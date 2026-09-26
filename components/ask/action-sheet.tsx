'use client';

import { ArrowRight, CircleCheck, CircleAlert, Loader2, ScrollText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { HeaderTable, JsonBlock } from '@/components/ui/code';
import { Badge, Checkbox, Input, Progress, SurfaceBadge } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { prettyJson } from '@/lib/sim/format';
import type { ActionProgress, ActionSpec } from '@/lib/scenarios/types';
import { useSimStore } from '@/lib/store/sim-store';
import { invalidateSqlCache } from '@/lib/sql/engine';
import { previewHeaders } from '@/lib/stripe-sim/core';
import { idempotencyKey } from '@/lib/stripe-sim/ids';
import { cn } from '@/lib/utils';

type Phase = 'confirm' | 'running' | 'done' | 'failed';

/**
 * Nothing executes without passing through here.
 *
 * The sheet shows three things in order: what will happen in plain English, the
 * numbers it will move, and the exact request that will be sent — method, path,
 * headers including Stripe-Account and Idempotency-Key, and the JSON body. Then
 * it asks who is approving it. Large refunds and account debits need a second,
 * explicit acknowledgement on top.
 */
export function ActionSheet({
  action,
  open,
  onOpenChange,
  scenario,
}: {
  action: ActionSpec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenario: { id: string; title: string };
}) {
  const actor = useSimStore((state) => state.actor);
  const setActor = useSimStore((state) => state.setActor);

  const [phase, setPhase] = React.useState<Phase>('confirm');
  const [name, setName] = React.useState(actor);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [progress, setProgress] = React.useState<ActionProgress | null>(null);
  const [response, setResponse] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Generated once per opening, so the key shown in the preview is the key used.
  const key = React.useMemo(
    () => (open ? idempotencyKey(action.id.replace(/_/g, '-')) : ''),
    [open, action.id],
  );

  React.useEffect(() => {
    if (open) {
      setPhase('confirm');
      setAcknowledged(false);
      setProgress(null);
      setResponse(null);
      setError(null);
      setName(actor);
    }
  }, [open, actor]);

  const headers = React.useMemo(
    () =>
      previewHeaders({
        surface: action.surface,
        name: action.callLabel,
        method: action.method,
        path: action.path,
        stripeAccount: action.stripeAccount ?? null,
        idempotencyKey: key,
      }),
    [action, key],
  );

  const batches = action.batch
    ? Math.ceil(action.batch.total / action.batch.size)
    : 0;

  const canRun =
    name.trim().length >= 2 && (!action.requiresSecondAck || acknowledged);

  const run = async () => {
    if (!canRun) return;
    setPhase('running');
    setActor(name.trim());
    setProgress(
      action.batch
        ? { done: 0, total: action.batch.total, label: 'Starting…' }
        : null,
    );

    try {
      const ctx = useSimStore.getState().context(scenario);
      const result = await action.run(ctx, {
        idempotencyKey: key,
        onProgress: (update) => setProgress(update),
      });
      invalidateSqlCache();
      setResponse(result);
      setPhase('done');

      const id =
        result && typeof result === 'object' && 'id' in result
          ? String((result as { id: unknown }).id)
          : null;
      toast.success(action.label, {
        description: id ? `Returned ${id}` : 'Simulated call completed',
        action: { label: 'Audit log', onClick: () => { window.location.href = '/audit'; } },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The simulated call failed');
      setPhase('failed');
      toast.error(action.label, { description: 'The simulated call failed' });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Never let a batch be abandoned half-way through.
        if (phase === 'running') return;
        onOpenChange(next);
      }}
      title={action.label}
      description={
        phase === 'done'
          ? 'Done. The response below is what the simulated call returned.'
          : 'Review what this will do, then approve it.'
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <SurfaceBadge surface={action.surface} />
          <code className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[12px] text-gray-700">
            {action.method} {action.path}
          </code>
          {action.stripeAccount && (
            <Badge tone="warn">Runs on {action.stripeAccount}</Badge>
          )}
          {batches > 1 && (
            <Badge tone="neutral">
              {action.batch!.size === 1
                ? `${action.batch!.total.toLocaleString('en-US')} sequential calls`
                : `${batches} batches × ${action.batch!.size}`}
            </Badge>
          )}
        </div>

        {/* 1 — plain English, before any jargon. */}
        <section>
          <h4 className="label-xs mb-2">What will happen</h4>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13.5px] leading-relaxed text-gray-800">
            {action.plainEnglish}
          </p>
        </section>

        {/* 2 — the numbers. */}
        {action.totals && action.totals.length > 0 && (
          <section>
            <h4 className="label-xs mb-2">Totals</h4>
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-2">
              {action.totals.map((total) => (
                <div key={total.label} className="bg-white px-3.5 py-2.5">
                  <dt className="text-[11.5px] font-medium text-gray-500">{total.label}</dt>
                  <dd
                    className={cn(
                      'nums mt-0.5 text-[14px] font-bold',
                      total.tone === 'danger'
                        ? 'text-danger'
                        : total.tone === 'warn'
                          ? 'text-warning'
                          : 'text-gray-900',
                    )}
                  >
                    {total.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* 3 — the actual request. */}
        <section>
          <h4 className="label-xs mb-2">Request preview</h4>
          <div className="space-y-2">
            <HeaderTable headers={headers} />
            <JsonBlock value={action.params} maxHeight="18rem" />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
            {action.surface === 'mcp'
              ? 'In production the agent would call this through the hosted Stripe MCP server rather than constructing the request itself. The path is shown so you can see what it maps to.'
              : 'No MCP tool covers this endpoint, so it would be a direct API call from code you own.'}{' '}
            Here it resolves in-process against the seeded dataset — no network request is made.
          </p>
        </section>

        {phase === 'running' && (
          <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-gray-800">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              {progress?.label ?? 'Running…'}
            </div>
            {progress && progress.total > 1 && (
              <div className="mt-3 space-y-1.5">
                <Progress value={progress.done} total={progress.total} />
                <p className="nums text-[12px] text-gray-500">
                  {progress.done.toLocaleString('en-US')} of{' '}
                  {progress.total.toLocaleString('en-US')} {action.batch?.unitLabel ?? 'items'}
                </p>
              </div>
            )}
          </section>
        )}

        {phase === 'done' && (
          <section>
            <h4 className="label-xs mb-2 flex items-center gap-1.5">
              <CircleCheck className="h-3.5 w-3.5 text-success" />
              Response
            </h4>
            <JsonBlock value={response} maxHeight="20rem" />
          </section>
        )}

        {phase === 'failed' && (
          <section className="flex items-start gap-2 rounded-lg border border-[#f2b9cd] bg-[#fdeef3] px-4 py-3 text-[13px] text-danger">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </section>
        )}

        {/* 4 — who is approving. */}
        {phase === 'confirm' && (
          <section className="space-y-3 border-t border-gray-200 pt-4">
            <div>
              <label
                htmlFor={`approved-by-${action.id}`}
                className="label-xs mb-1.5 block"
              >
                Approved by <span className="text-danger">*</span>
              </label>
              <Input
                id={`approved-by-${action.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="off"
              />
              <p className="mt-1.5 text-[12px] text-gray-500">
                Recorded against this call in the audit log.
              </p>
            </div>

            {action.requiresSecondAck && (
              <Checkbox
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                label={
                  <span className="font-medium text-gray-900">
                    {action.secondAckLabel ??
                      'I understand this cannot be undone'}
                  </span>
                }
                className="border-[#f0d5a8] bg-[#fdf6e9] has-[:checked]:border-warning has-[:checked]:bg-[#fdf6e9]"
              />
            )}
          </section>
        )}
      </div>

      <SheetFooter
        phase={phase}
        canRun={canRun}
        variant={action.variant}
        onCancel={() => onOpenChange(false)}
        onRun={run}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}

function SheetFooter({
  phase,
  canRun,
  variant,
  onCancel,
  onRun,
  onClose,
}: {
  phase: Phase;
  canRun: boolean;
  variant?: ActionSpec['variant'];
  onCancel: () => void;
  onRun: () => void;
  onClose: () => void;
}) {
  if (phase === 'done' || phase === 'failed') {
    return (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" asChild>
          <Link href="/audit">
            <ScrollText className="h-4 w-4" />
            View in audit log
          </Link>
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      <Button variant="secondary" onClick={onCancel} disabled={phase === 'running'}>
        Cancel
      </Button>
      <Button
        variant={variant === 'danger' ? 'danger' : 'primary'}
        onClick={onRun}
        disabled={!canRun || phase === 'running'}
      >
        {phase === 'running' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running
          </>
        ) : (
          <>
            Approve &amp; run
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}

/** Button that opens the sheet for one action. */
export function ActionButton({
  action,
  scenario,
  size = 'md',
}: {
  action: ActionSpec;
  scenario: { id: string; title: string };
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={action.variant === 'danger' ? 'danger' : action.variant ?? 'primary'}
        size={size}
        onClick={() => setOpen(true)}
      >
        {action.label}
      </Button>
      <ActionSheet
        action={action}
        open={open}
        onOpenChange={setOpen}
        scenario={scenario}
      />
    </>
  );
}

export { prettyJson };
