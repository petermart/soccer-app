/**
 * Downloads both raw sources the archives are built from.
 *
 *   ratings   github.com/mzafram2001/ea-fc  (MIT) — FIFA 07 to EA FC 26
 *   fixtures  football-data.co.uk           — which clubs were in each top flight
 *
 * Both are gitignored and fetched on demand rather than committed.
 *
 * Run with: bun run fetch:data
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { EDITIONS, DIVISION } from "./lib/seasons.ts";
import { LEAGUE_ORDER } from "../src/engine/leagues.ts";

const EA_BASE = "https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data";
const FD_BASE = "https://www.football-data.co.uk/mmz4281";

mkdirSync("data/raw/eafc", { recursive: true });
mkdirSync("data/raw/football-data", { recursive: true });

/** Skips anything already on disk at a plausible size. */
function have(path: string, minBytes: number): boolean {
  return existsSync(path) && statSync(path).size >= minBytes;
}

async function download(url: string, out: string, minBytes: number): Promise<boolean> {
  if (have(out, minBytes)) return false;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${url}`);
    return false;
  }
  await Bun.write(out, res);
  return true;
}

console.log(`Ratings: ${EDITIONS.length} editions from mzafram2001/ea-fc`);
let got = 0;
for (const e of EDITIONS) {
  const remote = e.title.startsWith("EA FC")
    ? `${EA_BASE}/dataset_ea_fc_${e.title.slice(-2)}.csv`
    : `${EA_BASE}/dataset_fifa_${e.title.slice(-2)}.csv`;
  if (await download(remote, e.file, 1_000_000)) got++;
  process.stdout.write(".");
}
console.log(`\n  ${got} downloaded, ${EDITIONS.length - got} already present.\n`);

console.log("Fixtures: 20 seasons x 5 leagues from football-data.co.uk");
got = 0;
for (const e of EDITIONS) {
  for (const league of LEAGUE_ORDER) {
    const out = `data/raw/football-data/${e.code}_${DIVISION[league]}.csv`;
    if (await download(`${FD_BASE}/${e.code}/${DIVISION[league]}.csv`, out, 1_000)) got++;
  }
  process.stdout.write(".");
}
console.log(`\n  ${got} downloaded, ${EDITIONS.length * 5 - got} already present.\n`);

console.log("Next: bun scripts/fit-attribute-model.ts");
console.log("      bun scripts/fit-slot-model.ts   (needs data/raw/male_players_legacy.csv)");
console.log("      bun run build:data");
