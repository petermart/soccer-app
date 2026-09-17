# Perfect XI

A spin-and-draft football game with a full season simulator, for Europe's big five
leagues: **England, Spain, Germany, Italy and France**, across **20 seasons (2006/07 –
2025/26)**.

Spin for a real club from a real season, draft one player from that squad, fill your
eleven, then take the weakest club's place in a real league season and play out every
game. Chase the perfect record — `38-0`, or `34-0` in the years a league ran 18 clubs.

Built with [Bun](https://bun.sh) and React. Everything runs locally; no external services
at runtime.

## Running it

The built league archives are committed, so a fresh clone runs with no data step:

```bash
bun install
bun run dev          # http://localhost:3838
```

`bun test` runs the engine suite (26 tests, no network).

### Rebuilding the data

Only needed when adding a season or changing how archives are built. The raw sources are
gitignored and fetched on demand.

```bash
bun run fetch:data   # ~100MB: ratings + fixtures
bun run build:data   # rewrites src/data/*.json
```

The two fitted models in `src/data/` are committed, so that is enough. To refit them from
scratch you also need the FIFA 15-23 archive that carries EA's real per-slot ratings:

```bash
bun run fetch:data -- --legacy    # adds a ~91MB file
bun scripts/fit-attribute-model.ts
bun scripts/fit-slot-model.ts
bun scripts/validate-derived.ts   # reconstruction error + snapshot drift
bun run build:data
```

### Deploying

Railway, from the repo root:

```bash
railway link                      # pick the perfect-xi project
railway up
```

`railway.json` holds the build config. Nothing secret lives in the repo — Railway's token
and project link are in your global `~/.railway/config.json`, keyed by directory, so the
link has to be re-made on each machine.

## How a run works

1. **Pick a competition.** One league at a time.
2. **Pick the season you play.** Defaults to the most recent. The clubs you face are that
   season's real field at their real strength, and the league is as big as it really was
   that year.
3. **Draft.** Spin, take a player, slot them in. The wheel only lands on club-seasons that
   can still fill an open slot, and no player can be drafted twice.
4. **Simulate.** You take the place of the weakest club that season, play everyone home
   and away, and get a full table, every result, and a scorers list.

Your players can come from any season in the era range — a 2008/09 Werder Bremen defender
can line up beside a 2024/25 Bayern midfielder. Only the opposition is pinned to one season.

### Options

| Option | Effect |
| --- | --- |
| Formation | 12 of them, from 4-3-3 to 4-2-2-2 |
| Difficulty | Easy 3 re-rolls, Normal 1, Hard 0 and ratings hidden |
| Draft mode | Squad-first (spin then choose a slot) or position-first |
| Rating lens | **Season** rates players as they were that year; **Prime** uses their career best |
| Era | Restricts which club-seasons the wheel can land on |
| Gaffers | A manager archetype that tilts attack/defence for the season |
| European nights | Finish top seven and play a knockout run against the best of the continent |
| January window | One random mid-season event. Half the deck helps, half hurts |

## The data

Two public sources are compiled into five league archives.

| Source | Provides | Span |
| --- | --- | --- |
| [mzafram2001/ea-fc](https://github.com/mzafram2001/ea-fc) (MIT) | player ratings and 29 attributes, every league | FIFA 07 – EA FC 26 |
| [football-data.co.uk](https://www.football-data.co.uk/) | which clubs were actually in each top flight, and how many | 2000/01 – 2025/26 |

| League | Seasons | Club-seasons | Player-seasons | Span |
| --- | --- | --- | --- | --- |
| England | 20 | 400 | 12,389 | 2006/07–2025/26 |
| Spain | 20 | 400 | 12,058 | 2006/07–2025/26 |
| Germany | 20 | 360 | 10,467 | 2006/07–2025/26 |
| Italy | 20 | 400 | 11,002 | 2006/07–2025/26 |
| France | 20 | 393 | 11,219 | 2006/07–2025/26 |

**1,953 club-seasons, 57,135 player-seasons.**

### Why the archive starts at 2006/07

Player ratings only exist in structured form back to FIFA 07. Both sites that hold
earlier data (SoFIFA from FIFA 07, FIFA Index from FIFA 05) sit behind Cloudflare and
refuse scripted requests, and no rating data of any kind exists for 2000/01–2003/04.
Fixture and result data goes back to 2000/01, but without ratings there is nothing to
draft, so the archive is capped at what can be sourced honestly.

### Two problems the build had to solve

**Clubs are named differently by the two sources** — "Man United" against "Manchester
United", "Reims" against "Stade de Reims". A normaliser plus an evidence-driven alias
table resolves **1,953 of 1,954** club-seasons (99.9%). The one miss is Arles-Avignon in
2010/11, who are genuinely absent from FIFA 11, so Ligue 1 that season runs 19 clubs.
Run `bun scripts/match-report.ts` to see the current match rate.

**Older games did not record every attribute.** FIFA 07–10 have no volleys, curve,
agility, balance, jumping, interceptions, positioning, vision, penalties or sliding
tackle; FIFA 11–16 have no composure. Left as zeros, 2006/07 squads rated ~19 points
below their true level. Every edition does record `overall` and the six face stats, so
missing attributes are predicted from those by a model fitted on the modern editions
(`bun scripts/fit-attribute-model.ts`). After imputation, derived club ratings track raw
overalls evenly across all 20 seasons.

### Reconstructing per-slot ratings

The historical dataset has attributes but not EA's per-position ratings, which is what
makes playing someone out of position cost the right amount. Those are reconstructed by a
linear model fitted on the FIFA 15–23 archive, which carries both
(`bun scripts/fit-slot-model.ts`).

`bun scripts/validate-derived.ts` measures it on held-out rows:

```
mean absolute error 0.414
within 1 point      98.6%
within 2 points     99.7%
```

The same script also reports **snapshot drift**: the two sources sample different
in-season roster updates of the same game, so about 25% of attributes genuinely differ
between them, by ~4 points on average. That is a property of the data, not model error —
worth knowing before comparing a player here against some other FIFA dataset.

## How the simulation works

Everything is seeded, so a run is reproducible from its seed alone.

**Rating a side.** Each player carries a per-slot rating, so playing someone out of
position costs what it should. The eleven are grouped into four lines; each line uses a
mean that leans on its weakest member, and a badly unbalanced side takes a penalty.
Computer opposition is rated by the same function applied to the XI that club would
actually field, so the two are directly comparable.

**Playing a match.** A rating edge becomes expected goals
(`base × e^(0.62 × edge/10) × venue`), and both scorelines are drawn from a Poisson.
Every club plays every other home and away via the circle method, so the whole table is
real rather than decorative.

**Calibration.** `bun scripts/calibrate.ts` checks the model against reality. Simulated
finishes track real ones closely — 2025/26 PSG averages 78 points from 34 games, Bayern
70, and bottom clubs land around 25–30. A hand-picked dream XI wins the title ~96% of the
time and goes unbeaten ~3%; a perfect season stays rare enough to be worth chasing.

One honest limitation: the model rates *squads*, not results. A club that wildly
overperformed its squad in real life will place lower here than it really finished.

## Layout

```
src/engine/    pure game logic, no React
  leagues.ts     the five competitions
  types.ts       players, club-seasons, slots
  attributes.ts  the 29 shared attributes
  rng.ts         seeded PRNG, Poisson, shuffle
  formations.ts  12 formations and pitch coordinates
  ratings.ts     per-slot ratings, line strength, balance
  bestxi.ts      strongest legal XI for a squad
  draft.ts       spin/eligibility/re-roll state machine
  simulate.ts    fixtures, matches, table, scorers
  extras.ts      gaffers, January events, European run
src/ui/        React screens
src/data/      generated archives and fitted models (committed)
scripts/
  fetch-data.ts          downloads both raw sources
  fit-attribute-model.ts imputes attributes the old games lack
  fit-slot-model.ts      learns per-slot ratings from attributes
  build-data.ts          compiles the five archives
  match-report.ts        club-name match diagnostic
  validate-derived.ts    reconstruction error and snapshot drift
  calibrate.ts           sim against real league tables
tests/         engine suite
```

## Legal

Independent, fan-made, and not affiliated with or endorsed by any club, competition,
league, player association or governing body. Club and player names, ratings and
statistics are used descriptively. No crests, kits, photographs or other official
branding are included.
