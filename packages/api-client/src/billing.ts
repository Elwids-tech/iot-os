/** Billing accounts (spec 023, ADR-026): the payer of record for one or more organizations. */

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
  organization_limit: number
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
  organization_limit: number
  organizations_count: number
  created_at: string | null
  owners: BillingAccountOwner[]
  organizations: BillingAccountOrganization[]
  history: BillingAccountHistoryEntry[]
}

export type BillingAccountValues = {
  name: string
  contact_email?: string | null
  notes?: string | null
  /** From 0 to 1000; owners cannot create organizations at or above it. */
  organization_limit?: number
}

/** A billing account as its owner sees it in the portal. */
export type OwnedBillingAccount = {
  uuid: string
  name: string
  organization_limit: number
  organizations_count: number
  organizations: { uuid: string; name: string; created_at: string | null; member: boolean }[]
}

/** The organization an owner just created; reload the session for its capabilities. */
export type OwnerOrganization = {
  uuid: string
  name: string
  slug: string
}
