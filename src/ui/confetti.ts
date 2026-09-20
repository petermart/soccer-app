/**
 * Confetti trajectories, integrated rather than eyeballed.
 *
 * A CSS keyframe with a hand-picked easing curve cannot describe a launch:
 * the rise and the fall obey the same acceleration, and a falling scrap of
 * paper stops speeding up once drag balances gravity. So each piece is
 * stepped through a small physics model here and handed to the Web Animations
 * API as sampled keyframes — real motion, still composited by the browser.
 *
 * Everything is in pixels and seconds. The model is deliberately simple:
 * constant gravity, exponential drag on both axes, and a terminal velocity
 * the downward speed is clamped to.
 */

export interface Burst {
  /** Launch direction above the horizontal, in degrees. */
  angleDeg: number;
  /** Launch speed in px/s. */
  speed: number;
  /** +1 fires to the right, -1 to the left. */
  direction: 1 | -1;
  /** Total rotation over the flight, in degrees. */
  spinDeg: number;
  /** Seconds to wait before firing. */
  delay: number;
  /** Seconds of flight. */
  duration: number;
}

export interface Physics {
  /** Downward acceleration, px/s². */
  gravity: number;
  /** The fastest a piece may fall, px/s. Paper does not accelerate forever. */
  terminalVelocity: number;
  /** Air resistance, as an exponential decay rate per second. */
  drag: number;
  /** How many samples to hand the browser. */
  steps: number;
}

/**
 * Tuned so a mid-range shot peaks around two thirds of the way up a laptop
 * screen and then drifts down rather than dropping like a stone. Gravity is
 * well below the real 9.8 m/s² on purpose: at screen scale, true gravity
 * turns the arc into a twitch.
 */
export const DEFAULT_PHYSICS: Physics = {
  gravity: 950,
  terminalVelocity: 620,
  drag: 0.32,
  steps: 40,
};

/** Shaped for the Web Animations API, which wants an index signature. */
export interface Frame {
  [property: string]: string | number | null | undefined;
  offset: number;
  transform: string;
  opacity: number;
}

/**
 * Steps one piece through its flight and returns Web Animations keyframes.
 *
 * Screen coordinates: y grows downward, so an upward launch starts with a
 * negative vertical velocity and gravity pulls it back towards positive.
 */
export function trajectory(burst: Burst, physics: Physics = DEFAULT_PHYSICS): Frame[] {
  const { gravity, terminalVelocity, drag, steps } = physics;
  const dt = burst.duration / steps;
  const radians = (burst.angleDeg * Math.PI) / 180;

  let x = 0;
  let y = 0;
  let vx = Math.cos(radians) * burst.speed * burst.direction;
  let vy = -Math.sin(radians) * burst.speed;

  const frames: Frame[] = [{ offset: 0, transform: `translate3d(0px, 0px, 0) rotate(0deg)`, opacity: 1 }];

  for (let i = 1; i <= steps; i++) {
    vy += gravity * dt;
    // Drag acts on both axes; the clamp is what keeps the fall gentle.
    const decay = Math.exp(-drag * dt);
    vx *= decay;
    vy *= decay;
    if (vy > terminalVelocity) vy = terminalVelocity;

    x += vx * dt;
    y += vy * dt;

    const offset = i / steps;
    frames.push({
      offset,
      transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(burst.spinDeg * offset).toFixed(0)}deg)`,
      // Hold full opacity until the tail, then fade rather than blink out.
      opacity: offset < 0.75 ? 1 : Math.max(0, 1 - (offset - 0.75) / 0.25),
    });
  }

  return frames;
}

export interface Piece extends Burst {
  /** Which bottom corner it is fired from. */
  fromLeft: boolean;
  /** Palette index. */
  hue: number;
  /** Every so often, a football instead of a paper scrap. */
  ball: boolean;
}

/**
 * Lays out one volley from each bottom corner.
 *
 * Both cannons fire inward and upward across a wide spread of angles, so the
 * two streams cross in the middle of the screen. Values are derived from the
 * index rather than Math.random so a re-render cannot reshuffle mid-flight.
 */
export function makePieces(
  count: number,
  viewportWidth: number,
  viewportHeight: number,
  physics: Physics = DEFAULT_PHYSICS,
): Piece[] {
  // Size the charge off the screen HEIGHT, because "does it reach the top" is
  // the thing you actually notice. Ignoring drag, clearing a height H needs an
  // upward velocity of sqrt(2gH); DRAG_MAKEUP covers what air resistance eats.
  const DRAG_MAKEUP = 1.18;
  const REFERENCE_ANGLE = Math.sin((66 * Math.PI) / 180);
  const toTop = Math.sqrt(2 * physics.gravity * viewportHeight);
  const base = (toTop / REFERENCE_ANGLE) * DRAG_MAKEUP;

  return Array.from({ length: count }, (_, i) => {
    const golden = (i * 0.6180339887) % 1;
    const fromLeft = i % 2 === 0;
    return {
      fromLeft,
      direction: (fromLeft ? 1 : -1) as 1 | -1,
      // Cannons are aimed high, not at 45°: the fan runs from a steep
      // inward arc to very nearly straight up, which is how a real popper
      // sits. Even the shallowest shot here still climbs more than it flies.
      angleDeg: 44 + golden * 44,
      speed: base * (0.84 + ((i * 11) % 32) / 100),
      spinDeg: (i % 2 === 0 ? 1 : -1) * (360 + ((i * 29) % 7) * 220),
      // A short stagger reads as one bang rather than a stream.
      delay: golden * 0.22,
      duration: 3 + ((i * 7) % 26) / 10,
      hue: i % 5,
      ball: i % 9 === 0,
    };
  });
}
