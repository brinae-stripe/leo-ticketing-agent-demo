import { DAY, NOW } from './constants';
import type { SimIndex } from './dataset';
import type {
  Account,
  PlatformEvent,
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

  // The float: balances held for organizers with an event still to come.
  //
  // Not scaled, because of what it is rendered next to — the count of organizers
  // behind it, the stored balances of the ones enrolled, and a list of named
  // accounts. Multiplying only the money gave a card reading "$41,644,778 across
  // 58 organizers", which is a platform-scale total propped against a
  // cohort-scale count and implies an average float of $718,000 an organizer.
  // The treasury_float scenario states the platform extrapolation explicitly,
  // which is the right place for it.
  let floatTotal = 0;
  let floatOrganizers = 0;
  for (const balance of data.account_balances) {
    const account = index.accountById.get(balance.account_id);
    if (!account?.metadata.next_event_date) continue;
    if (balance.available <= 0) continue;
    floatTotal += balance.available + balance.pending;
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

/* -------------------------------------------------------------------------- */
/* Funding outlook                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Will the money be there when the bill is?
 *
 * The projection walks obligations in due-date order against funds reachable on
 * that date, and reports the first point where it does not add up.
 *
 * ## Why a gap exists at all
 *
 * Event costs are front-loaded; ticket revenue is not. And for an organizer who
 * settles after the event, the platform is holding the revenue from the very
 * event they are paying suppliers to stage — a cancelled show means refunding
 * buyers out of money the organizer would otherwise have spent. So bills due
 * before doors open have to come out of the last event's money, not this one's.
 * That is the same hold the platform-side float page measures, seen from the
 * organizer's side.
 *
 * ## What this can and cannot see
 *
 * Funds on Stripe: balance, stored balance, and ticket revenue arriving on
 * Stripe. An organizer's working capital mostly sits in their own bank, which
 * this dataset does not model and the agent has no access to. A shortfall here
 * is a prompt to check, never a verdict, and the copy says so.
 */

/** Far enough out to act on, near enough to matter. */
const SHORTFALL_HORIZON_DAYS = 21;

/**
 * Minimum shortfall, as a share of the obligation that triggers it.
 *
 * Being $200 short on a $400,000 deposit is a rounding difference in a forecast
 * built on a trailing average, not a finding. This keeps the card off the page
 * unless the number would actually change a decision.
 */
const SHORTFALL_MATERIALITY = 0.15;

/**
 * Smallest gap worth a card, in cents.
 *
 * The proportional test alone passes a $550 shortfall on an $800 print bill,
 * which is true and useless: it is not a financing decision, and putting it next
 * to the offer of a $7,000 advance makes the agent look like it cannot judge
 * scale. Organizers on this platform range from a comedy room taking $64,000 a
 * year to a festival taking $9.5M, so the test has to be both — a gap has to be
 * a real share of the bill *and* big enough to be worth someone's afternoon.
 */
const SHORTFALL_FLOOR = 1_000_00;

/** Days after an event that Marquee's settlement run debits the service fee. */
const SERVICE_FEE_TERMS_DAYS = 4;

/**
 * Whole days between two instants, counted the way a calendar counts them.
 *
 * "Due in N days" sits next to a printed date, and the two have to agree. A
 * fractional difference does not give you that: a bill due at midnight tomorrow
 * is six hours away, which rounds to nought and reads as though it were already
 * late. Dates render in UTC (see `format.ts`), so both instants are floored to
 * UTC midnight and the difference taken between the days themselves.
 */
function calendarDaysUntil(ts: number): number {
  const day = (at: number) => Math.floor(at / DAY);
  return day(ts) - day(NOW);
}

export type ObligationKind = 'vendor_bill' | 'service_fee';

export interface Obligation {
  id: string;
  kind: ObligationKind;
  label: string;
  counterparty: string | null;
  amount: number;
  dueDate: number;
}

export interface FundingShortfall {
  /**
   * The obligation whose due date the projection first falls short at.
   *
   * Not necessarily the one that caused it. Bills are walked in date order
   * against a running total, so a $250 print bill can be the row that tips a
   * stack built mostly by a venue deposit a week earlier. `obligations` below is
   * the whole stack due by this date, and `largest` is the one worth naming —
   * headlining the tipping row produced cards reading "$500 is due in 16 days —
   * funds come up $1,470 short", where the shortfall exceeds the bill it is
   * supposedly about.
   */
  obligation: Obligation;
  /** Everything due on or before `obligation.dueDate`, in date order. */
  obligations: Obligation[];
  /** The biggest of those, which is the one a person would act on. */
  largest: Obligation;
  dueInDays: number;
  /** Funds projected to be reachable on the due date. */
  projectedFunds: number;
  /** Everything due on or before that date. */
  cumulativeDue: number;
  amount: number;
  /** True when the gap is caused by revenue being held until the event. */
  heldByPreEventHold: boolean;
}

export interface FundingOutlook {
  nextEvent: PlatformEvent | null;
  settlesPostEvent: boolean;
  /** Stripe balance plus stored balance, at platform scale. */
  reachableNow: number;
  dailyRevenue: number;
  obligations: Obligation[];
  obligationsTotal: number;
  shortfall: FundingShortfall | null;
  /** Reachable funds divided by average daily outflow. */
  bufferDays: number | null;
}

export function fundingOutlook(
  data: SimDataset,
  index: SimIndex,
  accountId: string,
): FundingOutlook | null {
  const account = index.accountById.get(accountId);
  if (!account) return null;

  const balance = index.balanceById.get(accountId);
  const financialAccount = data.treasury_financial_accounts.find(
    (a) => a.account_id === accountId && a.status === 'open',
  );

  // Pending is excluded: it has not settled, so it is not reachable today.
  const reachableNow =
    Math.max(0, balance?.available ?? 0) +
    Math.max(0, (financialAccount?.balance_cash ?? 0) - (financialAccount?.balance_outbound_pending ?? 0));

  const dailyRevenue = Number(account.metadata.trailing_volume) / 90;
  const settlesPostEvent = account.metadata.settlement_mode === 'post_event';

  const nextEvent =
    (index.eventsByAccount.get(accountId) ?? [])
      .filter((event) => event.status === 'on_sale' && event.starts_at > NOW)
      .sort((a, b) => a.starts_at - b.starts_at)[0] ?? null;

  /* ---------------------------- obligations ------------------------------ */

  const obligations: Obligation[] = [];

  for (const bill of data.vendor_bills) {
    if (bill.account_id !== accountId || bill.status === 'paid') continue;
    obligations.push({
      id: bill.id,
      kind: 'vendor_bill',
      label: bill.description,
      counterparty: bill.vendor_name,
      amount: bill.amount,
      dueDate: bill.due_date,
    });
  }

  // Service fees are debited in the settlement run a few days after the event
  // they belong to, not on the event date itself.
  for (const row of data.service_fee_ledger) {
    if (row.account_id !== accountId || row.settled) continue;
    obligations.push({
      id: `${row.account_id}:${row.event_id}`,
      kind: 'service_fee',
      label: 'Marquee service fee',
      counterparty: null,
      amount: row.fee_owed,
      dueDate: row.period_end + SERVICE_FEE_TERMS_DAYS * DAY,
    });
  }

  // Payments already in flight are deliberately *not* obligations.
  //
  // They are the same money as `balance_outbound_pending`, which `reachableNow`
  // above has already subtracted, so listing them here subtracted them twice.
  // That is what produced the card reporting a staging payment "due in 0 days"
  // against an organizer who was not in fact short: the gap was the double
  // count. Money leaving reduces what you can reach; it is not also a bill
  // waiting to be paid.

  obligations.sort((a, b) => a.dueDate - b.dueDate);

  /* ----------------------------- projection ------------------------------ */

  const fundsAt = (ts: number) => {
    if (settlesPostEvent && nextEvent && ts < nextEvent.starts_at) return reachableNow;
    return reachableNow + dailyRevenue * Math.max(0, (ts - NOW) / DAY);
  };

  /**
   * Only obligations still ahead of us.
   *
   * Something already past due is a collections problem, not a forecast, and
   * reporting it as "due in 0 days" is simply wrong. Overdue service fees are
   * the settlement page's business.
   */
  const upcoming = obligations.filter((o) => o.dueDate >= NOW);
  let cumulative = 0;
  let shortfall: FundingShortfall | null = null;
  for (const [index, obligation] of upcoming.entries()) {
    cumulative += obligation.amount;
    const dueInDays = calendarDaysUntil(obligation.dueDate);
    if (dueInDays > SHORTFALL_HORIZON_DAYS) break;

    const projectedFunds = fundsAt(obligation.dueDate);
    const gap = cumulative - projectedFunds;
    if (gap <= 0) continue;
    if (gap < SHORTFALL_FLOOR) continue;
    // Measured against the whole stack due by this date, not just the row that
    // tipped it — that is what the organizer has to find the money for.
    if (gap < cumulative * SHORTFALL_MATERIALITY) continue;

    const stack = upcoming.slice(0, index + 1);
    shortfall = {
      obligation,
      obligations: stack,
      largest: stack.reduce((a, b) => (b.amount > a.amount ? b : a)),
      dueInDays: Math.max(0, dueInDays),
      projectedFunds,
      cumulativeDue: cumulative,
      amount: gap,
      heldByPreEventHold:
        settlesPostEvent && nextEvent != null && obligation.dueDate < nextEvent.starts_at,
    };
    break;
  }

  /* ------------------------------- buffer -------------------------------- */

  // Average daily outflow over the trailing quarter, from money that actually
  // left: posted vendor payments and approved card spend.
  const since = NOW - 90 * DAY;
  const outflow =
    data.treasury_outbound_payments
      .filter((p) => p.account_id === accountId && p.status === 'posted' && p.created >= since)
      .reduce((sum, p) => sum + p.amount, 0) +
    data.issuing_authorizations
      .filter((a) => a.account_id === accountId && a.approved && a.created >= since)
      .reduce((sum, a) => sum + a.amount, 0);
  const dailyOutflow = outflow / 90;

  return {
    nextEvent,
    settlesPostEvent,
    reachableNow,
    dailyRevenue,
    obligations,
    obligationsTotal: obligations.reduce((sum, o) => sum + o.amount, 0),
    shortfall,
    bufferDays: dailyOutflow > 0 ? reachableNow / dailyOutflow : null,
  };
}
