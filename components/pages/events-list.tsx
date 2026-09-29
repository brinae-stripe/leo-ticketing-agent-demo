'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { SimGate } from '@/components/layout/sim-gate';
import { Badge, Card, Input, Select, Skeleton } from '@/components/ui/primitives';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { NOW } from '@/lib/sim/constants';
import { count, money, percent, shortDate, untilLabel } from '@/lib/sim/format';
import { eventRows } from '@/lib/sim/metrics';
import type { EventStatus, OrganizerCategory } from '@/lib/sim/types';
import { useSim } from '@/lib/store/sim-store';

/**
 * The platform's Events tab.
 *
 * Split into on-sale and past rather than one long list, because those two
 * groups are read for opposite reasons: an on-sale event is a forecast you can
 * still change, a past event is a settlement you have to reconcile. The default
 * view is on-sale for that reason.
 */
type Timeframe = 'on_sale' | 'past' | 'cancelled' | 'all';

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  on_sale: 'On sale',
  past: 'Past events',
  cancelled: 'Cancelled',
  all: 'All events',
};

export function EventsList() {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-black text-gray-900">Events</h1>
        <p className="mt-1.5 text-[14px] text-gray-500">
          Every event across the platform, with the money each one has taken. This is the join
          Stripe cannot do alone — charges know the amount, the event catalogue knows what it
          was for.
        </p>
      </header>
      <SimGate
        fallback={
          <div aria-busy="true">
            <div className="mb-4 flex gap-2">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-36" />
            </div>
            <Skeleton className="h-[48rem] w-full" />
          </div>
        }
      >
        <EventsTable />
      </SimGate>
    </div>
  );
}

function EventsTable() {
  const { data, index } = useSim();

  const [query, setQuery] = React.useState('');
  const [timeframe, setTimeframe] = React.useState<Timeframe>('on_sale');
  const [category, setCategory] = React.useState<'all' | OrganizerCategory>('all');

  const all = React.useMemo(() => eventRows(data, index), [data, index]);

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all
      .filter((row) => {
        if (timeframe === 'on_sale' && !(row.status === 'on_sale' && row.startsAt >= NOW)) {
          return false;
        }
        if (timeframe === 'past' && !(row.status === 'completed' || row.startsAt < NOW)) {
          return false;
        }
        if (timeframe === 'cancelled' && row.status !== 'cancelled') return false;
        if (category !== 'all' && row.category !== category) return false;
        if (needle) {
          const haystack = `${row.name} ${row.organizerName} ${row.venue} ${row.city}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      // On-sale events read forward in time; everything else reads backward.
      .sort((a, b) =>
        timeframe === 'on_sale' ? a.startsAt - b.startsAt : b.startsAt - a.startsAt,
      );
  }, [all, category, query, timeframe]);

  const categories = Object.keys(CATEGORY_PROFILES) as OrganizerCategory[];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events, organizers or venues"
            className="h-9 pl-9 text-[13px]"
            aria-label="Search events"
          />
        </div>
        <Select
          value={timeframe}
          onChange={(event) => setTimeframe(event.target.value as Timeframe)}
          aria-label="Filter by timeframe"
        >
          {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((key) => (
            <option key={key} value={key}>
              {TIMEFRAME_LABELS[key]}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as 'all' | OrganizerCategory)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((key) => (
            <option key={key} value={key}>
              {CATEGORY_PROFILES[key].label}
            </option>
          ))}
        </Select>
        <span className="nums ml-auto text-[12.5px] text-gray-500">
          {rows.length} of {all.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Event</th>
                <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
                <th className="px-4 py-2.5 text-left font-semibold">Doors</th>
                <th className="px-4 py-2.5 text-right font-semibold">Tickets</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net taken</th>
                <th className="px-4 py-2.5 text-right font-semibold">Success</th>
                <th className="px-4 py-2.5 text-left font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/events/${row.id}`}
                      className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <div className="mt-0.5 text-[11.5px] text-gray-500">
                      {row.venue} · {row.city}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/organizers/${row.accountId}`}
                      className="text-gray-700 hover:text-blue-600 hover:underline"
                    >
                      {row.organizerName}
                    </Link>
                  </td>
                  <td className="nums px-4 py-2.5 text-gray-600">
                    {shortDate(row.startsAt)}
                    <div className="text-[11.5px] text-gray-400">
                      {untilLabel(row.startsAt, NOW)}
                    </div>
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-700">
                    {count(row.tickets)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                    {money(row.net)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-700">
                    {row.attempts > 0 ? percent(row.successRate, 1) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={row.status} startsAt={row.startsAt} />
                      {row.disputes > 0 && <Badge tone="warn">{row.disputes} disputes</Badge>}
                      {row.refunded > 0 && (
                        <Badge tone="neutral">{money(row.refunded)} refunded</Badge>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-gray-500">
            No events match those filters.
          </p>
        )}
      </Card>
    </>
  );
}

function StatusBadge({ status, startsAt }: { status: EventStatus; startsAt: number }) {
  if (status === 'cancelled') return <Badge tone="danger">Cancelled</Badge>;
  if (status === 'completed' || startsAt < NOW) return <Badge tone="neutral">Past</Badge>;
  // Inside a week of doors opening there is no longer time to fix a problem by
  // changing checkout, so the state is worth calling out separately.
  if (startsAt - NOW < 7 * 86_400) return <Badge tone="warn">On sale · this week</Badge>;
  return <Badge tone="good">On sale</Badge>;
}
