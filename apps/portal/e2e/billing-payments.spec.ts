import { test, expect, type Page } from "@playwright/test"

/** Card payments for billing account owners (spec 029 US7), against a mocked API and a stand-in for Stripe's pages. */
const org = "a0000000-0000-4000-8000-000000000001"
const accountUuid = "d0000000-0000-4000-8000-000000000001"
const unpaidUuid = "f0000000-0000-4000-8000-000000000001"
const paidUuid = "f0000000-0000-4000-8000-000000000002"
const stripe = "https://checkout.stripe.test"
const now = Date.now()
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

type Options = { enabled?: boolean; card?: boolean; pastDue?: boolean; failed?: boolean; processing?: boolean }

function invoiceOf(uuid: string, number: string, status: string, outstanding: number, processing = false) {
  return {
    uuid,
    number,
    payment_processing: processing,
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
    outstanding,
    due_at: ago(-14 * 86_400),
    payment_status: status,
    drafted_at: ago(86_400),
    issued_at: ago(3600),
  }
}

async function setup(page: Page, options: Options = {}) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const state = {
    card: options.card ?? false,
    // Stripe's event lands after the owner is back, on the second look.
    cardLooks: 0,
    paidLooks: 0,
    unpaidStatus: options.failed ? "failed" : "pending",
    posts: [] as string[],
    returnedWith: "",
  }
  const organization = {
    uuid: org,
    name: "Corner Shop",
    slug: "corner-shop",
    capabilities: { manage_administration: false, devices: { view: true, manage: true, command: false } },
  }
  await page.route(`${stripe}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<title>Stripe test page</title><h1>Stripe test page</h1>" }))
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (request.method() !== "GET") state.posts.push(`${request.method()} ${path}`)
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
    if (path === "/api/v1/billing-accounts") {
      if (options.card === false && state.posts.includes(`POST /api/v1/billing-accounts/${accountUuid}/payment-method/checkout`) && state.cardLooks++ >= 1) state.card = true
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
            prices: null,
            latest_invoice: null,
            payments_enabled: options.enabled ?? true,
            payment_method: state.card ? { brand: "visa", last_four: "4242", expires: "2030-12" } : null,
            past_due_since: options.pastDue ? ago(86_400) : null,
          },
        ],
      })
    }
    if (path === `/api/v1/billing-accounts/${accountUuid}/payment-method/checkout`) return json({ data: { url: `${stripe}/c/setup` } })
    if (path === `/api/v1/billing-accounts/${accountUuid}/payment-method` && request.method() === "DELETE") {
      state.card = false
      return route.fulfill({ status: 204 })
    }
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices/${unpaidUuid}/checkout`) return json({ data: { url: `${stripe}/c/pay` } })
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices/${unpaidUuid}/checkout/returned`) {
      // The API asks Stripe how the session stands: paid already, before Stripe's event.
      state.returnedWith = (JSON.parse(request.postData() ?? "{}") as { session?: string }).session ?? ""
      state.unpaidStatus = "paid"
      return route.fulfill({ status: 204 })
    }
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices`) {
      if (state.posts.includes(`POST /api/v1/billing-accounts/${accountUuid}/invoices/${unpaidUuid}/checkout`) && state.paidLooks++ >= 1) state.unpaidStatus = "paid"
      const unpaid = state.unpaidStatus === "paid" ? 0 : 2614
      return json({ data: { invoices: [invoiceOf(unpaidUuid, "INV-0002", state.unpaidStatus, unpaid, options.processing), invoiceOf(paidUuid, "INV-0001", "paid", 0)], credit_notes: [] } })
    }
    if (path === `/api/v1/billing-accounts/${accountUuid}/invoices/${unpaidUuid}`)
      return json({
        data: {
          ...invoiceOf(unpaidUuid, "INV-0002", state.unpaidStatus, state.unpaidStatus === "paid" ? 0 : 2614, options.processing),
          draft_note: null,
          tax_rate_name: null,
          tax_basis_points: null,
          operator_details: null,
          account_details: { name: "Example Integrations", contact_email: null, billing_address: null, tax_number: null },
          lines: [{ id: 1, position: 1, kind: "base_price", description: "Example plan · October 2026", quantity: 31, unit_price: null, amount: 2273, period_start: null, period_end: null, note: null }],
          usage: [],
          credit_notes: [],
          payments: options.failed
            ? [{ uuid: "c0000000-0000-4000-8000-000000000001", method: "card", amount: 2614, attempt: 1, status: "failed", failure_reason: "Your card was declined.", note: null, at: ago(3600) }]
            : [],
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
  return { errors, state }
}

test("an owner adds a card on Stripe's page and sees it once Stripe confirms it", async ({ page }) => {
  const { errors } = await setup(page, { card: false })
  await page.goto("/billing")
  const card = page.getByRole("region", { name: "Card" })
  await expect(card).toContainText("No card saved")

  await card.getByRole("button", { name: "Add card" }).click()
  await expect(page).toHaveURL(`${stripe}/c/setup`)
  await expect(page.getByRole("heading", { name: "Stripe test page" })).toBeVisible()

  // Stripe sends the owner back; its event arrives a moment later.
  await page.goto(`/billing?account=${accountUuid}&card=saved`)
  await expect(page.getByText("Visa •••• 4242 saved")).toBeVisible()
  await expect(card).toContainText("Visa •••• 4242")
  await expect(card).toContainText("Expires December 2030")
  await expect(page).not.toHaveURL(/card=saved/)
  expect(errors).toEqual([])
})

test("an owner pays an unpaid invoice on Stripe's page and replaces or removes the card", async ({ page }) => {
  const { errors, state } = await setup(page, { card: true })
  await page.goto("/billing")
  const invoices = page.getByRole("region", { name: "Invoices" })
  await expect(invoices.getByRole("row", { name: /INV-0002 .* Awaiting payment/ })).toBeVisible()
  await expect(invoices.getByRole("row", { name: /INV-0001/ }).getByRole("button", { name: /^Pay/ })).toHaveCount(0)

  await invoices.getByRole("button", { name: "Pay $26.14 for INV-0002" }).click()
  await expect(page).toHaveURL(`${stripe}/c/pay`)
  await page.goto(`/billing?account=${accountUuid}&invoice=${unpaidUuid}&paid=1`)
  await expect(page.getByText("Payment received for INV-0002")).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Invoice INV-0002" }).getByText("Paid")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(invoices.getByRole("row", { name: /INV-0002 .* Paid/ })).toBeVisible()

  const card = page.getByRole("region", { name: "Card" })
  await card.getByRole("button", { name: "Remove" }).click()
  await page.getByRole("alertdialog", { name: "Remove Visa •••• 4242?" }).getByRole("button", { name: "Remove card" }).click()
  await expect(page.getByText("Card removed")).toBeVisible()
  expect(state.posts).toContain(`DELETE /api/v1/billing-accounts/${accountUuid}/payment-method`)
  await expect(card.getByRole("button", { name: "Add card" })).toBeVisible()
  expect(errors).toEqual([])
})

test("back from Stripe's page with the session, the payment is looked up at once", async ({ page }) => {
  const { errors, state } = await setup(page, { card: true })
  await page.goto(`/billing?account=${accountUuid}&invoice=${unpaidUuid}&paid=1&session=cs_test_1`)
  await expect(page.getByText("Payment received for INV-0002")).toBeVisible()
  expect(state.posts).toContain(`POST /api/v1/billing-accounts/${accountUuid}/invoices/${unpaidUuid}/checkout/returned`)
  expect(state.returnedWith).toBe("cs_test_1")
  await expect(page).not.toHaveURL(/session=/)
  expect(errors).toEqual([])
})

test("an email's link opens a declined invoice with Pay focused, and past due restricts nothing", async ({ page }) => {
  const { errors } = await setup(page, { card: true, failed: true, pastDue: true })
  await page.goto(`/billing?account=${accountUuid}&invoice=${unpaidUuid}`)
  const sheet = page.getByRole("dialog", { name: "Invoice INV-0002" })
  await expect(sheet.getByRole("button", { name: "Pay $26.14" })).toBeFocused()
  await expect(sheet.getByText("Payment failed")).toBeVisible()
  await expect(sheet.getByText("Your card was declined.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByText("An invoice is unpaid past its due date")).toBeVisible()
  await expect(page.getByText("Nothing is restricted, and every device and dashboard keeps working.", { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})

test("while a charge is processing, the invoice says so and offers no Pay", async ({ page }) => {
  const { errors } = await setup(page, { card: true, processing: true })
  await page.goto(`/billing?account=${accountUuid}`)
  const row = page.getByRole("region", { name: "Invoices" }).getByRole("row", { name: /INV-0002/ })
  await expect(row).toContainText("Payment processing")
  await expect(row.getByRole("button", { name: /^Pay/ })).toHaveCount(0)

  await page.goto(`/billing?account=${accountUuid}&invoice=${unpaidUuid}`)
  const sheet = page.getByRole("dialog", { name: "Invoice INV-0002" })
  await expect(sheet.getByText("Payment processing")).toBeVisible()
  await expect(sheet.getByRole("button", { name: /^Pay/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("with payments off, no card or Pay is offered", async ({ page }) => {
  const { errors } = await setup(page, { enabled: false })
  await page.goto("/billing")
  await expect(page.getByRole("region", { name: "Invoices" }).getByRole("row", { name: /INV-0002/ })).toBeVisible()
  await expect(page.getByRole("region", { name: "Card" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0)
  await page.goto(`/billing?account=${accountUuid}&invoice=${unpaidUuid}`)
  await expect(page.getByRole("dialog", { name: "Invoice INV-0002" }).getByText("Awaiting payment")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0)
  expect(errors).toEqual([])
})
