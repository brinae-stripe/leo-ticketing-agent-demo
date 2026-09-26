'use client';

import * as React from 'react';
import { Toaster } from 'sonner';

import { bootstrapSim, useSimStore } from '@/lib/store/sim-store';

/**
 * Generating the seeded dataset is ~100k rows of work, so it happens once here
 * on the client rather than on every server render. Anything that reads data
 * sits behind <SimGate> and shows a skeleton until this finishes.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const storageWarning = useSimStore((state) => state.storageWarning);

  React.useEffect(() => {
    void bootstrapSim();
  }, []);

  React.useEffect(() => {
    if (storageWarning) {
      // Imported lazily so the toast library is not pulled into the first paint.
      void import('sonner').then(({ toast }) =>
        toast.warning('Session too large to save', { description: storageWarning }),
      );
    }
  }, [storageWarning]);

  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: 'rounded-lg border border-gray-200 shadow-lift',
            title: 'font-semibold text-[13px]',
            description: 'text-[12.5px] text-gray-500',
          },
        }}
      />
    </>
  );
}
