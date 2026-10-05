'use client';

import Link from 'next/link';
import * as React from 'react';

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
} from '@/components/ui/primitives';
import { PlatformScaleNote, ProductTile } from '@/components/money/money-ui';
import { Recommendations } from '@/components/money/recommendations';
import { PLATFORM } from '@/lib/brand';
import { organizerBase } from '@/lib/nav';
import { CATEGORY_PROFILES } from '@/lib/sim/catalog';
import { NOW } from '@/lib/sim/constants';
import { dateTime, humanize, isoToShortDate, longDate, money, percent, untilLabel } from '@/lib/sim/format';
import { embeddedFinanceStatus, organizerSummary } from '@/lib/sim/metrics';
import { organizerDashboardRecommendations } from '@/lib/recommendations/organizer';
import { fundingOutlook, organizerMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

/**
 * One organizer, split by section rather than tabbed.
 *
 * The sections are sidebar destinations now, so each is its own URL — which
 * means a link can point at an organizer's payment mix rather than at their
 * account and a note saying "click the third tab". The identity header lives in
 * the shell's context bar, so it is not repeated here.
 */
export type OrganizerSection = 'dashboard' | 'payments' | 'account';

export function OrganizerDetail({
  accountId,
  section,
}: {
  accountId: string;
  section: OrganizerSection;
}) {
  return (
    <SimGate
      fallback={
        <div className="mx-auto max-w-[84rem] px-4 py-10 sm:px-6">
          <p className="text-[13px] text-gray-500">Loading organizer…</p>
        </div>
      }
    >
      <OrganizerDetailBody accountId={accountId} section={section} />
    </SimGate>
  );
}

const SECTION_HEADINGS: Record<OrganizerSection, { title: string; blurb: string }> = {
  dashboard: {
    title: 'Dashboard',
    blurb: 'Ticket sales, commercials and money products for this organizer.',
  },
  payments: {
    title: 'Payments',
    blurb: 'How buyers pay, what gets disputed, and which readers are online.',
  },
  account: {
    title: 'Account settings',
    blurb: 'Verification requirements and payout configuration.',
  },
};

function OrganizerDetailBody({
  accountId,
  section,
}: {
  accountId: string;
  section: OrganizerSection;
}) {
  const { data, index } = useSim();

  const account = index.accountById.get(accountId);

  const summary = React.useMemo(
    () => (account ? organizerSummary(data, index, accountId) : null),
    [account, accountId, data, index],
  );

  const finance = React.useMemo(
    () => embeddedFinanceStatus(data, accountId),
    [accountId, data],
  );

  const money$ = React.useMemo(
    () => organizerMoney(data, index, accountId),
    [accountId, data, index],
  );
  const outlook = React.useMemo(
    () => fundingOutlook(data, index, accountId),
    [accountId, data, index],
  );
  // Pay-over-time is read off the account's own payment method configuration
  // rather than from whether anyone used it — the question is whether buyers
  // were ever offered it.
  const payOverTimeEnabled = React.useMemo(() => {
    const config = index.pmcByAccount.get(accountId);
    if (!config) return false;
    return ['affirm', 'klarna', 'afterpay_clearpay'].some(
      (method) => config.payment_methods[method]?.display_preference.preference === 'on',
    );
  }, [accountId, index.pmcByAccount]);

  if (!account || !summary) {
    return (
      <div className="mx-auto max-w-[84rem] px-4 py-10 sm:px-6">
        <EmptyState
          title="No such organizer"
          description="That account id is not in the seeded dataset. It may have been from an older demo session — reset the demo data or pick an organizer from the list."
        />
        <div className="mt-4">
          <Link href="/platform/organizers" className="text-[13px] font-medium text-blue-600 hover:underline">
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

  const heading = SECTION_HEADINGS[section];

  return (
    <>
      <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[24px] font-black text-gray-900">
              {heading.title}
            </h1>
            <p className="mt-1 text-[13.5px] text-gray-500">{heading.blurb}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{profile.label}</Badge>
            {!account.payouts_enabled && <Badge tone="danger">Payouts disabled</Badge>}
            {!account.charges_enabled && <Badge tone="danger">Charges disabled</Badge>}
            {summary.available < 0 && <Badge tone="warn">Negative balance</Badge>}
            <Badge tone="ink">{humanize(account.metadata.settlement_mode)} billing</Badge>
            {account.metadata.next_event_date && (
              <Badge tone="neutral">
                Next event {isoToShortDate(account.metadata.next_event_date)}
              </Badge>
            )}
          </div>
        </header>

        {section === 'dashboard' && (
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        )}

        {section === 'dashboard' && money$ && (
          <Recommendations
            items={organizerDashboardRecommendations(
              money$,
              outlook,
              summary,
              payOverTimeEnabled,
            )}
            scope={{ id: 'page_organizer_dashboard', title: 'Organizer dashboard' }}
            className="mb-8"
          />
        )}

        <div className="py-6">
          {section === 'dashboard' && (
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

              {/* Pointers, not a second copy of the money pages. The figures used
                  to be inlined here, which meant two places to keep in step and a
                  platform-scale amount sitting next to the sampled tiles above. */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div>
                    <CardTitle>{PLATFORM} Money</CardTitle>
                    <CardDescription>
                      What Capital, Treasury and Issuing are doing on this account.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ProductTile
                      title="Event Account"
                      state={finance.treasuryCash != null ? 'active' : 'available'}
                      detail={
                        finance.treasuryCash != null
                          ? `${money(finance.treasuryCash)} held`
                          : 'No stored balance open'
                      }
                      href={
                        finance.treasuryCash != null
                          ? `${organizerBase(accountId)}/money/account`
                          : undefined
                      }
                    />
                    <ProductTile
                      title="Production Cards"
                      state={finance.cards > 0 ? 'active' : 'available'}
                      detail={
                        finance.cards > 0
                          ? `${finance.cards} active · ${money(finance.cardLimit)} ceiling`
                          : 'No cards issued'
                      }
                      href={
                        finance.cards > 0
                          ? `${organizerBase(accountId)}/money/cards`
                          : undefined
                      }
                    />
                    <ProductTile
                      title="Event Advance"
                      state={
                        finance.capital.state === 'drawn' || finance.capital.state === 'offered'
                          ? 'active'
                          : 'available'
                      }
                      detail={
                        finance.capital.state === 'drawn'
                          ? `${money(finance.capital.remaining)} outstanding`
                          : finance.capital.state === 'offered'
                            ? `${money(finance.capital.amount)} available`
                            : 'No offer written'
                      }
                      href={`${organizerBase(accountId)}/money/advance`}
                    />
                  </div>
                  <PlatformScaleNote className="mt-4" />
                </CardBody>
              </Card>

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

          {section === 'account' && (
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

          {section === 'payments' && (
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

          {section === 'payments' && (
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

          {section === 'payments' && (
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
