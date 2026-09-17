/** The five competitions the archive covers, with their real shape. */
export type LeagueId = "eng" | "esp" | "ger" | "ita" | "fra";

export interface LeagueConfig {
  id: LeagueId;
  /** sofifa league_id in the source dataset */
  sourceId: string;
  name: string;
  country: string;
  /** Three-letter code used as the card badge; emoji flags do not render everywhere. */
  code: string;
  /**
   * Clubs in a *typical modern* season. Real season sizes come from the
   * archive, since top flights change size (Serie A ran 18 until 2004/05,
   * Ligue 1 went back to 18 in 2023/24). Use this only as a fallback.
   */
  teams: number;
  /** Matches in a typical modern season: 2 * (teams - 1). */
  matches: number;
  /** Goals per team per game, long-run league average. Calibrates the sim. */
  avgGoals: number;
  /** Shown on the "perfect season" banner, e.g. "38-0". */
  perfect: string;
  accent: string;
}

const make = (
  id: LeagueId,
  sourceId: string,
  name: string,
  country: string,
  code: string,
  teams: number,
  avgGoals: number,
  accent: string,
): LeagueConfig => ({
  id,
  sourceId,
  name,
  country,
  code,
  teams,
  matches: 2 * (teams - 1),
  avgGoals,
  perfect: `${2 * (teams - 1)}-0`,
  accent,
});

export const LEAGUES: Record<LeagueId, LeagueConfig> = {
  eng: make("eng", "13", "English Top Flight", "England", "ENG", 20, 1.37, "#00ff87"),
  esp: make("esp", "53", "Spanish Top Flight", "Spain", "ESP", 20, 1.33, "#ff4b4b"),
  ger: make("ger", "19", "German Top Flight", "Germany", "GER", 18, 1.53, "#ff2d55"),
  ita: make("ita", "31", "Italian Top Flight", "Italy", "ITA", 20, 1.36, "#3b82f6"),
  fra: make("fra", "16", "French Top Flight", "France", "FRA", 20, 1.36, "#f5c518"),
};

export const LEAGUE_ORDER: LeagueId[] = ["eng", "esp", "ger", "ita", "fra"];

export const BY_SOURCE_ID: Record<string, LeagueConfig> = Object.fromEntries(
  LEAGUE_ORDER.map((id) => [LEAGUES[id]!.sourceId, LEAGUES[id]!]),
);
