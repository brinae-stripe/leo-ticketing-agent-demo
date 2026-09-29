import { AGENT, PLATFORM } from './brand';

/**
 * The two views, and what each one's sidebar contains.
 *
 * The view is derived from the URL rather than held in state: `/platform/*` is
 * the platform looking at its whole book, `/o/<account>/*` is one organizer
 * looking at their own. That means a link is enough to put someone in the right
 * lens — no provider to get out of sync, and the address bar always says which
 * view you are in, which matters when you are demoing on a projector.
 */
export type ViewKind = 'platform' | 'organizer';

export interface NavItem {
  label: string;
  /** Appended to the view's base path. '' is the view's index. */
  href: string;
  /** Matched as a prefix so child routes keep the parent highlighted. */
  match?: 'exact' | 'prefix';
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Platform sidebar.
 *
 * Grouped so the money program reads as its own product area rather than as
 * three more reports — that grouping is the argument that a ticketing platform
 * has a finance business, made in the navigation before anyone opens a page.
 */
export const PLATFORM_NAV: NavSection[] = [
  {
    label: PLATFORM,
    items: [
      { label: 'Dashboard', href: '', match: 'exact' },
      { label: 'Events', href: '/events' },
      { label: 'Organizers', href: '/organizers' },
    ],
  },
  {
    label: 'Money program',
    items: [
      { label: 'Advances', href: '/money/advances' },
      { label: 'Stored balances', href: '/money/treasury' },
      { label: 'Card program', href: '/money/cards' },
    ],
  },
  {
    label: 'Platform ops',
    items: [
      { label: 'Settlements', href: '/settlements' },
      { label: 'Audit log', href: '/audit' },
    ],
  },
];

/**
 * Organizer sidebar.
 *
 * Ticketing first, because that is what an organizer signed up for. The money
 * section is the part the platform is selling them, and it sits directly beneath
 * — an organizer who is already in here to check ticket sales walks past it.
 */
export const ORGANIZER_NAV: NavSection[] = [
  {
    label: 'Ticketing',
    items: [
      { label: 'Dashboard', href: '', match: 'exact' },
      { label: 'Events', href: '/events' },
    ],
  },
  {
    label: `${PLATFORM} Money`,
    items: [
      { label: 'Overview', href: '/money', match: 'exact' },
      { label: 'Event Account', href: '/money/account' },
      { label: 'Production Cards', href: '/money/cards' },
      { label: 'Event Advance', href: '/money/advance' },
    ],
  },
  {
    label: 'Settlement',
    items: [
      { label: 'Payments', href: '/payments' },
      { label: 'Account settings', href: '/account' },
    ],
  },
];

export const PLATFORM_BASE = '/platform';

export function organizerBase(accountId: string): string {
  return `/o/${accountId}`;
}

export interface ActiveView {
  kind: ViewKind;
  /** Set only in the organizer view. */
  accountId?: string;
  base: string;
  sections: NavSection[];
}

/**
 * Work out which view a pathname belongs to.
 *
 * Anything that is not an organizer path is treated as the platform view,
 * including `/how-it-works` — that page is about the demo rather than about
 * either lens, and defaulting it to the platform rail is less jarring than
 * rendering it with no navigation at all.
 */
export function viewForPath(pathname: string): ActiveView {
  const organizer = /^\/o\/([^/]+)/.exec(pathname);
  if (organizer) {
    const accountId = organizer[1];
    return {
      kind: 'organizer',
      accountId,
      base: organizerBase(accountId),
      sections: ORGANIZER_NAV,
    };
  }
  return { kind: 'platform', base: PLATFORM_BASE, sections: PLATFORM_NAV };
}

export function isItemActive(pathname: string, base: string, item: NavItem): boolean {
  const href = `${base}${item.href}` || '/';
  if (item.match === 'exact') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Which scenario catalogue the agent should use, given the view. */
export function agentScopeFor(kind: ViewKind): 'internal' | 'organizer' {
  return kind === 'platform' ? 'internal' : 'organizer';
}

export const AGENT_LABEL = `Ask ${AGENT}`;
