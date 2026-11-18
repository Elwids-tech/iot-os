import { expect, test, type Page } from "@playwright/test"
import { Secret, TOTP } from "otpauth"

// Two-step sign-in in the admin app (spec 034, US1), against a mocked API.

const admin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const secret = new Secret({ size: 20 })
const totp = new TOTP({ secret, digits: 6, period: 30 })

async function mockApi(page: Page) {
  const state = { signedIn: false, pending: false, attempts: 0, logins: [] as unknown[] }
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (path === "/api/v1/auth/login") {
      state.logins.push(body)
      state.pending = true
      return json({ two_step_required: true, expires_in: 300, methods: ["code", "recovery_code"] }, 202)
    }
    if (path === "/api/v1/auth/two-step") {
      if (!state.pending) return json({ message: "Start again.", errors: { pending: ["Start again with your password."] } }, 422)
      if (totp.validate({ token: String(body.code ?? ""), window: 1 }) === null) {
        state.attempts += 1
        return json({ message: "That code is not valid.", errors: { code: ["That code is not valid."] }, attempts_left: 5 - state.attempts }, 422)
      }
      state.pending = false
      state.signedIn = true
      return json({ data: admin })
    }
    if (!state.signedIn) return json({ message: "Unauthenticated." }, 401)
    if (path === "/api/v1/me") return json({ data: admin })
    if (path === "/api/v1/admin/tickets/summary") return json({ data: { awaiting_team: 0 } })
    return json({ data: [], links: {}, meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 } })
  })
  return state
}

test("a person with two-step on signs in to the admin app with a code", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const state = await mockApi(page)
  await page.goto("/")

  await page.getByRole("textbox", { name: "Email" }).fill(admin.email)
  await page.getByRole("textbox", { name: "Password" }).fill("password")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible()
  expect(state.signedIn).toBe(false)

  const right = totp.generate()
  await page.getByLabel("Code from your authenticator app").fill(right === "000000" ? "111111" : "000000")
  await expect(page.getByText("That code is not valid. 4 tries left.")).toBeVisible()

  await page.getByLabel("Code from your authenticator app").fill(right)
  await expect(page).toHaveURL(/\/organizations$/)

  // The person's own security settings are a portal page.
  await page.getByRole("button", { name: admin.name }).click()
  await expect(page.getByRole("menuitem", { name: "Security settings" })).toHaveAttribute("href", /\/account\/security$/)
  expect(errors).toEqual([])
})

test("Back to password keeps the email and clears the password", async ({ page }) => {
  await mockApi(page)
  await page.goto("/")
  await page.getByRole("textbox", { name: "Email" }).fill(admin.email)
  await page.getByRole("textbox", { name: "Password" }).fill("password")
  await page.getByRole("button", { name: "Sign in" }).click()

  await page.getByRole("button", { name: "Back to password" }).click()
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(admin.email)
  await expect(page.getByRole("textbox", { name: "Password" })).toHaveValue("")
})

test("the six code boxes fit a 320 px phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await mockApi(page)
  await page.goto("/")
  await page.getByRole("textbox", { name: "Email" }).fill(admin.email)
  await page.getByRole("textbox", { name: "Password" }).fill("password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible()

  const card = await page.locator("[data-slot=card]").boundingBox()
  const last = await page.locator("[data-slot=input-otp-slot]").last().boundingBox()
  expect(last!.x + last!.width).toBeLessThanOrEqual(card!.x + card!.width)
  expect(last!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("a person who must set up two-step is sent to the portal's setup page, which returns here", async ({ page }) => {
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/me") return route.fulfill({ status: 200, json: { data: admin } })
    return route.fulfill({ status: 403, json: { code: "two_step_setup_required", message: "Set up two-step sign-in to continue." } })
  })
  // The portal's page itself is not under test here.
  await page.route("**/account/security/setup**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Portal setup</h1>" }))

  await page.goto("/organizations")

  await expect(page.getByRole("heading", { name: "Portal setup" })).toBeVisible()
  const url = new URL(page.url())
  expect(url.pathname).toBe("/account/security/setup")
  expect(new URL(url.searchParams.get("return")!).pathname).toBe("/organizations")
})
