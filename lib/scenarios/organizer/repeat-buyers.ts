import { mcp } from '../../stripe-sim';
import { QUARTER_DAYS } from '../../sim/constants';
import { longDate, shortDate } from '../../sim/format';
import { money, num, percent, plural, sql, str } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

/**
 * "How many of my buyers are repeat customers vs last year?"
 *
 * Worth being straight about the limit: this warehouse only holds the trailing
 * quarter, so there is no last year to compare against. Rather than invent one,
 * the agent answers the half it can — repeat rate across this quarter's events —
 * says plainly what is missing, and states what it would take to answer the rest.
 */
export const repeatBuyers: Scenario = {
  id: 'organizer_repeat_buyers',
  scope: 'organizer',
  title: 'Repeat buyers',
  suggestedPrompt: 'How many of my buyers are repeat customers vs last year?',
  blurb:
    'Measures repeat purchase rate across this quarter using card fingerprints, and is explicit about the year-over-year data it does not have.',
  triggers: [
    'how many of my buyers are repeat customers vs last year',
    'how many of my buyers are repeat customers',
    'repeat customers',
    'repeat buyers',
    'returning customers',
    'how many returning buyers',
  ],
  keywords: ['repeat', 'returning', 'loyal', 'buyers', 'customers', 'cohort', 'retention'],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const host = ctx.index.accountById.get(accountId)!;

    const repeatSql = sql`
-- Repeat buyers, identified by card fingerprint rather than customer id.
-- Fingerprint is the better key here: guest checkout creates a fresh customer
-- every time, but the same physical card keeps the same fingerprint.
SELECT
  c.card_fingerprint,
  COUNT(*) AS purchases,
  COUNT(DISTINCT c.metadata_event_id) AS events_attended,
  SUM(c.amount) AS lifetime_spend,
  SUM(c.metadata_quantity) AS tickets,
  MIN(c.created) AS first_purchase,
  MAX(c.created) AS last_purchase
FROM charges c
WHERE c.account_id = '${accountId}'
  AND c.paid = true
GROUP BY c.card_fingerprint
ORDER BY purchases DESC, lifetime_spend DESC`;

    const summarySql = sql`
-- Headline split, computed over the same base.
SELECT
  COUNT(DISTINCT c.card_fingerprint) AS distinct_buyers,
  COUNT(*) AS paid_orders,
  SUM(c.amount) AS gross_volume,
  SUM(c.metadata_quantity) AS tickets_sold,
  COUNT(DISTINCT c.metadata_event_id) AS events_with_sales,
  MIN(c.created) AS earliest_sale
FROM charges c
WHERE c.account_id = '${accountId}'
  AND c.paid = true`;

    const eventSql = sql`
-- Per event, so you can see whether repeat business is growing show to show.
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.starts_at,
  e.status,
  COUNT(*) AS paid_orders,
  COUNT(DISTINCT c.card_fingerprint) AS distinct_buyers,
  SUM(c.amount) AS gross_volume,
  ROUND(AVG(c.amount), 0) AS avg_order_value
FROM charges c
JOIN events e ON e.id = c.metadata_event_id
WHERE c.account_id = '${accountId}'
  AND c.paid = true
GROUP BY e.id, e.name, e.starts_at, e.status
ORDER BY e.starts_at ASC`;

    const [repeat, summary, byEvent] = await Promise.all([
      ctx.sql(repeatSql),
      ctx.sql(summarySql),
      ctx.sql(eventSql),
    ]);

    const buyers = repeat.rows;
    const repeaters = buyers.filter((row) => num(row, 'purchases') > 1);
    const multiEvent = buyers.filter((row) => num(row, 'events_attended') > 1);

    const distinctBuyers = num(summary.rows[0], 'distinct_buyers');
    const paidOrders = num(summary.rows[0], 'paid_orders');
    const grossVolume = num(summary.rows[0], 'gross_volume');
    const earliest = num(summary.rows[0], 'earliest_sale');

    const repeatBuyerRate = repeaters.length / Math.max(1, distinctBuyers);
    const repeatOrders = repeaters.reduce((s, r) => s + num(r, 'purchases'), 0);
    const repeatOrderShare = repeatOrders / Math.max(1, paidOrders);
    const repeatRevenue = repeaters.reduce((s, r) => s + num(r, 'lifetime_spend'), 0);
    const repeatRevenueShare = repeatRevenue / Math.max(1, grossVolume);

    const avgRepeatSpend = repeatRevenue / Math.max(1, repeaters.length);
    const oneTime = buyers.filter((row) => num(row, 'purchases') === 1);
    const avgOneTimeSpend =
      oneTime.reduce((s, r) => s + num(r, 'lifetime_spend'), 0) / Math.max(1, oneTime.length);

    const topBuyers = buyers.slice(0, 8);
    const presaleUnit = Math.round(
      (grossVolume / Math.max(1, paidOrders)) * 0.85 / 100,
    ) * 100;

    const answer = [
      `Across the ${QUARTER_DAYS} days of data we hold, ${host.business_profile_name} sold to ${distinctBuyers.toLocaleString('en-US')} distinct cards over ${plural(paidOrders, 'order')}. ${repeaters.length.toLocaleString('en-US')} of those cards bought more than once — a repeat rate of ${percent(repeatBuyerRate, 1)}.`,
      `Repeat buyers punch above their weight: they are ${percent(repeatBuyerRate, 1)} of your buyers but ${percent(repeatOrderShare, 1)} of orders and ${percent(repeatRevenueShare, 1)} of revenue. Average lifetime spend is ${money(avgRepeatSpend)} against ${money(avgOneTimeSpend)} for a one-time buyer — roughly ${(avgRepeatSpend / Math.max(1, avgOneTimeSpend)).toFixed(1)}×. ${multiEvent.length.toLocaleString('en-US')} of them have come to more than one of your events.`,
      `On "versus last year" — I cannot answer that from here, and I would rather say so than guess. This warehouse holds the trailing quarter only: the earliest sale in scope is ${longDate(earliest)}. A genuine year-over-year comparison needs the same fingerprint data from the equivalent period last year, which means either a longer Data Pipeline retention window or your own historical export loaded alongside it.`,
      `What you can see today is the trend across your own shows this quarter: ${byEvent.rows.map((row) => `${str(row, 'event_name').split('—').pop()?.trim() || str(row, 'event_name')} at ${num(row, 'distinct_buyers').toLocaleString('en-US')} buyers`).slice(0, 4).join(', ')}.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Buyers by purchase count', note: 'Keyed on card fingerprint.', sql: repeatSql, result: repeat },
        { label: 'Headline totals', sql: summarySql, result: summary },
        { label: 'Per event', sql: eventSql, result: byEvent },
      ],
      table: {
        caption: 'Your most frequent buyers',
        columns: [
          { key: 'card_fingerprint', label: 'Card' },
          { key: 'purchases', label: 'Orders', align: 'right', kind: 'number' },
          { key: 'events_attended', label: 'Events', align: 'right', kind: 'number' },
          { key: 'tickets', label: 'Tickets', align: 'right', kind: 'number' },
          { key: 'lifetime_spend', label: 'Spend', align: 'right', kind: 'money' },
          { key: 'first_purchase', label: 'First seen', kind: 'date' },
        ],
        rows: topBuyers,
      },
      resolution: {
        headline: `${percent(repeatBuyerRate, 1)} repeat rate, driving ${percent(repeatRevenueShare, 1)} of revenue. Give them first access.`,
        body: `A returning-buyer pre-sale is the obvious move: a payment link restricted to a fixed number of sessions, sent only to the ${repeaters.length.toLocaleString('en-US')} cards that have bought before. It rewards the cohort that already spends ${(avgRepeatSpend / Math.max(1, avgOneTimeSpend)).toFixed(1)}× more, and it gives you a clean read on how much of your next on-sale is repeat demand.`,
        bullets: [
          `${repeaters.length.toLocaleString('en-US')} repeat cards, ${multiEvent.length.toLocaleString('en-US')} across more than one event`,
          `${money(repeatRevenue)} of ${money(grossVolume)} comes from repeat buyers`,
          'Year-over-year needs data this warehouse does not hold — flagged rather than estimated',
        ],
      },
      actions: [
        {
          id: 'organizer_presale_link',
          label: 'Create a returning-buyer pre-sale link',
          surface: 'mcp',
          callLabel: 'create_payment_link',
          method: 'POST',
          path: '/v1/payment_links',
          stripeAccount: accountId,
          plainEnglish: `Creates a payment link for a ${money(presaleUnit)} pre-sale ticket on your account, capped at ${repeaters.length} completed checkouts so it cannot leak beyond the cohort. You send it to your repeat buyers; the cap closes it once they have used it.`,
          params: {
            line_items: [
              {
                price_data: {
                  unit_amount: presaleUnit,
                  currency: 'usd',
                  product_data: {
                    name: `${host.business_profile_name} — returning buyer pre-sale`,
                  },
                },
                quantity: 1,
              },
            ],
            restrictions: { completed_sessions: { limit: repeaters.length } },
            allow_promotion_codes: false,
            metadata: { cohort: 'repeat_buyers', cohort_size: String(repeaters.length) },
          },
          totals: [
            { label: 'Ticket price', value: money(presaleUnit) },
            { label: 'Session cap', value: repeaters.length.toLocaleString('en-US') },
            { label: 'Cohort revenue to date', value: money(repeatRevenue) },
            { label: 'Runs on', value: host.business_profile_name },
          ],
          variant: 'primary',
          run: (simCtx, options) =>
            mcp.create_payment_link(
              simCtx,
              {
                stripe_account: accountId,
                line_items: [
                  {
                    price_data: {
                      unit_amount: presaleUnit,
                      currency: 'usd',
                      product_data: {
                        name: `${host.business_profile_name} — returning buyer pre-sale`,
                      },
                    },
                    quantity: 1,
                  },
                ],
                restrictions: { completed_sessions: { limit: repeaters.length } },
                allow_promotion_codes: false,
                metadata: {
                  cohort: 'repeat_buyers',
                  cohort_size: String(repeaters.length),
                },
              },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
        {
          id: 'organizer_top_buyer_history',
          label: 'Look up your top buyer',
          surface: 'mcp',
          callLabel: 'search_stripe_resources',
          method: 'GET',
          path: '/v1/customers/search',
          plainEnglish: `Searches Stripe for the customer records behind your most frequent card (${str(topBuyers[0], 'card_fingerprint')}, ${num(topBuyers[0], 'purchases')} orders since ${shortDate(num(topBuyers[0], 'first_purchase'))}). Read-only.`,
          params: { resource: 'customers', query: str(topBuyers[0], 'card_fingerprint'), limit: 10 },
          totals: [
            { label: 'Orders', value: String(num(topBuyers[0], 'purchases')) },
            { label: 'Lifetime spend', value: money(num(topBuyers[0], 'lifetime_spend')) },
          ],
          variant: 'secondary',
          run: (simCtx, options) =>
            mcp.search_stripe_resources(
              simCtx,
              {
                resource: 'customers',
                query: str(topBuyers[0], 'card_fingerprint'),
                limit: 10,
              },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
      ],
    };
  },
};
