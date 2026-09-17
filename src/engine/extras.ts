/**
 * Optional layers on top of the league season: a manager you roll for, who
 * tilts how your side plays, and a January window you can gamble on.
 */
import { canPlaySlot, rateTeam, ratingInSlot, type Pick, type RatingLens } from "./ratings.ts";
import { Rng } from "./rng.ts";
import type { MatchStyle } from "./simulate.ts";
import type { ClubSeason, PlayerSeason } from "./types.ts";

export interface Gaffer extends MatchStyle {
  id: string;
  name: string;
  style: string;
  blurb: string;
}

/**
 * Archetypes rather than real managers, so nobody's likeness is used.
 *
 * `attack` and `defence` are rating points and `tempo` scales the goals in
 * your games at both ends. One rating point is worth about 6% more (or fewer)
 * goals, so the most any gaffer adds net is one point: they change the
 * character of a season far more than its outcome.
 */
export const GAFFERS: Gaffer[] = [
  { id: "professor", name: "The Professor", style: "Possession", blurb: "Keeps the ball, strangles the game. Fewer goals at both ends.", attack: 0.5, defence: 0.5, tempo: 0.88 },
  { id: "sergeant", name: "The Sergeant", style: "Low block", blurb: "Concede the ball, never the goal. Not many scored either.", attack: -2, defence: 2.5, tempo: 0.85 },
  { id: "firestarter", name: "The Firestarter", style: "Gegenpress", blurb: "Full throttle for ninety minutes. Leaves space behind.", attack: 1.5, defence: -1, tempo: 1.08 },
  { id: "architect", name: "The Architect", style: "Balanced", blurb: "No weaknesses, no fireworks.", attack: 0.5, defence: 0.5, tempo: 0.96 },
  { id: "gambler", name: "The Gambler", style: "All-out attack", blurb: "Wins 4-3. Loses 3-4. Never bores you.", attack: 2, defence: -2.5, tempo: 1.18 },
  { id: "caretaker", name: "The Caretaker", style: "Hands-off", blurb: "Names the XI, stays out of the way.", attack: 0, defence: 0, tempo: 1 },
];

/** The manager you get is rolled, not chosen. Same seed, same gaffer. */
export function rollGaffer(seed: string): Gaffer {
  return new Rng(`${seed}:gaffer`).pick(GAFFERS);
}

// ------------------------------------------------------------------ January

export type JanuaryTone = "good" | "bad" | "neutral";

export interface JanuaryMove {
  slotIndex: number;
  out: Pick;
  in: Pick;
  reason: string;
}

export interface JanuaryOutcome {
  id: string;
  title: string;
  text: string;
  tone: JanuaryTone;
  moves: JanuaryMove[];
  /** Your XI for the second half. Equal to the input when nothing happened. */
  picks: Pick[];
}

interface JanuaryCard {
  id: string;
  title: string;
  text: string;
  tone: JanuaryTone;
  weight: number;
  /** How many players leave. */
  count: number;
  /** Who goes: the weakest, the best, or anyone. */
  target: "weakest" | "best" | "random";
  /** Rating change for the replacement, relative to who left: [min, max]. */
  delta: [number, number];
  reason: string;
}

/**
 * The deck. Every card that changes the XI brings in a real player-season
 * from this league's archive who can genuinely play the vacated slot. Roughly
 * half the weight helps and half hurts, so rolling is a real gamble.
 */
export const JANUARY_CARDS: JanuaryCard[] = [
  { id: "marquee", title: "Marquee signing", text: "The board finally opens the cheque book for your weakest position.", tone: "good", weight: 2, count: 1, target: "weakest", delta: [4, 10], reason: "Replaced by a marquee signing" },
  { id: "upgrade", title: "Shrewd upgrade", text: "A better option comes up late on deadline day.", tone: "good", weight: 3, count: 1, target: "random", delta: [2, 6], reason: "Upgraded on deadline day" },
  { id: "double", title: "Double swoop", text: "Two new faces walk straight into the XI.", tone: "good", weight: 1, count: 2, target: "random", delta: [1, 5], reason: "Replaced in a double swoop" },
  { id: "swap", title: "Player-plus-player swap", text: "A like-for-like deal with a rival club.", tone: "neutral", weight: 3, count: 1, target: "random", delta: [-2, 2], reason: "Swapped like-for-like" },
  { id: "quiet", title: "A quiet window", text: "Deadline day came and went. Nothing happened.", tone: "neutral", weight: 2, count: 0, target: "random", delta: [0, 0], reason: "" },
  { id: "sold", title: "Star man sold", text: "The bid for your best player was too big to turn down.", tone: "bad", weight: 2, count: 1, target: "best", delta: [-10, -5], reason: "Sold — the bid was too big" },
  { id: "injury", title: "Season-ending injury", text: "Out for the season. The physio would not look up.", tone: "bad", weight: 3, count: 1, target: "random", delta: [-9, -4], reason: "Injured for the season" },
  { id: "crisis", title: "Injury crisis", text: "Two players down in the same week. The kids have to step up.", tone: "bad", weight: 1, count: 2, target: "random", delta: [-7, -3], reason: "Injured, backup comes in" },
];

export interface JanuaryOptions {
  picks: Pick[];
  pool: ClubSeason[];
  lens: RatingLens;
  seasonRange: [string, string];
  seed: string;
}

/** Rolls the January window. Deterministic for a given seed and XI. */
export function rollJanuary(opts: JanuaryOptions): JanuaryOutcome {
  const rng = new Rng(`${opts.seed}:january`);
  const card = rng.weighted(JANUARY_CARDS, (c) => c.weight);
  const quiet = JANUARY_CARDS.find((c) => c.id === "quiet")!;

  const picks = [...opts.picks].sort((a, b) => a.slotIndex - b.slotIndex);
  const rated = picks.map((p) => ({ pick: p, rating: ratingInSlot(p.player, p.slot, opts.lens) }));
  const order =
    card.target === "weakest" ? [...rated].sort((a, b) => a.rating - b.rating)
    : card.target === "best" ? [...rated].sort((a, b) => b.rating - a.rating)
    : rng.shuffle(rated);

  const inXi = new Set(picks.map((p) => p.player.pid));
  const candidates = opts.pool.filter(
    (cs) => cs.season >= opts.seasonRange[0] && cs.season <= opts.seasonRange[1],
  );

  const moves: JanuaryMove[] = [];
  for (const { pick, rating } of order) {
    if (moves.length >= card.count) break;
    const replacement = findReplacement(pick, rating, card.delta, candidates, inXi, opts.lens, rng);
    if (!replacement) continue;
    inXi.add(replacement.player.pid);
    moves.push({
      slotIndex: pick.slotIndex,
      out: pick,
      in: {
        player: replacement.player, slot: pick.slot, slotIndex: pick.slotIndex,
        club: replacement.club.club, season: replacement.club.season,
      },
      reason: card.reason,
    });
  }

  // A card that found nobody suitable is, in effect, a quiet window.
  const played = moves.length > 0 || card.count === 0 ? card : quiet;
  const next = picks.map((p) => moves.find((m) => m.slotIndex === p.slotIndex)?.in ?? p);
  return { id: played.id, title: played.title, text: played.text, tone: played.tone, moves, picks: next };
}

/**
 * A real player-season who can play the slot, rated inside the wanted band.
 * The band widens a step at a time if nobody fits, but never flips direction:
 * a bad card cannot turn into an upgrade.
 */
function findReplacement(
  out: Pick, outRating: number, [lo, hi]: [number, number],
  pool: ClubSeason[], exclude: Set<number>, lens: RatingLens, rng: Rng,
): { player: PlayerSeason; club: ClubSeason } | null {
  const all: { player: PlayerSeason; club: ClubSeason; rating: number }[] = [];
  for (const club of pool) {
    for (const player of club.players) {
      if (exclude.has(player.pid) || !canPlaySlot(player, out.slot)) continue;
      all.push({ player, club, rating: ratingInSlot(player, out.slot, lens) });
    }
  }
  for (let widen = 0; widen <= 6; widen++) {
    const min = outRating + (lo > 0 ? lo : lo - widen);
    const max = Math.min(99, outRating + (hi < 0 ? hi : hi + widen));
    const fit = all.filter((c) => c.rating >= min && c.rating <= max);
    if (fit.length) return rng.pick(fit);
  }
  return null;
}

/** Net change in team rating from a January outcome, for the summary line. */
export function januaryImpact(before: Pick[], after: Pick[], lens: RatingLens): number {
  return Math.round((rateTeam(after, lens).overall - rateTeam(before, lens).overall) * 10) / 10;
}
