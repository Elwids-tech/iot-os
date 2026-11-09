import { expect, test as base, type Page, type Route } from "@playwright/test"

// Prices, tax and invoices in the admin app (spec 029 US6), against a mocked API.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const actor = { id: 1, name: "Platform Super Admin" }
const plan = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const harbour = "11111111-1111-4111-8111-111111111111"
const draftUuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const inAFortnight = new Date(Date.now() + 14 * 86400_000).toISOString()

type Payment = { uuid: string; method: string; amount: number; attempt: number; status: string; failure_reason: string | null; note: string | null; at: string }

type Line = { id: number; position: number; kind: string; description: string; quantity: number; unit_price: number | null; amount: number; period_start: string | null; period_end: string | null; note: string | null }

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

/** The mocked API, plus the request bodies the tests assert on. `issued` starts with INV-0001 issued, its card charge still processing. */
async function mockApi(
  page: Page,
  { issued = false, pastDue = false, month = "2026-10-01", usageFinal = false }: { issued?: boolean; pastDue?: boolean; month?: string; usageFinal?: boolean } = {},
) {
  const sent: { method: string; path: string; body: unknown }[] = []
  let settings = {
    legal_name: null as string | null,
    address: null as string | null,
    tax_registration_number: null as string | null,
    invoice_footer: null as string | null,
    invoice_prefix: "INV-",
    credit_note_prefix: "CN-",
    revision: 0,
    currency: "USD",
    updated_at: null as string | null,
  }
  let staleNextSave = false
  const rates: { uuid: string; name: string; basis_points: number; archived: boolean; archived_at: string | null }[] = []
  let details = { billing_address: null as string | null, tax_number: null as string | null, tax_rate: null as (typeof rates)[number] | null }
  const current = { effective_from: "2026-11-01", base_price: 2000, alert_overage_price: 50, data_point_overage_price: 200, data_point_block_size: 1000000 }
  let next: typeof current | null = null
  const overrides: { price: string; value: number | null; note: string | null; next_value: number | null; next_note: string | null }[] = []
  let waiting = [{ billing_account: { uuid: harbour, name: "Harbour Depot" }, month, waiting_since: "2026-11-01T00:00:00Z", overdue: true }]
  let invoice: null | {
    status: "draft" | "issued"
    number: string | null
    lines: Line[]
    credit_notes: { uuid: string; number: string; invoice: { uuid: string; number: string }; currency: string; amount: number; applied: number; reason: string; issued_at: string }[]
    history: { at: string; action: string; actor: typeof actor | null; description: string | null; amount: number | null; note: string | null; number: string | null }[]
    payment_status: string
    payments: Payment[]
  } = issued
    ? {
        status: "issued",
        number: "INV-0001",
        payment_status: "pending",
        credit_notes: [],
        lines: [{ id: 1, position: 1, kind: "base_price", description: "Starter · October 2026", quantity: 31, unit_price: null, amount: 2000, period_start: "2026-10-01", period_end: "2026-10-31", note: null }],
        history: [{ at: "2026-11-08T10:05:00Z", action: "issued", actor, description: null, amount: null, note: null, number: "INV-0001" }],
        payments: [{ uuid: "aaaa0000-0000-4000-8000-000000000001", method: "card", amount: 2000, attempt: 1, status: "pending", failure_reason: null, note: null, at: "2026-11-08T10:05:00Z" }],
      }
    : null
  let pastDueSince = pastDue ? "2026-11-23T09:00:00Z" : null

  const prices = () => ({ currency: "USD", current, next })
  const planDetail = () => ({
    uuid: plan,
    name: "Starter",
    description: null,
    archived: false,
    archived_at: null,
    allowances: [{ kind: "alerts", value: 100 }],
    accounts_count: 1,
    ever_assigned: true,
    created_at: "2026-11-01T08:00:00Z",
    prices: prices(),
    accounts: [{ uuid: harbour, name: "Harbour Depot", kind: "paid", since: "2026-10-09T00:00:00Z" }],
    history: [],
  })
  const accountDetail = () => ({
    uuid: harbour,
    name: "Harbour Depot",
    contact_email: "billing@example.com",
    notes: null,
    organization_limit: 1,
    organizations_count: 0,
    created_at: "2026-10-01T08:00:00Z",
    plan: { uuid: plan, name: "Starter" },
    plan_assignment: {
      uuid: "99999999-9999-4999-8999-999999999999",
      kind: "paid",
      plan: { uuid: plan, name: "Starter", archived: false },
      started_at: "2026-10-09T00:00:00Z",
      trial_ends_at: null,
    },
    allowances: [{ kind: "alerts", value: 100, source: "plan", note: null }],
    prices: prices(),
    price_overrides: overrides,
    billing_details: details,
    payment_method: { brand: "visa", last_four: "4242", expires: "2030-12" },
    past_due_since: pastDueSince,
    usage: [],
    owners: [],
    organizations: [],
    history: [],
  })
  const totals = () => {
    const subtotal = invoice!.lines.reduce((sum, line) => sum + line.amount, 0)
    const tax = Math.round((subtotal * (details.tax_rate?.basis_points ?? 0)) / 10000)
    return { subtotal, tax, total: subtotal + tax }
  }
  const summary = () => {
    const { subtotal, tax, total } = totals()
    const credited = invoice!.credit_notes.reduce((sum, note) => sum + note.applied, 0) + invoice!.payments.filter((payment) => payment.status === "succeeded").reduce((sum, payment) => sum + payment.amount, 0)
    return {
      uuid: draftUuid,
      number: invoice!.number,
      status: invoice!.status,
      month,
      billing_account: { uuid: harbour, name: "Harbour Depot" },
      // Drafted anyway: an invoice issued from it keeps the mark.
      usage_incomplete: !issued,
      currency: "USD",
      subtotal,
      tax,
      total,
      credit_applied: 0,
      amount_due: total,
      outstanding: invoice!.status === "issued" ? total - credited : total,
      due_at: invoice!.status === "issued" ? inAFortnight : null,
      payment_status: invoice!.payment_status,
      drafted_at: "2026-11-08T10:00:00Z",
      issued_at: invoice!.status === "issued" ? "2026-11-08T10:05:00Z" : null,
    }
  }
  const detail = () => ({
    ...summary(),
    draft_note: invoice!.status === "draft" ? "Runtime is behind" : "Runtime is behind",
    usage_final: usageFinal,
    tax_rate_name: details.tax_rate?.name ?? null,
    tax_basis_points: details.tax_rate?.basis_points ?? null,
    operator_details: invoice!.status === "issued" ? { legal_name: settings.legal_name, address: null, tax_registration_number: null, invoice_footer: null } : null,
    account_details: { name: "Harbour Depot", contact_email: "billing@example.com", billing_address: details.billing_address, tax_number: details.tax_number },
    lines: invoice!.lines,
    usage: [{ organization_uuid: "22222222-2222-4222-8222-222222222222", organization_name: "Harbour East", kind: "alerts", count: 102 }],
    credit_notes: invoice!.credit_notes,
    payments: invoice!.payments,
    history: invoice!.history,
  })

  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON?.() ?? null
    if (method !== "GET") sent.push({ method, path, body })
    const at = new Date().toISOString()

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/users") return json(route, paginated([], url))
    if (path === "/api/v1/admin/organizations" && method === "GET") return json(route, paginated([], url))
    if (path === "/api/v1/admin/billing-accounts" && method === "GET") {
      const row = { uuid: harbour, name: "Harbour Depot", contact_email: null, organization_limit: 1, plan: null, organizations_count: 0, owners: [], created_at: "2026-10-01T08:00:00Z", past_due_since: pastDueSince }
      return json(route, paginated(url.searchParams.get("past_due") === "1" && !pastDueSince ? [] : [row], url))
    }
    if (path === "/api/v1/admin/billing-plans" && method === "GET") return json(route, paginated([], url))

    if (path === "/api/v1/admin/billing/settings") {
      if (method === "PUT") {
        if (staleNextSave || (body as { revision: number }).revision !== settings.revision) {
          staleNextSave = false
          return json(route, { message: "These settings were changed by someone else." }, 409)
        }
        settings = { ...settings, ...(body as object), revision: settings.revision + 1, updated_at: at }
      }
      return json(route, { data: settings })
    }
    if (path === "/api/v1/admin/billing/tax-rates" && method === "GET") return json(route, { data: rates })
    if (path === "/api/v1/admin/billing/tax-rates" && method === "POST") {
      const rate = { uuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...(body as { name: string; basis_points: number }), archived: false, archived_at: null }
      rates.push(rate)
      return json(route, { data: rate }, 201)
    }
    if (path === `/api/v1/admin/billing-plans/${plan}`) return json(route, { data: planDetail() })
    if (path === `/api/v1/admin/billing-plans/${plan}/prices`) {
      next = { ...(body as typeof current), effective_from: "2026-12-01" }
      return json(route, { data: planDetail(), effective_from: "2026-12-01" })
    }
    if (path === `/api/v1/admin/billing-accounts/${harbour}`) return json(route, { data: accountDetail() })
    if (path === `/api/v1/admin/billing-accounts/${harbour}/billing-details`) {
      const values = body as { billing_address: string | null; tax_number: string | null; tax_rate_uuid: string | null }
      details = { billing_address: values.billing_address, tax_number: values.tax_number, tax_rate: rates.find((rate) => rate.uuid === values.tax_rate_uuid) ?? null }
      return json(route, { data: accountDetail() })
    }
    const priceMatch = path.match(new RegExp(`^/api/v1/admin/billing-accounts/${harbour}/prices/([a-z_]+)$`))
    if (priceMatch) {
      const values = body as { value: number | null; note: string | null }
      const row = overrides.find((item) => item.price === priceMatch[1])
      if (row) Object.assign(row, { next_value: values.value, next_note: values.note })
      else overrides.push({ price: priceMatch[1], value: null, note: null, next_value: values.value, next_note: values.note })
      return json(route, { data: accountDetail(), effective_from: "2026-12-01" })
    }

    if (path === "/api/v1/admin/billing/invoices/waiting") return json(route, { data: waiting })
    if (path === "/api/v1/admin/billing/invoices") {
      const status = url.searchParams.get("status")
      const list = invoice && (!status || status === invoice.status) && (!url.searchParams.get("unpaid") || invoice.status === "issued") ? [summary()] : []
      return json(route, paginated(list, url))
    }
    if (path === `/api/v1/admin/billing-accounts/${harbour}/invoices` && method === "POST") {
      waiting = []
      invoice = {
        status: "draft",
        number: null,
        payment_status: "pending",
        credit_notes: [],
        payments: [],
        lines: [
          { id: 1, position: 1, kind: "base_price", description: "Starter · 9–31 Oct 2026 · 23 of 31 days at $20.00 a month", quantity: 23, unit_price: null, amount: 1484, period_start: "2026-10-09", period_end: "2026-10-31", note: null },
          { id: 2, position: 2, kind: "alert_overage", description: "Alerts over the allowance", quantity: 2, unit_price: 50, amount: 100, period_start: null, period_end: null, note: null },
        ],
        history: [{ at, action: "drafted", actor, description: null, amount: null, note: (body as { note: string }).note, number: null }],
      }
      return json(route, { data: detail() }, 201)
    }
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}`) return json(route, { data: detail() })
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}/adjustments`) {
      const values = body as { description: string; amount: number; note: string }
      invoice!.lines.push({ id: 3, position: 3, kind: "adjustment", description: values.description, quantity: 1, unit_price: null, amount: values.amount, period_start: null, period_end: null, note: values.note })
      invoice!.history.unshift({ at, action: "adjustment_added", actor, description: values.description, amount: values.amount, note: values.note, number: null })
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}/issue`) {
      Object.assign(invoice!, { status: "issued", number: "INV-0001" })
      invoice!.history.unshift({ at, action: "issued", actor, description: null, amount: null, note: null, number: "INV-0001" })
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}/payments`) {
      const values = body as { amount: number; note: string | null }
      invoice!.payments.push({ uuid: "aaaa0000-0000-4000-8000-000000000009", method: "outside", amount: values.amount, attempt: 0, status: "succeeded", failure_reason: null, note: values.note, at })
      if (summary().outstanding <= 0) {
        invoice!.payment_status = "paid_outside"
        pastDueSince = null
      }
      invoice!.history.unshift({ at, action: "payment_recorded", actor, description: null, amount: values.amount, note: values.note, number: null })
      return json(route, { data: detail() }, 201)
    }
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}/reconcile`) {
      invoice!.payments = invoice!.payments.map((payment) => (payment.status === "pending" ? { ...payment, status: "failed", failure_reason: "Your card was declined." } : payment))
      invoice!.payment_status = "failed"
      invoice!.history.unshift({ at, action: "payment_failed", actor: null, description: null, amount: 2000, note: "Your card was declined.", number: null })
      return json(route, { data: detail() })
    }
    if (path === `/api/v1/admin/billing/invoices/${draftUuid}/credit-notes`) {
      const values = body as { amount: number; reason: string }
      const note = { uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff", number: "CN-0001", invoice: { uuid: draftUuid, number: "INV-0001" }, currency: "USD", amount: values.amount, applied: values.amount, reason: values.reason, issued_at: at }
      invoice!.credit_notes.push(note)
      invoice!.history.unshift({ at, action: "credit_note_issued", actor, description: null, amount: values.amount, note: values.reason, number: "CN-0001" })
      return json(route, { data: note }, 201)
    }

    return json(route, { message: `Unmocked ${method} ${path}` }, 404)
  })

  return { sent, staleNext: () => (staleNextSave = true) }
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

test("saves the operator's details and a tax rate, then gives an account the rate", async ({ page }) => {
  const { sent, staleNext } = await mockApi(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "Billing", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible()

  await page.getByRole("textbox", { name: "Legal name" }).fill("Example Operator Ltd")
  await page.getByRole("button", { name: "Save settings" }).click()
  await expect(page.getByText("Billing settings saved")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "PUT", body: { revision: 0, legal_name: "Example Operator Ltd", invoice_prefix: "INV-" } })

  staleNext()
  await page.getByRole("textbox", { name: "Tax registration number" }).fill("OP-123")
  await page.getByRole("button", { name: "Save settings" }).click()
  await expect(page.getByText("Someone else saved these settings")).toBeVisible()
  await page.getByRole("button", { name: "Load saved settings" }).click()
  await expect(page.getByText("Someone else saved these settings")).toHaveCount(0)

  await page.getByRole("button", { name: "Add tax rate" }).click()
  const dialog = page.getByRole("dialog", { name: "Add a tax rate" })
  await dialog.getByRole("textbox", { name: "Name" }).fill("Sales tax")
  await dialog.getByRole("textbox", { name: "Percentage" }).fill("8.255")
  await dialog.getByRole("button", { name: "Add tax rate" }).click()
  await expect(dialog.getByText("Enter a percentage from 0 to 100, with up to two decimals.")).toBeVisible()
  await dialog.getByRole("textbox", { name: "Percentage" }).fill("8.25")
  await dialog.getByRole("button", { name: "Add tax rate" }).click()
  await expect(page.getByText("Sales tax added")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ name: "Sales tax", basis_points: 825 })
  await expect(page.getByRole("row", { name: /Sales tax 8\.25% Active/ })).toBeVisible()

  await page.goto(`/billing-accounts/${harbour}`)
  await page.getByRole("button", { name: "Edit billing details" }).click()
  const details = page.getByRole("dialog", { name: "Billing details for Harbour Depot" })
  await details.getByRole("textbox", { name: "Billing address" }).fill("2 Customer Road")
  await details.getByRole("combobox", { name: "Tax rate" }).click()
  await page.getByRole("option", { name: "Sales tax · 8.25%" }).click()
  await details.getByRole("button", { name: "Save billing details" }).click()
  await expect(page.getByText("Billing details for Harbour Depot saved")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ billing_address: "2 Customer Road", tax_number: null, tax_rate_uuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
  await expect(page.getByRole("region", { name: "Billing details" }).getByText("Sales tax · 8.25%")).toBeVisible()
})

test("sets a plan's prices from next month and overrides one for an account", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto(`/plans/${plan}`)
  await expect(page.getByRole("region", { name: "Prices" }).getByText("$20.00")).toBeVisible()

  await page.getByRole("button", { name: "Set prices" }).click()
  const dialog = page.getByRole("dialog", { name: "Prices for Starter" })
  await expect(dialog.getByText(/Applies from/)).toBeVisible()
  await dialog.getByRole("textbox", { name: "Base price" }).fill("31")
  await dialog.getByRole("button", { name: /Apply from/ }).click()
  await expect(page.getByText(/Prices for Starter apply from/)).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ base_price: 3100, alert_overage_price: 50, data_point_overage_price: 200, data_point_block_size: 1000000 })
  await expect(page.getByRole("region", { name: "Prices" }).getByText(/\$31\.00 from/)).toBeVisible()

  await page.goto(`/billing-accounts/${harbour}`)
  await page.getByRole("button", { name: "Actions for Base price" }).click()
  await page.getByRole("menuitem", { name: "Override" }).click()
  const override = page.getByRole("dialog", { name: "Override base price" })
  await override.getByRole("textbox", { name: "Base price (USD)" }).fill("25")
  await override.getByRole("textbox", { name: "Note" }).fill("Agreed for the first year")
  await override.getByRole("button", { name: "Save override" }).click()
  await expect(page.getByText(/Base price for Harbour Depot changes from/)).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "PUT", path: `/api/v1/admin/billing-accounts/${harbour}/prices/base_price`, body: { value: 2500, note: "Agreed for the first year" } })
  await expect(page.getByRole("row", { name: /Base price .*Agreed for the first year/ })).toBeVisible()
})

test("drafts a waiting account's invoice anyway, adjusts it, issues it and credits it", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "Invoices" }).click()
  await expect(page.getByText("1 account has waited over 3 days for final usage")).toBeVisible()
  await page.getByRole("button", { name: "Show waiting accounts" }).click()
  await expect(page.getByRole("row", { name: /Harbour Depot October 2026 .* Waiting over 3 days/ })).toBeVisible()

  await page.getByRole("button", { name: "Actions for Harbour Depot" }).click()
  await page.getByRole("menuitem", { name: "Draft anyway" }).click()
  const draft = page.getByRole("dialog", { name: "Draft October 2026 anyway for Harbour Depot" })
  await draft.getByRole("textbox", { name: "Note" }).fill("Runtime is behind")
  await draft.getByRole("button", { name: "Draft invoice" }).click()
  await expect(page).toHaveURL(new RegExp(`/billing/invoices/${draftUuid}$`))
  expect(sent.at(-1)).toMatchObject({ method: "POST", body: { month: "2026-10", note: "Runtime is behind" } })
  await expect(page.getByRole("heading", { name: "Draft for October 2026" })).toBeVisible()
  await expect(page.getByText("Drafted before the month's usage was final")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alerts over the allowance 2 \$0\.50 \$1\.00/ })).toBeVisible()

  await page.getByRole("button", { name: "Add adjustment" }).click()
  const adjustment = page.getByRole("dialog", { name: "Add an adjustment" })
  await adjustment.getByRole("textbox", { name: "Description" }).fill("Credit for the outage")
  await adjustment.getByRole("textbox", { name: "Amount (USD)" }).fill("1")
  await adjustment.getByRole("textbox", { name: "Note" }).fill("Agreed on the phone")
  await adjustment.getByRole("button", { name: "Add adjustment" }).click()
  await expect(page.getByText("Credit of $1.00 added")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ description: "Credit for the outage", amount: -100, note: "Agreed on the phone" })
  await expect(page.getByRole("region", { name: "History" }).getByText("Added “Credit for the outage”, -$1.00: Agreed on the phone")).toBeVisible()

  await page.getByRole("button", { name: "Issue", exact: true }).click()
  const confirm = page.getByRole("alertdialog", { name: "Issue the October 2026 invoice for Harbour Depot?" })
  await expect(confirm.getByText(/cannot be changed after/)).toBeVisible()
  await confirm.getByRole("button", { name: "Issue invoice" }).click()
  await expect(page.getByText("Issued as INV-0001 and emailed")).toBeVisible()
  await expect(page.getByRole("heading", { name: "INV-0001" })).toBeVisible()
  await expect(page.getByText("Issued before the month's usage was final")).toBeVisible()
  await expect(page.getByText("Awaiting payment").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Add adjustment" })).toHaveCount(0)

  await page.getByRole("button", { name: "Credit note" }).click()
  const credit = page.getByRole("dialog", { name: "Credit note for INV-0001" })
  await credit.getByRole("textbox", { name: "Amount (USD)" }).fill("5")
  await credit.getByRole("textbox", { name: "Reason" }).fill("Partial outage")
  await credit.getByRole("button", { name: "Issue credit note" }).click()
  await expect(page.getByText("Credit note CN-0001 issued for $5.00")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ amount: 500, reason: "Partial outage" })
  await expect(page.getByRole("row", { name: /CN-0001 \$5\.00 \$5\.00 Partial outage/ })).toBeVisible()
  await page.getByRole("button", { name: "Actions for CN-0001" }).click()
  await expect(page.getByRole("menuitem", { name: "Download CSV" })).toHaveAttribute("href", /\/api\/v1\/admin\/billing\/credit-notes\/[0-9a-f-]+\.csv$/)
})

test("a draft made before usage was final asks to be recalculated once it is", async ({ page }) => {
  await mockApi(page, { usageFinal: true })
  await page.goto("/billing/invoices?tab=waiting")
  await page.getByRole("button", { name: "Actions for Harbour Depot" }).click()
  await page.getByRole("menuitem", { name: "Draft anyway" }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Note" }).fill("Runtime is behind")
  await page.getByRole("dialog").getByRole("button", { name: "Draft invoice" }).click()

  await expect(page.getByText("The month's usage is final now")).toBeVisible()
  await expect(page.getByText("· recalculate before issuing")).toBeVisible()
  await expect(page.getByRole("button", { name: "Issue", exact: true })).toBeDisabled()
})

test("a draft of the running month is a preview that cannot be issued yet", async ({ page }) => {
  const today = new Date()
  const running = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`
  await mockApi(page, { month: `${running}-01` })
  await page.goto("/billing/invoices?tab=waiting")
  await page.getByRole("button", { name: "Actions for Harbour Depot" }).click()
  await page.getByRole("menuitem", { name: "Draft anyway" }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Note" }).fill("A look at the month so far")
  await page.getByRole("dialog").getByRole("button", { name: "Draft invoice" }).click()

  await expect(page).toHaveURL(new RegExp(`/billing/invoices/${draftUuid}$`))
  await expect(page.getByText(/a preview until the month ends; issue from/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Issue", exact: true })).toBeDisabled()
})

test("checks a processing charge with Stripe, records a bank transfer and clears past due", async ({ page }) => {
  const { sent } = await mockApi(page, { issued: true, pastDue: true })
  await page.goto("/billing-accounts")
  await expect(page.getByRole("row", { name: /Harbour Depot Past due/ })).toBeVisible()
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "Payment" }).click()
  await page.getByRole("option", { name: "Past due" }).click()
  await expect(page).toHaveURL(/payment=past_due/)

  await page.goto(`/billing-accounts/${harbour}`)
  await expect(page.getByText("Past due").first()).toBeVisible()
  await expect(page.getByRole("region", { name: "Payment method" })).toContainText("Visa•••• 4242")

  await page.goto(`/billing/invoices/${draftUuid}`)
  const payments = page.getByRole("region", { name: "Payments" })
  await expect(payments.getByRole("row", { name: /Card, charged at issue \$20\.00 Processing/ })).toBeVisible()
  await page.getByRole("button", { name: "Check with Stripe" }).click()
  await expect(page.getByText("Checked with Stripe: payment failed")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "POST", path: `/api/v1/admin/billing/invoices/${draftUuid}/reconcile` })
  await expect(payments.getByRole("row", { name: /Failed Your card was declined\./ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Check with Stripe" })).toHaveCount(0)

  await page.getByRole("button", { name: "Record payment" }).click()
  const record = page.getByRole("dialog", { name: "Record a payment on INV-0001" })
  await expect(record.getByRole("textbox", { name: "Amount (USD)" })).toHaveValue("20.00")
  // How it was paid is required (FR-044).
  await expect(record.getByRole("textbox", { name: "Note" })).toHaveAttribute("required", "")
  await record.getByRole("textbox", { name: "Note" }).fill("Bank transfer 1234")
  await record.getByRole("textbox", { name: "Amount (USD)" }).fill("25")
  await record.getByRole("button", { name: "Record payment" }).click()
  await expect(record.getByText("Enter an amount above 0 and up to $20.00, what is still owed.")).toBeVisible()
  await record.getByRole("textbox", { name: "Amount (USD)" }).fill("20")
  await record.getByRole("button", { name: "Record payment" }).click()
  await expect(page.getByText("Payment of $20.00 recorded")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ amount: 2000, note: "Bank transfer 1234" })
  await expect(payments.getByRole("row", { name: /Recorded by hand \$20\.00 Succeeded Bank transfer 1234/ })).toBeVisible()
  await expect(page.getByText("Paid another way").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Record payment" })).toBeDisabled()
  await expect(page.getByRole("region", { name: "History" }).getByText("Recorded a payment of $20.00: Bank transfer 1234")).toBeVisible()

  await page.goto("/settings/billing")
  await expect(page.getByRole("group", { name: "Card payments" })).toContainText("Off")
})

test("invoice pages fit a phone without sideways scrolling", async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 375, height: 812 })

  for (const path of ["/billing/invoices", "/settings/billing", `/billing-accounts/${harbour}`]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
