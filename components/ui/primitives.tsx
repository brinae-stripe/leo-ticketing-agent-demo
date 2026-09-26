'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ---------------------------------- card ---------------------------------- */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4', className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-bold text-gray-900', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-[13px] leading-relaxed text-gray-500', className)} {...props} />;
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

/* --------------------------------- badge ---------------------------------- */

const badgeTones = {
  neutral: 'border-gray-300 bg-gray-50 text-gray-700',
  good: 'border-[#9ad8ba] bg-[#eefaf3] text-success',
  warn: 'border-[#f0d5a8] bg-[#fdf6e9] text-warning',
  danger: 'border-[#f2b9cd] bg-[#fdeef3] text-danger',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  purple: 'border-purple-100 bg-purple-50 text-purple-700',
  ink: 'border-gray-800 bg-ink text-white',
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** mcp / api surface marker — used everywhere a call is described. */
export function SurfaceBadge({ surface }: { surface: 'mcp' | 'api' }) {
  return (
    <Badge tone={surface === 'mcp' ? 'blue' : 'purple'} className="uppercase">
      {surface === 'mcp' ? 'MCP tool' : 'Direct API'}
    </Badge>
  );
}

/* -------------------------------- checkbox -------------------------------- */

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-300 bg-white p-3 text-[13px] leading-relaxed text-gray-700 transition-colors hover:border-gray-400 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-500"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/* -------------------------------- progress -------------------------------- */

export function Progress({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((value / total) * 100));
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-gray-200', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-blue-500 transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------- skeleton -------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200/80', className)} />;
}

/* ---------------------------------- input --------------------------------- */

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500',
        className,
      )}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-9 cursor-pointer appearance-none rounded-lg border border-gray-300 bg-white bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pl-3 pr-8 text-[13px] text-gray-900 focus:border-blue-500',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    />
  );
});

/* --------------------------------- tabs ----------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn('flex gap-1 overflow-x-auto border-b border-gray-200 scroll-thin', className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
              selected
                ? 'border-blue-500 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'nums ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                  selected ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- collapsible ------------------------------ */

export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn('overflow-hidden rounded-lg border border-gray-200', className)}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-gray-900">{title}</span>
          {subtitle && <span className="mt-0.5 block text-[12px] text-gray-500">{subtitle}</span>}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="border-t border-gray-200 bg-white">{children}</div>}
    </div>
  );
}

/* ------------------------------ empty state ------------------------------- */

export function EmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'stadium-dots-light flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="mb-3 text-gray-400">{icon}</div>}
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-gray-500">{description}</p>
      )}
    </div>
  );
}
