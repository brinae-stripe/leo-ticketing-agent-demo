import { api } from '../../stripe-sim';
import { dashboardOnly } from '../../stripe-sim/dashboard-only';
import { list, money, num, percent, plural, pts, sql, str } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

/**
 * "Which organizers' buyers would benefit from Apple Pay or pay-over-time?"
 *
 * Two separate arguments, and they apply to different organizers. Wallets are a
 * friction argument: a buyer who has to type a card number converts worse, and
 * organizers with wallets switched off on their child configuration are the ones
 * leaving that on the table. Pay-over-time is an affordability argument: it only
 * makes sense where order values are high and we can see buyers being declined
 * for insufficient funds.
 *
 * Note on the dataset: there is no device column here, so "manually entered" is
 * online card attempts with no wallet. It is a proxy for typing friction, not a
 * mobile-versus-desktop split.
 */
export const checkoutOptimizer: Scenario = {
  id: 'checkout_optimizer',
  scope: 'internal',
  title: 'Checkout method opportunities',
  suggestedPrompt: "Which organizers' buyers would benefit from Apple Pay or pay-over-time?",
  blurb:
    'Ranks organizers by the conversion they are losing to manual card entry, and separately by how much their order values justify pay-over-time.',
  triggers: [
    "which organizers' buyers would benefit from apple pay or pay-over-time",
    'which organizers would benefit from apple pay',
    'checkout optimization',
    'wallets',
    'apple pay',
    'pay over time',
    'bnpl',
  ],
  keywords: [
    'apple', 'wallet', 'wallets', 'google', 'link', 'checkout', 'klarna', 'affirm',
    'afterpay', 'bnpl', 'optimize', 'conversion',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const methodCase = `CASE
    WHEN c.payment_method_details_type = 'card_present' THEN 'card_present'
    WHEN c.payment_method_details_type <> 'card' THEN 'pay_over_time'
    WHEN c.card_wallet_type IS NULL THEN 'card_manual_entry'
    ELSE c.card_wallet_type
  END`;

    const methodSql = sql`
-- Platform-wide conversion by how the buyer paid. This is the benchmark every
-- per-organizer recommendation below is measured against.
SELECT
  ${methodCase} AS method,
  COUNT(*) AS attempts,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS succeeded,
  ROUND(SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) / COUNT(*), 4) AS conversion,
  ROUND(AVG(c.amount), 0) AS avg_order_value
FROM charges c
GROUP BY ${methodCase}
ORDER BY attempts DESC`;

    const organizerSql = sql`
-- Checkout profile per organizer. Organizers under 150 attempts are excluded — there is
-- not enough there to recommend a change with a straight face.
SELECT
  c.account_id,
  a.business_profile_name AS organizer,
  a.metadata_organizer_category AS category,
  COUNT(*) AS attempts,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS succeeded,
  ROUND(SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) / COUNT(*), 4) AS conversion,
  SUM(CASE WHEN c.card_wallet_type IN ('apple_pay', 'google_pay') THEN 1 ELSE 0 END) AS wallet_attempts,
  SUM(CASE WHEN c.card_wallet_type = 'link' THEN 1 ELSE 0 END) AS link_attempts,
  SUM(CASE WHEN c.payment_method_details_type = 'card' AND c.card_wallet_type IS NULL THEN 1 ELSE 0 END) AS manual_card_attempts,
  SUM(CASE WHEN c.card_country <> 'US' THEN 1 ELSE 0 END) AS non_us_attempts,
  SUM(CASE WHEN c.payment_method_details_type IN ('klarna', 'affirm', 'afterpay_clearpay') THEN 1 ELSE 0 END) AS bnpl_attempts,
  SUM(CASE WHEN c.outcome_reason = 'insufficient_funds' THEN 1 ELSE 0 END) AS insufficient_funds_declines,
  SUM(CASE WHEN c.amount >= 20000 THEN 1 ELSE 0 END) AS orders_over_200,
  ROUND(AVG(c.amount), 0) AS avg_order_value,
  SUM(c.amount) AS gross_volume
FROM charges c
JOIN accounts a ON a.id = c.account_id
GROUP BY c.account_id, a.business_profile_name, a.metadata_organizer_category
HAVING COUNT(*) >= 150
ORDER BY gross_volume DESC`;

    const configSql = sql`
-- What each organizer's child payment method configuration actually has switched on.
-- A organizer can want Apple Pay and still not have it if onboarding left it off.
SELECT
  p.id AS configuration_id,
  p.account_id,
  a.business_profile_name AS organizer,
  p.parent,
  p.apple_pay_preference,
  p.google_pay_preference,
  p.link_preference,
  p.klarna_preference,
  p.affirm_preference,
  p.afterpay_clearpay_preference
FROM payment_method_configurations p
JOIN accounts a ON a.id = p.account_id
ORDER BY a.business_profile_name ASC`;

    const [methods, organizerRows, configs] = await Promise.all([
      ctx.sql(methodSql),
      ctx.sql(organizerSql),
      ctx.sql(configSql),
    ]);

    const byMethod = new Map(methods.rows.map((row) => [str(row, 'method'), row]));
    const manualConv = num(byMethod.get('card_manual_entry'), 'conversion');
    const applePayConv = num(byMethod.get('apple_pay'), 'conversion');
    const googlePayConv = num(byMethod.get('google_pay'), 'conversion');
    const linkConv = num(byMethod.get('link'), 'conversion');
    const bnplRow = byMethod.get('pay_over_time');

    const walletConv = Math.max(applePayConv, googlePayConv);
    const walletLift = walletConv - manualConv;

    const configByAccount = new Map(configs.rows.map((row) => [str(row, 'account_id'), row]));

    // Wallet candidates: wallets off in config, and a real manual-entry base.
    const walletCandidates = organizerRows.rows
      .map((row) => {
        const config = configByAccount.get(str(row, 'account_id'));
        const walletsOff = str(config, 'apple_pay_preference') === 'off';
        const manual = num(row, 'manual_card_attempts');
        const attempts = num(row, 'attempts');
        const manualShare = manual / Math.max(1, attempts);
        // Recoverable transactions if manual-entry buyers converted like wallet ones.
        const upside = Math.round(manual * walletLift);
        return { row, config, walletsOff, manual, manualShare, upside };
      })
      .filter((c) => c.walletsOff && c.manual >= 60 && c.upside > 0)
      .sort((a, b) => b.upside - a.upside);

    // Pay-over-time candidates: high order values plus visible affordability pain.
    const bnplCandidates = organizerRows.rows
      .map((row) => {
        const config = configByAccount.get(str(row, 'account_id'));
        const bnplOff = str(config, 'affirm_preference') === 'off';
        const aov = num(row, 'avg_order_value');
        const bigOrders = num(row, 'orders_over_200');
        const nsf = num(row, 'insufficient_funds_declines');
        return { row, config, bnplOff, aov, bigOrders, nsf };
      })
      .filter((c) => c.bnplOff && c.aov >= 18_000 && c.nsf >= 3)
      .sort((a, b) => b.aov - a.aov);

    const platformAov = Math.round(
      organizerRows.rows.reduce((s, r) => s + num(r, 'gross_volume'), 0) /
        Math.max(1, organizerRows.rows.reduce((s, r) => s + num(r, 'succeeded'), 0)),
    );

    const walletItems: ScenarioItem[] = walletCandidates.slice(0, 6).map((candidate) => {
      const accountId = str(candidate.row, 'account_id');
      const organizer = str(candidate.row, 'organizer');
      const configId = str(candidate.config, 'configuration_id');

      return {
        id: `wallet_${accountId}`,
        title: organizer,
        subtitle: `${percent(candidate.manualShare, 0)} of attempts are typed card numbers · ${plural(candidate.upside, 'transaction')} recoverable`,
        href: `/organizers/${accountId}`,
        facts: [
          {
            label: 'Manually entered',
            value: `${candidate.manual.toLocaleString('en-US')} of ${num(candidate.row, 'attempts').toLocaleString('en-US')} attempts`,
            tone: 'warn',
          },
          {
            label: 'Their conversion',
            value: percent(num(candidate.row, 'conversion'), 1),
          },
          {
            label: 'Wallet conversion, platform',
            value: `${percent(walletConv, 1)} (${pts(walletLift)} better)`,
            tone: 'good',
          },
          {
            label: 'Apple Pay / Google Pay',
            value: 'Off on their configuration',
            tone: 'danger',
          },
        ],
        recommendation: `Turn on Apple Pay and Google Pay. ${candidate.manual.toLocaleString('en-US')} attempts came through as typed card numbers; at the platform wallet conversion rate that is roughly ${plural(candidate.upside, 'extra successful order')} on the same traffic.`,
        actions: [
          {
            id: `enable_wallets_${accountId}`,
            label: 'Enable Apple Pay + Google Pay',
            surface: 'api',
            callLabel: 'POST /v1/payment_method_configurations/:id',
            method: 'POST',
            path: `/v1/payment_method_configurations/${configId}`,
            stripeAccount: accountId,
            plainEnglish: `Switches Apple Pay and Google Pay on in ${organizer}'s child payment method configuration. Buyers on a supported device will see the wallet button at the top of checkout from the next page load. Nothing changes for buyers who already use a card.`,
            params: {
              'apple_pay[display_preference][preference]': 'on',
              'google_pay[display_preference][preference]': 'on',
            },
            totals: [
              { label: 'Organizer', value: organizer },
              { label: 'Configuration', value: configId },
              { label: 'Manual-entry attempts', value: candidate.manual.toLocaleString('en-US') },
              { label: 'Modelled upside', value: `${plural(candidate.upside, 'order')} / quarter` },
            ],
            variant: 'primary',
            run: (simCtx, options) =>
              api.updatePaymentMethodConfiguration(
                simCtx,
                configId,
                { updates: { apple_pay: 'on', google_pay: 'on' } },
                { idempotencyKey: options.idempotencyKey },
              ),
          },
        ],
      };
    });

    const bnplItems: ScenarioItem[] = bnplCandidates.slice(0, 4).map((candidate) => {
      const accountId = str(candidate.row, 'account_id');
      const organizer = str(candidate.row, 'organizer');
      const configId = str(candidate.config, 'configuration_id');

      return {
        id: `bnpl_${accountId}`,
        title: organizer,
        subtitle: `${money(candidate.aov)} average order · ${plural(candidate.nsf, 'insufficient-funds decline')}`,
        href: `/organizers/${accountId}`,
        facts: [
          {
            label: 'Average order',
            value: `${money(candidate.aov)} vs ${money(platformAov)} platform`,
            tone: 'warn',
          },
          {
            label: 'Orders over $200',
            value: candidate.bigOrders.toLocaleString('en-US'),
          },
          {
            label: 'Insufficient funds',
            value: `${candidate.nsf} declines`,
            tone: 'warn',
          },
          {
            label: 'Pay over time',
            value: 'Off on their configuration',
            tone: 'danger',
          },
        ],
        recommendation: `Offer Affirm and Klarna. Average order is ${money(candidate.aov)} — ${Math.round((candidate.aov / Math.max(1, platformAov)) * 10) / 10}× the platform average — and ${candidate.nsf} attempts were declined for insufficient funds, which is the signal that price is the blocker rather than intent.`,
        actions: [
          {
            id: `enable_bnpl_${accountId}`,
            label: 'Enable Affirm + Klarna',
            surface: 'api',
            callLabel: 'POST /v1/payment_method_configurations/:id',
            method: 'POST',
            path: `/v1/payment_method_configurations/${configId}`,
            stripeAccount: accountId,
            plainEnglish: `Switches Affirm and Klarna on for ${organizer}. Pay-over-time carries a higher processing rate — around 5.99% + $0.30 against 2.9% + $0.30 for cards — so it only pays for itself on orders this size. Marquee is paid in full at the time of sale either way.`,
            params: {
              'affirm[display_preference][preference]': 'on',
              'klarna[display_preference][preference]': 'on',
            },
            totals: [
              { label: 'Organizer', value: organizer },
              { label: 'Average order', value: money(candidate.aov) },
              { label: 'Processing rate', value: '≈5.99% + $0.30 on those orders' },
              {
                label: 'Platform pay-over-time conversion',
                value: percent(num(bnplRow, 'conversion'), 1),
              },
            ],
            variant: 'primary',
            run: (simCtx, options) =>
              api.updatePaymentMethodConfiguration(
                simCtx,
                configId,
                { updates: { affirm: 'on', klarna: 'on' } },
                { idempotencyKey: options.idempotencyKey },
              ),
          },
        ],
      };
    });

    const totalWalletUpside = walletCandidates.reduce((s, c) => s + c.upside, 0);

    const answer = [
      `Two different arguments here, and they point at different organizers. Platform-wide, wallet payments convert at ${percent(walletConv, 1)} and Link at ${percent(linkConv, 1)}, against ${percent(manualConv, 1)} for a typed card number — a ${pts(walletLift)} gap on identical traffic.`,
      `${plural(walletCandidates.length, 'organizer')} have Apple Pay and Google Pay switched off on their child configuration while still taking real volume through manual card entry. The biggest is ${str(walletCandidates[0]?.row, 'organizer')}, where ${num(walletCandidates[0]?.row, 'manual_card_attempts').toLocaleString('en-US')} attempts were typed card numbers. Across all ${walletCandidates.length}, closing that gap is worth roughly ${plural(totalWalletUpside, 'additional successful order')} per quarter on the traffic they already have.`,
      `Pay-over-time is a narrower case. ${plural(bnplCandidates.length, 'organizer')} clear the bar: average order above ${money(18_000)} and visible insufficient-funds declines. ${bnplCandidates.length > 0 ? `${list(bnplCandidates.slice(0, 3).map((c) => `${str(c.row, 'organizer')} at ${money(c.aov)}`))}.` : ''} Everywhere else the 5.99% rate is not worth it — platform pay-over-time is only ${percent(num(bnplRow, 'attempts') / Math.max(1, organizerRows.rows.reduce((s, r) => s + num(r, 'attempts'), 0)), 2)} of attempts today, and that is about right.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Conversion by payment method', note: 'The platform benchmark.', sql: methodSql, result: methods },
        { label: 'Checkout profile per organizer', note: 'Organizers with at least 150 attempts.', sql: organizerSql, result: organizerRows },
        { label: 'What each organizer has switched on', sql: configSql, result: configs },
      ],
      table: {
        caption: 'Conversion by method, platform-wide',
        columns: [
          { key: 'method', label: 'Method' },
          { key: 'attempts', label: 'Attempts', align: 'right', kind: 'number' },
          { key: 'succeeded', label: 'Succeeded', align: 'right', kind: 'number' },
          { key: 'conversion', label: 'Conversion', align: 'right', kind: 'percent' },
          { key: 'avg_order_value', label: 'Avg order', align: 'right', kind: 'money' },
        ],
        rows: methods.rows,
      },
      items: [...walletItems, ...bnplItems],
      resolution: {
        headline: `Turn wallets on for ${walletCandidates.length} organizers. Offer pay-over-time to ${bnplCandidates.length}.`,
        body: `Wallets are close to free — no rate change, no buyer-facing risk, and the conversion gap is measured on our own traffic. Pay-over-time costs roughly 3 points more per transaction, so it should stay limited to the organizers whose order values justify it rather than being switched on platform-wide.`,
        bullets: [
          `${pts(walletLift)} conversion gap between wallet and typed-card checkout`,
          `${plural(totalWalletUpside, 'order')} per quarter recoverable across the wallet candidates`,
          'Each change is scoped to that organizer\'s child configuration, not the platform default',
          'Network tokens and Account Updater would help the same cohort but cannot be enabled through the API',
        ],
      },
      actions: [],
      dashboardOnly: [
        dashboardOnly(
          'network_tokens',
          `The organizers above take ${percent(organizerRows.rows.reduce((s, r) => s + num(r, 'non_us_attempts'), 0) / Math.max(1, organizerRows.rows.reduce((s, r) => s + num(r, 'attempts'), 0)), 1)} of their attempts on non-US cards, which is where network tokens lift authorisation most. There is no endpoint for this — it is enabled per account by Stripe.`,
        ),
        dashboardOnly(
          'card_account_updater',
          `${organizerRows.rows.reduce((s, r) => s + num(r, 'insufficient_funds_declines'), 0).toLocaleString('en-US')} insufficient-funds declines and the platform's 0.5% stale-credential decline rate both point the same way. Account Updater refreshes stored cards automatically, but it is a Dashboard setting.`,
        ),
        dashboardOnly(
          'adaptive_acceptance',
          `Manual-entry conversion sits ${pts(walletLift)} below wallets even after controlling for card country. Adaptive Acceptance works on exactly that retry-and-reformat layer, and it is applied by Stripe rather than configured by us.`,
        ),
      ],
    };
  },
};
