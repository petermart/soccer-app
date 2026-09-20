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

/** One of your goals: who scored, who set it up, and roughly when. */
export interface GoalEvent {
  minute: number;
  pid: number;
  name: string;
  assistPid: number | null;
  assistName: string | null;
}

export interface Match {
  round: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  /** Your goals in this match, in minute order. Empty for matches without you. */
  yourGoals: GoalEvent[];
  /**
   * The minutes the opposition scored, in order. Only populated for your own
   * matches, and without scorers: the archive holds no opposition line-ups,
   * so naming who scored would be invention.
   */
  oppGoals: number[];
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
  pid: number;
  name: string;
  slot: string;
  goals: number;
  assists: number;
  /** False for anyone who left the XI in January. */
  finishedSeason: boolean;
}

export interface SeasonResult {
  league: LeagueId;
  leagueName: string;
  seasonLabel: string;
  matches: Match[];
  table: TableRow[];
  you: TableRow;
  /** The XI that started the season. */
  rating: TeamRating;
  /** The XI after the halfway change, when there was one. */
  secondHalfRating: TeamRating | null;
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
  /** Rounds on the calendar; equals gamesPlayed unless the field is odd. */
  rounds: number;
  /** Last round of the first half, where the January window opens. */
  halfwayRound: number;
  /** The club whose place in that season's league you took. */
  replacedClub: string | null;
  longestWinStreak: number;
  biggestWin: { match: Match; margin: number } | null;
  worstDefeat: { match: Match; margin: number } | null;
  headline: string;
}

/**
 * How a manager sets a side up. Effects are in rating points and a goal-rate
 * multiplier, deliberately small: a manager tilts a side, never transforms it.
 */
export interface MatchStyle {
  /** Rating points added to your attack (can be negative). */
  attack: number;
  /** Rating points added to your defence (can be negative). */
  defence: number;
  /** Multiplies both sides' expected goals in your matches: open or cagey. */
  tempo: number;
}

export const NEUTRAL_STYLE: MatchStyle = { attack: 0, defence: 0, tempo: 1 };

export interface SimOptions {
  league: LeagueId;
  picks: Pick[];
  lens: RatingLens;
  /** Club-seasons to field as opposition; the sim picks from these. */
  pool: ClubSeason[];
  /** Which real season you drop into. Chosen at random when omitted. */
  opponentSeason?: string;
  seed: string;
  style?: MatchStyle;
  /** Your XI from the second half on, after a January change. */
  secondHalfPicks?: Pick[];
  teamName?: string;
}

/**
 * Model constants, checked in scripts/calibrate.ts against real league tables.
 *
 * goalSensitivity is the important one: it says how much a rating edge is
 * worth. FIFA overalls are compressed into a narrow band, so a small number
 * here would leave elite sides barely better than mid-table ones.
 *
 * maxGoals caps expected goals, not the scoreline. Even the most lopsided real
 * fixtures rarely carry more than ~4 xG for one side; above that, Poisson
 * tails start producing 9-2s that almost never happen in these leagues.
 */
export const MODEL = {
  goalSensitivity: 0.62,
  homeAdvantage: 1.18,
  awayPenalty: 0.88,
  maxGoals: 3.6,
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
export function expectedGoals(
  attack: number, oppDefence: number, base: number, venue: number, tempo = 1,
): number {
  const edge = (attack - oppDefence) / 10;
  const xg = base * Math.exp(MODEL.goalSensitivity * edge) * venue * tempo;
  return Math.min(MODEL.maxGoals, Math.max(MODEL.minGoals, xg));
}

/** Which real season you drop into, and the clubs you face in it. */
export function fieldFor(pool: ClubSeason[], season: string) {
  const field = pool.filter((c) => c.season === season);
  const ranked = [...field].sort((a, b) => b.rating - a.rating);
  return {
    field,
    opponents: ranked.slice(0, Math.max(0, field.length - 1)),
    replaced: ranked.at(-1) ?? null,
  };
}

export function simulateSeason(opts: SimOptions): SeasonResult {
  const cfg = LEAGUES[opts.league];
  const style = opts.style ?? NEUTRAL_STYLE;

  // You drop into one real season of this league, taking the place of the
  // club that finished weakest that year. Everyone else is exactly who they
  // really were.
  const season =
    opts.opponentSeason ??
    new Rng(`${opts.seed}:season`).pick([...new Set(opts.pool.map((c) => c.season))].sort());
  const { field, opponents, replaced } = fieldFor(opts.pool, season);
  if (field.length < 4) throw new Error(`No usable field for ${opts.league} ${season}`);

  // The league is as big as it really was that year; you take one club's place.
  const teams = field.length;
  const gamesPlayed = 2 * (teams - 1);
  const perfectTarget = `${gamesPlayed}-0`;

  const rating = rateTeam(opts.picks, opts.lens);
  const secondHalfRating = opts.secondHalfPicks ? rateTeam(opts.secondHalfPicks, opts.lens) : null;
  const yourClub = (r: TeamRating): Club => ({
    id: YOU,
    name: opts.teamName?.trim() || "Your XI",
    attack: r.attack + style.attack,
    defence: r.defence + style.defence,
    isYou: true,
  });

  const clubs: Club[] = [
    yourClub(rating),
    ...opponents.map((cs) => ({
      id: cs.key, name: cs.club, attack: cs.attack, defence: cs.defence, isYou: false,
    })),
  ];

  const fixtures = buildFixtures(clubs.map((c) => c.id));
  const rounds = fixtures.reduce((m, f) => Math.max(m, f.round), 0);
  const halfwayRound = Math.floor(rounds / 2);
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const secondHalfClub = secondHalfRating ? yourClub(secondHalfRating) : null;
  const firstShares = shares(opts.picks, rating);
  const secondShares = opts.secondHalfPicks && secondHalfRating
    ? shares(opts.secondHalfPicks, secondHalfRating)
    : firstShares;

  const matches: Match[] = fixtures.map((f) => {
    const late = f.round > halfwayRound;
    const pick = (id: string) => (id === YOU && late && secondHalfClub ? secondHalfClub : byId.get(id)!);
    // Every match draws from its own stream, so changing the second half can
    // never disturb a result that has already been played.
    const rng = new Rng(`${opts.seed}:m:${f.round}:${f.homeId}:${f.awayId}`);
    return playMatch(f.round, pick(f.homeId), pick(f.awayId), rng, cfg.avgGoals, style, late ? secondShares : firstShares);
  });

  const table = buildTable(clubs, matches);
  const you = table.find((r) => r.isYou)!;
  const scorers = tallyScorers(opts.picks, opts.secondHalfPicks ?? null, matches);

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
    secondHalfRating,
    scorers,
    perfect: isPerfect,
    invincible,
    champion,
    perfectTarget,
    teams,
    gamesPlayed,
    rounds,
    halfwayRound,
    replacedClub: replaced?.club ?? null,
    longestWinStreak: longest,
    biggestWin: biggest,
    worstDefeat: worst,
    headline: headlineFor(you, perfectTarget, isPerfect, invincible, champion, gamesPlayed, teams),
  };
}

interface Fixture { round: number; homeId: string; awayId: string }

/** Round-robin, home and away, using the circle method for a valid calendar. */
function buildFixtures(ids: string[]): Fixture[] {
  const rotation = ids.length % 2 === 0 ? ids.slice() : [...ids, "__bye__"];
  const size = rotation.length;
  const rounds = size - 1;
  const fixtures: Fixture[] = [];

  for (let leg = 0; leg < 2; leg++) {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < size / 2; i++) {
        const a = rotation[i]!;
        const b = rotation[size - 1 - i]!;
        if (a === "__bye__" || b === "__bye__") continue;
        // Alternate who is at home so every club gets a fair split.
        const flip = leg === 1 ? (i + r) % 2 === 0 : (i + r) % 2 === 1;
        fixtures.push({ round: leg * rounds + r + 1, homeId: flip ? b : a, awayId: flip ? a : b });
      }
      // Rotate all but the first entry.
      rotation.splice(1, 0, rotation.pop()!);
    }
  }
  return fixtures;
}

interface Share { pick: Pick; gw: number; aw: number }

function shares(picks: Pick[], rating: TeamRating): Share[] {
  return picks.map((p) => {
    const r = rating.perSlot[p.slotIndex] ?? p.player.overall;
    return { pick: p, gw: goalShareWeight(p, r), aw: assistShareWeight(p, r) };
  });
}

function playMatch(
  round: number, home: Club, away: Club, rng: Rng, base: number,
  style: MatchStyle, yourShares: Share[],
): Match {
  const withYou = home.isYou || away.isYou;
  const tempo = withYou ? style.tempo : 1;
  const xgHome = expectedGoals(home.attack, away.defence, base, MODEL.homeAdvantage, tempo);
  const xgAway = expectedGoals(away.attack, home.defence, base, MODEL.awayPenalty, tempo);
  const homeGoals = rng.poisson(xgHome);
  const awayGoals = rng.poisson(xgAway);

  const yourGoals: GoalEvent[] = [];
  const oppGoals: number[] = [];
  if (withYou) {
    const n = home.isYou ? homeGoals : awayGoals;
    for (let i = 0; i < n; i++) {
      const scorer = rng.weighted(yourShares, (s) => s.gw).pick;
      // Roughly three in four goals are assisted, never by the scorer.
      const assist = rng.next() < 0.74
        ? rng.weighted(yourShares, (s) => (s.pick.player.pid === scorer.player.pid ? 0 : s.aw)).pick
        : null;
      yourGoals.push({
        minute: 1 + rng.int(90),
        pid: scorer.player.pid,
        name: scorer.player.name,
        assistPid: assist?.player.pid ?? null,
        assistName: assist?.player.name ?? null,
      });
    }
    yourGoals.sort((a, b) => a.minute - b.minute);

    const against = home.isYou ? awayGoals : homeGoals;
    for (let i = 0; i < against; i++) oppGoals.push(1 + rng.int(90));
    oppGoals.sort((a, b) => a - b);
  }

  return { round, homeId: home.id, awayId: away.id, homeGoals, awayGoals, yourGoals, oppGoals };
}

function buildTable(clubs: { id: string; name: string; isYou: boolean }[], matches: Match[]): TableRow[] {
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

/** The league table as it stood after a given round, for the live view. */
export function tableAfter(result: SeasonResult, round: number): TableRow[] {
  const clubs = result.table.map(({ id, name, isYou }) => ({ id, name, isYou }));
  return buildTable(clubs, result.matches.filter((m) => m.round <= round));
}

/** Season goals and assists, built from every match so the two always agree. */
function tallyScorers(first: Pick[], second: Pick[] | null, matches: Match[]): ScorerRow[] {
  const rows = new Map<number, ScorerRow>();
  const stayed = new Set((second ?? first).map((p) => p.player.pid));
  for (const p of [...first, ...(second ?? [])]) {
    if (rows.has(p.player.pid)) continue;
    rows.set(p.player.pid, {
      pid: p.player.pid, name: p.player.name, slot: p.slot,
      goals: 0, assists: 0, finishedSeason: stayed.has(p.player.pid),
    });
  }
  for (const m of matches) {
    for (const g of m.yourGoals) {
      rows.get(g.pid)!.goals++;
      if (g.assistPid !== null) rows.get(g.assistPid)!.assists++;
    }
  }
  return [...rows.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists);
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
  if (you.position <= 4) return `Top four on ${you.points} points. Champions League football.`;
  if (you.position <= 7) return `${ordinal(you.position)} place. A season of almosts.`;
  if (you.position > teams - 3) return `${ordinal(you.position)}. Relegated.`;
  if (you.position > teams - 5) return `${ordinal(you.position)}. That is a relegation scrap.`;
  return `${ordinal(you.position)} on ${you.points} points. Mid-table anonymity.`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
