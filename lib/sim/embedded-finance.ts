import { CURRENCY, DAY, HOUR, NOW } from './constants';
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
  TreasuryReceivedCredit,
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
 * ## Everything here is at the organizer's own scale
 *
 * The dataset samples organizers, not their charges (see SCALE_FACTOR), so an
 * organizer's charge rows are the whole of their trading history. Amounts here
 * are sized straight off that: a festival that took $336,599 last quarter is
 * underwritten against $1.35M a year and offered a few per cent of it. Query
 * `charges` for the same organizer and the figures agree, because they are the
 * same figures — there is no scaling step to remember and nothing to reconcile.
 *
 * What that buys is numbers a reader can check. A $40,000-to-$108,000 advance
 * against a $1.35M-a-year food festival is a real Stripe Capital offer. The same
 * organizer scaled up a hundredfold gets $9.7M, which is more than most
 * independent festivals in the country gross, and the moment anyone in the room
 * does that arithmetic the rest of the demo stops being believable too.
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
   * Trailing 90-day net volume, in cents — $30,000, which is roughly $120,000 a
   * year. The organizer's own figure; nothing is scaled.
   *
   * Low, deliberately. Stripe Capital is not reserved for large merchants, and
   * setting the bar where only festivals clear it would quietly remove the most
   * interesting organizers from the platform-side question — the comedy club
   * doing $218,000 a year is exactly who an offer is useful to.
   */
  minTrailingVolume: 30_000_00,
  minPaidCharges: 120,
  /**
   * Advance size as a share of *annual* volume.
   *
   * A few per cent of a year's processing, not a few per cent of a quarter's —
   * the latter produces advances small enough to look like a rounding error next
   * to the volume they are secured against.
   */
  offerShareOfAnnualVolume: [0.03, 0.08] as const,
  /**
   * Hard ceiling on an advance, in cents — $250,000.
   *
   * A share of annual volume alone would write Riverlight a $759,000 advance on
   * the strength of a $9.5M year. Cash advances cap out well below that, so the
   * largest organizer on the platform is limited by the product rather than by
   * its own volume — which is itself the more interesting fact to show.
   */
  maxOffer: 250_000_00,
  feeRate: [0.06, 0.11] as const,
  /**
   * The payback window the withhold rate is solved for, in days.
   *
   * Withholding is not picked independently of the advance — it is chosen so the
   * advance clears in a sensible time at the organizer's own run rate. Deriving
   * it here means the rate, the advance and the repayment progress all agree:
   * pick them separately and a four-day-old advance ends up showing 2% repaid
   * next to a daily rate that implies 12%, which is the kind of contradiction a
   * controller spots in about five seconds.
   */
  paybackTargetDays: [120, 240] as const,
  offerTermDays: 30,
} as const;

export interface EligibilityInput {
  account: Account;
  /** The organizer's own trailing 90-day net volume, in cents. */
  trailingVolume: number;
  paidCharges: number;
}

export function isCapitalEligible(input: EligibilityInput): boolean {
  return (
    input.account.charges_enabled &&
    input.account.payouts_enabled &&
    input.account.requirements_past_due.length === 0 &&
    input.trailingVolume >= CAPITAL_ELIGIBILITY.minTrailingVolume &&
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
  treasury_received_credits: TreasuryReceivedCredit[];
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
    const trailing90 = input.trailingVolumeByAccount.get(account.id) ?? 0;
    const annualVolume = trailing90 * 4;
    const share = rng.between(...CAPITAL_ELIGIBILITY.offerShareOfAnnualVolume);
    const offered = Math.min(
      CAPITAL_ELIGIBILITY.maxOffer,
      roundOffer(annualVolume * share),
    );
    // Below a few thousand dollars an advance is not worth either side's
    // paperwork, and Stripe would not write it.
    if (offered < 500_000) continue;

    const feeRate = rng.between(...CAPITAL_ELIGIBILITY.feeRate);
    // Solve the withhold rate for the payback window rather than drawing it
    // independently, so repayment progress and the daily rate cannot disagree.
    const targetDays = rng.between(...CAPITAL_ELIGIBILITY.paybackTargetDays);
    const dailyVolume = annualVolume / 365;
    const withholdRate =
      dailyVolume > 0
        ? Math.min(0.25, Math.max(0.05, (offered * (1 + feeRate)) / (dailyVolume * targetDays)))
        : 0.12;

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

    // Repayment is the withhold rate applied to the organizer's actual run rate
    // for however long the advance has been outstanding — the same arithmetic the
    // Event Advance page shows. Anything else and the page contradicts the data.
    const paidOutAt = (acceptedAt ?? created) + DAY;
    const total = offer.offered_amount + offer.fee_amount;
    const elapsedDays = Math.max(0, (NOW - paidOutAt) / DAY);
    const repaid = Math.min(total * 0.92, dailyVolume * withholdRate * elapsedDays);
    capital_financing_summaries.push({
      offer_id: offer.id,
      account_id: account.id,
      advance_amount: offer.offered_amount,
      fee_amount: offer.fee_amount,
      withhold_rate: offer.withhold_rate,
      remaining_amount: Math.round(total - repaid),
      paid_out_at: paidOutAt,
      currency: CURRENCY,
    });
  }

  /* ------------------------------- Treasury ------------------------------ */

  const treasury_financial_accounts: TreasuryFinancialAccount[] = [];
  const treasury_outbound_payments: TreasuryOutboundPayment[] = [];
  const treasury_received_credits: TreasuryReceivedCredit[] = [];

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
    const openedAt = NOW - rng.int(40, 160) * DAY;
    // Weekly ticket revenue is what actually sweeps in, so the account's history
    // is sized off that rather than off the settled balance. A balance is the
    // residue after payouts — near zero for an organizer who sweeps often — and
    // sizing a quarter of inbound sweeps off it says nothing about how much they
    // trade.
    const weeklyRevenue = (input.trailingVolumeByAccount.get(account.id) ?? 0) / 13;

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
      // An ABA address is what makes the account payable — it is the routing and
      // account number an organizer gives a sponsor or a bank.
      routing_number: '011401533',
      account_number_last4: rng.string(4, '0123456789'),
      // Filled in below, once the ledger exists.
      balance_cash: 0,
      balance_inbound_pending: 0,
      balance_outbound_pending: 0,
      currency: CURRENCY,
      created: openedAt,
    };
    treasury_financial_accounts.push(financialAccount);

    /* ----------------------------- money in ----------------------------- */

    // Ticket revenue sweeps into the account weekly. Sizing the sweeps off the
    // organizer's settled balance keeps the account's history proportional to
    // how much they actually trade, rather than inventing a number and hoping
    // it looks plausible next to their charges.
    const weeklySweep = Math.max(
      50_000,
      Math.round(weeklyRevenue * rng.between(0.35, 0.75)),
    );
    for (let ts = openedAt + 7 * DAY; ts <= NOW; ts += 7 * DAY) {
      const created = Math.round(ts + 9 * HOUR);
      const amount = Math.round((weeklySweep * rng.between(0.55, 1.5)) / 10_000) * 10_000;
      if (amount < 50_000) continue;
      // The most recent sweep has not landed yet — that is the inbound pending.
      const settled = created < NOW - 2 * DAY;
      treasury_received_credits.push({
        id: rng.id('rc', 20),
        financial_account_id: financialAccount.id,
        account_id: account.id,
        amount,
        currency: CURRENCY,
        status: settled ? 'succeeded' : 'pending',
        description: 'Ticket revenue settlement',
        network: 'stripe',
        created,
      });
    }

    const settledIn = treasury_received_credits
      .filter((c) => c.account_id === account.id && c.status === 'succeeded')
      .reduce((sum, c) => sum + c.amount, 0);

    /* ---------------------------- money out ----------------------------- */

    // Vendor payments are capped at what had actually arrived by the time each
    // one went out, so the ledger never goes negative and the running balance
    // on the activity page is monotonically sane.
    let spentSoFar = 0;
    for (let i = 0; i < rng.int(4, 9); i += 1) {
      const created = NOW - rng.int(1, 84) * DAY;
      const arrivedByThen = treasury_received_credits
        .filter((c) => c.account_id === account.id && c.created < created)
        .reduce((sum, c) => sum + c.amount, 0);
      const headroom = arrivedByThen - spentSoFar;
      if (headroom < 200_000) continue;

      const amount = Math.round(rng.between(headroom * 0.08, headroom * 0.35) / 10_000) * 10_000;
      if (amount < 100_000) continue;
      spentSoFar += amount;

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

    const posted = treasury_outbound_payments
      .filter((p) => p.account_id === account.id && p.status === 'posted')
      .reduce((sum, p) => sum + p.amount, 0);
    const processing = treasury_outbound_payments
      .filter((p) => p.account_id === account.id && p.status === 'processing')
      .reduce((sum, p) => sum + p.amount, 0);

    // The balance is derived, not asserted. Card spend is subtracted further
    // down, once the cards that draw on this account exist.
    financialAccount.balance_cash = settledIn - posted;
    financialAccount.balance_inbound_pending = treasury_received_credits
      .filter((c) => c.account_id === account.id && c.status === 'pending')
      .reduce((sum, c) => sum + c.amount, 0);
    financialAccount.balance_outbound_pending = processing;
  }

  /* -------------------------------- Issuing ------------------------------ */

  const issuing_cardholders: IssuingCardholder[] = [];
  const issuing_cards: IssuingCard[] = [];
  const issuing_authorizations: IssuingAuthorization[] = [];

  // Cards only make sense where there is a funding source, so the Issuing pilot
  // is drawn from the Treasury pilot rather than independently.
  const issuingPilot = rng.sample(treasuryPilot, 6);

  /**
   * How much card spend each account can actually have supported.
   *
   * Capped at a share of the cash left after vendor payments, and decremented as
   * authorisations are generated. Without this, an organizer with a small balance
   * accumulates more card spend than ever arrived and the Event Account balance
   * has to be floored to stop it going negative — which is a real authorisation
   * that would have been declined for insufficient funds, showing up as
   * approved. The cap is the honest version.
   */
  const cardHeadroom = new Map<string, number>();
  for (const financialAccount of treasury_financial_accounts) {
    cardHeadroom.set(
      financialAccount.account_id,
      Math.round(financialAccount.balance_cash * rng.between(0.2, 0.5)),
    );
  }

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

      // Per-person monthly limits. The ceiling is a policy decision rather
      // than a formula, so it comes off a ladder — but which rungs are on the
      // table depends on what the organizer turns over, because a $25,000-a-month
      // production card at an organizer billing $18,000 a month is not a control,
      // it is an unsecured line of credit.
      const monthlyRevenue = (input.trailingVolumeByAccount.get(account.id) ?? 0) / 3;
      const ladder = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];
      const ceiling = Math.max(100_000, monthlyRevenue * 0.3);
      const affordable = ladder.filter((rung) => rung <= ceiling);
      const limit = rng.pick(affordable.length > 0 ? affordable : [ladder[0]]);
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

      // Approved spend per calendar month, so a monthly ceiling actually binds.
      const monthlySpend = new Map<string, number>();
      const monthKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 7);

      for (let i = 0; i < rng.int(4, 12); i += 1) {
        const created = NOW - rng.int(1, 80) * DAY;
        // Roughly one authorisation in nine is off-policy and declined by the
        // card's own category allow-list, which is the whole reason to set one.
        const offPolicy = rng.bool(0.11);
        const index = rng.int(0, OFF_POLICY_CATEGORIES.length - 1);
        const amount = Math.round(rng.between(limit * 0.02, limit * 0.4) / 1_000) * 1_000;

        /**
         * Two reasons a card refuses a purchase, and both have to be modelled or
         * the data contradicts the product.
         *
         * A category decline is the allow-list. A spending-limit decline is the
         * ceiling — and without it, approved spend accumulates past the monthly
         * limit and a page ends up reporting a cardholder at 110% of a ceiling
         * that the network would never have let them cross.
         *
         * Neither kind moves money, so neither consumes balance headroom.
         */
        const spentThisMonth = monthlySpend.get(monthKey(created)) ?? 0;
        const overCeiling = !offPolicy && spentThisMonth + amount > limit;

        let declineReason: string | null = null;
        if (offPolicy) declineReason = 'card_controls_merchant_category';
        else if (overCeiling) declineReason = 'card_controls_spending_limit';

        if (declineReason === null) {
          // An approved authorisation draws on the stored balance. If there is
          // not enough left the card would have been declined for insufficient
          // funds, which is a third case this dataset does not need — so skip it
          // rather than record a decline the page would have to explain.
          const left = cardHeadroom.get(account.id) ?? 0;
          if (amount > left) continue;
          cardHeadroom.set(account.id, left - amount);
          monthlySpend.set(monthKey(created), spentThisMonth + amount);
        }

        const approved = declineReason === null;
        issuing_authorizations.push({
          id: rng.id('iauth', 20),
          card_id: card.id,
          account_id: account.id,
          amount,
          currency: CURRENCY,
          approved,
          status: approved ? (created < NOW - 2 * DAY ? 'closed' : 'pending') : 'closed',
          decline_reason: declineReason,
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

  // Cards draw on the stored balance, so approved card spend comes out of cash
  // the same way a vendor payment does. Doing it here rather than inside the
  // Treasury block above is only an ordering constraint: the cards did not exist
  // yet. Without this the Event Account page would show a balance that does not
  // reconcile against the card activity sitting next to it.
  for (const financialAccount of treasury_financial_accounts) {
    const cardSpend = issuing_authorizations
      .filter(
        (auth) =>
          auth.account_id === financialAccount.account_id &&
          auth.approved &&
          auth.status === 'closed',
      )
      .reduce((sum, auth) => sum + auth.amount, 0);
    // No floor needed: `cardHeadroom` above already refused any authorisation
    // the balance could not fund, so this subtraction cannot go negative. If it
    // ever does, the headroom accounting has drifted and that is worth knowing
    // rather than papering over.
    financialAccount.balance_cash -= cardSpend;
  }

  return {
    capital_financing_offers,
    capital_financing_summaries,
    treasury_financial_accounts,
    treasury_outbound_payments,
    treasury_received_credits,
    issuing_cardholders,
    issuing_cards,
    issuing_authorizations,
  };
}

export { VENDOR_NAMES, EVENT_SPEND_CATEGORIES, CARDHOLDER_ROLES };
