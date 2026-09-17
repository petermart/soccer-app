import type { LeagueId } from "./leagues.ts";

/** The 15 pitch slots any supported formation can ask for. */
export const SLOTS = [
  "GK", "RB", "CB", "LB", "RWB", "LWB",
  "CDM", "CM", "CAM", "RM", "LM",
  "RW", "LW", "CF", "ST",
] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_INDEX: Record<Slot, number> = Object.fromEntries(
  SLOTS.map((s, i) => [s, i]),
) as Record<Slot, number>;

export type Line = "GK" | "DEF" | "MID" | "ATT";

export const SLOT_LINE: Record<Slot, Line> = {
  GK: "GK",
  RB: "DEF", CB: "DEF", LB: "DEF", RWB: "DEF", LWB: "DEF",
  CDM: "MID", CM: "MID", CAM: "MID", RM: "MID", LM: "MID",
  RW: "ATT", LW: "ATT", CF: "ATT", ST: "ATT",
};

/**
 * A player as they were in one specific club-season. Stored as a compact
 * tuple on disk; this is the inflated form the game works with.
 */
export interface PlayerSeason {
  /** Stable id: sofifa player id, unique per human (not per season). */
  pid: number;
  name: string;
  fullName: string;
  nation: string;
  age: number;
  /** Overall in this season. */
  overall: number;
  /** Career-best overall anywhere in the archive ("Prime" lens). */
  prime: number;
  /** Positions that season's game listed them at, e.g. ["CF","ST"]. */
  positions: Slot[];
  /**
   * Primary and secondary positions across every FIFA / EA FC edition, most
   * common first. This, not the single season, decides where they may play.
   */
  careerPositions: Slot[];
  /** Per-slot rating, index-aligned with SLOTS. 0 means unusable there. */
  slotRatings: number[];
  /** pace, shooting, passing, dribbling, defending, physical. */
  face: [number, number, number, number, number, number];
}

export interface ClubSeason {
  /** Unique key, e.g. "esp:FC Barcelona:2014/15". */
  key: string;
  club: string;
  league: LeagueId;
  season: string;
  /** Index into the league's season list. */
  seasonIdx: number;
  players: PlayerSeason[];
  /** Mean overall of the best XI — how good this squad really was. */
  strength: number;
  /** Attack rating of the XI this club would field, precomputed at build time. */
  attack: number;
  /** Defence rating of that same XI. */
  defence: number;
  /** Whole-team rating of that same XI. */
  rating: number;
}

/** A club-season used as computer opposition, with derived line ratings. */
export interface OpponentProfile {
  club: string;
  season: string;
  attack: number;
  midfield: number;
  defence: number;
  overall: number;
}

export interface LeagueArchive {
  league: LeagueId;
  seasons: string[];
  /** Clubs per season. Top flights change size, so this is not a constant. */
  shape: Record<string, number>;
  clubSeasons: ClubSeason[];
}
