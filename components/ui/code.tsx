'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, []);
  return [copied, copy];
}

export function CodeBlock({
  code,
  language,
  className,
  maxHeight = 'none',
}: {
  code: string;
  language?: string;
  className?: string;
  maxHeight?: string;
}) {
  const [copied, copy] = useCopy();
  return (
    <div className={cn('group relative', className)}>
      <button
        onClick={() => copy(code)}
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-200 bg-white/90 p-1.5 text-gray-500 opacity-0 transition-opacity hover:text-gray-900 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre
        className="code-block scroll-thin whitespace-pre"
        style={{ maxHeight, overflowY: maxHeight === 'none' ? 'visible' : 'auto' }}
      >
        <code data-language={language}>{code}</code>
      </pre>
    </div>
  );
}

/**
 * SQL with the leading comment lines dimmed, so the intent of a query reads
 * before the mechanics of it.
 */
export function SqlBlock({ sql, className }: { sql: string; className?: string }) {
  const [copied, copy] = useCopy();
  const lines = sql.split('\n');
  return (
    <div className={cn('group relative', className)}>
      <button
        onClick={() => copy(sql)}
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-200 bg-white/90 p-1.5 text-gray-500 opacity-0 transition-opacity hover:text-gray-900 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="Copy SQL"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="code-block scroll-thin whitespace-pre">
        <code>
          {lines.map((line, i) => (
            <span
              key={i}
              className={cn(
                'block',
                line.trimStart().startsWith('--') ? 'text-gray-400' : 'text-gray-800',
              )}
            >
              {line || ' '}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function JsonBlock({
  value,
  className,
  maxHeight = '22rem',
}: {
  value: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? 'null';
    } catch {
      return String(value);
    }
  }, [value]);
  return <CodeBlock code={text} language="json" className={className} maxHeight={maxHeight} />;
}

/** Key/value request headers, rendered like a request inspector. */
export function HeaderTable({ headers }: { headers: Record<string, string> }) {
  return (
    <dl className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 text-[12.5px]">
      {Object.entries(headers).map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
          <dt className="shrink-0 font-mono font-semibold text-gray-500 sm:w-44">{key}</dt>
          <dd className="break-all font-mono text-gray-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
