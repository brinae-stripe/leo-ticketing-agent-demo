import { percent as pct } from '../../sim/format';
import { ef } from '../../stripe-sim';
import { money, num, plural, sql, str, T } from '../helpers';
import type { ActionSpec, Scenario, ScenarioResult } from '../types';

/**
 * "Which organizers are paying vendors by bank transfer instead of card?"
 *
 * The premise: an event organizer's costs are almost entirely pre-event and
 * almost entirely to a short list of suppliers — staging, audio, security,
 * catering, freight, print. Today that money leaves as a bank transfer, which
 * means it is uncontrolled at the point of spend and only visible afterwards.
 *
 * On a card it is controlled at authorisation: a limit and a category allow-list
 * are enforced by the network, so an off-policy purchase is declined rather than
 * discovered in a reconciliation three weeks later. The platform earns
 * interchange on the spend that does go through.
 *
 * Deliberately not modelled: what that interchange is worth. Revenue share on
 * Issuing is a commercial term, not a published rate, and inventing a number
 * here would be the one genuinely misleading thing in this demo. The spend base
 * is the honest version of the same argument.
 */
export const issuingVendorSpend: Scenario = {
  id: 'issuing_vendor_spend',
  scope: 'internal',
  title: 'Which organizers are paying vendors by bank transfer?',
  suggestedPrompt: 'Which organizers are paying vendors by bank transfer instead of card?',
  blurb:
    'Sizes vendor spend leaving as ACH, and where spend controls on a card would have caught it first.',
  triggers: [
    'which organizers are paying vendors by bank transfer instead of card',
    'which organizers are paying vendors by bank transfer',
    'who is paying vendors by ach',
    'vendor spend',
    'issuing',
    'should we issue cards',
    'spend controls',
    'card issuing',
    'interchange',
  ],
  keywords: [
    'issuing',
    'card',
    'cards',
    'vendor',
    'vendors',
    'spend',
    'interchange',
    'controls',
    'limit',
    'ach',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const achSql = sql`
-- Vendor money leaving as a bank transfer over the last 90 days.
-- Grouped by organizer, since the decision to issue cards is made per organizer.
SELECT
  op.account_id,
  a.business_profile_name AS organizer,
  COUNT(*) AS payments,
  SUM(op.amount) AS total_amount,
  ROUND(AVG(op.amount)) AS avg_payment,
  COUNT(DISTINCT op.payee_name) AS distinct_vendors
FROM treasury_outbound_payments op
JOIN accounts a ON a.id = op.account_id
WHERE op.created >= ${T.daysAgo(90)}
GROUP BY op.account_id, a.business_profile_name
ORDER BY total_amount DESC`;

    const payeeSql = sql`
-- The same money by supplier. A short, repeating list is what makes this worth
-- putting on a card: these are not one-off purchases, they are a standing
-- relationship that recurs every event.
SELECT
  op.payee_name AS vendor,
  COUNT(*) AS payments,
  SUM(op.amount) AS total_amount,
  COUNT(DISTINCT op.account_id) AS organizers
FROM treasury_outbound_payments op
WHERE op.created >= ${T.daysAgo(90)}
GROUP BY op.payee_name
ORDER BY total_amount DESC`;

    const cardsSql = sql`
-- Who already has cards, and how tightly they are scoped.
SELECT
  c.account_id,
  a.business_profile_name AS organizer,
  COUNT(*) AS cards,
  SUM(c.spending_limit_amount) AS combined_monthly_limit,
  ROUND(AVG(c.allowed_categories_count)) AS avg_allowed_categories
FROM issuing_cards c
JOIN accounts a ON a.id = c.account_id
WHERE c.status = 'active'
GROUP BY c.account_id, a.business_profile_name
ORDER BY combined_monthly_limit DESC`;

    const declineSql = sql`
-- The payoff. Spend the card's own controls refused, by category.
-- Every row here is money that would have left the building on a bank transfer
-- and been argued about later.
SELECT
  auth.merchant_category,
  COUNT(*) AS declined,
  SUM(auth.amount) AS amount,
  auth.decline_reason
FROM issuing_authorizations auth
WHERE auth.approved = false
GROUP BY auth.merchant_category, auth.decline_reason
ORDER BY amount DESC`;

    const approvedSql = sql`
-- For scale: what the cards did approve, by category.
SELECT
  auth.merchant_category,
  COUNT(*) AS authorizations,
  SUM(auth.amount) AS amount
FROM issuing_authorizations auth
WHERE auth.approved = true
GROUP BY auth.merchant_category
ORDER BY amount DESC`;

    const [ach, payees, cards, declines, approved] = await Promise.all([
      ctx.sql(achSql),
      ctx.sql(payeeSql),
      ctx.sql(cardsSql),
      ctx.sql(declineSql),
      ctx.sql(approvedSql),
    ]);

    const achTotal = ach.rows.reduce((s, r) => s + num(r, 'total_amount'), 0);
    const achPayments = ach.rows.reduce((s, r) => s + num(r, 'payments'), 0);

    const cardAccounts = new Set(cards.rows.map((r) => str(r, 'account_id')));
    const withoutCards = ach.rows.filter((r) => !cardAccounts.has(str(r, 'account_id')));
    const withoutCardsTotal = withoutCards.reduce((s, r) => s + num(r, 'total_amount'), 0);

    const declinedCount = declines.rows.reduce((s, r) => s + num(r, 'declined'), 0);
    const declinedAmount = declines.rows.reduce((s, r) => s + num(r, 'amount'), 0);
    // The two controls do different jobs and the split is the interesting part:
    // a category decline is policy, a ceiling decline is budget.
    const categoryRows = declines.rows.filter(
      (r) => str(r, 'decline_reason') === 'card_controls_merchant_category',
    );
    const limitRows = declines.rows.filter(
      (r) => str(r, 'decline_reason') === 'card_controls_spending_limit',
    );
    const categoryCount = categoryRows.reduce((s, r) => s + num(r, 'declined'), 0);
    const categoryAmount = categoryRows.reduce((s, r) => s + num(r, 'amount'), 0);
    const limitCount = limitRows.reduce((s, r) => s + num(r, 'declined'), 0);
    const limitAmount = limitRows.reduce((s, r) => s + num(r, 'amount'), 0);
    const approvedCount = approved.rows.reduce((s, r) => s + num(r, 'authorizations'), 0);
    const approvedAmount = approved.rows.reduce((s, r) => s + num(r, 'amount'), 0);
    // Typical allow-list width on the cards that exist, for the recommendation.
    const avgCategories = cards.rows.length
      ? Math.round(
          cards.rows.reduce((s, r) => s + num(r, 'avg_allowed_categories'), 0) / cards.rows.length,
        )
      : 0;
    const declineRate =
      approvedCount + declinedCount > 0 ? declinedCount / (approvedCount + declinedCount) : 0;

    const topVendor = payees.rows[0];
    const topDecline = declines.rows[0];

    const answer = [
      `${money(achTotal)} left as bank transfers over the last 90 days — ${plural(achPayments, 'payment')} across ${plural(ach.rows.length, 'organizer')}. ${topVendor ? `It is concentrated: ${str(topVendor, 'vendor')} alone took ${money(num(topVendor, 'total_amount'))} over ${plural(num(topVendor, 'payments'), 'payment')} from ${plural(num(topVendor, 'organizers'), 'organizer')}.` : ''} Event costs are like this by nature — a short list of suppliers, every event, every year.`,
      `${withoutCards.length} of those organizers ${withoutCards.length === 1 ? 'has' : 'have'} no cards at all, covering ${money(withoutCardsTotal)} of that spend. For them every purchase is uncontrolled at the moment it happens and only visible once it has cleared.`,
      declinedCount > 0
        ? `The ${cards.rows.length} organizers that do have cards show what changes. ${plural(declinedCount, 'authorization')} worth ${money(declinedAmount)} were refused by the cards' own spending controls — ${pct(declineRate, 1)} of all attempts — against ${money(approvedAmount)} approved. Two different controls did that work: ${categoryCount > 0 ? `${plural(categoryCount, 'purchase')} worth ${money(categoryAmount)} fell outside the allowed merchant categories` : 'nothing fell outside the allowed categories'}, and ${limitCount > 0 ? `${plural(limitCount, 'purchase')} worth ${money(limitAmount)} would have taken a cardholder past their monthly ceiling` : 'nothing hit a monthly ceiling'}. ${topDecline ? `The largest single category refused was ${str(topDecline, 'merchant_category').replace(/_/g, ' ')}, ${money(num(topDecline, 'amount'))}.` : ''} None of it needed a policy conversation — the network declined it at authorisation.`
        : 'No card spend to read yet, so there is no control behaviour to compare.',
      `What this does not tell you is what the interchange is worth. Revenue share on issued cards is a commercial term rather than a published rate, so the honest figure to take into that conversation is the spend base — ${money(achTotal)} a quarter, ${money(achTotal * 4)} annualised — not a revenue estimate this query is in no position to make.`,
    ];

    /* ------------------------------- actions ------------------------------ */

    const actions: ActionSpec[] = [];

    if (withoutCards.length > 0) {
      const targets = withoutCards.slice(0, 5);
      actions.push({
        id: 'issuing_request_capability',
        label: `Request card issuing for ${targets.length} organizers`,
        surface: 'api',
        callLabel: 'POST /v1/accounts/:id',
        method: 'POST',
        path: '/v1/accounts/:id',
        plainEnglish: `Requests the card_issuing capability on ${targets.length} connected accounts. The capability comes back pending, not active — Stripe reviews each one, and creating a card before the review clears will fail. This is the first of two steps, and it moves no money.`,
        params: {
          note: `${targets.length} separate calls, one per connected account`,
          accounts: targets.map((r) => ({
            id: str(r, 'account_id'),
            organizer: str(r, 'organizer'),
            quarterly_vendor_spend: num(r, 'total_amount'),
          })),
          capabilities: { card_issuing: { requested: true } },
        },
        totals: [
          { label: 'Accounts', value: String(targets.length) },
          {
            label: 'Vendor spend behind them',
            value: money(targets.reduce((s, r) => s + num(r, 'total_amount'), 0)),
          },
          { label: 'Result', value: 'capability pending Stripe review', tone: 'warn' },
          { label: 'Money moved', value: 'None' },
        ],
        batch: { size: 1, total: targets.length, unitLabel: 'account' },
        variant: 'primary',
        run: async (simCtx, options) => {
          const results = [];
          for (const [i, row] of targets.entries()) {
            results.push(
              await ef.requestCardIssuingCapability(simCtx, str(row, 'account_id'), {
                idempotencyKey: `${options.idempotencyKey}-${i}`,
              }),
            );
            options.onProgress?.({
              done: i + 1,
              total: targets.length,
              label: 'Requesting card_issuing',
            });
          }
          return results;
        },
      });
    }

    return {
      answer,
      queries: [
        { label: 'Vendor spend leaving as ACH', sql: achSql, result: ach },
        { label: 'The same spend by supplier', sql: payeeSql, result: payees },
        { label: 'Cards already issued', sql: cardsSql, result: cards },
        { label: 'Spend the controls refused', sql: declineSql, result: declines },
        { label: 'Spend the controls allowed', sql: approvedSql, result: approved },
      ],
      table: {
        caption: 'Vendor spend by organizer, last 90 days',
        columns: [
          { key: 'organizer', label: 'Organizer' },
          { key: 'payments', label: 'Payments', align: 'right', kind: 'number' },
          { key: 'total_amount', label: 'Total', align: 'right', kind: 'money' },
          { key: 'avg_payment', label: 'Average', align: 'right', kind: 'money' },
          { key: 'distinct_vendors', label: 'Vendors', align: 'right', kind: 'number' },
        ],
        rows: ach.rows,
      },
      resolution: {
        headline: `${money(achTotal)} of vendor spend a quarter is leaving uncontrolled, ${money(withoutCardsTotal)} of it from organizers with no cards.`,
        body: `Requesting the capability is the cheap first step and commits nothing — it comes back pending and Stripe reviews it. The argument to make to organizers is not interchange, which is yours rather than theirs; it is that a card scoped to ${avgCategories > 0 ? `${avgCategories} merchant categories` : 'a handful of merchant categories'} declines the off-policy purchase at the till instead of surfacing it at month end. ${declinedCount > 0 ? `The ${cards.rows.length} organizers already on cards had ${money(declinedAmount)} refused that way, without anyone having to police it.` : ''}`,
        bullets: [
          `${money(achTotal)} over ${plural(achPayments, 'bank transfer')} in 90 days · ${money(achTotal * 4)} annualised`,
          `${plural(withoutCards.length, 'organizer')} with vendor spend and no cards · ${money(withoutCardsTotal)}`,
          ...(declinedCount > 0
            ? [`${pct(declineRate, 1)} of card attempts declined by spend controls · ${money(declinedAmount)}`]
            : []),
          'Interchange revenue share is a commercial term and is deliberately not estimated here',
        ],
      },
      actions,
      items: withoutCards.slice(0, 5).map((row) => {
        const accountId = str(row, 'account_id');
        const organizer = str(row, 'organizer');
        const total = num(row, 'total_amount');

        return {
          id: accountId,
          title: organizer,
          subtitle: `${money(total)} to ${plural(num(row, 'distinct_vendors'), 'vendor')} over ${plural(num(row, 'payments'), 'bank transfer')} in 90 days`,
          href: `/organizers/${accountId}`,
          facts: [
            { label: 'Average payment', value: money(num(row, 'avg_payment')) },
            { label: 'Annualised', value: money(total * 4) },
            { label: 'Cards today', value: 'none', tone: 'warn' },
          ],
          recommendation: `Request the capability, then issue one card to whoever signs off the ${plural(num(row, 'distinct_vendors'), 'vendor')} — scoped to those categories and a monthly ceiling.`,
          actions: [
            {
              id: `issuing_capability_${accountId}`,
              label: 'Request card issuing',
              surface: 'api',
              callLabel: 'POST /v1/accounts/:id',
              method: 'POST',
              path: `/v1/accounts/${accountId}`,
              stripeAccount: null,
              plainEnglish: `Asks Stripe to review ${organizer} for card issuing. Comes back pending; cards cannot be created until it is active. No money moves.`,
              params: { capabilities: { card_issuing: { requested: true } } },
              totals: [
                { label: 'Organizer', value: organizer },
                { label: 'Quarterly vendor spend', value: money(total) },
                { label: 'Result', value: 'pending review' },
              ],
              variant: 'primary',
              run: (simCtx, options) =>
                ef.requestCardIssuingCapability(simCtx, accountId, {
                  idempotencyKey: options.idempotencyKey,
                }),
            },
          ],
        };
      }),
    };
  },
};
