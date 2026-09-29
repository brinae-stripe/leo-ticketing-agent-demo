/**
 * The simulated Stripe surface.
 *
 * Nothing in here opens a socket. There is no `stripe` package in this project,
 * no API key is read, and no MCP client exists. Every function resolves
 * in-process against the seeded dataset after a realistic delay, and writes an
 * audit entry describing the call it would have made.
 */

export * as mcp from './mcp';
export * as api from './api';
export * as ef from './embedded-finance';

export { PLATFORM_ACCOUNT_ID, previewHeaders, nextLatency } from './core';
export { DASHBOARD_ONLY, dashboardOnly } from './dashboard-only';
export type {
  DashboardOnlyCapability,
  DashboardOnlyId,
  DashboardOnlyRecommendation,
} from './dashboard-only';
export { idempotencyKey, nextId, resetIds } from './ids';
export type { AuditEntry, CallMeta, SimContext, Surface } from './types';
