/**
 * European nights: who qualifies, who they meet, and whether the campaign
 * that follows holds together.
 */
import { describe, expect, test } from "bun:test";
import { inflateArchive } from "../src/engine/archive.ts";
import { bestXi } from "../src/engine/bestxi.ts";
import {
  buildField, competitionFor, simulateEurope, COMPETITIONS, QUALIFICATION,
  type Competition, type EuropeData,
} from "../src/engine/europe.ts";
import { LEAGUE_ORDER, type LeagueId } from "../src/engine/leagues.ts";
import { rateTeam, type Pick } from "../src/engine/ratings.ts";
import { YOU } from "../src/engine/simulate.ts";
import type { LeagueArchive } from "../src/engine/types.ts";

const data: EuropeData = await Bun.file("src/data/europe.json").json();
const esp: LeagueArchive = inflateArchive(await Bun.file("src/data/esp.json").json());
const SEASON = "2025/26";

const picks: Pick[] = bestXi(
  [...esp.clubSeasons].sort((a, b) => b.strength - a.strength)[0]!.players, "4-3-3", "season",
);
const rating = rateTeam(picks, "season");

const run = (competition: Competition, league: LeagueId = "esp", seed = "euro") =>
  simulateEurope({
    data, season: SEASON, competition, yourLeague: league, yourName: "Your XI",
    picks, lens: "season", yourAttack: rating.attack, yourDefence: rating.defence, seed,
  });

describe("qualification", () => {
  test("the rule is top four, then fifth, then sixth", () => {
    expect(competitionFor("esp", 1)).toBe("cl");
    expect(competitionFor("esp", 4)).toBe("cl");
    expect(competitionFor("esp", 5)).toBe("el");
    expect(competitionFor("esp", 6)).toBe("uecl");
    expect(competitionFor("esp", 7)).toBeNull();
    expect(competitionFor("esp", 20)).toBeNull();
  });

  test("it applies to every league, and can be overridden per league", () => {
    for (const league of LEAGUE_ORDER) {
      expect(competitionFor(league, 3)).toBe("cl");
      expect(competitionFor(league, 6)).toBe("uecl");
    }
    // The rule lives in one object so it can be corrected without touching
    // anything that reads it.
    expect(QUALIFICATION.default.slice(0, 6))
      .toEqual(["cl", "cl", "cl", "cl", "el", "uecl"]);
  });
});

describe("the field", () => {
  test("every season has qualifiers for all five leagues", () => {
    const seasons = Object.keys(data);
    expect(seasons.length).toBe(20);
    for (const season of seasons) {
      for (const league of LEAGUE_ORDER) {
        const qualifiers = data[season]![league]!;
        expect(qualifiers.length).toBeGreaterThanOrEqual(6);
        for (const q of qualifiers) {
          expect(q.club.length).toBeGreaterThan(0);
          expect(q.attack).toBeGreaterThan(0);
          expect(q.defence).toBeGreaterThan(0);
          expect(q.prevPos).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test("the Champions League takes four per league, the others one each", () => {
    for (const [competition, perLeague] of [["cl", 4], ["el", 1], ["uecl", 1]] as const) {
      const { field } = buildField({
        data, season: SEASON, competition, yourLeague: "esp",
        yourName: "Your XI", yourAttack: 80, yourDefence: 80,
      });
      // Five leagues, minus the one club you displaced, plus you.
      expect(field.length).toBe(perLeague * 5);
      for (const league of LEAGUE_ORDER) {
        const from = field.filter((c) => c.league === league).length;
        expect(from).toBe(perLeague);
      }
      expect(field.filter((c) => c.isYou).length).toBe(1);
    }
  });

  test("you displace the club from your own league that scraped in", () => {
    // Spain's 2025/26 Champions League places went to the top four of
    // 2024/25, so the fourth-placed club is the one that makes way.
    const qualifiers = data[SEASON]!.esp!;
    const fourth = qualifiers[3]!;
    const { field, displaced } = buildField({
      data, season: SEASON, competition: "cl", yourLeague: "esp",
      yourName: "Your XI", yourAttack: 80, yourDefence: 80,
    });
    expect(displaced).toBe(fourth.club);
    expect(field.some((c) => c.name === fourth.club)).toBe(false);
    // The three ahead of them stay.
    for (const q of qualifiers.slice(0, 3)) {
      expect(field.some((c) => c.name === q.club)).toBe(true);
    }
  });

  test("a different league displaces one of its own", () => {
    for (const league of LEAGUE_ORDER) {
      const { field, displaced } = buildField({
        data, season: SEASON, competition: "cl", yourLeague: league,
        yourName: "Your XI", yourAttack: 80, yourDefence: 80,
      });
      expect(displaced).toBe(data[SEASON]![league]![3]!.club);
      expect(field.filter((c) => c.league === league && !c.isYou).length).toBe(3);
    }
  });
});

describe("the campaign", () => {
  test("a big field plays eight league-phase games, then a knockout", () => {
    const r = run("cl");
    expect(r.clubs.length).toBe(20);
    const yours = r.leaguePhase.filter((m) => m.homeId === YOU || m.awayId === YOU);
    expect(yours.length).toBe(8);
    // Eight different opponents, never yourself.
    const opponents = new Set(yours.map((m) => (m.homeId === YOU ? m.awayId : m.homeId)));
    expect(opponents.size).toBe(8);
    expect(opponents.has(YOU)).toBe(false);
    expect(r.table.length).toBe(20);
    for (const row of r.table) expect(row.played).toBe(8);
  });

  test("a small field plays everyone home and away, then a final", () => {
    const r = run("el");
    expect(r.clubs.length).toBe(5);
    const yours = r.leaguePhase.filter((m) => m.homeId === YOU || m.awayId === YOU);
    expect(yours.length).toBe(8); // four opponents, twice each
    for (const row of r.table) expect(row.played).toBe(8);
    if (r.ties.length) {
      expect(r.ties.length).toBe(1);
      expect(r.ties[0]!.round).toBe("Final");
      expect(r.ties[0]!.neutral).toBe(true);
      expect(r.ties[0]!.legs.length).toBe(1);
    }
  });

  test("the table adds up and goals balance", () => {
    for (const competition of ["cl", "el", "uecl"] as const) {
      const r = run(competition);
      const gf = r.table.reduce((s, x) => s + x.goalsFor, 0);
      const ga = r.table.reduce((s, x) => s + x.goalsAgainst, 0);
      expect(gf).toBe(ga);
      for (const row of r.table) {
        expect(row.points).toBe(row.won * 3 + row.drawn);
        expect(row.won + row.drawn + row.lost).toBe(row.played);
      }
    }
  });

  test("knockout ties resolve, with penalties only when level", () => {
    for (let i = 0; i < 40; i++) {
      const r = run("cl", "esp", `ko:${i}`);
      for (const tie of r.ties) {
        if (tie.yourAggregate === tie.theirAggregate) {
          expect(tie.penalties).not.toBeNull();
          expect(tie.won).toBe(tie.penalties!.you > tie.penalties!.them);
        } else {
          expect(tie.penalties).toBeNull();
          expect(tie.won).toBe(tie.yourAggregate > tie.theirAggregate);
        }
      }
      // A run ends the moment you lose: no tie follows a defeat.
      const lostAt = r.ties.findIndex((t) => !t.won);
      if (lostAt >= 0) expect(lostAt).toBe(r.ties.length - 1);
      if (r.won) expect(r.ties.at(-1)!.round).toBe("Final");
    }
  });

  test("your own goals carry scorers and minutes, the opposition's just minutes", () => {
    const r = run("cl");
    for (const m of r.yourMatches) {
      const gf = m.homeId === YOU ? m.homeGoals : m.awayGoals;
      const ga = m.homeId === YOU ? m.awayGoals : m.homeGoals;
      expect(m.yourGoals.length).toBe(gf);
      expect(m.oppGoals.length).toBe(ga);
      for (const g of m.yourGoals) {
        expect(g.minute).toBeGreaterThanOrEqual(1);
        expect(g.minute).toBeLessThanOrEqual(90);
        expect(g.name.length).toBeGreaterThan(0);
        expect(g.assistPid).not.toBe(g.pid);
      }
    }
  });

  test("the same seed replays the same campaign", () => {
    const a = run("cl", "esp", "same");
    const b = run("cl", "esp", "same");
    expect(b.finish).toBe(a.finish);
    expect(b.leaguePosition).toBe(a.leaguePosition);
    expect(b.leaguePhase.map((m) => `${m.homeGoals}-${m.awayGoals}`).join())
      .toBe(a.leaguePhase.map((m) => `${m.homeGoals}-${m.awayGoals}`).join());
  });

  test("a stronger side goes further, over many runs", () => {
    const weak = bestXi(
      [...esp.clubSeasons].sort((a, b) => a.strength - b.strength)[0]!.players, "4-3-3", "season",
    );
    const weakRating = rateTeam(weak, "season");
    let strongWins = 0;
    let weakWins = 0;
    for (let i = 0; i < 30; i++) {
      strongWins += run("cl", "esp", `s:${i}`).won ? 1 : 0;
      weakWins += simulateEurope({
        data, season: SEASON, competition: "cl", yourLeague: "esp", yourName: "Weak XI",
        picks: weak, lens: "season", yourAttack: weakRating.attack,
        yourDefence: weakRating.defence, seed: `s:${i}`,
      }).won ? 1 : 0;
    }
    expect(strongWins).toBeGreaterThan(weakWins);
  });

  test("every season and competition is playable from every league", () => {
    for (const season of Object.keys(data)) {
      for (const league of LEAGUE_ORDER) {
        for (const competition of Object.keys(COMPETITIONS) as Competition[]) {
          const r = simulateEurope({
            data, season, competition, yourLeague: league, yourName: "Your XI",
            picks, lens: "season", yourAttack: rating.attack,
            yourDefence: rating.defence, seed: `all:${season}:${league}:${competition}`,
          });
          expect(r.clubs.length).toBeGreaterThanOrEqual(5);
          expect(r.table.find((row) => row.isYou)).toBeDefined();
          expect(r.finish.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
