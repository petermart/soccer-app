/**
 * Learns how EA turns raw attributes into a per-slot rating.
 *
 * The FIFA 15-23 archive carries BOTH the 29 outfield attributes and the real
 * per-slot ratings (ls, st, cb, gk, …). The historical EA FC dataset carries
 * the attributes but not the slot ratings, so we fit the mapping here once and
 * apply it to every season.
 *
 * EA computes these as a weighted sum of attributes, so a linear model should
 * fit almost exactly. The script prints mean absolute error on held-out rows
 * so that claim is checked rather than assumed.
 *
 * Run with: bun scripts/fit-slot-model.ts
 */
import { existsSync, writeFileSync } from "node:fs";
import { SLOTS, type Slot } from "../src/engine/types.ts";
import { ATTRIBUTES, type AttributeName } from "../src/engine/attributes.ts";

const RAW = "data/raw/male_players_legacy.csv";
const OUT = "src/data/slot-model.json";

if (!existsSync(RAW)) {
  console.error(`Missing ${RAW}. Run \`bun run fetch:data\` first.`);
  process.exit(1);
}

/** Legacy CSV column backing each shared attribute name. */
const LEGACY_COLUMN: Record<AttributeName, string> = {
  crossing: "attacking_crossing",
  finishing: "attacking_finishing",
  heading_accuracy: "attacking_heading_accuracy",
  short_passing: "attacking_short_passing",
  volleys: "attacking_volleys",
  dribbling_stat: "skill_dribbling",
  curve: "skill_curve",
  fk_accuracy: "skill_fk_accuracy",
  long_passing: "skill_long_passing",
  ball_control: "skill_ball_control",
  acceleration: "movement_acceleration",
  sprint_speed: "movement_sprint_speed",
  agility: "movement_agility",
  reactions: "movement_reactions",
  balance: "movement_balance",
  shot_power: "power_shot_power",
  jumping: "power_jumping",
  stamina: "power_stamina",
  strength: "power_strength",
  long_shots: "power_long_shots",
  aggression: "mentality_aggression",
  interceptions: "mentality_interceptions",
  positioning: "mentality_positioning",
  vision: "mentality_vision",
  penalties: "mentality_penalties",
  composure: "mentality_composure",
  defensive_awareness: "defending_marking_awareness",
  standing_tackle: "defending_standing_tackle",
  sliding_tackle: "defending_sliding_tackle",
};

const SLOT_COLUMN: Record<Slot, string> = {
  GK: "gk", RB: "rb", CB: "cb", LB: "lb", RWB: "rwb", LWB: "lwb",
  CDM: "cdm", CM: "cm", CAM: "cam", RM: "rm", LM: "lm",
  RW: "rw", LW: "lw", CF: "cf", ST: "st",
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSlotRating(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = /^(\d+)\s*([+-])\s*(\d+)$/.exec(cell.trim());
  if (m) return Math.max(0, Math.min(99, Number(m[1]) + Number(m[3]) * (m[2] === "-" ? -1 : 1)));
  const n = Number(cell.trim());
  return Number.isFinite(n) && cell.trim() !== "" ? n : null;
}

/** Solves (XᵀX)β = Xᵀy by Gaussian elimination with partial pivoting. */
function solveLeastSquares(rows: number[][], targets: number[], features: number): number[] {
  const n = features + 1; // + intercept
  const ata = Array.from({ length: n }, () => new Float64Array(n));
  const aty = new Float64Array(n);

  for (let r = 0; r < rows.length; r++) {
    const x = rows[r]!;
    const y = targets[r]!;
    for (let i = 0; i < n; i++) {
      const xi = i === features ? 1 : x[i]!;
      aty[i]! += xi * y;
      for (let j = i; j < n; j++) {
        const xj = j === features ? 1 : x[j]!;
        ata[i]![j]! += xi * xj;
      }
    }
  }
  // Mirror the symmetric half, and ridge-regularise so collinear
  // attributes cannot make the system singular.
  for (let i = 0; i < n; i++) {
    ata[i]![i]! += 1e-6;
    for (let j = 0; j < i; j++) ata[i]![j]! = ata[j]![i]!;
  }

  const m = Array.from({ length: n }, (_, i) => [...ata[i]!, aty[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pv = m[col]![col]!;
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / pv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return Array.from({ length: n }, (_, i) => {
    const pv = m[i]![i]!;
    return Math.abs(pv) < 1e-12 ? 0 : m[i]![n]! / pv;
  });
}

console.log("Reading the legacy archive…");
const text = await Bun.file(RAW).text();
const lines = text.split("\n");
const header = splitCsvLine(lines[0]!);
const idx = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Missing column ${name}`);
  return i;
};

const attrIdx = ATTRIBUTES.map((a) => idx(LEGACY_COLUMN[a]));
const slotIdx = Object.fromEntries(SLOTS.map((s) => [s, idx(SLOT_COLUMN[s])])) as Record<Slot, number>;
const overallIdx = idx("overall");
const positionsIdx = idx("player_positions");

// Collect one sample per row: attributes plus every slot rating present.
const samples: { attrs: number[]; slots: Partial<Record<Slot, number>> }[] = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const f = splitCsvLine(line);
  if (f.length < header.length) continue;
  if ((f[positionsIdx] ?? "").includes("GK")) continue; // keepers have no outfield ratings

  const attrs = attrIdx.map((j) => Number(f[j]) || 0);
  if (attrs.some((v) => v <= 0)) continue; // incomplete row

  const slots: Partial<Record<Slot, number>> = {};
  for (const s of SLOTS) {
    if (s === "GK") continue;
    const v = parseSlotRating(f[slotIdx[s]]);
    if (v !== null && v > 0) slots[s] = v;
  }
  if (Object.keys(slots).length === 0) continue;
  samples.push({ attrs, slots });
}

console.log(`Fitting on ${samples.length.toLocaleString()} outfield player-seasons.\n`);

// Hold out every 10th row so the error figure is honest.
const train = samples.filter((_, i) => i % 10 !== 0);
const test = samples.filter((_, i) => i % 10 === 0);

const model: Record<string, { weights: number[]; intercept: number }> = {};
console.log("slot   n        MAE   within±1   within±2");
console.log("----------------------------------------------");

for (const slot of SLOTS) {
  if (slot === "GK") continue;
  const rows: number[][] = [];
  const targets: number[] = [];
  for (const s of train) {
    const v = s.slots[slot];
    if (v === undefined) continue;
    rows.push(s.attrs);
    targets.push(v);
  }
  if (rows.length < 500) { console.log(`${slot}: too few samples`); continue; }

  const beta = solveLeastSquares(rows, targets, ATTRIBUTES.length);
  const weights = beta.slice(0, ATTRIBUTES.length);
  const intercept = beta[ATTRIBUTES.length]!;
  model[slot] = { weights, intercept };

  let sum = 0;
  let n = 0;
  let w1 = 0;
  let w2 = 0;
  for (const s of test) {
    const actual = s.slots[slot];
    if (actual === undefined) continue;
    let pred = intercept;
    for (let k = 0; k < weights.length; k++) pred += weights[k]! * s.attrs[k]!;
    const err = Math.abs(Math.round(pred) - actual);
    sum += err; n++;
    if (err <= 1) w1++;
    if (err <= 2) w2++;
  }
  console.log(
    `${slot.padEnd(5)} ${String(n).padStart(7)}  ${(sum / n).toFixed(3).padStart(6)}` +
    `   ${((w1 / n) * 100).toFixed(1).padStart(5)}%    ${((w2 / n) * 100).toFixed(1).padStart(5)}%`,
  );
}

writeFileSync(OUT, JSON.stringify({ attributes: ATTRIBUTES, slots: model }));
console.log(`\nWrote ${OUT}`);
