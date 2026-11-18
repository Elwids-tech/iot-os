import { expect, test, type Page } from "@playwright/test"

// Lock-out reset in the admin app (spec 034, US4), against a mocked API.

const admin = {
  id: 1,
  name: "Platform Staff",
  email: "platform-staff@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: false,
  capabilities: { platform_administration: true, manage_organizations: true, reset_two_step: true },
  organizations: [],
}

const organization = { uuid: "0199a8f0-0000-7000-8000-000000000001", name: "Acme Manufacturing", slug: "acme-manufacturing" }

function person(id: number, name: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    email,
    is_super_admin: false,
    two_step_enabled: false,
    passkey_count: 0,
    platform_roles: [],
    organizations: [organization],
    ...extra,
  }
}

async function mockApi(page: Page, capabilities: Record<string, boolean> = admin.capabilities) {
  const users = [
    person(1, admin.name, admin.email, { two_step_enabled: true, platform_roles: [{ key: "platform-administrator", display_name: "Platform Administrator" }], organizations: [] }),
    person(2, "Member Person", "member@example.test", { two_step_enabled: true, passkey_count: 2 }),
    person(3, "Super Person", "super@example.test", { is_super_admin: true, organizations: [] }),
  ]
  const resets: { id: number; reason: unknown }[] = []
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (path === "/api/v1/me") return json({ data: { ...admin, capabilities } })
    if (path === "/api/v1/admin/tickets/summary") return json({ data: { awaiting_team: 0 } })
    if (path === "/api/v1/admin/users" && request.method() === "GET") {
      return json({ data: users, links: {}, meta: { current_page: 1, last_page: 1, per_page: 25, total: users.length } })
    }
    const reset = path.match(/^\/api\/v1\/admin\/users\/(\d+)\/two-step\/reset$/)
    if (reset && request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      const target = users.find((user) => user.id === Number(reset[1]))!
      resets.push({ id: target.id, reason: body.reason })
      target.two_step_enabled = false
      target.passkey_count = 0
      return route.fulfill({ status: 204 })
    }
    if (path === "/api/v1/admin/organizations") {
      return json({ data: [organization], links: {}, meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } })
    }
    return json({ data: [], links: {}, meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } })
  })
  return resets
}

function row(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name })
}

test("an administrator resets a member's two-step with a reason", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const resets = await mockApi(page)
  await page.goto("/users")

  const member = row(page, "Member Person")
  await expect(member).toContainText("On")
  await expect(member).toContainText("2")

  await page.getByRole("button", { name: "Actions for Member Person" }).click()
  await page.getByRole("menuitem", { name: "Reset two-step" }).click()
  const dialog = page.getByRole("dialog", { name: "Reset two-step sign-in for Member Person?" })
  await expect(dialog).toContainText("2 passkeys")

  // The reason is required.
  await dialog.getByRole("button", { name: "Reset two-step" }).click()
  await expect(dialog.getByText("Give a reason, such as how you checked who they are.")).toBeVisible()
  expect(resets).toEqual([])

  await dialog.getByRole("textbox", { name: "Reason" }).fill("Identity checked by a video call")
  await expect(dialog.getByText("Give a reason, such as how you checked who they are.")).toBeHidden()
  await expect(dialog.getByRole("textbox", { name: "Reason" })).toHaveAttribute("maxlength", "500")
  await dialog.getByRole("button", { name: "Reset two-step" }).click()

  await expect(page.getByText("Two-step sign-in reset for Member Person")).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(resets).toEqual([{ id: 2, reason: "Identity checked by a video call" }])
  await expect(member).toContainText("Not set up")
  await expect(member).toContainText("None")
  expect(errors).toEqual([])
})

test("the action is absent on your own row and on a super administrator's", async ({ page }) => {
  await mockApi(page)
  await page.goto("/users")

  await expect(row(page, "Member Person")).toBeVisible()
  // Your own row has no other action either, so it has no menu at all.
  await expect(page.getByRole("button", { name: `Actions for ${admin.name}` })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Actions for Super Person" })).toHaveCount(0)
})

test("without the permission there is no reset", async ({ page }) => {
  await mockApi(page, { platform_administration: true, manage_organizations: true, reset_two_step: false })
  await page.goto("/users")

  await page.getByRole("button", { name: "Actions for Member Person" }).click()
  await expect(page.getByRole("menuitem", { name: "Change roles" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Reset two-step" })).toHaveCount(0)
})
