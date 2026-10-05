import type { Metadata } from 'next';
import {
  Building2,
  CircleCheck,
  Database,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';

import { AskAgentLink } from '@/components/layout/app-shell';
import { StadiumLights, Wordmark } from '@/components/brand/wordmark';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { AGENT, AGENT_GLOSS, LENS, PLATFORM } from '@/lib/brand';
import { INTERNAL_SCENARIOS, ORGANIZER_SCENARIOS } from '@/lib/scenarios';
import { NOW_ISO, SCALE_FACTOR, TARGETS, TOTAL_ACCOUNTS, TOTAL_CHARGES } from '@/lib/sim/constants';
import { SCHEMA_CAVEATS, TABLE_DOCS, TABLE_SOURCE_LABELS } from '@/lib/sql/tables';
import { DASHBOARD_ONLY } from '@/lib/stripe-sim/dashboard-only';

export const metadata: Metadata = {
  title: 'How it works',
  description: `The architecture behind ${AGENT}, the two views it serves, what is simulated, and where the boundaries are.`,
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
  {
    path: 'POST /v1/transfers',
    why: `Account debits — Stripe-Account is the organizer, destination is ${PLATFORM}.`,
  },
  { path: 'POST /v1/transfers/:id/reversals', why: 'Clawing a transfer back.' },
  {
    path: 'POST /v1/accounts/:id',
    why: 'Payout schedules, and requesting the card_issuing capability.',
  },
  { path: 'POST /v1/account_links', why: 'Onboarding links.' },
  {
    path: 'POST /v1/account_sessions',
    why: 'Embedding a Stripe-hosted component the organizer completes themselves.',
  },
  { path: 'POST /v1/payouts', why: 'Instant payouts, in the organizer context.' },
  {
    path: 'POST /v1/payment_method_configurations/:id',
    why: 'Turning wallets or pay-over-time on.',
  },
  {
    path: 'POST /v1/capital/financing_offers/:id/mark_delivered',
    why: 'Recording that an organizer has been shown an offer.',
  },
  { path: 'POST /v1/treasury/financial_accounts', why: 'Opening a stored balance.' },
  { path: 'POST /v1/treasury/outbound_payments', why: 'Paying a vendor out of that balance.' },
  { path: 'POST /v1/issuing/cardholders', why: 'Someone on the team who can hold a card.' },
  { path: 'POST /v1/issuing/cards', why: 'The card, with its spending controls attached.' },
  { path: 'POST /v1/reporting/report_runs', why: 'Itemized fee and reconciliation reports.' },
  { path: 'POST /v1/sigma/query_runs', why: 'Scheduling a query.' },
  { path: 'POST /v1/terminal/readers/:id/refund_payment', why: 'Refunding at the reader.' },
];

export default function Page() {
  return (
    <>
      <Hero />
      <div className="mx-auto max-w-[84rem] space-y-12 px-4 py-10 sm:px-6">
        <Disclaimer />
        <TheFlow />
        <TheTwoViews />
        <TheMoneySection />
        <Surfaces />
        <DashboardOnlySection />
        <DataSection />
      </div>
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink text-white">
      <StadiumLights />
      <div className="relative mx-auto max-w-[84rem] px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display max-w-3xl text-[30px] font-black leading-[1.15] sm:text-[40px]">
          Two views, one pipeline
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70">
          <Wordmark className="text-[15px]" /> is a fictional ticketing platform, and {AGENT} —
          the {AGENT_GLOSS} — is the agent inside it. Use the <strong>Viewing as</strong> control
          at the top of the sidebar to move between the two: the platform&apos;s own back office,
          and one organizer&apos;s account. The whole rail changes, because they are genuinely
          different products. The data, the organizers and the events are all generated. So is
          every API call. What is real is the shape.
        </p>
      </div>
    </section>
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
              {AGENT} is not a language model here either. It matches your question against a
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

/* -------------------------------------------------------------------------- */
/* The flow                                                                   */
/* -------------------------------------------------------------------------- */

function TheFlow() {
  const stages = [
    {
      title: 'Data Pipeline',
      body: 'Stripe writes charges, balance transactions, disputes and payouts into your warehouse on a schedule.',
      tone: 'ink' as const,
    },
    {
      title: 'Warehouse',
      body: `Joined against ${PLATFORM}-side tables Stripe has never seen — the event catalogue, gate scans, the service fee ledger.`,
      tone: 'ink' as const,
    },
    {
      title: AGENT,
      body: 'Matches the question to a scenario, runs its SQL, and writes a narrative with the numbers in it.',
      tone: 'blue' as const,
    },
    {
      title: 'Human approval',
      body: 'Request preview, totals, approver name. Large refunds, account debits and money leaving to a third party need a second acknowledgement.',
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
      <h2 className="font-display text-[24px] font-bold text-gray-900">The flow</h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        Five steps, and the same five whichever view you are in. The interesting join is the one
        Stripe cannot do for you: a dispute on a ticket is just a dispute until you join it to
        the gate scan that proves the buyer walked in — that is the difference between a queue
        you work and a queue you win.
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

/* -------------------------------------------------------------------------- */
/* The two views                                                              */
/* -------------------------------------------------------------------------- */

interface ViewSpec {
  key: 'platform' | 'organizer';
  icon: typeof Building2;
  accent: 'blue' | 'purple';
  href: string;
  hrefLabel: string;
  scope: string;
  sees: string;
  cannotSee: string;
  why: string;
  scenarios: typeof INTERNAL_SCENARIOS;
  footnote?: string;
}

const VIEWS: ViewSpec[] = [
  {
    key: 'platform',
    icon: Building2,
    accent: 'blue',
    href: '/platform',
    hrefLabel: 'Open the platform view',
    scope: `All ${TOTAL_ACCOUNTS} organizers, every event, and the platform's own money program.`,
    sees: 'Everything. Cross-organizer aggregates, the fee ledger, who cannot be paid out, the advance portfolio, the float, the card program — and which financing offers have never been surfaced.',
    cannotSee: 'Nothing is withheld — this view is the platform looking at its own book.',
    why: `Partly an internal tool that makes a finance and operations team smaller than the volume would otherwise need, and partly the place ${PLATFORM} sees what its finance products are earning.`,
    scenarios: INTERNAL_SCENARIOS,
  },
  {
    key: 'organizer',
    icon: UserRound,
    accent: 'purple',
    href: '/platform/organizers',
    hrefLabel: 'Pick an organizer',
    scope: 'One connected account, scoped by account_id in every query and in every page.',
    sees: 'Their own ticket sales, balance, vendor payments, cards and advance — in plain language, with the SQL kept behind the panel.',
    cannotSee: `Another organizer's rows, ${PLATFORM}'s margin on their volume, or any cross-organizer comparison. Those are the platform's business, not theirs.`,
    why: `The one ${PLATFORM} can sell. Same pipeline, same approval flow, pointed at a single account and priced as a product.`,
    scenarios: ORGANIZER_SCENARIOS,
    footnote:
      'Treasury and Issuing are on a handful of organizers by design, and a Capital offer only exists where Stripe wrote one — so most organizers land on a "you do not have this, and here is why" page. The switcher marks the accounts that do have money products and lists them first.',
  },
];

function TheTwoViews() {
  return (
    <section>
      <h2 className="font-display text-[24px] font-bold text-gray-900">The two views</h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        The difference between them is one clause in a WHERE, and that is the whole argument.
        Building the agent once for internal operations means the organizer-facing version is not
        a second project — it is the same thing with the scope narrowed, which is what makes it
        something to sell rather than something to fund.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {VIEWS.map((view) => {
          const lens = LENS[view.key];
          const Icon = view.icon;

          return (
            <Card key={view.key} className="flex h-full flex-col">
              <CardHeader className="items-start">
                <div className="flex items-start gap-3">
                  <span
                    className={[
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white',
                      view.accent === 'blue' ? 'bg-blue-500' : 'bg-purple-500',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <CardTitle className="text-[16px]">{lens.label}</CardTitle>
                    <CardDescription>
                      {lens.persona} — {lens.personaRole}
                    </CardDescription>
                  </div>
                </div>
                <Badge tone={view.accent}>{view.scenarios.length} scenarios</Badge>
              </CardHeader>

              <CardBody className="flex flex-1 flex-col gap-4">
                <blockquote
                  className={[
                    'border-l-2 pl-3 text-[13.5px] italic leading-relaxed text-gray-700',
                    view.accent === 'blue' ? 'border-blue-300' : 'border-purple-300',
                  ].join(' ')}
                >
                  &ldquo;{lens.quote}&rdquo;
                </blockquote>

                <dl className="space-y-2.5 text-[12.5px] leading-relaxed">
                  <FactRow label="Scope" value={view.scope} />
                  <FactRow label="Sees" value={view.sees} />
                  <FactRow label="Cannot see" value={view.cannotSee} />
                  <FactRow label="Why it exists" value={view.why} />
                </dl>

                <div>
                  <h4 className="label-xs mb-2">What {lens.persona} asks</h4>
                  <ul className="space-y-1.5">
                    {view.scenarios.map((scenario) => (
                      <li key={scenario.id} className="text-[12.5px] leading-snug">
                        {view.key === 'platform' ? (
                          <AskAgentLink
                            question={scenario.suggestedPrompt}
                            className="text-left text-blue-600 hover:underline"
                          >
                            {scenario.suggestedPrompt}
                          </AskAgentLink>
                        ) : (
                          <span className="text-gray-700">{scenario.suggestedPrompt}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-auto pt-1">
                  <Link
                    href={view.href}
                    className={[
                      'inline-flex items-center gap-1.5 text-[13px] font-semibold hover:underline',
                      view.accent === 'blue' ? 'text-blue-600' : 'text-purple-600',
                    ].join(' ')}
                  >
                    {view.hrefLabel} →
                  </Link>
                  {view.footnote && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                      {view.footnote}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The money section                                                          */
/* -------------------------------------------------------------------------- */

const MONEY_SURFACES = [
  {
    product: 'Treasury',
    name: 'Event Account',
    organizer:
      'A stored balance. Ticket revenue sweeps in, vendors get paid straight out, and the page carries the routing and account number a sponsor would pay into. Cash and spendable are always shown side by side.',
    platform:
      'Stored balances — the float across every organizer, who is enrolled, and who has float and no account.',
    honest:
      'The activity table reconciles: credits in, less payments out, less approved card spend, equals the balance above it. An advance is deliberately absent, because Capital pays out to the Stripe balance rather than into this account.',
  },
  {
    product: 'Issuing',
    name: 'Production Cards',
    organizer:
      'A card per person with a monthly ceiling and a merchant-category allow-list, and the list of off-policy purchases the network refused at authorisation.',
    platform:
      'Card program — cards issued, combined ceiling, approved spend, and what the controls caught.',
    honest:
      'No interchange revenue is estimated anywhere. Revenue share is a commercial term rather than a published rate, so the spend base is the figure on screen instead.',
  },
  {
    product: 'Capital',
    name: 'Event Advance',
    organizer:
      'The live offer with its flat fee, and the withhold rate translated into a payback period against the organizer’s own sales rate — because "17% of every payment" is not a number anyone can decide on.',
    platform:
      'Advances — the portfolio, what is outstanding, and the offers nobody has ever surfaced.',
    honest:
      'The page stops before accepting. The organizer takes on the liability so the organizer agrees to the terms, in a Stripe-hosted surface the platform can embed but cannot complete.',
  },
];

function TheMoneySection() {
  return (
    <section>
      <h2 className="font-display text-[24px] font-bold text-gray-900">
        Where the money products live
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        Capital, Treasury and Issuing are pages, not just answers. Each one appears twice — once
        as something an organizer uses, once as something {PLATFORM} runs — and the sidebar groups
        them so a finance product area reads as a product area rather than as three more reports.
        {AGENT} is a drawer over all of it, so a question never costs you your place on the page.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {MONEY_SURFACES.map((surface) => (
          <Card key={surface.product} className="flex h-full flex-col">
            <CardHeader>
              <div>
                <CardTitle className="text-[15px]">{surface.name}</CardTitle>
                <CardDescription>Stripe {surface.product}</CardDescription>
              </div>
            </CardHeader>
            <CardBody className="flex flex-1 flex-col gap-3 text-[12.5px] leading-relaxed">
              <div>
                <p className="label-xs mb-1">Organizer view</p>
                <p className="text-gray-700">{surface.organizer}</p>
              </div>
              <div>
                <p className="label-xs mb-1">Platform view</p>
                <p className="text-gray-700">{surface.platform}</p>
              </div>
              <div className="mt-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="label-xs mb-1">Where it stops</p>
                <p className="text-gray-600">{surface.honest}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[5.5rem] shrink-0 font-semibold text-gray-500">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

function Surfaces() {
  return (
    <section>
      <h2 className="font-display text-[24px] font-bold text-gray-900">
        Two surfaces, tagged everywhere
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        Every action in this demo is labelled with how it would execute, because the difference
        matters when you build it. MCP tools are a curated surface the agent can be pointed at
        safely. Everything else is code you write, own and secure yourself — including all of
        Capital, Treasury and Issuing, none of which the hosted tool surface covers today.
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
              'A second checkbox for refunds over $10,000, every account debit, and any payment leaving to a third party',
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
      <h2 className="font-display flex items-center gap-2 text-[24px] font-bold text-gray-900">
        <LockKeyhole className="h-5 w-5 text-gray-500" />
        Things there is no button for
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        {capabilities.length} real Stripe capabilities have no API or MCP surface to turn them on
        — they are Dashboard settings, account-level enablements Stripe underwrites, or decisions
        that belong to the organizer rather than to the platform. When a scenario recommends one,
        the agent renders a chip explaining why and who owns it, rather than a button that quietly
        does nothing. An agent that silently no-ops here is worse than one that admits the limit.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <h2 className="font-display flex items-center gap-2 text-[24px] font-bold text-gray-900">
        <Database className="h-5 w-5 text-purple-500" />
        The data
      </h2>
      <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-gray-600">
        {TOTAL_CHARGES.toLocaleString('en-US')} charge rows across {TOTAL_ACCOUNTS} organizers,
        generated from a fixed seed so every run of this demo is byte-identical.
        &ldquo;Now&rdquo; is pinned to{' '}
        <code className="font-mono text-[12.5px]">{NOW_ISO}</code> — nothing drifts as the real
        clock moves.
      </p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Scale factor: 1:{SCALE_FACTOR}</CardTitle>
              <CardDescription>
                The story is a platform doing ~
                {(TOTAL_CHARGES * SCALE_FACTOR).toLocaleString('en-US')} attempts a quarter
                across thousands of organizers. What is sampled is the organizers:{' '}
                {TOTAL_ACCOUNTS} accounts stand in for about{' '}
                {(TOTAL_ACCOUNTS * SCALE_FACTOR).toLocaleString('en-US')}, and each one shown
                has its complete history.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <p className="text-[13px] leading-relaxed text-gray-700">
              Rates — success, block, mix, dispute rate — are read straight off the sample and
              are directly comparable to a real platform&apos;s. So are an organizer&apos;s own
              amounts: their volume, balance, financing offer and supplier bills are real as
              they stand, which is what makes them worth checking. Only totals across every
              organizer are multiplied up, and the UI says so where it does it.
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
                {SCHEMA_CAVEATS.length} deliberate simplifications, stated rather than hidden.
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
