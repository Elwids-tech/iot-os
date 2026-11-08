/**
 * Billing accounts (spec 023, ADR-026): the payer of record for one or more organizations.
 * Plans, allowances and usage (specs 028 and 029, ADR-035).
 */

/** What a plan can limit. */
export type AllowanceKind = "alerts" | "sms" | "devices" | "data_points" | "retention_days" | "organizations"

/**
 * One allowance a plan sets. `value` is null for unlimited; `retention_days` is never
 * unlimited. A kind a plan does not list falls back to the deployment's default.
 */
export type PlanAllowance = {
  kind: AllowanceKind
  value: number | null
}

/**
 * One of a billing account's allowances: its override, else its plan's, else the
 * deployment's default. For `retention_days`, null means the platform setting applies.
 */
export type Allowance = {
  kind: AllowanceKind
  value: number | null
  source: "override" | "plan" | "default"
  note: string | null
}

/** What usage covers: monthly alerts, SMS and data points (stored readings), and devices, which are a level. */
export type UsageKind = "alerts" | "sms" | "data_points" | "devices"

/**
 * A billing account's usage of one allowance in one UTC month. `allowance` is the
 * account's allowance now (null when unlimited) and `left` follows from it, 0 once used
 * up. `overage` was fixed as each unit was counted. `organizations` is each
 * organization's share, deleted and moved-away ones included under the name they had.
 *
 * `data_points` come from the runtime's reports and alone carry `final` (the whole month
 * is reported), `reported_at` and `stale` (an open month not reported for a while): show
 * "Provisional" or "Last reported …" instead of presenting the count as current.
 *
 * `devices` is a level: `count` is the devices holding a place now (an earlier month
 * shows its peak), `overage` is always 0, and only devices carry `peak_this_month` and
 * `over_limit` (more devices than the limit, after it was lowered or an organization
 * moved in).
 */
export type Usage = {
  kind: UsageKind
  /** The first day of the UTC month, `YYYY-MM-DD`. */
  month: string
  count: number
  allowance: number | null
  left: number | null
  overage: number
  organizations: { organization_uuid: string; name: string; count: number }[]
  final?: boolean
  reported_at?: string | null
  stale?: boolean
  peak_this_month?: number
  over_limit?: boolean
}

/**
 * One allowance this month as a manager of the organization sees it: the organization's
 * own `count`, and the billing account's `allowance`, `left` and `overage`. It never
 * names the account or its other organizations.
 */
export type OrganizationUsage = {
  kind: UsageKind
  month: string
  count: number
  allowance: number | null
  left: number | null
  overage: number
  /** Data points only, as on `Usage`. */
  final?: boolean
  reported_at?: string | null
  stale?: boolean
  /** Devices only: the billing account has more devices than its limit allows. */
  over_limit?: boolean
}

/** A plan in the platform administrators' list. */
export type BillingPlan = {
  uuid: string
  name: string
  description: string | null
  archived: boolean
  archived_at: string | null
  allowances: PlanAllowance[]
  /** Billing accounts on the plan now. */
  accounts_count: number
  /** Whether any account was ever on it; such a plan cannot be deleted, only archived. */
  ever_assigned: boolean
  created_at: string | null
  /** This month's prices, and next month's when a change waits. */
  prices: PriceSummary
}

/** A plan's page: the accounts on it now (up to 100) and its latest history. */
export type BillingPlanDetail = BillingPlan & {
  accounts: { uuid: string; name: string; kind: PlanAssignmentKind; since: string }[]
  history: PlanHistoryEntry[]
}

/**
 * One entry of a plan's history. `changes` lists name and description changes and
 * each allowance as text: a number, "Unlimited" or "Default".
 */
export type PlanHistoryEntry = {
  at: string
  action: "created" | "updated" | "archived" | "restored"
  actor: { id: number; name: string } | null
  changes?: { field: string; from: string | null; to: string | null }[]
}

/**
 * A plan's values. `allowances`, when sent, is the complete set: a kind left out falls
 * back to the deployment's default.
 */
export type BillingPlanValues = {
  name: string
  description?: string | null
  allowances?: Partial<Record<AllowanceKind, number | null>>
}

export type PlanAssignmentKind = "paid" | "trial" | "trial_unpaid"

/** The plan a billing account is on now, and since when. */
export type PlanAssignment = {
  uuid: string
  kind: PlanAssignmentKind
  plan: { uuid: string; name: string; archived: boolean }
  started_at: string
  trial_ends_at: string | null
}

/** A billing account owner, by integer user id (ADR-013). */
export type BillingAccountOwner = {
  id: number
  name: string
  email: string
  added_at: string | null
}

/** A row of the platform administrators' billing account list. */
export type BillingAccountSummary = {
  uuid: string
  name: string
  contact_email: string | null
  /** The `organizations` allowance; null when unlimited. */
  organization_limit: number | null
  plan: { uuid: string; name: string } | null
  organizations_count: number
  owners: BillingAccountOwner[]
  created_at: string | null
}

export type BillingAccountHistoryAction =
  | "created"
  | "updated"
  | "owner_added"
  | "owner_removed"
  | "organization_joined"
  | "organization_left"

/** One entry of an account's history. Each action fills only its own fields. */
export type BillingAccountHistoryEntry = {
  at: string
  action: BillingAccountHistoryAction
  /** Null for the rollout and for changes made outside a request. */
  actor: { id: number; name: string } | null
  /** organization_joined and organization_left. */
  organization?: { uuid: string; name: string }
  /** owner_added and owner_removed. */
  user?: { id: number; name: string }
  /** updated: each changed field, old and new value as text. */
  changes?: { field: string; from: string | null; to: string | null }[]
}

export type BillingAccountOrganization = {
  uuid: string
  name: string
  slug: string
  users_count: number
  devices_count: number
  assigned_at: string | null
}

/** A billing account's page: details, organizations, owners and the latest 100 history entries. */
export type BillingAccountDetail = {
  uuid: string
  name: string
  contact_email: string | null
  notes: string | null
  /** The `organizations` allowance; null when unlimited. */
  organization_limit: number | null
  organizations_count: number
  created_at: string | null
  plan_assignment: PlanAssignment | null
  allowances: Allowance[]
  /** This month's usage, with each organization's share. */
  usage: Usage[]
  /** What the account pays on its plan, overrides included; null without a plan. */
  prices: PriceSummary | null
  price_overrides: PriceOverride[]
  billing_details: BillingDetails
  owners: BillingAccountOwner[]
  organizations: BillingAccountOrganization[]
  history: BillingAccountHistoryEntry[]
}

/** The organization limit is the `organizations` allowance: see `overrideAllowance`. */
export type BillingAccountValues = {
  name: string
  contact_email?: string | null
  notes?: string | null
}

/**
 * A billing account as its owner sees it in the portal. Without an SMS provider on the
 * deployment, `allowances` and `usage` leave SMS out.
 */
export type OwnedBillingAccount = {
  uuid: string
  name: string
  /** Null when unlimited. */
  organization_limit: number | null
  organizations_count: number
  organizations: { uuid: string; name: string; created_at: string | null; member: boolean }[]
  /** `since` is when the account went onto the plan. */
  plan: { uuid: string; name: string; since: string } | null
  allowances: Allowance[]
  /** This month's usage, with each organization's share. */
  usage: Usage[]
  /** What the account pays on its plan, overrides included; null without a plan. */
  prices: PriceSummary | null
  /** The latest issued invoice; owners never see drafts. */
  latest_invoice: InvoiceSummary | null
}

/** The organization an owner just created; reload the session for its capabilities. */
export type OwnerOrganization = {
  uuid: string
  name: string
  slug: string
}

/**
 * The 409 a billing change answers when it would shorten organizations' telemetry
 * retention (spec 029 US4). Resend with `confirmRetention`; older history is deleted only
 * from `deletion_from`.
 */
export type RetentionNeedsConfirmation = {
  message: string
  retention: {
    deletion_from: string
    organizations: { uuid: string; name: string; from_days: number; to_days: number }[]
  }
}

/** What a plan charges (spec 029 FR-027); an account can override each from next month. */
export type PriceKind = "base_price" | "alert_overage_price" | "data_point_overage_price"

/**
 * One month's prices, integers in the currency's minor units: the monthly base price, the
 * price per alert over the allowance, and the price per block of data points over it.
 */
export type Prices = {
  /** The first day of the UTC month they apply from, `YYYY-MM-DD`. */
  effective_from: string
  base_price: number
  alert_overage_price: number
  data_point_overage_price: number
  data_point_block_size: number
}

/** This month's prices, and next month's when a change waits (null otherwise). */
export type PriceSummary = {
  currency: string
  current: Prices
  next: Prices | null
}

/** An account's override of one price this month (`value`) and next (`next_value`); null is the plan's price. */
export type PriceOverride = {
  price: PriceKind
  value: number | null
  note: string | null
  next_value: number | null
  next_note: string | null
}

/** The plan's prices from next month. */
export type PlanPriceValues = Omit<Prices, "effective_from">

/** A named tax rate; `basis_points` is hundredths of a percent (1500 is 15%). */
export type TaxRate = {
  uuid: string
  name: string
  basis_points: number
  archived: boolean
  archived_at: string | null
}

/** A billing account's details for its invoices. */
export type BillingDetails = {
  billing_address: string | null
  tax_number: string | null
  tax_rate: TaxRate | null
}

/**
 * The operator's billing details and number prefixes. Send `revision` back when saving:
 * a stale one answers 409. `currency` is the deployment's and read-only.
 */
export type BillingSettings = {
  legal_name: string | null
  address: string | null
  tax_registration_number: string | null
  invoice_footer: string | null
  invoice_prefix: string
  credit_note_prefix: string
  revision: number
  currency: string
  updated_at: string | null
}

export type BillingSettingsValues = Omit<BillingSettings, "currency" | "updated_at">

export type InvoiceStatus = "draft" | "issued"

/** `credited` when credit notes left nothing to pay; `paid_outside` when a payment made another way was recorded. */
export type PaymentStatus = "pending" | "paid" | "failed" | "credited" | "paid_outside"

export type InvoiceLineKind = "base_price" | "trial" | "alert_overage" | "data_point_overage" | "adjustment" | "credit"

/**
 * An invoice in a list. Amounts are integers in the minor units of `currency`;
 * `outstanding` is what is still owed after credit notes and payment.
 */
export type InvoiceSummary = {
  uuid: string
  /** Null until issued. */
  number: string | null
  status: InvoiceStatus
  /** The first day of the UTC month, `YYYY-MM-DD`. */
  month: string
  billing_account: { uuid: string; name: string }
  /** Drafted before the month's usage was final. */
  usage_incomplete: boolean
  currency: string
  subtotal: number
  tax: number
  total: number
  credit_applied: number
  amount_due: number
  outstanding: number
  due_at: string | null
  payment_status: PaymentStatus
  drafted_at: string
  issued_at: string | null
}

/** One invoice line; `amount` is negative for credit, `unit_price` null where a line has none. */
export type InvoiceLine = {
  id: number
  position: number
  kind: InvoiceLineKind
  description: string
  quantity: number
  unit_price: number | null
  amount: number
  period_start: string | null
  period_end: string | null
  /** Owners never see an adjustment's note. */
  note: string | null
}

/** A credit note: `applied` was taken off its invoice, the rest of `amount` became account credit. */
export type CreditNote = {
  uuid: string
  number: string
  invoice: { uuid: string; number: string }
  currency: string
  amount: number
  applied: number
  reason: string
  issued_at: string
}

/**
 * An invoice with its lines, each organization's usage and its credit notes. Issued
 * invoices carry the details they were issued with; drafts show today's.
 */
export type InvoiceDetail = InvoiceSummary & {
  /** Why it was drafted early; administrators only. */
  draft_note: string | null
  tax_rate_name: string | null
  tax_basis_points: number | null
  operator_details: { legal_name: string | null; address: string | null; tax_registration_number: string | null; invoice_footer: string | null } | null
  account_details: { name: string; contact_email: string | null; billing_address: string | null; tax_number: string | null }
  lines: InvoiceLine[]
  usage: { organization_uuid: string; organization_name: string; kind: "alerts" | "sms" | "data_points"; count: number }[]
  credit_notes: CreditNote[]
}

/** An account whose invoice for an ended month waits for final usage; `overdue` after three days. */
export type WaitingInvoice = {
  billing_account: { uuid: string; name: string }
  month: string
  waiting_since: string
  overdue: boolean
}

/**
 * The organization's telemetry retention as a manager sees it (spec 029 FR-024): its days,
 * where they come from, and a shorter period a billing change has pending from `from`.
 */
export type OrganizationRetention = {
  days: number
  source: "organization" | "billing_account" | "platform" | "default"
  pending_reduction: { days: number; from: string } | null
}
