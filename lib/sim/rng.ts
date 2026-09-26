/**
 * Deterministic pseudo-random number generation.
 *
 * Every number in the seeded dataset comes from here, so a given SEED always
 * produces a byte-identical demo. Never use Math.random() in generation code.
 */

/** mulberry32 — small, fast, good enough distribution for fake data. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';

export type Weighted<T> = [value: T, weight: number];

export class Rng {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform float in [min, max). */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick. Weights need not sum to 1. */
  weighted<T>(entries: readonly Weighted<T>[]): T {
    let total = 0;
    for (const [, weight] of entries) total += weight;
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** Box–Muller normal draw. */
  normal(mean = 0, stdDev = 1): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    return (
      mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    );
  }

  /** Log-normal draw, handy for ticket prices and order volumes. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  string(length: number, alphabet = ALNUM): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += alphabet[Math.floor(this.next() * alphabet.length)];
    }
    return out;
  }

  hex(length: number): string {
    return this.string(length, HEX);
  }

  /** Stripe-shaped object id, e.g. ch_3Qf1aBCdEfGhIjKl. */
  id(prefix: string, length = 24): string {
    return `${prefix}_${this.string(length)}`;
  }

  /** Fisher–Yates shuffle, returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** N distinct members of items (or all of them if n >= length). */
  sample<T>(items: readonly T[], n: number): T[] {
    if (n >= items.length) return items.slice();
    return this.shuffle(items).slice(0, n);
  }
}
