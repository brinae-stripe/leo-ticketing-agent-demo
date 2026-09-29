'use client';

import { ArrowLeft, Bot } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AskChat } from '@/components/ask/chat';
import { StadiumLights } from '@/components/brand/wordmark';
import { SimGate } from '@/components/layout/sim-gate';
import { DataTable } from '@/components/ui/data-table';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Tabs,
} from '@/components/ui/primitives';
import { ORGANIZER_SCENARIOS } from '@/lib/scenarios';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { NOW } from '@/lib/sim/constants';
import { dateTime, humanize, isoToShortDate, longDate, money, percent, untilLabel } from '@/lib/sim/format';
import { embeddedFinanceStatus, organizerSummary } from '@/lib/sim/metrics';
import { useSim } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

export function OrganizerDetail({ accountId }: { accountId: string }) {
  return (
    <SimGate
      fallback={
        <div className="mx-auto max-w-[84rem] px-4 py-10 sm:px-6">
          <p className="text-[13px] text-gray-500">Loading organizer…</p>
        </div>
      }
    >
      <OrganizerDetailBody accountId={accountId} />
    </SimGate>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements & payouts' },
  { id: 'payments', label: 'Payments mix' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'readers', label: 'Readers' },
  { id: 'copilot', label: 'Organizer copilot' },
];

function OrganizerDetailBody({ accountId }: { accountId: string }) {
  const { data, index } = useSim();
  const [tab, setTab] = React.useState('overview');

  const account = index.accountById.get(accountId);

  const summary = React.useMemo(
    () => (account ? organizerSummary(data, index, accountId) : null),
    [account, accountId, data, index],
  );

  const finance = React.useMemo(
    () => embeddedFinanceStatus(data, accountId),
    [accountId, data],
  );

  if (!account || !summary) {
    return (
      <div className="mx-auto max-w-[84rem] px-4 py-10 sm:px-6">
        <EmptyState
          title="No such organizer"
          description="That account id is not in the seeded dataset. It may have been from an older demo session — reset the demo data or pick an organizer from the list."
        />
        <div className="mt-4">
          <Link href="/organizers" className="text-[13px] font-medium text-blue-600 hover:underline">
            Back to all organizers
          </Link>
        </div>
      </div>
    );
  }

  const profile = CATEGORY_PROFILES[account.metadata.organizer_category];
  const events = (index.eventsByAccount.get(accountId) ?? [])
    .slice()
    .sort((a, b) => b.starts_at - a.starts_at);
  const readers = index.readersByAccount.get(accountId) ?? [];
  const disputes = data.disputes.filter(
    (dispute) => index.chargeById.get(dispute.charge_id)?.account_id === accountId,
  );
  const payouts = data.connected_account_payouts
    .filter((payout) => payout.account_id === accountId)
    .sort((a, b) => b.created - a.created);
  const ledger = data.service_fee_ledger.filter((row) => row.account_id === accountId);
  const config = index.pmcByAccount.get(accountId);

  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <StadiumLights />
        <div className="relative mx-auto max-w-[84rem] px-4 py-8 sm:px-6">
          <Link
            href="/organizers"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All organizers
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-[28px] font-black leading-tight sm:text-[34px]">
                {account.business_profile_name}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-white/60">
                <span>{profile.label}</span>
                <span aria-hidden>·</span>
                <span className="font-mono">{account.id}</span>
                <span aria-hidden>·</span>
                <span className="capitalize">{account.type} account</span>
                {account.metadata.next_event_date && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Next event {isoToShortDate(account.metadata.next_event_date)}</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!account.payouts_enabled && <Badge tone="danger">Payouts disabled</Badge>}
              {!account.charges_enabled && <Badge tone="danger">Charges disabled</Badge>}
              {summary.available < 0 && <Badge tone="warn">Negative balance</Badge>}
              <Badge tone="ink">{humanize(account.metadata.settlement_mode)} billing</Badge>
              {/* Deliberately no amounts here. These rows are at platform scale
                  and the stat tiles below are at sample scale, so putting the
                  two next to each other would read as a contradiction. The
                  figures live in the embedded-finance card, labelled. */}
              {finance.capital.state === 'offered' && (
                <Badge tone={finance.capital.surfaced ? 'blue' : 'warn'}>
                  Financing offer{finance.capital.surfaced ? '' : ' · not surfaced'}
                </Badge>
              )}
              {finance.capital.state === 'drawn' && <Badge tone="blue">Advance outstanding</Badge>}
              {finance.treasuryCash != null && <Badge tone="purple">Stored balance</Badge>}
              {finance.cards > 0 && (
                <Badge tone="purple">
                  {finance.cards} {finance.cards === 1 ? 'card' : 'cards'}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Net volume" value={money(summary.netVolume)} />
          <Stat
            label="Success rate"
            value={summary.attempts > 0 ? percent(summary.successRate, 1) : '—'}
            hint={`${summary.succeeded.toLocaleString('en-US')} of ${summary.attempts.toLocaleString('en-US')} attempts`}
          />
          <Stat
            label="Available balance"
            value={money(summary.available)}
            hint={`${money(summary.pending)} pending`}
            tone={summary.available < 0 ? 'danger' : 'neutral'}
          />
          <Stat
            label="Open disputes"
            value={String(summary.openDisputes)}
            hint={`${summary.disputes} total this quarter`}
            tone={summary.openDisputes > 0 ? 'warn' : 'neutral'}
          />
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} className="mt-6" />

        <div className="py-6">
          {tab === 'overview' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Events</CardTitle>
                    <CardDescription>
                      {events.length} in the data window, newest first.
                    </CardDescription>
                  </div>
                </CardHeader>
                <DataTable
                  columns={[
                    { key: 'name', label: 'Event' },
                    { key: 'venue', label: 'Venue' },
                    { key: 'starts_at', label: 'Starts', kind: 'date' },
                    { key: 'status', label: 'Status' },
                  ]}
                  rows={events as unknown as Record<string, unknown>[]}
                />
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Commercials</CardTitle>
                    <CardDescription>
                      How Marquee is paid by this organizer.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-3 text-[13px]">
                    <Row
                      label="Billing model"
                      value={
                        account.metadata.settlement_mode === 'on_charge'
                          ? 'Application fee taken at charge time'
                          : 'Invoiced or debited after the event'
                      }
                    />
                    <Row
                      label="Service fee"
                      value={`${percent(Number(account.metadata.service_fee_percent), 1)} + ${money(Number(account.metadata.service_fee_fixed))} per ticket`}
                    />
                    <Row
                      label="Outstanding service fees"
                      value={money(summary.outstandingServiceFees)}
                      tone={summary.outstandingServiceFees > 0 ? 'warn' : 'neutral'}
                    />
                    <Row label="Payout schedule" value={humanize(account.payout_schedule_interval)} />
                    <Row label="Average order" value={money(summary.averageOrderValue)} />
                    <Row label="Repeat buyer share" value={percent(summary.repeatBuyerShare, 1)} />
                    <Row label="Refunded" value={money(summary.refunds)} />
                  </dl>
                </CardBody>
              </Card>

              {finance.any && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div>
                      <CardTitle>Embedded finance</CardTitle>
                      <CardDescription>
                        Capital, Treasury and Issuing on this account. These figures are at
                        platform scale, unlike the sampled payment figures above — one row per
                        organizer is not something you sample, so these are sized against the
                        organizer&apos;s real volume rather than the 1:100 charge rows.
                      </CardDescription>
                    </div>
                    <Badge tone="neutral">Platform scale</Badge>
                  </CardHeader>
                  <CardBody>
                    <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
                      {finance.capital.state === 'offered' && (
                        <>
                          <Row
                            label="Financing offered"
                            value={money(finance.capital.amount)}
                          />
                          <Row
                            label="Offer surfaced"
                            value={
                              finance.capital.surfaced
                                ? 'Yes'
                                : 'No — the organizer has never seen it'
                            }
                            tone={finance.capital.surfaced ? 'neutral' : 'warn'}
                          />
                          <Row
                            label="Offer lapses"
                            value={`${longDate(finance.capital.expiresAfter)} (${untilLabel(finance.capital.expiresAfter, NOW)})`}
                          />
                        </>
                      )}
                      {finance.capital.state === 'drawn' && (
                        <>
                          <Row label="Advance drawn" value={money(finance.capital.advanced)} />
                          <Row
                            label="Still outstanding"
                            value={money(finance.capital.remaining)}
                            tone="warn"
                          />
                        </>
                      )}
                      {finance.capital.state === 'lapsed' && (
                        <Row
                          label="Financing"
                          value={`A ${money(finance.capital.amount)} offer lapsed unused`}
                          tone="warn"
                        />
                      )}
                      {finance.capital.state === 'none' && (
                        <Row label="Financing" value="No offer written" />
                      )}
                      {finance.treasuryCash != null ? (
                        <>
                          <Row label="Stored balance" value={money(finance.treasuryCash)} />
                          <Row
                            label="Committed to payments in flight"
                            value={money(finance.treasuryCommitted)}
                          />
                          <Row
                            label="Spendable"
                            value={money(finance.treasuryCash - finance.treasuryCommitted)}
                          />
                        </>
                      ) : (
                        <Row label="Stored balance" value="None open" />
                      )}
                      <Row
                        label="Issued cards"
                        value={
                          finance.cards > 0
                            ? `${finance.cards} active · ${money(finance.cardLimit)} combined monthly ceiling`
                            : 'None'
                        }
                      />
                    </dl>
                  </CardBody>
                </Card>
              )}

              {ledger.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div>
                      <CardTitle>Service fee ledger</CardTitle>
                      <CardDescription>
                        Fees accrued per event, and whether they have been collected.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <DataTable
                    columns={[
                      { key: 'event_id', label: 'Event' },
                      { key: 'tickets_sold', label: 'Tickets', align: 'right', kind: 'number' },
                      { key: 'gross_volume', label: 'Gross', align: 'right', kind: 'money' },
                      { key: 'fee_owed', label: 'Fee owed', align: 'right', kind: 'money' },
                      { key: 'period_end', label: 'Event date', kind: 'date' },
                      { key: 'settled', label: 'Settled' },
                    ]}
                    rows={ledger as unknown as Record<string, unknown>[]}
                  />
                </Card>
              )}
            </div>
          )}

          {tab === 'requirements' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Onboarding requirements</CardTitle>
                    <CardDescription>
                      What Stripe is still waiting on from this account.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardBody className="space-y-3 text-[13px]">
                  <Row
                    label="Payouts enabled"
                    value={account.payouts_enabled ? 'Yes' : 'No'}
                    tone={account.payouts_enabled ? 'good' : 'danger'}
                  />
                  <Row
                    label="Charges enabled"
                    value={account.charges_enabled ? 'Yes' : 'No'}
                    tone={account.charges_enabled ? 'good' : 'danger'}
                  />
                  <Row
                    label="Disabled reason"
                    value={account.requirements_disabled_reason ?? 'None'}
                  />
                  <Row
                    label="Deadline"
                    value={
                      account.requirements_current_deadline
                        ? `${longDate(account.requirements_current_deadline)} (${untilLabel(account.requirements_current_deadline, NOW)})`
                        : 'None set'
                    }
                    tone={
                      account.requirements_current_deadline &&
                      account.requirements_current_deadline < NOW
                        ? 'danger'
                        : 'neutral'
                    }
                  />
                  <div>
                    <p className="label-xs mb-1.5">Currently due</p>
                    {account.requirements_currently_due.length === 0 ? (
                      <p className="text-gray-500">Nothing outstanding.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {account.requirements_currently_due.map((field) => (
                          <li key={field}>
                            <code className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                              {field}
                            </code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {account.requirements_past_due.length > 0 && (
                    <div>
                      <p className="label-xs mb-1.5 text-danger">Past due</p>
                      <ul className="flex flex-wrap gap-1">
                        {account.requirements_past_due.map((field) => (
                          <li key={field}>
                            <code className="rounded border border-[#f2b9cd] bg-[#fdeef3] px-1.5 py-0.5 font-mono text-[11px] text-danger">
                              {field}
                            </code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Payouts</CardTitle>
                    <CardDescription>{payouts.length} in the data window.</CardDescription>
                  </div>
                </CardHeader>
                <DataTable
                  columns={[
                    { key: 'id', label: 'Payout' },
                    { key: 'amount', label: 'Amount', align: 'right', kind: 'money' },
                    { key: 'status', label: 'Status' },
                    { key: 'method', label: 'Method' },
                    { key: 'arrival_date', label: 'Arrives', kind: 'date' },
                    { key: 'failure_code', label: 'Failure' },
                  ]}
                  rows={payouts.slice(0, 80) as unknown as Record<string, unknown>[]}
                />
              </Card>
            </div>
          )}

          {tab === 'payments' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Method mix</CardTitle>
                    <CardDescription>Share of successful transactions.</CardDescription>
                  </div>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-3 text-[13px]">
                    <Row label="Apple Pay / Google Pay" value={percent(summary.walletShare, 1)} />
                    <Row label="Link" value={percent(summary.linkShare, 1)} />
                    <Row label="Card present" value={percent(summary.cardPresentShare, 1)} />
                    <Row label="Pay over time" value={percent(summary.bnplShare, 2)} />
                    <Row label="Non-US cards" value={percent(summary.nonUsShare, 1)} />
                  </dl>
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Conversion by cohort</CardTitle>
                    <CardDescription>
                      Where this organizer loses authorisations.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-3 text-[13px]">
                    <Row label="US cards" value={percent(summary.usConversion, 1)} />
                    <Row
                      label="Non-US cards"
                      value={percent(summary.nonUsConversion, 1)}
                      tone={
                        summary.usConversion - summary.nonUsConversion > 0.03 ? 'warn' : 'neutral'
                      }
                    />
                    <Row label="Credit" value={percent(summary.creditConversion, 1)} />
                    <Row
                      label="Debit"
                      value={percent(summary.debitConversion, 1)}
                      tone={
                        summary.creditConversion - summary.debitConversion > 0.02
                          ? 'warn'
                          : 'neutral'
                      }
                    />
                  </dl>
                </CardBody>
              </Card>

              {config && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div>
                      <CardTitle>Checkout configuration</CardTitle>
                      <CardDescription>
                        Child payment method configuration{' '}
                        <code className="font-mono text-[11.5px]">{config.id}</code>, inheriting
                        from the platform default.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <ul className="flex flex-wrap gap-1.5">
                      {Object.entries(config.payment_methods).map(([method, value]) => (
                        <li key={method}>
                          <Badge
                            tone={
                              value.display_preference.preference === 'on' ? 'good' : 'neutral'
                            }
                          >
                            {humanize(method)}: {value.display_preference.preference}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {tab === 'disputes' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Disputes</CardTitle>
                  <CardDescription>
                    {disputes.length} this quarter, {summary.openDisputes} still open.
                  </CardDescription>
                </div>
              </CardHeader>
              {disputes.length === 0 ? (
                <CardBody>
                  <EmptyState
                    title="No disputes"
                    description="Nothing has been charged back against this organizer in the data window."
                  />
                </CardBody>
              ) : (
                <DataTable
                  columns={[
                    { key: 'id', label: 'Dispute' },
                    { key: 'amount', label: 'Amount', align: 'right', kind: 'money' },
                    { key: 'reason', label: 'Reason' },
                    { key: 'status', label: 'Status' },
                    { key: 'evidence_due_by', label: 'Evidence due', kind: 'date' },
                    { key: 'charge_id', label: 'Charge' },
                  ]}
                  rows={disputes as unknown as Record<string, unknown>[]}
                />
              )}
            </Card>
          )}

          {tab === 'readers' && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Card readers</CardTitle>
                  <CardDescription>
                    {summary.readers.online} online, {summary.readers.offline} offline.
                  </CardDescription>
                </div>
              </CardHeader>
              {readers.length === 0 ? (
                <CardBody>
                  <EmptyState
                    title="No readers registered"
                    description="This organizer sells online only — there is no Terminal hardware on the account."
                  />
                </CardBody>
              ) : (
                <div className="divide-y divide-gray-100">
                  {readers.map((reader) => (
                    <div
                      key={reader.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-gray-900">
                          {reader.label}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400">
                          {reader.id} · {reader.device_type} · {reader.location_id}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="nums text-[12px] text-gray-500">
                          Last seen {dateTime(reader.last_seen_at)}
                        </span>
                        <Badge tone={reader.status === 'online' ? 'good' : 'danger'}>
                          {reader.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {tab === 'copilot' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div>
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
                  <p className="text-[12.5px] leading-relaxed text-gray-700">
                    This is what {account.business_profile_name} sees when they open the
                    copilot in their own dashboard. Everything is scoped to this connected
                    account — the organizer cannot query other organizers, and the actions run in
                    their account context.
                  </p>
                </div>
                <AskChat scope="organizer" accountId={accountId} />
              </div>
              <aside className="space-y-2 lg:sticky lg:top-6 lg:self-start">
                <p className="label-xs">Organizer scenarios</p>
                {ORGANIZER_SCENARIOS.map((scenario) => (
                  <Card key={scenario.id}>
                    <CardBody className="px-3.5 py-2.5">
                      <p className="text-[12.5px] font-semibold leading-snug text-gray-900">
                        {scenario.suggestedPrompt}
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                        {scenario.blurb}
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
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
            'nums font-display mt-1.5 text-[24px] font-black leading-none',
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
        {hint && <p className="mt-1 text-[11.5px] text-gray-500">{hint}</p>}
      </CardBody>
    </Card>
  );
}

function Row({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-gray-500">{label}</dt>
      <dd
        className={cn(
          'nums font-semibold',
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
      </dd>
    </div>
  );
}
