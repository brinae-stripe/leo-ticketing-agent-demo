import { CURRENCY, DAY, NOW, SCALE_FACTOR } from './constants';
import { Rng } from './rng';
import type {
  Account,
  AccountBalance,
  CapitalFinancingOffer,
  CapitalFinancingSummary,
  IssuingAuthorization,
  IssuingCard,
  IssuingCardholder,
  TreasuryFinancialAccount,
  TreasuryOutboundPayment,
} from './types';

/**
 * Capital, Treasury and Issuing, generated on top of the payments dataset.
 *
 * Kept out of generate.ts because it depends on that file's output rather than
 * sitting alongside it: eligibility for an advance is a function of trailing
 * volume, a Treasury balance is a function of what has not been paid out yet,
 * and card spend only makes sense against an organizer who has money to spend.
 * Generating these in a second pass is what keeps them consistent with the
 * charges instead of merely plausible next to them.
 *
 * None of these three products is on by default. The deliberately small pilot
 * counts below are the point of the platform-side scenarios — the interesting
 * question is not "what do the enrolled organizers do", it is "who is eligible
 * and not enrolled", which is the number that turns into revenue.
 *
 * ## These rows are not sampled
 *
 * `charges` is a 1:100 sample: 24,000 rows stand in for 2.4M payment attempts.
 * Nothing here is. A financing offer is one row per organizer, not one row per
 * payment, so there is nothing to sample — an organizer either has an offer or
 * does not, and a platform with 70 organizers has at most 70 offers.
 *
 * The consequence is that amounts here are sized off `trailingVolume *
 * SCALE_FACTOR`, the organizer's real volume, rather than off the sampled rows
 * directly. A $4M organizer gets an offer sized against $4M. Read alongside a
 * `charges` query the two look inconsistent — the charge rows for that organizer
 * only add up to $40,000 — and that is the sampling, not a bug. It is listed on
 * /how-it-works with the other schema caveats.
 */

/* --------------------------------- content -------------------------------- */

const VENDOR_NAMES = [
  'Northgate Staging & Rigging',
  'Halcyon Audio Rentals',
  'Bright Line Security Services',
  'Two Rivers Catering',
  'Meridian Tent & Structure',
  'Copperfield Print Works',
  'Lakeside Sanitation',
  'Vantage Barricade Supply',
  'Ridgeway Talent Buyers',
  'Harbor Light Electrical',
  'Stonepath Freight',
  'Fielding Insurance Brokers',
];

const CARDHOLDER_ROLES = [
  'Production lead',
  'Site operations manager',
  'Talent buyer',
  'Box office manager',
  'Marketing director',
  'Logistics coordinator',
];

/**
 * Merchant categories an event production team actually spends in. These double
 * as the allow-list on issued cards, which is the control an organizer's finance
 * team cares about: a card that only works at freight and equipment merchants is
 * a card nobody has to police.
 */
const EVENT_SPEND_CATEGORIES = [
  'equipment_rental',
  'freight_carriers_trucking',
  'commercial_printing',
  'security_services',
  'catering',
  'electrical_services',
  'lodging',
  'advertising_services',
];

/** Spend that lands outside the allow-list, which is what gets declined. */
const OFF_POLICY_CATEGORIES = [
  'eating_places_restaurants',
  'liquor_stores',
  'consumer_electronics',
];

const OFF_POLICY_MERCHANTS = [
  'The Copper Kettle',
  'Fifth Street Wine & Spirits',
  'Peak Electronics Depot',
];

/* -------------------------------- eligibility ------------------------------ */

/**
 * Capital eligibility, approximated.
 *
 * Stripe underwrites Capital itself and the real signals are not public, so this
 * is a stand-in built from what a platform can see: enough trailing volume to
 * repay from, a long enough history to have a trend, and an account in good
 * standing. It is labelled as an approximation everywhere it surfaces — quoting
 * it as if it were Stripe's own decision would be the one genuinely misleading
 * thing this demo could do.
 */
export const CAPITAL_ELIGIBILITY = {
  /**
   * Trailing 90-day net volume, in cents, at platform scale — $4M. Compare
   * against `sampledVolume * SCALE_FACTOR`, not against the sampled rows.
   */
  minTrailingVolume: 4_000_000_00,
  minPaidCharges: 120,
  /**
   * Advance sizing as a share of trailing 90-day volume. A 90-day window at 5%
   * is roughly six weeks of revenue, which is the order of magnitude Capital
   * advances actually land at.
   */
  offerShareOfVolume: [0.03, 0.08] as const,
  feeRate: [0.06, 0.11] as const,
  withholdRate: [0.09, 0.17] as const,
  offerTermDays: 30,
} as const;

export interface EligibilityInput {
  account: Account;
  /** Sampled trailing 90-day net volume. Scaled up inside. */
  trailingVolume: number;
  paidCharges: number;
}

export function isCapitalEligible(input: EligibilityInput): boolean {
  return (
    input.account.charges_enabled &&
    input.account.payouts_enabled &&
    input.account.requirements_past_due.length === 0 &&
    input.trailingVolume * SCALE_FACTOR >= CAPITAL_ELIGIBILITY.minTrailingVolume &&
    input.paidCharges >= CAPITAL_ELIGIBILITY.minPaidCharges
  );
}

/* -------------------------------- generation ------------------------------- */

export interface EmbeddedFinanceInput {
  accounts: Account[];
  balances: AccountBalance[];
  /** Trailing 90-day net volume per account id, in cents. */
  trailingVolumeByAccount: Map<string, number>;
  paidChargeCountByAccount: Map<string, number>;
  /** Next event date per account id, epoch seconds, when there is one. */
  nextEventByAccount: Map<string, number>;
}

export interface EmbeddedFinanceOutput {
  capital_financing_offers: CapitalFinancingOffer[];
  capital_financing_summaries: CapitalFinancingSummary[];
  treasury_financial_accounts: TreasuryFinancialAccount[];
  treasury_outbound_payments: TreasuryOutboundPayment[];
  issuing_cardholders: IssuingCardholder[];
  issuing_cards: IssuingCard[];
  issuing_authorizations: IssuingAuthorization[];
}

/** Round to the nearest $500, so offers read as underwritten rather than computed. */
function roundOffer(cents: number): number {
  return Math.round(cents / 50_000) * 50_000;
}

export function generateEmbeddedFinance(
  input: EmbeddedFinanceInput,
  seed: number,
): EmbeddedFinanceOutput {
  const rng = new Rng(seed);

  const balanceByAccount = new Map(input.balances.map((b) => [b.account_id, b]));

  const eligible = input.accounts.filter((account) =>
    isCapitalEligible({
      account,
      trailingVolume: input.trailingVolumeByAccount.get(account.id) ?? 0,
      paidCharges: input.paidChargeCountByAccount.get(account.id) ?? 0,
    }),
  );

  /* ------------------------------- Capital ------------------------------- */

  const capital_financing_offers: CapitalFinancingOffer[] = [];
  const capital_financing_summaries: CapitalFinancingSummary[] = [];

  // Stripe has generated an offer for most eligible organizers but not all —
  // underwriting is its own model, not a threshold the platform controls.
  const withOffers = rng.sample(eligible, Math.round(eligible.length * 0.82));

  for (const account of withOffers) {
    // Platform scale, not sample scale — see the note at the top of this file.
    const volume = (input.trailingVolumeByAccount.get(account.id) ?? 0) * SCALE_FACTOR;
    const offered = roundOffer(
      volume * rng.between(...CAPITAL_ELIGIBILITY.offerShareOfVolume),
    );
    if (offered < 2_500_000) continue;

    const feeRate = rng.between(...CAPITAL_ELIGIBILITY.feeRate);
    const withholdRate = rng.between(...CAPITAL_ELIGIBILITY.withholdRate);

    // The split that makes the platform-side scenario worth asking: a third of
    // live offers have never been shown to the organizer, which is revenue
    // sitting in a table nobody queries.
    const status = rng.weighted<CapitalFinancingOffer['status']>([
      ['undelivered', 34],
      ['delivered', 30],
      ['accepted', 8],
      ['paid_out', 22],
      ['expired', 6],
    ]);

    // An expired offer has to have been created longer ago than the term, or
    // its expires_after lands in the future and the status contradicts the row.
    // Live offers sit inside the term, weighted late enough that several are
    // days from lapsing — which is the urgency the undelivered ones need.
    const created =
      status === 'expired'
        ? NOW - rng.int(CAPITAL_ELIGIBILITY.offerTermDays + 3, 90) * DAY
        : NOW - rng.int(4, CAPITAL_ELIGIBILITY.offerTermDays - 2) * DAY;

    const deliveredAt =
      status === 'undelivered' ? null : created + rng.int(1, 4) * DAY;
    const acceptedAt =
      status === 'accepted' || status === 'paid_out'
        ? (deliveredAt ?? created) + rng.int(1, 6) * DAY
        : null;

    const offer: CapitalFinancingOffer = {
      id: rng.id('financingoffer', 20),
      account_id: account.id,
      status,
      offered_amount: offered,
      fee_amount: roundOffer(offered * feeRate),
      withhold_rate: withholdRate.toFixed(3),
      currency: CURRENCY,
      created,
      expires_after: created + CAPITAL_ELIGIBILITY.offerTermDays * DAY,
      delivered_at: deliveredAt,
      accepted_at: acceptedAt,
    };
    capital_financing_offers.push(offer);

    if (status !== 'paid_out') continue;

    // Repayment is proportional to how long the advance has been outstanding,
    // not random, so the remaining balance is consistent with paid_out_at.
    const paidOutAt = (acceptedAt ?? created) + DAY;
    const total = offer.offered_amount + offer.fee_amount;
    const elapsedDays = Math.max(0, (NOW - paidOutAt) / DAY);
    const repaidShare = Math.min(0.92, (elapsedDays / 180) * rng.between(0.7, 1.3));
    capital_financing_summaries.push({
      offer_id: offer.id,
      account_id: account.id,
      advance_amount: offer.offered_amount,
      fee_amount: offer.fee_amount,
      withhold_rate: offer.withhold_rate,
      remaining_amount: Math.round(total * (1 - repaidShare)),
      paid_out_at: paidOutAt,
      currency: CURRENCY,
    });
  }

  /* ------------------------------- Treasury ------------------------------ */

  const treasury_financial_accounts: TreasuryFinancialAccount[] = [];
  const treasury_outbound_payments: TreasuryOutboundPayment[] = [];

  // A small pilot, drawn from organizers who have an event still to come.
  // That is the whole premise: money arrives when tickets sell and is not needed
  // until the event, so there is a float to hold — and a vendor to pay out of
  // it. An organizer with nothing upcoming has no reason to want a wallet.
  //
  // Treasury is invite-only and needs the capability granted per connected
  // account, so a platform-wide rollout is not something that has quietly
  // already happened.
  const treasuryPilot = rng.sample(
    eligible.filter(
      (account) =>
        (balanceByAccount.get(account.id)?.available ?? 0) > 0 &&
        input.nextEventByAccount.has(account.id),
    ),
    8,
  );

  for (const account of treasuryPilot) {
    const balance = balanceByAccount.get(account.id);
    // Platform scale, as with the offers above.
    const available = (balance?.available ?? 0) * SCALE_FACTOR;
    const cash = Math.max(5_000_000, Math.round(available * rng.between(0.4, 0.9)));
    const financialAccount: TreasuryFinancialAccount = {
      id: rng.id('fa', 20),
      account_id: account.id,
      status: 'open',
      active_features: [
        'card_issuing',
        'deposit_insurance',
        'financial_addresses.aba',
        'inbound_transfers.ach',
        'outbound_payments.ach',
        'outbound_transfers.ach',
      ],
      balance_cash: cash,
      balance_inbound_pending: Math.round(
        (balance?.pending ?? 0) * SCALE_FACTOR * rng.between(0.2, 0.6),
      ),
      balance_outbound_pending: 0,
      currency: CURRENCY,
      created: NOW - rng.int(40, 160) * DAY,
    };
    treasury_financial_accounts.push(financialAccount);

    for (let i = 0; i < rng.int(3, 7); i += 1) {
      const created = NOW - rng.int(1, 70) * DAY;
      const amount = Math.round(rng.between(cash * 0.04, cash * 0.3) / 10_000) * 10_000;
      if (amount < 100_000) continue;
      const settled = created < NOW - 3 * DAY;
      treasury_outbound_payments.push({
        id: rng.id('obp', 20),
        financial_account_id: financialAccount.id,
        account_id: account.id,
        amount,
        currency: CURRENCY,
        status: settled ? 'posted' : 'processing',
        payee_name: rng.pick(VENDOR_NAMES),
        description: rng.pick([
          'Venue deposit',
          'Staging and rigging',
          'Audio rental',
          'Security staffing',
          'Print and signage',
          'Freight',
        ]),
        expected_arrival_date: created + rng.int(1, 3) * DAY,
        created,
      });
    }

    // Money already committed reads as pending outbound rather than as cash.
    financialAccount.balance_outbound_pending = treasury_outbound_payments
      .filter((p) => p.account_id === account.id && p.status === 'processing')
      .reduce((sum, p) => sum + p.amount, 0);
  }

  /* -------------------------------- Issuing ------------------------------ */

  const issuing_cardholders: IssuingCardholder[] = [];
  const issuing_cards: IssuingCard[] = [];
  const issuing_authorizations: IssuingAuthorization[] = [];

  // Cards only make sense where there is a funding source, so the Issuing pilot
  // is drawn from the Treasury pilot rather than independently.
  const issuingPilot = rng.sample(treasuryPilot, 6);

  for (const account of issuingPilot) {
    const slug = account.business_profile_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '');

    for (const role of rng.sample(CARDHOLDER_ROLES, rng.int(1, 3))) {
      const first = rng.pick([
        'Dani', 'Priya', 'Marcus', 'Iris', 'Tomas', 'Nadia', 'Owen', 'Ruth',
        'Kai', 'Lena', 'Desmond', 'Yuki',
      ]);
      const last = rng.pick([
        'Okafor', 'Reyes', 'Lindqvist', 'Barouch', 'Whitfield', 'Nakamura',
        'Delacroix', 'Osei', 'Kovač', 'Mbeki',
      ]);
      const cardholder: IssuingCardholder = {
        id: rng.id('ich', 20),
        account_id: account.id,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${slug}.example`,
        role,
        type: 'individual',
        status: 'active',
        created: NOW - rng.int(20, 140) * DAY,
      };
      issuing_cardholders.push(cardholder);

      // Per-person monthly limits, which are set by role rather than by the
      // organizer's volume — a production lead's ceiling is a policy decision.
      const limit = rng.pick([1_000_000, 2_500_000, 5_000_000, 10_000_000]);
      const card: IssuingCard = {
        id: rng.id('ic', 20),
        cardholder_id: cardholder.id,
        account_id: account.id,
        last4: String(rng.int(1000, 9999)),
        brand: 'Visa',
        type: rng.bool(0.75) ? 'virtual' : 'physical',
        status: 'active',
        spending_limit_amount: limit,
        spending_limit_interval: 'monthly',
        allowed_categories: rng.sample(EVENT_SPEND_CATEGORIES, rng.int(3, 6)),
        created: cardholder.created + rng.int(0, 3) * DAY,
      };
      issuing_cards.push(card);

      for (let i = 0; i < rng.int(4, 12); i += 1) {
        const created = NOW - rng.int(1, 80) * DAY;
        // Roughly one authorisation in nine is off-policy and declined by the
        // card's own controls, which is the whole reason to set them.
        const offPolicy = rng.bool(0.11);
        const index = rng.int(0, OFF_POLICY_CATEGORIES.length - 1);
        issuing_authorizations.push({
          id: rng.id('iauth', 20),
          card_id: card.id,
          account_id: account.id,
          amount: Math.round(rng.between(limit * 0.02, limit * 0.4) / 1_000) * 1_000,
          currency: CURRENCY,
          approved: !offPolicy,
          status: offPolicy ? 'closed' : created < NOW - 2 * DAY ? 'closed' : 'pending',
          decline_reason: offPolicy ? 'card_controls_merchant_category' : null,
          merchant_name: offPolicy
            ? OFF_POLICY_MERCHANTS[index]
            : rng.pick(VENDOR_NAMES),
          merchant_category: offPolicy
            ? OFF_POLICY_CATEGORIES[index]
            : rng.pick(card.allowed_categories),
          created,
        });
      }
    }
  }

  return {
    capital_financing_offers,
    capital_financing_summaries,
    treasury_financial_accounts,
    treasury_outbound_payments,
    issuing_cardholders,
    issuing_cards,
    issuing_authorizations,
  };
}

export { VENDOR_NAMES, EVENT_SPEND_CATEGORIES, CARDHOLDER_ROLES };
