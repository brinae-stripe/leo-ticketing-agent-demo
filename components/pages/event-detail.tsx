'use client';

import {
  ArrowLeft,
  CalendarX2,
  ExternalLink,
  QrCode,
  Sparkles,
  Ticket,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  ACTIVITY_METRICS,
  EventActivityChart,
  type ActivityMetric,
} from '@/components/charts/trend-charts';
import { SimGate } from '@/components/layout/sim-gate';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui/primitives';
import { AGENT } from '@/lib/brand';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { DAY, NOW } from '@/lib/sim/constants';
import { count, longDate, money, percent, untilLabel } from '@/lib/sim/format';
import { eventDetail, type EventDetail } from '@/lib/sim/metrics';
import { useSim } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

export function EventDetailPage({ eventId }: { eventId: string }) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
      <SimGate
        fallback={
          <div aria-busy="true" className="space-y-4">
            <Skeleton className="h-9 w-80" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <EventDetailBody eventId={eventId} />
      </SimGate>
    </div>
  );
}

function EventDetailBody({ eventId }: { eventId: string }) {
  const { data, index } = useSim();
  const detail = React.useMemo(() => eventDetail(data, index, eventId), [data, index, eventId]);

  if (!detail) {
    return (
      <EmptyState
        title="No such event"
        description="That event id is not in the seeded catalogue. Every event in this demo is generated, so ids do not survive a data reset."
      />
    );
  }

  return (
    <>
      <Link
        href="/events"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-600 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All events
      </Link>

      <EventHeader detail={detail} />
      <RecentActivity detail={detail} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <PriceLevels detail={detail} />
        <EventStats detail={detail} />
      </div>
    </>
  );
}

/* --------------------------------- header --------------------------------- */

function EventHeader({ detail }: { detail: EventDetail }) {
  const past = detail.status === 'completed' || detail.startsAt < NOW;

  return (
    <header className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-black leading-tight text-gray-900 sm:text-[30px]">
            {detail.name}
          </h1>
          <p className="mt-1.5 text-[14px] text-gray-500">
            {detail.venue} · {detail.city} · {longDate(detail.startsAt)}{' '}
            <span className="text-gray-400">({untilLabel(detail.startsAt, NOW)})</span>
          </p>
          <p className="mt-1 text-[13px] text-gray-500">
            <Link
              href={`/organizers/${detail.accountId}`}
              className="font-medium text-blue-600 hover:underline"
            >
              {detail.organizerName}
            </Link>
            <span className="text-gray-400">
              {' '}
              · {CATEGORY_PROFILES[detail.category].label} · {detail.accountId}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {detail.status === 'cancelled' ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : past ? (
            <Badge tone="neutral">Past</Badge>
          ) : (
            <Badge tone="good">On sale</Badge>
          )}
        </div>
      </div>

      {/* The actions an event back office puts on this page. Only the two that
          move money are wired up, and they route through the agent rather than
          firing here, because both need an approval sheet in front of them. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/organizers/${detail.accountId}`}>
            <Ticket className="h-3.5 w-3.5" />
            Organizer
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link
            href={`/leo?q=${encodeURIComponent(`Are all readers at ${detail.organizerName} online for tomorrow?`)}`}
          >
            <QrCode className="h-3.5 w-3.5" />
            Reader readiness
          </Link>
        </Button>
        {!past && detail.status !== 'cancelled' && (
          <Button asChild variant="secondary" size="sm">
            <Link
              href={`/leo?q=${encodeURIComponent(`${detail.name} is cancelled — refund everyone`)}`}
            >
              <CalendarX2 className="h-3.5 w-3.5" />
              Cancel event
            </Link>
          </Button>
        )}
        <Button asChild size="sm">
          <Link href="/leo">
            <Sparkles className="h-3.5 w-3.5" />
            Ask {AGENT}
          </Link>
        </Button>
      </div>
    </header>
  );
}

/* ------------------------------ recent activity ---------------------------- */

const RANGES = [
  { days: 30, label: 'Past month' },
  { days: 7, label: 'Last week' },
  { days: 1, label: 'Last 24 hours' },
] as const;

function RecentActivity({ detail }: { detail: EventDetail }) {
  const [metric, setMetric] = React.useState<ActivityMetric>('tickets');
  const [days, setDays] = React.useState<number>(30);

  const windowEnd = Math.min(detail.startsAt, NOW);
  const visible = React.useMemo(
    () => detail.activity.filter((point) => point.day >= windowEnd - days * DAY),
    [days, detail.activity, windowEnd],
  );

  const totals = React.useMemo(
    () =>
      visible.reduce(
        (acc, point) => ({
          tickets: acc.tickets + point.tickets,
          revenue: acc.revenue + point.revenue,
          orders: acc.orders + point.orders,
          attempts: acc.attempts + point.attempts,
        }),
        { tickets: 0, revenue: 0, orders: 0, attempts: 0 },
      ),
    [visible],
  );

  const note = ACTIVITY_METRICS.find((entry) => entry.key === metric)?.note;

  return (
    <Card className="mt-6">
      <CardHeader className="flex-wrap gap-3">
        <div>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            {detail.startsAt < NOW
              ? 'The window ending when doors opened.'
              : 'The window ending today.'}{' '}
            {note}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => setDays(range.days)}
              aria-pressed={days === range.days}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                days === range.days
                  ? 'bg-ink text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_13rem]">
          <div>
            <div className="mb-3 flex flex-wrap gap-1">
              {ACTIVITY_METRICS.map((entry) => (
                <button
                  key={entry.key}
                  onClick={() => setMetric(entry.key)}
                  aria-pressed={metric === entry.key}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    metric === entry.key
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            {visible.length > 0 ? (
              <EventActivityChart data={visible} metric={metric} />
            ) : (
              <p className="py-16 text-center text-[13px] text-gray-500">
                No sales recorded in this window.
              </p>
            )}
          </div>

          <dl className="space-y-3 border-gray-200 lg:border-l lg:pl-5">
            <Figure label="Tickets issued" value={count(totals.tickets)} />
            <Figure label="Revenue, net" value={money(totals.revenue)} />
            <Figure label="Orders" value={count(totals.orders)} />
            <Figure
              label="Conversion"
              value={totals.attempts > 0 ? percent(totals.orders / totals.attempts, 1) : '—'}
              hint={`${count(totals.attempts)} attempts`}
            />
          </dl>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-gray-500">
          Refunds and exchanges are excluded from the daily curve, the same caveat a real
          event overview carries — use the settlement figures below for anything that has to
          reconcile.
        </p>
      </CardBody>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[11.5px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="nums mt-0.5 text-[19px] font-bold leading-none text-gray-900">{value}</dd>
      {hint && <dd className="mt-1 text-[11.5px] text-gray-400">{hint}</dd>}
    </div>
  );
}

/* ------------------------------ price levels ------------------------------ */

function PriceLevels({ detail }: { detail: EventDetail }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Price levels</CardTitle>
          <CardDescription>
            Issued inventory per tier. &ldquo;Issued&rdquo; means a buyer completed the purchase —
            tickets sitting in an open checkout are held, not issued, and are not counted here.
          </CardDescription>
        </div>
        <Badge tone="neutral">{detail.priceLevels.length}</Badge>
      </CardHeader>
      <CardBody>
        {detail.priceLevels.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-gray-500">
            Nothing issued on this event yet.
          </p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 text-left font-semibold">Price level</th>
                  <th className="px-3 py-2 text-right font-semibold">Issued</th>
                  <th className="px-3 py-2 text-right font-semibold">Avg price</th>
                  <th className="px-3 py-2 text-right font-semibold">Gross</th>
                  <th className="py-2 pl-3 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {detail.priceLevels.map((level) => (
                  <tr key={level.tier} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-gray-900">
                      {level.tier}
                      {level.refunded > 0 && (
                        <span className="ml-2 text-[11.5px] font-normal text-gray-400">
                          {money(level.refunded)} refunded
                        </span>
                      )}
                    </td>
                    <td className="nums px-3 py-2.5 text-right text-gray-700">
                      {count(level.issued)}
                    </td>
                    <td className="nums px-3 py-2.5 text-right text-gray-700">
                      {money(level.averagePrice)}
                    </td>
                    <td className="nums px-3 py-2.5 text-right font-semibold text-gray-900">
                      {money(level.gross)}
                    </td>
                    <td className="nums py-2.5 pl-3 text-right text-gray-500">
                      {percent(level.shareOfGross, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="py-2.5 pr-3 text-gray-900">Total</td>
                  <td className="nums px-3 py-2.5 text-right text-gray-900">
                    {count(detail.tickets)}
                  </td>
                  <td className="nums px-3 py-2.5 text-right text-gray-500">
                    {detail.tickets > 0 ? money(detail.gross / detail.tickets) : '—'}
                  </td>
                  <td className="nums px-3 py-2.5 text-right text-gray-900">
                    {money(detail.gross)}
                  </td>
                  <td className="py-2.5 pl-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------ event stats ------------------------------- */

function EventStats({ detail }: { detail: EventDetail }) {
  const past = detail.startsAt < NOW;

  const rows: { label: string; value: string; hint?: string }[] = [
    { label: 'Tickets issued', value: count(detail.tickets) },
    { label: 'Orders', value: count(detail.orders) },
    {
      label: 'Payment attempts',
      value: count(detail.attempts),
      hint: `${percent(detail.successRate, 1)} authorised`,
    },
    { label: 'Gross', value: money(detail.gross) },
    { label: 'Refunded', value: money(detail.refunded) },
    { label: 'Net', value: money(detail.net) },
    {
      label: 'Box office share',
      value: percent(detail.boxOfficeShare, 1),
      hint: 'Tickets sold in person at a reader',
    },
    {
      label: 'Wallet share',
      value: percent(detail.walletShare, 1),
      hint: 'Apple Pay, Google Pay or Link',
    },
    { label: 'Disputes', value: count(detail.disputes) },
  ];

  if (past) {
    rows.push({
      label: 'Scanned in',
      value: `${count(detail.scanned)} of ${count(detail.orders)}`,
      hint: `${percent(detail.attendanceRate, 0)} of orders — gate scans double as dispute evidence`,
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Event stats</CardTitle>
            <CardDescription>
              Everything here is derived from the charge rows, not stored separately — so it
              cannot drift from what settled.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <dl className="divide-y divide-gray-100">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-[13px] text-gray-600">
                  {row.label}
                  {row.hint && (
                    <span className="block text-[11.5px] leading-snug text-gray-400">
                      {row.hint}
                    </span>
                  )}
                </dt>
                <dd className="nums shrink-0 text-[13.5px] font-semibold text-gray-900">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      {detail.serviceFeeOwed > 0 && (
        <Card className={detail.serviceFeeSettled ? undefined : 'border-amber-200 bg-amber-50/40'}>
          <CardBody>
            <Badge tone={detail.serviceFeeSettled ? 'good' : 'warn'}>
              {detail.serviceFeeSettled ? 'Service fee collected' : 'Service fee outstanding'}
            </Badge>
            <p className="nums mt-2 text-[22px] font-bold leading-none text-gray-900">
              {money(detail.serviceFeeOwed)}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600">
              {detail.organizerName} settles after the event rather than at charge time, so this
              is billed back once the doors close.{' '}
              {!detail.serviceFeeSettled && (
                <Link
                  href={`/leo?q=${encodeURIComponent("Which organizers owe service fees from last week's events?")}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  Settle it with {AGENT}
                  <ExternalLink className="ml-0.5 inline h-3 w-3" />
                </Link>
              )}
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
