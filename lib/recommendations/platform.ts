import { DAY, NOW } from '../sim/constants';
import { longDate, money, percent } from '../sim/format';
import type { PlatformMoney } from '../sim/money';
import type { SimDataset } from '../sim/types';
import { dashboardOnly, ef } from '../stripe-sim';
import { sortRecommendations, type Recommendation } from './types';

/**
 * Recommendations for the platform's own money pages.
 *
 * The organizer pages answer "what do I have". These answer "what are we leaving
 * on the table", which is the question that turns into revenue — and the reason
 * the strongest recommendation on the Advances page is about offers nobody has
 * looked at rather than about offers nobody has accepted.
 */

/* -------------------------------------------------------------------------- */
/* Advances                                                                   */
/* -------------------------------------------------------------------------- */

export function advanceRecommendations(p: PlatformMoney): Recommendation[] {
  const out: Recommendation[] = [];

  if (p.lapsingSoon.length > 0) {
    const value = p.lapsingSoon.reduce((s, a) => s + a.offered, 0);
    const soonest = p.lapsingSoon
      .slice()
      .sort((a, b) => (a.expiresAfter ?? 0) - (b.expiresAfter ?? 0))[0];
    const days = soonest.expiresAfter
      ? Math.max(0, Math.round((soonest.expiresAfter - NOW) / DAY))
      : 0;

    out.push({
      id: 'lapsing',
      tone: 'act',
      title: `${money(value)} of financing lapses within the week`,
      why: `${p.lapsingSoon.length} offers on a 30-day clock that no organizer has been shown. The soonest is ${soonest.organizer} at ${money(soonest.offered)}, closing in ${days} ${days === 1 ? 'day' : 'days'}.`,
      next: 'Marking an offer delivered costs nothing, commits nobody and moves no money — it is the step that lets the organizer see it exists at all. Do these first.',
      action: batchDeliver(p.lapsingSoon, 'lapsing'),
    });
  }

  const rest = p.undelivered.filter((a) => !p.lapsingSoon.includes(a));
  if (rest.length > 0) {
    const value = rest.reduce((s, a) => s + a.offered, 0);
    out.push({
      id: 'undelivered_rest',
      tone: 'watch',
      title: `${money(value)} more has never been surfaced`,
      why: `${rest.length} further offers sit in \`undelivered\`, with more runway. Undelivered is not declined — it means the organizer has never seen it, and that is the one state the platform alone is responsible for.`,
      next: 'Surface them before they join the lapsing pile.',
      action: batchDeliver(rest, 'rest'),
    });
  }

  if (p.outstandingTotal > 0) {
    const drawn = p.advances.filter((a) => a.advanced > 0);
    out.push({
      id: 'outstanding',
      tone: 'info',
      title: `${money(p.outstandingTotal)} outstanding across ${drawn.length} organizers`,
      why: `${money(p.advancedTotal)} was advanced. The outstanding figure is higher because it includes the fee, and it comes back through withholding on ticket sales rather than on a repayment schedule.`,
      next: 'No collection work and no credit risk on the platform balance sheet — if an organizer trades less, repayment simply takes longer.',
    });
  }

  if (p.undelivered.length === 0 && p.advances.length > 0) {
    out.push({
      id: 'all_surfaced',
      tone: 'info',
      title: 'Every live offer has been surfaced',
      why: `${p.advances.length} offers written, none sitting unseen.`,
      next: 'Worth re-checking when Stripe writes the next batch, since each offer starts its own 30-day clock.',
    });
  }

  return sortRecommendations(out);
}

/** One call per offer, driven by a progress bar. */
function batchDeliver(rows: PlatformMoney['undelivered'], key: string) {
  const value = rows.reduce((s, a) => s + a.offered, 0);
  return {
    id: `rec_deliver_${key}`,
    label: rows.length === 1 ? 'Surface this offer' : `Surface all ${rows.length}`,
    surface: 'api' as const,
    callLabel: 'POST /v1/capital/financing_offers/:id/mark_delivered',
    method: 'POST' as const,
    path: '/v1/capital/financing_offers/:id/mark_delivered',
    plainEnglish: `Records that ${rows.length === 1 ? 'this offer has' : `all ${rows.length} offers have`} been surfaced to ${rows.length === 1 ? 'its organizer' : 'their organizers'}, which is what Stripe requires before an organizer can act on one. This marks delivery only — nothing is accepted and no money moves.`,
    params: {
      note: `${rows.length} separate calls, one per offer`,
      offers: rows.map((r) => ({
        id: r.offerId,
        account: r.accountId,
        organizer: r.organizer,
        offered_amount: r.offered,
      })),
    },
    totals: [
      { label: 'Offers', value: String(rows.length) },
      { label: 'Financing surfaced', value: money(value) },
      { label: 'Money moved', value: 'None' },
    ],
    batch: { size: 1, total: rows.length, unitLabel: 'offer' },
    variant: 'primary' as const,
    run: async (
      ctx: Parameters<NonNullable<Recommendation['action']>['run']>[0],
      options: Parameters<NonNullable<Recommendation['action']>['run']>[1],
    ) => {
      const results = [];
      for (const [i, row] of rows.entries()) {
        if (!row.offerId) continue;
        results.push(
          await ef.markFinancingOfferDelivered(ctx, row.offerId, {
            idempotencyKey: `${options.idempotencyKey}-${i}`,
          }),
        );
        options.onProgress?.({
          done: i + 1,
          total: rows.length,
          label: 'Marking offers delivered',
        });
      }
      return results;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Stored balances                                                            */
/* -------------------------------------------------------------------------- */

export function treasuryRecommendations(
  p: PlatformMoney,
  data: SimDataset,
): Recommendation[] {
  const out: Recommendation[] = [];

  const enrolled = new Set(p.storedBalances.map((r) => r.accountId));
  const notEnrolled = Math.max(0, p.floatOrganizers - enrolled.size);

  if (notEnrolled > 0) {
    // Candidates worth opening first: the organizers holding the most, who have
    // an event ahead of them and no account yet.
    const candidates = data.account_balances
      .filter((b) => b.available > 0 && !enrolled.has(b.account_id))
      .map((b) => ({
        accountId: b.account_id,
        organizer:
          data.accounts.find((a) => a.id === b.account_id)?.business_profile_name ?? b.account_id,
        hasEvent: Boolean(
          data.accounts.find((a) => a.id === b.account_id)?.metadata.next_event_date,
        ),
        held: (b.available + b.pending) * 100,
      }))
      .filter((c) => c.hasEvent)
      .sort((a, b) => b.held - a.held)
      .slice(0, 5);

    out.push({
      id: 'not_enrolled',
      tone: 'watch',
      title: `${notEnrolled} organizers are holding float with no stored balance`,
      why: `${money(p.floatTotal)} sits across ${p.floatOrganizers} organizers with events still to come, and only ${enrolled.size} of them can see or spend it. The rest wait for a payout and then wire money out of their own bank.`,
      next: 'Opening an account moves no money and changes no release date — the hold stays exactly as it is. What changes is that the organizer behind it stops being unable to use their own takings.',
      action:
        candidates.length > 0
          ? {
              id: 'rec_open_accounts',
              label: `Open accounts for the top ${candidates.length}`,
              surface: 'api',
              callLabel: 'POST /v1/treasury/financial_accounts',
              method: 'POST',
              path: '/v1/treasury/financial_accounts',
              plainEnglish: `Opens a stored-balance account on each of the ${candidates.length} largest organizers without one. Each starts empty — opening it moves nothing. Funds only arrive once the payout destination is repointed, which is a separate change those organizers have to agree to.`,
              params: {
                note: `${candidates.length} separate calls, one per connected account`,
                accounts: candidates.map((c) => ({
                  stripe_account: c.accountId,
                  organizer: c.organizer,
                  currently_held: c.held,
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
                { label: 'Accounts opened', value: String(candidates.length) },
                {
                  label: 'Float behind them',
                  value: money(candidates.reduce((s, c) => s + c.held, 0)),
                },
                { label: 'Money moved now', value: 'None' },
                {
                  label: 'Prerequisite',
                  value: 'treasury capability active',
                  tone: 'warn',
                },
              ],
              batch: { size: 1, total: candidates.length, unitLabel: 'account' },
              variant: 'primary',
              run: async (ctx, options) => {
                const results = [];
                for (const [i, c] of candidates.entries()) {
                  results.push(
                    await ef.createFinancialAccount(
                      ctx,
                      c.accountId,
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
                    total: candidates.length,
                    label: 'Opening financial accounts',
                  });
                }
                return results;
              },
            }
          : undefined,
      dashboardOnly: dashboardOnly(
        'treasury_enablement',
        `The ${money(p.floatTotal)} float is the case to take to the account team. Until the capability is active, the create call above fails on every one of these accounts.`,
      ),
    });
  }

  // An account with nothing in it is a rollout that stalled after step one.
  const empty = p.storedBalances.filter((r) => r.creditsIn === 0);
  if (empty.length > 0) {
    out.push({
      id: 'empty_accounts',
      tone: 'watch',
      title: `${empty.length} stored ${empty.length === 1 ? 'balance has' : 'balances have'} never received anything`,
      why: `${empty.map((r) => r.organizer).slice(0, 3).join(', ')} ${empty.length === 1 ? 'has an open account' : 'have open accounts'} with no ticket revenue ever swept in.`,
      next: 'Opening an account does not route money to it. The payout destination has to be repointed separately, and that is the step that gets forgotten.',
    });
  }

  if (p.storedBalances.length > 0) {
    const idle = p.storedBalances.filter((r) => r.paidOut === 0 && r.cash > 0);
    if (idle.length > 0) {
      out.push({
        id: 'idle_accounts',
        tone: 'info',
        title: `${idle.length} ${idle.length === 1 ? 'organizer holds' : 'organizers hold'} a balance but pay no vendors from it`,
        why: `${money(idle.reduce((s, r) => s + r.cash, 0))} held with no outbound payments. The account is being used as a holding pen rather than as a wallet.`,
        next: 'Worth asking whether they know they can pay suppliers directly from it — that is the half of the product that saves them a step.',
        ask: 'Which organizers are paying vendors by bank transfer instead of card?',
      });
    }
  }

  return sortRecommendations(out);
}

/* -------------------------------------------------------------------------- */
/* Card program                                                               */
/* -------------------------------------------------------------------------- */

export function cardProgramRecommendations(
  p: PlatformMoney,
  data: SimDataset,
): Recommendation[] {
  const out: Recommendation[] = [];

  const withCards = new Set(p.cardProgram.map((r) => r.accountId));

  // Organizers already paying vendors out of a stored balance, by bank transfer,
  // with no cards. They have the funding source and the spend — the only thing
  // missing is the instrument.
  const spendNoCards = new Map<string, { organizer: string; total: number; count: number }>();
  for (const payment of data.treasury_outbound_payments) {
    if (withCards.has(payment.account_id)) continue;
    if (payment.created < NOW - 90 * DAY) continue;
    const row = spendNoCards.get(payment.account_id) ?? {
      organizer:
        data.accounts.find((a) => a.id === payment.account_id)?.business_profile_name ??
        payment.account_id,
      total: 0,
      count: 0,
    };
    row.total += payment.amount;
    row.count += 1;
    spendNoCards.set(payment.account_id, row);
  }

  const targets = Array.from(spendNoCards.entries())
    .map(([accountId, row]) => ({ accountId, ...row }))
    .sort((a, b) => b.total - a.total);

  if (targets.length > 0) {
    const total = targets.reduce((s, t) => s + t.total, 0);
    out.push({
      id: 'spend_no_cards',
      tone: 'watch',
      title: `${money(total)} of vendor spend from organizers with no cards`,
      why: `${targets.length} ${targets.length === 1 ? 'organizer' : 'organizers'} — ${targets.map((t) => t.organizer).slice(0, 3).join(', ')} — moved ${money(total)} to suppliers by bank transfer in 90 days. They already have the stored balance a card would draw on.`,
      next: 'Requesting the capability is the cheap first step: it comes back pending for Stripe review, creates nothing and moves nothing. Cards cannot be created until it is active.',
      action: {
        id: 'rec_request_issuing',
        label: `Request card issuing for ${targets.length}`,
        surface: 'api',
        callLabel: 'POST /v1/accounts/:id',
        method: 'POST',
        path: '/v1/accounts/:id',
        plainEnglish: `Requests the card_issuing capability on ${targets.length} connected accounts. The capability comes back pending, not active — Stripe reviews each one, and a card created before the review clears would fail.`,
        params: {
          note: `${targets.length} separate calls, one per connected account`,
          accounts: targets.map((t) => ({
            id: t.accountId,
            organizer: t.organizer,
            quarterly_vendor_spend: t.total,
          })),
          capabilities: { card_issuing: { requested: true } },
        },
        totals: [
          { label: 'Accounts', value: String(targets.length) },
          { label: 'Vendor spend behind them', value: money(total) },
          { label: 'Result', value: 'capability pending review', tone: 'warn' },
          { label: 'Money moved', value: 'None' },
        ],
        batch: { size: 1, total: targets.length, unitLabel: 'account' },
        variant: 'primary',
        run: async (ctx, options) => {
          const results = [];
          for (const [i, t] of targets.entries()) {
            results.push(
              await ef.requestCardIssuingCapability(ctx, t.accountId, {
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
      },
    });
  }

  // A high decline rate is ambiguous on purpose: it is either the control
  // working or an allow-list that was set too narrow. Both need a human.
  const attempts = p.cardApprovedTotal + p.cardDeclinedTotal;
  const noisy = p.cardProgram
    .filter((r) => r.declinedCount >= 2)
    .sort((a, b) => b.declinedAmount - a.declinedAmount)[0];

  if (noisy) {
    out.push({
      id: 'decline_concentration',
      tone: 'info',
      title: `${noisy.organizer} has the most refused spend`,
      why: `${money(noisy.declinedAmount)} across ${noisy.declinedCount} attempts. Platform-wide, controls refused ${money(p.cardDeclinedTotal)} of ${money(attempts)} attempted — ${attempts > 0 ? percent(p.cardDeclinedTotal / attempts, 1) : '0%'} by value.`,
      next: 'This number is good or bad depending on what was being bought, and the platform cannot tell from here. The organizer can: either the control caught off-policy spend, or their allow-list is too narrow for how they actually operate.',
      ask: 'Which organizers are paying vendors by bank transfer instead of card?',
    });
  }

  if (p.cardProgram.length === 0) {
    out.push({
      id: 'no_program',
      tone: 'info',
      title: 'No cards issued anywhere on the platform',
      why: 'The card program has not started.',
      next: 'Cards need a stored balance to draw on and the card_issuing capability granted per account, so the Treasury rollout comes first.',
      ask: 'Which organizers are paying vendors by bank transfer instead of card?',
    });
  }

  return sortRecommendations(out);
}

export function settlementRecommendations(data: SimDataset): Recommendation[] {
  const out: Recommendation[] = [];
  const outstanding = data.service_fee_ledger.filter((r) => !r.settled);
  if (outstanding.length === 0) return out;

  const total = outstanding.reduce((s, r) => s + r.fee_owed, 0);
  const organizers = new Set(outstanding.map((r) => r.account_id));
  const oldest = outstanding.slice().sort((a, b) => a.period_end - b.period_end)[0];
  const ageDays = Math.max(0, Math.round((NOW - oldest.period_end) / DAY));

  out.push({
    id: 'fees_outstanding',
    tone: ageDays > 14 ? 'act' : 'watch',
    title: `${money(total)} of service fees uncollected across ${organizers.size} organizers`,
    why: `${outstanding.length} events billed after the fact. The oldest closed ${longDate(oldest.period_end)}, ${ageDays} days ago — and every day it sits is a day the organizer can spend the money first.`,
    next: 'Debit only the organizers whose balance covers it. Pushing an account negative to collect a fee turns a clean settlement into a support conversation and a failed payout.',
    ask: "Which organizers owe service fees from last week's events?",
  });

  return out;
}
