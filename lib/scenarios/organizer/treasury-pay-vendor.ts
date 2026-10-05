import { longDate } from '../../sim/format';
import { dashboardOnly, ef } from '../../stripe-sim';
import { money, num, plural, sql, str, T } from '../helpers';
import type { ActionSpec, Scenario, ScenarioResult } from '../types';

/**
 * "Pay my staging vendor out of my balance."
 *
 * The organizer-facing half of the float story. An organizer with a stored
 * balance can send money to a supplier directly; without one, the only route is
 * a payout to their own bank and then a transfer out of it, which adds days and
 * a reconciliation step for no reason.
 *
 * The number this scenario is careful about is what is actually spendable.
 * Cash minus payments already in flight — not cash. Treating a committed payment
 * as available is how an organizer double-spends a deposit, and the failure shows
 * up as a returned payment to a supplier they need next week.
 */
export const treasuryPayVendor: Scenario = {
  id: 'organizer_treasury_pay_vendor',
  scope: 'organizer',
  title: 'Pay a vendor out of my balance',
  suggestedPrompt: 'Can I pay my staging vendor out of my balance?',
  blurb:
    'Works out what is actually spendable after payments in flight, then sends it straight to the supplier.',
  triggers: [
    'can i pay my staging vendor out of my balance',
    'pay my staging vendor',
    'pay a vendor out of my balance',
    'pay my vendor',
    'pay a supplier',
    'what is in my wallet',
    'my stored balance',
    'can i pay a vendor',
  ],
  keywords: [
    'vendor',
    'supplier',
    'pay',
    'wallet',
    'stored',
    'staging',
    'rigging',
    'deposit',
    'invoice',
    'spendable',
  ],

  async run(ctx): Promise<ScenarioResult> {
    const accountId = ctx.accountId!;
    const organizer = ctx.index.accountById.get(accountId)!;

    const accountSql = sql`
-- The stored balance, if this organizer has one.
SELECT
  id AS financial_account_id,
  status,
  balance_cash,
  balance_inbound_pending,
  balance_outbound_pending,
  active_features,
  created
FROM treasury_financial_accounts
WHERE account_id = '${accountId}'
  AND status = 'open'`;

    const historySql = sql`
-- Who has been paid out of it, and what is still moving.
SELECT
  id AS payment_id,
  payee_name,
  description,
  amount,
  status,
  created,
  expected_arrival_date
FROM treasury_outbound_payments
WHERE account_id = '${accountId}'
ORDER BY created DESC`;

    const suppliersSql = sql`
-- Recurring suppliers, largest first. A name that appears more than once is a
-- standing relationship rather than a one-off, which is the useful thing to
-- surface when someone says "my staging vendor" without naming them.
SELECT
  payee_name AS vendor,
  COUNT(*) AS payments,
  SUM(amount) AS total_amount,
  ROUND(AVG(amount)) AS avg_payment,
  MAX(created) AS last_paid
FROM treasury_outbound_payments
WHERE account_id = '${accountId}'
GROUP BY payee_name
ORDER BY total_amount DESC`;

    const [accountRows, history, suppliers] = await Promise.all([
      ctx.sql(accountSql),
      ctx.sql(historySql),
      ctx.sql(suppliersSql),
    ]);

    const financialAccount = accountRows.rows[0];

    /* ------------------------- no stored balance -------------------------- */

    if (!financialAccount) {
      const balance = ctx.index.balanceById.get(accountId);
      const available = balance?.available ?? 0;
      const pending = balance?.pending ?? 0;

      return {
        answer: [
          `Not today — you do not have a stored balance on this account, so there is nothing to pay a vendor out of directly.`,
          `What you do have is ${money(available)} settled and ${money(pending)} still inside the settlement window. That money reaches you as a payout to your bank on your ${organizer.payout_schedule_interval} schedule, and paying a supplier from there is a bank transfer you make yourself — which works, it just means the money takes the long way round and lands in two places in your books instead of one.`,
          `A stored balance would let it go straight out. Opening one is a platform-side change and needs the Treasury capability active first, which Stripe grants after review rather than through an API call — so this is a conversation to have with ${organizer.business_profile_name}'s platform contact, not something that can be switched on from this page.`,
        ],
        queries: [
          { label: 'Stored balance', sql: accountSql, result: accountRows },
          { label: 'Payments out of it', sql: historySql, result: history },
        ],
        resolution: {
          headline: 'No stored balance on this account yet.',
          body: `Your ${money(available)} reaches you by payout, then you pay suppliers from your bank. A stored balance removes that hop, but it has to be enabled rather than requested from here.`,
          bullets: [
            `${money(available)} settled · ${money(pending)} still settling`,
            `Payout schedule: ${organizer.payout_schedule_interval}`,
            'Treasury needs Stripe review before an account can be opened',
          ],
        },
        actions: [],
        dashboardOnly: [
          dashboardOnly(
            'treasury_enablement',
            'A stored balance for this organizer depends on the Treasury capability being active on the platform, which Stripe underwrites with its bank partners. Nothing in the API requests it.',
          ),
        ],
      };
    }

    /* ---------------------------- has a balance --------------------------- */

    const faId = str(financialAccount, 'financial_account_id');
    const cash = num(financialAccount, 'balance_cash');
    const inbound = num(financialAccount, 'balance_inbound_pending');
    const outboundPending = num(financialAccount, 'balance_outbound_pending');
    const spendable = cash - outboundPending;

    const inFlight = history.rows.filter((r) => str(r, 'status') === 'processing');
    const posted = history.rows.filter((r) => str(r, 'status') === 'posted');
    const postedTotal = posted.reduce((s, r) => s + num(r, 'amount'), 0);

    // "My staging vendor" is whoever they pay most. Guessing from history beats
    // asking them to remember an exact legal entity name.
    const topSupplier = suppliers.rows[0];
    const supplierName = topSupplier ? str(topSupplier, 'vendor') : null;
    const typicalPayment = topSupplier ? num(topSupplier, 'avg_payment') : 0;
    // Round to something a person would actually type, and never propose more
    // than is spendable.
    const proposed = Math.min(
      spendable,
      Math.max(100_000, Math.round(typicalPayment / 10_000) * 10_000),
    );

    const supplierPayments = topSupplier ? num(topSupplier, 'payments') : 0;

    const answer = [
      outboundPending > 0
        ? `Yes. You have ${money(cash)} in your balance, but ${money(spendable)} is what you can actually commit — ${money(outboundPending)} is already promised to ${inFlight.length === 1 ? 'a payment' : `${inFlight.length} payments`} still in flight.${inbound > 0 ? ` A further ${money(inbound)} is on its way in and is not spendable yet.` : ''}`
        : `Yes. You have ${money(cash)} in your balance and nothing committed to a payment in flight, so all of it is spendable.${inbound > 0 ? ` A further ${money(inbound)} is on its way in and is not spendable until it settles.` : ''}`,
      supplierName
        ? `Your largest supplier is ${supplierName}: ${supplierPayments === 1 ? 'one payment' : `${supplierPayments} payments`} totalling ${money(num(topSupplier, 'total_amount'))}${supplierPayments > 1 ? `, averaging ${money(typicalPayment)}` : ''}, last paid ${longDate(num(topSupplier, 'last_paid'))}. I have pre-filled ${money(proposed)} against them below, which you can change before approving.`
        : 'You have not paid anyone out of this balance yet, so there is no supplier history to work from — the first payment needs the payee details entered by hand.',
      posted.length > 0
        ? `For context on how this normally runs: ${posted.length === 1 ? 'one payment' : `${posted.length} payments`} totalling ${money(postedTotal)} ${posted.length === 1 ? 'has' : 'have'} settled out of this balance. They arrive in one to two business days and go straight to the supplier — no payout to your own bank in between, which is the point.`
        : 'Nothing has settled out of this balance yet.',
      outboundPending > 0
        ? `The distinction worth holding on to: ${money(cash)} is what you have, ${money(spendable)} is what you can spend. Committing against the first number is how a deposit gets promised twice, and the failure lands as a returned payment to a supplier rather than as an error on your screen.`
        : `One thing to watch as this gets busier: the number to commit against is cash minus whatever is already in flight, not cash. Today those are the same because nothing is moving, but during an event build-out they diverge fast — and promising the same money twice fails as a returned payment to a supplier rather than as an error on your screen.`,
    ];

    const actions: ActionSpec[] = [];

    if (supplierName && proposed > 0) {
      actions.push({
        id: 'organizer_pay_vendor',
        label: `Pay ${supplierName}`,
        surface: 'api',
        callLabel: 'POST /v1/treasury/outbound_payments',
        method: 'POST',
        path: '/v1/treasury/outbound_payments',
        stripeAccount: accountId,
        plainEnglish: `Sends ${money(proposed)} from your stored balance to ${supplierName} by ACH, arriving in one to two business days. It comes out of the ${money(spendable)} you have spendable, leaving ${money(spendable - proposed)}. This money leaves your control once it posts.`,
        params: {
          financial_account: faId,
          amount: proposed,
          currency: 'usd',
          description: 'Event production — staging and rigging',
          destination_payment_method_data: {
            type: 'us_bank_account',
            billing_details: { name: supplierName },
          },
        },
        totals: [
          { label: 'To', value: supplierName },
          { label: 'Amount', value: money(proposed) },
          { label: 'Spendable now', value: money(spendable) },
          { label: 'Spendable after', value: money(spendable - proposed) },
          { label: 'Arrives', value: '1–2 business days' },
        ],
        // Money leaving to a third party is the one direction that cannot be
        // undone with a click, so it gets the same second gate as an account
        // debit does.
        requiresSecondAck: true,
        secondAckLabel: `I understand ${money(proposed)} will leave this balance and go to a third party`,
        variant: 'primary',
        run: (simCtx, options) =>
          ef.createOutboundPayment(
            simCtx,
            accountId,
            {
              financial_account: faId,
              amount: proposed,
              currency: 'usd',
              description: 'Event production — staging and rigging',
              destination_payment_method_data: {
                type: 'us_bank_account',
                billing_details: { name: supplierName },
              },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      });
    }

    return {
      answer,
      queries: [
        { label: 'Your stored balance', sql: accountSql, result: accountRows },
        { label: 'Suppliers you pay', sql: suppliersSql, result: suppliers },
        { label: 'Payment history', sql: historySql, result: history },
      ],
      table:
        suppliers.rows.length > 0
          ? {
              caption: 'Suppliers paid from this balance',
              columns: [
                { key: 'vendor', label: 'Supplier' },
                { key: 'payments', label: 'Payments', align: 'right', kind: 'number' },
                { key: 'total_amount', label: 'Total', align: 'right', kind: 'money' },
                { key: 'avg_payment', label: 'Average', align: 'right', kind: 'money' },
                { key: 'last_paid', label: 'Last paid', kind: 'date' },
              ],
              rows: suppliers.rows,
            }
          : undefined,
      resolution: {
        headline:
          outboundPending > 0
            ? `${money(spendable)} spendable out of ${money(cash)} held.`
            : `${money(spendable)} spendable, all of it.`,
        body: supplierName
          ? `${outboundPending > 0 ? `${money(outboundPending)} is already committed to payments in flight, so the spendable figure is the one to work from. ` : ''}Sending ${money(proposed)} to ${supplierName} leaves ${money(spendable - proposed)}. It arrives in one to two business days and cannot be pulled back once it posts, which is why this needs a second confirmation.`
          : `${money(spendable)} is available to send. The first payment out of a balance needs the payee's bank details, which is not something to guess at.`,
        bullets: [
          `${money(cash)} cash · ${money(outboundPending)} committed · ${money(spendable)} spendable`,
          ...(inbound > 0 ? [`${money(inbound)} inbound and not yet spendable`] : []),
          ...(inFlight.length > 0
            ? [`${plural(inFlight.length, 'payment')} in flight, arriving ${longDate(num(inFlight[0], 'expected_arrival_date'))}`]
            : []),
        ],
      },
      actions,
    };
  },
};
