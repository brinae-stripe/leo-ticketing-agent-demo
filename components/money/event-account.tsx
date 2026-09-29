'use client';

import { Landmark } from 'lucide-react';
import * as React from 'react';

import { AskAgentButton } from '@/components/layout/app-shell';
import { SimGate } from '@/components/layout/sim-gate';
import {
  ActivityTable,
  BalanceHero,
  DefinitionRow,
  MoneyStat,
  PlatformScaleNote,
  SectionHeading,
} from '@/components/money/money-ui';
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui/primitives';
import { humanize, longDate, money, shortDate } from '@/lib/sim/format';
import { organizerActivity, organizerMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';

/**
 * Event Account — the Treasury financial account.
 *
 * The page is built around one distinction: cash versus spendable. Cash is what
 * has arrived; spendable is cash less what is already committed to a payment in
 * flight. Committing against the first number is how a deposit gets promised
 * twice, and the failure lands as a returned payment to a supplier rather than an
 * error on screen — so both are on the page, next to each other, always.
 */
export function EventAccountPage({ accountId }: { accountId: string }) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <SimGate
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <Body accountId={accountId} />
      </SimGate>
    </div>
  );
}

function Body({ accountId }: { accountId: string }) {
  const { data, index } = useSim();
  const m = React.useMemo(() => organizerMoney(data, index, accountId), [accountId, data, index]);
  // Without the advance, so the rows reconcile against the balance above them.
  const ledger = React.useMemo(
    () => organizerActivity(data, accountId),
    [accountId, data],
  );

  if (!m) return <EmptyState title="No such organizer" description="Pick one from the switcher." />;

  const fa = m.financialAccount;

  if (!fa) {
    return (
      <>
        <SectionHeading
          title="Event Account"
          blurb="A stored balance this organizer could hold their event revenue in."
        />
        <EmptyState
          title="No Event Account open"
          description={`${m.account.business_profile_name} does not have a stored balance. Ticket revenue reaches them as a payout to their own bank on a ${m.settlementCadence} schedule. Opening an account needs the Treasury capability active on the platform, which Stripe grants after review — it is not an API call.`}
        />
        <div className="mt-4">
          <AskAgentButton question="How much are we holding before events, and for how long?">
            Size the float across the platform
          </AskAgentButton>
        </div>
      </>
    );
  }

  const settledIn = m.credits
    .filter((c) => c.status === 'succeeded')
    .reduce((s, c) => s + c.amount, 0);
  const paidOut = m.payments
    .filter((p) => p.status === 'posted')
    .reduce((s, p) => s + p.amount, 0);
  const cardSpend = m.authorizations
    .filter((a) => a.approved && a.status === 'closed')
    .reduce((s, a) => s + a.amount, 0);
  const inFlight = m.payments.filter((p) => p.status === 'processing');

  return (
    <>
      <SectionHeading
        title="Event Account"
        blurb="Ticket revenue lands here, and vendors get paid from here — with no payout to your own bank in between."
        actions={
          <>
            <AskAgentButton question="Can I pay my staging vendor out of my balance?">
              Send money
            </AskAgentButton>
            <AskAgentButton question="Where's my money from Saturday?">
              Trace a settlement
            </AskAgentButton>
          </>
        }
      />

      <BalanceHero
        label="Available balance"
        amount={fa.balance_cash}
        inbound={fa.balance_inbound_pending}
        outbound={fa.balance_outbound_pending}
        tag="Simulated balance"
        asideLabel="Spendable now"
        asideValue={money(m.spendable)}
        asideHint={
          fa.balance_outbound_pending > 0
            ? `${money(fa.balance_outbound_pending)} is already committed`
            : 'Nothing committed to a payment in flight'
        }
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyStat
          label="Settled in"
          value={money(settledIn)}
          hint={`${m.credits.length} ticket-revenue sweeps`}
        />
        <MoneyStat label="Paid to vendors" value={money(paidOut)} hint={`${m.payments.length} payments`} />
        <MoneyStat label="Card spend" value={money(cardSpend)} hint={`${m.cards.length} active cards`} />
        <MoneyStat
          label="In flight"
          value={money(fa.balance_outbound_pending)}
          hint={
            inFlight.length > 0
              ? `Arriving ${shortDate(inFlight[0].expected_arrival_date)}`
              : 'Nothing moving'
          }
          tone={inFlight.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                Settled rows reconcile against the balance: {money(settledIn)} in, less{' '}
                {money(paidOut)} paid out, less {money(cardSpend)} of card spend, is the{' '}
                {money(fa.balance_cash)} above. Greyed rows have not landed yet and are not in
                that figure — {money(fa.balance_inbound_pending)} inbound and{' '}
                {money(fa.balance_outbound_pending)} in flight. Struck-through rows were declined
                and never moved money at all. An event advance is absent because Capital pays out
                to the Stripe balance rather than into this account.
              </CardDescription>
            </div>
            <Badge tone="neutral">{ledger.length}</Badge>
          </CardHeader>
          <ActivityTable entries={ledger} />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-gray-500" />
                  Account details
                </CardTitle>
                <CardDescription>
                  The routing and account number a sponsor would pay into.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <dl>
                <DefinitionRow label="Routing number" value={fa.routing_number} mono />
                <DefinitionRow
                  label="Account number"
                  value={`•••• ${fa.account_number_last4}`}
                  mono
                />
                <DefinitionRow label="Account type" value="Checking" />
                <DefinitionRow label="Opened" value={longDate(fa.created)} />
                <DefinitionRow
                  label="Financial account"
                  value={fa.id}
                  mono
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Enabled features</CardTitle>
                <CardDescription>
                  What this account can do. Each is requested and granted separately.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-wrap gap-1.5">
                {fa.active_features.map((feature) => (
                  <li key={feature}>
                    <code className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11.5px] text-gray-700">
                      {feature}
                    </code>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Settlement</CardTitle>
              </div>
            </CardHeader>
            <CardBody>
              <dl>
                <DefinitionRow label="Cadence" value={humanize(m.settlementCadence)} />
                <DefinitionRow
                  label="Next settlement"
                  value={m.nextSettlement ? longDate(m.nextSettlement) : 'Manual'}
                />
                <DefinitionRow
                  label="Billing model"
                  value={
                    m.account.metadata.settlement_mode === 'on_charge'
                      ? 'Fee at charge time'
                      : 'Invoiced after the event'
                  }
                />
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}
