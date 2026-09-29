import { CARDHOLDER_ROLES, EVENT_SPEND_CATEGORIES } from '../../sim/embedded-finance';
import { longDate, percent as pct } from '../../sim/format';
import { ef } from '../../stripe-sim';
import { money, num, plural, sql, str, T } from '../helpers';
import type { ActionSpec, Scenario, ScenarioResult } from '../types';

/**
 * "Give my production lead a card with a monthly limit."
 *
 * The point of this scenario is where the control lives. A spending limit and a
 * category allow-list are set at card creation and enforced by the network at
 * authorisation, which means an off-policy purchase is declined at the till.
 * The alternative — a shared card and an expenses policy in a document — finds
 * out about the same purchase three weeks later, when the argument is about a
 * refund rather than a decline.
 *
 * So the scenario leads with the organizer's own decline history if they have
 * any, because eight declined authorisations are a more convincing argument for
 * spend controls than any description of them.
 */
export const issuingTeamCard: Scenario = {
  id: 'organizer_issuing_team_card',
  scope: 'organizer',
  title: 'Issue a card to my team',
  suggestedPrompt: 'Give my production lead a card with a monthly limit',
  blurb:
    'Issues a virtual card scoped to event-spend categories with a monthly ceiling, enforced at authorisation.',
  triggers: [
    'give my production lead a card with a monthly limit',
    'give my production lead a card',
    'issue a card to my team',
    'issue a card',
    'i need a card for my team',
    'team card',
    'spending limit',
    'company card',
    'card for my production lead',
  ],
  keywords: [
    'card',
    'cards',
    'issue',
    'cardholder',
    'limit',
    'spending',
    'team',
    'production',
    'crew',
    'expenses',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const organizer = ctx.index.accountById.get(accountId)!;

    const cardsSql = sql`
-- Cards already issued on this account, with the controls on each.
SELECT
  c.id AS card_id,
  ch.name AS cardholder,
  ch.role,
  c.last4,
  c.type,
  c.status,
  c.spending_limit_amount,
  c.spending_limit_interval,
  c.allowed_categories,
  c.created
FROM issuing_cards c
JOIN issuing_cardholders ch ON ch.id = c.cardholder_id
WHERE c.account_id = '${accountId}'
ORDER BY c.spending_limit_amount DESC`;

    const spendSql = sql`
-- Spend by category over the last 90 days, approved and declined side by side.
-- The declined rows are the interesting half: that is the control working.
SELECT
  auth.merchant_category,
  auth.approved,
  COUNT(*) AS authorizations,
  SUM(auth.amount) AS amount
FROM issuing_authorizations auth
WHERE auth.account_id = '${accountId}'
  AND auth.created >= ${T.daysAgo(90)}
GROUP BY auth.merchant_category, auth.approved
ORDER BY amount DESC`;

    const declinesSql = sql`
-- Individual declines, most recent first. Named merchants, because "your card
-- declined 8 off-policy purchases" lands differently with the names attached.
SELECT
  auth.merchant_name,
  auth.merchant_category,
  auth.amount,
  auth.decline_reason,
  auth.created,
  ch.name AS cardholder
FROM issuing_authorizations auth
JOIN issuing_cards c ON c.id = auth.card_id
JOIN issuing_cardholders ch ON ch.id = c.cardholder_id
WHERE auth.account_id = '${accountId}'
  AND auth.approved = false
ORDER BY auth.created DESC`;

    const fundingSql = sql`
-- Cards spend out of the stored balance, so the balance is the real ceiling
-- regardless of what any individual card's limit says.
SELECT
  id AS financial_account_id,
  balance_cash,
  balance_outbound_pending
FROM treasury_financial_accounts
WHERE account_id = '${accountId}'
  AND status = 'open'`;

    const [cards, spend, declines, funding] = await Promise.all([
      ctx.sql(cardsSql),
      ctx.sql(spendSql),
      ctx.sql(declinesSql),
      ctx.sql(fundingSql),
    ]);

    const fundingAccount = funding.rows[0];
    const cash = num(fundingAccount, 'balance_cash');
    const committed = num(fundingAccount, 'balance_outbound_pending');
    const spendable = cash - committed;

    const approvedRows = spend.rows.filter((r) => r.approved === true);
    const declinedRows = spend.rows.filter((r) => r.approved === false);
    const approvedAmount = approvedRows.reduce((s, r) => s + num(r, 'amount'), 0);
    const approvedCount = approvedRows.reduce((s, r) => s + num(r, 'authorizations'), 0);
    const declinedAmount = declinedRows.reduce((s, r) => s + num(r, 'amount'), 0);
    const declinedCount = declinedRows.reduce((s, r) => s + num(r, 'authorizations'), 0);
    const attempts = approvedCount + declinedCount;

    const existingLimit = cards.rows.reduce((s, r) => s + num(r, 'spending_limit_amount'), 0);
    const categoryDeclines = declines.rows.filter(
      (r) => str(r, 'decline_reason') === 'card_controls_merchant_category',
    ).length;
    const limitDeclines = declines.rows.filter(
      (r) => str(r, 'decline_reason') === 'card_controls_spending_limit',
    ).length;

    /* ---------------------- no card issuing on the account ---------------- */

    if (!fundingAccount && cards.rows.length === 0) {
      return {
        answer: [
          'Not from here yet. Issued cards spend out of a stored balance, and this account does not have one — so there is no funding source for a card to draw on.',
          `The sequence is: the platform requests the card_issuing capability on your account, Stripe reviews it, a stored balance is opened, and then cards can be created against it. Each step is a real gate rather than a formality, and none of them can be skipped by creating the card first.`,
          `Worth raising with ${organizer.business_profile_name}'s platform contact if team spend is the problem you are trying to solve — the case for it is usually the vendor payments you are currently making by bank transfer.`,
        ],
        queries: [
          { label: 'Cards on this account', sql: cardsSql, result: cards },
          { label: 'Funding account', sql: fundingSql, result: funding },
        ],
        resolution: {
          headline: 'No card issuing on this account.',
          body: 'Cards need a stored balance to draw on, and the capability has to be granted by Stripe before either exists. Both are platform-side steps.',
          bullets: [
            'card_issuing capability: not requested',
            'Stored balance: none open',
            'Cards: none',
          ],
        },
        actions: [],
      };
    }

    /* ----------------------------- can issue ------------------------------ */

    const takenRoles = new Set(cards.rows.map((r) => str(r, 'role')));
    const role =
      CARDHOLDER_ROLES.find((candidate) => !takenRoles.has(candidate)) ?? 'Production lead';

    // A new card's ceiling should not exceed what the balance can actually fund,
    // no matter what number someone asks for.
    const requestedLimit = 2_500_000;
    const limit = Math.min(requestedLimit, Math.max(100_000, spendable));
    const cappedByBalance = limit < requestedLimit;

    const slug = organizer.business_profile_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '');
    const name = 'Dana Whitfield';
    const email = `dana.whitfield@${slug}.example`;
    const categories = EVENT_SPEND_CATEGORIES.slice(0, 5);

    const answer = [
      cards.rows.length > 0
        ? `You have ${plural(cards.rows.length, 'card')} out already — ${money(existingLimit)} of combined monthly ceiling across ${cards.rows.map((r) => str(r, 'cardholder')).join(', ')}. Adding one more for a ${role.toLowerCase()} is a two-step call: create the cardholder, then create the card with its controls.`
        : `Nothing issued yet. Getting a card to a ${role.toLowerCase()} is two calls — create the cardholder, then create the card with its spending controls attached.`,
      declinedCount > 0
        ? `Before the new card, the case for setting the controls carefully. Over the last 90 days your cards approved ${plural(approvedCount, 'authorization')} worth ${money(approvedAmount)} and declined ${declinedCount} worth ${money(declinedAmount)} — ${pct(declinedCount / attempts, 1)} of attempts — every one refused by the card itself rather than by anyone reviewing it. ${categoryDeclines > 0 && limitDeclines > 0 ? `${categoryDeclines} were outside the allowed categories and ${limitDeclines} would have crossed a monthly ceiling, which are different problems: the first is policy, the second is budget.` : categoryDeclines > 0 ? `All of them were outside the allowed merchant categories.` : `All of them would have crossed a monthly ceiling — the categories were fine, the budget was not.`} ${declines.rows[0] ? `The most recent was ${money(num(declines.rows[0], 'amount'))} at ${str(declines.rows[0], 'merchant_name')} on ${longDate(num(declines.rows[0], 'created'))}, ${str(declines.rows[0], 'cardholder')}'s card.` : ''}`
        : `Your cards have approved ${plural(approvedCount, 'authorization')} worth ${money(approvedAmount)} and declined nothing, which either means the allow-lists are set generously or nobody has tried to spend outside them yet.`,
      `The limit and the category list are set on the card at creation and enforced by the network when the card is presented. That is the difference worth understanding: an off-policy purchase is declined at the till, not discovered at month end when the only remaining option is asking for the money back.`,
      cappedByBalance
        ? `One constraint. The card would draw on your stored balance, and you have ${money(spendable)} spendable — so a ${money(requestedLimit)} monthly ceiling would be a number the balance cannot actually honour. I have set it to ${money(limit)} to match. A limit larger than the funding behind it just moves the decline from the card to the balance.`
        : `Funding is not a constraint here: ${money(spendable)} is spendable against a ${money(limit)} monthly ceiling.`,
    ];

    const actions: ActionSpec[] = [
      {
        id: 'organizer_create_cardholder',
        label: `Create cardholder for ${name}`,
        surface: 'api',
        callLabel: 'POST /v1/issuing/cardholders',
        method: 'POST',
        path: '/v1/issuing/cardholders',
        stripeAccount: accountId,
        plainEnglish: `Creates ${name} as a cardholder on ${organizer.business_profile_name}. This is the identity a card gets attached to — it holds no money, has no card number, and can spend nothing on its own. Cards come next.`,
        params: {
          name,
          email,
          type: 'individual',
          billing: {
            address: {
              line1: '1 Production Way',
              city: 'Portland',
              state: 'OR',
              postal_code: '97209',
              country: 'US',
            },
          },
          metadata: { role },
        },
        totals: [
          { label: 'Cardholder', value: name },
          { label: 'Role', value: role },
          { label: 'Spending power', value: 'None until a card is issued' },
        ],
        variant: 'primary',
        run: (simCtx, options) =>
          ef.createCardholder(
            simCtx,
            accountId,
            {
              name,
              email,
              type: 'individual',
              billing: {
                address: {
                  line1: '1 Production Way',
                  city: 'Portland',
                  state: 'OR',
                  postal_code: '97209',
                  country: 'US',
                },
              },
              metadata: { role },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
    ];

    // A card needs a cardholder id that already exists, so the second call only
    // appears once the first has run. `created === T.now` is what marks one as
    // having been made in this demo session — offering the card step against a
    // cardholder who was seeded months ago would issue a card to the wrong
    // person and read as a bug even though the call would succeed.
    const newCardholder = ctx.data.issuing_cardholders
      .filter((c) => c.account_id === accountId && c.created === T.now)
      .sort((a, b) => b.created - a.created)[0];

    if (newCardholder) {
      const latestCardholder = newCardholder;
      actions.push({
        id: 'organizer_create_card',
        label: `Issue a card to ${latestCardholder.name}`,
        surface: 'api',
        callLabel: 'POST /v1/issuing/cards',
        method: 'POST',
        path: '/v1/issuing/cards',
        stripeAccount: accountId,
        plainEnglish: `Issues a virtual card to ${latestCardholder.name} with a ${money(limit)} monthly ceiling, usable only at ${categories.length} merchant categories: ${categories.map((c) => c.replace(/_/g, ' ')).join(', ')}. Anything outside that list is declined by the network at authorisation. The card is usable immediately.`,
        params: {
          cardholder: latestCardholder.id,
          currency: 'usd',
          type: 'virtual',
          spending_controls: {
            spending_limits: [{ amount: limit, interval: 'monthly' }],
            allowed_categories: categories,
          },
          metadata: { role: latestCardholder.role },
        },
        totals: [
          { label: 'Cardholder', value: latestCardholder.name },
          { label: 'Monthly limit', value: money(limit) },
          { label: 'Allowed categories', value: String(categories.length) },
          {
            label: 'Funded by balance',
            value: money(spendable),
            tone: cappedByBalance ? 'warn' : 'neutral',
          },
        ],
        variant: 'primary',
        run: (simCtx, options) =>
          ef.createIssuingCard(
            simCtx,
            accountId,
            {
              cardholder: latestCardholder.id,
              currency: 'usd',
              type: 'virtual',
              spending_controls: {
                spending_limits: [{ amount: limit, interval: 'monthly' }],
                allowed_categories: categories,
              },
              metadata: { role: latestCardholder.role },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      });
    }

    return {
      answer,
      queries: [
        { label: 'Cards already issued', sql: cardsSql, result: cards },
        { label: 'Spend by category, approved and declined', sql: spendSql, result: spend },
        { label: 'Every decline, with the merchant', sql: declinesSql, result: declines },
        { label: 'What funds the cards', sql: fundingSql, result: funding },
      ],
      table:
        declines.rows.length > 0
          ? {
              caption: 'Purchases the spending controls declined',
              columns: [
                { key: 'merchant_name', label: 'Merchant' },
                { key: 'merchant_category', label: 'Category' },
                { key: 'amount', label: 'Amount', align: 'right', kind: 'money' },
                { key: 'cardholder', label: 'Cardholder' },
                { key: 'created', label: 'When', kind: 'date' },
              ],
              rows: declines.rows,
            }
          : undefined,
      resolution: {
        headline: `A ${money(limit)}-a-month card scoped to ${categories.length} categories, in two calls.`,
        body: `Create the cardholder first — it can spend nothing on its own — then the card with its controls. ${newCardholder ? `${newCardholder.name} exists now, so the card call is ready.` : 'The card call appears once the cardholder exists, because it needs the cardholder id.'} Set the category list tighter than feels necessary: widening it later is one call, and every category you leave off is a decline you never have to have a conversation about.${cappedByBalance ? ` The ceiling is capped at ${money(limit)} by what the stored balance can fund, not by policy.` : ''}`,
        bullets: [
          `${money(limit)} monthly ceiling · ${categories.length} allowed categories · virtual card`,
          `Funded from ${money(spendable)} spendable in the stored balance`,
          ...(declinedCount > 0
            ? [`${declinedCount} purchases already declined by existing controls · ${money(declinedAmount)}`]
            : []),
          ...(cards.rows.length > 0
            ? [`${plural(cards.rows.length, 'card')} already out · ${money(existingLimit)} combined ceiling`]
            : []),
        ],
      },
      actions,
    };
  },
};
