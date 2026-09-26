import type { Metadata } from 'next';
import { CircleCheck, Database, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { StadiumLights, Wordmark } from '@/components/brand/wordmark';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { INTERNAL_SCENARIOS, ORGANIZER_SCENARIOS } from '@/lib/scenarios';
import { NOW_ISO, SCALE_FACTOR, TARGETS, TOTAL_ACCOUNTS, TOTAL_CHARGES } from '@/lib/sim/constants';
import { SCHEMA_CAVEATS, TABLE_DOCS, TABLE_SOURCE_LABELS } from '@/lib/sql/tables';
import { DASHBOARD_ONLY } from '@/lib/stripe-sim/dashboard-only';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'The architecture behind StageGate Ask, what is simulated, and where the boundaries are.',
};

const MCP_TOOLS = [
  'create_refund',
  'update_dispute',
  'list_disputes',
  'list_payment_intents',
  'create_invoice',
  'create_invoice_item',
  'finalize_invoice',
  'create_payment_link',
  'retrieve_balance',
  'search_stripe_resources',
  'fetch_stripe_resources',
];

const API_CALLS = [
  { path: 'POST /v1/disputes/:id/close', why: 'Accepting a dispute.' },
  { path: 'POST /v1/reviews/:id/approve', why: 'Releasing a Radar review.' },
  { path: 'POST /v1/radar/value_list_items', why: 'Block and allow lists.' },
  { path: 'POST /v1/transfers', why: 'Account debits — Stripe-Account is the host, destination is the platform.' },
  { path: 'POST /v1/transfers/:id/reversals', why: 'Clawing a transfer back.' },
  { path: 'POST /v1/accounts/:id', why: 'Changing a payout schedule.' },
  { path: 'POST /v1/account_links', why: 'Onboarding links.' },
  { path: 'POST /v1/payouts', why: 'Instant payouts, in the host context.' },
  { path: 'POST /v1/payment_method_configurations/:id', why: 'Turning wallets or pay-over-time on.' },
  { path: 'POST /v1/reporting/report_runs', why: 'Itemized fee and reconciliation reports.' },
  { path: 'POST /v1/sigma/query_runs', why: 'Scheduling a query.' },
  { path: 'POST /v1/terminal/readers/:id/refund_payment', why: 'Refunding at the reader.' },
];

export default function Page() {
  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <StadiumLights />
        <div className="relative mx-auto max-w-[84rem] px-4 py-12 sm:px-6 sm:py-16">
          <h1 className="font-display max-w-3xl text-[30px] font-black leading-[1.15] sm:text-[40px]">
            How this demo is put together
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70">
            <Wordmark className="text-[15px]" /> is a fictional ticketing platform. The data,
            the hosts and the events are all generated. So is every API call. What is real is
            the shape: the table names, the endpoints, the approval flow, and the places where
            an agent has to stop and ask a human.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[84rem] space-y-10 px-4 py-10 sm:px-6">
        <Disclaimer />
        <Architecture />
        <Surfaces />
        <DashboardOnlySection />
        <DataSection />
        <ScenarioSection />
      </div>
    </>
  );
}

function Disclaimer() {
  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardBody>
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="space-y-2 text-[13.5px] leading-relaxed text-gray-700">
            <p className="font-display text-[16px] font-bold text-gray-900">
              Nothing here touches Stripe.
            </p>
            <p>
              There is no <code className="font-mono text-[12.5px]">stripe</code> package in
              this project, no API key is read from anywhere, and no MCP client exists. Every
              &ldquo;call&rdquo; resolves in-process against a seeded dataset after a 400–900ms
              delay, returns a realistically shaped object, writes an audit entry, and mutates
              local state so the rest of the app reflects it.
            </p>
            <p>
              The agent is not a language model either. It matches your question against a
              catalogue of {INTERNAL_SCENARIOS.length + ORGANIZER_SCENARIOS.length} scenarios by
              phrase and then by keyword, and falls back to telling you what it can do rather
              than guessing. The streaming effect is cosmetic.
            </p>
            <p>
              The SQL, though, is real. It executes in your browser through alasql against the
              same in-memory rows the rest of the pages read, and you can edit and re-run any
              of it from the &ldquo;Data used&rdquo; panel.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Architecture() {
  const stages = [
    {
      title: 'Data Pipeline',
      body: 'Stripe writes charges, balance transactions, disputes and payouts into your warehouse on a schedule.',
      tone: 'ink' as const,
    },
    {
      title: 'Warehouse',
      body: 'Joined against platform-side tables Stripe has never seen — the event catalogue, gate scans, the service fee ledger.',
      tone: 'ink' as const,
    },
    {
      title: 'Agent',
      body: 'Matches the question to a scenario, runs its SQL, and writes a narrative with the numbers in it.',
      tone: 'blue' as const,
    },
    {
      title: 'Human approval',
      body: 'Request preview, totals, approver name. Large refunds and account debits need a second acknowledgement.',
      tone: 'blue' as const,
    },
    {
      title: 'MCP tools / REST API',
      body: 'Executes, then records what it did in the audit log.',
      tone: 'purple' as const,
    },
  ];

  return (
    <section>
      <h2 className="font-display text-[22px] font-bold text-gray-900">The shape of it</h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        The interesting join is the one Stripe cannot do for you. A dispute on a ticket is just
        a dispute until you join it to the gate scan that proves the buyer walked in — that is
        the difference between a queue you work and a queue you win.
      </p>

      <ol className="mt-5 grid gap-3 lg:grid-cols-5">
        {stages.map((stage, i) => (
          <li key={stage.title} className="relative">
            <Card className="h-full">
              <CardBody>
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      'nums flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold text-white',
                      stage.tone === 'ink'
                        ? 'bg-ink'
                        : stage.tone === 'blue'
                          ? 'bg-blue-500'
                          : 'bg-purple-500',
                    ].join(' ')}
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-[13.5px] font-bold text-gray-900">{stage.title}</h3>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600">{stage.body}</p>
              </CardBody>
            </Card>
            {i < stages.length - 1 && (
              <span
                aria-hidden
                className="absolute -right-2 top-1/2 hidden h-px w-4 -translate-y-1/2 bg-gray-300 lg:block"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Surfaces() {
  return (
    <section>
      <h2 className="font-display text-[22px] font-bold text-gray-900">
        Two surfaces, tagged everywhere
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        Every action in this demo is labelled with how it would execute, because the difference
        matters when you build it. MCP tools are a curated surface the agent can be pointed at
        safely. Everything else is code you write, own and secure yourself.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Badge tone="blue">MCP tool</Badge>
                Hosted Stripe MCP server
              </CardTitle>
              <CardDescription>
                {MCP_TOOLS.length} tools. The agent picks the tool and fills the arguments —
                there is no URL to construct and no key in your prompt path.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-wrap gap-1.5">
              {MCP_TOOLS.map((tool) => (
                <li key={tool}>
                  <code className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-[11.5px] text-blue-800">
                    {tool}
                  </code>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Badge tone="purple">Direct API</Badge>
                Endpoints with no MCP tool
              </CardTitle>
              <CardDescription>
                {API_CALLS.length} calls this demo needs that the tool surface does not cover.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2.5">
              {API_CALLS.map((call) => (
                <div key={call.path}>
                  <dt>
                    <code className="font-mono text-[11.5px] font-semibold text-purple-700">
                      {call.path}
                    </code>
                  </dt>
                  <dd className="mt-0.5 text-[12.5px] leading-snug text-gray-600">{call.why}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              What approval actually gates
            </CardTitle>
          </div>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {[
              'Plain-English description of the effect, before any jargon',
              'Method, path, and headers including Stripe-Account and Idempotency-Key',
              'The JSON body exactly as it would be sent',
              'Dollar and count totals, with the after-state where money moves',
              'A required approver name, recorded in the audit log',
              'A second checkbox for refunds over $10,000 and for every account debit',
            ].map((item) => (
              <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

function DashboardOnlySection() {
  const capabilities = Object.values(DASHBOARD_ONLY);
  return (
    <section>
      <h2 className="font-display flex items-center gap-2 text-[22px] font-bold text-gray-900">
        <LockKeyhole className="h-5 w-5 text-gray-500" />
        Things there is no button for
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        {capabilities.length} real Stripe capabilities have no API or MCP surface — they are
        Dashboard settings, support requests, or account-level enablements. When a scenario
        recommends one, the agent renders a chip explaining why and who should own it, rather
        than a button that quietly does nothing. An agent that silently no-ops here is worse
        than one that admits the limit.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {capabilities.map((capability) => (
          <Card key={capability.id}>
            <CardBody>
              <Badge tone="neutral">Dashboard-only</Badge>
              <h3 className="mt-2 text-[13.5px] font-bold text-gray-900">{capability.label}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600">
                {capability.why}
              </p>
              <dl className="mt-3 space-y-1 text-[12px]">
                <div className="flex gap-1.5">
                  <dt className="font-semibold text-gray-500">Where:</dt>
                  <dd className="text-gray-700">{capability.where}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="font-semibold text-gray-500">Owner:</dt>
                  <dd className="text-gray-700">{capability.owner}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function DataSection() {
  const grouped = TABLE_DOCS.reduce<Record<string, typeof TABLE_DOCS>>((acc, table) => {
    (acc[table.source] ??= []).push(table);
    return acc;
  }, {});

  return (
    <section>
      <h2 className="font-display flex items-center gap-2 text-[22px] font-bold text-gray-900">
        <Database className="h-5 w-5 text-purple-500" />
        The data
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        {TOTAL_CHARGES.toLocaleString('en-US')} charge rows across {TOTAL_ACCOUNTS} hosts,
        generated from a fixed seed so every run of this demo is byte-identical. &ldquo;Now&rdquo;
        is pinned to <code className="font-mono text-[12.5px]">{NOW_ISO}</code> — nothing drifts
        as the real clock moves.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Scale factor: 1:{SCALE_FACTOR}</CardTitle>
              <CardDescription>
                The story is a platform doing ~
                {(TOTAL_CHARGES * SCALE_FACTOR).toLocaleString('en-US')} attempts a quarter.
                Holding that in a browser tab is not realistic, so{' '}
                {TOTAL_CHARGES.toLocaleString('en-US')} rows stand in for it.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <p className="text-[13px] leading-relaxed text-gray-700">
              Rates — success, block, mix, dispute rate — are read straight off the sample and
              are directly comparable to a real platform&apos;s. Absolute counts and amounts are
              the sample&apos;s own, and anywhere the UI quotes a platform-wide total it says
              so.
            </p>
            <h4 className="label-xs mt-4 mb-2">Calibrated to</h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
              {[
                ['Payment success', TARGETS.paymentSuccessRate],
                ['Block rate', TARGETS.blockRate],
                ['Wallet share of attempts', TARGETS.walletShareOfAttempts],
                ['Link share of transactions', TARGETS.linkShareOfTransactions],
                ['Card present', TARGETS.cardPresentShareOfAttempts],
                ['Dispute rate', TARGETS.disputeRate],
                ['Non-US cards', TARGETS.nonUsCardShare],
                ['Outdated card declines', TARGETS.outdatedCardDetailsDeclineRate],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-2">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="nums font-semibold text-gray-900">
                    {(Number(value) * 100).toFixed(2)}%
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Non-US conversion gap</dt>
                <dd className="nums font-semibold text-gray-900">
                  ~{TARGETS.nonUsConversionGapPts} pts
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Debit conversion gap</dt>
                <dd className="nums font-semibold text-gray-900">
                  ~{TARGETS.debitConversionGapPts} pts
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Where the schema departs from Sigma</CardTitle>
              <CardDescription>
                Four deliberate simplifications, stated rather than hidden.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <dl className="space-y-3">
              {SCHEMA_CAVEATS.map((caveat) => (
                <div key={caveat.title}>
                  <dt className="text-[13px] font-semibold text-gray-900">{caveat.title}</dt>
                  <dd className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">
                    {caveat.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {Object.entries(grouped).map(([source, tables]) => (
          <Card key={source}>
            <CardHeader>
              <CardTitle className="text-[13.5px]">
                {TABLE_SOURCE_LABELS[source as keyof typeof TABLE_SOURCE_LABELS]}
              </CardTitle>
              <Badge tone="neutral">{tables.length}</Badge>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2">
                {tables.map((table) => (
                  <div key={table.name}>
                    <dt>
                      <code className="font-mono text-[11.5px] font-semibold text-gray-800">
                        {table.name}
                      </code>
                    </dt>
                    <dd className="mt-0.5 text-[12px] leading-snug text-gray-600">
                      {table.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ScenarioSection() {
  return (
    <section>
      <h2 className="font-display text-[22px] font-bold text-gray-900">
        The {INTERNAL_SCENARIOS.length + ORGANIZER_SCENARIOS.length} scenarios
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        Each one owns its trigger phrases, its SQL, its narrative and its actions. Adding
        another is one file and one line in the registry — see the README.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {[
          { heading: 'Internal operations', scenarios: INTERNAL_SCENARIOS },
          { heading: 'Organizer copilot', scenarios: ORGANIZER_SCENARIOS },
        ].map((group) => (
          <Card key={group.heading}>
            <CardHeader>
              <CardTitle className="text-[13.5px]">{group.heading}</CardTitle>
              <Badge tone="neutral">{group.scenarios.length}</Badge>
            </CardHeader>
            <CardBody>
              <ol className="space-y-3">
                {group.scenarios.map((scenario) => (
                  <li key={scenario.id}>
                    <p className="text-[13px] font-semibold text-gray-900">
                      {group.heading === 'Internal operations' ? (
                        <Link
                          href={`/ask?q=${encodeURIComponent(scenario.suggestedPrompt)}`}
                          className="text-blue-600 hover:underline"
                        >
                          {scenario.suggestedPrompt}
                        </Link>
                      ) : (
                        scenario.suggestedPrompt
                      )}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">
                      {scenario.blurb}
                    </p>
                  </li>
                ))}
              </ol>
              {group.heading === 'Organizer copilot' && (
                <p className="mt-4 text-[12.5px] leading-relaxed text-gray-500">
                  Organizer scenarios only run scoped to a single connected account — open any
                  host and use the Organizer copilot tab.
                </p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}
