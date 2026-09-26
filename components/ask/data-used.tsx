'use client';

import { Database, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { SqlBlock } from '@/components/ui/code';
import { DataTable, inferColumns } from '@/components/ui/data-table';
import { Badge, Collapsible, Tabs } from '@/components/ui/primitives';
import type { ExecutedQuery } from '@/lib/scenarios/types';
import { runSql, SqlError, type QueryResult } from '@/lib/sql/engine';
import { useSimStore } from '@/lib/store/sim-store';

/**
 * The receipts.
 *
 * Every number in the answer above came out of one of these queries, and they
 * really ran — this panel shows the SQL and the rows it returned. You can also
 * edit a query and re-run it, which is the fastest way to satisfy yourself that
 * the agent is not making the numbers up.
 */
export function DataUsed({ queries }: { queries: ExecutedQuery[] }) {
  const [active, setActive] = React.useState(queries[0]?.label ?? '');
  const totalRows = queries.reduce((sum, query) => sum + query.result.rows.length, 0);
  const totalMs = queries.reduce((sum, query) => sum + query.result.ms, 0);

  if (queries.length === 0) return null;

  const current = queries.find((query) => query.label === active) ?? queries[0];

  return (
    <Collapsible
      title={
        <span className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-gray-500" />
          Data used
        </span>
      }
      subtitle={`${queries.length} ${queries.length === 1 ? 'query' : 'queries'} · ${totalRows.toLocaleString('en-US')} rows · ${totalMs.toFixed(0)}ms, run in this browser`}
    >
      <Tabs
        tabs={queries.map((query) => ({
          id: query.label,
          label: query.label,
          count: query.result.rows.length,
        }))}
        active={current.label}
        onChange={setActive}
        className="px-4 pt-1"
      />
      <QueryPanel key={current.label} query={current} />
    </Collapsible>
  );
}

function QueryPanel({ query }: { query: ExecutedQuery }) {
  const data = useSimStore((state) => state.data);
  const rev = useSimStore((state) => state.rev);

  const [sql, setSql] = React.useState(query.sql);
  const [result, setResult] = React.useState<QueryResult>(query.result);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const edited = sql !== query.sql;

  const rerun = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await runSql(data, rev, sql));
    } catch (caught) {
      setError(
        caught instanceof SqlError ? caught.message : 'Query failed to execute',
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSql(query.sql);
    setResult(query.result);
    setError(null);
    setEditing(false);
  };

  const columns = React.useMemo(
    () => inferColumns(result.columns, result.rows),
    [result],
  );

  return (
    <div className="space-y-3 p-4">
      {query.note && <p className="text-[13px] text-gray-500">{query.note}</p>}

      {editing ? (
        <textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          spellCheck={false}
          rows={Math.min(24, sql.split('\n').length + 2)}
          className="scroll-thin w-full rounded-lg border border-gray-300 bg-gray-50 p-4 font-mono text-[12.5px] leading-relaxed text-gray-800 focus:border-blue-500"
        />
      ) : (
        <SqlBlock sql={sql} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button size="sm" onClick={rerun} disabled={busy}>
              <Play className="h-3.5 w-3.5" />
              {busy ? 'Running…' : 'Run query'}
            </Button>
            <Button size="sm" variant="secondary" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit and re-run
          </Button>
        )}
        <span className="nums text-[12px] text-gray-500">
          {result.rows.length.toLocaleString('en-US')} rows · {result.ms.toFixed(1)}ms
        </span>
        {edited && <Badge tone="warn">Edited</Badge>}
        {result.truncated && (
          <Badge tone="neutral">Showing the first 500 rows</Badge>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-[#f2b9cd] bg-[#fdeef3] px-3 py-2 text-[12.5px] text-danger">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{error}</span>
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <DataTable columns={columns} rows={result.rows} maxHeight="20rem" />
      </div>
    </div>
  );
}
