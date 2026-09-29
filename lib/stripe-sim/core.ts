import { Rng } from '../sim/rng';
import { SEED } from '../sim/constants';
import { nextId, requestId } from './ids';
import type { AuditEntry, CallMeta, SimContext } from './types';

/**
 * Nothing here touches the network. Every "call" resolves in-process after a
 * plausible delay, writes an audit entry, and mutates the seeded dataset so the
 * rest of the UI reflects the change immediately.
 */

const latencyRng = new Rng(SEED + 7_777);

/** Realistic Stripe API round-trip. */
export function nextLatency(): number {
  return Math.round(latencyRng.between(400, 900));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractId(response: unknown): string {
  if (response && typeof response === 'object') {
    const candidate = (response as { id?: unknown }).id;
    if (typeof candidate === 'string') return candidate;
    if ((response as { object?: unknown }).object === 'list') return requestId();
  }
  return requestId();
}

/**
 * Runs one simulated call end to end: latency, state change, audit entry.
 *
 * `run` is where the mutation happens and where the response object is built,
 * so the audit log always records exactly what the UI just acted on.
 */
export async function perform<T>(
  ctx: SimContext,
  meta: CallMeta,
  params: unknown,
  summary: string,
  run: () => T,
): Promise<T> {
  await sleep(nextLatency());

  const response = run();
  const accountName = meta.stripeAccount
    ? ctx.index.accountById.get(meta.stripeAccount)?.business_profile_name ?? null
    : null;

  const entry: AuditEntry = {
    id: nextId('log', 12),
    at: Date.now(),
    actor: ctx.actor,
    surface: meta.surface,
    name: meta.name,
    method: meta.method,
    path: meta.path,
    params,
    stripeAccount: meta.stripeAccount ?? null,
    accountName,
    idempotencyKey: meta.idempotencyKey ?? null,
    responseId: extractId(response),
    response,
    scenarioId: ctx.scenarioId ?? null,
    scenarioTitle: ctx.scenarioTitle ?? null,
    summary,
  };
  ctx.log(entry);

  return response;
}

/** The request headers a real call would carry. Shown in every preview. */
export function previewHeaders(meta: CallMeta): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer sk_live_•••• (simulated — no key is read or sent)',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2026-08-27.basil',
  };
  if (meta.stripeAccount) headers['Stripe-Account'] = meta.stripeAccount;
  if (meta.idempotencyKey) headers['Idempotency-Key'] = meta.idempotencyKey;
  return headers;
}

/** Marquee's own platform account id, used as the destination on debits. */
export const PLATFORM_ACCOUNT_ID = 'acct_platform_marquee';
