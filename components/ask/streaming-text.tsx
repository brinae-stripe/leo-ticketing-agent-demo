'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

const WORD_DELAY_MS = 16;

interface TimedWord {
  word: string;
  delay: number;
  spaced: boolean;
}

/**
 * Streaming effect without layout shift.
 *
 * The obvious way to fake streaming is to append characters to state, but that
 * reflows the page on every tick and pushes everything below it around. Instead
 * the full text is laid out immediately and each word fades in on a staggered
 * delay — the geometry is final from the first frame, so nothing moves.
 */
export function StreamingText({
  paragraphs,
  startDelayMs = 0,
  onDone,
  className,
}: {
  paragraphs: string[];
  startDelayMs?: number;
  onDone?: () => void;
  className?: string;
}) {
  // Delays are derived from each paragraph's starting word offset rather than a
  // running counter, so there is no mutable state in the render path at all.
  const plan = React.useMemo<TimedWord[][]>(() => {
    const lists = paragraphs.map((paragraph) =>
      paragraph.split(/\s+/).filter(Boolean),
    );
    const startOffsets = lists.reduce<number[]>(
      (offsets, list) => [...offsets, offsets[offsets.length - 1] + list.length],
      [0],
    );
    return lists.map((list, paragraphIndex) =>
      list.map((word, wordIndex) => ({
        word,
        delay:
          startDelayMs +
          (startOffsets[paragraphIndex] + wordIndex) * WORD_DELAY_MS,
        spaced: wordIndex < list.length - 1,
      })),
    );
  }, [paragraphs, startDelayMs]);

  const durationMs = React.useMemo(() => {
    const totalWords = plan.reduce((sum, list) => sum + list.length, 0);
    return startDelayMs + totalWords * WORD_DELAY_MS + 220;
  }, [plan, startDelayMs]);

  const [finished, setFinished] = React.useState(false);

  // Keeps the latest callback without reading a ref during render.
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setFinished(true);
      doneRef.current?.();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  return (
    <div className={cn('space-y-3.5', className)}>
      {plan.map((list, paragraphIndex) => {
        const isLast = paragraphIndex === plan.length - 1;
        return (
          <p
            key={paragraphIndex}
            className={cn(
              'text-[14.5px] leading-[1.65] text-gray-800',
              isLast && !finished && 'caret',
            )}
          >
            {list.map((entry, wordIndex) => (
              <span
                key={wordIndex}
                className="animate-fade-in opacity-0"
                style={{ animationDelay: `${entry.delay}ms`, animationFillMode: 'forwards' }}
              >
                {entry.word}
                {entry.spaced ? ' ' : ''}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Non-animated variant, for content that is revisited rather than streamed. */
export function StaticText({
  paragraphs,
  className,
}: {
  paragraphs: string[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-3.5', className)}>
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="text-[14.5px] leading-[1.65] text-gray-800">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
