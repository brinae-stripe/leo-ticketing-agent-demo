'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

const WORD_DELAY_MS = 16;

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
  const words = React.useMemo(
    () => paragraphs.map((paragraph) => paragraph.split(/\s+/).filter(Boolean)),
    [paragraphs],
  );
  const totalWords = words.reduce((sum, list) => sum + list.length, 0);
  const durationMs = startDelayMs + totalWords * WORD_DELAY_MS + 220;

  const [finished, setFinished] = React.useState(false);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;

  React.useEffect(() => {
    setFinished(false);
    const timer = setTimeout(() => {
      setFinished(true);
      doneRef.current?.();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  let cursor = 0;
  return (
    <div className={cn('space-y-3.5', className)}>
      {words.map((list, paragraphIndex) => {
        const isLast = paragraphIndex === words.length - 1;
        return (
          <p
            key={paragraphIndex}
            className={cn(
              'text-[14.5px] leading-[1.65] text-gray-800',
              isLast && !finished && 'caret',
            )}
          >
            {list.map((word, wordIndex) => {
              const delay = startDelayMs + cursor * WORD_DELAY_MS;
              cursor += 1;
              return (
                <span
                  key={wordIndex}
                  className="animate-fade-in opacity-0"
                  style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
                >
                  {word}
                  {wordIndex < list.length - 1 ? ' ' : ''}
                </span>
              );
            })}
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
