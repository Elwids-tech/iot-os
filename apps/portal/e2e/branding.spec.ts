import AxeBuilder from "@axe-core/playwright"
import { test, expect, type Page } from "@playwright/test"
import { mockBranding, ownPixel, pngFile, providerPixel, type MockAddress, type MockImage } from "./branding-mock"

/** Brands and logos in the portal (spec 036 US1 and US2), against a mocked API. */
const account = { uuid: "d0000000-0000-4000-8000-000000000001", name: "Example Integrations" }
const now = new Date().toISOString()
const overview = {
  devices: { active: 0, online: 0, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: 0, active_unacknowledged: 0, unacknowledged: 0, last_24_hours: 0, latest_active: [] },
  automations: { applied: 0 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
}

type Organization = {
  uuid: string
  name: string
  slug: string
  logo: MockImage | null
  logo_dark: MockImage | null
  brand: { product_name: string | null; logo: MockImage | null; logo_dark: MockImage | null }
  capabilities: Record<string, unknown>
}

const shop = (manage: boolean, provider: MockImage | null = null): Organization => ({
  uuid: "a0000000-0000-4000-8000-000000000001",
  name: "Corner Shop",
  slug: "corner-shop",
  logo: null,
  logo_dark: null,
  brand: { product_name: provider ? "Acme Monitor" : null, logo: provider, logo_dark: null },
  capabilities: { devices: { view: true, manage: true, command: true }, manage_administration: manage },
})

async function setup(
  page: Page,
  options: { allowed?: boolean; organization?: Organization; addressesDomain?: string; productName?: string; customDomain?: boolean; addresses?: MockAddress[] } = {},
) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const organizations = [options.organization ?? shop(true)]
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 7,
          name: "Owner Person",
          email: "owner@example.test",
          email_verified_at: now,
          capabilities: { platform_administration: false, billing_accounts: true },
          organizations,
        },
      })
    if (path === "/api/v1/billing-accounts")
      return json({
        data: [
          {
            ...account,
            plan: null,
            allowances: [],
            usage: [],
            organization_limit: 10,
            organizations_count: 1,
            organizations: [{ uuid: organizations[0].uuid, name: organizations[0].name, created_at: now, member: true }],
          },
        ],
      })
    if (/\/billing-accounts\/[0-9a-f-]{36}\/invoices$/.test(path)) return json({ data: { invoices: [], credit_notes: [] } })
    if (path.endsWith("/context")) return json({ data: organizations[0] })
    if (path.endsWith("/sites")) return json({ data: [], organization_timezone: null })
    if (path.endsWith("/overview")) return json({ data: overview })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: now } })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  const branding = await mockBranding(page, { allowed: options.allowed, organizations: () => organizations, addressesDomain: options.addressesDomain, productName: options.productName, customDomain: options.customDomain, addresses: options.addresses })
  return { errors, organizations, ...branding }
}

test("the Branding panel is locked while branding is not part of the plan", async ({ page }) => {
  const { errors, sent } = await setup(page, { allowed: false })
  await page.goto("/billing")

  const panel = page.getByRole("region", { name: "Branding" })
  await expect(panel.getByText("Branding is not part of your plan")).toBeVisible()
  await expect(panel.getByText("Contact the platform operator to add it.")).toBeVisible()
  // Nothing was ever saved, so there is nothing to show or edit.
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await expect(panel.getByRole("button")).toHaveCount(0)
  expect(sent).toEqual([])
  expect(errors).toEqual([])
})

test("an owner sets the brand, sees the preview, and a refused image says why", async ({ page }) => {
  const { errors, sent, state } = await setup(page, { allowed: true })
  await page.goto("/billing")

  const panel = page.getByRole("region", { name: "Branding" })
  await expect(panel.getByText("Not shown until it has a product name")).toBeVisible()
  await expect(panel.getByText("Sign in to IoT OS")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled()

  await panel.getByRole("textbox", { name: "Product name" }).fill("Acme Monitor")
  await expect(panel.getByText("Sign in to Acme Monitor")).toBeVisible()
  await expect(panel.getByRole("textbox", { name: "Short name" })).toHaveAttribute("placeholder", "Acme Monitor")
  await panel.getByRole("textbox", { name: "Short name" }).fill("Acme")
  await panel.getByRole("textbox", { name: "Support link" }).fill("mailto:help@example.org")
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Brand saved")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ product_name: "Acme Monitor", short_name: "Acme", support_url: "mailto:help@example.org", revision: 0 })
  await expect(panel.getByText("Shown", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled()

  // Images save when picked and show in the preview.
  await panel.getByLabel("Logo", { exact: true }).setInputFiles(pngFile("logo.png"))
  await expect(panel.getByRole("img", { name: "Current logo" })).toBeVisible()
  await expect(panel.getByRole("figure").getByRole("img", { name: "Acme Monitor" })).toHaveAttribute("src", providerPixel)
  expect(state.brand.revision).toBe(2)

  // The API's reason for a refusal shows under the field; so does a file the form itself refuses.
  await panel.getByLabel("Icon", { exact: true }).setInputFiles(pngFile("refused.png"))
  await expect(panel.getByText("Upload a PNG, JPEG or WebP image.")).toBeVisible()
  await panel.getByLabel("Icon", { exact: true }).setInputFiles({ name: "icon.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") })
  await expect(panel.getByText("Choose a PNG, JPEG or WebP image.")).toBeVisible()
  await panel.getByLabel("Icon", { exact: true }).setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(1048577) })
  await expect(panel.getByText("The image is larger than 1 MB.")).toBeVisible()
  expect(state.brand.icon).toBeNull()

  await panel.getByRole("button", { name: "Remove" }).click()
  await expect(panel.getByRole("img", { name: "Current logo" })).toHaveCount(0)

  // Someone else saved meanwhile: the draft is kept until Reload.
  state.brand.revision = 9
  state.brand.product_name = "Acme Cloud"
  await panel.getByRole("textbox", { name: "Product name" }).fill("Acme Monitoring")
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(panel.getByText("The brand was changed by someone else")).toBeVisible()
  await expect(panel.getByRole("textbox", { name: "Product name" })).toHaveValue("Acme Monitoring")
  await panel.getByRole("button", { name: "Reload" }).click()
  await expect(panel.getByRole("textbox", { name: "Product name" })).toHaveValue("Acme Cloud")

  const results = await new AxeBuilder({ page }).include("[aria-labelledby=billing-branding]").analyze()
  expect(results.violations).toEqual([])
  expect(errors).toEqual([])
})

test("an organization shows its provider's logo until it has its own", async ({ page }) => {
  const provider = { url: providerPixel, width: 480, height: 120 }
  const { errors } = await setup(page, { allowed: true, organization: shop(true, provider) })
  await page.goto(`/organizations/${shop(true).uuid}/settings/general`)

  // The sidebar shows the provider's logo with the organization's name under it.
  const switcher = page.getByRole("button", { name: "Organization: Corner Shop" })
  await expect(switcher.locator("img").first()).toHaveAttribute("src", providerPixel)
  await expect(switcher.getByText("Corner Shop")).toBeVisible()

  const panel = page.getByRole("region", { name: "Organization logo" })
  await expect(panel.getByText("Without one, the logo of the organization's provider is shown.", { exact: false })).toBeVisible()
  await panel.getByLabel("Logo", { exact: true }).setInputFiles(pngFile("refused.png"))
  await expect(panel.getByText("Upload a PNG, JPEG or WebP image.")).toBeVisible()

  await panel.getByLabel("Logo", { exact: true }).setInputFiles(pngFile("logo.png"))
  await expect(page.getByText("Logo saved")).toBeVisible()
  await expect(panel.getByRole("img", { name: "Current logo" })).toHaveAttribute("src", ownPixel)
  await expect(switcher.locator("img").first()).toHaveAttribute("src", ownPixel)

  // Removing it falls back to the provider's.
  await panel.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("Logo removed")).toBeVisible()
  await expect(switcher.locator("img").first()).toHaveAttribute("src", providerPixel)

  const results = await new AxeBuilder({ page }).include("[aria-labelledby=organization-logo-title]").analyze()
  expect(results.violations).toEqual([])
  expect(errors).toEqual([])
})

test("without a logo the sidebar keeps the initial, and a member cannot change the logo", async ({ page }) => {
  const { errors, sent } = await setup(page, { organization: shop(false) })
  await page.goto(`/organizations/${shop(false).uuid}/settings/general`)

  const switcher = page.getByRole("button", { name: "Organization: Corner Shop" })
  await expect(switcher.locator("img")).toHaveCount(0)
  await expect(switcher.getByText("Corner Shop")).toBeVisible()

  const panel = page.getByRole("region", { name: "Organization logo" })
  await expect(panel.getByText("Only people who may update the organization can change it.", { exact: false })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Upload" }).first()).toBeDisabled()
  await expect(panel.getByRole("button", { name: "Remove" })).toHaveCount(0)
  expect(sent).toEqual([])
  expect(errors).toEqual([])
})

test("the Addresses panel says why when the deployment or the plan has no addresses", async ({ page }) => {
  const { errors } = await setup(page, { allowed: true, productName: "Acme Monitor" })
  await page.goto("/billing")
  const panel = page.getByRole("region", { name: "Addresses" })
  await expect(panel.getByText("Addresses are not available on this deployment")).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(0)

  await setup(page, { allowed: false, addressesDomain: "example.com" })
  await page.reload()
  await expect(panel.getByText("Addresses come with branding, which is not part of your plan")).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("an owner claims a name, is told when one is taken, renames it and removes it", async ({ page }) => {
  const { errors, sent } = await setup(page, { allowed: true, addressesDomain: "example.com", productName: "Acme Monitor" })
  await page.goto("/billing")

  const panel = page.getByRole("region", { name: "Addresses" })
  const name = panel.getByRole("textbox", { name: "Name" })
  await expect(panel.getByText(".example.com")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Claim address" })).toBeDisabled()

  await name.fill("taken")
  await panel.getByRole("button", { name: "Claim address" }).click()
  await expect(panel.getByText("This name is taken. Choose another.")).toBeVisible()
  await expect(name).toHaveAttribute("aria-invalid", "true")

  await name.fill("acme")
  await expect(panel.getByText("This name is taken. Choose another.")).toHaveCount(0)
  await panel.getByRole("button", { name: "Claim address" }).click()
  await expect(page.getByText("acme.example.com is ready")).toBeVisible()
  await expect(panel.getByRole("link", { name: "acme.example.com" })).toHaveAttribute("href", "https://acme.example.com")
  await expect(panel.getByText("Active", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Change address" })).toBeDisabled()

  await panel.getByRole("textbox", { name: "Change the name" }).fill("acme-monitor")
  await panel.getByRole("button", { name: "Change address" }).click()
  await expect(page.getByText("Address changed to acme-monitor.example.com")).toBeVisible()
  expect(sent.filter((request) => request.method === "PUT").map((request) => request.body)).toEqual([{ name: "taken" }, { name: "acme" }, { name: "acme-monitor" }])

  const results = await new AxeBuilder({ page }).include('section[aria-labelledby="billing-addresses"]').analyze()
  expect(results.violations).toEqual([])

  await panel.getByRole("button", { name: "Remove" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Remove acme-monitor.example.com?" })
  await expect(dialog.getByText("The name is held for 30 days")).toBeVisible()
  await dialog.getByRole("button", { name: "Remove address" }).click()
  await expect(page.getByText("acme-monitor.example.com removed")).toBeVisible()
  await expect(panel.getByRole("link")).toHaveCount(0)
  await expect(panel.getByRole("textbox", { name: "Name" })).toHaveValue("")
  expect(errors).toEqual([])
})

test("a name waits for the brand's product name", async ({ page }) => {
  const { errors } = await setup(page, { allowed: true, addressesDomain: "example.com" })
  await page.goto("/billing")
  const panel = page.getByRole("region", { name: "Addresses" })
  await expect(panel.getByText("Save a product name in Branding first")).toBeVisible()
  await expect(panel.getByRole("textbox", { name: "Name" })).toBeDisabled()
  expect(errors).toEqual([])
})

test("an owner adds their own domain, sees the record to add, and it turns active when the record is found", async ({ page }) => {
  const { errors, sent, state } = await setup(page, { allowed: true, customDomain: true, addressesDomain: "example.com", productName: "Acme Monitor" })
  await page.goto("/billing")

  const section = page.getByRole("region", { name: "Use your own domain" })
  const domain = section.getByRole("textbox", { name: "Domain" })
  await expect(section.getByRole("button", { name: "Add domain" })).toBeDisabled()

  await domain.fill("example.org")
  await section.getByRole("button", { name: "Add domain" }).click()
  await expect(section.getByText("Use a subdomain such as portal.example.org.")).toBeVisible()
  await expect(domain).toHaveAttribute("aria-invalid", "true")

  await domain.fill("taken.example.org")
  await section.getByRole("button", { name: "Add domain" }).click()
  await expect(section.getByText("This domain is already in use.")).toBeVisible()

  await domain.fill("Portal.Example.org")
  await section.getByRole("button", { name: "Add domain" }).click()
  await expect(page.getByText("Add the DNS record for portal.example.org")).toBeVisible()
  await expect(section.getByText("Waiting for DNS")).toBeVisible()
  const record = section.getByLabel("DNS record")
  await expect(record.getByText("CNAME")).toBeVisible()
  await expect(record.getByText("c-0123456789abcdef0123.example.com")).toBeVisible()
  await expect(section.getByText("the request lapses on")).toBeVisible()
  await expect(section.getByRole("button", { name: "Copy record value" })).toBeVisible()

  // The record is not there yet: the check says so and the state stays.
  await section.getByRole("button", { name: "Check now" }).click()
  await expect(page.getByText("The DNS record was not found yet")).toBeVisible()
  await expect(section.getByText("Waiting for DNS")).toBeVisible()

  const results = await new AxeBuilder({ page }).include('section[aria-labelledby="billing-addresses"]').analyze()
  expect(results.violations).toEqual([])

  state.recordFound = true
  await section.getByRole("button", { name: "Check now" }).click()
  await expect(page.getByText("portal.example.org is active")).toBeVisible()
  await expect(section.getByText("Active", { exact: true })).toBeVisible()
  await expect(section.getByText("Main address")).toBeVisible()
  await expect(section.getByRole("link", { name: "portal.example.org" })).toHaveAttribute("href", "https://portal.example.org")

  await section.getByRole("button", { name: "Remove" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Remove portal.example.org?" })
  await expect(dialog.getByText("it then needs a new DNS record")).toBeVisible()
  await dialog.getByRole("button", { name: "Remove address" }).click()
  await expect(page.getByText("portal.example.org removed")).toBeVisible()
  await expect(section.getByRole("textbox", { name: "Domain" })).toHaveValue("")
  expect(sent.filter((request) => request.path.endsWith("/addresses/domain")).map((request) => request.body)).toEqual([
    { host: "example.org" },
    { host: "taken.example.org" },
    { host: "Portal.Example.org" },
  ])
  expect(errors).toEqual([])
})

test("the own-domain section says when the plan has none, when a request lapsed and when the record went missing", async ({ page }) => {
  const base = { claimed_at: now, activated_at: null, last_checked_at: now, unreachable_since: null, suspended_at: null, lapses_at: null }
  const record = { type: "CNAME" as const, name: "portal.example.org", value: "c-0123456789abcdef0123.example.com" }
  const { errors } = await setup(page, { allowed: true, addressesDomain: "example.com", productName: "Acme Monitor" })
  await page.goto("/billing")
  const section = page.getByRole("region", { name: "Use your own domain" })
  await expect(section.getByText("Your own domain is not part of your plan")).toBeVisible()
  await expect(section.getByRole("textbox")).toHaveCount(0)

  await setup(page, {
    allowed: true, customDomain: true, addressesDomain: "example.com", productName: "Acme Monitor",
    addresses: [{ ...base, uuid: "ad000000-0000-4000-8000-000000000003", kind: "domain", host: "portal.example.org", url: "https://portal.example.org", state: "lapsed", main: false, record }],
  })
  await page.reload()
  await expect(section.getByText("The request for portal.example.org lapsed")).toBeVisible()
  await expect(section.getByRole("textbox", { name: "Domain" })).toBeEnabled()

  await setup(page, {
    allowed: true, customDomain: true, addressesDomain: "example.com", productName: "Acme Monitor",
    addresses: [{ ...base, uuid: "ad000000-0000-4000-8000-000000000003", kind: "domain", host: "portal.example.org", url: "https://portal.example.org", state: "unreachable", main: false, activated_at: now, unreachable_since: now, record }],
  })
  await page.reload()
  await expect(section.getByText("Not reachable")).toBeVisible()
  await expect(section.getByText("The DNS record has been missing since")).toBeVisible()
  await expect(section.getByText("The portal still opens at portal.example.org for now")).toBeVisible()
  expect(errors).toEqual([])
})
