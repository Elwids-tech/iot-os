import { test, expect, type Page, type Request } from "@playwright/test"

/** Support tickets in the portal (spec 015), against a mocked API. */
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const acme = {
  uuid: org,
  name: "Acme",
  slug: "acme",
  capabilities: { devices: { view: true, manage: true, command: true } },
}
const me = { id: 4, name: "Ana Perera", email: "ana@example.test" }
const colleague = { id: 6, name: "Kasun Silva", email: "kasun@example.test" }
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)
const now = new Date().toISOString()

type Ticket = Record<string, any>

function ticket(overrides: Ticket = {}): Ticket {
  return {
    uuid: "aaaaaaaa-1111-4111-8111-111111111111",
    number: 42,
    title: "Devices page shows no readings",
    type: "bug",
    status: "new",
    organization: { uuid: org, name: "Acme" },
    revision: 1,
    sequence: 1,
    context: { path: "/organizations/x/devices", user_agent: "Test browser", screen: "1440x900", time_zone: "Asia/Colombo" },
    last_activity_at: now,
    created_at: now,
    closed_at: null,
    people: [{ ...me, role: "reporter" }],
    timeline: [
      { type: "message", key: "m-1", created_at: now, actor: { id: me.id, name: me.name }, from_team: false, internal: false, body: "The pump meter page is **empty**.", attachments: [], event: null, from: null, to: null, cause: null },
      { type: "event", key: "e-1", created_at: now, actor: { id: me.id, name: me.name }, from_team: false, internal: false, body: null, attachments: [], event: "created", from: null, to: null, cause: null },
    ],
    abilities: { reply: true, close: true, edit_title: true, manage_people: true, leave: false },
    ...overrides,
  }
}

const summary = (t: Ticket, unread = false) => ({
  uuid: t.uuid,
  number: t.number,
  title: t.title,
  type: t.type,
  status: t.status,
  role: "reporter",
  reporter: { id: me.id, name: me.name },
  unread,
  last_activity_at: t.last_activity_at,
  created_at: t.created_at,
  closed_at: t.closed_at,
})

const field = (request: Request, name: string) =>
  new RegExp(`name="${name.replace(/[[\]]/g, "\\$&")}"\\r\\n\\r\\n([^\\r]*)`).exec(request.postData() ?? "")?.[1]

async function setup(page: Page, options: { tickets?: Ticket[]; unread?: number } = {}) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const tickets = new Map((options.tickets ?? []).map((item) => [item.uuid, item]))
  let unread = options.unread ?? 0
  const reads: unknown[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const base = `/api/v1/organizations/${org}/tickets`
    if (path === "/api/v1/me")
      return json({ data: { ...me, email_verified_at: now, is_super_admin: false, capabilities: { platform_administration: false }, organizations: [acme] } })
    if (path.endsWith("/context")) return json({ data: acme })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: now } })
    if (path === `${base}/summary`) return json({ data: { unread } })
    if (path === base && method === "GET") {
      const rows = [...tickets.values()].map((item) => summary(item, unread > 0))
      return json({ data: rows, meta: { current_page: 1, last_page: 1, total: rows.length, per_page: 25 } })
    }
    if (path === base && method === "POST") {
      const created = ticket({
        uuid: "bbbbbbbb-2222-4222-8222-222222222222",
        number: 43,
        title: field(request, "title"),
        type: field(request, "type"),
        context: { path: field(request, "context[path]") ?? null, user_agent: "Test browser", screen: "1440x900", time_zone: "UTC" },
        timeline: [
          {
            ...ticket().timeline[0],
            body: "What happened: no readings",
            attachments: (request.postData() ?? "").includes('filename="pump.png"') ? [{ uuid: "f-1", name: "pump.png", mime: "image/png", size: png.length }] : [],
          },
          ticket().timeline[1],
        ],
      })
      tickets.set(created.uuid, created)
      return json({ data: created }, 201)
    }
    const match = /\/tickets\/([0-9a-f-]{36})(\/.*)?$/.exec(path)
    const current = match ? tickets.get(match[1]) : undefined
    if (match && current) {
      const rest = match[2] ?? ""
      if (rest === "" && method === "GET") return json({ data: current })
      if (rest === "/read") {
        reads.push(request.postDataJSON())
        unread = 0
        return route.fulfill({ status: 204 })
      }
      if (rest === "/messages") {
        const next = {
          ...current,
          status: current.status === "needs_info" ? "in_review" : current.status,
          sequence: current.sequence + 1,
          timeline: [...current.timeline, { ...ticket().timeline[0], key: `m-${current.timeline.length + 1}`, body: field(request, "body") }],
        }
        tickets.set(current.uuid, next)
        return json({ data: next }, 201)
      }
      if (rest.startsWith("/people")) return json({ data: url.searchParams.get("search")?.startsWith("ka") || url.searchParams.get("search") === "" ? [colleague] : [] })
      if (rest === `/participants/${colleague.id}` && method === "PUT") {
        const next = {
          ...current,
          people: [...current.people, { ...colleague, role: "participant" }],
          timeline: [...current.timeline, { ...ticket().timeline[1], key: "e-2", event: "participant_added", to: { id: colleague.id, name: colleague.name } }],
        }
        tickets.set(current.uuid, next)
        return json({ data: next })
      }
    }
    return json({ data: [] })
  })
  return { errors, reads }
}

test("files a bug with a screenshot and lands on the new ticket", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/organizations/${org}/support/new?type=bug&from=${encodeURIComponent("/organizations/x/devices")}`)

  await expect(page.getByRole("heading", { name: "New ticket" })).toBeVisible()
  await expect(page.getByRole("radio", { name: "Bug" })).toBeChecked()
  const description = page.getByRole("textbox", { name: "Description" })
  await expect(page.locator('[data-slot="composer"] p[data-placeholder]')).toHaveAttribute("data-placeholder", /What happened/)
  await page.getByRole("button", { name: "What else is included with your report?" }).click()
  await expect(page.getByText("/organizations/x/devices")).toBeVisible()

  await page.getByRole("textbox", { name: "Title" }).fill("Pump meter shows no readings")
  // Formatting from the toolbar and from Markdown shortcuts is sent as Markdown.
  await description.click()
  await page.keyboard.type("The ")
  await page.getByRole("button", { name: "Bold" }).click()
  await page.keyboard.type("pump meter")
  await page.getByRole("button", { name: "Bold" }).click()
  await page.keyboard.type(" is empty.")
  await page.keyboard.press("Enter")
  await page.keyboard.type("- Open Devices")
  await expect(description.locator("strong")).toHaveText("pump meter")
  await expect(description.locator("ul li")).toHaveText("Open Devices")
  await page.locator('[data-slot="composer"] input[type="file"]').setInputFiles([
    { name: "pump.png", mimeType: "image/png", buffer: png },
    { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("zip") },
  ])
  await expect(page.getByText("Use a PNG, JPEG, WebP or PDF file.")).toBeVisible()
  await expect(page.getByRole("button", { name: "File ticket" })).toBeDisabled()
  await page.getByRole("button", { name: "Remove notes.zip" }).click()

  const filed = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(`/organizations/${org}/tickets`))
  await page.getByRole("button", { name: "File ticket" }).click()
  const request = await filed
  expect(field(request, "type")).toBe("bug")
  expect(field(request, "title")).toBe("Pump meter shows no readings")
  expect(field(request, "context[path]")).toBe("/organizations/x/devices")
  expect(field(request, "client_id")).toMatch(/^[0-9a-f-]{36}$/)
  // Multipart form fields carry CRLF line breaks.
  expect(new RegExp('name="body"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--').exec(request.postData() ?? "")?.[1]?.replaceAll("\r\n", "\n")).toBe("The **pump meter** is empty.\n\n- Open Devices")
  expect(request.postData()).toContain('filename="pump.png"')
  expect(request.postData()).not.toContain("notes.zip")

  await expect(page).toHaveURL(new RegExp(`/support/bbbbbbbb-2222-4222-8222-222222222222$`))
  await expect(page.getByRole("heading", { name: "Pump meter shows no readings" })).toBeVisible()
  await expect(page.getByText("#43").first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Open pump.png" })).toBeVisible()
  await expect(page.getByText("Ticket #43 filed.")).toBeVisible()
  expect(errors).toEqual([])
})

test("shows unread replies, reads them, answers and tags a colleague", async ({ page }) => {
  const answered = ticket({
    status: "needs_info",
    sequence: 3,
    timeline: [
      ...ticket().timeline,
      { type: "message", key: "m-2", created_at: now, actor: { id: 1, name: "Nimal" }, from_team: true, internal: false, body: "Which serial number?", attachments: [], event: null, from: null, to: null, cause: null },
      { type: "event", key: "e-3", created_at: now, actor: { id: 1, name: "Nimal" }, from_team: false, internal: false, body: null, attachments: [], event: "status", from: "new", to: "needs_info", cause: null },
    ],
  })
  const { errors, reads } = await setup(page, { tickets: [answered], unread: 1 })
  await page.goto(`/organizations/${org}/support`)

  await expect(page.getByRole("link", { name: /Support\s*1 unread/ })).toBeVisible()
  await expect(page.getByRole("img", { name: "Unread" })).toBeVisible()
  await page.getByRole("link", { name: "Devices page shows no readings" }).click()

  await expect(page.getByText("Which serial number?")).toBeVisible()
  await expect(page.locator('[data-slot="thread-message"]').filter({ hasText: "Nimal" }).getByText("Team")).toBeVisible()
  await expect(page.getByText("changed the status from")).toBeVisible()
  await expect.poll(() => reads).toContainEqual({ sequence: 3 })
  await expect(page.getByRole("link", { name: /Support\s*1 unread/ })).toHaveCount(0)

  await page.getByRole("textbox", { name: "Reply" }).fill("Serial 4411.")
  await page.getByRole("button", { name: "Reply", exact: true }).click()
  await expect(page.locator('[data-slot="thread-message"]').filter({ hasText: "Serial 4411." })).toBeVisible()
  await expect(page.getByText("In review").first()).toBeVisible()

  await page.getByRole("combobox", { name: "Tag a colleague" }).click()
  await page.getByRole("option", { name: /Kasun Silva/ }).click()
  await expect(page.getByText("Tagged · kasun@example.test")).toBeVisible()
  await expect(page.getByText(/added\s+Kasun Silva/)).toBeVisible()
  expect(errors).toEqual([])
})

test("a link added from the toolbar stays in the draft until the reply is sent", async ({ page }) => {
  const { errors } = await setup(page, { tickets: [ticket()] })
  const sent: Request[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/messages")) sent.push(request)
  })
  await page.goto(`/organizations/${org}/support/${ticket().uuid}`)
  const reply = page.getByRole("textbox", { name: "Reply" })
  await reply.click()
  await page.keyboard.type("docs")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("textbox", { name: "Link address" }).fill("example.com/help")
  await page.keyboard.press("Enter")

  // Enter in the link box applies the link; it must not send the reply.
  await expect(reply.getByRole("link", { name: "docs" })).toHaveAttribute("href", "https://example.com/help")
  await expect(reply).toBeFocused()
  expect(sent).toHaveLength(0)

  await page.getByRole("button", { name: "Reply", exact: true }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(new RegExp('name="body"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--').exec(sent[0].postData() ?? "")?.[1]).toBe("[docs](https://example.com/help)")
  expect(errors).toEqual([])
})

test("opens with a draft another page hands over, without putting it in the URL", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/organizations/${org}/support`)
  await expect(page.getByText("No tickets yet")).toBeVisible()
  // In-app navigation with router state, as the dashboard assistant's feature request does.
  await page.evaluate((path) => {
    window.history.pushState({ usr: { draft: { title: "Total energy across meters", body: "Asked for: **one total** for all meters." } }, key: "draft", idx: 1 }, "", path)
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
  }, `/organizations/${org}/support/new?type=feature_request`)

  await expect(page.getByRole("radio", { name: "Feature request" })).toBeChecked()
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Total energy across meters")
  await expect(page.getByRole("textbox", { name: "Description" }).locator("strong")).toHaveText("one total")
  expect(page.url()).toMatch(/\/support\/new\?type=feature_request$/)
  expect(errors).toEqual([])
})

test("a declined ticket takes no replies and offers a new one", async ({ page }) => {
  const declined = ticket({ status: "declined", closed_at: now, abilities: { reply: false, close: false, edit_title: true, manage_people: true, leave: false } })
  const { errors } = await setup(page, { tickets: [declined] })
  await page.goto(`/organizations/${org}/support/${declined.uuid}`)

  await expect(page.getByText("This ticket was declined")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Reply" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Close as resolved" })).toHaveCount(0)
  await page.getByRole("link", { name: "New ticket" }).click()
  await expect(page).toHaveURL(/\/support\/new\?type=bug$/)
  expect(errors).toEqual([])
})

test("the command palette opens the form for an improvement", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(`/organizations/${org}/support`)
  // ⌘K is bound once the session loads, so open the palette from its button instead.
  await expect(page.getByText("No tickets yet")).toBeVisible()
  await page.getByRole("button", { name: /Search or jump to/ }).click()
  await page.getByRole("option", { name: "Suggest an improvement" }).click()
  await expect(page).toHaveURL(/\/support\/new\?type=improvement$/)
  await expect(page.getByRole("radio", { name: "Improvement" })).toBeChecked()
  expect(errors).toEqual([])
})
