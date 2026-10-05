import { DAY, NOW } from '../sim/constants';
import { EVENT_SPEND_CATEGORIES } from '../sim/embedded-finance';
import { longDate, money, percent, shortDate } from '../sim/format';
import { organizerBase } from '../nav';
import type { FundingOutlook, OrganizerMoney } from '../sim/money';
import { dashboardOnly, ef, mcp } from '../stripe-sim';
import { sortRecommendations, type Recommendation } from './types';

/**
 * Recommendations for one organizer's money pages.
 *
 * Each function looks at one page's rows and returns nothing when there is
 * nothing to say. That is the important property: a panel that always has three
 * items is a panel nobody reads, because it is obviously generated rather than
 * observed.
 */

/** Calendar-month window, since that is what a monthly limit resets on. */
function monthBounds(): { start: number; daysLeft: number } {
  const d = new Date(NOW * 1000);
  const start = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  const next = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000);
  return { start, daysLeft: Math.max(0, Math.round((next - NOW) / DAY)) };
}

/* -------------------------------------------------------------------------- */
/* Event Account                                                              */
/* -------------------------------------------------------------------------- */

export function eventAccountRecommendations(m: OrganizerMoney): Recommendation[] {
  const out: Recommendation[] = [];
  const fa = m.financialAccount;

  if (!fa) {
    // The only thing to say when there is no account is how to get one, and that
    // is not an API call.
    out.push({
      id: 'no_account',
      tone: 'info',
      title: 'No stored balance on this account',
      why: `Ticket revenue reaches ${m.account.business_profile_name} as a payout to their own bank on a ${m.settlementCadence} schedule, and they pay suppliers from there.`,
      next: 'Opening an Event Account removes that hop, but Treasury has to be enabled on the platform first.',
      dashboardOnly: dashboardOnly(
        'treasury_enablement',
        'Treasury is invite-only and underwritten by Stripe with its bank partners. Nothing in the API requests the capability.',
      ),
    });
    return out;
  }

  const inFlight = m.payments.filter((p) => p.status === 'processing');
  const lastOut = m.payments.find((p) => p.status === 'posted');
  const idleDays = lastOut ? Math.round((NOW - lastOut.created) / DAY) : null;

  /* ------------------------- money committed twice ----------------------- */

  if (inFlight.length > 0) {
    out.push({
      id: 'committed_out',
      tone: 'watch',
      title: `${money(fa.balance_outbound_pending)} is committed but not gone`,
      why: `${inFlight.length === 1 ? 'One payment is' : `${inFlight.length} payments are`} in flight, arriving ${longDate(inFlight[0].expected_arrival_date)}. The balance still shows ${money(fa.balance_cash)}, but only ${money(m.spendable)} of it can be committed again.`,
      next: 'Work from the spendable figure. Committing against cash is how a deposit gets promised twice, and it fails as a returned payment to the supplier rather than an error on screen.',
    });
  }

  /* ---------------------------- idle balance ----------------------------- */

  // Only worth raising when there is enough sitting there to matter and an event
  // ahead that the money is presumably for.
  if (idleDays != null && idleDays >= 21 && fa.balance_cash > 5_000_00) {
    out.push({
      id: 'idle_balance',
      tone: 'info',
      title: `Nothing has left this balance in ${idleDays} days`,
      why: `${money(fa.balance_cash)} is sitting here and the last vendor payment posted ${longDate(lastOut!.created)}.`,
      next: 'Not a problem in itself — but if supplier invoices are being paid from a bank account instead, the money is taking the long way round and landing in two places in the books.',
      ask: 'Can I pay my staging vendor out of my balance?',
    });
  }

  /* ----------------------- inbound not yet spendable --------------------- */

  if (fa.balance_inbound_pending > 0) {
    out.push({
      id: 'inbound_pending',
      tone: 'info',
      title: `${money(fa.balance_inbound_pending)} is on the way in`,
      why: `The most recent ticket-revenue sweep has not settled yet. It is not in the ${money(fa.balance_cash)} balance and cannot be spent until it lands.`,
      next: m.nextSettlement
        ? `Next settlement is ${longDate(m.nextSettlement)}.`
        : undefined,
    });
  }

  /* --------------------------- live balance read ------------------------- */

  // A genuine MCP read: the warehouse copy is a snapshot, the API is current.
  out.push({
    id: 'verify_balance',
    tone: 'info',
    title: 'This page reads a warehouse copy, not the live balance',
    why: `Data Pipeline writes on a schedule, so ${money(fa.balance_cash)} is as of the last load. Before committing a large payment it is worth reading the live figure.`,
    action: {
      id: 'rec_retrieve_balance',
      label: 'Read the live balance',
      surface: 'mcp',
      callLabel: 'retrieve_balance',
      method: 'GET',
      path: '/v1/balance',
      stripeAccount: m.account.id,
      plainEnglish: `Reads the current Stripe balance for ${m.account.business_profile_name} rather than the nightly warehouse copy this page renders. Read-only — nothing changes.`,
      params: { stripe_account: m.account.id },
      totals: [
        { label: 'Warehouse figure', value: money(fa.balance_cash) },
        { label: 'Effect', value: 'None — this is a read' },
      ],
      variant: 'secondary',
      run: (ctx, options) =>
        mcp.retrieve_balance(
          ctx,
          { stripe_account: m.account.id },
          { idempotencyKey: options.idempotencyKey },
        ),
    },
  });

  return sortRecommendations(out);
}

/* -------------------------------------------------------------------------- */
/* Production Cards                                                           */
/* -------------------------------------------------------------------------- */

export function productionCardRecommendations(m: OrganizerMoney): Recommendation[] {
  const out: Recommendation[] = [];
  const { start: monthStart, daysLeft } = monthBounds();

  if (m.cards.length === 0) {
    out.push({
      id: 'no_cards',
      tone: 'info',
      title: 'No cards issued to this team',
      why: m.financialAccount
        ? `There is an Event Account with ${money(m.spendable)} spendable to fund cards from, but nobody holds one.`
        : 'Cards draw on a stored balance, and this organizer does not have one.',
      next: m.financialAccount
        ? 'Issuing a card is two calls: a cardholder, then a card with its spending controls attached.'
        : 'The Event Account comes first, then the card_issuing capability, then cards.',
      ask: 'Give my production lead a card with a monthly limit',
    });
    return out;
  }

  const holderById = new Map(m.cardholders.map((c) => [c.id, c]));
  const approved = m.authorizations.filter((a) => a.approved);
  const declined = m.authorizations.filter((a) => !a.approved);

  /* ------------------- declines clustered in one category ---------------- */

  // A repeated decline in the same category is the interesting case: either the
  // spend is off-policy and the control is doing its job, or the allow-list is
  // wrong. Both are worth a decision; a one-off is not.
  // Only category declines. A spending-limit decline happens in an *allowed*
  // category, so treating it as an allow-list problem would propose adding a
  // category that is already there — and would not fix the actual cause.
  const categoryDeclines = declined.filter(
    (a) => a.decline_reason === 'card_controls_merchant_category',
  );
  const limitDeclines = declined.filter(
    (a) => a.decline_reason === 'card_controls_spending_limit',
  );

  const byCategory = new Map<string, typeof declined>();
  for (const auth of categoryDeclines) {
    const list = byCategory.get(auth.merchant_category) ?? [];
    list.push(auth);
    byCategory.set(auth.merchant_category, list);
  }
  const clustered = Array.from(byCategory.entries())
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (limitDeclines.length > 0) {
    const amount = limitDeclines.reduce((s, a) => s + a.amount, 0);
    const first = limitDeclines[0];
    const card = m.cards.find((c) => c.id === first.card_id);
    const holder = card ? holderById.get(card.cardholder_id) : undefined;
    out.push({
      id: 'limit_declines',
      tone: 'watch',
      title: `${limitDeclines.length} ${limitDeclines.length === 1 ? 'purchase was' : 'purchases were'} refused for hitting a monthly ceiling`,
      why: `${money(amount)} declined — ${money(first.amount)} at ${first.merchant_name} on ${longDate(first.created)} was in an allowed category, but would have taken ${holder?.name ?? 'the cardholder'} past their ${money(card?.spending_limit_amount ?? 0)} monthly limit.`,
      next: 'This is a different problem from an off-policy purchase, and widening the allow-list would not fix it. Either the ceiling is set too low for how this role actually spends, or the spend needs approving as an exception.',
    });
  }

  if (categoryDeclines.length === 0 && limitDeclines.length === 0) {
    // Worth one line rather than silence: zero declines is ambiguous, and which
    // of the two readings applies is something only the organizer knows.
    out.push({
      id: 'no_declines',
      tone: 'info',
      title: 'Nothing has been refused by the spending controls',
      why: `${approved.length} authorisations, none declined. The allow-lists cover ${m.cards.map((c) => c.allowed_categories.length).join(', ')} categories across ${m.cards.length} ${m.cards.length === 1 ? 'card' : 'cards'}.`,
      next: 'Either the lists match how this team actually spends, or nobody has tried to spend outside them yet. Those look identical from here and only the first is a result.',
    });
  } else if (categoryDeclines.length > 0 && !clustered) {
    // A one-off is the control working. There is nothing to decide, so it gets a
    // card without a button — naming the merchant is the whole value.
    const one = categoryDeclines[0];
    out.push({
      id: 'single_decline',
      tone: 'info',
      title: `The controls refused ${categoryDeclines.length === 1 ? 'a purchase' : `${categoryDeclines.length} purchases`} at the till`,
      why: `${money(one.amount)} at ${one.merchant_name} on ${longDate(one.created)} — ${one.merchant_category.replace(/_/g, ' ')} is not on the cardholder's allow-list. ${categoryDeclines.length === 1 ? 'No other purchase has been refused on category.' : 'The rest were spread across different categories, so there is no pattern to act on.'}`,
      next: 'Nothing to do. This is the difference between a card and an expenses policy: the purchase failed when it was attempted rather than surfacing in a reconciliation weeks later.',
    });
  }

  if (clustered) {
    const [category, list] = clustered;
    const amount = list.reduce((s, a) => s + a.amount, 0);
    const card = m.cards.find((c) => c.id === list[0].card_id);
    const holder = card ? holderById.get(card.cardholder_id) : undefined;
    const pretty = category.replace(/_/g, ' ');

    out.push({
      id: `declines_${category}`,
      tone: 'watch',
      title: `${list.length} declines at ${pretty}, all on the same category`,
      why: `${money(amount)} refused across ${list.length} attempts — ${list.map((a) => a.merchant_name).slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}. ${pretty} is not on ${holder?.name ?? 'the cardholder'}'s allow-list.`,
      next: `Two readings, and they need opposite responses. If this is off-policy spend, the control is working and nothing should change. If it is legitimate event cost, the allow-list is too narrow and widening it is one call — which is the argument for setting these tight at creation rather than loose.`,
      action:
        card && !card.allowed_categories.includes(category)
          ? {
              id: `rec_allow_${category}`,
              label: `Add ${pretty} to the allow-list`,
              surface: 'api',
              callLabel: 'POST /v1/issuing/cards/:id',
              method: 'POST',
              path: `/v1/issuing/cards/${card.id}`,
              stripeAccount: m.account.id,
              plainEnglish: `Adds ${pretty} to the categories ${holder?.name ?? 'this cardholder'} can spend at, taking the allow-list from ${card.allowed_categories.length} to ${card.allowed_categories.length + 1} categories. It applies from the next authorisation — the ${list.length} already declined stay declined.`,
              params: {
                spending_controls: {
                  allowed_categories: [...card.allowed_categories, category],
                },
              },
              totals: [
                { label: 'Cardholder', value: holder?.name ?? card.id },
                {
                  label: 'Allow-list',
                  value: `${card.allowed_categories.length} → ${card.allowed_categories.length + 1}`,
                },
                { label: 'Monthly ceiling', value: 'Unchanged' },
                {
                  label: 'Retroactive',
                  value: 'No — the declines stand',
                  tone: 'warn',
                },
              ],
              variant: 'secondary',
              run: (ctx, options) =>
                ef.updateIssuingCard(
                  ctx,
                  m.account.id,
                  card.id,
                  {
                    spending_controls: {
                      allowed_categories: [...card.allowed_categories, category],
                    },
                  },
                  { idempotencyKey: options.idempotencyKey },
                ),
            }
          : undefined,
    });
  }

  /* ------------------------- a card near its ceiling --------------------- */

  for (const card of m.cards) {
    const limit = card.spending_limit_amount ?? 0;
    if (limit <= 0) continue;
    const spend = approved
      .filter((a) => a.card_id === card.id && a.created >= monthStart)
      .reduce((s, a) => s + a.amount, 0);
    if (spend / limit < 0.8) continue;

    const holder = holderById.get(card.cardholder_id);
    const raised = Math.round((limit * 1.5) / 100_000) * 100_000;

    out.push({
      id: `ceiling_${card.id}`,
      tone: 'act',
      title: `${holder?.name ?? 'A cardholder'} is at ${percent(spend / limit, 0)} of their monthly ceiling`,
      why: `${money(spend)} spent against a ${money(limit)} limit, with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in the month. The next authorisation over ${money(limit - spend)} will be declined.`,
      next:
        m.spendable < raised
          ? `Raising the ceiling to ${money(raised)} would put it above the ${money(m.spendable)} the balance can actually fund, which moves the decline from the card to the balance rather than removing it. Top the balance up first.`
          : `Raising it to ${money(raised)} takes effect on the next authorisation.`,
      action: {
        id: `rec_raise_${card.id}`,
        label: `Raise to ${money(raised)}`,
        surface: 'api',
        callLabel: 'POST /v1/issuing/cards/:id',
        method: 'POST',
        path: `/v1/issuing/cards/${card.id}`,
        stripeAccount: m.account.id,
        plainEnglish: `Raises ${holder?.name ?? 'this cardholder'}'s monthly ceiling from ${money(limit)} to ${money(raised)}. The category allow-list is unchanged, so this widens how much they can spend and not where.`,
        params: {
          spending_controls: {
            spending_limits: [{ amount: raised, interval: 'monthly' }],
          },
        },
        totals: [
          { label: 'Cardholder', value: holder?.name ?? card.id },
          { label: 'Ceiling', value: `${money(limit)} → ${money(raised)}` },
          { label: 'Spent this month', value: money(spend) },
          {
            label: 'Funded by balance',
            value: money(m.spendable),
            tone: m.spendable < raised ? 'warn' : 'neutral',
          },
        ],
        // Raising a spend ceiling above what the funding source covers is the
        // failure mode worth a second look.
        requiresSecondAck: m.spendable < raised,
        secondAckLabel: `I understand the balance only covers ${money(m.spendable)} of this`,
        variant: 'primary',
        run: (ctx, options) =>
          ef.updateIssuingCard(
            ctx,
            m.account.id,
            card.id,
            {
              spending_controls: {
                spending_limits: [{ amount: raised, interval: 'monthly' }],
              },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
    });
  }

  /* ---------------- combined ceilings exceed the funding ----------------- */

  if (m.cardLimitTotal > m.spendable && m.spendable > 0) {
    out.push({
      id: 'ceilings_exceed_balance',
      tone: 'watch',
      title: 'The cards could authorise more than the balance holds',
      why: `${money(m.cardLimitTotal)} of combined monthly ceiling against ${money(m.spendable)} spendable. If every cardholder spent to their limit in the same month, authorisations would start failing for insufficient funds rather than for policy.`,
      next: 'Not wrong — ceilings are per person and rarely all used at once. Worth knowing which constraint bites first, because the two decline reasons look very different to whoever is standing at the till.',
      ask: 'Can I pay my staging vendor out of my balance?',
    });
  }

  /* --------------------- a cardholder with no card ----------------------- */

  const cardless = m.cardholders.filter(
    (holder) => !m.cards.some((card) => card.cardholder_id === holder.id),
  );
  for (const holder of cardless) {
    out.push({
      id: `cardless_${holder.id}`,
      tone: 'watch',
      title: `${holder.name} is a cardholder with no card`,
      why: `Created ${longDate(holder.created)} as a ${holder.role.toLowerCase()}, but no card was ever issued — so they can spend nothing.`,
      next: 'A cardholder on its own holds no money and has no number. The card is the second call.',
      action: {
        id: `rec_card_for_${holder.id}`,
        label: `Issue a card to ${holder.name}`,
        surface: 'api',
        callLabel: 'POST /v1/issuing/cards',
        method: 'POST',
        path: '/v1/issuing/cards',
        stripeAccount: m.account.id,
        plainEnglish: `Issues a virtual card to ${holder.name} with a ${money(500_000)} monthly ceiling, restricted to ${EVENT_SPEND_CATEGORIES.slice(0, 5).length} event-spend categories. Anything outside them is declined by the network at authorisation.`,
        params: {
          cardholder: holder.id,
          currency: 'usd',
          type: 'virtual',
          spending_controls: {
            spending_limits: [{ amount: 500_000, interval: 'monthly' }],
            allowed_categories: EVENT_SPEND_CATEGORIES.slice(0, 5),
          },
        },
        totals: [
          { label: 'Cardholder', value: holder.name },
          { label: 'Monthly ceiling', value: money(500_000) },
          { label: 'Allowed categories', value: '5' },
        ],
        variant: 'primary',
        run: (ctx, options) =>
          ef.createIssuingCard(
            ctx,
            m.account.id,
            {
              cardholder: holder.id,
              currency: 'usd',
              type: 'virtual',
              spending_controls: {
                spending_limits: [{ amount: 500_000, interval: 'monthly' }],
                allowed_categories: EVENT_SPEND_CATEGORIES.slice(0, 5),
              },
              metadata: { role: holder.role },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
    });
  }

  return sortRecommendations(out);
}

/* -------------------------------------------------------------------------- */
/* Event Advance                                                              */
/* -------------------------------------------------------------------------- */

export function eventAdvanceRecommendations(m: OrganizerMoney): Recommendation[] {
  const out: Recommendation[] = [];
  const trailing = Number(m.account.metadata.trailing_volume);
  const dailyVolume = trailing / 90;

  if (m.advance) {
    const a = m.advance;
    const withhold = Number(a.withhold_rate);
    const daily = dailyVolume * withhold;
    const daysLeft = daily > 0 ? a.remaining_amount / daily : 0;

    out.push({
      id: 'advance_running',
      tone: 'info',
      title: `${money(a.remaining_amount)} left to repay, about ${Math.round(daysLeft)} days at the current rate`,
      why: `${percent(withhold, 1)} of every payment is withheld, which is roughly ${money(Math.round(daily))} a day on ${money(Math.round(dailyVolume))} of daily sales.`,
      next: 'Nothing to do. Repayment is automatic out of ticket sales and there is no instalment to miss — sell more and it clears sooner.',
    });

    // Two advances cannot run at once, so this is the only thing worth saying
    // about a new one.
    out.push({
      id: 'advance_no_stacking',
      tone: 'info',
      title: 'No new advance while this one runs',
      why: 'Stripe writes one financing offer at a time per account.',
      next: `Once ${money(a.remaining_amount)} has been withheld, a new offer is usually written.`,
    });
    return out;
  }

  const offer = m.offer;
  const live = offer && (offer.status === 'undelivered' || offer.status === 'delivered');

  if (offer && live) {
    const total = offer.offered_amount + offer.fee_amount;
    const withhold = Number(offer.withhold_rate);
    const daily = dailyVolume * withhold;
    const paybackDays = daily > 0 ? total / daily : 0;
    const daysToLapse = Math.max(0, Math.round((offer.expires_after - NOW) / DAY));

    out.push({
      id: 'offer_lapsing',
      tone: daysToLapse <= 7 ? 'act' : 'watch',
      title:
        daysToLapse <= 7
          ? `The ${money(offer.offered_amount)} offer lapses in ${daysToLapse} ${daysToLapse === 1 ? 'day' : 'days'}`
          : `${money(offer.offered_amount)} is available for ${daysToLapse} more days`,
      why: `Offers run 30 days from the day Stripe writes them. This one closes ${longDate(offer.expires_after)} and Stripe does not extend it.`,
      next: `Reading the terms commits nothing. Accepting is the organizer's decision and happens in Stripe's own flow — there is no endpoint that agrees to ${money(total)} of liability on a business's behalf.`,
      action: {
        id: 'rec_open_terms',
        label: 'Open the financing terms',
        surface: 'api',
        callLabel: 'POST /v1/account_sessions',
        method: 'POST',
        path: '/v1/account_sessions',
        plainEnglish: `Mints a short-lived session so ${m.account.business_profile_name} can read Stripe's terms for the ${money(offer.offered_amount)} offer, embedded in this page. Nothing is borrowed and nothing is agreed by this call.`,
        params: {
          account: m.account.id,
          components: {
            capital_financing: { enabled: true },
            capital_financing_promotion: { enabled: true },
          },
        },
        totals: [
          { label: 'Offer', value: money(offer.offered_amount) },
          { label: 'Total repayable', value: money(total) },
          { label: 'Borrowed by this call', value: 'Nothing' },
        ],
        variant: 'primary',
        run: (ctx, options) =>
          ef.createAccountSession(
            ctx,
            {
              account: m.account.id,
              components: {
                capital_financing: { enabled: true },
                capital_financing_promotion: { enabled: true },
              },
            },
            { idempotencyKey: options.idempotencyKey },
          ),
      },
      dashboardOnly: dashboardOnly(
        'capital_offer_acceptance',
        `${m.account.business_profile_name} accepts the ${money(offer.offered_amount)} themselves. The platform can embed the flow; it cannot complete it.`,
      ),
    });

    // Cash-flow warning, only where it actually applies.
    if (paybackDays > 0) {
      out.push({
        id: 'offer_cashflow',
        tone: 'info',
        title: `Repaying would take about ${Math.round(paybackDays / 7)} weeks and cost ${percent(withhold, 1)} of every sale`,
        why: `At ${money(Math.round(dailyVolume))} a day of ticket sales, ${percent(withhold, 1)} is roughly ${money(Math.round(daily))} a day coming off the top until ${money(total)} is repaid.`,
        next: 'The fee is fixed, so repaying faster does not make it cheaper. What to weigh is the cash flow — that withholding is money not available while supplier terms are landing.',
        ask: 'Can I get an advance to cover my venue deposit?',
      });
    }

    if (!offer.delivered_at) {
      out.push({
        id: 'offer_not_surfaced',
        tone: 'watch',
        title: 'This offer has never been formally surfaced',
        why: `Stripe wrote it ${longDate(offer.created)} and it still sits in \`undelivered\` — meaning the platform has not recorded showing it to ${m.account.business_profile_name}.`,
        next: 'Marking it delivered is a platform-side step and moves no money. It lapses on schedule either way.',
        ask: 'Which organizers could be offered financing?',
      });
    }

    return sortRecommendations(out);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The organizer dashboard panel.
 *
 * Three signals, matching what the deck promises LEO does: flag funding gaps,
 * flag unusual spending, and surface opportunities to improve event economics.
 * Each is derived or it does not render — there is no third card for the sake of
 * having three.
 */
export function organizerDashboardRecommendations(
  m: OrganizerMoney,
  outlook: FundingOutlook | null,
  summary: { averageOrderValue: number; walletShare: number; bnplShare: number },
  payOverTimeEnabled: boolean,
): Recommendation[] {
  const out: Recommendation[] = [];
  const base = organizerBase(m.account.id);

  /* --------------------------- 1. funding gap ---------------------------- */

  if (outlook?.shortfall) {
    const s = outlook.shortfall;
    const o = s.obligation;
    const offer = m.offer;
    const live = offer && (offer.status === 'undelivered' || offer.status === 'delivered');

    // Capital funds in one to three business days. Whether that clears the due
    // date is the thing that decides what to do, so it leads.
    const inTime = s.dueInDays >= 3;
    const covers = live && offer.offered_amount >= s.amount;

    // Never "due in 0 days" — a deadline today reads as one already missed.
    const due =
      s.dueInDays <= 0
        ? 'is due today'
        : s.dueInDays === 1
          ? 'is due tomorrow'
          : `is due in ${s.dueInDays} days`;

    out.push({
      id: 'funding_gap',
      tone: s.dueInDays <= 7 ? 'act' : 'watch',
      title: `${money(o.amount)} ${o.counterparty ? `to ${o.counterparty} ` : ''}${due} — funds on Stripe come up ${money(s.amount)} short`,
      why: [
        `${o.label}${o.counterparty ? `, ${o.counterparty}` : ''}, ${money(o.amount)}, due ${longDate(o.dueDate)}.`,
        `Everything due by then totals ${money(s.cumulativeDue)} against ${money(s.projectedFunds)} projected reachable.`,
        s.heldByPreEventHold && outlook.nextEvent
          ? `Ticket revenue from ${outlook.nextEvent.name} does not count toward that: this account settles after the event, so Marquee holds it until doors open ${longDate(outlook.nextEvent.starts_at)}.`
          : `Projected from ${money(Math.round(outlook.dailyRevenue))} a day of ticket revenue.`,
      ].join(' '),
      next: live
        ? [
            covers
              ? `The ${money(offer.offered_amount)} Event Advance already underwritten covers it.`
              : `The ${money(offer.offered_amount)} Event Advance covers part of it.`,
            inTime
              ? `Capital funds in one to three business days, so there is room before ${shortDate(o.dueDate)} — but not much.`
              : `Capital funds in one to three business days, so it will not clear ${shortDate(o.dueDate)}. Supplier terms are the faster lever here; an advance still helps with what comes after.`,
            'This only counts money on Stripe. If the shortfall is already covered from a bank account, nothing needs doing.',
          ].join(' ')
        : 'No financing offer is written on this account, so an advance is not an option today — underwriting is Stripe\'s decision, not the platform\'s. The realistic moves are supplier terms or funds from outside Stripe. This projection only sees money on Stripe.',
      ask: live
        ? o.counterparty
          ? `Can an advance cover the ${o.label.toLowerCase()} due to ${o.counterparty}?`
          : 'Can an advance cover what is due before my next event?'
        : 'Which organizers could be offered financing?',
    });
  } else if (outlook && outlook.obligations.length > 0) {
    const horizon = outlook.obligations.filter(
      (o) => (o.dueDate - NOW) / DAY <= 21 && o.dueDate >= NOW,
    );
    if (horizon.length > 0) {
      const total = horizon.reduce((sum, o) => sum + o.amount, 0);
      out.push({
        id: 'funding_covered',
        tone: 'info',
        title: `${money(total)} of supplier bills due in the next three weeks, and the money is there`,
        why: `${horizon.length} ${horizon.length === 1 ? 'obligation' : 'obligations'} against ${money(outlook.reachableNow)} reachable now${outlook.dailyRevenue > 0 ? ` plus about ${money(Math.round(outlook.dailyRevenue))} a day arriving` : ''}.${outlook.bufferDays != null ? ` That is roughly ${Math.round(outlook.bufferDays)} days of cash buffer at the current spend rate.` : ''}`,
        next: 'Nothing to do. Worth re-checking if a large bill lands or the next event sells behind forecast.',
      });
    }
  }

  /* ------------------------- 2. unusual spending ------------------------- */

  // An outlier against this organizer's own history, not against a global
  // threshold — a $40,000 freight invoice is unremarkable for a festival and
  // extraordinary for a comedy club.
  const approved = m.authorizations.filter((a) => a.approved);
  if (approved.length >= 5) {
    const amounts = approved.map((a) => a.amount).sort((x, y) => x - y);
    const median = amounts[Math.floor(amounts.length / 2)];
    const biggest = approved.slice().sort((a, b) => b.amount - a.amount)[0];
    if (median > 0 && biggest.amount >= median * 2.5 && biggest.amount >= 500_00) {
      const card = m.cards.find((c) => c.id === biggest.card_id);
      const holder = m.cardholders.find((h) => h.id === card?.cardholder_id);
      out.push({
        id: 'unusual_spend',
        tone: 'watch',
        title: `${money(biggest.amount)} at ${biggest.merchant_name} is ${(biggest.amount / median).toFixed(1)}× this team's typical card spend`,
        why: `Approved on ${longDate(biggest.created)}${holder ? ` on ${holder.name}'s card` : ''}, in ${biggest.merchant_category.replace(/_/g, ' ')}. The median of the other ${approved.length - 1} approved authorisations is ${money(median)}.`,
        next: 'Large is not the same as wrong — a venue or freight settlement legitimately dwarfs everyday spend. Flagged because it is the kind of charge worth recognising rather than discovering at month end.',
        ask: 'Give my production lead a card with a monthly limit',
      });
    }
  }

  /* ------------------------- 3. event economics -------------------------- */

  // High average order value with pay-over-time switched off is the clearest
  // economics gap available from this data.
  if (summary.averageOrderValue >= 120_00 && !payOverTimeEnabled) {
    out.push({
      id: 'economics_pay_over_time',
      tone: 'info',
      title: `Average order is ${money(summary.averageOrderValue)} and pay-over-time is switched off at checkout`,
      why: `Wallets carry ${percent(summary.walletShare, 1)} of paid orders and pay-over-time ${percent(summary.bnplShare, 1)}. On tickets at this price, instalments are the option buyers most often look for and do not find.`,
      next: 'Enabling it is a commercial decision as much as a technical one — it costs more per transaction, so it pays off on higher-value tiers and not on cheap ones. Worth modelling against the actual tier mix before switching it on.',
      ask: 'Should I offer pay-over-time on my $300 VIP tier?',
    });
  } else if (summary.walletShare > 0 && summary.walletShare < 0.25) {
    out.push({
      id: 'economics_wallets',
      tone: 'info',
      title: `Wallets are ${percent(summary.walletShare, 1)} of paid orders`,
      why: `Apple Pay, Google Pay and Link together account for ${percent(summary.walletShare, 1)} of this account's orders. Wallet checkouts convert better than manually entered cards, and the gap usually comes from how the account was onboarded rather than from a decision anyone made.`,
      next: 'Worth confirming the payment method configuration has them on before putting effort anywhere else.',
      ask: "Which organizers' buyers would benefit from Apple Pay or pay-over-time?",
    });
  }

  return sortRecommendations(out);
}
