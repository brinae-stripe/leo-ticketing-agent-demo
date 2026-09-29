/**
 * Things a well-behaved agent must not pretend it can do.
 *
 * Each of these is a real Stripe capability with no API or MCP surface to turn
 * it on — they are Dashboard settings, support requests, or account-level
 * enablements. When a scenario's recommendation lands on one of them, the UI
 * renders a "Dashboard-only" chip with a link and a suggested owner instead of
 * an action button. Being honest about the boundary is the point: an agent that
 * silently no-ops here is worse than one that says "a human has to do this".
 */

export type DashboardOnlyId =
  | 'radar_rule_edit'
  | 'network_tokens'
  | 'card_account_updater'
  | 'adaptive_acceptance'
  | 'smart_disputes'
  | 'instant_bank_payments'
  | 'treasury_enablement'
  | 'capital_offer_acceptance';

export interface DashboardOnlyCapability {
  id: DashboardOnlyId;
  label: string;
  /** Why there is no button for it. */
  why: string;
  where: string;
  owner: string;
}

export const DASHBOARD_ONLY: Record<DashboardOnlyId, DashboardOnlyCapability> = {
  radar_rule_edit: {
    id: 'radar_rule_edit',
    label: 'Edit a Radar rule',
    why: 'Rule creation and thresholds are Dashboard-only. The API can add and remove value list items, but not author or edit the rules that read them.',
    where: 'Dashboard → Radar → Rules',
    owner: 'Risk operations',
  },
  network_tokens: {
    id: 'network_tokens',
    label: 'Enrol in network tokens',
    why: 'Network tokenisation is enabled per account by Stripe. There is no endpoint to opt an account in.',
    where: 'Dashboard → Settings → Payments, or your Stripe account team',
    owner: 'Payments lead + Stripe account team',
  },
  card_account_updater: {
    id: 'card_account_updater',
    label: 'Turn on Card Account Updater',
    why: 'Account Updater is an account-level setting, not an API resource. It refreshes stored cards automatically once enabled.',
    where: 'Dashboard → Settings → Payments → Card Account Updater',
    owner: 'Payments lead',
  },
  adaptive_acceptance: {
    id: 'adaptive_acceptance',
    label: 'Enable Adaptive Acceptance',
    why: "Adaptive Acceptance is applied by Stripe's network-level models. There is nothing to configure through the API.",
    where: 'Your Stripe account team',
    owner: 'Stripe account team',
  },
  smart_disputes: {
    id: 'smart_disputes',
    label: 'Turn on Smart Disputes',
    why: 'Smart Disputes automates evidence assembly and is switched on for the account in the Dashboard, not per dispute.',
    where: 'Dashboard → Disputes → Settings',
    owner: 'Disputes operations',
  },
  instant_bank_payments: {
    id: 'instant_bank_payments',
    label: 'Enable Instant Bank Payments',
    why: 'Instant Bank Payments requires account review and enablement by Stripe before it can be added to a payment method configuration.',
    where: 'Dashboard → Settings → Payment methods, then Stripe review',
    owner: 'Payments lead + Stripe account team',
  },
  treasury_enablement: {
    id: 'treasury_enablement',
    label: 'Enable Treasury on the platform',
    why: 'Treasury is invite-only and underwritten by Stripe and its bank partners. The API can open a financial account once the capability is active, but nothing in the API requests the capability in the first place.',
    where: 'Your Stripe account team',
    owner: 'Finance lead + Stripe account team',
  },
  capital_offer_acceptance: {
    id: 'capital_offer_acceptance',
    label: 'Accept a financing offer',
    why: 'The organizer takes on the liability, so the organizer has to agree to the terms — in a Stripe-hosted surface, which the platform can embed but cannot complete. There is no endpoint that accepts an offer on someone else\'s behalf, by design.',
    where: 'Embedded Connect component, or the organizer\'s Stripe-hosted dashboard',
    owner: 'The organizer',
  },
};

export interface DashboardOnlyRecommendation {
  capability: DashboardOnlyId;
  /** Scenario-specific reasoning, with the numbers that justify it. */
  rationale: string;
}

export function dashboardOnly(
  capability: DashboardOnlyId,
  rationale: string,
): DashboardOnlyRecommendation {
  return { capability, rationale };
}
