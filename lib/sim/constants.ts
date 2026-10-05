/** Global knobs for the seeded simulation. */

/** Fixed seed. Change this and every number in the demo changes. */
export const SEED = 20260925;

/**
 * The narrative platform processes ~2.4M payment attempts per quarter across
 * thousands of organizers. Holding that in a browser tab is not realistic, so
 * the dataset is a 1:100 sample — and *what is sampled is the organizers*.
 *
 * The 70 accounts here stand in for roughly 7,000. Each one's history is
 * complete: Big Fork Food & Wine really did take 961 payments for $338,270 last
 * quarter, and that is the whole of their business, not a hundredth of it.
 *
 * Getting this axis the wrong way round is not a cosmetic error. Sampling each
 * organizer's charges instead means every organizer's own figures have to be
 * multiplied by 100 to be "real", which turns a regional food festival into a
 * $134M-a-year operation, hands it a $9.7M Capital offer, and bills it $490,000
 * for a venue deposit. Every one of those numbers is individually defensible and
 * collectively absurd. Sampling organizers keeps the same platform headline and
 * leaves every per-organizer figure one a reader can sanity-check.
 *
 * So the rule, which holds everywhere in this codebase:
 *
 * - **An organizer's own figures are never scaled.** Their volume, balance,
 *   financing offer, supplier bills, stored balance and card limits are real as
 *   they stand.
 * - **Platform-wide roll-ups are scaled, and say so.** Totals across all
 *   organizers multiply by SCALE_FACTOR, because the 70 shown are 1% of them.
 *
 * Rates (success %, block %, mix %) are read straight off the sample and are
 * directly comparable to a real platform's either way.
 */
export const SCALE_FACTOR = 100;

/** Number of sampled charge (payment attempt) rows. */
export const TOTAL_CHARGES = 24_000;

/** Connected accounts ("event organizers"). */
export const TOTAL_ACCOUNTS = 70;

/**
 * "Now" is pinned so the dataset never drifts. All relative windows
 * (trailing quarter, next 72 hours, next 14 days) are measured from here.
 */
export const NOW_ISO = '2026-09-25T18:00:00.000Z';
export const NOW = Math.floor(Date.parse(NOW_ISO) / 1000);

export const DAY = 86_400;
export const HOUR = 3_600;
export const WEEK = 7 * DAY;

/** Trailing-quarter analysis window. */
export const QUARTER_DAYS = 91;
export const QUARTER_START = NOW - QUARTER_DAYS * DAY;

/** Trend charts cover 13 complete weeks. */
export const TREND_WEEKS = 13;

/** Platform currency. Every charge settles in USD. */
export const CURRENCY = 'usd';

/** Targets the generator calibrates toward (documented in /how-it-works). */
export const TARGETS = {
  paymentSuccessRate: 0.957,
  blockRate: 0.01,
  walletShareOfAttempts: 0.17,
  linkShareOfTransactions: 0.22,
  cardPresentShareOfAttempts: 0.1,
  bnplShareOfVolume: 0.01,
  disputeRate: 0.0008,
  nonUsCardShare: 0.12,
  nonUsConversionGapPts: 5,
  debitConversionGapPts: 2,
  outdatedCardDetailsDeclineRate: 0.005,
} as const;

/** Hand-placed situations the scenarios depend on. */
export const FIXTURES = {
  disputesDueWithin72h: 10,
  actionableEfwsUnrefunded: 17,
  openReviews: 9,
  organizersBlockedFromPayouts: 12,
  negativeBalanceOrganizers: 3,
  cancellingEventChargeCount: 2_100,
  offlineReaderVenue: 'Cascade Aquarium',
} as const;

/** Stripe pricing used by the fee simulation (US standard list pricing). */
export const PRICING = {
  cardPercent: 0.029,
  cardFixed: 30,
  cardPresentPercent: 0.027,
  cardPresentFixed: 5,
  bnplPercent: 0.0599,
  bnplFixed: 30,
  internationalCardPercent: 0.015,
  disputeFee: 1_500,
  instantPayoutPercent: 0.015,
} as const;
