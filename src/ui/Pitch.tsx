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
  onSlotClick?: (index: number) => void;
}

export function Pitch({ slots, picks, ratings, showRatings, highlight, targetIndex, onSlotClick }: PitchProps) {
  return (
    <div className="pitch">
      <svg className="pitch-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="2" y="2" width="96" height="96" />
        <circle cx="50" cy="50" r="11" />
        <line x1="2" y1="50" x2="98" y2="50" />
        <rect x="26" y="2" width="48" height="14" />
        <rect x="26" y="84" width="48" height="14" />
        <rect x="38" y="2" width="24" height="6" />
        <rect x="38" y="92" width="24" height="6" />
      </svg>

      {slots.map((slot) => {
        const pick = picks[slot.index];
        const isTarget = targetIndex === slot.index;
        const canTake = highlight?.has(slot.index) ?? false;
        const [x, y] = slot.coords;
        const classes = [
          "slot",
          pick ? "filled" : "",
          canTake ? "targetable" : "",
          isTarget ? "target" : "",
        ].filter(Boolean).join(" ");

        return (
          <button
            key={slot.index}
            className={classes}
            style={{ left: `${x}%`, bottom: `${y}%` }}
            disabled={!onSlotClick || (!!pick && !canTake)}
            onClick={() => onSlotClick?.(slot.index)}
            title={pick ? `${pick.player.name} — ${pick.club} ${pick.season}` : slot.slot}
          >
            <span className="slot-badge">
              {pick && showRatings ? ratings[slot.index] ?? pick.player.overall : slot.slot}
            </span>
            {pick && (
              <>
                <span className="slot-name">{pick.player.name}</span>
                <span className="slot-club">{pick.club}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
