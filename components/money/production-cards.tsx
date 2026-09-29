'use client';

import { CreditCard, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import { AskAgentButton } from '@/components/layout/app-shell';
import { SimGate } from '@/components/layout/sim-gate';
import {
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
import { count, humanize, money, percent, shortDate } from '@/lib/sim/format';
import { organizerMoney } from '@/lib/sim/money';
import { useSim } from '@/lib/store/sim-store';
import { cn } from '@/lib/utils';

/**
 * Production Cards — Issuing.
 *
 * Built around the declines. A page listing cards and their limits describes the
 * feature; a page showing eight named off-policy purchases the network refused
 * demonstrates it. The limit and the category allow-list are enforced at
 * authorisation, so the argument is not "you will have better reporting", it is
 * "the wrong purchase fails at the till".
 */
export function ProductionCardsPage({ accountId }: { accountId: string }) {
  return (
    <div className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <SimGate
        fallback={
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-64" />
            <div className="grid gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
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

  if (!m) return <EmptyState title="No such organizer" description="Pick one from the switcher." />;

  const holderById = new Map(m.cardholders.map((c) => [c.id, c]));
  const approved = m.authorizations.filter((a) => a.approved);
  const declined = m.authorizations.filter((a) => !a.approved);
  const approvedTotal = approved.reduce((s, a) => s + a.amount, 0);

  if (m.cards.length === 0) {
    return (
      <>
        <SectionHeading
          title="Production Cards"
          blurb="Cards for the people who spend on an event, scoped to what they are allowed to buy."
        />
        <EmptyState
          title="No cards issued"
          description={
            m.financialAccount
              ? `${m.account.business_profile_name} has an Event Account to fund cards from, but none have been issued. Creating one is two calls — a cardholder, then a card with its spending controls.`
              : `Cards draw on a stored balance, and ${m.account.business_profile_name} does not have one. The Event Account comes first, then the card_issuing capability, then cards.`
          }
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <AskAgentButton question="Give my production lead a card with a monthly limit">
            Issue the first card
          </AskAgentButton>
          <AskAgentButton question="Which organizers are paying vendors by bank transfer instead of card?">
            See the platform case
          </AskAgentButton>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionHeading
        title="Production Cards"
        blurb="Each card carries a monthly ceiling and a merchant-category allow-list, enforced by the network when the card is presented."
        actions={
          <AskAgentButton question="Give my production lead a card with a monthly limit">
            Issue a card
          </AskAgentButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyStat
          label="Active cards"
          value={count(m.cards.length)}
          hint={`${m.cardholders.length} cardholders`}
        />
        <MoneyStat
          label="Combined ceiling"
          value={money(m.cardLimitTotal)}
          hint="Per month, across all cards"
        />
        <MoneyStat
          label="Spent this month"
          value={money(m.cardSpendThisMonth)}
          hint={
            m.cardLimitTotal > 0
              ? `${percent(m.cardSpendThisMonth / m.cardLimitTotal, 0)} of the ceiling`
              : undefined
          }
        />
        <MoneyStat
          label="Refused by controls"
          value={money(m.declinedAmount)}
          hint={`${declined.length} of ${m.authorizations.length} attempts`}
          tone={declined.length > 0 ? 'good' : 'neutral'}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {m.cards.map((card) => {
          const holder = holderById.get(card.cardholder_id);
          const spend = approved
            .filter((a) => a.card_id === card.id)
            .reduce((s, a) => s + a.amount, 0);
          const limit = card.spending_limit_amount ?? 0;
          const used = limit > 0 ? Math.min(1, spend / limit) : 0;

          return (
            <Card key={card.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-gray-900">
                      {holder?.name ?? 'Unknown cardholder'}
                    </p>
                    <p className="text-[12px] text-gray-500">{holder?.role ?? '—'}</p>
                  </div>
                  <Badge tone={card.type === 'virtual' ? 'blue' : 'purple'}>
                    {card.type}
                  </Badge>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[13px] text-gray-700">
                  <CreditCard className="h-4 w-4 text-gray-400" aria-hidden />
                  <span className="font-mono">
                    {card.brand} •••• {card.last4}
                  </span>
                  <Badge tone={card.status === 'active' ? 'good' : 'neutral'}>
                    {card.status}
                  </Badge>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="text-gray-500">
                      {humanize(card.spending_limit_interval ?? 'monthly')} limit
                    </span>
                    <span className="nums font-semibold text-gray-900">
                      {money(spend)} of {money(limit)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        used > 0.85 ? 'bg-warning' : 'bg-blue-500',
                      )}
                      style={{ width: `${Math.max(2, used * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <p className="label-xs mb-1.5">
                    Allowed categories · {card.allowed_categories.length}
                  </p>
                  <ul className="flex flex-wrap gap-1">
                    {card.allowed_categories.map((category) => (
                      <li key={category}>
                        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
                          {category.replace(/_/g, ' ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {declined.length > 0 && (
        <Card className="mt-6 border-amber-200">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-warning" />
                Purchases the controls refused
              </CardTitle>
              <CardDescription>
                Declined at authorisation by the card&apos;s own category allow-list. Nobody
                reviewed these and no money moved — which is the difference between a card and
                an expenses policy in a document.
              </CardDescription>
            </div>
            <Badge tone="warn">{money(m.declinedAmount)}</Badge>
          </CardHeader>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5 text-left font-semibold">Merchant</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Cardholder</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Attempted</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {declined.map((auth) => {
                  const card = m.cards.find((c) => c.id === auth.card_id);
                  const holder = card ? holderById.get(card.cardholder_id) : undefined;
                  return (
                    <tr key={auth.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {auth.merchant_name}
                      </td>
                      <td className="px-4 py-2.5 capitalize text-gray-600">
                        {auth.merchant_category.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{holder?.name ?? '—'}</td>
                      <td className="nums px-4 py-2.5 text-right text-gray-400 line-through">
                        {money(auth.amount)}
                      </td>
                      <td className="nums px-4 py-2.5 text-right text-gray-500">
                        {shortDate(auth.created)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Approved card spend</CardTitle>
            <CardDescription>
              {count(approved.length)} authorisations totalling {money(approvedTotal)}, drawn
              from the Event Account balance.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Merchant</th>
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-left font-semibold">Card</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-4 py-2.5 text-right font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {approved.slice(0, 25).map((auth) => {
                const card = m.cards.find((c) => c.id === auth.card_id);
                return (
                  <tr key={auth.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {auth.merchant_name}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-gray-600">
                      {auth.merchant_category.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-gray-500">
                      •••• {card?.last4 ?? '????'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={auth.status === 'pending' ? 'warn' : 'neutral'}>
                        {auth.status}
                      </Badge>
                    </td>
                    <td className="nums px-4 py-2.5 text-right font-semibold text-gray-900">
                      {money(auth.amount)}
                    </td>
                    <td className="nums px-4 py-2.5 text-right text-gray-500">
                      {shortDate(auth.created)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PlatformScaleNote className="mt-6" />
    </>
  );
}
