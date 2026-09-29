'use client';

import { ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { StadiumLights, Wordmark } from '@/components/brand/wordmark';
import {
  ChartLegend,
  FeeRateChart,
  MethodMixChart,
  VolumeSuccessChart,
} from '@/components/charts/trend-charts';
import { SimGate } from '@/components/layout/sim-gate';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle, Badge } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { AGENT, LENS } from '@/lib/brand';
import { SCALE_FACTOR, TOTAL_ACCOUNTS, TOTAL_CHARGES } from '@/lib/sim/constants';
import { countCompact, humanize, moneyCompact, percent } from '@/lib/sim/format';
import {
  overviewKpis,
  paymentMethodMix,
  platformTotals,
  topOrganizersByVolume,
  weeklyTrend,
  type Kpi,
} from '@/lib/sim/metrics';
import { useSim } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

export function Overview() {
  return (
    <>
      <Hero />
      <div className="mx-auto max-w-[84rem] space-y-8 px-4 py-8 sm:px-6">
        <SimGate>
          <OverviewBody />
        </SimGate>
      </div>
    </>
  );
}

function Hero() {
  const router = useRouter();
  const [question, setQuestion] = React.useState('');

  return (
    <section className="relative overflow-hidden bg-ink text-white">
      <StadiumLights />
      <div className="relative mx-auto max-w-[84rem] px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
          <Wordmark className="text-[11px]" /> &nbsp;·&nbsp; {LENS.platform.label}
        </p>
        <h1 className="font-display mt-3 max-w-3xl text-[32px] font-black leading-[1.1] sm:text-[44px]">
          Ask {AGENT} anything about payments.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70">
          One question, answered from the Data Pipeline tables, with the SQL shown and a
          proposed resolution you can execute — after you approve it. Across{' '}
          {countCompact(TOTAL_CHARGES * SCALE_FACTOR)} payment attempts and{' '}
          {TOTAL_ACCOUNTS} event organizers.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = question.trim();
            router.push(trimmed ? `/leo?q=${encodeURIComponent(trimmed)}` : '/leo');
          }}
          className="mt-8 max-w-2xl"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur focus-within:border-blue-400">
            <Sparkles className="ml-2 h-4 w-4 shrink-0 text-blue-300" aria-hidden />
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What disputes are due in the next 72 hours?"
              aria-label="Ask LEO"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[14.5px] text-white placeholder:text-white/40 focus:outline-none"
            />
            <Button type="submit" variant="inverse" className="shrink-0">
              Ask
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function OverviewBody() {
  const { data, index } = useSim();

  const kpis = React.useMemo(() => overviewKpis(data), [data]);
  const trend = React.useMemo(() => weeklyTrend(data, index), [data, index]);
  const mix = React.useMemo(() => paymentMethodMix(data), [data]);
  const organizers = React.useMemo(() => topOrganizersByVolume(data, index, 10), [data, index]);
  const totals = React.useMemo(() => platformTotals(data), [data]);

  const latest = trend[trend.length - 1];
  const previous = trend[trend.length - 2];

  return (
    <>
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-display text-[20px] font-bold text-gray-900">
            Where the platform stands
          </h2>
          <p className="text-[12.5px] text-gray-500">
            Trailing quarter · sampled at 1:{SCALE_FACTOR}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiTile key={kpi.id} kpi={kpi} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Volume and success rate, 13 weeks</CardTitle>
              <CardDescription>
                {moneyCompact(totals.volume)} of sampled volume across{' '}
                {totals.attempts.toLocaleString('en-US')} attempts.{' '}
                {latest && previous && (
                  <>
                    Latest week{' '}
                    <span className="font-semibold text-gray-700">
                      {percent(latest.successRate, 1)}
                    </span>{' '}
                    against {percent(previous.successRate, 1)} the week before.
                  </>
                )}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <VolumeSuccessChart data={trend} />
            <ChartLegend
              items={[
                { label: 'Volume', color: 'blue' },
                { label: 'Success rate', color: 'green' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>How buyers are paying</CardTitle>
              <CardDescription>
                Share of successful transactions each week.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <MethodMixChart data={trend} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Cost and risk</CardTitle>
              <CardDescription>
                Effective Stripe rate against disputes opened.{' '}
                <Link href="/leo?q=Why+did+our+effective+fee+go+up+last+week%3F" className="font-medium text-blue-600 hover:underline">
                  Ask why it moved
                </Link>
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <FeeRateChart data={trend} />
            <ChartLegend
              items={[
                { label: 'Effective Stripe rate', color: 'purple' },
                { label: 'Block rate', color: 'gray', dashed: true },
                { label: 'Disputes opened', color: 'amber' },
              ]}
            />
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Top organizers by volume</CardTitle>
              <CardDescription>Net of refunds, trailing quarter.</CardDescription>
            </div>
            <Link
              href="/organizers"
              className="shrink-0 text-[12.5px] font-medium text-blue-600 hover:underline"
            >
              All 70 organizers
            </Link>
          </CardHeader>
          <DataTable
            columns={[
              { key: 'name', label: 'Organizer' },
              { key: 'category', label: 'Category' },
              { key: 'volume', label: 'Net volume', align: 'right', kind: 'money' },
              { key: 'attempts', label: 'Attempts', align: 'right', kind: 'number' },
              { key: 'successRate', label: 'Success', align: 'right', kind: 'percent' },
              { key: 'disputes', label: 'Disputes', align: 'right', kind: 'number' },
            ]}
            rows={organizers.map((organizer) => ({
              ...organizer,
              category: humanize(organizer.category),
            }))}
            maxHeight="none"
          />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Method mix and conversion</CardTitle>
              <CardDescription>
                Where the conversion gap between wallets and typed cards shows up.
              </CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={[
              { key: 'label', label: 'Method' },
              { key: 'share', label: 'Share', align: 'right', kind: 'percent' },
              { key: 'conversion', label: 'Conversion', align: 'right', kind: 'percent' },
            ]}
            rows={mix as unknown as Record<string, unknown>[]}
            maxHeight="none"
          />
          <CardBody className="border-t border-gray-200">
            <Link
              href="/leo?q=Which+organizers%27+buyers+would+benefit+from+Apple+Pay+or+pay-over-time%3F"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-blue-600 hover:underline"
            >
              Which organizers should turn wallets on?
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </CardBody>
        </Card>
      </section>

      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[12.5px] leading-relaxed text-gray-600">
        <strong className="font-semibold text-gray-800">On the numbers.</strong> The seeded
        dataset is a 1:{SCALE_FACTOR} sample — {TOTAL_CHARGES.toLocaleString('en-US')} charge
        rows standing in for {(TOTAL_CHARGES * SCALE_FACTOR).toLocaleString('en-US')} payment
        attempts a quarter. Rates are read straight off the sample; absolute counts and
        amounts are the sample&apos;s own.{' '}
        <Link href="/how-it-works" className="font-medium text-blue-600 hover:underline">
          More on how this is put together
        </Link>
        .
      </p>
    </>
  );
}

function KpiTile({ kpi }: { kpi: Kpi }) {
  const tone = {
    neutral: 'text-gray-900',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-danger',
  }[kpi.tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-medium leading-snug text-gray-500">{kpi.label}</p>
        {kpi.ask && (
          <Badge tone="blue" className="shrink-0">
            Ask
          </Badge>
        )}
      </div>
      <p className={cn('nums font-display mt-2 text-[28px] font-black leading-none', tone)}>
        {kpi.value}
      </p>
      <p className="mt-1.5 text-[12px] leading-snug text-gray-500">{kpi.hint}</p>
    </>
  );

  if (!kpi.ask) {
    return (
      <Card>
        <CardBody>{body}</CardBody>
      </Card>
    );
  }

  return (
    <Card className="transition-colors hover:border-blue-400 hover:bg-blue-50/30">
      <Link href={`/leo?q=${encodeURIComponent(kpi.ask)}`} className="block px-5 py-4">
        {body}
      </Link>
    </Card>
  );
}
