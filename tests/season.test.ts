/**
 * The season layer: per-match scorers, the January window, and the limits on
 * what a gaffer is allowed to do to a season.
 */
import { describe, expect, test } from "bun:test";
import { inflateArchive } from "../src/engine/archive.ts";
import { bestXi } from "../src/engine/bestxi.ts";
import { completedPicks, createDraft, draftPlayer, spin, type DraftConfig } from "../src/engine/draft.ts";
import { GAFFERS, JANUARY_CARDS, rollGaffer, rollJanuary } from "../src/engine/extras.ts";
import { canPlaySlot, rateTeam, ratingInSlot, type Pick } from "../src/engine/ratings.ts";
import { simulateSeason, tableAfter, YOU, type SeasonResult } from "../src/engine/simulate.ts";
import type { LeagueArchive } from "../src/engine/types.ts";

const esp: LeagueArchive = inflateArchive(await Bun.file("src/data/esp.json").json());
const SEASON = esp.seasons.at(-1)!;
const RANGE: [string, string] = [esp.seasons[0]!, esp.seasons.at(-1)!];

const config = (over: Partial<DraftConfig> = {}): DraftConfig => ({
  league: "esp", playSeason: SEASON, formation: "4-3-3", difficulty: "normal",
  mode: "squad", lens: "season", showRatings: true, seasonRange: RANGE,
  uniquePlayers: true, seed: "season-seed", teamName: "Test XI", ...over,
});

/** Drafts the way a decent player does: best available, in their best slot. */
function botDraft(seed: string): Pick[] {
  const state = createDraft(config({ seed }));
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

const squad = botDraft("bot-a");
const sim = (over: Partial<Parameters<typeof simulateSeason>[0]> = {}): SeasonResult =>
  simulateSeason({
    league: "esp", picks: squad, lens: "season", pool: esp.clubSeasons,
    opponentSeason: SEASON, seed: "sim-seed", ...over,
  });

describe("match by match", () => {
  test("your scorers account for exactly the goals you scored, in every match", () => {
    const r = sim();
    let total = 0;
    for (const m of r.matches) {
      const you = m.homeId === YOU || m.awayId === YOU;
      if (!you) {
        expect(m.yourGoals.length).toBe(0);
        continue;
      }
      const scored = m.homeId === YOU ? m.homeGoals : m.awayGoals;
      expect(m.yourGoals.length).toBe(scored);
      total += scored;
      for (const g of m.yourGoals) {
        expect(g.minute).toBeGreaterThanOrEqual(1);
        expect(g.minute).toBeLessThanOrEqual(90);
        // Nobody assists their own goal.
        expect(g.assistPid).not.toBe(g.pid);
      }
      // Minutes come through in order, so the match reads like a match.
      const minutes = m.yourGoals.map((g) => g.minute);
      expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
    }
    expect(total).toBe(r.you.goalsFor);
  });

  test("the season scorer list is just the matches added up", () => {
    const r = sim();
    const goals = new Map<number, number>();
    const assists = new Map<number, number>();
    for (const m of r.matches) {
      for (const g of m.yourGoals) {
        goals.set(g.pid, (goals.get(g.pid) ?? 0) + 1);
        if (g.assistPid !== null) assists.set(g.assistPid, (assists.get(g.assistPid) ?? 0) + 1);
      }
    }
    for (const row of r.scorers) {
      expect(row.goals).toBe(goals.get(row.pid) ?? 0);
      expect(row.assists).toBe(assists.get(row.pid) ?? 0);
    }
    expect(r.scorers.reduce((s, x) => s + x.goals, 0)).toBe(r.you.goalsFor);
    // Only players who were actually in the XI can appear.
    const pids = new Set(squad.map((p) => p.player.pid));
    for (const row of r.scorers) expect(pids.has(row.pid)).toBe(true);
  });

  test("the running table matches the final one when the season ends", () => {
    const r = sim();
    const atEnd = tableAfter(r, r.rounds);
    expect(atEnd.map((x) => [x.name, x.points, x.goalDifference]))
      .toEqual(r.table.map((x) => [x.name, x.points, x.goalDifference]));

    // Partway through, everyone has played at most the rounds gone by.
    const mid = tableAfter(r, r.halfwayRound);
    for (const row of mid) {
      expect(row.played).toBeLessThanOrEqual(r.halfwayRound);
      expect(row.points).toBe(row.won * 3 + row.drawn);
    }
    expect(mid.reduce((s, x) => s + x.goalsFor, 0)).toBe(mid.reduce((s, x) => s + x.goalsAgainst, 0));
  });
});

describe("the January window", () => {
  test("a rolled card brings in real players who can play the slot", () => {
    for (let i = 0; i < 40; i++) {
      const outcome = rollJanuary({ picks: squad, pool: esp.clubSeasons, lens: "season", seasonRange: RANGE, seed: `jan:${i}` });
      expect(outcome.picks.length).toBe(11);
      expect(new Set(outcome.picks.map((p) => p.player.pid)).size).toBe(11);

      for (const move of outcome.moves) {
        // The incoming player is a real archived player-season, not a stat boost.
        const club = esp.clubSeasons.find((cs) => cs.club === move.in.club && cs.season === move.in.season);
        expect(club).toBeDefined();
        expect(club!.players.some((p) => p.pid === move.in.player.pid)).toBe(true);
        expect(canPlaySlot(move.in.player, move.in.slot)).toBe(true);
        expect(move.in.slot).toBe(move.out.slot);
        expect(move.in.slotIndex).toBe(move.out.slotIndex);
        expect(club!.season >= RANGE[0] && club!.season <= RANGE[1]).toBe(true);
      }
      // Untouched slots keep their player.
      const changed = new Set(outcome.moves.map((m) => m.slotIndex));
      for (const p of squad) {
        if (changed.has(p.slotIndex)) continue;
        expect(outcome.picks.find((x) => x.slotIndex === p.slotIndex)!.player.pid).toBe(p.player.pid);
      }
    }
  });

  test("good cards improve the XI and bad cards hurt it", () => {
    const before = rateTeam(squad, "season").overall;
    const tallies = new Map<string, { good: number; bad: number }>();
    for (let i = 0; i < 120; i++) {
      const outcome = rollJanuary({ picks: squad, pool: esp.clubSeasons, lens: "season", seasonRange: RANGE, seed: `tone:${i}` });
      if (outcome.moves.length === 0) continue;
      const after = rateTeam(outcome.picks, "season").overall;
      const t = tallies.get(outcome.tone) ?? { good: 0, bad: 0 };
      if (after > before) t.good++;
      else if (after < before) t.bad++;
      tallies.set(outcome.tone, t);

      for (const move of outcome.moves) {
        const out = ratingInSlot(move.out.player, move.out.slot, "season");
        const into = ratingInSlot(move.in.player, move.in.slot, "season");
        if (outcome.tone === "good") expect(into).toBeGreaterThan(out);
        if (outcome.tone === "bad") expect(into).toBeLessThan(out);
      }
    }
    expect((tallies.get("good")?.bad ?? 0)).toBe(0);
    expect((tallies.get("bad")?.good ?? 0)).toBe(0);
  });

  test("it is a real gamble: the deck helps about as often as it hurts", () => {
    const good = JANUARY_CARDS.filter((c) => c.tone === "good").reduce((s, c) => s + c.weight, 0);
    const bad = JANUARY_CARDS.filter((c) => c.tone === "bad").reduce((s, c) => s + c.weight, 0);
    expect(good).toBe(bad);
  });

  test("the same seed always rolls the same window", () => {
    const a = rollJanuary({ picks: squad, pool: esp.clubSeasons, lens: "season", seasonRange: RANGE, seed: "repeat" });
    const b = rollJanuary({ picks: squad, pool: esp.clubSeasons, lens: "season", seasonRange: RANGE, seed: "repeat" });
    expect(a.id).toBe(b.id);
    expect(a.moves.map((m) => m.in.player.pid)).toEqual(b.moves.map((m) => m.in.player.pid));
  });

  test("changing the XI in January cannot change the first half", () => {
    const first = sim();
    const outcome = rollJanuary({ picks: squad, pool: esp.clubSeasons, lens: "season", seasonRange: RANGE, seed: "split" });
    const second = sim({ secondHalfPicks: outcome.picks });

    const upToHalfway = (r: SeasonResult) =>
      r.matches.filter((m) => m.round <= r.halfwayRound)
        .map((m) => `${m.round}:${m.homeId}:${m.awayId}:${m.homeGoals}-${m.awayGoals}`);
    expect(upToHalfway(second)).toEqual(upToHalfway(first));
    expect(tableAfter(second, second.halfwayRound)).toEqual(tableAfter(first, first.halfwayRound));
  });

  test("a weakened XI takes fewer points over a full season", () => {
    const weakened = squad.map((p, i) =>
      i % 2 === 0 ? p : { ...p, player: { ...p.player, slotRatings: p.player.slotRatings.map((r) => Math.max(20, r - 12)) } },
    );
    let strong = 0;
    let weak = 0;
    for (let i = 0; i < 12; i++) {
      strong += sim({ seed: `half:${i}` }).you.points;
      weak += sim({ seed: `half:${i}`, secondHalfPicks: weakened }).you.points;
    }
    expect(weak).toBeLessThan(strong);
  });
});

describe("gaffers", () => {
  test("the gaffer is rolled, and the same seed gives the same one", () => {
    expect(rollGaffer("abc").id).toBe(rollGaffer("abc").id);
    const rolled = new Set(Array.from({ length: 200 }, (_, i) => rollGaffer(`g:${i}`).id));
    // Over enough runs every archetype turns up, so none is unreachable.
    expect(rolled.size).toBe(GAFFERS.length);
  });

  test("no gaffer is worth more than about a point of rating", () => {
    for (const g of GAFFERS) {
      expect(Math.abs(g.attack + g.defence)).toBeLessThanOrEqual(1);
      expect(Math.abs(g.attack)).toBeLessThanOrEqual(3);
      expect(Math.abs(g.defence)).toBeLessThanOrEqual(3);
      expect(g.tempo).toBeGreaterThanOrEqual(0.8);
      expect(g.tempo).toBeLessThanOrEqual(1.25);
    }
  });

  /**
   * The complaint this guards against: a manager that turned a mid-table side
   * into a title winner and produced 10-3 scorelines. A gaffer may change how
   * a season feels, not whether it is won.
   */
  test("a gaffer changes the character of a season, not the outcome", () => {
    const squads = [squad, botDraft("bot-b"), botDraft("bot-c")];
    const byGaffer = GAFFERS.map((g) => {
      let points = 0;
      let titles = 0;
      let runs = 0;
      let biggest = 0;
      for (const [i, picks] of squads.entries()) {
        for (let k = 0; k < 3; k++) {
          const r = sim({ picks, style: g, seed: `gaf:${g.id}:${i}:${k}` });
          runs++;
          points += r.you.points;
          if (r.champion) titles++;
          for (const m of r.matches) {
            if (m.homeId !== YOU && m.awayId !== YOU) continue;
            biggest = Math.max(biggest, m.homeId === YOU ? m.homeGoals : m.awayGoals);
          }
        }
      }
      return { id: g.id, points: points / runs, titleRate: titles / runs, biggest };
    });

    const points = byGaffer.map((x) => x.points);
    // Across every archetype, the spread in points is small.
    expect(Math.max(...points) - Math.min(...points)).toBeLessThan(12);
    // And nobody is running up cricket scores.
    for (const x of byGaffer) expect(x.biggest).toBeLessThanOrEqual(9);
  });

  test("style moves the goals in your games, never the opposition's other games", () => {
    const calm = sim({ style: { attack: 0, defence: 0, tempo: 0.8 } });
    const wild = sim({ style: { attack: 0, defence: 0, tempo: 1.2 } });
    const others = (r: SeasonResult) =>
      r.matches.filter((m) => m.homeId !== YOU && m.awayId !== YOU)
        .reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
    expect(others(calm)).toBe(others(wild));

    const yours = (r: SeasonResult) => r.you.goalsFor + r.you.goalsAgainst;
    expect(yours(wild)).toBeGreaterThan(yours(calm));
  });
});

describe("scorelines stay believable", () => {
  test("even a dream XI against the weakest field rarely runs up double figures", () => {
    const best = [...esp.clubSeasons].sort((a, b) => b.strength - a.strength)[0]!;
    const picks = bestXi(best.players, "4-3-3", "prime", best);
    let most = 0;
    let sixPlus = 0;
    let matches = 0;
    for (let i = 0; i < 12; i++) {
      const r = simulateSeason({
        league: "esp", picks, lens: "prime", pool: esp.clubSeasons,
        opponentSeason: SEASON, seed: `blow:${i}`, style: GAFFERS.find((g) => g.id === "gambler"),
      });
      for (const m of r.matches) {
        if (m.homeId !== YOU && m.awayId !== YOU) continue;
        matches++;
        const gf = m.homeId === YOU ? m.homeGoals : m.awayGoals;
        most = Math.max(most, gf);
        if (gf >= 6) sixPlus++;
      }
    }
    expect(most).toBeLessThanOrEqual(10);
    // Six or more should stay a highlight, not a weekly occurrence.
    expect(sixPlus / matches).toBeLessThan(0.1);
  });
});
