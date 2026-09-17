/**
 * Club-name normalisation shared by every source adapter.
 *
 * Match rates are reported by `bun scripts/build-data.ts --report`, so the
 * alias table below is grown from evidence rather than guesswork.
 */

/** Strips accents, punctuation, and the club-type words every league adds. */
export function normalizeClub(raw: string): string {
  let s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ");

  // Club-type tokens that one source includes and another omits.
  const noise = [
    "fc", "afc", "cf", "ac", "as", "ss", "ssc", "us", "usl", "sc", "bc", "cd",
    "ud", "rcd", "rc", "sd", "sad", "ca", "cp", "rq", "aj", "og", "sm", "rco",
    "calcio", "futbol", "football", "club", "de", "di", "del", "the",
    "ev", "vfb", "vfl", "tsg", "tsv", "fsv", "bsc", "sv", "spvgg", "borussia",
    "deportivo", "real", "athletic", "atletico", "sporting", "societa",
    "associazione", "unione", "olympique", "stade", "association", "racing",
    "1899", "1900", "1904", "1905", "1909", "1846", "1848", "1860", "05", "04", "1", "2",
  ];
  const tokens = s.split(/\s+/).filter(Boolean).filter((t) => !noise.includes(t));
  // If stripping removed everything, fall back to the un-stripped form.
  s = (tokens.length ? tokens : s.split(/\s+/).filter(Boolean)).join(" ");
  return s.trim();
}

/**
 * Short names used by the fixture source that normalisation alone cannot
 * reconcile with the ratings source. Keys and values are both normalised.
 */
export const CLUB_ALIASES: Record<string, string> = {};
