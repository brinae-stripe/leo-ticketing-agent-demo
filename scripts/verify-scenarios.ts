/**
 * Runs every scenario against the seeded dataset and prints what it produced.
 *
 * Not part of the build. This is the harness used to check that the SQL actually
 * parses in alasql, that the narratives read correctly against real numbers, and
 * that the action executors mutate state the way they claim to.
 *
 *   npx tsc -p tsconfig.verify.json && node .tmp-verify/scripts/verify-scenarios.js
 */

import { applyMutation, buildIndex, createDataset, type Mutation } from '../lib/sim/dataset';
import { runSql } from '../lib/sql/engine';
import { ALL_SCENARIOS, matchScenario } from '../lib/scenarios';
import type { ActionSpec, ScenarioContext } from '../lib/scenarios/types';
import type { AuditEntry, SimContext } from '../lib/stripe-sim/types';
import { money } from '../lib/sim/format';

const ONLY = process.argv[2];
const RUN_ACTIONS = process.argv.includes('--actions');

const data = createDataset();
let index = buildIndex(data);
const audit: AuditEntry[] = [];
const mutations: Mutation[] = [];
let rev = 1;

const simContext: SimContext = {
  data,
  index,
  actor: 'Verification harness',
  record: (mutation) => {
    applyMutation(data, mutation);
    mutations.push(mutation);
    if (mutation.kind === 'insert') {
      // Cheap approximation of the store's incremental indexing.
      if (mutation.table === 'refunds') {
        const chargeId = mutation.row.charge_id as string;
        const list = index.refundsByCharge.get(chargeId);
        if (list) list.push(mutation.row as never);
        else index.refundsByCharge.set(chargeId, [mutation.row as never]);
      }
    }
  },
  log: (entry) => {
    audit.push(entry);
    rev += 1;
  },
};

function scenarioContext(accountId?: string, query = ''): ScenarioContext {
  return {
    data,
    index,
    accountId,
    query,
    sql: (text: string) => runSql(data, rev, text),
  };
}

let failures = 0;

async function runAction(action: ActionSpec, label: string): Promise<void> {
  const before = audit.length;
  const started = Date.now();
  try {
    await action.run(simContext, {
      idempotencyKey: `verify-${action.id}`,
      onProgress: () => {},
    });
    index = buildIndex(data);
    console.log(
      `      executed ${label} → ${audit.length - before} audit entr${audit.length - before === 1 ? 'y' : 'ies'} in ${Date.now() - started}ms`,
    );
  } catch (error) {
    failures += 1;
    console.log(`      ACTION FAILED ${label}: ${(error as Error).message}`);
  }
}

/**
 * Which connected account to run an organizer scenario against.
 *
 * Most of them only need an organizer with volume, so one default does. The
 * embedded-finance ones need an organizer who is actually in the relevant pilot
 * — Treasury and Issuing are on a handful of accounts by design, and probing a
 * random organizer would exercise only the "you do not have this" branch and
 * report every query as empty. Both branches matter, so this picks the account
 * that reaches the interesting one.
 */
function probeAccount(scenarioId: string, fallback: string): string {
  switch (scenarioId) {
    case 'organizer_capital_advance': {
      const live = data.capital_financing_offers.find((o) =>
        ['undelivered', 'delivered'].includes(o.status),
      );
      return live?.account_id ?? fallback;
    }
    case 'organizer_treasury_pay_vendor': {
      const withPayments = data.treasury_financial_accounts.find((fa) =>
        data.treasury_outbound_payments.some((p) => p.account_id === fa.account_id),
      );
      return withPayments?.account_id ?? fallback;
    }
    case 'organizer_issuing_team_card': {
      // Prefer an organizer whose controls have actually refused something —
      // the decline list is the argument the scenario is built around.
      const declined = data.issuing_authorizations.find((a) => !a.approved);
      return declined?.account_id ?? data.issuing_cards[0]?.account_id ?? fallback;
    }
    default:
      return fallback;
  }
}

async function main(): Promise<void> {
  // Organizer scenarios need an account in scope. Use a hero organizer with volume.
  const defaultOrganizer = index.accountByName.get('Nebula Fan Expo')!;

  for (const scenario of ALL_SCENARIOS) {
    if (ONLY && !ONLY.startsWith('--') && scenario.id !== ONLY) continue;

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${scenario.scope.toUpperCase()}  ${scenario.id}`);
    console.log(`  prompt: ${scenario.suggestedPrompt}`);

    // The matcher should route its own suggested prompt back to itself.
    const match = matchScenario(scenario.suggestedPrompt, scenario.scope);
    if (match?.scenario.id !== scenario.id) {
      failures += 1;
      console.log(`  MATCHER FAILED → routed to ${match?.scenario.id ?? 'nothing'}`);
    } else {
      console.log(`  matcher: ${match.how} (${match.reason})`);
    }

    const accountId =
      scenario.scope === 'organizer'
        ? probeAccount(scenario.id, defaultOrganizer.id)
        : undefined;
    if (accountId) {
      console.log(
        `  account: ${index.accountById.get(accountId)?.business_profile_name} (${accountId})`,
      );
    }

    const ctx = scenarioContext(accountId, scenario.suggestedPrompt);

    try {
      const started = Date.now();
      const result = await scenario.run(ctx);
      const elapsed = Date.now() - started;

      console.log(`  ran in ${elapsed}ms`);
      console.log('  --- answer ---');
      for (const paragraph of result.answer) {
        console.log(`  ${paragraph.replace(/\s+/g, ' ')}`);
        console.log('');
      }
      console.log('  --- queries ---');
      for (const query of result.queries) {
        const flag = query.result.rows.length === 0 ? 'EMPTY' : 'ok   ';
        if (query.result.rows.length === 0) failures += 1;
        console.log(
          `  ${flag} ${query.label.padEnd(44)} ${String(query.result.rows.length).padStart(5)} rows  ${query.result.ms.toFixed(1)}ms${query.result.truncated ? '  (truncated)' : ''}`,
        );
      }
      console.log('  --- resolution ---');
      console.log(`  ${result.resolution.headline}`);
      console.log('  --- actions ---');
      if (result.actions.length === 0 && !result.items?.some((i) => i.actions.length)) {
        console.log('  (none — scenario is advisory only)');
      }
      for (const action of result.actions) {
        console.log(
          `  [${action.surface}] ${action.label}  →  ${action.method} ${action.path}${action.requiresSecondAck ? '  [2nd ack]' : ''}${action.batch ? `  [batch ${action.batch.size}×${Math.ceil(action.batch.total / action.batch.size)}]` : ''}`,
        );
      }
      if (result.items?.length) {
        console.log(`  --- items (${result.items.length}) ---`);
        for (const item of result.items.slice(0, 3)) {
          console.log(`  • ${item.title} — ${item.subtitle ?? ''}`);
          console.log(`    ${item.recommendation ?? ''}`);
          console.log(
            `    actions: ${item.actions.map((a) => a.label).join(', ') || '(none)'}`,
          );
        }
        if (result.items.length > 3) {
          console.log(`  … ${result.items.length - 3} more`);
        }
      }
      if (result.dashboardOnly?.length) {
        console.log('  --- dashboard-only ---');
        for (const chip of result.dashboardOnly) {
          console.log(`  ⚑ ${chip.capability}`);
        }
      }
      if (result.table) {
        console.log(
          `  --- table: ${result.table.caption} (${result.table.rows.length} rows, ${result.table.columns.length} cols) ---`,
        );
      }

      if (RUN_ACTIONS) {
        // Targeting a single scenario exercises every one of its actions;
        // a full sweep only runs the primary to keep the runtime sane.
        const toRun = ONLY && !ONLY.startsWith('--') ? result.actions : result.actions.slice(0, 1);
        for (const action of toRun) await runAction(action, action.label);
        const itemAction = result.items?.find((item) => item.actions.length)?.actions[0];
        if (itemAction) await runAction(itemAction, itemAction.label);
      }
    } catch (error) {
      failures += 1;
      console.log(`  SCENARIO THREW: ${(error as Error).message}`);
      console.log((error as Error).stack?.split('\n').slice(1, 4).join('\n'));
    }
  }

  // Fallback behaviour: an unrelated question must not be force-matched.
  console.log(`\n${'='.repeat(78)}`);
  const junk = [
    'what is the weather in tokyo',
    'reset my password',
    'how tall is the venue',
  ];
  for (const question of junk) {
    const match = matchScenario(question, 'internal');
    const ok = match === null;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? 'ok  ' : 'MISS'} unmatched question "${question}" → ${match?.scenario.id ?? 'capability list'}`,
    );
  }

  if (RUN_ACTIONS) {
    console.log(`\n${'='.repeat(78)}`);
    console.log(`audit entries: ${audit.length}`);
    console.log(`mutations:     ${mutations.length}`);
    console.log(`refunds:       ${data.refunds.length}`);
    console.log(`transfers:     ${data.transfers.length}`);
    console.log(`invoices:      ${data.invoices.length}`);
    console.log(`report runs:   ${data.report_runs.length}`);
    console.log(`radar items:   ${data.radar_value_list_items.length}`);
    console.log(`platform bal:  ${money(data.platform_balances[0].available)}`);
    const surfaces = new Map<string, number>();
    for (const entry of audit) {
      surfaces.set(entry.surface, (surfaces.get(entry.surface) ?? 0) + 1);
    }
    console.log(`by surface:    ${JSON.stringify(Object.fromEntries(surfaces))}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} PROBLEM(S)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
