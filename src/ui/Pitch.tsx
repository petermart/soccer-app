import type { SquadSlot } from "../engine/formations.ts";
import type { Pick } from "../engine/ratings.ts";

export interface PitchProps {
  slots: SquadSlot[];
  picks: (Pick | null)[];
  ratings: number[];
  showRatings: boolean;
  /** Slots the current selection could legally fill. */
  highlight?: Set<number>;
  targetIndex?: number | null;
  /** The drafted player currently being moved, if any. */
  movingIndex?: number | null;
  onSlotClick?: (index: number) => void;
}

export function Pitch({ slots, picks, ratings, showRatings, highlight, targetIndex, movingIndex, onSlotClick }: PitchProps) {
  return (
    <div className="pitch" data-testid="pitch">
      <PitchMarkings />

      {slots.map((slot) => {
        const pick = picks[slot.index];
        const canTake = highlight?.has(slot.index) ?? false;
        const [x, y] = slot.coords;
        const classes = [
          "slot",
          pick ? "filled" : "",
          canTake ? "targetable" : "",
          targetIndex === slot.index ? "target" : "",
          movingIndex === slot.index ? "moving" : "",
        ].filter(Boolean).join(" ");

        return (
          <button
            key={slot.index}
            className={classes}
            style={{ left: `${x}%`, bottom: `${y}%` }}
            disabled={!onSlotClick}
            onClick={() => onSlotClick?.(slot.index)}
            title={pick ? `${pick.player.name} — ${pick.club} ${pick.season}. Click to move.` : slot.label}
            data-testid={`slot-${slot.index}`}
            data-slot={slot.slot}
            data-side={slot.side ?? ""}
            data-filled={pick ? "true" : "false"}
            data-pid={pick?.player.pid}
          >
            <span className="slot-badge">
              {pick && showRatings ? ratings[slot.index] ?? pick.player.overall : slot.slot}
            </span>
            {pick && (
              <span className="slot-label">
                <span className="slot-name">{pick.player.name}</span>
                <span className="slot-club">{slot.label} · {pick.club}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pitch markings at real proportions.
 *
 * The box is 100x100 but stretched to the pitch's 3:4 frame, so the two axes
 * do not share a scale. Everything below is therefore authored in that
 * stretched space: a regulation 105m x 68m pitch mapped onto the viewBox,
 * with circles drawn as ellipses because a true circle would come out as an
 * egg once the box is stretched.
 */
function PitchMarkings() {
  // A 105m x 68m pitch: one unit of x is 0.68m, one unit of y is 1.05m.
  const X = (metres: number) => (metres / 68) * 100;
  const Y = (metres: number) => (metres / 105) * 100;

  const edge = 1.6;                    // touchline inset
  const top = edge;
  const bottom = 100 - edge;
  const mid = 50;

  const boxW = X(40.32);               // penalty area, 40.32m wide
  const boxD = Y(16.5);                // and 16.5m deep
  const sixW = X(18.32);
  const sixD = Y(5.5);
  const spot = Y(11);                  // penalty spot, 11m out
  const arcRx = X(9.15);               // centre circle / arc radius, 9.15m
  const arcRy = Y(9.15);
  const cornerRx = X(1);
  const cornerRy = Y(1);

  const boxX = 50 - boxW / 2;
  const sixX = 50 - sixW / 2;

  // Where the penalty arc meets the edge of the box, so only the part
  // outside the area is drawn — as it is on a real pitch.
  const arcDy = boxD - spot;
  const arcDx = arcRx * Math.sqrt(Math.max(0, 1 - (arcDy / arcRy) ** 2));

  return (
    <svg className="pitch-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x={edge} y={top} width={100 - edge * 2} height={100 - edge * 2} />
      <line x1={edge} y1={mid} x2={100 - edge} y2={mid} />
      <ellipse cx={50} cy={mid} rx={arcRx} ry={arcRy} />
      <ellipse className="pitch-spot" cx={50} cy={mid} rx={0.7} ry={0.45} />

      {/* Defensive end (nearest the keeper). */}
      <rect x={boxX} y={bottom - boxD} width={boxW} height={boxD} />
      <rect x={sixX} y={bottom - sixD} width={sixW} height={sixD} />
      <ellipse className="pitch-spot" cx={50} cy={bottom - spot} rx={0.7} ry={0.45} />
      <path d={`M ${50 - arcDx} ${bottom - boxD} A ${arcRx} ${arcRy} 0 0 1 ${50 + arcDx} ${bottom - boxD}`} />

      {/* Attacking end. */}
      <rect x={boxX} y={top} width={boxW} height={boxD} />
      <rect x={sixX} y={top} width={sixW} height={sixD} />
      <ellipse className="pitch-spot" cx={50} cy={top + spot} rx={0.7} ry={0.45} />
      <path d={`M ${50 - arcDx} ${top + boxD} A ${arcRx} ${arcRy} 0 0 0 ${50 + arcDx} ${top + boxD}`} />

      {/* Corner arcs. */}
      <path d={`M ${edge + cornerRx} ${top} A ${cornerRx} ${cornerRy} 0 0 1 ${edge} ${top + cornerRy}`} />
      <path d={`M ${100 - edge - cornerRx} ${top} A ${cornerRx} ${cornerRy} 0 0 0 ${100 - edge} ${top + cornerRy}`} />
      <path d={`M ${edge + cornerRx} ${bottom} A ${cornerRx} ${cornerRy} 0 0 0 ${edge} ${bottom - cornerRy}`} />
      <path d={`M ${100 - edge - cornerRx} ${bottom} A ${cornerRx} ${cornerRy} 0 0 1 ${100 - edge} ${bottom - cornerRy}`} />
    </svg>
  );
}
