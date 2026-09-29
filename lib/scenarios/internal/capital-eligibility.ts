import { CAPITAL_ELIGIBILITY } from '../../sim/embedded-finance';
import { SCALE_FACTOR } from '../../sim/constants';
import { longDate } from '../../sim/format';
import { dashboardOnly, ef } from '../../stripe-sim';
import { money, num, percent, plural, sql, str, within, T } from '../helpers';
import type { ActionSpec, Scenario, ScenarioResult } from '../types';

/**
 * "Which organizers could be offered financing?"
 *
 * The interesting number here is not how many organizers qualify — Stripe
 * underwrites that and hands the platform a list. It is how many of those offers
 * the platform has never shown anyone. An offer sits in `undelivered` until the
 * platform records that it surfaced it, and an offer nobody sees expires on
 * schedule regardless. That is revenue decaying in a table, on a clock.
 *
 * Note the `* ${SCALE_FACTOR}` in the first query. `charges` is a 1:100 sample,
 * so trailing volume off the sampled rows has to be scaled before it can be
 * compared to a threshold denominated in real dollars. It is done in the SQL
 * rather than in TypeScript so that anyone reading the query on screen can see
 * it happening instead of wondering why the numbers do not tie.
 */
export const capitalEligibility: Scenario = {
  id: 'capital_eligibility',
  scope: 'internal',
  title: 'Which organizers could be offered financing?',
  suggestedPrompt: 'Which organizers could be offered financing?',
  blurb:
    'Finds live Capital offers the platform has never surfaced, and what they are worth before they lapse.',
  triggers: [
    'which organizers could be offered financing',
    'which organizers are eligible for financing',
    'who is eligible for capital',
    'capital eligibility',
    'financing offers',
    'working capital',
    'who can we offer a loan to',
    'which organizers can get an advance',
  ],
  keywords: [
    'capital',
    'financing',
    'advance',
    'loan',
    'eligible',
    'eligibility',
    'lending',
    'offers',
    'undelivered',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const eligibilitySql = sql`
-- Who clears the bar, and by how much.
-- Two filters, not one. Volume and history in the HAVING, because those are
-- aggregates; account standing in the WHERE, because an organizer who cannot be
-- paid out cannot be advanced against either — there is nothing to withhold
-- repayment from.
-- charges is a 1:100 sample, so trailing volume is scaled to real dollars here
-- rather than in application code: the threshold is a real-dollar figure and
-- comparing it against sampled rows would exclude everybody.
SELECT
  a.id AS account_id,
  a.business_profile_name AS organizer,
  SUM(c.amount - c.amount_refunded) * ${SCALE_FACTOR} AS trailing_volume,
  COUNT(*) AS paid_charges,
  a.payout_schedule_interval,
  a.metadata_next_event_date AS next_event
FROM charges c
JOIN accounts a ON a.id = c.account_id
WHERE c.paid = true
  AND c.created >= ${T.daysAgo(90)}
  AND a.charges_enabled = true
  AND a.payouts_enabled = true
  AND a.requirements_past_due_count = 0
GROUP BY a.id, a.business_profile_name, a.payout_schedule_interval, a.metadata_next_event_date
HAVING SUM(c.amount - c.amount_refunded) * ${SCALE_FACTOR} >= ${CAPITAL_ELIGIBILITY.minTrailingVolume}
  AND COUNT(*) >= ${CAPITAL_ELIGIBILITY.minPaidCharges}
ORDER BY trailing_volume DESC`;

    const offersSql = sql`
-- Every offer Stripe has underwritten, and where it stands.
-- "undelivered" does not mean declined. It means the organizer has never been
-- shown it, which is the one state the platform alone is responsible for.
SELECT
  o.status,
  COUNT(*) AS offers,
  SUM(o.offered_amount) AS offered,
  SUM(o.fee_amount) AS fees
FROM capital_financing_offers o
GROUP BY o.status
ORDER BY offered DESC`;

    const undeliveredSql = sql`
-- The actionable list, soonest to lapse first. An offer has a 30-day term from
-- the day Stripe writes it, and that clock does not pause for the platform.
SELECT
  o.id AS offer_id,
  o.account_id,
  a.business_profile_name AS organizer,
  o.offered_amount,
  o.fee_amount,
  o.withhold_rate,
  o.created,
  o.expires_after,
  a.metadata_next_event_date AS next_event
FROM capital_financing_offers o
JOIN accounts a ON a.id = o.account_id
WHERE o.status = 'undelivered'
ORDER BY o.expires_after ASC`;

    const outstandingSql = sql`
-- Advances already drawn, and what is still being withheld from ticket sales.
SELECT
  s.account_id,
  a.business_profile_name AS organizer,
  s.advance_amount,
  s.fee_amount,
  s.remaining_amount,
  s.withhold_rate,
  s.paid_out_at
FROM capital_financing_summaries s
JOIN accounts a ON a.id = s.account_id
ORDER BY s.remaining_amount DESC`;

    const [eligibility, offers, undelivered, outstanding] = await Promise.all([
      ctx.sql(eligibilitySql),
      ctx.sql(offersSql),
      ctx.sql(undeliveredSql),
      ctx.sql(outstandingSql),
    ]);

    const eligibleCount = eligibility.rows.length;
    const eligibleVolume = eligibility.rows.reduce((s, r) => s + num(r, 'trailing_volume'), 0);

    const totalOffers = offers.rows.reduce((s, r) => s + num(r, 'offers'), 0);
    const totalOffered = offers.rows.reduce((s, r) => s + num(r, 'offered'), 0);

    const undeliveredRows = undelivered.rows;
    const undeliveredValue = undeliveredRows.reduce((s, r) => s + num(r, 'offered_amount'), 0);
    const lapsingSoon = undeliveredRows.filter(
      (r) => num(r, 'expires_after') - T.now < 7 * 86_400,
    );
    const lapsingValue = lapsingSoon.reduce((s, r) => s + num(r, 'offered_amount'), 0);

    const drawn = outstanding.rows.length;
    const drawnAmount = outstanding.rows.reduce((s, r) => s + num(r, 'advance_amount'), 0);
    const remaining = outstanding.rows.reduce((s, r) => s + num(r, 'remaining_amount'), 0);

    const withoutOffer = Math.max(0, eligibleCount - totalOffers);

    const answer = [
      `${plural(eligibleCount, 'organizer')} clear the eligibility bar — ${money(eligibleVolume)} of trailing 90-day volume between them, at platform scale, all of them in good standing and payable. Stripe has underwritten ${plural(totalOffers, 'offer')} against that, worth ${money(totalOffered)} in total.`,
      undeliveredRows.length === 0
        ? 'Every live offer has been surfaced to its organizer, which is the state you want.'
        : `${undeliveredRows.length} of those offers ${undeliveredRows.length === 1 ? 'has' : 'have'} never been shown to anyone — ${money(undeliveredValue)} of financing sitting in a table. Offers run for ${CAPITAL_ELIGIBILITY.offerTermDays} days from the day Stripe writes them, and ${lapsingSoon.length > 0 ? `${lapsingSoon.length} of them ${lapsingSoon.length === 1 ? 'lapses' : 'lapse'} inside a week, taking ${money(lapsingValue)} with ${lapsingSoon.length === 1 ? 'it' : 'them'}` : 'none of these are inside a week of lapsing yet'}.`,
      drawn > 0
        ? `For what it is worth as a signal: ${plural(drawn, 'organizer')} ${drawn === 1 ? 'has' : 'have'} already drawn. ${money(drawnAmount)} was advanced and ${money(remaining)} is still to come back — more than was advanced, because the figure includes the fee. Repayment comes out of future ticket sales at the withhold rate, so it settles itself as they trade: no invoice to chase, and no credit risk on your balance sheet.`
        : 'Nobody has drawn yet, so there is no repayment behaviour to read.',
      `The limit of this answer. ${withoutOffer > 0 ? `${plural(withoutOffer, 'organizer')} clear${withoutOffer === 1 ? 's' : ''} the bar above with no offer written against ${withoutOffer === 1 ? 'it' : 'them'}, and this cannot tell you why. ` : ''}The filter above is the platform's approximation of eligibility, not Stripe's decision — underwriting is Stripe's own model and it weighs things the platform's warehouse cannot see. Treat the list as a prompt to ask, not as a promise to the organizer.`,
    ];

    /* ------------------------------- actions ------------------------------ */

    const deliverAll: ActionSpec[] =
      undeliveredRows.length > 0
        ? [
            {
              id: 'capital_deliver_all',
              label: `Surface all ${undeliveredRows.length} offers`,
              surface: 'api',
              callLabel: 'POST /v1/capital/financing_offers/:id/mark_delivered',
              method: 'POST',
              path: '/v1/capital/financing_offers/:id/mark_delivered',
              plainEnglish: `Records that all ${undeliveredRows.length} offers have been surfaced to their organizers, which is what Stripe requires before an organizer can act on one. This marks delivery — it does not accept anything, and no money moves. Each organizer still has to agree to the terms themselves.`,
              params: {
                note: `${undeliveredRows.length} separate calls, one per offer`,
                offers: undeliveredRows.map((r) => ({
                  id: str(r, 'offer_id'),
                  account: str(r, 'account_id'),
                  offered_amount: num(r, 'offered_amount'),
                })),
              },
              totals: [
                { label: 'Offers', value: String(undeliveredRows.length) },
                { label: 'Financing surfaced', value: money(undeliveredValue) },
                {
                  label: 'Lapsing within 7 days',
                  value: `${lapsingSoon.length} · ${money(lapsingValue)}`,
                  tone: lapsingSoon.length > 0 ? 'warn' : 'neutral',
                },
                { label: 'Money moved', value: 'None' },
              ],
              batch: {
                size: 1,
                total: undeliveredRows.length,
                unitLabel: 'offer',
              },
              variant: 'primary',
              run: async (simCtx, options) => {
                const results = [];
                for (const [i, row] of undeliveredRows.entries()) {
                  results.push(
                    await ef.markFinancingOfferDelivered(simCtx, str(row, 'offer_id'), {
                      idempotencyKey: `${options.idempotencyKey}-${i}`,
                    }),
                  );
                  options.onProgress?.({
                    done: i + 1,
                    total: undeliveredRows.length,
                    label: 'Marking offers delivered',
                  });
                }
                return results;
              },
            },
          ]
        : [];

    return {
      answer,
      queries: [
        { label: 'Organizers clearing the eligibility bar', sql: eligibilitySql, result: eligibility },
        { label: 'Offers by status', sql: offersSql, result: offers },
        { label: 'Offers never surfaced', sql: undeliveredSql, result: undelivered },
        { label: 'Advances already drawn', sql: outstandingSql, result: outstanding },
      ],
      table:
        undeliveredRows.length > 0
          ? {
              caption: 'Undelivered offers, soonest to lapse first',
              columns: [
                { key: 'organizer', label: 'Organizer' },
                { key: 'offered_amount', label: 'Offered', align: 'right', kind: 'money' },
                { key: 'fee_amount', label: 'Fee', align: 'right', kind: 'money' },
                { key: 'withhold', label: 'Withhold', align: 'right' },
                { key: 'expires_after', label: 'Lapses', kind: 'date' },
                { key: 'lapses_in', label: 'Time left', align: 'right' },
                { key: 'next_event_date', label: 'Next event' },
              ],
              // withhold_rate arrives as a decimal string and next_event as an ISO
              // date, neither of which the table's money/date/number kinds cover.
              // Formatting them into the row keeps the raw columns queryable while
              // the table stays readable.
              rows: undeliveredRows.map((row) => ({
                ...row,
                withhold: percent(Number(str(row, 'withhold_rate')), 1),
                lapses_in: within(num(row, 'expires_after')),
                next_event_date: str(row, 'next_event')
                  ? longDate(Date.parse(`${str(row, 'next_event')}T00:00:00Z`) / 1000)
                  : '—',
              })),
            }
          : undefined,
      resolution: {
        headline:
          undeliveredRows.length > 0
            ? `${money(undeliveredValue)} of financing has never been shown to the organizers it was written for.`
            : `${money(totalOffered)} of financing is live and surfaced.`,
        body:
          undeliveredRows.length > 0
            ? `Marking these delivered costs nothing and commits nobody — it is the step that lets an organizer see the offer at all. Do the ${lapsingSoon.length > 0 ? `${lapsingSoon.length} lapsing inside a week` : 'whole list'} first. Acceptance is the organizer's decision and happens in a Stripe-hosted flow you can embed but cannot complete on their behalf, which is the right shape: they are the ones taking on the liability.`
            : 'Nothing to surface. Worth re-running when Stripe writes the next batch, since each offer starts its own 30-day clock.',
        bullets: [
          `${plural(eligibleCount, 'organizer')} eligible on volume · ${plural(totalOffers, 'offer')} underwritten · ${money(totalOffered)}`,
          ...(lapsingSoon.length > 0
            ? [
                `Soonest to lapse: ${str(lapsingSoon[0], 'organizer')}, ${money(num(lapsingSoon[0], 'offered_amount'))}, ${within(num(lapsingSoon[0], 'expires_after'))} (${longDate(num(lapsingSoon[0], 'expires_after'))})`,
              ]
            : []),
          ...(drawn > 0
            ? [`${money(remaining)} outstanding across ${plural(drawn, 'drawn advance')}, repaid from ticket sales`]
            : []),
        ],
      },
      actions: deliverAll,
      items: undeliveredRows.slice(0, 6).map((row) => {
        const offerId = str(row, 'offer_id');
        const accountId = str(row, 'account_id');
        const organizer = str(row, 'organizer');
        const offered = num(row, 'offered_amount');
        const fee = num(row, 'fee_amount');
        const expires = num(row, 'expires_after');
        const soon = expires - T.now < 7 * 86_400;

        return {
          id: offerId,
          title: organizer,
          subtitle: `${money(offered)} offered · ${money(fee)} fee · ${percent(Number(str(row, 'withhold_rate')), 1)} withheld from sales`,
          href: `/organizers/${accountId}`,
          facts: [
            { label: 'Lapses', value: within(expires), tone: soon ? 'danger' : 'neutral' },
            { label: 'Written', value: longDate(num(row, 'created')) },
            {
              label: 'Next event',
              value: str(row, 'next_event')
                ? longDate(Date.parse(`${str(row, 'next_event')}T00:00:00Z`) / 1000)
                : 'none scheduled',
            },
            { label: 'Total cost to organizer', value: money(offered + fee) },
          ],
          recommendation: soon
            ? `Surface this now — it lapses ${within(expires)} and Stripe will not extend it.`
            : 'Surface it. There is no downside to the organizer seeing an offer they can decline.',
          actions: [
            {
              id: `capital_deliver_${offerId}`,
              label: 'Mark delivered',
              surface: 'api',
              callLabel: 'POST /v1/capital/financing_offers/:id/mark_delivered',
              method: 'POST',
              path: `/v1/capital/financing_offers/${offerId}/mark_delivered`,
              plainEnglish: `Records that ${organizer} has been shown their ${money(offered)} offer. No money moves and nothing is accepted — this is the step that makes the offer visible to them.`,
              params: {},
              totals: [
                { label: 'Organizer', value: organizer },
                { label: 'Offered', value: money(offered) },
                { label: 'Lapses', value: within(expires), tone: soon ? 'warn' : 'neutral' },
              ],
              variant: 'primary',
              run: (simCtx, options) =>
                ef.markFinancingOfferDelivered(simCtx, offerId, {
                  idempotencyKey: options.idempotencyKey,
                }),
            },
          ],
          dashboardOnly: [
            dashboardOnly(
              'capital_offer_acceptance',
              `${organizer} accepts the ${money(offered)} themselves. The platform can embed the flow so they never leave your dashboard, but there is no endpoint that agrees to ${money(offered + fee)} of liability on someone else's behalf.`,
            ),
          ],
        };
      }),
    };
  },
};
