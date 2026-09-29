/**
 * The two names this demo wears, in one place.
 *
 * `PLATFORM` is the fictional ticketing platform — the company. `AGENT` is the
 * AI agent inside it, which is what the demo is actually about. Keeping them
 * separate matters: the platform owns the data and the connected accounts, the
 * agent is a surface over that data which the platform can also resell to its
 * organizers. Changing either name is a one-line edit here.
 *
 * Reserved competitor and customer names must never appear in this repository —
 * `npm run check:names` fails the build on any match, so check that guard before
 * choosing a replacement.
 */

export const PLATFORM = 'Marquee';

export const AGENT = 'LEO';

/** Expanded on first use only, on /how-it-works. */
export const AGENT_GLOSS = 'Live Event Optimizer';

/** What the platform calls the businesses on its connected accounts. */
export const ORGANIZER = 'organizer';
export const ORGANIZERS = 'organizers';

/**
 * The two lenses the demo is built around, matching the personas the deck uses.
 * `platform` sees every organizer; `organizer` is scoped to one connected
 * account and never sees another organizer's rows.
 */
export const LENS = {
  platform: {
    key: 'platform',
    label: 'Platform view',
    persona: 'Hana',
    personaRole: `${PLATFORM} employee — finance, operations, risk`,
    quote: 'I can see what is happening across every event, and act before it costs us.',
  },
  organizer: {
    key: 'organizer',
    label: 'Organizer view',
    persona: 'Elena',
    personaRole: 'Event organizer on one connected account',
    quote: 'I can see what is happening, understand why, and act before it affects my event.',
  },
} as const;
