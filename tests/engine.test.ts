import { describe, expect, test } from "bun:test";
import { inflateArchive } from "../src/engine/archive.ts";
import { bestXi } from "../src/engine/bestxi.ts";
import {
  createDraft, draftPlayer, eligibleClubSeasons, reroll, spin,
  completedPicks, REROLLS, type DraftConfig,
} from "../src/engine/draft.ts";
import { FORMATIONS, slotsOf } from "../src/engine/formations.ts";
import { LEAGUES, LEAGUE_ORDER } from "../src/engine/leagues.ts";
import { canPlaySlot, rateTeam, ratingInSlot } from "../src/engine/ratings.ts";
import { Rng } from "../src/engine/rng.ts";
import { simulateSeason, YOU } from "../src/engine/simulate.ts";
import type { LeagueArchive } from "../src/engine/types.ts";

const archives = new Map<string, LeagueArchive>();
for (const id of LEAGUE_ORDER) {
  archives.set(id, inflateArchive(await Bun.file(`src/data/${id}.json`).json()));
}
const eng = archives.get("eng")!;

const baseConfig = (over: Partial<DraftConfig> = {}): DraftConfig => ({
  league: "eng",
  playSeason: null,
  formation: "4-3-3",
  difficulty: "normal",
  mode: "squad",
  lens: "season",
  showRatings: true,
  seasonRange: ["2006/07", "2025/26"],
  uniquePlayers: true,
  seed: "test-seed",
  teamName: "Test XI",
  ...over,
});

describe("archive", () => {
  test("every league loads with twenty seasons of complete club-seasons", () => {
    for (const id of LEAGUE_ORDER) {
      const arc = archives.get(id)!;
      expect(arc.seasons.length).toBe(20);
      expect(arc.seasons[0]).toBe("2006/07");
      expect(arc.seasons.at(-1)).toBe("2025/26");
      expect(arc.clubSeasons.length).toBeGreaterThan(350);
      for (const cs of arc.clubSeasons) {
        expect(cs.players.length).toBeGreaterThanOrEqual(14);
        expect(cs.attack).toBeGreaterThan(0);
        expect(cs.defence).toBeGreaterThan(0);
      }
    }
  });

  test("every club-season can field a legal keeper", () => {
    for (const id of LEAGUE_ORDER) {
      for (const cs of archives.get(id)!.clubSeasons) {
        expect(cs.players.some((p) => p.positions.includes("GK"))).toBe(true);
      }
    }
  });
});

describe("formations", () => {
  test("each formation has eleven slots, one keeper, and matching coordinates", () => {
    for (const [name, f] of Object.entries(FORMATIONS)) {
      expect(f.slots.length).toBe(11);
      expect(f.coords.length).toBe(11);
      expect(f.slots.filter((s) => s === "GK").length).toBe(1);
      expect(f.name).toBe(name);
    }
  });
});

describe("slot sides", () => {
  test("duplicate slots in a formation are told apart by side", () => {
    // Two centre-backs used to render as two identical "CB" choices, so
    // picking a side was a coin flip.
    const back4 = slotsOf("4-3-3").filter((s) => s.slot === "CB");
    expect(back4.length).toBe(2);
    expect(new Set(back4.map((s) => s.side))).toEqual(new Set(["left", "right"]));
    expect(new Set(back4.map((s) => s.label))).toEqual(new Set(["CB left", "CB right"]));
  });

  test("the side matches where the slot actually renders", () => {
    for (const name of Object.keys(FORMATIONS)) {
      for (const s of slotsOf(name)) {
        if (s.side === "right") {
          const mirror = slotsOf(name).find((o) => o.slot === s.slot && o.side === "left")!;
          // Higher x renders further right on the pitch.
          expect(s.coords[0]).toBeGreaterThan(mirror.coords[0]);
        }
      }
    }
  });

  test("a unique slot name carries no side and is labelled plainly", () => {
    const gk = slotsOf("4-3-3").find((s) => s.slot === "GK")!;
    expect(gk.side).toBeNull();
    expect(gk.label).toBe("GK");
  });

  test("three of the same slot get left, centre and right", () => {
    const mids = slotsOf("4-3-3").filter((s) => s.slot === "CM");
    expect(mids.length).toBe(3);
    expect(new Set(mids.map((s) => s.side))).toEqual(new Set(["left", "centre", "right"]));
  });

  test("every formation labels its slots uniquely", () => {
    for (const name of Object.keys(FORMATIONS)) {
      const labels = slotsOf(name).map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("ratings", () => {
  test("a keeper is unusable outfield and vice versa", () => {
    const squad = eng.clubSeasons[0]!.players;
    const keeper = squad.find((p) => p.positions.includes("GK"))!;
    const outfielder = squad.find((p) => !p.positions.includes("GK"))!;
    expect(canPlaySlot(keeper, "GK")).toBe(true);
    expect(canPlaySlot(keeper, "ST")).toBe(false);
    expect(canPlaySlot(outfielder, "GK")).toBe(false);
  });

  test("playing out of position costs rating", () => {
    const striker = eng.clubSeasons
      .flatMap((c) => c.players)
      .find((p) => p.positions.length === 1 && p.positions[0] === "ST" && p.overall > 82)!;
    expect(ratingInSlot(striker, "ST", "season")).toBeGreaterThan(
      ratingInSlot(striker, "CB", "season"),
    );
  });

  test("prime is never below the season rating", () => {
    for (const cs of eng.clubSeasons.slice(0, 40)) {
      for (const p of cs.players) expect(p.prime).toBeGreaterThanOrEqual(p.overall);
    }
  });

  test("an unbalanced side is penalised against a balanced one of equal talent", () => {
    const pool = eng.clubSeasons;
    const balanced = bestXi(pool.flatMap((c) => c.players).slice(0, 4000), "4-3-3", "season");
    const rating = rateTeam(balanced, "season");
    expect(rating.balance).toBeGreaterThan(0);
    expect(rating.balancePenalty).toBeGreaterThanOrEqual(0);
    expect(rating.overall).toBeGreaterThan(40);
    expect(rating.overall).toBeLessThan(100);
  });
});

describe("draft", () => {
  test("a full XI can always be drafted, in every formation", () => {
    for (const formation of Object.keys(FORMATIONS)) {
      const state = createDraft(baseConfig({ formation, seed: `full:${formation}` }));
      let guard = 0;
      while (!state.done && guard++ < 200) {
        const outcome = spin(state, eng.clubSeasons);
        const choice = outcome.choices[0]!;
        const slot = state.slots.find(
          (s) => state.picks[s.index] === null && choice.slots.includes(s.slot),
        )!;
        draftPlayer(state, choice.player, slot.index);
      }
      expect(state.done).toBe(true);
      expect(completedPicks(state).length).toBe(11);
    }
  });

  test("the same human cannot be drafted twice", () => {
    const state = createDraft(baseConfig({ seed: "unique" }));
    let guard = 0;
    while (!state.done && guard++ < 200) {
      const outcome = spin(state, eng.clubSeasons);
      const choice = outcome.choices[0]!;
      const slot = state.slots.find(
        (s) => state.picks[s.index] === null && choice.slots.includes(s.slot),
      )!;
      draftPlayer(state, choice.player, slot.index);
    }
    const ids = completedPicks(state).map((p) => p.player.pid);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the wheel never lands on a club that cannot help", () => {
    const state = createDraft(baseConfig({ seed: "eligible" }));
    spin(state, eng.clubSeasons);
    draftPlayer(state, spinFirstChoice(state), keeperSlotIndex(state));
    for (const cs of eligibleClubSeasons(state, eng.clubSeasons)) {
      const open = state.slots.filter((s) => state.picks[s.index] === null);
      expect(cs.players.some((p) => open.some((o) => canPlaySlot(p, o.slot)))).toBe(true);
    }
  });

  test("rerolls are limited by difficulty and then refused", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const state = createDraft(baseConfig({ difficulty, seed: `rr:${difficulty}` }));
      spin(state, eng.clubSeasons);
      let used = 0;
      while (reroll(state, eng.clubSeasons) !== null) used++;
      expect(used).toBe(REROLLS[difficulty]);
      expect(reroll(state, eng.clubSeasons)).toBeNull();
    }
  });

  test("an illegal slot assignment is rejected", () => {
    const state = createDraft(baseConfig({ seed: "illegal" }));
    const outcome = spin(state, eng.clubSeasons);
    const keeper = outcome.choices.find((c) => c.player.positions.includes("GK"));
    if (!keeper) return;
    const outfieldSlot = state.slots.find((s) => s.slot !== "GK")!;
    expect(() => draftPlayer(state, keeper.player, outfieldSlot.index)).toThrow();
  });

  test("the season range is respected", () => {
    const state = createDraft(baseConfig({ seasonRange: ["2020/21", "2022/23"], seed: "range" }));
    const eligible = eligibleClubSeasons(state, eng.clubSeasons);
    expect(eligible.length).toBeGreaterThan(0);
    for (const cs of eligible) {
      expect(cs.season >= "2020/21" && cs.season <= "2022/23").toBe(true);
    }
  });
});

function spinFirstChoice(state: ReturnType<typeof createDraft>) {
  const keeper = state.currentClub!.players.find((p) => p.positions.includes("GK"));
  return keeper!;
}
function keeperSlotIndex(state: ReturnType<typeof createDraft>) {
  return state.slots.find((s) => s.slot === "GK")!.index;
}

describe("simulation", () => {
  const picks = bestXi(
    [...eng.clubSeasons].sort((a, b) => b.strength - a.strength)[0]!.players,
    "4-3-3",
    "season",
  );

  test("produces a complete, internally consistent league table", () => {
    for (const id of LEAGUE_ORDER) {
      const arc = archives.get(id)!;
      const r = simulateSeason({
        league: id, picks, lens: "season", pool: arc.clubSeasons, seed: `sim:${id}`,
      });

      expect(r.table.length).toBe(r.teams);
      expect(r.matches.length).toBe(r.teams * (r.teams - 1));
      for (const row of r.table) expect(row.played).toBe(r.gamesPlayed);
      expect(r.you.played).toBe(r.gamesPlayed);
      expect(r.you.won + r.you.drawn + r.you.lost).toBe(r.gamesPlayed);

      // Goals scored across the league must equal goals conceded across it.
      const gf = r.table.reduce((s, x) => s + x.goalsFor, 0);
      const ga = r.table.reduce((s, x) => s + x.goalsAgainst, 0);
      expect(gf).toBe(ga);

      // Points must match results exactly.
      for (const row of r.table) expect(row.points).toBe(row.won * 3 + row.drawn);
    }
  });

  test("each club plays every other home and away exactly once", () => {
    const r = simulateSeason({
      league: "eng", picks, lens: "season", pool: eng.clubSeasons, seed: "fixtures",
    });
    const seen = new Map<string, number>();
    for (const m of r.matches) {
      const key = `${m.homeId}>${m.awayId}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      expect(m.homeId).not.toBe(m.awayId);
    }
    for (const count of seen.values()) expect(count).toBe(1);
    expect(seen.size).toBe(r.matches.length);

    const homeGames = r.matches.filter((m) => m.homeId === YOU).length;
    expect(homeGames).toBe(r.gamesPlayed / 2);
  });

  test("the same seed always gives the same season", () => {
    const a = simulateSeason({ league: "ita", picks, lens: "season", pool: archives.get("ita")!.clubSeasons, seed: "same" });
    const b = simulateSeason({ league: "ita", picks, lens: "season", pool: archives.get("ita")!.clubSeasons, seed: "same" });
    expect(b.you.points).toBe(a.you.points);
    expect(b.matches.map((m) => `${m.homeGoals}-${m.awayGoals}`).join()).toBe(
      a.matches.map((m) => `${m.homeGoals}-${m.awayGoals}`).join(),
    );
  });

  test("different seeds give different seasons", () => {
    const results = new Set(
      Array.from({ length: 12 }, (_, i) =>
        simulateSeason({ league: "eng", picks, lens: "season", pool: eng.clubSeasons, seed: `v${i}` }).you.points,
      ),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  test("goals are shared out across the XI and add up", () => {
    const r = simulateSeason({
      league: "esp", picks, lens: "season", pool: archives.get("esp")!.clubSeasons, seed: "scorers",
    });
    expect(r.scorers.reduce((s, x) => s + x.goals, 0)).toBe(r.you.goalsFor);
    expect(r.scorers.length).toBe(11);
    // Forwards should out-score the keeper.
    expect(r.scorers[0]!.goals).toBeGreaterThanOrEqual(r.scorers.at(-1)!.goals);
  });

  test("you take the weakest club's place in a real season's field", () => {
    const season = "2018/19";
    const field = eng.clubSeasons.filter((c) => c.season === season);
    const weakest = [...field].sort((a, b) => a.rating - b.rating)[0]!;

    const r = simulateSeason({
      league: "eng", picks, lens: "season", pool: eng.clubSeasons,
      opponentSeason: season, seed: "replace",
    });

    expect(r.seasonLabel).toBe(season);
    expect(r.replacedClub).toBe(weakest.club);
    // The club you replaced is not also in the table alongside you.
    expect(r.table.some((row) => row.name === weakest.club)).toBe(false);
    // Everyone else from that real season is.
    const others = field.filter((c) => c.club !== weakest.club).map((c) => c.club).sort();
    expect(r.table.filter((row) => !row.isYou).map((row) => row.name).sort()).toEqual(others);
  });

  test("the chosen season is honoured and is reproducible", () => {
    for (const season of ["2006/07", "2014/15", "2025/26"]) {
      const r = simulateSeason({
        league: "esp", picks, lens: "season", pool: archives.get("esp")!.clubSeasons,
        opponentSeason: season, seed: "season-choice",
      });
      expect(r.seasonLabel).toBe(season);
      expect(r.table.length).toBe(r.teams);
    }
  });

  test("season length follows the real field size, not a constant", () => {
    // Germany has always run 18 clubs.
    const ger = simulateSeason({
      league: "ger", picks, lens: "season", pool: archives.get("ger")!.clubSeasons,
      opponentSeason: "2015/16", seed: "bund",
    });
    expect(ger.teams).toBe(18);
    expect(ger.gamesPlayed).toBe(34);
    expect(ger.perfectTarget).toBe("34-0");

    // Ligue 1 dropped back to 18 clubs in 2023/24.
    const fraBig = simulateSeason({
      league: "fra", picks, lens: "season", pool: archives.get("fra")!.clubSeasons,
      opponentSeason: "2018/19", seed: "l1a",
    });
    const fraSmall = simulateSeason({
      league: "fra", picks, lens: "season", pool: archives.get("fra")!.clubSeasons,
      opponentSeason: "2024/25", seed: "l1b",
    });
    expect(fraBig.teams).toBe(20);
    expect(fraBig.perfectTarget).toBe("38-0");
    expect(fraSmall.teams).toBe(18);
    expect(fraSmall.perfectTarget).toBe("34-0");
  });

  test("every archived season can be simulated", () => {
    for (const id of LEAGUE_ORDER) {
      const arc = archives.get(id)!;
      for (const season of arc.seasons) {
        const r = simulateSeason({
          league: id, picks, lens: "season", pool: arc.clubSeasons,
          opponentSeason: season, seed: `all:${id}:${season}`,
        });
        expect(r.seasonLabel).toBe(season);
        expect(r.teams).toBeGreaterThanOrEqual(17);
        expect(r.table.length).toBe(r.teams);
        expect(r.you.played).toBe(r.gamesPlayed);
      }
    }
  });

  test("a stronger side reliably out-points a weaker one", () => {
    const sorted = [...eng.clubSeasons].sort((a, b) => b.strength - a.strength);
    const strong = bestXi(sorted[0]!.players, "4-3-3", "season");
    const weak = bestXi(sorted.at(-1)!.players, "4-3-3", "season");
    let strongPts = 0;
    let weakPts = 0;
    for (let i = 0; i < 25; i++) {
      strongPts += simulateSeason({ league: "eng", picks: strong, lens: "season", pool: eng.clubSeasons, seed: `s${i}` }).you.points;
      weakPts += simulateSeason({ league: "eng", picks: weak, lens: "season", pool: eng.clubSeasons, seed: `s${i}` }).you.points;
    }
    expect(strongPts).toBeGreaterThan(weakPts * 1.4);
  });
});

describe("rng", () => {
  test("is deterministic and stays in range", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    for (let i = 0; i < 500; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("poisson has roughly the requested mean", () => {
    const rng = new Rng("poisson");
    for (const lambda of [0.3, 1.4, 3.1]) {
      let total = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) total += rng.poisson(lambda);
      expect(Math.abs(total / n - lambda)).toBeLessThan(lambda * 0.08);
    }
  });

  test("shuffle keeps every element", () => {
    const rng = new Rng("shuffle");
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = rng.shuffle(input);
    expect(out.length).toBe(input.length);
    expect(new Set(out).size).toBe(input.length);
    expect(input[0]).toBe(0); // original untouched
  });
});
