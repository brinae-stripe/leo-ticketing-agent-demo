import type { QueryResult } from '../sql/engine';
import type { SimIndex } from '../sim/dataset';
import type { SimDataset } from '../sim/types';
import type { DashboardOnlyRecommendation } from '../stripe-sim/dashboard-only';
import type { SimContext } from '../stripe-sim/types';

/** A query the agent ran, together with what it returned. */
export interface ExecutedQuery {
  label: string
  /** Why this query, in one line. */
  note?: string;
  sql: string;
  result: QueryResult;
}

export interface ActionTotal {
  label: string;
  value: string;
  tone?: 'neutral' | 'warn' | 'danger';
}

export interface ActionProgress {
  done: number;
  total: number;
  label: string;
}

export interface ActionRunOptions {
  idempotencyKey: string;
  onProgress?: (progress: ActionProgress) => void;
}

/**
 * One button. Everything the confirmation sheet needs to explain the call
 * before anyone approves it, plus the function that actually runs it.
 */
export interface ActionSpec {
  id: string;
  label: string;
  surface: 'mcp' | 'api';
  /** MCP tool name, or a short human label for a direct API call. */
  callLabel: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  /** Connected account context, shown as the Stripe-Account header. */
  stripeAccount?: string | null;
  /** What will happen, in plain English, before any jargon. */
  plainEnglish: string;
  /** Request body as it would be sent. */
  params: unknown;
  totals?: ActionTotal[];
  /** Big refunds and account debits need a second, explicit acknowledgement. */
  requiresSecondAck?: boolean;
  secondAckLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  /** Set when the work is chunked, which drives the progress bar. */
  batch?: { size: number; total: number; unitLabel: string };
  run: (ctx: SimContext, options: ActionRunOptions) => Promise<unknown>;
}

export interface ResolutionCard {
  headline: string;
  body: string;
  bullets?: string[];
}

/** A row the agent wants a decision on — one dispute, one review, one organizer. */
export interface ScenarioItem {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  facts: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'danger' }[];
  recommendation?: string;
  actions: ActionSpec[];
  dashboardOnly?: DashboardOnlyRecommendation[];
}

export interface ScenarioTable {
  caption?: string;
  columns: { key: string; label: string; align?: 'left' | 'right'; kind?: 'money' | 'percent' | 'number' | 'text' | 'date' }[];
  rows: Record<string, unknown>[];
}

export interface ScenarioResult {
  /** The narrative answer, one string per paragraph. Numbers come from the SQL. */
  answer: string[];
  queries: ExecutedQuery[];
  resolution: ResolutionCard;
  /** Scenario-wide actions. */
  actions: ActionSpec[];
  /** Per-row decisions, each with its own actions. */
  items?: ScenarioItem[];
  table?: ScenarioTable;
  dashboardOnly?: DashboardOnlyRecommendation[];
}

export interface ScenarioContext {
  data: SimDataset;
  index: SimIndex;
  /** Runs SQL against the live tables and returns real rows. */
  sql: (sql: string) => Promise<QueryResult>;
  /** Set for organizer scenarios — the single connected account in scope. */
  accountId?: string;
  /** The raw question, so a scenario can pick a organizer name out of it. */
  query: string;
}

export interface Scenario {
  id: string;
  scope: 'internal' | 'organizer';
  title: string;
  /** The prompt shown on suggestion chips. */
  suggestedPrompt: string;
  /** One line describing what it answers, for the catalogue. */
  blurb: string;
  /** Phrases that should match this scenario outright. */
  triggers: string[];
  /** Individual tokens for the keyword fallback. */
  keywords: string[];
  run: (ctx: ScenarioContext) => Promise<ScenarioResult>;
}

/** Thrown when a scenario genuinely has nothing to act on. */
export class NothingToDoError extends Error {}
