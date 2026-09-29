import { api, mcp } from '../../stripe-sim';
import { PRICING } from '../../sim/constants';
import { longDate } from '../../sim/format';
import { money, num, plural, sql, str, T } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

const DAY = 86_400;

/** Start of the Nth most recent Saturday that has fully passed. */
function saturdayBefore(now: number, weeksBack: number): number {
  const dow = new Date(now * 1000).getUTCDay(); // 0 Sun … 6 Sat
  const daysBack = dow === 6 ? 7 : (dow + 1) % 7 || 7;
  return Math.floor(now / DAY) * DAY - daysBack * DAY - weeksBack * 7 * DAY;
}

/**
 * "Where's my money from Saturday?"
 *
 * The honest answer is almost always "it is on its way, and here is the date",
 * but organizers ask because nobody has ever shown them the T+2 window. So show
 * it: what was taken, what Stripe held back in fees, when each tranche becomes
 * available, and which payout it is riding in.
 */
export const moneyFromSaturday: Scenario = {
  id: 'organizer_money_saturday',
  scope: 'organizer',
  title: "Where's my money from Saturday?",
  suggestedPrompt: "Where's my money from Saturday?",
  blurb: 'Traces a single day of ticket sales through fees, the settlement window and the payout it lands in.',
  triggers: [
    "where's my money from saturday",
    'where is my money from saturday',
    'where is my money',
    'when do i get paid',
    'when will i be paid',
    'my payout',
  ],
  keywords: ['money', 'payout', 'paid', 'saturday', 'settlement', 'when', 'deposit'],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const organizer = ctx.index.accountById.get(accountId)!;

    // "Saturday" means the organizer's most recent trading Saturday. Most organizers do
    // not sell every weekend — a ballet company plays Thursdays — so anchoring
    // on the calendar Saturday would answer a question nobody asked.
    const organizerCharges = ctx.index.paidChargesByAccount.get(accountId) ?? [];
    let start = saturdayBefore(T.now, 0);
    let weeksBack = 0;
    for (; weeksBack < 13; weeksBack += 1) {
      const candidate = saturdayBefore(T.now, weeksBack);
      const traded = organizerCharges.some(
        (charge) => charge.created >= candidate && charge.created < candidate + DAY,
      );
      if (traded) {
        start = candidate;
        break;
      }
    }
    const end = start + DAY;
    const isMostRecentSaturday = weeksBack === 0;

    const salesSql = sql`
-- Saturday's takings, grouped by the date each tranche becomes available.
-- available_on is the number organizers actually want: card money settles T+2,
-- and weekends push it to the following business day.
SELECT
  bt.available_on,
  COUNT(*) AS charges,
  SUM(bt.amount) AS gross,
  SUM(bt.fee) AS fees,
  SUM(bt.net) AS net
FROM balance_transactions bt
JOIN charges c ON c.id = bt.source_id
WHERE c.account_id = '${accountId}'
  AND bt.reporting_category = 'charge'
  AND bt.created >= ${start}
  AND bt.created < ${end}
GROUP BY bt.available_on
ORDER BY bt.available_on ASC`;

    const payoutSql = sql`
-- Payouts since Saturday, and where each one is.
SELECT
  id AS payout_id,
  amount,
  status,
  method,
  created,
  arrival_date,
  failure_code,
  failure_message
FROM connected_account_payouts
WHERE account_id = '${accountId}'
  AND created >= ${start}
ORDER BY created ASC`;

    const balanceSql = sql`
-- What is sitting in the Stripe balance right now.
SELECT available, pending, currency
FROM account_balances
WHERE account_id = '${accountId}'`;

    const refundSql = sql`
-- Refunds since Saturday come straight back off the balance, so they explain
-- gaps between "what I sold" and "what arrived".
SELECT
  COUNT(*) AS refunds,
  SUM(r.amount) AS refunded_amount
FROM refunds r
JOIN charges c ON c.id = r.charge_id
WHERE c.account_id = '${accountId}'
  AND r.created >= ${start}`;

    const [sales, payoutRows, balance, refunds] = await Promise.all([
      ctx.sql(salesSql),
      ctx.sql(payoutSql),
      ctx.sql(balanceSql),
      ctx.sql(refundSql),
    ]);

    const gross = sales.rows.reduce((s, r) => s + num(r, 'gross'), 0);
    const fees = sales.rows.reduce((s, r) => s + num(r, 'fees'), 0);
    const net = sales.rows.reduce((s, r) => s + num(r, 'net'), 0);
    const charges = sales.rows.reduce((s, r) => s + num(r, 'charges'), 0);

    const available = num(balance.rows[0], 'available');
    const pending = num(balance.rows[0], 'pending');
    const refundedAmount = num(refunds.rows[0], 'refunded_amount');

    const paid = payoutRows.rows.filter((r) => str(r, 'status') === 'paid');
    const inTransit = payoutRows.rows.filter((r) => str(r, 'status') === 'in_transit');
    const failed = payoutRows.rows.filter((r) => str(r, 'status') === 'failed');
    const firstTranche = sales.rows[0];

    const instantAmount = Math.max(0, Math.floor(available * 0.9));
    const instantFee = Math.round(instantAmount * PRICING.instantPayoutPercent);

    const answer =
      charges === 0
        ? [
            `Nothing was sold on Saturday ${longDate(start)} for ${organizer.business_profile_name}, so there is no money from that day to trace. Your balance today is ${money(available)} available and ${money(pending)} still settling.`,
          ]
        : [
            isMostRecentSaturday
              ? `Saturday ${longDate(start)} you took ${plural(charges, 'payment')} totalling ${money(gross)}. Stripe's fees on that were ${money(fees)}, so ${money(net)} is yours.`
              : `Your most recent trading Saturday was ${longDate(start)} — ${weeksBack === 1 ? 'a week' : `${weeksBack} weeks`} ago, since you had no sales on the Saturdays after it. That day you took ${plural(charges, 'payment')} totalling ${money(gross)}. Stripe's fees were ${money(fees)}, so ${money(net)} is yours.`,
            `That money settles on a two-business-day cycle. ${sales.rows.length === 1 ? `All of it became available ${longDate(num(firstTranche, 'available_on'))}.` : `It arrives in ${sales.rows.length} tranches: ${sales.rows.map((r) => `${money(num(r, 'net'))} on ${longDate(num(r, 'available_on'))}`).join(', ')}.`} Weekend sales get pushed to the following business day, which is why Saturday money does not show up Monday.`,
            payoutRows.rows.length > 0
              ? `Since Saturday there ${payoutRows.rows.length === 1 ? 'has been 1 payout' : `have been ${payoutRows.rows.length} payouts`} on your account: ${paid.length} already in your bank${inTransit.length > 0 ? `, ${inTransit.length} in transit arriving ${longDate(num(inTransit[0], 'arrival_date'))}` : ''}${failed.length > 0 ? `, and ${failed.length} failed — ${str(failed[0], 'failure_message')}` : ''}.`
              : 'No payouts have gone out since Saturday yet, which is expected if your schedule has not come round.',
            refundedAmount > 0
              ? `One thing to account for: ${money(refundedAmount)} of refunds came off the balance in the same period, so the figure that lands in your bank will be lower than the ${money(net)} you sold.`
              : `No refunds came off the balance in this period, so the full ${money(net)} flows through.`,
          ];

    const actions: ScenarioResult['actions'] = [
      {
        id: 'organizer_reconciliation_report',
        label: 'Download reconciliation report',
        surface: 'api',
        callLabel: 'POST /v1/reporting/report_runs',
        method: 'POST',
        path: '/v1/reporting/report_runs',
        plainEnglish: `Generates an itemized payout reconciliation report for ${organizer.business_profile_name} covering Saturday through today. One row per transaction, with the fee and the payout it settled into — the file your bookkeeper wants.`,
        params: {
          report_type: 'connected_account_payout_reconciliation.itemized.5',
          parameters: {
            interval_start: start,
            interval_end: T.now,
            connected_account: accountId,
          },
        },
        totals: [
          { label: 'Period', value: `${longDate(start)} – ${longDate(T.now)}` },
          { label: 'Transactions', value: charges.toLocaleString('en-US') },
          { label: 'Gross', value: money(gross) },
        ],
        variant: 'secondary',
        run: (simCtx, options) =>
          api.createReportRun(
            simCtx,
            {
              report_type: 'connected_account_payout_reconciliation.itemized.5',
              parameters: {
                interval_start: start,
                interval_end: T.now,
                connected_account: accountId,
              },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
      {
        id: 'organizer_check_balance',
        label: 'Re-check my balance',
        surface: 'mcp',
        callLabel: 'retrieve_balance',
        method: 'GET',
        path: '/v1/balance',
        stripeAccount: accountId,
        plainEnglish: 'Reads your live Stripe balance rather than the nightly warehouse copy. Read-only.',
        params: { stripe_account: accountId },
        totals: [
          { label: 'Warehouse available', value: money(available) },
          { label: 'Warehouse pending', value: money(pending) },
        ],
        variant: 'secondary',
        run: (simCtx, options) =>
          mcp.retrieve_balance(
            simCtx,
            { stripe_account: accountId },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
    ];

    if (instantAmount > 0) {
      actions.unshift({
        id: 'organizer_instant_payout',
        label: 'Request instant payout',
        surface: 'api',
        callLabel: 'POST /v1/payouts',
        method: 'POST',
        path: '/v1/payouts',
        stripeAccount: accountId,
        plainEnglish: `Pays out ${money(instantAmount)} to your bank within about 30 minutes instead of waiting for the standard schedule. Instant payouts cost 1.5% — ${money(instantFee)} on this amount — and that fee is not refundable.`,
        params: {
          amount: instantAmount,
          currency: 'usd',
          method: 'instant',
          statement_descriptor: 'MARQUEE PAYOUT',
        },
        totals: [
          { label: 'Payout amount', value: money(instantAmount) },
          { label: 'Instant fee (1.5%)', value: money(instantFee), tone: 'warn' },
          { label: 'You receive', value: money(instantAmount - instantFee) },
          { label: 'Arrives', value: 'Within ~30 minutes' },
        ],
        variant: 'primary',
        run: (simCtx, options) =>
          api.createPayout(
            simCtx,
            accountId,
            {
              amount: instantAmount,
              currency: 'usd',
              method: 'instant',
              statement_descriptor: 'MARQUEE PAYOUT',
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      });
    }

    return {
      answer,
      queries: [
        { label: "Saturday's sales by availability date", sql: salesSql, result: sales },
        { label: 'Payouts since Saturday', sql: payoutSql, result: payoutRows },
        { label: 'Balance right now', sql: balanceSql, result: balance },
        { label: 'Refunds in the same period', sql: refundSql, result: refunds },
      ],
      table: {
        caption: 'When Saturday money becomes available',
        columns: [
          { key: 'available_on', label: 'Available on', kind: 'date' },
          { key: 'charges', label: 'Payments', align: 'right', kind: 'number' },
          { key: 'gross', label: 'Gross', align: 'right', kind: 'money' },
          { key: 'fees', label: 'Fees', align: 'right', kind: 'money' },
          { key: 'net', label: 'Net to you', align: 'right', kind: 'money' },
        ],
        rows: sales.rows,
      },
      resolution: {
        headline:
          instantAmount > 0
            ? `${money(net)} from Saturday is settled or settling. ${money(instantAmount)} could be in your bank in half an hour.`
            : `${money(net)} from Saturday is settled or settling on the standard schedule.`,
        body:
          instantAmount > 0
            ? `Nothing is stuck. If you need it today, an instant payout moves ${money(instantAmount)} for a ${money(instantFee)} fee; if you can wait for the normal schedule it costs nothing. Either way, pull the reconciliation report so the numbers tie out against your own box-office totals.`
            : `Nothing is stuck. Pull the reconciliation report so the numbers tie out against your own box-office totals.`,
        bullets: [
          `${money(gross)} gross, ${money(fees)} fees, ${money(net)} net on ${plural(charges, 'payment')}`,
          `${money(available)} available now, ${money(pending)} still inside the settlement window`,
          ...(failed.length > 0
            ? [`${failed.length} payout failed — ${str(failed[0], 'failure_code')} — fix the bank details before the next cycle`]
            : []),
        ],
      },
      actions,
    };
  },
};
