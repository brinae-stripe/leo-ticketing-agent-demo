import { api } from '../../stripe-sim';
import { NOW } from '../../sim/constants';
import { nextId } from '../../stripe-sim/ids';
import { money, num, percent, plural, sql, str } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

/**
 * "Should I offer pay-over-time on my $300 VIP tier?"
 *
 * A pricing question dressed as a payments question. The answer has to weigh
 * three real numbers: what the top tier actually converts at, how many of those
 * declines look like affordability rather than fraud, and what the extra ~3
 * points of processing cost on Affirm or Klarna does to the margin.
 *
 * Enabling it is not the organizer's call alone — pay-over-time changes what
 * StageGate is underwriting — so this files a request and says so.
 */
export const vipPayOverTime: Scenario = {
  id: 'organizer_vip_bnpl',
  scope: 'organizer',
  title: 'Pay-over-time on the top tier',
  suggestedPrompt: 'Should I offer pay-over-time on my $300 VIP tier?',
  blurb:
    'Weighs conversion on high-value tiers, insufficient-funds declines and the extra processing cost before recommending Affirm or Klarna.',
  triggers: [
    'should i offer pay-over-time on my $300 vip tier',
    'should i offer pay over time',
    'should i offer affirm',
    'should i offer klarna',
    'pay over time on vip',
    'buy now pay later',
  ],
  keywords: ['vip', 'pay', 'over', 'time', 'affirm', 'klarna', 'afterpay', 'instalment', 'tier'],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const host = ctx.index.accountById.get(accountId)!;
    const config = ctx.index.pmcByAccount.get(accountId);

    const bucketCase = `CASE
    WHEN c.amount < 5000 THEN '01_under_50'
    WHEN c.amount < 10000 THEN '02_50_to_100'
    WHEN c.amount < 20000 THEN '03_100_to_200'
    WHEN c.amount < 30000 THEN '04_200_to_300'
    ELSE '05_300_plus'
  END`;

    const bucketSql = sql`
-- Conversion by order value for this host. If the top band converts materially
-- worse than the rest, price is doing something to the checkout.
SELECT
  ${bucketCase} AS order_band,
  COUNT(*) AS attempts,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS succeeded,
  ROUND(SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) / COUNT(*), 4) AS conversion,
  ROUND(AVG(c.amount), 0) AS avg_order_value,
  SUM(c.amount) AS gross_volume
FROM charges c
WHERE c.account_id = '${accountId}'
GROUP BY ${bucketCase}
ORDER BY order_band ASC`;

    const declineSql = sql`
-- Why the top band gets declined. insufficient_funds is the affordability
-- signal; the rest are not fixed by offering instalments.
SELECT
  c.outcome_reason,
  COUNT(*) AS declines,
  SUM(c.amount) AS declined_value
FROM charges c
WHERE c.account_id = '${accountId}'
  AND c.paid = false
  AND c.amount >= 20000
GROUP BY c.outcome_reason
ORDER BY declines DESC`;

    const tierSql = sql`
-- The host's own tiers, so the recommendation names the right one.
SELECT
  c.metadata_tier AS tier,
  COUNT(*) AS attempts,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS succeeded,
  ROUND(SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) / COUNT(*), 4) AS conversion,
  ROUND(AVG(c.amount), 0) AS avg_order_value,
  SUM(c.amount) AS gross_volume
FROM charges c
WHERE c.account_id = '${accountId}'
GROUP BY c.metadata_tier
ORDER BY avg_order_value DESC`;

    const platformSql = sql`
-- Platform-wide pay-over-time benchmark: is anyone actually using it, and at
-- what order size?
SELECT
  c.payment_method_details_type AS method,
  COUNT(*) AS attempts,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS succeeded,
  ROUND(SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) / COUNT(*), 4) AS conversion,
  ROUND(AVG(c.amount), 0) AS avg_order_value,
  COUNT(DISTINCT c.account_id) AS hosts_using
FROM charges c
WHERE c.payment_method_details_type IN ('klarna', 'affirm', 'afterpay_clearpay')
GROUP BY c.payment_method_details_type
ORDER BY attempts DESC`;

    const [buckets, declines, tiers, platform] = await Promise.all([
      ctx.sql(bucketSql),
      ctx.sql(declineSql),
      ctx.sql(tierSql),
      ctx.sql(platformSql),
    ]);

    const topBand = buckets.rows.find((r) => str(r, 'order_band') === '05_300_plus');
    const highBand = buckets.rows.find((r) => str(r, 'order_band') === '04_200_to_300');
    const lowBands = buckets.rows.filter((r) =>
      ['01_under_50', '02_50_to_100'].includes(str(r, 'order_band')),
    );

    const lowConv =
      lowBands.reduce((s, r) => s + num(r, 'succeeded'), 0) /
      Math.max(1, lowBands.reduce((s, r) => s + num(r, 'attempts'), 0));
    const topConv = num(topBand, 'conversion') || num(highBand, 'conversion');
    const gap = lowConv - topConv;

    const nsf = declines.rows.find((r) => str(r, 'outcome_reason') === 'insufficient_funds');
    const nsfCount = num(nsf, 'declines');
    const totalHighDeclines = declines.rows.reduce((s, r) => s + num(r, 'declines'), 0);
    const nsfShare = nsfCount / Math.max(1, totalHighDeclines);

    const premiumTier = tiers.rows[0];
    const premiumVolume = num(premiumTier, 'gross_volume');
    const premiumAov = num(premiumTier, 'avg_order_value');

    // Extra cost of moving premium-tier volume onto pay-over-time.
    const cardCost = premiumVolume * 0.029 + num(premiumTier, 'succeeded') * 30;
    const bnplCost = premiumVolume * 0.0599 + num(premiumTier, 'succeeded') * 30;
    const extraCost = Math.round(bnplCost - cardCost);
    // Recovered revenue if the affordability declines converted instead.
    const recoverable = Math.round(nsfCount * premiumAov);
    const worthIt = recoverable > extraCost;

    const affirmOn = config?.payment_methods.affirm?.display_preference.preference === 'on';

    const answer = [
      `Your top tier is ${str(premiumTier, 'tier')} at ${money(premiumAov)} average, ${money(premiumVolume)} of volume this quarter. It converts at ${percent(topConv, 1)} against ${percent(lowConv, 1)} on your cheapest tiers — a ${(gap * 100).toFixed(1)} point gap.`,
      totalHighDeclines > 0
        ? `Of the ${plural(totalHighDeclines, 'decline')} on orders over ${money(20_000)}, ${nsfCount} were insufficient funds — ${percent(nsfShare, 0)}. That is the number that matters: insufficient funds means the buyer wanted the ticket and the money was not there, which is exactly what instalments fix. The rest ${declines.rows.filter((r) => str(r, 'outcome_reason') !== 'insufficient_funds').length > 0 ? `(${declines.rows.filter((r) => str(r, 'outcome_reason') !== 'insufficient_funds').map((r) => `${num(r, 'declines')} ${str(r, 'outcome_reason').replace(/_/g, ' ')}`).join(', ')}) ` : ''}would not be helped by it.`
        : `There are no declines on orders over ${money(20_000)} for you at all, which weakens the case considerably — there is no visible affordability problem to solve.`,
      `The cost side: Affirm and Klarna run around 5.99% + $0.30 against 2.9% + $0.30 for cards. Moving your ${str(premiumTier, 'tier')} volume onto pay-over-time would cost roughly ${money(extraCost)} more in processing per quarter. Recovering those ${nsfCount} affordability declines at your ${money(premiumAov)} average order would be worth about ${money(recoverable)}.`,
      platform.rows.length > 0
        ? `For context, ${platform.rows.reduce((s, r) => s + num(r, 'hosts_using'), 0)} hosts on StageGate take pay-over-time today, at an average order of ${money(Math.round(platform.rows.reduce((s, r) => s + num(r, 'avg_order_value') * num(r, 'attempts'), 0) / Math.max(1, platform.rows.reduce((s, r) => s + num(r, 'attempts'), 0))))} and ${percent(platform.rows.reduce((s, r) => s + num(r, 'succeeded'), 0) / Math.max(1, platform.rows.reduce((s, r) => s + num(r, 'attempts'), 0)), 1)} conversion. It is a premium-tier tool, not a general one.`
        : 'No hosts on StageGate currently take pay-over-time, so there is no internal benchmark to compare against.',
      worthIt
        ? `On these numbers it is worth trying — ${money(recoverable)} of recoverable demand against ${money(extraCost)} of extra cost. Worth scoping it to the top tier only, so the higher rate does not apply to your ${money(num(lowBands[0], 'avg_order_value'))} tickets.`
        : `On these numbers it does not pay for itself yet: ${money(recoverable)} of recoverable demand against ${money(extraCost)} of extra processing cost. Worth revisiting if the top tier grows or if you add a higher-priced package.`,
    ];

    const detail = `Requesting Affirm and Klarna for the ${str(premiumTier, 'tier')} tier. ${money(premiumVolume)} quarterly volume at ${money(premiumAov)} average order; ${nsfCount} insufficient-funds declines above ${money(20_000)} this quarter; modelled recoverable revenue ${money(recoverable)} against ${money(extraCost)} additional processing cost.`;

    return {
      answer,
      queries: [
        { label: 'Conversion by order value', sql: bucketSql, result: buckets },
        { label: 'Declines on orders over $200', sql: declineSql, result: declines },
        { label: 'Your tiers', sql: tierSql, result: tiers },
        { label: 'Platform pay-over-time benchmark', sql: platformSql, result: platform },
      ],
      table: {
        caption: 'Conversion by order value',
        columns: [
          { key: 'order_band', label: 'Order value' },
          { key: 'attempts', label: 'Attempts', align: 'right', kind: 'number' },
          { key: 'succeeded', label: 'Succeeded', align: 'right', kind: 'number' },
          { key: 'conversion', label: 'Conversion', align: 'right', kind: 'percent' },
          { key: 'gross_volume', label: 'Volume', align: 'right', kind: 'money' },
        ],
        rows: buckets.rows,
      },
      resolution: {
        headline: worthIt
          ? `Yes — for the ${str(premiumTier, 'tier')} tier only. Request it from StageGate.`
          : `Not yet on these numbers, but here is the request if you want to try it anyway.`,
        body: affirmOn
          ? `Pay-over-time is already switched on for your account, so there is nothing to request — check that your checkout is surfacing it on the top tier.`
          : `Turning on a pay-over-time method is a joint decision: it changes what StageGate underwrites and it changes your effective rate. The copilot files a request for their payments team with the numbers attached, so the conversation starts from evidence rather than a hunch.`,
        bullets: [
          `${str(premiumTier, 'tier')}: ${money(premiumAov)} average, ${percent(topConv, 1)} conversion`,
          `${nsfCount} insufficient-funds declines above ${money(20_000)}`,
          `${money(extraCost)} extra processing cost versus ${money(recoverable)} recoverable`,
          'Instant Bank Payments would be the cheaper alternative, but it needs Stripe review',
        ],
      },
      actions: config
        ? [
            {
              id: 'organizer_request_bnpl',
              label: 'Request Affirm on my checkout',
              surface: 'api',
              callLabel: 'Platform request + POST /v1/payment_method_configurations/:id',
              method: 'POST',
              path: `/v1/payment_method_configurations/${config.id}`,
              stripeAccount: accountId,
              plainEnglish: `Two things happen. First, a request is filed for StageGate's payments team with the numbers above attached — that is the approval step, and in production it waits for a human. Second, because this demo lets you stand in for the platform, the configuration change is applied immediately so you can see the result. In a real deployment those are days apart.`,
              params: {
                request: {
                  account: accountId,
                  kind: 'payment_method_enablement',
                  methods: ['affirm', 'klarna'],
                  detail,
                },
                configuration: {
                  'affirm[display_preference][preference]': 'on',
                  'klarna[display_preference][preference]': 'on',
                },
              },
              totals: [
                { label: 'Methods requested', value: 'Affirm, Klarna' },
                { label: 'Configuration', value: config.id },
                { label: 'Extra cost modelled', value: money(extraCost), tone: 'warn' },
                { label: 'Recoverable modelled', value: money(recoverable) },
              ],
              variant: worthIt ? 'primary' : 'secondary',
              run: async (simCtx, options) => {
                // The approval item StageGate's team would action.
                simCtx.record({
                  kind: 'insert',
                  table: 'platform_requests',
                  row: {
                    id: nextId('psreq', 14),
                    account_id: accountId,
                    kind: 'payment_method_enablement',
                    detail,
                    status: 'pending_platform_review',
                    created: NOW,
                    requested_by: simCtx.actor,
                  },
                });
                return api.updatePaymentMethodConfiguration(
                  simCtx,
                  config.id,
                  { updates: { affirm: 'on', klarna: 'on' } },
                  { idempotencyKey: options.idempotencyKey },
                );
              },
            },
          ]
        : [],
      dashboardOnly: [
        {
          capability: 'instant_bank_payments',
          rationale: `If the problem is genuinely affordability on ${money(premiumAov)} orders, Instant Bank Payments is worth looking at before instalments — it settles like a card payment at a materially lower rate than 5.99%. It needs Stripe to review and enable the account first, so it cannot be turned on from here.`,
        },
      ],
    };
  },
};
