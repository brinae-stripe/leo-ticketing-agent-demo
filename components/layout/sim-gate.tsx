'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/primitives';
import { useSimStore } from '@/lib/store/sim-store';

/**
 * Holds a page back until the seeded dataset exists.
 *
 * The fallback is sized to roughly match what replaces it — the point is to
 * avoid the page jumping once 24,000 charges finish generating.
 */
export function SimGate({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const ready = useSimStore((state) => state.ready);
  if (!ready) return <>{fallback ?? <DefaultFallback />}</>;
  return <>{children}</>;
}

function DefaultFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-[13px] text-gray-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        Generating the seeded dataset…
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

/** Inline variant for small regions. */
export function SimGateInline({
  children,
  height = 'h-40',
}: {
  children: React.ReactNode;
  height?: string;
}) {
  const ready = useSimStore((state) => state.ready);
  if (!ready) return <Skeleton className={height} />;
  return <>{children}</>;
}
