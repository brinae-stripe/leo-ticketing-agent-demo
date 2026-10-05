# Marquee · LEO

A fully simulated demo of **LEO** (the Live Event Optimizer), the AI agent inside
**Marquee** — a fictional live-events ticketing platform running on Stripe Connect.

Somebody asks a question in plain English. LEO answers from simulated Stripe Data Pipeline
tables, shows the SQL it ran, proposes a resolution, and offers buttons that execute
simulated Stripe MCP and REST calls — each behind an explicit human approval.

**Two views, one pipeline.** They are separate products in the UI, not two descriptions of
one. The **Viewing as** control at the top of the sidebar switches between them and the whole
rail changes:

| | Platform view (`/platform/*`) | Organizer view (`/o/<account>/*`) |
| --- | --- | --- |
| Who | Hana, Marquee finance and operations | Elena, one event organizer |
| Scope | All 70 organizers | One connected account, by `account_id` |
| Sees | Everything, including Marquee's own margin | Their own rows only |
| Money nav | Advances · Stored balances · Card program | Event Account · Production Cards · Event Advance |
| Why it exists | Runs the book and the finance program | The version Marquee can package and sell |

The difference between them is one clause in a `WHERE`. Building the agent once for internal
operations means the organizer-facing version is not a second project — which is what makes
it a product rather than a cost centre.

LEO is a **drawer**, not a page. It opens over whatever you are looking at, scoped to the view
you are in, so asking a question never costs you your place. Contextual "Ask LEO" buttons on
the money pages deep-link a question into it.

Both names live in [`lib/brand.ts`](lib/brand.ts), so renaming the platform or the agent is
a one-line edit. `npm run check:names` fails the build if a reserved name appears anywhere,
so check that guard before picking a replacement.

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
- LEO is **not** a language model here. It matches your question against a catalogue of 19
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
| `npm run lint`        | ESLint (flat config, `eslint.config.mjs`)                        |
| `npm run typecheck`   | `tsc --noEmit`                                                   |
| `npm run check:names` | Fails the build if a reserved brand name appears anywhere        |
| `npm run verify:data` | Calibration harness — see [Verification](#verification)          |

No environment variables are required, for local development or for deployment.

Built on Next 16, which uses Turbopack for `next build`. The alasql alias is declared for
both Turbopack and webpack in [`next.config.mjs`](next.config.mjs), so `next build
--webpack` also works.

---

## The pages

A dark left rail, grouped into sections, because grouping is itself the argument: a finance
product area reading as a product area next to Ticketing is the claim the demo is making,
and it is made in the navigation before anyone opens a page.

**Platform view**

| Route | What is there |
| ----- | ------------- |
| `/platform` | KPI tiles, 13-week trend charts, top organizers by volume |
| `/platform/events` | All 324 events, split on-sale from past — the two get read for opposite reasons |
| `/platform/events/[id]` | Event overview: daily activity curve, issued inventory per price level, derived stats |
| `/platform/organizers` | All 70 connected accounts, filterable by category, state, and which money products they have |
| `/platform/money/advances` | The advance portfolio, what is outstanding, and the offers nobody has surfaced |
| `/platform/money/treasury` | The pre-event float, who is enrolled, and who has float and no account |
| `/platform/money/cards` | Cards issued, combined ceiling, approved spend, what the controls caught |
| `/platform/settlements` | Service fees accrued per event by post-event organizers |
| `/platform/audit` | Every simulated call this session made, with request and response |

**Organizer view**

| Route | What is there |
| ----- | ------------- |
| `/o/[id]` | Their dashboard: sales, commercials, and pointers into the money section |
| `/o/[id]/events` | The same events list, scoped to this account |
| `/o/[id]/money` | Money overview: balance hero, next settlement, product tiles, cross-product timeline |
| `/o/[id]/money/account` | **Event Account** (Treasury): balance, spendable, routing and account number, reconciling ledger |
| `/o/[id]/money/cards` | **Production Cards** (Issuing): cards, limits, allow-lists, and every decline |
| `/o/[id]/money/advance` | **Event Advance** (Capital): the offer or the drawn advance, with payback worked out |
| `/o/[id]/payments` | Method mix, disputes, readers |
| `/o/[id]/account` | Verification requirements and payout configuration |

`/how-it-works` sits outside both: the flow, the two views, where the money products live, the
MCP-versus-API split, the Dashboard-only list, and the schema caveats. The old URLs (`/`,
`/events`, `/organizers/:id`, `/leo`, `/audit`) redirect, because they have been shared.

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
refunds over $10,000**, to **every account debit** regardless of size (a debit moves money
out of an organizer's balance in the opposite direction from a payout), and to **any Treasury
outbound payment**, because money going to a third party cannot be pulled back with a click.

Long-running work sets `batch`, which drives a progress bar. Small batches make one real
call per item (17 refunds, 17 audit entries). Large ones chunk — the cancellation covers
1,957 refundable charges in 10 batches of 200 and says so in the sheet, because simulating
1,957 individual round-trips would take twenty minutes.

---

## Scenarios

**Platform view** (LEO drawer, platform scope) — payments first, then the three that only become askable once
payment data and the platform's own event data are in the same warehouse.

| Scenario | Question |
| --- | --- |
| Fee explainer | Why did our effective fee go up last week? |
| Disputes due | What disputes are due in the next 72 hours? |
| Refundable EFWs | Which early fraud warnings are still refundable? |
| Review queue | What's in the review queue? |
| Payout health | Which organizers with events in the next 14 days can't be paid out? |
| Settlement | Which organizers owe service fees from last week's events? |
| Checkout optimizer | Which organizers' buyers would benefit from Apple Pay or pay-over-time? |
| Event cancellation | Riverlight Music Festival is cancelled — refund everyone |
| Terminal readiness | Are all readers at Cascade Aquarium online for tomorrow? |
| Capital eligibility | Which organizers could be offered financing? |
| Treasury float | How much are we holding before events, and for how long? |
| Issuing vendor spend | Which organizers are paying vendors by bank transfer instead of card? |

**Organizer view** (LEO drawer, scoped to one account)

| Scenario | Question |
| --- | --- |
| Money from Saturday | Where's my money from Saturday? |
| Repeat buyers | How many of my buyers are repeat customers vs last year? |
| VIP pay-over-time | Should I offer pay-over-time on my $300 VIP tier? |
| Invoice a sponsor | Invoice my sponsor |
| Capital advance | Can I get an advance to cover my venue deposit? |
| Treasury pay vendor | Can I pay my staging vendor out of my balance? |
| Issuing team card | Give my production lead a card with a monthly limit |

Treasury and Issuing are on a handful of organizers by design, and a Capital offer only
exists where Stripe wrote one — so every organizer page and scenario has a "you do not have
this, and here is why" branch, which is what you land on for most accounts. The **Viewing as**
switcher marks organizers that do have money products and lists them first; `/platform/organizers`
is also filterable by **Has a stored balance**, **Has issued cards** or **Has a financing offer**.

`Tidewater Playhouse` and `Ink & Panel Comic Fest` have all three, which makes them the
accounts to open first in a live demo.

---

## Recommendations on the money pages

Each money page carries a **What LEO noticed** panel, as does the organizer
dashboard — where the three signals are the three the deck promises: funding
gaps, unusual spending, and opportunities to improve event economics. Unusual
spending is an outlier against *this* organizer's own approved authorisations,
not a global threshold, because a $40,000 freight invoice is unremarkable for a
festival and extraordinary for a comedy club.

Three rules keep the panel from becoming the filler it easily could be:

1. **Every card is derived from rows on that page**, and `why` carries the numbers
   that produced it. Nothing renders when the data does not support it — an empty
   panel says so in one line rather than inventing three findings.
2. **The resolution matches what is actually possible.** An action runs through
   the same approval sheet as everything else and is tagged MCP or direct API
   with its endpoint printed next to it. Where no endpoint exists it is a
   Dashboard-only chip naming the owner. Where the answer needs analysis rather
   than a call, it opens LEO with the question pre-filled.
3. **Tone is urgency, not confidence.** `Needs a decision` means there is a clock
   or money decaying. `Worth a look` means it will matter soon. `Context` means it
   is worth knowing and needs nothing.

The list is held steady while an approval sheet is open. A recommendation that
resolves itself is normal — widen an allow-list and "these declines share a
category" stops being true — but without freezing, the item disappears the moment
the call lands and takes the open sheet, and the response panel, with it.

See [`lib/recommendations/`](lib/recommendations/).

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
`POST /v1/account_sessions` · `POST /v1/payouts` ·
`POST /v1/payment_method_configurations/:id` ·
`POST /v1/capital/financing_offers/:id/mark_delivered` ·
`POST /v1/treasury/financial_accounts` · `POST /v1/treasury/outbound_payments` ·
`POST /v1/issuing/cardholders` · `POST /v1/issuing/cards` ·
`POST /v1/issuing/cards/:id` (widen an allow-list, raise a ceiling) ·
`POST /v1/reporting/report_runs` · `POST /v1/sigma/query_runs` ·
`POST /v1/terminal/readers/:id/refund_payment`

Worth stating plainly: **the hosted MCP surface covers none of Capital, Treasury or
Issuing.** All three are direct REST — code a platform writes, owns and secures itself. See
[`lib/stripe-sim/embedded-finance.ts`](lib/stripe-sim/embedded-finance.ts).

**Dashboard-only** — eight real capabilities with no API surface to turn them on: Radar rule
edits, network token enrolment, Card Account Updater, Adaptive Acceptance, Smart Disputes,
Instant Bank Payments, Treasury enablement, and accepting a Capital offer. The last one is
the most instructive: the organizer takes on the liability, so the organizer agrees to the
terms in a Stripe-hosted surface the platform can embed but cannot complete. There is no
endpoint that accepts an offer on someone else's behalf, by design — so the demo opens the
flow and stops, rather than faking a tidier ending. Scenarios that recommend any of these
render a chip explaining why and who owns it.
See [`lib/stripe-sim/dashboard-only.ts`](lib/stripe-sim/dashboard-only.ts).

---

## The data

70 connected accounts — fandom and comic conventions, immersive museums, music and food
festivals, haunted attractions, light shows, performing arts companies, minor-league teams,
aquariums, comedy clubs, photo-op operators, brand activations and a renaissance faire —
including 14 named organizers with richer histories.

**Scale factor 1:100 — and what is sampled is the organizers.** The story is a platform doing
~2.4M payment attempts a quarter across thousands of organizers. The 70 accounts here stand in
for roughly 7,000, and each one's history is *complete*: Big Fork Food & Wine really did take
961 payments for $338,270 last quarter, and that is their whole business rather than a
hundredth of it.

That axis is the whole ballgame. Sampling each organizer's charges instead means every
per-organizer figure has to be multiplied by 100 to be "real", which turns a regional food
festival into a $134M-a-year operation, hands it a $9.7M Capital advance and bills it $490,000
for a venue deposit. Each of those is individually defensible and collectively absurd, and the
moment anyone does the arithmetic the rest of the demo stops being believable. So:

- **An organizer's own figures are never scaled.** Volume, balance, financing offer, supplier
  bills, stored balance, card limits — real as they stand, and they agree with that
  organizer's charge rows because they *are* those rows.
- **Platform-wide roll-ups are scaled, and say so.** A total across all organizers multiplies
  by the scale factor, because the 70 shown are 1% of them.

Rates are read straight off the sample and are directly comparable to a real platform's.

Calibrated to: 95.7% payment success · 1.0% block rate · 17% wallet share of attempts · 22%
Link share of transactions · 10% card-present · under 1% of volume on pay-over-time · 0.08%
dispute rate · 12% non-US cards converting ~5 pts worse · ~0.5% outdated-card-details
declines · debit ~2 pts below credit.

**The stored balance is a real ledger.** `balance_cash` is derived, not asserted: settled
received credits, less posted outbound payments, less approved card spend. Nothing is floored
or fudged — card authorisations are capped at what the balance could actually fund while the
data is generated, so a declined-for-insufficient-funds authorisation never shows up as
approved. On the Event Account page the settled rows sum to the balance, the four stat tiles
derive to the same figure, pending rows are greyed because they are not in it yet, and declined
authorisations render at zero. A Capital advance is deliberately absent from that ledger:
Capital pays out to the Stripe balance rather than into the stored balance, so including it
would break the reconciliation.

**One number for volume.** `accounts.metadata.trailing_volume` is the authoritative trailing
90-day figure — the organizer's own, unscaled. Every consumer reads that column rather than
re-deriving it. It used to carry a correction for the one fixture event that holds its full
charge list while everything else was sampled; sampling organizers instead makes every event's
charge list complete, so the special case is gone rather than fixed.

**A monthly ceiling actually binds.** Card authorisations are checked against
per-calendar-month approved spend as the data is generated, so an authorisation
that would cross the limit is recorded as declined with
`card_controls_spending_limit` rather than approved. That gives the dataset both
decline reasons — the allow-list is a policy control, the ceiling is a budget
control, and they need opposite responses — and it means no page can report a
cardholder at 130% of a limit the network would never have let them pass. The
card tiles compare this month's spend against the monthly limit for the same
reason.

**Withhold rates are solved, not drawn.** A Capital advance's withhold rate is computed from the
advance and a target payback window against the organizer's own run rate, and repayment progress
uses the same arithmetic the Event Advance page shows. Pick them independently and a four-day-old
advance shows 2% repaid next to a daily rate implying 12% — which is the kind of contradiction a
controller spots immediately.

**Embedded finance is at the organizer's own scale.** Capital, Treasury and Issuing amounts are
sized straight off the organizer's trailing volume, so they agree with that organizer's charge
rows and there is no scaling step to reconcile. A $1.35M-a-year festival is offered $40,000 to
$108,000, which is a real Stripe Capital offer; advances are capped at $250,000 regardless of
volume, so the platform's largest organizer is limited by the product rather than by its own
size. Card limits come off a role-based ladder bounded by what the organizer turns over — a
$25,000-a-month production card at an organizer billing $18,000 a month is not a control.
See [`lib/sim/embedded-finance.ts`](lib/sim/embedded-finance.ts).

**`vendor_bills` is not a Stripe object.** It is platform-side data, and the only table here that
has no Stripe counterpart. It exists because you cannot flag a funding gap without knowing what
is actually due and when, and production costs are the reason an organizer needs financing in the
first place. Stripe can see an organizer's balance and their ticket revenue; what it cannot see is
the venue invoice sitting on their desk. A ticketing platform can, which is precisely the asymmetry
that makes the platform the right place to notice.

**The funding gap is discovered, not engineered.** Event costs are front-loaded and ticket
revenue is not: the venue deposit, the staging contract and the talent guarantee all fall due
*before* doors open, while Marquee holds that event's revenue until it has happened, because a
cancelled show means refunding buyers. So an organizer's spendable balance reflects events that
have already run while the bills on their desk belong to the one that has not — the same
pre-event hold the platform float page measures, seen from the organizer's side.

Bills are sized off the event and nothing else: what this organizer's completed events
typically grossed, times a realistic cost share per line, times one per-organizer cost-intensity
draw (a promoter who owns their staging stages the same gross far cheaper than a festival
trucking in a built site). Whether that leaves them short is then a question for whoever reads
the data — `fundingOutlook` works it out at render time, and 4 of 70 organizers come up short
while 25 have bills they can cover.

An earlier version solved it backwards: bills were scaled until the shortfall at a chosen bill
hit a target fraction of projected funds. It is worth saying why that was wrong, because it
looked fine. It needed the balance to exist before the bills, it quietly guaranteed the
conclusion the demo then presented as a finding, and it collapsed the moment amounts were not
inflated a hundredfold — an organizer's Stripe balance is near zero between weekly payouts, so
solving against it produced $300 venue deposits and a $1,283 "funding gap" sitting next to the
offer of a $51,000 advance.

**What the projection can and cannot see.** Funds *on Stripe* — balance, stored balance, and
ticket revenue arriving on Stripe — against obligations due by a date, where obligations are
open supplier bills and service fees (debited four days after the event they belong to, not on
the event date). Payments already in flight are deliberately *not* obligations: they are the
same money as `balance_outbound_pending`, which reachable funds already nets out, and counting
them twice is what produced a card reporting a staging payment "due in 0 days" against an
organizer who was not in fact short. An organizer's working capital mostly sits in their own
bank, which this dataset does not model and the agent has no access to. A shortfall is
therefore a prompt to check, never a verdict, and the card says so in those words.

Three guards keep it from crying wolf. A gap has to clear an absolute floor of $1,000, because
a $550 shortfall on an $800 print bill is true and useless. It has to be at least 15% of the
whole stack due by that date, not of the row that happened to tip it. And a bill falling due
inside three days is recorded as paid, because an invoice due tomorrow has either been settled
or is a phone call rather than a financing decision. The card headlines a single bill when
there is one and the stack total when there are several — headlining whichever row tipped it
produced "$500 is due in 16 days — funds come up $1,470 short", where the shortfall exceeds the
bill it is supposedly about. "Due in N days" is counted in calendar days off UTC midnight so it
agrees with the date printed beside it.

See [`lib/sim/bills.ts`](lib/sim/bills.ts) and `fundingOutlook` in
[`lib/sim/money.ts`](lib/sim/money.ts).

Deliberate departures from Sigma, mostly because a browser SQL engine has no JSON operators
or array aggregates — `metadata.event_id` becomes `metadata_event_id`, array columns become a
joined string plus a `_count`, and every organizer is US-based settling in USD so the
international signal lives in `card_country`. All five caveats, including the sampling note
above, are listed on `/how-it-works` rather than buried here.

---

## Verification

Two harnesses, neither part of the build. Both compile through `tsc` (no esbuild) and run on
plain Node:

```bash
npm run verify              # both

npm run verify:data         # does the generated data hit its targets?
npm run verify:scenarios    # do all 19 scenarios run, and does the matcher route correctly?
```

Each wraps `tsc -p tsconfig.verify.json` into `.tmp-verify/`, which is how they have to run:
the scripts import extensionless specifiers across the whole `lib/` graph, so Node's ESM
loader cannot resolve them directly no matter how the type stripping is flagged.

For the flags, call the compiled script:

```bash
npm run verify:build

# …and execute their primary actions against the dataset
node .tmp-verify/scripts/verify-scenarios.js --actions

# One scenario, all of its actions
node .tmp-verify/scripts/verify-scenarios.js event_cancellation --actions
```

`verify-dataset` is what the calibration constants were tuned against — it prints every
aggregate target with a pass or miss. `verify-scenarios` runs each scenario against the real
seeded data and flags any scenario that throws, any suggested prompt the matcher fails to
route back to its own scenario, and any query returning zero rows — except the handful marked
`emptyIsExpected`, where finding nothing *is* the answer and the narrative says so ("no
invoices have been raised yet, so there is no duplicate risk"). Without that distinction those
two sit there as permanent failures and a genuine empty hides behind them.

Anything touching the generators moves the seeded RNG stream, so re-run both after changing
them — figures quoted in scenarios will have shifted even when nothing is broken.

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
# If gh has more than one GitHub host configured, pin it — otherwise it will try
# first one and fail on its credentials.
GH_HOST=github.com gh repo create leo-ticketing-agent-demo --private --source=. --remote=origin --push

vercel login            # required once
vercel --yes --prod     # framework auto-detected as Next.js
vercel git connect      # pushes to main then auto-deploy
```

No environment variables to set, for either. `prebuild` runs `check:names`, so a reserved
name in any file fails the deploy rather than shipping.

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
  brand.ts               the platform name, the agent name, and the two view definitions
  scenarios/             internal/ and organizer/, plus the registry and matcher
  sim/                   generator, types, metrics, formatting, seeded RNG
    embedded-finance.ts  Capital, Treasury and Issuing, generated on top of payments
  sql/                   alasql engine, flattening, table documentation
  store/                 zustand store and mutation replay
  stripe-sim/            the simulated MCP and REST surfaces, audit, dashboard-only
    embedded-finance.ts  the Capital, Treasury and Issuing calls — all direct REST
scripts/                 check-names guard and the two verification harnesses
```
