import { CAPITAL_ELIGIBILITY } from '../../sim/embedded-finance';
import { SCALE_FACTOR } from '../../sim/constants';
import { longDate } from '../../sim/format';
import { dashboardOnly, ef } from '../../stripe-sim';
import { money, num, percent, plural, sql, str, within, T } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

const DAY = 86_400;

/**
 * "Can I get an advance to cover my venue deposit?"
 *
 * The organizer's version of the Capital question, and the one place in this
 * demo where the right answer is a button that deliberately does not finish the
 * job. An advance is the organizer's liability, so the organizer has to agree to
 * the terms in a Stripe-hosted surface. The platform can embed that surface —
 * they never leave the dashboard — but there is no endpoint that accepts on
 * someone else's behalf, and building the demo as though there were would teach
 * the wrong integration.
 *
 * What the agent can do that is genuinely useful: work out the payback period
 * from the organizer's own sales rate, so "17% withheld" becomes "about nine
 * weeks", which is the number a person can actually decide on.
 */
export const capitalAdvance: Scenario = {
  id: 'organizer_capital_advance',
  scope: 'organizer',
  title: 'Can I get an advance on my next event?',
  suggestedPrompt: 'Can I get an advance to cover my venue deposit?',
  blurb:
    'Reads the live financing offer, converts the withhold rate into a payback period, and opens the flow the organizer has to complete themselves.',
  triggers: [
    'can i get an advance to cover my venue deposit',
    'can i get an advance on my next event',
    'can i get an advance',
    'can i borrow',
    'do i qualify for financing',
    'i need cash for my next event',
    'venue deposit',
    'working capital',
    'a loan',
  ],
  keywords: [
    'advance',
    'loan',
    'borrow',
    'financing',
    'capital',
    'deposit',
    'cash',
    'upfront',
    'fund',
    'funding',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const organizer = ctx.index.accountById.get(accountId)!;

    const offerSql = sql`
-- The offer, if Stripe has written one. status matters as much as the amount:
-- "undelivered" means the platform has it but has not surfaced it yet.
SELECT
  id AS offer_id,
  status,
  offered_amount,
  fee_amount,
  withhold_rate,
  created,
  expires_after,
  delivered_at,
  accepted_at
FROM capital_financing_offers
WHERE account_id = '${accountId}'
ORDER BY created DESC`;

    const drawnSql = sql`
-- Anything already drawn. Two advances cannot run at once, so an outstanding
-- balance is the answer to the question on its own.
SELECT
  offer_id,
  advance_amount,
  fee_amount,
  remaining_amount,
  withhold_rate,
  paid_out_at
FROM capital_financing_summaries
WHERE account_id = '${accountId}'`;

    const rateSql = sql`
-- The sales rate that would repay it. 90 days rather than a single week, because
-- ticket sales are spiky around events and a week either side of a show would
-- give a payback estimate that is wrong in both directions.
SELECT
  COUNT(*) AS paid_charges,
  SUM(c.amount - c.amount_refunded) * ${SCALE_FACTOR} AS trailing_volume,
  ROUND(SUM(c.amount - c.amount_refunded) * ${SCALE_FACTOR} / 90) AS daily_volume
FROM charges c
WHERE c.account_id = '${accountId}'
  AND c.paid = true
  AND c.created >= ${T.daysAgo(90)}`;

    const upcomingSql = sql`
-- What the money would be for. An advance against an event that has already
-- sold through is a different conversation from one funding a deposit.
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.starts_at,
  e.venue,
  COUNT(c.id) AS orders,
  COALESCE(SUM(CASE WHEN c.paid = true THEN c.amount - c.amount_refunded ELSE 0 END), 0) * ${SCALE_FACTOR} AS sold_so_far
FROM events e
LEFT JOIN charges c ON c.metadata_event_id = e.id
WHERE e.account_id = '${accountId}'
  AND e.starts_at > ${T.now}
  AND e.status = 'on_sale'
GROUP BY e.id, e.name, e.starts_at, e.venue
ORDER BY e.starts_at ASC`;

    const [offerRows, drawnRows, rate, upcoming] = await Promise.all([
      ctx.sql(offerSql),
      ctx.sql(drawnSql),
      ctx.sql(rateSql),
      ctx.sql(upcomingSql),
    ]);

    const trailingVolume = num(rate.rows[0], 'trailing_volume');
    const dailyVolume = num(rate.rows[0], 'daily_volume');
    const paidCharges = num(rate.rows[0], 'paid_charges');
    const nextEvent = upcoming.rows[0];

    const drawn = drawnRows.rows[0];
    const live = offerRows.rows.find((r) =>
      ['undelivered', 'delivered'].includes(str(r, 'status')),
    );

    /* ----------------------- already drawing an advance ------------------- */

    if (drawn) {
      const remaining = num(drawn, 'remaining_amount');
      const withhold = Number(str(drawn, 'withhold_rate'));
      const daysLeft = dailyVolume * withhold > 0 ? remaining / (dailyVolume * withhold) : 0;

      return {
        answer: [
          `You already have an advance running, so there is nothing new to take right now — Stripe writes one at a time. You drew ${money(num(drawn, 'advance_amount'))} on ${longDate(num(drawn, 'paid_out_at'))} with a ${money(num(drawn, 'fee_amount'))} fee.`,
          `${money(remaining)} of that is still outstanding. It is coming out of your ticket sales at ${percent(withhold, 1)} of each payment, so at your current rate of about ${money(dailyVolume)} a day you are repaying roughly ${money(Math.round(dailyVolume * withhold))} a day — ${Math.round(daysLeft)} days to clear, give or take however your next event sells.`,
          `Nothing to chase and no date to miss: if you sell more it clears faster, and if you sell less it takes longer. That is the whole mechanism. Once it is clear, Stripe usually writes a new offer.`,
        ],
        queries: [
          { label: 'Your advance', sql: drawnSql, result: drawnRows },
          { label: 'Your sales rate', sql: rateSql, result: rate },
          { label: 'Offer history', sql: offerSql, result: offerRows },
        ],
        resolution: {
          headline: `${money(remaining)} left to repay, about ${Math.round(daysLeft)} days at your current sales rate.`,
          body: `No action needed. Repayment is automatic out of ticket sales at ${percent(withhold, 1)}, and there is no fixed instalment to miss.`,
          bullets: [
            `${money(num(drawn, 'advance_amount'))} advanced ${longDate(num(drawn, 'paid_out_at'))} · ${money(num(drawn, 'fee_amount'))} fee`,
            `${money(remaining)} outstanding · ${percent(withhold, 1)} of each payment withheld`,
            `~${money(Math.round(dailyVolume * withhold))} a day at your current rate`,
          ],
        },
        actions: [],
      };
    }

    /* --------------------------- no offer at all -------------------------- */

    if (!live) {
      const shortfall = CAPITAL_ELIGIBILITY.minTrailingVolume - trailingVolume;
      const declined = offerRows.rows.filter((r) =>
        ['expired', 'canceled'].includes(str(r, 'status')),
      );

      return {
        answer: [
          declined.length > 0
            ? `There is no live offer on your account right now. You did have one for ${money(num(declined[0], 'offered_amount'))}, but it lapsed on ${longDate(num(declined[0], 'expires_after'))} — offers run ${CAPITAL_ELIGIBILITY.offerTermDays} days and then close.`
            : 'Stripe has not written a financing offer for you yet, so there is nothing to take today.',
          shortfall > 0
            ? `The usual reason is trading history. Your last 90 days came to ${money(trailingVolume)} across ${plural(paidCharges, 'payment')}; the rough bar is ${money(CAPITAL_ELIGIBILITY.minTrailingVolume)}, so you are about ${money(shortfall)} short of where offers typically start appearing.`
            : `Your volume is not the issue — ${money(trailingVolume)} over the last 90 days clears the range where offers usually appear. ${!organizer.payouts_enabled ? 'Payouts are currently disabled on your account, and that does block it: finish your outstanding verification and it should resolve.' : organizer.requirements_past_due.length > 0 ? `You have ${plural(organizer.requirements_past_due.length, 'verification item')} past due, which blocks it. Clear those first.` : 'Underwriting is Stripe\'s own model and it weighs more than volume, so this is worth asking your platform contact about rather than guessing at.'}`,
          `To be straight about the limits of this answer: eligibility is Stripe's decision, not something this dashboard computes. The figures above are what your own sales data says, which is a good guide and not a ruling.`,
        ],
        queries: [
          { label: 'Offers on your account', sql: offerSql, result: offerRows },
          { label: 'Your trailing volume', sql: rateSql, result: rate },
        ],
        resolution: {
          headline: 'No financing offer available today.',
          body:
            shortfall > 0
              ? `Keep trading. Offers are written off trailing volume, and you are roughly ${money(shortfall)} of 90-day volume away from the range where they appear.`
              : 'Your volume is in range, so this is worth raising with your platform contact rather than waiting.',
          bullets: [
            `${money(trailingVolume)} over 90 days across ${plural(paidCharges, 'payment')}`,
            `Rough threshold: ${money(CAPITAL_ELIGIBILITY.minTrailingVolume)}`,
            ...(organizer.requirements_past_due.length > 0
              ? [`${plural(organizer.requirements_past_due.length, 'verification item')} past due — clear these first`]
              : []),
          ],
        },
        actions: [],
      };
    }

    /* ------------------------------ live offer ---------------------------- */

    const offerId = str(live, 'offer_id');
    const offered = num(live, 'offered_amount');
    const fee = num(live, 'fee_amount');
    const withhold = Number(str(live, 'withhold_rate'));
    const expires = num(live, 'expires_after');
    const total = offered + fee;
    const surfaced = str(live, 'status') === 'delivered';

    const dailyRepayment = dailyVolume * withhold;
    const paybackDays = dailyRepayment > 0 ? total / dailyRepayment : 0;
    const paybackWeeks = Math.round(paybackDays / 7);
    const effectiveCost = offered > 0 ? fee / offered : 0;
    const clearsBeforeEvent = nextEvent
      ? T.now + paybackDays * DAY < num(nextEvent, 'starts_at')
      : false;

    return {
      answer: [
        `Yes — you have an offer for ${money(offered)}. The cost is a flat ${money(fee)} fee, which is ${percent(effectiveCost, 1)} of the amount. There is no interest and no instalment schedule: Stripe withholds ${percent(withhold, 1)} of every payment you take until ${money(total)} is repaid.`,
        `What that means at your sales rate. You have taken ${money(trailingVolume)} over the last 90 days, about ${money(dailyVolume)} a day, so ${percent(withhold, 1)} of that is roughly ${money(Math.round(dailyRepayment))} a day coming off the top. ${money(total)} at that rate is about ${paybackWeeks === 1 ? 'a week' : `${paybackWeeks} weeks`}. If sales slow it stretches; there is no date you can miss.`,
        nextEvent
          ? `Against your next event: ${str(nextEvent, 'event_name')} opens ${longDate(num(nextEvent, 'starts_at'))} at ${str(nextEvent, 'venue')} and has sold ${money(num(nextEvent, 'sold_so_far'))} so far. ${clearsBeforeEvent ? `On current pace the advance would be repaid before doors open, so it would not eat into that event's takings.` : `On current pace you would still be repaying when doors open, so plan for ${percent(withhold, 1)} coming off that event's sales too.`}`
          : 'You have no event on sale at the moment, which is worth weighing: repayment only happens when you are taking payments, so an advance drawn during a quiet period just sits there costing you the fee.',
        surfaced
          ? `This offer lapses ${within(expires)} (${longDate(expires)}). The decision is yours and has to be made by you — the platform cannot accept it for you, because you are the one taking on the ${money(total)}.`
          : `Worth knowing: this offer has not formally been surfaced to you yet, which is a step on the platform's side. It lapses ${within(expires)} either way.`,
      ],
      queries: [
        { label: 'Your offer', sql: offerSql, result: offerRows },
        { label: 'Your sales rate', sql: rateSql, result: rate },
        { label: 'What it would fund', sql: upcomingSql, result: upcoming },
        { label: 'Advances already drawn', sql: drawnSql, result: drawnRows },
      ],
      resolution: {
        headline: `${money(offered)} available for a ${money(fee)} fee, repaid over about ${paybackWeeks === 1 ? 'a week' : `${paybackWeeks} weeks`} out of ticket sales.`,
        body: `Two things to weigh. The fee is fixed, so repaying faster does not make it cheaper — there is no benefit to rushing it. And ${percent(withhold, 1)} of every payment is real cash flow you will not have while it runs, which matters most if you have supplier terms landing in the same window. If you want it, the next step opens Stripe's own terms page, which is the only place it can be agreed.`,
        bullets: [
          `${money(offered)} advanced · ${money(fee)} fee · ${money(total)} total repayable`,
          `${percent(withhold, 1)} withheld per payment · ~${money(Math.round(dailyRepayment))} a day at your rate`,
          `Lapses ${within(expires)} — ${longDate(expires)}`,
          ...(nextEvent
            ? [
                clearsBeforeEvent
                  ? `Likely clear before ${str(nextEvent, 'event_name')} opens`
                  : `Still repaying when ${str(nextEvent, 'event_name')} opens`,
              ]
            : []),
        ],
      },
      actions: [
        {
          id: 'organizer_capital_open_terms',
          label: 'Open the financing terms',
          surface: 'api',
          callLabel: 'POST /v1/account_sessions',
          method: 'POST',
          path: '/v1/account_sessions',
          plainEnglish: `Opens Stripe's financing terms for the ${money(offered)} offer, embedded in this page. Nothing is borrowed and nothing is agreed by this call — it mints a short-lived session so you can read the terms and decide. Accepting happens inside that component, by you, because the ${money(total)} is your liability.`,
          params: {
            account: accountId,
            components: {
              capital_financing: { enabled: true },
              capital_financing_promotion: { enabled: true },
            },
          },
          totals: [
            { label: 'Offer', value: money(offered) },
            { label: 'Fee', value: money(fee) },
            { label: 'Total repayable', value: money(total) },
            { label: 'Borrowed by this call', value: 'Nothing' },
          ],
          variant: 'primary',
          run: (simCtx, options) =>
            ef.createAccountSession(
              simCtx,
              {
                account: accountId,
                components: {
                  capital_financing: { enabled: true },
                  capital_financing_promotion: { enabled: true },
                },
              },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
      ],
      dashboardOnly: [
        dashboardOnly(
          'capital_offer_acceptance',
          `The ${money(offered)} is accepted by ${organizer.business_profile_name}, in Stripe's own flow. The button above embeds that flow rather than replacing it — there is no endpoint that agrees to ${money(total)} of liability on a business's behalf, which is the correct design even though it makes for a less tidy demo.`,
        ),
      ],
    };
  },
};
