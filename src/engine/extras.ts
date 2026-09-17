/**
 * Optional layers on top of the league season: a manager who tilts your
 * side one way or another, a January gamble, and a European knockout run.
 */
import { LEAGUES, type LeagueId } from "./leagues.ts";
import { Rng } from "./rng.ts";
import type { TeamRating } from "./ratings.ts";
import type { ClubSeason } from "./types.ts";
import { MODEL } from "./simulate.ts";

export interface Gaffer {
  id: string;
  name: string;
  style: string;
  blurb: string;
  attack: number;
  defence: number;
}

/** Archetypes rather than real managers, so nobody's likeness is used. */
export const GAFFERS: Gaffer[] = [
  { id: "professor", name: "The Professor", style: "Possession", blurb: "Keeps the ball, strangles the game.", attack: 1.04, defence: 1.03 },
  { id: "sergeant", name: "The Sergeant", style: "Low block", blurb: "Concede the ball, never the goal.", attack: 0.94, defence: 1.1 },
  { id: "firestarter", name: "The Firestarter", style: "Gegenpress", blurb: "Full throttle for ninety minutes. Nothing held back.", attack: 1.12, defence: 0.95 },
  { id: "architect", name: "The Architect", style: "Balanced", blurb: "No weaknesses, no fireworks.", attack: 1.03, defence: 1.05 },
  { id: "gambler", name: "The Gambler", style: "All-out attack", blurb: "Wins 5-4. Loses 4-5. Never bores you.", attack: 1.18, defence: 0.86 },
  { id: "caretaker", name: "The Caretaker", style: "None", blurb: "Names the XI, stays out of the way.", attack: 1, defence: 1 },
];

export interface JanuaryEvent {
  id: string;
  title: string;
  text: string;
  attack: number;
  defence: number;
  /** Relative likelihood of being drawn. */
  weight: number;
}

/** Half the deck helps, half hurts. No undo, by design. */
export const JANUARY_EVENTS: JanuaryEvent[] = [
  { id: "wonderkid", title: "Wonderkid arrives", text: "A teenager nobody had heard of walks straight into the XI.", attack: 1.07, defence: 1, weight: 3 },
  { id: "marquee", title: "Marquee signing", text: "The board finally opens the cheque book.", attack: 1.09, defence: 1.02, weight: 2 },
  { id: "rock", title: "Defensive rock signed", text: "A proper old-fashioned centre half.", attack: 1, defence: 1.08, weight: 3 },
  { id: "keeper", title: "Keeper finds form", text: "Suddenly he is saving everything.", attack: 1, defence: 1.06, weight: 3 },
  { id: "acl", title: "Star man injured", text: "Out for the season. The physio would not look up.", attack: 0.9, defence: 0.97, weight: 3 },
  { id: "bust-up", title: "Dressing-room bust-up", text: "Two senior players, one training-ground argument.", attack: 0.95, defence: 0.94, weight: 3 },
  { id: "fixture-pileup", title: "Fixture pile-up", text: "Three games a week until March. Legs are going.", attack: 0.96, defence: 0.95, weight: 2 },
  { id: "nothing", title: "A quiet window", text: "Deadline day came and went. Nothing happened.", attack: 1, defence: 1, weight: 4 },
  { id: "talisman-sold", title: "Talisman sold", text: "The bid was too big to turn down.", attack: 0.87, defence: 1, weight: 2 },
  { id: "system-clicks", title: "The system clicks", text: "Something finally makes sense out there.", attack: 1.06, defence: 1.05, weight: 2 },
];

export function drawJanuaryEvent(seed: string): JanuaryEvent {
  const rng = new Rng(`${seed}:january`);
  return rng.weighted(JANUARY_EVENTS, (e) => e.weight);
}

export interface CupTie {
  round: string;
  opponent: string;
  opponentSeason: string;
  legs: { yourGoals: number; theirGoals: number }[];
  yourAggregate: number;
  theirAggregate: number;
  won: boolean;
  /** Set when the tie was level and went to penalties. */
  penalties?: { you: number; them: number };
}

export interface CupRun {
  name: string;
  ties: CupTie[];
  /** "Winners", "Final", "Semi-final", ... or "Did not qualify". */
  finish: string;
  won: boolean;
  qualified: boolean;
}

const CUP_ROUNDS = ["Round of 16", "Quarter-final", "Semi-final", "Final"];

/**
 * European nights. Finish high enough and your XI plays the best of the
 * other four leagues over two legs, with a one-legged final.
 */
export function simulateCup(opts: {
  rating: TeamRating;
  league: LeagueId;
  leaguePosition: number;
  /** Elite club-seasons from every league, used as continental opposition. */
  continental: ClubSeason[];
  seed: string;
  attackModifier?: number;
  defenceModifier?: number;
}): CupRun {
  const qualifySpots = 7;
  if (opts.leaguePosition > qualifySpots) {
    return { name: "European Nights", ties: [], finish: "Did not qualify", won: false, qualified: false };
  }

  const rng = new Rng(`${opts.seed}:cup`);
  const attack = opts.rating.attack * (opts.attackModifier ?? 1);
  const defence = opts.rating.defence * (opts.defenceModifier ?? 1);

  // Continental opposition is drawn from the strongest sides on the continent.
  const pool = [...opts.continental]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 60);

  const ties: CupTie[] = [];
  let alive = true;

  for (const round of CUP_ROUNDS) {
    if (!alive) break;
    const opp = rng.pick(pool);
    const oneLeg = round === "Final";
    const legs: CupTie["legs"] = [];

    for (let leg = 0; leg < (oneLeg ? 1 : 2); leg++) {
      // Neutral venue for the final, otherwise alternate home and away.
      const venue = oneLeg ? 1 : leg === 0 ? MODEL.homeAdvantage : MODEL.awayPenalty;
      const oppVenue = oneLeg ? 1 : leg === 0 ? MODEL.awayPenalty : MODEL.homeAdvantage;
      const base = LEAGUES[opts.league].avgGoals;
      const xgYou = clamp(base * Math.exp(MODEL.goalSensitivity * ((attack - opp.defence) / 10)) * venue);
      const xgThem = clamp(base * Math.exp(MODEL.goalSensitivity * ((opp.attack - defence) / 10)) * oppVenue);
      legs.push({ yourGoals: rng.poisson(xgYou), theirGoals: rng.poisson(xgThem) });
    }

    const yourAggregate = legs.reduce((s, l) => s + l.yourGoals, 0);
    const theirAggregate = legs.reduce((s, l) => s + l.theirGoals, 0);
    let won = yourAggregate > theirAggregate;
    let penalties: CupTie["penalties"];
    if (yourAggregate === theirAggregate) {
      // A shootout is close to a coin flip, with a nudge for the better side.
      const edge = 0.5 + Math.max(-0.12, Math.min(0.12, (attack - opp.attack) / 160));
      const you = 3 + rng.int(3);
      const them = rng.next() < edge ? you - 1 : you + 1;
      penalties = { you: Math.max(you, 0), them: Math.max(them, 0) };
      won = penalties.you > penalties.them;
    }

    ties.push({
      round, opponent: opp.club, opponentSeason: opp.season,
      legs, yourAggregate, theirAggregate, won, penalties,
    });
    alive = won;
  }

  const lastTie = ties.at(-1);
  const finish = !lastTie
    ? "Did not qualify"
    : lastTie.won && lastTie.round === "Final"
      ? "Winners"
      : lastTie.round;

  return { name: "European Nights", ties, finish, won: finish === "Winners", qualified: true };
}

const clamp = (xg: number) => Math.min(MODEL.maxGoals, Math.max(MODEL.minGoals, xg));
