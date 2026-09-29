'use client';

import { Info, LockKeyhole, TrendingUp } from 'lucide-react';
import * as React from 'react';

import { AskAgentButton } from '@/components/layout/app-shell';
import { SimGate } from '@/components/layout/sim-gate';
import { Recommendations } from '@/components/money/recommendations';
import {
  DefinitionRow,
  MoneyStat,
  PlatformScaleNote,
  SectionHeading,
} from '@/components/money/money-ui';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
  Skeleton,
} from '@/components/ui/primitives';
import { CAPITAL_ELIGIBILITY } from '@/lib/sim/embedded-finance';
import { NOW, DAY } from '@/lib/sim/constants';
import { longDate, money, percent, untilLabel } from '@/lib/sim/format';
import { eventAdvanceRecommendations } from '@/lib/recommendations/organizer';
import { organizerMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';

/**
 * Event Advance — Capital.
 *
 * The page translates a withhold rate into a payback period, because "17% of
 * every payment" is not a number anyone can decide on and "about nine weeks" is.
 *
 * It also stops where the product stops. An organizer takes on the liability, so
 * the organizer agrees to the terms in a Stripe-hosted surface the platform can
 * embed but cannot complete. There is no endpoint that accepts an offer for
 * someone else, so the page says so rather than rendering a button that would be
 * lying about what it does.
 */
export function EventAdvancePage({ accountId }: { accountId: string }) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <SimGate
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <Body accountId={accountId} />
      </SimGate>
    </div>
  );
}

function Body({ accountId }: { accountId: string }) {
  const { data, index } = useSim();
  const m = React.useMemo(() => organizerMoney(data, index, accountId), [accountId, data, index]);

  if (!m) return <EmptyState title="No such organizer" description="Pick one from the switcher." />;

  // The account's own field: platform scale, fixture-corrected, and the same
  // number the offer was sized against.
  const trailing = Number(m.account.metadata.trailing_volume);
  const dailyVolume = trailing / 90;

  /* ----------------------------- drawn advance --------------------------- */

  if (m.advance) {
    const a = m.advance;
    const total = a.advance_amount + a.fee_amount;
    const repaid = total - a.remaining_amount;
    const withhold = Number(a.withhold_rate);
    const dailyRepayment = dailyVolume * withhold;
    const daysLeft = dailyRepayment > 0 ? a.remaining_amount / dailyRepayment : 0;

    return (
      <>
        <SectionHeading
          title="Event Advance"
          blurb="Funding drawn against future ticket sales, repaid automatically as they come in."
          actions={
            <AskAgentButton question="Can I get an advance to cover my venue deposit?">
              Ask about repayment
            </AskAgentButton>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyStat label="Advanced" value={money(a.advance_amount)} hint={longDate(a.paid_out_at)} />
          <MoneyStat label="Flat fee" value={money(a.fee_amount)} hint="No interest, no instalments" />
          <MoneyStat label="Repaid so far" value={money(repaid)} hint={`of ${money(total)}`} tone="good" />
          <MoneyStat
            label="Still outstanding"
            value={money(a.remaining_amount)}
            hint={`~${Math.round(daysLeft)} days at your current sales rate`}
            tone="warn"
          />
        </div>

        <Recommendations
          items={eventAdvanceRecommendations(m)}
          scope={{ id: 'page_event_advance', title: 'Event Advance' }}
          className="mt-8"
        />

        <Card className="mt-8">
          <CardHeader>
            <div>
              <CardTitle>Repayment</CardTitle>
              <CardDescription>
                {percent(withhold, 1)} of every payment you take is withheld until{' '}
                {money(total)} is repaid. Sell more and it clears faster; sell less and it takes
                longer. There is no date you can miss.
              </CardDescription>
            </div>
            <Badge tone="blue">{percent(repaid / total, 0)} repaid</Badge>
          </CardHeader>
          <CardBody>
            <Progress value={repaid} total={total} />
            <dl className="mt-5">
              <DefinitionRow label="Withhold rate" value={percent(withhold, 1)} />
              <DefinitionRow
                label="Your sales rate"
                value={`${money(Math.round(dailyVolume))} a day`}
                hint="Trailing 90 days"
              />
              <DefinitionRow
                label="Repaying at"
                value={`~${money(Math.round(dailyRepayment))} a day`}
              />
              <DefinitionRow
                label="Projected clear"
                value={
                  daysLeft > 0 ? longDate(NOW + Math.round(daysLeft) * DAY) : 'Cleared'
                }
                hint="Moves with your sales"
              />
            </dl>
          </CardBody>
        </Card>

        <PlatformScaleNote className="mt-6" />
      </>
    );
  }

  /* ------------------------------ live offer ----------------------------- */

  const offer = m.offer;
  const live = offer && (offer.status === 'undelivered' || offer.status === 'delivered');

  if (offer && live) {
    const total = offer.offered_amount + offer.fee_amount;
    const withhold = Number(offer.withhold_rate);
    const dailyRepayment = dailyVolume * withhold;
    const paybackDays = dailyRepayment > 0 ? total / dailyRepayment : 0;
    const paybackWeeks = Math.round(paybackDays / 7);
    const effectiveCost = offer.offered_amount > 0 ? offer.fee_amount / offer.offered_amount : 0;

    return (
      <>
        <SectionHeading
          title="Event Advance"
          blurb="Funding against future ticket sales, to cover costs that land before the money does."
          actions={
            <AskAgentButton question="Can I get an advance to cover my venue deposit?">
              Talk it through
            </AskAgentButton>
          }
        />

        <Card className="border-blue-200 bg-blue-50/40">
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" aria-hidden />
                  <p className="text-[12.5px] font-semibold uppercase tracking-wide text-blue-700">
                    Available to draw
                  </p>
                </div>
                <p className="nums font-display mt-1.5 text-[38px] font-black leading-none text-gray-900">
                  {money(offer.offered_amount)}
                </p>
                <p className="mt-2 text-[13px] text-gray-600">
                  A flat {money(offer.fee_amount)} fee — {percent(effectiveCost, 1)} of the
                  amount. No interest and no instalment schedule.
                </p>
              </div>
              <div className="border-blue-200 sm:border-l sm:pl-6">
                <p className="text-[12.5px] text-gray-500">Offer lapses</p>
                <p className="font-display mt-0.5 text-[20px] font-bold text-gray-900">
                  {untilLabel(offer.expires_after, NOW)}
                </p>
                <p className="mt-0.5 text-[12px] text-gray-500">
                  {longDate(offer.expires_after)}
                </p>
                {!offer.delivered_at && (
                  <Badge tone="warn" className="mt-2">
                    Not yet surfaced
                  </Badge>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyStat label="Total repayable" value={money(total)} />
          <MoneyStat label="Withheld per sale" value={percent(withhold, 1)} />
          <MoneyStat
            label="Repaying at"
            value={`${money(Math.round(dailyRepayment))}/day`}
            hint={`On ${money(Math.round(dailyVolume))} a day of sales`}
          />
          <MoneyStat
            label="Payback period"
            value={paybackWeeks <= 1 ? '~1 week' : `~${paybackWeeks} weeks`}
            hint="Moves with your sales"
          />
        </div>

        <Recommendations
          items={eventAdvanceRecommendations(m)}
          scope={{ id: 'page_event_advance', title: 'Event Advance' }}
          className="mt-8"
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>How repayment works</CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <dl>
                <DefinitionRow label="Advance" value={money(offer.offered_amount)} />
                <DefinitionRow label="Flat fee" value={money(offer.fee_amount)} />
                <DefinitionRow label="Total repayable" value={money(total)} />
                <DefinitionRow
                  label="Withhold rate"
                  value={percent(withhold, 1)}
                  hint="Taken from each payment you receive"
                />
                <DefinitionRow
                  label="Trailing 90-day volume"
                  value={money(trailing)}
                  hint="What the offer was sized against"
                />
              </dl>
              <p className="mt-4 text-[12.5px] leading-relaxed text-gray-600">
                The fee is fixed, so repaying faster does not make it cheaper — there is no
                benefit to rushing. What to weigh instead is cash flow:{' '}
                {percent(withhold, 1)} of every payment is money you will not have while the
                advance runs, which matters most if you have supplier terms landing in the same
                window.
              </p>
            </CardBody>
          </Card>

          <Card className="border-gray-300">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4 text-gray-500" />
                  Accepting this is your decision
                </CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-[13px] leading-relaxed text-gray-700">
                {m.account.business_profile_name} takes on the {money(total)}, so{' '}
                {m.account.business_profile_name} has to agree to the terms — in a Stripe-hosted
                flow the platform can embed but cannot complete.
              </p>
              <p className="mt-2.5 text-[13px] leading-relaxed text-gray-700">
                There is no endpoint that accepts an offer on a business&apos;s behalf, by
                design. So this page ends here rather than showing a button that pretends
                otherwise — which is the honest shape even though it makes for a less tidy demo.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <AskAgentButton question="Can I get an advance to cover my venue deposit?">
                  Open the terms
                </AskAgentButton>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-gray-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                The agent mints a real{' '}
                <code className="font-mono text-[11.5px]">account_session</code> for the
                embedded component, which is the call a platform actually writes.
              </p>
            </CardBody>
          </Card>
        </div>

        <PlatformScaleNote className="mt-6" />
      </>
    );
  }

  /* ------------------------------- no offer ------------------------------ */

  const shortfall = CAPITAL_ELIGIBILITY.minTrailingVolume - trailing;
  const lapsed = offer && (offer.status === 'expired' || offer.status === 'canceled');

  return (
    <>
      <SectionHeading
        title="Event Advance"
        blurb="Funding against future ticket sales, when Stripe has underwritten an offer."
      />
      <Card>
        <CardBody>
          <p className="font-display text-[17px] font-bold text-gray-900">
            {lapsed ? 'The last offer lapsed unused' : 'No offer available today'}
          </p>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-gray-700">
            {lapsed
              ? `A ${money(offer.offered_amount)} offer was written and closed on ${longDate(offer.expires_after)} without being taken. Offers run ${CAPITAL_ELIGIBILITY.offerTermDays} days and then lapse.`
              : 'Stripe has not written a financing offer for this organizer.'}
          </p>
          <dl className="mt-4 max-w-md">
            <DefinitionRow
              label="Trailing 90-day volume"
              value={money(trailing)}
              hint="At platform scale"
            />
            <DefinitionRow
              label="Rough threshold"
              value={money(CAPITAL_ELIGIBILITY.minTrailingVolume)}
            />
            <DefinitionRow
              label="Gap"
              value={shortfall > 0 ? money(shortfall) : 'Clears the bar'}
            />
            <DefinitionRow
              label="Account standing"
              value={
                !m.account.payouts_enabled
                  ? 'Payouts disabled — this blocks it'
                  : m.account.requirements_past_due.length > 0
                    ? `${m.account.requirements_past_due.length} items past due`
                    : 'Good standing'
              }
            />
          </dl>
          <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-gray-500">
            The threshold above is the platform&apos;s approximation, not Stripe&apos;s decision.
            Underwriting is Stripe&apos;s own model and it weighs things the platform&apos;s
            warehouse cannot see — so treat this as a guide rather than a ruling.
          </p>
          <div className="mt-4">
            <AskAgentButton question="Which organizers could be offered financing?">
              See who is eligible across the platform
            </AskAgentButton>
          </div>
        </CardBody>
      </Card>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}
