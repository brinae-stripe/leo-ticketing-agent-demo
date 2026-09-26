import { api } from '../../stripe-sim';
import { FIXTURES } from '../../sim/constants';
import { dateTime, longDate } from '../../sim/format';
import { money, num, percent, plural, sql, str, T } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

/**
 * "Are all readers at Cascade Aquarium online for tomorrow?"
 *
 * Deliberately ends in something the API cannot fix. A reader that has dropped
 * off the network needs a person to go and power-cycle it — there is no endpoint
 * for that, and an agent that pretends otherwise is worse than useless the
 * morning a gate stops taking payments. What the API *can* do is tell you
 * precisely which units, when they were last seen, and how much in-person
 * volume is riding on them.
 */
export const terminalReadiness: Scenario = {
  id: 'terminal_readiness',
  scope: 'internal',
  title: 'Card reader readiness',
  suggestedPrompt: 'Are all readers at Cascade Aquarium online for tomorrow?',
  blurb:
    'Checks reader status for a venue against its next event, and sizes the in-person volume at risk.',
  triggers: [
    'are all readers at cascade aquarium online for tomorrow',
    'are all readers online',
    'reader status',
    'terminal readers',
    'are the readers online',
    'card readers',
  ],
  keywords: ['reader', 'readers', 'terminal', 'offline', 'online', 'gate', 'box', 'office', 'aquarium'],

  async run(ctx): Promise<ScenarioResult> {
    // If the question names a host we know, use it; otherwise the venue the
    // suggested prompt refers to.
    const lowerQuery = ctx.query.toLowerCase();
    const named = ctx.data.accounts.find(
      (account) =>
        ctx.index.readersByAccount.has(account.id) &&
        lowerQuery.includes(account.business_profile_name.toLowerCase()),
    );
    const host =
      named ??
      ctx.index.accountByName.get(FIXTURES.offlineReaderVenue) ??
      ctx.data.accounts.find((a) => ctx.index.readersByAccount.has(a.id));

    if (!host) throw new Error('No host with card readers found in the dataset');

    const readersSql = sql`
-- Reader inventory for this host. last_seen_at is the number that matters: a
-- reader Stripe has not heard from in hours is not going to wake up on its own.
SELECT
  r.id AS reader_id,
  r.label,
  r.device_type,
  r.status,
  r.last_seen_at,
  r.location_id
FROM terminal_readers r
WHERE r.account_id = '${host.id}'
ORDER BY r.status ASC, r.label ASC`;

    const upcomingSql = sql`
-- What is actually coming up, so "tomorrow" is grounded in the calendar.
SELECT
  id AS event_id,
  name AS event_name,
  venue,
  city,
  starts_at,
  status
FROM events
WHERE account_id = '${host.id}'
  AND starts_at > ${T.now}
ORDER BY starts_at ASC
LIMIT 3`;

    const volumeSql = sql`
-- In-person volume over the last 30 days: what one gate going dark costs per day.
SELECT
  COUNT(*) AS in_person_charges,
  SUM(c.amount) AS in_person_volume,
  ROUND(AVG(c.amount), 0) AS avg_order_value,
  COUNT(DISTINCT c.metadata_event_id) AS events_covered
FROM charges c
WHERE c.account_id = '${host.id}'
  AND c.payment_method_details_type = 'card_present'
  AND c.paid = true
  AND c.created >= ${T.daysAgo(30)}`;

    const refundableSql = sql`
-- A recent in-person sale, in case the gate needs to refund one at the door.
SELECT
  c.id AS charge_id,
  c.amount,
  c.created,
  c.metadata_tier AS tier,
  c.card_brand
FROM charges c
WHERE c.account_id = '${host.id}'
  AND c.payment_method_details_type = 'card_present'
  AND c.paid = true
  AND c.refunded = false
ORDER BY c.created DESC
LIMIT 5`;

    const [readers, upcoming, volume, refundable] = await Promise.all([
      ctx.sql(readersSql),
      ctx.sql(upcomingSql),
      ctx.sql(volumeSql),
      ctx.sql(refundableSql),
    ]);

    const offline = readers.rows.filter((row) => str(row, 'status') === 'offline');
    const online = readers.rows.filter((row) => str(row, 'status') === 'online');
    const locations = new Set(readers.rows.map((row) => str(row, 'location_id')));
    const offlineLocations = new Set(offline.map((row) => str(row, 'location_id')));

    const nextEvent = upcoming.rows[0];
    const vol = volume.rows[0];
    const inPersonVolume = num(vol, 'in_person_volume');
    const inPersonCharges = num(vol, 'in_person_charges');
    const dailyVolume = Math.round(inPersonVolume / 30);
    const perReaderDaily = Math.round(dailyVolume / Math.max(1, readers.rows.length));

    const answer = [
      offline.length === 0
        ? `Yes. All ${readers.rows.length} readers at ${host.business_profile_name} are online, most recently seen within the last few minutes.`
        : `No — ${offline.length} of ${readers.rows.length} readers at ${host.business_profile_name} are offline. ${online.length} are online and healthy.`,
      offline.length > 0
        ? `The offline units are ${offline.map((row) => `${str(row, 'label')} (${str(row, 'device_type')}, last seen ${dateTime(num(row, 'last_seen_at'))})`).join('; ')}. They have been dark for between ${Math.round((T.now - Math.max(...offline.map((r) => num(r, 'last_seen_at')))) / 3600)} and ${Math.round((T.now - Math.min(...offline.map((r) => num(r, 'last_seen_at')))) / 3600)} hours, which rules out a momentary network blip.`
        : 'Nothing needs attention before the next event.',
      nextEvent
        ? `Next up is ${str(nextEvent, 'event_name')} at ${str(nextEvent, 'venue')}, ${longDate(num(nextEvent, 'starts_at'))}. Over the last 30 days this host took ${plural(inPersonCharges, 'in-person sale')} worth ${money(inPersonVolume)} — around ${money(dailyVolume)} a day across ${readers.rows.length} readers, so roughly ${money(perReaderDaily)} of throughput per reader per day.`
        : 'Nothing is currently on sale for this host.',
      offline.length > 0
        ? `All ${offlineLocations.size} of the affected units sit at ${offlineLocations.size === 1 ? 'a single location' : `${offlineLocations.size} of ${locations.size} locations`}, which points at the local network rather than the devices. Worth checking that before shipping replacements.`
        : '',
    ].filter(Boolean);

    const items: ScenarioItem[] = offline.map((row) => ({
      id: str(row, 'reader_id'),
      title: str(row, 'label'),
      subtitle: `${str(row, 'device_type')} · ${str(row, 'reader_id')}`,
      facts: [
        { label: 'Status', value: 'Offline', tone: 'danger' },
        {
          label: 'Last seen',
          value: `${dateTime(num(row, 'last_seen_at'))} (${Math.round((T.now - num(row, 'last_seen_at')) / 3600)}h ago)`,
          tone: 'danger',
        },
        { label: 'Location', value: str(row, 'location_id') },
        { label: 'Throughput at risk', value: `≈${money(perReaderDaily)} / day` },
      ],
      recommendation:
        'Someone has to physically power-cycle this reader and confirm it rejoins the network. There is no API call that brings a reader back online — Stripe can only tell you it is gone.',
      actions: [],
    }));

    const onlineReader = online[0];
    const chargeToRefund = refundable.rows[0];

    const actions: ScenarioResult['actions'] = [];

    if (onlineReader && chargeToRefund) {
      const readerId = str(onlineReader, 'reader_id');
      const chargeId = str(chargeToRefund, 'charge_id');
      const amount = num(chargeToRefund, 'amount');

      actions.push({
        id: 'terminal_refund_in_person',
        label: 'Refund an in-person sale',
        surface: 'api',
        callLabel: 'POST /v1/terminal/readers/:id/refund_payment',
        method: 'POST',
        path: `/v1/terminal/readers/${readerId}/refund_payment`,
        stripeAccount: host.id,
        plainEnglish: `Sends a ${money(amount)} refund to ${str(onlineReader, 'label')} for charge ${chargeId}. The buyer has to present the same card at the reader to complete it — this is the interac-style flow for in-person refunds, not a card-not-present refund.`,
        params: {
          charge: chargeId,
          amount,
          refund_application_fee: false,
          reverse_transfer: true,
        },
        totals: [
          { label: 'Reader', value: `${str(onlineReader, 'label')} (${readerId})` },
          { label: 'Charge', value: `${chargeId} · ${money(amount)}` },
          { label: 'Tier', value: str(chargeToRefund, 'tier') },
          { label: 'Buyer action needed', value: 'Present card at reader', tone: 'warn' },
        ],
        variant: 'secondary',
        run: (simCtx, options) =>
          api.refundTerminalPayment(
            simCtx,
            readerId,
            host.id,
            {
              charge: chargeId,
              amount,
              refund_application_fee: false,
              reverse_transfer: true,
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      });
    }

    return {
      answer,
      queries: [
        { label: 'Reader inventory', sql: readersSql, result: readers },
        { label: 'Upcoming events for this host', sql: upcomingSql, result: upcoming },
        { label: 'In-person volume, last 30 days', sql: volumeSql, result: volume },
        { label: 'Recent in-person sales', note: 'Candidates for a reader refund.', sql: refundableSql, result: refundable },
      ],
      table: {
        caption: `All readers at ${host.business_profile_name}`,
        columns: [
          { key: 'label', label: 'Reader' },
          { key: 'device_type', label: 'Device' },
          { key: 'status', label: 'Status' },
          { key: 'last_seen_at', label: 'Last seen', kind: 'date' },
          { key: 'location_id', label: 'Location' },
        ],
        rows: readers.rows,
      },
      items,
      resolution:
        offline.length > 0
          ? {
              headline: `${offline.length} readers need a person, not an API call.`,
              body: `Get someone at ${str(nextEvent, 'venue') || host.business_profile_name} to power-cycle ${offline.map((r) => str(r, 'label')).join(', ')} and confirm they come back before doors. The ${online.length} online readers can cover the gate in the meantime, but at ${percent(offline.length / Math.max(1, readers.rows.length), 0)} of capacity down you should expect queues. Nothing here is fixable from this screen — what the API gives you is the list and the last-seen times.`,
              bullets: [
                `${offline.length} offline, ${online.length} online, ${locations.size} location${locations.size === 1 ? '' : 's'}`,
                `≈${money(perReaderDaily)} of daily throughput per reader`,
                'Reader connectivity has no API remedy — this is an on-site task',
                'The one reader action that does exist is refunding an in-person sale',
              ],
            }
          : {
              headline: 'All readers online. Nothing to do.',
              body: `Every one of the ${readers.rows.length} readers has checked in recently. If you want a belt-and-braces check on the morning, re-run this — last_seen_at is the only reliable signal, and it moves.`,
              bullets: [`${readers.rows.length} readers across ${locations.size} location${locations.size === 1 ? '' : 's'}`],
            },
      actions,
    };
  },
};
