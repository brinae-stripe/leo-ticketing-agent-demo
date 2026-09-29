import { DAY, NOW, SCALE_FACTOR } from './constants';
import type { SimIndex } from './dataset';
import type {
  Account,
  CapitalFinancingOffer,
  CapitalFinancingSummary,
  IssuingAuthorization,
  IssuingCard,
  IssuingCardholder,
  SimDataset,
  TreasuryFinancialAccount,
  TreasuryOutboundPayment,
  TreasuryReceivedCredit,
} from './types';

/**
 * Everything the money pages read, in one place.
 *
 * Kept separate from metrics.ts because these figures are at platform scale
 * while almost everything in metrics.ts is at sample scale. Mixing the two in
 * one module is how you end up with a page that quietly compares a $40,000
 * charge total against a $600,000 advance — so the boundary is the file.
 */

/* -------------------------------------------------------------------------- */
/* Unified activity                                                           */
/* -------------------------------------------------------------------------- */

export type ActivityKind = 'received_credit' | 'outbound_payment' | 'card_spend' | 'advance';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  /** Positive is money in, negative is money out. */
  amount: number;
  description: string;
  counterparty: string | null;
  status: string;
  created: number;
  /** Set for declined card authorisations — nothing moved. */
  declined?: boolean;
}

const KIND_LABELS: Record<ActivityKind, string> = {
  received_credit: 'Received credit',
  outbound_payment: 'Outbound payment',
  card_spend: 'Card spend',
  advance: 'Advance',
};

export function activityKindLabel(kind: ActivityKind): string {
  return KIND_LABELS[kind];
}

/**
 * One timeline across every way money moves in or out of a stored balance.
 *
 * Declined card authorisations are included with `declined` set and a zero-value
 * effect. They did not move money, so they must not affect a running total — but
 * leaving them out entirely would hide the single most useful thing the card
 * controls do, which is refuse things.
 */
export function organizerActivity(
  data: SimDataset,
  accountId: string,
  options: { includeAdvance?: boolean } = {},
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const credit of data.treasury_received_credits) {
    if (credit.account_id !== accountId) continue;
    entries.push({
      id: credit.id,
      kind: 'received_credit',
      amount: credit.amount,
      description: credit.description,
      counterparty: null,
      status: credit.status,
      created: credit.created,
    });
  }

  for (const payment of data.treasury_outbound_payments) {
    if (payment.account_id !== accountId) continue;
    entries.push({
      id: payment.id,
      kind: 'outbound_payment',
      amount: -payment.amount,
      description: payment.description,
      counterparty: payment.payee_name,
      status: payment.status,
      created: payment.created,
    });
  }

  for (const auth of data.issuing_authorizations) {
    if (auth.account_id !== accountId) continue;
    entries.push({
      id: auth.id,
      kind: 'card_spend',
      amount: auth.approved ? -auth.amount : 0,
      description: auth.approved
        ? auth.merchant_category.replace(/_/g, ' ')
        : `Declined — ${auth.merchant_category.replace(/_/g, ' ')} not on the allow-list`,
      counterparty: auth.merchant_name,
      status: auth.approved ? auth.status : 'declined',
      created: auth.created,
      declined: !auth.approved,
    });
  }

  /**
   * The advance is off-ledger for the Event Account.
   *
   * Capital pays out to the connected account's Stripe balance, not into a
   * stored balance — so it is money movement worth seeing on a cross-product
   * timeline, but including it in the Event Account's own activity would mean
   * the column no longer sums to the balance above it. Anyone who adds it up
   * would find a discrepancy, and they would be right.
   */
  const summary = options.includeAdvance
    ? data.capital_financing_summaries.find((s) => s.account_id === accountId)
    : undefined;
  if (summary) {
    entries.push({
      id: summary.offer_id,
      kind: 'advance',
      amount: summary.advance_amount,
      description: 'Event advance paid out',
      counterparty: null,
      status: 'posted',
      created: summary.paid_out_at,
    });
  }

  return entries.sort((a, b) => b.created - a.created);
}

/* -------------------------------------------------------------------------- */
/* One organizer's money                                                      */
/* -------------------------------------------------------------------------- */

export type ProductState = 'active' | 'requested' | 'available' | 'none';

export interface OrganizerMoney {
  account: Account;
  financialAccount: TreasuryFinancialAccount | null;
  credits: TreasuryReceivedCredit[];
  payments: TreasuryOutboundPayment[];
  cardholders: IssuingCardholder[];
  cards: IssuingCard[];
  authorizations: IssuingAuthorization[];
  offer: CapitalFinancingOffer | null;
  advance: CapitalFinancingSummary | null;
  activity: ActivityEntry[];

  /** Cash, less anything already committed to a payment in flight. */
  spendable: number;
  /** What each of the three products is doing on this account. */
  state: { account: ProductState; cards: ProductState; advance: ProductState };
  /** Next date ticket revenue sweeps in, from the payout schedule. */
  nextSettlement: number | null;
  settlementCadence: string;
  /** Approved card spend this calendar month, against the combined ceiling. */
  cardSpendThisMonth: number;
  cardLimitTotal: number;
  declinedCount: number;
  declinedAmount: number;
}

/** The next weekday on the organizer's settlement cadence. */
function nextSettlementFor(account: Account): number | null {
  const interval = account.payout_schedule_interval;
  if (interval === 'manual') return null;
  const step = interval === 'daily' ? DAY : interval === 'weekly' ? 7 * DAY : 30 * DAY;
  // Anchor on the start of today so the answer is a date, not a timestamp.
  const today = Math.floor(NOW / DAY) * DAY;
  return today + step;
}

export function organizerMoney(
  data: SimDataset,
  index: SimIndex,
  accountId: string,
): OrganizerMoney | null {
  const account = index.accountById.get(accountId);
  if (!account) return null;

  const financialAccount =
    data.treasury_financial_accounts.find(
      (a) => a.account_id === accountId && a.status === 'open',
    ) ?? null;

  const credits = data.treasury_received_credits
    .filter((c) => c.account_id === accountId)
    .sort((a, b) => b.created - a.created);
  const payments = data.treasury_outbound_payments
    .filter((p) => p.account_id === accountId)
    .sort((a, b) => b.created - a.created);
  const cardholders = data.issuing_cardholders.filter((c) => c.account_id === accountId);
  const cards = data.issuing_cards.filter((c) => c.account_id === accountId);
  const authorizations = data.issuing_authorizations
    .filter((a) => a.account_id === accountId)
    .sort((a, b) => b.created - a.created);

  const offer =
    data.capital_financing_offers
      .filter((o) => o.account_id === accountId)
      .sort((a, b) => b.created - a.created)[0] ?? null;
  const advance =
    data.capital_financing_summaries.find((s) => s.account_id === accountId) ?? null;

  const cash = financialAccount?.balance_cash ?? 0;
  const committed = financialAccount?.balance_outbound_pending ?? 0;

  // Calendar month, because that is the window a monthly spending limit resets on.
  const monthStart = (() => {
    const d = new Date(NOW * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  })();

  const approved = authorizations.filter((a) => a.approved);
  const declined = authorizations.filter((a) => !a.approved);

  return {
    account,
    financialAccount,
    credits,
    payments,
    cardholders,
    cards,
    authorizations,
    offer,
    advance,
    // Cross-product timeline for the overview page; the Event Account page
    // rebuilds it without the advance so its figures reconcile.
    activity: organizerActivity(data, accountId, { includeAdvance: true }),
    spendable: cash - committed,
    state: {
      account: financialAccount ? 'active' : 'available',
      cards: cards.length > 0 ? 'active' : financialAccount ? 'available' : 'none',
      advance: advance
        ? 'active'
        : offer && (offer.status === 'undelivered' || offer.status === 'delivered')
          ? 'available'
          : 'none',
    },
    nextSettlement: nextSettlementFor(account),
    settlementCadence: account.payout_schedule_interval,
    cardSpendThisMonth: approved
      .filter((a) => a.created >= monthStart)
      .reduce((sum, a) => sum + a.amount, 0),
    cardLimitTotal: cards.reduce((sum, c) => sum + (c.spending_limit_amount ?? 0), 0),
    declinedCount: declined.length,
    declinedAmount: declined.reduce((sum, a) => sum + a.amount, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* The platform's own book                                                    */
/* -------------------------------------------------------------------------- */

export interface AdvanceRow {
  accountId: string;
  organizer: string;
  offerId: string | null;
  status: CapitalFinancingOffer['status'] | 'none';
  offered: number;
  fee: number;
  withholdRate: number;
  expiresAfter: number | null;
  advanced: number;
  remaining: number;
  /** Trailing 90-day volume at platform scale — what the offer was sized on. */
  trailingVolume: number;
}

export interface StoredBalanceRow {
  accountId: string;
  organizer: string;
  financialAccountId: string;
  cash: number;
  inboundPending: number;
  outboundPending: number;
  creditsIn: number;
  paidOut: number;
  openedAt: number;
  cards: number;
}

export interface CardProgramRow {
  accountId: string;
  organizer: string;
  cards: number;
  cardholders: number;
  limitTotal: number;
  approvedSpend: number;
  declinedCount: number;
  declinedAmount: number;
}

export interface PlatformMoney {
  advances: AdvanceRow[];
  storedBalances: StoredBalanceRow[];
  cardProgram: CardProgramRow[];

  /** Offers written but never shown to the organizer. */
  undelivered: AdvanceRow[];
  undeliveredValue: number;
  lapsingSoon: AdvanceRow[];
  offeredTotal: number;
  advancedTotal: number;
  outstandingTotal: number;

  storedCashTotal: number;
  /** Pre-event float across every organizer with an event still to come. */
  floatTotal: number;
  floatOrganizers: number;

  cardLimitTotal: number;
  cardApprovedTotal: number;
  cardDeclinedTotal: number;
  cardDeclinedCount: number;
}

export function platformMoney(data: SimDataset, index: SimIndex): PlatformMoney {
  const name = (id: string) =>
    index.accountById.get(id)?.business_profile_name ?? 'Unknown organizer';

  const summaryByAccount = new Map(
    data.capital_financing_summaries.map((s) => [s.account_id, s]),
  );

  const advances: AdvanceRow[] = data.capital_financing_offers
    .map((offer) => {
      const summary = summaryByAccount.get(offer.account_id);
      return {
        accountId: offer.account_id,
        organizer: name(offer.account_id),
        offerId: offer.id,
        status: offer.status,
        offered: offer.offered_amount,
        fee: offer.fee_amount,
        withholdRate: Number(offer.withhold_rate),
        expiresAfter: offer.expires_after,
        advanced: summary?.advance_amount ?? 0,
        remaining: summary?.remaining_amount ?? 0,
        // Already at platform scale and fixture-corrected.
        trailingVolume: Number(
          index.accountById.get(offer.account_id)?.metadata.trailing_volume ?? 0,
        ),
      };
    })
    .sort((a, b) => b.offered - a.offered);

  const undelivered = advances.filter((a) => a.status === 'undelivered');
  const lapsingSoon = undelivered.filter(
    (a) => a.expiresAfter != null && a.expiresAfter - NOW < 7 * DAY,
  );

  const cardsByAccount = new Map<string, IssuingCard[]>();
  for (const card of data.issuing_cards) {
    const list = cardsByAccount.get(card.account_id) ?? [];
    list.push(card);
    cardsByAccount.set(card.account_id, list);
  }

  const storedBalances: StoredBalanceRow[] = data.treasury_financial_accounts
    .filter((a) => a.status === 'open')
    .map((fa) => ({
      accountId: fa.account_id,
      organizer: name(fa.account_id),
      financialAccountId: fa.id,
      cash: fa.balance_cash,
      inboundPending: fa.balance_inbound_pending,
      outboundPending: fa.balance_outbound_pending,
      creditsIn: data.treasury_received_credits
        .filter((c) => c.account_id === fa.account_id && c.status === 'succeeded')
        .reduce((sum, c) => sum + c.amount, 0),
      paidOut: data.treasury_outbound_payments
        .filter((p) => p.account_id === fa.account_id && p.status === 'posted')
        .reduce((sum, p) => sum + p.amount, 0),
      openedAt: fa.created,
      cards: (cardsByAccount.get(fa.account_id) ?? []).length,
    }))
    .sort((a, b) => b.cash - a.cash);

  const cardProgram: CardProgramRow[] = Array.from(cardsByAccount.entries())
    .map(([accountId, cards]) => {
      const auths = data.issuing_authorizations.filter((a) => a.account_id === accountId);
      const declined = auths.filter((a) => !a.approved);
      return {
        accountId,
        organizer: name(accountId),
        cards: cards.length,
        cardholders: data.issuing_cardholders.filter((c) => c.account_id === accountId).length,
        limitTotal: cards.reduce((sum, c) => sum + (c.spending_limit_amount ?? 0), 0),
        approvedSpend: auths
          .filter((a) => a.approved)
          .reduce((sum, a) => sum + a.amount, 0),
        declinedCount: declined.length,
        declinedAmount: declined.reduce((sum, a) => sum + a.amount, 0),
      };
    })
    .sort((a, b) => b.approvedSpend - a.approvedSpend);

  // The float: balances held for organizers with an event still to come, at
  // platform scale. Same definition the treasury_float scenario uses.
  let floatTotal = 0;
  let floatOrganizers = 0;
  for (const balance of data.account_balances) {
    const account = index.accountById.get(balance.account_id);
    if (!account?.metadata.next_event_date) continue;
    if (balance.available <= 0) continue;
    floatTotal += (balance.available + balance.pending) * SCALE_FACTOR;
    floatOrganizers += 1;
  }

  return {
    advances,
    storedBalances,
    cardProgram,
    undelivered,
    undeliveredValue: undelivered.reduce((sum, a) => sum + a.offered, 0),
    lapsingSoon,
    offeredTotal: advances.reduce((sum, a) => sum + a.offered, 0),
    advancedTotal: advances.reduce((sum, a) => sum + a.advanced, 0),
    outstandingTotal: advances.reduce((sum, a) => sum + a.remaining, 0),
    storedCashTotal: storedBalances.reduce((sum, r) => sum + r.cash, 0),
    floatTotal,
    floatOrganizers,
    cardLimitTotal: cardProgram.reduce((sum, r) => sum + r.limitTotal, 0),
    cardApprovedTotal: cardProgram.reduce((sum, r) => sum + r.approvedSpend, 0),
    cardDeclinedTotal: cardProgram.reduce((sum, r) => sum + r.declinedAmount, 0),
    cardDeclinedCount: cardProgram.reduce((sum, r) => sum + r.declinedCount, 0),
  };
}
