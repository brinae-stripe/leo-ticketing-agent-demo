'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { SimGate } from '@/components/layout/sim-gate';
import { Badge, Card, Input, Select, Skeleton } from '@/components/ui/primitives';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { isoToShortDate, money, percent } from '@/lib/sim/format';
import { topHostsByVolume } from '@/lib/sim/metrics';
import type { HostCategory } from '@/lib/sim/types';
import { useSim } from '@/lib/store/sim-store';

type StatusFilter = 'all' | 'payouts_blocked' | 'charges_disabled' | 'negative_balance' | 'healthy';

export function HostsList() {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-black text-gray-900">Event hosts</h1>
        <p className="mt-1.5 text-[14px] text-gray-500">
          Every connected account on the platform, with the state that matters before their
          next event.
        </p>
      </header>
      {/* The fallback is deliberately as tall as the filled table. A short
          skeleton here pushes the footer down when 70 rows arrive, which is a
          visible layout shift on an otherwise still page. */}
      <SimGate
        fallback={
          <div aria-busy="true">
            <div className="mb-4 flex gap-2">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-32" />
            </div>
            <Skeleton className="h-[52rem] w-full" />
          </div>
        }
      >
        <HostsTable />
      </SimGate>
    </div>
  );
}

function HostsTable() {
  const { data, index } = useSim();

  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<'all' | HostCategory>('all');
  const [status, setStatus] = React.useState<StatusFilter>('all');

  const volumes = React.useMemo(
    () => new Map(topHostsByVolume(data, index, 500).map((row) => [row.accountId, row])),
    [data, index],
  );
  const balances = React.useMemo(
    () => new Map(data.account_balances.map((row) => [row.account_id, row])),
    [data],
  );

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.accounts
      .map((account) => {
        const volume = volumes.get(account.id);
        const balance = balances.get(account.id);
        return {
          account,
          volume: volume?.volume ?? 0,
          attempts: volume?.attempts ?? 0,
          successRate: volume?.successRate ?? 0,
          disputes: volume?.disputes ?? 0,
          available: balance?.available ?? 0,
          readers: (index.readersByAccount.get(account.id) ?? []).length,
        };
      })
      .filter((row) => {
        if (needle && !row.account.business_profile_name.toLowerCase().includes(needle)) {
          if (!row.account.id.toLowerCase().includes(needle)) return false;
        }
        if (category !== 'all' && row.account.metadata.host_category !== category) return false;
        if (status === 'payouts_blocked' && row.account.payouts_enabled) return false;
        if (status === 'charges_disabled' && row.account.charges_enabled) return false;
        if (status === 'negative_balance' && row.available >= 0) return false;
        if (
          status === 'healthy' &&
          (!row.account.payouts_enabled || !row.account.charges_enabled || row.available < 0)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.volume - a.volume);
  }, [balances, category, data.accounts, index.readersByAccount, query, status, volumes]);

  const categories = Object.keys(CATEGORY_PROFILES) as HostCategory[];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search hosts or account ids"
            className="h-9 pl-9 text-[13px]"
            aria-label="Search hosts"
          />
        </div>
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as 'all' | HostCategory)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((key) => (
            <option key={key} value={key}>
              {CATEGORY_PROFILES[key].label}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">Any status</option>
          <option value="payouts_blocked">Payouts blocked</option>
          <option value="charges_disabled">Charges disabled</option>
          <option value="negative_balance">Negative balance</option>
          <option value="healthy">Healthy</option>
        </Select>
        <span className="nums ml-auto text-[12.5px] text-gray-500">
          {rows.length} of {data.accounts.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Host</th>
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-left font-semibold">Next event</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net volume</th>
                <th className="px-4 py-2.5 text-right font-semibold">Success</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-4 py-2.5 text-left font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.account.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/hosts/${row.account.id}`}
                      className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.account.business_profile_name}
                    </Link>
                    <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                      {row.account.id}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {CATEGORY_PROFILES[row.account.metadata.host_category].label}
                  </td>
                  <td className="nums px-4 py-2.5 text-gray-600">
                    {row.account.metadata.next_event_date
                      ? isoToShortDate(row.account.metadata.next_event_date)
                      : '—'}
                  </td>
                  <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                    {money(row.volume)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right text-gray-700">
                    {row.attempts > 0 ? percent(row.successRate, 1) : '—'}
                  </td>
                  <td
                    className={`nums px-4 py-2.5 text-right ${row.available < 0 ? 'font-semibold text-danger' : 'text-gray-700'}`}
                  >
                    {money(row.available)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {!row.account.payouts_enabled && <Badge tone="danger">No payouts</Badge>}
                      {!row.account.charges_enabled && <Badge tone="danger">No charges</Badge>}
                      {row.available < 0 && <Badge tone="warn">Negative</Badge>}
                      {row.disputes > 0 && <Badge tone="warn">{row.disputes} disputes</Badge>}
                      {row.readers > 0 && <Badge tone="neutral">{row.readers} readers</Badge>}
                      {row.account.payouts_enabled &&
                        row.account.charges_enabled &&
                        row.available >= 0 &&
                        row.disputes === 0 && <Badge tone="good">Healthy</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-gray-500">
            No hosts match those filters.
          </p>
        )}
      </Card>
    </>
  );
}
