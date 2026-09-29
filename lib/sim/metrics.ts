import { DAY, NOW, QUARTER_START, SCALE_FACTOR, TREND_WEEKS, WEEK } from './constants';
import type { SimIndex } from './dataset';
import type { Charge, SimDataset } from './types';

const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

export interface Kpi {
  id: string;
  label: string;
  value: string;
  raw: number;
  hint: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
  /** Suggested question to send to the agent. */
  ask?: string;
}

/* -------------------------------------------------------------------------- */
/* Derived sets the whole app agrees on                                       */
/* -------------------------------------------------------------------------- */

export function disputesDueWithin(data: SimDataset, hours: number) {
  const cutoff = NOW + hours * 3600;
  return data.disputes
    .filter(
      (d) =>
        d.status === 'needs_response' &&
        d.evidence_due_by > NOW &&
        d.evidence_due_by <= cutoff,
    )
    .sort((a, b) => a.evidence_due_by - b.evidence_due_by);
}

export function refundableEarlyFraudWarnings(data: SimDataset) {
  const refunded = new Set(
    data.refunds.filter((r) => r.status === 'succeeded').map((r) => r.charge_id),
  );
  const disputed = new Set(data.disputes.map((d) => d.charge_id));
  return data.early_fraud_warnings
    .filter(
      (w) => w.actionable && !refunded.has(w.charge_id) && !disputed.has(w.charge_id),
    )
    .sort((a, b) => a.created - b.created);
}

export function openReviews(data: SimDataset) {
  return data.reviews.filter((r) => r.open).sort((a, b) => a.created - b.created);
}

export function organizersBlockedFromPayouts(data: SimDataset) {
  return data.accounts.filter((a) => !a.payouts_enabled);
}

export function organizersWithUpcomingEventAndNoPayouts(data: SimDataset, days = 14) {
  const cutoff = NOW + days * DAY;
  const upcoming = new Map<string, number>();
  for (const event of data.events) {
    if (event.status !== 'on_sale') continue;
    if (event.starts_at <= NOW || event.starts_at > cutoff) continue;
    const current = upcoming.get(event.account_id);
    if (current === undefined || event.starts_at < current) {
      upcoming.set(event.account_id, event.starts_at);
    }
  }
  return data.accounts
    .filter((a) => !a.payouts_enabled && upcoming.has(a.id))
    .map((account) => ({ account, nextEventAt: upcoming.get(account.id)! }))
    .sort((a, b) => a.nextEventAt - b.nextEventAt);
}

export function negativeBalanceOrganizers(data: SimDataset) {
  return data.account_balances
    .filter((b) => b.available < 0)
    .sort((a, b) => a.available - b.available);
}

export function offlineReaders(data: SimDataset) {
  return data.terminal_readers.filter((r) => r.status === 'offline');
}

/* -------------------------------------------------------------------------- */
/* Headline KPIs                                                              */
/* -------------------------------------------------------------------------- */

export interface PlatformTotals {
  attempts: number;
  succeeded: number;
  successRate: number;
  blocked: number;
  blockRate: number;
  volume: number;
  netVolume: number;
  refundedAmount: number;
  averageOrderValue: number;
}

export function platformTotals(data: SimDataset): PlatformTotals {
  let attempts = 0;
  let succeeded = 0;
  let blocked = 0;
  let volume = 0;
  let refunded = 0;

  for (const charge of data.charges) {
    if (charge.created < QUARTER_START) continue;
    attempts += 1;
    if (charge.outcome_type === 'blocked') blocked += 1;
    if (charge.paid) {
      succeeded += 1;
      volume += charge.amount;
      refunded += charge.amount_refunded;
    }
  }

  return {
    attempts,
    succeeded,
    successRate: div(succeeded, attempts),
    blocked,
    blockRate: div(blocked, attempts),
    volume,
    netVolume: volume - refunded,
    refundedAmount: refunded,
    averageOrderValue: div(volume, succeeded),
  };
}

export function overviewKpis(data: SimDataset): Kpi[] {
  const totals = platformTotals(data);
  const dueSoon = disputesDueWithin(data, 72);
  const efws = refundableEarlyFraudWarnings(data);
  const blockedOrganizers = organizersBlockedFromPayouts(data);
  const blockedWithEvents = organizersWithUpcomingEventAndNoPayouts(data, 14);
  const negative = negativeBalanceOrganizers(data);
  const readers = offlineReaders(data);

  return [
    {
      id: 'success_rate',
      label: 'Payment success rate',
      value: `${(totals.successRate * 100).toFixed(1)}%`,
      raw: totals.successRate,
      hint: `${totals.succeeded.toLocaleString()} of ${totals.attempts.toLocaleString()} sampled attempts`,
      tone: totals.successRate >= 0.95 ? 'good' : 'warn',
    },
    {
      id: 'block_rate',
      label: 'Radar block rate',
      value: `${(totals.blockRate * 100).toFixed(2)}%`,
      raw: totals.blockRate,
      hint: `${totals.blocked.toLocaleString()} attempts blocked before the issuer`,
      tone: totals.blockRate <= 0.012 ? 'neutral' : 'warn',
    },
    {
      id: 'disputes_72h',
      label: 'Disputes due in 72h',
      value: String(dueSoon.length),
      raw: dueSoon.length,
      hint: dueSoon.length
        ? `Earliest deadline ${new Date(dueSoon[0].evidence_due_by * 1000)
            .toISOString()
            .slice(5, 10)}`
        : 'Nothing due',
      tone: dueSoon.length > 5 ? 'bad' : dueSoon.length > 0 ? 'warn' : 'good',
      ask: 'What disputes are due in the next 72 hours?',
    },
    {
      id: 'actionable_efws',
      label: 'Refundable fraud warnings',
      value: String(efws.length),
      raw: efws.length,
      hint: 'Actionable, not yet refunded or disputed',
      tone: efws.length > 10 ? 'bad' : efws.length > 0 ? 'warn' : 'good',
      ask: 'Which early fraud warnings are still refundable?',
    },
    {
      id: 'payout_blocked',
      label: 'Organizers unable to pay out',
      value: String(blockedOrganizers.length),
      raw: blockedOrganizers.length,
      hint: `${blockedWithEvents.length} have an event inside 14 days`,
      tone: blockedWithEvents.length > 6 ? 'bad' : 'warn',
      ask: "Which organizers with events in the next 14 days can't be paid out?",
    },
    {
      id: 'negative_balances',
      label: 'Organizers in negative balance',
      value: String(negative.length),
      raw: negative.length,
      hint: negative.length
        ? `Deepest ${(negative[0].available / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
          })}`
        : 'All organizers positive',
      tone: negative.length > 0 ? 'warn' : 'good',
    },
    {
      id: 'offline_readers',
      label: 'Offline card readers',
      value: String(readers.length),
      raw: readers.length,
      hint: 'Last seen more than an hour ago',
      tone: readers.length > 3 ? 'warn' : 'neutral',
      ask: 'Are all readers at Cascade Aquarium online for tomorrow?',
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Trends                                                                     */
/* -------------------------------------------------------------------------- */

export interface WeeklyPoint {
  weekStart: number;
  label: string;
  attempts: number;
  succeeded: number;
  successRate: number;
  blockRate: number;
  volume: number;
  disputes: number;
  effectiveFeeRate: number;
  cardPresent: number;
  wallet: number;
  link: number;
  bnpl: number;
  onlineCard: number;
}

export function weeklyTrend(data: SimDataset, index: SimIndex): WeeklyPoint[] {
  const start = NOW - TREND_WEEKS * WEEK;
  const buckets: WeeklyPoint[] = [];
  const labelFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  for (let i = 0; i < TREND_WEEKS; i += 1) {
    const weekStart = start + i * WEEK;
    buckets.push({
      weekStart,
      label: labelFmt.format(new Date(weekStart * 1000)),
      attempts: 0,
      succeeded: 0,
      successRate: 0,
      blockRate: 0,
      volume: 0,
      disputes: 0,
      effectiveFeeRate: 0,
      cardPresent: 0,
      wallet: 0,
      link: 0,
      bnpl: 0,
      onlineCard: 0,
    });
  }

  const bucketFor = (ts: number): WeeklyPoint | null => {
    const i = Math.floor((ts - start) / WEEK);
    return i >= 0 && i < buckets.length ? buckets[i] : null;
  };

  const blockedPerWeek = new Array<number>(buckets.length).fill(0);
  const feesPerWeek = new Array<number>(buckets.length).fill(0);

  for (const charge of data.charges) {
    const i = Math.floor((charge.created - start) / WEEK);
    if (i < 0 || i >= buckets.length) continue;
    const bucket = buckets[i];
    bucket.attempts += 1;
    if (charge.outcome_type === 'blocked') blockedPerWeek[i] += 1;
    if (!charge.paid) continue;
    bucket.succeeded += 1;
    bucket.volume += charge.amount;
    if (charge.balance_transaction_id) {
      feesPerWeek[i] +=
        index.stripeFeeByBalanceTransaction.get(charge.balance_transaction_id) ?? 0;
    }
    switch (charge.payment_method_details_type) {
      case 'card_present':
        bucket.cardPresent += 1;
        break;
      case 'card':
        bucket.onlineCard += 1;
        if (charge.card_wallet_type === 'link') bucket.link += 1;
        else if (charge.card_wallet_type) bucket.wallet += 1;
        break;
      default:
        bucket.bnpl += 1;
    }
  }

  for (const dispute of data.disputes) {
    const bucket = bucketFor(dispute.created);
    if (bucket) bucket.disputes += 1;
  }

  // Dispute fees belong in the effective-rate numerator too.
  for (const bt of data.balance_transactions) {
    if (bt.reporting_category !== 'dispute') continue;
    const i = Math.floor((bt.created - start) / WEEK);
    if (i < 0 || i >= buckets.length) continue;
    feesPerWeek[i] += index.stripeFeeByBalanceTransaction.get(bt.id) ?? 0;
  }

  buckets.forEach((bucket, i) => {
    bucket.successRate = div(bucket.succeeded, bucket.attempts);
    bucket.blockRate = div(blockedPerWeek[i], bucket.attempts);
    bucket.effectiveFeeRate = div(feesPerWeek[i], bucket.volume);
  });

  return buckets;
}

export interface MixSlice {
  key: string;
  label: string;
  attempts: number;
  succeeded: number;
  volume: number;
  share: number;
  conversion: number;
}

export function paymentMethodMix(data: SimDataset): MixSlice[] {
  const rows = new Map<string, MixSlice>();
  const ensure = (key: string, label: string) => {
    let row = rows.get(key);
    if (!row) {
      row = { key, label, attempts: 0, succeeded: 0, volume: 0, share: 0, conversion: 0 };
      rows.set(key, row);
    }
    return row;
  };

  let attempts = 0;
  for (const charge of data.charges) {
    attempts += 1;
    let key: string;
    let label: string;
    if (charge.payment_method_details_type === 'card') {
      if (charge.card_wallet_type === 'link') {
        key = 'link';
        label = 'Link';
      } else if (charge.card_wallet_type === 'apple_pay') {
        key = 'apple_pay';
        label = 'Apple Pay';
      } else if (charge.card_wallet_type === 'google_pay') {
        key = 'google_pay';
        label = 'Google Pay';
      } else {
        key = 'card_manual';
        label = 'Card, manually entered';
      }
    } else if (charge.payment_method_details_type === 'card_present') {
      key = 'card_present';
      label = 'Card present';
    } else {
      key = 'bnpl';
      label = 'Pay over time';
    }
    const row = ensure(key, label);
    row.attempts += 1;
    if (charge.paid) {
      row.succeeded += 1;
      row.volume += charge.amount;
    }
  }

  const list = Array.from(rows.values());
  for (const row of list) {
    row.share = div(row.attempts, attempts);
    row.conversion = div(row.succeeded, row.attempts);
  }
  return list.sort((a, b) => b.attempts - a.attempts);
}

export interface OrganizerVolumeRow {
  accountId: string;
  name: string;
  category: string;
  volume: number;
  attempts: number;
  succeeded: number;
  successRate: number;
  disputes: number;
  payoutsEnabled: boolean;
}

export function topOrganizersByVolume(
  data: SimDataset,
  index: SimIndex,
  limit = 10,
): OrganizerVolumeRow[] {
  const disputesByAccount = new Map<string, number>();
  for (const dispute of data.disputes) {
    const charge = index.chargeById.get(dispute.charge_id);
    if (!charge) continue;
    disputesByAccount.set(
      charge.account_id,
      (disputesByAccount.get(charge.account_id) ?? 0) + 1,
    );
  }

  const rows = new Map<string, OrganizerVolumeRow>();
  for (const charge of data.charges) {
    const account = index.accountById.get(charge.account_id);
    if (!account) continue;
    let row = rows.get(charge.account_id);
    if (!row) {
      row = {
        accountId: account.id,
        name: account.business_profile_name,
        category: account.metadata.organizer_category,
        volume: 0,
        attempts: 0,
        succeeded: 0,
        successRate: 0,
        disputes: disputesByAccount.get(account.id) ?? 0,
        payoutsEnabled: account.payouts_enabled,
      };
      rows.set(charge.account_id, row);
    }
    row.attempts += 1;
    if (charge.paid) {
      row.succeeded += 1;
      row.volume += charge.amount - charge.amount_refunded;
    }
  }

  const list = Array.from(rows.values());
  for (const row of list) row.successRate = div(row.succeeded, row.attempts);
  return list.sort((a, b) => b.volume - a.volume).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Per-organizer view                                                              */
/* -------------------------------------------------------------------------- */

export interface OrganizerSummary {
  attempts: number;
  succeeded: number;
  successRate: number;
  volume: number;
  netVolume: number;
  refunds: number;
  disputes: number;
  openDisputes: number;
  averageOrderValue: number;
  walletShare: number;
  linkShare: number;
  cardPresentShare: number;
  bnplShare: number;
  nonUsShare: number;
  nonUsConversion: number;
  usConversion: number;
  debitConversion: number;
  creditConversion: number;
  repeatBuyerShare: number;
  readers: { online: number; offline: number };
  available: number;
  pending: number;
  outstandingServiceFees: number;
}

export function organizerSummary(
  data: SimDataset,
  index: SimIndex,
  accountId: string,
): OrganizerSummary {
  const charges = data.charges.filter((c) => c.account_id === accountId);
  const paid = charges.filter((c) => c.paid);
  const nonUs = charges.filter((c) => c.card_country !== 'US');
  const us = charges.filter((c) => c.card_country === 'US');
  const debit = charges.filter((c) => c.card_funding === 'debit');
  const credit = charges.filter((c) => c.card_funding === 'credit');

  const fingerprints = index.fingerprintCountByAccount.get(accountId) ?? new Map();
  let repeatTransactions = 0;
  for (const [, n] of fingerprints) if (n > 1) repeatTransactions += n;

  const readers = index.readersByAccount.get(accountId) ?? [];
  const balance = index.balanceById.get(accountId);
  const outstanding = data.service_fee_ledger
    .filter((row) => row.account_id === accountId && !row.settled)
    .reduce((sum, row) => sum + row.fee_owed, 0);

  const disputeIds = new Set(
    data.disputes
      .filter((d) => index.chargeById.get(d.charge_id)?.account_id === accountId)
      .map((d) => d.id),
  );
  const organizerDisputes = data.disputes.filter((d) => disputeIds.has(d.id));

  const volume = paid.reduce((s, c) => s + c.amount, 0);
  const refunded = paid.reduce((s, c) => s + c.amount_refunded, 0);

  const wallets = paid.filter(
    (c) => c.card_wallet_type === 'apple_pay' || c.card_wallet_type === 'google_pay',
  ).length;

  return {
    attempts: charges.length,
    succeeded: paid.length,
    successRate: div(paid.length, charges.length),
    volume,
    netVolume: volume - refunded,
    refunds: refunded,
    disputes: organizerDisputes.length,
    openDisputes: organizerDisputes.filter(
      (d) => d.status === 'needs_response' || d.status === 'under_review',
    ).length,
    averageOrderValue: div(volume, paid.length),
    walletShare: div(wallets, paid.length),
    linkShare: div(paid.filter((c) => c.card_wallet_type === 'link').length, paid.length),
    cardPresentShare: div(
      paid.filter((c) => c.payment_method_details_type === 'card_present').length,
      paid.length,
    ),
    bnplShare: div(
      paid.filter((c) =>
        ['klarna', 'affirm', 'afterpay_clearpay'].includes(
          c.payment_method_details_type,
        ),
      ).length,
      paid.length,
    ),
    nonUsShare: div(nonUs.length, charges.length),
    nonUsConversion: div(nonUs.filter((c) => c.paid).length, nonUs.length),
    usConversion: div(us.filter((c) => c.paid).length, us.length),
    debitConversion: div(debit.filter((c) => c.paid).length, debit.length),
    creditConversion: div(credit.filter((c) => c.paid).length, credit.length),
    repeatBuyerShare: div(repeatTransactions, paid.length),
    readers: {
      online: readers.filter((r) => r.status === 'online').length,
      offline: readers.filter((r) => r.status === 'offline').length,
    },
    available: balance?.available ?? 0,
    pending: balance?.pending ?? 0,
    outstandingServiceFees: outstanding,
  };
}

/** Platform-wide figures scaled back up from the 1:100 sample. */
export function scaled(value: number): number {
  return value * SCALE_FACTOR;
}

export type { Charge };
