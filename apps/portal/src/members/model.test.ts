import { describe, expect, it } from "vitest"
import type { Organization, TenantRole } from "@iot-os/api-client"
import {
  ADMINISTRATOR_LOCKED,
  NOT_GRANTABLE,
  administrationOf,
  expiryLabel,
  losesOwnAdministration,
  matrixItems,
  noAdministration,
  roleSummary,
  sameSelection,
  sortRoles,
} from "./model"

const role = (overrides: Partial<TenantRole>): TenantRole => ({
  id: 1,
  key: "custom",
  display_name: "Custom",
  is_default: false,
  is_administrator: false,
  permissions: [],
  ...overrides,
})

describe("organization administration model", () => {
  it("treats a payload without administration flags as no access", () => {
    expect(administrationOf(undefined)).toEqual(noAdministration)
    expect(administrationOf({ uuid: "o", name: "O", slug: "o", capabilities: { manage_administration: true } } as Organization)).toEqual(noAdministration)
  })

  it("orders Organization Admin, then built-in roles, then custom roles by name", () => {
    const sorted = sortRoles([
      role({ id: 4, display_name: "Zeta" }),
      role({ id: 2, display_name: "Member", is_default: true }),
      role({ id: 3, display_name: "Alpha" }),
      role({ id: 1, display_name: "Organization Admin", is_default: true, is_administrator: true }),
    ])
    expect(sorted.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it("summarises roles without counting the administrator bundle", () => {
    expect(roleSummary(role({ is_administrator: true }))).toBe("Every available permission")
    expect(roleSummary(role({ permissions: [{ name: "Device.view", group: "Device" }] }))).toBe("1 permission")
  })

  it("locks permissions the actor cannot grant, and everything on Organization Admin", () => {
    const permissions = [
      { name: "Device.view", group: "Device", grantable: true },
      { name: "Device.manage", group: "Device", grantable: false },
    ]
    expect(matrixItems(permissions).map((item) => item.lockedReason)).toEqual([null, NOT_GRANTABLE])
    expect(matrixItems(permissions, { administrator: true }).every((item) => item.lockedReason === ADMINISTRATOR_LOCKED)).toBe(true)
    expect(matrixItems(permissions, { readOnly: true }).every((item) => item.lockedReason)).toBe(true)
  })

  it("compares selections regardless of order", () => {
    expect(sameSelection([1, 2], [2, 1])).toBe(true)
    expect(sameSelection(new Set(["a"]), new Set(["a", "b"]))).toBe(false)
  })

  it("describes invitation expiry in days", () => {
    const now = Date.parse("2026-10-10T12:00:00Z")
    expect(expiryLabel({ expires_at: "2026-10-13T12:00:00Z", status: "pending" }, now)).toBe("Expires in 3 days")
    expect(expiryLabel({ expires_at: "2026-10-10T15:00:00Z", status: "pending" }, now)).toBe("Expires today")
    expect(expiryLabel({ expires_at: "2026-10-09T12:00:00Z", status: "expired" }, now)).toBe("Expired 1 day ago")
  })

  it("warns only when you remove your own Organization Admin role", () => {
    const roles = [role({ id: 1, is_administrator: true }), role({ id: 2 })]
    expect(losesOwnAdministration(true, roles, [1], [2])).toBe(true)
    expect(losesOwnAdministration(true, roles, [1, 2], [1])).toBe(false)
    expect(losesOwnAdministration(false, roles, [1], [2])).toBe(false)
  })
})
