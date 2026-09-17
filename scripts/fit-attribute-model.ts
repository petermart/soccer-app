/**
 * Fills in attributes the older games never recorded.
 *
 * FIFA 07-10 have no volleys, curve, agility, balance, jumping, interceptions,
 * positioning, vision, penalties or sliding tackle; FIFA 11-16 have no
 * composure. Left as zeros they drag the slot-rating model down, which is why
 * 2006/07 squads were rating ~19 points below their true level.
 *
 * Every edition does record `overall` and the six face stats, so each missing
 * attribute is predicted from those, fitted on the modern editions where the
 * real value is present.
 *
 * Run with: bun scripts/fit-attribute-model.ts
 */
import { existsSync, writeFileSync } from "node:fs";
import { readCsv } from "./lib/csv.ts";
import { solveLeastSquares } from "./lib/leastsq.ts";
import { ATTRIBUTES } from "../src/engine/attributes.ts";
import { EDITIONS } from "./lib/seasons.ts";

const OUT = "src/data/attribute-model.json";

/** Present in every edition, so these are the predictors. */
const BASE = ["overall", "pace", "shooting", "passing", "dribbling", "defending", "physical"] as const;

/** Editions with a complete attribute set, used for training. */
const COMPLETE = EDITIONS.filter((e) => {
  const n = Number(e.title.replace(/\D/g, ""));
  return e.title.startsWith("EA FC") || n >= 17;
});

console.log(`Training on ${COMPLETE.length} complete editions ` +
  `(${COMPLETE[0]!.title}-${COMPLETE.at(-1)!.title}).\n`);

interface Sample { base: number[]; attrs: number[]; isKeeper: boolean }
const samples: Sample[] = [];

for (const edition of COMPLETE) {
  if (!existsSync(edition.file)) continue;
  const t = await readCsv(edition.file);
  const baseIdx = BASE.map((b) => t.index(b));
  const attrIdx = ATTRIBUTES.map((a) => t.index(a));
  const posIdx = t.index("positions");

  for (const r of t.rows) {
    const isKeeper = (r[posIdx] ?? "").includes("GK");
    const base = baseIdx.map((i) => Number(r[i]) || 0);
    if (base.some((v) => v <= 0)) continue;
    const attrs = attrIdx.map((i) => Number(r[i]) || 0);
    if (attrs.some((v) => v <= 0)) continue;
    samples.push({ base, attrs, isKeeper });
  }
}

// Keepers have a completely different attribute profile, so they get their
// own fit rather than polluting the outfield one.
const groups = {
  outfield: samples.filter((s) => !s.isKeeper),
  keeper: samples.filter((s) => s.isKeeper),
};
console.log(`outfield samples ${groups.outfield.length.toLocaleString()}, ` +
  `keeper samples ${groups.keeper.length.toLocaleString()}\n`);

const model: Record<string, Record<string, { weights: number[]; intercept: number }>> = {
  outfield: {}, keeper: {},
};

for (const [groupName, group] of Object.entries(groups)) {
  if (group.length < 1000) { console.log(`${groupName}: too few samples, skipped`); continue; }
  const train = group.filter((_, i) => i % 10 !== 0);
  const test = group.filter((_, i) => i % 10 === 0);

  console.log(`${groupName}:`);
  console.log("  attribute              MAE   sd(actual)");
  for (let k = 0; k < ATTRIBUTES.length; k++) {
    const rows = train.map((s) => s.base);
    const targets = train.map((s) => s.attrs[k]!);
    const beta = solveLeastSquares(rows, targets, BASE.length);
    const weights = beta.slice(0, BASE.length);
    const intercept = beta[BASE.length]!;
    model[groupName]![ATTRIBUTES[k]!] = { weights, intercept };

    let sum = 0;
    let mean = 0;
    for (const s of test) mean += s.attrs[k]!;
    mean /= test.length;
    let variance = 0;
    for (const s of test) {
      let pred = intercept;
      for (let j = 0; j < weights.length; j++) pred += weights[j]! * s.base[j]!;
      sum += Math.abs(pred - s.attrs[k]!);
      variance += (s.attrs[k]! - mean) ** 2;
    }
    const sd = Math.sqrt(variance / test.length);
    console.log(
      `  ${ATTRIBUTES[k]!.padEnd(20)} ${(sum / test.length).toFixed(2).padStart(6)}` +
      `   ${sd.toFixed(2).padStart(6)}`,
    );
  }
  console.log();
}

writeFileSync(OUT, JSON.stringify({ base: BASE, attributes: ATTRIBUTES, groups: model }));
console.log(`Wrote ${OUT}`);
