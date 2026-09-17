import type { Slot } from "./types.ts";

export interface Formation {
  name: string;
  /** Slots in draft order, GK first. */
  slots: Slot[];
  /** Pitch position per slot, 0-100 left-to-right and 0-100 back-to-front. */
  coords: [number, number][];
  blurb: string;
}

/** Coordinates are authored back-to-front so the pitch renders naturally. */
export const FORMATIONS: Record<string, Formation> = {
  "4-3-3": {
    name: "4-3-3",
    slots: ["GK", "RB", "CB", "CB", "LB", "CM", "CM", "CM", "RW", "ST", "LW"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [76, 52], [50, 48], [24, 52], [82, 80], [50, 86], [18, 80]],
    blurb: "Attacking with width. Three forwards create constant threat.",
  },
  "4-4-2": {
    name: "4-4-2",
    slots: ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "ST", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [85, 54], [61, 50], [39, 50], [15, 54], [62, 84], [38, 84]],
    blurb: "The classic. Two banks of four and a strike partnership.",
  },
  "4-2-3-1": {
    name: "4-2-3-1",
    slots: ["GK", "RB", "CB", "CB", "LB", "CDM", "CDM", "RM", "CAM", "LM", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [62, 42], [38, 42], [82, 66], [50, 66], [18, 66], [50, 88]],
    blurb: "Modern and balanced. A double pivot shields a creative three.",
  },
  "4-5-1": {
    name: "4-5-1",
    slots: ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CDM", "CM", "LM", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [88, 56], [66, 54], [50, 44], [34, 54], [12, 56], [50, 86]],
    blurb: "Midfield overload. Hard to play through, light up top.",
  },
  "3-4-3": {
    name: "3-4-3",
    slots: ["GK", "CB", "CB", "CB", "RWB", "CM", "CM", "LWB", "RW", "ST", "LW"],
    coords: [[50, 6], [72, 22], [50, 20], [28, 22], [90, 50], [60, 48], [40, 48], [10, 50], [82, 80], [50, 86], [18, 80]],
    blurb: "Bold and expansive. Wing-backs do the running of two players.",
  },
  "3-5-2": {
    name: "3-5-2",
    slots: ["GK", "CB", "CB", "CB", "RWB", "CM", "CDM", "CM", "LWB", "ST", "ST"],
    coords: [[50, 6], [72, 22], [50, 20], [28, 22], [90, 52], [66, 52], [50, 42], [34, 52], [10, 52], [62, 84], [38, 84]],
    blurb: "Control the middle, attack from deep, two up front.",
  },
  "5-4-1": {
    name: "5-4-1",
    slots: ["GK", "RWB", "CB", "CB", "CB", "LWB", "RM", "CM", "CM", "LM", "ST"],
    coords: [[50, 6], [90, 30], [72, 22], [50, 20], [28, 22], [10, 30], [82, 56], [61, 52], [39, 52], [18, 56], [50, 86]],
    blurb: "Defensive block. Concede space, punish on the counter.",
  },
  "4-1-2-1-2": {
    name: "4-1-2-1-2",
    slots: ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CM", "CAM", "ST", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [50, 40], [72, 54], [28, 54], [50, 68], [62, 86], [38, 86]],
    blurb: "The diamond. Narrow, technical, overloads the centre.",
  },
  "4-4-1-1": {
    name: "4-4-1-1",
    slots: ["GK", "RB", "CB", "CB", "LB", "RM", "CM", "CM", "LM", "CAM", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [85, 54], [61, 50], [39, 50], [15, 54], [50, 72], [50, 88]],
    blurb: "A shadow striker links midfield to the lone forward.",
  },
  "5-3-2": {
    name: "5-3-2",
    slots: ["GK", "RWB", "CB", "CB", "CB", "LWB", "CM", "CDM", "CM", "ST", "ST"],
    coords: [[50, 6], [90, 30], [72, 22], [50, 20], [28, 22], [10, 30], [70, 54], [50, 46], [30, 54], [62, 84], [38, 84]],
    blurb: "Back five, compact middle, two to break away.",
  },
  "3-4-1-2": {
    name: "3-4-1-2",
    slots: ["GK", "CB", "CB", "CB", "RWB", "CM", "CM", "LWB", "CAM", "ST", "ST"],
    coords: [[50, 6], [72, 22], [50, 20], [28, 22], [90, 50], [60, 48], [40, 48], [10, 50], [50, 68], [62, 86], [38, 86]],
    blurb: "Wing-backs stretch it, a ten threads it, two finish it.",
  },
  "4-2-2-2": {
    name: "4-2-2-2",
    slots: ["GK", "RB", "CB", "CB", "LB", "CDM", "CDM", "CAM", "CAM", "ST", "ST"],
    coords: [[50, 6], [85, 26], [61, 22], [39, 22], [15, 26], [62, 42], [38, 42], [70, 66], [30, 66], [62, 86], [38, 86]],
    blurb: "Two pivots, two tens, two strikers. Chaos, by design.",
  },
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

export interface SquadSlot {
  /** Index within the formation, 0-10. */
  index: number;
  slot: Slot;
  coords: [number, number];
}

export function slotsOf(formationName: string): SquadSlot[] {
  const f = FORMATIONS[formationName];
  if (!f) throw new Error(`Unknown formation: ${formationName}`);
  return f.slots.map((slot, index) => ({ index, slot, coords: f.coords[index]! }));
}
