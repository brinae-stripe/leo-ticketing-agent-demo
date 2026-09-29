'use client';

import { CircleCheck, LockKeyhole, Sparkles, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { ActionButton } from '@/components/ask/action-sheet';
import { useAskAgent } from '@/components/layout/app-shell';
import { Badge, Card, CardBody, SurfaceBadge } from '@/components/ui/primitives';
import { AGENT } from '@/lib/brand';
import type { Recommendation, RecommendationTone } from '@/lib/recommendations/types';
import { DASHBOARD_ONLY } from '@/lib/stripe-sim/dashboard-only';
import { cn } from '@/lib/utils';

/**
 * What {@link AGENT} noticed on this page, without being asked.
 *
 * Every card carries the numbers that produced it, and resolves in whichever way
 * is actually available: a button that runs through the approval sheet and is
 * tagged MCP or direct API, a Dashboard-only chip where no endpoint exists, or a
 * question handed to the agent where the answer needs analysis rather than a
 * call. An empty list renders as a single line saying so — a recommendations
 * panel that always has something in it is one nobody trusts.
 */

const TONE: Record<
  RecommendationTone,
  { label: string; badge: 'danger' | 'warn' | 'neutral'; rail: string; Icon: typeof TriangleAlert }
> = {
  act: {
    label: 'Needs a decision',
    badge: 'danger',
    rail: 'border-l-danger',
    Icon: TriangleAlert,
  },
  watch: {
    label: 'Worth a look',
    badge: 'warn',
    rail: 'border-l-warning',
    Icon: TriangleAlert,
  },
  info: {
    label: 'Context',
    badge: 'neutral',
    rail: 'border-l-gray-300',
    Icon: CircleCheck,
  },
};

export function Recommendations({
  items,
  scope,
  className,
}: {
  items: Recommendation[];
  /** Labels the audit entries these actions produce. */
  scope: { id: string; title: string };
  className?: string;
}) {
  /**
   * The list is held steady while an approval sheet is open.
   *
   * A recommendation that resolves itself is the normal case — widen an
   * allow-list and the "these declines share a category" finding stops being
   * true. But `items` is derived from simulation state, so the moment the call
   * lands the parent re-renders, that item disappears, and the open sheet is
   * unmounted along with the response panel the user was about to read.
   *
   * Snapshotting on open and releasing on close means the sheet survives to show
   * what the API returned, and the list refreshes the instant it is dismissed.
   */
  const [frozen, setFrozen] = React.useState<Recommendation[] | null>(null);
  const shown = frozen ?? items;
  const actionable = shown.filter((item) => item.tone !== 'info').length;

  return (
    <section className={className}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500">
            <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden />
          </span>
          <h2 className="font-display text-[17px] font-bold text-gray-900">
            What {AGENT} noticed
          </h2>
        </div>
        {shown.length > 0 && (
          <p className="text-[12px] text-gray-500">
            {actionable > 0
              ? `${actionable} ${actionable === 1 ? 'item needs' : 'items need'} a decision`
              : 'Nothing needs a decision'}
          </p>
        )}
      </header>

      {shown.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-[13px] text-gray-500">
              Nothing worth flagging on this page. {AGENT} only writes a card when the rows
              support one, so an empty panel means the data is unremarkable rather than
              unread.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => (
            <RecommendationCard
              key={item.id}
              item={item}
              scope={scope}
              onSheetOpenChange={(open) => setFrozen(open ? items : null)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecommendationCard({
  item,
  scope,
  onSheetOpenChange,
}: {
  item: Recommendation;
  scope: { id: string; title: string };
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const agent = useAskAgent();
  const tone = TONE[item.tone];
  const capability = item.dashboardOnly
    ? DASHBOARD_ONLY[item.dashboardOnly.capability]
    : null;

  return (
    <li>
      <Card className={cn('border-l-[3px]', tone.rail)}>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <tone.Icon
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  item.tone === 'act'
                    ? 'text-danger'
                    : item.tone === 'watch'
                      ? 'text-warning'
                      : 'text-gray-400',
                )}
                aria-hidden
              />
              <h3 className="text-[14px] font-bold leading-snug text-gray-900">
                {item.title}
              </h3>
            </div>
            <Badge tone={tone.badge}>{tone.label}</Badge>
          </div>

          <p className="mt-2 pl-6 text-[13px] leading-relaxed text-gray-700">{item.why}</p>
          {item.next && (
            <p className="mt-2 pl-6 text-[13px] leading-relaxed text-gray-600">{item.next}</p>
          )}

          {(item.action || item.ask || capability) && (
            <div className="mt-3.5 space-y-2.5 pl-6">
              {item.action && (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    action={item.action}
                    scenario={scope}
                    size="sm"
                    onOpenChange={onSheetOpenChange}
                  />
                  <SurfaceBadge surface={item.action.surface} />
                  <code className="font-mono text-[11.5px] text-gray-500">
                    {item.action.method} {item.action.path}
                  </code>
                </div>
              )}

              {item.ask && (
                <button
                  onClick={() => agent.open(item.ask)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Sparkles className="h-3.5 w-3.5 text-blue-500" aria-hidden />
                  Ask {AGENT}: &ldquo;{item.ask}&rdquo;
                </button>
              )}

              {capability && item.dashboardOnly && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="h-3.5 w-3.5 text-gray-500" aria-hidden />
                    <Badge tone="neutral">No API for this</Badge>
                    <span className="text-[12.5px] font-semibold text-gray-800">
                      {capability.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                    {item.dashboardOnly.rationale}
                  </p>
                  <p className="mt-1.5 text-[12px] text-gray-500">
                    <span className="font-semibold">Where:</span> {capability.where} ·{' '}
                    <span className="font-semibold">Owner:</span> {capability.owner}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </li>
  );
}
