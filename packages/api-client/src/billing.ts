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

/** The monthly allowances counted: alerts, SMS and data points (stored readings). */
export type UsageKind = "alerts" | "sms" | "data_points"

/**
 * A billing account's usage of one allowance in one UTC month. `allowance` is the
 * account's allowance now (null when unlimited) and `left` follows from it, 0 once used
 * up. `overage` was fixed as each unit was counted. `organizations` is each
 * organization's share, deleted and moved-away ones included under the name they had.
 *
 * `data_points` come from the runtime's reports and alone carry `final` (the whole month
 * is reported), `reported_at` and `stale` (an open month not reported for a while): show
 * "Provisional" or "Last reported …" instead of presenting the count as current.
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
  plan: { uuid: string; name: string } | null
  allowances: Allowance[]
  /** This month's usage, with each organization's share. */
  usage: Usage[]
}

/** The organization an owner just created; reload the session for its capabilities. */
export type OwnerOrganization = {
  uuid: string
  name: string
  slug: string
}
