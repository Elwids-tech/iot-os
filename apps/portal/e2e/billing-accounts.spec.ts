import AxeBuilder from "@axe-core/playwright"
import { test, expect, type Page } from "@playwright/test"

/** Billing account owners in the portal (spec 023), against a mocked API. */
const shop = { uuid: "a0000000-0000-4000-8000-000000000001", name: "Corner Shop", slug: "corner-shop" }
const home = { uuid: "a0000000-0000-4000-8000-000000000002", name: "Home", slug: "home" }
const created = { uuid: "a0000000-0000-4000-8000-000000000003", name: "Café Two", slug: "cafe-two" }
const capabilities = { devices: { view: true, manage: true, command: true } }
const now = new Date().toISOString()
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

type Account = {
  uuid: string
  name: string
  organization_limit: number
  organizations_count: number
  organizations: { uuid: string; name: string; created_at: string | null; member: boolean }[]
}

const integrations = (): Account => ({
  uuid: "d0000000-0000-4000-8000-000000000001",
  name: "Example Integrations",
  organization_limit: 10,
  organizations_count: 2,
  organizations: [
    { uuid: shop.uuid, name: shop.name, created_at: now, member: true },
    { uuid: home.uuid, name: home.name, created_at: now, member: false },
  ],
})

const second = (): Account => ({
  uuid: "d0000000-0000-4000-8000-000000000002",
  name: "Second Account",
  organization_limit: 3,
  organizations_count: 1,
  organizations: [{ uuid: "a0000000-0000-4000-8000-000000000009", name: "Warehouse", created_at: now, member: false }],
})

async function setup(
  page: Page,
  options: {
    owner?: boolean
    member?: boolean
    accounts?: Account[]
    /** Answer the create with this status and body instead of creating. */
    refuse?: { status: number; body: unknown }
  } = {},
) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const state = {
    accounts: options.accounts ?? [integrations()],
    organizations: options.member === false ? [] : [{ ...shop, capabilities }],
    posts: [] as Record<string, unknown>[],
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 7,
          name: "Owner Person",
          email: "owner@example.test",
          email_verified_at: now,
          capabilities: { platform_administration: false, billing_accounts: options.owner ?? true },
          organizations: state.organizations,
        },
      })
    if (path === "/api/v1/billing-accounts") return json({ data: state.accounts })
    const create = /^\/api\/v1\/billing-accounts\/([0-9a-f-]{36})\/organizations$/.exec(path)
    if (create && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      state.posts.push(body)
      if (options.refuse) return json(options.refuse.body, options.refuse.status)
      const account = state.accounts.find((item) => item.uuid === create[1])!
      account.organizations.push({ uuid: created.uuid, name: String(body.name), created_at: now, member: true })
      account.organizations_count += 1
      state.organizations.push({ ...created, name: String(body.name), capabilities })
      return json({ data: { ...created, name: body.name } }, 201)
    }
    const context = /^\/api\/v1\/organizations\/([0-9a-f-]{36})\/context$/.exec(path)
    if (context) return json({ data: state.organizations.find((item) => item.uuid === context[1]) })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: now } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { state, errors }
}

const userMenu = (page: Page) => page.getByRole("button", { name: "Owner Person" })
const newOrganization = (page: Page) => page.getByRole("button", { name: "New organization" })

test("the user menu offers Billing accounts only to owners", async ({ page }) => {
  const { errors } = await setup(page, { owner: false })
  await page.goto(`/organizations/${shop.uuid}/home`)
  await userMenu(page).click()
  await expect(page.getByRole("menuitem", { name: "Email preferences" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Billing accounts" })).toHaveCount(0)

  await page.unrouteAll({ behavior: "ignoreErrors" })
  await setup(page)
  await page.reload()
  await userMenu(page).click()
  await page.getByRole("menuitem", { name: "Billing accounts" }).click()
  await expect(page).toHaveURL("/billing")
  await expect(page.getByRole("heading", { name: "Billing accounts" })).toBeVisible()
  expect(errors).toEqual([])
})

test("an owner with no organization is pointed to Billing accounts; anyone else to an invitation", async ({ page }) => {
  const { errors } = await setup(page, { member: false })
  await page.goto("/")
  await page.getByRole("link", { name: "Billing accounts" }).click()
  await expect(page).toHaveURL("/billing")

  await page.unrouteAll({ behavior: "ignoreErrors" })
  await setup(page, { member: false, owner: false })
  await page.goto("/")
  await expect(page.getByText("Ask your organization administrator for an invitation.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Billing accounts" })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("the page lists the account's organizations and opens only those the owner belongs to", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto("/billing")
  await expect(page.getByText("2 of 10 organizations")).toBeVisible()
  await expect(page.getByText("Owning it gives you no access to them")).toBeVisible()
  const rows = page.getByRole("row")
  await expect(rows.filter({ hasText: "Home" })).toContainText("Not a member")
  await expect(rows.filter({ hasText: "Home" }).getByRole("link")).toHaveCount(0)
  await rows.filter({ hasText: "Corner Shop" }).getByRole("link", { name: "Open Corner Shop" }).click()
  await expect(page).toHaveURL(`/organizations/${shop.uuid}/home`)
  expect(errors).toEqual([])
})

test("with several accounts, the selector switches between them and keeps the choice in the address", async ({ page }) => {
  const { errors } = await setup(page, { accounts: [integrations(), second()] })
  await page.goto("/billing")
  await expect(page.getByText("2 of 10 organizations")).toBeVisible()
  await page.getByRole("combobox", { name: "Billing account" }).click()
  await page.getByPlaceholder(/search/i).fill("second")
  await expect(page.getByRole("option")).toHaveCount(1)
  await page.getByRole("option", { name: "Second Account" }).click()
  await expect(page).toHaveURL(/account=d0000000-0000-4000-8000-000000000002/)
  await expect(page.getByText("1 of 3 organizations")).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "Warehouse" })).toContainText("Not a member")
  await page.reload()
  await expect(page.getByText("1 of 3 organizations")).toBeVisible()
  expect(errors).toEqual([])
})

test("creating with the suggested address sends only the name and lands in the new organization", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto("/billing")
  await newOrganization(page).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByLabel("Name").fill("Café Two")
  await expect(dialog.getByLabel("Address")).toHaveValue("cafe-two")
  await expect(dialog.getByText("A number is added if this address is taken.")).toBeVisible()
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(page).toHaveURL(`/organizations/${created.uuid}/home`)
  expect(state.posts).toEqual([{ name: "Café Two" }])
  await expect(page.getByText("Café Two created")).toBeVisible()
  expect(errors).toEqual([])
})

test("an edited address is sent with the name", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto("/billing")
  await newOrganization(page).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByLabel("Name").fill("Café Two")
  await dialog.getByLabel("Address").fill("cafe-2")
  await dialog.getByLabel("Name").fill("Café Two Ltd")
  await expect(dialog.getByLabel("Address")).toHaveValue("cafe-2")
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(page).toHaveURL(`/organizations/${created.uuid}/home`)
  expect(state.posts).toEqual([{ name: "Café Two Ltd", slug: "cafe-2" }])
  expect(errors).toEqual([])
})

test("the server's limit refusal shows on the form", async ({ page }) => {
  const message = "This billing account allows 10 organizations. Ask the platform operator to raise the limit."
  const { errors } = await setup(page, { refuse: { status: 422, body: { message, errors: { billing_account: [message] } } } })
  await page.goto("/billing")
  await newOrganization(page).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByLabel("Name").fill("One Too Many")
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(dialog.getByRole("alert")).toHaveText(message)
  await expect(dialog.getByText(message)).toHaveCount(1)
  await expect(page).toHaveURL("/billing")
  expect(errors).toEqual([])
})

test("a person who no longer owns the account is told so", async ({ page }) => {
  const { errors } = await setup(page, { refuse: { status: 404, body: { message: "Not Found" } } })
  await page.goto("/billing")
  await newOrganization(page).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByLabel("Name").fill("Too Late")
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("You no longer own this billing account.")
  expect(errors).toEqual([])
})

test("at the limit, New organization is disabled and names the limit", async ({ page }) => {
  const { errors } = await setup(page, { accounts: [{ ...integrations(), organization_limit: 2 }] })
  await page.goto("/billing")
  await expect(page.getByText("2 of 2 organizations")).toBeVisible()
  await expect(newOrganization(page)).toBeDisabled()
  await page.locator("span[tabindex='0']").filter({ has: newOrganization(page) }).focus()
  await expect(page.getByRole("tooltip")).toHaveText(
    "Example Integrations allows 2 organizations. Contact the platform operator to raise the limit.",
  )
  expect(errors).toEqual([])
})

test("the page passes axe and fits a phone", async ({ page }) => {
  const { errors } = await setup(page, { accounts: [integrations(), second()] })
  await page.goto("/billing")
  await expect(page.getByText("2 of 10 organizations")).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"))
  expect((await new AxeBuilder({ page }).include('[data-slot="collection-page"]').analyze()).violations).toEqual([])

  await page.setViewportSize({ width: 375, height: 812 })
  await page.reload()
  await expect(page.getByText("2 of 10 organizations")).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await newOrganization(page).click()
  await expect(page.getByRole("dialog", { name: "New organization" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  expect(errors).toEqual([])
})
