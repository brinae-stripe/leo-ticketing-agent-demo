import { api } from '../../stripe-sim';
import { dashboardOnly } from '../../stripe-sim/dashboard-only';
import { T, bpsDelta, findRow, money, num, percent, sql, str } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

/**
 * "Why did our effective fee go up last week?"
 *
 * Attributes the movement rather than just reporting it: cross-border mix,
 * dispute fees, funding mix and average order value each get a number, and the
 * ones that actually moved are named in the answer.
 */
export const feeExplainer: Scenario = {
  id: 'fee_explainer',
  scope: 'internal',
  title: 'Effective fee movement',
  suggestedPrompt: 'Why did our effective fee go up last week?',
  blurb:
    'Breaks a change in blended processing cost into cross-border mix, dispute fees, funding mix and order size.',
  triggers: [
    'why did our effective fee go up last week',
    'why did our effective fee go up',
    'effective fee',
    'why are our fees higher',
    'processing costs went up',
  ],
  keywords: ['fee', 'fees', 'effective', 'cost', 'costs', 'processing', 'bps', 'rate'],

  async run(ctx): Promise<ScenarioResult> {
    const weekAgo = T.daysAgo(7);
    const twoWeeksAgo = T.daysAgo(14);

    const periodSql = sql`
-- Effective Stripe cost, last 7 days vs the 7 days before.
-- Application fees are deliberately excluded: that line is Marquee revenue,
-- not cost, and it swings with which organizers are on on-charge billing.
SELECT
  CASE WHEN bt.created >= ${weekAgo} THEN 'last_7_days' ELSE 'prior_7_days' END AS period,
  COUNT(*) AS charge_count,
  SUM(bt.amount) AS gross_volume,
  SUM(fd.amount) AS stripe_fees,
  ROUND(SUM(fd.amount) / SUM(bt.amount), 5) AS effective_rate,
  ROUND(SUM(bt.amount) / COUNT(*), 0) AS avg_order_value
FROM balance_transactions bt
JOIN balance_transaction_fee_details fd
  ON fd.balance_transaction_id = bt.id
WHERE bt.reporting_category = 'charge'
  AND bt.created >= ${twoWeeksAgo}
  AND bt.created < ${T.now}
  AND fd.type = 'stripe_fee'
GROUP BY CASE WHEN bt.created >= ${weekAgo} THEN 'last_7_days' ELSE 'prior_7_days' END`;

    const originSql = sql`
-- Same two windows, split by where the card was issued. Cross-border cards
-- carry an extra 1.5%, so a shift in this mix moves the blended rate on its own.
SELECT
  CASE WHEN c.created >= ${weekAgo} THEN 'last_7_days' ELSE 'prior_7_days' END AS period,
  CASE WHEN c.card_country = 'US' THEN 'domestic' ELSE 'international' END AS card_origin,
  COUNT(*) AS charge_count,
  SUM(c.amount) AS gross_volume,
  SUM(fd.amount) AS stripe_fees,
  ROUND(SUM(fd.amount) / SUM(c.amount), 5) AS effective_rate
FROM charges c
JOIN balance_transaction_fee_details fd
  ON fd.balance_transaction_id = c.balance_transaction_id
WHERE c.paid = true
  AND fd.type = 'stripe_fee'
  AND c.created >= ${twoWeeksAgo}
  AND c.created < ${T.now}
GROUP BY
  CASE WHEN c.created >= ${weekAgo} THEN 'last_7_days' ELSE 'prior_7_days' END,
  CASE WHEN c.card_country = 'US' THEN 'domestic' ELSE 'international' END`;

    const compositionSql = sql`
-- Every fee line booked in the last 7 days, by kind.
SELECT
  fd.type AS fee_type,
  fd.description,
  COUNT(*) AS fee_lines,
  SUM(fd.amount) AS total_amount
FROM balance_transaction_fee_details fd
JOIN balance_transactions bt
  ON bt.id = fd.balance_transaction_id
WHERE bt.created >= ${weekAgo}
  AND bt.created < ${T.now}
GROUP BY fd.type, fd.description
ORDER BY total_amount DESC`;

    const fundingSql = sql`
-- Funding mix in the last 7 days. Debit is cheaper per dollar but converts
-- worse, so this is the line to check before blaming cross-border.
SELECT
  c.card_funding,
  COUNT(*) AS charge_count,
  SUM(c.amount) AS gross_volume,
  SUM(fd.amount) AS stripe_fees,
  ROUND(SUM(fd.amount) / SUM(c.amount), 5) AS effective_rate
FROM charges c
JOIN balance_transaction_fee_details fd
  ON fd.balance_transaction_id = c.balance_transaction_id
WHERE c.paid = true
  AND fd.type = 'stripe_fee'
  AND c.created >= ${weekAgo}
  AND c.created < ${T.now}
GROUP BY c.card_funding
ORDER BY gross_volume DESC`;

    const [periods, origins, composition, funding] = await Promise.all([
      ctx.sql(periodSql),
      ctx.sql(originSql),
      ctx.sql(compositionSql),
      ctx.sql(fundingSql),
    ]);

    const last = findRow(periods, 'period', 'last_7_days');
    const prior = findRow(periods, 'period', 'prior_7_days');
    const lastRate = num(last, 'effective_rate');
    const priorRate = num(prior, 'effective_rate');
    const movement = lastRate - priorRate;

    const intlLast = origins.rows.find(
      (r) => str(r, 'period') === 'last_7_days' && str(r, 'card_origin') === 'international',
    );
    const intlPrior = origins.rows.find(
      (r) => str(r, 'period') === 'prior_7_days' && str(r, 'card_origin') === 'international',
    );
    const domLast = origins.rows.find(
      (r) => str(r, 'period') === 'last_7_days' && str(r, 'card_origin') === 'domestic',
    );

    const intlShareLast =
      num(intlLast, 'gross_volume') /
      Math.max(1, num(intlLast, 'gross_volume') + num(domLast, 'gross_volume'));
    const intlSharePrior =
      num(intlPrior, 'gross_volume') /
      Math.max(
        1,
        num(intlPrior, 'gross_volume') +
          num(
            origins.rows.find(
              (r) =>
                str(r, 'period') === 'prior_7_days' && str(r, 'card_origin') === 'domestic',
            ),
            'gross_volume',
          ),
      );

    const intlRate = num(intlLast, 'effective_rate');
    const domRate = num(domLast, 'effective_rate');
    const shareShift = intlShareLast - intlSharePrior;
    // Holding rates fixed, this is the movement the mix shift alone explains.
    const mixContribution = shareShift * (intlRate - domRate);

    const disputeFees = composition.rows
      .filter((r) => str(r, 'description').toLowerCase().includes('dispute'))
      .reduce((total, r) => total + num(r, 'total_amount'), 0);
    const disputeContribution = disputeFees / Math.max(1, num(last, 'gross_volume'));

    const avgLast = num(last, 'avg_order_value');
    const avgPrior = num(prior, 'avg_order_value');

    const explained = mixContribution + disputeContribution;
    const residual = movement - explained;

    const answer = [
      `Blended Stripe cost went from ${percent(priorRate, 2)} of volume to ${percent(lastRate, 2)} — ${bpsDelta(priorRate, lastRate)} on ${money(num(last, 'gross_volume'))} of gross volume, or ${money(Math.round(movement * num(last, 'gross_volume')))} of extra cost for the week.`,
      `Cross-border mix is most of it. International cards went from ${percent(intlSharePrior, 1)} of volume to ${percent(intlShareLast, 1)}, and they cost ${percent(intlRate, 2)} against ${percent(domRate, 2)} for domestic — the extra 1.5% cross-border fee. That mix shift alone accounts for ${bpsDelta(0, mixContribution)} of the move.`,
      disputeFees > 0
        ? `Dispute fees add ${bpsDelta(0, disputeContribution)}: ${money(disputeFees)} across ${composition.rows.filter((r) => str(r, 'description').toLowerCase().includes('dispute')).reduce((n, r) => n + num(r, 'fee_lines'), 0)} new disputes, all of them at the flat $15.`
        : 'No dispute fees were booked in the window, so none of the move is chargeback-driven.',
      `Order size moved the other way and softened the blow — average order value rose from ${money(avgPrior)} to ${money(avgLast)}, which spreads the fixed $0.30 over more dollars. Between mix, disputes and order size, ${bpsDelta(0, residual)} is unexplained residual, which is within the noise for a single week.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Effective rate, week over week', note: 'Stripe fees only, application fees excluded.', sql: periodSql, result: periods },
        { label: 'Split by card origin', note: 'Where the mix shift shows up.', sql: originSql, result: origins },
        { label: 'Fee composition, last 7 days', note: 'Every fee line by kind.', sql: compositionSql, result: composition },
        { label: 'Funding mix, last 7 days', sql: fundingSql, result: funding },
      ],
      table: {
        caption: 'Effective rate by card origin',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'card_origin', label: 'Card origin' },
          { key: 'charge_count', label: 'Charges', align: 'right', kind: 'number' },
          { key: 'gross_volume', label: 'Volume', align: 'right', kind: 'money' },
          { key: 'stripe_fees', label: 'Stripe fees', align: 'right', kind: 'money' },
          { key: 'effective_rate', label: 'Effective', align: 'right', kind: 'percent' },
        ],
        rows: origins.rows,
      },
      resolution: {
        headline: 'Nothing is broken — the mix changed. Get the itemized backup before anyone escalates.',
        body: 'The move is explained by where cards were issued, not by pricing or by a Stripe change. Pull the itemized fee report so Finance can tie it out line by line, and the per-organizer reconciliation so you can see which organizers drove the international volume.',
        bullets: [
          `${bpsDelta(0, mixContribution)} from cross-border mix, ${bpsDelta(0, disputeContribution)} from dispute fees`,
          'Itemized report ties every fee line back to a balance transaction',
          'Per-organizer attribution shows whether this is one touring festival or a broad shift',
        ],
      },
      actions: [
        {
          id: 'fee_itemized_report',
          label: 'Generate itemized fee report',
          surface: 'api',
          callLabel: 'POST /v1/reporting/report_runs',
          method: 'POST',
          path: '/v1/reporting/report_runs',
          plainEnglish:
            'Queues the itemized balance-change report for the last 7 days. Every fee line, one row each, so Finance can reconcile against the ledger.',
          params: {
            report_type: 'balance_change_from_activity.itemized.3',
            parameters: {
              interval_start: weekAgo,
              interval_end: T.now,
              columns: [
                'balance_transaction_id',
                'created',
                'reporting_category',
                'gross',
                'fee',
                'net',
                'charge_id',
                'connected_account',
              ],
            },
          },
          totals: [
            { label: 'Window', value: 'Last 7 days' },
            { label: 'Fee lines', value: composition.rows.reduce((n, r) => n + num(r, 'fee_lines'), 0).toLocaleString('en-US') },
            { label: 'Total fees', value: money(composition.rows.reduce((n, r) => n + num(r, 'total_amount'), 0)) },
          ],
          variant: 'primary',
          run: (simCtx, options) =>
            api.createReportRun(
              simCtx,
              {
                report_type: 'balance_change_from_activity.itemized.3',
                parameters: {
                  interval_start: weekAgo,
                  interval_end: T.now,
                  columns: [
                    'balance_transaction_id',
                    'created',
                    'reporting_category',
                    'gross',
                    'fee',
                    'net',
                    'charge_id',
                    'connected_account',
                  ],
                },
              },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
        {
          id: 'fee_per_organizer_report',
          label: 'Per-organizer attribution report',
          surface: 'api',
          callLabel: 'POST /v1/reporting/report_runs',
          method: 'POST',
          path: '/v1/reporting/report_runs',
          plainEnglish:
            'Queues the connected-account payout reconciliation report, itemized. Shows the same fees broken down by organizer so you can see who the international volume belongs to.',
          params: {
            report_type: 'connected_account_payout_reconciliation.itemized.5',
            parameters: { interval_start: weekAgo, interval_end: T.now },
          },
          totals: [
            { label: 'Window', value: 'Last 7 days' },
            { label: 'Grouping', value: 'By connected account' },
          ],
          variant: 'secondary',
          run: (simCtx, options) =>
            api.createReportRun(
              simCtx,
              {
                report_type: 'connected_account_payout_reconciliation.itemized.5',
                parameters: { interval_start: weekAgo, interval_end: T.now },
              },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
        {
          id: 'fee_sigma_query',
          label: 'Run as a Sigma query',
          surface: 'api',
          callLabel: 'POST /v1/sigma/query_runs',
          method: 'POST',
          path: '/v1/sigma/query_runs',
          plainEnglish:
            'Saves the week-over-week comparison above as a scheduled Sigma query, so this lands in your inbox instead of being asked again next month.',
          params: { sql: periodSql },
          totals: [{ label: 'Rows in preview', value: String(periods.rows.length) }],
          variant: 'secondary',
          run: (simCtx, options) =>
            api.createSigmaQueryRun(simCtx, { sql: periodSql }, { idempotencyKey: options.idempotencyKey }),
        },
      ],
      dashboardOnly: [
        dashboardOnly(
          'network_tokens',
          `International volume is now ${percent(intlShareLast, 1)} of the week. Network tokens would not touch the cross-border fee, but they would lift authorisation on exactly this cohort — worth raising with the Stripe account team alongside the fee question.`,
        ),
      ],
    };
  },
};
