'use client';

import * as React from 'react';

import { money, percent, shortDate } from '@/lib/sim/format';
import { cn } from '@/lib/utils';

export type ColumnKind = 'money' | 'percent' | 'number' | 'text' | 'date';

export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  kind?: ColumnKind;
}

function formatCell(value: unknown, kind: ColumnKind = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') return money(value);
  if (kind === 'percent' && typeof value === 'number') return percent(value, 2);
  if (kind === 'number' && typeof value === 'number') return value.toLocaleString('en-US');
  if (kind === 'date' && typeof value === 'number') return shortDate(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * The table used for both scenario output and raw query results. Kept
 * deliberately plain: monospace ids, tabular figures, no zebra striping, so a
 * 20-column query result is still scannable.
 */
export function DataTable({
  columns,
  rows,
  className,
  maxHeight = '26rem',
  emptyLabel = 'No rows',
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  className?: string;
  maxHeight?: string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-gray-500">{emptyLabel}</p>
    );
  }

  return (
    <div
      className={cn('scroll-thin w-full max-w-full overflow-auto', className)}
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-gray-200">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2 font-semibold text-gray-500',
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
              {columns.map((column) => {
                const value = row[column.key];
                const isId =
                  typeof value === 'string' && /^[a-z_]+_[A-Za-z0-9]{8,}$/.test(value);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-gray-800',
                      column.align === 'right' ? 'nums text-right' : 'text-left',
                      column.kind && column.kind !== 'text' ? 'nums' : '',
                      isId && 'font-mono text-[11.5px] text-gray-500',
                    )}
                  >
                    {formatCell(value, column.kind)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Infers sensible column kinds from a raw query result. */
export function inferColumns(
  keys: string[],
  rows: Record<string, unknown>[],
): Column[] {
  return keys.map((key) => {
    const sample = rows.find((row) => row[key] !== null && row[key] !== undefined)?.[key];
    const numeric = typeof sample === 'number';
    let kind: ColumnKind = 'text';
    if (numeric) {
      if (/(^|_)(amount|volume|gross|net|fee|fees|owed|spend|available|pending|value)($|_)/.test(key)) {
        kind = 'money';
      } else if (/(rate|conversion|share|pct|percent)$/.test(key)) {
        kind = 'percent';
      } else if (/(created|_at|_on|_by|starts_at|arrival_date|deadline|first_|last_|latest_|earliest_)/.test(key)) {
        kind = 'date';
      } else {
        kind = 'number';
      }
    }
    return {
      key,
      label: key,
      align: numeric ? 'right' : 'left',
      kind,
    };
  });
}
