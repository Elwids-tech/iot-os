import { expect, test as base, type Page, type Route } from "@playwright/test"

// Trials in the admin app (spec 029 US8), against a mocked API.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const starter = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const growth = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const shop = "33333333-3333-4333-8333-333333333333"
const DAY = 86_400_000

/** A UTC day `days` from today, as `YYYY-MM-DD`. */
const utcDay = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString()
const shortDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

const plans = [
  { uuid: starter, name: "Starter" },
  { uuid: growth, name: "Growth" },
]

type Assignment = { kind: "paid" | "trial" | "trial_unpaid"; plan: string; trial_ends_at: string | null }

function paginated<T>(items: T[]) {
  return { data: items, meta: { current_page: 1, from: items.length ? 1 : null, last_page: 1, per_page: 25, to: items.length, total: items.length } }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, json: body })
}

/** The mocked API: Corner Shop on Starter, paid, with no card; plus the request bodies. */
async function mockApi(page: Page) {
  const sent: { method: string; path: string; body: unknown }[] = []
  const lists: string[] = []
  let assignment: Assignment = { kind: "paid", plan: starter, trial_ends_at: null }
  const planOf = (uuid: string) => plans.find((plan) => plan.uuid === uuid)!
  const detail = () => ({
    uuid: shop,
    name: "Corner Shop",
    contact_email: null,
    notes: null,
    organization_limit: 1,
    organizations_count: 0,
    created_at: "2026-11-01T08:00:00Z",
    plan_assignment: {
      uuid: "99999999-9999-4999-8999-999999999999",
      kind: assignment.kind,
      plan: { ...planOf(assignment.plan), archived: false },
      started_at: "2026-11-02T08:00:00Z",
      trial_ends_at: assignment.trial_ends_at,
    },
    allowances: [],
    prices: null,
    price_overrides: [],
    billing_details: { billing_address: null, tax_number: null, tax_rate: null },
    payment_method: null,
    past_due_since: null,
    usage: [],
    owners: [],
    organizations: [],
    history: [],
  })
  const summary = (uuid: string, name: string, plan: Assignment) => ({
    uuid,
    name,
    contact_email: null,
    organization_limit: 1,
    plan: { uuid: plan.plan, name: planOf(plan.plan).name, kind: plan.kind, trial_ends_at: plan.trial_ends_at },
    organizations_count: 1,
    owners: [],
    created_at: "2026-11-01T08:00:00Z",
    past_due_since: null,
  })

  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON?.() ?? null
    if (method !== "GET") sent.push({ method, path, body })

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/tickets/summary") return json(route, { data: { awaiting_team: 0 } })
    if (path === "/api/v1/admin/billing-plans") return json(route, paginated(plans.map((plan) => ({ ...plan, archived: false, allowances: [] }))))
    if (path === "/api/v1/admin/organizations" && method === "GET") return json(route, paginated([]))
    if (path === "/api/v1/admin/organizations" && method === "POST") {
      const values = body as { name: string; slug: string }
      return json(route, { data: { uuid: "44444444-4444-4444-8444-444444444444", ...values, users_count: 0, devices_count: 0 } }, 201)
    }
    if (path === "/api/v1/admin/billing-accounts" && method === "GET") {
      lists.push(url.search)
      const ending = { kind: "trial" as const, plan: starter, trial_ends_at: dayAfter(utcDay(3)) }
      const rows = [
        summary("11111111-1111-4111-8111-111111111111", "Harbour Depot", ending),
        summary("22222222-2222-4222-8222-222222222222", "Lakeside Group", { kind: "trial_unpaid", plan: growth, trial_ends_at: null }),
        summary(shop, "Corner Shop", { kind: "paid", plan: starter, trial_ends_at: null }),
      ]
      return json(route, paginated(url.searchParams.get("trial") === "ending" ? rows.slice(0, 1) : rows))
    }
    if (path === `/api/v1/admin/billing-accounts/${shop}/trial`) {
      const values = body as { plan_uuid: string | null; ends_at: string | null }
      if (method === "POST" && assignment.kind === "trial") return json(route, { message: "This billing account is already on a trial." }, 409)
      assignment = { kind: "trial", plan: values.plan_uuid ?? assignment.plan, trial_ends_at: values.ends_at }
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing-accounts/${shop}/trial/end`) {
      assignment = { ...assignment, kind: "trial_unpaid", trial_ends_at: null }
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing-accounts/${shop}/trial/convert`) {
      assignment = { ...assignment, kind: "paid", trial_ends_at: null }
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing-accounts/${shop}`) return json(route, { data: detail() })
    if (path === "/api/v1/admin/users") return json(route, paginated([]))
    if (path === "/api/v1/admin/billing/invoices") return json(route, paginated([]))

    return json(route, { message: `Unmocked ${method} ${path}` }, 404)
  })

  return { sent, lists }
}

const test = base.extend<{ consoleMessages: string[] }>({
  consoleMessages: [
    async ({ page }, use) => {
      const messages: string[] = []
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) messages.push(`${message.type()}: ${message.text()}`)
      })
      page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`))
      await use(messages)
      expect(messages.filter((message) => !message.includes("409"))).toEqual([])
    },
    { auto: true },
  ],
})

/** Waits for the list to close: a click during its exit animation logs a flushSync warning (docs/dev/gotchas.md). */
async function choose(page: Page, combobox: string | RegExp, option: RegExp) {
  await page.getByRole("combobox", { name: combobox }).click()
  await page.getByRole("option", { name: option }).click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
}

test("starts a trial, extends it, ends it without a card and converts it to paid", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto(`/billing-accounts/${shop}`)
  const plan = page.getByRole("region", { name: "Plan" })
  await expect(plan.getByText("Paid")).toBeVisible()

  await plan.getByRole("button", { name: "Start trial" }).click()
  const dialog = page.getByRole("dialog", { name: "Start a trial for Corner Shop" })
  // The account's plan, for 30 days with today, by default.
  await expect(dialog.getByRole("combobox", { name: "Plan" })).toHaveText(/Starter/)
  await expect(dialog.getByLabel("Last day (UTC)")).toHaveValue(utcDay(29))
  const lastDay = utcDay(20)
  await dialog.getByLabel("Last day (UTC)").fill(lastDay)
  await dialog.getByRole("button", { name: "Start trial" }).click()

  await expect(page.getByText("Corner Shop is on a trial of Starter")).toBeVisible()
  expect(sent.at(-1)).toEqual({ method: "POST", path: `/api/v1/admin/billing-accounts/${shop}/trial`, body: { plan_uuid: starter, ends_at: dayAfter(lastDay) } })
  await expect(plan.getByText("Trial", { exact: true })).toBeVisible()
  await expect(plan.getByText(`until ${shortDay(lastDay)}`, { exact: false })).toBeVisible()

  // Open-ended, on Growth.
  await plan.getByRole("button", { name: "Change trial" }).click()
  const change = page.getByRole("dialog", { name: "Change the trial of Corner Shop" })
  await expect(change.getByLabel("Last day (UTC)")).toHaveValue(lastDay)
  await choose(page, "Plan", /Growth/)
  await change.getByRole("radio", { name: /No end date/ }).click()
  await change.getByRole("button", { name: "Save trial" }).click()
  await expect(page.getByText("Trial changed")).toBeVisible()
  expect(sent.at(-1)).toEqual({ method: "PATCH", path: `/api/v1/admin/billing-accounts/${shop}/trial`, body: { plan_uuid: growth, ends_at: null } })
  await expect(plan.getByText("no end date", { exact: false })).toBeVisible()

  await plan.getByRole("button", { name: "End trial" }).click()
  const end = page.getByRole("alertdialog", { name: "End the trial of Growth now?" })
  await expect(end.getByText("There is no saved card", { exact: false })).toBeVisible()
  await end.getByRole("button", { name: "End trial" }).click()
  await expect(page.getByText("The trial ended. Corner Shop is not charged until an owner saves a card")).toBeVisible()
  await expect(plan.getByText("Trial ended, no payment method")).toBeVisible()
  await expect(plan.getByRole("button", { name: "Start trial" })).toBeVisible()

  await plan.getByRole("button", { name: "Convert to paid" }).click()
  await page.getByRole("alertdialog", { name: "Convert Corner Shop to paid?" }).getByRole("button", { name: "Convert to paid" }).click()
  await expect(page.getByText("Corner Shop is on Growth, charged from tomorrow")).toBeVisible()
  expect(sent.at(-1)?.path).toBe(`/api/v1/admin/billing-accounts/${shop}/trial/convert`)
  await expect(plan.getByText("Paid")).toBeVisible()
})

test("asks before a trial's plan shortens telemetry retention, then confirms it", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.route(`**/api/v1/admin/billing-accounts/${shop}/trial`, async (route) => {
    if ((route.request().postDataJSON() as { confirm_retention?: boolean }).confirm_retention) return route.fallback()
    await route.fulfill({
      status: 409,
      json: {
        message: "This shortens telemetry retention for 1 organization.",
        retention: {
          deletion_from: "2026-12-08T10:00:00Z",
          organizations: [{ uuid: "55555555-5555-4555-8555-555555555555", name: "Corner Shop HQ", from_days: 400, to_days: 30 }],
        },
      },
    })
  })
  await page.goto(`/billing-accounts/${shop}`)

  await page.getByRole("button", { name: "Start trial" }).click()
  const dialog = page.getByRole("dialog", { name: "Start a trial for Corner Shop" })
  await choose(page, "Plan", /Growth/)
  await dialog.getByRole("radio", { name: /No end date/ }).click()
  await dialog.getByRole("button", { name: "Start trial" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Shorten telemetry retention for 1 organization?" })
  await expect(confirm.getByText("400 → 30 days")).toBeVisible()
  await confirm.getByRole("button", { name: "Shorten retention" }).click()

  await expect(page.getByText("Corner Shop is on a trial of Growth")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ plan_uuid: growth, ends_at: null, confirm_retention: true })
})

test("marks trials in the list and filters those ending within 7 days", async ({ page }) => {
  const { lists } = await mockApi(page)
  await page.goto("/billing-accounts")

  await expect(page.getByRole("row", { name: new RegExp(`Harbour Depot .* Starter Trial until ${shortDay(utcDay(3))}`) })).toBeVisible()
  await expect(page.getByRole("row", { name: /Lakeside Group .* Growth Trial ended, no payment method/ })).toBeVisible()
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "Trial" }).click()
  await page.getByRole("option", { name: "Ending within 7 days" }).click()
  await expect(page).toHaveURL(/trial=ending/)
  await expect(page.getByRole("row", { name: /Lakeside Group/ })).toHaveCount(0)
  expect(lists.at(-1)).toContain("trial=ending")
})

test("creates an organization whose new billing account starts on an open-ended trial", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Bay Kiosk")
  await expect(dialog.getByRole("checkbox", { name: /Start on a trial/ })).toHaveCount(0)
  await choose(page, /^Plan/, /Starter/)
  await dialog.getByRole("checkbox", { name: /Start on a trial/ }).click()
  await dialog.getByRole("radio", { name: /No end date/ }).click()
  await dialog.getByRole("button", { name: "Create organization" }).click()

  await expect(page.getByText("Bay Kiosk created")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({
    name: "Bay Kiosk",
    slug: "bay-kiosk",
    new_billing_account: { name: "Bay Kiosk", contact_email: null },
    trial: { plan_uuid: starter, ends_at: null },
  })
})
