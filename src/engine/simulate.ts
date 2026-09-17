/**
 * Season simulation.
 *
 * Your XI is dropped into a real league season: the other 17 or 19 clubs are
 * actual club-seasons from the archive, carrying their real squad strength.
 * Every club plays every other home and away, so the table around you is
 * coherent rather than decorative.
 */
import { LEAGUES, type LeagueId } from "./leagues.ts";
import { Rng } from "./rng.ts";
import {
  assistShareWeight, goalShareWeight, rateTeam,
  type Pick, type RatingLens, type TeamRating,
} from "./ratings.ts";
import type { ClubSeason } from "./types.ts";

export const YOU = "__you__";

export interface Club {
  id: string;
  name: string;
  attack: number;
  defence: number;
  isYou: boolean;
}

export interface Match {
  round: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  id: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  isYou: boolean;
  position: number;
  /** Most recent five results, newest last. */
  form: ("W" | "D" | "L")[];
}

export interface ScorerRow {
  name: string;
  slot: string;
  goals: number;
  assists: number;
}

export interface SeasonResult {
  league: LeagueId;
  leagueName: string;
  seasonLabel: string;
  matches: Match[];
  table: TableRow[];
  you: TableRow;
  rating: TeamRating;
  scorers: ScorerRow[];
  /** True when you won every single match. */
  perfect: boolean;
  invincible: boolean;
  champion: boolean;
  /** e.g. "38-0", or "34-0" in a season the league ran 18 clubs. */
  perfectTarget: string;
  /** Clubs in the league that season, including you. */
  teams: number;
  /** Games each club played that season. */
  gamesPlayed: number;
  /** The club whose place in that season's league you took. */
  replacedClub: string | null;
  longestWinStreak: number;
  biggestWin: { match: Match; margin: number } | null;
  worstDefeat: { match: Match; margin: number } | null;
  headline: string;
}

export interface SimOptions {
  league: LeagueId;
  picks: Pick[];
  lens: RatingLens;
  /** Club-seasons to field as opposition; the sim picks from these. */
  pool: ClubSeason[];
  /** Which real season you drop into. Chosen at random when omitted. */
  opponentSeason?: string;
  seed: string;
  /** Multiplicative nudges from gaffers, transfer events and so on. */
  attackModifier?: number;
  defenceModifier?: number;
  teamName?: string;
}

/**
 * Model constants, fitted in scripts/calibrate.ts against real league tables.
 *
 * GOAL_SENSITIVITY is the important one: it says how much a rating edge is
 * worth. FIFA overalls are compressed into a narrow band, so a small number
 * here would leave elite sides barely better than mid-table ones.
 */
export const MODEL = {
  goalSensitivity: 0.62,
  homeAdvantage: 1.18,
  awayPenalty: 0.88,
  maxGoals: 7,
  minGoals: 0.08,
} as const;

/**
 * How big a league was in a given season, taken from the real field rather
 * than assumed. Serie A ran 18 clubs until 2004/05 and Ligue 1 went back to
 * 18 in 2023/24, so the perfect target is not always 38-0.
 */
export function seasonShape(pool: ClubSeason[], season: string) {
  const teams = pool.reduce((n, c) => n + (c.season === season ? 1 : 0), 0);
  const matches = 2 * (teams - 1);
  return { teams, matches, perfect: `${matches}-0` };
}

/** Expected goals for one side of one fixture. */
function expectedGoals(attack: number, oppDefence: number, base: number, venue: number): number {
  const edge = (attack - oppDefence) / 10;
  const xg = base * Math.exp(MODEL.goalSensitivity * edge) * venue;
  return Math.min(MODEL.maxGoals, Math.max(MODEL.minGoals, xg));
}

export function simulateSeason(opts: SimOptions): SeasonResult {
  const cfg = LEAGUES[opts.league];
  const rng = new Rng(opts.seed);
  const rating = rateTeam(opts.picks, opts.lens);

  // You drop into one real season of this league, taking the place of the
  // club that finished weakest that year. Everyone else is exactly who they
  // really were.
  const season =
    opts.opponentSeason ??
    rng.pick([...new Set(opts.pool.map((c) => c.season))].sort());
  const field = opts.pool.filter((c) => c.season === season);
  if (field.length < 4) throw new Error(`No usable field for ${opts.league} ${season}`);

  // The league is as big as it really was that year; you take one club's place.
  const teams = field.length;
  const gamesPlayed = 2 * (teams - 1);
  const perfectTarget = `${gamesPlayed}-0`;

  const ranked = [...field].sort((a, b) => b.rating - a.rating);
  const opponents = ranked.slice(0, teams - 1);
  const replaced = ranked[teams - 1] ?? ranked.at(-1) ?? null;

  const clubs: Club[] = [
    {
      id: YOU,
      name: opts.teamName?.trim() || "Your XI",
      attack: rating.attack * (opts.attackModifier ?? 1),
      defence: rating.defence * (opts.defenceModifier ?? 1),
      isYou: true,
    },
    ...opponents.map((cs) => ({
      id: cs.key, name: cs.club, attack: cs.attack, defence: cs.defence, isYou: false,
    })),
  ];

  const matches = buildFixtures(clubs, rng, cfg.avgGoals);
  const table = buildTable(clubs, matches);
  const you = table.find((r) => r.isYou)!;

  const scorers = shareOutGoals(opts.picks, opts.lens, you.goalsFor, rng);

  let streak = 0;
  let longest = 0;
  let biggest: SeasonResult["biggestWin"] = null;
  let worst: SeasonResult["worstDefeat"] = null;
  for (const m of matches) {
    if (m.homeId !== YOU && m.awayId !== YOU) continue;
    const home = m.homeId === YOU;
    const gf = home ? m.homeGoals : m.awayGoals;
    const ga = home ? m.awayGoals : m.homeGoals;
    if (gf > ga) {
      streak++;
      longest = Math.max(longest, streak);
      if (!biggest || gf - ga > biggest.margin) biggest = { match: m, margin: gf - ga };
    } else {
      streak = 0;
      if (gf < ga && (!worst || ga - gf > worst.margin)) worst = { match: m, margin: ga - gf };
    }
  }

  const isPerfect = you.won === gamesPlayed;
  const invincible = you.lost === 0;
  const champion = you.position === 1;

  return {
    league: opts.league,
    leagueName: cfg.name,
    seasonLabel: season,
    matches,
    table,
    you,
    rating,
    scorers,
    perfect: isPerfect,
    invincible,
    champion,
    perfectTarget,
    teams,
    gamesPlayed,
    replacedClub: replaced?.club ?? null,
    longestWinStreak: longest,
    biggestWin: biggest,
    worstDefeat: worst,
    headline: headlineFor(you, perfectTarget, isPerfect, invincible, champion, gamesPlayed, teams),
  };
}

/** Round-robin, home and away, using the circle method for a valid calendar. */
function buildFixtures(clubs: Club[], rng: Rng, base: number): Match[] {
  const ids = clubs.map((c) => c.id);
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const n = ids.length;
  const rotation = n % 2 === 0 ? ids.slice() : [...ids, "__bye__"];
  const size = rotation.length;
  const rounds = size - 1;
  const matches: Match[] = [];

  for (let leg = 0; leg < 2; leg++) {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < size / 2; i++) {
        const a = rotation[i]!;
        const b = rotation[size - 1 - i]!;
        if (a === "__bye__" || b === "__bye__") continue;
        // Alternate who is at home so every club gets a fair split.
        const flip = leg === 1 ? (i + r) % 2 === 0 : (i + r) % 2 === 1;
        const homeId = flip ? b : a;
        const awayId = flip ? a : b;
        matches.push(playMatch(leg * rounds + r + 1, byId.get(homeId)!, byId.get(awayId)!, rng, base));
      }
      // Rotate all but the first entry.
      rotation.splice(1, 0, rotation.pop()!);
    }
  }
  return matches;
}

function playMatch(round: number, home: Club, away: Club, rng: Rng, base: number): Match {
  const xgHome = expectedGoals(home.attack, away.defence, base, MODEL.homeAdvantage);
  const xgAway = expectedGoals(away.attack, home.defence, base, MODEL.awayPenalty);
  return {
    round,
    homeId: home.id,
    awayId: away.id,
    homeGoals: rng.poisson(xgHome),
    awayGoals: rng.poisson(xgAway),
  };
}

function buildTable(clubs: Club[], matches: Match[]): TableRow[] {
  const rows = new Map<string, TableRow>(
    clubs.map((c) => [
      c.id,
      {
        id: c.id, name: c.name, played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
        isYou: c.isYou, position: 0, form: [],
      },
    ]),
  );

  for (const m of matches) {
    const h = rows.get(m.homeId)!;
    const a = rows.get(m.awayId)!;
    h.played++; a.played++;
    h.goalsFor += m.homeGoals; h.goalsAgainst += m.awayGoals;
    a.goalsFor += m.awayGoals; a.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) {
      h.won++; h.points += 3; a.lost++; h.form.push("W"); a.form.push("L");
    } else if (m.homeGoals < m.awayGoals) {
      a.won++; a.points += 3; h.lost++; h.form.push("L"); a.form.push("W");
    } else {
      h.drawn++; a.drawn++; h.points++; a.points++; h.form.push("D"); a.form.push("D");
    }
  }

  const table = [...rows.values()];
  for (const r of table) {
    r.goalDifference = r.goalsFor - r.goalsAgainst;
    r.form = r.form.slice(-5);
  }
  table.sort(
    (x, y) =>
      y.points - x.points ||
      y.goalDifference - x.goalDifference ||
      y.goalsFor - x.goalsFor ||
      x.name.localeCompare(y.name),
  );
  table.forEach((r, i) => { r.position = i + 1; });
  return table;
}

/** Hands your season's goals and assists out across the XI. */
function shareOutGoals(picks: Pick[], lens: RatingLens, totalGoals: number, rng: Rng): ScorerRow[] {
  const rating = rateTeam(picks, lens);
  const rows = picks.map((p) => ({
    name: p.player.name,
    slot: p.slot as string,
    goals: 0,
    assists: 0,
    gw: goalShareWeight(p, rating.perSlot[p.slotIndex] ?? p.player.overall),
    aw: assistShareWeight(p, rating.perSlot[p.slotIndex] ?? p.player.overall),
  }));

  for (let i = 0; i < totalGoals; i++) {
    rng.weighted(rows, (r) => r.gw).goals++;
    // Roughly three in four goals are assisted.
    if (rng.next() < 0.74) rng.weighted(rows, (r) => r.aw).assists++;
  }

  return rows
    .map(({ name, slot, goals, assists }) => ({ name, slot, goals, assists }))
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists);
}

function headlineFor(
  you: TableRow, target: string, perfect: boolean,
  invincible: boolean, champion: boolean, games: number, teams: number,
): string {
  if (perfect) return `${target}. Perfection. ${games} games, ${games} wins.`;
  if (invincible && champion) return `Champions, unbeaten. ${you.won} wins, ${you.drawn} draws.`;
  if (invincible) return `Unbeaten all season — and still not champions. Brutal.`;
  if (champion) return `Champions with ${you.points} points. ${you.won}-${you.drawn}-${you.lost}.`;
  if (you.position === 2) return `Runners-up on ${you.points} points. So close.`;
  if (you.position === 3) return `Third on ${you.points} points. On the podium, not on the trophy.`;
  if (you.position <= 4) return `Top four on ${you.points} points. Europe, at least.`;
  if (you.position <= 7) return `${ordinal(you.position)} place. A season of almosts.`;
  if (you.position > teams - 4) return `${ordinal(you.position)}. That is a relegation scrap.`;
  return `${ordinal(you.position)} on ${you.points} points. Mid-table anonymity.`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
