# StageGate Ask

A fully simulated demo of an internal *ask an agent* experience for **StageGate**, a
fictional live-events ticketing platform running on Stripe Connect.

A staff member asks a question in plain English. The agent answers from simulated Stripe
Data Pipeline tables, shows the SQL it ran, proposes a resolution, and offers buttons that
execute simulated Stripe MCP and REST calls — each behind an explicit human approval. There
is also an organizer-facing copilot, scoped to a single connected account.

---

## This is a simulation

**No live Stripe connection. All data and actions are fictional.**

To be specific about what that means:

- There is no `stripe` package in this project. No API key is read from anywhere — not from
  env vars, not from a config file. There is no MCP client, no OAuth, and no network request
  of any kind at runtime.
- Every "API call" resolves in-process after a 400–900 ms delay, returns a realistically
  shaped object, appends an audit entry, and mutates local state so the rest of the app
  reflects the change.
- The agent is **not** a language model. It matches your question against a catalogue of 13
  scenarios — exact phrases first, then keyword scoring with a floor — and falls through to
  "here is what I can do" rather than guessing. The typing effect is cosmetic.
- The data is generated from a fixed seed, so every run of the demo is identical. "Now" is
  pinned to `2026-09-25T18:00:00.000Z` so nothing drifts as the real clock moves.

**The SQL is real.** Queries execute in your browser through [alasql](https://alasql.org)
against the same in-memory rows every page reads. The "Data used" panel under each answer
shows the query, its row count and its runtime — and lets you edit and re-run it.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script                | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `npm run dev`         | Dev server                                                       |
| `npm run build`       | Production build (runs `check:names` first via `prebuild`)        |
| `npm run lint`        | ESLint                                                           |
| `npm run typecheck`   | `tsc --noEmit`                                                   |
| `npm run check:names` | Fails the build if a reserved brand name appears anywhere        |
| `npm run verify:data` | Calibration harness — see [Verification](#verification)          |

No environment variables are required, for local development or for deployment.

---

## The pages

| Route            | What is there                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`              | KPI tiles, 13-week trend charts, top hosts by volume, and the entry point to the agent                          |
| `/ask`           | The internal operations agent                                                                                   |
| `/hosts`         | All 70 connected accounts, filterable by category and state                                                     |
| `/hosts/[id]`    | One host: requirements, payouts, method mix, conversion by cohort, disputes, readers — plus the organizer copilot |
| `/audit`         | Every simulated call this session made, with request and response                                               |
| `/how-it-works`  | Architecture, the MCP-versus-API split, the Dashboard-only list, and the schema caveats                          |

---

## How a scenario works

A scenario is one file that owns its trigger phrases, its SQL, its narrative and its
actions. The full type is in [`lib/scenarios/types.ts`](lib/scenarios/types.ts).

```ts
export const myScenario: Scenario = {
  id: 'my_scenario',
  scope: 'internal',                       // or 'organizer'
  title: 'Short label for the UI',
  suggestedPrompt: 'The question, as a user would type it',
  blurb: 'One line for the catalogue.',
  triggers: ['the question as a user would type it', 'shorter phrasing'],
  keywords: ['distinctive', 'tokens'],

  async run(ctx) {
    const querySql = sql`
-- A comment explaining why this query, not what it does.
SELECT ... FROM charges WHERE created >= ${T.daysAgo(7)}`;

    const result = await ctx.sql(querySql);          // really runs

    return {
      answer: ['Paragraphs, with numbers taken from `result`.'],
      queries: [{ label: 'What this shows', sql: querySql, result }],
      resolution: { headline: '…', body: '…', bullets: ['…'] },
      actions: [/* ActionSpec[] */],
      items: [/* per-row decisions, each with its own actions */],
      dashboardOnly: [/* recommendations with no API */],
    };
  },
};
```

Three rules that keep the demo credible:

1. **Derive the narrative from the rows.** `run` is async precisely so it can await its own
   SQL and read the numbers back out. Never compute a figure in TypeScript and show SQL that
   *would* produce it — they drift.
2. **Comment the *why*.** The SQL is on screen. A comment explaining why a `LEFT JOIN … IS
   NULL` is the right filter is worth more than one restating the syntax.
3. **Say what you cannot do.** If the data will not support the question, say so in the
   answer. If the fix has no API, return a `dashboardOnly` entry instead of a button.

Register it in [`lib/scenarios/index.ts`](lib/scenarios/index.ts) and it appears in the
catalogue, the suggestion chips, and `/how-it-works` automatically.

### Actions and approval

Every `ActionSpec` carries the plain-English effect, the request body, the totals it moves,
and a `run` function that calls the simulated surface. The confirmation sheet shows all of
it — method, path, headers including `Stripe-Account` and `Idempotency-Key`, and the JSON
body — and requires an approver name, which is recorded in the audit log.

Set `requiresSecondAck: true` for a second checkbox. The project applies it to **aggregate
refunds over $10,000** and to **every account debit**, regardless of size, since a debit
moves money out of a host's balance in the opposite direction from a payout.

Long-running work sets `batch`, which drives a progress bar. Small batches make one real
call per item (17 refunds, 17 audit entries). Large ones chunk — the 2,100-charge
cancellation runs 11 batches of 200 and says so in the sheet, because simulating 2,100
individual round-trips would take twenty minutes.

---

## Scenarios

**Internal operations** (`/ask`)

| Scenario | Question |
| --- | --- |
| Fee explainer | Why did our effective fee go up last week? |
| Disputes due | What disputes are due in the next 72 hours? |
| Refundable EFWs | Which early fraud warnings are still refundable? |
| Review queue | What's in the review queue? |
| Payout health | Which hosts with events in the next 14 days can't be paid out? |
| Settlement | Which hosts owe service fees from last week's events? |
| Checkout optimizer | Which hosts' buyers would benefit from Apple Pay or pay-over-time? |
| Event cancellation | Riverlight Music Festival is cancelled — refund everyone |
| Terminal readiness | Are all readers at Cascade Aquarium online for tomorrow? |

**Organizer copilot** (`/hosts/[id]` → Organizer copilot)

| Scenario | Question |
| --- | --- |
| Money from Saturday | Where's my money from Saturday? |
| Repeat buyers | How many of my buyers are repeat customers vs last year? |
| VIP pay-over-time | Should I offer pay-over-time on my $300 VIP tier? |
| Invoice a sponsor | Invoice my sponsor |

---

## The simulated Stripe surface

Tagged throughout the UI so the distinction is never lost: **MCP tools** are a curated
surface an agent can be pointed at safely; **direct API** calls are code you write and own.

**MCP** — `create_refund`, `update_dispute`, `list_disputes`, `list_payment_intents`,
`create_invoice`, `create_invoice_item`, `finalize_invoice`, `create_payment_link`,
`retrieve_balance`, `search_stripe_resources`, `fetch_stripe_resources`

**Direct API** — `POST /v1/disputes/:id/close` · `POST /v1/reviews/:id/approve` ·
`POST /v1/radar/value_list_items` · `POST /v1/transfers` (account debit) ·
`POST /v1/transfers/:id/reversals` · `POST /v1/accounts/:id` · `POST /v1/account_links` ·
`POST /v1/payouts` · `POST /v1/payment_method_configurations/:id` ·
`POST /v1/reporting/report_runs` · `POST /v1/sigma/query_runs` ·
`POST /v1/terminal/readers/:id/refund_payment`

**Dashboard-only** — six real capabilities with no API surface: Radar rule edits, network
token enrolment, Card Account Updater, Adaptive Acceptance, Smart Disputes, Instant Bank
Payments. Scenarios that recommend one render a chip explaining why and who should own it.
See [`lib/stripe-sim/dashboard-only.ts`](lib/stripe-sim/dashboard-only.ts).

---

## The data

70 connected accounts — fandom and comic conventions, immersive museums, music and food
festivals, haunted attractions, light shows, performing arts companies, minor-league teams,
aquariums, comedy clubs, photo-op operators, brand activations and a renaissance faire —
including 14 named hosts with richer histories.

**Scale factor 1:100.** The story is a platform doing ~2.4M payment attempts a quarter;
holding that in a browser tab is not realistic, so 24,000 charge rows stand in for it. Rates
are read straight off the sample and are directly comparable to a real platform's. Absolute
counts and amounts are the sample's own, and the UI says so where it matters.

Calibrated to: 95.7% payment success · 1.0% block rate · 17% wallet share of attempts · 22%
Link share of transactions · 10% card-present · under 1% of volume on pay-over-time · 0.08%
dispute rate · 12% non-US cards converting ~5 pts worse · ~0.5% outdated-card-details
declines · debit ~2 pts below credit.

Three deliberate departures from Sigma, all because a browser SQL engine has no JSON
operators or array aggregates — `metadata.event_id` becomes `metadata_event_id`, array
columns become a joined string plus a `_count`, and every host is US-based settling in USD
so the international signal lives in `card_country`. All four are listed on
`/how-it-works`.

---

## Verification

Two harnesses, neither part of the build. Both compile through `tsc` (no esbuild) and run on
plain Node:

```bash
npx tsc -p tsconfig.verify.json

# Does the generated data hit its targets?
node .tmp-verify/scripts/verify-dataset.js

# Do all 13 scenarios run, and does the matcher route correctly?
node .tmp-verify/scripts/verify-scenarios.js

# …and execute their primary actions against the dataset
node .tmp-verify/scripts/verify-scenarios.js --actions

# One scenario, all of its actions
node .tmp-verify/scripts/verify-scenarios.js event_cancellation --actions
```

`verify-dataset` is what the calibration constants were tuned against — it prints every
aggregate target with a pass or miss. `verify-scenarios` runs each scenario against the real
seeded data and flags any query returning zero rows, any scenario that throws, and any
suggested prompt the matcher fails to route back to its own scenario.

---

## Brand

Modern live-event technology. Black and white base, **brilliant blue `#1F5EFF`** as the
dominant accent, vibrant purple `#7A3BFF` and cool gray `#6B7280` used sparingly. Red Hat
Display for headlines, Red Hat Text for body. A subtle dotted "stadium lights" pattern on
hero and header surfaces and in empty states. The wordmark is monochrome text with a slanted
leading letter — never multicolour. Light theme with a dark header band; rounded-`lg` cards
on 1px cool-gray borders. No stock photography.

Tokens live in [`tailwind.config.ts`](tailwind.config.ts); the dot-grid and streaming-caret
utilities are in [`app/globals.css`](app/globals.css).

---

## Deploying

```bash
gh repo create stagegate-ask-demo --private --source=. --remote=origin --push

vercel --yes --prod     # framework auto-detected as Next.js
vercel git connect      # pushes to main then auto-deploy
```

No environment variables to set. `prebuild` runs `check:names`, so a reserved name in any
file fails the deploy rather than shipping.

---

## Repository layout

```
app/                     routes; data pages are thin wrappers over components/pages
components/
  ask/                   chat, streaming answer, data-used panel, approval sheet
  charts/                recharts trend charts
  layout/                banner, header, footer, the dataset-ready gate
  pages/                 one component per route
  ui/                    buttons, cards, tables, sheet, code blocks
lib/
  scenarios/             internal/ and organizer/, plus the registry and matcher
  sim/                   generator, types, metrics, formatting, seeded RNG
  sql/                   alasql engine, flattening, table documentation
  store/                 zustand store and mutation replay
  stripe-sim/            the simulated MCP and REST surfaces, audit, dashboard-only
scripts/                 check-names guard and the two verification harnesses
```
