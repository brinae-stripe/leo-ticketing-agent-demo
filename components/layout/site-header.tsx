'use client';

import { Menu, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { AGENT, PLATFORM } from '@/lib/brand';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

/**
 * Two groups, deliberately.
 *
 * `PRODUCT_NAV` is the platform's own admin, and mirrors the tab structure an
 * event-ticketing back office actually uses — Dashboard, Events, Organizers —
 * with the agent sitting alongside them rather than buried inside one of them.
 * `DEMO_NAV` is about the demo itself and is separated by a rule, so nobody
 * mistakes the audit log or the architecture write-up for product surface.
 */
const PRODUCT_NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/events', label: 'Events' },
  { href: '/organizers', label: 'Organizers' },
  { href: '/leo', label: AGENT },
];

const DEMO_NAV = [
  { href: '/audit', label: 'Audit' },
  { href: '/how-it-works', label: 'How it works' },
];

const ALL_NAV = [...PRODUCT_NAV, ...DEMO_NAV];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const auditCount = useSimStore((state) => state.audit.length);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const linkClass = (href: string) =>
    cn(
      'relative rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
      isActive(href)
        ? 'bg-white/10 text-white'
        : 'text-white/60 hover:bg-white/5 hover:text-white',
    );

  return (
    <header className="relative z-10 border-b border-white/10 bg-ink text-white">
      <div className="mx-auto flex h-16 max-w-[84rem] items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-7">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <Wordmark className="text-[19px]" />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {PRODUCT_NAV.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                {item.label}
              </Link>
            ))}

            <span aria-hidden className="mx-2 h-5 w-px bg-white/15" />

            {DEMO_NAV.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                {item.label}
                {item.href === '/audit' && auditCount > 0 && (
                  <span className="nums ml-1.5 rounded bg-blue-500 px-1.5 py-0.5 text-[10.5px] font-bold">
                    {auditCount}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/leo"
            className="hidden items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-600 sm:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Ask {AGENT}
          </Link>
          <button
            onClick={() => setMenuOpen((value) => !value)}
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-white/10 px-4 pb-3 pt-2 lg:hidden" aria-label="Mobile">
          {ALL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={cn(
                'block rounded-md px-3 py-2.5 text-sm font-medium',
                isActive(item.href) ? 'bg-white/10 text-white' : 'text-white/65',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-[84rem] flex-col gap-3 px-4 py-8 text-[12.5px] text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex flex-wrap items-center gap-x-2">
          <Wordmark className="text-[13px] text-gray-700" />
          <span>
            — a fictional live-events ticketing platform. {AGENT} is {PLATFORM}&apos;s AI
            agent. Nothing here is real.
          </span>
        </p>
        <Link
          href="/how-it-works"
          className="shrink-0 font-medium text-blue-600 hover:underline"
        >
          How this demo works
        </Link>
      </div>
    </footer>
  );
}
