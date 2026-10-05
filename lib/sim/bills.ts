import { DAY, NOW } from './constants';
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
}

/**
 * How expensive this organizer's production is, relative to the cost shares
 * above.
 *
 * A real spread, not a knob: a promoter who owns their staging and runs a
 * volunteer gate stages the same gross for a fraction of what a festival
 * trucking in a built site pays. This is the only per-organizer variation
 * applied, and it is why some organizers come up short and others do not.
 *
 * Bills used to be solved backwards instead — scaled until the shortfall at a
 * chosen bill hit a target fraction of projected funds. That worked while every
 * figure was multiplied by a hundred and collapsed the moment they were not: an
 * organizer's Stripe balance is near zero between weekly payouts, so solving
 * against it produced $300 venue deposits and a "funding gap" of $1,283 sitting
 * next to the offer of a $51,000 advance. Sizing costs off the event and letting
 * the shortfall fall out is both simpler and the only version that survives
 * someone checking it.
 */
const COST_INTENSITY = [0.7, 1.4] as const;

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

  // What this organizer's events typically gross, from the ones that have
  // finished. This is the budget line a production is actually costed against:
  // an organizer whose last three shows each took $50,000 books the next one
  // around $50,000.
  //
  // Not what the upcoming event has sold so far. That was the first version and
  // it reads plausibly until you notice an event that went on sale last week has
  // taken almost nothing, so its costs came out near zero and the venue deposit
  // on a real festival landed at $300. Sales-to-date measures how far through
  // the on-sale you are, not how big the event is.
  const typicalGross = new Map<string, number>();
  const grossByAccount = new Map<string, number[]>();
  for (const event of input.events) {
    if (event.status !== 'completed') continue;
    const gross = (input.paidChargesByEvent.get(event.id) ?? []).reduce(
      (sum, charge) => sum + (charge.amount - charge.amount_refunded),
      0,
    );
    if (gross <= 0) continue;
    const list = grossByAccount.get(event.account_id) ?? [];
    list.push(gross);
    grossByAccount.set(event.account_id, list);
  }
  for (const [accountId, list] of grossByAccount) {
    typicalGross.set(accountId, list.reduce((a, b) => a + b, 0) / list.length);
  }

  for (const [accountId, event] of nextByAccount) {
    const baseline = typicalGross.get(accountId);
    const soldSoFar = (input.paidChargesByEvent.get(event.id) ?? []).reduce(
      (sum, charge) => sum + (charge.amount - charge.amount_refunded),
      0,
    );
    // An organizer with no completed event has no history to budget from, so
    // fall back to the on-sale run rate — the weakest signal, used only where
    // there is nothing better.
    const expectedGross =
      baseline != null
        ? baseline * rng.between(0.9, 1.45)
        : soldSoFar * rng.between(1.5, 2.2);
    if (expectedGross < 25_000) continue;

    // Four to six cost lines per event, not all seven — a comedy club does not
    // book a talent guarantee and a staging contract for the same night.
    const intensity = rng.between(...COST_INTENSITY);
    const draft = rng.sample(COST_LINES, rng.int(4, 6)).map((line) => {
      const dueBefore = rng.int(...line.dueBefore);
      const dueDate = event.starts_at - dueBefore * DAY;
      return {
        description: line.description,
        raw: expectedGross * rng.between(...line.share) * intensity,
        dueDate,
        issuedAt: dueDate - rng.int(14, 45) * DAY,
        vendor: rng.pick(line.vendors),
      };
    });

    const stillOpenFrom = NOW + MIN_OPEN_LEAD_DAYS * DAY;

    for (const line of draft) {
      // Round to $50 and drop anything under $250 — a supplier invoice is a
      // round-ish number, but rounding to $10,000 as this did while amounts were
      // a hundred times larger now quantises a $3,000 print bill into nothing.
      const amount = Math.round(line.raw / 5_000) * 5_000;
      if (amount < 25_000) continue;

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
