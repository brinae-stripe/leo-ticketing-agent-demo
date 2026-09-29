import { mcp } from '../../stripe-sim';
import { longDate } from '../../sim/format';
import { batchCount, chunk, money, num, percent, plural, sql, str } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

const BATCH_SIZE = 200;

/**
 * "Riverlight Music Festival is cancelled — refund everyone."
 *
 * The interesting part is not the loop, it is what you check before running it.
 * There is no bulk refund endpoint, so this is create_refund a few thousand
 * times, and with reverse_transfer set it pulls each ticket's money back out of
 * the organizer's balance. If the organizer has already been paid out — and they have —
 * that drives them deeply negative, which is a conversation to have before the
 * first batch rather than after the last one.
 */
export const eventCancellation: Scenario = {
  id: 'event_cancellation',
  scope: 'internal',
  title: 'Cancel an event and refund every buyer',
  suggestedPrompt: 'Riverlight Music Festival is cancelled — refund everyone',
  blurb:
    'Scopes every refundable charge on a cancelled event, checks the organizer can absorb the reversal, and runs the refunds in batches.',
  triggers: [
    'riverlight music festival is cancelled — refund everyone',
    'riverlight music festival is cancelled',
    'riverlight is cancelled refund everyone',
    'cancel the event and refund everyone',
    'refund everyone',
    'event cancelled',
  ],
  keywords: ['cancel', 'cancelled', 'cancellation', 'riverlight', 'refund', 'everyone', 'festival'],

  async run(ctx): Promise<ScenarioResult> {
    // Riverlight has several dates on sale. The one being cancelled is the one
    // with money on it — picking by date would land on whichever show happens
    // to be soonest, which is not what "refund everyone" is about.
    const organizer = ctx.index.accountByName.get('Riverlight Music Festival');
    const event = ctx.data.events
      .filter((e) => e.account_id === organizer?.id && e.status === 'on_sale')
      .map((candidate) => ({
        candidate,
        refundable: (ctx.index.chargesByEvent.get(candidate.id) ?? []).filter(
          (charge) => charge.paid && !charge.refunded && !charge.disputed,
        ).length,
      }))
      .sort((a, b) => b.refundable - a.refundable)[0]?.candidate;

    if (!organizer || !event) {
      throw new Error('No on-sale Riverlight event found in the dataset');
    }

    const totalsSql = sql`
-- Everything still refundable on this event. Already-refunded and disputed
-- charges are excluded: refunding a disputed charge does not stop the dispute,
-- it just pays the buyer twice.
SELECT
  COUNT(*) AS refundable_charges,
  SUM(c.amount - c.amount_refunded) AS refundable_amount,
  SUM(c.metadata_quantity) AS tickets,
  COUNT(DISTINCT c.customer_id) AS distinct_buyers,
  SUM(CASE WHEN c.payment_method_details_type = 'card_present' THEN 1 ELSE 0 END) AS in_person_sales,
  SUM(CASE WHEN c.transfer_id IS NULL THEN 0 ELSE 1 END) AS charges_with_transfer,
  MIN(c.created) AS first_sale,
  MAX(c.created) AS last_sale
FROM charges c
WHERE c.metadata_event_id = '${event.id}'
  AND c.paid = true
  AND c.refunded = false
  AND c.disputed = false`;

    const excludedSql = sql`
-- What is deliberately left out of the run, and why.
SELECT 'already_refunded' AS bucket, COUNT(*) AS charges, SUM(amount_refunded) AS amount
FROM charges WHERE metadata_event_id = '${event.id}' AND refunded = true
UNION ALL
SELECT 'disputed' AS bucket, COUNT(*) AS charges, SUM(amount) AS amount
FROM charges WHERE metadata_event_id = '${event.id}' AND disputed = true
UNION ALL
SELECT 'never_succeeded' AS bucket, COUNT(*) AS charges, SUM(amount) AS amount
FROM charges WHERE metadata_event_id = '${event.id}' AND paid = false`;

    const balanceSql = sql`
-- Can the organizer absorb the reversal? Almost never, once they have been paid out.
SELECT
  b.account_id,
  a.business_profile_name AS organizer,
  a.payout_schedule_interval,
  b.available,
  b.pending,
  (SELECT available FROM platform_balances) AS platform_available
FROM account_balances b
JOIN accounts a ON a.id = b.account_id
WHERE b.account_id = '${organizer.id}'`;

    const payoutSql = sql`
-- How much has already left for the organizer's bank account. This is why the
-- balance cannot cover it.
SELECT
  COUNT(*) AS payouts,
  SUM(amount) AS paid_out,
  MAX(arrival_date) AS latest_arrival
FROM connected_account_payouts
WHERE account_id = '${organizer.id}'
  AND status IN ('paid', 'in_transit')`;

    const sampleSql = sql`
-- A sample of the charges the run will touch. Capped for the browser; the
-- action itself targets the full set.
SELECT
  c.id AS charge_id,
  c.created,
  c.amount,
  c.metadata_tier AS tier,
  c.metadata_quantity AS quantity,
  c.payment_method_details_type AS method,
  c.transfer_id
FROM charges c
WHERE c.metadata_event_id = '${event.id}'
  AND c.paid = true
  AND c.refunded = false
  AND c.disputed = false
ORDER BY c.amount DESC
LIMIT 100`;

    const [totals, excluded, balance, payouts, sample] = await Promise.all([
      ctx.sql(totalsSql),
      ctx.sql(excludedSql),
      ctx.sql(balanceSql),
      ctx.sql(payoutSql),
      ctx.sql(sampleSql),
    ]);

    const summary = totals.rows[0];
    const refundableCount = num(summary, 'refundable_charges');
    const refundableAmount = num(summary, 'refundable_amount');
    const tickets = num(summary, 'tickets');
    const buyers = num(summary, 'distinct_buyers');

    const balanceRow = balance.rows[0];
    const available = num(balanceRow, 'available');
    const pending = num(balanceRow, 'pending');
    const platformAvailable = num(balanceRow, 'platform_available');
    const shortfall = refundableAmount - available - pending;
    const paidOut = num(payouts.rows[0], 'paid_out');

    const batches = batchCount(refundableCount, BATCH_SIZE);

    // The action works from the dataset, not the capped query result.
    const targetCharges = ctx.data.charges
      .filter(
        (c) =>
          c.metadata.event_id === event.id && c.paid && !c.refunded && !c.disputed,
      )
      .map((c) => c.id);

    const excludedTotal = excluded.rows.reduce((sum, row) => sum + num(row, 'charges'), 0);

    const answer = [
      `${event.name} at ${event.venue}, ${event.city} was due to open ${longDate(event.starts_at)}. There are ${plural(refundableCount, 'refundable charge')} on it — ${money(refundableAmount)} across ${tickets.toLocaleString('en-US')} tickets and ${buyers.toLocaleString('en-US')} distinct buyers.`,
      `${plural(excludedTotal, 'charge')} are excluded: ${excluded.rows.map((row) => `${num(row, 'charges')} ${str(row, 'bucket').replace(/_/g, ' ')}`).join(', ')}. Disputed charges in particular should not be refunded — the dispute is already running and refunding on top of it pays the buyer twice.`,
      `The balance will not cover it. ${str(balanceRow, 'organizer')} has ${money(available)} available and ${money(pending)} pending against ${money(refundableAmount)} of refunds, because ${money(paidOut)} has already gone out on their ${str(balanceRow, 'payout_schedule_interval')} payout schedule. With reverse_transfer set, this run leaves them roughly ${money(shortfall)} in the red.`,
      `That is recoverable — Stripe will settle the negative balance against future sales, and Riverlight has other dates on sale — but it is a conversation to have before the first batch, not after the last. Marquee's own balance is ${money(platformAvailable)}, so absorbing it centrally is not an option at this size.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Refundable scope', sql: totalsSql, result: totals },
        { label: 'What is excluded and why', sql: excludedSql, result: excluded },
        { label: 'Organizer balance versus exposure', sql: balanceSql, result: balance },
        { label: 'Already paid out to the organizer', sql: payoutSql, result: payouts },
        { label: 'Sample of charges in scope', note: 'Largest 100 of the full set.', sql: sampleSql, result: sample },
      ],
      resolution: {
        headline: `Refund ${refundableCount.toLocaleString('en-US')} charges in ${batches} batches of ${BATCH_SIZE}, with reverse_transfer on.`,
        body: `reverse_transfer is the right call even though it drives the organizer negative: these are Riverlight's ticket sales and Riverlight's cancellation, so the money should come back out of Riverlight's balance rather than Marquee's. Flag the ${money(shortfall)} shortfall to the account manager before running it, and let them tell the promoter. The event is also marked cancelled in Marquee's catalogue as part of the run so it stops selling.`,
        bullets: [
          `${money(refundableAmount)} across ${tickets.toLocaleString('en-US')} tickets and ${buyers.toLocaleString('en-US')} buyers`,
          `${batches} batches — there is no bulk refund endpoint, so this is create_refund ${refundableCount.toLocaleString('en-US')} times`,
          `Organizer lands at roughly ${money(available - refundableAmount)}; Stripe recovers it from future sales`,
          `${percent(num(summary, 'in_person_sales') / Math.max(1, refundableCount), 1)} of these were box-office sales and refund back to the original card`,
        ],
      },
      actions: [
        {
          id: 'cancellation_check_balance',
          label: 'Check organizer balance first',
          surface: 'mcp',
          callLabel: 'retrieve_balance',
          method: 'GET',
          path: '/v1/balance',
          stripeAccount: organizer.id,
          plainEnglish: `Reads ${organizer.business_profile_name}'s live balance before anything is refunded, so the shortfall number in the answer above can be confirmed against Stripe rather than the warehouse. Read-only.`,
          params: { stripe_account: organizer.id },
          totals: [
            { label: 'Warehouse says available', value: money(available) },
            { label: 'Refund exposure', value: money(refundableAmount), tone: 'danger' },
          ],
          variant: 'secondary',
          run: (simCtx, options) =>
            mcp.retrieve_balance(
              simCtx,
              { stripe_account: organizer.id },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
        {
          id: 'cancellation_refund_all',
          label: `Refund all ${refundableCount.toLocaleString('en-US')} buyers`,
          surface: 'mcp',
          callLabel: 'create_refund',
          method: 'POST',
          path: '/v1/refunds',
          plainEnglish: `Refunds every refundable charge on ${event.name} in full, with reverse_transfer set so the money comes back out of ${organizer.business_profile_name}'s balance. Runs in ${batches} batches of ${BATCH_SIZE}. Also marks the event cancelled in Marquee's own catalogue so it stops selling. This cannot be undone.`,
          params: {
            event: event.id,
            charges: `${refundableCount} charges`,
            reason: 'requested_by_customer',
            reverse_transfer: true,
            refund_application_fee: true,
            metadata: { cancellation: event.id },
          },
          totals: [
            { label: 'Charges', value: refundableCount.toLocaleString('en-US') },
            { label: 'Total refunded', value: money(refundableAmount), tone: 'danger' },
            { label: 'Buyers contacted by Stripe', value: buyers.toLocaleString('en-US') },
            {
              label: 'Organizer balance after',
              value: money(available - refundableAmount),
              tone: 'danger',
            },
            { label: 'Batches', value: `${batches} × ${BATCH_SIZE}` },
          ],
          requiresSecondAck: true,
          secondAckLabel: `I understand this refunds ${money(refundableAmount)} and leaves ${organizer.business_profile_name} approximately ${money(available - refundableAmount)} negative`,
          variant: 'danger',
          batch: { size: BATCH_SIZE, total: refundableCount, unitLabel: 'refund' },
          run: async (simCtx, options) => {
            const groups = chunk(targetCharges, BATCH_SIZE);
            let refunded = 0;
            let amount = 0;

            for (let i = 0; i < groups.length; i += 1) {
              const result = await mcp.create_refund_batch(
                simCtx,
                {
                  charges: groups[i],
                  reason: 'requested_by_customer',
                  reverse_transfer: true,
                  refund_application_fee: true,
                  metadata: { cancellation: event.id, event_name: event.name },
                  batch_index: i + 1,
                  batch_total: groups.length,
                },
                { idempotencyKey: `${options.idempotencyKey}-batch-${i + 1}` },
              );
              refunded += result.calls;
              amount += result.amount;
              options.onProgress?.({
                done: refunded,
                total: targetCharges.length,
                label: `Batch ${i + 1} of ${groups.length} — ${refunded.toLocaleString('en-US')} refunded`,
              });
            }

            // Stop the event selling. Platform-side state, not a Stripe object.
            simCtx.record({
              kind: 'patch',
              table: 'events',
              match: { id: event.id },
              patch: { status: 'cancelled' },
            });

            return { refunds: refunded, amount, batches: groups.length, event: event.id };
          },
        },
      ],
    };
  },
};
