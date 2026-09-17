/**
 * Diagnostic: how completely do the two sources line up?
 *
 * For every league-season, takes the clubs the fixture source says were in the
 * top flight and tries to find each one in that year's ratings file. Prints
 * anything unmatched so the alias table can be filled in.
 *
 * Run with: bun scripts/match-report.ts [league]
 */
import { existsSync } from "node:fs";
import { readCsv } from "./lib/csv.ts";
import { indexClubs, resolveClub } from "./lib/clubs.ts";
import { DIVISION, EDITIONS } from "./lib/seasons.ts";
import { LEAGUE_ORDER, LEAGUES, type LeagueId } from "../src/engine/leagues.ts";

const only = process.argv[2] as LeagueId | undefined;
const leagues = only ? [only] : LEAGUE_ORDER;

/** Clubs that appear as a home team in that season's fixture list. */
async function fixtureClubs(league: LeagueId, code: string): Promise<string[]> {
  const path = `data/raw/football-data/${code}_${DIVISION[league]}.csv`;
  if (!existsSync(path)) return [];
  const t = await readCsv(path, "latin1");
  const home = t.index("HomeTeam");
  const away = t.index("AwayTeam");
  const set = new Set<string>();
  for (const r of t.rows) {
    if (r[home]?.trim()) set.add(r[home]!.trim());
    if (r[away]?.trim()) set.add(r[away]!.trim());
  }
  return [...set].sort();
}

/** Every club in a ratings file, with squad sizes. */
async function ratingClubs(file: string): Promise<Map<string, string[]>> {
  const t = await readCsv(file);
  const club = t.index("club_name");
  const name = t.index("short_name");
  const byClub = new Map<string, string[]>();
  for (const r of t.rows) {
    const c = r[club]?.trim();
    if (!c) continue;
    (byClub.get(c) ?? byClub.set(c, []).get(c)!).push(r[name] ?? "");
  }
  return byClub;
}

let totalWanted = 0;
let totalMatched = 0;
const unmatched: string[] = [];
const thinSquads: string[] = [];

for (const edition of EDITIONS) {
  if (!existsSync(edition.file)) { console.log(`missing ${edition.file}`); continue; }
  const squads = await ratingClubs(edition.file);
  const index = indexClubs(squads.keys());

  for (const league of leagues) {
    const wanted = await fixtureClubs(league, edition.code);
    if (wanted.length === 0) continue;
    let matched = 0;
    for (const w of wanted) {
      const hit = resolveClub(w, index);
      totalWanted++;
      if (hit) {
        matched++; totalMatched++;
        const size = squads.get(hit)!.length;
        if (size < 14) thinSquads.push(`${league} ${edition.season} ${w} -> ${hit} (${size})`);
      } else {
        unmatched.push(`${league} ${edition.season}  ${w}`);
      }
    }
    const pct = (matched / wanted.length) * 100;
    const flag = matched === wanted.length ? "  " : "!!";
    console.log(
      `${flag} ${league} ${edition.season} ${edition.title.padEnd(9)} ` +
      `${String(matched).padStart(2)}/${String(wanted.length).padEnd(2)} ${pct.toFixed(0)}%`,
    );
  }
}

console.log(`\n=== matched ${totalMatched}/${totalWanted} club-seasons ` +
  `(${((totalMatched / totalWanted) * 100).toFixed(1)}%) ===`);

if (unmatched.length) {
  console.log(`\n--- unmatched (${unmatched.length}) ---`);
  for (const u of unmatched) console.log("  " + u);
}
if (thinSquads.length) {
  console.log(`\n--- squads under 14 players (${thinSquads.length}) ---`);
  for (const t of thinSquads.slice(0, 40)) console.log("  " + t);
}
