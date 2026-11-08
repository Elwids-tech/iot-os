import AxeBuilder from "@axe-core/playwright"
import { test, expect, type Page } from "@playwright/test"

/** Usage in the portal (spec 028 US4, spec 029 US5): owners' panels and managers' Settings → Usage, against a mocked API. */
const org = "a0000000-0000-4000-8000-000000000001"
const depot = "a0000000-0000-4000-8000-000000000002"
const accountUuid = "d0000000-0000-4000-8000-000000000001"
const accountName = "Example Integrations"
const now = Date.now()
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()
const thisMonth = new Date(now).toISOString().slice(0, 7)
const lastMonth = (() => {
  const date = new Date(now)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
})()
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

const share = (organization_uuid: string, name: string, count: number) => ({ organization_uuid, name, count })

function accountUsage(month: string, reportedAt: string) {
  return [
    { kind: "alerts", month: `${month}-01`, count: 850, allowance: 1000, left: 150, overage: 0, organizations: [share(org, "Corner Shop", 600), share(depot, "Depot", 250)] },
    { kind: "sms", month: `${month}-01`, count: 20, allowance: 200, left: 180, overage: 0, organizations: [share(org, "Corner Shop", 20)] },
    { kind: "data_points", month: `${month}-01`, count: 412_000, allowance: 1_000_000, left: 588_000, overage: 0, final: false, reported_at: reportedAt, stale: false, organizations: [share(org, "Corner Shop", 300_000), share(depot, "Depot", 112_000)] },
    { kind: "devices", month: `${month}-01`, count: 12, allowance: 10, left: 0, overage: 0, peak_this_month: 13, over_limit: true, organizations: [share(org, "Corner Shop", 9), share(depot, "Depot", 3)] },
  ]
}

const october = [
  { kind: "alerts", month: `${lastMonth}-01`, count: 1240, allowance: 1000, left: 0, overage: 240, organizations: [share(org, "Corner Shop", 1240)] },
  { kind: "data_points", month: `${lastMonth}-01`, count: 980_000, allowance: 1_000_000, left: 20_000, overage: 0, final: true, reported_at: ago(3600), stale: false, organizations: [share(org, "Corner Shop", 980_000)] },
  { kind: "devices", month: `${lastMonth}-01`, count: 9, allowance: 10, left: 1, overage: 0, organizations: [share(org, "Corner Shop", 9)] },
]

async function setup(page: Page, options: { manage?: boolean; reportedAt?: string; sms?: boolean } = {}) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const manage = options.manage ?? true
  const reportedAt = options.reportedAt ?? ago(30)
  const organization = {
    uuid: org,
    name: "Corner Shop",
    slug: "corner-shop",
    capabilities: { manage_administration: false, devices: { view: true, manage, command: false } },
  }
  const months: string[] = []
  const organizationUsage = accountUsage(thisMonth, reportedAt)
    .filter((item) => options.sms !== false || item.kind !== "sms")
    .map(({ organizations, peak_this_month: _peak, ...item }) => ({
      ...item,
      count: organizations.find((entry) => entry.organization_uuid === org)?.count ?? 0,
    }))
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 7,
          name: "Owner Person",
          email: "owner@example.test",
          email_verified_at: ago(86_400),
          capabilities: { platform_administration: false, billing_accounts: true },
          organizations: [organization],
        },
      })
    if (path === "/api/v1/billing-accounts")
      return json({
        data: [
          {
            uuid: accountUuid,
            name: accountName,
            organization_limit: 10,
            organizations_count: 2,
            organizations: [
              { uuid: org, name: "Corner Shop", created_at: ago(86_400), member: true },
              { uuid: depot, name: "Depot", created_at: ago(86_400), member: false },
            ],
            plan: { uuid: "e0000000-0000-4000-8000-000000000001", name: "Example plan", since: ago(10 * 86_400) },
            allowances: [
              { kind: "alerts", value: 1000, source: "plan", note: null },
              { kind: "sms", value: 200, source: "plan", note: null },
              { kind: "devices", value: 10, source: "plan", note: null },
              { kind: "data_points", value: 1_000_000, source: "plan", note: null },
              { kind: "retention_days", value: 90, source: "plan", note: null },
              { kind: "organizations", value: 10, source: "default", note: null },
            ],
            usage: accountUsage(thisMonth, reportedAt),
          },
        ],
      })
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices`) return json({ data: { invoices: [], credit_notes: [] } })
    if (path === `/api/v1/billing-accounts/${accountUuid}/usage`) {
      months.push(url.searchParams.get("month") ?? "")
      return json({ data: october })
    }
    if (path === `/api/v1/organizations/${org}/usage`)
      return manage
        ? json({ data: organizationUsage, retention: { days: 90, source: "billing_account", pending_reduction: { days: 90, from: ago(-20 * 86_400) } } })
        : json({ message: "This action is unauthorized." }, 403)
    if (path === `/api/v1/organizations/${org}/context`) return json({ data: organization })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: ago(0) } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { errors, months }
}

test("an owner sees the plan, usage with each organization's share, and an earlier month", async ({ page }) => {
  const { errors, months } = await setup(page)
  await page.goto("/billing")
  await expect(page.getByRole("heading", { name: accountName })).toBeVisible()

  const plan = page.getByRole("region", { name: "Plan" })
  await expect(plan).toContainText("Example plan since 10 d ago")
  await expect(plan.getByRole("definition").filter({ hasText: "90 days" })).toBeVisible()

  const usage = page.getByRole("region", { name: "Usage" })
  const alerts = usage.locator('[data-slot="allowance-meter"]').filter({ hasText: "Alerts" })
  await expect(alerts).toContainText("850")
  await expect(alerts).toContainText("of 1,000")
  await expect(alerts).toContainText("80% or more used")
  await expect(alerts).toContainText("150 alerts left")
  const devices = usage.locator('[data-slot="allowance-meter"]').filter({ hasText: "Active devices" })
  await expect(devices).toContainText("Over the limit")
  await expect(devices).toContainText("2 devices over the limit")
  await expect(devices).toContainText("Peak 13")
  await expect(usage.locator('[data-slot="allowance-meter"]').filter({ hasText: "Data points" })).toContainText("Provisional · last reported")
  const depotRow = usage.getByRole("row").filter({ hasText: "Depot" })
  await expect(depotRow).toContainText("250")
  await expect(depotRow).toContainText("112,000")

  await usage.getByRole("combobox", { name: "Month" }).click()
  await page.getByRole("option").nth(1).click()
  await expect(alerts).toContainText("240 alerts of overage")
  await expect(usage.locator('[data-slot="allowance-meter"]').filter({ hasText: "Data points" })).toContainText("Final")
  await expect(usage.getByRole("row").filter({ hasText: "Depot" })).toHaveCount(0)
  await expect(usage.locator('[data-slot="allowance-meter"]').filter({ hasText: "Peak devices" })).toContainText("9")
  await expect(usage.getByRole("columnheader", { name: "Active devices" })).toHaveCount(0)
  expect(months).toEqual([lastMonth])

  await expect(page.getByRole("region", { name: "Organizations" }).getByRole("row").filter({ hasText: "Depot" })).toContainText("Not a member")
  expect(errors).toEqual([])
})

test("a stale report reads late on the data point meter", async ({ page }) => {
  const { errors } = await setup(page, { reportedAt: ago(12 * 60) })
  await page.goto("/billing")
  const meter = page.locator('[data-slot="allowance-meter"]').filter({ hasText: "Data points" })
  await expect(meter.locator('[data-slot="freshness"]')).toHaveAttribute("data-state", "late")
  await expect(meter).toContainText("12 min ago")
  expect(errors).toEqual([])
})

test("a manager sees Settings → Usage for the organization without the billing account", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/organizations/${org}/settings/general`)
  await page.getByRole("link", { name: "Usage" }).click()
  await expect(page).toHaveURL(`/organizations/${org}/settings/usage`)
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible()

  const allowances = page.getByRole("region", { name: "Allowances" })
  const alerts = allowances.locator('[data-kind="alerts"]')
  await expect(alerts).toContainText("600")
  await expect(alerts).toContainText("150 alerts left on the account")
  await expect(alerts).toContainText("80% or more used")
  await expect(allowances.locator('[data-kind="devices"]')).toContainText("The account is over its device limit")
  await expect(allowances.locator('[data-kind="data_points"]')).toContainText("300,000")
  await expect(allowances.locator('[data-kind="data_points"]')).toContainText("Provisional · last reported")

  const retention = page.getByRole("region", { name: "Telemetry retention" })
  await expect(retention).toContainText("90 days")
  await expect(retention).toContainText("From the billing plan")
  await expect(retention).toContainText("History older than 90 days is deleted from")

  await expect(page.getByText(accountName)).toHaveCount(0)
  await expect(page.getByText("Depot")).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"))
  expect((await new AxeBuilder({ page }).include('[data-slot="collection-page"]').analyze()).violations).toEqual([])
  expect(errors).toEqual([])
})

test("without device management the Usage section is hidden", async ({ page }) => {
  const { errors } = await setup(page, { manage: false })
  await page.goto(`/organizations/${org}/settings/general`)
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Usage" })).toHaveCount(0)
  await page.goto(`/organizations/${org}/settings/usage`)
  await expect(page.getByText("Usage unavailable")).toBeVisible()
  await expect(page.getByText("left on the account")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("Settings → Notifications shows the alert and SMS allowances, and hides SMS when the response omits it", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/organizations/${org}/settings/notifications`)
  const allowances = page.getByRole("region", { name: "Allowances" })
  await expect(allowances.locator('[data-kind="alerts"]')).toContainText("150 alerts left on the account")
  await expect(allowances.locator('[data-kind="sms"]')).toContainText("180 SMS left on the account")
  await expect(allowances.locator('[data-kind="devices"]')).toHaveCount(0)
  await expect(allowances).toContainText("SMS stops once its allowance is used up.")

  await page.unrouteAll({ behavior: "ignoreErrors" })
  await setup(page, { sms: false })
  await page.reload()
  await expect(allowances.locator('[data-kind="alerts"]')).toBeVisible()
  await expect(allowances.locator('[data-kind="sms"]')).toHaveCount(0)
  await expect(allowances).not.toContainText("SMS")
  expect(errors).toEqual([])
})

test("the billing page passes axe and fits a phone", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto("/billing")
  await expect(page.getByRole("region", { name: "Usage" })).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"))
  expect((await new AxeBuilder({ page }).include('[data-slot="entity-page"]').analyze()).violations).toEqual([])

  await page.setViewportSize({ width: 375, height: 812 })
  await page.reload()
  await expect(page.getByRole("region", { name: "Usage" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  expect(errors).toEqual([])
})
