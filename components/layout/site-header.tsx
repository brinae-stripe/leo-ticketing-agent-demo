'use client';

import { Menu, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/ask', label: 'Ask' },
  { href: '/hosts', label: 'Hosts' },
  { href: '/audit', label: 'Audit' },
  { href: '/how-it-works', label: 'How it works' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const auditCount = useSimStore((state) => state.audit.length);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="relative z-10 border-b border-white/10 bg-ink text-white">
      <div className="mx-auto flex h-16 max-w-[84rem] items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <Wordmark className="text-[19px]" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45 sm:inline">
              Ask
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
                  isActive(item.href)
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
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
            href="/ask"
            className="hidden items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-600 sm:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Ask StageGate
          </Link>
          <button
            onClick={() => setMenuOpen((value) => !value)}
            className="rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-white/10 px-4 pb-3 pt-2 md:hidden" aria-label="Mobile">
          {NAV.map((item) => (
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
        <p className="flex items-center gap-2">
          <Wordmark className="text-[13px] text-gray-700" />
          <span>— a fictional live-events ticketing platform. Nothing here is real.</span>
        </p>
        <Link href="/how-it-works" className="font-medium text-blue-600 hover:underline">
          How this demo works
        </Link>
      </div>
    </footer>
  );
}
