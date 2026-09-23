/**
 * Draft rules: where a player may be slotted, and moving them once drafted.
 */
import { describe, expect, test } from "bun:test";
import { inflateArchive } from "../src/engine/archive.ts";
import {
  blockedFor, choicesFor, completedPicks, createDraft, draftPlayer,
  movePick, moveTargets, spin, type DraftConfig,
} from "../src/engine/draft.ts";
import { LEAGUE_ORDER } from "../src/engine/leagues.ts";
import { canPlaySlot, playableSlots, ratingInSlot } from "../src/engine/ratings.ts";
import { SLOTS, type LeagueArchive, type PlayerSeason } from "../src/engine/types.ts";

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
  seed: "rules-seed",
  teamName: "Test XI",
  ...over,
});

/** Drafts greedily until `count` slots are filled. */
function draftSome(state: ReturnType<typeof createDraft>, count: number) {
  let guard = 0;
  while (completedPicks(state).length < count && guard++ < 200) {
    const choice = spin(state, eng.clubSeasons).choices[0]!;
    const slot = state.slots.find(
      (s) => state.picks[s.index] === null && choice.slots.includes(s.slot),
    )!;
    draftPlayer(state, choice.player, slot.index);
  }
  return state;
}

describe("career positions", () => {
  test("every player has them, and keepers only ever have GK", () => {
    for (const id of LEAGUE_ORDER) {
      for (const cs of archives.get(id)!.clubSeasons) {
        for (const p of cs.players) {
          expect(p.careerPositions.length).toBeGreaterThan(0);
          const keeper = p.positions.includes("GK");
          expect(p.careerPositions.includes("GK")).toBe(keeper);
          if (keeper) expect(p.careerPositions).toEqual(["GK"]);
        }
      }
    }
  });

  test("they cover the season's own listing", () => {
    // What a player was listed as that year must be somewhere in their career.
    for (const cs of eng.clubSeasons) {
      for (const p of cs.players) {
        for (const listed of p.positions) {
          expect(canPlaySlot(p, listed)).toBe(true);
        }
      }
    }
  });

  test("a player can only be slotted where they have played", () => {
    const all = eng.clubSeasons.flatMap((c) => c.players);
    const striker = all.find(
      (p) => p.careerPositions.length === 1 && p.careerPositions[0] === "ST",
    )!;
    expect(canPlaySlot(striker, "ST")).toBe(true);
    expect(canPlaySlot(striker, "CF")).toBe(true); // one role, two names
    expect(canPlaySlot(striker, "CB")).toBe(false);
    expect(canPlaySlot(striker, "CDM")).toBe(false);
    expect(canPlaySlot(striker, "GK")).toBe(false);

    const back = all.find(
      (p) => p.careerPositions.length === 1 && p.careerPositions[0] === "CB",
    )!;
    expect(canPlaySlot(back, "CB")).toBe(true);
    expect(canPlaySlot(back, "ST")).toBe(false);
    expect(canPlaySlot(back, "RW")).toBe(false);
  });

  test("playableSlots and canPlaySlot always agree", () => {
    for (const p of eng.clubSeasons.flatMap((c) => c.players).slice(0, 4000)) {
      const playable = playableSlots(p);
      for (const slot of SLOTS) {
        expect(canPlaySlot(p, slot)).toBe(playable.includes(slot));
      }
    }
  });

  test("players are named the way the games name them", () => {
    const named = (league: string, pid: number) =>
      archives.get(league)!.clubSeasons.flatMap((c) => c.players).find((p) => p.pid === pid)?.name;
    // Both are "R. Dias" in the raw short_name column; the games call them this.
    expect(named("esp", 233419)).toBe("Raphinha");
    expect(named("eng", 239818)).toBe("Rúben Dias");
    expect(named("eng", 231866)).toBe("Rodri");
  });
});

describe("the draft honours positions", () => {
  test("it never offers a slot a player cannot fill", () => {
    const state = createDraft(baseConfig({ seed: "legal-slots" }));
    let guard = 0;
    while (!state.done && guard++ < 200) {
      const outcome = spin(state, eng.clubSeasons);
      for (const choice of outcome.choices) {
        expect(choice.slots.length).toBeGreaterThan(0);
        for (const slot of choice.slots) expect(canPlaySlot(choice.player, slot)).toBe(true);
      }
      const choice = outcome.choices[0]!;
      const slot = state.slots.find(
        (s) => state.picks[s.index] === null && choice.slots.includes(s.slot),
      )!;
      draftPlayer(state, choice.player, slot.index);
    }
    expect(state.done).toBe(true);
    for (const pick of completedPicks(state)) {
      expect(canPlaySlot(pick.player, pick.slot)).toBe(true);
    }
  });

  test("filling a position takes everyone who only plays there out of the running", () => {
    const state = createDraft(baseConfig({ seed: "blocked" }));
    spin(state, eng.clubSeasons);
    const keeper = state.currentClub!.players.find((p) => p.positions.includes("GK"))!;
    draftPlayer(state, keeper, state.slots.find((s) => s.slot === "GK")!.index);

    // The one keeper slot is filled, so every other keeper is now blocked.
    const club = eng.clubSeasons.find((cs) => cs.key !== state.history[0]?.club)!;
    const offered = new Set(choicesFor(state, club).map((c) => c.player.pid));
    for (const p of club.players.filter((p) => p.positions.includes("GK"))) {
      expect(offered.has(p.pid)).toBe(false);
    }
    const blocked = blockedFor(state, club);
    expect(blocked.some((b) => b.slots.includes("GK"))).toBe(true);
    for (const b of blocked) {
      expect(offered.has(b.player.pid)).toBe(false);
      expect(b.slots.length).toBeGreaterThan(0);
      // Blocked means the slot exists in the formation but is taken.
      for (const slot of b.slots) {
        expect(canPlaySlot(b.player, slot)).toBe(true);
        expect(state.slots.some((s) => s.slot === slot && state.picks[s.index] !== null)).toBe(true);
      }
    }
  });
});

describe("moving a drafted player", () => {
  test("only legal destinations are offered", () => {
    const state = draftSome(createDraft(baseConfig({ seed: "move-legal" })), 6);
    for (const pick of completedPicks(state)) {
      for (const target of moveTargets(state, pick.slotIndex)) {
        expect(canPlaySlot(pick.player, state.slots[target]!.slot)).toBe(true);
        const other = state.picks[target];
        // A swap needs the other player to cover the slot being vacated.
        if (other) expect(canPlaySlot(other.player, pick.slot)).toBe(true);
      }
    }
  });

  test("moving into an empty slot frees the old one", () => {
    const state = draftSome(createDraft(baseConfig({ seed: "move-empty" })), 6);
    const pick = completedPicks(state).find((p) =>
      moveTargets(state, p.slotIndex).some((t) => state.picks[t] === null),
    )!;
    const from = pick.slotIndex;
    const to = moveTargets(state, from).find((t) => state.picks[t] === null)!;

    movePick(state, from, to);

    expect(state.picks[from]).toBeNull();
    expect(state.picks[to]!.player.pid).toBe(pick.player.pid);
    expect(state.picks[to]!.slot).toBe(state.slots[to]!.slot);
    expect(state.picks[to]!.slotIndex).toBe(to);
  });

  test("moving onto a filled slot swaps the two", () => {
    const state = draftSome(createDraft(baseConfig({ seed: "move-swap" })), 8);
    const found = completedPicks(state)
      .map((p) => ({ p, to: moveTargets(state, p.slotIndex).find((t) => state.picks[t] !== null) }))
      .find((x) => x.to !== undefined)!;
    const from = found.p.slotIndex;
    const to = found.to!;
    const other = state.picks[to]!.player.pid;

    movePick(state, from, to);

    expect(state.picks[to]!.player.pid).toBe(found.p.player.pid);
    expect(state.picks[from]!.player.pid).toBe(other);
    expect(state.picks[from]!.slot).toBe(state.slots[from]!.slot);
    expect(state.picks[to]!.slot).toBe(state.slots[to]!.slot);
  });

  test("an illegal move is refused and changes nothing", () => {
    const state = draftSome(createDraft(baseConfig({ seed: "move-illegal" })), 6);
    const pick = completedPicks(state).find((p) =>
      state.slots.some(
        (s) => s.index !== p.slotIndex && !moveTargets(state, p.slotIndex).includes(s.index),
      ),
    )!;
    const illegal = state.slots.find(
      (s) => s.index !== pick.slotIndex && !moveTargets(state, pick.slotIndex).includes(s.index),
    )!;
    const before = state.picks.map((p) => p?.player.pid ?? null);

    expect(() => movePick(state, pick.slotIndex, illegal.index)).toThrow();
    expect(state.picks.map((p) => p?.player.pid ?? null)).toEqual(before);
  });

  test("a move keeps the XI legal and never duplicates a player", () => {
    const state = draftSome(createDraft(baseConfig({ seed: "move-legal-xi" })), 11);
    for (let i = 0; i < 20; i++) {
      const movable = completedPicks(state).filter((p) => moveTargets(state, p.slotIndex).length);
      if (!movable.length) break;
      const pick = movable[i % movable.length]!;
      const targets = moveTargets(state, pick.slotIndex);
      movePick(state, pick.slotIndex, targets[i % targets.length]!);

      const picks = completedPicks(state);
      expect(picks.length).toBe(11);
      expect(new Set(picks.map((p) => p.player.pid)).size).toBe(11);
      for (const p of picks) {
        expect(canPlaySlot(p.player, p.slot)).toBe(true);
        expect(p.slot).toBe(state.slots[p.slotIndex]!.slot);
      }
    }
  });
});

describe("the Prime lens reads a real peak rating", () => {
  /** Best rating across the positions a player may actually be slotted at. */
  const bestUnder = (p: PlayerSeason, lens: "season" | "prime") =>
    Math.max(...playableSlots(p).map((s) => ratingInSlot(p, s, lens)));

  test("every archive carries peak slot ratings for every player", () => {
    for (const league of LEAGUE_ORDER) {
      const arc = archives.get(league)!;
      let missing = 0;
      for (const cs of arc.clubSeasons) {
        for (const p of cs.players) if (!p.primeSlotRatings) missing++;
      }
      expect(missing).toBe(0);
    }
  });

  test("Prime never invents a rating far above the peak the player reached", () => {
    // It used to: the lens scaled the current slot rating by prime/overall,
    // so a 49-rated teenager came out at 91 against a real peak of 80. The
    // small remaining gap is EA's position-rating maths, the same gap the
    // season lens shows against overall.
    for (const league of LEAGUE_ORDER) {
      const arc = archives.get(league)!;
      let n = 0;
      let sum = 0;
      let wild = 0;
      for (const cs of arc.clubSeasons) {
        for (const p of cs.players) {
          if (p.positions.includes("GK")) continue;
          const gap = bestUnder(p, "prime") - p.prime;
          n++; sum += gap;
          if (gap > 8) wild++;
        }
      }
      expect(sum / n).toBeLessThan(1.2);
      expect(wild / n).toBeLessThan(0.005);
    }
  });

  test("Prime is never below the season being drafted from, on the whole", () => {
    // Per player the two can differ by a few points even at equal overall,
    // because the peak edition has its own attributes. What must hold is the
    // direction: Prime lifts a squad, it does not quietly lower one.
    const arc = archives.get("fra")!;
    let n = 0;
    let lifted = 0;
    let sum = 0;
    for (const cs of arc.clubSeasons) {
      for (const p of cs.players) {
        if (p.positions.includes("GK")) continue;
        expect(p.prime).toBeGreaterThanOrEqual(p.overall);
        const diff = bestUnder(p, "prime") - bestUnder(p, "season");
        n++; sum += diff;
        if (diff >= 0) lifted++;
      }
    }
    expect(sum / n).toBeGreaterThan(2);
    expect(lifted / n).toBeGreaterThan(0.9);
  });

  test("a player already at their peak rates about the same under both lenses", () => {
    const arc = archives.get("fra")!;
    let checked = 0;
    let sum = 0;
    for (const cs of arc.clubSeasons) {
      for (const p of cs.players) {
        if (p.overall !== p.prime || p.positions.includes("GK")) continue;
        // Within a few points: same overall, but the peak edition can be a
        // different year with slightly different attributes.
        expect(Math.abs(bestUnder(p, "prime") - bestUnder(p, "season"))).toBeLessThanOrEqual(6);
        sum += Math.abs(bestUnder(p, "prime") - bestUnder(p, "season"));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(sum / checked).toBeLessThan(1);
  });
});
