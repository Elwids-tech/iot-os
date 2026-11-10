import { expect, test as base, type Page, type Route } from "@playwright/test"

// Plans and allowances in the admin app (spec 028 US1 and US2), against a mocked API.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

type Kind = "alerts" | "sms" | "devices" | "data_points" | "retention_days" | "organizations"

const kinds: Kind[] = ["alerts", "sms", "devices", "data_points", "retention_days", "organizations"]
const defaults: Record<Kind, number | null> = {
  alerts: null,
  sms: 0,
  devices: null,
  data_points: null,
  retention_days: null,
  organizations: 1,
}

type Plan = {
  uuid: string
  name: string
  description: string | null
  archived_at: string | null
  allowances: Partial<Record<Kind, number | null>>
  ever_assigned: boolean
}

type Account = {
  uuid: string
  name: string
  plan: string | null
  overrides: Partial<Record<Kind, { value: number | null; note: string }>>
}

const planA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const planB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const created = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const harbour = "11111111-1111-4111-8111-111111111111"
const lakeside = "22222222-2222-4222-8222-222222222222"

function fixtures() {
  const plans: Plan[] = [
    {
      uuid: planA,
      name: "Plan A",
      description: null,
      archived_at: null,
      allowances: { alerts: 100, devices: 10 },
      ever_assigned: true,
    },
    {
      uuid: planB,
      name: "Plan B",
      description: "For multi-site customers.",
      archived_at: null,
      allowances: { alerts: 1000, devices: 50, organizations: 5 },
      ever_assigned: false,
    },
  ]
  const accounts: Account[] = [
    { uuid: harbour, name: "Harbour Depot", plan: planA, overrides: {} },
    { uuid: lakeside, name: "Lakeside Group", plan: planA, overrides: {} },
    { uuid: "33333333-3333-4333-8333-333333333333", name: "Corner Shop", plan: null, overrides: {} },
  ]
  return { plans, accounts }
}

function paginated<T>(items: T[], url: URL) {
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10), 1)
  const perPage = Math.max(Number.parseInt(url.searchParams.get("per_page") ?? "25", 10), 1)
  const data = items.slice((page - 1) * perPage, page * perPage)
  return {
    data,
    meta: {
      current_page: page,
      from: data.length ? (page - 1) * perPage + 1 : null,
      last_page: Math.max(Math.ceil(items.length / perPage), 1),
      per_page: perPage,
      to: data.length ? (page - 1) * perPage + data.length : null,
      total: items.length,
    },
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, json: body })
}

/** Plans in these tests have no prices: everything is 0 (spec 029 FR-027). */
const freePrices = {
  currency: "USD",
  current: { effective_from: "2026-11-01", base_price: 0, alert_overage_price: 0, data_point_overage_price: 0, data_point_block_size: 1000000 },
  next: null,
}

/** Plan A's made-up base price, with a change waiting for next month. */
const planAPrices = {
  ...freePrices,
  current: { ...freePrices.current, base_price: 1234 },
  next: { ...freePrices.current, effective_from: "2026-12-01", base_price: 1500 },
}

/** The mocked API, plus the request bodies the tests assert on. */
async function mockApi(page: Page) {
  const { plans, accounts } = fixtures()
  const sent: { method: string; path: string; body: unknown }[] = []
  const on = (plan: Plan) => accounts.filter((account) => account.plan === plan.uuid)
  const planSummary = (plan: Plan) => ({
    uuid: plan.uuid,
    name: plan.name,
    description: plan.description,
    archived: plan.archived_at !== null,
    archived_at: plan.archived_at,
    allowances: kinds.filter((kind) => kind in plan.allowances).map((kind) => ({ kind, value: plan.allowances[kind] })),
    accounts_count: on(plan).length,
    ever_assigned: plan.ever_assigned,
    created_at: "2026-11-01T08:00:00Z",
    prices: plan.uuid === planA ? planAPrices : freePrices,
  })
  const planDetail = (plan: Plan) => ({
    ...planSummary(plan),
    accounts: on(plan).map((account) => ({ uuid: account.uuid, name: account.name, kind: "paid", since: "2026-11-02T08:00:00Z" })),
    history: [{ at: "2026-11-01T08:00:00Z", action: "created", actor: { id: 1, name: "Platform Super Admin" }, changes: [] }],
  })
  const accountDetail = (account: Account) => {
    const plan = plans.find((item) => item.uuid === account.plan)
    const allowances = kinds.map((kind) => {
      const override = account.overrides[kind]
      if (override) return { kind, value: override.value, source: "override", note: override.note }
      if (plan && kind in plan.allowances) return { kind, value: plan.allowances[kind], source: "plan", note: null }
      return { kind, value: defaults[kind], source: "default", note: null }
    })
    return {
      uuid: account.uuid,
      name: account.name,
      contact_email: null,
      notes: null,
      organization_limit: allowances[5].value,
      organizations_count: 0,
      created_at: "2026-11-01T08:00:00Z",
      plan_assignment: plan
        ? {
            uuid: "99999999-9999-4999-8999-999999999999",
            kind: "paid",
            plan: { uuid: plan.uuid, name: plan.name, archived: plan.archived_at !== null },
            started_at: "2026-11-02T08:00:00Z",
            trial_ends_at: null,
          }
        : null,
      allowances,
      prices: plan ? freePrices : null,
      price_overrides: [],
      billing_details: { billing_address: null, tax_number: null, tax_rate: null },
      owners: [],
      organizations: [],
      history: [],
    }
  }

  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON?.() ?? null
    if (method !== "GET") sent.push({ method, path, body })
    const search = url.searchParams.get("search")?.toLowerCase() ?? ""
    const planMatch = path.match(/^\/api\/v1\/admin\/billing-plans\/([^/]+)(\/archive|\/restore)?$/)
    const accountMatch = path.match(/^\/api\/v1\/admin\/billing-accounts\/([^/]+)(\/plan|\/allowances\/([a-z_]+))?$/)

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/tickets/summary") return json(route, { data: { awaiting_team: 0 } })
    if (path === "/api/v1/admin/organizations" && method === "GET") return json(route, paginated([], url))
    if (path === "/api/v1/admin/organizations" && method === "POST") {
      const values = body as { name: string; slug: string }
      return json(route, { data: { uuid: "44444444-4444-4444-8444-444444444444", ...values, users_count: 0, devices_count: 0 } }, 201)
    }

    if (path === "/api/v1/admin/billing-plans" && method === "GET") {
      const archived = url.searchParams.get("archived")
      const matches = plans
        .filter((plan) => plan.name.toLowerCase().includes(search))
        .filter((plan) => (archived === "0" ? !plan.archived_at : archived === "1" ? Boolean(plan.archived_at) : true))
      return json(route, paginated(matches.map(planSummary), url))
    }
    if (path === "/api/v1/admin/billing-plans" && method === "POST") {
      const values = body as { name: string; description: string | null; allowances: Plan["allowances"] }
      const plan: Plan = { uuid: created, archived_at: null, ever_assigned: false, ...values }
      plans.push(plan)
      return json(route, { data: planDetail(plan) }, 201)
    }
    if (planMatch) {
      const plan = plans.find((item) => item.uuid === planMatch[1])
      if (!plan) return json(route, { message: "Not found." }, 404)
      if (planMatch[2] === "/archive") plan.archived_at = "2026-11-07T10:00:00Z"
      if (planMatch[2] === "/restore") plan.archived_at = null
      if (method === "PATCH") {
        const values = body as { name: string; allowances: Plan["allowances"]; confirm_affected?: number }
        const changed = JSON.stringify(values.allowances) !== JSON.stringify(plan.allowances)
        if (changed && on(plan).length > 0 && values.confirm_affected !== on(plan).length) {
          return json(route, { message: "Confirm.", affected_accounts: on(plan).length }, 409)
        }
        plan.name = values.name
        plan.allowances = values.allowances
      }
      if (method === "DELETE") {
        plans.splice(plans.indexOf(plan), 1)
        return route.fulfill({ status: 204 })
      }
      return json(route, { data: planDetail(plan) })
    }

    if (path === "/api/v1/admin/billing-accounts" && method === "GET") {
      return json(route, paginated([], url))
    }
    if (accountMatch) {
      const account = accounts.find((item) => item.uuid === accountMatch[1])
      if (!account) return json(route, { message: "Not found." }, 404)
      if (accountMatch[2] === "/plan") {
        account.plan = (body as { plan_uuid: string | null }).plan_uuid
        plans.forEach((plan) => plan.uuid === account.plan && (plan.ever_assigned = true))
      }
      const kind = accountMatch[3] as Kind | undefined
      if (kind && method === "PUT") account.overrides[kind] = body as { value: number | null; note: string }
      if (kind && method === "DELETE") delete account.overrides[kind]
      return json(route, { data: accountDetail(account) })
    }
    if (path === "/api/v1/admin/users") return json(route, paginated([], url))
    if (path === "/api/v1/admin/billing/invoices") return json(route, paginated([], url))

    return json(route, { message: `Unmocked ${method} ${path}` }, 404)
  })

  return { sent }
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

async function choose(page: Page, combobox: string | RegExp, option: RegExp) {
  await page.getByRole("combobox", { name: combobox }).click()
  await page.getByRole("option", { name: option }).click()
}

test("creates a plan, then edits one that billing accounts are on after confirming", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "Plans" }).click()

  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible()
  const planARow = page.getByRole("row", { name: /Plan A Alerts 100 · Devices 10 .* 2 Active/ })
  await expect(planARow).toBeVisible()
  // This month's base price, and next month's waiting change.
  await expect(planARow.getByRole("cell").nth(2)).toHaveText(/^\$12\.34\$15\.00 from (1 Dec|Dec 1,) 2026$/)

  await page.getByRole("button", { name: "New plan" }).click()
  const dialog = page.getByRole("dialog", { name: "New plan" })
  await dialog.getByRole("textbox", { name: "Name" }).fill("Fleet")
  await dialog.getByRole("spinbutton", { name: "Alerts per month" }).fill("5000")
  await dialog.getByRole("switch", { name: "Active devices: unlimited" }).click()
  await expect(dialog.getByRole("spinbutton", { name: "Active devices" })).toBeDisabled()
  await dialog.getByRole("spinbutton", { name: "Telemetry retention" }).fill("90")
  await dialog.getByRole("button", { name: "Create plan" }).click()

  await expect(page.getByText("Fleet created")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({
    name: "Fleet",
    description: null,
    allowances: { alerts: 5000, devices: null, retention_days: 90 },
  })
  await expect(page.getByText("90 days")).toBeVisible()

  await page.goto(`/plans/${planA}`)
  await expect(page.getByRole("row", { name: /Harbour Depot Paid/ })).toBeVisible()
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByRole("spinbutton", { name: "Alerts per month" }).fill("150")
  await page.getByRole("button", { name: "Save plan" }).click()

  const confirm = page.getByRole("alertdialog", { name: "This changes 2 billing accounts" })
  await expect(confirm).toBeVisible()
  await confirm.getByRole("button", { name: "Change 2 accounts" }).click()
  await expect(page.getByText("Plan A saved")).toBeVisible()
  expect(sent.at(-1)?.body).toMatchObject({ allowances: { alerts: 150, devices: 10 }, confirm_affected: 2 })
  await expect(page.getByText("150", { exact: true })).toBeVisible()
})

test("archives a plan, lists it under Archived, and never deletes a used plan", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/plans")

  await page.getByRole("button", { name: "Actions for Plan A" }).click()
  await expect(page.getByRole("menuitem", { name: "Delete: it was used, archive it instead" })).toBeDisabled()
  await page.getByRole("menuitem", { name: "Archive plan" }).click()
  await expect(page.getByText("Plan A archived")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "POST", path: `/api/v1/admin/billing-plans/${planA}/archive` })
  await expect(page.getByRole("row", { name: /Plan A\b/ })).toHaveCount(0)

  await page.goto("/plans?archived=archived")
  await expect(page.getByRole("row", { name: /Plan A .* Archived/ })).toBeVisible()
  await expect(page.getByRole("row", { name: /Plan B\b/ })).toHaveCount(0)

  await page.goto("/plans")
  await page.getByRole("button", { name: "Actions for Plan B" }).click()
  await page.getByRole("menuitem", { name: "Delete plan" }).click()
  await page.getByRole("alertdialog", { name: "Delete Plan B?" }).getByRole("button", { name: "Delete plan" }).click()
  await expect(page.getByText("Plan B deleted")).toBeVisible()
  await expect(page.getByRole("row", { name: /Plan B\b/ })).toHaveCount(0)
})

test("puts a billing account on a plan, overrides an allowance and removes both", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/billing-accounts/33333333-3333-4333-8333-333333333333")

  await expect(page.getByText("No plan. The account gets the deployment's default allowances.")).toBeVisible()
  await choose(page, "Choose a plan", /Plan B\b/)
  await expect(page.getByText("Corner Shop is now on Plan B")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({
    method: "PUT",
    path: "/api/v1/admin/billing-accounts/33333333-3333-4333-8333-333333333333/plan",
    body: { plan_uuid: planB },
  })
  await expect(page.getByRole("row", { name: /Active devices 50 Plan/ })).toBeVisible()
  await expect(page.getByText("0 of 5 organizations")).toBeVisible()

  await page.getByRole("button", { name: "Actions for Active devices" }).click()
  await page.getByRole("menuitem", { name: "Override" }).click()
  const dialog = page.getByRole("dialog", { name: "Override active devices" })
  await expect(dialog.getByText("Now 50, from its plan.", { exact: false })).toBeVisible()
  await dialog.getByRole("spinbutton", { name: "Active devices" }).fill("80")
  await dialog.getByRole("button", { name: "Save override" }).click()
  await expect(dialog.getByRole("textbox", { name: "Note" })).toBeFocused()
  await dialog.getByRole("textbox", { name: "Note" }).fill("Agreed for the 2026 rollout")
  await dialog.getByRole("button", { name: "Save override" }).click()

  await expect(page.getByText("Active devices for Corner Shop is now 80")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ value: 80, note: "Agreed for the 2026 rollout" })
  await expect(page.getByRole("row", { name: /Active devices 80 Override Agreed for the 2026 rollout/ })).toBeVisible()

  await page.getByRole("button", { name: "Actions for Active devices" }).click()
  await page.getByRole("menuitem", { name: "Remove override" }).click()
  await expect(page.getByText("Active devices for Corner Shop is back to 50")).toBeVisible()

  await page.getByRole("button", { name: "Remove plan" }).click()
  await page.getByRole("alertdialog", { name: "Take Corner Shop off Plan B?" }).getByRole("button", { name: "Remove plan" }).click()
  await expect(page.getByText("Corner Shop is no longer on a plan")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ plan_uuid: null })
})

test("asks before a plan change shortens telemetry retention, then confirms it", async ({ page }) => {
  const { sent } = await mockApi(page)
  // Spec 029 US4: the API answers 409 with the organizations and the deletion date until confirmed.
  await page.route("**/api/v1/admin/billing-accounts/*/plan", async (route) => {
    if ((route.request().postDataJSON() as { confirm_retention?: boolean }).confirm_retention) return route.fallback()
    await route.fulfill({
      status: 409,
      json: {
        message: "This shortens telemetry retention for 1 organization.",
        retention: {
          deletion_from: "2026-12-08T10:00:00Z",
          organizations: [{ uuid: "55555555-5555-4555-8555-555555555555", name: "Corner Shop HQ", from_days: 400, to_days: 7 }],
        },
      },
    })
  })
  await page.goto("/billing-accounts/33333333-3333-4333-8333-333333333333")

  await choose(page, "Choose a plan", /Plan B\b/)
  const dialog = page.getByRole("alertdialog", { name: "Shorten telemetry retention for 1 organization?" })
  await expect(dialog.getByText("Corner Shop HQ")).toBeVisible()
  await expect(dialog.getByText("400 → 7 days")).toBeVisible()
  await dialog.getByRole("button", { name: "Shorten retention" }).click()

  await expect(page.getByText("Corner Shop is now on Plan B")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ plan_uuid: planB, confirm_retention: true })
})

test("creates an organization with a new billing account on a plan", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Bay Kiosk")
  await expect(dialog.getByRole("combobox", { name: /^Plan/ })).toHaveText(/No plan/)
  await choose(page, /^Plan/, /Plan A\b/)
  await dialog.getByRole("button", { name: "Create organization" }).click()

  await expect(page.getByText("Bay Kiosk created")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({
    name: "Bay Kiosk",
    slug: "bay-kiosk",
    new_billing_account: { name: "Bay Kiosk", contact_email: null },
    plan_uuid: planA,
  })
})

test("plan pages fit a phone without sideways scrolling", async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 375, height: 812 })

  for (const path of ["/plans", `/plans/${planA}`, `/billing-accounts/${harbour}`]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
