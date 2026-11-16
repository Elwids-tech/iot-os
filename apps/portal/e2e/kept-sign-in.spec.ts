import { test, expect, type Page } from "@playwright/test"

/** Keep me signed in (spec 033, FR-011a), against a mocked API. */
const organization = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const acme = {
  uuid: organization,
  name: "Acme",
  slug: "acme",
  capabilities: { devices: { view: true, manage: true, command: true } },
}
const me = {
  id: 1,
  name: "Operator",
  email: "operator@example.test",
  email_verified_at: "2026-01-01",
  capabilities: { platform_administration: false },
  organizations: [acme],
}
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

async function setup(page: Page, { signedIn = false } = {}) {
  const errors: string[] = []
  const logins: unknown[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/auth/login") {
      logins.push(route.request().postDataJSON())
      signedIn = true
      return json({ data: me })
    }
    if (path === "/api/v1/me")
      return signedIn ? json({ data: me }) : json({ message: "Unauthenticated." }, 401)
    if (path.endsWith("/context")) return json({ data: acme })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: "2026-10-09T00:00:00Z" } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { errors, logins }
}

async function signIn(page: Page, keep: boolean) {
  await page.goto("/")
  const checkbox = page.getByRole("checkbox", { name: "Keep me signed in" })
  await expect(checkbox).not.toBeChecked()
  await expect(page.getByText("Don't tick this on a shared device.")).toBeVisible()
  await page.getByLabel("Email address").fill(me.email)
  await page.getByLabel("Password").fill("correct-horse")
  if (keep) await checkbox.check()
  await page.getByRole("button", { name: "Sign in" }).click()
}

test("the sign-in asks to stay signed in only when ticked", async ({ page }) => {
  const { errors, logins } = await setup(page)
  await signIn(page, false)
  await expect.poll(() => logins.length).toBe(1)
  expect(logins[0]).toEqual({ email: me.email, password: "correct-horse" })
  expect(errors).toEqual([])
})

test("a ticked sign-in sends remember", async ({ page }) => {
  const { errors, logins } = await setup(page)
  await signIn(page, true)
  await expect.poll(() => logins.length).toBe(1)
  expect(logins[0]).toEqual({ email: me.email, password: "correct-horse", remember: true })
  expect(errors).toEqual([])
})

test("restoring an expired session offers the same choice", async ({ page }) => {
  const { errors, logins } = await setup(page, { signedIn: true })
  await page.goto(`/organizations/${organization}/home`)
  await expect(page.locator('[data-slot="sidebar"]').first()).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("iot-session-expired")))
  const dialog = page.getByRole("dialog", { name: "Restore your session" })
  const checkbox = dialog.getByRole("checkbox", { name: "Keep me signed in" })
  await expect(checkbox).not.toBeChecked()
  await expect(dialog.getByText("Don't tick this on a shared device.")).toBeVisible()
  await dialog.getByLabel("Session password").fill("correct-horse")
  await checkbox.check()
  await dialog.getByRole("button", { name: "Restore session" }).click()
  await expect(dialog).toBeHidden()
  expect(logins).toEqual([{ email: me.email, password: "correct-horse", remember: true }])
  expect(errors).toEqual([])
})

test("the checkbox is a 44 px target on a 360 px phone", async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto("/")
  const checkbox = page.getByRole("checkbox", { name: "Keep me signed in" })
  await expect(checkbox).toBeVisible()
  // The box stays 16 px; its ::after hit area grows to 44 px below 768 px.
  const target = await checkbox.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const after = getComputedStyle(element, "::after")
    return {
      width: box.width - parseFloat(after.left) - parseFloat(after.right),
      height: box.height - parseFloat(after.top) - parseFloat(after.bottom),
    }
  })
  expect(target.width).toBeGreaterThanOrEqual(44)
  expect(target.height).toBeGreaterThanOrEqual(44)
  // A tap near the target's corner still ticks it.
  const box = (await checkbox.boundingBox())!
  await page.mouse.click(box.x + box.width / 2 - 21, box.y + box.height / 2 - 21)
  await expect(checkbox).toBeChecked()
})
