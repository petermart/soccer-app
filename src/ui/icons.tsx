import type { LeagueId } from "../engine/leagues.ts";

/**
 * Inline SVG furniture.
 *
 * Everything here is drawn rather than pulled from an emoji font, because
 * flag emoji do not render at all on Windows — they come out as bare letter
 * pairs, or an empty box for England.
 */

/** National flags, 3:2, for the competition cards. */
export function Flag({ league, className = "" }: { league: LeagueId; className?: string }) {
  return (
    <svg className={`flag ${className}`} viewBox="0 0 30 20" role="img" aria-label={FLAG_LABEL[league]}>
      {FLAG_ART[league]}
      <rect x="0.25" y="0.25" width="29.5" height="19.5" rx="1.5" className="flag-edge" />
    </svg>
  );
}

const FLAG_LABEL: Record<LeagueId, string> = {
  eng: "Flag of England",
  esp: "Flag of Spain",
  ger: "Flag of Germany",
  ita: "Flag of Italy",
  fra: "Flag of France",
};

const FLAG_ART: Record<LeagueId, React.ReactNode> = {
  // St George's cross.
  eng: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect x="12.5" width="5" height="20" fill="#ce1124" />
      <rect y="7.5" width="30" height="5" fill="#ce1124" />
    </>
  ),
  // Red, gold, red in a 1:2:1 band.
  esp: (
    <>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </>
  ),
  ger: (
    <>
      <rect width="30" height="6.667" fill="#000" />
      <rect y="6.667" width="30" height="6.667" fill="#dd0000" />
      <rect y="13.333" width="30" height="6.667" fill="#ffce00" />
    </>
  ),
  ita: (
    <>
      <rect width="10" height="20" fill="#008c45" />
      <rect x="10" width="10" height="20" fill="#f4f5f0" />
      <rect x="20" width="10" height="20" fill="#cd212a" />
    </>
  ),
  fra: (
    <>
      <rect width="10" height="20" fill="#002395" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ed2939" />
    </>
  ),
};

/**
 * A tumbling die for anything decided by a roll.
 *
 * Deliberately blank: the cube carries no pips at any point, because the
 * thing being rolled is a manager or a transfer card, not a number, and
 * showing a face would imply a value that means nothing here.
 */
export function Die({ rolling = false, className = "" }: { rolling?: boolean; className?: string }) {
  return (
    <svg
      className={`die${rolling ? " is-rolling" : ""} ${className}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      {/* Motion arcs, shown only while it is in the air. */}
      <g className="die-motion">
        <path d="M7 24a17 17 0 0 1 6-13" />
        <path d="M41 24a17 17 0 0 1-6 13" />
      </g>
      <g className="die-cube">
        {/* An isometric cube: top, left and right faces, all unmarked. */}
        <path className="die-top" d="M24 8 39 16.5 24 25 9 16.5Z" />
        <path className="die-left" d="M9 16.5 24 25v17L9 33.5Z" />
        <path className="die-right" d="M39 16.5 24 25v17l15-8.5Z" />
      </g>
    </svg>
  );
}

/**
 * A spinning prize wheel for the club draw.
 *
 * The segments are unlabelled on purpose — the club that comes up is shown
 * in words beside it, and numbering the wedges would suggest the wheel has
 * fixed positions that mean something.
 */
export function SpinWheel({ spinning = false, className = "" }: { spinning?: boolean; className?: string }) {
  const segments = 8;
  const wedges = Array.from({ length: segments }, (_, i) => {
    const a0 = (i / segments) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2 - Math.PI / 2;
    const r = 19;
    const x0 = 24 + r * Math.cos(a0);
    const y0 = 24 + r * Math.sin(a0);
    const x1 = 24 + r * Math.cos(a1);
    const y1 = 24 + r * Math.sin(a1);
    return <path key={i} className={`wheel-wedge w${i % 4}`} d={`M24 24 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} />;
  });

  return (
    <svg
      className={`spin-wheel${spinning ? " is-spinning" : ""} ${className}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <g className="wheel-face">
        {wedges}
        <circle cx="24" cy="24" r="19" className="wheel-rim" />
        <circle cx="24" cy="24" r="4" className="wheel-hub" />
      </g>
      {/* The pointer stays put while the face turns under it. */}
      <path className="wheel-pointer" d="M24 1.5 28 8h-8Z" />
    </svg>
  );
}
