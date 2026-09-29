'use client';

import { Building2, Check, ChevronsUpDown, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { PLATFORM } from '@/lib/brand';
import { organizerBase, PLATFORM_BASE, type ActiveView } from '@/lib/nav';
import { embeddedFinanceStatus } from '@/lib/sim/metrics';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

/**
 * "Viewing as" — the control that makes the two views impossible to confuse.
 *
 * Pinned to the top of the sidebar rather than hidden in a menu, because in a
 * live demo the first question anyone asks is "whose screen is this?". Switching
 * changes the whole rail, not just the content.
 *
 * Organizers that already have Capital, Treasury or Issuing are marked and
 * listed first. Most organizers have none of the three by design, so without
 * that the fastest way to find a working money page would be to open accounts
 * until you hit one.
 */
export function ViewSwitcher({ view }: { view: ActiveView }) {
  const router = useRouter();
  const pathname = usePathname();
  /**
   * Which pathname the panel was opened on.
   *
   * Storing the path rather than a boolean means navigation closes the panel for
   * free — `open` simply stops being true once `pathname` changes. The obvious
   * alternative, an effect that calls setOpen(false) when the path changes, sets
   * state during render-commit and cascades a second render for no reason.
   */
  const [openedAt, setOpenedAt] = React.useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = React.useCallback(
    (next: boolean) => setOpenedAt(next ? pathname : null),
    [pathname],
  );
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const data = useSimStore((state) => state.data);
  const ready = useSimStore((state) => state.ready);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const organizers = React.useMemo(() => {
    if (!ready || !data) return [];
    const rows = data.accounts.map((account) => {
      const finance = embeddedFinanceStatus(data, account.id);
      const products = [
        finance.capital.state !== 'none' ? 'Advance' : null,
        finance.treasuryCash != null ? 'Account' : null,
        finance.cards > 0 ? 'Cards' : null,
      ].filter(Boolean) as string[];
      return { account, products };
    });
    // Accounts with money products first, then alphabetical.
    return rows.sort(
      (a, b) =>
        b.products.length - a.products.length ||
        a.account.business_profile_name.localeCompare(b.account.business_profile_name),
    );
  }, [data, ready]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return organizers.slice(0, 40);
    return organizers
      .filter((row) =>
        `${row.account.business_profile_name} ${row.account.id}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 40);
  }, [organizers, query]);

  const current =
    view.kind === 'platform'
      ? null
      : (data?.accounts.find((a) => a.id === view.accountId) ?? null);

  return (
    <div ref={containerRef} className="relative px-3 pb-3">
      <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-nav-label">
        Viewing as
      </p>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-2 rounded-lg border border-nav-border bg-nav-raised px-2.5 py-2 text-left transition-colors hover:bg-nav-active"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            view.kind === 'platform' ? 'bg-blue-500' : 'bg-purple-500',
          )}
        >
          {view.kind === 'platform' ? (
            <Building2 className="h-3.5 w-3.5 text-white" />
          ) : (
            <UserRound className="h-3.5 w-3.5 text-white" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-white">
            {view.kind === 'platform'
              ? `${PLATFORM} — platform`
              : (current?.business_profile_name ?? 'Organizer')}
          </span>
          <span className="block text-[10.5px] text-nav-label">
            {view.kind === 'platform' ? 'All organizers' : 'Organizer account'}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-nav-label" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-nav-border bg-nav-raised shadow-sheet"
        >
          <button
            onClick={() => {
              setOpen(false);
              router.push(PLATFORM_BASE);
            }}
            className="flex w-full items-center gap-2 border-b border-nav-border px-3 py-2.5 text-left transition-colors hover:bg-nav-active"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500">
              <Building2 className="h-3.5 w-3.5 text-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-white">
                {PLATFORM} — platform
              </span>
              <span className="block text-[10.5px] text-nav-label">
                Every organizer, every event
              </span>
            </span>
            {view.kind === 'platform' && <Check className="h-3.5 w-3.5 text-blue-300" />}
          </button>

          <div className="border-b border-nav-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nav-label" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an organizer…"
                aria-label="Find an organizer"
                className="w-full rounded-md border border-nav-border bg-nav px-2 py-1.5 pl-8 text-[12.5px] text-white placeholder:text-nav-label focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>

          <ul className="scroll-thin max-h-[19rem] overflow-y-auto py-1">
            {filtered.map(({ account, products }) => (
              <li key={account.id}>
                <Link
                  href={organizerBase(account.id)}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-nav-active"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-500 text-[11px] font-bold text-white">
                    {account.business_profile_name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-white">
                      {account.business_profile_name}
                    </span>
                    <span className="block truncate text-[10.5px] text-nav-label">
                      {products.length > 0 ? products.join(' · ') : 'Ticketing only'}
                    </span>
                  </span>
                  {view.accountId === account.id && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-purple-300" />
                  )}
                </Link>
              </li>
            ))}
            {ready && filtered.length === 0 && (
              <li className="px-3 py-3 text-[12px] text-nav-label">No organizer matches that.</li>
            )}
            {!ready && (
              <li className="px-3 py-3 text-[12px] text-nav-label">
                Generating the dataset…
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
