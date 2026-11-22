import { expect, test as base, type Page, type Route } from "@playwright/test"

// Branding and portal addresses for platform staff (spec 036 US6), against a mocked API:
// the allowances, a brand edited on the owner's behalf, and Suspend and Restore.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_organizations: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

type Kind = "alerts" | "sms" | "devices" | "data_points" | "retention_days" | "organizations" | "branding" | "custom_domain" | "hide_powered_by"
type State = "waiting_dns" | "active" | "unreachable" | "suspended" | "lapsed"

const kinds: Kind[] = ["alerts", "sms", "devices", "data_points", "retention_days", "organizations", "branding", "custom_domain", "hide_powered_by"]
const defaults: Record<Kind, number | null> = {
  alerts: null,
  sms: 0,
  devices: null,
  data_points: null,
  retention_days: null,
  organizations: 1,
  branding: 0,
  custom_domain: 0,
  hide_powered_by: 0,
}

const acme = "11111111-1111-4111-8111-111111111111"
const borealis = "22222222-2222-4222-8222-222222222222"

type Address = {
  uuid: string
  account: string
  kind: "name" | "domain"
  host: string
  state: State
  /** Whether the domain's DNS record is in place, for what Restore finds. */
  record: boolean
  last_checked_at: string | null
  suspended_at: string | null
  /** A serving domain whose certificate is close to expiring. */
  certificate_expiring?: boolean
}

function fixtures() {
  const accounts = [
    { uuid: acme, name: "Acme Water", overrides: {} as Partial<Record<Kind, { value: number | null; note: string }>> },
    { uuid: borealis, name: "Borealis Power", overrides: { branding: { value: 1, note: "Agreed" } } as Partial<Record<Kind, { value: number | null; note: string }>> },
  ]
  const addresses: Address[] = [
    { uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", account: acme, kind: "name", host: "acme.example.com", state: "active", record: true, last_checked_at: null, suspended_at: null },
    {
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      account: acme,
      kind: "domain",
      host: "portal.example.org",
      state: "active",
      record: true,
      last_checked_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      suspended_at: null,
      certificate_expiring: true,
    },
    { uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", account: borealis, kind: "name", host: "borealis.example.com", state: "active", record: true, last_checked_at: null, suspended_at: null },
    {
      uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      account: borealis,
      kind: "domain",
      host: "view.example.net",
      state: "waiting_dns",
      record: false,
      last_checked_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      suspended_at: null,
    },
  ]
  return { accounts, addresses }
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

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body })

/** The mocked API, plus the requests the tests assert on. */
async function mockApi(page: Page) {
  const { accounts, addresses } = fixtures()
  const sent: { method: string; path: string; body: unknown }[] = []
  const lists: URLSearchParams[] = []
  const brand = { product_name: null as string | null, short_name: null as string | null, support_url: null as string | null, revision: 0 }

  const on = (uuid: string, kind: Kind) => accounts.find((account) => account.uuid === uuid)?.overrides[kind]?.value === 1
  const serves = (address: Address) =>
    (address.state === "active" || address.state === "unreachable") && on(address.account, "branding") && (address.kind === "name" || on(address.account, "custom_domain"))
  const main = (address: Address) => {
    const serving = addresses.filter((item) => item.account === address.account && item.state === "active" && serves(item))
    return (serving.find((item) => item.kind === "domain") ?? serving.find((item) => item.kind === "name")) === address
  }
  const shown = (address: Address) => ({
    uuid: address.uuid,
    kind: address.kind,
    host: address.host,
    url: `https://${address.host}`,
    state: address.state,
    main: main(address),
    claimed_at: "2026-11-20T08:00:00Z",
    activated_at: address.state === "waiting_dns" ? null : "2026-11-20T08:05:00Z",
    last_checked_at: address.last_checked_at,
    unreachable_since: null,
    suspended_at: address.suspended_at,
    record: address.kind === "domain" ? { type: "CNAME", name: address.host, value: "c-0123456789abcdef0123.example.com" } : null,
    lapses_at: address.state === "waiting_dns" ? "2026-11-27T08:00:00Z" : null,
    certificate_expires_at: address.certificate_expiring ? "2026-11-30T08:00:00Z" : null,
    certificate_expiring: address.certificate_expiring ?? false,
  })
  const forStaff = (address: Address) => ({
    ...shown(address),
    serving: serves(address),
    billing_account: { uuid: address.account, name: accounts.find((account) => account.uuid === address.account)?.name ?? "" },
    suspended_by_user_id: address.state === "suspended" ? superAdmin.id : null,
  })
  const accountDetail = (account: (typeof accounts)[number]) => {
    const allowances = kinds.map((kind) => {
      const override = account.overrides[kind]
      return override ? { kind, value: override.value, source: "override", note: override.note } : { kind, value: defaults[kind], source: "default", note: null }
    })
    return {
      uuid: account.uuid,
      name: account.name,
      contact_email: null,
      notes: null,
      organization_limit: 1,
      organizations_count: 0,
      created_at: "2026-11-01T08:00:00Z",
      plan_assignment: null,
      allowances,
      prices: null,
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

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/tickets/summary") return json(route, { data: { awaiting_team: 0 } })
    if (path === "/api/v1/admin/organizations") return json(route, paginated([], url))
    if (path === "/api/v1/admin/users") return json(route, paginated([], url))
    if (path === "/api/v1/admin/billing-plans") return json(route, paginated([], url))
    if (path === "/api/v1/admin/billing/invoices") return json(route, paginated([], url))

    if (path === "/api/v1/admin/portal-addresses") {
      lists.push(url.searchParams)
      const search = url.searchParams.get("search")?.toLowerCase() ?? ""
      const state = url.searchParams.get("state")
      const matches = addresses
        .map(forStaff)
        .filter((address) => !state || address.state === state)
        .filter((address) => address.host.includes(search) || address.billing_account.name.toLowerCase().includes(search))
        .sort((a, b) => a.host.localeCompare(b.host))
      return json(route, paginated(matches, url))
    }
    const action = path.match(/^\/api\/v1\/admin\/portal-addresses\/([^/]+)\/(suspend|restore)$/)
    if (action && method === "POST") {
      const address = addresses.find((item) => item.uuid === action[1])
      if (!address) return json(route, { message: "Not found." }, 404)
      if (action[2] === "suspend" && address.state !== "suspended") {
        address.state = "suspended"
        address.suspended_at = new Date().toISOString()
      } else if (action[2] === "restore" && address.state === "suspended") {
        // A name serves at once; a domain is checked again and waits when its record is gone.
        address.state = address.kind === "name" || address.record ? "active" : "waiting_dns"
        address.suspended_at = null
      }
      return json(route, { data: forStaff(address) })
    }

    const accountMatch = path.match(/^\/api\/v1\/admin\/billing-accounts\/([^/]+)(\/allowances\/([a-z_]+)|\/branding|\/brand)?$/)
    if (accountMatch) {
      const account = accounts.find((item) => item.uuid === accountMatch[1])
      if (!account) return json(route, { message: "Not found." }, 404)
      const inEffect = () => on(account.uuid, "branding") && brand.product_name !== null
      const shownBrand = () => ({ ...brand, logo: null, logo_dark: null, icon: null, in_effect: inEffect() })
      if (accountMatch[2] === "/branding")
        return json(route, {
          data: {
            brand: shownBrand(),
            addresses: addresses.filter((address) => address.account === account.uuid && address.state !== "lapsed").map(shown),
            allowances: { branding: on(account.uuid, "branding"), custom_domain: on(account.uuid, "custom_domain"), hide_powered_by: on(account.uuid, "hide_powered_by") },
            addresses_available: true,
            name_suffix: ".example.com",
            limits: { image_bytes: 1048576, types: ["image/png", "image/jpeg", "image/webp"], icon_min: 512 },
          },
        })
      if (accountMatch[2] === "/brand") {
        const values = body as { product_name: string | null; short_name: string | null; support_url: string | null; revision: number }
        Object.assign(brand, { product_name: values.product_name, short_name: values.short_name, support_url: values.support_url, revision: brand.revision + 1 })
        return json(route, { data: shownBrand() })
      }
      const kind = accountMatch[3] as Kind | undefined
      if (kind && method === "PUT") account.overrides[kind] = body as { value: number | null; note: string }
      if (kind && method === "DELETE") delete account.overrides[kind]
      return json(route, { data: accountDetail(account) })
    }
    if (path === "/api/v1/admin/billing-accounts") return json(route, paginated([], url))

    return json(route, { message: `Unmocked ${method} ${path}` }, 404)
  })

  return { sent, lists, addresses }
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
      expect(messages).toEqual([])
    },
    { auto: true },
  ],
})

/** Turns one of the three switches on through its override dialog. */
async function allow(page: Page, label: string) {
  await page.getByRole("button", { name: `Actions for ${label}` }).click()
  await page.getByRole("menuitem", { name: "Override" }).click()
  const dialog = page.getByRole("dialog", { name: `Override ${label.toLowerCase()}` })
  await dialog.getByRole("switch", { name: label }).click()
  await dialog.getByRole("textbox", { name: "Note" }).fill("Agreed with the integrator")
  await dialog.getByRole("button", { name: "Save override" }).click()
  await expect(page.getByText(`${label} for Acme Water is now On`)).toBeVisible()
}

test("turns the allowances on, edits the brand for the owner, then suspends and restores an address", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto(`/billing-accounts/${acme}`)

  // Before the allowance: the addresses are kept in their state, and the panel says they do not serve.
  const addresses = page.getByRole("region", { name: "Addresses" })
  const name = addresses.getByRole("row", { name: /acme\.example\.com/ })
  const domain = addresses.getByRole("row", { name: /portal\.example\.org/ })
  await expect(addresses.getByText("Branding is off, so these addresses do not open the portal")).toBeVisible()
  await expect(name).toContainText("Active")
  await expect(name).toContainText("Allowance off")
  await expect(name).toContainText("Not checked")
  await expect(domain).toContainText("Custom domain")
  await expect(domain).toContainText("Allowance off")

  await allow(page, "Branding")
  expect(sent.at(-1)).toEqual({ method: "PUT", path: `/api/v1/admin/billing-accounts/${acme}/allowances/branding`, body: { value: 1, note: "Agreed with the integrator" } })
  await expect(addresses.getByText("Branding is off, so these addresses do not open the portal")).toHaveCount(0)
  await expect(name).not.toContainText("Allowance off")
  await expect(name).toContainText("Main address")
  // The domain needs its own switch.
  await expect(domain).toContainText("Allowance off")
  await allow(page, "Custom domain")
  await expect(domain).not.toContainText("Allowance off")
  await expect(domain).toContainText("Main address")
  await expect(name).not.toContainText("Main address")

  // The brand, on the owner's behalf.
  const branding = page.getByRole("region", { name: "Branding" })
  await branding.getByRole("textbox", { name: "Product name" }).fill("Acme Monitor")
  await branding.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Brand of Acme Water saved")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ product_name: "Acme Monitor", short_name: null, support_url: null, revision: 0 })
  await expect(branding.getByText("Shown", { exact: true })).toBeVisible()

  // Suspending asks first, and says what it does.
  await addresses.getByRole("button", { name: "Actions for portal.example.org" }).click()
  await expect(page.getByRole("menuitem", { name: "Restore" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Suspend" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Suspend portal.example.org?" })
  await expect(confirm).toContainText("People signed in there are signed out.")
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(domain).toContainText("Active")

  await addresses.getByRole("button", { name: "Actions for portal.example.org" }).click()
  await page.getByRole("menuitem", { name: "Suspend" }).click()
  await confirm.getByRole("button", { name: "Suspend address" }).click()
  await expect(page.getByText("portal.example.org suspended")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/v1/admin/portal-addresses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/suspend" })
  await expect(domain).toContainText("Suspended")
  // Links fall back to the name while the domain is stopped.
  await expect(name).toContainText("Main address")

  await addresses.getByRole("button", { name: "Actions for portal.example.org" }).click()
  await expect(page.getByRole("menuitem", { name: "Suspend" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Restore" }).click()
  await expect(page.getByText("portal.example.org restored")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/v1/admin/portal-addresses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/restore" })
  await expect(domain).toContainText("Active")
  await expect(domain).toContainText("Main address")
})

test("lists every portal address, narrows the list, and suspends and restores from it", async ({ page }) => {
  const { sent, lists, addresses } = await mockApi(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "Portal addresses" }).click()
  await expect(page.getByRole("heading", { name: "Portal addresses" })).toBeVisible()

  const row = (host: string) => page.getByRole("row", { name: new RegExp(host.replaceAll(".", "\\.")) })
  await expect(page.getByRole("row")).toHaveCount(5)
  // Acme's Branding is off: its addresses keep their state and do not serve.
  await expect(row("acme.example.com")).toContainText("Name")
  await expect(row("acme.example.com")).toContainText("Acme Water")
  await expect(row("acme.example.com")).toContainText("Allowance off")
  await expect(row("borealis.example.com")).toContainText("Active")
  await expect(row("borealis.example.com")).not.toContainText("Allowance off")
  // A domain whose certificate is not renewing is marked, and no other address is.
  await expect(row("portal.example.org")).toContainText("Certificate expiring")
  await expect(page.getByText("Certificate expiring")).toHaveCount(1)
  await expect(row("view.example.net")).toContainText("Custom domain")
  await expect(row("view.example.net")).toContainText("Waiting for DNS")
  await expect(row("view.example.net")).toContainText("2 min ago")
  await expect(row("borealis.example.com").getByRole("link", { name: "Borealis Power" })).toHaveAttribute("href", `/billing-accounts/${borealis}`)

  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "State" }).click()
  await page.getByRole("option", { name: "Waiting for DNS" }).click()
  await expect(page).toHaveURL(/state=waiting_dns/)
  await expect(page.getByRole("row")).toHaveCount(2)
  await expect(row("view.example.net")).toBeVisible()
  expect(lists.at(-1)?.get("state")).toBe("waiting_dns")
  await page.keyboard.press("Escape")
  await page.goto("/portal-addresses")

  await page.getByRole("searchbox", { name: "Search" }).fill("borealis")
  await expect(page.getByRole("row")).toHaveCount(3)
  expect(lists.at(-1)?.get("search")).toBe("borealis")

  // A name: suspended at once, restored at once.
  await page.getByRole("button", { name: "Actions for borealis.example.com" }).click()
  await page.getByRole("menuitem", { name: "Suspend" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Suspend borealis.example.com?" })
  await expect(confirm).not.toContainText("signed out")
  await confirm.getByRole("button", { name: "Suspend address" }).click()
  await expect(page.getByText("borealis.example.com suspended")).toBeVisible()
  await expect(row("borealis.example.com")).toContainText("Suspended")
  await page.getByRole("button", { name: "Actions for borealis.example.com" }).click()
  await page.getByRole("menuitem", { name: "Restore" }).click()
  await expect(page.getByText("borealis.example.com restored")).toBeVisible()
  await expect(row("borealis.example.com")).toContainText("Active")

  // A custom domain whose record is not there waits for it again after Restore.
  expect(addresses.find((address) => address.host === "view.example.net")?.record).toBe(false)
  await page.getByRole("button", { name: "Actions for view.example.net" }).click()
  await page.getByRole("menuitem", { name: "Suspend" }).click()
  await page.getByRole("alertdialog", { name: "Suspend view.example.net?" }).getByRole("button", { name: "Suspend address" }).click()
  await expect(row("view.example.net")).toContainText("Suspended")
  await page.getByRole("button", { name: "Actions for view.example.net" }).click()
  await page.getByRole("menuitem", { name: "Restore" }).click()
  await expect(page.getByText("view.example.net restored. It is waiting for its DNS record")).toBeVisible()
  await expect(row("view.example.net")).toContainText("Waiting for DNS")
  expect(sent.map((request) => request.path.split("/").at(-1))).toEqual(["suspend", "restore", "suspend", "restore"])
})
