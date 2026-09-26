/**
 * Calibration harness for the seeded dataset.
 *
 * Not part of the app or the build — this is the tool used to tune the
 * generator until the sampled data actually lands on the aggregate targets
 * documented in lib/sim/constants.ts.
 *
 * Run it with:
 *   npx tsc -p tsconfig.verify.json && node .tmp-verify/scripts/verify-dataset.js
 */

import { FIXTURES, NOW, DAY, SCALE_FACTOR, TARGETS } from '../lib/sim/constants';
import { generateDataset } from '../lib/sim/generate';

const started = Date.now();
const data = generateDataset();
const elapsed = Date.now() - started;

const charges = data.charges;
const paid = charges.filter((c) => c.paid);
const rate = (n: number, d: number) => (d === 0 ? 0 : n / d);
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function row(label: string, actual: string, target: string, ok: boolean) {
  const flag = ok ? 'ok  ' : 'MISS';
  console.log(`  ${flag} ${label.padEnd(42)} ${actual.padStart(12)}   target ${target}`);
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log(`\ngenerated in ${elapsed}ms\n`);

console.log('row counts');
for (const [name, rows] of Object.entries(data)) {
  console.log(`  ${name.padEnd(38)} ${String((rows as unknown[]).length).padStart(8)}`);
}

console.log('\naggregate targets');

const successRate = rate(paid.length, charges.length);
row('payment success rate', pct(successRate), pct(TARGETS.paymentSuccessRate), near(successRate, TARGETS.paymentSuccessRate, 0.002));

const blockRate = rate(charges.filter((c) => c.outcome_type === 'blocked').length, charges.length);
row('block rate', pct(blockRate), pct(TARGETS.blockRate), near(blockRate, TARGETS.blockRate, 0.002));

const walletAttempts = charges.filter(
  (c) => c.card_wallet_type === 'apple_pay' || c.card_wallet_type === 'google_pay',
).length;
const walletShare = rate(walletAttempts, charges.length);
row('wallet share of attempts (Apple + Google)', pct(walletShare), pct(TARGETS.walletShareOfAttempts), near(walletShare, TARGETS.walletShareOfAttempts, 0.01));

const linkShare = rate(paid.filter((c) => c.card_wallet_type === 'link').length, paid.length);
row('Link share of transactions', pct(linkShare), pct(TARGETS.linkShareOfTransactions), near(linkShare, TARGETS.linkShareOfTransactions, 0.015));

const cpShare = rate(
  charges.filter((c) => c.payment_method_details_type === 'card_present').length,
  charges.length,
);
row('card-present share of attempts', pct(cpShare), pct(TARGETS.cardPresentShareOfAttempts), near(cpShare, TARGETS.cardPresentShareOfAttempts, 0.015));

const paidVolume = paid.reduce((s, c) => s + c.amount, 0);
const bnplVolume = paid
  .filter((c) => ['klarna', 'affirm', 'afterpay_clearpay'].includes(c.payment_method_details_type))
  .reduce((s, c) => s + c.amount, 0);
const bnplShare = rate(bnplVolume, paidVolume);
row('BNPL share of volume', pct(bnplShare), `< ${pct(TARGETS.bnplShareOfVolume)}`, bnplShare < TARGETS.bnplShareOfVolume);

const disputeRate = rate(data.disputes.length, paid.length);
row('dispute rate', pct(disputeRate), pct(TARGETS.disputeRate), near(disputeRate, TARGETS.disputeRate, 0.0004));

const nonUs = charges.filter((c) => c.card_country !== 'US');
const nonUsShare = rate(nonUs.length, charges.length);
row('non-US card share', pct(nonUsShare), pct(TARGETS.nonUsCardShare), near(nonUsShare, TARGETS.nonUsCardShare, 0.02));

const us = charges.filter((c) => c.card_country === 'US');
const usConv = rate(us.filter((c) => c.paid).length, us.length);
const nonUsConv = rate(nonUs.filter((c) => c.paid).length, nonUs.length);
const gap = (usConv - nonUsConv) * 100;
row('non-US conversion gap (pts)', gap.toFixed(2), `~${TARGETS.nonUsConversionGapPts}`, near(gap, TARGETS.nonUsConversionGapPts, 1.2));

const credit = charges.filter((c) => c.card_funding === 'credit');
const debit = charges.filter((c) => c.card_funding === 'debit');
const debitGap =
  (rate(credit.filter((c) => c.paid).length, credit.length) -
    rate(debit.filter((c) => c.paid).length, debit.length)) *
  100;
row('debit conversion gap (pts)', debitGap.toFixed(2), `~${TARGETS.debitConversionGapPts}`, near(debitGap, TARGETS.debitConversionGapPts, 1.0));

const outdated = rate(
  charges.filter((c) => c.outcome_reason === 'expired_card' || c.outcome_reason === 'incorrect_number').length,
  charges.length,
);
row('outdated card details declines', pct(outdated), pct(TARGETS.outdatedCardDetailsDeclineRate), near(outdated, TARGETS.outdatedCardDetailsDeclineRate, 0.0015));

console.log('\nscenario fixtures');

const refundedIds = new Set(data.refunds.map((r) => r.charge_id));
const disputedIds = new Set(data.disputes.map((d) => d.charge_id));

const dueSoon = data.disputes.filter(
  (d) => d.status === 'needs_response' && d.evidence_due_by > NOW && d.evidence_due_by <= NOW + 3 * DAY,
).length;
row('disputes due within 72h', String(dueSoon), String(FIXTURES.disputesDueWithin72h), dueSoon === FIXTURES.disputesDueWithin72h);

const refundableEfws = data.early_fraud_warnings.filter(
  (w) => w.actionable && !refundedIds.has(w.charge_id) && !disputedIds.has(w.charge_id),
).length;
row('actionable EFWs still refundable', String(refundableEfws), String(FIXTURES.actionableEfwsUnrefunded), refundableEfws === FIXTURES.actionableEfwsUnrefunded);

const openReviews = data.reviews.filter((r) => r.open).length;
row('open reviews', String(openReviews), String(FIXTURES.openReviews), openReviews === FIXTURES.openReviews);

const upcoming = new Set(
  data.events.filter((e) => e.starts_at > NOW && e.starts_at <= NOW + 14 * DAY && e.status === 'on_sale').map((e) => e.account_id),
);
const blockedHosts = data.accounts.filter((a) => !a.payouts_enabled && upcoming.has(a.id)).length;
row('hosts w/ event in 14d, payouts disabled', String(blockedHosts), `~${FIXTURES.hostsBlockedFromPayouts}`, blockedHosts >= 8);

const negative = data.account_balances.filter((b) => b.available < 0).length;
row('hosts with negative balance', String(negative), String(FIXTURES.negativeBalanceHosts), negative === FIXTURES.negativeBalanceHosts);

const cancelEvent = data.events.find((e) => e.name.includes('Autumn Sessions'));
const cancelCharges = charges.filter((c) => c.metadata.event_id === cancelEvent?.id).length;
row('charges on the event to cancel', String(cancelCharges), String(FIXTURES.cancellingEventChargeCount), cancelCharges === FIXTURES.cancellingEventChargeCount);

const offline = data.terminal_readers.filter((r) => r.status === 'offline').length;
row('offline readers (all hosts)', String(offline), '>= 4', offline >= 4);

console.log('\nfee movement (what the fee explainer narrates)');

// Effective *Stripe* cost only. StageGate's own application fee is revenue, not
// cost, so it is excluded — otherwise week-to-week swings in which hosts are on
// on-charge billing would drown out the real signal.
const stripeFeeByBt = new Map<string, number>();
for (const detail of data.balance_transaction_fee_details) {
  if (detail.type !== 'stripe_fee') continue;
  stripeFeeByBt.set(
    detail.balance_transaction_id,
    (stripeFeeByBt.get(detail.balance_transaction_id) ?? 0) + detail.amount,
  );
}

function effectiveFee(from: number, to: number) {
  let gross = 0;
  let processing = 0;
  let disputeFees = 0;
  let intlCount = 0;
  let count = 0;
  for (const bt of data.balance_transactions) {
    if (bt.created < from || bt.created >= to) continue;
    const stripeFee = stripeFeeByBt.get(bt.id) ?? 0;
    if (bt.reporting_category === 'charge') {
      gross += bt.amount;
      processing += stripeFee;
      count += 1;
      const charge = charges.find((c) => c.id === bt.source_id);
      if (charge && charge.card_country !== 'US') intlCount += 1;
    } else if (bt.reporting_category === 'dispute') {
      disputeFees += stripeFee;
    }
  }
  const fees = processing + disputeFees;
  return {
    gross,
    fees,
    processing,
    disputeFees,
    rate: rate(fees, gross),
    intlShare: rate(intlCount, count),
    avgTicket: rate(gross, count),
  };
}

const lastWeek = effectiveFee(NOW - 7 * DAY, NOW);
const priorWeek = effectiveFee(NOW - 14 * DAY, NOW - 7 * DAY);
const fmt = (w: typeof lastWeek) =>
  `gross $${(w.gross / 100).toFixed(0).padStart(8)}  effective ${pct(w.rate)}  intl ${pct(w.intlShare)}  avg ticket $${(w.avgTicket / 100).toFixed(2)}  dispute fees $${(w.disputeFees / 100).toFixed(0)}`;
console.log(`  prior week  ${fmt(priorWeek)}`);
console.log(`  last week   ${fmt(lastWeek)}`);
const movement = (lastWeek.rate - priorWeek.rate) * 10000;
console.log(
  `  movement    ${movement.toFixed(1)} bps  ${movement > 8 ? '(ok — fee went up)' : '(MISS — scenario needs a rise of 8bps+)'}`,
);

console.log('\nscenario inputs');

const aquarium = data.accounts.find((a) => a.business_profile_name === FIXTURES.offlineReaderVenue)!;
const aquariumReaders = data.terminal_readers.filter((r) => r.account_id === aquarium.id);
row(
  `${FIXTURES.offlineReaderVenue} readers (offline)`,
  `${aquariumReaders.length} (${aquariumReaders.filter((r) => r.status === 'offline').length})`,
  '9 (4)',
  aquariumReaders.length === 9 && aquariumReaders.filter((r) => r.status === 'offline').length === 4,
);

const lastWeekLedger = data.service_fee_ledger.filter(
  (r) => !r.settled && r.period_end >= NOW - 7 * DAY && r.period_end <= NOW,
);
const owedHosts = new Set(lastWeekLedger.map((r) => r.account_id)).size;
row(
  "hosts owing service fees (last week's events)",
  `${owedHosts} hosts / $${(lastWeekLedger.reduce((s, r) => s + r.fee_owed, 0) / 100).toFixed(0)}`,
  '>= 3 hosts',
  owedHosts >= 3,
);

const platformBalance = data.platform_balances[0];
row(
  'platform available balance',
  `$${(platformBalance.available / 100).toFixed(0)}`,
  '> 0',
  platformBalance.available > 0,
);

const cancelHostBalance = data.account_balances.find(
  (b) => b.account_id === data.accounts.find((a) => a.business_profile_name === 'Riverlight Music Festival')!.id,
)!;
const cancelTotal = charges
  .filter((c) => c.metadata.event_id === cancelEvent?.id && c.paid)
  .reduce((s, c) => s + c.amount, 0);
console.log(
  `  --   refund exposure on the cancelling event  $${(cancelTotal / 100).toFixed(0)}  vs host available $${(cancelHostBalance.available / 100).toFixed(0)}`,
);

const readerHostCount = new Set(data.terminal_readers.map((r) => r.account_id)).size;
console.log(`  --   hosts with card readers  ${readerHostCount}`);

console.log('\nplatform scale');
console.log(`  sampled attempts  ${charges.length.toLocaleString()}`);
console.log(`  implied attempts  ${(charges.length * SCALE_FACTOR).toLocaleString()} (×${SCALE_FACTOR})`);
console.log(`  sampled volume    $${(paidVolume / 100).toLocaleString()}`);
console.log('');
