'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { SimGate } from '@/components/layout/sim-gate';
import { Badge, Card, Input, Select, Skeleton } from '@/components/ui/primitives';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { isoToShortDate, money, percent } from '@/lib/sim/format';
import { embeddedFinanceStatus, topOrganizersByVolume } from '@/lib/sim/metrics';
import type { OrganizerCategory } from '@/lib/sim/types';
import { useSim } from '@/lib/store/sim-store';

type StatusFilter =
  | 'all'
  | 'payouts_blocked'
  | 'charges_disabled'
  | 'negative_balance'
  | 'healthy'
  | 'capital_offer'
  | 'stored_balance'
  | 'has_cards';

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Any status',
  payouts_blocked: 'Payouts blocked',
  charges_disabled: 'Charges disabled',
  negative_balance: 'Negative balance',
  healthy: 'Healthy',
  capital_offer: 'Has a financing offer',
  stored_balance: 'Has a stored balance',
  has_cards: 'Has issued cards',
};

export function OrganizersList() {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-black text-gray-900">Event organizers</h1>
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
        <OrganizersTable />
      </SimGate>
    </div>
  );
}

function OrganizersTable() {
  const { data, index } = useSim();

  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<'all' | OrganizerCategory>('all');
  const [status, setStatus] = React.useState<StatusFilter>('all');

  const volumes = React.useMemo(
    () => new Map(topOrganizersByVolume(data, index, 500).map((row) => [row.accountId, row])),
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
          finance: embeddedFinanceStatus(data, account.id),
        };
      })
      .filter((row) => {
        if (needle && !row.account.business_profile_name.toLowerCase().includes(needle)) {
          if (!row.account.id.toLowerCase().includes(needle)) return false;
        }
        if (category !== 'all' && row.account.metadata.organizer_category !== category) return false;
        if (status === 'payouts_blocked' && row.account.payouts_enabled) return false;
        if (status === 'charges_disabled' && row.account.charges_enabled) return false;
        if (status === 'negative_balance' && row.available >= 0) return false;
        if (
          status === 'healthy' &&
          (!row.account.payouts_enabled || !row.account.charges_enabled || row.available < 0)
        ) {
          return false;
        }
        if (status === 'capital_offer' && row.finance.capital.state === 'none') return false;
        if (status === 'stored_balance' && row.finance.treasuryCash == null) return false;
        if (status === 'has_cards' && row.finance.cards === 0) return false;
        return true;
      })
      .sort((a, b) => b.volume - a.volume);
  }, [balances, category, data, index.readersByAccount, query, status, volumes]);

  const categories = Object.keys(CATEGORY_PROFILES) as OrganizerCategory[];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search organizers or account ids"
            className="h-9 pl-9 text-[13px]"
            aria-label="Search organizers"
          />
        </div>
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
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABELS[key]}
            </option>
          ))}
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
                <th className="px-4 py-2.5 text-left font-semibold">Organizer</th>
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
                      href={`/o/${row.account.id}`}
                      className="font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {row.account.business_profile_name}
                    </Link>
                    <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                      {row.account.id}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {CATEGORY_PROFILES[row.account.metadata.organizer_category].label}
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
                      {row.disputes > 0 && (
                        <Badge tone="warn">
                          {row.disputes} {row.disputes === 1 ? 'dispute' : 'disputes'}
                        </Badge>
                      )}
                      {row.readers > 0 && (
                        <Badge tone="neutral">
                          {row.readers} {row.readers === 1 ? 'reader' : 'readers'}
                        </Badge>
                      )}
                      {row.finance.capital.state === 'offered' && (
                        <Badge tone="blue">Financing offer</Badge>
                      )}
                      {row.finance.capital.state === 'drawn' && <Badge tone="blue">Advance</Badge>}
                      {row.finance.treasuryCash != null && (
                        <Badge tone="purple">Stored balance</Badge>
                      )}
                      {row.finance.cards > 0 && (
                        <Badge tone="purple">
                          {row.finance.cards} {row.finance.cards === 1 ? 'card' : 'cards'}
                        </Badge>
                      )}
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
            No organizers match those filters.
          </p>
        )}
      </Card>
    </>
  );
}
