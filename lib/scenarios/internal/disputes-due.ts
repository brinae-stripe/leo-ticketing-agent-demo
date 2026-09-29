import { api, mcp } from '../../stripe-sim';
import { dashboardOnly } from '../../stripe-sim/dashboard-only';
import { dateTime, longDate } from '../../sim/format';
import { T, money, num, plural, sql, str, within } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

/**
 * "What disputes are due in the next 72 hours?"
 *
 * The useful part is not the list — it is the gate scan. A dispute on a ticket
 * that was scanned at the door has real evidence behind it; one on a ticket that
 * was never scanned usually does not, and fighting it burns time you could spend
 * on the winnable ones. The agent sorts them on that basis.
 */
export const disputesDue: Scenario = {
  id: 'disputes_due',
  scope: 'internal',
  title: 'Disputes due inside 72 hours',
  suggestedPrompt: 'What disputes are due in the next 72 hours?',
  blurb:
    'Lists disputes with an evidence deadline inside three days, and pairs each one with its gate scan so you know which are worth fighting.',
  triggers: [
    'what disputes are due in the next 72 hours',
    'disputes due',
    'disputes due soon',
    'what disputes need a response',
    'chargebacks due',
  ],
  keywords: ['dispute', 'disputes', 'chargeback', 'chargebacks', 'evidence', 'deadline', '72'],

  async run(ctx): Promise<ScenarioResult> {
    const deadline = T.hoursAhead(72);

    const dueSql = sql`
-- Disputes still needing a response, deadline inside 72 hours.
-- The LEFT JOIN onto admissions is the whole point: a gate scan is the
-- strongest evidence a ticketing platform has that the buyer showed up.
SELECT
  d.id AS dispute_id,
  d.amount,
  d.reason,
  d.evidence_due_by,
  d.is_charge_refundable,
  c.id AS charge_id,
  c.created AS charge_created,
  c.customer_id,
  c.card_brand,
  c.card_country,
  a.id AS account_id,
  a.business_profile_name AS organizer,
  e.name AS event_name,
  e.venue,
  e.starts_at AS event_starts_at,
  ad.scanned_at,
  ad.gate
FROM disputes d
JOIN charges c ON c.id = d.charge_id
JOIN accounts a ON a.id = c.account_id
JOIN events e ON e.id = c.metadata_event_id
LEFT JOIN admissions ad ON ad.charge_id = c.id
WHERE d.status = 'needs_response'
  AND d.evidence_due_by > ${T.now}
  AND d.evidence_due_by <= ${deadline}
ORDER BY d.evidence_due_by ASC`;

    const reasonSql = sql`
-- Win rate by reason code across everything already resolved, so the
-- recommendation below is grounded in our own history rather than a hunch.
SELECT
  reason,
  COUNT(*) AS resolved,
  SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
  SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost
FROM disputes
WHERE status IN ('won', 'lost')
GROUP BY reason
ORDER BY resolved DESC`;

    const [due, reasons] = await Promise.all([ctx.sql(dueSql), ctx.sql(reasonSql)]);

    const rows = due.rows;
    const total = rows.reduce((sum, row) => sum + num(row, 'amount'), 0);
    const withScan = rows.filter((row) => num(row, 'scanned_at') > 0);
    const withoutScan = rows.filter((row) => num(row, 'scanned_at') === 0);
    const soonest = rows[0];

    const items: ScenarioItem[] = rows.map((row) => {
      const disputeId = str(row, 'dispute_id');
      const chargeId = str(row, 'charge_id');
      const accountId = str(row, 'account_id');
      const amount = num(row, 'amount');
      const scannedAt = num(row, 'scanned_at');
      const hasScan = scannedAt > 0;
      const dueBy = num(row, 'evidence_due_by');
      const eventStarts = num(row, 'event_starts_at');

      const evidence = {
        uncategorized_text: hasScan
          ? `Ticket was scanned at ${str(row, 'gate')} on ${dateTime(scannedAt)} for ${str(row, 'event_name')} at ${str(row, 'venue')} (event start ${dateTime(eventStarts)}). Purchase completed ${longDate(num(row, 'charge_created'))} on a ${str(row, 'card_brand')} card issued in ${str(row, 'card_country')}. Admission was used, so the goods were delivered as described.`
          : `Order placed ${longDate(num(row, 'charge_created'))} for ${str(row, 'event_name')} at ${str(row, 'venue')}. No gate scan is recorded against this order.`,
        receipt: `https://dashboard.stripe.com/receipts/sim_${chargeId.slice(3, 17)}`,
        service_date: new Date(eventStarts * 1000).toISOString().slice(0, 10),
        access_activity_log: hasScan
          ? `${str(row, 'gate')} — scanned ${dateTime(scannedAt)}`
          : 'No scan recorded',
        customer_email_address: `${str(row, 'customer_id')}@buyers.marquee.example`,
      };

      const actions: ScenarioItem['actions'] = hasScan
        ? [
            {
              id: `submit_${disputeId}`,
              label: 'Submit evidence',
              surface: 'mcp',
              callLabel: 'update_dispute',
              method: 'POST',
              path: `/v1/disputes/${disputeId}`,
              plainEnglish: `Submits the gate scan, receipt and service date as evidence on this ${money(amount)} dispute, and files it with the card network. Evidence can only be submitted once — after this the dispute moves to under review and cannot be edited.`,
              params: { dispute: disputeId, evidence, submit: true },
              totals: [
                { label: 'Disputed amount', value: money(amount) },
                { label: 'Deadline', value: `${dateTime(dueBy)} (${within(dueBy)})` },
                { label: 'Gate scan', value: `${str(row, 'gate')}, ${dateTime(scannedAt)}` },
              ],
              variant: 'primary',
              run: (simCtx, options) =>
                mcp.update_dispute(
                  simCtx,
                  { dispute: disputeId, evidence, submit: true },
                  { idempotencyKey: options.idempotencyKey },
                ),
            },
          ]
        : [
            {
              id: `accept_${disputeId}`,
              label: 'Accept dispute',
              surface: 'api',
              callLabel: 'POST /v1/disputes/:id/close',
              method: 'POST',
              path: `/v1/disputes/${disputeId}/close`,
              plainEnglish: `Concedes this ${money(amount)} dispute. Stripe records it as lost, the funds stay with the buyer, and the $15 dispute fee is not refunded. This cannot be undone.`,
              params: {},
              totals: [
                { label: 'Amount conceded', value: money(amount), tone: 'danger' },
                { label: 'Dispute fee', value: money(1_500), tone: 'warn' },
                { label: 'Evidence on file', value: 'None — no gate scan' },
              ],
              requiresSecondAck: amount > 10_000_00,
              secondAckLabel: 'I understand this concedes more than $10,000 and cannot be reversed',
              variant: 'danger',
              run: (simCtx, options) =>
                api.closeDispute(simCtx, disputeId, { idempotencyKey: options.idempotencyKey }),
            },
            {
              id: `submit_anyway_${disputeId}`,
              label: 'Submit anyway',
              surface: 'mcp',
              callLabel: 'update_dispute',
              method: 'POST',
              path: `/v1/disputes/${disputeId}`,
              plainEnglish:
                'Submits what evidence exists — order record and receipt, but no gate scan. Worth doing if you have something the warehouse does not know about, such as an email thread with the buyer.',
              params: { dispute: disputeId, evidence, submit: true },
              totals: [
                { label: 'Disputed amount', value: money(amount) },
                { label: 'Gate scan', value: 'None', tone: 'warn' },
              ],
              variant: 'secondary',
              run: (simCtx, options) =>
                mcp.update_dispute(
                  simCtx,
                  { dispute: disputeId, evidence, submit: true },
                  { idempotencyKey: options.idempotencyKey },
                ),
            },
          ];

      return {
        id: disputeId,
        title: `${money(amount)} · ${str(row, 'reason').replace(/_/g, ' ')}`,
        subtitle: `${str(row, 'organizer')} — ${str(row, 'event_name')}`,
        href: `/organizers/${accountId}`,
        facts: [
          {
            label: 'Evidence due',
            value: `${dateTime(dueBy)} · ${within(dueBy)}`,
            tone: dueBy - T.now < 24 * 3600 ? 'danger' : 'warn',
          },
          {
            label: 'Gate scan',
            value: hasScan ? `${str(row, 'gate')} · ${dateTime(scannedAt)}` : 'None on file',
            tone: hasScan ? 'good' : 'warn',
          },
          { label: 'Card', value: `${str(row, 'card_brand')} · ${str(row, 'card_country')}` },
          { label: 'Charge', value: chargeId },
        ],
        recommendation: hasScan
          ? 'Submit evidence. The ticket was scanned at the gate, which is direct proof the buyer attended.'
          : 'Accept. Nothing was scanned against this order, so there is no delivery evidence to submit and contesting it will almost certainly lose while still costing the fee.',
        actions,
      };
    });

    const answer = [
      `${plural(rows.length, 'dispute')} need a response inside 72 hours, worth ${money(total)} in total. The earliest deadline is ${dateTime(num(soonest, 'evidence_due_by'))} — ${within(num(soonest, 'evidence_due_by'))} — on a ${money(num(soonest, 'amount'))} ${str(soonest, 'reason').replace(/_/g, ' ')} dispute against ${str(soonest, 'organizer')}.`,
      `${withScan.length} of them have a gate scan on file, which is the evidence that actually wins ticketing disputes: it shows the buyer turned up and used the admission. The remaining ${withoutScan.length} have no scan at all.`,
      withoutScan.length > 0
        ? `For those ${withoutScan.length}, worth ${money(withoutScan.reduce((s, r) => s + num(r, 'amount'), 0))}, there is nothing to submit. Our own history backs that up — see the win rate by reason code below.`
        : 'Every dispute in the window has a scan, so all of them are worth contesting.',
    ];

    return {
      answer,
      queries: [
        { label: 'Disputes due inside 72h', note: 'Joined to the gate scan for each order.', sql: dueSql, result: due },
        { label: 'Historical win rate by reason', note: 'Grounds the submit-or-accept call.', sql: reasonSql, result: reasons },
      ],
      items,
      resolution: {
        headline: `Submit evidence on ${withScan.length}, accept ${withoutScan.length}.`,
        body: `Splitting on the gate scan gives a clean rule: contest where we can prove admission, concede where we cannot. That puts ${money(withScan.reduce((s, r) => s + num(r, 'amount'), 0))} into disputes we have a real case on and stops spending analyst time on ${money(withoutScan.reduce((s, r) => s + num(r, 'amount'), 0))} we would lose anyway.`,
        bullets: [
          'Evidence is prefilled from the admissions table — scan time, gate, service date and receipt',
          'Evidence can only be submitted once per dispute, so review the text before approving',
          'Accepting still costs the $15 dispute fee; it saves the analyst time, not the fee',
        ],
      },
      actions: [
        {
          id: 'disputes_recheck',
          label: 'Re-check open disputes',
          surface: 'mcp',
          callLabel: 'list_disputes',
          method: 'GET',
          path: '/v1/disputes',
          plainEnglish:
            'Reads the current list of disputes needing a response straight from Stripe, in case something was filed or withdrawn since the warehouse last synced.',
          params: { status: 'needs_response', limit: 25 },
          totals: [{ label: 'Warehouse count', value: String(rows.length) }],
          variant: 'secondary',
          run: (simCtx, options) =>
            mcp.list_disputes(
              simCtx,
              { status: 'needs_response', limit: 25 },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
      ],
      dashboardOnly: [
        dashboardOnly(
          'smart_disputes',
          `${withScan.length} of ${rows.length} disputes this week had evidence sitting in the admissions table waiting to be assembled by hand. Smart Disputes builds that packet automatically — turning it on would remove most of this queue rather than speeding it up.`,
        ),
      ],
    };
  },
};
