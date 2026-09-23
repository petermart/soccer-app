/**
 * Works out who was in Europe, season by season.
 *
 * A club plays in a European competition in season S because of where it
 * finished in season S-1. So for each archive season this computes the real
 * final table of the season before — from actual match results — and pairs
 * each qualifier with the rating it carries in season S.
 *
 * Which finishing places earn which competition is NOT decided here: that
 * rule lives in src/engine/europe.ts so it can be corrected without a
 * rebuild. This script only answers "who finished where, and how good were
 * they the following year".
 *
 * Input  : data/raw/football-data/*.csv   real results, 2005/06 onwards
 *          src/data/<league>.json         ratings for the season being played
 * Output : src/data/europe.json
 *
 * Run with: bun run build:europe
 */
import { existsSync, writeFileSync } from "node:fs";
import { readCsv } from "./lib/csv.ts";
import { DIVISION, EDITIONS } from "./lib/seasons.ts";
import { inflateArchive } from "../src/engine/archive.ts";
import { LEAGUE_ORDER, type LeagueId } from "../src/engine/leagues.ts";
import type { LeagueArchive } from "../src/engine/types.ts";

const OUT = "src/data/europe.json";

/** football-data season code for the year before a given code, e.g. 0708 -> 0607. */
function priorCode(code: string): string {
  const start = Number(code.slice(0, 2));
  const prev = (start + 99) % 100; // 07 -> 06, 00 -> 99
  return `${String(prev).padStart(2, "0")}${String(start).padStart(2, "0")}`;
}

interface Standing { club: string; played: number; points: number; gd: number; gf: number }

/** The real final table of one league-season, from its results. */
async function realTable(league: LeagueId, code: string): Promise<Standing[]> {
  const path = `data/raw/football-data/${code}_${DIVISION[league]}.csv`;
  if (!existsSync(path)) return [];
  const t = await readCsv(path, "latin1");
  const home = t.index("HomeTeam");
  const away = t.index("AwayTeam");
  const hg = t.index("FTHG");
  const ag = t.index("FTAG");

  const rows = new Map<string, Standing>();
  const row = (club: string) =>
    rows.get(club) ?? rows.set(club, { club, played: 0, points: 0, gd: 0, gf: 0 }).get(club)!;

  for (const r of t.rows) {
    const h = r[home]?.trim();
    const a = r[away]?.trim();
    const hGoals = Number(r[hg]);
    const aGoals = Number(r[ag]);
    if (!h || !a || !Number.isFinite(hGoals) || !Number.isFinite(aGoals)) continue;
    const H = row(h);
    const A = row(a);
    H.played++; A.played++;
    H.gf += hGoals; A.gf += aGoals;
    H.gd += hGoals - aGoals; A.gd += aGoals - hGoals;
    if (hGoals > aGoals) H.points += 3;
    else if (hGoals < aGoals) A.points += 3;
    else { H.points++; A.points++; }
  }

  return [...rows.values()].sort(
    (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.club.localeCompare(y.club),
  );
}

export interface Qualifier {
  club: string;
  /** Where they finished the season before, which is why they are here. */
  prevPos: number;
  /** Their strength in the season being played, from the archive. */
  rating: number;
  attack: number;
  defence: number;
}

/** How many finishers to record per league; more than any rule needs. */
const DEPTH = 8;

const archives = new Map<LeagueId, LeagueArchive>();
for (const league of LEAGUE_ORDER) {
  archives.set(league, inflateArchive(await Bun.file(`src/data/${league}.json`).json()));
}

const out: Record<string, Partial<Record<LeagueId, Qualifier[]>>> = {};
let missing = 0;

console.log("season    eng esp ger ita fra   (qualifiers found per league)");
for (const edition of EDITIONS) {
  const season = edition.season;
  const counts: string[] = [];

  for (const league of LEAGUE_ORDER) {
    const table = await realTable(league, priorCode(edition.code));
    if (table.length === 0) { counts.push(" -"); continue; }

    const archive = archives.get(league)!;
    const thisSeason = new Map(
      archive.clubSeasons.filter((c) => c.season === season).map((c) => [c.club, c]),
    );

    const qualifiers: Qualifier[] = [];
    for (let i = 0; i < table.length && qualifiers.length < DEPTH; i++) {
      const standing = table[i]!;
      const club = thisSeason.get(standing.club);
      // A club that finished high and then left the division — relegated on
      // appeal, dissolved, or simply absent from the ratings — cannot be
      // fielded, so the next finisher takes the place, as happens for real.
      if (!club) { missing++; continue; }
      qualifiers.push({
        club: club.club,
        prevPos: i + 1,
        rating: club.rating,
        attack: club.attack,
        defence: club.defence,
      });
    }

    (out[season] ??= {})[league] = qualifiers;
    counts.push(String(qualifiers.length).padStart(2));
  }
  console.log(`${season}  ${counts.join("  ")}`);
}

writeFileSync(OUT, JSON.stringify(out));
const bytes = Bun.file(OUT).size;
console.log(`\nWrote ${OUT} (${(bytes / 1024).toFixed(0)}KB)`);
if (missing) {
  console.log(`${missing} qualifier(s) skipped: finished high, then absent from the next season's top flight.`);
}
