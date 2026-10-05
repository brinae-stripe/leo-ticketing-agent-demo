import { SCALE_FACTOR } from '../../sim/constants';
import { count, humanize, longDate } from '../../sim/format';
import { dashboardOnly, ef } from '../../stripe-sim';
import { money, num, plural, sql, str, T } from '../helpers';
import type { ActionSpec, Scenario, ScenarioResult } from '../types';

const DAY = 86_400;

/**
 * "How much are we holding before events, and for how long?"
 *
 * This is the scenario that exists because of how event ticketing actually
 * works. Money arrives the day a ticket sells; the organizer does not need it
 * until the event, and the platform does not release it until the event has
 * happened, because a cancelled show means refunding buyers out of funds the
 * organizer would otherwise have spent. So there is a float, it is large, and
 * nobody has ever been asked to put a number on it.
 *
 * Two things follow. The float is measurable, which is the finance answer. And
 * the organizer sitting behind it has money they cannot see or use, which is the
 * product answer — a stored balance turns a holding pen into an account they can
 * pay a vendor out of, without the platform releasing funds any earlier.
 */
export const treasuryFloat: Scenario = {
  id: 'treasury_float',
  scope: 'internal',
  title: 'How much are we holding before events?',
  suggestedPrompt: 'How much are we holding before events, and for how long?',
  blurb:
    'Sizes the pre-event float, how many days it sits, and which organizers could hold it in a stored balance instead.',
  triggers: [
    'how much are we holding before events',
    'how much are we holding before events and for how long',
    'how much money are we holding',
    'pre event float',
    'how long do we hold funds',
    'held funds',
    'what is our float',
    'treasury',
    'stored balance',
  ],
  keywords: [
    'holding',
    'held',
    'float',
    'treasury',
    'wallet',
    'balance',
    'yield',
    'idle',
    'settlement',
    'pre',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const floatSql = sql`
-- The float, organizer by organizer.
-- Only organizers with an event still ahead of them: money held against an event
-- that already happened is a settlement problem, not a float. Each organizer's
-- balance is their own and is not scaled — the 1:100 sampling is of organizers,
-- so the extrapolation to the whole platform happens once, on the total.
SELECT
  a.id AS account_id,
  a.business_profile_name AS organizer,
  b.available + b.pending AS held,
  b.available,
  b.pending,
  a.metadata_next_event_date AS next_event,
  a.payout_schedule_interval,
  a.metadata_settlement_mode AS settlement_mode
FROM account_balances b
JOIN accounts a ON a.id = b.account_id
WHERE b.available > 0
  AND a.metadata_next_event_date IS NOT NULL
ORDER BY held DESC`;

    const durationSql = sql`
-- How long the float actually sits: the gap between money arriving and the
-- event it was sold for. Averaged per event so a big show does not drown out
-- the shape — the tail matters more than the mean here.
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.account_id,
  e.starts_at,
  COUNT(*) AS orders,
  SUM(c.amount - c.amount_refunded) AS gross,
  ROUND(AVG(e.starts_at - c.created) / ${DAY}) AS avg_days_held
FROM charges c
JOIN events e ON e.id = c.metadata_event_id
WHERE c.paid = true
  AND e.starts_at > ${T.now}
  AND e.status = 'on_sale'
GROUP BY e.id, e.name, e.account_id, e.starts_at
ORDER BY gross DESC`;

    const existingSql = sql`
-- Who already holds a stored balance, and what is in it.
SELECT
  fa.id AS financial_account_id,
  fa.account_id,
  a.business_profile_name AS organizer,
  fa.balance_cash,
  fa.balance_inbound_pending,
  fa.balance_outbound_pending,
  fa.active_features_count,
  fa.created
FROM treasury_financial_accounts fa
JOIN accounts a ON a.id = fa.account_id
WHERE fa.status = 'open'
ORDER BY fa.balance_cash DESC`;

    const vendorSql = sql`
-- What the organizers who do have a balance use it for. This is the behaviour
-- that justifies the product: money leaving to a third party directly, rather
-- than a payout to the organizer's bank followed by a wire out of it.
SELECT
  op.status,
  COUNT(*) AS payments,
  SUM(op.amount) AS total_amount
FROM treasury_outbound_payments op
WHERE op.created >= ${T.daysAgo(90)}
GROUP BY op.status
ORDER BY total_amount DESC`;

    const [floatRows, duration, existing, vendor] = await Promise.all([
      ctx.sql(floatSql),
      ctx.sql(durationSql),
      ctx.sql(existingSql),
      ctx.sql(vendorSql),
    ]);

    const totalHeld = floatRows.rows.reduce((s, r) => s + num(r, 'held'), 0);
    const organizerCount = floatRows.rows.length;

    // Weight by gross, not by event: a 30-day hold on $2M is the number that
    // matters, and a simple mean over events would let a $900 show cancel it out.
    const weightedDays = duration.rows.reduce(
      (s, r) => s + num(r, 'avg_days_held') * num(r, 'gross'),
      0,
    );
    const durationGross = duration.rows.reduce((s, r) => s + num(r, 'gross'), 0);
    const avgDaysHeld = durationGross > 0 ? weightedDays / durationGross : 0;

    const longestHold = duration.rows
      .slice()
      .sort((a, b) => num(b, 'avg_days_held') - num(a, 'avg_days_held'))[0];

    const existingIds = new Set(existing.rows.map((r) => str(r, 'account_id')));
    const existingCash = existing.rows.reduce((s, r) => s + num(r, 'balance_cash'), 0);

    const candidates = floatRows.rows.filter((r) => !existingIds.has(str(r, 'account_id')));
    const candidateHeld = candidates.reduce((s, r) => s + num(r, 'held'), 0);

    const vendorTotal = vendor.rows.reduce((s, r) => s + num(r, 'total_amount'), 0);
    const vendorCount = vendor.rows.reduce((s, r) => s + num(r, 'payments'), 0);

    const answer = [
      `${money(totalHeld)} across ${plural(organizerCount, 'organizer')} with an event still to come — and since these organizers are a 1:100 sample of the platform's, about ${money(totalHeld * SCALE_FACTOR)} platform-wide. That is the pre-event float: money that has arrived from ticket buyers and will not be released until the doors close.`,
      `Weighted by volume it sits for about ${Math.round(avgDaysHeld)} days. ${longestHold ? `The long tail is worse than the average: ${str(longestHold, 'event_name')} is holding money for ${count(num(longestHold, 'avg_days_held'))} days on average, and does not open until ${longDate(num(longestHold, 'starts_at'))}.` : ''} The hold is not an accident or a Stripe constraint — it is deliberate, because a cancelled show means refunding buyers from funds the organizer has not yet spent.`,
      existing.rows.length > 0
        ? `${plural(existing.rows.length, 'organizer')} already hold${existing.rows.length === 1 ? 's' : ''} a stored balance rather than waiting on a payout, ${money(existingCash)} between them. Over the last 90 days they made ${plural(vendorCount, 'payment')} out of it totalling ${money(vendorTotal)} — vendor money going straight out, instead of a payout to their own bank and then a wire from there.`
        : 'No organizer holds a stored balance yet, so there is no behaviour to compare against.',
      `The thing worth noticing: the float does not have to shrink for this to be useful. An organizer with a stored balance can see and spend what they have taken without the platform releasing funds any earlier than it does today — the hold stays, the ${money(candidateHeld)} sitting behind ${plural(candidates.length, 'organizer')} stops being invisible to them.`,
    ];

    /* ------------------------------- actions ------------------------------ */

    const topCandidates = candidates.slice(0, 5);

    const actions: ActionSpec[] = [];

    if (topCandidates.length > 0) {
      const batchHeld = topCandidates.reduce((s, r) => s + num(r, 'held'), 0);
      actions.push({
        id: 'treasury_open_accounts',
        label: `Open stored balances for the top ${topCandidates.length}`,
        surface: 'api',
        callLabel: 'POST /v1/treasury/financial_accounts',
        method: 'POST',
        path: '/v1/treasury/financial_accounts',
        plainEnglish: `Opens a stored-balance account on each of the ${topCandidates.length} largest organizers without one. Each account starts empty — opening it moves no money. Funds only arrive once the payout destination is repointed at it, which is a separate change these organizers have to agree to.`,
        params: {
          note: `${topCandidates.length} separate calls, one per connected account`,
          accounts: topCandidates.map((r) => ({
            stripe_account: str(r, 'account_id'),
            organizer: str(r, 'organizer'),
            currently_held: num(r, 'held'),
          })),
          supported_currencies: ['usd'],
          features: {
            'financial_addresses.aba': { requested: true },
            'inbound_transfers.ach': { requested: true },
            'outbound_payments.ach': { requested: true },
            'outbound_transfers.ach': { requested: true },
          },
        },
        totals: [
          { label: 'Accounts opened', value: String(topCandidates.length) },
          { label: 'Float behind them', value: money(batchHeld) },
          { label: 'Money moved now', value: 'None' },
          { label: 'Prerequisite', value: 'treasury capability active', tone: 'warn' },
        ],
        batch: { size: 1, total: topCandidates.length, unitLabel: 'account' },
        variant: 'primary',
        run: async (simCtx, options) => {
          const results = [];
          for (const [i, row] of topCandidates.entries()) {
            results.push(
              await ef.createFinancialAccount(
                simCtx,
                str(row, 'account_id'),
                {
                  supported_currencies: ['usd'],
                  features: {
                    'financial_addresses.aba': { requested: true },
                    'inbound_transfers.ach': { requested: true },
                    'outbound_payments.ach': { requested: true },
                    'outbound_transfers.ach': { requested: true },
                  },
                },
                { idempotencyKey: `${options.idempotencyKey}-${i}` },
              ),
            );
            options.onProgress?.({
              done: i + 1,
              total: topCandidates.length,
              label: 'Opening financial accounts',
            });
          }
          return results;
        },
      });
    }

    return {
      answer,
      queries: [
        { label: 'Float by organizer', sql: floatSql, result: floatRows },
        { label: 'How long it sits, per upcoming event', sql: durationSql, result: duration },
        { label: 'Stored balances already open', sql: existingSql, result: existing },
        { label: 'What those balances get spent on', sql: vendorSql, result: vendor },
      ],
      table: {
        caption: 'Largest pre-event balances without a stored-balance account',
        columns: [
          { key: 'organizer', label: 'Organizer' },
          { key: 'held', label: 'Held', align: 'right', kind: 'money' },
          { key: 'available', label: 'Settled', align: 'right', kind: 'money' },
          { key: 'pending', label: 'In transit', align: 'right', kind: 'money' },
          { key: 'next_event_date', label: 'Next event' },
          { key: 'payout_schedule', label: 'Payout schedule' },
        ],
        // next_event arrives as an ISO date string and the schedule as a raw
        // enum. Neither is covered by the table's money/date/number kinds, so
        // they are formatted into the row.
        rows: candidates.slice(0, 12).map((row) => ({
          ...row,
          next_event_date: str(row, 'next_event')
            ? longDate(Date.parse(`${str(row, 'next_event')}T00:00:00Z`) / 1000)
            : '—',
          payout_schedule: humanize(str(row, 'payout_schedule_interval')),
        })),
      },
      resolution: {
        headline: `${money(totalHeld)} held for an average of ${Math.round(avgDaysHeld)} days before events.`,
        body: `The hold itself is a real operating requirement and should stay. What is worth changing is that the organizer behind it cannot see or use their own money in the meantime — a stored balance fixes that without moving the release date. Opening an account is free and moves nothing; it needs the treasury capability active on the platform first, and that is not an API call.`,
        bullets: [
          `${money(totalHeld)} across ${plural(organizerCount, 'organizer')} with events still to come`,
          `~${Math.round(avgDaysHeld)} days weighted average hold${longestHold ? `, up to ${count(num(longestHold, 'avg_days_held'))} days on ${str(longestHold, 'event_name')}` : ''}`,
          `${plural(candidates.length, 'organizer')} with float and no stored balance · ${money(candidateHeld)}`,
          ...(vendorTotal > 0
            ? [`${money(vendorTotal)} already paid straight to vendors by the ${existing.rows.length} that have one`]
            : []),
        ],
      },
      actions,
      dashboardOnly: [
        dashboardOnly(
          'treasury_enablement',
          `Treasury is invite-only and underwritten by Stripe with its bank partners. The ${money(totalHeld)} float and the ~${Math.round(avgDaysHeld)}-day hold are the case to take to the account team; until the capability is active, the create call above will fail on every one of these accounts.`,
        ),
      ],
    };
  },
};
