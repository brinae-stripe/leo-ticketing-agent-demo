'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, X } from 'lucide-react';
import * as React from 'react';

import { AskChat } from '@/components/ask/chat';
import { AGENT } from '@/lib/brand';
import { agentScopeFor, type ActiveView } from '@/lib/nav';

/**
 * {@link AGENT} as a layer over the product rather than a place you go.
 *
 * The drawer takes its scope from the view it was opened in: in the platform
 * view it gets the internal catalogue and sees every organizer, in an organizer
 * view it gets the organizer catalogue scoped to that one account. Same agent,
 * same approval flow, different `WHERE` — which is easier to believe when you
 * can open it from either side without the page changing underneath you.
 *
 * `key` on the chat is deliberate: switching view resets the conversation rather
 * than carrying a platform-wide answer into an organizer's account, which would
 * be a data-leak shape even in a simulation.
 */
export function LeoDrawer({
  open,
  onOpenChange,
  view,
  initialQuestion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: ActiveView;
  initialQuestion?: string;
}) {
  const scope = agentScopeFor(view.kind);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] animate-overlay-in" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[40rem] flex-col bg-white shadow-sheet animate-sheet-in">
          <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500">
                <Sparkles className="h-4 w-4 text-white" aria-hidden />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="font-display text-[17px] font-bold leading-snug text-gray-900">
                  {AGENT}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-[12.5px] leading-relaxed text-gray-500">
                  {scope === 'internal'
                    ? 'Platform view — every organizer on the platform is in scope.'
                    : 'Organizer view — scoped to this account only.'}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="-mr-1 -mt-1 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {open && (
              <AskChat
                key={`${scope}:${view.accountId ?? 'platform'}:${initialQuestion ?? ''}`}
                scope={scope}
                accountId={view.accountId}
                initialQuestion={initialQuestion}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
