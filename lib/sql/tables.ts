/**
 * The tables the agent can query, and where each one would come from in a real
 * deployment. Kept free of client-only code so both the SQL engine and the
 * server-rendered documentation page can read it.
 */

export type TableSource =
  | 'sigma'
  | 'terminal_api'
  | 'embedded_finance_api'
  | 'platform'
  | 'sim_only';

export interface TableDoc {
  name: string;
  source: TableSource;
  description: string;
}

export const TABLE_DOCS: TableDoc[] = [
  { name: 'accounts', source: 'sigma', description: 'Connected accounts, with requirements and payout state.' },
  { name: 'charges', source: 'sigma', description: 'Every payment attempt, including declines and blocks.' },
  { name: 'balance_transactions', source: 'sigma', description: 'Gross, fee and net per movement, with available_on.' },
  { name: 'balance_transaction_fee_details', source: 'sigma', description: 'Fee lines split into Stripe fee, application fee and tax.' },
  { name: 'transfers', source: 'sigma', description: 'Money moved to organizers, plus account debits back to the platform.' },
  { name: 'transfer_reversals', source: 'sigma', description: 'Transfers pulled back, usually alongside a refund.' },
  { name: 'refunds', source: 'sigma', description: 'Refunds issued, with reason and reverse_transfer.' },
  { name: 'disputes', source: 'sigma', description: 'Chargebacks, their reason codes and evidence deadlines.' },
  { name: 'early_fraud_warnings', source: 'sigma', description: 'Issuer fraud notices, and whether they are still actionable.' },
  { name: 'reviews', source: 'sigma', description: 'Radar reviews awaiting a human decision.' },
  { name: 'payouts', source: 'sigma', description: "The platform's own payouts to its bank account." },
  { name: 'connected_account_payouts', source: 'sigma', description: 'Payouts on connected accounts, including failures.' },
  { name: 'radar_value_list_items', source: 'sigma', description: 'Block and allow list membership.' },
  { name: 'payment_method_configurations', source: 'sigma', description: 'What each organizer has switched on at checkout.' },
  { name: 'invoices', source: 'sigma', description: 'Invoices raised on connected accounts.' },
  { name: 'payment_links', source: 'sigma', description: 'Hosted payment links and their restrictions.' },
  { name: 'account_links', source: 'sigma', description: 'Onboarding links generated for organizers.' },
  { name: 'report_runs', source: 'sigma', description: 'Queued Reporting API runs.' },
  { name: 'query_runs', source: 'sigma', description: 'Sigma query runs submitted from the agent.' },
  { name: 'account_balances', source: 'sim_only', description: 'Per-organizer available and pending balance. Derived — in production you would read /v1/balance per account.' },
  { name: 'platform_balances', source: 'sim_only', description: "Marquee's own balance. Derived the same way." },
  { name: 'terminal_readers', source: 'terminal_api', description: 'Reader inventory and last_seen_at. Live API shaped, not a warehouse table.' },
  { name: 'capital_financing_offers', source: 'embedded_finance_api', description: 'Advances Stripe has underwritten per organizer, and whether the organizer has been shown them.' },
  { name: 'capital_financing_summaries', source: 'embedded_finance_api', description: 'Drawn advances with the amount still outstanding after withholding.' },
  { name: 'treasury_financial_accounts', source: 'embedded_finance_api', description: 'Stored-balance accounts, with cash and pending inbound and outbound.' },
  { name: 'treasury_outbound_payments', source: 'embedded_finance_api', description: 'Vendor payments made out of a stored balance rather than a payout.' },
  { name: 'treasury_received_credits', source: 'embedded_finance_api', description: 'Money arriving into a stored balance — weekly ticket-revenue sweeps.' },
  { name: 'issuing_cardholders', source: 'embedded_finance_api', description: 'People on an organizer\'s team who hold a card.' },
  { name: 'issuing_cards', source: 'embedded_finance_api', description: 'Issued cards with their spending limit and allowed merchant categories.' },
  { name: 'issuing_authorizations', source: 'embedded_finance_api', description: 'Card spend attempts, including the ones the card\'s own controls declined.' },
  { name: 'events', source: 'platform', description: "Marquee's own event catalogue. Not a Stripe object." },
  { name: 'admissions', source: 'platform', description: 'Gate scans. Doubles as dispute evidence.' },
  { name: 'service_fee_ledger', source: 'platform', description: 'Service fees accrued per event and whether collected.' },
  { name: 'platform_requests', source: 'platform', description: 'Organizer asks that need a human at Marquee to approve.' },
];

export const SQL_TABLE_NAMES: string[] = TABLE_DOCS.map((table) => table.name);

export const TABLE_SOURCE_LABELS: Record<TableSource, string> = {
  sigma: 'Sigma / Data Pipeline',
  terminal_api: 'Terminal API',
  embedded_finance_api: 'Capital / Treasury / Issuing API',
  platform: 'Marquee platform data',
  sim_only: 'Derived for the simulation',
};

/**
 * Two places the simulated schema departs from Sigma, both because a browser
 * SQL engine has no JSON operators. Documented rather than hidden.
 */
export const SCHEMA_CAVEATS = [
  {
    title: 'metadata is flattened',
    detail:
      "Sigma exposes metadata as a JSON column you reach into. alasql has no JSON operators, so metadata keys become their own columns: charges.metadata.event_id is charges.metadata_event_id here.",
  },
  {
    title: 'array columns are flattened',
    detail:
      'requirements_currently_due arrives as a comma-joined string alongside a requirements_currently_due_count integer, because alasql cannot aggregate over an array cell.',
  },
  {
    title: 'one currency',
    detail:
      'Every organizer is US-based and every charge settles in USD, so cross-currency settlement is out of scope. The international signal lives in card_country — the buyer\'s issuing country — which is what the fee and conversion scenarios actually need.',
  },
  {
    title: 'the sample is not uniform',
    detail:
      'Rates are read off a 1:100 sample, but the event used by the cancellation scenario carries its full charge list so the batch refund runs end to end against real rows rather than a fortieth of them.',
  },
  {
    title: 'embedded finance is not sampled',
    detail:
      "The Capital, Treasury and Issuing tables hold one row per organizer, per financial account, per card — there is nothing to sample, so they are not. Their amounts are sized off the organizer's real volume rather than off the sampled rows, which means a $600,000 financing offer sits next to an organizer whose charge rows only add up to $40,000. Scenarios that mix the two multiply the sampled side by the scale factor in the SQL, where you can see it.",
  },
];
