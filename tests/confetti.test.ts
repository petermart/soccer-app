/**
 * The celebration is physics, not a hand-drawn easing curve, so it can be
 * checked like anything else: does it go up, does it come down, and does it
 * ever fall faster than it should?
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PHYSICS, makePieces, trajectory, type Burst } from "../src/ui/confetti.ts";

/** Pulls the translate values back out of a keyframe's transform. */
function xy(transform: string): { x: number; y: number } {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(transform);
  if (!m) throw new Error(`Unreadable transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

const shot = (over: Partial<Burst> = {}): Burst => ({
  angleDeg: 60, speed: 1200, direction: 1, spinDeg: 720, delay: 0, duration: 3, ...over,
});

describe("confetti physics", () => {
  test("a piece rises, turns over, and comes back down", () => {
    const points = trajectory(shot()).map((f) => xy(f.transform));
    const peak = Math.min(...points.map((p) => p.y)); // y grows downward
    const peakAt = points.findIndex((p) => p.y === peak);

    expect(peak).toBeLessThan(-200);            // it really did go up
    expect(peakAt).toBeGreaterThan(0);          // not at the muzzle
    expect(peakAt).toBeLessThan(points.length - 1); // and not at the end
    expect(points.at(-1)!.y).toBeGreaterThan(peak); // it fell back afterwards
  });

  test("it never falls faster than terminal velocity", () => {
    const burst = shot({ duration: 6 });
    const frames = trajectory(burst);
    const dt = burst.duration / DEFAULT_PHYSICS.steps;
    for (let i = 1; i < frames.length; i++) {
      const drop = xy(frames[i]!.transform).y - xy(frames[i - 1]!.transform).y;
      // A small tolerance: the clamp is applied before the position step.
      expect(drop / dt).toBeLessThanOrEqual(DEFAULT_PHYSICS.terminalVelocity * 1.02);
    }
  });

  test("direction decides which way it flies, and nothing else changes", () => {
    const right = trajectory(shot({ direction: 1 })).map((f) => xy(f.transform));
    const left = trajectory(shot({ direction: -1 })).map((f) => xy(f.transform));
    expect(right.at(-1)!.x).toBeGreaterThan(0);
    expect(left.at(-1)!.x).toBeLessThan(0);
    // Mirrored horizontally, identical vertically.
    expect(left.at(-1)!.x).toBeCloseTo(-right.at(-1)!.x, 1);
    expect(left.at(-1)!.y).toBeCloseTo(right.at(-1)!.y, 1);
  });

  test("a steeper launch goes higher and travels less far", () => {
    const shallow = trajectory(shot({ angleDeg: 30 })).map((f) => xy(f.transform));
    const steep = trajectory(shot({ angleDeg: 80 })).map((f) => xy(f.transform));
    expect(Math.min(...steep.map((p) => p.y))).toBeLessThan(Math.min(...shallow.map((p) => p.y)));
    expect(Math.abs(steep.at(-1)!.x)).toBeLessThan(Math.abs(shallow.at(-1)!.x));
  });

  test("frames are ordered, span the whole flight, and fade only at the end", () => {
    const frames = trajectory(shot());
    expect(frames[0]!.offset).toBe(0);
    expect(frames.at(-1)!.offset).toBeCloseTo(1, 6);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.offset).toBeGreaterThan(frames[i - 1]!.offset);
      expect(frames[i]!.opacity).toBeLessThanOrEqual(frames[i - 1]!.opacity);
    }
    expect(frames.find((f) => f.offset <= 0.7)!.opacity).toBe(1);
    expect(frames.at(-1)!.opacity).toBeCloseTo(0, 5);
  });

  test("both corners fire, inward, in equal numbers", () => {
    const pieces = makePieces(120, 1280, 835);
    const left = pieces.filter((p) => p.fromLeft);
    const right = pieces.filter((p) => !p.fromLeft);
    expect(left.length).toBe(60);
    expect(right.length).toBe(60);
    // Left cannon fires right, right cannon fires left.
    expect(left.every((p) => p.direction === 1)).toBe(true);
    expect(right.every((p) => p.direction === -1)).toBe(true);
    // Every shot points upward and into the screen.
    expect(pieces.every((p) => p.angleDeg > 0 && p.angleDeg < 90)).toBe(true);
    expect(pieces.every((p) => p.speed > 0 && p.duration > 0)).toBe(true);
  });

  test("the layout is stable, so a re-render cannot reshuffle mid-flight", () => {
    expect(makePieces(40, 1280, 835)).toEqual(makePieces(40, 1280, 835));
  });

  test("the cannons are aimed high, not at 45 degrees", () => {
    const pieces = makePieces(200, 1280, 835);
    // Every shot climbs more than it flies, and the fan runs to near-vertical.
    expect(Math.min(...pieces.map((p) => p.angleDeg))).toBeGreaterThanOrEqual(44);
    expect(Math.max(...pieces.map((p) => p.angleDeg))).toBeGreaterThan(80);
  });

  test("the charge is sized to the screen height, so the burst reaches the top", () => {
    for (const [w, h] of [[1280, 835], [1920, 1080], [390, 780]] as [number, number][]) {
      const peaks = makePieces(200, w, h).map((p) =>
        Math.min(...trajectory(p).map((f) => xy(f.transform).y)));
      const reachedTop = peaks.filter((y) => -y >= h * 0.95).length / peaks.length;
      const reachedHalf = peaks.filter((y) => -y >= h * 0.5).length / peaks.length;
      // A good share crest the top of the screen, nearly all clear halfway,
      // and none are wasted flying miles above it.
      expect(reachedTop).toBeGreaterThan(0.25);
      expect(reachedHalf).toBeGreaterThan(0.85);
      expect(peaks.every((y) => -y < h * 1.8)).toBe(true);
    }
  });

  test("a taller screen gets a bigger charge", () => {
    const short = makePieces(20, 1280, 700);
    const tall = makePieces(20, 1280, 1200);
    expect(Math.max(...tall.map((p) => p.speed)))
      .toBeGreaterThan(Math.max(...short.map((p) => p.speed)));
  });
});
