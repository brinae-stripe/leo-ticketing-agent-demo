import { DAY, NOW, SCALE_FACTOR } from './constants';
import { Rng } from './rng';
import type { Charge, PlatformEvent, VendorBill } from './types';

/**
 * What organizers owe their suppliers.
 *
 * Platform-side data, not a Stripe object. Marquee tracks it because event
 * production costs are the reason an organizer needs financing at all, and you
 * cannot flag a funding gap without knowing what is actually due and when.
 *
 * ## Why the gap exists at all
 *
 * Event costs are front-loaded and ticket revenue is not. A venue deposit, the
 * staging contract and the security booking all fall due in the weeks *before*
 * the doors open, while the money from that event arrives gradually as tickets
 * sell — and the platform holds it until the event has happened, because a
 * cancelled show means refunding buyers.
 *
 * So an organizer's spendable balance reflects events that have already run,
 * while the bills on their desk belong to the one that has not. That timing
 * mismatch is the whole case for an advance, and it is a property of the
 * business rather than something invented to make the demo work.
 */

/** Venues bill separately from the suppliers in the shared vendor list. */
const VENUE_LESSORS = [
  'Riverfront Park Authority',
  'Civic Center Management',
  'Exhibition Hall Group',
  'Old Mill Yard Holdings',
];

/**
 * Cost lines a live event actually incurs, with how far ahead each falls due and
 * who bills for it.
 *
 * Vendors are tied to the line rather than drawn at random, because a catering
 * company invoicing a talent guarantee is the sort of detail that quietly tells
 * a reader the data is fake.
 */
const COST_LINES: {
  description: string;
  /** Share of the event's expected gross this line typically runs. */
  share: [min: number, max: number];
  /** Days before doors open that it falls due. */
  dueBefore: [min: number, max: number];
  vendors: readonly string[];
}[] = [
  { description: 'Venue deposit', share: [0.14, 0.24], dueBefore: [3, 21], vendors: VENUE_LESSORS },
  { description: 'Staging and rigging', share: [0.06, 0.12], dueBefore: [2, 14], vendors: ['Northgate Staging & Rigging', 'Meridian Tent & Structure'] },
  { description: 'Audio and lighting rental', share: [0.04, 0.09], dueBefore: [1, 10], vendors: ['Halcyon Audio Rentals'] },
  { description: 'Security staffing', share: [0.03, 0.07], dueBefore: [-4, 7], vendors: ['Bright Line Security Services', 'Vantage Barricade Supply'] },
  { description: 'Print and signage', share: [0.01, 0.03], dueBefore: [5, 25], vendors: ['Copperfield Print Works'] },
  { description: 'Freight and logistics', share: [0.02, 0.05], dueBefore: [1, 9], vendors: ['Stonepath Freight'] },
  { description: 'Talent guarantee', share: [0.08, 0.18], dueBefore: [7, 30], vendors: ['Ridgeway Talent Buyers'] },
  { description: 'Catering and hospitality', share: [0.02, 0.06], dueBefore: [0, 8], vendors: ['Two Rivers Catering'] },
  { description: 'Event liability cover', share: [0.01, 0.03], dueBefore: [10, 30], vendors: ['Fielding Insurance Brokers'] },
];

export interface BillsInput {
  events: PlatformEvent[];
  /** Paid charges per event id, for sizing costs off expected gross. */
  paidChargesByEvent: Map<string, Charge[]>;
  /** Account ids that should get bills at all. */
  accountIds: Set<string>;
  /**
   * Everything the organizer can currently reach, at platform scale: Stripe
   * balance plus any stored balance.
   */
  liquidityByAccount: Map<string, number>;
  /** Platform-scale ticket revenue per day, from trailing volume. */
  dailyRevenueByAccount: Map<string, number>;
  /**
   * True when the organizer settles after the event rather than at charge time.
   *
   * This is the crux of the whole gap. Marquee does not release funds for an
   * event until the doors have closed — a cancelled show means refunding buyers
   * out of money the organizer would otherwise have spent. So for a post-event
   * organizer, the ticket revenue from the very event they are paying suppliers
   * to stage is *not* available to pay those suppliers with. Bills due before
   * doors open have to come out of the previous event's money.
   */
  settlesPostEvent: Set<string>;
  /** Obligations already on the books before bills: fees owed, payments in flight. */
  priorObligationsByAccount: Map<string, number>;
  /**
   * Accounts that should end up short. Everyone else is scaled to stay covered,
   * so the recommendation is selective rather than universal.
   */
  gapAccountIds: Set<string>;
}

/**
 * What "coverage" means here, because it is narrower than it sounds.
 *
 * Funds *on Stripe* — balance, stored balance, and ticket revenue arriving on
 * Stripe — against obligations due by a date. An organizer's working capital
 * mostly sits in their own bank, which this dataset does not model and the agent
 * cannot see. A shortfall against this number is a prompt to check, not a
 * verdict, and the recommendation reading it says exactly that.
 *
 * For gap accounts the stack is scaled so the shortfall at the anchor bill is
 * this fraction of projected funds. For everyone else, so obligations stay this
 * fraction below funds at every due date.
 */
const GAP_SHORTFALL_SHARE = [0.18, 0.55] as const;
const COVERED_HEADROOM = [0.45, 0.8] as const;

/** Window the anchor bill falls in: close enough to matter, far enough to act on. */
const ANCHOR_WINDOW_DAYS = [6, 20] as const;

/**
 * How close a bill can be to its due date and still be sitting unpaid.
 *
 * An invoice falling due tomorrow is not an open question — it has been paid, or
 * the organizer is already on the phone about it. Leaving one open produces a
 * card reporting a gap on a deadline no financing product could meet, which
 * reads as a broken flag rather than a useful one. Bills inside this window are
 * recorded as paid, the same as anything already past due.
 */
const MIN_OPEN_LEAD_DAYS = 3;

/**
 * Bound on how far scaling may move a line item.
 *
 * The share bands above are the realistic cost shape; without a bound, hitting a
 * funding target overrides them and produces a "venue deposit" worth 40% of an
 * event's gross. Wide, because event cost structures genuinely are — a touring
 * festival carrying a talent guarantee and a holiday light installation renting a
 * field have little in common beyond both being called an event.
 */
const SCALE_CLAMP = [0.25, 2.2] as const;

/**
 * Bills for the next event on each account.
 *
 * Only the next one. An organizer juggling six events' worth of payables at
 * once is a different business, and the recommendation that reads this is about
 * the immediate runway rather than a full AP ledger.
 */
export function generateVendorBills(input: BillsInput, seed: number): VendorBill[] {
  const rng = new Rng(seed);
  const bills: VendorBill[] = [];

  // The soonest on-sale event per account.
  const nextByAccount = new Map<string, PlatformEvent>();
  for (const event of input.events) {
    if (event.status !== 'on_sale' || event.starts_at <= NOW) continue;
    if (!input.accountIds.has(event.account_id)) continue;
    const current = nextByAccount.get(event.account_id);
    if (!current || event.starts_at < current.starts_at) {
      nextByAccount.set(event.account_id, event);
    }
  }

  for (const [accountId, event] of nextByAccount) {
    // Expected gross at platform scale. Tickets are still selling, so scale the
    // run rate up to a full house rather than using what has sold so far —
    // production is budgeted against the forecast, not against receipts.
    const sold = (input.paidChargesByEvent.get(event.id) ?? []).reduce(
      (sum, charge) => sum + (charge.amount - charge.amount_refunded),
      0,
    );
    const expectedGross = sold * SCALE_FACTOR * rng.between(1.15, 1.7);
    if (expectedGross < 500_000) continue;

    // Four to six cost lines per event, not all seven — a comedy club does not
    // book a talent guarantee and a staging contract for the same night.
    const draft = rng.sample(COST_LINES, rng.int(4, 6)).map((line) => {
      const dueBefore = rng.int(...line.dueBefore);
      const dueDate = event.starts_at - dueBefore * DAY;
      return {
        description: line.description,
        raw: expectedGross * rng.between(...line.share),
        dueDate,
        issuedAt: dueDate - rng.int(14, 45) * DAY,
        vendor: rng.pick(line.vendors),
      };
    });

    /* --------------------- scale to a funding outcome --------------------- */

    const stillOpenFrom = NOW + MIN_OPEN_LEAD_DAYS * DAY;
    const openDraft = draft.filter((line) => line.dueDate >= stillOpenFrom).sort(
      (a, b) => a.dueDate - b.dueDate,
    );
    if (openDraft.length === 0) continue;

    const liquidity = input.liquidityByAccount.get(accountId) ?? 0;
    const daily = input.dailyRevenueByAccount.get(accountId) ?? 0;
    const prior = input.priorObligationsByAccount.get(accountId) ?? 0;
    const heldUntilDoors = input.settlesPostEvent.has(accountId);

    /**
     * Funds reachable by a date.
     *
     * For a post-event organizer, nothing earned on the upcoming event counts
     * before doors open, because the platform is holding it. That is not a
     * modelling shortcut — it is the same hold the float scenario measures, seen
     * from the organizer's side of it.
     */
    const fundsAt = (ts: number) => {
      if (heldUntilDoors && ts < event.starts_at) return liquidity;
      return liquidity + daily * Math.max(0, (ts - NOW) / DAY);
    };

    // The bill the recommendation will point at: the first one far enough out to
    // do something about and near enough to matter.
    const anchor =
      openDraft.find((line) => {
        const days = (line.dueDate - NOW) / DAY;
        return days >= ANCHOR_WINDOW_DAYS[0] && days <= ANCHOR_WINDOW_DAYS[1];
      }) ?? openDraft[openDraft.length - 1];

    const throughAnchor = openDraft
      .filter((line) => line.dueDate <= anchor.dueDate)
      .reduce((sum, line) => sum + line.raw, 0);
    if (throughAnchor <= 0) continue;

    let scale: number;
    if (input.gapAccountIds.has(accountId)) {
      // Solve for a definite shortfall at the anchor date.
      const target =
        fundsAt(anchor.dueDate) * (1 + rng.between(...GAP_SHORTFALL_SHARE)) - prior;
      scale = target / throughAnchor;
    } else {
      // Solve so the last due date still has headroom, which keeps every date
      // before it covered too.
      const last = openDraft[openDraft.length - 1];
      const throughLast = openDraft.reduce((sum, line) => sum + line.raw, 0);
      const target = fundsAt(last.dueDate) * rng.between(...COVERED_HEADROOM) - prior;
      scale = target / throughLast;
    }
    scale = Math.min(SCALE_CLAMP[1], Math.max(SCALE_CLAMP[0], scale));

    for (const line of draft) {
      const amount = Math.round((line.raw * scale) / 10_000) * 10_000;
      if (amount < 100_000) continue;

      // Anything already due, or due inside the next few days, was paid on
      // time. Organizers that habitually miss supplier dates are a different
      // story, and not one this demo is making.
      const status: VendorBill['status'] =
        line.dueDate < stillOpenFrom ? 'paid' : 'open';

      bills.push({
        id: rng.id('bill', 20),
        account_id: accountId,
        event_id: event.id,
        vendor_name: line.vendor,
        description: line.description,
        amount,
        currency: 'usd',
        issued_at: line.issuedAt,
        due_date: line.dueDate,
        status,
        paid_by_payment_id: null,
      });
    }
  }

  return bills.sort((a, b) => a.due_date - b.due_date);
}
