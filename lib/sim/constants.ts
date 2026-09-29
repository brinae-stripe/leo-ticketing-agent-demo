/** Global knobs for the seeded simulation. */

/** Fixed seed. Change this and every number in the demo changes. */
export const SEED = 20260925;

/**
 * The narrative platform processes ~2.4M payment attempts per quarter. Holding
 * 2.4M rows in a browser tab is not realistic, so the seeded dataset is a
 * 1:100 sample: 24,000 charge rows stand in for 2.4M attempts.
 *
 * Rates (success %, block %, mix %) are read straight off the sample. Absolute
 * counts and amounts are labelled "sampled" in the UI, and anywhere we quote a
 * platform-wide total we multiply by SCALE_FACTOR and say so.
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
