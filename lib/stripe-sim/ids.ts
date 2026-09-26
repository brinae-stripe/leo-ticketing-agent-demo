import { Rng } from '../sim/rng';
import { SEED } from '../sim/constants';

/**
 * Object ids for simulated calls.
 *
 * Seeded from a session counter rather than the clock so that a fresh demo
 * produces the same ids in the same order every time. "Reset demo data" calls
 * resetIds() and the sequence starts over.
 */
let rng = new Rng(SEED + 9_001);
let counter = 0;

export function resetIds(): void {
  rng = new Rng(SEED + 9_001);
  counter = 0;
}

export function nextId(prefix: string, length = 24): string {
  counter += 1;
  return `${prefix}_${rng.string(length)}`;
}

/** Idempotency keys look like UUIDs in the Stripe dashboard. */
export function idempotencyKey(label: string): string {
  const raw = rng.hex(32);
  const uuid = [
    raw.slice(0, 8),
    raw.slice(8, 12),
    raw.slice(12, 16),
    raw.slice(16, 20),
    raw.slice(20, 32),
  ].join('-');
  return `stagegate-${label}-${uuid}`;
}

export function requestId(): string {
  return `req_${rng.string(16)}`;
}

export function callCount(): number {
  return counter;
}
