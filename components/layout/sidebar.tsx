'use client';

import { BookOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewSwitcher } from '@/components/layout/view-switcher';
import { AGENT, PLATFORM } from '@/lib/brand';
import { isItemActive, viewForPath } from '@/lib/nav';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

/**
 * The dark rail. Fixed on desktop, a drawer on mobile.
 *
 * Section groupings are the whole point of this component: "Money" reading as a
 * product area alongside "Ticketing" is the argument the demo is making, and it
 * is made here before anyone clicks anything.
 */
export function Sidebar({
  onNavigate,
  onAskAgent,
}: {
  onNavigate?: () => void;
  onAskAgent: () => void;
}) {
  const pathname = usePathname();
  const view = viewForPath(pathname);
  const auditCount = useSimStore((state) => state.audit.length);

  return (
    <div className="flex h-full min-h-0 flex-col bg-nav">
      <Link
        href="/platform"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-4 py-4"
      >
        <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-[17px] font-black italic text-white">
          {PLATFORM.charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="font-display block truncate text-[15px] font-black leading-tight text-white">
            {PLATFORM}
          </span>
          <span className="block text-[10.5px] leading-tight text-nav-label">
            Event Ticketing
          </span>
        </span>
      </Link>

      <ViewSwitcher view={view} />

      <nav
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        aria-label={view.kind === 'platform' ? 'Platform navigation' : 'Organizer navigation'}
      >
        {view.sections.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-nav-label">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const href = `${view.base}${item.href}` || '/';
                const active = isItemActive(pathname, view.base, item);
                return (
                  <li key={item.label}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-[7px] text-[13px] transition-colors',
                        active
                          ? 'bg-nav-active font-semibold text-white'
                          : 'text-nav-item hover:bg-nav-raised hover:text-white',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.label === 'Audit log' && auditCount > 0 && (
                        <span className="nums rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {auditCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-nav-border p-3">
        <button
          onClick={onAskAgent}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-600"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Ask {AGENT}
        </button>
        <Link
          href="/how-it-works"
          onClick={onNavigate}
          className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-nav-label transition-colors hover:text-white"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden />
          How this demo works
        </Link>
      </div>
    </div>
  );
}
