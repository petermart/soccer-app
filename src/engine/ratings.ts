import { SLOT_INDEX, SLOT_LINE, type Line, type PlayerSeason, type Slot } from "./types.ts";

export type RatingLens = "season" | "prime";

/** A drafted player, pinned to the slot they occupy. */
export interface Pick {
  player: PlayerSeason;
  slot: Slot;
  slotIndex: number;
  club: string;
  season: string;
}

/**
 * How good a player is in a given slot, under the chosen lens.
 *
 * The dataset already carries a per-slot rating, which is what makes playing
 * someone out of position cost you something real rather than a flat penalty.
 */
export function ratingInSlot(player: PlayerSeason, slot: Slot, lens: RatingLens): number {
  if (lens === "prime") {
    // Read the rating the player actually had in their best season. Scaling
    // the current one by prime/overall used to invent numbers: a 49-rated
    // teenager multiplied by 80/49 came out at 91, eleven points above the
    // peak he ever reached, and worst in Ligue 1 where the young and lowly
    // rated are thickest on the ground.
    const peak = player.primeSlotRatings?.[SLOT_INDEX[slot]] ?? 0;
    if (peak > 0) return peak;
    return outOfPositionFallback(player, slot, player.prime);
  }
  const raw = player.slotRatings[SLOT_INDEX[slot]] ?? 0;
  return raw > 0 ? raw : outOfPositionFallback(player, slot, player.overall);
}

/**
 * Keepers have no outfield ratings and outfielders have no GK rating. Rather
 * than let a nonsense pick read as zero, fall back to a heavy penalty so the
 * squad is still playable but clearly worse for it.
 */
function outOfPositionFallback(player: PlayerSeason, slot: Slot, from: number): number {
  const isKeeper = player.positions.includes("GK");
  const wantsKeeper = slot === "GK";
  if (isKeeper && !wantsKeeper) return Math.max(20, from - 32);
  if (!isKeeper && wantsKeeper) return Math.max(20, from - 30);
  return Math.max(20, from - 12);
}

/**
 * Formation slots that are one role under two names. EA lists them
 * inconsistently across editions (FC 24 onwards barely uses CF or the
 * wing-back labels), so a listed striker may lead the line whichever name the
 * formation gives it. Wide midfield and wing are NOT merged: EA rates them
 * differently and so does this game.
 */
const SAME_ROLE: Partial<Record<Slot, Slot>> = {
  ST: "CF", CF: "ST", RB: "RWB", RWB: "RB", LB: "LWB", LWB: "LB",
};

/**
 * True when a player can legally occupy a slot: it must be one of their
 * primary or secondary positions from across their career.
 */
export function canPlaySlot(player: PlayerSeason, slot: Slot): boolean {
  const isKeeper = player.positions.includes("GK");
  if (isKeeper !== (slot === "GK")) return false;
  const known = player.careerPositions;
  const alias = SAME_ROLE[slot];
  return known.includes(slot) || (alias !== undefined && known.includes(alias));
}

/** Every formation-slot name a listed position covers, e.g. CF -> [CF, ST]. */
export function slotNamesFor(position: Slot): Slot[] {
  const alias = SAME_ROLE[position];
  return alias ? [position, alias] : [position];
}

/** The formation-slot names a player can be dropped into. */
export function playableSlots(player: PlayerSeason): Slot[] {
  return [...new Set(player.careerPositions.flatMap(slotNamesFor))];
}

export interface TeamRating {
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
  /** Weighted whole-team number shown on the badge. */
  overall: number;
  /** 0-1: how evenly the four lines are stocked. */
  balance: number;
  /** Penalty already folded into attack/defence, kept for the UI to explain. */
  balancePenalty: number;
  /** Per-line mean before the penalty. */
  lines: Record<Line, number>;
  /** Slot ratings keyed by formation index. */
  perSlot: number[];
}

/** Mean that leans on the weakest link — one liability really does hurt. */
function softMin(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  return mean * 0.78 + min * 0.22;
}

export function rateTeam(picks: Pick[], lens: RatingLens): TeamRating {
  const perSlot: number[] = [];
  const byLine: Record<Line, number[]> = { GK: [], DEF: [], MID: [], ATT: [] };

  for (const p of picks) {
    const r = ratingInSlot(p.player, p.slot, lens);
    perSlot[p.slotIndex] = r;
    byLine[SLOT_LINE[p.slot]].push(r);
  }

  const lines: Record<Line, number> = {
    GK: byLine.GK.length ? softMin(byLine.GK) : 60,
    DEF: byLine.DEF.length ? softMin(byLine.DEF) : 60,
    MID: byLine.MID.length ? softMin(byLine.MID) : 60,
    ATT: byLine.ATT.length ? softMin(byLine.ATT) : 60,
  };

  // A side that is all attack and no defence should not rate as elite.
  const vals = [lines.GK, lines.DEF, lines.MID, lines.ATT];
  const mean = vals.reduce((a, b) => a + b, 0) / 4;
  const spread = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / 4);
  const balancePenalty = Math.min(6, spread * 0.45);
  const balance = Math.max(0, 1 - spread / 18);

  // Midfield feeds both boxes, so it contributes to attack and defence alike.
  const attack = lines.ATT * 0.62 + lines.MID * 0.38 - balancePenalty;
  const defence = lines.DEF * 0.55 + lines.GK * 0.24 + lines.MID * 0.21 - balancePenalty;

  const overall =
    lines.GK * 0.12 + lines.DEF * 0.3 + lines.MID * 0.31 + lines.ATT * 0.27 - balancePenalty * 0.5;

  return {
    attack: round1(attack),
    midfield: round1(lines.MID),
    defence: round1(defence),
    keeper: round1(lines.GK),
    overall: round1(overall),
    balance: Math.round(balance * 100) / 100,
    balancePenalty: round1(balancePenalty),
    lines: {
      GK: round1(lines.GK), DEF: round1(lines.DEF),
      MID: round1(lines.MID), ATT: round1(lines.ATT),
    },
    perSlot,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Share of the team's goals a player is likely to take, by slot and quality. */
export function goalShareWeight(pick: Pick, rating: number): number {
  const byLine: Record<Line, number> = { GK: 0.001, DEF: 0.06, MID: 0.26, ATT: 1 };
  const bySlot: Partial<Record<Slot, number>> = {
    ST: 1.3, CF: 1.2, RW: 0.85, LW: 0.85, CAM: 0.6, CM: 0.32, CDM: 0.12,
    RM: 0.45, LM: 0.45, CB: 0.055, RB: 0.05, LB: 0.05, RWB: 0.07, LWB: 0.07, GK: 0.001,
  };
  const quality = Math.max(0.2, (rating - 55) / 30);
  return (bySlot[pick.slot] ?? byLine[SLOT_LINE[pick.slot]]) * quality;
}

/** Share of assists, which skews to creators rather than finishers. */
export function assistShareWeight(pick: Pick, rating: number): number {
  const bySlot: Partial<Record<Slot, number>> = {
    CAM: 1.25, RW: 1.0, LW: 1.0, RM: 0.95, LM: 0.95, CM: 0.7, ST: 0.6, CF: 0.7,
    CDM: 0.3, RWB: 0.4, LWB: 0.4, RB: 0.3, LB: 0.3, CB: 0.1, GK: 0.02,
  };
  const quality = Math.max(0.2, (rating - 55) / 30);
  return (bySlot[pick.slot] ?? 0.2) * quality;
}
