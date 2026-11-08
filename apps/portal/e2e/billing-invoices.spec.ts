import AxeBuilder from "@axe-core/playwright"
import { test, expect, type Page } from "@playwright/test"

/** Invoices for billing account owners (spec 029 US6), against a mocked API: issued only, never drafts. */
const org = "a0000000-0000-4000-8000-000000000001"
const accountUuid = "d0000000-0000-4000-8000-000000000001"
const invoiceUuid = "f0000000-0000-4000-8000-000000000001"
const noteUuid = "f0000000-0000-4000-8000-000000000002"
const now = Date.now()
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

const invoice = {
  uuid: invoiceUuid,
  number: "INV-0001",
  status: "issued",
  month: "2026-10-01",
  billing_account: { uuid: accountUuid, name: "Example Integrations" },
  usage_incomplete: false,
  currency: "USD",
  subtotal: 2273,
  tax: 341,
  total: 2614,
  credit_applied: 0,
  amount_due: 2614,
  outstanding: 2114,
  due_at: ago(-14 * 86_400),
  payment_status: "pending",
  drafted_at: ago(86_400),
  issued_at: ago(3600),
}

const creditNote = {
  uuid: noteUuid,
  number: "CN-0001",
  invoice: { uuid: invoiceUuid, number: "INV-0001" },
  currency: "USD",
  amount: 500,
  applied: 500,
  reason: "Partial outage",
  issued_at: ago(600),
}

async function setup(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const organization = {
    uuid: org,
    name: "Corner Shop",
    slug: "corner-shop",
    capabilities: { manage_administration: false, devices: { view: true, manage: true, command: false } },
  }
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
            name: "Example Integrations",
            organization_limit: 10,
            organizations_count: 1,
            organizations: [{ uuid: org, name: "Corner Shop", created_at: ago(86_400), member: true }],
            plan: { uuid: "e0000000-0000-4000-8000-000000000001", name: "Example plan", since: ago(30 * 86_400) },
            allowances: [{ kind: "alerts", value: 1000, source: "plan", note: null }],
            usage: [],
            prices: {
              currency: "USD",
              current: { effective_from: "2026-11-01", base_price: 3100, alert_overage_price: 50, data_point_overage_price: 200, data_point_block_size: 1_000_000 },
              next: { effective_from: "2026-12-01", base_price: 3500, alert_overage_price: 50, data_point_overage_price: 200, data_point_block_size: 1_000_000 },
            },
            latest_invoice: invoice,
          },
        ],
      })
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices`) return json({ data: { invoices: [invoice], credit_notes: [creditNote] } })
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices/${invoiceUuid}`)
      return json({
        data: {
          ...invoice,
          draft_note: null,
          tax_rate_name: "Sales tax",
          tax_basis_points: 1500,
          operator_details: { legal_name: "Example Operator Ltd", address: null, tax_registration_number: null, invoice_footer: null },
          account_details: { name: "Example Integrations", contact_email: "billing@example.com", billing_address: "2 Customer Road", tax_number: null },
          lines: [
            { id: 1, position: 1, kind: "base_price", description: "Example plan · 9–31 Oct 2026 · 23 of 31 days at $31.00 a month", quantity: 23, unit_price: null, amount: 2300, period_start: "2026-10-09", period_end: "2026-10-31", note: null },
            { id: 2, position: 2, kind: "alert_overage", description: "Alerts over the allowance", quantity: 2, unit_price: 50, amount: 100, period_start: null, period_end: null, note: null },
            { id: 3, position: 3, kind: "adjustment", description: "Credit for the outage", quantity: 1, unit_price: null, amount: -127, period_start: null, period_end: null, note: null },
          ],
          usage: [{ organization_uuid: org, organization_name: "Corner Shop", kind: "alerts", count: 1002 }],
          credit_notes: [creditNote],
          payments: [],
          history: [],
        },
      })
    if (path === `/api/v1/billing-accounts/${accountUuid}/usage`) return json({ data: [] })
    if (path === `/api/v1/organizations/${org}/context`) return json({ data: organization })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: ago(0) } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return { errors }
}

test("an owner sees the plan's prices, issued invoices and credit notes, and opens one", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto("/billing")

  const plan = page.getByRole("region", { name: "Plan" })
  await expect(plan.getByRole("definition").filter({ hasText: "$31.00" })).toContainText("$35.00 from December 2026")

  const invoices = page.getByRole("region", { name: "Invoices" })
  await expect(invoices.getByRole("row", { name: /INV-0001 October 2026 \$26\.14 Awaiting payment/ })).toBeVisible()
  await expect(page.getByRole("region", { name: "Credit notes" }).getByRole("row", { name: /CN-0001 INV-0001 \$5\.00 Partial outage/ })).toBeVisible()

  await invoices.getByRole("button", { name: "Actions for INV-0001" }).click()
  await expect(page.getByRole("menuitem", { name: "Download PDF" })).toHaveAttribute(
    "href",
    new RegExp(`/api/v1/billing-accounts/${accountUuid}/invoices/${invoiceUuid}\\.pdf$`),
  )
  await expect(page.getByRole("menuitem", { name: "Download CSV" })).toHaveAttribute("href", /\.csv$/)
  await page.keyboard.press("Escape")

  await invoices.getByRole("button", { name: "INV-0001", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`invoice=${invoiceUuid}`))
  const sheet = page.getByRole("dialog", { name: "Invoice INV-0001" })
  await expect(sheet.getByText("Example Integrations · October 2026")).toBeVisible()
  await expect(sheet.getByText("2 × $0.50")).toBeVisible()
  await expect(sheet.getByText("Tax · Sales tax 15%")).toBeVisible()
  await expect(sheet.getByText("Credit for the outage")).toBeVisible()
  await expect(sheet.getByRole("link", { name: "PDF" })).toHaveAttribute("href", /\.pdf$/)
  await expect(sheet.getByRole("link", { name: "CN-0001" })).toHaveAttribute("href", new RegExp(`/credit-notes/${noteUuid}\\.pdf$`))
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])

  await page.keyboard.press("Escape")
  await expect(page).not.toHaveURL(/invoice=/)
  expect(errors).toEqual([])
})

test("an invoice link opens the invoice straight away", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/billing?invoice=${invoiceUuid}`)
  await expect(page.getByRole("dialog", { name: "Invoice INV-0001" })).toBeVisible()
  expect(errors).toEqual([])
})
