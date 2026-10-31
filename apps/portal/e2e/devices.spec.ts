import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import profile from "../../../contracts/definitions/device-profiles/three-phase-energy-meter.v1.json" with { type: "json" }
import gpsProfile from "../../../contracts/definitions/device-profiles/gps-tracker.v1.json" with { type: "json" }

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const meterId = "11111111-1111-4111-8111-111111111111"
const idleId = "22222222-2222-4222-8222-222222222222"
const configuration = "44444444-4444-4444-8444-444444444444"
const profileId = "55555555-5555-4555-8555-555555555555"
const gatewayId = "66666666-6666-4666-8666-666666666666"
const dashboardId = "77777777-7777-4777-8777-777777777777"
const base = `/organizations/${org}`
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const gateway = {
  uuid: gatewayId,
  name: "Simulator gateway",
  edge_node_id: "simulator-edge",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: "simulator-group",
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 1,
}
const candidate = {
  uuid: "99999999-9999-4999-8999-999999999999",
  assigned_device_uuid: meterId,
  source_device_id: "meter",
  status: "approved",
  presence: "online",
  session_id: null,
  birth_revision: 2,
  metrics: [{ name: "Voltage L1", datatype: "Double", value: 230 }],
  last_seen_at: ago(3),
  gateway,
}
const values: Record<string, number> = {
  "voltage.l1": 230.04,
  "voltage.l2": 231,
  "voltage.l3": 229.2,
  "energy.imported": 100.2631,
  "energy.exported": 5.013,
  "voltage.average": 230.08,
}
const meter = {
  uuid: meterId,
  code: "sim-energy-meter",
  name: "Energy Meter Simulator",
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
  candidate,
  profile: { uuid: profileId, name: "Three-phase Energy Meter", revision: 1 },
}
const idle = {
  ...meter,
  uuid: idleId,
  code: "testing-d1",
  name: "D1",
  lifecycle: "registered",
  presence: "unseen",
  deployment_status: "idle",
  desired_configuration_uuid: null,
  applied_configuration_uuid: null,
  last_applied_configuration_uuid: null,
  last_seen_at: null,
  candidate: null,
  profile: null,
}
const retired = {
  ...meter,
  uuid: "33333333-3333-4333-8333-333333333333",
  code: "old-meter",
  name: "Retired meter",
  lifecycle: "archived",
  presence: "offline",
  deployment_status: "inactive",
  candidate: null,
}
/** The list status the API filters on, with the portal's precedence. */
const listStatus = (d: Record<string, any>) =>
  d.lifecycle === "archived"
    ? "archived"
    : d.deployment_status === "failed"
      ? "failed"
      : d.deployment_status === "pending"
        ? "updating"
        : d.lifecycle === "deactivated"
          ? "deactivated"
          : d.lifecycle === "registered"
            ? "unconfigured"
            : d.presence
const detail = {
  ...meter,
  retention: { days: 90, source: "platform" },
  draft: null,
  draft_artifact: null,
  configurations: [
    {
      uuid: configuration,
      revision: 1,
      definition_hash: "hash",
      profile_artifact_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      profile_uuid: profileId,
      profile_name: "Three-phase Energy Meter",
      profile_revision: 1,
      created_at: ago(86400),
      definition: {
        profile_canonical_json: JSON.stringify(profile),
        mappings: [],
      },
    },
  ],
}
const dashboard = {
  uuid: dashboardId,
  name: "Energy overview",
  revision: 4,
  widgets: [
    {
      id: "voltage",
      schema_version: 2,
      type: "timeseries",
      title: "Voltage",
      description: "",
      config: {
        sources: [
          {
            device_uuid: meterId,
            parameter_uuid: profile.parameters[0].uuid,
            label: "Voltage L1",
            unit: "V",
            data_type: "number",
            precision: null,
            color: "#2563eb",
            base: { label: "Current", color: "#64748b" },
            thresholds: [],
          },
        ],
      },
    },
  ],
  layouts: { lg: [{ i: "voltage", x: 0, y: 0, w: 6, h: 6 }] },
  defaults: { range: { mode: "relative", preset: "6h" }, timezone: "browser", refresh: 5 },
  tags: [],
  folder: null,
  starred: false,
  last_viewed_at: null,
  created_by_name: null,
  updated_by_name: null,
  created_at: ago(86400),
  updated_at: ago(86400),
}

type Options = {
  devices?: Record<string, any>[]
  /** The devices API sorts and echoes meta.sort, as servers with list sorting do. */
  serverSort?: boolean
  details?: Record<string, Record<string, any>>
  /** Pending discovery sources no device has reserved. */
  pending?: number
  latest?: "unavailable" | ((device: string) => Record<string, any>[])
  history?: "unavailable" | "empty"
  alerts?: Record<string, any>[]
  bindings?: Record<string, any>[]
}

async function setup(page: Page, options: Options = {}) {
  const state = {
    errors: [] as string[],
    saved: null as null | Record<string, any>,
    history: [] as URLSearchParams[],
    sorts: [] as string[],
    bindings: [...(options.bindings ?? [])],
    savedBindings: [] as Record<string, any>[],
  }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource"))
      state.errors.push(message.text())
  })
  const context = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      devices: { view: true, manage: true, connections: true, activate: true, command: true },
    },
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/device-profiles"))
      return json({
        data: [{ uuid: profileId, code: "three-phase-energy-meter", name: "Three-phase Energy Meter" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    if (path.endsWith("/devices")) {
      const lifecycle = url.searchParams.get("lifecycle")
      const statuses = url.searchParams.getAll("status[]")
      const profileUuid = url.searchParams.get("profile_uuid")
      const rows = (options.devices ?? [meter, idle]).filter(
        (d) =>
          (!lifecycle || (lifecycle === "current" ? d.lifecycle !== "archived" : d.lifecycle === lifecycle)) &&
          (!statuses.length || statuses.includes(listStatus(d))) &&
          (!profileUuid || d.profile?.uuid === profileUuid),
      )
      const perPage = Number(url.searchParams.get("per_page") ?? 25)
      if (!options.serverSort)
        return json({
          data: rows.slice(0, perPage),
          meta: { current_page: 1, last_page: 1, total: rows.length },
        })
      const sort = url.searchParams.get("sort") ?? "name"
      if (url.searchParams.get("per_page") !== "1") state.sorts.push(sort)
      const key = sort.replace(/^-/, "") === "last_seen" ? "last_seen_at" : "name"
      const sign = sort.startsWith("-") ? -1 : 1
      // Never-seen devices sort last either way, as the API does.
      const sorted = [...rows].sort((a, b) =>
        a[key] === null ? 1 : b[key] === null ? -1 : sign * String(a[key]).localeCompare(String(b[key])),
      )
      return json({
        data: sorted.slice(0, perPage),
        meta: { current_page: 1, last_page: 1, total: rows.length, sort },
      })
    }
    const one = /\/devices\/([^/]+)$/.exec(path)?.[1]
    if (one && request.method() === "PATCH") {
      state.saved = request.postDataJSON()
      const row = (options.devices ?? [meter, idle]).find((d) => d.uuid === one)!
      Object.assign(row, state.saved, { draft_revision: row.draft_revision + 1 })
      return json({ data: { ...detail, ...row } })
    }
    if (one && (options.details?.[one] || one === meterId))
      return json({ data: options.details?.[one] ?? detail })
    if (path.endsWith("/measurements/latest") && options.latest === "unavailable")
      return json({ message: "The device runtime is unavailable." }, 503)
    if (path.endsWith("/measurements/latest") && options.latest)
      return json({ presence: "online", data: options.latest(path.split("/").at(-3)!) })
    if (path.endsWith("/measurements/history") && options.history) {
      state.history.push(url.searchParams)
      return options.history === "unavailable"
        ? json({ message: "The device runtime is unavailable." }, 503)
        : json({ data: [] })
    }
    if (path.endsWith("/measurements/records"))
      return json({
        data: [],
        meta: {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit: Number(url.searchParams.get("limit")),
          page_size: Number(url.searchParams.get("page_size")),
          returned: 0,
          consumed: 0,
          next_cursor: null,
          has_more: false,
          limit_reached: false,
        },
      })
    if (path.endsWith("/location-bindings")) return json({ data: state.bindings })
    const bound = /\/location-bindings\/([^/]+)$/.exec(path)?.[1]
    if (bound && request.method() === "PUT") {
      const input = request.postDataJSON()
      state.savedBindings.push(input)
      const saved = {
        ...input,
        schema_version: "location-binding.v1",
        uuid: "abababab-abab-4bab-8bab-abababababab",
        revision: input.revision + 1,
        organization_uuid: org,
        device_uuid: bound,
        device_name: "GPS Demo Tracker",
        generation: 1,
        pairing: "same_event",
      }
      state.bindings = [...state.bindings.filter((b) => b.device_uuid !== bound), saved]
      return json({ data: saved })
    }
    if (path.endsWith("/measurements/latest"))
      return json({
        presence: "online",
        configuration_uuid: configuration,
        data: profile.parameters.map((p) => ({
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
      const parameter = profile.parameters.find(
        (p) => p.uuid === url.searchParams.get("parameter_uuid"),
      )!
      return json({
        data: [
          {
            configuration_uuid: configuration,
            unit: parameter.unit,
            data_type: parameter.data_type,
            points: Array.from({ length: 30 }, (_, i) => ({
              at: ago((30 - i) * 120),
              value: values[parameter.key] + Math.sin(i / 3),
              count: 1,
            })),
          },
        ],
      })
    }
    if (path.endsWith("/commands"))
      return json({
        data: [
          {
            uuid: "cmd-1",
            actor_name: "Operator",
            configuration_uuid: configuration,
            parameter_uuid: profile.parameters[0].uuid,
            value: 230,
            status: "observed",
            confirmed_at: ago(600),
            expires_at: ago(570),
            sent_at: ago(600),
            completed_at: ago(598),
            diagnostic: null,
            created_at: ago(610),
          },
        ],
      })
    if (path.endsWith("/alerts") && options.alerts) {
      const workflow = url.searchParams.get("workflow")
      const rows = options.alerts.filter((a) => !workflow || a.workflow_uuid === workflow)
      return json({ data: rows, meta: { current_page: 1, last_page: 1, total: rows.length } })
    }
    if (path.endsWith("/alerts"))
      return json({
        data:
          url.searchParams.get("device") === meterId
            ? [
                {
                  uuid: "alert-1",
                  workflow_uuid: "wf-1",
                  workflow_name: "Phase voltage band",
                  operation_uuid: "op-1",
                  device_uuid: meterId,
                  episode: 1,
                  condition: "active",
                  activated_at: ago(300),
                  cleared_at: null,
                  acknowledged_at: null,
                  acknowledged_by: null,
                  execution_stopped_reason: null,
                },
              ]
            : [],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    if (path.endsWith(`/dashboards/${dashboardId}`) && request.method() === "PUT") {
      state.saved = request.postDataJSON()
      return json({ data: { ...dashboard, ...state.saved, revision: dashboard.revision + 1 } })
    }
    if (path.endsWith("/dashboards"))
      return json({ data: [dashboard, { ...dashboard, uuid: "other", name: "Other", widgets: [] }] })
    if (path.endsWith("/gateways"))
      return json({ data: [gateway], meta: { current_page: 1, last_page: 1, total: 1 } })
    if (path.endsWith("/sparkplug-connections"))
      return json({
        data: [
          { uuid: gateway.connection_uuid, name: "Local simulator", group_id: "simulator-group", host_id: "h", status: "ready", diagnostic: null },
          { uuid: "c2", name: "Warehouse sensors", group_id: "warehouse", host_id: "h2", status: "provisioning", diagnostic: null },
        ],
        meta: { current_page: 1, last_page: 1, total: 2 },
      })
    if (path.endsWith("/discovery-candidates") && url.searchParams.get("available") === "1")
      return json({
        data: [],
        meta: { current_page: 1, last_page: 1, total: options.pending ?? 0 },
      })
    if (path.endsWith("/discovery-candidates"))
      return json({ data: [candidate], meta: { current_page: 1, last_page: 1, total: 1 } })
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  // Toggles and tabs fade their colours; scan once no transition is running.
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

async function fitsPhone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  // Charts resize on the next ResizeObserver callback, so let the layout settle.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
}

test("device directory links profiles and gateways, hides archived devices and filters by lifecycle", async ({ page }) => {
  const state = await setup(page, { devices: [meter, idle, retired] })
  await page.goto(`${base}/devices`)
  await expect(page).toHaveTitle("Devices · IoT OS")
  await expect(page.getByRole("heading", { name: "Devices", level: 1 })).toBeVisible()
  // Archived devices stay out of the default list, and the footer says so.
  await expect(page.getByRole("status").filter({ hasText: "2 devices" })).toBeVisible()
  await expect(page.getByText("1 archived device hidden")).toBeVisible()
  await expect(page.getByRole("link", { name: "Retired meter" })).toHaveCount(0)
  await expect(page.getByRole("radiogroup", { name: "Lifecycle" })).toHaveCount(0)
  const row = page.getByRole("row", { name: /Energy Meter Simulator/ })
  await expect(row.getByRole("link", { name: "Three-phase Energy Meter" })).toHaveAttribute(
    "href",
    `${base}/device-profiles/${profileId}`,
  )
  await expect(row.getByRole("link", { name: "Simulator gateway" })).toHaveAttribute(
    "href",
    `${base}/gateways/${gatewayId}`,
  )
  await expect(row.getByText("Online", { exact: true })).toBeVisible()

  // Lifecycle sits in Filters: the default first, then each lifecycle, then All.
  await page.getByRole("button", { name: "Filters" }).click()
  const lifecycle = page.getByRole("combobox", { name: "Lifecycle" })
  await expect(lifecycle).toHaveText("Not archived")
  await lifecycle.click()
  await expect(page.getByRole("option")).toHaveText(["Not archived", "Registered", "Active", "Deactivated", "Archived", "All"])
  await page.getByRole("option", { name: "Registered" }).click()
  await expect(page).toHaveURL(/lifecycle=registered/)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("status").filter({ hasText: "1 device match" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Energy Meter Simulator" })).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Lifecycle: Registered")
  await expect(page.getByText("archived device hidden")).toHaveCount(0)

  // Removing the chip returns to the default; the footer's Show includes archived devices.
  await page.getByRole("button", { name: "Remove Lifecycle filter" }).click()
  await expect(page).not.toHaveURL(/lifecycle=/)
  await page.getByRole("button", { name: "Show archived devices" }).click()
  await expect(page).toHaveURL(/lifecycle=all/)
  await expect(page.getByRole("status").filter({ hasText: "3 devices" })).toBeVisible()
  await expect(page.getByRole("row", { name: /Retired meter/ }).getByText("Archived")).toBeVisible()
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Lifecycle: All")
  await axe(page)
  await fitsPhone(page)
  expect(state.errors).toEqual([])
})

test("device toolbar keeps search beside icon buttons and filters by status on the server", async ({ page }) => {
  const state = await setup(page, { devices: [meter, idle, generated], pending: 2 })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/devices`)
  const toolbar = page.locator('[data-slot="data-table-toolbar"]')
  await expect(toolbar.getByRole("searchbox", { name: "Search devices" })).toBeVisible()
  // Each button shows only its icon; a tooltip and the accessible name say what it does.
  for (const name of ["Filters", "Group", "Columns"]) {
    const button = toolbar.getByRole("button", { name })
    await expect(button).toHaveText("")
    await button.hover()
    await expect(page.getByRole("tooltip")).toHaveText(name)
    // Leave first: a pointer that jumps between buttons reads as heading for the open tooltip.
    await page.mouse.move(0, 0, { steps: 4 })
    await expect(page.getByRole("tooltip")).toHaveCount(0)
  }
  const discovery = toolbar.getByRole("link", { name: "2 sources waiting in Discovery" })
  await expect(discovery).toHaveText("2")
  await discovery.hover()
  await expect(page.getByRole("tooltip")).toHaveText("2 sources waiting in Discovery")
  await page.mouse.move(0, 0, { steps: 4 })
  await expect(page.getByRole("tooltip")).toHaveCount(0)

  // Status is the column the table groups by; picking two asks the server for both.
  await toolbar.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "Status", exact: true }).click()
  await expect(page.getByRole("option")).toHaveText([
    "Online",
    "Offline",
    "Not seen yet",
    "Connection unknown",
    "Needs configuration",
    "Updating",
    "Configuration failed",
    "Deactivated",
  ])
  await page.getByRole("option", { name: "Needs configuration" }).click()
  await page.getByRole("option", { name: "Offline" }).click()
  await expect(page).toHaveURL(/status=unconfigured&status=offline/)
  // The list closes first and hands focus back; the next Escape closes Filters.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(toolbar.getByRole("button", { name: "Filters, 1 active" })).toHaveAttribute("aria-expanded", "false")
  const table = page.getByRole("table")
  await expect(table.getByRole("row", { name: /D1/ })).toBeVisible()
  await expect(table.getByRole("row", { name: /Energy Meter Simulator/ })).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Status: Needs configuration, Offline")
  await expect(toolbar.getByRole("button", { name: "Filters, 1 active" })).toHaveText("1")
  await expect(page.getByRole("status").filter({ hasText: "1 device match" })).toBeVisible()
  // Focus is back on Filters, which names itself in a tooltip until Escape.
  await expect(page.getByRole("tooltip")).toHaveText("Filters, 1 active")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await axe(page)

  // Phones keep the search and the icon buttons on one row.
  await page.setViewportSize({ width: 375, height: 812 })
  const search = await toolbar.getByRole("searchbox", { name: "Search devices" }).boundingBox()
  const columns = await toolbar.getByRole("button", { name: "Columns" }).boundingBox()
  expect(Math.abs(search!.y + search!.height / 2 - (columns!.y + columns!.height / 2))).toBeLessThan(4)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  expect(state.errors).toEqual([])
})

test("device overview leads with readings and links profile, gateway, dashboards and alerts", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices/${meterId}`)
  await expect(page.getByRole("heading", { name: "Energy Meter Simulator", level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "Back to Devices" })).toHaveAttribute("href", `${base}/devices`)
  await expect(page.getByText("Configuration applied rev 1")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Control" })).toBeVisible()
  const readings = page.getByRole("table").first()
  await expect(readings.getByRole("row", { name: /Voltage L1/ })).toContainText("230.0")
  await expect(readings.getByRole("row", { name: /Imported energy/ })).toContainText("100.263")
  await expect(page.getByRole("table", { name: "Chart legend" })).toContainText("Voltage L3")
  const summary = page.getByRole("complementary", { name: "Device summary" })
  await expect(summary.getByRole("link", { name: "Three-phase Energy Meter" })).toHaveAttribute(
    "href",
    `${base}/device-profiles/${profileId}`,
  )
  await expect(summary.getByRole("link", { name: "Simulator gateway" })).toBeVisible()
  await expect(summary.getByRole("link", { name: "Energy overview" })).toHaveAttribute(
    "href",
    `${base}/dashboards/${dashboardId}`,
  )
  await expect(summary.getByRole("link", { name: "Other" })).toHaveCount(0)
  await expect(summary.getByRole("link", { name: "Phase voltage band" })).toBeVisible()
  await expect(summary.getByText("1 active")).toBeVisible()
  await expect(summary.getByText("Confirmed")).toBeVisible()
  await axe(page)

  await page.getByRole("button", { name: "Device actions" }).click()
  await expect(page.getByRole("menuitem", { name: /Archive device/ })).toBeDisabled()
  await expect(page.getByRole("menuitem", { name: /Archive device/ })).toContainText(
    "Deactivate the device",
  )
  await page.getByRole("menuitem", { name: "Edit details" }).click()
  await expect(page.getByRole("dialog", { name: "Edit details" })).toBeVisible()
  await expect(page.getByLabel("Device name")).toHaveValue("Energy Meter Simulator")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Edit details" })).toHaveCount(0)

  await readings.getByRole("button", { name: "Add Voltage L1 to a dashboard" }).click()
  const add = page.getByRole("dialog", { name: "Add to dashboard" })
  await expect(add.getByRole("checkbox", { name: /^Voltage L1/ })).toBeChecked()
  await expect(add.getByRole("radio", { name: /^Status/ })).toBeChecked()
  await add.getByRole("checkbox", { name: /^Voltage L2/ }).click()
  await expect(add.getByRole("radio", { name: /^Time series/ })).toBeChecked()
  await expect(add.getByRole("radio", { name: /^Time series/ })).toHaveAccessibleName(/One unit/)
  await add.getByRole("combobox", { name: "Dashboard" }).click()
  await page.getByRole("option", { name: "Energy overview" }).click()
  await add.getByRole("button", { name: "Add panel" }).click()
  await expect.poll(() => state.saved?.revision).toBe(4)
  const widget = state.saved!.widgets.at(-1)
  expect(widget.type).toBe("timeseries")
  expect(widget.title).toBe("Energy Meter Simulator · Time series")
  expect(widget.config.sources.map((s: { label: string }) => s.label)).toEqual(["Voltage L1", "Voltage L2"])
  expect(widget.config.sources[0].device_uuid).toBe(meterId)
  expect(state.saved!.layouts.lg.map((item: { i: string }) => item.i)).toContain(widget.id)
  await expect(page.getByRole("dialog", { name: "Add to dashboard" })).toHaveCount(0)
  await expect(page.getByText("Added to Energy overview")).toBeVisible()
  await fitsPhone(page)
  expect(state.errors).toEqual([])
})

test("gateways list their devices and discovery shows a clearable gateway filter", async ({ page }) => {
  const state = await setup(page)
  // Broker connections have their own page under Connect.
  await page.goto(`${base}/connections`)
  await expect(page.getByRole("button", { name: "Provision", exact: true })).toBeVisible()
  // Links from before the gateway page still open it.
  await page.goto(`${base}/gateways?gateway=${gatewayId}`)
  await expect(page).toHaveURL(`${base}/gateways/${gatewayId}`)
  await expect(page.getByRole("heading", { name: "Simulator gateway", level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "Energy Meter Simulator" })).toBeVisible()
  await page.getByRole("button", { name: "Get credentials" }).click()
  await expect(page.getByRole("dialog", { name: "Get gateway credentials" })).toContainText(
    `devices:export-gateway ${gatewayId}`,
  )
  await page.keyboard.press("Escape")
  await axe(page)
  await page.getByRole("link", { name: "Back to Gateways" }).click()
  await page.getByRole("link", { name: "1 source" }).click()
  await expect(page).toHaveURL(`${base}/discovery?gateway=${gatewayId}`)
  await expect(page.getByText("Gateway: Simulator gateway")).toBeVisible()
  await page.getByLabel("Search discovered sources").fill("met")
  await expect(page).toHaveURL(/search=met/)
  await page.getByRole("button", { name: "Remove Gateway filter" }).click()
  await expect(page).toHaveURL(`${base}/discovery?search=met`)
  await axe(page)
  await fitsPhone(page)
  expect(state.errors).toEqual([])
})

const generated = {
  ...meter,
  uuid: "33333333-3333-4333-8333-333333333333",
  code: "device-ef7b2376-8fdb-4371-a8fa-f0426d457632",
  name: "Boiler room sensor",
  // A live session that has not sent data for days.
  presence: "online",
  last_seen_at: ago(5 * 86400),
  candidate: null,
}

test("device directory shows one health status, short codes, pending sources and phone cards", async ({ page }, info) => {
  const state = await setup(page, {
    devices: [meter, idle, generated],
    pending: 2,
    details: { [generated.uuid]: { ...detail, ...generated } },
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/devices`)
  const table = page.getByRole("table")
  await expect(table.getByRole("columnheader")).toHaveText(["", "Device", "Device code", "Status", "Last seen", "Profile", "Gateway", "Actions"])
  const lastSeen = await table.getByRole("columnheader", { name: "Last seen" }).boundingBox()
  expect(lastSeen!.x + lastSeen!.width).toBeLessThanOrEqual(1280)
  await expect(page.getByRole("link", { name: "Manufacturer MQTT device" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Add device" })).toBeVisible()

  const row = table.getByRole("row", { name: /Boiler room sensor/ })
  await expect(row.getByRole("button", { name: `Copy device code ${generated.code}` })).toHaveText("device-ef7b…7632")
  // Presence and freshness are separate: the status says Online, Last seen says the data is late.
  await expect(row.getByText("Online", { exact: true })).toBeVisible()
  await expect(row.getByText("5 d ago")).toBeVisible()
  await expect(row.locator('[data-slot="freshness"]')).toHaveAttribute("data-state", "late")
  await expect(table.getByRole("row", { name: /D1/ }).getByText("Needs configuration")).toBeVisible()
  await expect(table.getByRole("row", { name: /D1/ }).getByText("testing-d1")).toBeVisible()
  await row.getByText("Online", { exact: true }).hover()
  await expect(page.getByRole("tooltip")).toContainText("LifecycleActive")
  await expect(page.getByRole("tooltip")).toContainText("ConnectionOnline, no recent data")
  await expect(page.getByRole("tooltip")).toContainText("Last seen5 d ago")
  await expect(page.getByRole("tooltip")).toContainText("ConfigurationApplied")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tooltip")).toHaveCount(0)

  // Waiting sources are a quiet toolbar link to Discovery instead of a banner.
  await expect(page.getByRole("link", { name: "2 sources waiting in Discovery" })).toHaveAttribute(
    "href",
    `${base}/discovery`,
  )
  await axe(page)
  await page.screenshot({ path: info.outputPath("devices-desktop.png") })

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByRole("table")).toBeHidden()
  const cards = page.getByRole("list", { name: "Devices" })
  await expect(cards.getByRole("listitem")).toHaveCount(3)
  const card = cards.getByRole("listitem").filter({ hasText: "Boiler room sensor" })
  await expect(card).toContainText("Online")
  await expect(card).toContainText("Last seen 5 d ago")
  await expect(card).toContainText("Three-phase Energy Meter")
  await expect(page.getByRole("link", { name: "Add device" })).toBeInViewport()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: info.outputPath("devices-phone.png") })
  await card.getByRole("link", { name: "Boiler room sensor" }).click()
  await expect(page).toHaveURL(`${base}/devices/${generated.uuid}`)
  // Errors from the device page arrive after the URL changes, so wait for it to render.
  await expect(page.getByRole("heading", { name: "Boiler room sensor", level: 1 })).toBeVisible()
  expect(state.errors).toEqual([])
})

test("device names and codes copy in one click and quick edit renames from the row menu", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const devices = [{ ...meter }, { ...idle }, { ...generated }]
  const state = await setup(page, { devices })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/devices`)
  const table = page.getByRole("table")
  const row = table.getByRole("row", { name: /Boiler room sensor/ })

  // The code copies in full although it shows shortened, and copying does not open the device.
  await row.getByRole("button", { name: `Copy device code ${generated.code}` }).click()
  await expect(row.getByRole("button", { name: "Copied device code" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated.code)
  await expect(page).toHaveURL(`${base}/devices`)
  // The name is the row's link, so a button beside it copies it.
  await row.hover()
  await row.getByRole("button", { name: "Copy device name" }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Boiler room sensor")
  await expect(page).toHaveURL(`${base}/devices`)

  await row.getByRole("button", { name: "Actions for Boiler room sensor" }).click()
  await page.getByRole("menuitem", { name: "Quick edit" }).click()
  const dialog = page.getByRole("dialog", { name: "Quick edit" })
  await expect(dialog.getByLabel("Device name")).toBeFocused()
  await dialog.getByLabel("Device name").fill("Boiler room east")
  await dialog.getByLabel("Tags").fill("Energy, Line 2")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toHaveCount(0)
  // Only the quick fields change; the code and revision come from the row.
  expect(state.saved).toEqual({
    name: "Boiler room east",
    code: generated.code,
    description: null,
    tags: ["Energy", "Line 2"],
    draft_revision: generated.draft_revision,
  })
  await expect(table.getByRole("row", { name: /Boiler room east/ })).toBeVisible()
  expect(state.errors).toEqual([])
})

test("device table selects and exports rows, hides columns, groups and filters by profile", async ({ page }) => {
  const state = await setup(page, { devices: [meter, idle, generated] })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/devices`)
  const table = page.getByRole("table")
  await expect(table.getByRole("row", { name: /Boiler room sensor/ })).toBeVisible()

  // Selection opens the bulk bar; Export CSV saves the selected rows.
  await table.getByRole("checkbox", { name: "Select Energy Meter Simulator" }).click()
  await table.getByRole("checkbox", { name: "Select Boiler room sensor" }).click()
  await expect(page.getByText("2 selected")).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export CSV" }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^devices-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = (await (await file.createReadStream()).toArray()).join("")
  expect(csv.split("\n")[0]).toBe("Device,Device code,Status,Last seen,Profile,Gateway")
  expect(csv).toContain("Energy Meter Simulator,sim-energy-meter,Online")
  expect(csv).toContain(`Boiler room sensor,${generated.code},Online`)
  await page.getByRole("button", { name: "Clear" }).click()
  await expect(page.getByText("2 selected")).toHaveCount(0)

  // The column manager hides Gateway and remembers it after a reload.
  await page.getByRole("button", { name: "Columns" }).click()
  await page.getByRole("menuitemcheckbox", { name: "Gateway" }).click()
  await page.keyboard.press("Escape")
  await expect(table.getByRole("columnheader", { name: "Gateway" })).toHaveCount(0)
  await page.reload()
  await expect(table.getByRole("row", { name: /Boiler room sensor/ })).toBeVisible()
  await expect(table.getByRole("columnheader", { name: "Gateway" })).toHaveCount(0)

  // Grouping by profile puts both metered devices under one header.
  await page.getByRole("button", { name: "Group" }).click()
  await page.getByRole("menuitemradio", { name: "Profile" }).click()
  const group = table.getByRole("button", { name: /Three-phase Energy Meter/ })
  await expect(group).toContainText("2 devices")
  await expect(table.getByRole("button", { name: /No profile/ })).toContainText("1 device")
  await group.click()
  await expect(table.getByRole("row", { name: /Boiler room sensor/ })).toHaveCount(0)
  await group.click()

  // A profile filter goes to the URL and shows as a removable chip.
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("combobox", { name: "Profile" }).click()
  await page.getByRole("option", { name: "Three-phase Energy Meter" }).click()
  await expect(page).toHaveURL(new RegExp(`profile=${profileId}`))
  await page.keyboard.press("Escape")
  const chips = page.getByRole("group", { name: "Active filters" })
  await expect(chips).toContainText("Profile: Three-phase Energy Meter")
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "2 devices match" })).toBeVisible()
  await expect(table.getByRole("row", { name: /D1/ })).toHaveCount(0)
  await axe(page)
  await chips.getByRole("button", { name: "Remove Profile filter" }).click()
  await expect(page).not.toHaveURL(/profile=/)
  await expect(table.getByRole("row", { name: /D1/ })).toBeVisible()
  expect(state.errors).toEqual([])
})

test("phone cards keep row actions, selection and sorting", async ({ page }) => {
  const state = await setup(page, { devices: [meter, idle, generated], serverSort: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${base}/devices`)
  const cards = page.getByRole("list", { name: "Devices" })
  const card = cards.getByRole("listitem").filter({ hasText: "Boiler room sensor" })
  await expect(card).toBeVisible()

  // The ⋯ menu sits above the card's row link, so it opens instead of the device.
  await card.getByRole("button", { name: "Actions for Boiler room sensor" }).click()
  await expect(page.getByRole("menuitem", { name: "Command log" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(`${base}/devices`)

  // Card checkboxes and Select all open the bulk bar, as the table's do.
  await card.getByRole("checkbox", { name: "Select Boiler room sensor" }).click()
  await expect(page.getByText("1 selected")).toBeVisible()
  await page.getByText("Select all", { exact: true }).click()
  await expect(page.getByText("3 selected")).toBeVisible()
  await page.getByRole("button", { name: "Clear" }).click()
  await expect(page.getByText("3 selected")).toHaveCount(0)

  // Phones have no column headers, so the toolbar sorts instead.
  await page.getByRole("button", { name: /^Sort: Device/ }).click()
  await page.getByRole("menuitemradio", { name: "Descending" }).click()
  await expect(page).toHaveURL(/sort=-name/)
  await expect(cards.getByRole("listitem").first()).toContainText("Energy Meter Simulator")
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
  expect(state.errors).toEqual([])
})

test("device headers sort on the server and keep the sort in the address", async ({ page }) => {
  const state = await setup(page, { devices: [meter, idle, generated], serverSort: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${base}/devices`)
  const table = page.getByRole("table")
  const first = table.getByRole("row").nth(1)
  await expect(table.getByRole("columnheader", { name: "Device", exact: true })).toHaveAttribute("aria-sort", "ascending")
  await expect(first).toContainText("Boiler room sensor")

  // Oldest first, then newest first; a device never seen stays at the end.
  await table.getByRole("button", { name: "Last seen" }).click()
  await expect(page).toHaveURL(/sort=last_seen/)
  await expect(table.getByRole("columnheader", { name: "Last seen" })).toHaveAttribute("aria-sort", "ascending")
  await expect(first).toContainText("Boiler room sensor")
  await expect(table.getByRole("row").last()).toContainText("testing-d1")
  await table.getByRole("button", { name: "Last seen" }).click()
  await expect(page).toHaveURL(/sort=-last_seen/)
  await expect(first).toContainText("Energy Meter Simulator")
  await expect(table.getByRole("row").last()).toContainText("testing-d1")
  expect(state.sorts.slice(-2)).toEqual(["last_seen", "-last_seen"])

  // Name ascending is the default, so it leaves the address.
  await table.getByRole("button", { name: "Device", exact: true }).click()
  await expect(page).not.toHaveURL(/sort=/)
  await expect(first).toContainText("Boiler room sensor")
  expect(state.errors).toEqual([])
})

test("device overview explains unavailable live values and groups repeated alerts", async ({ page }, info) => {
  const episode = (n: number, condition: "active" | "cleared", seconds: number) => ({
    uuid: `alert-${n}`,
    workflow_uuid: condition === "active" ? "wf-door" : "wf-fence",
    workflow_name: condition === "active" ? "Door open" : "Demo boundary",
    operation_uuid: "op-1",
    device_uuid: meterId,
    device_name: meter.name,
    episode: n,
    condition,
    activated_at: ago(seconds + 60),
    cleared_at: condition === "cleared" ? ago(seconds) : null,
    acknowledged_at: null,
    acknowledged_by: null,
    acknowledged_by_name: null,
    assignee: null,
    assigned_at: null,
    execution_stopped_reason: null,
  })
  const state = await setup(page, {
    details: { [meterId]: { ...detail, presence: "online", last_seen_at: ago(5 * 86400) } },
    latest: "unavailable",
    alerts: [
      episode(6, "active", 600),
      ...[5, 4, 3, 2, 1].map((n) => episode(n, "cleared", (6 - n) * 86400)),
    ],
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${base}/devices/${meterId}`)
  await expect(page.getByRole("status").filter({ hasText: "Live values are unavailable right now." })).toHaveText(
    "Live values are unavailable right now. Last reading 5 d ago.",
  )
  await expect(page.getByText("Online · no recent data")).toBeVisible()
  await expect(page.getByText("Action needs attention")).toHaveCount(0)
  await expect(page.getByText("Waiting for the first reading")).toHaveCount(0)

  const summary = page.getByRole("complementary", { name: "Device summary" })
  await expect(summary.getByText("Up to date (revision 1)")).toBeVisible()
  await expect(summary.getByText(/requested 1/)).toHaveCount(0)
  await summary.getByText("Up to date (revision 1)").focus()
  await expect(page.getByRole("tooltip")).toContainText("Requested revision 1 · Applied revision 1 · Last working revision 1")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tooltip")).toHaveCount(0)

  await expect(summary.getByText("1 active")).toBeVisible()
  await expect(summary.getByRole("link", { name: "Demo boundary" })).toHaveCount(1)
  await expect(summary.getByRole("link", { name: "Demo boundary" })).toHaveAttribute(
    "href",
    `${base}/alerts?device=${meterId}&workflow=wf-fence`,
  )
  await expect(summary.getByRole("listitem").filter({ hasText: "Demo boundary" })).toContainText(
    "5 occurrences · last cleared 1 d ago",
  )
  await expect(summary.getByRole("link", { name: "Door open" })).toHaveAttribute("href", `${base}/alerts/alert-6`)
  await expect(summary.getByRole("listitem").filter({ hasText: "Door open" })).toContainText("1 occurrence · active since 11 min ago")
  await expect(summary.getByRole("link", { name: "All alerts" })).toHaveAttribute("href", `${base}/alerts?device=${meterId}`)
  await axe(page)
  await page.screenshot({ path: info.outputPath("overview-unavailable.png") })
  await fitsPhone(page)
  expect(state.errors).toEqual([])
})

const trackerId = "12121212-1212-4212-8212-121212121212"
const trackerConfiguration = "45454545-4545-4545-8545-454545454545"
/** A GPS tracker 2 min after its last fix, with the given saved location bindings. */
async function trackerSetup(page: Page, bindings: Record<string, any>[] = []) {
  const tracker = {
    ...detail,
    uuid: trackerId,
    code: "gps-demo-tracker",
    name: "GPS Demo Tracker",
    desired_configuration_uuid: trackerConfiguration,
    applied_configuration_uuid: trackerConfiguration,
    last_applied_configuration_uuid: trackerConfiguration,
    profile: { uuid: profileId, name: "GPS tracker", revision: 1 },
    configurations: [
      {
        ...detail.configurations[0],
        uuid: trackerConfiguration,
        profile_name: "GPS tracker",
        definition: { profile_canonical_json: JSON.stringify(gpsProfile), mappings: [] },
      },
    ],
  }
  const values: Record<string, number> = {
    "location.latitude": 51.0447,
    "location.longitude": -114.0719,
    "location.accuracy": 4,
  }
  return setup(page, {
    details: { [trackerId]: tracker },
    history: "empty",
    bindings,
    latest: () =>
      gpsProfile.parameters.map((p) => ({
        parameter_uuid: p.uuid,
        key: p.key,
        label: p.label,
        data_type: p.data_type,
        unit: p.unit,
        value: values[p.key],
        quality: "good",
        observed_at: ago(120),
        received_at: ago(119),
        historical: false,
      })),
  })
}

test("GPS tracker overview shows its last position and age on a map", async ({ page }, info) => {
  const state = await trackerSetup(page)
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`${base}/devices/${trackerId}`)
  const location = page.getByRole("complementary", { name: "Device summary" })
  await expect(location.getByText("Last position 2 min ago")).toBeVisible()
  await expect(location.getByText("51.04470, -114.07190 · ±4 m")).toBeVisible()
  await expect(page.getByRole("button", { name: "GPS Demo Tracker: unknown" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Latest measurements" })).toBeVisible()
  await page.screenshot({ path: info.outputPath("overview-gps.png") })
  expect(state.errors).toEqual([])
})

test("a GPS tracker's suggested location saves as its binding and can be edited", async ({ page }, info) => {
  const [latitude, longitude, accuracy] = gpsProfile.parameters.map((p) => p.uuid)
  const state = await trackerSetup(page)
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`${base}/devices/${trackerId}`)
  const summary = page.getByRole("complementary", { name: "Device summary" })
  await expect(summary.getByText("Not saved as this device's location")).toBeVisible()
  await expect(summary.getByText("Dashboard maps and geofences need a saved location.")).toBeVisible()
  await summary.getByRole("button", { name: "Save location", exact: true }).click()
  await expect.poll(() => state.savedBindings).toEqual([
    {
      revision: 0,
      configuration_uuid: trackerConfiguration,
      latitude_parameter_uuid: latitude,
      longitude_parameter_uuid: longitude,
      accuracy_parameter_uuid: accuracy,
      max_age_seconds: 90,
      max_future_skew_seconds: 5,
      allow_unknown_accuracy: true,
    },
  ])
  await expect(page.getByText("Location saved. Dashboard maps and geofences can use it now.")).toBeVisible()
  await expect(summary.getByText("Not saved as this device's location")).toHaveCount(0)
  await summary.getByRole("button", { name: "Edit", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Edit location" })
  await expect(sheet.getByRole("combobox", { name: "Latitude" })).toHaveText("Latitude · location.latitude (deg)")
  await expect(sheet.getByText("No unsaved changes")).toBeVisible()
  await sheet.getByRole("combobox", { name: "Accuracy" }).click()
  await page.getByRole("option", { name: "No accuracy parameter", exact: true }).click()
  await sheet.getByLabel("Maximum age (seconds)").fill("0")
  await expect(sheet.getByText("Enter whole seconds from 1 to 86,400.")).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Save location" })).toBeDisabled()
  await sheet.getByLabel("Maximum age (seconds)").fill("300")
  await axe(page)
  await page.screenshot({ path: info.outputPath("location-sheet.png") })
  await sheet.getByRole("button", { name: "Save location" }).click()
  await expect(sheet).toHaveCount(0)
  expect(state.savedBindings.at(-1)).toMatchObject({ revision: 1, accuracy_parameter_uuid: null, max_age_seconds: 300 })
  expect(state.errors).toEqual([])
})

test("the location card offers no setup without device management", async ({ page }) => {
  const state = await trackerSetup(page)
  await page.route("**/api/v1/organizations/*/context", (route) =>
    route.fulfill({
      json: { data: { uuid: org, name: "Acme", slug: "acme", capabilities: { devices: { view: true, manage: false } } } },
    }),
  )
  await page.goto(`${base}/devices/${trackerId}`)
  const summary = page.getByRole("complementary", { name: "Device summary" })
  await expect(summary.getByText("Not saved as this device's location")).toBeVisible()
  await expect(summary.getByRole("button", { name: "Save location" })).toHaveCount(0)
  await expect(summary.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("history explains failures and jumps to the latest data", async ({ page }, info) => {
  const quiet = { ...detail, presence: "offline", last_seen_at: ago(5 * 86400) }
  const state = await setup(page, { details: { [meterId]: quiet }, history: "unavailable" })
  await page.goto(`${base}/devices/${meterId}/history`)
  const failure = page.getByRole("alert").filter({ hasText: "History couldn't be loaded" })
  await expect(failure).toContainText("The device runtime is unavailable.")
  await expect(page.getByText("No measurements in this range")).toHaveCount(0)
  await expect(page.getByText(/retention cannot restore/)).toHaveCount(0)
  await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible()
  await page.screenshot({ path: info.outputPath("history-failure.png") })
  expect(state.errors).toEqual([])
})

test("an empty history range offers the latest data instead of retention advice", async ({ page }, info) => {
  const lastSeen = ago(5 * 86400)
  const quiet = { ...detail, presence: "offline", last_seen_at: lastSeen }
  const state = await setup(page, { details: { [meterId]: quiet }, history: "empty" })
  await page.goto(`${base}/devices/${meterId}/history`)
  await expect(page.getByText("No measurements in this range")).toBeVisible()
  await expect(page.getByText("The device last reported 5 d ago, before this range starts.")).toBeVisible()
  await expect(page.getByText(/retention cannot restore/)).toHaveCount(0)
  await axe(page)
  await page.screenshot({ path: info.outputPath("history-empty.png") })
  await page.getByRole("button", { name: "Jump to latest data" }).click()
  await expect.poll(() => state.history.at(-1)?.get("to")).toBe(
    new Date(Date.parse(lastSeen) + 60_000).toISOString(),
  )
  const request = state.history.at(-1)!
  expect(Date.parse(request.get("to")!) - Date.parse(request.get("from")!)).toBe(24 * 3600_000)
  await expect(page.getByRole("combobox", { name: "Time range" })).toHaveText("Custom range")
  await expect(page.getByLabel("To", { exact: true })).not.toHaveValue("")
  expect(state.errors).toEqual([])
})
