import { generateDataset } from './generate';
import type { SimDataset, TableName } from './types';

/**
 * Mutations are how simulated Stripe calls change the world.
 *
 * The seeded dataset itself is never persisted — it is 100k+ rows and would
 * blow past the localStorage quota. Instead we persist only the small list of
 * mutations a demo session produced, and on reload we regenerate the seeded
 * dataset and replay them. Same end state, a few kilobytes on disk.
 */
export type Mutation =
  | {
      kind: 'insert';
      table: TableName;
      row: Record<string, unknown>;
    }
  | {
      kind: 'patch';
      table: TableName;
      /** All keys must match for a row to be patched. First match wins. */
      match: Record<string, string | number | boolean>;
      patch: Record<string, unknown>;
    }
  | {
      kind: 'patch_many';
      table: TableName;
      match: Record<string, string | number | boolean>;
      patch: Record<string, unknown>;
    };

/** Build a brand-new copy of the seeded world. */
export function createDataset(): SimDataset {
  return generateDataset();
}

function matches(
  row: Record<string, unknown>,
  match: Record<string, string | number | boolean>,
): boolean {
  for (const key of Object.keys(match)) {
    if (row[key] !== match[key]) return false;
  }
  return true;
}

export function applyMutation(data: SimDataset, mutation: Mutation): void {
  const table = data[mutation.table] as unknown as Record<string, unknown>[];
  if (!table) return;

  if (mutation.kind === 'insert') {
    table.push(mutation.row);
    return;
  }

  if (mutation.kind === 'patch') {
    const row = table.find((candidate) => matches(candidate, mutation.match));
    if (row) Object.assign(row, mutation.patch);
    return;
  }

  for (const row of table) {
    if (matches(row, mutation.match)) Object.assign(row, mutation.patch);
  }
}

export function applyMutations(data: SimDataset, mutations: Mutation[]): void {
  for (const mutation of mutations) applyMutation(data, mutation);
}

/* -------------------------------------------------------------------------- */
/* Indexes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Derived lookups. Rebuilt whenever the dataset changes, which in practice
 * means once at startup and once per approved action.
 */
export interface SimIndex {
  accountById: Map<string, SimDataset['accounts'][number]>;
  accountByName: Map<string, SimDataset['accounts'][number]>;
  eventById: Map<string, SimDataset['events'][number]>;
  chargeById: Map<string, SimDataset['charges'][number]>;
  balanceById: Map<string, SimDataset['account_balances'][number]>;
  transferByCharge: Map<string, SimDataset['transfers'][number]>;
  admissionByCharge: Map<string, SimDataset['admissions'][number]>;
  eventsByAccount: Map<string, SimDataset['events']>;
  paidChargesByAccount: Map<string, SimDataset['charges']>;
  chargesByEvent: Map<string, SimDataset['charges']>;
  refundsByCharge: Map<string, SimDataset['refunds']>;
  readersByAccount: Map<string, SimDataset['terminal_readers']>;
  stripeFeeByBalanceTransaction: Map<string, number>;
  applicationFeeByBalanceTransaction: Map<string, number>;
  fingerprintCountByAccount: Map<string, Map<string, number>>;
  pmcByAccount: Map<string, SimDataset['payment_method_configurations'][number]>;
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndex(data: SimDataset): SimIndex {
  const index: SimIndex = {
    accountById: new Map(data.accounts.map((a) => [a.id, a])),
    accountByName: new Map(data.accounts.map((a) => [a.business_profile_name, a])),
    eventById: new Map(data.events.map((e) => [e.id, e])),
    chargeById: new Map(data.charges.map((c) => [c.id, c])),
    balanceById: new Map(data.account_balances.map((b) => [b.account_id, b])),
    transferByCharge: new Map(),
    admissionByCharge: new Map(),
    eventsByAccount: new Map(),
    paidChargesByAccount: new Map(),
    chargesByEvent: new Map(),
    refundsByCharge: new Map(),
    readersByAccount: new Map(),
    stripeFeeByBalanceTransaction: new Map(),
    applicationFeeByBalanceTransaction: new Map(),
    fingerprintCountByAccount: new Map(),
    pmcByAccount: new Map(),
  };

  for (const transfer of data.transfers) {
    if (transfer.source_transaction_id) {
      index.transferByCharge.set(transfer.source_transaction_id, transfer);
    }
  }
  for (const admission of data.admissions) {
    index.admissionByCharge.set(admission.charge_id, admission);
  }
  for (const event of data.events) {
    pushInto(index.eventsByAccount, event.account_id, event);
  }
  for (const charge of data.charges) {
    pushInto(index.chargesByEvent, charge.metadata.event_id, charge);
    if (charge.paid) {
      pushInto(index.paidChargesByAccount, charge.account_id, charge);
      const perAccount =
        index.fingerprintCountByAccount.get(charge.account_id) ?? new Map<string, number>();
      perAccount.set(
        charge.card_fingerprint,
        (perAccount.get(charge.card_fingerprint) ?? 0) + 1,
      );
      index.fingerprintCountByAccount.set(charge.account_id, perAccount);
    }
  }
  for (const refund of data.refunds) {
    pushInto(index.refundsByCharge, refund.charge_id, refund);
  }
  for (const reader of data.terminal_readers) {
    pushInto(index.readersByAccount, reader.account_id, reader);
  }
  for (const detail of data.balance_transaction_fee_details) {
    const target =
      detail.type === 'application_fee'
        ? index.applicationFeeByBalanceTransaction
        : index.stripeFeeByBalanceTransaction;
    if (detail.type === 'tax') continue;
    target.set(
      detail.balance_transaction_id,
      (target.get(detail.balance_transaction_id) ?? 0) + detail.amount,
    );
  }
  for (const config of data.payment_method_configurations) {
    if (config.account_id) index.pmcByAccount.set(config.account_id, config);
  }

  return index;
}
