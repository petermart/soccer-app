import { useCallback, useState } from "react";
import type { Difficulty, DraftMode } from "../engine/draft.ts";
import type { LeagueId } from "../engine/leagues.ts";
import type { RatingLens } from "../engine/ratings.ts";

/**
 * Everything the setup screen remembers between runs.
 *
 * The setup screen unmounts while you draft and play, so without this every
 * choice snapped back to the default the moment you came back for another go.
 * The run seed is deliberately absent — each run gets a fresh one.
 */
export interface Settings {
  league: LeagueId;
  /** null means "the most recent season in the archive". */
  playSeason: string | null;
  formation: string;
  difficulty: Difficulty;
  mode: DraftMode;
  lens: RatingLens;
  showRatings: boolean;
  /** Indices into the selected league's season list; null means the full span. */
  range: [number, number] | null;
  teamName: string;
  gaffers: boolean;
  january: boolean;
  europe: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  league: "eng",
  playSeason: null,
  formation: "4-3-3",
  difficulty: "normal",
  mode: "squad",
  lens: "season",
  showRatings: true,
  range: null,
  teamName: "",
  gaffers: true,
  january: true,
  europe: true,
};

const KEY = "perfect-xi:settings:v1";

/** Storage can throw or be empty in private windows, so every access is guarded. */
function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge over the defaults so a stored blob from an older version, or one
    // missing a key, still yields a complete and valid object.
    return sanitise({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Drops anything that is no longer a valid choice. */
function sanitise(s: Settings): Settings {
  const difficulties: Difficulty[] = ["easy", "normal", "hard"];
  const modes: DraftMode[] = ["squad", "position"];
  const lenses: RatingLens[] = ["season", "prime"];
  const leagues: LeagueId[] = ["eng", "esp", "ger", "ita", "fra"];
  return {
    ...s,
    league: leagues.includes(s.league) ? s.league : DEFAULT_SETTINGS.league,
    difficulty: difficulties.includes(s.difficulty) ? s.difficulty : DEFAULT_SETTINGS.difficulty,
    mode: modes.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode,
    lens: lenses.includes(s.lens) ? s.lens : DEFAULT_SETTINGS.lens,
    showRatings: typeof s.showRatings === "boolean" ? s.showRatings : true,
    gaffers: typeof s.gaffers === "boolean" ? s.gaffers : true,
    january: typeof s.january === "boolean" ? s.january : true,
    europe: typeof s.europe === "boolean" ? s.europe : true,
    teamName: typeof s.teamName === "string" ? s.teamName.slice(0, 28) : "",
    range: Array.isArray(s.range) && s.range.length === 2 ? s.range : null,
  };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, () => void] {
  const [settings, setSettings] = useState<Settings>(read);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable — the choices still apply for this session.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return [settings, update, reset];
}
