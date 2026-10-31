import { expect, test, type Page, type Route } from "@playwright/test"

// The activity log in the admin app (spec 024 US1 and US2), against a mocked API.

const superAdmin = {
  id: 1,
  name: "Platform Super Admin",
  email: "super-admin@example.test",
  email_verified_at: "2026-08-24T00:00:00.000000Z",
  is_super_admin: true,
  capabilities: { platform_administration: true, manage_assistant: true, manage_tickets: false },
  organizations: [],
}

const ana = { id: 7, name: "Ana Silva", email: "ana@example.com" }
const ben = { id: 8, name: "Ben Perera", email: "ben@example.com" }
const acme = { uuid: "11111111-1111-4111-8111-111111111111", name: "Acme Manufacturing", slug: "acme-manufacturing", users_count: 3, devices_count: 2 }
const northstar = { uuid: "22222222-2222-4222-8222-222222222222", name: "Northstar Utilities", slug: "northstar-utilities", users_count: 2, devices_count: 0 }

type Event = {
  id: number
  action: string
  summary: string
  at: string
  actor: { id: number; name: string | null; email: string | null }
  organization: { uuid: string; name: string } | null
  subject: { type: string | null; uuid: string | null; name: string | null } | null
  changes: { field: string; from: string | string[] | null; to: string | string[] | null; opaque: boolean }[]
  details: { key: string; value: string }[]
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function events(): Event[] {
  return [
    {
      id: 5,
      action: "device.updated",
      summary: "updated device",
      at: minutesAgo(4),
      actor: ana,
      organization: { uuid: acme.uuid, name: acme.name },
      subject: { type: "device", uuid: "d1", name: "Pump 3 north" },
      changes: [{ field: "name", from: "Pump 3", to: "Pump 3 north", opaque: false }],
      details: [],
    },
    {
      id: 4,
      action: "organization.member.roles_changed",
      summary: "changed the roles of",
      at: minutesAgo(20),
      actor: ana,
      organization: { uuid: acme.uuid, name: acme.name },
      subject: { type: "user", uuid: null, name: "Ben Perera" },
      changes: [{ field: "roles", from: ["Member"], to: ["Moderator"], opaque: false }],
      details: [],
    },
    {
      id: 3,
      action: "dashboard.updated",
      summary: "updated dashboard",
      at: minutesAgo(40),
      actor: ben,
      organization: { uuid: northstar.uuid, name: northstar.name },
      subject: { type: "dashboard", uuid: "b1", name: "Plant floor" },
      changes: [{ field: "layouts", from: null, to: null, opaque: true }],
      details: [{ key: "revision", value: "4" }],
    },
    {
      id: 2,
      action: "billing_account.updated",
      summary: "updated billing account",
      at: minutesAgo(60),
      actor: { id: 99, name: null, email: null },
      organization: null,
      subject: { type: "billing_account", uuid: "a1", name: "Example Integrations" },
      changes: [],
      details: [],
    },
    {
      id: 1,
      action: "organization.invitation.sent",
      summary: "invited",
      at: minutesAgo(90),
      actor: ana,
      organization: { uuid: acme.uuid, name: acme.name },
      subject: { type: "invitation", uuid: "i1", name: "new.person@example.com" },
      changes: [],
      details: [{ key: "roles", value: "Member" }],
    },
  ]
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, json: body })
}

function paginated<T>(items: T[]) {
  return { data: items, meta: { current_page: 1, from: items.length ? 1 : null, last_page: 1, per_page: 25, to: items.length, total: items.length } }
}

/** The mocked API; `requests` holds each activity query string, in order. */
async function mockApi(page: Page) {
  const all = events()
  const requests: string[] = []

  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const search = url.searchParams.get("search")?.toLowerCase() ?? ""

    if (path === "/api/v1/me") return json(route, { data: superAdmin })
    if (path === "/api/v1/admin/tickets/summary") return json(route, { data: { awaiting_team: 0 } })
    if (path === "/api/v1/admin/users") {
      return json(route, paginated([ana, ben].filter((person) => person.name.toLowerCase().includes(search)).map((person) => ({ ...person, is_super_admin: false, platform_roles: [], organizations: [] }))))
    }
    if (path === "/api/v1/admin/organizations") {
      return json(route, paginated([acme, northstar].filter((item) => item.name.toLowerCase().includes(search))))
    }
    if (path === "/api/v1/admin/activity") {
      requests.push(url.search)
      const user = Number(url.searchParams.get("user_id") ?? 0)
      const organization = url.searchParams.get("organization")
      const matching = all.filter((event) => (!user || event.actor.id === user) && (!organization || event.organization?.uuid === organization))
      // Three per page here, so the second page needs Load older.
      const start = url.searchParams.get("cursor") === "older" ? 3 : 0
      const data = matching.slice(start, start + 3)
      return json(route, { data, links: {}, meta: { path: null, per_page: 3, next_cursor: start + 3 < matching.length ? "older" : null, prev_cursor: null } })
    }
    return json(route, { message: `Unmocked ${path}` }, 404)
  })

  return { requests }
}

test("the timeline shows who changed what, where and when", async ({ page }) => {
  await mockApi(page)
  await page.goto("/activity")

  await expect(page.getByRole("link", { name: "Activity" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible()
  const timeline = page.locator("[data-slot=activity-timeline]")
  await expect(timeline.getByRole("heading", { name: "Today" })).toBeVisible()

  const entries = timeline.locator("[data-slot=activity-item]")
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toContainText("Ana Silva updated device Pump 3 north")
  await expect(entries.nth(0)).toContainText("Acme Manufacturing")
  await expect(entries.nth(0)).toContainText("4 min ago")
  await expect(entries.nth(0).locator("[data-slot=activity-changes]")).toContainText("NamePump 3Pump 3 north")
  await expect(entries.nth(1).locator("[data-slot=activity-changes]")).toContainText("added + Moderator")
  await expect(entries.nth(1).locator("[data-slot=activity-changes]")).toContainText("removed − Member")
  await expect(entries.nth(2)).toContainText("Ben Perera updated dashboard Plant floor")
  await expect(entries.nth(2).locator("[data-slot=activity-changes]")).toContainText("Layoutschanged")
  await expect(entries.nth(2)).toContainText("Revision: 4")

  await page.getByRole("button", { name: "Load older activity" }).click()
  await expect(entries).toHaveCount(5)
  await expect(entries.nth(3)).toContainText("Deleted user updated billing account Example Integrations")
  await expect(entries.nth(3)).toContainText("Platform")
  await expect(entries.nth(4)).toContainText("Ana Silva invited new.person@example.com")
  await expect(entries.nth(4)).toContainText("Roles: Member")
  await expect(page.getByText("That is everything recorded.")).toBeVisible()
})

test("filters by person and organization stay in the address", async ({ page }) => {
  const { requests } = await mockApi(page)
  await page.goto("/activity")
  const entries = page.locator("[data-slot=activity-item]")
  await expect(entries).toHaveCount(3)

  await page.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Acme Manufacturing" }).click()
  await expect(page).toHaveURL(new RegExp(`organization=${acme.uuid}`))
  await expect(entries).toHaveCount(3)
  await expect(page.locator("[data-slot=activity-timeline]")).not.toContainText("Northstar Utilities")

  await page.getByRole("combobox", { name: "Person" }).click()
  await page.getByRole("combobox", { name: "Search person" }).fill("ana")
  await page.getByRole("option", { name: /Ana Silva/ }).click()
  await expect(page).toHaveURL(/user=7/)
  expect(requests.at(-1)).toContain("user_id=7")
  expect(requests.at(-1)).toContain(`organization=${acme.uuid}`)

  await page.reload()
  await expect(page.getByRole("combobox", { name: "Person" })).toHaveText(/Ana Silva/)
  await expect(page.getByRole("combobox", { name: "Organization" })).toHaveText(/Acme Manufacturing/)

  await page.getByRole("button", { name: "Clear filters" }).first().click()
  await expect(page).toHaveURL(/\/activity$/)
  await expect(page.getByRole("combobox", { name: "Person" })).toHaveText(/Everyone/)
})

test("a filter with no matches says so and offers to clear it", async ({ page }) => {
  await mockApi(page)
  await page.goto(`/activity?user=${ben.id}&organization=${acme.uuid}`)

  await expect(page.getByText("No activity matches these filters")).toBeVisible()
  await page.locator("[data-slot=empty-state]").getByRole("button", { name: "Clear filters" }).click()
  await expect(page.locator("[data-slot=activity-item]")).toHaveCount(3)
})
