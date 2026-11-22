import { readFileSync } from "node:fs"
import { test, expect, type Page } from "@playwright/test"

/**
 * The portal on a billing account's address (spec 036 US1 and US4, quickstart 6 and 7),
 * against a mocked API. The address is `acme.localhost`, which browsers resolve to this
 * machine; its `runtime-config.js` is the fixture the unit tests read, with the API on
 * the page's own origin as a development stack serves it.
 */
const base = new URL(process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173")
const address = `http://acme.localhost:${base.port}`
const fixture = JSON.parse(
  readFileSync(new URL("../src/lib/__fixtures__/runtime-config.branded.js", import.meta.url), "utf8").replace("window.__IOT_CONFIG__ = ", "").replace(/;\s*$/, ""),
)
const now = new Date().toISOString()
const a1 = { uuid: "a0000000-0000-4000-8000-000000000001", name: "A One", slug: "a-one", logo: null, logo_dark: null, brand: { product_name: "Acme Monitor", logo: null, logo_dark: null }, capabilities: { devices: { view: true, manage: false, command: false } } }
const b1 = "b0000000-0000-4000-8000-000000000001"
const people: Record<string, { name: string; here: boolean }> = {
  "ann@example.test": { name: "Ann Member", here: true },
  "cy@example.test": { name: "Cy Both", here: true },
  "bo@example.test": { name: "Bo Elsewhere", here: false },
}
const notHere = { code: "not_available_here", message: "This account cannot sign in at this address." }

async function open(page: Page, config: object = { ...fixture, VITE_API_URL: "", brand: { ...fixture.brand, logo: null, icon: null, touch_icon: null } }) {
  const errors: string[] = []
  const state = { user: null as string | null, refuse: false, elsewhere: 0 }
  page.on("pageerror", (error) => errors.push(error.message))
  // Every title the tab ever had, from before the first script.
  await page.addInitScript(() => {
    const titles: string[] = []
    Object.assign(window, { __titles: titles })
    new MutationObserver(() => {
      if (document.title && titles.at(-1) !== document.title) titles.push(document.title)
    }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  await page.route("**/runtime-config.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.__IOT_CONFIG__ = ${JSON.stringify(config)};` }),
  )
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const me = () => ({
      data: { id: 7, name: people[state.user!].name, email: state.user, email_verified_at: now, is_super_admin: false, capabilities: { platform_administration: false }, organizations: [a1], address: { kind: "name", host: "acme.localhost" }, push_devices_elsewhere: state.elsewhere },
    })
    if (path === "/api/v1/me") return state.refuse ? json(notHere, 403) : state.user ? json(me()) : json({ message: "Unauthenticated." }, 401)
    if (path === "/api/v1/auth/login") {
      const body = request.postDataJSON() as { email: string; password: string }
      const person = people[body.email]
      if (!person || body.password !== "password") return json({ message: "These credentials do not match our records.", errors: { email: ["These credentials do not match our records."] } }, 422)
      if (!person.here) return json(notHere, 403)
      state.user = body.email
      return json(me())
    }
    if (path.startsWith("/api/v1/auth/passkeys")) return json({ message: "Not Found" }, 404)
    if (state.refuse) return json(notHere, 403)
    if (path === "/api/v1/notifications/push")
      return json({ data: { available: true, public_key: "BElmLWtleS1mb3ItdGVzdHMtb25seS1ub3QtcmVhbC1wMjU2LXBvaW50LWJ5dGVzLTAwMDAwMDAwMDAwMDAwMDAwMDAwMDA", enabled: true, levels: null, revision: 0, muted_organizations: [], devices: [] } })
    if (path.endsWith("/context")) return json({ data: a1 })
    if (path.endsWith("/sites")) return json({ data: [], organization_timezone: null })
    if (path.endsWith("/overview"))
      return json({ data: { devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 }, alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] }, automations: { applied: 0 }, discovery: { pending: 0 }, commands: { uncertain: 0, recent: [] } } })
    if (path.endsWith("/runtime-status")) return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: now } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { errors, state }
}

const signIn = async (page: Page, email: string, password = "password") => {
  await page.getByRole("textbox", { name: "Email address" }).fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("the sign-in page carries the account's brand from the first paint", async ({ page }) => {
  const { errors } = await open(page)
  await page.goto(`${address}/`)

  await expect(page.getByRole("heading", { name: "Sign in to Acme Monitor" })).toBeVisible()
  await expect(page).toHaveTitle("Acme Monitor")
  expect(await page.evaluate(() => (window as unknown as { __titles: string[] }).__titles)).toEqual(["Acme Monitor"])
  await expect(page.locator("[data-slot=brand-mark]").first()).toContainText("Acme Monitor")

  // The platform is named once, in the Powered by line; the support link is the account's.
  const footer = page.locator("[data-slot=sign-in-footer]")
  await expect(footer).toContainText("Powered by IoT OS")
  await expect(footer.getByRole("link", { name: "Help" })).toHaveAttribute("href", "https://support.example.org/help")
  const text = await page.locator("body").innerText()
  expect(text.replace("Powered by IoT OS", "")).not.toContain("IoT OS")
  // The installed app is the address's own (its manifest is answered per host); nothing offers signing up.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest")
  await expect(page.getByRole("link", { name: /start free|sign up|create an account/i })).toHaveCount(0)

  // The other pages before sign-in carry it too.
  await page.getByRole("link", { name: "Forgot password?" }).click()
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible()
  await expect(page.locator("[data-slot=brand-mark]").first()).toContainText("Acme Monitor")
  await expect(page.locator("[data-slot=sign-in-footer]")).toContainText("Powered by IoT OS")
  expect(errors).toEqual([])
})

test("the Powered by line is gone when the plan removes it, and the logo replaces the name", async ({ page }) => {
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  const { errors } = await open(page, { ...fixture, VITE_API_URL: "", brand: { ...fixture.brand, logo: pixel, icon: pixel, touch_icon: pixel, support_url: null, powered_by: null } })
  await page.goto(`${address}/`)

  await expect(page.getByRole("img", { name: "Acme Monitor" })).toHaveAttribute("src", pixel)
  await expect(page.locator("[data-slot=sign-in-footer]")).toHaveCount(0)
  expect(await page.locator("body").innerText()).not.toContain("IoT OS")
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", pixel)
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", pixel)
  expect(errors).toEqual([])
})

test("a member signs in, and a link to another account's organization says it is not here", async ({ page }) => {
  const { errors } = await open(page)
  await page.goto(`${address}/`)
  await signIn(page, "cy@example.test")

  await expect(page.getByRole("heading", { name: "A One" }).or(page.getByText("A One").first())).toBeVisible()
  await expect(page).toHaveTitle(/Acme Monitor$/)

  await page.goto(`${address}/organizations/${b1}/devices`)
  await expect(page.getByRole("heading", { name: "Not available at this address" })).toBeVisible()
  await expect(page.getByText("This organization cannot be opened at this address.")).toBeVisible()
  await expect(page.getByRole("link", { name: /A One/ })).toBeVisible()
  expect(await page.locator("body").innerText()).not.toContain("IoT OS")
  expect(errors).toEqual([])
})

test("someone with push on at another address is told once that alerts must be turned on here", async ({ page }) => {
  const { errors, state } = await open(page)
  state.elsewhere = 2
  // A headless browser refuses notifications; a person's has not been asked yet.
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }))
  await page.goto(`${address}/`)
  await signIn(page, "cy@example.test")

  const notice = page.getByRole("listitem").filter({ hasText: "Alerts are not on at this address" })
  await expect(notice).toBeVisible()
  await expect(notice).toContainText("Push alerts you turned on at another address do not arrive here.")
  await expect(notice.getByRole("button", { name: "Turn on alerts" })).toBeVisible()

  // Once per browser at this address: the next start says nothing.
  await page.reload()
  await expect(page.getByText("A One").first()).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByText("Alerts are not on at this address")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("a person outside the account is told so only after a right password", async ({ page }) => {
  const { errors } = await open(page)
  await page.goto(`${address}/`)

  await signIn(page, "bo@example.test", "wrong-password")
  await expect(page.getByText("These credentials do not match our records.")).toBeVisible()
  await expect(page.getByText("This account cannot sign in at this address.")).toHaveCount(0)

  await signIn(page, "bo@example.test")
  await expect(page.getByText("This account cannot sign in at this address.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sign in to Acme Monitor" })).toBeVisible()
  expect(errors).toEqual([])
})

test("losing the last organization there returns the person to the sign-in page", async ({ page }) => {
  const { errors, state } = await open(page)
  await page.goto(`${address}/`)
  await signIn(page, "ann@example.test")
  await expect(page.getByText("A One").first()).toBeVisible()

  state.refuse = true
  // The next request is refused. A background poll can get there before the click and
  // take the page, link and all, to the sign-in page; either way ends there.
  await page.getByRole("link", { name: "Devices" }).first().click({ timeout: 5000 }).catch(() => undefined)
  await expect(page.getByRole("heading", { name: "Sign in to Acme Monitor" })).toBeVisible()
  await expect(page.getByText("This account cannot sign in at this address. Sign in with an account that belongs here.")).toBeVisible()
  expect(errors).toEqual([])
})

test("an address that is not in use says so and starts nothing", async ({ page }) => {
  const { errors } = await open(page, { VITE_API_URL: "", address: { state: "not_in_use" }, sign_up: false })
  const calls: string[] = []
  page.on("request", (request) => request.url().includes("/api/") && calls.push(request.url()))
  await page.goto(`${address}/devices`)

  await expect(page.getByText("This address is not in use.")).toBeVisible()
  await expect(page).toHaveTitle("This address is not in use")
  await expect(page.getByRole("textbox")).toHaveCount(0)
  expect(calls).toEqual([])
  expect(await page.locator("body").innerText()).not.toContain("IoT OS")
  expect(errors).toEqual([])
})

test("the platform's own address looks as it did", async ({ page }) => {
  const { errors } = await open(page, { VITE_API_URL: "", environment: "local" })
  // The build's API is another origin; this spec only needs the page before sign-in.
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Unauthenticated." }) }))
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
  await expect(page).toHaveTitle("IoT OS")
  await expect(page.locator("[data-slot=sign-in-footer]")).toHaveCount(0)
  await expect(page.locator("[data-slot=brand-mark]")).toHaveCount(0)
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  expect(errors).toEqual([])
})
