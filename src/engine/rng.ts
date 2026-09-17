/**
 * Seeded randomness. Every spin, match and scoreline comes from here so a
 * run can be replayed, shared and verified from its seed alone.
 */

/** Deterministic 32-bit hash, used to turn a string seed into a number. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = (typeof seed === "number" ? seed >>> 0 : hashSeed(seed)) || 0x9e3779b9;
  }

  /** mulberry32 — small, fast, good enough spread for a game. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on an empty list");
    return items[this.int(items.length)]!;
  }

  /** Fisher-Yates, returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * Poisson draw. Knuth's method below 30, where football scorelines live;
   * a normal approximation above it so we can never spin forever.
   */
  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > limit);
      return k - 1;
    }
    const g = Math.sqrt(lambda) * this.gaussian() + lambda;
    return Math.max(0, Math.round(g));
  }

  /** Standard normal via Box-Muller. */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Weighted choice; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1]!;
  }
}

/** Short, shareable, unambiguous run code, e.g. "K7QP-2M4X". */
export function makeRunCode(rng: Rng = new Rng(Date.now() ^ Math.floor(Math.random() * 1e9))): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let out = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += alphabet[rng.int(alphabet.length)];
  }
  return out;
}
