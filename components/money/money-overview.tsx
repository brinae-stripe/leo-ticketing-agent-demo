'use client';

import { ArrowRight, CreditCard, Landmark, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AskAgentButton } from '@/components/layout/app-shell';
import { SimGate } from '@/components/layout/sim-gate';
import {
  ActivityTable,
  BalanceHero,
  MoneyStat,
  PlatformScaleNote,
  ProductTile,
  SectionHeading,
} from '@/components/money/money-ui';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui/primitives';
import { PLATFORM } from '@/lib/brand';
import { organizerBase } from '@/lib/nav';
import { longDate, money, percent } from '@/lib/sim/format';
import { organizerMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';

/**
 * The money section's front door.
 *
 * Deliberately balance-first. An organizer opening this has one question — how
 * much do I have and when does more arrive — and every other thing on the page is
 * secondary to answering it in the first line.
 */
export function MoneyOverview({ accountId }: { accountId: string }) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <SimGate
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-36 w-full rounded-2xl" />
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-72 w-full" />
          </div>
        }
      >
        <MoneyOverviewBody accountId={accountId} />
      </SimGate>
    </div>
  );
}

function MoneyOverviewBody({ accountId }: { accountId: string }) {
  const { data, index } = useSim();
  const m = React.useMemo(() => organizerMoney(data, index, accountId), [accountId, data, index]);

  if (!m) {
    return (
      <EmptyState
        title="No such organizer"
        description="That account id is not in the seeded dataset. Reset the demo data or pick an organizer from the switcher."
      />
    );
  }

  const base = organizerBase(accountId);
  const fa = m.financialAccount;

  return (
    <>
      <SectionHeading
        title={`${PLATFORM} Money`}
        blurb="Hold your event revenue, pay your vendors, and fund production."
        actions={
          <AskAgentButton question="Can I pay my staging vendor out of my balance?">
            Ask about my money
          </AskAgentButton>
        }
      />

      {fa ? (
        <BalanceHero
          label="Event Account balance"
          amount={fa.balance_cash}
          inbound={fa.balance_inbound_pending}
          outbound={fa.balance_outbound_pending}
          tag="Simulated balance"
          asideLabel="Next settlement"
          asideValue={m.nextSettlement ? longDate(m.nextSettlement) : 'Manual'}
          asideHint={
            m.nextSettlement
              ? `Ticket revenue sweeps ${m.settlementCadence}`
              : 'Payouts are on a manual schedule'
          }
        />
      ) : (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardBody>
            <div className="flex items-start gap-3">
              <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div>
                <p className="font-display text-[16px] font-bold text-gray-900">
                  No Event Account on this organizer yet
                </p>
                <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-gray-700">
                  Ticket revenue reaches {m.account.business_profile_name} as a payout to their
                  own bank on a {m.settlementCadence} schedule, and they pay suppliers from
                  there. An Event Account would let money go straight out — but it needs the
                  Treasury capability active on the platform first, which Stripe grants after
                  review rather than through an API call.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <AskAgentButton question="How much are we holding before events, and for how long?">
                    Size the opportunity
                  </AskAgentButton>
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/platform/money/treasury">
                      See the platform view
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ProductTile
          title="Event Account"
          state={m.state.account}
          detail={
            fa
              ? `Primary account · ${fa.active_features.length} features live`
              : 'Needs Treasury enabled on the platform'
          }
          href={fa ? `${base}/money/account` : undefined}
        />
        <ProductTile
          title="Production Cards"
          state={m.state.cards}
          detail={
            m.cards.length > 0
              ? `${m.cards.length} active · ${money(m.cardLimitTotal)} monthly ceiling`
              : 'No cards issued to this team'
          }
          href={m.cards.length > 0 ? `${base}/money/cards` : undefined}
        />
        <ProductTile
          title="Event Advance"
          state={m.state.advance}
          detail={
            m.advance
              ? `${money(m.advance.remaining_amount)} outstanding`
              : m.offer
                ? `${money(m.offer.offered_amount)} available`
                : 'No offer written'
          }
          href={m.offer || m.advance ? `${base}/money/advance` : undefined}
        />
      </div>

      {fa && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyStat label="Spendable now" value={money(m.spendable)} />
            <MoneyStat
              label="Committed out"
              value={money(fa.balance_outbound_pending)}
              hint="Payments already in flight"
              tone={fa.balance_outbound_pending > 0 ? 'warn' : 'neutral'}
            />
            <MoneyStat
              label="Card spend this month"
              value={money(m.cardSpendThisMonth)}
              hint={
                m.cardLimitTotal > 0
                  ? `${percent(m.cardSpendThisMonth / m.cardLimitTotal, 0)} of the combined ceiling`
                  : 'No cards issued'
              }
            />
            <MoneyStat
              label="Declined by card controls"
              value={money(m.declinedAmount)}
              hint={`${m.declinedCount} off-policy attempts refused`}
              tone={m.declinedCount > 0 ? 'good' : 'neutral'}
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <div>
                <CardTitle>Event Account</CardTitle>
                <CardDescription>
                  Balances and account numbers for this organizer.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="nums font-display text-[26px] font-black leading-none text-gray-900">
                  {money(fa.balance_cash)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <AskAgentButton question="Can I pay my staging vendor out of my balance?">
                    Send money
                  </AskAgentButton>
                  <AskAgentButton question="Give my production lead a card with a monthly limit">
                    <span className="inline-flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5" aria-hidden />
                      Create card
                    </span>
                  </AskAgentButton>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`${base}/money/account`}>Account details</Link>
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>
                  Ticket revenue, vendor payments and card spend in one timeline.
                </CardDescription>
              </div>
            </CardHeader>
            <ActivityTable entries={m.activity} limit={12} />
            {m.activity.length > 12 && (
              <CardBody className="border-t border-gray-100">
                <Link
                  href={`${base}/money/account`}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:underline"
                >
                  All {m.activity.length} entries
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardBody>
            )}
          </Card>
        </>
      )}

      {m.offer && !m.advance && (
        <Card className="mt-6 border-blue-200 bg-blue-50/40">
          <CardBody>
            <div className="flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="font-display text-[16px] font-bold text-gray-900">
                  {money(m.offer.offered_amount)} of funding is available
                </p>
                <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-gray-700">
                  A flat {money(m.offer.fee_amount)} fee, repaid by withholding{' '}
                  {percent(Number(m.offer.withhold_rate), 1)} of future ticket sales. No
                  instalments and no date to miss. The offer lapses{' '}
                  {longDate(m.offer.expires_after)}.
                </p>
                <div className="mt-3">
                  <Button asChild size="sm">
                    <Link href={`${base}/money/advance`}>
                      Review the terms
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <PlatformScaleNote className="mt-6" />
    </>
  );
}
