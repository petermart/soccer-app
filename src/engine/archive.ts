/**
 * Loads the compact on-disk archives and inflates them into game objects.
 * The tuple layout here must stay in step with scripts/build-data.ts.
 */
import type { LeagueId } from "./leagues.ts";
import type { ClubSeason, LeagueArchive, PlayerSeason, Slot } from "./types.ts";

type PlayerTuple = [
  pid: number, name: string, fullName: string, nation: string, age: number,
  overall: number, prime: number, positions: string,
  slotRatings: number[], face: [number, number, number, number, number, number],
  careerPositions: string,
];

interface RawClubSeason {
  key: string; club: string; season: string; seasonIdx: number;
  strength: number; attack: number; defence: number; rating: number;
  players: PlayerTuple[];
}

interface RawArchive {
  league: LeagueId;
  seasons: string[];
  shape: Record<string, number>;
  /** Career-best slot ratings, keyed by player id, shared across their seasons. */
  peaks?: Record<string, number[]>;
  clubSeasons: RawClubSeason[];
}

function inflatePlayer(t: PlayerTuple, peaks: Record<string, number[]>): PlayerSeason {
  return {
    pid: t[0],
    name: t[1],
    fullName: t[2] || t[1],
    nation: t[3],
    age: t[4],
    overall: t[5],
    prime: t[6],
    positions: t[7].split(",").filter(Boolean) as Slot[],
    careerPositions: (t[10] || t[7]).split(",").filter(Boolean) as Slot[],
    slotRatings: t[8],
    primeSlotRatings: peaks[String(t[0])] ?? null,
    face: t[9],
  };
}

export function inflateArchive(raw: RawArchive): LeagueArchive {
  return {
    league: raw.league,
    seasons: raw.seasons,
    shape: raw.shape,
    clubSeasons: raw.clubSeasons.map(
      (cs): ClubSeason => ({
        key: cs.key,
        club: cs.club,
        league: raw.league,
        season: cs.season,
        seasonIdx: cs.seasonIdx,
        strength: cs.strength,
        attack: cs.attack,
        defence: cs.defence,
        rating: cs.rating,
        players: cs.players.map((t) => inflatePlayer(t, raw.peaks ?? {})),
      }),
    ),
  };
}

export interface ArchiveSummary {
  id: LeagueId;
  name: string;
  country: string;
  seasons: number;
  clubSeasons: number;
  players: number;
}
