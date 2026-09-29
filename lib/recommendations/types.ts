import type { ActionSpec } from '../scenarios/types';
import type { DashboardOnlyRecommendation } from '../stripe-sim/dashboard-only';

/**
 * What {@link AGENT} puts on a money page without being asked.
 *
 * Three rules, because a recommendation panel is the easiest place in a demo to
 * start lying:
 *
 * 1. **Every recommendation is derived from rows on that page.** `why` carries
 *    the numbers that produced it. If the data does not support a recommendation,
 *    it does not render — there is no filler, and a page with nothing worth
 *    saying says nothing.
 * 2. **The resolution matches what is actually possible.** An `action` goes
 *    through the same approval sheet as everything else and is tagged MCP or
 *    direct API. Where there is no endpoint, it is a `dashboardOnly` chip naming
 *    the owner. Where the answer needs analysis rather than a call, it is an
 *    `ask` that opens the agent with the question pre-filled.
 * 3. **Tone reflects urgency, not confidence.** `act` means there is a deadline
 *    or money is decaying. `watch` means it will matter soon. `info` means it is
 *    worth knowing and needs nothing.
 */
export type RecommendationTone = 'act' | 'watch' | 'info';

export interface Recommendation {
  id: string;
  tone: RecommendationTone;
  /** The finding, as a sentence. */
  title: string;
  /** The numbers behind it — this is what makes it checkable. */
  why: string;
  /** What to do about it, if that needs saying beyond the button. */
  next?: string;
  /** Executes through the approval sheet. */
  action?: ActionSpec;
  /** No endpoint exists; say who owns it instead. */
  dashboardOnly?: DashboardOnlyRecommendation;
  /** Needs analysis rather than a call — opens the agent with this question. */
  ask?: string;
}

/** Sorted so the things with a clock on them come first. */
const TONE_ORDER: Record<RecommendationTone, number> = { act: 0, watch: 1, info: 2 };

export function sortRecommendations(items: Recommendation[]): Recommendation[] {
  return items.slice().sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
