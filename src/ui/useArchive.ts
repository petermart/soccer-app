import { useEffect, useState } from "react";
import { inflateArchive } from "../engine/archive.ts";
import type { LeagueId } from "../engine/leagues.ts";
import type { ClubSeason, LeagueArchive } from "../engine/types.ts";

export interface LeagueSummary {
  id: LeagueId;
  name: string;
  country: string;
  code: string;
  seasons: number;
  /** Every season in the archive, oldest first. */
  seasonList: string[];
  /** Clubs per season — top flights change size over the years. */
  shape: Record<string, number>;
  clubSeasons: number;
  players: number;
  firstSeason: string;
  lastSeason: string;
  accent: string;
}

/** Archives are immutable once fetched, so one module-level cache is enough. */
const cache = new Map<LeagueId, LeagueArchive>();
const inflight = new Map<LeagueId, Promise<LeagueArchive>>();

export async function loadArchive(id: LeagueId): Promise<LeagueArchive> {
  const hit = cache.get(id);
  if (hit) return hit;
  const pending = inflight.get(id);
  if (pending) return pending;

  const promise = (async () => {
    const res = await fetch(`/api/league/${id}`);
    if (!res.ok) throw new Error(`Could not load ${id}: ${res.status}`);
    const archive = inflateArchive(await res.json());
    cache.set(id, archive);
    inflight.delete(id);
    return archive;
  })();

  inflight.set(id, promise);
  return promise;
}

export function useLeagueSummaries() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/leagues")
      .then((r) => r.json())
      .then((d) => live && setLeagues(d))
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, []);

  return { leagues, error };
}

/**
 * Loads the club-seasons for the selected league.
 *
 * The loaded set is tagged with the league it was loaded for, so callers can
 * never be handed a pool belonging to a previous selection — without that,
 * a draft can mount against an empty or stale archive.
 */
export function usePool(league: LeagueId | null) {
  const wanted = league ?? "";
  const [loaded, setLoaded] = useState<{ key: string; pool: ClubSeason[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!league) { setLoaded({ key: "", pool: [] }); return; }
    let live = true;
    setError(null);
    loadArchive(league)
      .then((archive) => live && setLoaded({ key: league, pool: archive.clubSeasons }))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [league]);

  const ready = loaded?.key === wanted;
  return {
    pool: ready ? loaded.pool : null,
    loading: !ready && !error,
    error,
  };
}
