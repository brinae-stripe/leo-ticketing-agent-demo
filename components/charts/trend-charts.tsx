'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { count, moneyCompact, percent, shortDate } from '@/lib/sim/format';
import type { EventActivityPoint, WeeklyPoint } from '@/lib/sim/metrics';

/**
 * Chart palette. Brilliant blue leads; purple and cool gray support it. Green
 * and amber appear only where a series needs to read as good or as a warning.
 */
const COLORS = {
  blue: '#1F5EFF',
  purple: '#7A3BFF',
  gray: '#6B7280',
  green: '#0B8A4B',
  amber: '#B45309',
} as const;

const AXIS = {
  stroke: '#9CA3AF',
  fontSize: 11,
  fontFamily: 'var(--font-body)',
} as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-lift">
      <p className="mb-1 font-semibold text-gray-900">Week of {label}</p>
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600">{entry.name}</span>
            <span className="nums ml-auto font-semibold text-gray-900">
              {formatByKey(String(entry.dataKey), entry.value ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatByKey(key: string, value: number): string {
  if (key === 'volume') return moneyCompact(value);
  if (key.endsWith('Rate') || key === 'successRate' || key === 'blockRate') {
    return percent(value, 2);
  }
  return value.toLocaleString('en-US');
}

/** Fixed heights everywhere — a chart that measures itself causes layout shift. */
const HEIGHT = 240;

export function VolumeSuccessChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#F3F4F6" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis
            yAxisId="volume"
            tickFormatter={(value: number) => moneyCompact(value)}
            tickLine={false}
            axisLine={false}
            width={52}
            {...AXIS}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0.9, 1]}
            tickFormatter={(value: number) => percent(value, 0)}
            tickLine={false}
            axisLine={false}
            width={44}
            {...AXIS}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            yAxisId="volume"
            dataKey="volume"
            name="Volume"
            fill={COLORS.blue}
            radius={[3, 3, 0, 0]}
            maxBarSize={26}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="successRate"
            name="Success rate"
            stroke={COLORS.green}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MethodMixChart({ data }: { data: WeeklyPoint[] }) {
  // Shares rather than counts, so the mix shift is legible even as volume moves.
  const shaped = React.useMemo(
    () =>
      data.map((point) => {
        const total = Math.max(1, point.succeeded);
        return {
          label: point.label,
          manual: (point.onlineCard - point.wallet - point.link) / total,
          wallet: point.wallet / total,
          link: point.link / total,
          cardPresent: point.cardPresent / total,
          bnpl: point.bnpl / total,
        };
      }),
    [data],
  );

  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={shaped} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#F3F4F6" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis
            tickFormatter={(value: number) => percent(value, 0)}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, 1]}
            {...AXIS}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-lift">
                  <p className="mb-1 font-semibold text-gray-900">Week of {label}</p>
                  <ul className="space-y-0.5">
                    {payload.map((entry, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-gray-600">{entry.name}</span>
                        <span className="nums ml-auto font-semibold text-gray-900">
                          {percent(Number(entry.value ?? 0), 1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="manual"
            name="Card, typed"
            stackId="mix"
            stroke={COLORS.gray}
            fill={COLORS.gray}
            fillOpacity={0.22}
          />
          <Area
            type="monotone"
            dataKey="link"
            name="Link"
            stackId="mix"
            stroke={COLORS.blue}
            fill={COLORS.blue}
            fillOpacity={0.28}
          />
          <Area
            type="monotone"
            dataKey="wallet"
            name="Apple / Google Pay"
            stackId="mix"
            stroke={COLORS.purple}
            fill={COLORS.purple}
            fillOpacity={0.28}
          />
          <Area
            type="monotone"
            dataKey="cardPresent"
            name="Card present"
            stackId="mix"
            stroke={COLORS.green}
            fill={COLORS.green}
            fillOpacity={0.24}
          />
          <Area
            type="monotone"
            dataKey="bnpl"
            name="Pay over time"
            stackId="mix"
            stroke={COLORS.amber}
            fill={COLORS.amber}
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FeeRateChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#F3F4F6" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} />
          <YAxis
            yAxisId="rate"
            tickFormatter={(value: number) => percent(value, 1)}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={['auto', 'auto']}
            {...AXIS}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
            {...AXIS}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            yAxisId="count"
            dataKey="disputes"
            name="Disputes opened"
            fill={COLORS.amber}
            fillOpacity={0.35}
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="effectiveFeeRate"
            name="Effective Stripe rate"
            stroke={COLORS.purple}
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="blockRate"
            name="Block rate"
            stroke={COLORS.gray}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Event activity                                                             */
/* -------------------------------------------------------------------------- */

export type ActivityMetric = 'tickets' | 'revenue' | 'conversion';

export const ACTIVITY_METRICS: { key: ActivityMetric; label: string; note: string }[] = [
  { key: 'tickets', label: 'Ticket sales', note: 'Tickets issued per day.' },
  { key: 'revenue', label: 'Revenue', note: 'Net of refunds, per day.' },
  {
    key: 'conversion',
    label: 'Conversion',
    note: 'Payments authorised as a share of payments attempted — not page views.',
  },
];

/**
 * Daily sales curve for one event, mirroring the "recent activity" module an
 * event back office puts at the top of an event overview.
 *
 * Deliberately one metric at a time. Tickets, revenue and conversion have three
 * unrelated units, and a dual-axis chart that pretends otherwise invites the
 * wrong read — a revenue spike sitting above a conversion dip looks like cause
 * and effect when it is usually just a price mix change.
 */
export function EventActivityChart({
  data,
  metric,
}: {
  data: EventActivityPoint[];
  metric: ActivityMetric;
}) {
  const series = React.useMemo(
    () =>
      data.map((point) => ({
        label: shortDate(point.day),
        tickets: point.tickets,
        revenue: point.revenue,
        // Days with no attempts have no conversion rate. `null` leaves a gap in
        // the line; zero would draw a cliff to the axis that did not happen.
        conversion: point.attempts > 0 ? point.orders / point.attempts : null,
      })),
    [data],
  );

  const config = {
    tickets: { name: 'Tickets', color: COLORS.blue, format: (v: number) => count(v) },
    revenue: { name: 'Revenue', color: COLORS.purple, format: moneyCompact },
    conversion: { name: 'Conversion', color: COLORS.green, format: (v: number) => percent(v, 1) },
  }[metric];

  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`activity-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={config.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#F3F4F6" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
            {...AXIS}
          />
          <YAxis
            tickFormatter={config.format}
            tickLine={false}
            axisLine={false}
            width={54}
            domain={metric === 'conversion' ? [0, 1] : undefined}
            {...AXIS}
          />
          <Tooltip content={<ActivityTooltip format={config.format} />} />
          <Area
            type="monotone"
            dataKey={metric}
            name={config.name}
            stroke={config.color}
            strokeWidth={2}
            fill={`url(#activity-${metric})`}
            connectNulls={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActivityTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | null; color?: string }[];
  label?: string | number;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-lift">
      <p className="mb-1 font-semibold text-gray-900">{label}</p>
      <p className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
        <span className="text-gray-600">{entry.name}</span>
        <span className="nums ml-auto font-semibold text-gray-900">
          {entry.value == null ? 'no sales' : format(entry.value)}
        </span>
      </p>
    </div>
  );
}

export function ChartLegend({
  items,
}: {
  items: { label: string; color: keyof typeof COLORS; dashed?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[12px] text-gray-600">
          <span
            className="h-2 w-4 rounded-full"
            style={{
              backgroundColor: item.dashed ? 'transparent' : COLORS[item.color],
              borderTop: item.dashed ? `2px dashed ${COLORS[item.color]}` : undefined,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
