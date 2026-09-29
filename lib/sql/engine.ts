'use client';

import type { SimDataset } from '../sim/types';
import { SQL_TABLE_NAMES as KNOWN_TABLES } from './tables';

/**
 * Real SQL, really executed.
 *
 * The queries the agent shows you in "Data used" are not decorative — they run
 * through alasql against the same in-memory rows the rest of the app reads, and
 * the result table below each query is that query's output. If you edit a query
 * in the inspector, the numbers change.
 *
 * Two deliberate departures from Sigma, both because a browser SQL engine has
 * no JSON operators:
 *   - `metadata` is flattened to `metadata_<key>` columns.
 *   - array columns are flattened to a comma-joined string plus a `_count`.
 * Both are called out in /how-it-works.
 */

type Row = Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: Row[];
  ms: number;
  truncated: boolean;
}

export class SqlError extends Error {
  constructor(
    message: string,
    readonly sql: string,
  ) {
    super(message);
    this.name = 'SqlError';
  }
}

/** Hard cap so a careless query cannot lock the tab up rendering a million rows. */
const MAX_ROWS = 500;

/* ------------------------------- flattening ------------------------------- */

function flattenCharges(data: SimDataset): Row[] {
  return data.charges.map((c) => ({
    id: c.id,
    account_id: c.account_id,
    payment_intent_id: c.payment_intent_id,
    created: c.created,
    amount: c.amount,
    currency: c.currency,
    status: c.status,
    paid: c.paid,
    captured: c.captured,
    refunded: c.refunded,
    amount_refunded: c.amount_refunded,
    disputed: c.disputed,
    customer_id: c.customer_id,
    card_brand: c.card_brand,
    card_funding: c.card_funding,
    card_country: c.card_country,
    card_wallet_type: c.card_wallet_type,
    payment_method_details_type: c.payment_method_details_type,
    card_fingerprint: c.card_fingerprint,
    balance_transaction_id: c.balance_transaction_id,
    transfer_id: c.transfer_id,
    transfer_group: c.transfer_group,
    outcome_type: c.outcome_type,
    outcome_reason: c.outcome_reason,
    outcome_risk_score: c.outcome_risk_score,
    outcome_risk_level: c.outcome_risk_level,
    metadata_event_id: c.metadata.event_id,
    metadata_tier: c.metadata.tier,
    metadata_quantity: Number(c.metadata.quantity),
  }));
}

function flattenAccounts(data: SimDataset): Row[] {
  return data.accounts.map((a) => ({
    id: a.id,
    business_profile_name: a.business_profile_name,
    country: a.country,
    type: a.type,
    charges_enabled: a.charges_enabled,
    payouts_enabled: a.payouts_enabled,
    requirements_currently_due: a.requirements_currently_due.join(','),
    requirements_currently_due_count: a.requirements_currently_due.length,
    requirements_past_due: a.requirements_past_due.join(','),
    requirements_past_due_count: a.requirements_past_due.length,
    requirements_disabled_reason: a.requirements_disabled_reason,
    requirements_current_deadline: a.requirements_current_deadline,
    payout_schedule_interval: a.payout_schedule_interval,
    metadata_organizer_category: a.metadata.organizer_category,
    metadata_next_event_date: a.metadata.next_event_date,
    metadata_settlement_mode: a.metadata.settlement_mode,
    metadata_service_fee_percent: Number(a.metadata.service_fee_percent),
    metadata_service_fee_fixed: Number(a.metadata.service_fee_fixed),
    metadata_trailing_volume: Number(a.metadata.trailing_volume),
  }));
}

function flattenPmc(data: SimDataset): Row[] {
  return data.payment_method_configurations.map((c) => {
    const row: Row = {
      id: c.id,
      account_id: c.account_id,
      name: c.name,
      is_default: c.is_default,
      parent: c.parent,
    };
    for (const [method, value] of Object.entries(c.payment_methods)) {
      row[`${method}_preference`] = value.display_preference.preference;
    }
    return row;
  });
}

function flattenInvoices(data: SimDataset): Row[] {
  return data.invoices.map((i) => ({
    id: i.id,
    account_id: i.account_id,
    customer_id: i.customer_id,
    customer_name: i.customer_name,
    status: i.status,
    amount_due: i.amount_due,
    currency: i.currency,
    created: i.created,
    hosted_invoice_url: i.hosted_invoice_url,
    line_count: i.lines.length,
  }));
}

/** Same array-flattening convention as `accounts.requirements_*`. */
function flattenFinancialAccounts(data: SimDataset): Row[] {
  return data.treasury_financial_accounts.map((a) => ({
    id: a.id,
    account_id: a.account_id,
    status: a.status,
    active_features: a.active_features.join(','),
    active_features_count: a.active_features.length,
    routing_number: a.routing_number,
    account_number_last4: a.account_number_last4,
    balance_cash: a.balance_cash,
    balance_inbound_pending: a.balance_inbound_pending,
    balance_outbound_pending: a.balance_outbound_pending,
    currency: a.currency,
    created: a.created,
  }));
}

function flattenIssuingCards(data: SimDataset): Row[] {
  return data.issuing_cards.map((c) => ({
    id: c.id,
    cardholder_id: c.cardholder_id,
    account_id: c.account_id,
    last4: c.last4,
    brand: c.brand,
    type: c.type,
    status: c.status,
    spending_limit_amount: c.spending_limit_amount,
    spending_limit_interval: c.spending_limit_interval,
    allowed_categories: c.allowed_categories.join(','),
    allowed_categories_count: c.allowed_categories.length,
    created: c.created,
  }));
}

/** Every table the agent's SQL can reference, in its SQL-facing shape. */
export function sqlTables(data: SimDataset): Record<string, Row[]> {
  return {
    accounts: flattenAccounts(data),
    events: data.events as unknown as Row[],
    charges: flattenCharges(data),
    balance_transactions: data.balance_transactions as unknown as Row[],
    balance_transaction_fee_details:
      data.balance_transaction_fee_details as unknown as Row[],
    transfers: data.transfers as unknown as Row[],
    transfer_reversals: data.transfer_reversals as unknown as Row[],
    refunds: data.refunds as unknown as Row[],
    disputes: data.disputes as unknown as Row[],
    early_fraud_warnings: data.early_fraud_warnings as unknown as Row[],
    reviews: data.reviews as unknown as Row[],
    payouts: data.payouts as unknown as Row[],
    connected_account_payouts: data.connected_account_payouts as unknown as Row[],
    terminal_readers: data.terminal_readers as unknown as Row[],
    admissions: data.admissions as unknown as Row[],
    account_balances: data.account_balances as unknown as Row[],
    platform_balances: data.platform_balances as unknown as Row[],
    service_fee_ledger: data.service_fee_ledger as unknown as Row[],
    radar_value_list_items: data.radar_value_list_items as unknown as Row[],
    invoices: flattenInvoices(data),
    payment_links: data.payment_links as unknown as Row[],
    account_links: data.account_links as unknown as Row[],
    report_runs: data.report_runs as unknown as Row[],
    query_runs: data.query_runs as unknown as Row[],
    payment_method_configurations: flattenPmc(data),
    capital_financing_offers: data.capital_financing_offers as unknown as Row[],
    capital_financing_summaries: data.capital_financing_summaries as unknown as Row[],
    treasury_financial_accounts: flattenFinancialAccounts(data),
    treasury_outbound_payments: data.treasury_outbound_payments as unknown as Row[],
    treasury_received_credits: data.treasury_received_credits as unknown as Row[],
    issuing_cardholders: data.issuing_cardholders as unknown as Row[],
    issuing_cards: flattenIssuingCards(data),
    issuing_authorizations: data.issuing_authorizations as unknown as Row[],
    platform_requests: data.platform_requests as unknown as Row[],
  };
}

export { SQL_TABLE_NAMES } from './tables';

/* ------------------------------- the engine ------------------------------- */

type AlaSql = ((sql: string, params?: unknown[]) => unknown) & {
  tables: Record<string, { data: Row[] }>;
  options: Record<string, unknown>;
};

let enginePromise: Promise<AlaSql> | null = null;
let loadedRev = -1;

async function getEngine(): Promise<AlaSql> {
  if (!enginePromise) {
    enginePromise = import('alasql').then((mod) => {
      const alasql = (mod.default ?? mod) as unknown as AlaSql;
      alasql('CREATE DATABASE IF NOT EXISTS sim');
      alasql('USE sim');
      return alasql;
    });
  }
  return enginePromise;
}

/**
 * Point alasql at the current rows. Re-run whenever the dataset revision
 * changes, which is once at startup plus once per approved action.
 */
async function loadTables(data: SimDataset, rev: number): Promise<AlaSql> {
  const alasql = await getEngine();
  if (loadedRev === rev) return alasql;

  const tables = sqlTables(data);

  // Catches the documentation and the engine drifting apart: if a table is
  // listed in tables.ts but never loaded, a scenario querying it would fail at
  // demo time rather than here.
  for (const name of KNOWN_TABLES) {
    if (!(name in tables)) {
      throw new Error(`Table "${name}" is documented but not loaded into the SQL engine`);
    }
  }

  for (const [name, rows] of Object.entries(tables)) {
    if (!alasql.tables[name]) alasql(`CREATE TABLE IF NOT EXISTS ${name}`);
    // Assigning by reference — no copy of 24,000 rows per query.
    alasql.tables[name].data = rows;
  }
  loadedRev = rev;
  return alasql;
}

export async function runSql(
  data: SimDataset,
  rev: number,
  sql: string,
): Promise<QueryResult> {
  const alasql = await loadTables(data, rev);
  const started = performance.now();

  let raw: unknown;
  try {
    raw = alasql(sql);
  } catch (error) {
    throw new SqlError(
      error instanceof Error ? error.message : 'Query failed',
      sql,
    );
  }

  const ms = performance.now() - started;
  const all = Array.isArray(raw) ? (raw as Row[]) : [];
  const truncated = all.length > MAX_ROWS;
  const rows = truncated ? all.slice(0, MAX_ROWS) : all;

  const columns: string[] = [];
  for (const row of rows.slice(0, 25)) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
  }

  return { columns, rows, ms, truncated };
}

/** Invalidate the loaded snapshot, e.g. after "Reset demo data". */
export function invalidateSqlCache(): void {
  loadedRev = -1;
}
