/**
 * Downloads the raw sources the archives are built from.
 *
 *   ratings   github.com/mzafram2001/ea-fc  (MIT) — FIFA 07 to EA FC 26
 *   fixtures  football-data.co.uk           — which clubs were in each top flight
 *
 * With --legacy it also fetches the FIFA 15-23 archive that carries EA's real
 * per-slot ratings. That one is only needed to REFIT the slot model or to run
 * validate-derived.ts; the fitted models are committed, so a normal rebuild
 * does not need it. It is ~91MB, hence opt-in.
 *
 * Everything lands in data/raw/, which is gitignored.
 *
 * Run with: bun run fetch:data          (or: bun run fetch:data -- --legacy)
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { EDITIONS, DIVISION } from "./lib/seasons.ts";
import { LEAGUE_ORDER } from "../src/engine/leagues.ts";

const EA_BASE = "https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data";
const FD_BASE = "https://www.football-data.co.uk/mmz4281";
const LEGACY_URL =
  "https://raw.githubusercontent.com/aryansain1162/fifa-player-explorer/main/male_players_legacy.csv";
const LEGACY_OUT = "data/raw/male_players_legacy.csv";

const wantLegacy = process.argv.includes("--legacy");

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

if (wantLegacy) {
  console.log("Legacy FIFA 15-23 archive (~91MB, for refitting the slot model)");
  if (have(LEGACY_OUT, 80_000_000)) {
    console.log("  already present.\n");
  } else {
    const res = await fetch(LEGACY_URL);
    if (res.ok) {
      await Bun.write(LEGACY_OUT, res);
      console.log(`  saved ${LEGACY_OUT} (${(Bun.file(LEGACY_OUT).size / 1e6).toFixed(1)}MB).\n`);
    } else {
      console.warn(`  ! ${res.status} ${LEGACY_URL}\n`);
    }
  }
}

console.log("Next: bun run build:data");
console.log("");
console.log("The fitted models in src/data/ are committed, so a rebuild needs nothing else.");
console.log("To refit them from scratch (needs --legacy above):");
console.log("  bun scripts/fit-attribute-model.ts");
console.log("  bun scripts/fit-slot-model.ts");
console.log("  bun scripts/validate-derived.ts");
