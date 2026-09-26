'use client';

import { ArrowUp, Bot, CircleAlert, Loader2, Sparkles, User } from 'lucide-react';
import * as React from 'react';

import { ScenarioView } from '@/components/ask/scenario-view';
import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody } from '@/components/ui/primitives';
import { capabilityList, matchScenario, type ScenarioMatch } from '@/lib/scenarios';
import type { ScenarioResult } from '@/lib/scenarios/types';
import { runSql } from '@/lib/sql/engine';
import { useSimStore } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

type Status = 'thinking' | 'querying' | 'done' | 'unmatched' | 'error';

interface Turn {
  id: string;
  question: string;
  status: Status;
  match?: ScenarioMatch;
  result?: ScenarioResult;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AskChat({
  scope,
  accountId,
  initialQuestion,
  className,
}: {
  scope: 'internal' | 'organizer';
  accountId?: string;
  initialQuestion?: string;
  className?: string;
}) {
  const data = useSimStore((state) => state.data);
  const index = useSimStore((state) => state.index);
  const rev = useSimStore((state) => state.rev);

  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const counter = React.useRef(0);

  const scenarios = React.useMemo(() => capabilityList(scope), [scope]);

  const ask = React.useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || !data || !index || busy) return;

      counter.current += 1;
      const id = `turn_${counter.current}`;
      setBusy(true);
      setTurns((current) => [...current, { id, question: trimmed, status: 'thinking' }]);

      const patch = (changes: Partial<Turn>) =>
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, ...changes } : turn)),
        );

      // A beat of latency before routing — an agent that answers instantly
      // reads as a lookup table, which undersells what is happening.
      await sleep(340);

      const match = matchScenario(trimmed, scope);
      if (!match) {
        patch({ status: 'unmatched' });
        setBusy(false);
        return;
      }

      patch({ status: 'querying', match });
      await sleep(260);

      try {
        const result = await match.scenario.run({
          data,
          index,
          accountId,
          query: trimmed,
          sql: (text: string) => runSql(data, rev, text),
        });
        patch({ status: 'done', result });
      } catch (caught) {
        patch({
          status: 'error',
          error:
            caught instanceof Error ? caught.message : 'Something went wrong running that',
        });
      } finally {
        setBusy(false);
      }
    },
    [accountId, busy, data, index, rev, scope],
  );

  // Auto-run a question passed in via the URL.
  const launched = React.useRef(false);
  React.useEffect(() => {
    if (launched.current || !initialQuestion || !data) return;
    launched.current = true;
    void ask(initialQuestion);
  }, [ask, data, initialQuestion]);

  React.useEffect(() => {
    if (turns.length > 0) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [turns.length]);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {turns.length === 0 && (
        <EmptyChat scope={scope} scenarios={scenarios} onPick={ask} />
      )}

      {turns.map((turn) => (
        <div key={turn.id} className="space-y-4">
          <div className="flex justify-end">
            <div className="flex max-w-[85%] items-start gap-2.5">
              <p className="rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-[14px] leading-relaxed text-white">
                {turn.question}
              </p>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                <User className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              {turn.match && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{turn.match.scenario.title}</Badge>
                  <span className="text-[12px] text-gray-500">{turn.match.reason}</span>
                </div>
              )}

              {(turn.status === 'thinking' || turn.status === 'querying') && (
                <ThinkingState status={turn.status} match={turn.match} />
              )}

              {turn.status === 'unmatched' && (
                <UnmatchedState scope={scope} scenarios={scenarios} onPick={ask} />
              )}

              {turn.status === 'error' && (
                <p className="flex items-start gap-2 rounded-lg border border-[#f2b9cd] bg-[#fdeef3] px-4 py-3 text-[13px] text-danger">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{turn.error}</span>
                </p>
              )}

              {turn.status === 'done' && turn.result && turn.match && (
                <ScenarioView
                  result={turn.result}
                  scenario={{
                    id: turn.match.scenario.id,
                    title: turn.match.scenario.title,
                  }}
                  stream
                />
              )}
            </div>
          </div>
        </div>
      ))}

      <div ref={endRef} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
          setDraft('');
        }}
        className="sticky bottom-4 z-10"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-gray-300 bg-white p-2 shadow-lift focus-within:border-blue-500">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
                setDraft('');
              }
            }}
            rows={1}
            placeholder={
              scope === 'organizer'
                ? 'Ask about your payouts, buyers or checkout…'
                : 'Ask about disputes, fees, payouts, readers…'
            }
            className="scroll-thin max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || draft.trim().length === 0}
            aria-label="Send"
            className="shrink-0 rounded-xl"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-gray-500">
          The agent is scripted, not a language model — it matches your question against a
          catalogue of {scenarios.length} scenarios and runs their SQL.
        </p>
      </form>
    </div>
  );
}

/* --------------------------------- states --------------------------------- */

function ThinkingState({
  status,
  match,
}: {
  status: 'thinking' | 'querying';
  match?: ScenarioMatch;
}) {
  const stages =
    status === 'thinking'
      ? ['Matching your question to a scenario…']
      : [
          'Matched a scenario',
          `Querying the warehouse${match ? ` for ${match.scenario.title.toLowerCase()}` : ''}…`,
        ];

  return (
    <div className="space-y-2" aria-live="polite">
      {stages.map((stage, i) => (
        <p
          key={stage}
          className="flex items-center gap-2 text-[13px] text-gray-500"
        >
          {i === stages.length - 1 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
          )}
          {stage}
        </p>
      ))}
      <div className="mt-3 space-y-2">
        <div className="h-3 w-[92%] animate-pulse rounded bg-gray-200/80" />
        <div className="h-3 w-[78%] animate-pulse rounded bg-gray-200/80" />
        <div className="h-3 w-[85%] animate-pulse rounded bg-gray-200/80" />
      </div>
    </div>
  );
}

function UnmatchedState({
  scope,
  scenarios,
  onPick,
}: {
  scope: 'internal' | 'organizer';
  scenarios: ReturnType<typeof capabilityList>;
  onPick: (question: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[14.5px] leading-relaxed text-gray-800">
        I could not match that to anything I know how to do, and I would rather say so than
        guess at it. Here is what I can answer{' '}
        {scope === 'organizer' ? 'about this account' : 'across the platform'}:
      </p>
      <ScenarioGrid scenarios={scenarios} onPick={onPick} />
    </div>
  );
}

function EmptyChat({
  scope,
  scenarios,
  onPick,
}: {
  scope: 'internal' | 'organizer';
  scenarios: ReturnType<typeof capabilityList>;
  onPick: (question: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[14.5px] leading-relaxed text-gray-800">
            {scope === 'organizer' ? (
              <>
                Ask me about this account&apos;s money, buyers or checkout. I read the same
                Stripe data <Wordmark className="text-[13px]" /> does, scoped to this host
                only.
              </>
            ) : (
              <>
                Ask me anything about payments across the platform. I query the Data
                Pipeline tables, show you the SQL I ran, and propose actions you approve
                before they execute.
              </>
            )}
          </p>
          <p className="mt-1.5 text-[13px] text-gray-500">
            Start with one of these, or type your own.
          </p>
        </div>
      </div>
      <ScenarioGrid scenarios={scenarios} onPick={onPick} />
    </div>
  );
}

function ScenarioGrid({
  scenarios,
  onPick,
}: {
  scenarios: ReturnType<typeof capabilityList>;
  onPick: (question: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {scenarios.map((scenario) => (
        <Card
          key={scenario.id}
          className="transition-colors hover:border-blue-400 hover:bg-blue-50/40"
        >
          <CardBody className="p-0">
            <button
              onClick={() => onPick(scenario.suggestedPrompt)}
              className="h-full w-full px-4 py-3 text-left"
            >
              <span className="block text-[13.5px] font-semibold leading-snug text-gray-900">
                {scenario.suggestedPrompt}
              </span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-gray-500">
                {scenario.blurb}
              </span>
            </button>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
