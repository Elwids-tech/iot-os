import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const everything = {
  members_view: true,
  invite: true,
  members_update: true,
  members_remove: true,
  roles_view: true,
  roles_create: true,
  roles_update: true,
  roles_delete: true,
}
const nothing = Object.fromEntries(Object.keys(everything).map((key) => [key, false]))

const catalogue = [
  { name: "Device.view", group: "Device", grantable: true },
  { name: "Device.manage", group: "Device", grantable: false },
  { name: "User.view-any", group: "User", grantable: true },
  { name: "User.create", group: "User", grantable: true },
]
const permission = (name: string) => ({ name, group: name.split(".")[0] })

async function setup(page: Page, administration: Record<string, boolean> = everything) {
  const state = {
    roles: [
      { id: 1, key: "organization-admin", display_name: "Organization Admin", is_default: true, is_administrator: true, members_count: 1, assignable: false, manageable: false, permissions: catalogue.map((item) => permission(item.name)) },
      { id: 2, key: "member", display_name: "Member", is_default: true, is_administrator: false, members_count: 2, assignable: true, manageable: true, permissions: [permission("Device.view")] },
      { id: 3, key: "custom-operators", display_name: "Operators", is_default: false, is_administrator: false, members_count: 0, assignable: true, manageable: true, permissions: [permission("Device.view"), permission("User.view-any")] },
    ] as any[],
    members: [
      { id: 10, name: "People Lead", email: "lead@example.test", is_current_user: true, manageable: true, roles: [{ id: 3, key: "custom-operators", display_name: "Operators", is_default: false }] },
      { id: 11, name: "Owner Person", email: "owner@example.test", is_current_user: false, manageable: false, roles: [{ id: 1, key: "organization-admin", display_name: "Organization Admin", is_default: true }] },
      { id: 12, name: "Member Person", email: "member@example.test", is_current_user: false, manageable: true, roles: [{ id: 2, key: "member", display_name: "Member", is_default: true }] },
    ] as any[],
    invitations: [] as any[],
    resent: 0,
  }
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = method === "GET" || method === "DELETE" ? null : request.postDataJSON()
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) => ({ data, meta: { current_page: 1, last_page: 1, per_page: 25, from: 1, to: data.length, total: data.length } })
    const organization = {
      uuid: org,
      name: "Acme",
      slug: "acme",
      capabilities: { manage_administration: true, administration, devices: { view: true, manage: true, command: false } },
    }
    const prefix = `/api/v1/organizations/${org}`

    if (path === "/api/v1/me")
      return reply({ data: { id: 10, name: "People Lead", email: "lead@example.test", email_verified_at: "2026-01-01", capabilities: { platform_administration: false }, organizations: [organization] } })
    if (path === `${prefix}/context`) return reply({ data: organization })
    if (path === `${prefix}/members` && method === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      return reply(page1(state.members.filter((member) => !search || `${member.name} ${member.email}`.toLowerCase().includes(search))))
    }
    const member = path.match(new RegExp(`^${prefix}/members/(\\d+)$`))
    if (member) {
      const id = Number(member[1])
      if (method === "DELETE") {
        state.members = state.members.filter((item) => item.id !== id)
        return route.fulfill({ status: 204 })
      }
      const target = state.members.find((item) => item.id === id)
      target.roles = state.roles.filter((role) => body.role_ids.includes(role.id)).map(({ id, key, display_name, is_default }) => ({ id, key, display_name, is_default }))
      return reply({ data: target })
    }
    if (path === `${prefix}/roles` && method === "GET") return reply({ data: state.roles })
    if (path === `${prefix}/roles` && method === "POST") {
      const role = { id: 4, key: "custom-new", display_name: body.display_name, is_default: false, is_administrator: false, members_count: 0, assignable: true, manageable: true, permissions: body.permission_names.map(permission) }
      state.roles.push(role)
      return reply({ data: role }, 201)
    }
    const role = path.match(new RegExp(`^${prefix}/roles/(\\d+)$`))
    if (role && method === "DELETE") {
      state.roles = state.roles.filter((item) => item.id !== Number(role[1]))
      return route.fulfill({ status: 204 })
    }
    if (path === `${prefix}/role-permissions`) return reply({ data: catalogue })
    if (path === `${prefix}/invitations` && method === "GET")
      return reply(page1(state.invitations.filter((invitation) => invitation.status === (url.searchParams.get("status") ?? "pending"))))
    if (path === `${prefix}/invitations` && method === "POST") {
      const invitation = {
        uuid: "08b842d4-dbe9-44b7-a82f-8409bf314099",
        email: body.email.toLowerCase(),
        role_ids: body.role_ids,
        roles: state.roles.filter((role) => body.role_ids.includes(role.id)).map(({ id, display_name }) => ({ id, display_name })),
        invited_by: { id: 10, name: "People Lead" },
        manageable: true,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        accepted_at: null,
        revoked_at: null,
        status: "pending",
      }
      state.invitations.push(invitation)
      return reply({ data: invitation }, 201)
    }
    if (path.endsWith("/resend")) {
      state.resent += 1
      return reply({ data: state.invitations[0] })
    }
    if (path.startsWith(`${prefix}/invitations/`) && method === "DELETE") {
      state.invitations = []
      return route.fulfill({ status: 204 })
    }
    return reply({ data: [] })
  })
  return { state, errors }
}

test("administrators invite people, send the link again and revoke it", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto(`${base}/members`)
  await expect(page.getByRole("link", { name: "Members" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Roles" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible()

  await page.getByRole("button", { name: "Invite people" }).click()
  const sheet = page.getByRole("dialog", { name: "Invite people" })
  await expect(sheet.getByRole("checkbox", { name: /Organization Admin/ })).toBeDisabled()
  await expect(sheet.getByText("Includes permissions you don't hold.")).toBeVisible()
  await sheet.getByLabel("Email address").fill("New.Person@example.test")
  await sheet.getByRole("checkbox", { name: /^Member/ }).check()
  await sheet.getByRole("button", { name: "Send invitation" }).click()

  await expect(page.getByText("Invitation sent to new.person@example.test")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Invitations" })).toHaveAttribute("aria-selected", "true")
  const row = page.getByRole("row", { name: /new\.person@example\.test/ })
  await expect(row).toContainText("Member")
  await expect(row).toContainText("People Lead")
  // The confirmation toast is still fading in, which axe reads as low contrast.
  expect((await new AxeBuilder({ page }).exclude("[data-sonner-toaster]").analyze()).violations).toEqual([])

  await page.getByRole("button", { name: "Actions for new.person@example.test" }).click()
  await page.getByRole("menuitem", { name: "Send again" }).click()
  await expect(page.getByText("A new link was sent to new.person@example.test")).toBeVisible()
  expect(state.resent).toBe(1)

  await page.getByRole("button", { name: "Actions for new.person@example.test" }).click()
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke invitation" }).click()
  await expect(page.getByText("No open invitations")).toBeVisible()
  expect(errors).toEqual([])
})

test("members with more access are protected; others can change roles or be removed", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto(`${base}/members`)

  await page.getByRole("button", { name: "Actions for Owner Person" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toHaveAttribute("data-disabled", "")
  await expect(page.getByText("This member has access you don't hold")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Actions for People Lead" }).click()
  await expect(page.getByRole("menuitem", { name: "Remove from organization" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Actions for Member Person" }).click()
  await page.getByRole("menuitem", { name: "Change roles" }).click()
  const sheet = page.getByRole("dialog", { name: "Change roles for Member Person" })
  await sheet.getByRole("checkbox", { name: /^Operators/ }).check()
  await sheet.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Roles updated for Member Person")).toBeVisible()
  await expect(page.getByRole("row", { name: /Member Person/ })).toContainText("Operators")

  await page.getByRole("button", { name: "Actions for Member Person" }).click()
  await page.getByRole("menuitem", { name: "Remove from organization" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove member" }).click()
  await expect(page.getByRole("row", { name: /Member Person/ })).toHaveCount(0)
  expect(state.members.map((item) => item.id)).toEqual([10, 11])

  await page.getByLabel("Search members").fill("owner")
  await expect(page.getByRole("row", { name: /Owner Person/ })).toBeVisible()
  await expect(page.getByRole("row", { name: /People Lead/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("the role editor locks permissions you cannot grant and keeps Organization Admin read-only", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto(`${base}/roles`)
  await expect(page.getByRole("row", { name: /Organization Admin/ })).toContainText("Every available permission")

  await page.getByRole("link", { name: "New role" }).click()
  await page.getByLabel("Role name").fill("Viewers")
  await expect(page.getByRole("checkbox", { name: "Manage devices" })).toBeDisabled()
  await page.getByRole("checkbox", { name: "View devices" }).check()
  await page.getByRole("button", { name: "Create role" }).click()
  await expect(page.getByText("Viewers created")).toBeVisible()
  await expect(page).toHaveURL(`${base}/settings/roles`)
  expect(state.roles.at(-1).permissions).toEqual([permission("Device.view")])

  await page.getByRole("link", { name: "Viewers" }).click()
  await page.getByRole("button", { name: "Delete role" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete role" }).click()
  await expect(page).toHaveURL(`${base}/settings/roles`)
  await expect(page.getByText("Viewers deleted")).toBeVisible()
  await expect(page.getByRole("link", { name: "Viewers" })).toHaveCount(0)

  await page.getByRole("link", { name: "Organization Admin" }).click()
  await expect(page.getByText("Permissions follow the organization")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "View devices" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
  // The "deleted" toast may still be fading out, which axe reads as low contrast.
  expect((await new AxeBuilder({ page }).exclude("[data-sonner-toaster]").analyze()).violations).toEqual([])
  expect(errors).toEqual([])
})

test("members and roles stay hidden without administration access", async ({ page }) => {
  const { errors } = await setup(page, nothing)
  await page.goto(`${base}/dashboards`)
  await expect(page.getByRole("link", { name: "Devices" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Members" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Roles" })).toHaveCount(0)
  await page.goto(`${base}/members`)
  await expect(page.getByText("Members unavailable")).toBeVisible()
  expect(errors).toEqual([])
})
