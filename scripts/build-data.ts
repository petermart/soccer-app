/**
 * Builds the five league archives from two sources.
 *
 *   ratings   data/raw/eafc/*.csv          FIFA 07 - EA FC 26, every league,
 *                                          attributes but no slot ratings
 *   fixtures  data/raw/football-data/*.csv which clubs were actually in each
 *                                          top flight, per season
 *
 * Slot ratings are reconstructed with the model fitted in fit-slot-model.ts.
 * Season length is taken from the real field size, so Serie A's 18-club years
 * and Ligue 1's return to 18 are both handled without special-casing.
 *
 * Run with: bun run build:data
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readCsv } from "./lib/csv.ts";
import { indexClubs, resolveClub } from "./lib/clubs.ts";
import { DIVISION, EDITIONS } from "./lib/seasons.ts";
import { LEAGUE_ORDER, LEAGUES, type LeagueId } from "../src/engine/leagues.ts";
import { SLOTS, type PlayerSeason, type Slot } from "../src/engine/types.ts";
import { ATTRIBUTES } from "../src/engine/attributes.ts";
import { bestXi } from "../src/engine/bestxi.ts";
import { rateTeam } from "../src/engine/ratings.ts";

const OUT_DIR = "src/data";
const SLOT_MODEL = `${OUT_DIR}/slot-model.json`;
const ATTR_MODEL = `${OUT_DIR}/attribute-model.json`;
const REPORT = process.argv.includes("--report");

for (const [path, script] of [[SLOT_MODEL, "fit-slot-model"], [ATTR_MODEL, "fit-attribute-model"]]) {
  if (!existsSync(path!)) {
    console.error(`Missing ${path}. Run \`bun scripts/${script}.ts\` first.`);
    process.exit(1);
  }
}

const slotModel: {
  attributes: string[];
  slots: Record<string, { weights: number[]; intercept: number }>;
} = await Bun.file(SLOT_MODEL).json();

const attrModel: {
  base: string[];
  attributes: string[];
  groups: Record<"outfield" | "keeper", Record<string, { weights: number[]; intercept: number }>>;
} = await Bun.file(ATTR_MODEL).json();

let imputedCount = 0;

/**
 * The older games never recorded some attributes. Rather than let zeros drag
 * the slot model down, predict them from `overall` and the six face stats,
 * which every edition does record.
 */
function fillMissingAttributes(
  attrs: number[], base: number[], isKeeper: boolean,
): number[] {
  const group = attrModel.groups[isKeeper ? "keeper" : "outfield"];
  return attrs.map((v, i) => {
    if (v > 0) return v;
    const m = group[ATTRIBUTES[i]!];
    if (!m) return v;
    let pred = m.intercept;
    for (let k = 0; k < m.weights.length; k++) pred += m.weights[k]! * (base[k] ?? 0);
    imputedCount++;
    return Math.max(1, Math.min(99, Math.round(pred)));
  });
}

/** Reconstructs the per-slot ratings EA would have shown for this player. */
function deriveSlotRatings(attrs: number[], overall: number, isKeeper: boolean): number[] {
  return SLOTS.map((slot) => {
    if (isKeeper) return slot === "GK" ? overall : 0;
    if (slot === "GK") return 0;
    const m = slotModel.slots[slot];
    if (!m) return Math.max(0, overall - 12);
    let v = m.intercept;
    for (let i = 0; i < m.weights.length; i++) v += m.weights[i]! * (attrs[i] ?? 0);
    return Math.max(0, Math.min(99, Math.round(v)));
  });
}

/** Positions come through as "CF, RW"; keep the ones we model. */
const VALID_SLOT = new Set<string>(SLOTS);
function parsePositions(raw: string): Slot[] {
  return raw
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p): p is Slot => VALID_SLOT.has(p));
}

// ---------------------------------------------------------------- pass one
// Career facts per player, across every edition and every league (not just
// the big five), so a player looks the same whichever club-season you meet:
//   prime      career-best overall, for the "Prime" lens
//   name       the name the games most often displayed (the `alias` column,
//              e.g. "Raphinha" where short_name says "R. Dias")
//   positions  every position EA listed them at, primary and secondary

console.log("Pass 1: career peaks, names and positions across 20 editions…");
const primeById = new Map<string, number>();
const aliasesById = new Map<string, Map<string, { count: number; last: number }>>();
const positionsById = new Map<string, { editions: number; listed: Map<Slot, number>; primary: Set<Slot> }>();

for (const [editionIdx, edition] of EDITIONS.entries()) {
  if (!existsSync(edition.file)) continue;
  const t = await readCsv(edition.file);
  const idIdx = t.index("sofifa_id");
  const ovrIdx = t.index("overall");
  // Older mirrors of the dataset may lack the alias column; fall back to short_name.
  const aliasIdx = t.header.findIndex((h) => h.trim() === "alias");
  const posIdx = t.index("positions");
  const seen = new Set<string>();
  for (const r of t.rows) {
    const id = r[idIdx]?.trim();
    const ovr = Number(r[ovrIdx]);
    if (!id || !Number.isFinite(ovr)) continue;
    const cur = primeById.get(id);
    if (cur === undefined || ovr > cur) primeById.set(id, ovr);

    // A player can appear twice in one edition (mid-season roster updates);
    // count each edition once.
    if (seen.has(id)) continue;
    seen.add(id);

    const alias = aliasIdx >= 0 ? (r[aliasIdx] ?? "").trim() : "";
    if (alias) {
      const names = aliasesById.get(id) ?? aliasesById.set(id, new Map()).get(id)!;
      const n = names.get(alias) ?? { count: 0, last: 0 };
      names.set(alias, { count: n.count + 1, last: editionIdx });
    }

    const listed = parsePositions(r[posIdx] ?? "");
    if (listed.length) {
      const p = positionsById.get(id) ?? positionsById.set(id, { editions: 0, listed: new Map(), primary: new Set() }).get(id)!;
      p.editions++;
      p.primary.add(listed[0]!);
      for (const slot of listed) p.listed.set(slot, (p.listed.get(slot) ?? 0) + 1);
    }
  }
}
console.log(`  ${primeById.size.toLocaleString()} distinct players seen.\n`);

/** Most common display name; the more recent one wins a tie. */
function careerName(id: string): string | null {
  const names = aliasesById.get(id);
  if (!names) return null;
  return [...names.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)[0]![0];
}

/**
 * Primary and secondary positions over a career, most listed first.
 *
 * A position counts if it was ever their first-listed (primary) position, or
 * was listed in at least two editions. A one-off secondary listing across a
 * long career is treated as noise; for players with only one or two editions,
 * everything listed counts.
 */
function careerPositions(id: string, fallback: Slot[]): Slot[] {
  const p = positionsById.get(id);
  if (!p) return fallback;
  return [...p.listed.entries()]
    .filter(([slot, n]) => p.primary.has(slot) || n >= 2 || p.editions <= 2)
    .sort((a, b) => b[1] - a[1] || Number(p.primary.has(b[0])) - Number(p.primary.has(a[0])))
    .map(([slot]) => slot);
}

// ---------------------------------------------------------------- pass two

interface BuiltClubSeason {
  key: string; club: string; season: string; seasonIdx: number;
  strength: number; attack: number; defence: number; rating: number;
  players: unknown[];
}

const byLeague = new Map<LeagueId, BuiltClubSeason[]>(LEAGUE_ORDER.map((l) => [l, []]));
const seasonsSeen = new Map<LeagueId, Set<string>>(LEAGUE_ORDER.map((l) => [l, new Set()]));
const missing: string[] = [];

/** Clubs the fixture source lists for a league-season. */
async function fixtureClubs(league: LeagueId, code: string): Promise<string[]> {
  const path = `data/raw/football-data/${code}_${DIVISION[league]}.csv`;
  if (!existsSync(path)) return [];
  const t = await readCsv(path, "latin1");
  const home = t.index("HomeTeam");
  const away = t.index("AwayTeam");
  const set = new Set<string>();
  for (const r of t.rows) {
    const h = r[home]?.trim();
    const a = r[away]?.trim();
    if (h) set.add(h);
    if (a) set.add(a);
  }
  return [...set].sort();
}

console.log("Pass 2: building club-seasons…");

for (const edition of EDITIONS) {
  if (!existsSync(edition.file)) { console.log(`  missing ${edition.file}`); continue; }
  const t = await readCsv(edition.file);

  const C = {
    id: t.index("sofifa_id"),
    name: t.index("short_name"),
    longName: t.index("long_name"),
    nation: t.index("nationality"),
    club: t.index("club_name"),
    positions: t.index("positions"),
    age: t.index("age"),
    overall: t.index("overall"),
    pace: t.index("pace"),
    shooting: t.index("shooting"),
    passing: t.index("passing"),
    dribbling: t.index("dribbling"),
    defending: t.index("defending"),
    physical: t.index("physical"),
    gkDiving: t.index("gk_diving"),
    gkHandling: t.index("gk_handling"),
    gkKicking: t.index("gk_kicking"),
    gkPositioning: t.index("gk_positioning"),
    gkReflexes: t.index("gk_reflexes"),
    attrs: ATTRIBUTES.map((a) => t.index(a)),
  };

  // Group this edition's players by club once.
  const squads = new Map<string, PlayerSeason[]>();
  for (const r of t.rows) {
    const club = r[C.club]?.trim();
    if (!club) continue;
    const positions = parsePositions(r[C.positions] ?? "");
    if (positions.length === 0) continue;
    const overall = Number(r[C.overall]);
    if (!Number.isFinite(overall) || overall <= 0) continue;

    const isKeeper = positions.includes("GK");
    const id = r[C.id]?.trim() ?? "";

    // Predictors available in every edition, in the order the model expects.
    const base = [
      overall,
      Number(r[C.pace]) || 0, Number(r[C.shooting]) || 0, Number(r[C.passing]) || 0,
      Number(r[C.dribbling]) || 0, Number(r[C.defending]) || 0, Number(r[C.physical]) || 0,
    ];
    const attrs = fillMissingAttributes(C.attrs.map((i) => Number(r[i]) || 0), base, isKeeper);

    const face: [number, number, number, number, number, number] = isKeeper
      ? [Number(r[C.gkDiving]) || 0, Number(r[C.gkHandling]) || 0, Number(r[C.gkKicking]) || 0,
         Number(r[C.gkReflexes]) || 0, Number(r[C.gkPositioning]) || 0, Number(r[C.gkPositioning]) || 0]
      : [Number(r[C.pace]) || 0, Number(r[C.shooting]) || 0, Number(r[C.passing]) || 0,
         Number(r[C.dribbling]) || 0, Number(r[C.defending]) || 0, Number(r[C.physical]) || 0];

    const short = (r[C.name] ?? "").trim();
    const long = (r[C.longName] ?? "").trim();

    // This season's own listing always counts — the noise filter is only there
    // to stop a long career accumulating positions from single stray listings,
    // and a player plainly played where the game listed them that year.
    // Keepers stay keepers and outfielders stay outfield either way.
    // Career order first, so the most-played position stays the primary one.
    const career = [...new Set([...careerPositions(id, positions), ...positions])]
      .filter((s) => (s === "GK") === isKeeper);

    (squads.get(club) ?? squads.set(club, []).get(club)!).push({
      pid: Number(id) || 0,
      name: careerName(id) || short || long,
      fullName: long || short,
      nation: (r[C.nation] ?? "").trim(),
      age: Number(r[C.age]) || 0,
      overall,
      prime: Math.max(overall, primeById.get(id) ?? overall),
      positions,
      careerPositions: career.length ? career : positions,
      slotRatings: deriveSlotRatings(attrs, overall, isKeeper),
      face,
    });
  }

  const index = indexClubs(squads.keys());

  for (const league of LEAGUE_ORDER) {
    const wanted = await fixtureClubs(league, edition.code);
    if (wanted.length === 0) continue;

    for (const fixtureName of wanted) {
      const ratingName = resolveClub(fixtureName, index);
      if (!ratingName) { missing.push(`${league} ${edition.season} ${fixtureName} (no club)`); continue; }
      const squad = squads.get(ratingName);
      if (!squad || squad.length < 14 || !squad.some((p) => p.positions.includes("GK"))) {
        missing.push(`${league} ${edition.season} ${fixtureName} (squad ${squad?.length ?? 0})`);
        continue;
      }

      const sorted = [...squad].sort((a, b) => b.overall - a.overall);
      const top11 = sorted.slice(0, 11);
      const strength = top11.reduce((s, p) => s + p.overall, 0) / top11.length;
      // Rate the XI this club would actually field, on the same scale the
      // player's drafted side is rated on.
      const rating = rateTeam(
        bestXi(sorted, "4-3-3", "season", { club: fixtureName, season: edition.season }),
        "season",
      );

      seasonsSeen.get(league)!.add(edition.season);
      byLeague.get(league)!.push({
        key: `${league}:${fixtureName}:${edition.season}`,
        // Use the fixture source's name: it is the one the league table shows.
        club: fixtureName,
        season: edition.season,
        seasonIdx: 0, // filled once every season is known
        strength: Math.round(strength * 10) / 10,
        attack: rating.attack,
        defence: rating.defence,
        rating: rating.overall,
        players: sorted.map((p) => [
          p.pid, p.name, p.fullName === p.name ? "" : p.fullName, p.nation, p.age,
          p.overall, p.prime, p.positions.join(","), p.slotRatings, p.face,
          p.careerPositions.join(","),
        ]),
      });
    }
  }
  process.stdout.write(`  ${edition.title} `);
}
console.log("\n");

// ---------------------------------------------------------------- write out

mkdirSync(OUT_DIR, { recursive: true });
const manifest: Record<string, unknown>[] = [];

console.log("league  seasons  club-seasons   players   size   span");
console.log("--------------------------------------------------------------");

for (const league of LEAGUE_ORDER) {
  const cfg = LEAGUES[league];
  const seasons = [...seasonsSeen.get(league)!].sort();
  const seasonIdx = new Map(seasons.map((s, i) => [s, i]));
  const clubSeasons = byLeague.get(league)!
    .map((cs) => ({ ...cs, seasonIdx: seasonIdx.get(cs.season)! }))
    .sort((a, b) => a.seasonIdx - b.seasonIdx || a.club.localeCompare(b.club));

  // How many clubs each season really had, so the sim can size the league.
  const shape: Record<string, number> = {};
  for (const cs of clubSeasons) shape[cs.season] = (shape[cs.season] ?? 0) + 1;

  const path = `${OUT_DIR}/${league}.json`;
  writeFileSync(path, JSON.stringify({ league, seasons, shape, clubSeasons }));

  const players = clubSeasons.reduce((s, c) => s + c.players.length, 0);
  const bytes = Bun.file(path).size;
  manifest.push({
    id: league, name: cfg.name, country: cfg.country,
    seasons: seasons.length, seasonList: seasons, shape,
    clubSeasons: clubSeasons.length, players,
    firstSeason: seasons[0], lastSeason: seasons.at(-1),
  });
  console.log(
    `${league}        ${String(seasons.length).padStart(2)}       ${String(clubSeasons.length).padStart(5)}` +
    `     ${String(players).padStart(6)}  ${(bytes / 1e6).toFixed(1)}MB  ${seasons[0]}-${seasons.at(-1)}`,
  );
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\nWrote ${OUT_DIR}/manifest.json`);

if (missing.length) {
  console.log(`\n${missing.length} club-season(s) could not be built:`);
  for (const m of (REPORT ? missing : missing.slice(0, 15))) console.log("  " + m);
  if (!REPORT && missing.length > 15) console.log(`  … run with --report for all ${missing.length}`);
}
