import { mcp } from '../../stripe-sim';
import { SPONSOR_NAMES } from '../../sim/catalog';
import { longDate } from '../../sim/format';
import { money, num, plural, sql, str, T } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

/**
 * "Invoice my sponsor."
 *
 * The one scenario here that creates money rather than moving it. Sponsorship is
 * invoiced, not ticketed, so it never appears in the charge data — which is
 * exactly why organizers end up chasing it in a spreadsheet. Three MCP calls
 * turn it into a hosted invoice with a payment link on it.
 */
export const invoiceSponsor: Scenario = {
  id: 'organizer_invoice_sponsor',
  scope: 'organizer',
  title: 'Invoice a sponsor',
  suggestedPrompt: 'Invoice my sponsor',
  blurb:
    'Builds a sponsorship invoice from the event’s actual attendance and finalises it into a hosted, payable invoice.',
  triggers: [
    'invoice my sponsor',
    'invoice a sponsor',
    'bill my sponsor',
    'create a sponsor invoice',
    'sponsorship invoice',
  ],
  keywords: ['invoice', 'sponsor', 'sponsorship', 'bill', 'billing'],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const organizer = ctx.index.accountById.get(accountId)!;

    const reachSql = sql`
-- Sponsorship is priced on reach, and reach is something the ticketing data can
-- actually evidence: tickets sold, distinct buyers, gates scanned.
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.venue,
  e.city,
  e.starts_at,
  e.status,
  COUNT(*) AS paid_orders,
  SUM(c.metadata_quantity) AS tickets_sold,
  COUNT(DISTINCT c.card_fingerprint) AS distinct_buyers,
  SUM(c.amount) AS gross_volume
FROM charges c
JOIN events e ON e.id = c.metadata_event_id
WHERE c.account_id = '${accountId}'
  AND c.paid = true
  AND e.starts_at <= ${T.now}
GROUP BY e.id, e.name, e.venue, e.city, e.starts_at, e.status
ORDER BY e.starts_at DESC
LIMIT 5`;

    const admissionSql = sql`
-- Scanned admissions are the number a sponsor will actually accept as proof of
-- footfall, as opposed to tickets sold.
SELECT
  COUNT(*) AS admissions_scanned,
  COUNT(DISTINCT ad.gate) AS gates_used
FROM admissions ad
JOIN charges c ON c.id = ad.charge_id
WHERE c.account_id = '${accountId}'`;

    const existingSql = sql`
-- Invoices already raised on this account, so we do not bill twice.
SELECT id AS invoice_id, customer_name, status, amount_due, created, hosted_invoice_url
FROM invoices
WHERE account_id = '${accountId}'
ORDER BY created DESC`;

    const [reach, admissions, existing] = await Promise.all([
      ctx.sql(reachSql),
      ctx.sql(admissionSql),
      ctx.sql(existingSql),
    ]);

    const event = reach.rows[0];
    if (!event) {
      return {
        answer: [
          `${organizer.business_profile_name} has no completed events in the data window, so there is no attendance to price a sponsorship against yet. Once a show has run, this will build the invoice from tickets sold, distinct buyers and scanned admissions.`,
        ],
        queries: [
          { label: 'Recent events and reach', sql: reachSql, result: reach },
          { label: 'Scanned admissions', sql: admissionSql, result: admissions },
        ],
        resolution: {
          headline: 'Nothing to invoice yet.',
          body: 'Sponsorship invoices are priced on attendance, and no event has completed in the window we hold.',
        },
        actions: [],
      };
    }

    const tickets = num(event, 'tickets_sold');
    const buyers = num(event, 'distinct_buyers');
    const gross = num(event, 'gross_volume');
    const scanned = num(admissions.rows[0], 'admissions_scanned');

    // Sponsor selection is stable per organizer so the demo reads the same each run.
    const sponsorIndex =
      Array.from(organizer.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      SPONSOR_NAMES.length;
    const sponsor = SPONSOR_NAMES[sponsorIndex];
    const sponsorCustomerId = `cus_sponsor_${organizer.id.slice(5, 15)}`;

    // Rate card: priced off reach, rounded to something a human would write down.
    const round = (cents: number) => Math.max(25_000, Math.round(cents / 25_000) * 25_000);
    const lines = [
      {
        description: `Main stage banner placement — ${str(event, 'event_name')}`,
        amount: round(tickets * 180),
        quantity: 1,
      },
      {
        description: `Programme and app placement — ${tickets.toLocaleString('en-US')} tickets scanned`,
        amount: round(tickets * 95),
        quantity: 1,
      },
      {
        description: 'Hospitality passes',
        amount: 45_000,
        quantity: 6,
      },
    ];
    const total = lines.reduce((sum, line) => sum + line.amount * line.quantity, 0);

    const alreadyInvoiced = existing.rows.filter(
      (row) => str(row, 'customer_name') === sponsor,
    );

    const answer = [
      `Your most recent completed event is ${str(event, 'event_name')} at ${str(event, 'venue')}, ${str(event, 'city')} on ${longDate(num(event, 'starts_at'))}. It sold ${tickets.toLocaleString('en-US')} tickets across ${plural(num(event, 'paid_orders'), 'order')} to ${buyers.toLocaleString('en-US')} distinct buyers, for ${money(gross)} of ticket revenue.`,
      `${scanned.toLocaleString('en-US')} admissions were scanned at the gate across your events, which is the footfall figure a sponsor will accept — it is attendance rather than tickets sold, and the two are never the same number.`,
      `Priced off that reach, the sponsorship invoice for ${sponsor} comes to ${money(total)}: ${lines.map((line) => `${money(line.amount * line.quantity)} ${line.description.split('—')[0].trim().toLowerCase()}`).join(', ')}.`,
      alreadyInvoiced.length > 0
        ? `Note that ${sponsor} already has ${plural(alreadyInvoiced.length, 'invoice')} on this account — ${alreadyInvoiced.map((row) => `${str(row, 'invoice_id')} (${str(row, 'status')}, ${money(num(row, 'amount_due'))})`).join(', ')}. Check before sending another.`
        : `No invoices have been raised for ${sponsor} on this account yet, so there is no duplicate risk.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Recent events and reach', sql: reachSql, result: reach },
        { label: 'Scanned admissions', note: 'The footfall number sponsors accept.', sql: admissionSql, result: admissions },
        {
          label: 'Invoices already on this account',
          sql: existingSql,
          result: existing,
          // Asked to rule out a duplicate; nothing found is the good outcome,
          // and the answer states it.
          emptyIsExpected: true,
        },
      ],
      table: {
        caption: 'Proposed invoice lines',
        columns: [
          { key: 'description', label: 'Line item' },
          { key: 'quantity', label: 'Qty', align: 'right', kind: 'number' },
          { key: 'amount', label: 'Unit', align: 'right', kind: 'money' },
          { key: 'total', label: 'Total', align: 'right', kind: 'money' },
        ],
        rows: lines.map((line) => ({ ...line, total: line.amount * line.quantity })),
      },
      resolution: {
        headline: `Raise a ${money(total)} invoice to ${sponsor}, due in 30 days.`,
        body: `Three calls: create the draft, add the three line items, then finalise it. Finalising is what produces the hosted invoice page and emails the sponsor a payable link — until then it is a draft only you can see, so the line items are still editable.`,
        bullets: [
          `${money(total)} across ${plural(lines.length, 'line item')}`,
          `Priced on ${tickets.toLocaleString('en-US')} tickets and ${scanned.toLocaleString('en-US')} scanned admissions`,
          'Raised on your connected account, so the money lands in your balance',
          'Net 30 — the sponsor pays by card or bank transfer from the hosted page',
        ],
      },
      actions: [
        {
          id: 'organizer_invoice_sponsor',
          label: `Create & finalize ${money(total)} invoice`,
          surface: 'mcp',
          callLabel: 'create_invoice → create_invoice_item ×3 → finalize_invoice',
          method: 'POST',
          path: '/v1/invoices',
          stripeAccount: accountId,
          plainEnglish: `Creates a draft invoice for ${sponsor} on ${organizer.business_profile_name}, adds the ${lines.length} line items, and finalises it. Once finalised, Stripe organizers a payable invoice page and the sponsor can pay by card or bank transfer. Net 30.`,
          params: {
            invoice: {
              customer: sponsorCustomerId,
              collection_method: 'send_invoice',
              days_until_due: 30,
              description: `Sponsorship — ${str(event, 'event_name')}`,
            },
            items: lines,
            finalize: { auto_advance: true },
          },
          totals: [
            { label: 'Sponsor', value: sponsor },
            { label: 'Total due', value: money(total) },
            { label: 'Line items', value: String(lines.length) },
            { label: 'Terms', value: 'Net 30' },
          ],
          variant: 'primary',
          batch: { size: 1, total: lines.length + 2, unitLabel: 'call' },
          run: async (simCtx, options) => {
            const invoice = await mcp.create_invoice(
              simCtx,
              {
                customer: sponsorCustomerId,
                customer_name: sponsor,
                stripe_account: accountId,
                collection_method: 'send_invoice',
                days_until_due: 30,
                description: `Sponsorship — ${str(event, 'event_name')}`,
              },
              { idempotencyKey: `${options.idempotencyKey}-invoice` },
            );
            options.onProgress?.({
              done: 1,
              total: lines.length + 2,
              label: 'Draft invoice created',
            });

            for (let i = 0; i < lines.length; i += 1) {
              await mcp.create_invoice_item(
                simCtx,
                {
                  customer: sponsorCustomerId,
                  invoice: invoice.id,
                  amount: lines[i].amount,
                  currency: 'usd',
                  description: lines[i].description,
                  quantity: lines[i].quantity,
                  stripe_account: accountId,
                },
                { idempotencyKey: `${options.idempotencyKey}-item-${i + 1}` },
              );
              options.onProgress?.({
                done: i + 2,
                total: lines.length + 2,
                label: `Added line ${i + 1} of ${lines.length}`,
              });
            }

            const finalized = await mcp.finalize_invoice(
              simCtx,
              { invoice: invoice.id, auto_advance: true, stripe_account: accountId },
              { idempotencyKey: `${options.idempotencyKey}-finalize` },
            );
            options.onProgress?.({
              done: lines.length + 2,
              total: lines.length + 2,
              label: 'Invoice finalised and sent',
            });
            return finalized;
          },
        },
      ],
    };
  },
};
