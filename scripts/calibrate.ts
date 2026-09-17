/**
 * Sanity-checks the season model against reality.
 *
 * Two questions:
 *  1. Do real club-seasons finish roughly where they actually finished?
 *  2. Is a perfect season hard but reachable for a genuinely great XI?
 */
import { inflateArchive } from "../src/engine/archive.ts";
import { LEAGUES, LEAGUE_ORDER, type LeagueId } from "../src/engine/leagues.ts";
import { simulateSeason, YOU } from "../src/engine/simulate.ts";
import { slotsOf } from "../src/engine/formations.ts";
import { bestXi } from "../src/engine/bestxi.ts";
import { canPlaySlot, rateTeam, ratingInSlot, type Pick } from "../src/engine/ratings.ts";
import type { ClubSeason, LeagueArchive } from "../src/engine/types.ts";

async function load(id: LeagueId): Promise<LeagueArchive> {
  return inflateArchive(await Bun.file(`src/data/${id}.json`).json());
}

const bestXiOf = (cs: ClubSeason, formation = "4-3-3") =>
  bestXi(cs.players, formation, "season", cs);

const RUNS = 40;

console.log("=== 1. Real squads, simulated finishes ===\n");
for (const lid of LEAGUE_ORDER) {
  const arc = await load(lid);
  const cfg = LEAGUES[lid];
  const season = arc.seasons.at(-1)!;
  const field = arc.clubSeasons.filter((c) => c.season === season);
  const ranked = [...field].sort((a, b) => b.strength - a.strength);

  const probe = [ranked[0]!, ranked[Math.floor(ranked.length / 2)]!, ranked.at(-1)!];
  console.log(`${cfg.country} ${season} (${field.length} clubs)`);
  for (const cs of probe) {
    let pts = 0, pos = 0, gf = 0, ga = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = simulateSeason({
        league: lid, picks: bestXiOf(cs), lens: "season",
        pool: field.filter((c) => c.key !== cs.key),
        opponentSeason: season, seed: `cal:${cs.key}:${i}`, teamName: cs.club,
      });
      pts += r.you.points; pos += r.you.position; gf += r.you.goalsFor; ga += r.you.goalsAgainst;
    }
    console.log(
      `  ${cs.club.padEnd(24)} str ${String(cs.strength).padStart(4)}` +
      `  → ${(pts / RUNS).toFixed(0).padStart(3)} pts` +
      `  ${(pos / RUNS).toFixed(1).padStart(4)} pos` +
      `  ${(gf / RUNS).toFixed(0)}:${(ga / RUNS).toFixed(0)}`,
    );
  }
  console.log();
}

console.log("=== 2. How hard is a perfect season? ===\n");
const eng = await load("eng");
const allTime = eng.clubSeasons;
console.log(`Archive: ${eng.seasons.length} seasons, ${allTime.length} club-seasons, ` +
  `${allTime.reduce((s, c) => s + c.players.length, 0).toLocaleString()} player-seasons
`);

/** A dream XI: the best player available at each slot from the whole archive. */
function dreamXi(pool: ClubSeason[], formation = "4-3-3"): Pick[] {
  const slots = slotsOf(formation);
  const taken = new Set<number>();
  const picks: Pick[] = [];
  for (const slot of [...slots].sort((a, b) => (a.slot === "GK" ? -1 : b.slot === "GK" ? 1 : 0))) {
    let best: { p: any; r: number; cs: ClubSeason } | null = null;
    for (const cs of pool) {
      for (const p of cs.players) {
        if (taken.has(p.pid) || !canPlaySlot(p, slot.slot)) continue;
        const r = ratingInSlot(p, slot.slot, "season");
        if (!best || r > best.r) best = { p, r, cs };
      }
    }
    if (!best) continue;
    taken.add(best.p.pid);
    picks.push({ player: best.p, slot: slot.slot, slotIndex: slot.index, club: best.cs.club, season: best.cs.season });
  }
  return picks;
}

const tiers: [string, Pick[]][] = [
  ["Dream XI (best at every slot)", dreamXi(allTime)],
  ["Elite club XI (strongest squad)", bestXiOf([...allTime].sort((a, b) => b.strength - a.strength)[0]!)],
  ["Mid club XI", bestXiOf([...allTime].sort((a, b) => b.strength - a.strength)[Math.floor(allTime.length / 2)]!)],
];

const TRIALS = 400;
for (const [label, picks] of tiers) {
  let perfect = 0, unbeaten = 0, titles = 0, pts = 0, wins = 0;
  for (let i = 0; i < TRIALS; i++) {
    const r = simulateSeason({
      league: "eng", picks, lens: "season", pool: allTime, seed: `perf:${label}:${i}`,
    });
    if (r.perfect) perfect++;
    if (r.invincible) unbeaten++;
    if (r.champion) titles++;
    pts += r.you.points; wins += r.you.won;
  }
  const rating = (picks.length ? picks : []).length;
  console.log(
    `${label.padEnd(34)} avg ${(pts / TRIALS).toFixed(0).padStart(3)} pts` +
    `  ${(wins / TRIALS).toFixed(1).padStart(4)} wins` +
    `  title ${((titles / TRIALS) * 100).toFixed(0).padStart(3)}%` +
    `  unbeaten ${((unbeaten / TRIALS) * 100).toFixed(1).padStart(5)}%` +
    `  PERFECT ${((perfect / TRIALS) * 100).toFixed(2)}%`,
  );
}

console.log("\n=== 3. Sample dream XI ===");
for (const p of dreamXi(allTime)) {
  console.log(
    `  ${p.slot.padEnd(4)} ${p.player.name.padEnd(22)} ` +
    `${String(ratingInSlot(p.player, p.slot, "season")).padStart(2)}  ${p.club} ${p.season}`,
  );
}
