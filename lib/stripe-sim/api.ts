import { CURRENCY, DAY, NOW, PRICING } from '../sim/constants';
import type {
  Dispute,
  PaymentMethodConfiguration,
  Payout,
  Refund,
  Review,
  SimAccountLink,
  SimQueryRun,
  SimReportRun,
  Transfer,
} from '../sim/types';
import { PLATFORM_ACCOUNT_ID, perform } from './core';
import { nextId } from './ids';
import { applyRefund } from './mcp';
import type { CallOptions } from './mcp';
import type { SimContext } from './types';

/**
 * Direct Stripe REST calls — the things no MCP tool covers today.
 *
 * Each function is named after its endpoint and takes the same parameters the
 * real API takes. Where a call has to run in a connected account's context, the
 * `Stripe-Account` header is set explicitly and shown in the preview, because
 * getting that wrong is the difference between debiting a organizer and debiting
 * yourself.
 */

/* ------------------------ POST /v1/disputes/:id/close --------------------- */

export async function closeDispute(
  ctx: SimContext,
  disputeId: string,
  options: CallOptions = {},
): Promise<Dispute> {
  const dispute = ctx.data.disputes.find((d) => d.id === disputeId);
  if (!dispute) throw new Error(`No such dispute: ${disputeId}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Close dispute (accept liability)',
      method: 'POST',
      path: `/v1/disputes/${disputeId}/close`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    {},
    `Accepted dispute ${disputeId}`,
    () => {
      // Closing a dispute is accepting it: Stripe records the outcome as lost.
      ctx.record({
        kind: 'patch',
        table: 'disputes',
        match: { id: disputeId },
        patch: { status: 'lost', is_charge_refundable: false },
      });
      return { ...dispute, status: 'lost' as const, is_charge_refundable: false };
    },
  );
}

/* ----------------------- POST /v1/reviews/:id/approve --------------------- */

export async function approveReview(
  ctx: SimContext,
  reviewId: string,
  options: CallOptions = {},
): Promise<Review> {
  const review = ctx.data.reviews.find((r) => r.id === reviewId);
  if (!review) throw new Error(`No such review: ${reviewId}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Approve review',
      method: 'POST',
      path: `/v1/reviews/${reviewId}/approve`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    {},
    `Approved review ${reviewId}`,
    () => {
      ctx.record({
        kind: 'patch',
        table: 'reviews',
        match: { id: reviewId },
        patch: { open: false, closed_reason: 'approved', reason: 'approved' },
      });
      return { ...review, open: false, closed_reason: 'approved', reason: 'approved' };
    },
  );
}

/* --------------------- POST /v1/radar/value_list_items -------------------- */

export interface RadarValueListItemParams {
  value_list: string;
  value: string;
}

export async function createRadarValueListItem(
  ctx: SimContext,
  params: RadarValueListItemParams,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Add Radar value list item',
      method: 'POST',
      path: '/v1/radar/value_list_items',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Added ${params.value} to ${params.value_list}`,
    () => {
      const row = {
        id: nextId('rsli'),
        object: 'radar.value_list_item',
        value_list: params.value_list,
        value: params.value,
        created: NOW,
      };
      ctx.record({ kind: 'insert', table: 'radar_value_list_items', row });
      return row;
    },
  );
}

/* ---------------------------- POST /v1/transfers -------------------------- */

export interface CreateTransferParams {
  amount: number;
  currency: string;
  /** Where the money goes. For an account debit this is the platform. */
  destination: string;
  description?: string;
  metadata?: Record<string, string>;
}

/**
 * Account debit.
 *
 * Called with `Stripe-Account: <organizer>` and `destination: <platform>`, which
 * moves money out of the connected account and into Marquee — the opposite
 * direction from every other transfer in the dataset.
 */
export async function createTransfer(
  ctx: SimContext,
  stripeAccount: string,
  params: CreateTransferParams,
  options: CallOptions = {},
): Promise<Transfer> {
  const account = ctx.index.accountById.get(stripeAccount);
  if (!account) throw new Error(`No such account: ${stripeAccount}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create transfer (account debit)',
      method: 'POST',
      path: '/v1/transfers',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Debited ${(params.amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} from ${account.business_profile_name}`,
    () => {
      const transfer: Transfer = {
        id: nextId('tr'),
        amount: params.amount,
        destination_account_id: params.destination,
        source_transaction_id: null,
        transfer_group: null,
        reversed: false,
        amount_reversed: 0,
        created: NOW,
        is_account_debit: true,
        description: params.description ?? null,
      };
      ctx.record({
        kind: 'insert',
        table: 'transfers',
        row: transfer as unknown as Record<string, unknown>,
      });

      const balance = ctx.index.balanceById.get(stripeAccount);
      if (balance) {
        ctx.record({
          kind: 'patch',
          table: 'account_balances',
          match: { account_id: stripeAccount },
          patch: { available: balance.available - params.amount },
        });
      }
      const platform = ctx.data.platform_balances[0];
      if (platform) {
        ctx.record({
          kind: 'patch',
          table: 'platform_balances',
          match: { account_id: platform.account_id },
          patch: { available: platform.available + params.amount },
        });
      }
      // Mark the organizer's outstanding service fees as settled.
      ctx.record({
        kind: 'patch_many',
        table: 'service_fee_ledger',
        match: { account_id: stripeAccount, settled: false },
        patch: { settled: true },
      });

      return transfer;
    },
  );
}

/* --------------------- POST /v1/transfers/:id/reversals ------------------- */

export async function createTransferReversal(
  ctx: SimContext,
  transferId: string,
  params: { amount?: number; refund_application_fee?: boolean; description?: string },
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  const transfer = ctx.data.transfers.find((t) => t.id === transferId);
  if (!transfer) throw new Error(`No such transfer: ${transferId}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Reverse transfer',
      method: 'POST',
      path: `/v1/transfers/${transferId}/reversals`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Reversed ${transferId}`,
    () => {
      const amount = Math.min(
        params.amount ?? transfer.amount - transfer.amount_reversed,
        transfer.amount - transfer.amount_reversed,
      );
      const reversal = {
        id: nextId('trr'),
        object: 'transfer_reversal',
        transfer_id: transferId,
        amount,
        created: NOW,
        balance_transaction_id: nextId('txn'),
      };
      ctx.record({ kind: 'insert', table: 'transfer_reversals', row: reversal });
      ctx.record({
        kind: 'patch',
        table: 'transfers',
        match: { id: transferId },
        patch: {
          amount_reversed: transfer.amount_reversed + amount,
          reversed: transfer.amount_reversed + amount >= transfer.amount,
        },
      });
      const balance = ctx.index.balanceById.get(transfer.destination_account_id);
      if (balance) {
        ctx.record({
          kind: 'patch',
          table: 'account_balances',
          match: { account_id: transfer.destination_account_id },
          patch: { available: balance.available - amount },
        });
      }
      return reversal;
    },
  );
}

/* -------------------------- POST /v1/accounts/:id ------------------------- */

export interface UpdateAccountParams {
  settings?: {
    payouts?: {
      schedule?: { interval: 'manual' | 'daily' | 'weekly' | 'monthly' };
    };
  };
  metadata?: Record<string, string>;
}

export async function updateAccount(
  ctx: SimContext,
  accountId: string,
  params: UpdateAccountParams,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  const account = ctx.index.accountById.get(accountId);
  if (!account) throw new Error(`No such account: ${accountId}`);
  const interval = params.settings?.payouts?.schedule?.interval;

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Update account payout schedule',
      method: 'POST',
      path: `/v1/accounts/${accountId}`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    interval
      ? `Set ${account.business_profile_name} payouts to ${interval}`
      : `Updated ${account.business_profile_name}`,
    () => {
      if (interval) {
        ctx.record({
          kind: 'patch',
          table: 'accounts',
          match: { id: accountId },
          patch: { payout_schedule_interval: interval },
        });
      }
      return {
        id: accountId,
        object: 'account',
        business_profile: { name: account.business_profile_name },
        settings: {
          payouts: { schedule: { interval: interval ?? account.payout_schedule_interval } },
        },
      };
    },
  );
}

/* ------------------------- POST /v1/account_links ------------------------- */

export interface CreateAccountLinkParams {
  account: string;
  refresh_url: string;
  return_url: string;
  type: 'account_onboarding' | 'account_update';
  collection_options?: { fields: 'currently_due' | 'eventually_due' };
}

export async function createAccountLink(
  ctx: SimContext,
  params: CreateAccountLinkParams,
  options: CallOptions = {},
): Promise<SimAccountLink> {
  const account = ctx.index.accountById.get(params.account);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create account link',
      method: 'POST',
      path: '/v1/account_links',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Generated an onboarding link for ${account?.business_profile_name ?? params.account}`,
    () => {
      const link: SimAccountLink = {
        id: nextId('acctlink', 16),
        account_id: params.account,
        url: `https://connect.stripe.com/setup/s/sim_${nextId('x', 14).slice(2)}`,
        created: NOW,
        expires_at: NOW + 5 * 60,
        type: params.type,
      };
      ctx.record({
        kind: 'insert',
        table: 'account_links',
        row: link as unknown as Record<string, unknown>,
      });
      return link;
    },
  );
}

/* ---------------------------- POST /v1/payouts ---------------------------- */

export interface CreatePayoutParams {
  amount: number;
  currency: string;
  method: 'standard' | 'instant';
  statement_descriptor?: string;
}

/** Instant payout, run in the connected account's context. */
export async function createPayout(
  ctx: SimContext,
  stripeAccount: string,
  params: CreatePayoutParams,
  options: CallOptions = {},
): Promise<Payout> {
  const account = ctx.index.accountById.get(stripeAccount);
  if (!account) throw new Error(`No such account: ${stripeAccount}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create payout',
      method: 'POST',
      path: '/v1/payouts',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `${params.method === 'instant' ? 'Instant' : 'Standard'} payout of ${(params.amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} for ${account.business_profile_name}`,
    () => {
      const fee =
        params.method === 'instant'
          ? Math.round(params.amount * PRICING.instantPayoutPercent)
          : 0;
      const payout: Payout = {
        id: nextId('po'),
        account_id: stripeAccount,
        amount: params.amount,
        currency: params.currency,
        arrival_date: params.method === 'instant' ? NOW + 30 * 60 : NOW + 2 * DAY,
        created: NOW,
        status: 'in_transit',
        method: params.method,
        failure_code: null,
        failure_message: null,
      };
      ctx.record({
        kind: 'insert',
        table: 'connected_account_payouts',
        row: payout as unknown as Record<string, unknown>,
      });
      const balance = ctx.index.balanceById.get(stripeAccount);
      if (balance) {
        ctx.record({
          kind: 'patch',
          table: 'account_balances',
          match: { account_id: stripeAccount },
          patch: { available: balance.available - params.amount - fee },
        });
      }
      return payout;
    },
  );
}

/* --------------- POST /v1/payment_method_configurations/:id --------------- */

export type ConfigurablePaymentMethod =
  | 'apple_pay'
  | 'google_pay'
  | 'klarna'
  | 'affirm'
  | 'afterpay_clearpay'
  | 'cashapp'
  | 'link';

export interface UpdatePmcParams {
  /** Each key maps to { display_preference: { preference: 'on' | 'off' } }. */
  updates: Partial<Record<ConfigurablePaymentMethod, 'on' | 'off'>>;
}

export async function updatePaymentMethodConfiguration(
  ctx: SimContext,
  configurationId: string,
  params: UpdatePmcParams,
  options: CallOptions = {},
): Promise<PaymentMethodConfiguration> {
  const config = ctx.data.payment_method_configurations.find(
    (c) => c.id === configurationId,
  );
  if (!config) throw new Error(`No such configuration: ${configurationId}`);
  const account = config.account_id
    ? ctx.index.accountById.get(config.account_id)
    : null;

  // The wire format is form-encoded nested keys; show it the way Stripe wants it.
  const wireParams: Record<string, string> = {};
  for (const [method, preference] of Object.entries(params.updates)) {
    wireParams[`${method}[display_preference][preference]`] = preference as string;
  }

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Update payment method configuration',
      method: 'POST',
      path: `/v1/payment_method_configurations/${configurationId}`,
      stripeAccount: config.account_id,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    wireParams,
    `Updated checkout methods for ${account?.business_profile_name ?? configurationId}`,
    () => {
      const next = { ...config.payment_methods };
      for (const [method, preference] of Object.entries(params.updates)) {
        next[method] = {
          display_preference: {
            preference: preference as 'on' | 'off',
            value: preference as 'on' | 'off',
          },
        };
      }
      ctx.record({
        kind: 'patch',
        table: 'payment_method_configurations',
        match: { id: configurationId },
        patch: { payment_methods: next },
      });
      return { ...config, payment_methods: next };
    },
  );
}

/* --------------------- POST /v1/reporting/report_runs --------------------- */

export interface CreateReportRunParams {
  report_type: string;
  parameters: {
    interval_start: number;
    interval_end: number;
    columns?: string[];
    connected_account?: string;
  };
}

export async function createReportRun(
  ctx: SimContext,
  params: CreateReportRunParams,
  options: CallOptions = {},
): Promise<SimReportRun> {
  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create report run',
      method: 'POST',
      path: '/v1/reporting/report_runs',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Queued the ${params.report_type} report`,
    () => {
      const run: SimReportRun = {
        id: nextId('frr'),
        report_type: params.report_type,
        status: 'succeeded',
        created: NOW,
        parameters: params.parameters,
        result_url: `https://files.stripe.com/v1/files/sim_${nextId('file', 12).slice(5)}/contents`,
      };
      ctx.record({
        kind: 'insert',
        table: 'report_runs',
        row: run as unknown as Record<string, unknown>,
      });
      return run;
    },
  );
}

/* ----------------------- POST /v1/sigma/query_runs ----------------------- */

export async function createSigmaQueryRun(
  ctx: SimContext,
  params: { sql: string },
  options: CallOptions = {},
): Promise<SimQueryRun> {
  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Run Sigma query',
      method: 'POST',
      path: '/v1/sigma/query_runs',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    'Submitted a Sigma query run',
    () => {
      const run: SimQueryRun = {
        id: nextId('sqr'),
        sql: params.sql,
        status: 'completed',
        created: NOW,
        // The preview the UI already rendered is the row count here.
        row_count: 0,
      };
      ctx.record({
        kind: 'insert',
        table: 'query_runs',
        row: run as unknown as Record<string, unknown>,
      });
      return run;
    },
  );
}

/* -------------- POST /v1/terminal/readers/:id/refund_payment ------------- */

export interface TerminalRefundParams {
  charge: string;
  amount: number;
  refund_application_fee?: boolean;
  reverse_transfer?: boolean;
}

export async function refundTerminalPayment(
  ctx: SimContext,
  readerId: string,
  stripeAccount: string,
  params: TerminalRefundParams,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  const reader = ctx.data.terminal_readers.find((r) => r.id === readerId);
  if (!reader) throw new Error(`No such reader: ${readerId}`);
  const charge = ctx.index.chargeById.get(params.charge);
  if (!charge) throw new Error(`No such charge: ${params.charge}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Terminal reader refund',
      method: 'POST',
      path: `/v1/terminal/readers/${readerId}/refund_payment`,
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Refunded an in-person sale on ${reader.label}`,
    () => {
      const refund: Refund = applyRefund(ctx, charge, {
        charge: params.charge,
        amount: params.amount,
        reason: 'requested_by_customer',
        reverse_transfer: params.reverse_transfer ?? true,
        refund_application_fee: params.refund_application_fee,
      });
      return {
        id: reader.id,
        object: 'terminal.reader',
        action: {
          type: 'refund_payment',
          status: 'succeeded',
          refund_payment: {
            charge: params.charge,
            amount: params.amount,
            refund: refund.id,
            reverse_transfer: params.reverse_transfer ?? true,
          },
        },
        label: reader.label,
        status: reader.status,
      };
    },
  );
}

export { PLATFORM_ACCOUNT_ID, CURRENCY };
