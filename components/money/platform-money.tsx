'use client';

import Link from 'next/link';
import * as React from 'react';

import { AskAgentButton } from '@/components/layout/app-shell';
import { SimGate } from '@/components/layout/sim-gate';
import { Recommendations } from '@/components/money/recommendations';
import {
  MoneyStat,
  PlatformScaleNote,
  SectionHeading,
} from '@/components/money/money-ui';
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { PLATFORM } from '@/lib/brand';
import { organizerBase } from '@/lib/nav';
import { NOW } from '@/lib/sim/constants';
import { count, longDate, money, percent, shortDate, untilLabel } from '@/lib/sim/format';
import {
  advanceRecommendations,
  cardProgramRecommendations,
  settlementRecommendations,
  treasuryRecommendations,
} from '@/lib/recommendations/platform';
import { platformMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';

/**
 * The platform's own money book — three pages, one per product.
 *
 * The organizer pages answer "what do I have". These answer "what have we got
 * out there, and what are we leaving on the table", which is a different question
 * and the reason the money program is its own section in the sidebar rather than
 * a column on the organizers list.
 */

function Frame({
  children,
  fallbackRows = 3,
}: {
  children: React.ReactNode;
  fallbackRows?: number;
}) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <SimGate
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-72" />
            <div className="grid gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            {Array.from({ length: fallbackRows }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        }
      >
        {children}
      </SimGate>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Advances                                                                   */
/* -------------------------------------------------------------------------- */

export function PlatformAdvancesPage() {
  return (
    <Frame>
      <AdvancesBody />
    </Frame>
  );
}

function AdvancesBody() {
  const { data, index } = useSim();
  const p = React.useMemo(() => platformMoney(data, index), [data, index]);

  const drawn = p.advances.filter((a) => a.advanced > 0);

  return (
    <>
      <SectionHeading
        title="Advances"
        blurb={`Funding Stripe has underwritten against organizers' future ticket sales. ${PLATFORM} carries no credit risk — repayment is withheld from sales as they happen.`}
        actions={
          <AskAgentButton question="Which organizers could be offered financing?">
            Work the list
          </AskAgentButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyStat
          label="Underwritten"
          value={money(p.offeredTotal)}
          hint={`${p.advances.length} offers written`}
        />
        <MoneyStat
          label="Never surfaced"
          value={money(p.undeliveredValue)}
          hint={`${p.undelivered.length} organizers have not seen their offer`}
          tone={p.undelivered.length > 0 ? 'warn' : 'good'}
        />
        <MoneyStat
          label="Lapsing this week"
          value={money(p.lapsingSoon.reduce((s, a) => s + a.offered, 0))}
          hint={`${p.lapsingSoon.length} offers on a 30-day clock`}
          tone={p.lapsingSoon.length > 0 ? 'danger' : 'neutral'}
        />
        <MoneyStat
          label="Outstanding"
          value={money(p.outstandingTotal)}
          hint={`${money(p.advancedTotal)} advanced across ${drawn.length} organizers`}
        />
      </div>

      <Recommendations
        items={advanceRecommendations(p)}
        scope={{ id: 'page_platform_advances', title: 'Advances' }}
        className="mt-8"
      />

      {p.undelivered.length > 0 && (
        <Card className="mt-8 border-amber-200">
          <CardHeader>
            <div>
              <CardTitle>Offers nobody has seen</CardTitle>
              <CardDescription>
                An offer sits in <code className="font-mono text-[12px]">undelivered</code> until
                the platform records that it surfaced it — and it lapses on schedule regardless.
                This is the one state the platform alone is responsible for.
              </CardDescription>
            </div>
            <Badge tone="warn">{money(p.undeliveredValue)}</Badge>
          </CardHeader>
          <OfferTable rows={p.undelivered} showLapse />
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Every offer</CardTitle>
            <CardDescription>
              Sized against trailing 90-day volume. Organizers who clear the bar with no offer
              are Stripe&apos;s underwriting decision, not the platform&apos;s.
            </CardDescription>
          </div>
          <Badge tone="neutral">{p.advances.length}</Badge>
        </CardHeader>
        <OfferTable rows={p.advances} />
      </Card>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}

function OfferTable({
  rows,
  showLapse,
}: {
  rows: ReturnType<typeof platformMoney>['advances'];
  showLapse?: boolean;
}) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-gray-50">
          <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
            <th className="px-4 py-2.5 text-left font-semibold">Status</th>
            <th className="px-4 py-2.5 text-right font-semibold">Offered</th>
            <th className="px-4 py-2.5 text-right font-semibold">Fee</th>
            <th className="px-4 py-2.5 text-right font-semibold">Withhold</th>
            <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
            <th className="px-4 py-2.5 text-right font-semibold">
              {showLapse ? 'Lapses' : 'Trailing volume'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const soon =
              row.expiresAfter != null && row.expiresAfter - NOW < 7 * 86_400;
            return (
              <tr key={row.offerId ?? row.accountId} className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40">
                <td className="px-4 py-2.5">
                  <Link
                    href={`${organizerBase(row.accountId)}/money/advance`}
                    className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                  >
                    {row.organizer}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <Badge
                    tone={
                      row.status === 'undelivered'
                        ? 'warn'
                        : row.status === 'paid_out' || row.status === 'accepted'
                          ? 'good'
                          : row.status === 'expired' || row.status === 'canceled'
                            ? 'danger'
                            : 'blue'
                    }
                  >
                    {row.status.replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                  {money(row.offered)}
                </td>
                <td className="nums px-4 py-2.5 text-right text-gray-600">{money(row.fee)}</td>
                <td className="nums px-4 py-2.5 text-right text-gray-600">
                  {percent(row.withholdRate, 1)}
                </td>
                <td className="nums px-4 py-2.5 text-right text-gray-700">
                  {row.remaining > 0 ? money(row.remaining) : '—'}
                </td>
                <td
                  className={`nums px-4 py-2.5 text-right ${showLapse && soon ? 'font-semibold text-danger' : 'text-gray-500'}`}
                >
                  {showLapse
                    ? row.expiresAfter != null
                      ? untilLabel(row.expiresAfter, NOW)
                      : '—'
                    : money(row.trailingVolume)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stored balances                                                            */
/* -------------------------------------------------------------------------- */

export function PlatformTreasuryPage() {
  return (
    <Frame fallbackRows={2}>
      <TreasuryBody />
    </Frame>
  );
}

function TreasuryBody() {
  const { data, index } = useSim();
  const p = React.useMemo(() => platformMoney(data, index), [data, index]);

  const enrolled = new Set(p.storedBalances.map((r) => r.accountId));
  const notEnrolled = p.floatOrganizers - enrolled.size;

  return (
    <>
      <SectionHeading
        title="Stored balances"
        blurb="Money arrives when a ticket sells and is not released until the event closes. That float is real and deliberate — a stored balance does not shorten it, it just stops the organizer behind it being unable to see their own money."
        actions={
          <AskAgentButton question="How much are we holding before events, and for how long?">
            Size the float
          </AskAgentButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyStat
          label="Pre-event float"
          value={money(p.floatTotal)}
          hint={`Across ${p.floatOrganizers} organizers with events still to come`}
        />
        <MoneyStat
          label="Held in stored balances"
          value={money(p.storedCashTotal)}
          hint={`${p.storedBalances.length} accounts open`}
        />
        <MoneyStat
          label="Not enrolled"
          value={count(Math.max(0, notEnrolled))}
          hint="Organizers with float and no account"
          tone={notEnrolled > 0 ? 'warn' : 'good'}
        />
        <MoneyStat
          label="Paid straight to vendors"
          value={money(p.storedBalances.reduce((s, r) => s + r.paidOut, 0))}
          hint="Without a payout to the organizer's bank first"
        />
      </div>

      <Recommendations
        items={treasuryRecommendations(p, data)}
        scope={{ id: 'page_platform_treasury', title: 'Stored balances' }}
        className="mt-8"
      />

      <Card className="mt-8">
        <CardHeader>
          <div>
            <CardTitle>Open accounts</CardTitle>
            <CardDescription>
              Each balance reconciles: settled credits in, less posted payments out, less
              approved card spend. Nothing here is asserted.
            </CardDescription>
          </div>
          <Badge tone="neutral">{p.storedBalances.length}</Badge>
        </CardHeader>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cash</th>
                <th className="px-4 py-2.5 text-right font-semibold">In</th>
                <th className="px-4 py-2.5 text-right font-semibold">Out</th>
                <th className="px-4 py-2.5 text-right font-semibold">Committed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cards</th>
                <th className="px-4 py-2.5 text-right font-semibold">Opened</th>
              </tr>
            </thead>
            <tbody>
              {p.storedBalances.map((row) => (
                <tr
                  key={row.financialAccountId}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`${organizerBase(row.accountId)}/money/account`}
                      className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.organizer}
                    </Link>
                    <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                      {row.financialAccountId}
                    </div>
                  </td>
                  <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                    {money(row.cash)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-success">
                    {money(row.creditsIn)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {money(row.paidOut)}
                  </td>
                  <td
                    className={`nums px-4 py-2.5 text-right ${row.outboundPending > 0 ? 'text-warning' : 'text-gray-400'}`}
                  >
                    {row.outboundPending > 0 ? money(row.outboundPending) : '—'}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {row.cards > 0 ? row.cards : '—'}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-500">
                    {shortDate(row.openedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Card program                                                               */
/* -------------------------------------------------------------------------- */

export function PlatformCardsPage() {
  return (
    <Frame fallbackRows={2}>
      <CardsBody />
    </Frame>
  );
}

function CardsBody() {
  const { data, index } = useSim();
  const p = React.useMemo(() => platformMoney(data, index), [data, index]);

  const attempts = p.cardApprovedTotal + p.cardDeclinedTotal;
  const totalCards = p.cardProgram.reduce((s, r) => s + r.cards, 0);

  return (
    <>
      <SectionHeading
        title="Card program"
        blurb="Cards issued to organizers' production teams, funded from their stored balances. Spend controls are enforced by the network at authorisation, not policed afterwards."
        actions={
          <AskAgentButton question="Which organizers are paying vendors by bank transfer instead of card?">
            Find candidates
          </AskAgentButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyStat
          label="Cards issued"
          value={count(totalCards)}
          hint={`Across ${p.cardProgram.length} organizers`}
        />
        <MoneyStat
          label="Combined ceiling"
          value={money(p.cardLimitTotal)}
          hint="Per month"
        />
        <MoneyStat label="Approved spend" value={money(p.cardApprovedTotal)} />
        <MoneyStat
          label="Refused by controls"
          value={money(p.cardDeclinedTotal)}
          hint={`${p.cardDeclinedCount} attempts · ${attempts > 0 ? percent(p.cardDeclinedTotal / attempts, 1) : '0%'} of value`}
          tone={p.cardDeclinedCount > 0 ? 'good' : 'neutral'}
        />
      </div>

      <Recommendations
        items={cardProgramRecommendations(p, data)}
        scope={{ id: 'page_platform_cards', title: 'Card program' }}
        className="mt-8"
      />

      <Card className="mt-8">
        <CardHeader>
          <div>
            <CardTitle>By organizer</CardTitle>
            <CardDescription>
              Interchange revenue share is a commercial term rather than a published rate, so it
              is deliberately not estimated here — the spend base is the honest figure.
            </CardDescription>
          </div>
          <Badge tone="neutral">{p.cardProgram.length}</Badge>
        </CardHeader>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cards</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cardholders</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monthly ceiling</th>
                <th className="px-4 py-2.5 text-right font-semibold">Approved</th>
                <th className="px-4 py-2.5 text-right font-semibold">Refused</th>
              </tr>
            </thead>
            <tbody>
              {p.cardProgram.map((row) => (
                <tr
                  key={row.accountId}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`${organizerBase(row.accountId)}/money/cards`}
                      className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.organizer}
                    </Link>
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-700">{row.cards}</td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {row.cardholders}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {money(row.limitTotal)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                    {money(row.approvedSpend)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-500">
                    {row.declinedCount > 0
                      ? `${money(row.declinedAmount)} · ${row.declinedCount}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Settlements                                                                */
/* -------------------------------------------------------------------------- */

export function PlatformSettlementsPage() {
  return (
    <Frame fallbackRows={1}>
      <SettlementsBody />
    </Frame>
  );
}

function SettlementsBody() {
  const { data, index } = useSim();

  const rows = React.useMemo(() => {
    return data.service_fee_ledger
      .map((row) => ({
        ...row,
        organizer:
          index.accountById.get(row.account_id)?.business_profile_name ?? row.account_id,
        eventName: index.eventById.get(row.event_id)?.name ?? row.event_id,
      }))
      .sort((a, b) => b.period_end - a.period_end);
  }, [data.service_fee_ledger, index]);

  const outstanding = rows.filter((r) => !r.settled);
  const outstandingTotal = outstanding.reduce((s, r) => s + r.fee_owed, 0);
  const collected = rows.filter((r) => r.settled).reduce((s, r) => s + r.fee_owed, 0);

  return (
    <>
      <SectionHeading
        title="Settlements"
        blurb="Service fees accrued per event by organizers who settle after the event rather than at charge time. The collection step is the price of that flexibility."
        actions={
          <AskAgentButton question="Which organizers owe service fees from last week's events?">
            Settle the week
          </AskAgentButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyStat
          label="Outstanding"
          value={money(outstandingTotal)}
          hint={`${outstanding.length} events not yet collected`}
          tone={outstandingTotal > 0 ? 'warn' : 'good'}
        />
        <MoneyStat label="Collected" value={money(collected)} />
        <MoneyStat
          label="Events on the ledger"
          value={count(rows.length)}
          hint="Post-event billing only"
        />
      </div>

      <Recommendations
        items={settlementRecommendations(data)}
        scope={{ id: 'page_platform_settlements', title: 'Settlements' }}
        className="mt-8"
      />

      <Card className="mt-8">
        <CardHeader>
          <div>
            <CardTitle>Service fee ledger</CardTitle>
            <CardDescription>
              One row per event. Fees are owed once the doors close.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Event</th>
                <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
                <th className="px-4 py-2.5 text-right font-semibold">Tickets</th>
                <th className="px-4 py-2.5 text-right font-semibold">Gross</th>
                <th className="px-4 py-2.5 text-right font-semibold">Fee owed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Event date</th>
                <th className="px-4 py-2.5 text-left font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.account_id}:${row.event_id}`}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/platform/events/${row.event_id}`}
                      className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.eventName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={organizerBase(row.account_id)}
                      className="text-gray-700 hover:text-blue-600 hover:underline"
                    >
                      {row.organizer}
                    </Link>
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {count(row.tickets_sold)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-600">
                    {money(row.gross_volume)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                    {money(row.fee_owed)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-500">
                    {longDate(row.period_end)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.settled ? 'good' : 'warn'}>
                      {row.settled ? 'Collected' : 'Outstanding'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
