'use client';

import { ExternalLink, Lightbulb, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ActionButton } from '@/components/ask/action-sheet';
import { DataUsed } from '@/components/ask/data-used';
import { StreamingText, StaticText } from '@/components/ask/streaming-text';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, CardBody, CardHeader, CardTitle, SurfaceBadge } from '@/components/ui/primitives';
import type { ScenarioItem, ScenarioResult } from '@/lib/scenarios/types';
import { DASHBOARD_ONLY, type DashboardOnlyRecommendation } from '@/lib/stripe-sim/dashboard-only';
import { cn } from '@/lib/utils';

/** Everything the agent produced for one question. */
export function ScenarioView({
  result,
  scenario,
  stream,
}: {
  result: ScenarioResult;
  scenario: { id: string; title: string };
  stream: boolean;
}) {
  const [answerDone, setAnswerDone] = React.useState(!stream);

  return (
    <div className="space-y-5">
      {stream ? (
        <StreamingText paragraphs={result.answer} onDone={() => setAnswerDone(true)} />
      ) : (
        <StaticText paragraphs={result.answer} />
      )}

      {/* Everything below waits for the answer so the reveal reads in order. */}
      <div
        className={cn(
          'space-y-5 transition-opacity duration-300',
          answerDone ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {result.table && (
          <Card>
            <CardHeader>
              <CardTitle>{result.table.caption ?? 'Detail'}</CardTitle>
            </CardHeader>
            <DataTable columns={result.table.columns} rows={result.table.rows} />
          </Card>
        )}

        <DataUsed queries={result.queries} />

        <Card className="border-blue-200 bg-blue-50/40">
          <CardBody>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white">
                <Lightbulb className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="label-xs text-blue-700">Proposed resolution</p>
                <h4 className="font-display mt-1 text-[16px] font-bold leading-snug text-gray-900">
                  {result.resolution.headline}
                </h4>
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-700">
                  {result.resolution.body}
                </p>
                {result.resolution.bullets && result.resolution.bullets.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {result.resolution.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="flex gap-2 text-[13px] leading-relaxed text-gray-700"
                      >
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-blue-500" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {result.actions.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-blue-200/70 pt-4">
                {result.actions.map((action) => (
                  <div key={action.id} className="flex items-center gap-1.5">
                    <ActionButton action={action} scenario={scenario} size="sm" />
                  </div>
                ))}
              </div>
            )}

            {result.dashboardOnly && result.dashboardOnly.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-blue-200/70 pt-4">
                {result.dashboardOnly.map((chip) => (
                  <DashboardOnlyChip key={chip.capability} recommendation={chip} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {result.items && result.items.length > 0 && (
          <div className="space-y-3">
            <h4 className="label-xs">
              Needs a decision · {result.items.length}
            </h4>
            {result.items.map((item) => (
              <ItemCard key={item.id} item={item} scenario={scenario} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  scenario,
}: {
  item: ScenarioItem;
  scenario: { id: string; title: string };
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h5 className="font-display text-[15px] font-bold leading-snug text-gray-900">
              {item.title}
            </h5>
            {item.subtitle && (
              <p className="mt-0.5 text-[13px] text-gray-500">{item.subtitle}</p>
            )}
          </div>
          {item.href && (
            <Link
              href={item.href}
              className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-blue-600 hover:underline"
            >
              Open host
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-2">
          {item.facts.map((fact) => (
            <div key={fact.label} className="bg-white px-3 py-2">
              <dt className="text-[11.5px] font-medium text-gray-500">{fact.label}</dt>
              <dd
                className={cn(
                  'mt-0.5 break-words text-[13px] font-semibold',
                  fact.tone === 'danger'
                    ? 'text-danger'
                    : fact.tone === 'warn'
                      ? 'text-warning'
                      : fact.tone === 'good'
                        ? 'text-success'
                        : 'text-gray-900',
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>

        {item.recommendation && (
          <p className="rounded-lg border-l-2 border-blue-500 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">
            {item.recommendation}
          </p>
        )}

        {(item.actions.length > 0 || item.dashboardOnly?.length) && (
          <div className="flex flex-wrap items-center gap-2">
            {item.actions.map((action) => (
              <div key={action.id} className="flex items-center gap-1.5">
                <ActionButton
                  action={action}
                  scenario={scenario}
                  size="sm"
                />
                <SurfaceBadge surface={action.surface} />
              </div>
            ))}
          </div>
        )}

        {item.dashboardOnly?.map((chip) => (
          <DashboardOnlyChip key={chip.capability} recommendation={chip} />
        ))}
      </CardBody>
    </Card>
  );
}

/**
 * Rendered wherever a recommendation lands on something with no API. The point
 * is that the agent says so instead of offering a button that quietly does
 * nothing.
 */
export function DashboardOnlyChip({
  recommendation,
}: {
  recommendation: DashboardOnlyRecommendation;
}) {
  const capability = DASHBOARD_ONLY[recommendation.capability];
  const [open, setOpen] = React.useState(false);

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Dashboard-only</Badge>
            <span className="text-[13px] font-semibold text-gray-900">
              {capability.label}
            </span>
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-gray-600">
            {recommendation.rationale}
          </span>
        </span>
      </button>
      {open && (
        <dl className="space-y-2 border-t border-gray-300 px-3 py-2.5 text-[12.5px]">
          <div>
            <dt className="font-semibold text-gray-500">Why there is no button</dt>
            <dd className="mt-0.5 text-gray-700">{capability.why}</dd>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <div>
              <dt className="font-semibold text-gray-500">Where</dt>
              <dd className="mt-0.5 text-gray-700">{capability.where}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Suggested owner</dt>
              <dd className="mt-0.5 text-gray-700">{capability.owner}</dd>
            </div>
          </div>
        </dl>
      )}
    </div>
  );
}
