import { api, mcp } from '../../stripe-sim';
import { dashboardOnly } from '../../stripe-sim/dashboard-only';
import { shortDate } from '../../sim/format';
import { money, num, percent, plural, sql, str } from '../helpers';
import type { Scenario, ScenarioItem, ScenarioResult } from '../types';

const BLOCKLIST = 'rsl_marquee_blocked_fingerprints';
const ALLOWLIST = 'rsl_marquee_box_office_allowlist';

/**
 * "What's in the review queue?"
 *
 * A review is a charge Radar let through but flagged for a human. The decision
 * is approve or refund-and-block, and the thing that actually settles it is the
 * card's history: a fingerprint with a long clean record across several organizers is
 * a real buyer, and one that appeared for the first time an hour ago is not.
 */
export const reviewQueue: Scenario = {
  id: 'review_queue',
  scope: 'internal',
  title: 'Radar review queue',
  suggestedPrompt: "What's in the review queue?",
  blurb:
    'Works the open Radar reviews using each card’s history across the platform, and flags the rule change that would stop the false positives.',
  triggers: [
    "what's in the review queue",
    'what is in the review queue',
    'review queue',
    'open reviews',
    'radar reviews',
    'manual review',
  ],
  keywords: ['review', 'reviews', 'queue', 'radar', 'flagged', 'manual'],

  async run(ctx): Promise<ScenarioResult> {
    const openSql = sql`
-- Everything Radar is holding for a human decision.
SELECT
  r.id AS review_id,
  r.reason,
  r.opened_reason,
  r.created,
  c.id AS charge_id,
  c.amount,
  c.customer_id,
  c.card_fingerprint,
  c.card_brand,
  c.card_country,
  c.card_funding,
  c.outcome_risk_score,
  c.outcome_risk_level,
  c.payment_method_details_type,
  c.transfer_id,
  a.id AS account_id,
  a.business_profile_name AS organizer,
  e.name AS event_name
FROM reviews r
JOIN charges c ON c.id = r.charge_id
JOIN accounts a ON a.id = c.account_id
JOIN events e ON e.id = c.metadata_event_id
WHERE r.open = true
ORDER BY r.created ASC`;

    const open = await ctx.sql(openSql);
    const rows = open.rows;
    const fingerprints = Array.from(new Set(rows.map((row) => str(row, 'card_fingerprint'))));
    const inList = fingerprints.map((f) => `'${f}'`).join(', ') || "''";

    const historySql = sql`
-- History for each flagged card, across every organizer on the platform. This is the
-- signal that decides it: a card with a clean multi-organizer record is a real buyer.
SELECT
  c.card_fingerprint,
  COUNT(*) AS total_charges,
  SUM(CASE WHEN c.paid = true THEN 1 ELSE 0 END) AS successful_charges,
  COUNT(DISTINCT c.account_id) AS organizers_purchased_from,
  SUM(CASE WHEN c.disputed = true THEN 1 ELSE 0 END) AS disputed_charges,
  SUM(CASE WHEN c.refunded = true THEN 1 ELSE 0 END) AS refunded_charges,
  SUM(c.amount) AS lifetime_amount,
  MIN(c.created) AS first_seen,
  MAX(c.created) AS last_seen
FROM charges c
WHERE c.card_fingerprint IN (${inList})
GROUP BY c.card_fingerprint
ORDER BY total_charges DESC`;

    const boxOfficeSql = sql`
-- Cards used at a box office more than once. These are physically-present sales
-- with a person and a terminal, and they are the most common false positive in
-- this queue — worth allow-listing rather than reviewing every weekend.
SELECT
  c.card_fingerprint,
  COUNT(*) AS in_person_charges,
  COUNT(DISTINCT c.account_id) AS organizers,
  SUM(c.amount) AS total_amount
FROM charges c
WHERE c.payment_method_details_type = 'card_present'
  AND c.paid = true
GROUP BY c.card_fingerprint
HAVING COUNT(*) >= 2
ORDER BY in_person_charges DESC
LIMIT 12`;

    const closedSql = sql`
-- How past reviews were resolved, and at what risk score. If almost everything
-- gets approved, the threshold is too low and the queue is just tax.
SELECT
  r.closed_reason,
  COUNT(*) AS reviews,
  ROUND(AVG(c.outcome_risk_score), 1) AS avg_risk_score,
  MIN(c.outcome_risk_score) AS min_risk_score,
  MAX(c.outcome_risk_score) AS max_risk_score
FROM reviews r
JOIN charges c ON c.id = r.charge_id
WHERE r.open = false
GROUP BY r.closed_reason
ORDER BY reviews DESC`;

    const [history, boxOffice, closed] = await Promise.all([
      ctx.sql(historySql),
      ctx.sql(boxOfficeSql),
      ctx.sql(closedSql),
    ]);

    const historyByFingerprint = new Map(
      history.rows.map((row) => [str(row, 'card_fingerprint'), row]),
    );

    const totalAmount = rows.reduce((sum, row) => sum + num(row, 'amount'), 0);
    const avgRisk =
      rows.reduce((sum, row) => sum + num(row, 'outcome_risk_score'), 0) /
      Math.max(1, rows.length);

    const approvedRow = closed.rows.find((r) => str(r, 'closed_reason') === 'approved');
    const refundedRow = closed.rows.find((r) => str(r, 'closed_reason') === 'refunded');
    const closedTotal = closed.rows.reduce((n, r) => n + num(r, 'reviews'), 0);
    const approvalRate = num(approvedRow, 'reviews') / Math.max(1, closedTotal);

    const items: ScenarioItem[] = rows.map((row) => {
      const reviewId = str(row, 'review_id');
      const chargeId = str(row, 'charge_id');
      const fingerprint = str(row, 'card_fingerprint');
      const amount = num(row, 'amount');
      const card = historyByFingerprint.get(fingerprint);
      const cardCharges = num(card, 'total_charges');
      const cardOrganizers = num(card, 'organizers_purchased_from');
      const cardDisputes = num(card, 'disputed_charges');
      const firstSeen = num(card, 'first_seen');
      const inPerson = str(row, 'payment_method_details_type') === 'card_present';

      // Clean history across more than one organizer, no disputes → real buyer.
      const trusted = (cardCharges > 1 && cardDisputes === 0 && cardOrganizers >= 1) || inPerson;

      const approveAction: ScenarioItem['actions'][number] = {
        id: `approve_${reviewId}`,
        label: 'Approve',
        surface: 'api',
        callLabel: 'POST /v1/reviews/:id/approve',
        method: 'POST',
        path: `/v1/reviews/${reviewId}/approve`,
        plainEnglish: `Releases this ${money(amount)} charge. The payment has already been captured — approving just closes the review so the organizer's payout is not held up.`,
        params: {},
        totals: [
          { label: 'Charge', value: `${chargeId} · ${money(amount)}` },
          { label: 'Risk score', value: String(num(row, 'outcome_risk_score')) },
          {
            label: 'Card history',
            value: `${cardCharges} charges across ${cardOrganizers} organizer${cardOrganizers === 1 ? '' : 's'}, ${cardDisputes} disputed`,
          },
        ],
        variant: trusted ? 'primary' : 'secondary',
        run: (simCtx, options) =>
          api.approveReview(simCtx, reviewId, { idempotencyKey: options.idempotencyKey }),
      };

      const refundAndBlock: ScenarioItem['actions'][number] = {
        id: `refund_block_${reviewId}`,
        label: 'Refund & block',
        surface: 'mcp',
        callLabel: 'create_refund + POST /v1/radar/value_list_items',
        method: 'POST',
        path: '/v1/refunds',
        plainEnglish: `Refunds the ${money(amount)} charge as fraudulent with the transfer reversed, then adds the card fingerprint to ${BLOCKLIST} so it cannot buy again. Two calls: one MCP refund, one direct Radar write.`,
        params: {
          refund: {
            charge: chargeId,
            reason: 'fraudulent',
            reverse_transfer: true,
          },
          radar: { value_list: BLOCKLIST, value: fingerprint },
        },
        totals: [
          { label: 'Refund', value: money(amount), tone: 'warn' },
          { label: 'Organizer debited', value: str(row, 'organizer') },
          { label: 'Fingerprint blocked', value: fingerprint },
        ],
        requiresSecondAck: amount > 10_000_00,
        secondAckLabel: 'I understand this refunds more than $10,000 and debits the organizer',
        variant: trusted ? 'secondary' : 'danger',
        run: async (simCtx, options) => {
          const refund = await mcp.create_refund(
            simCtx,
            {
              charge: chargeId,
              reason: 'fraudulent',
              reverse_transfer: true,
              metadata: { review: reviewId },
            },
            { idempotencyKey: `${options.idempotencyKey}-refund` },
          );
          const listItem = await api.createRadarValueListItem(
            simCtx,
            { value_list: BLOCKLIST, value: fingerprint },
            { idempotencyKey: `${options.idempotencyKey}-radar` },
          );
          return { refund, listItem };
        },
      };

      return {
        id: reviewId,
        title: `${money(amount)} · risk ${num(row, 'outcome_risk_score')}`,
        subtitle: `${str(row, 'organizer')} — ${str(row, 'event_name')}`,
        href: `/organizers/${str(row, 'account_id')}`,
        facts: [
          {
            label: 'Card history',
            value:
              cardCharges > 1
                ? `${cardCharges} charges, ${cardOrganizers} organizer${cardOrganizers === 1 ? '' : 's'}, first seen ${shortDate(firstSeen)}`
                : 'First charge on this card',
            tone: cardCharges > 1 && cardDisputes === 0 ? 'good' : 'warn',
          },
          {
            label: 'Disputes on card',
            value: String(cardDisputes),
            tone: cardDisputes > 0 ? 'danger' : 'good',
          },
          {
            label: 'Channel',
            value: inPerson ? 'Box office (card present)' : 'Online',
            tone: inPerson ? 'good' : 'neutral',
          },
          { label: 'Opened by', value: str(row, 'opened_reason') },
        ],
        recommendation: inPerson
          ? 'Approve. This was taken in person on a terminal — the card and the buyer were physically at the gate.'
          : trusted
            ? `Approve. ${cardCharges} charges on this card across ${cardOrganizers} organizer${cardOrganizers === 1 ? '' : 's'} with no disputes is a returning buyer, not a fraud pattern.`
            : 'Refund and block. First time we have seen this card, flagged on a rule, and nothing in its history to offset the score.',
        actions: trusted ? [approveAction, refundAndBlock] : [refundAndBlock, approveAction],
      };
    });

    const trustedCount = items.filter((item) =>
      item.recommendation?.startsWith('Approve'),
    ).length;
    const blockCount = items.length - trustedCount;
    const allowlistFingerprints = boxOffice.rows.map((row) => str(row, 'card_fingerprint'));

    const answer = [
      `${plural(rows.length, 'review')} are open, holding ${money(totalAmount)}. Average risk score is ${avgRisk.toFixed(1)}, and the oldest has been sitting since ${shortDate(num(rows[0], 'created'))}.`,
      `Pulling each card's history across the platform sorts them quickly: ${trustedCount} are on cards with a clean record — repeat purchases, more than one organizer, no disputes — and ${blockCount} are on cards we have never seen before with nothing to offset the score.`,
      `This queue is also mostly noise. Of the ${closedTotal} reviews already closed, ${percent(approvalRate, 0)} were approved${refundedRow ? ` and only ${num(refundedRow, 'reviews')} were refunded` : ''}, at an average risk score of ${num(approvedRow, 'avg_risk_score')}. That is a threshold problem, not a staffing problem.`,
    ];

    return {
      answer,
      queries: [
        { label: 'Open reviews', sql: openSql, result: open },
        { label: 'Card history for each flagged card', note: 'Across every organizer.', sql: historySql, result: history },
        { label: 'Repeat box-office cards', note: 'Allow-list candidates.', sql: boxOfficeSql, result: boxOffice },
        { label: 'How past reviews resolved', sql: closedSql, result: closed },
      ],
      items,
      resolution: {
        headline: `Approve ${trustedCount}, refund and block ${blockCount}, then allow-list the box office.`,
        body: `Work the queue on card history rather than risk score alone. Then stop it refilling: ${allowlistFingerprints.length} cards have been used at a box office more than once and keep getting flagged despite a person standing at the terminal. Allow-listing them removes a recurring chunk of this work.`,
        bullets: [
          `${percent(approvalRate, 0)} historical approval rate says the review threshold is set too low`,
          `${allowlistFingerprints.length} repeat box-office cards to allow-list`,
          'Raising the rule threshold itself has to be done in the Dashboard',
        ],
      },
      actions: [
        {
          id: 'review_allowlist_box_office',
          label: `Allow-list ${allowlistFingerprints.length} box-office cards`,
          surface: 'api',
          callLabel: 'POST /v1/radar/value_list_items',
          method: 'POST',
          path: '/v1/radar/value_list_items',
          plainEnglish: `Adds ${allowlistFingerprints.length} card fingerprints that have been used at a box office more than once to ${ALLOWLIST}. A Radar rule referencing that list will stop sending in-person sales on these cards to review.`,
          params: { value_list: ALLOWLIST, values: allowlistFingerprints },
          totals: [
            { label: 'Fingerprints', value: String(allowlistFingerprints.length) },
            { label: 'Value list', value: ALLOWLIST },
            {
              label: 'In-person charges covered',
              value: String(boxOffice.rows.reduce((n, r) => n + num(r, 'in_person_charges'), 0)),
            },
          ],
          variant: 'secondary',
          batch: { size: 1, total: allowlistFingerprints.length, unitLabel: 'fingerprint' },
          run: async (simCtx, options) => {
            const added: unknown[] = [];
            for (let i = 0; i < allowlistFingerprints.length; i += 1) {
              added.push(
                await api.createRadarValueListItem(
                  simCtx,
                  { value_list: ALLOWLIST, value: allowlistFingerprints[i] },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: allowlistFingerprints.length,
                label: `Allow-listed ${i + 1} of ${allowlistFingerprints.length}`,
              });
            }
            return { items: added.length, value_list: ALLOWLIST };
          },
        },
      ],
      dashboardOnly: [
        dashboardOnly(
          'radar_rule_edit',
          `${percent(approvalRate, 0)} of the ${closedTotal} reviews we have closed were approved, at an average risk score of ${num(approvedRow, 'avg_risk_score')} and as low as ${num(approvedRow, 'min_risk_score')}. The open queue averages ${avgRisk.toFixed(1)}. Moving the review threshold up to around ${Math.round(num(refundedRow, 'avg_risk_score') || 75)} — where refunded reviews actually sit — would have kept roughly ${Math.round(approvalRate * closedTotal)} of those ${closedTotal} charges out of the queue entirely. Rule thresholds are Dashboard-only, so this one needs a human in Radar → Rules.`,
        ),
      ],
    };
  },
};
