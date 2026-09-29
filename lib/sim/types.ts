/**
 * Row shapes for the simulated warehouse.
 *
 * Table and column names mirror what Stripe Sigma / Data Pipeline actually
 * expose, so the SQL the agent shows you would be recognisable to anyone who
 * has written a Sigma query. Money is always an integer in the currency's
 * minor unit (cents), and timestamps are epoch seconds — same as Stripe.
 *
 * `terminal_readers` is shaped after the live Terminal API rather than Sigma,
 * because reader state is not a warehouse concept.
 */

export type OrganizerCategory =
  | 'fandom_convention'
  | 'comic_convention'
  | 'immersive_museum'
  | 'music_festival'
  | 'food_festival'
  | 'haunted_attraction'
  | 'holiday_lights'
  | 'performing_arts'
  | 'minor_league_sports'
  | 'comedy_club'
  | 'photo_ops'
  | 'aquarium_zoo'
  | 'brand_activation'
  | 'renaissance_faire';

export type AccountType = 'express' | 'custom';

/**
 * How Marquee collects its service fee from a organizer.
 * - `on_charge`  — application_fee_amount is taken at charge time.
 * - `post_event` — Marquee invoices or debits the organizer after the event.
 * The settlement scenario exists because of the second group.
 */
export type SettlementMode = 'on_charge' | 'post_event';

export interface Account {
  id: string;
  business_profile_name: string;
  country: string;
  type: AccountType;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_currently_due: string[];
  requirements_past_due: string[];
  requirements_disabled_reason: string | null;
  requirements_current_deadline: number | null;
  payout_schedule_interval: 'daily' | 'weekly' | 'monthly' | 'manual';
  metadata: {
    organizer_category: OrganizerCategory;
    next_event_date: string | null;
    settlement_mode: SettlementMode;
    service_fee_percent: string;
    service_fee_fixed: string;
  };
}

export type EventStatus = 'on_sale' | 'completed' | 'cancelled';

/** Platform-side table. Marquee's own product data, not a Stripe object. */
export interface PlatformEvent {
  id: string;
  account_id: string;
  name: string;
  venue: string;
  city: string;
  starts_at: number;
  status: EventStatus;
}

export type CardFunding = 'credit' | 'debit' | 'prepaid';
export type WalletType = 'apple_pay' | 'google_pay' | 'link' | null;
export type PaymentMethodType =
  | 'card'
  | 'card_present'
  | 'affirm'
  | 'afterpay_clearpay'
  | 'klarna';
export type OutcomeType =
  | 'authorized'
  | 'issuer_declined'
  | 'blocked'
  | 'manual_review';
export type RiskLevel = 'normal' | 'elevated' | 'highest' | 'not_assessed';

export interface Charge {
  id: string;
  /** Destination connected account on the destination charge. */
  account_id: string;
  payment_intent_id: string;
  created: number;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
  paid: boolean;
  captured: boolean;
  refunded: boolean;
  amount_refunded: number;
  disputed: boolean;
  customer_id: string;
  card_brand: string;
  card_funding: CardFunding;
  card_country: string;
  card_wallet_type: WalletType;
  payment_method_details_type: PaymentMethodType;
  card_fingerprint: string;
  balance_transaction_id: string | null;
  transfer_id: string | null;
  transfer_group: string | null;
  outcome_type: OutcomeType;
  outcome_reason: string | null;
  outcome_risk_score: number;
  outcome_risk_level: RiskLevel;
  metadata: {
    event_id: string;
    tier: string;
    quantity: string;
  };
}

export type BalanceTransactionType =
  | 'charge'
  | 'payment'
  | 'refund'
  | 'transfer'
  | 'transfer_reversal'
  | 'adjustment'
  | 'payout'
  | 'stripe_fee';

export interface BalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
  available_on: number;
  type: BalanceTransactionType;
  reporting_category: string;
  source_id: string;
}

export interface BalanceTransactionFeeDetail {
  balance_transaction_id: string;
  amount: number;
  currency: string;
  type: 'stripe_fee' | 'application_fee' | 'tax';
  description: string;
}

export interface Transfer {
  id: string;
  amount: number;
  destination_account_id: string;
  source_transaction_id: string | null;
  transfer_group: string | null;
  reversed: boolean;
  amount_reversed: number;
  created: number;
  /**
   * Set when the transfer is an account debit: created in the connected
   * account's context with the platform as the destination.
   */
  is_account_debit?: boolean;
  description?: string | null;
}

export interface TransferReversal {
  id: string;
  transfer_id: string;
  amount: number;
  created: number;
  balance_transaction_id: string | null;
}

export interface Refund {
  id: string;
  charge_id: string;
  amount: number;
  status: 'succeeded' | 'pending' | 'failed' | 'canceled';
  reason: string | null;
  created: number;
  /** Destination-charge refunds can pull the transfer back too. */
  reverse_transfer?: boolean;
}

export type DisputeStatus =
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'warning_closed';

export interface Dispute {
  id: string;
  charge_id: string;
  amount: number;
  reason: string;
  status: DisputeStatus;
  evidence_due_by: number;
  is_charge_refundable: boolean;
  created: number;
  evidence_submitted_at?: number | null;
}

export interface EarlyFraudWarning {
  id: string;
  charge_id: string;
  fraud_type: string;
  actionable: boolean;
  created: number;
}

export interface Review {
  id: string;
  charge_id: string;
  open: boolean;
  reason: string;
  opened_reason: string;
  created: number;
  closed_reason?: string | null;
}

export interface Payout {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  arrival_date: number;
  created: number;
  status: 'paid' | 'pending' | 'in_transit' | 'failed' | 'canceled';
  method: 'standard' | 'instant';
  failure_code: string | null;
  failure_message: string | null;
}

export interface TerminalReader {
  id: string;
  account_id: string;
  location_id: string;
  label: string;
  device_type: string;
  status: 'online' | 'offline';
  last_seen_at: number;
}

/** Platform-side gate scans. Doubles as dispute evidence. */
export interface Admission {
  charge_id: string;
  scanned_at: number;
  gate: string;
}

/** Per-account balance, derived at generation time. */
export interface AccountBalance {
  account_id: string;
  available: number;
  pending: number;
  currency: string;
}

/** Outstanding Marquee service fees for post_event organizers. */
export interface ServiceFeeLedgerRow {
  account_id: string;
  event_id: string;
  tickets_sold: number;
  gross_volume: number;
  fee_owed: number;
  period_end: number;
  settled: boolean;
}

export interface SimDataset {
  accounts: Account[];
  events: PlatformEvent[];
  charges: Charge[];
  balance_transactions: BalanceTransaction[];
  balance_transaction_fee_details: BalanceTransactionFeeDetail[];
  transfers: Transfer[];
  transfer_reversals: TransferReversal[];
  refunds: Refund[];
  disputes: Dispute[];
  early_fraud_warnings: EarlyFraudWarning[];
  reviews: Review[];
  payouts: Payout[];
  connected_account_payouts: Payout[];
  terminal_readers: TerminalReader[];
  admissions: Admission[];
  account_balances: AccountBalance[];
  /** Single row: Marquee's own platform balance. */
  platform_balances: AccountBalance[];
  service_fee_ledger: ServiceFeeLedgerRow[];
  radar_value_list_items: RadarValueListItem[];
  invoices: SimInvoice[];
  payment_links: SimPaymentLink[];
  account_links: SimAccountLink[];
  report_runs: SimReportRun[];
  query_runs: SimQueryRun[];
  payment_method_configurations: PaymentMethodConfiguration[];
  /**
   * Organizer-raised asks that need a human at Marquee to look at them.
   * Enabling a pay-over-time method is a commercial decision as well as a
   * technical one, so the copilot files a request rather than flipping it on.
   */
  platform_requests: PlatformRequest[];
}

export interface PlatformRequest {
  id: string;
  account_id: string;
  kind: 'payment_method_enablement';
  detail: string;
  status: 'pending_platform_review' | 'approved' | 'rejected';
  created: number;
  requested_by: string;
}

export interface RadarValueListItem {
  id: string;
  value_list: string;
  value: string;
  created: number;
}

export interface SimInvoice {
  id: string;
  account_id: string;
  customer_id: string;
  customer_name: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  amount_due: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  lines: { description: string; amount: number; quantity: number }[];
}

export interface SimPaymentLink {
  id: string;
  account_id: string;
  url: string;
  active: boolean;
  created: number;
  line_description: string;
  unit_amount: number;
  restrictions: string | null;
}

export interface SimAccountLink {
  id: string;
  account_id: string;
  url: string;
  created: number;
  expires_at: number;
  type: 'account_onboarding' | 'account_update';
}

export interface SimReportRun {
  id: string;
  report_type: string;
  status: 'pending' | 'succeeded' | 'failed';
  created: number;
  parameters: Record<string, unknown>;
  result_url: string | null;
}

export interface SimQueryRun {
  id: string;
  sql: string;
  status: 'pending' | 'completed' | 'failed';
  created: number;
  row_count: number;
}

export interface PaymentMethodConfiguration {
  id: string;
  account_id: string | null;
  name: string;
  is_default: boolean;
  parent: string | null;
  payment_methods: Record<
    string,
    { display_preference: { preference: 'on' | 'off'; value: 'on' | 'off' } }
  >;
}

export type TableName = keyof SimDataset;
