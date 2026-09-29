'use client';

import { Menu, Sparkles, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { LeoDrawer } from '@/components/layout/leo-drawer';
import { Sidebar } from '@/components/layout/sidebar';
import { SimBanner } from '@/components/layout/sim-banner';
import { AGENT } from '@/lib/brand';
import { viewForPath } from '@/lib/nav';
import { useSimStore } from '@/lib/store/sim-store';

/**
 * Opening the agent from anywhere.
 *
 * Any page can call `useAskAgent()` and hand it a question, which is what the
 * contextual "Ask LEO" buttons on the money pages do — they deep-link a question
 * into the drawer without navigating away from the page the question is about.
 * That is the point of the drawer over a dedicated route: you keep your place.
 */
interface AgentControl {
  open: (question?: string) => void;
}

const AgentContext = React.createContext<AgentControl>({ open: () => {} });

export function useAskAgent(): AgentControl {
  return React.useContext(AgentContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const view = viewForPath(pathname);

  // Keyed on pathname for the same reason as the view switcher: navigating
  // closes the drawer without an effect that sets state on every route change.
  const [menuOpenAt, setMenuOpenAt] = React.useState<string | null>(null);
  const menuOpen = menuOpenAt === pathname;
  const setMenuOpen = React.useCallback(
    (next: boolean) => setMenuOpenAt(next ? pathname : null),
    [pathname],
  );
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [question, setQuestion] = React.useState<string | undefined>();

  const control = React.useMemo<AgentControl>(
    () => ({
      open: (next?: string) => {
        setQuestion(next);
        setAgentOpen(true);
      },
    }),
    [],
  );

  return (
    <AgentContext.Provider value={control}>
      <SimBanner />

      <div className="flex min-h-0 flex-1">
        {/* Desktop rail. Sticky rather than fixed so the banner above it still
            scrolls away, and the rail scrolls internally when the nav is tall. */}
        <aside className="sticky top-0 hidden h-screen w-[15.5rem] shrink-0 lg:block">
          <Sidebar onAskAgent={() => control.open()} />
        </aside>

        {/* Mobile drawer. */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-ink/50"
            />
            <div className="absolute inset-y-0 left-0 w-[16rem] shadow-sheet">
              <Sidebar
                onNavigate={() => setMenuOpen(false)}
                onAskAgent={() => {
                  setMenuOpen(false);
                  control.open();
                }}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col bg-gray-50">
          <MobileBar onMenu={() => setMenuOpen(true)} onAsk={() => control.open()} />
          <ContextBar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      <LeoDrawer
        open={agentOpen}
        onOpenChange={setAgentOpen}
        view={view}
        initialQuestion={question}
      />
    </AgentContext.Provider>
  );
}

function MobileBar({ onMenu, onAsk }: { onMenu: () => void; onAsk: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-nav px-3 py-2 lg:hidden">
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className="rounded-md p-2 text-white/80 transition-colors hover:bg-white/10"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        onClick={onAsk}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[12.5px] font-semibold text-white"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {AGENT}
      </button>
    </div>
  );
}

/**
 * The white strip naming whose account you are looking at.
 *
 * Only rendered in the organizer view, and that asymmetry is deliberate: the
 * platform view has no single subject, so a context bar there would be an empty
 * frame. Its presence is itself the signal that you are inside one account.
 */
function ContextBar() {
  const pathname = usePathname();
  const view = viewForPath(pathname);
  const data = useSimStore((state) => state.data);

  if (view.kind !== 'organizer') return null;
  const account = data?.accounts.find((a) => a.id === view.accountId);

  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
      <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500 text-[15px] font-black text-white">
        {(account?.business_profile_name ?? '?').charAt(0)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-bold leading-tight text-gray-900">
          {account?.business_profile_name ?? 'Unknown organizer'}
        </p>
        <p className="text-[11.5px] leading-tight text-gray-500">
          Organizer account
          {account && <span className="ml-2 font-mono text-gray-400">{account.id}</span>}
        </p>
      </div>
    </div>
  );
}

/** A small "ask about this" affordance for money pages to drop next to a figure. */
export function AskAgentButton({
  question,
  children,
  className,
}: {
  question: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const agent = useAskAgent();
  return (
    <button
      onClick={() => agent.open(question)}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
      }
    >
      <Sparkles className="h-3.5 w-3.5 text-blue-500" aria-hidden />
      {children ?? `Ask ${AGENT}`}
    </button>
  );
}

/**
 * The prose flavour: looks like a link, opens the drawer.
 *
 * Needed because {@link AskAgentButton} is too heavy inside a sentence, and a
 * real `<Link>` cannot work any more — the agent has no route of its own now
 * that it is a drawer.
 */
export function AskAgentLink({
  question,
  children,
  className,
}: {
  question: string;
  children: React.ReactNode;
  className?: string;
}) {
  const agent = useAskAgent();
  return (
    <button
      onClick={() => agent.open(question)}
      className={className ?? 'text-left font-medium text-blue-600 hover:underline'}
    >
      {children}
    </button>
  );
}

export { X as CloseIcon };
