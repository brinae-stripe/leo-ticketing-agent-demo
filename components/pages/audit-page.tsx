'use client';

import { ChevronRight, Search, ScrollText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { SimGate } from '@/components/layout/sim-gate';
import { HeaderTable, JsonBlock } from '@/components/ui/code';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Select,
  SurfaceBadge,
} from '@/components/ui/primitives';
import { auditTime } from '@/lib/sim/format';
import { previewHeaders } from '@/lib/stripe-sim/core';
import type { AuditEntry } from '@/lib/stripe-sim/types';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

export function AuditPage() {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-black text-gray-900">Audit log</h1>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-500">
          Every simulated call this session made, in order, with who approved it and the exact
          request and response. In a real deployment this is the artefact that makes an agent
          with write access defensible — without it, nobody can answer &ldquo;what did it
          do?&rdquo;
        </p>
      </header>
      <SimGate>
        <AuditBody />
      </SimGate>
    </div>
  );
}

function AuditBody() {
  const audit = useSimStore((state) => state.audit);

  const [query, setQuery] = React.useState('');
  const [surface, setSurface] = React.useState<'all' | 'mcp' | 'api'>('all');
  const [scenario, setScenario] = React.useState('all');

  const scenarios = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of audit) {
      if (entry.scenarioId && entry.scenarioTitle) {
        seen.set(entry.scenarioId, entry.scenarioTitle);
      }
    }
    return Array.from(seen.entries());
  }, [audit]);

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return audit.filter((entry) => {
      if (surface !== 'all' && entry.surface !== surface) return false;
      if (scenario !== 'all' && entry.scenarioId !== scenario) return false;
      if (!needle) return true;
      return [
        entry.name,
        entry.path,
        entry.method,
        entry.actor,
        entry.responseId,
        entry.summary,
        entry.stripeAccount ?? '',
        entry.accountName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [audit, query, scenario, surface]);

  const mcpCount = audit.filter((entry) => entry.surface === 'mcp').length;

  if (audit.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText className="h-7 w-7" />}
        title="Nothing has been executed yet"
        description="Approve an action from the LEO page or an organizer copilot and it will appear here with its full request and response."
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by tool, path, id, approver…"
            className="h-9 pl-9 text-[13px]"
            aria-label="Search the audit log"
          />
        </div>
        <Select
          value={surface}
          onChange={(event) => setSurface(event.target.value as 'all' | 'mcp' | 'api')}
          aria-label="Filter by surface"
        >
          <option value="all">Both surfaces</option>
          <option value="mcp">MCP tools ({mcpCount})</option>
          <option value="api">Direct API ({audit.length - mcpCount})</option>
        </Select>
        {scenarios.length > 0 && (
          <Select
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
            aria-label="Filter by scenario"
          >
            <option value="all">All scenarios</option>
            {scenarios.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </Select>
        )}
        <span className="nums ml-auto text-[12.5px] text-gray-500">
          {rows.length} of {audit.length} calls
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((entry) => (
          <AuditRow key={entry.id} entry={entry} />
        ))}
      </div>

      {rows.length === 0 && (
        <p className="py-10 text-center text-[13px] text-gray-500">
          No calls match those filters.
        </p>
      )}
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = React.useState(false);

  const headers = React.useMemo(
    () =>
      previewHeaders({
        surface: entry.surface,
        name: entry.name,
        method: entry.method as 'GET' | 'POST' | 'DELETE',
        path: entry.path,
        stripeAccount: entry.stripeAccount,
        idempotencyKey: entry.idempotencyKey,
      }),
    [entry],
  );

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <ChevronRight
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform',
            open && 'rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SurfaceBadge surface={entry.surface} />
            <code className="font-mono text-[12px] font-semibold text-gray-900">
              {entry.name}
            </code>
            <code className="font-mono text-[11.5px] text-gray-500">
              {entry.method} {entry.path}
            </code>
          </div>
          <p className="mt-1 text-[13px] text-gray-700">{entry.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-gray-500">
            <span className="nums">{auditTime(entry.at)}</span>
            <span aria-hidden>·</span>
            <span>
              Approved by{' '}
              <span className="font-medium text-gray-700">{entry.actor}</span>
            </span>
            {entry.scenarioTitle && (
              <>
                <span aria-hidden>·</span>
                <span>{entry.scenarioTitle}</span>
              </>
            )}
            {entry.accountName && (
              <>
                <span aria-hidden>·</span>
                <Link
                  href={`/o/${entry.stripeAccount}`}
                  className="font-medium text-blue-600 hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {entry.accountName}
                </Link>
              </>
            )}
          </div>
        </div>
        <Badge tone="neutral" className="mt-0.5 hidden shrink-0 font-mono sm:inline-flex">
          {entry.responseId}
        </Badge>
      </button>

      {open && (
        <div className="grid gap-4 border-t border-gray-200 bg-gray-50/60 px-4 py-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h4 className="label-xs">Request</h4>
            <HeaderTable headers={headers} />
            <JsonBlock value={entry.params} maxHeight="16rem" />
          </div>
          <div className="space-y-2">
            <h4 className="label-xs">Response</h4>
            <JsonBlock value={entry.response} maxHeight="20rem" />
          </div>
        </div>
      )}
    </Card>
  );
}
