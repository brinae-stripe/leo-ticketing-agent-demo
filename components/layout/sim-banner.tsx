'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { invalidateSqlCache } from '@/lib/sql/engine';
import { useSimStore } from '@/lib/store/sim-store';

/**
 * The persistent disclaimer. Deliberately at the very top of every page and not
 * dismissible — someone screenshotting this app should not be able to crop the
 * banner out by accident.
 */
export function SimBanner() {
  const reset = useSimStore((state) => state.reset);
  const ready = useSimStore((state) => state.ready);
  const auditCount = useSimStore((state) => state.audit.length);

  const onReset = React.useCallback(() => {
    reset();
    invalidateSqlCache();
    toast.success('Demo data reset', {
      description: 'Seeded dataset regenerated and the audit log cleared.',
    });
  }, [reset]);

  return (
    <div className="relative z-20 bg-blue-500 text-white">
      <div className="mx-auto flex max-w-[84rem] flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <p className="flex items-start gap-2 text-[12.5px] font-medium leading-snug">
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>
            Simulated demo — no live Stripe connection. All data and actions are fictional.
          </span>
        </p>
        <button
          onClick={onReset}
          disabled={!ready}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-white/15 px-2.5 py-1 text-[12px] font-semibold transition-colors hover:bg-white/25 disabled:opacity-50 sm:self-auto"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset demo data
          {auditCount > 0 && (
            <span className="nums rounded bg-white/25 px-1 text-[11px]">{auditCount}</span>
          )}
        </button>
      </div>
    </div>
  );
}
