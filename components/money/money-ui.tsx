'use client';

import Link from 'next/link';
import * as React from 'react';

import { Badge, Card, CardBody } from '@/components/ui/primitives';
import { count, money, shortDate } from '@/lib/sim/format';
import {
  activityKindLabel,
  type ActivityEntry,
  type ProductState,
} from '@/lib/sim/money';
import { cn } from '@/lib/utils';

/**
 * The money section's shared furniture.
 *
 * Every figure rendered through these is the organizer's own and unscaled, the
 * same as their charge rows — the 1:100 sampling is of organizers, not of each
 * organizer's payments. `PlatformScaleNote` is for the platform pages, where a
 * total across all organizers is an extrapolation and should say so.
 */

/* --------------------------------- hero ----------------------------------- */

export function BalanceHero({
  label,
  amount,
  inbound,
  outbound,
  asideLabel,
  asideValue,
  asideHint,
  tag,
}: {
  label: string;
  amount: number;
  inbound?: number;
  outbound?: number;
  asideLabel?: string;
  asideValue?: string;
  asideHint?: string;
  tag?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-money-hero text-white">
      <div className="flex flex-wrap items-center justify-between gap-6 px-6 py-6 sm:px-8 sm:py-7">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-white/60">{label}</p>
          <p className="nums font-display mt-1 text-[38px] font-black leading-none tracking-tight sm:text-[46px]">
            {money(amount)}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-white/55">
            {inbound != null && <span>{money(inbound)} on the way</span>}
            {inbound != null && outbound != null && <span aria-hidden>·</span>}
            {outbound != null && <span>{money(outbound)} pending out</span>}
            {tag && (
              <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                {tag}
              </span>
            )}
          </div>
        </div>

        {asideValue && (
          <div className="border-white/15 sm:border-l sm:pl-8">
            <p className="text-[12.5px] text-white/55">{asideLabel}</p>
            <p className="font-display mt-0.5 text-[22px] font-bold leading-tight">
              {asideValue}
            </p>
            {asideHint && <p className="mt-0.5 text-[12px] text-white/50">{asideHint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ status tiles ------------------------------- */

const STATE_COPY: Record<ProductState, { label: string; tone: 'good' | 'blue' | 'neutral' }> = {
  active: { label: 'Active', tone: 'good' },
  requested: { label: 'Requested', tone: 'blue' },
  available: { label: 'Not enabled', tone: 'neutral' },
  none: { label: 'Unavailable', tone: 'neutral' },
};

export function ProductTile({
  title,
  state,
  detail,
  href,
}: {
  title: string;
  state: ProductState;
  detail: string;
  href?: string;
}) {
  const copy = STATE_COPY[state];
  const body = (
    <CardBody>
      <p className="text-[12px] font-medium text-gray-500">{title}</p>
      <p
        className={cn(
          'font-display mt-1 text-[21px] font-black leading-none',
          state === 'active' ? 'text-gray-900' : 'text-gray-400',
        )}
      >
        {copy.label}
      </p>
      <p className="mt-1.5 text-[12px] leading-snug text-gray-500">{detail}</p>
    </CardBody>
  );

  if (!href) return <Card>{body}</Card>;
  return (
    <Card className="transition-colors hover:border-blue-200 hover:bg-blue-50/30">
      <Link href={href} className="block">
        {body}
      </Link>
    </Card>
  );
}

/* --------------------------------- figures -------------------------------- */

export function MoneyStat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-[12px] font-medium text-gray-500">{label}</p>
        <p
          className={cn(
            'nums font-display mt-1.5 text-[23px] font-black leading-none',
            tone === 'danger'
              ? 'text-danger'
              : tone === 'warn'
                ? 'text-warning'
                : tone === 'good'
                  ? 'text-success'
                  : 'text-gray-900',
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-[11.5px] leading-snug text-gray-500">{hint}</p>}
      </CardBody>
    </Card>
  );
}

export function DefinitionRow({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 py-2 last:border-0">
      <dt className="text-[13px] text-gray-500">
        {label}
        {hint && <span className="block text-[11.5px] leading-snug text-gray-400">{hint}</span>}
      </dt>
      <dd
        className={cn(
          'text-[13.5px] font-semibold text-gray-900',
          mono ? 'font-mono text-[12.5px]' : 'nums',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------- activity -------------------------------- */

/**
 * The money timeline.
 *
 * Three states get distinct treatment, because each has a different relationship
 * to the balance shown above the table:
 *
 *   - settled rows are counted in it, and render in full colour;
 *   - pending and processing rows are not counted yet, and render muted;
 *   - declined authorisations never moved money at all, and render at zero with
 *     the amount struck through.
 *
 * The last is the most useful row on a cards page and also the one that must not
 * affect a total. Showing it as a negative would be a lie; hiding it would waste
 * the point of spend controls.
 */
export function ActivityTable({
  entries,
  emptyMessage = 'Nothing has moved through this account yet.',
  limit,
}: {
  entries: ActivityEntry[];
  emptyMessage?: string;
  limit?: number;
}) {
  const rows = limit ? entries.slice(0, limit) : entries;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-gray-500">{emptyMessage}</p>
    );
  }

  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-gray-50">
          <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
            <th className="px-4 py-2.5 text-left font-semibold">Description</th>
            <th className="px-4 py-2.5 text-left font-semibold">Type</th>
            <th className="px-4 py-2.5 text-left font-semibold">Status</th>
            <th className="px-4 py-2.5 text-right font-semibold">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id} className="border-b border-gray-100 last:border-0">
              <td
                className={cn(
                  'nums px-4 py-2.5 text-right font-semibold',
                  entry.declined
                    ? 'text-gray-400 line-through'
                    : // Pending and processing rows have not hit the balance yet,
                      // so they are muted — the balance above does not include
                      // them and the colour should not imply that it does.
                      entry.status === 'pending' || entry.status === 'processing'
                      ? 'text-gray-400'
                      : entry.amount > 0
                        ? 'text-success'
                        : 'text-gray-900',
                )}
              >
                {entry.declined
                  ? money(0)
                  : `${entry.amount > 0 ? '+' : ''}${money(entry.amount)}`}
              </td>
              <td className="px-4 py-2.5">
                <span className="capitalize text-gray-900">{entry.description}</span>
                {entry.counterparty && (
                  <span className="block text-[11.5px] text-gray-500">
                    {entry.counterparty}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-gray-600">{activityKindLabel(entry.kind)}</td>
              <td className="px-4 py-2.5">
                <Badge
                  tone={
                    entry.status === 'declined'
                      ? 'danger'
                      : entry.status === 'processing' || entry.status === 'pending'
                        ? 'warn'
                        : 'neutral'
                  }
                >
                  {entry.status}
                </Badge>
              </td>
              <td className="nums px-4 py-2.5 text-right text-gray-500">
                {shortDate(entry.created)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- notes ---------------------------------- */

/**
 * Says out loud where a total is an extrapolation rather than a sum.
 */
export function PlatformScaleNote({ className }: { className?: string }) {
  return (
    <p className={cn('text-[12px] leading-relaxed text-gray-500', className)}>
      Totals in this section are at platform scale. The 70 organizers in this dataset are a
      1:100 sample of the platform&apos;s, so figures across all of them are multiplied up.
      Any single organizer&apos;s own numbers are theirs, unscaled.
    </p>
  );
}

export function SectionHeading({
  title,
  blurb,
  actions,
}: {
  title: string;
  blurb?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[24px] font-black leading-tight text-gray-900">
          {title}
        </h1>
        {blurb && <p className="mt-1 max-w-3xl text-[13.5px] text-gray-500">{blurb}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export { count };
