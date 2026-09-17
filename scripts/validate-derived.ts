/**
 * Checks the per-slot rating reconstruction.
 *
 * Two separate things are measured, because conflating them is misleading:
 *
 *  1. RECONSTRUCTION ERROR — apply the fitted model to a snapshot's own
 *     attributes and compare against that same snapshot's real slot ratings.
 *     This is the number that says whether the method works. Only rows held
 *     out of the fit are used.
 *
 *  2. SNAPSHOT DRIFT — the two sources sample different in-season roster
 *     updates of the same game (launch vs late season), so their attributes
 *     genuinely differ for about a quarter of players. Reported for context;
 *     it is a property of the data, not an error in the model.
 *
 * Run with: bun scripts/validate-derived.ts
 */
import { existsSync } from "node:fs";
import { readCsv } from "./lib/csv.ts";
import { SLOTS, type Slot } from "../src/engine/types.ts";
import { ATTRIBUTES } from "../src/engine/attributes.ts";

const LEGACY = "data/raw/male_players_legacy.csv";
const MODEL_PATH = "src/data/slot-model.json";

for (const p of [LEGACY, MODEL_PATH]) {
  if (!existsSync(p)) { console.error(`Missing ${p}`); process.exit(1); }
}

const model: {
  attributes: string[];
  slots: Record<string, { weights: number[]; intercept: number }>;
} = await Bun.file(MODEL_PATH).json();

const LEGACY_ATTR: Record<string, string> = {
  crossing: "attacking_crossing", finishing: "attacking_finishing",
  heading_accuracy: "attacking_heading_accuracy", short_passing: "attacking_short_passing",
  volleys: "attacking_volleys", dribbling_stat: "skill_dribbling", curve: "skill_curve",
  fk_accuracy: "skill_fk_accuracy", long_passing: "skill_long_passing",
  ball_control: "skill_ball_control", acceleration: "movement_acceleration",
  sprint_speed: "movement_sprint_speed", agility: "movement_agility",
  reactions: "movement_reactions", balance: "movement_balance",
  shot_power: "power_shot_power", jumping: "power_jumping", stamina: "power_stamina",
  strength: "power_strength", long_shots: "power_long_shots",
  aggression: "mentality_aggression", interceptions: "mentality_interceptions",
  positioning: "mentality_positioning", vision: "mentality_vision",
  penalties: "mentality_penalties", composure: "mentality_composure",
  defensive_awareness: "defending_marking_awareness",
  standing_tackle: "defending_standing_tackle", sliding_tackle: "defending_sliding_tackle",
};

const SLOT_COLUMN: Record<Slot, string> = {
  GK: "gk", RB: "rb", CB: "cb", LB: "lb", RWB: "rwb", LWB: "lwb",
  CDM: "cdm", CM: "cm", CAM: "cam", RM: "rm", LM: "lm",
  RW: "rw", LW: "lw", CF: "cf", ST: "st",
};

function parseSlotRating(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = /^(\d+)\s*([+-])\s*(\d+)$/.exec(cell.trim());
  if (m) return Math.max(0, Math.min(99, Number(m[1]) + Number(m[3]) * (m[2] === "-" ? -1 : 1)));
  const n = Number(cell.trim());
  return Number.isFinite(n) && cell.trim() !== "" ? n : null;
}

console.log("Reading the legacy archive…\n");
const t = await readCsv(LEGACY);
const attrIdx = ATTRIBUTES.map((a) => t.index(LEGACY_ATTR[a]!));
const slotIdx = Object.fromEntries(SLOTS.map((s) => [s, t.index(SLOT_COLUMN[s])])) as Record<Slot, number>;
const posIdx = t.index("player_positions");
const idIdx = t.index("player_id");
const verIdx = t.index("fifa_version");

// ------------------------------------------------- 1. reconstruction error

let compared = 0;
let sumErr = 0;
let within1 = 0;
let within2 = 0;
const perSlot = new Map<Slot, { n: number; sum: number }>();

for (let i = 0; i < t.rows.length; i++) {
  if (i % 10 !== 0) continue; // the rows the fit held out
  const r = t.rows[i]!;
  if ((r[posIdx] ?? "").includes("GK")) continue;
  const attrs = attrIdx.map((j) => Number(r[j]) || 0);
  if (attrs.some((v) => v <= 0)) continue;

  for (const slot of SLOTS) {
    if (slot === "GK") continue;
    const actual = parseSlotRating(r[slotIdx[slot]]);
    if (actual === null || actual <= 0) continue;
    const m = model.slots[slot];
    if (!m) continue;
    let pred = m.intercept;
    for (let k = 0; k < m.weights.length; k++) pred += m.weights[k]! * attrs[k]!;
    const err = Math.abs(Math.round(Math.max(0, Math.min(99, pred))) - actual);
    compared++; sumErr += err;
    if (err <= 1) within1++;
    if (err <= 2) within2++;
    const agg = perSlot.get(slot) ?? { n: 0, sum: 0 };
    agg.n++; agg.sum += err;
    perSlot.set(slot, agg);
  }
}

const mae = sumErr / compared;
console.log("1. RECONSTRUCTION ERROR (held-out rows, same snapshot)");
console.log(`   compared            ${compared.toLocaleString()} slot ratings`);
console.log(`   mean absolute error ${mae.toFixed(3)}`);
console.log(`   within 1 point      ${((within1 / compared) * 100).toFixed(1)}%`);
console.log(`   within 2 points     ${((within2 / compared) * 100).toFixed(1)}%\n`);
console.log("   per slot:");
for (const slot of SLOTS) {
  const agg = perSlot.get(slot);
  if (agg) console.log(`     ${slot.padEnd(4)} ${(agg.sum / agg.n).toFixed(3)}`);
}

// ------------------------------------------------------- 2. snapshot drift

console.log("\n2. SNAPSHOT DRIFT (legacy launch roster vs archive's later roster)");
const legacyByKey = new Map<string, string[]>();
for (const r of t.rows) {
  const id = r[idIdx]?.trim();
  const v = r[verIdx]?.trim();
  if (id && v) legacyByKey.set(`${id}:${v}`, r);
}

let attrCompared = 0;
let attrDiffer = 0;
let attrSum = 0;
for (const version of ["15", "19", "23"]) {
  const file = `data/raw/eafc/fifa_${version}.csv`;
  if (!existsSync(file)) continue;
  const ea = await readCsv(file);
  const eaId = ea.index("sofifa_id");
  const eaAttr = ATTRIBUTES.map((a) => ea.index(a));
  for (const r of ea.rows) {
    const legacyRow = legacyByKey.get(`${r[eaId]?.trim()}:${version}`);
    if (!legacyRow) continue;
    for (let k = 0; k < ATTRIBUTES.length; k++) {
      const a = Number(r[eaAttr[k]!]) || 0;
      const b = Number(legacyRow[attrIdx[k]!]) || 0;
      if (a <= 0 || b <= 0) continue;
      attrCompared++;
      if (a !== b) { attrDiffer++; attrSum += Math.abs(a - b); }
    }
  }
}
console.log(`   attributes compared ${attrCompared.toLocaleString()}`);
console.log(`   differ              ${((attrDiffer / attrCompared) * 100).toFixed(1)}%`);
console.log(`   mean gap when differing ${(attrSum / Math.max(1, attrDiffer)).toFixed(2)} points`);
console.log("   (expected: the sources sample different in-season updates)\n");

console.log(mae < 1 ? "PASS — reconstruction is within a rating point." : "FAIL — reconstruction error too large.");
process.exit(mae < 1 ? 0 : 1);
