/**
 * Reconciles club names between the two sources.
 *
 * The fixture source (football-data.co.uk) tells us which clubs were in each
 * top flight in each season; the ratings source (the EA dataset) tells us who
 * played for them. They spell club names differently, so every club-season has
 * to be matched across the two.
 *
 * `bun run build:data -- --report` prints anything still unmatched, so the
 * alias table below is grown from evidence rather than guesswork.
 */

/** Strips accents, punctuation and the club-type words the sources disagree on. */
export function normalizeClub(raw: string): string {
  const base = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Club-type tokens and founding years that one source prints and the other omits.
  const NOISE = new Set([
    "fc", "afc", "cf", "ac", "as", "ss", "ssc", "us", "sc", "cd", "ud", "rcd",
    "rc", "sd", "ca", "cp", "aj", "sm", "rco", "ogc", "sco", "esct", "fco",
    "calcio", "futbol", "football", "club", "de", "del", "the", "ev", "ev.",
    "vfb", "vfl", "tsg", "tsv", "fsv", "bsc", "sv", "spvgg", "kgaa", "dsc", "09",
    "1899", "1900", "1904", "1905", "1909", "1846", "1848", "1860", "1893",
    "1907", "1913", "1919", "04", "05", "96", "98", "1", "2",
  ]);

  const tokens = base.split(" ").filter((t) => t && !NOISE.has(t));
  return (tokens.length ? tokens : base.split(" ").filter(Boolean)).join(" ");
}

/**
 * Fixture-source name -> ratings-source name, for clubs that normalisation
 * cannot reconcile. Both sides are matched after normalisation.
 */
export const CLUB_ALIASES: Record<string, string> = {
  // England
  "man united": "manchester united",
  "man city": "manchester city",
  "nott m forest": "nottingham forest",
  "sheffield weds": "sheffield wednesday",
  "wolves": "wolverhampton wanderers",
  "qpr": "queens park rangers",
  "west brom": "west bromwich albion",
  "newcastle": "newcastle united",
  "tottenham": "tottenham hotspur",
  "blackburn": "blackburn rovers",
  "bolton": "bolton wanderers",
  "charlton": "charlton athletic",
  "wigan": "wigan athletic",
  "birmingham": "birmingham city",
  "stoke": "stoke city",
  "swansea": "swansea city",
  "hull": "hull city",
  "cardiff": "cardiff city",
  "norwich": "norwich city",
  "leicester": "leicester city",
  "huddersfield": "huddersfield town",
  "brighton": "brighton and hove albion",
  "leeds": "leeds united",
  "west ham": "west ham united",
  "luton": "luton town",
  "ipswich": "ipswich town",
  "derby": "derby county",
  "middlesbrough": "middlesbrough",
  "bournemouth": "bournemouth",
  "sheffield united": "sheffield united",

  // Spain
  "ath madrid": "atletico madrid",
  "ath bilbao": "athletic bilbao",
  "espanol": "espanyol",
  "sociedad": "real sociedad",
  "betis": "real betis",
  "celta": "celta vigo",
  "la coruna": "deportivo la coruna",
  "vallecano": "rayo vallecano",
  "sp gijon": "sporting gijon",
  "santander": "racing santander",
  "recreativo": "recreativo huelva",
  "almeria": "almeria",
  "malaga": "malaga",
  "zaragoza": "real zaragoza",
  "valladolid": "real valladolid",
  "mallorca": "mallorca",
  "vila real": "villarreal",
  "alaves": "deportivo alaves",
  "hercules": "hercules",
  "granada": "granada",
  "eibar": "eibar",
  "leganes": "leganes",
  "girona": "girona",
  "cadiz": "cadiz",
  "elche": "elche",
  "osasuna": "osasuna",
  "getafe": "getafe",
  "levante": "levante",
  "barcelona": "barcelona",
  "sevilla": "sevilla",
  "valencia": "valencia",
  "madrid": "real madrid",

  // Germany
  "bayern munich": "bayern munchen",
  "dortmund": "borussia dortmund",
  "m gladbach": "borussia monchengladbach",
  "leverkusen": "bayer leverkusen",
  "schalke 04": "schalke",
  "ein frankfurt": "eintracht frankfurt",
  "hertha": "hertha bsc",
  "werder bremen": "werder bremen",
  "hamburg": "hamburger sv",
  "stuttgart": "vfb stuttgart",
  "wolfsburg": "vfl wolfsburg",
  "hoffenheim": "tsg hoffenheim",
  "mainz": "mainz",
  "augsburg": "augsburg",
  "freiburg": "sc freiburg",
  "hannover": "hannover",
  "nurnberg": "nurnberg",
  "kaiserslautern": "kaiserslautern",
  "bochum": "vfl bochum",
  "cottbus": "energie cottbus",
  "duisburg": "msv duisburg",
  "karlsruhe": "karlsruher sc",
  "fortuna dusseldorf": "fortuna dusseldorf",
  "greuther furth": "greuther furth",
  "braunschweig": "eintracht braunschweig",
  "paderborn": "paderborn",
  "darmstadt": "darmstadt",
  "ingolstadt": "ingolstadt",
  "rb leipzig": "rb leipzig",
  "union berlin": "union berlin",
  "heidenheim": "heidenheim",
  "st pauli": "st pauli",
  "holstein kiel": "holstein kiel",
  "koln": "koln",
  "hansa rostock": "hansa rostock",

  // Italy
  "inter": "inter",
  "milan": "milan",
  "roma": "roma",
  "lazio": "lazio",
  "napoli": "napoli",
  "juventus": "juventus",
  "fiorentina": "fiorentina",
  "atalanta": "atalanta",
  "sampdoria": "sampdoria",
  "torino": "torino",
  "genoa": "genoa",
  "udinese": "udinese",
  "bologna": "bologna",
  "cagliari": "cagliari",
  "sassuolo": "sassuolo",
  "verona": "hellas verona",
  "chievo": "chievo verona",
  "parma": "parma",
  "palermo": "palermo",
  "siena": "siena",
  "catania": "catania",
  "livorno": "livorno",
  "reggina": "reggina",
  "ascoli": "ascoli",
  "empoli": "empoli",
  "brescia": "brescia",
  "lecce": "lecce",
  "spezia": "spezia",
  "salernitana": "salernitana",
  "cremonese": "cremonese",
  "monza": "monza",
  "venezia": "venezia",
  "benevento": "benevento",
  "crotone": "crotone",
  "frosinone": "frosinone",
  "spal": "spal",
  "carpi": "carpi",
  "cesena": "cesena",
  "novara": "novara",
  "bari": "bari",
  "como": "como",
  "pisa": "pisa",

  // France
  "paris sg": "paris saint germain",
  "st etienne": "saint etienne",
  "lyon": "olympique lyonnais",
  "marseille": "olympique marseille",
  "bordeaux": "girondins bordeaux",
  "lille": "lille",
  "monaco": "monaco",
  "nice": "nice",
  "nantes": "nantes",
  "toulouse": "toulouse",
  "montpellier": "montpellier",
  "strasbourg": "strasbourg",
  "lens": "lens",
  "angers": "angers",
  "metz": "metz",
  "auxerre": "auxerre",
  "lorient": "lorient",
  "sochaux": "sochaux",
  "valenciennes": "valenciennes",
  "le mans": "le mans",
  "grenoble": "grenoble",
  "boulogne": "boulogne",
  "ajaccio": "ac ajaccio",
  "gazelec ajaccio": "gazelec ajaccio",
  "bastia": "bastia",
  "dijon": "dijon",
  "amiens": "amiens",
  "nimes": "nimes",
  "clermont": "clermont foot",
  "le havre": "le havre",
  "paris fc": "paris fc",

  // Clubs the ratings source prints with a prefix the fixture source drops.
  "rennes": "stade rennais",
  "reims": "stade reims",
  "brest": "stade brestois 29",
  "caen": "stade malherbe caen",
  "guingamp": "en avant guingamp",
  "troyes": "estac troyes",
  "pescara": "delfino pescara 1936",
  "evian thonon gaillard": "thonon evian",
  "arles": "arles avignon",
  "sedan": "cs sedan ardennes",
  "aachen": "alemannia aachen",
  "messina": "acr messina",
  "murcia": "real murcia",
  "oviedo": "real oviedo",
  "bielefeld": "arminia bielefeld",
};

/**
 * Resolves a fixture-source club name to a ratings-source club name.
 *
 * Tries, in order: the alias table, an exact normalised match, and finally a
 * containment match (one name being a prefix of the other), which catches
 * "Arsenal" against "Arsenal FC" without needing an entry per club.
 */
export function resolveClub(
  fixtureName: string,
  ratingClubs: Map<string, string>,
): string | null {
  const norm = normalizeClub(fixtureName);

  const aliased = CLUB_ALIASES[norm];
  if (aliased) {
    const hit = ratingClubs.get(aliased);
    if (hit) return hit;
  }

  const exact = ratingClubs.get(norm);
  if (exact) return exact;

  const target = aliased ?? norm;
  // Containment, longest candidate first so "real madrid" beats "madrid".
  let best: { name: string; len: number } | null = null;
  for (const [candidate, original] of ratingClubs) {
    if (candidate === target) return original;
    if (candidate.startsWith(`${target} `) || target.startsWith(`${candidate} `)) {
      const len = Math.min(candidate.length, target.length);
      if (!best || len > best.len) best = { name: original, len };
    }
  }
  return best?.name ?? null;
}

/** Builds the normalised lookup the resolver searches. */
export function indexClubs(names: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of names) {
    const key = normalizeClub(n);
    // Prefer the first spelling seen; they are all the same club.
    if (!map.has(key)) map.set(key, n);
  }
  return map;
}
