import { DAY, HOUR, NOW } from '../sim/constants';
import { money, moneyWhole, percent } from '../sim/format';
import type { QueryResult } from '../sql/engine';

/** Row accessors that keep scenario code free of casts. */
export function num(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function str(row: Record<string, unknown> | undefined, key: string): string {
  const value = row?.[key];
  return value == null ? '' : String(value);
}

export function bool(row: Record<string, unknown> | undefined, key: string): boolean {
  return row?.[key] === true;
}

export function findRow(
  result: QueryResult,
  key: string,
  value: string,
): Record<string, unknown> | undefined {
  return result.rows.find((row) => String(row[key]) === value);
}

/* ------------------------------ time windows ------------------------------ */

export const T = {
  now: NOW,
  hoursAgo: (h: number) => NOW - h * HOUR,
  daysAgo: (d: number) => NOW - d * DAY,
  hoursAhead: (h: number) => NOW + h * HOUR,
  daysAhead: (d: number) => NOW + d * DAY,
} as const;

/**
 * SQL is written with literal epoch seconds rather than bound parameters so
 * that what the UI shows is exactly what ran, and can be copied into Sigma.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings
    .reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), '')
    .trim();
}

/* --------------------------- narrative formatting ------------------------- */

export { money, moneyWhole, percent };

export function pts(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)} pts`;
}

export function bpsDelta(from: number, to: number): string {
  const delta = Math.round((to - from) * 10_000);
  return `${delta >= 0 ? '+' : ''}${delta} bps`;
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

export function list(items: string[], conjunction = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** Human deadline, e.g. "in 14h" / "in 2d". */
export function within(target: number): string {
  const delta = target - NOW;
  if (delta <= 0) return 'overdue';
  const hours = Math.round(delta / HOUR);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** Splits a total into chunk counts, e.g. 2100 / 200 -> 11 batches. */
export function batchCount(total: number, size: number): number {
  return Math.ceil(total / size);
}

/** Chunks an array for batched execution. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
