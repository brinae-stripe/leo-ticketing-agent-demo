import type { Mutation, SimIndex } from '../sim/dataset';
import type { SimDataset } from '../sim/types';

/**
 * Which surface a simulated call goes through.
 *
 * - `mcp` — a tool exposed by Stripe's hosted MCP server. The agent picks the
 *   tool and fills the arguments; there is no URL to construct.
 * - `api` — a direct call to the REST API with a secret key, because no MCP
 *   tool covers it.
 *
 * The distinction matters for a real build: MCP tools are the safe, curated
 * surface, and everything else needs code you own.
 */
export type Surface = 'mcp' | 'api';

export interface CallMeta {
  surface: Surface;
  /** MCP tool name, or a short label for a direct API call. */
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  /** The REST path the call maps to, shown in every preview. */
  path: string;
  /** Connected account the call runs against, if any. */
  stripeAccount?: string | null;
  idempotencyKey?: string | null;
}

export interface AuditEntry {
  id: string;
  /** Real wall-clock time — this is a record of the demo session, not sim time. */
  at: number;
  actor: string;
  surface: Surface;
  name: string;
  method: string;
  path: string;
  params: unknown;
  stripeAccount: string | null;
  accountName: string | null;
  idempotencyKey: string | null;
  responseId: string;
  response: unknown;
  scenarioId: string | null;
  scenarioTitle: string | null;
  summary: string;
}

/**
 * Everything a simulated call needs: the world to read, a way to change it,
 * and a way to write to the audit log.
 */
export interface SimContext {
  data: SimDataset;
  index: SimIndex;
  actor: string;
  scenarioId?: string | null;
  scenarioTitle?: string | null;
  /** Applies the mutation immediately and queues it for persistence. */
  record: (mutation: Mutation) => void;
  log: (entry: AuditEntry) => void;
}

export interface SimListResponse<T> {
  object: 'list';
  url: string;
  has_more: boolean;
  data: T[];
}
