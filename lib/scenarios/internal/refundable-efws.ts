import { api, mcp } from '../../stripe-sim';
import { dashboardOnly } from '../../stripe-sim/dashboard-only';
import { shortDate } from '../../sim/format';
import { T, list, money, num, plural, sql, str } from '../helpers';
import type { Scenario, ScenarioResult } from '../types';

const BLOCKLIST = 'rsl_marquee_blocked_fingerprints';

/**
 * "Which early fraud warnings are still refundable?"
 *
 * An actionable EFW is a warning from the issuer that a card was used
 * fraudulently. Refund it before the buyer disputes and you keep the dispute off
 * your ratio and avoid the $15 fee. Once it becomes a dispute, that option is
 * gone — so the only ones worth listing are those with no refund and no dispute
 * against them yet.
 */
export const refundableEfws: Scenario = {
  id: 'refundable_efws',
  scope: 'internal',
  title: 'Refundable fraud warnings',
  suggestedPrompt: 'Which early fraud warnings are still refundable?',
  blurb:
    'Finds actionable early fraud warnings with no refund and no dispute yet, and refunds them before they turn into chargebacks.',
  triggers: [
    'which early fraud warnings are still refundable',
    'early fraud warnings',
    'refundable fraud warnings',
    'efws',
    'fraud warnings',
  ],
  keywords: ['efw', 'efws', 'fraud', 'warning', 'warnings', 'refundable', 'stolen'],

  async run(ctx): Promise<ScenarioResult> {
    const warningsSql = sql`
-- Actionable early fraud warnings with nothing done about them yet.
-- The two LEFT JOINs plus IS NULL are doing the work: an EFW that has already
-- been refunded needs no action, and one that has already become a dispute is
-- past the point where refunding helps.
SELECT
  w.id AS warning_id,
  w.fraud_type,
  w.created AS warning_created,
  c.id AS charge_id,
  c.amount,
  c.created AS charge_created,
  c.customer_id,
  c.card_fingerprint,
  c.card_brand,
  c.card_country,
  c.outcome_risk_score,
  c.transfer_id,
  a.id AS account_id,
  a.business_profile_name AS organizer,
  e.name AS event_name,
  e.starts_at AS event_starts_at
FROM early_fraud_warnings w
JOIN charges c ON c.id = w.charge_id
JOIN accounts a ON a.id = c.account_id
JOIN events e ON e.id = c.metadata_event_id
LEFT JOIN refunds r ON r.charge_id = c.id
LEFT JOIN disputes d ON d.charge_id = c.id
WHERE w.actionable = true
  AND r.id IS NULL
  AND d.id IS NULL
ORDER BY w.created ASC`;

    const repeatSql = sql`
-- Do any of these cards appear more than once across the platform? A fingerprint
-- with several successful charges is a card being worked, not a one-off.
SELECT
  c.card_fingerprint,
  COUNT(*) AS charges_on_card,
  COUNT(DISTINCT c.account_id) AS organizers_hit,
  SUM(c.amount) AS total_charged
FROM charges c
WHERE c.paid = true
GROUP BY c.card_fingerprint
HAVING COUNT(*) > 1
ORDER BY charges_on_card DESC
LIMIT 25`;

    const outcomeSql = sql`
-- What happened to warnings we did refund, versus ones we let ride.
SELECT
  CASE WHEN r.id IS NULL THEN 'not_refunded' ELSE 'refunded' END AS handling,
  COUNT(*) AS warnings,
  SUM(CASE WHEN d.id IS NULL THEN 0 ELSE 1 END) AS became_disputes
FROM early_fraud_warnings w
JOIN charges c ON c.id = w.charge_id
LEFT JOIN refunds r ON r.charge_id = c.id
LEFT JOIN disputes d ON d.charge_id = c.id
GROUP BY CASE WHEN r.id IS NULL THEN 'not_refunded' ELSE 'refunded' END`;

    const [warnings, repeats, outcomes] = await Promise.all([
      ctx.sql(warningsSql),
      ctx.sql(repeatSql),
      ctx.sql(outcomeSql),
    ]);

    const rows = warnings.rows;
    const totalAmount = rows.reduce((sum, row) => sum + num(row, 'amount'), 0);
    const chargeIds = rows.map((row) => str(row, 'charge_id'));
    const fingerprints = Array.from(new Set(rows.map((row) => str(row, 'card_fingerprint'))));
    const disputeFeeExposure = rows.length * 1_500;

    const repeatSet = new Set(repeats.rows.map((r) => str(r, 'card_fingerprint')));
    const repeatOffenders = rows.filter((row) => repeatSet.has(str(row, 'card_fingerprint')));

    const organizerCounts = new Map<string, number>();
    for (const row of rows) {
      const organizer = str(row, 'organizer');
      organizerCounts.set(organizer, (organizerCounts.get(organizer) ?? 0) + 1);
    }
    const topOrganizers = Array.from(organizerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const byType = new Map<string, number>();
    for (const row of rows) {
      const type = str(row, 'fraud_type');
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }

    const oldest = rows[0];

    const answer = [
      `${plural(rows.length, 'early fraud warning')} are still refundable — actionable, with no refund and no dispute against them yet. Together they are ${money(totalAmount)}.`,
      `Refunding now closes them out. Left alone, most turn into disputes, which costs the ${money(totalAmount)} anyway plus ${money(disputeFeeExposure)} in dispute fees and the hit to the dispute ratio. The oldest warning has been open since ${shortDate(num(oldest, 'warning_created'))}, so the window is closing on that one.`,
      `${list(Array.from(byType.entries()).map(([type, n]) => `${n} ${type.replace(/_/g, ' ')}`))}. Concentration is ${list(topOrganizers.map(([organizer, n]) => `${organizer} (${n})`))}.`,
      repeatOffenders.length > 0
        ? `${plural(repeatOffenders.length, 'warning')} sit on cards that have more than one successful charge on the platform, so blocking the fingerprint matters as much as the refund — otherwise the same card comes back tomorrow.`
        : 'Each warning is on a distinct card fingerprint, so there is no repeat-offender pattern to block beyond these.',
    ];

    const refundParams = {
      charges: chargeIds,
      reason: 'fraudulent' as const,
      reverse_transfer: true,
      refund_application_fee: true,
    };

    return {
      answer,
      queries: [
        { label: 'Refundable warnings', note: 'Actionable, no refund, no dispute.', sql: warningsSql, result: warnings },
        { label: 'Cards seen more than once', note: 'Tells you whether to block as well as refund.', sql: repeatSql, result: repeats },
        { label: 'What happened historically', note: 'Refunded versus left alone.', sql: outcomeSql, result: outcomes },
      ],
      table: {
        caption: 'Every refundable warning',
        columns: [
          { key: 'warning_id', label: 'Warning' },
          { key: 'organizer', label: 'Organizer' },
          { key: 'fraud_type', label: 'Fraud type' },
          { key: 'amount', label: 'Amount', align: 'right', kind: 'money' },
          { key: 'outcome_risk_score', label: 'Risk', align: 'right', kind: 'number' },
          { key: 'card_country', label: 'Card' },
          { key: 'warning_created', label: 'Raised', kind: 'date' },
        ],
        rows,
      },
      resolution: {
        headline: `Refund all ${rows.length} with reverse_transfer, then blocklist the ${fingerprints.length} card fingerprints.`,
        body: `reverse_transfer pulls the money back out of each organizer's balance rather than leaving Marquee to absorb it — these were fraudulent sales, and the organizer was paid for them. Blocking the fingerprints afterwards is what stops the same cards being used again next weekend.`,
        bullets: [
          `${money(totalAmount)} refunded, ${money(disputeFeeExposure)} of dispute fees avoided if they would otherwise have been disputed`,
          'reverse_transfer = true, so each organizer balance is debited for its own fraudulent sales',
          `${fingerprints.length} fingerprints added to ${BLOCKLIST}`,
          'Radar rule thresholds cannot be changed through the API — see the Dashboard-only note',
        ],
      },
      actions: [
        {
          id: 'efw_refund_all',
          label: `Refund all ${rows.length} with reverse_transfer`,
          surface: 'mcp',
          callLabel: 'create_refund',
          method: 'POST',
          path: '/v1/refunds',
          plainEnglish: `Issues a full refund on all ${rows.length} charges, marked as fraudulent, and reverses the matching transfer so the money comes back out of each organizer's balance instead of Marquee's. ${rows.length} separate create_refund calls, one per charge.`,
          params: refundParams,
          totals: [
            { label: 'Charges refunded', value: String(rows.length) },
            { label: 'Total refunded', value: money(totalAmount), tone: totalAmount > 10_000_00 ? 'warn' : 'neutral' },
            { label: 'Transfers reversed', value: String(rows.filter((r) => str(r, 'transfer_id')).length) },
            { label: 'Organizers affected', value: String(organizerCounts.size) },
          ],
          requiresSecondAck: totalAmount > 10_000_00,
          secondAckLabel: `I understand this refunds more than $10,000 (${money(totalAmount)}) across ${organizerCounts.size} organizers and debits their balances`,
          variant: 'primary',
          batch: { size: 1, total: rows.length, unitLabel: 'refund' },
          run: async (simCtx, options) => {
            const created: unknown[] = [];
            for (let i = 0; i < rows.length; i += 1) {
              const chargeId = chargeIds[i];
              created.push(
                await mcp.create_refund(
                  simCtx,
                  {
                    charge: chargeId,
                    reason: 'fraudulent',
                    reverse_transfer: true,
                    refund_application_fee: true,
                    metadata: { reason_detail: 'early_fraud_warning', warning: str(rows[i], 'warning_id') },
                  },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: rows.length,
                label: `Refunded ${i + 1} of ${rows.length}`,
              });
            }
            return { refunds: created.length, amount: totalAmount };
          },
        },
        {
          id: 'efw_block_buyers',
          label: `Block these ${fingerprints.length} cards`,
          surface: 'api',
          callLabel: 'POST /v1/radar/value_list_items',
          method: 'POST',
          path: '/v1/radar/value_list_items',
          plainEnglish: `Adds each card fingerprint to the ${BLOCKLIST} value list. Any Radar rule that reads that list will block future attempts from these cards across every organizer on the platform.`,
          params: { value_list: BLOCKLIST, values: fingerprints },
          totals: [
            { label: 'Fingerprints', value: String(fingerprints.length) },
            { label: 'Value list', value: BLOCKLIST },
            { label: 'Scope', value: 'Platform-wide' },
          ],
          variant: 'secondary',
          batch: { size: 1, total: fingerprints.length, unitLabel: 'fingerprint' },
          run: async (simCtx, options) => {
            const added: unknown[] = [];
            for (let i = 0; i < fingerprints.length; i += 1) {
              added.push(
                await api.createRadarValueListItem(
                  simCtx,
                  { value_list: BLOCKLIST, value: fingerprints[i] },
                  { idempotencyKey: `${options.idempotencyKey}-${i + 1}` },
                ),
              );
              options.onProgress?.({
                done: i + 1,
                total: fingerprints.length,
                label: `Blocked ${i + 1} of ${fingerprints.length}`,
              });
            }
            return { items: added.length, value_list: BLOCKLIST };
          },
        },
        {
          id: 'efw_buyer_history',
          label: 'Pull buyer history first',
          surface: 'mcp',
          callLabel: 'list_payment_intents',
          method: 'GET',
          path: '/v1/payment_intents',
          plainEnglish: `Reads the payment history for the oldest warning's buyer (${str(oldest, 'customer_id')}) so you can sanity-check the call before refunding anyone. Read-only.`,
          params: { customer: str(oldest, 'customer_id'), limit: 20 },
          totals: [
            { label: 'Customer', value: str(oldest, 'customer_id') },
            { label: 'Organizer', value: str(oldest, 'organizer') },
          ],
          variant: 'secondary',
          run: (simCtx, options) =>
            mcp.list_payment_intents(
              simCtx,
              { customer: str(oldest, 'customer_id'), limit: 20 },
              { idempotencyKey: options.idempotencyKey },
            ),
        },
      ],
      dashboardOnly: [
        dashboardOnly(
          'radar_rule_edit',
          `${rows.length} warnings landed on charges with an average risk score of ${Math.round(rows.reduce((s, r) => s + num(r, 'outcome_risk_score'), 0) / Math.max(1, rows.length))}, below the current block threshold. Tightening the rule for this cohort is a Dashboard change — the API can fill the value list but cannot author the rule that reads it.`,
        ),
        dashboardOnly(
          'card_account_updater',
          `${rows.filter((r) => str(r, 'card_country') !== 'US').length} of these were on non-US cards. Account Updater will not stop fraud, but it does cut the stale-credential declines that push buyers into re-entering details, which is where a chunk of this traffic comes from.`,
        ),
      ],
    };
  },
};

/** Exported for the audit page, which labels blocklist writes. */
export const RADAR_BLOCKLIST = BLOCKLIST;
