import type { AllowanceKind, OwnedBillingAccount, PriceKind } from "@iot-os/api-client"

/** The billing accounts the signed-in person owns (spec 023). */
export const billingAccountsKey = ["billing-accounts"] as const

export const billingPath = (accountUuid?: string) =>
  accountUuid ? `/billing?account=${encodeURIComponent(accountUuid)}` : "/billing"

type Counted = Pick<OwnedBillingAccount, "organizations_count" | "organization_limit">

/**
 * Owners cannot add organizations at or above the limit; a platform administrator still
 * can. A null limit is unlimited.
 */
export const atLimit = (account: Counted) =>
  account.organization_limit !== null && account.organizations_count >= account.organization_limit

/** "2 of 10 organizations", or "3 organizations, limit 1" once a platform administrator went past it. */
export function organizationsOfLimit({ organizations_count: count, organization_limit: limit }: Counted) {
  if (limit === null) {
    return `${count} ${count === 1 ? "organization" : "organizations"}, no limit`
  }
  return count > limit
    ? `${count} ${count === 1 ? "organization" : "organizations"}, limit ${limit}`
    : `${count} of ${limit} ${limit === 1 ? "organization" : "organizations"}`
}

/** Allowance labels on the Plan panel, in the API's order (ADR-035). */
export const allowanceLabels: Record<AllowanceKind, string> = {
  alerts: "Alerts per month",
  sms: "SMS per month",
  devices: "Active devices",
  data_points: "Data points per month",
  retention_days: "Telemetry retention",
  organizations: "Organizations",
}

/** An allowance as text: a number, "Unlimited", or for retention days, the platform's when the plan sets none. */
export function allowanceValue(kind: AllowanceKind, value: number | null, platformRetentionDays?: number): string {
  const days = (count: number) => `${count.toLocaleString()} ${count === 1 ? "day" : "days"}`
  if (value === null && kind !== "retention_days") return "Unlimited"
  if (value === null) return platformRetentionDays === undefined ? "Platform setting" : `${days(platformRetentionDays)} (platform setting)`
  return kind === "retention_days" ? days(value) : value.toLocaleString()
}

/** An owned account's issued invoices and credit notes (spec 029 FR-036). */
export const ownedInvoicesKey = (accountUuid: string) => ["billing-accounts", accountUuid, "invoices"] as const

/** Price labels on the Plan panel (spec 029 FR-030); owners see only their own account's. */
export const priceLabels: Record<PriceKind, string> = {
  base_price: "Base price per month",
  alert_overage_price: "Per alert over the allowance",
  data_point_overage_price: "Per block of data points over the allowance",
}
