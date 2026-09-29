import { api } from '../../stripe-sim';
import { PLATFORM_ACCOUNT_ID } from '../../stripe-sim/core';
import { shortDate } from '../../sim/format';
import { money, num, percent, plural, sql, str, T } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

/**
 * "Which organizers owe service fees from last week's events?"
 *
 * Marquee bills roughly two-thirds of its organizers after the event rather than
 * taking application_fee_amount on the charge. That is a commercial choice, but
 * it means the platform has to go and collect, and collection is an account
 * debit — a transfer created in the organizer's context with the platform as the
 * destination. It is the single most dangerous call in this demo, which is why
 * it carries a second acknowledgement.
 */
export const settlement: Scenario = {
  id: 'settlement',
  scope: 'internal',
  title: 'Service fee settlement',
  suggestedPrompt: "Which organizers owe service fees from last week's events?",
  blurb:
    'Finds post-event organizers with unsettled service fees, checks each balance can cover the debit, and compares the whole thing to taking the fee on-charge.',
  triggers: [
    "which organizers owe service fees from last week's events",
    'which organizers owe service fees',
    'service fees owed',
    'settlement',
    'collect service fees',
    'who owes us money',
  ],
  keywords: ['settlement', 'settle', 'owe', 'owed', 'service', 'debit', 'invoice', 'collect'],

  async run(ctx): Promise<ScenarioResult> {
    const weekAgo = T.daysAgo(7);

    const owedSql = sql`
-- Unsettled service fees on events that finished in the last 7 days, with the
-- organizer's current balance alongside so we know the debit can actually clear.
SELECT
  l.account_id,
  a.business_profile_name AS organizer,
  a.metadata_settlement_mode AS settlement_mode,
  a.metadata_service_fee_percent AS fee_percent,
  a.metadata_service_fee_fixed AS fee_fixed,
  a.payout_schedule_interval,
  COUNT(*) AS events_settled,
  SUM(l.tickets_sold) AS tickets_sold,
  SUM(l.gross_volume) AS gross_volume,
  SUM(l.fee_owed) AS fee_owed,
  MAX(l.period_end) AS latest_event,
  b.available,
  b.pending
FROM service_fee_ledger l
JOIN accounts a ON a.id = l.account_id
LEFT JOIN account_balances b ON b.account_id = l.account_id
WHERE l.settled = false
  AND l.period_end >= ${weekAgo}
  AND l.period_end <= ${T.now}
GROUP BY
  l.account_id,
  a.business_profile_name,
  a.metadata_settlement_mode,
  a.metadata_service_fee_percent,
  a.metadata_service_fee_fixed,
  a.payout_schedule_interval,
  b.available,
  b.pending
ORDER BY fee_owed DESC`;

    const modeSql = sql`
-- The two billing models side by side. On-charge organizers have already paid via
-- application_fee_amount; post-event organizers have to be collected from.
SELECT
  metadata_settlement_mode AS settlement_mode,
  COUNT(*) AS organizers,
  ROUND(AVG(metadata_service_fee_percent), 4) AS avg_fee_percent,
  ROUND(AVG(metadata_service_fee_fixed), 0) AS avg_fee_fixed_cents
FROM accounts
GROUP BY metadata_settlement_mode`;

    const reversalSql = sql`
-- Refunded charges whose transfer was never reversed. Every one of these is
-- money sitting in an organizer balance that Marquee has already handed back to a
-- buyer out of its own pocket.
SELECT
  c.id AS charge_id,
  c.account_id,
  a.business_profile_name AS organizer,
  c.amount,
  c.amount_refunded,
  t.id AS transfer_id,
  t.amount AS transfer_amount,
  t.amount_reversed,
  c.created AS charge_created
FROM charges c
JOIN transfers t ON t.source_transaction_id = c.id
JOIN accounts a ON a.id = c.account_id
WHERE c.amount_refunded > 0
  AND t.amount_reversed = 0
ORDER BY c.amount_refunded DESC
LIMIT 50`;

    const [owed, modes, reversals] = await Promise.all([
      ctx.sql(owedSql),
      ctx.sql(modeSql),
      ctx.sql(reversalSql),
    ]);

    const rows = owed.rows;
    const totalOwed = rows.reduce((sum, row) => sum + num(row, 'fee_owed'), 0);
    const totalGross = rows.reduce((sum, row) => sum + num(row, 'gross_volume'), 0);
    const totalTickets = rows.reduce((sum, row) => sum + num(row, 'tickets_sold'), 0);

    const coverable = rows.filter((row) => num(row, 'available') >= num(row, 'fee_owed'));
    const short = rows.filter((row) => num(row, 'available') < num(row, 'fee_owed'));

    const onChargeMode = modes.rows.find((r) => str(r, 'settlement_mode') === 'on_charge');
    const postEventMode = modes.rows.find((r) => str(r, 'settlement_mode') === 'post_event');

    // Counterfactual: the same volume under the on-charge schedule.
    const onChargePercent = num(onChargeMode, 'avg_fee_percent');
    const onChargeFixed = num(onChargeMode, 'avg_fee_fixed_cents');
    const counterfactual = Math.round(totalGross * onChargePercent + totalTickets * onChargeFixed);

    const reversalTotal = reversals.rows.reduce((sum, row) => sum + num(row, 'amount_refunded'), 0);

    const items: ScenarioItem[] = rows.map((row) => {
      const accountId = str(row, 'account_id');
      const organizer = str(row, 'organizer');
      const feeOwed = num(row, 'fee_owed');
      const available = num(row, 'available');
      const covers = available >= feeOwed;

      return {
        id: accountId,
        title: `${organizer} — ${money(feeOwed)}`,
        subtitle: `${plural(num(row, 'events_settled'), 'event')}, ${num(row, 'tickets_sold').toLocaleString('en-US')} tickets, last ${shortDate(num(row, 'latest_event'))}`,
        href: `/organizers/${accountId}`,
        facts: [
          { label: 'Gross volume', value: money(num(row, 'gross_volume')) },
          {
            label: 'Fee schedule',
            value: `${percent(num(row, 'fee_percent'), 1)} + ${money(num(row, 'fee_fixed'))} per ticket`,
          },
          {
            label: 'Available balance',
            value: money(available),
            tone: covers ? 'good' : 'danger',
          },
          {
            label: 'After debit',
            value: money(available - feeOwed),
            tone: covers ? 'neutral' : 'danger',
          },
        ],
        recommendation: covers
          ? `Debit now. ${money(available)} available covers the ${money(feeOwed)} with ${money(available - feeOwed)} left over.`
          : `Do not debit yet. Only ${money(available)} is available against ${money(feeOwed)} owed — the debit would push them ${money(Math.abs(available - feeOwed))} negative. Invoice them instead, or wait for the next settlement cycle.`,
        actions: [
          {
            id: `debit_${accountId}`,
            label: covers ? 'Debit this organizer' : 'Debit anyway',
            surface: 'api',
            callLabel: 'POST /v1/transfers',
            method: 'POST',
            path: '/v1/transfers',
            stripeAccount: accountId,
            plainEnglish: `Moves ${money(feeOwed)} out of ${organizer}'s Stripe balance and into Marquee's platform account. This runs with Stripe-Account set to the organizer and destination set to the platform — the reverse direction of a normal payout, which is why the header matters.`,
            params: {
              amount: feeOwed,
              currency: 'usd',
              destination: PLATFORM_ACCOUNT_ID,
              description: `Marquee service fees, events through ${shortDate(num(row, 'latest_event'))}`,
              metadata: { settlement_period_end: String(num(row, 'latest_event')) },
            },
            totals: [
              { label: 'Debit amount', value: money(feeOwed), tone: 'danger' },
              { label: 'Organizer balance now', value: money(available) },
              {
                label: 'Balance after',
                value: money(available - feeOwed),
                tone: covers ? 'neutral' : 'danger',
              },
              { label: 'Direction', value: 'Organizer → Marquee' },
            ],
            requiresSecondAck: true,
            secondAckLabel: covers
              ? `I confirm debiting ${money(feeOwed)} from ${organizer}`
              : `I understand this will push ${organizer} to a negative balance of ${money(available - feeOwed)}`,
            variant: 'danger',
            run: (simCtx, options) =>
              api.createTransfer(
                simCtx,
                accountId,
                {
                  amount: feeOwed,
                  currency: 'usd',
                  destination: PLATFORM_ACCOUNT_ID,
                  description: `Marquee service fees, events through ${shortDate(num(row, 'latest_event'))}`,
                  metadata: { settlement_period_end: String(num(row, 'latest_event')) },
                },
                { idempotencyKey: options.idempotencyKey },
              ),
          },
        ],
      };
    });

    const answer = [
      `${plural(rows.length, 'organizer')} owe service fees on events that finished in the last 7 days — ${money(totalOwed)} in total, on ${money(totalGross)} of gross ticket volume across ${totalTickets.toLocaleString('en-US')} tickets.`,
      `All of them are on post-event billing, so nothing was taken at charge time. ${coverable.length} have enough in their balance to cover the debit today; ${short.length > 0 ? `${short.length} do not and would be pushed negative, so those need an invoice or another cycle instead` : 'every one of them clears'}.`,
      `Worth noting what this costs in effort: the same ${money(totalGross)} under on-charge billing would have collected roughly ${money(counterfactual)} automatically, at ${percent(onChargePercent, 1)} + ${money(onChargeFixed)} per ticket, with no collection step and no risk of an organizer spending the money first. The post-event schedule is ${percent(num(postEventMode, 'avg_fee_percent'), 1)} + ${money(num(postEventMode, 'avg_fee_fixed_cents'))} — about ${money(totalOwed - counterfactual)} more revenue on this volume, which is the premium for carrying the collection risk.`,
      reversals.rows.length > 0
        ? `Separately, ${plural(reversals.rows.length, 'refunded charge')} still have an un-reversed transfer, totalling ${money(reversalTotal)}. Marquee refunded those buyers out of its own balance while the organizer kept the money.`
        : 'Every refunded charge already has its transfer reversed, so there is nothing to claw back there.',
    ];

    const debitable = coverable;

    return {
      answer,
      queries: [
        { label: "Service fees owed on last week's events", sql: owedSql, result: owed },
        { label: 'Billing model comparison', note: 'On-charge versus post-event fee schedules.', sql: modeSql, result: modes },
        { label: 'Refunded charges with un-reversed transfers', sql: reversalSql, result: reversals },
      ],
      table: {
        caption: 'Settlement run',
        columns: [
          { key: 'organizer', label: 'Organizer' },
          { key: 'events_settled', label: 'Events', align: 'right', kind: 'number' },
          { key: 'tickets_sold', label: 'Tickets', align: 'right', kind: 'number' },
          { key: 'gross_volume', label: 'Gross', align: 'right', kind: 'money' },
          { key: 'fee_owed', label: 'Fee owed', align: 'right', kind: 'money' },
          { key: 'available', label: 'Balance', align: 'right', kind: 'money' },
        ],
        rows,
      },
      resolution: {
        headline: `Debit ${debitable.length} organizers for ${money(debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0))}, and reverse ${reversals.rows.length} stale transfers.`,
        body: `Debit only the organizers whose balance covers it — pushing an organizer negative to collect a fee turns a clean settlement into a support conversation and a payout failure. Reversing the transfers on refunded charges is separate but should go out in the same run: that money is already gone from Marquee's side.`,
        bullets: [
          `${money(totalOwed)} owed, ${money(debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0))} collectable today`,
          `Every debit runs with Stripe-Account: <organizer> and destination: ${PLATFORM_ACCOUNT_ID}`,
          `${money(reversalTotal)} of refunds to claw back from organizer balances`,
          'Account debits always require the second acknowledgement, regardless of size',
        ],
      },
      actions: [
        {
          id: 'settlement_debit_all',
          label: `Debit ${debitable.length} organizers`,
          surface: 'api',
          callLabel: 'POST /v1/transfers',
          method: 'POST',
          path: '/v1/transfers',
          plainEnglish: `Creates an account debit against each of the ${debitable.length} organizers whose balance covers what they owe, moving ${money(debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0))} into Marquee's platform account. Organizers who would be pushed negative are excluded. One transfer per organizer, each with Stripe-Account set to that organizer.`,
          params: {
            transfers: debitable.map((row) => ({
              stripe_account: str(row, 'account_id'),
              amount: num(row, 'fee_owed'),
              currency: 'usd',
              destination: PLATFORM_ACCOUNT_ID,
            })),
          },
          totals: [
            { label: 'Organizers debited', value: String(debitable.length) },
            {
              label: 'Total collected',
              value: money(debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0)),
              tone: 'danger',
            },
            { label: 'Organizers skipped', value: `${short.length} (insufficient balance)`, tone: 'warn' },
            { label: 'If billed on-charge instead', value: money(counterfactual) },
          ],
          requiresSecondAck: true,
          secondAckLabel: `I confirm debiting ${debitable.length} connected accounts for ${money(debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0))}`,
          variant: 'danger',
          batch: { size: 1, total: debitable.length, unitLabel: 'debit' },
          run: async (simCtx, options) => {
            const created: unknown[] = [];
            for (let i = 0; i < debitable.length; i += 1) {
              const row = debitable[i];
              created.push(
                await api.createTransfer(
                  simCtx,
                  str(row, 'account_id'),
                  {
                    amount: num(row, 'fee_owed'),
                    currency: 'usd',
                    destination: PLATFORM_ACCOUNT_ID,
                    description: `Marquee service fees, events through ${shortDate(num(row, 'latest_event'))}`,
                    metadata: { settlement_run: shortDate(T.now) },
                  },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: debitable.length,
                label: `Debited ${i + 1} of ${debitable.length}`,
              });
            }
            return {
              debits: created.length,
              collected: debitable.reduce((s, r) => s + num(r, 'fee_owed'), 0),
            };
          },
        },
        {
          id: 'settlement_reverse_transfers',
          label: `Reverse ${reversals.rows.length} transfers on refunded charges`,
          surface: 'api',
          callLabel: 'POST /v1/transfers/:id/reversals',
          method: 'POST',
          path: '/v1/transfers/:id/reversals',
          plainEnglish: `Reverses the transfer on each refunded charge that never had one, pulling ${money(reversalTotal)} back out of organizer balances. These refunds were already paid to buyers from Marquee's balance.`,
          params: {
            reversals: reversals.rows.slice(0, 50).map((row) => ({
              transfer: str(row, 'transfer_id'),
              amount: num(row, 'amount_refunded'),
            })),
          },
          totals: [
            { label: 'Transfers', value: String(reversals.rows.length) },
            { label: 'Total reversed', value: money(reversalTotal), tone: 'warn' },
            {
              label: 'Organizers affected',
              value: String(new Set(reversals.rows.map((r) => str(r, 'account_id'))).size),
            },
          ],
          requiresSecondAck: reversalTotal > 10_000_00,
          secondAckLabel: `I understand this reverses more than $10,000 (${money(reversalTotal)}) from organizer balances`,
          variant: 'secondary',
          batch: { size: 1, total: reversals.rows.length, unitLabel: 'reversal' },
          run: async (simCtx, options) => {
            const done: unknown[] = [];
            for (let i = 0; i < reversals.rows.length; i += 1) {
              const row = reversals.rows[i];
              done.push(
                await api.createTransferReversal(
                  simCtx,
                  str(row, 'transfer_id'),
                  {
                    amount: Math.min(num(row, 'amount_refunded'), num(row, 'transfer_amount')),
                    description: 'Refund issued without transfer reversal',
                  },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: reversals.rows.length,
                label: `Reversed ${i + 1} of ${reversals.rows.length}`,
              });
            }
            return { reversals: done.length, amount: reversalTotal };
          },
        },
      ],
    };
  },
};
