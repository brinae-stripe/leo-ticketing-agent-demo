'use client';

import { Database, ScrollText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AskChat } from '@/components/ask/chat';
import { StadiumLights } from '@/components/brand/wordmark';
import { SimGate } from '@/components/layout/sim-gate';
import { AGENT, LENS, PLATFORM } from '@/lib/brand';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { INTERNAL_SCENARIOS } from '@/lib/scenarios';
import { SCALE_FACTOR, TOTAL_CHARGES } from '@/lib/sim/constants';
import { SQL_TABLE_NAMES } from '@/lib/sql/engine';

export function LeoPage({ initialQuestion }: { initialQuestion?: string }) {
  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <StadiumLights />
        <div className="relative mx-auto max-w-[84rem] px-4 py-8 sm:px-6 sm:py-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            {LENS.platform.label}
          </p>
          <h1 className="font-display mt-2 text-[26px] font-black leading-tight sm:text-[32px]">
            Ask {AGENT}
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/70">
            {LENS.platform.persona} works in {PLATFORM} finance and operations, so she sees
            every organizer on the platform. {AGENT} reads the simulated Data Pipeline tables,
            shows the SQL it ran, proposes a resolution, and offers actions that need her
            approval before anything executes.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-[84rem] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <SimGate>
          <AskChat scope="internal" initialQuestion={initialQuestion} />
        </SimGate>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[13.5px]">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                How it behaves
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5 text-[12.5px] leading-relaxed text-gray-600">
              <p>
                Nothing runs without a human. Every action opens a sheet showing the exact
                request, the totals it moves, and a required approver name.
              </p>
              <p>
                Aggregate refunds over $10,000 and any account debit need a second explicit
                acknowledgement on top of that.
              </p>
              <p>
                Where a recommendation has no API — Radar rules, network tokens, Adaptive
                Acceptance — it says so instead of offering a button.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[13.5px]">
                <Database className="h-4 w-4 text-purple-500" />
                What it can see
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              <p className="text-[12.5px] leading-relaxed text-gray-600">
                {SQL_TABLE_NAMES.length} tables, {TOTAL_CHARGES.toLocaleString('en-US')}{' '}
                sampled charge rows standing in for{' '}
                {(TOTAL_CHARGES * SCALE_FACTOR).toLocaleString('en-US')} attempts a quarter.
              </p>
              <div className="flex flex-wrap gap-1">
                {SQL_TABLE_NAMES.slice(0, 12).map((table) => (
                  <code
                    key={table}
                    className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-600"
                  >
                    {table}
                  </code>
                ))}
                <span className="text-[11px] text-gray-400">
                  +{SQL_TABLE_NAMES.length - 12} more
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[13.5px]">Scenario catalogue</CardTitle>
              <Badge tone="neutral">{INTERNAL_SCENARIOS.length}</Badge>
            </CardHeader>
            <CardBody className="space-y-2">
              {INTERNAL_SCENARIOS.map((scenario) => (
                <Link
                  key={scenario.id}
                  href={`/leo?q=${encodeURIComponent(scenario.suggestedPrompt)}`}
                  className="block rounded-md px-2 py-1.5 text-[12.5px] leading-snug text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                >
                  {scenario.title}
                </Link>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Link
                href="/audit"
                className="flex items-center gap-2 text-[13px] font-medium text-blue-600 hover:underline"
              >
                <ScrollText className="h-4 w-4" />
                Audit log
              </Link>
              <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                Every simulated call, with its request and response.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
