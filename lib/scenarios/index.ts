import { capitalEligibility } from './internal/capital-eligibility';
import { checkoutOptimizer } from './internal/checkout-optimizer';
import { disputesDue } from './internal/disputes-due';
import { eventCancellation } from './internal/event-cancellation';
import { feeExplainer } from './internal/fee-explainer';
import { issuingVendorSpend } from './internal/issuing-vendor-spend';
import { payoutHealth } from './internal/payout-health';
import { refundableEfws } from './internal/refundable-efws';
import { reviewQueue } from './internal/review-queue';
import { settlement } from './internal/settlement';
import { terminalReadiness } from './internal/terminal-readiness';
import { treasuryFloat } from './internal/treasury-float';
import { capitalAdvance } from './organizer/capital-advance';
import { invoiceSponsor } from './organizer/invoice-sponsor';
import { issuingTeamCard } from './organizer/issuing-team-card';
import { moneyFromSaturday } from './organizer/money-from-saturday';
import { repeatBuyers } from './organizer/repeat-buyers';
import { treasuryPayVendor } from './organizer/treasury-pay-vendor';
import { vipPayOverTime } from './organizer/vip-pay-over-time';
import type { Scenario } from './types';

/**
 * Platform-view scenarios, in the order they appear on /leo.
 *
 * Payments questions first, because those are the ones somebody has today. The
 * embedded-finance three sit at the end as a block — they are questions a
 * platform can only ask once its payment data and its own event data are in the
 * same place, which is the argument for putting them there.
 */
export const INTERNAL_SCENARIOS: Scenario[] = [
  feeExplainer,
  disputesDue,
  refundableEfws,
  reviewQueue,
  payoutHealth,
  settlement,
  checkoutOptimizer,
  eventCancellation,
  terminalReadiness,
  capitalEligibility,
  treasuryFloat,
  issuingVendorSpend,
];

/** Organizer-view scenarios, always scoped to one connected account. */
export const ORGANIZER_SCENARIOS: Scenario[] = [
  moneyFromSaturday,
  repeatBuyers,
  vipPayOverTime,
  invoiceSponsor,
  capitalAdvance,
  treasuryPayVendor,
  issuingTeamCard,
];

export const ALL_SCENARIOS: Scenario[] = [...INTERNAL_SCENARIOS, ...ORGANIZER_SCENARIOS];

export function scenarioById(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((scenario) => scenario.id === id);
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

export interface ScenarioMatch {
  scenario: Scenario;
  /** 'trigger' when a known phrase matched, 'keyword' when scored. */
  how: 'trigger' | 'keyword';
  score: number;
  /** Shown in the UI so the routing decision is never a black box. */
  reason: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'what',
  'which', 'who', 'how', 'why', 'when', 'where', 'my', 'our', 'we', 'i', 'me',
  'of', 'in', 'on', 'for', 'to', 'and', 'or', 'from', 'with', 'at', 'by', 'up',
  'can', 'could', 'should', 'would', 'be', 'been', 'have', 'has', 'had', 'get',
  'got', 'all', 'any', 'some', 'this', 'that', 'these', 'those', 'next', 'last',
  'you', 'it', 'its', 'if', 'not', 'no', 'yes', 'please', 'show', 'tell',
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9$'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Intent matching without a model.
 *
 * Two passes. First, known phrases: if the question contains a scenario's
 * trigger (or a trigger contains the question), that is an outright match.
 * Second, keyword scoring over the remaining candidates, requiring a minimum
 * score so that an unrelated question falls through to the capability list
 * rather than being force-fitted to the nearest scenario.
 */
export function matchScenario(
  query: string,
  scope: 'internal' | 'organizer',
): ScenarioMatch | null {
  const normalized = normalize(query);
  if (normalized.length < 3) return null;

  const candidates = ALL_SCENARIOS.filter((scenario) => scenario.scope === scope);

  // Pass 1 — phrase match, longest trigger wins.
  let best: { scenario: Scenario; trigger: string } | null = null;
  for (const scenario of candidates) {
    for (const trigger of scenario.triggers) {
      const normalizedTrigger = normalize(trigger);
      const hit =
        normalized.includes(normalizedTrigger) ||
        (normalizedTrigger.length > 12 && normalizedTrigger.includes(normalized));
      if (hit && (!best || normalizedTrigger.length > normalize(best.trigger).length)) {
        best = { scenario, trigger };
      }
    }
  }
  if (best) {
    return {
      scenario: best.scenario,
      how: 'trigger',
      score: 1,
      reason: `Matched the phrase “${best.trigger}”.`,
    };
  }

  // Pass 2 — keyword scoring.
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return null;

  let bestScored: { scenario: Scenario; score: number; hits: string[] } | null = null;
  for (const scenario of candidates) {
    const keywords = new Set(scenario.keywords.map((k) => k.toLowerCase()));
    const titleTokens = new Set(tokens(`${scenario.title} ${scenario.blurb}`));
    const hits: string[] = [];
    let score = 0;
    for (const token of queryTokens) {
      if (keywords.has(token)) {
        score += 2;
        hits.push(token);
      } else if (titleTokens.has(token)) {
        score += 1;
        hits.push(token);
      }
    }
    // Normalise so a scenario with many keywords is not automatically favoured.
    const normalizedScore = score / Math.sqrt(queryTokens.length);
    if (normalizedScore > 0 && (!bestScored || normalizedScore > bestScored.score)) {
      bestScored = { scenario, score: normalizedScore, hits };
    }
  }

  // Below this, the match is noise. Better to say what we can do.
  if (!bestScored || bestScored.score < 1.2) return null;

  return {
    scenario: bestScored.scenario,
    how: 'keyword',
    score: bestScored.score,
    reason: `Closest match on ${bestScored.hits
      .slice(0, 4)
      .map((hit) => `“${hit}”`)
      .join(', ')}.`,
  };
}

/** Text used when nothing matches — the honest "here is what I can do". */
export function capabilityList(scope: 'internal' | 'organizer'): Scenario[] {
  return ALL_SCENARIOS.filter((scenario) => scenario.scope === scope);
}

export type { Scenario } from './types';
export type {
  ActionSpec,
  ActionProgress,
  ExecutedQuery,
  ResolutionCard,
  ScenarioContext,
  ScenarioItem,
  ScenarioResult,
  ScenarioTable,
} from './types';
