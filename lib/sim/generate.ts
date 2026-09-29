import { faker } from '@faker-js/faker';

import {
  CURRENCY,
  DAY,
  FIXTURES,
  HOUR,
  NOW,
  PRICING,
  QUARTER_START,
  SCALE_FACTOR,
  SEED,
  TOTAL_ACCOUNTS,
  TOTAL_CHARGES,
} from './constants';
import {
  CARD_BRANDS,
  CATEGORY_PROFILES,
  DECLINE_REASONS,
  DISPUTE_REASONS,
  FRAUD_TYPES,
  GATES,
  HERO_ORGANIZERS,
  MASCOTS,
  NON_US_COUNTRIES,
  PLACE_WORDS,
  READER_DEVICE_TYPES,
} from './catalog';
import { Rng } from './rng';
import type {
  Account,
  AccountBalance,
  Admission,
  BalanceTransaction,
  BalanceTransactionFeeDetail,
  Charge,
  Dispute,
  EarlyFraudWarning,
  OrganizerCategory,
  PaymentMethodConfiguration,
  PaymentMethodType,
  Payout,
  PlatformEvent,
  Refund,
  Review,
  ServiceFeeLedgerRow,
  SimDataset,
  TerminalReader,
  Transfer,
  WalletType,
} from './types';

/* -------------------------------------------------------------------------- */
/* Calibration                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Conversion model.
 *
 * Every attempt gets a quality score `q = adjustment + U(0,1)`. Radar blocks the
 * highest-risk 1.0% outright; of what is left, the lowest-q tail is declined by
 * the issuer until the overall success rate is exactly 95.7%.
 *
 * Because the noise is U(0,1), the gap in conversion between two cohorts comes
 * out equal to the difference in their adjustments, in percentage points. That
 * is what lets us hit "non-US converts ~5 pts worse" and "debit ~2 pts below
 * credit" precisely rather than approximately.
 */
const CONVERSION_ADJUSTMENT = {
  funding: { credit: 0, debit: -0.0195, prepaid: -0.045 },
  nonUsCard: -0.0466,
  cardPresent: 0.012,
  bnpl: 0.012,
  wallet: 0.016,
} as const;

const SUCCESS_COUNT = Math.round(TOTAL_CHARGES * 0.957); // 22,968
const BLOCKED_COUNT = Math.round(TOTAL_CHARGES * 0.01); // 240
const DECLINED_COUNT = TOTAL_CHARGES - SUCCESS_COUNT - BLOCKED_COUNT; // 792
const MANUAL_REVIEW_COUNT = 40;

/** Share of attempts that are in-person box-office sales. */
const CARD_PRESENT_SHARE = 0.1;
/** How strongly box-office selling concentrates in the days around an event. */
const CARD_PRESENT_EVENT_MULTIPLIER = 5;
const CARD_PRESENT_WINDOW = 3; // days before the event doors open
/** Share of attempts paid with a pay-over-time method. */
const BNPL_SHARE = 0.0042;
/** Wallet mix within online card attempts. */
const ONLINE_WALLET_MIX: [WalletType, number][] = [
  ['link', 24.5],
  ['apple_pay', 12.6],
  ['google_pay', 6.4],
  [null, 56.5],
];

/**
 * Baseline non-US card share, and the elevated share in the final week.
 *
 * The jump in the last week is the engine of the "why did our effective fee go
 * up?" story: every international card carries an extra 1.5% cross-border fee,
 * so a ~10 pt swing in mix moves the blended Stripe rate by ~15 bps on its own.
 */
const NON_US_SHARE_BASELINE = 0.122;
const NON_US_SHARE_LAST_WEEK = 0.215;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** T+2 settlement, skipping weekends. */
function availableOn(created: number): number {
  let ts = created + 2 * DAY;
  const day = new Date(ts * 1000).getUTCDay();
  if (day === 6) ts += 2 * DAY;
  if (day === 0) ts += 1 * DAY;
  return ts;
}

function isoDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** Distribute `total` across `weights` exactly, using largest remainder. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const floored = exact.map(Math.floor);
  let remaining = total - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
    floored[order[i % order.length].index] += 1;
  }
  return floored;
}

/** Stripe fee for one charge, in cents. */
function stripeFeeFor(
  amount: number,
  method: PaymentMethodType,
  cardCountry: string,
): number {
  let fee: number;
  if (method === 'card_present') {
    fee = amount * PRICING.cardPresentPercent + PRICING.cardPresentFixed;
  } else if (method === 'card') {
    fee = amount * PRICING.cardPercent + PRICING.cardFixed;
  } else {
    fee = amount * PRICING.bnplPercent + PRICING.bnplFixed;
  }
  if (cardCountry !== 'US' && method !== 'card_present') {
    fee += amount * PRICING.internationalCardPercent;
  }
  return Math.round(fee);
}

/* -------------------------------------------------------------------------- */
/* Generator                                                                  */
/* -------------------------------------------------------------------------- */

export function generateDataset(seed: number = SEED): SimDataset {
  faker.seed(seed);

  // Separate streams so that tweaking one stage perturbs the others as little
  // as possible between builds.
  const rngAccount = new Rng(seed + 1);
  const rngEvent = new Rng(seed + 2);
  const rngCharge = new Rng(seed + 3);
  const rngRisk = new Rng(seed + 4);
  const rngFixture = new Rng(seed + 5);
  const rngLedger = new Rng(seed + 6);

  /* ---------------------------- accounts --------------------------------- */

  const accounts: Account[] = [];
  const accountVolumeWeight = new Map<string, number>();
  const accountCity = new Map<string, string>();

  const categories = Object.keys(CATEGORY_PROFILES) as OrganizerCategory[];
  const usedNames = new Set<string>();

  function pushAccount(
    name: string,
    category: OrganizerCategory,
    city: string,
    volumeMultiplier: number,
    type: 'express' | 'custom',
  ): Account {
    const profile = CATEGORY_PROFILES[category];
    const id = rngAccount.id('acct', 16);
    const settlementMode = rngAccount.bool(0.31) ? 'on_charge' : 'post_event';
    const account: Account = {
      id,
      business_profile_name: name,
      country: 'US',
      type,
      charges_enabled: true,
      payouts_enabled: true,
      requirements_currently_due: [],
      requirements_past_due: [],
      requirements_disabled_reason: null,
      requirements_current_deadline: null,
      payout_schedule_interval: rngAccount.weighted([
        ['daily' as const, 58],
        ['weekly' as const, 34],
        ['monthly' as const, 8],
      ]),
      metadata: {
        organizer_category: category,
        next_event_date: null,
        settlement_mode: settlementMode,
        service_fee_percent: settlementMode === 'on_charge' ? '0.035' : '0.042',
        service_fee_fixed: settlementMode === 'on_charge' ? '125' : '150',
      },
    };
    accounts.push(account);
    accountVolumeWeight.set(id, profile.volumeWeight * volumeMultiplier);
    accountCity.set(id, city);
    usedNames.add(name);
    return account;
  }

  for (const hero of HERO_ORGANIZERS) {
    pushAccount(hero.name, hero.category, hero.city, hero.volumeMultiplier, hero.type);
  }

  while (accounts.length < TOTAL_ACCOUNTS) {
    const category = rngAccount.pick(categories);
    const profile = CATEGORY_PROFILES[category];
    const place = rngAccount.pick(PLACE_WORDS);
    const name =
      category === 'minor_league_sports'
        ? `${place} ${rngAccount.pick(MASCOTS)} ${rngAccount.pick(profile.nameSuffixes)}`
        : `${place} ${rngAccount.pick(profile.nameSuffixes)}`;
    if (usedNames.has(name)) continue;
    pushAccount(
      name,
      category,
      faker.location.city(),
      rngAccount.between(0.35, 1.25),
      rngAccount.bool(0.78) ? 'express' : 'custom',
    );
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const accountByName = new Map(accounts.map((a) => [a.business_profile_name, a]));

  /* ----------------------------- events ---------------------------------- */

  const events: PlatformEvent[] = [];

  /** Festival season bias: events cluster into late summer / autumn. */
  function seasonalWeight(ts: number): number {
    const month = new Date(ts * 1000).getUTCMonth(); // 0-11
    const bias = [0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.2, 1.35, 1.4, 1.1, 1.15];
    return bias[month];
  }

  function makeEvent(
    account: Account,
    startsAt: number,
    nameOverride?: string,
    statusOverride?: PlatformEvent['status'],
  ): PlatformEvent {
    const profile = CATEGORY_PROFILES[account.metadata.organizer_category];
    const city = accountCity.get(account.id) ?? 'Chicago';
    const year = new Date(startsAt * 1000).getUTCFullYear();
    const month = new Date(startsAt * 1000).toLocaleString('en-US', {
      month: 'long',
      timeZone: 'UTC',
    });
    const event: PlatformEvent = {
      id: `evt_${rngEvent.string(14)}`,
      account_id: account.id,
      name:
        nameOverride ??
        `${account.business_profile_name} — ${month} ${year}`,
      venue: rngEvent.pick(profile.venues),
      city,
      starts_at: startsAt,
      status: statusOverride ?? (startsAt < NOW ? 'completed' : 'on_sale'),
    };
    events.push(event);
    return event;
  }

  // The event the cancellation scenario operates on.
  const riverlight = accountByName.get('Riverlight Music Festival')!;
  const cancellationEvent = makeEvent(
    riverlight,
    NOW + 12 * DAY + 3 * HOUR,
    'Riverlight Music Festival — Autumn Sessions',
    'on_sale',
  );

  const heroIds = new Set(
    HERO_ORGANIZERS.map((hero) => accountByName.get(hero.name)?.id).filter(
      (id): id is string => Boolean(id),
    ),
  );

  for (const account of accounts) {
    const profile = CATEGORY_PROFILES[account.metadata.organizer_category];
    const [minEvents, maxEvents] = profile.eventsPerQuarter;
    // Hero organizers get richer histories: the per-event trends and the
    // repeat-buyer-across-events signal need more than one show to be worth
    // reading.
    const count = heroIds.has(account.id)
      ? rngEvent.int(Math.max(minEvents, 4), Math.max(maxEvents, 8))
      : rngEvent.int(minEvents, maxEvents);
    for (let i = 0; i < count; i += 1) {
      // Candidate dates span the trailing quarter plus the next ~10 weeks;
      // rejection-sample against the seasonal curve so the calendar looks real.
      let startsAt = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const candidate = Math.round(
          rngEvent.between(QUARTER_START + 3 * DAY, NOW + 72 * DAY),
        );
        if (rngEvent.float() < seasonalWeight(candidate) / 1.4) {
          startsAt = candidate;
          break;
        }
        startsAt = candidate;
      }
      makeEvent(account, startsAt);
    }
  }

  // The reader-readiness scenario asks whether a venue is ready "for tomorrow",
  // so the venue it names needs a session tomorrow to be ready for.
  const readerVenue = accountByName.get(FIXTURES.offlineReaderVenue);
  if (readerVenue) {
    const tomorrow = NOW + 18 * HOUR;
    const label = new Date(tomorrow * 1000).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    makeEvent(
      readerVenue,
      tomorrow,
      `${readerVenue.business_profile_name} — Timed Entry, ${label}`,
      'on_sale',
    );
  }

  // A couple of historical cancellations, so "cancelled" is not a brand-new
  // state the first time someone runs the cancellation scenario.
  const historicalCancellations = rngEvent.sample(
    events.filter((e) => e.status === 'completed' && e.id !== cancellationEvent.id),
    2,
  );
  for (const event of historicalCancellations) event.status = 'cancelled';

  // next_event_date on the account metadata.
  for (const account of accounts) {
    const upcoming = events
      .filter((e) => e.account_id === account.id && e.starts_at > NOW && e.status === 'on_sale')
      .sort((a, b) => a.starts_at - b.starts_at)[0];
    account.metadata.next_event_date = upcoming ? isoDate(upcoming.starts_at) : null;
  }

  /* --------------------------- charge budget ------------------------------ */

  const chargeEvents = events.filter((e) => e.id !== cancellationEvent.id);
  const eventWeights = chargeEvents.map((event) => {
    const accountWeight = accountVolumeWeight.get(event.account_id) ?? 1;
    // Events further in the future have sold fewer tickets so far.
    const maturity =
      event.starts_at <= NOW
        ? 1
        : clamp(1 - (event.starts_at - NOW) / (110 * DAY), 0.12, 1);
    return accountWeight * maturity * rngEvent.between(0.55, 1.5);
  });

  const budget = apportion(
    TOTAL_CHARGES - FIXTURES.cancellingEventChargeCount,
    eventWeights,
  );
  const chargeBudget = new Map<string, number>();
  chargeEvents.forEach((event, i) => chargeBudget.set(event.id, budget[i]));
  chargeBudget.set(cancellationEvent.id, FIXTURES.cancellingEventChargeCount);

  /* ------------------------------ charges -------------------------------- */

  const charges: Charge[] = [];
  /** Reused fingerprints create the repeat-buyer signal. */
  const fingerprintPool = new Map<string, string[]>();

  function fingerprintFor(accountId: string): { fingerprint: string; customer: string; repeat: boolean } {
    const pool = fingerprintPool.get(accountId) ?? [];
    // ~29% of buyers at a given organizer have bought there before.
    if (pool.length > 40 && rngCharge.bool(0.29)) {
      const fingerprint = rngCharge.pick(pool);
      return { fingerprint, customer: `cus_${fingerprint.slice(0, 14)}`, repeat: true };
    }
    const fingerprint = rngCharge.string(16);
    pool.push(fingerprint);
    fingerprintPool.set(accountId, pool);
    return { fingerprint, customer: `cus_${fingerprint.slice(0, 14)}`, repeat: false };
  }

  for (const event of events) {
    const count = chargeBudget.get(event.id) ?? 0;
    if (count === 0) continue;
    const account = accountById.get(event.account_id)!;
    const profile = CATEGORY_PROFILES[account.metadata.organizer_category];

    const windowStart = Math.max(QUARTER_START, event.starts_at - 120 * DAY);
    const windowEnd = Math.min(NOW, event.starts_at);
    const span = Math.max(windowEnd - windowStart, HOUR);

    for (let i = 0; i < count; i += 1) {
      // Ticket sales skew late in the on-sale window.
      const progress = Math.pow(rngCharge.float(), 0.55);
      const created = Math.round(windowStart + progress * span);
      const inLastWeek = created >= NOW - 7 * DAY;

      const nonUsShare = inLastWeek
        ? NON_US_SHARE_LAST_WEEK
        : NON_US_SHARE_BASELINE * (0.6 + profile.internationalBias * 3.2);
      const isNonUs = rngCharge.bool(clamp(nonUsShare, 0.02, 0.4));
      const cardCountry = isNonUs ? rngCharge.weighted(NON_US_COUNTRIES) : 'US';

      // In-person sales only happen at or just before the event itself.
      const nearEvent = event.starts_at - created < CARD_PRESENT_WINDOW * DAY;
      const cardPresentChance =
        nearEvent && event.starts_at <= NOW
          ? profile.cardPresentBias * CARD_PRESENT_EVENT_MULTIPLIER
          : CARD_PRESENT_SHARE * 0.3;

      let method: PaymentMethodType;
      if (rngCharge.bool(clamp(cardPresentChance, 0, 0.85))) {
        method = 'card_present';
      } else if (rngCharge.bool(BNPL_SHARE * (inLastWeek ? 1.9 : 1))) {
        method = rngCharge.weighted<PaymentMethodType>([
          ['klarna', 38],
          ['affirm', 34],
          ['afterpay_clearpay', 28],
        ]);
      } else {
        method = 'card';
      }

      const wallet: WalletType =
        method === 'card' ? rngCharge.weighted(ONLINE_WALLET_MIX) : null;

      const tier = rngCharge.pick(profile.tiers);
      const tierMultiplier = /VIP|Platinum|Front|Club|Premium|Behind|Combo|Feast|Grand/i.test(tier)
        ? rngCharge.between(2.1, 3.4)
        : /Child|Student|Kids|Designated/i.test(tier)
          ? rngCharge.between(0.42, 0.68)
          : rngCharge.between(0.85, 1.25);
      const quantity = rngCharge.weighted([
        [1, 34],
        [2, 41],
        [3, 11],
        [4, 10],
        [6, 4],
      ]);
      const bnplBoost = method === 'card' || method === 'card_present' ? 1 : 2.4;
      const unit = Math.max(
        800,
        Math.round(
          (rngCharge.logNormal(profile.medianTicket, profile.sigma) *
            tierMultiplier *
            bnplBoost) /
            50,
        ) * 50,
      );
      const amount = unit * quantity;

      const { fingerprint, customer } = fingerprintFor(account.id);

      // Risk score: mostly clean traffic with a thin high-risk tail.
      const riskBand = rngRisk.weighted([
        ['low' as const, 70],
        ['mid' as const, 22],
        ['high' as const, 5],
        ['top' as const, 3],
      ]);
      const riskScore =
        riskBand === 'low'
          ? rngRisk.int(1, 20)
          : riskBand === 'mid'
            ? rngRisk.int(21, 50)
            : riskBand === 'high'
              ? rngRisk.int(51, 74)
              : rngRisk.int(75, 99);

      let adjustment = 0;
      const funding = rngCharge.weighted([
        ['credit' as const, 62],
        ['debit' as const, 35],
        ['prepaid' as const, 3],
      ]);
      adjustment += CONVERSION_ADJUSTMENT.funding[funding];
      if (cardCountry !== 'US') adjustment += CONVERSION_ADJUSTMENT.nonUsCard;
      if (method === 'card_present') adjustment += CONVERSION_ADJUSTMENT.cardPresent;
      else if (method !== 'card') adjustment += CONVERSION_ADJUSTMENT.bnpl;
      if (wallet) adjustment += CONVERSION_ADJUSTMENT.wallet;

      const pi = rngCharge.id('pi');
      charges.push({
        id: rngCharge.id('ch'),
        account_id: account.id,
        payment_intent_id: pi,
        created,
        amount,
        currency: CURRENCY,
        status: 'succeeded',
        paid: true,
        captured: true,
        refunded: false,
        amount_refunded: 0,
        disputed: false,
        customer_id: customer,
        card_brand:
          method === 'card' || method === 'card_present'
            ? rngCharge.weighted(CARD_BRANDS)
            : '',
        card_funding: funding,
        card_country: cardCountry,
        card_wallet_type: wallet,
        payment_method_details_type: method,
        card_fingerprint: fingerprint,
        balance_transaction_id: null,
        transfer_id: null,
        transfer_group: `group_${pi.slice(3)}`,
        outcome_type: 'authorized',
        outcome_reason: null,
        outcome_risk_score: riskScore,
        outcome_risk_level: 'normal',
        metadata: {
          event_id: event.id,
          tier,
          quantity: String(quantity),
        },
        // Scratch fields, removed below.
        ...({ _q: adjustment + rngCharge.float() } as object),
      } as Charge);
    }
  }

  /* --------------------- outcome assignment (quotas) --------------------- */

  type Scratch = Charge & { _q: number };
  const scratch = charges as Scratch[];

  // 1. Radar blocks the highest-risk 1.0%.
  const byRisk = scratch
    .map((c, i) => ({ i, score: c.outcome_risk_score, tie: rngRisk.float() }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie);
  const blocked = new Set<number>();
  for (let i = 0; i < BLOCKED_COUNT; i += 1) blocked.add(byRisk[i].i);

  // 2. The lowest-quality tail of what remains is declined by the issuer.
  const survivors = byRisk.slice(BLOCKED_COUNT).map((r) => r.i);
  survivors.sort((a, b) => scratch[a]._q - scratch[b]._q);
  const declined = new Set<number>(survivors.slice(0, DECLINED_COUNT));

  // 3. A handful of authorized charges land in manual review.
  const authorized = survivors.slice(DECLINED_COUNT);
  authorized.sort(
    (a, b) => scratch[b].outcome_risk_score - scratch[a].outcome_risk_score,
  );
  const inReview = new Set<number>(authorized.slice(0, MANUAL_REVIEW_COUNT));

  scratch.forEach((charge, index) => {
    if (blocked.has(index)) {
      charge.status = 'failed';
      charge.paid = false;
      charge.captured = false;
      charge.outcome_type = 'blocked';
      charge.outcome_reason = rngRisk.bool(0.72) ? 'highest_risk_level' : 'rule';
      charge.outcome_risk_level = 'highest';
      charge.transfer_group = null;
    } else if (declined.has(index)) {
      charge.status = 'failed';
      charge.paid = false;
      charge.captured = false;
      charge.outcome_type = 'issuer_declined';
      charge.outcome_reason = rngRisk.weighted(DECLINE_REASONS);
      charge.outcome_risk_level =
        charge.outcome_risk_score >= 65 ? 'elevated' : 'normal';
      charge.transfer_group = null;
    } else if (inReview.has(index)) {
      charge.outcome_type = 'manual_review';
      charge.outcome_risk_level = 'elevated';
      charge.outcome_reason = 'elevated_risk_level';
    } else {
      charge.outcome_risk_level =
        charge.outcome_risk_score >= 65 ? 'elevated' : 'normal';
    }
    delete (charge as Partial<Scratch>)._q;
  });

  const successfulCharges = charges.filter((c) => c.paid);
  const chargeById = new Map(charges.map((c) => [c.id, c]));

  // Index once — several stages below would otherwise re-scan all 24k rows per
  // event, which turns into millions of comparisons.
  const paidChargesByEvent = new Map<string, Charge[]>();
  for (const charge of successfulCharges) {
    const list = paidChargesByEvent.get(charge.metadata.event_id);
    if (list) list.push(charge);
    else paidChargesByEvent.set(charge.metadata.event_id, [charge]);
  }

  /* ------------- balance transactions, fees, transfers ------------------- */

  const balance_transactions: BalanceTransaction[] = [];
  const balance_transaction_fee_details: BalanceTransactionFeeDetail[] = [];
  const transfers: Transfer[] = [];

  /**
   * What Marquee keeps, per charge, before it settles service fees.
   *
   * On-charge organizers: application_fee_amount is taken at charge time, so the
   * platform nets (application fee − Stripe fee) immediately.
   *
   * Post-event organizers: the transfer is net of the Stripe fee only, so processing
   * cost is passed through straight away and the platform nets zero until it
   * bills or debits its service fee after the event. That gap is precisely what
   * the settlement scenario exists to close.
   */
  let platformNet = 0;

  for (const charge of successfulCharges) {
    const account = accountById.get(charge.account_id)!;
    const stripeFee = stripeFeeFor(
      charge.amount,
      charge.payment_method_details_type,
      charge.card_country,
    );
    const applicationFee =
      account.metadata.settlement_mode === 'on_charge'
        ? Math.round(
            charge.amount * Number(account.metadata.service_fee_percent) +
              Number(account.metadata.service_fee_fixed),
          )
        : 0;
    const fee = stripeFee + applicationFee;

    const btId = rngCharge.id('txn');
    balance_transactions.push({
      id: btId,
      amount: charge.amount,
      fee,
      net: charge.amount - fee,
      currency: CURRENCY,
      created: charge.created,
      available_on: availableOn(charge.created),
      type: charge.payment_method_details_type === 'card_present' ? 'payment' : 'charge',
      reporting_category: 'charge',
      source_id: charge.id,
    });
    balance_transaction_fee_details.push({
      balance_transaction_id: btId,
      amount: stripeFee,
      currency: CURRENCY,
      type: 'stripe_fee',
      description:
        charge.card_country !== 'US' && charge.payment_method_details_type !== 'card_present'
          ? 'Stripe processing fees (international card)'
          : 'Stripe processing fees',
    });
    if (applicationFee > 0) {
      balance_transaction_fee_details.push({
        balance_transaction_id: btId,
        amount: applicationFee,
        currency: CURRENCY,
        type: 'application_fee',
        description: 'Marquee service fee',
      });
    }
    charge.balance_transaction_id = btId;

    const isOnCharge = account.metadata.settlement_mode === 'on_charge';
    const transferAmount = isOnCharge
      ? charge.amount - applicationFee
      : charge.amount - stripeFee;
    platformNet += isOnCharge ? applicationFee - stripeFee : 0;

    const transferId = rngCharge.id('tr');
    transfers.push({
      id: transferId,
      amount: transferAmount,
      destination_account_id: charge.account_id,
      source_transaction_id: charge.id,
      transfer_group: charge.transfer_group,
      reversed: false,
      amount_reversed: 0,
      created: charge.created,
      is_account_debit: false,
      description: null,
    });
    charge.transfer_id = transferId;
  }

  const transferByCharge = new Map(
    transfers.map((t) => [t.source_transaction_id ?? '', t]),
  );

  /* ------------------------------ refunds -------------------------------- */

  const refunds: Refund[] = [];

  function addRefund(
    charge: Charge,
    reason: string | null,
    createdAt: number,
    reverseTransfer: boolean,
  ): Refund {
    const refund: Refund = {
      id: rngFixture.id('re'),
      charge_id: charge.id,
      amount: charge.amount - charge.amount_refunded,
      status: 'succeeded',
      reason,
      created: createdAt,
      reverse_transfer: reverseTransfer,
    };
    refunds.push(refund);
    charge.amount_refunded += refund.amount;
    charge.refunded = charge.amount_refunded >= charge.amount;
    balance_transactions.push({
      id: rngFixture.id('txn'),
      amount: -refund.amount,
      fee: 0,
      net: -refund.amount,
      currency: CURRENCY,
      created: createdAt,
      available_on: createdAt,
      type: 'refund',
      reporting_category: 'refund',
      source_id: refund.id,
    });
    if (reverseTransfer) {
      const transfer = transferByCharge.get(charge.id);
      if (transfer) {
        transfer.reversed = true;
        transfer.amount_reversed = transfer.amount;
      }
    }
    return refund;
  }

  // Ordinary ticket refunds: date changes, buyer's remorse, duplicate orders.
  const refundCandidates = rngFixture.sample(
    successfulCharges.filter((c) => c.created < NOW - 2 * DAY),
    620,
  );
  for (const charge of refundCandidates) {
    addRefund(
      charge,
      rngFixture.weighted([
        ['requested_by_customer', 74],
        ['duplicate', 18],
        ['fraudulent', 8],
      ]),
      Math.min(NOW - HOUR, charge.created + rngFixture.int(1, 26) * DAY),
      rngFixture.bool(0.8),
    );
  }

  // Historical cancellations were refunded in full.
  for (const event of historicalCancellations) {
    const eventCharges = (paidChargesByEvent.get(event.id) ?? []).filter(
      (c) => !c.refunded,
    );
    for (const charge of eventCharges) {
      addRefund(charge, 'requested_by_customer', event.starts_at - DAY, true);
    }
  }

  const refundedChargeIds = new Set(refunds.map((r) => r.charge_id));

  /* ------------------------------ disputes ------------------------------- */

  const disputes: Dispute[] = [];
  const disputePool = rngFixture.shuffle(
    successfulCharges.filter(
      (c) =>
        !refundedChargeIds.has(c.id) &&
        c.payment_method_details_type !== 'card_present' &&
        c.created < NOW - 20 * DAY,
    ),
  );
  let disputeCursor = 0;
  const nextDisputeCharge = () => disputePool[disputeCursor++];

  function addDispute(
    charge: Charge,
    status: Dispute['status'],
    created: number,
    evidenceDueBy: number,
  ) {
    charge.disputed = true;
    disputes.push({
      id: rngFixture.id('dp'),
      charge_id: charge.id,
      amount: charge.amount,
      reason: rngFixture.weighted(DISPUTE_REASONS),
      status,
      evidence_due_by: evidenceDueBy,
      is_charge_refundable: status === 'needs_response' && rngFixture.bool(0.7),
      created,
      evidence_submitted_at: status === 'under_review' ? created + 2 * DAY : null,
    });
    // Every dispute carries a $15 fee.
    const btId = rngFixture.id('txn');
    balance_transactions.push({
      id: btId,
      amount: -charge.amount,
      fee: PRICING.disputeFee,
      net: -charge.amount - PRICING.disputeFee,
      currency: CURRENCY,
      created,
      available_on: created,
      type: 'adjustment',
      reporting_category: 'dispute',
      source_id: charge.id,
    });
    balance_transaction_fee_details.push({
      balance_transaction_id: btId,
      amount: PRICING.disputeFee,
      currency: CURRENCY,
      type: 'stripe_fee',
      description: 'Dispute fee',
    });
  }

  // 10 disputes whose evidence deadline lands inside the next 72 hours.
  for (let i = 0; i < FIXTURES.disputesDueWithin72h; i += 1) {
    const charge = nextDisputeCharge();
    addDispute(
      charge,
      'needs_response',
      NOW - rngFixture.int(17, 19) * DAY,
      NOW + rngFixture.int(3, 70) * HOUR,
    );
  }
  // Recent disputes — their fees are what moves last week's effective rate.
  for (let i = 0; i < 4; i += 1) {
    const charge = nextDisputeCharge();
    const created = NOW - rngFixture.int(2, 6) * DAY;
    addDispute(charge, 'under_review', created, created + rngFixture.int(16, 20) * DAY);
  }
  for (let i = 0; i < 2; i += 1) {
    const charge = nextDisputeCharge();
    const created = NOW - rngFixture.int(3, 5) * DAY;
    addDispute(charge, 'needs_response', created, created + rngFixture.int(17, 20) * DAY);
  }
  // Resolved history.
  for (let i = 0; i < 2; i += 1) {
    const charge = nextDisputeCharge();
    const created = NOW - rngFixture.int(52, 68) * DAY;
    addDispute(charge, 'won', created, created + 20 * DAY);
  }
  {
    const charge = nextDisputeCharge();
    const created = NOW - 45 * DAY;
    addDispute(charge, 'lost', created, created + 20 * DAY);
  }

  const disputedChargeIds = new Set(disputes.map((d) => d.charge_id));

  /* -------------------------- fraud warnings ----------------------------- */

  const early_fraud_warnings: EarlyFraudWarning[] = [];
  const efwPool = rngFixture.shuffle(
    successfulCharges.filter(
      (c) =>
        !refundedChargeIds.has(c.id) &&
        !disputedChargeIds.has(c.id) &&
        c.created > NOW - 30 * DAY &&
        c.outcome_risk_score > 28,
    ),
  );
  let efwCursor = 0;

  // The 17 that are still refundable — no refund, no dispute, actionable.
  for (let i = 0; i < FIXTURES.actionableEfwsUnrefunded; i += 1) {
    const charge = efwPool[efwCursor++];
    early_fraud_warnings.push({
      id: rngFixture.id('issfr'),
      charge_id: charge.id,
      fraud_type: rngFixture.weighted(FRAUD_TYPES),
      actionable: true,
      created: NOW - rngFixture.int(1, 9) * DAY,
    });
  }
  // Actionable but already refunded, plus a few non-actionable ones.
  for (let i = 0; i < 5; i += 1) {
    const charge = efwPool[efwCursor++];
    early_fraud_warnings.push({
      id: rngFixture.id('issfr'),
      charge_id: charge.id,
      fraud_type: rngFixture.weighted(FRAUD_TYPES),
      actionable: true,
      created: NOW - rngFixture.int(10, 26) * DAY,
    });
    addRefund(charge, 'fraudulent', NOW - rngFixture.int(1, 9) * DAY, true);
  }
  for (let i = 0; i < 4; i += 1) {
    const charge = efwPool[efwCursor++];
    early_fraud_warnings.push({
      id: rngFixture.id('issfr'),
      charge_id: charge.id,
      fraud_type: 'misc',
      actionable: false,
      created: NOW - rngFixture.int(2, 20) * DAY,
    });
  }

  /* ------------------------------ reviews -------------------------------- */

  const reviews: Review[] = [];
  const reviewCharges = charges.filter((c) => c.outcome_type === 'manual_review');
  reviewCharges.sort((a, b) => b.created - a.created);
  reviewCharges.forEach((charge, index) => {
    const open = index < FIXTURES.openReviews;
    reviews.push({
      id: rngFixture.id('prv'),
      charge_id: charge.id,
      open,
      reason: open ? 'rule' : rngFixture.bool(0.6) ? 'approved' : 'refunded',
      opened_reason: rngFixture.bool(0.68) ? 'rule' : 'manual',
      created: charge.created,
      closed_reason: open ? null : rngFixture.bool(0.6) ? 'approved' : 'refunded',
    });
  });

  /* --------------------- account state & requirements -------------------- */

  const upcomingByAccount = new Map<string, PlatformEvent[]>();
  for (const event of events) {
    if (event.starts_at > NOW && event.status === 'on_sale') {
      const list = upcomingByAccount.get(event.account_id) ?? [];
      list.push(event);
      upcomingByAccount.set(event.account_id, list);
    }
  }

  const REQUIREMENT_FIELDS = [
    'individual.verification.document',
    'company.tax_id',
    'external_account',
    'company.verification.document',
    'individual.id_number',
    'representative.dob.day',
    'settings.dashboard.display_name',
  ];

  // 12 organizers with an event in the next 14 days who cannot be paid out.
  const blockedCandidates = accounts.filter((a) => {
    const soon = (upcomingByAccount.get(a.id) ?? []).some(
      (e) => e.starts_at <= NOW + 14 * DAY,
    );
    return soon && a.business_profile_name !== 'Riverlight Music Festival';
  });
  const blockedOrganizers = rngFixture.sample(
    blockedCandidates,
    FIXTURES.organizersBlockedFromPayouts,
  );
  for (const account of blockedOrganizers) {
    const due = rngFixture.sample(REQUIREMENT_FIELDS, rngFixture.int(1, 3));
    const pastDue = rngFixture.bool(0.42) ? due.slice(0, 1) : [];
    account.payouts_enabled = false;
    account.requirements_currently_due = due;
    account.requirements_past_due = pastDue;
    account.requirements_disabled_reason =
      pastDue.length > 0 ? 'requirements.past_due' : 'requirements.pending_verification';
    account.requirements_current_deadline = NOW + rngFixture.int(3, 21) * DAY;
    if (pastDue.length > 0 && rngFixture.bool(0.25)) account.charges_enabled = false;
  }

  /* --------------------------- balances ---------------------------------- */

  const account_balances: AccountBalance[] = [];
  const grossByAccount = new Map<string, number>();
  const refundedByAccount = new Map<string, number>();
  for (const charge of successfulCharges) {
    grossByAccount.set(
      charge.account_id,
      (grossByAccount.get(charge.account_id) ?? 0) + charge.amount,
    );
    if (charge.amount_refunded > 0) {
      refundedByAccount.set(
        charge.account_id,
        (refundedByAccount.get(charge.account_id) ?? 0) + charge.amount_refunded,
      );
    }
  }

  const negativeBalanceOrganizers = rngFixture.sample(
    accounts.filter((a) => (grossByAccount.get(a.id) ?? 0) > 0),
    FIXTURES.negativeBalanceOrganizers,
  );
  const negativeIds = new Set(negativeBalanceOrganizers.map((a) => a.id));

  for (const account of accounts) {
    const gross = grossByAccount.get(account.id) ?? 0;
    const refunded = refundedByAccount.get(account.id) ?? 0;
    // Most of the money has already been paid out; what is left is a few days
    // of settled funds plus whatever is still inside the T+2 window.
    const pending = Math.round(gross * rngFixture.between(0.03, 0.08));
    let available = Math.round(gross * rngFixture.between(0.01, 0.05)) - refunded;
    if (negativeIds.has(account.id)) {
      available = -Math.round(rngFixture.between(180_000, 920_000));
    } else if (available < 0) {
      available = Math.round(rngFixture.between(20_000, 140_000));
    }
    account_balances.push({
      account_id: account.id,
      available,
      pending,
      currency: CURRENCY,
    });
  }

  /* ------------------------------ payouts -------------------------------- */

  const payouts: Payout[] = [];
  const connected_account_payouts: Payout[] = [];

  const PAYOUT_FAILURES: [string, string][] = [
    ['account_closed', 'The bank account has been closed.'],
    ['no_account', 'The bank account could not be located.'],
    ['debit_not_authorized', 'Debit transactions are not approved on this account.'],
    ['invalid_account_number', 'The routing and account number combination is invalid.'],
  ];

  for (const account of accounts) {
    if (!account.payouts_enabled) continue;
    const interval = account.payout_schedule_interval;
    if (interval === 'manual') continue;
    const step = interval === 'daily' ? DAY : interval === 'weekly' ? 7 * DAY : 30 * DAY;
    const horizon = interval === 'daily' ? 45 * DAY : 91 * DAY;
    const gross = grossByAccount.get(account.id) ?? 0;
    if (gross === 0) continue;
    const perPayout = gross / Math.max(1, Math.floor(horizon / step));

    for (let ts = NOW - horizon; ts <= NOW; ts += step) {
      const created = Math.round(ts + 4 * HOUR);
      const amount = Math.max(
        1_000,
        Math.round((perPayout * rngFixture.between(0.5, 1.6)) / 100) * 100,
      );
      const failed = rngFixture.bool(0.004);
      const failure = failed ? rngFixture.pick(PAYOUT_FAILURES) : null;
      connected_account_payouts.push({
        id: rngFixture.id('po'),
        account_id: account.id,
        amount,
        currency: CURRENCY,
        arrival_date: availableOn(created),
        created,
        status: failed ? 'failed' : created > NOW - 2 * DAY ? 'in_transit' : 'paid',
        method: 'standard',
        failure_code: failure?.[0] ?? null,
        failure_message: failure?.[1] ?? null,
      });
    }
  }

  /* ------------------------ terminal readers ----------------------------- */

  const terminal_readers: TerminalReader[] = [];
  const readerOrganizers = [
    accountByName.get('Cascade Aquarium')!,
    accountByName.get('Harbor City Hounds Baseball')!,
    accountByName.get('Northgate Renaissance Faire')!,
    accountByName.get('Hollow Creek Haunt')!,
    accountByName.get('Starfield Photo Ops')!,
    accountByName.get("Big Fork Food & Wine Festival")!,
    accountByName.get('Nebula Fan Expo')!,
    accountByName.get('Ink & Panel Comic Fest')!,
    ...rngFixture.sample(
      accounts.filter((a) => CATEGORY_PROFILES[a.metadata.organizer_category].cardPresentBias > 0.28),
      4,
    ),
  ];

  const seenReaderOrganizers = new Set<string>();
  for (const account of readerOrganizers) {
    if (seenReaderOrganizers.has(account.id)) continue;
    seenReaderOrganizers.add(account.id);
    const isAquarium = account.business_profile_name === FIXTURES.offlineReaderVenue;
    const locationCount = isAquarium ? 2 : rngFixture.int(1, 2);
    const locations = Array.from({ length: locationCount }, () =>
      rngFixture.id('tml', 16),
    );
    const readerCount = isAquarium ? 9 : rngFixture.int(2, 6);
    const profile = CATEGORY_PROFILES[account.metadata.organizer_category];
    for (let i = 0; i < readerCount; i += 1) {
      // Four of the aquarium's readers dropped off the network yesterday.
      const offline = isAquarium ? i >= readerCount - 4 : rngFixture.bool(0.06);
      terminal_readers.push({
        id: rngFixture.id('tmr', 16),
        account_id: account.id,
        location_id: locations[i % locations.length],
        label: `${rngFixture.pick(profile.venues)} ${i + 1}`,
        device_type: rngFixture.weighted(READER_DEVICE_TYPES),
        status: offline ? 'offline' : 'online',
        last_seen_at: offline
          ? NOW - rngFixture.int(14, 31) * HOUR
          : NOW - rngFixture.int(1, 22) * 60,
      });
    }
  }

  /* ------------------------------ admissions ----------------------------- */

  const admissions: Admission[] = [];
  const completedEventIds = new Set(
    events.filter((e) => e.status === 'completed').map((e) => e.id),
  );
  const eventById = new Map(events.map((e) => [e.id, e]));

  for (const charge of successfulCharges) {
    if (!completedEventIds.has(charge.metadata.event_id)) continue;
    if (charge.refunded) continue;
    if (!rngFixture.bool(0.88)) continue;
    const event = eventById.get(charge.metadata.event_id)!;
    admissions.push({
      charge_id: charge.id,
      scanned_at: event.starts_at + rngFixture.int(-45, 190) * 60,
      gate: rngFixture.pick(GATES),
    });
  }

  // Make sure most disputes have a scan on file — that is the evidence the
  // agent prefills. The rest are the ones it recommends accepting.
  const admissionChargeIds = new Set(admissions.map((a) => a.charge_id));
  const needsResponse = disputes.filter((d) => d.status === 'needs_response');
  needsResponse.forEach((dispute, index) => {
    const hasScan = admissionChargeIds.has(dispute.charge_id);
    const shouldHaveScan = index % 10 < 7; // ~70% scanned
    if (shouldHaveScan && !hasScan) {
      const charge = chargeById.get(dispute.charge_id)!;
      const event = eventById.get(charge.metadata.event_id)!;
      admissions.push({
        charge_id: charge.id,
        scanned_at: Math.min(NOW - DAY, event.starts_at + rngFixture.int(5, 120) * 60),
        gate: rngFixture.pick(GATES),
      });
      admissionChargeIds.add(charge.id);
    } else if (!shouldHaveScan && hasScan) {
      const at = admissions.findIndex((a) => a.charge_id === dispute.charge_id);
      if (at >= 0) admissions.splice(at, 1);
      admissionChargeIds.delete(dispute.charge_id);
    }
  });

  /* ------------------------ service fee ledger --------------------------- */

  const service_fee_ledger: ServiceFeeLedgerRow[] = [];
  const lastWeekStart = NOW - 7 * DAY;

  for (const event of events) {
    if (event.starts_at > NOW) continue;
    const account = accountById.get(event.account_id)!;
    if (account.metadata.settlement_mode !== 'post_event') continue;
    if (event.starts_at < NOW - 21 * DAY) continue;

    const eventCharges = paidChargesByEvent.get(event.id) ?? [];
    if (eventCharges.length === 0) continue;
    const gross = eventCharges.reduce(
      (sum, c) => sum + (c.amount - c.amount_refunded),
      0,
    );
    const tickets = eventCharges.reduce(
      (sum, c) => sum + Number(c.metadata.quantity),
      0,
    );
    const feeOwed = Math.round(
      gross * Number(account.metadata.service_fee_percent) +
        tickets * Number(account.metadata.service_fee_fixed),
    );
    service_fee_ledger.push({
      account_id: account.id,
      event_id: event.id,
      tickets_sold: tickets,
      gross_volume: gross,
      fee_owed: feeOwed,
      period_end: event.starts_at,
      // Anything older than last week has already been collected.
      settled: event.starts_at < lastWeekStart ? rngLedger.bool(0.92) : false,
    });
  }

  /* ---------------------- platform settlement ---------------------------- */

  // Marquee's own payouts are derived, not invented: the platform can only
  // pay itself what it actually kept (application fees net of Stripe fees, plus
  // service fees already collected from post-event organizers).
  const collectedServiceFees = service_fee_ledger
    .filter((row) => row.settled)
    .reduce((sum, row) => sum + row.fee_owed, 0);
  const platformRevenue = platformNet + collectedServiceFees;

  const weeklyVolume = new Array<number>(13).fill(0);
  for (const charge of successfulCharges) {
    const week = Math.floor((NOW - charge.created) / (7 * DAY));
    if (week >= 0 && week < 13) weeklyVolume[week] += charge.amount;
  }
  const totalWeighted = weeklyVolume.reduce((a, b) => a + b, 0) || 1;
  // Hold back the most recent week — it is still inside the settlement window.
  const payoutBudget = Math.max(0, Math.round(platformRevenue * 0.85));
  let paidOutSoFar = 0;

  for (let week = 12; week >= 0; week -= 1) {
    const created = NOW - week * 7 * DAY - 6 * HOUR;
    const amount = Math.max(
      0,
      Math.round((weeklyVolume[week] / totalWeighted) * payoutBudget),
    );
    if (amount === 0) continue;
    paidOutSoFar += amount;
    payouts.push({
      id: rngFixture.id('po'),
      account_id: 'acct_platform_marquee',
      amount,
      currency: CURRENCY,
      arrival_date: availableOn(created),
      created,
      status: week === 0 ? 'in_transit' : 'paid',
      method: 'standard',
      failure_code: null,
      failure_message: null,
    });
  }

  const platform_balances: AccountBalance[] = [
    {
      account_id: 'acct_platform_marquee',
      available: platformRevenue - paidOutSoFar,
      // Funds still inside the T+2 window across every connected account.
      pending: account_balances.reduce((sum, b) => sum + b.pending, 0),
      currency: CURRENCY,
    },
  ];

  /* --------------- payment method configurations ------------------------- */

  const payment_method_configurations: PaymentMethodConfiguration[] = [];
  const PLATFORM_PMC_ID = 'pmc_marquee_platform_default';
  payment_method_configurations.push({
    id: PLATFORM_PMC_ID,
    account_id: null,
    name: 'Marquee platform default',
    is_default: true,
    parent: null,
    payment_methods: {
      card: { display_preference: { preference: 'on', value: 'on' } },
      link: { display_preference: { preference: 'on', value: 'on' } },
      apple_pay: { display_preference: { preference: 'on', value: 'on' } },
      google_pay: { display_preference: { preference: 'on', value: 'on' } },
      cashapp: { display_preference: { preference: 'on', value: 'on' } },
      klarna: { display_preference: { preference: 'off', value: 'off' } },
      affirm: { display_preference: { preference: 'off', value: 'off' } },
      afterpay_clearpay: { display_preference: { preference: 'off', value: 'off' } },
    },
  });

  for (const account of accounts) {
    // Roughly a third of organizers have wallets switched off on their child
    // configuration — usually a leftover from how they were onboarded.
    const walletsOn = rngLedger.bool(0.66);
    const bnplOn = rngLedger.bool(0.09);
    payment_method_configurations.push({
      id: `pmc_${rngLedger.string(16)}`,
      account_id: account.id,
      name: `${account.business_profile_name} checkout`,
      is_default: true,
      parent: PLATFORM_PMC_ID,
      payment_methods: {
        card: { display_preference: { preference: 'on', value: 'on' } },
        link: { display_preference: { preference: 'on', value: 'on' } },
        apple_pay: {
          display_preference: {
            preference: walletsOn ? 'on' : 'off',
            value: walletsOn ? 'on' : 'off',
          },
        },
        google_pay: {
          display_preference: {
            preference: walletsOn ? 'on' : 'off',
            value: walletsOn ? 'on' : 'off',
          },
        },
        cashapp: { display_preference: { preference: 'on', value: 'on' } },
        klarna: {
          display_preference: {
            preference: bnplOn ? 'on' : 'off',
            value: bnplOn ? 'on' : 'off',
          },
        },
        affirm: {
          display_preference: {
            preference: bnplOn ? 'on' : 'off',
            value: bnplOn ? 'on' : 'off',
          },
        },
        afterpay_clearpay: {
          display_preference: { preference: 'off', value: 'off' },
        },
      },
    });
  }

  return {
    accounts,
    events,
    charges,
    balance_transactions,
    balance_transaction_fee_details,
    transfers,
    transfer_reversals: [],
    refunds,
    disputes,
    early_fraud_warnings,
    reviews,
    payouts,
    connected_account_payouts,
    terminal_readers,
    admissions,
    account_balances,
    platform_balances,
    service_fee_ledger,
    radar_value_list_items: [],
    invoices: [],
    payment_links: [],
    account_links: [],
    report_runs: [],
    query_runs: [],
    payment_method_configurations,
    platform_requests: [],
  };
}

export const DATASET_META = {
  seed: SEED,
  scaleFactor: SCALE_FACTOR,
  sampledCharges: TOTAL_CHARGES,
  impliedAttempts: TOTAL_CHARGES * SCALE_FACTOR,
  generatedFor: NOW,
} as const;
