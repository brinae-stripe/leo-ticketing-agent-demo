'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import {
  applyMutation,
  applyMutations,
  buildIndex,
  createDataset,
  type Mutation,
  type SimIndex,
} from '../sim/dataset';
import type { SimDataset, TableName } from '../sim/types';
import { resetIds } from '../stripe-sim/ids';
import type { AuditEntry, SimContext } from '../stripe-sim/types';

const STORAGE_KEY = 'stagegate-ask-demo/v1';

/**
 * Only inserts can invalidate an index — a patch mutates the row object that
 * the index maps already point at, so those stay correct for free. That is what
 * makes a 2,100-charge batch refund cheap instead of quadratic.
 */
function indexInsert(index: SimIndex, table: TableName, row: Record<string, unknown>): void {
  if (table === 'refunds') {
    const chargeId = row.charge_id as string;
    const list = index.refundsByCharge.get(chargeId);
    if (list) list.push(row as never);
    else index.refundsByCharge.set(chargeId, [row as never]);
    return;
  }
  if (table === 'transfers') {
    const source = row.source_transaction_id as string | null;
    if (source) index.transferByCharge.set(source, row as never);
  }
}

export interface SimStore {
  /** False until the dataset has been generated on the client. */
  ready: boolean;
  /** Bumped after every simulated call so views recompute. */
  rev: number;
  data: SimDataset | null;
  index: SimIndex | null;
  /** Replayable record of everything this demo session changed. */
  mutations: Mutation[];
  audit: AuditEntry[];
  actor: string;
  storageWarning: string | null;

  init: () => void;
  reset: () => void;
  setActor: (actor: string) => void;
  record: (mutation: Mutation) => void;
  log: (entry: AuditEntry) => void;
  context: (scenario?: { id: string; title: string }) => SimContext;
}

/** localStorage, but a full disk or a blocked origin must never break the demo. */
const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      useSimStore.setState({
        storageWarning:
          'This session is too large to save locally. Actions still work, but they will not survive a reload.',
      });
    }
  },
  removeItem: (name: string) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* nothing to do */
    }
  },
}));

export const useSimStore = create<SimStore>()(
  persist(
    (set, get) => ({
      ready: false,
      rev: 0,
      data: null,
      index: null,
      mutations: [],
      audit: [],
      actor: '',
      storageWarning: null,

      init: () => {
        if (get().ready) return;
        const data = createDataset();
        // Whatever this browser had saved is replayed on top of the fresh seed.
        applyMutations(data, get().mutations);
        set({ data, index: buildIndex(data), ready: true, rev: get().rev + 1 });
      },

      reset: () => {
        resetIds();
        const data = createDataset();
        set({
          data,
          index: buildIndex(data),
          mutations: [],
          audit: [],
          ready: true,
          storageWarning: null,
          rev: get().rev + 1,
        });
      },

      setActor: (actor) => set({ actor }),

      record: (mutation) => {
        const { data, index } = get();
        if (!data || !index) return;
        applyMutation(data, mutation);
        if (mutation.kind === 'insert') {
          indexInsert(index, mutation.table, mutation.row);
        }
        // Kept out of `set` on purpose: pushing here avoids cloning the whole
        // mutation list on every row of a large batch.
        get().mutations.push(mutation);
      },

      log: (entry) => {
        set((state) => ({ audit: [entry, ...state.audit], rev: state.rev + 1 }));
      },

      context: (scenario) => {
        const { data, index, actor, record, log } = get();
        if (!data || !index) throw new Error('Simulation is not ready yet');
        return {
          data,
          index,
          actor: actor || 'Unnamed operator',
          scenarioId: scenario?.id ?? null,
          scenarioTitle: scenario?.title ?? null,
          record,
          log,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      storage: safeStorage,
      skipHydration: true,
      // The seeded dataset is regenerated, never stored.
      partialize: (state) => ({
        mutations: state.mutations,
        audit: state.audit,
        actor: state.actor,
      }),
    },
  ),
);

/**
 * Hydrate from localStorage, then generate. Called once from the provider —
 * keeping it out of module scope means the server never pays to build 100k rows
 * it would immediately throw away.
 */
export async function bootstrapSim(): Promise<void> {
  await useSimStore.persist.rehydrate();
  useSimStore.getState().init();
}

/** Narrowed accessor for components rendered inside <SimGate>. */
export function useSim(): { data: SimDataset; index: SimIndex; rev: number } {
  const data = useSimStore((s) => s.data);
  const index = useSimStore((s) => s.index);
  const rev = useSimStore((s) => s.rev);
  if (!data || !index) throw new Error('useSim must be used inside <SimGate>');
  return { data, index, rev };
}
