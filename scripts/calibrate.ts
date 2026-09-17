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
import { GAFFERS } from "../src/engine/extras.ts";
import { completedPicks, createDraft, draftPlayer, spin } from "../src/engine/draft.ts";
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

/**
 * 4. What a drafted side actually does, and what the gaffers do to it.
 *
 * A manager should change the character of a season, not decide it: if any
 * archetype swings the title odds by tens of points, or turns 6-0s into a
 * weekly event, the style numbers in extras.ts have gone wrong again.
 */
console.log("\n=== 4. A drafted XI, by gaffer ===\n");

const esp = await load("esp");
const PLAY_SEASON = esp.seasons.at(-1)!;

/** Drafts the way a decent player does: best available, in their best slot. */
function botDraft(seed: string): Pick[] {
  const state = createDraft({
    league: "esp", playSeason: PLAY_SEASON, formation: "4-3-3", difficulty: "normal",
    mode: "squad", lens: "season", showRatings: true,
    seasonRange: [esp.seasons[0]!, esp.seasons.at(-1)!],
    uniquePlayers: true, seed, teamName: "",
  });
  let guard = 0;
  while (!state.done && guard++ < 200) {
    const best = spin(state, esp.clubSeasons).choices[0]!;
    const slot = state.slots
      .filter((s) => state.picks[s.index] === null && best.slots.includes(s.slot))
      .sort((a, b) => ratingInSlot(best.player, b.slot, "season") - ratingInSlot(best.player, a.slot, "season"))[0]!;
    draftPlayer(state, best.player, slot.index);
  }
  return completedPicks(state);
}

const squads = Array.from({ length: 20 }, (_, i) => botDraft(`bot:${i}`));
const avgRating = squads.reduce((s, p) => s + rateTeam(p, "season").overall, 0) / squads.length;
const espField = [...esp.clubSeasons.filter((c) => c.season === PLAY_SEASON)].sort((a, b) => b.rating - a.rating);
console.log(
  `Spain ${PLAY_SEASON}: ${espField[0]!.club} ${espField[0]!.rating} down to ` +
  `${espField.at(-1)!.club} ${espField.at(-1)!.rating}. Bot XI averages ${avgRating.toFixed(1)}.\n`,
);

for (const g of GAFFERS) {
  let titles = 0, top4 = 0, pts = 0, runs = 0, blowouts = 0, worst = 0;
  for (const [i, picks] of squads.entries()) {
    for (let k = 0; k < 4; k++) {
      const r = simulateSeason({
        league: "esp", picks, lens: "season", pool: esp.clubSeasons,
        opponentSeason: PLAY_SEASON, seed: `gaf:${g.id}:${i}:${k}`, style: g,
      });
      runs++;
      if (r.champion) titles++;
      if (r.you.position <= 4) top4++;
      pts += r.you.points;
      for (const m of r.matches) {
        if (m.homeId !== YOU && m.awayId !== YOU) continue;
        const gf = m.homeId === YOU ? m.homeGoals : m.awayGoals;
        if (gf >= 6) blowouts++;
        worst = Math.max(worst, gf);
      }
    }
  }
  console.log(
    `  ${g.name.padEnd(16)} ${(pts / runs).toFixed(0).padStart(3)} pts` +
    `  title ${((titles / runs) * 100).toFixed(0).padStart(3)}%` +
    `  top four ${((top4 / runs) * 100).toFixed(0).padStart(3)}%` +
    `  6+ goals ${(blowouts / runs).toFixed(2)}/season  most ${worst}`,
  );
}
