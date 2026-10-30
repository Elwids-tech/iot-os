import { expect, test as base, type Page, type Route } from "@playwright/test"

// Billing accounts in the admin app (spec 023 US1 and US2), against a mocked API.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const pat = { id: 2, name: "Pat Example", email: "pat@example.com" }
const sam = { id: 3, name: "Sam Example", email: "sam@example.com" }

type Account = {
  uuid: string
  name: string
  contact_email: string | null
  notes: string | null
  organization_limit: number
  owners: { id: number; name: string; email: string; added_at: string | null }[]
  created_at: string
}

type Organization = {
  uuid: string
  name: string
  slug: string
  users_count: number
  devices_count: number
  billing_account?: { uuid: string; name: string }
}

const integrations = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const harbour = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const spare = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function fixtures() {
  const accounts: Account[] = [
    {
      uuid: integrations,
      name: "Example Integrations",
      contact_email: "billing@example.com",
      notes: null,
      organization_limit: 10,
      owners: [{ ...pat, added_at: "2026-10-30T09:00:00Z" }],
      created_at: "2026-10-30T08:00:00Z",
    },
    {
      uuid: harbour,
      name: "Harbour Depot",
      contact_email: null,
      notes: null,
      organization_limit: 1,
      owners: [],
      created_at: "2026-10-30T08:00:00Z",
    },
    {
      uuid: spare,
      name: "Spare Account",
      contact_email: null,
      notes: null,
      organization_limit: 1,
      owners: [],
      created_at: "2026-10-30T08:00:00Z",
    },
  ]
  const organizations: Organization[] = [
    {
      uuid: "11111111-1111-4111-8111-111111111111",
      name: "Acme Manufacturing",
      slug: "acme-manufacturing",
      users_count: 3,
      devices_count: 6,
      billing_account: { uuid: integrations, name: "Example Integrations" },
    },
    {
      uuid: "22222222-2222-4222-8222-222222222222",
      name: "Northstar Utilities",
      slug: "northstar-utilities",
      users_count: 2,
      devices_count: 0,
      billing_account: { uuid: harbour, name: "Harbour Depot" },
    },
  ]
  return { accounts, organizations }
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

/** The mocked API, plus the request bodies the tests assert on. */
async function mockApi(page: Page) {
  const { accounts, organizations } = fixtures()
  const sent: { method: string; path: string; body: unknown }[] = []
  const members = (uuid: string) => organizations.filter((organization) => organization.billing_account?.uuid === uuid)
  const summary = (account: Account) => ({
    ...account,
    organizations_count: members(account.uuid).length,
  })
  const detail = (account: Account) => ({
    ...summary(account),
    organizations: members(account.uuid).map(({ billing_account: _, ...organization }) => ({
      ...organization,
      assigned_at: "2026-10-30T08:00:00Z",
    })),
    history: [
      {
        at: "2026-10-30T10:00:00Z",
        action: "updated",
        actor: { id: 1, name: "Platform Super Admin" },
        changes: [{ field: "organization_limit", from: "1", to: String(account.organization_limit) }],
      },
      {
        at: "2026-10-30T08:00:00Z",
        action: "organization_joined",
        actor: null,
        organization: { uuid: "11111111-1111-4111-8111-111111111111", name: "Acme Manufacturing" },
      },
    ],
  })

  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON?.() ?? null
    if (method !== "GET") sent.push({ method, path, body })
    const search = url.searchParams.get("search")?.toLowerCase() ?? ""
    const accountMatch = path.match(/^\/api\/v1\/admin\/billing-accounts\/([^/]+)$/)
    const ownerMatch = path.match(/^\/api\/v1\/admin\/billing-accounts\/([^/]+)\/owners\/(\d+)$/)
    const moveMatch = path.match(/^\/api\/v1\/admin\/organizations\/([^/]+)\/billing-account$/)

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/tickets/summary") return json(route, { data: { awaiting_team: 0 } })

    if (path === "/api/v1/admin/organizations" && method === "GET") {
      return json(route, paginated(organizations.filter((item) => item.name.toLowerCase().includes(search)), url))
    }
    if (path === "/api/v1/admin/organizations" && method === "POST") {
      const values = body as { name: string; slug: string; billing_account_uuid?: string; new_billing_account?: { name: string } }
      let account = accounts.find((item) => item.uuid === values.billing_account_uuid)
      if (!account) {
        account = {
          uuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: values.new_billing_account?.name ?? values.name,
          contact_email: null,
          notes: null,
          organization_limit: 1,
          owners: [],
          created_at: "2026-10-30T11:00:00Z",
        }
        accounts.push(account)
      }
      const organization = {
        uuid: "33333333-3333-4333-8333-333333333333",
        name: values.name,
        slug: values.slug,
        users_count: 0,
        devices_count: 0,
        billing_account: { uuid: account.uuid, name: account.name },
      }
      organizations.push(organization)
      return json(route, { data: organization }, 201)
    }
    if (moveMatch && method === "PUT") {
      const organization = organizations.find((item) => item.uuid === moveMatch[1])!
      const target = accounts.find((item) => item.uuid === (body as { billing_account_uuid: string }).billing_account_uuid)!
      organization.billing_account = { uuid: target.uuid, name: target.name }
      return route.fulfill({ status: 204 })
    }

    if (path === "/api/v1/admin/billing-accounts" && method === "GET") {
      const matches = accounts.filter(
        (item) => item.name.toLowerCase().includes(search) || (item.contact_email ?? "").includes(search),
      )
      return json(route, paginated(matches.map(summary), url))
    }
    if (path === "/api/v1/admin/billing-accounts" && method === "POST") {
      const values = body as { name: string; organization_limit: number }
      const account: Account = {
        uuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: values.name,
        contact_email: null,
        notes: null,
        organization_limit: values.organization_limit,
        owners: [],
        created_at: "2026-10-30T11:00:00Z",
      }
      accounts.push(account)
      return json(route, { data: detail(account) }, 201)
    }
    if (accountMatch) {
      const account = accounts.find((item) => item.uuid === accountMatch[1])
      if (!account) return json(route, { message: "Not found." }, 404)
      if (method === "GET") return json(route, { data: detail(account) })
      if (method === "PATCH") {
        Object.assign(account, body)
        return json(route, { data: detail(account) })
      }
      if (method === "DELETE") {
        const count = members(account.uuid).length
        if (count > 0) {
          return json(route, { message: `Move this billing account's ${count} organizations before deleting it.` }, 409)
        }
        accounts.splice(accounts.indexOf(account), 1)
        return route.fulfill({ status: 204 })
      }
    }
    if (ownerMatch) {
      const account = accounts.find((item) => item.uuid === ownerMatch[1])!
      const user = [pat, sam].find((item) => item.id === Number(ownerMatch[2]))!
      if (method === "PUT") {
        if (!account.owners.some((owner) => owner.id === user.id)) {
          account.owners.push({ ...user, added_at: "2026-10-30T11:00:00Z" })
        }
        return json(route, { data: account.owners })
      }
      account.owners = account.owners.filter((owner) => owner.id !== user.id)
      return route.fulfill({ status: 204 })
    }
    if (path === "/api/v1/admin/users") {
      const users = [pat, sam].map((user) => ({ ...user, is_super_admin: false, platform_roles: [], organizations: [] }))
      return json(route, paginated(users.filter((user) => user.name.toLowerCase().includes(search)), url))
    }

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
      expect(messages).toEqual([])
    },
    { auto: true },
  ],
})

async function choose(page: Page, combobox: string, option: RegExp) {
  await page.getByRole("combobox", { name: combobox }).click()
  await page.getByRole("option", { name: option }).click()
}

test("creates an organization with a new billing account named after it", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Corner Shop")
  await expect(dialog.getByRole("textbox", { name: "Account name" })).toHaveValue("Corner Shop")
  await dialog.getByRole("textbox", { name: "Billing contact email" }).fill("shop@example.com")
  await dialog.getByRole("button", { name: "Create organization" }).click()

  await expect(page.getByText("Corner Shop created")).toBeVisible()
  await expect(page.getByRole("row", { name: /Corner Shop corner-shop/ }).getByRole("link", { name: "Corner Shop", exact: true })).toHaveAttribute(
    "href",
    "/billing-accounts/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  )
  expect(sent.at(-1)?.body).toEqual({
    name: "Corner Shop",
    slug: "corner-shop",
    new_billing_account: { name: "Corner Shop", contact_email: "shop@example.com" },
  })
})

test("creates an organization under an existing account and warns when it is at its limit", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "New organization" }).click()
  const dialog = page.getByRole("dialog", { name: "New organization" })
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Harbour Annex")
  await dialog.getByText("Existing billing account").click()
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(dialog.getByText("Choose a billing account.")).toBeVisible()

  await choose(page, "Account", /Harbour Depot · 1 of 1 organization/)
  await expect(dialog.getByText("Harbour Depot already has 1 of 1 organization.")).toBeVisible()
  await dialog.getByRole("button", { name: "Create organization" }).click()

  await expect(page.getByText("Harbour Annex created")).toBeVisible()
  expect(sent.at(-1)?.body).toEqual({ name: "Harbour Annex", slug: "harbour-annex", billing_account_uuid: harbour })

  await page.getByRole("link", { name: "Billing accounts" }).click()
  await expect(page.getByRole("row", { name: /Harbour Depot 2 organizations, limit 1/ })).toBeVisible()
})

test("lists billing accounts and creates one", async ({ page }) => {
  await mockApi(page)
  await page.goto("/organizations")
  await page.getByRole("link", { name: "Billing accounts" }).click()

  await expect(page.getByRole("heading", { name: "Billing accounts" })).toBeVisible()
  await expect(page.getByRole("row", { name: /Example Integrations 1 of 10 organizations Pat Example billing@example.com/ })).toBeVisible()
  await page.getByRole("searchbox", { name: "Search" }).fill("harbour")
  await expect(page.getByRole("row", { name: /Example Integrations/ })).toHaveCount(0)
  await expect(page.getByRole("row", { name: /Harbour Depot/ })).toBeVisible()

  await page.getByRole("button", { name: "New billing account" }).click()
  const dialog = page.getByRole("dialog", { name: "New billing account" })
  await dialog.getByRole("textbox", { name: "Name" }).fill("Lakeside Group")
  await dialog.getByRole("spinbutton", { name: "Organization limit" }).fill("5")
  await dialog.getByRole("button", { name: "Create billing account" }).click()

  await expect(page.getByText("Lakeside Group created")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Lakeside Group" })).toBeVisible()
  await expect(page.getByText("0 of 5 organizations")).toBeVisible()
})

test("deletes only an empty billing account", async ({ page }) => {
  await mockApi(page)
  await page.goto("/billing-accounts")

  await page.getByRole("button", { name: "Actions for Example Integrations" }).click()
  await expect(page.getByRole("menuitem", { name: "Delete: move its organizations first" })).toBeDisabled()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Actions for Spare Account" }).click()
  await page.getByRole("menuitem", { name: "Delete billing account" }).click()
  await page.getByRole("alertdialog", { name: "Delete Spare Account?" }).getByRole("button", { name: "Delete billing account" }).click()

  await expect(page.getByText("Spare Account deleted")).toBeVisible()
  await expect(page.getByRole("row", { name: /Spare Account/ })).toHaveCount(0)
})

test("edits an account, manages its owners and shows its history", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto(`/billing-accounts/${integrations}`)

  await expect(page.getByRole("heading", { name: "Example Integrations" })).toBeVisible()
  await expect(page.getByText("Platform Super Admin · Changed organization limit from 1 to 10")).toBeVisible()
  await expect(page.getByText("System · Acme Manufacturing joined")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Manufacturing acme-manufacturing 3 6/ })).toBeVisible()

  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByRole("spinbutton", { name: "Organization limit" }).fill("12")
  await page.getByRole("button", { name: "Save billing account" }).click()
  await expect(page.getByText("Example Integrations saved")).toBeVisible()
  await expect(page.getByText("1 of 12 organizations")).toBeVisible()

  await choose(page, "Add an owner", /Sam Example · sam@example.com/)
  await expect(page.getByText("Sam Example can now see Example Integrations")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "PUT", path: `/api/v1/admin/billing-accounts/${integrations}/owners/3` })

  await page.getByRole("button", { name: "Remove Pat Example as an owner" }).click()
  await page.getByRole("alertdialog", { name: "Remove Pat Example as an owner?" }).getByRole("button", { name: "Remove owner" }).click()
  await expect(page.getByText("Pat Example is no longer an owner")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({ method: "DELETE", path: `/api/v1/admin/billing-accounts/${integrations}/owners/2` })
})

test("moves an organization to another billing account from either page", async ({ page }) => {
  const { sent } = await mockApi(page)
  await page.goto("/organizations")

  await page.getByRole("button", { name: "Actions for Northstar Utilities" }).click()
  await page.getByRole("menuitem", { name: "Change billing account" }).click()
  const dialog = page.getByRole("dialog", { name: "Change billing account" })
  await expect(dialog.getByText("Northstar Utilities belongs to Harbour Depot.", { exact: false })).toBeVisible()
  await page.getByRole("combobox", { name: "New billing account" }).click()
  await expect(page.getByRole("option", { name: /Harbour Depot/ })).toHaveCount(0)
  await page.getByRole("option", { name: /Example Integrations/ }).click()
  await dialog.getByRole("button", { name: "Move organization" }).click()

  await expect(page.getByText("Northstar Utilities moved to Example Integrations")).toBeVisible()
  expect(sent.at(-1)).toMatchObject({
    method: "PUT",
    path: "/api/v1/admin/organizations/22222222-2222-4222-8222-222222222222/billing-account",
    body: { billing_account_uuid: integrations },
  })
  await expect(page.getByRole("row", { name: /Northstar Utilities/ }).getByRole("link", { name: "Example Integrations" })).toBeVisible()

  await page.goto(`/billing-accounts/${integrations}`)
  await page.getByRole("button", { name: "Actions for Acme Manufacturing" }).click()
  await page.getByRole("menuitem", { name: "Change billing account" }).click()
  await choose(page, "New billing account", /Spare Account/)
  await page.getByRole("button", { name: "Move organization" }).click()
  await expect(page.getByText("Acme Manufacturing moved to Spare Account")).toBeVisible()
  await expect(page.getByRole("row", { name: /Acme Manufacturing/ })).toHaveCount(0)
})

test("an unknown billing account shows that it was not found", async ({ page, consoleMessages }) => {
  await mockApi(page)
  await page.goto("/billing-accounts/ffffffff-ffff-4fff-8fff-ffffffffffff")

  await expect(page.getByText("Billing account not found")).toBeVisible()
  expect(consoleMessages.every((message) => message.includes("404"))).toBe(true)
  consoleMessages.length = 0
})

test("billing account pages fit a phone without sideways scrolling", async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 375, height: 812 })

  for (const path of ["/billing-accounts", `/billing-accounts/${integrations}`]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
