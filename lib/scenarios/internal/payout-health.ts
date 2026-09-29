import { api } from '../../stripe-sim';
import { isoToShortDate, longDate } from '../../sim/format';
import { T, list, money, num, plural, sql, str, within } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

/**
 * "Which organizers with events in the next 14 days can't be paid out?"
 *
 * The expensive version of this problem is a organizer who sells out a show, plays
 * it, and then discovers they cannot be paid because a verification field was
 * never filled in. Catching it while the event is still two weeks out means an
 * onboarding link fixes it; catching it after the show means a support ticket
 * and an angry promoter.
 */
export const payoutHealth: Scenario = {
  id: 'payout_health',
  scope: 'internal',
  title: 'Payout readiness before the doors open',
  suggestedPrompt: "Which organizers with events in the next 14 days can't be paid out?",
  blurb:
    'Cross-references payout status against the event calendar, and sends the right onboarding link before money gets stuck.',
  triggers: [
    "which organizers with events in the next 14 days can't be paid out",
    'which organizers cannot be paid out',
    'payout health',
    'payouts blocked',
    'who can\'t get paid',
    'payouts disabled',
  ],
  keywords: ['payout', 'payouts', 'onboarding', 'requirements', 'verification', 'blocked', 'kyc'],

  async run(ctx): Promise<ScenarioResult> {
    const horizon = T.daysAhead(14);

    const blockedSql = sql`
-- Organizers with an event inside 14 days whose payouts are switched off.
-- The join to events is what makes this urgent rather than merely untidy.
SELECT
  a.id AS account_id,
  a.business_profile_name AS organizer,
  a.type AS account_type,
  a.charges_enabled,
  a.payouts_enabled,
  a.requirements_currently_due,
  a.requirements_currently_due_count,
  a.requirements_past_due,
  a.requirements_past_due_count,
  a.requirements_disabled_reason,
  a.requirements_current_deadline,
  a.payout_schedule_interval,
  a.metadata_organizer_category,
  e.id AS event_id,
  e.name AS event_name,
  e.venue,
  e.city,
  e.starts_at AS event_starts_at,
  b.available,
  b.pending
FROM accounts a
JOIN events e ON e.account_id = a.id
LEFT JOIN account_balances b ON b.account_id = a.id
WHERE a.payouts_enabled = false
  AND e.status = 'on_sale'
  AND e.starts_at > ${T.now}
  AND e.starts_at <= ${horizon}
ORDER BY e.starts_at ASC`;

    const negativeSql = sql`
-- Separate problem, same page: organizers already carrying a negative balance.
-- These need payouts held, not onboarding links.
SELECT
  b.account_id,
  a.business_profile_name AS organizer,
  a.payouts_enabled,
  a.payout_schedule_interval,
  a.metadata_next_event_date,
  b.available,
  b.pending
FROM account_balances b
JOIN accounts a ON a.id = b.account_id
WHERE b.available < 0
ORDER BY b.available ASC`;

    const exposureSql = sql`
-- How much has already been sold by organizers who cannot currently be paid.
SELECT
  c.account_id,
  a.business_profile_name AS organizer,
  COUNT(*) AS paid_charges,
  SUM(c.amount - c.amount_refunded) AS net_volume
FROM charges c
JOIN accounts a ON a.id = c.account_id
WHERE c.paid = true
  AND a.payouts_enabled = false
GROUP BY c.account_id, a.business_profile_name
ORDER BY net_volume DESC`;

    const [blocked, negative, exposure] = await Promise.all([
      ctx.sql(blockedSql),
      ctx.sql(negativeSql),
      ctx.sql(exposureSql),
    ]);

    // One organizer can have several events inside the window; keep the soonest.
    const byOrganizer = new Map<string, Record<string, unknown>>();
    for (const row of blocked.rows) {
      const id = str(row, 'account_id');
      const existing = byOrganizer.get(id);
      if (!existing || num(row, 'event_starts_at') < num(existing, 'event_starts_at')) {
        byOrganizer.set(id, row);
      }
    }
    const organizers = Array.from(byOrganizer.values()).sort(
      (a, b) => num(a, 'event_starts_at') - num(b, 'event_starts_at'),
    );

    const exposureByOrganizer = new Map(
      exposure.rows.map((row) => [str(row, 'account_id'), num(row, 'net_volume')]),
    );
    const totalExposure = organizers.reduce(
      (sum, row) => sum + (exposureByOrganizer.get(str(row, 'account_id')) ?? 0),
      0,
    );

    const pastDue = organizers.filter((row) => num(row, 'requirements_past_due_count') > 0);
    const chargesOff = organizers.filter((row) => row.charges_enabled === false);
    const soonest = organizers[0];

    const fieldCounts = new Map<string, number>();
    for (const row of organizers) {
      for (const field of str(row, 'requirements_currently_due').split(',').filter(Boolean)) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }
    const topFields = Array.from(fieldCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const items: ScenarioItem[] = organizers.map((row) => {
      const accountId = str(row, 'account_id');
      const organizer = str(row, 'organizer');
      const due = str(row, 'requirements_currently_due').split(',').filter(Boolean);
      const isPastDue = num(row, 'requirements_past_due_count') > 0;
      const eventAt = num(row, 'event_starts_at');
      const linkType: 'account_onboarding' | 'account_update' =
        row.charges_enabled === false ? 'account_onboarding' : 'account_update';

      return {
        id: accountId,
        title: organizer,
        subtitle: `${str(row, 'event_name')} — ${str(row, 'venue')}, ${str(row, 'city')}`,
        href: `/organizers/${accountId}`,
        facts: [
          {
            label: 'Doors open',
            value: `${longDate(eventAt)} · ${within(eventAt)}`,
            tone: eventAt - T.now < 5 * 86400 ? 'danger' : 'warn',
          },
          {
            label: 'Outstanding',
            value: due.length ? due.join(', ') : 'None listed',
            tone: isPastDue ? 'danger' : 'warn',
          },
          {
            label: 'Already sold',
            value: money(exposureByOrganizer.get(accountId) ?? 0),
          },
          {
            label: 'Accepting payments',
            value: row.charges_enabled === false ? 'No — charges disabled too' : 'Yes',
            tone: row.charges_enabled === false ? 'danger' : 'good',
          },
        ],
        recommendation: isPastDue
          ? `Past due since ${row.requirements_current_deadline ? longDate(num(row, 'requirements_current_deadline')) : 'an unrecorded deadline'}. Send the onboarding link today — this one will not clear itself.`
          : 'Pending verification. The onboarding link lets them finish the outstanding fields themselves.',
        actions: [
          {
            id: `onboarding_${accountId}`,
            label: 'Send onboarding link',
            surface: 'api',
            callLabel: 'POST /v1/account_links',
            method: 'POST',
            path: '/v1/account_links',
            plainEnglish: `Generates a single-use Stripe-hosted link for ${organizer} to complete ${due.length ? due.join(', ') : 'their outstanding requirements'}. The link expires in five minutes once opened, so it goes out by email rather than being stored.`,
            params: {
              account: accountId,
              refresh_url: `https://marquee.example/connect/refresh/${accountId}`,
              return_url: `https://marquee.example/connect/return/${accountId}`,
              type: linkType,
              collection_options: { fields: 'currently_due' },
            },
            totals: [
              { label: 'Organizer', value: organizer },
              { label: 'Link type', value: linkType },
              { label: 'Fields requested', value: due.length ? String(due.length) : 'currently_due' },
              { label: 'Event', value: longDate(eventAt) },
            ],
            variant: 'primary',
            run: (simCtx, options) =>
              api.createAccountLink(
                simCtx,
                {
                  account: accountId,
                  refresh_url: `https://marquee.example/connect/refresh/${accountId}`,
                  return_url: `https://marquee.example/connect/return/${accountId}`,
                  type: linkType,
                  collection_options: { fields: 'currently_due' },
                },
                { idempotencyKey: options.idempotencyKey },
              ),
          },
        ],
      };
    });

    const negativeItems: ScenarioItem[] = negative.rows.map((row) => {
      const accountId = str(row, 'account_id');
      const organizer = str(row, 'organizer');
      const available = num(row, 'available');
      const nextEvent = str(row, 'metadata_next_event_date');

      return {
        id: `negative_${accountId}`,
        title: `${organizer} — ${money(available)}`,
        subtitle: nextEvent
          ? `Next event ${isoToShortDate(nextEvent)}`
          : 'No event currently on sale',
        href: `/organizers/${accountId}`,
        facts: [
          { label: 'Available balance', value: money(available), tone: 'danger' },
          { label: 'Pending', value: money(num(row, 'pending')) },
          { label: 'Payout schedule', value: str(row, 'payout_schedule_interval') },
          {
            label: 'Payouts enabled',
            value: row.payouts_enabled === true ? 'Yes' : 'No',
            tone: row.payouts_enabled === true ? 'warn' : 'neutral',
          },
        ],
        recommendation:
          'Switch this organizer to manual payouts. On a daily schedule, the next sale gets paid straight out and the negative balance never clears — it just rolls forward until Stripe starts failing payouts.',
        actions: [
          {
            id: `hold_payouts_${accountId}`,
            label: 'Hold payouts',
            surface: 'api',
            callLabel: 'POST /v1/accounts/:id',
            method: 'POST',
            path: `/v1/accounts/${accountId}`,
            plainEnglish: `Switches ${organizer} from ${str(row, 'payout_schedule_interval')} to manual payouts. Incoming sales will settle against the ${money(Math.abs(available))} shortfall instead of being paid out, and nothing leaves until someone releases it.`,
            params: {
              settings: { payouts: { schedule: { interval: 'manual' } } },
              metadata: { hold_reason: 'negative_balance', held_by: 'marquee_ask' },
            },
            totals: [
              { label: 'Organizer', value: organizer },
              { label: 'Shortfall', value: money(Math.abs(available)), tone: 'danger' },
              { label: 'Schedule', value: `${str(row, 'payout_schedule_interval')} → manual` },
            ],
            variant: 'danger',
            run: (simCtx, options) =>
              api.updateAccount(
                simCtx,
                accountId,
                {
                  settings: { payouts: { schedule: { interval: 'manual' } } },
                  metadata: { hold_reason: 'negative_balance', held_by: 'marquee_ask' },
                },
                { idempotencyKey: options.idempotencyKey },
              ),
          },
        ],
      };
    });

    const answer = [
      `${plural(organizers.length, 'organizer')} have an event inside 14 days and cannot currently be paid out. Between them they have already sold ${money(totalExposure)}.`,
      `The tightest is ${str(soonest, 'organizer')}: doors open ${longDate(num(soonest, 'event_starts_at'))}, ${within(num(soonest, 'event_starts_at'))}, with ${money(exposureByOrganizer.get(str(soonest, 'account_id')) ?? 0)} already taken.`,
      `${pastDue.length} are past due rather than merely pending, which means Stripe has already given them a deadline and it has passed${chargesOff.length > 0 ? `, and ${chargesOff.length} have had charges disabled as well — they cannot even sell` : ''}. The most common missing fields are ${list(topFields.map(([field, n]) => `${field} (${n})`))}.`,
      `Separately, ${plural(negative.rows.length, 'organizer')} are carrying a negative balance, the deepest at ${money(num(negative.rows[0], 'available'))}. Those need payouts held rather than onboarding links — on a daily schedule the shortfall never gets a chance to clear.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Payout-blocked organizers with imminent events', sql: blockedSql, result: blocked },
        { label: 'Organizers in negative balance', sql: negativeSql, result: negative },
        { label: 'Volume already sold by blocked organizers', sql: exposureSql, result: exposure },
      ],
      items: [...items, ...negativeItems],
      resolution: {
        headline: `Send ${organizers.length} onboarding links now, and hold payouts on the ${negative.rows.length} negative balances.`,
        body: `Onboarding links are the right tool for missing requirements — the organizer completes verification themselves on a Stripe-hosted page and no one on your side handles their documents. The negative balances are a different fix: moving them to manual payouts stops the shortfall rolling forward every day.`,
        bullets: [
          `${money(totalExposure)} of already-sold volume is sitting behind these ${organizers.length} accounts`,
          `${pastDue.length} past due, ${organizers.length - pastDue.length} pending verification`,
          'Links are single-use and expire five minutes after they are opened',
        ],
      },
      actions: [
        {
          id: 'payout_links_all',
          label: `Send all ${organizers.length} onboarding links`,
          surface: 'api',
          callLabel: 'POST /v1/account_links',
          method: 'POST',
          path: '/v1/account_links',
          plainEnglish: `Generates an account link for each of the ${organizers.length} blocked organizers, requesting only their currently-due fields. One call per organizer.`,
          params: {
            accounts: organizers.map((row) => str(row, 'account_id')),
            type: 'account_update',
            collection_options: { fields: 'currently_due' },
          },
          totals: [
            { label: 'Organizers', value: String(organizers.length) },
            { label: 'Exposure covered', value: money(totalExposure) },
            { label: 'Soonest event', value: longDate(num(soonest, 'event_starts_at')) },
          ],
          variant: 'primary',
          batch: { size: 1, total: organizers.length, unitLabel: 'link' },
          run: async (simCtx, options) => {
            const links: unknown[] = [];
            for (let i = 0; i < organizers.length; i += 1) {
              const accountId = str(organizers[i], 'account_id');
              links.push(
                await api.createAccountLink(
                  simCtx,
                  {
                    account: accountId,
                    refresh_url: `https://marquee.example/connect/refresh/${accountId}`,
                    return_url: `https://marquee.example/connect/return/${accountId}`,
                    type: organizers[i].charges_enabled === false ? 'account_onboarding' : 'account_update',
                    collection_options: { fields: 'currently_due' },
                  },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: organizers.length,
                label: `Sent ${i + 1} of ${organizers.length}`,
              });
            }
            return { links: links.length };
          },
        },
        {
          id: 'payout_hold_negatives',
          label: `Hold payouts on ${negative.rows.length} organizers`,
          surface: 'api',
          callLabel: 'POST /v1/accounts/:id',
          method: 'POST',
          path: '/v1/accounts/:id',
          plainEnglish: `Switches all ${negative.rows.length} negative-balance organizers to manual payouts so incoming sales settle the shortfall instead of being paid straight out.`,
          params: {
            accounts: negative.rows.map((row) => str(row, 'account_id')),
            settings: { payouts: { schedule: { interval: 'manual' } } },
          },
          totals: [
            { label: 'Organizers', value: String(negative.rows.length) },
            {
              label: 'Total shortfall',
              value: money(negative.rows.reduce((s, r) => s + num(r, 'available'), 0)),
              tone: 'danger',
            },
          ],
          variant: 'danger',
          batch: { size: 1, total: negative.rows.length, unitLabel: 'organizer' },
          run: async (simCtx, options) => {
            const updated: unknown[] = [];
            for (let i = 0; i < negative.rows.length; i += 1) {
              updated.push(
                await api.updateAccount(
                  simCtx,
                  str(negative.rows[i], 'account_id'),
                  {
                    settings: { payouts: { schedule: { interval: 'manual' } } },
                    metadata: { hold_reason: 'negative_balance', held_by: 'marquee_ask' },
                  },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: negative.rows.length,
                label: `Held ${i + 1} of ${negative.rows.length}`,
              });
            }
            return { accounts: updated.length };
          },
        },
      ],
    };
  },
};
