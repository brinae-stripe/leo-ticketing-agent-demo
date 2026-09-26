import { CURRENCY, NOW, PRICING } from '../sim/constants';
import type {
  Charge,
  Dispute,
  Refund,
  SimInvoice,
  SimPaymentLink,
} from '../sim/types';
import { PLATFORM_ACCOUNT_ID, perform } from './core';
import { nextId } from './ids';
import type { SimContext, SimListResponse } from './types';

/**
 * Stripe hosted MCP tools.
 *
 * Function names and parameter shapes match the tools the hosted MCP server
 * exposes, so swapping these for real tool calls would be a mechanical change.
 *
 * Simulated rows are stamped with the dataset's pinned "now" rather than real
 * wall-clock time, so a refund created during the demo lands inside the same
 * timeline as the seeded data. The audit log uses real time.
 */

export interface CallOptions {
  idempotencyKey?: string | null;
}

/* ----------------------------- refunds ----------------------------------- */

export interface CreateRefundParams {
  charge: string;
  amount?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  /** On a destination charge, pull the funds back out of the host's balance. */
  reverse_transfer?: boolean;
  refund_application_fee?: boolean;
  metadata?: Record<string, string>;
}

/**
 * Shared refund bookkeeping. Used by create_refund and by the Terminal
 * refund_payment endpoint, which produces the same objects.
 */
export function applyRefund(
  ctx: SimContext,
  charge: Charge,
  params: CreateRefundParams,
): Refund {
  const remaining = charge.amount - charge.amount_refunded;
  const amount = Math.min(params.amount ?? remaining, remaining);
  const reverseTransfer = params.reverse_transfer ?? false;

  const refund: Refund = {
    id: nextId('re'),
    charge_id: charge.id,
    amount,
    status: 'succeeded',
    reason: params.reason ?? null,
    created: NOW,
    reverse_transfer: reverseTransfer,
  };

  ctx.record({ kind: 'insert', table: 'refunds', row: refund as unknown as Record<string, unknown> });
  ctx.record({
    kind: 'patch',
    table: 'charges',
    match: { id: charge.id },
    patch: {
      amount_refunded: charge.amount_refunded + amount,
      refunded: charge.amount_refunded + amount >= charge.amount,
    },
  });
  ctx.record({
    kind: 'insert',
    table: 'balance_transactions',
    row: {
      id: nextId('txn'),
      amount: -amount,
      fee: 0,
      net: -amount,
      currency: CURRENCY,
      created: NOW,
      available_on: NOW,
      type: 'refund',
      reporting_category: 'refund',
      source_id: refund.id,
    },
  });

  if (reverseTransfer) {
    const transfer = ctx.index.transferByCharge.get(charge.id);
    if (transfer) {
      const reversalAmount = Math.min(
        amount,
        transfer.amount - transfer.amount_reversed,
      );
      ctx.record({
        kind: 'patch',
        table: 'transfers',
        match: { id: transfer.id },
        patch: {
          reversed: transfer.amount_reversed + reversalAmount >= transfer.amount,
          amount_reversed: transfer.amount_reversed + reversalAmount,
        },
      });
      ctx.record({
        kind: 'insert',
        table: 'transfer_reversals',
        row: {
          id: nextId('trr'),
          transfer_id: transfer.id,
          amount: reversalAmount,
          created: NOW,
          balance_transaction_id: nextId('txn'),
        },
      });
      const balance = ctx.index.balanceById.get(charge.account_id);
      if (balance) {
        ctx.record({
          kind: 'patch',
          table: 'account_balances',
          match: { account_id: charge.account_id },
          patch: { available: balance.available - reversalAmount },
        });
      }
    }
  }

  return refund;
}

export async function create_refund(
  ctx: SimContext,
  params: CreateRefundParams,
  options: CallOptions = {},
): Promise<Refund> {
  const charge = ctx.index.chargeById.get(params.charge);
  if (!charge) throw new Error(`No such charge: ${params.charge}`);

  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'create_refund',
      method: 'POST',
      path: '/v1/refunds',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Refunded ${(Math.min(params.amount ?? charge.amount - charge.amount_refunded, charge.amount - charge.amount_refunded) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} on ${charge.id}`,
    () => applyRefund(ctx, charge, params),
  );
}

export interface CreateRefundBatchParams {
  charges: string[];
  reason?: CreateRefundParams['reason'];
  reverse_transfer?: boolean;
  refund_application_fee?: boolean;
  metadata?: Record<string, string>;
  /** 1-based, for the audit trail. */
  batch_index: number;
  batch_total: number;
}

/**
 * A batch of refunds collapsed into one round-trip.
 *
 * The agent really does call create_refund once per charge — there is no bulk
 * refund endpoint. For a 2,100-charge cancellation, simulating 2,100 individual
 * round-trips would take twenty minutes, so each batch of 200 is modelled as a
 * single delay and a single audit entry that states how many tool calls it
 * stands for. The resulting objects are identical either way.
 */
export async function create_refund_batch(
  ctx: SimContext,
  params: CreateRefundBatchParams,
  options: CallOptions = {},
): Promise<{
  object: 'batch';
  tool: 'create_refund';
  calls: number;
  refunds: string[];
  amount: number;
  batch: string;
}> {
  const charges = params.charges
    .map((id) => ctx.index.chargeById.get(id))
    .filter((charge): charge is Charge => Boolean(charge));

  return perform(
    ctx,
    {
      surface: 'mcp',
      name: `create_refund ×${charges.length}`,
      method: 'POST',
      path: '/v1/refunds',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    {
      charges: params.charges,
      reason: params.reason,
      reverse_transfer: params.reverse_transfer,
      refund_application_fee: params.refund_application_fee,
      metadata: params.metadata,
      _note: `${charges.length} sequential create_refund calls, batch ${params.batch_index} of ${params.batch_total}`,
    },
    `Refunded ${charges.length} charges (batch ${params.batch_index} of ${params.batch_total})`,
    () => {
      const refunds: string[] = [];
      let amount = 0;
      for (const charge of charges) {
        const refund = applyRefund(ctx, charge, {
          charge: charge.id,
          reason: params.reason,
          reverse_transfer: params.reverse_transfer,
          refund_application_fee: params.refund_application_fee,
          metadata: params.metadata,
        });
        refunds.push(refund.id);
        amount += refund.amount;
      }
      return {
        object: 'batch' as const,
        tool: 'create_refund' as const,
        calls: charges.length,
        refunds,
        amount,
        batch: `${params.batch_index}/${params.batch_total}`,
      };
    },
  );
}

/* ----------------------------- disputes ---------------------------------- */

export interface DisputeEvidence {
  uncategorized_text?: string;
  receipt?: string;
  customer_communication?: string;
  service_date?: string;
  access_activity_log?: string;
  billing_address?: string;
  customer_email_address?: string;
}

export interface UpdateDisputeParams {
  dispute: string;
  evidence: DisputeEvidence;
  submit: boolean;
  metadata?: Record<string, string>;
}

export async function update_dispute(
  ctx: SimContext,
  params: UpdateDisputeParams,
  options: CallOptions = {},
): Promise<Dispute> {
  const dispute = ctx.data.disputes.find((d) => d.id === params.dispute);
  if (!dispute) throw new Error(`No such dispute: ${params.dispute}`);

  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'update_dispute',
      method: 'POST',
      path: `/v1/disputes/${params.dispute}`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    params.submit
      ? `Submitted evidence on ${params.dispute}`
      : `Saved draft evidence on ${params.dispute}`,
    () => {
      const status: Dispute['status'] = params.submit ? 'under_review' : dispute.status;
      ctx.record({
        kind: 'patch',
        table: 'disputes',
        match: { id: dispute.id },
        patch: {
          status,
          evidence_submitted_at: params.submit ? NOW : dispute.evidence_submitted_at,
        },
      });
      return { ...dispute, status, evidence_submitted_at: params.submit ? NOW : null };
    },
  );
}

export interface ListDisputesParams {
  status?: Dispute['status'];
  limit?: number;
  charge?: string;
}

export async function list_disputes(
  ctx: SimContext,
  params: ListDisputesParams = {},
  options: CallOptions = {},
): Promise<SimListResponse<Dispute>> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'list_disputes',
      method: 'GET',
      path: '/v1/disputes',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    'Listed disputes',
    () => {
      const limit = params.limit ?? 10;
      const rows = ctx.data.disputes
        .filter((d) => (params.status ? d.status === params.status : true))
        .filter((d) => (params.charge ? d.charge_id === params.charge : true))
        .sort((a, b) => a.evidence_due_by - b.evidence_due_by)
        .slice(0, limit);
      return {
        object: 'list' as const,
        url: '/v1/disputes',
        has_more: false,
        data: rows,
      };
    },
  );
}

/* ------------------------- payment intents ------------------------------- */

export interface ListPaymentIntentsParams {
  customer?: string;
  limit?: number;
}

export async function list_payment_intents(
  ctx: SimContext,
  params: ListPaymentIntentsParams = {},
  options: CallOptions = {},
): Promise<SimListResponse<Record<string, unknown>>> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'list_payment_intents',
      method: 'GET',
      path: '/v1/payment_intents',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    params.customer
      ? `Listed payment intents for ${params.customer}`
      : 'Listed payment intents',
    () => {
      const limit = params.limit ?? 10;
      const rows = ctx.data.charges
        .filter((c) => (params.customer ? c.customer_id === params.customer : true))
        .sort((a, b) => b.created - a.created)
        .slice(0, limit)
        .map((c) => ({
          id: c.payment_intent_id,
          object: 'payment_intent',
          amount: c.amount,
          currency: c.currency,
          created: c.created,
          status: c.paid ? 'succeeded' : 'requires_payment_method',
          latest_charge: c.id,
          customer: c.customer_id,
          on_behalf_of: c.account_id,
        }));
      return {
        object: 'list' as const,
        url: '/v1/payment_intents',
        has_more: false,
        data: rows,
      };
    },
  );
}

/* ------------------------------ invoicing -------------------------------- */

export interface CreateInvoiceParams {
  customer: string;
  /** Connected account the invoice is raised on. */
  stripe_account?: string;
  collection_method?: 'send_invoice' | 'charge_automatically';
  days_until_due?: number;
  description?: string;
  customer_name?: string;
}

export async function create_invoice(
  ctx: SimContext,
  params: CreateInvoiceParams,
  options: CallOptions = {},
): Promise<SimInvoice> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'create_invoice',
      method: 'POST',
      path: '/v1/invoices',
      stripeAccount: params.stripe_account ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Created a draft invoice for ${params.customer_name ?? params.customer}`,
    () => {
      const invoice: SimInvoice = {
        id: nextId('in'),
        account_id: params.stripe_account ?? PLATFORM_ACCOUNT_ID,
        customer_id: params.customer,
        customer_name: params.customer_name ?? params.customer,
        status: 'draft',
        amount_due: 0,
        currency: CURRENCY,
        created: NOW,
        hosted_invoice_url: null,
        lines: [],
      };
      ctx.record({
        kind: 'insert',
        table: 'invoices',
        row: invoice as unknown as Record<string, unknown>,
      });
      return invoice;
    },
  );
}

export interface CreateInvoiceItemParams {
  customer: string;
  invoice: string;
  amount: number;
  currency: string;
  description: string;
  quantity?: number;
  stripe_account?: string;
}

export async function create_invoice_item(
  ctx: SimContext,
  params: CreateInvoiceItemParams,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'create_invoice_item',
      method: 'POST',
      path: '/v1/invoiceitems',
      stripeAccount: params.stripe_account ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Added "${params.description}" to ${params.invoice}`,
    () => {
      const invoice = ctx.data.invoices.find((i) => i.id === params.invoice);
      const quantity = params.quantity ?? 1;
      const lineTotal = params.amount * quantity;
      if (invoice) {
        ctx.record({
          kind: 'patch',
          table: 'invoices',
          match: { id: invoice.id },
          patch: {
            amount_due: invoice.amount_due + lineTotal,
            lines: [
              ...invoice.lines,
              { description: params.description, amount: params.amount, quantity },
            ],
          },
        });
      }
      return {
        id: nextId('ii'),
        object: 'invoiceitem',
        amount: lineTotal,
        currency: params.currency,
        customer: params.customer,
        description: params.description,
        invoice: params.invoice,
        quantity,
      };
    },
  );
}

export interface FinalizeInvoiceParams {
  invoice: string;
  auto_advance?: boolean;
  stripe_account?: string;
}

export async function finalize_invoice(
  ctx: SimContext,
  params: FinalizeInvoiceParams,
  options: CallOptions = {},
): Promise<SimInvoice> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'finalize_invoice',
      method: 'POST',
      path: `/v1/invoices/${params.invoice}/finalize`,
      stripeAccount: params.stripe_account ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Finalized ${params.invoice}`,
    () => {
      const invoice = ctx.data.invoices.find((i) => i.id === params.invoice);
      if (!invoice) throw new Error(`No such invoice: ${params.invoice}`);
      const url = `https://invoice.stripe.com/i/sim_${invoice.id.slice(3, 15)}`;
      ctx.record({
        kind: 'patch',
        table: 'invoices',
        match: { id: invoice.id },
        patch: { status: 'open', hosted_invoice_url: url },
      });
      return { ...invoice, status: 'open' as const, hosted_invoice_url: url };
    },
  );
}

/* --------------------------- payment links ------------------------------- */

export interface CreatePaymentLinkParams {
  line_items: { price_data: { unit_amount: number; currency: string; product_data: { name: string } }; quantity: number }[];
  stripe_account?: string;
  restrictions?: { completed_sessions?: { limit: number } } | null;
  allow_promotion_codes?: boolean;
  metadata?: Record<string, string>;
}

export async function create_payment_link(
  ctx: SimContext,
  params: CreatePaymentLinkParams,
  options: CallOptions = {},
): Promise<SimPaymentLink> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'create_payment_link',
      method: 'POST',
      path: '/v1/payment_links',
      stripeAccount: params.stripe_account ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Created a payment link for ${params.line_items[0]?.price_data.product_data.name ?? 'a new price'}`,
    () => {
      const first = params.line_items[0];
      const link: SimPaymentLink = {
        id: nextId('plink'),
        account_id: params.stripe_account ?? PLATFORM_ACCOUNT_ID,
        url: `https://buy.stripe.com/sim_${nextId('x', 10).slice(2)}`,
        active: true,
        created: NOW,
        line_description: first?.price_data.product_data.name ?? 'Ticket',
        unit_amount: first?.price_data.unit_amount ?? 0,
        restrictions: params.restrictions
          ? `Limited to ${params.restrictions.completed_sessions?.limit ?? 0} completed sessions`
          : null,
      };
      ctx.record({
        kind: 'insert',
        table: 'payment_links',
        row: link as unknown as Record<string, unknown>,
      });
      return link;
    },
  );
}

/* ------------------------------ balance ---------------------------------- */

export interface RetrieveBalanceParams {
  stripe_account?: string;
}

export async function retrieve_balance(
  ctx: SimContext,
  params: RetrieveBalanceParams = {},
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'retrieve_balance',
      method: 'GET',
      path: '/v1/balance',
      stripeAccount: params.stripe_account ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    params.stripe_account
      ? `Read the balance for ${params.stripe_account}`
      : 'Read the platform balance',
    () => {
      const row = params.stripe_account
        ? ctx.index.balanceById.get(params.stripe_account)
        : ctx.data.platform_balances[0];
      const available = row?.available ?? 0;
      const pending = row?.pending ?? 0;
      return {
        object: 'balance',
        livemode: false,
        available: [{ amount: available, currency: CURRENCY, source_types: { card: available } }],
        pending: [{ amount: pending, currency: CURRENCY, source_types: { card: pending } }],
        instant_available: [
          {
            amount: Math.max(0, Math.round(available * 0.9)),
            currency: CURRENCY,
          },
        ],
      };
    },
  );
}

/* --------------------------- search & fetch ------------------------------ */

export type SearchableResource =
  | 'charges'
  | 'disputes'
  | 'customers'
  | 'accounts'
  | 'refunds';

export interface SearchStripeResourcesParams {
  resource: SearchableResource;
  query: string;
  limit?: number;
}

export async function search_stripe_resources(
  ctx: SimContext,
  params: SearchStripeResourcesParams,
  options: CallOptions = {},
): Promise<SimListResponse<Record<string, unknown>>> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'search_stripe_resources',
      method: 'GET',
      path: `/v1/${params.resource}/search`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Searched ${params.resource} for "${params.query}"`,
    () => {
      const limit = params.limit ?? 10;
      const needle = params.query.toLowerCase();
      const matches = (value: unknown) =>
        JSON.stringify(value ?? '').toLowerCase().includes(needle);

      let rows: Record<string, unknown>[] = [];
      if (params.resource === 'charges') {
        rows = ctx.data.charges.filter(matches).slice(0, limit) as unknown as Record<string, unknown>[];
      } else if (params.resource === 'disputes') {
        rows = ctx.data.disputes.filter(matches).slice(0, limit) as unknown as Record<string, unknown>[];
      } else if (params.resource === 'accounts') {
        rows = ctx.data.accounts.filter(matches).slice(0, limit) as unknown as Record<string, unknown>[];
      } else if (params.resource === 'refunds') {
        rows = ctx.data.refunds.filter(matches).slice(0, limit) as unknown as Record<string, unknown>[];
      } else {
        const seen = new Set<string>();
        for (const charge of ctx.data.charges) {
          if (seen.has(charge.customer_id)) continue;
          if (!matches(charge.customer_id) && !matches(charge.card_fingerprint)) continue;
          seen.add(charge.customer_id);
          rows.push({
            id: charge.customer_id,
            object: 'customer',
            card_fingerprint: charge.card_fingerprint,
          });
          if (rows.length >= limit) break;
        }
      }

      return {
        object: 'list' as const,
        url: `/v1/${params.resource}/search`,
        has_more: false,
        data: rows,
      };
    },
  );
}

export interface FetchStripeResourcesParams {
  resource: SearchableResource | 'balance_transactions' | 'transfers';
  id: string;
}

export async function fetch_stripe_resources(
  ctx: SimContext,
  params: FetchStripeResourcesParams,
  options: CallOptions = {},
): Promise<Record<string, unknown> | null> {
  return perform(
    ctx,
    {
      surface: 'mcp',
      name: 'fetch_stripe_resources',
      method: 'GET',
      path: `/v1/${params.resource}/${params.id}`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Fetched ${params.resource} ${params.id}`,
    () => {
      const table = (ctx.data as unknown as Record<string, Record<string, unknown>[]>)[
        params.resource
      ];
      if (!table) return null;
      return table.find((row) => row.id === params.id) ?? null;
    },
  );
}

/** Extra fee applied by an instant payout, used by the organizer scenario. */
export const INSTANT_PAYOUT_FEE_RATE = PRICING.instantPayoutPercent;
