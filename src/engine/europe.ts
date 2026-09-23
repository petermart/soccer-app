/**
 * European nights.
 *
 * Where you finish your domestic season decides which competition you enter.
 * The clubs you meet there are the ones who really qualified for it that
 * season — taken from the previous season's actual league tables — and you
 * take the place of the club from your own league that scraped in last.
 *
 * WHAT IS SIMPLIFIED, AND HOW TO CORRECT IT
 *
 * `QUALIFICATION` below is the whole rule, in one place. It says: top four to
 * the Champions League, fifth to the Europa League, sixth to the Conference
 * League, for every league in every season. That is close to today's shape
 * but it is not the real rulebook, which varies by league and by year:
 *
 *   - Cup winners enter the Europa League regardless of where they finish,
 *     which pushes league places down a rung.
 *   - The two best-performing countries have earned a fifth Champions League
 *     place since 2024/25, so fifth is sometimes a Champions League club.
 *   - Before 2024/25 France and Italy often had three Champions League
 *     places, not four; Germany had three until 2011/12.
 *   - The Conference League only exists from 2021/22. Before that, sixth
 *     place went to the Europa League, and before 2009/10 that competition
 *     was the UEFA Cup.
 *
 * Change `QUALIFICATION` — including per league or per season — and the rest
 * of this file follows. Nothing else encodes who qualifies for what.
 *
 * ALSO WORTH KNOWING: the fields here are built only from the big five
 * leagues, because those are the only leagues the archive holds ratings for.
 * A real Champions League also has clubs from Portugal, the Netherlands,
 * Scotland and beyond.
 */
import { expectedGoals, MODEL, NEUTRAL_STYLE, YOU, type GoalEvent, type Match, type MatchStyle } from "./simulate.ts";
import { LEAGUES, type LeagueId } from "./leagues.ts";
import { goalShareWeight, assistShareWeight, rateTeam, type Pick, type RatingLens } from "./ratings.ts";
import { Rng } from "./rng.ts";

export type Competition = "cl" | "el" | "uecl";

export const COMPETITIONS: Record<Competition, { name: string; short: string; accent: string }> = {
  cl: { name: "Champions League", short: "UCL", accent: "#3b82f6" },
  el: { name: "Europa League", short: "UEL", accent: "#f5c518" },
  uecl: { name: "Conference League", short: "UECL", accent: "#00ff87" },
};

/**
 * Finishing place -> competition. Index 0 is first place.
 *
 * This is the single rule described at the top of the file. Give a league its
 * own array to depart from it.
 */
export const QUALIFICATION: { default: (Competition | null)[]; byLeague?: Partial<Record<LeagueId, (Competition | null)[]>> } = {
  default: ["cl", "cl", "cl", "cl", "el", "uecl"],
};

/** Which competition a finishing position earns, or null for none. */
export function competitionFor(league: LeagueId, position: number): Competition | null {
  const table = QUALIFICATION.byLeague?.[league] ?? QUALIFICATION.default;
  return table[position - 1] ?? null;
}

/** One club's entry in a season's European draw, as built by build-europe.ts. */
export interface Qualifier {
  club: string;
  prevPos: number;
  rating: number;
  attack: number;
  defence: number;
}

export type EuropeData = Record<string, Partial<Record<LeagueId, Qualifier[]>>>;

export interface EuroClub {
  id: string;
  name: string;
  league: LeagueId;
  /** Where they finished last season, which is why they are in this draw. */
  prevPos: number;
  rating: number;
  attack: number;
  defence: number;
  isYou: boolean;
}

/**
 * Everyone in a competition that season, with you swapped in.
 *
 * You displace the club from your own league that qualified most narrowly —
 * the one that scraped the last place — because that is the place you would
 * have taken had you really finished where you did.
 */
export function buildField(opts: {
  data: EuropeData;
  season: string;
  competition: Competition;
  yourLeague: LeagueId;
  yourName: string;
  yourAttack: number;
  yourDefence: number;
}): { field: EuroClub[]; displaced: string | null } {
  const bySeason = opts.data[opts.season] ?? {};
  const field: EuroClub[] = [];

  for (const league of Object.keys(bySeason) as LeagueId[]) {
    const qualifiers = bySeason[league] ?? [];
    qualifiers.forEach((q, i) => {
      // Position in the queue, not the raw finish: when a club that finished
      // high has since left the division, everyone below moves up a place.
      if (competitionFor(league, i + 1) !== opts.competition) return;
      field.push({
        id: `${league}:${q.club}`,
        name: q.club,
        league,
        prevPos: q.prevPos,
        rating: q.rating,
        attack: q.attack,
        defence: q.defence,
        isYou: false,
      });
    });
  }

  // The last of your countrymen in — lowest finish, and if that ties, the
  // weakest of them — makes way.
  const mine = field.filter((c) => c.league === opts.yourLeague);
  const victim = mine.sort((a, b) => b.prevPos - a.prevPos || a.rating - b.rating)[0] ?? null;
  const remaining = victim ? field.filter((c) => c !== victim) : field;

  return {
    field: [
      {
        id: YOU,
        name: opts.yourName,
        league: opts.yourLeague,
        prevPos: 0,
        rating: (opts.yourAttack + opts.yourDefence) / 2,
        attack: opts.yourAttack,
        defence: opts.yourDefence,
        isYou: true,
      },
      ...remaining,
    ],
    displaced: victim?.name ?? null,
  };
}

export interface EuroTableRow {
  id: string;
  name: string;
  league: LeagueId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
  isYou: boolean;
}

export interface Tie {
  round: string;
  opponentId: string;
  opponent: string;
  opponentLeague: LeagueId;
  legs: Match[];
  yourAggregate: number;
  theirAggregate: number;
  won: boolean;
  penalties: { you: number; them: number } | null;
  /** True for the one-legged final on neutral ground. */
  neutral: boolean;
}

export interface EuroRun {
  competition: Competition;
  season: string;
  /** Everyone in the draw, you included. */
  clubs: EuroClub[];
  /** The club from your league whose place you took. */
  displaced: string | null;
  leaguePhase: Match[];
  table: EuroTableRow[];
  /** Your position after the league phase. */
  leaguePosition: number;
  ties: Tie[];
  /** "Winners", "Final", "Semi-final", "League phase" … */
  finish: string;
  won: boolean;
  /** Your matches in order, for the match list. */
  yourMatches: Match[];
}

/** Goals per club per game across a European season — a shade below league. */
const EURO_BASE = 1.32;

interface Share { pick: Pick; gw: number; aw: number }

function sharesFor(picks: Pick[], lens: RatingLens): Share[] {
  const rating = rateTeam(picks, lens);
  return picks.map((p) => {
    const r = rating.perSlot[p.slotIndex] ?? p.player.overall;
    return { pick: p, gw: goalShareWeight(p, r), aw: assistShareWeight(p, r) };
  });
}

function playMatch(
  round: number, home: EuroClub, away: EuroClub, rng: Rng, style: MatchStyle,
  shares: Share[], venue: "home" | "away" | "neutral",
): Match {
  const withYou = home.isYou || away.isYou;
  const tempo = withYou ? style.tempo : 1;
  const homeVenue = venue === "neutral" ? 1 : MODEL.homeAdvantage;
  const awayVenue = venue === "neutral" ? 1 : MODEL.awayPenalty;

  const homeAttack = home.attack + (home.isYou ? style.attack : 0);
  const homeDefence = home.defence + (home.isYou ? style.defence : 0);
  const awayAttack = away.attack + (away.isYou ? style.attack : 0);
  const awayDefence = away.defence + (away.isYou ? style.defence : 0);

  const homeGoals = rng.poisson(expectedGoals(homeAttack, awayDefence, EURO_BASE, homeVenue, tempo));
  const awayGoals = rng.poisson(expectedGoals(awayAttack, homeDefence, EURO_BASE, awayVenue, tempo));

  const yourGoals: GoalEvent[] = [];
  const oppGoals: number[] = [];
  if (withYou) {
    const mine = home.isYou ? homeGoals : awayGoals;
    for (let i = 0; i < mine; i++) {
      const scorer = rng.weighted(shares, (s) => s.gw).pick;
      const assist = rng.next() < 0.74
        ? rng.weighted(shares, (s) => (s.pick.player.pid === scorer.player.pid ? 0 : s.aw)).pick
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

/**
 * The league phase.
 *
 * A big field plays eight matches against eight different opponents, the way
 * the competition has run since 2024/25. A small field simply plays everyone
 * home and away, which also comes to eight when there are five clubs.
 */
function leaguePhase(clubs: EuroClub[], rng: Rng, style: MatchStyle, shares: Share[]): Match[] {
  const matches: Match[] = [];
  const rotation = clubs.length % 2 === 0 ? [...clubs] : [...clubs, null];
  const size = rotation.length;
  const roundsAvailable = size - 1;
  const legs = clubs.length >= 12 ? 1 : 2;
  const rounds = legs === 1 ? Math.min(8, roundsAvailable) : roundsAvailable;

  for (let leg = 0; leg < legs; leg++) {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < size / 2; i++) {
        const a = rotation[i];
        const b = rotation[size - 1 - i];
        if (!a || !b) continue;
        const flip = leg === 1 ? (i + r) % 2 === 0 : (i + r) % 2 === 1;
        const home = flip ? b : a;
        const away = flip ? a : b;
        matches.push(playMatch(leg * rounds + r + 1, home, away, rng, style, shares, "home"));
      }
      rotation.splice(1, 0, rotation.pop()!);
    }
  }
  return matches;
}

function buildTable(clubs: EuroClub[], matches: Match[]): EuroTableRow[] {
  const rows = new Map<string, EuroTableRow>(
    clubs.map((c) => [c.id, {
      id: c.id, name: c.name, league: c.league, played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, position: 0, isYou: c.isYou,
    }]),
  );
  for (const m of matches) {
    const h = rows.get(m.homeId);
    const a = rows.get(m.awayId);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.goalsFor += m.homeGoals; h.goalsAgainst += m.awayGoals;
    a.goalsFor += m.awayGoals; a.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) { h.won++; h.points += 3; a.lost++; }
    else if (m.homeGoals < m.awayGoals) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  const table = [...rows.values()];
  for (const r of table) r.goalDifference = r.goalsFor - r.goalsAgainst;
  table.sort((x, y) =>
    y.points - x.points || y.goalDifference - x.goalDifference ||
    y.goalsFor - x.goalsFor || x.name.localeCompare(y.name));
  table.forEach((r, i) => { r.position = i + 1; });
  return table;
}

/** One knockout tie: two legs, or a single neutral match for the final. */
function playTie(
  round: string, you: EuroClub, them: EuroClub, rng: Rng, style: MatchStyle,
  shares: Share[], neutral: boolean, youHomeFirst: boolean,
): Tie {
  const legs: Match[] = [];
  if (neutral) {
    legs.push(playMatch(1, you, them, rng, style, shares, "neutral"));
  } else {
    const first = youHomeFirst ? [you, them] : [them, you];
    const second = youHomeFirst ? [them, you] : [you, them];
    legs.push(playMatch(1, first[0]!, first[1]!, rng, style, shares, "home"));
    legs.push(playMatch(2, second[0]!, second[1]!, rng, style, shares, "home"));
  }

  let yourAggregate = 0;
  let theirAggregate = 0;
  for (const m of legs) {
    const youHome = m.homeId === you.id;
    yourAggregate += youHome ? m.homeGoals : m.awayGoals;
    theirAggregate += youHome ? m.awayGoals : m.homeGoals;
  }

  let won = yourAggregate > theirAggregate;
  let penalties: Tie["penalties"] = null;
  if (yourAggregate === theirAggregate) {
    // Close to a coin flip, with a nudge towards the better side.
    const edge = 0.5 + Math.max(-0.12, Math.min(0.12, (you.attack - them.attack) / 160));
    const scored = 3 + rng.int(3);
    const conceded = rng.next() < edge ? scored - 1 : scored + 1;
    penalties = { you: scored, them: Math.max(0, conceded) };
    won = penalties.you > penalties.them;
  }

  return {
    round, opponentId: them.id, opponent: them.name, opponentLeague: them.league,
    legs, yourAggregate, theirAggregate, won, penalties, neutral,
  };
}

export interface EuroOptions {
  data: EuropeData;
  season: string;
  competition: Competition;
  yourLeague: LeagueId;
  yourName: string;
  picks: Pick[];
  lens: RatingLens;
  yourAttack: number;
  yourDefence: number;
  style?: MatchStyle;
  seed: string;
}

/** Plays a whole European campaign: league phase, then the knockout. */
export function simulateEurope(opts: EuroOptions): EuroRun {
  const rng = new Rng(`${opts.seed}:europe:${opts.competition}`);
  const style = opts.style ?? NEUTRAL_STYLE;
  const shares = sharesFor(opts.picks, opts.lens);

  const { field, displaced } = buildField({
    data: opts.data, season: opts.season, competition: opts.competition,
    yourLeague: opts.yourLeague, yourName: opts.yourName,
    yourAttack: opts.yourAttack, yourDefence: opts.yourDefence,
  });

  const phase = leaguePhase(field, rng, style, shares);
  const table = buildTable(field, phase);
  const you = table.find((r) => r.isYou)!;
  const byId = new Map(field.map((c) => [c.id, c]));
  const seed = (position: number) => byId.get(table[position - 1]!.id)!;

  const ties: Tie[] = [];
  let alive = true;
  let survivor = you.position;

  const bigField = field.length >= 12;
  const knockoutCut = bigField ? 12 : 2;

  if (you.position <= knockoutCut) {
    if (bigField) {
      // Top four go straight to the quarter-finals; 5th to 12th play off.
      let quarterSeed = you.position;
      if (you.position > 4) {
        const opponent = seed(17 - you.position); // 5v12, 6v11, 7v10, 8v9
        const tie = playTie("Play-off", byId.get(YOU)!, opponent, rng, style, shares, false, you.position <= 8);
        ties.push(tie);
        alive = tie.won;
        quarterSeed = Math.min(you.position, 17 - you.position);
      }
      for (const [round, pool] of [["Quarter-final", 8], ["Semi-final", 4], ["Final", 2]] as const) {
        if (!alive) break;
        // A plausible opponent for that stage: someone who was around you in
        // the table, never yourself.
        const opponent = pickOpponent(table, byId, rng, quarterSeed, pool);
        const tie = playTie(round, byId.get(YOU)!, opponent, rng, style, shares, round === "Final", quarterSeed % 2 === 1);
        ties.push(tie);
        alive = tie.won;
        survivor = quarterSeed;
      }
    } else {
      // A small field settles it with a single final between the top two.
      const opponent = seed(you.position === 1 ? 2 : 1);
      const tie = playTie("Final", byId.get(YOU)!, opponent, rng, style, shares, true, true);
      ties.push(tie);
      alive = tie.won;
    }
  } else {
    alive = false;
  }

  void survivor;
  const last = ties.at(-1);
  const finish = ties.length === 0
    ? `Out in the league phase (${ordinalish(you.position)})`
    : last!.won && last!.round === "Final"
      ? "Winners"
      : last!.round === "Final" ? "Runners-up" : `Out in the ${last!.round.toLowerCase()}`;

  const yourMatches = [
    ...phase.filter((m) => m.homeId === YOU || m.awayId === YOU),
    ...ties.flatMap((t) => t.legs),
  ];

  return {
    competition: opts.competition,
    season: opts.season,
    clubs: field,
    displaced,
    leaguePhase: phase,
    table,
    leaguePosition: you.position,
    ties,
    finish,
    won: finish === "Winners",
    yourMatches,
  };
}

/** Someone still plausibly left in the draw at this stage. */
function pickOpponent(
  table: EuroTableRow[], byId: Map<string, EuroClub>, rng: Rng, yourSeed: number, pool: number,
): EuroClub {
  // Stronger league-phase finishers are likelier to still be standing.
  const candidates = table
    .filter((r) => !r.isYou)
    .slice(0, Math.max(pool, 4) * 2)
    .map((r) => byId.get(r.id)!)
    .filter(Boolean);
  if (candidates.length === 0) {
    return byId.get(table.find((r) => !r.isYou)!.id)!;
  }
  void yourSeed;
  return rng.weighted(candidates, (c) => Math.max(1, c.attack - 60));
}

function ordinalish(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
