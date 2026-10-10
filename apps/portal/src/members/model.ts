import type {
  AdministrationCapabilities,
  Organization,
  TenantInvitation,
  TenantPermission,
  TenantRole,
} from "@iot-os/api-client"
import type { PermissionMatrixItem } from "@iot-os/ui/components/permission-matrix"

export const noAdministration: AdministrationCapabilities = {
  members_view: false,
  invite: false,
  members_update: false,
  members_remove: false,
  roles_view: false,
  roles_create: false,
  roles_update: false,
  roles_delete: false,
}

/** Older session payloads omit the flags; treat that as no access rather than guessing. */
export const administrationOf = (organization?: Organization): AdministrationCapabilities =>
  organization?.capabilities?.administration ?? noAdministration

export const NOT_GRANTABLE = "You can only grant permissions you hold yourself."
export const ROLE_NOT_ASSIGNABLE = "Includes permissions you don't hold."
export const ADMINISTRATOR_LOCKED =
  "Organization Admin always has every permission available to this organization."

/** Organization Admin first, then the other built-in roles, then custom roles by name. */
export function sortRoles(roles: TenantRole[]): TenantRole[] {
  const rank = (role: TenantRole) => (role.is_administrator ? 0 : role.is_default ? 1 : 2)
  return [...roles].sort(
    (left, right) => rank(left) - rank(right) || left.display_name.localeCompare(right.display_name),
  )
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

export function roleSummary(role: TenantRole): string {
  return role.is_administrator ? "Every available permission" : plural(role.permissions.length, "permission")
}

/**
 * Matrix rows for a role. Organization Admin and read-only viewers see every row locked;
 * otherwise only permissions the actor cannot grant are locked.
 */
export function matrixItems(
  permissions: TenantPermission[],
  { administrator = false, readOnly = false }: { administrator?: boolean; readOnly?: boolean } = {},
): PermissionMatrixItem[] {
  return permissions.map((permission) => ({
    name: permission.name,
    group: permission.group,
    lockedReason: administrator
      ? ADMINISTRATOR_LOCKED
      : readOnly
        ? "You can view this role but not change it."
        : permission.grantable === false
          ? NOT_GRANTABLE
          : null,
  }))
}

export function sameSelection(left: ReadonlySet<string> | readonly number[], right: ReadonlySet<string> | readonly number[]) {
  const a = new Set<string | number>(left)
  const b = new Set<string | number>(right)
  return a.size === b.size && [...a].every((value) => b.has(value))
}

/** Pending invitations expire seven days after they are sent. */
export function expiryLabel(invitation: Pick<TenantInvitation, "expires_at" | "status">, now = Date.now()): string {
  const days = Math.round((new Date(invitation.expires_at).getTime() - now) / 86_400_000)
  if (invitation.status === "expired" || days < 0) {
    const ago = Math.abs(days)
    return ago === 0 ? "Expired today" : `Expired ${plural(ago, "day")} ago`
  }
  return days === 0 ? "Expires today" : `Expires in ${plural(days, "day")}`
}

/** Removing your own Organization Admin role takes away this page; say so before saving. */
export function losesOwnAdministration(
  isCurrentUser: boolean,
  roles: TenantRole[],
  current: readonly number[],
  next: readonly number[],
): boolean {
  if (!isCurrentUser) return false
  const administrator = roles.find((role) => role.is_administrator)
  return Boolean(administrator && current.includes(administrator.id) && !next.includes(administrator.id))
}
