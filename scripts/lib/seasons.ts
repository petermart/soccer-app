import type { LeagueId } from "../../src/engine/leagues.ts";

/** Which EA title shipped for which season, and where its file lives. */
export interface Edition {
  /** e.g. "2006/07" */
  season: string;
  /** e.g. "FIFA 07" — matches the dataset's game_version column. */
  title: string;
  file: string;
  /** football-data.co.uk season code, e.g. "0607". */
  code: string;
}

export const EDITIONS: Edition[] = [
  ...Array.from({ length: 17 }, (_, i) => {
    const v = 7 + i; // FIFA 07 .. FIFA 23
    const vv = String(v).padStart(2, "0");
    return {
      season: `${1999 + v}/${vv}`,
      title: `FIFA ${vv}`,
      file: `data/raw/eafc/fifa_${vv}.csv`,
      code: `${String(v - 1).padStart(2, "0")}${vv}`,
    };
  }),
  { season: "2023/24", title: "EA FC 24", file: "data/raw/eafc/fc_24.csv", code: "2324" },
  { season: "2024/25", title: "EA FC 25", file: "data/raw/eafc/fc_25.csv", code: "2425" },
  { season: "2025/26", title: "EA FC 26", file: "data/raw/eafc/fc_26.csv", code: "2526" },
];

/** football-data.co.uk division code per league. */
export const DIVISION: Record<LeagueId, string> = {
  eng: "E0", esp: "SP1", ger: "D1", ita: "I1", fra: "F1",
};
