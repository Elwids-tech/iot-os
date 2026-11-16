import { test, expect, type Page } from "@playwright/test"
import profile from "../../../contracts/definitions/device-profiles/three-phase-energy-meter.v1.json" with { type: "json" }

/*
 * Phone layouts (spec 033, US1 and US4). Every case runs at 320, 360 and 390 px wide,
 * and once more at 360 px with the root font size at 200% (large text). Each page must
 * fit the screen without sideways scrolling and keep its controls at 44 × 44 px (SC-002).
 */

const org = "33b842d4-dbe9-44b7-a82f-8409bf31401a"
const meterId = "33333333-3333-4333-8333-333333333301"
const workflowId = "33333333-3333-4333-8333-3333333333f1"
const configuration = "33333333-3333-4333-8333-3333333333c1"
const profileId = "33333333-3333-4333-8333-3333333333b1"
const dashboardId = "33333333-3333-4333-8333-3333333333d1"
const alertIds = {
  latest: "a3000000-0000-4000-8000-000000000003",
  older: "a3000000-0000-4000-8000-000000000002",
  cleared: "a3000000-0000-4000-8000-000000000001",
}
const base = `/organizations/${org}`
const alertsPath = `${base}/alerts`
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
const members = [
  { id: 1, name: "Manager", email: "manager@example.test" },
  { id: 2, name: "Operator Two", email: "operator@example.test" },
]
const values: Record<string, number> = {
  "voltage.l1": 230.04,
  "voltage.l2": 231,
  "voltage.l3": 229.2,
  "energy.imported": 100.2631,
  "energy.exported": 5.013,
  "voltage.average": 230.08,
}
const parameters = profile.parameters

type Options = {
  /** False: a member who can only view devices. */
  manage?: boolean
  /** Starts signed out; signing in makes /me answer. */
  signedOut?: boolean
}

const alert = (uuid: string, episode: number, extra: Record<string, unknown> = {}) => ({
  uuid,
  kind: "workflow",
  severity: "warning",
  workflow_uuid: workflowId,
  workflow_name: "Phase voltage band",
  operation_uuid: uuid,
  device_uuid: meterId,
  device_name: "Energy meter on the third floor plant room",
  episode,
  condition: "active",
  activated_at: ago(19 * 60),
  cleared_at: null,
  acknowledged_at: null,
  acknowledged_by: null,
  acknowledged_by_name: null,
  assignee: null as (typeof members)[number] | null,
  assigned_at: null as string | null,
  execution_stopped_reason: null,
  devices: [{ uuid: meterId, name: "Energy meter on the third floor plant room" }],
  devices_total: 1,
  ...extra,
})

const device = {
  uuid: meterId,
  code: "energy-meter-plant-room-3",
  name: "Energy meter on the third floor plant room",
  serial_number: null,
  description: null,
  lifecycle: "active",
  presence: "online",
  deployment_status: "applied",
  draft_revision: 3,
  deployment_generation: 1,
  state_revision: 1,
  desired_configuration_uuid: configuration,
  applied_configuration_uuid: configuration,
  last_applied_configuration_uuid: configuration,
  diagnostic: null,
  last_seen_at: ago(3),
  operation: null,
  candidate: null,
  profile: { uuid: profileId, name: "Three-phase Energy Meter", revision: 1 },
  retention: { days: 90, source: "platform" },
  draft: null,
  draft_artifact: null,
  configurations: [
    {
      uuid: configuration,
      revision: 1,
      definition_hash: "hash",
      profile_artifact_uuid: "33333333-3333-4333-8333-3333333333a1",
      profile_uuid: profileId,
      profile_name: "Three-phase Energy Meter",
      profile_revision: 1,
      created_at: ago(86400),
      definition: { profile_canonical_json: JSON.stringify(profile), mappings: [] },
    },
  ],
}

const source = (index: number) => ({
  device_uuid: meterId,
  parameter_uuid: parameters[index].uuid,
  device_name: "Energy meter on the third floor plant room",
  label: `${parameters[index].label} measured at the main incoming supply`,
  unit: parameters[index].unit,
  data_type: "number",
  precision: 1,
  color: "#2563eb",
  base: { label: "Normal", color: "#64748b" },
  thresholds: [],
})
/** On a computer: a stat and a chart side by side, a table under the stat. */
const layout = [
  { i: "stat", x: 0, y: 0, w: 4, h: 2 },
  { i: "chart", x: 4, y: 0, w: 8, h: 4 },
  { i: "table", x: 0, y: 2, w: 4, h: 4 },
]
const dashboard = {
  uuid: dashboardId,
  name: "Plant room energy",
  revision: 2,
  widgets: [
    // Listed out of reading order: the phone layout follows the computer layout, not this list.
    { id: "table", schema_version: 2, type: "table", title: "Phase readings", description: "", config: { sources: [0, 1, 2].map(source) } },
    { id: "chart", schema_version: 2, type: "timeseries", title: "Voltage history", description: "", config: { sources: [source(0)] } },
    { id: "stat", schema_version: 2, type: "status", title: "Voltage now", description: "", config: { sources: [source(0)] } },
  ],
  layouts: { lg: layout },
  defaults: { range: { mode: "relative", preset: "6h" }, timezone: "utc", refresh: 0 },
  tags: [],
  folder: null,
  starred: false,
  last_viewed_at: null,
  created_by: 1,
  created_by_name: "Manager",
  updated_by_name: null,
  created_at: ago(86400),
  updated_at: ago(86400),
  abilities: { edit: true, share: true, delete: true },
}

async function setup(page: Page, options: Options = {}) {
  const manage = options.manage ?? true
  const state = {
    signedIn: !options.signedOut,
    alerts: [
      alert(alertIds.latest, 3),
      alert(alertIds.older, 2, { activated_at: ago(3 * 3600) }),
      alert(alertIds.cleared, 1, {
        condition: "cleared",
        activated_at: ago(26 * 3600),
        cleared_at: ago(25 * 3600),
        acknowledged_at: ago(25 * 3600),
        acknowledged_by: 1,
        acknowledged_by_name: "Manager",
      }),
    ],
    queries: [] as URLSearchParams[],
    acknowledged: [] as string[],
    assigned: [] as (number | null)[],
    comments: [] as { uuid: string; body: string; created_by: number; author_name: string; created_at: string }[],
    errors: [] as string[],
  }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource"))
      state.errors.push(message.text())
  })
  const context = {
    uuid: org,
    name: "Acme Plant Operations",
    slug: "acme",
    capabilities: {
      devices: { view: true, manage, activate: manage, connections: false, command: false },
      dashboards: { view: true, create: manage, manage },
    },
  }
  const user = {
    id: 1,
    name: "Manager",
    email: "manager@example.test",
    email_verified_at: "2026-01-01",
    is_super_admin: false,
    capabilities: { platform_administration: false },
    organizations: [context],
  }
  await page.route("**/sanctum/**", (route) => route.fulfill({ status: 204 }))
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(`/api/v1/organizations/${org}`, "")
    const body = request.postData() ? request.postDataJSON() : null
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) => ({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
    if (url.pathname === "/api/v1/auth/login") {
      state.signedIn = true
      return json({ data: user })
    }
    if (url.pathname === "/api/v1/me")
      return state.signedIn ? json({ data: user }) : json({ message: "Unauthenticated." }, 401)
    if (path === "/context") return json({ data: context })
    if (path === "/runtime-status")
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: ago(5) } })
    if (path === "/overview")
      return json({
        data: {
          devices: { active: 1, online: 1, offline: 0, unknown: 0, registered: 0, deactivated: 0, silent: 0 },
          alerts: {
            active: 2,
            active_unacknowledged: 2,
            unacknowledged: 2,
            last_24_hours: 2,
            latest_active: state.alerts
              .filter((a) => a.condition === "active")
              .map((a) => ({ uuid: a.uuid, workflow_name: a.workflow_name, device_name: a.device_name, activated_at: a.activated_at, acknowledged: Boolean(a.acknowledged_at) })),
          },
          automations: { applied: 1 },
          discovery: { pending: 0 },
          commands: { uncertain: 0, recent: [] },
        },
      })
    if (path === "/alert-notifications/summary") return json({ data: { unread: 1, newest_unread_activation_id: null } })
    if (path === "/alert-notifications/read") return json({ data: { unread: 0, newest_unread_activation_id: null } })
    if (path === "/alert-notifications") return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0, unread: 0 } })
    const matching = (q: URLSearchParams) =>
      state.alerts.filter(
        (a) =>
          (!q.get("condition") || a.condition === q.get("condition")) &&
          (!q.get("acknowledged") || (q.get("acknowledged") === "1") === Boolean(a.acknowledged_at)) &&
          (!q.get("device") || a.device_uuid === q.get("device")) &&
          (!q.get("workflow") || a.workflow_uuid === q.get("workflow")) &&
          (!q.get("assignee") || String(a.assignee?.id) === q.get("assignee")),
      )
    if (path === "/alerts") {
      const q = url.searchParams
      if (q.get("per_page") !== "1") state.queries.push(q)
      const rows = matching(q)
      if (q.get("group") === "source") {
        const data = rows.length
          ? [
              {
                kind: "workflow",
                workflow_uuid: workflowId,
                device_uuid: meterId,
                occurrences: rows.length,
                unacknowledged: rows.filter((a) => !a.acknowledged_at).length,
                active: rows.filter((a) => a.condition === "active").length,
                first_activated_at: rows.at(-1)!.activated_at,
                last_activated_at: rows[0].activated_at,
                latest: rows[0],
              },
            ]
          : []
        return json(page1(data))
      }
      return json({ data: rows.slice(0, Number(q.get("per_page") ?? 25)), meta: { current_page: 1, last_page: 1, total: rows.length } })
    }
    const alertMatch = path.match(/^\/alerts\/([0-9a-f-]{36})(\/.*)?$/)
    if (alertMatch) {
      const item = state.alerts.find((a) => a.uuid === alertMatch[1])
      if (!item) return json({ message: "Not found." }, 404)
      const suffix = alertMatch[2] ?? ""
      if (suffix === "/acknowledge") {
        state.acknowledged.push(item.uuid)
        Object.assign(item, { acknowledged_at: new Date().toISOString(), acknowledged_by: 1, acknowledged_by_name: "Manager" })
        return json({ data: item })
      }
      if (suffix === "/assignee") {
        state.assigned.push(body.user_id)
        Object.assign(item, {
          assignee: members.find((m) => m.id === body.user_id) ?? null,
          assigned_at: body.user_id ? new Date().toISOString() : null,
        })
        return json({ data: item })
      }
      if (suffix === "/comments" && request.method() === "POST") {
        state.comments.push({ uuid: body.uuid, body: body.body, created_by: 1, author_name: "Manager", created_at: new Date().toISOString() })
        return json({ data: body }, 201)
      }
      if (suffix === "/comments") return json(page1(state.comments))
      if (suffix === "/deliveries")
        return json({
          data: [
            {
              uuid: "d1",
              recipient_id: 1,
              recipient_name: "Manager",
              type: "activated",
              status: "sent",
              attempts: 1,
              retry_generation: 0,
              history: [{ attempt: 1, status: "accepted", created_at: ago(18 * 60) }],
              sent_at: ago(18 * 60),
              diagnostic: null,
            },
            {
              uuid: "d2",
              recipient_id: 2,
              recipient_name: "Operator Two with a long display name",
              type: "activated",
              status: "failed",
              attempts: 3,
              retry_generation: 0,
              history: [{ attempt: 3, status: "failed", created_at: ago(17 * 60) }],
              sent_at: null,
              diagnostic: "Mailbox unavailable: the receiving server refused the message",
            },
          ],
        })
      return json({ data: item })
    }
    if (path === `/workflows/${workflowId}/notification-recipients`) return json(page1(members))
    if (url.pathname === "/api/v1/notifications/preferences")
      return json({
        data: {
          revision: 0,
          email_enabled: true,
          operations_access: false,
          grid: Object.fromEntries(
            ["workflow", "service", "watchdog"].map((source) => [source, { critical: true, warning: true, info: false, recovery: false }]),
          ),
        },
      })
    if (path === "/devices") return json(page1([device]))
    if (path === `/devices/${meterId}`) return json({ data: device })
    if (path === `/devices/${meterId}/connectivity`)
      return json({
        data: {
          effective: { enabled: true, style: "stays_connected", offline_after_seconds: null, grace_seconds: 120, severity: "warning", poll_interval_seconds: null },
          inherited_from: { enabled: "default", style: "default", offline_after_seconds: "automatic", grace_seconds: "default", severity: "default" },
          style_locked: null,
          state: {
            state: "monitored",
            monitoring_since: ago(86400),
            last_heard_at: ago(3),
            last_observed_at: ago(4),
            anchor_at: ago(3),
            reporting_interval_seconds: 60,
            readings_counted: 64,
            poll_interval_seconds: null,
            offline_after_seconds: 900,
            offline_after_automatic: true,
            suppressed_by_gateway: false,
            interruption: null,
            before_monitoring: false,
          },
          alert: null,
        },
      })
    if (path.endsWith("/measurements/latest"))
      return json({
        presence: "online",
        configuration_uuid: configuration,
        data: parameters.map((p) => ({
          parameter_uuid: p.uuid,
          key: p.key,
          label: p.label,
          data_type: p.data_type,
          unit: p.unit,
          value: values[p.key],
          quality: "good",
          observed_at: ago(3),
          received_at: ago(3),
          historical: false,
        })),
      })
    if (path.endsWith("/measurements/history")) {
      const parameter = parameters.find((p) => p.uuid === url.searchParams.get("parameter_uuid")) ?? parameters[0]
      return json({
        data: [
          {
            configuration_uuid: configuration,
            unit: parameter.unit,
            data_type: parameter.data_type,
            points: Array.from({ length: 30 }, (_, i) => ({ at: ago((30 - i) * 120), value: (values[parameter.key] ?? 1) + Math.sin(i / 3), count: 1 })),
          },
        ],
      })
    }
    if (path === "/dashboards") return json({ data: [dashboard] })
    if (path === `/dashboards/${dashboardId}`) return json({ data: dashboard })
    return json(page1([]))
  })
  return state
}

/**
 * The page fits a phone: no sideways scrolling (FR-002), every visible button, input,
 * select and textarea offers a target of at least 44 × 44 px (FR-004), and text fields
 * use 16 px text so iOS does not zoom in on focus. A control's hit
 * area includes an absolutely positioned `::before` or `::after` (checkboxes and switches
 * grow theirs on phones). Inline link buttons and copyable text are exempt, as WCAG 2.5.8
 * exempts targets in a line of text.
 */
async function expectPhoneFit(page: Page) {
  // The overflow, or the outermost elements that stick out past the right edge.
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (document.scrollingElement!.scrollWidth <= innerWidth) return []
        // Content inside a box that clips or scrolls sideways within the screen is fine.
        const contained = (element: HTMLElement) => {
          for (let box = element.parentElement; box && box !== document.body; box = box.parentElement)
            if (getComputedStyle(box).overflowX !== "visible") return box.getBoundingClientRect().right <= innerWidth + 0.5
          return false
        }
        const wide = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
          (element) => element.getBoundingClientRect().right > innerWidth + 0.5 && !contained(element),
        )
        return wide
          .filter((element) => !wide.includes(element.parentElement!))
          .slice(0, 5)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 50)} "${(element.textContent ?? "").trim().slice(0, 30)}" → ${Math.round(element.getBoundingClientRect().right)} px`,
          )
      }),
    { message: "the page scrolls sideways" })
    .toEqual([])
  // Sheets and popovers zoom and slide in; measure once they have settled.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  )
  const small = await page.evaluate(() => {
    const px = (value: string) => (value.endsWith("px") ? parseFloat(value) : 0)
    const offenders: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, [role=button], input:not([type=hidden]), select, textarea",
    )) {
      if (element.closest("[aria-hidden=true], [inert]")) continue
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const box = element.getBoundingClientRect()
      // Visually hidden controls (sr-only, Radix's native select) are 1 px or less.
      if (box.width <= 1 || box.height <= 1) continue
      // Text targets inside a line: link buttons and copyable codes.
      if (element.dataset.variant === "link" || element.dataset.slot === "copy-text") continue
      let width = box.width
      let height = box.height
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(element, pseudo)
        if (style.content === "none" || style.position !== "absolute") continue
        width = Math.max(width, box.width - px(style.left) - px(style.right))
        height = Math.max(height, box.height - px(style.top) - px(style.bottom))
      }
      const name = (element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)
      // Text fields need 16 px text, or iOS zooms the page when they take focus.
      const typed = element.matches("textarea, input:not([type=checkbox], [type=radio], [type=range], [type=file])")
      if (typed && parseFloat(getComputedStyle(element).fontSize) < 16) offenders.push(`${element.tagName.toLowerCase()} "${name}" text ${getComputedStyle(element).fontSize}`)
      if (width >= 43.5 && height >= 43.5) continue
      offenders.push(`${element.tagName.toLowerCase()}[${element.getAttribute("role") ?? element.getAttribute("type") ?? ""}] "${name}" ${Math.round(width)}×${Math.round(height)}`)
    }
    return offenders
  })
  expect(small, "controls under 44 × 44 px").toEqual([])
}

/** The sidebar menu, organization switcher, bell and user menu are all reachable (FR-001). */
async function expectShellReachable(page: Page) {
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeVisible()
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  const menu = page.getByRole("dialog", { name: "Sidebar" })
  await expect(menu.getByRole("button", { name: "Organization: Acme Plant Operations" })).toBeVisible()
  await expect(menu.getByRole("button", { name: "Manager" })).toBeVisible()
  await expect(menu.getByRole("link", { name: "Alerts" })).toBeVisible()
  await expectPhoneFit(page)
  // The first Escape may only close the focused row's tooltip.
  await expect(async () => {
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0, { timeout: 1000 })
  }).toPass()
}

const viewports = [
  { name: "320 px", width: 320, largeText: false },
  { name: "360 px", width: 360, largeText: false },
  { name: "390 px", width: 390, largeText: false },
  { name: "360 px, text at 200%", width: 360, largeText: true },
]

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: 760 } })
    if (viewport.largeText)
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
          const enlarge = () => document.documentElement?.style.setProperty("font-size", "200%")
          enlarge()
          document.addEventListener("DOMContentLoaded", enlarge)
        })
      })

    test("a signed-out alert link signs in on the same path and opens the alert", async ({ page }) => {
      const state = await setup(page, { signedOut: true })
      await page.goto(`${alertsPath}/${alertIds.latest}`)
      await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
      await expectPhoneFit(page)
      // Password reset fits too, and leads back to the same link.
      await page.getByRole("link", { name: "Forgot password?" }).click()
      await expect(page.getByLabel("Email address")).toBeVisible()
      await expectPhoneFit(page)
      await page.goBack()
      await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
      await page.getByLabel("Email address").fill("manager@example.test")
      await page.getByLabel("Password").fill("correct horse battery staple")
      await page.getByRole("button", { name: "Sign in" }).click()
      await expect(page).toHaveURL(`${alertsPath}/${alertIds.latest}`)
      await expect(page.getByRole("heading", { level: 1, name: /Phase voltage band/ })).toBeVisible()
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("acknowledge, assign and comment from the alert", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${alertsPath}/${alertIds.latest}`)
      const detail = page.getByRole("region", { name: "Alert detail" })
      await expect(detail.getByRole("button", { name: "Acknowledge alert" })).toBeVisible()
      await expectPhoneFit(page)
      await expectShellReachable(page)

      await detail.getByRole("button", { name: "Acknowledge alert" }).click()
      await expect(detail.getByText("Acknowledged by Manager")).toBeVisible()
      expect(state.acknowledged).toEqual([alertIds.latest])

      await detail.getByRole("combobox", { name: "Assignee" }).click()
      await expect(page.getByRole("option", { name: "Operator Two" })).toBeVisible()
      // The picker and its search field fit too.
      await expectPhoneFit(page)
      await page.getByRole("option", { name: "Operator Two" }).click()
      await expect(detail.getByText("Assigned to Operator Two")).toBeVisible()
      expect(state.assigned).toEqual([2])

      await detail.getByLabel("Add a comment").fill("Checked the breaker.")
      await detail.getByRole("button", { name: "Add comment" }).click()
      await expect(detail.getByText("Comment by Manager")).toBeVisible()
      expect(state.comments.map((comment) => comment.body)).toEqual(["Checked the breaker."])

      // Deliveries are phone cards: recipient, status and a Retry for the failed one.
      const deliveries = detail.getByRole("list", { name: "Email deliveries" })
      await expect(deliveries.getByRole("listitem")).toHaveCount(2)
      await expect(deliveries.getByRole("listitem").nth(1)).toContainText("Failed")
      await expect(deliveries.getByRole("button", { name: "Retry email" })).toHaveCount(1)
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("a link to an alert that is not there says only that it isn't available", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${alertsPath}/a3000000-0000-4000-8000-0000000000ff`)
      await expect(page.getByRole("region", { name: "Alert detail" })).toContainText("This alert isn't available")
      await expect(page.getByText("Phase voltage band")).toHaveCount(0)
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("the Alerts filters sheet holds every filter and rows stack", async ({ page }) => {
      const state = await setup(page)
      await page.goto(alertsPath)
      const list = page.getByRole("list", { name: "Alert sources" })
      await expect(list.getByRole("listitem")).toHaveCount(1)
      await expectPhoneFit(page)
      await expectShellReachable(page)

      await page.getByRole("button", { name: "Filters", exact: true }).click()
      const sheet = page.getByRole("dialog", { name: "Filter alerts" })
      await expect(sheet.getByRole("radiogroup", { name: "Condition" })).toBeVisible()
      await expect(sheet.getByRole("radiogroup", { name: "Repeats" })).toBeVisible()
      await expect(sheet.getByRole("checkbox", { name: "Unacknowledged only" })).toBeVisible()
      await expect(sheet.getByRole("checkbox", { name: "Assigned to me" })).toBeVisible()
      for (const filter of ["Kind", "Device", "Workflow"])
        await expect(sheet.getByRole("combobox", { name: filter })).toBeVisible()
      await expectPhoneFit(page)

      await sheet.getByRole("checkbox", { name: "Unacknowledged only" }).click()
      await expect.poll(() => state.queries.at(-1)?.get("acknowledged")).toBe("0")
      await sheet.getByRole("button", { name: "Done" }).click()
      await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible()

      // One stacked row per source: title, device and time; opening it shows the alert alone.
      await list.getByRole("link").first().click()
      await expect(page).toHaveURL(new RegExp(`${alertsPath}/${alertIds.latest}`))
      await expect(page.getByRole("region", { name: "Alert detail" })).toBeVisible()
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("a member who can only view devices sees no acknowledge, assign or comment controls", async ({ page }) => {
      const state = await setup(page, { manage: false })
      await page.goto(`${alertsPath}/${alertIds.latest}`)
      const detail = page.getByRole("region", { name: "Alert detail" })
      await expect(detail.getByText("Unacknowledged", { exact: true })).toBeVisible()
      await expect(detail.getByRole("button", { name: "Acknowledge alert" })).toHaveCount(0)
      await expect(detail.getByRole("combobox", { name: "Assignee" })).toHaveCount(0)
      await expect(detail.getByLabel("Add a comment")).toHaveCount(0)
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("Home and Devices fit and keep the shell reachable", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${base}/home`)
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
      await expect(page.getByText("Phase voltage band").first()).toBeVisible()
      await expectPhoneFit(page)
      await expectShellReachable(page)

      await page.goto(`${base}/devices`)
      await expect(page.getByRole("heading", { level: 1, name: "Devices" })).toBeVisible()
      await expect(page.getByRole("link", { name: "Energy meter on the third floor plant room" })).toBeVisible()
      await expectPhoneFit(page)
      await expectShellReachable(page)
      await page.getByRole("button", { name: "Filters", exact: true }).click()
      const sheet = page.getByRole("dialog", { name: "Filter devices" })
      for (const filter of ["Status", "Lifecycle"]) await expect(sheet.getByRole("combobox", { name: filter })).toBeVisible()
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("personal notification settings fit", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${base}/settings/email`)
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
      await expect(page.getByRole("switch", { name: "Allow alert emails" })).toBeVisible()
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("device detail leads with status, last seen, readings and alerts", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${base}/devices/${meterId}`)
      const top = async (name: string) =>
        (await page.getByRole("heading", { name, exact: true }).first().boundingBox())!.y
      await expect(page.getByRole("heading", { name: "Latest measurements" })).toBeVisible()
      await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible()
      await expect(page.getByText("Online").first()).toBeVisible()
      const order = [await top("Latest measurements"), await top("Alerts"), await top("Details"), await top("Used in"), await top("Recent commands")]
      expect(order).toEqual([...order].sort((a, b) => a - b))
      await expectPhoneFit(page)
      expect(state.errors).toEqual([])
    })

    test("a dashboard reads top to bottom in one column, without editing", async ({ page }) => {
      const state = await setup(page)
      await page.goto(`${base}/dashboards`)
      await expect(page.getByRole("link", { name: "Plant room energy" })).toBeVisible()
      await expectPhoneFit(page)

      await page.goto(`${base}/dashboards/${dashboardId}`, { waitUntil: "load" })
      await expect(page.getByRole("heading", { name: "Voltage now" })).toBeVisible()
      await expect(page.getByRole("button", { name: /^Edit/ })).toHaveCount(0)
      await expect(page.getByText("Editing needs a larger screen")).toBeVisible()
      // The header keeps Share in view; the other actions sit behind More actions, menus included.
      await expect(page.getByRole("button", { name: "Share" })).toBeVisible()
      await page.getByRole("button", { name: "More actions" }).click()
      const more = page.getByRole("dialog", { name: "More actions" })
      // A label phones hide beside an icon shows again in the list.
      await expect(more.getByRole("button", { name: "Kiosk" })).toHaveText("Kiosk")
      await expect(more.getByText("Kiosk")).toBeVisible()
      await more.getByRole("button", { name: "More dashboard actions" }).click()
      await expect(page.getByRole("menuitem", { name: "Export JSON" })).toBeVisible()
      await expectPhoneFit(page)
      // Escape closes the menu (which hides the list from assistive tech while open), then the list.
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menuitem", { name: "Export JSON" })).toHaveCount(0)
      await expect(more).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(more).toHaveCount(0)
      const boxes = await Promise.all(
        ["Voltage now", "Voltage history", "Phase readings"].map(async (title) => (await page.getByRole("group", { name: title }).boundingBox())!),
      )
      // One column in the computer layout's reading order, each panel tall enough to read.
      expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1)
      expect(boxes.map((box) => box.y)).toEqual([...boxes.map((box) => box.y)].sort((a, b) => a - b))
      const panelHeight = (title: string) =>
        page.locator(`#panel-${title}`).evaluate((element) => element.getBoundingClientRect().height)
      // Stat 3 rows, chart 6 and table 8 at least: 48 px rows plus the gaps between them.
      expect(await panelHeight("stat")).toBeGreaterThanOrEqual(48 * 3)
      expect(await panelHeight("chart")).toBeGreaterThanOrEqual(48 * 6)
      expect(await panelHeight("table")).toBeGreaterThanOrEqual(48 * 8)

      // A table wider than the phone scrolls inside its panel, never the page.
      const table = page.getByRole("group", { name: "Phase readings" })
      await expect(table.getByRole("table")).toBeVisible()
      await expect
        .poll(() => table.evaluate((element) => element.scrollWidth > element.clientWidth || [...element.querySelectorAll<HTMLElement>("[data-slot=table-container]")].some((scroller) => scroller.scrollWidth > scroller.clientWidth)))
        .toBe(true)
      // The time range stays reachable behind one button.
      await page.getByRole("button", { name: /^Time range/ }).click()
      const range = page.getByRole("dialog", { name: "Time range" })
      await expect(range.getByRole("radio", { name: "Last 24 hours" })).toBeVisible()
      for (const control of ["Compare previous period", "Refresh dashboard", "Previous interval"])
        await expect(range.getByRole("button", { name: control })).toBeVisible()
      await expect(range.getByRole("combobox", { name: "Auto refresh" })).toBeVisible()
      await expectPhoneFit(page)
      await page.keyboard.press("Escape")
      expect(state.errors).toEqual([])
    })
  })
}

test.describe("computers", () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test("the dashboard keeps its computer layout and Edit (SC-008)", async ({ page }) => {
    const state = await setup(page)
    await page.goto(`${base}/dashboards/${dashboardId}`)
    await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible()
    await expect(page.getByText("Editing needs a larger screen")).toHaveCount(0)
    const box = (id: string) => page.locator(`#panel-${id}`).evaluate((element) => {
      const { x, y, width, height } = element.parentElement!.getBoundingClientRect()
      return { x, y, width, height }
    })
    await expect(page.getByRole("heading", { name: "Voltage now" })).toBeVisible()
    const [stat, chart, table] = [await box("stat"), await box("chart"), await box("table")]
    // The stat and the chart share the first row; the table sits under the stat.
    const gap = chart.x - (stat.x + stat.width)
    const rows = (h: number) => 48 * h + gap * (h - 1)
    expect(Math.abs(chart.y - stat.y)).toBeLessThan(1)
    expect(Math.abs(table.x - stat.x)).toBeLessThan(1)
    // Heights are the saved ones (2, 4 and 4 rows): phone minimums never apply here.
    expect(Math.abs(stat.height - rows(2))).toBeLessThan(1.5)
    expect(Math.abs(chart.height - rows(4))).toBeLessThan(1.5)
    expect(Math.abs(table.height - rows(4))).toBeLessThan(1.5)
    expect(Math.abs(table.y - (stat.y + stat.height + gap))).toBeLessThan(1.5)
    expect(state.errors).toEqual([])
  })
})
