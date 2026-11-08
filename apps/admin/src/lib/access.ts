import type { AuthenticatedUser } from "@iot-os/api-client"

/**
 * Pages whose API needs `PlatformAdministration.manage-organizations`: organizations,
 * users, roles, activity and every billing page (spec 028 US1/AC6). A platform
 * administrator without it gets neither their navigation entries nor their routes.
 */
export const organizationPaths = [
  "/organizations",
  "/billing-accounts",
  "/plans",
  "/billing/invoices",
  "/users",
  "/roles",
  "/activity",
  "/settings/billing",
]

/** Where the admin app opens: the first page the person may use, or null when there is none. */
export function homePath(user: AuthenticatedUser): string | null {
  if (user.capabilities.manage_organizations) return "/organizations"
  if (user.capabilities.manage_retention) return "/settings/retention"
  if (user.capabilities.manage_assistant) return "/settings/assistant"
  return null
}
