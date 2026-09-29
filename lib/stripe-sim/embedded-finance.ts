import { CURRENCY, DAY, NOW } from '../sim/constants';
import type {
  CapitalFinancingOffer,
  IssuingCard,
  IssuingCardholder,
  SpendingLimitInterval,
  TreasuryFinancialAccount,
  TreasuryOutboundPayment,
} from '../sim/types';
import { perform } from './core';
import { nextDigits, nextId } from './ids';
import type { CallOptions } from './mcp';
import type { SimContext } from './types';

/**
 * Capital, Treasury and Issuing calls.
 *
 * All direct REST. There is no MCP tool for any of the three today, which is
 * worth stating plainly rather than papering over: the hosted tool surface
 * covers payments, refunds, disputes, invoices and balances, and stops there.
 * Everything in this file is code a platform writes, owns and secures itself.
 *
 * Two of these are reads that exist only so the agent's preview can show what it
 * is about to change. The writes are the ones that need the approval sheet.
 */

/* -------------------------------------------------------------------------- */
/* Capital                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `POST /v1/capital/financing_offers/:id/mark_delivered`
 *
 * Stripe requires a platform to record the moment it surfaced an offer to the
 * connected account. That is not bookkeeping for its own sake — an undelivered
 * offer is one the organizer has never seen, which is a completely different
 * situation from one they looked at and declined, and only the platform knows
 * which happened.
 */
export async function markFinancingOfferDelivered(
  ctx: SimContext,
  offerId: string,
  options: CallOptions = {},
): Promise<CapitalFinancingOffer> {
  const offer = ctx.data.capital_financing_offers.find((o) => o.id === offerId);
  if (!offer) throw new Error(`No such financing offer: ${offerId}`);
  if (offer.status !== 'undelivered') {
    throw new Error(
      `Offer ${offerId} is ${offer.status}, and only an undelivered offer can be marked delivered`,
    );
  }

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Mark financing offer delivered',
      method: 'POST',
      path: `/v1/capital/financing_offers/${offerId}/mark_delivered`,
      // Capital offers are read and marked from the platform account; the offer
      // itself carries the connected account it belongs to.
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    {},
    `Surfaced a financing offer to ${
      ctx.index.accountById.get(offer.account_id)?.business_profile_name ?? offer.account_id
    }`,
    () => {
      ctx.record({
        kind: 'patch',
        table: 'capital_financing_offers',
        match: { id: offerId },
        patch: { status: 'delivered', delivered_at: NOW },
      });
      return { ...offer, status: 'delivered' as const, delivered_at: NOW };
    },
  );
}

/**
 * `POST /v1/account_sessions`
 *
 * The honest boundary in the whole Capital flow. A platform can underwrite
 * nothing and accept nothing — the organizer has to agree to the terms
 * themselves, in a Stripe-hosted surface, because it is their liability. What
 * the platform can do is mint a short-lived session and embed that surface in
 * its own dashboard, so the organizer never leaves.
 *
 * There is no endpoint that accepts an offer on someone else's behalf, and a
 * demo that showed one would be teaching the wrong thing.
 */
export interface AccountSessionParams {
  account: string;
  components: Record<string, { enabled: boolean; features?: Record<string, unknown> }>;
}

export async function createAccountSession(
  ctx: SimContext,
  params: AccountSessionParams,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  const account = ctx.index.accountById.get(params.account);
  if (!account) throw new Error(`No such account: ${params.account}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create account session (embedded component)',
      method: 'POST',
      path: '/v1/account_sessions',
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Opened an embedded Stripe component for ${account.business_profile_name}`,
    () => ({
      object: 'account_session',
      account: params.account,
      // Real client secrets are single-use and expire in minutes.
      client_secret: `_${nextId('accts', 40)}_secret_simulated`,
      components: params.components,
      expires_at: NOW + 3_600,
      livemode: false,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Treasury                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `POST /v1/treasury/financial_accounts`
 *
 * Opens a stored-balance account on a connected account. Requires the
 * `treasury` capability to already be active, which Stripe grants after review —
 * see the Dashboard-only note, because requesting it is not something an agent
 * can do from here.
 */
export interface FinancialAccountParams {
  supported_currencies: string[];
  features: Record<string, { requested: boolean }>;
}

export async function createFinancialAccount(
  ctx: SimContext,
  stripeAccount: string,
  params: FinancialAccountParams,
  options: CallOptions = {},
): Promise<TreasuryFinancialAccount> {
  const account = ctx.index.accountById.get(stripeAccount);
  if (!account) throw new Error(`No such account: ${stripeAccount}`);

  const existing = ctx.data.treasury_financial_accounts.find(
    (a) => a.account_id === stripeAccount && a.status === 'open',
  );
  if (existing) {
    throw new Error(
      `${account.business_profile_name} already has an open financial account (${existing.id})`,
    );
  }

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create Treasury financial account',
      method: 'POST',
      path: '/v1/treasury/financial_accounts',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Opened a stored-balance account for ${account.business_profile_name}`,
    () => {
      const row: TreasuryFinancialAccount = {
        id: nextId('fa', 20),
        account_id: stripeAccount,
        status: 'open',
        active_features: Object.keys(params.features),
        routing_number: '011401533',
        account_number_last4: nextDigits(4),
        // A new financial account starts empty. Funds arrive when the payout
        // destination is switched to it, which is a separate change.
        balance_cash: 0,
        balance_inbound_pending: 0,
        balance_outbound_pending: 0,
        currency: CURRENCY,
        created: NOW,
      };
      ctx.record({
        kind: 'insert',
        table: 'treasury_financial_accounts',
        row: row as unknown as Record<string, unknown>,
      });
      return row;
    },
  );
}

/**
 * `POST /v1/treasury/outbound_payments`
 *
 * Pays a third party out of a stored balance. This is the call that makes a
 * wallet a wallet rather than a holding pen: without it the organizer's only
 * move is a payout to their own bank, and then a wire from there.
 */
export interface OutboundPaymentParams {
  financial_account: string;
  amount: number;
  currency: string;
  description: string;
  destination_payment_method_data: {
    type: 'us_bank_account';
    billing_details: { name: string };
  };
}

export async function createOutboundPayment(
  ctx: SimContext,
  stripeAccount: string,
  params: OutboundPaymentParams,
  options: CallOptions = {},
): Promise<TreasuryOutboundPayment> {
  const financialAccount = ctx.data.treasury_financial_accounts.find(
    (a) => a.id === params.financial_account,
  );
  if (!financialAccount) {
    throw new Error(`No such financial account: ${params.financial_account}`);
  }

  // Available cash, not total cash: money already committed to a payment in
  // flight cannot be committed twice.
  const spendable = financialAccount.balance_cash - financialAccount.balance_outbound_pending;
  if (params.amount > spendable) {
    throw new Error(
      `Outbound payment of ${params.amount} exceeds the ${spendable} available in ${financialAccount.id}`,
    );
  }

  const payeeName = params.destination_payment_method_data.billing_details.name;

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create Treasury outbound payment',
      method: 'POST',
      path: '/v1/treasury/outbound_payments',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Sent ${params.amount} to ${payeeName}`,
    () => {
      const row: TreasuryOutboundPayment = {
        id: nextId('obp', 20),
        financial_account_id: financialAccount.id,
        account_id: stripeAccount,
        amount: params.amount,
        currency: params.currency,
        status: 'processing',
        payee_name: payeeName,
        description: params.description,
        expected_arrival_date: NOW + 2 * DAY,
        created: NOW,
      };
      ctx.record({
        kind: 'insert',
        table: 'treasury_outbound_payments',
        row: row as unknown as Record<string, unknown>,
      });
      // The cash is not gone until it posts, but it is no longer spendable.
      ctx.record({
        kind: 'patch',
        table: 'treasury_financial_accounts',
        match: { id: financialAccount.id },
        patch: {
          balance_outbound_pending:
            financialAccount.balance_outbound_pending + params.amount,
        },
      });
      return row;
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/** `POST /v1/accounts/:id` requesting the card_issuing capability. */
export async function requestCardIssuingCapability(
  ctx: SimContext,
  accountId: string,
  options: CallOptions = {},
): Promise<Record<string, unknown>> {
  const account = ctx.index.accountById.get(accountId);
  if (!account) throw new Error(`No such account: ${accountId}`);

  const params = { capabilities: { card_issuing: { requested: true } } };

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Request card_issuing capability',
      method: 'POST',
      path: `/v1/accounts/${accountId}`,
      stripeAccount: null,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Requested card issuing for ${account.business_profile_name}`,
    () => ({
      id: accountId,
      object: 'account',
      capabilities: {
        // Requested, not active. Stripe reviews the request; a card created
        // before it clears would fail, which is why this is its own step.
        card_issuing: 'pending',
      },
      business_profile: { name: account.business_profile_name },
    }),
  );
}

/** `POST /v1/issuing/cardholders` */
export interface CardholderParams {
  name: string;
  email: string;
  type: 'individual' | 'company';
  billing: { address: Record<string, string> };
  metadata?: Record<string, string>;
}

export async function createCardholder(
  ctx: SimContext,
  stripeAccount: string,
  params: CardholderParams,
  options: CallOptions = {},
): Promise<IssuingCardholder> {
  const account = ctx.index.accountById.get(stripeAccount);
  if (!account) throw new Error(`No such account: ${stripeAccount}`);

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create Issuing cardholder',
      method: 'POST',
      path: '/v1/issuing/cardholders',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Created a cardholder for ${params.name}`,
    () => {
      const row: IssuingCardholder = {
        id: nextId('ich', 20),
        account_id: stripeAccount,
        name: params.name,
        email: params.email,
        role: params.metadata?.role ?? 'Team member',
        type: params.type,
        status: 'active',
        created: NOW,
      };
      ctx.record({
        kind: 'insert',
        table: 'issuing_cardholders',
        row: row as unknown as Record<string, unknown>,
      });
      return row;
    },
  );
}

/**
 * `POST /v1/issuing/cards`
 *
 * Spending controls are set here, at creation, rather than policed afterwards.
 * That is the actual difference between a card and a reimbursement process: a
 * limit and a category allow-list are enforced by the network at authorisation
 * time, so an off-policy purchase is declined instead of discovered.
 */
export interface CardParams {
  cardholder: string;
  currency: string;
  type: 'virtual' | 'physical';
  spending_controls: {
    spending_limits: { amount: number; interval: SpendingLimitInterval }[];
    allowed_categories?: string[];
  };
  metadata?: Record<string, string>;
}

export async function createIssuingCard(
  ctx: SimContext,
  stripeAccount: string,
  params: CardParams,
  options: CallOptions = {},
): Promise<IssuingCard> {
  const cardholder = ctx.data.issuing_cardholders.find((c) => c.id === params.cardholder);
  if (!cardholder) throw new Error(`No such cardholder: ${params.cardholder}`);

  const limit = params.spending_controls.spending_limits[0];

  return perform(
    ctx,
    {
      surface: 'api',
      name: 'Create Issuing card',
      method: 'POST',
      path: '/v1/issuing/cards',
      stripeAccount,
      idempotencyKey: options.idempotencyKey ?? null,
    },
    params,
    `Issued a ${params.type} card to ${cardholder.name}`,
    () => {
      const row: IssuingCard = {
        id: nextId('ic', 20),
        cardholder_id: params.cardholder,
        account_id: stripeAccount,
        last4: nextDigits(4),
        brand: 'Visa',
        type: params.type,
        status: 'active',
        spending_limit_amount: limit?.amount ?? null,
        spending_limit_interval: limit?.interval ?? null,
        allowed_categories: params.spending_controls.allowed_categories ?? [],
        created: NOW,
      };
      ctx.record({
        kind: 'insert',
        table: 'issuing_cards',
        row: row as unknown as Record<string, unknown>,
      });
      return row;
    },
  );
}
