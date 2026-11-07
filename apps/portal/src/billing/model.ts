import type { OwnedBillingAccount } from "@iot-os/api-client"

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
