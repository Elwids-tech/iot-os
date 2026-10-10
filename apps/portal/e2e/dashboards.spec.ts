import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import type {
  Dashboard,
  DashboardSource,
  DashboardWidget,
} from "@iot-os/api-client"

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const basePath = `/organizations/${org}/dashboards`
const deviceId = "11111111-1111-4111-8111-111111111111"
const parameterId = "22222222-2222-4222-8222-222222222222"
const secondParameter = "33333333-3333-4333-8333-333333333333"
const stateParameter = "44444444-4444-4444-8444-444444444444"
const colourParameter = "55555555-5555-4555-8555-555555555555"
const energyParameter = "66666666-6666-4666-8666-666666666666"
const source: DashboardSource = {
  device_uuid: deviceId,
  parameter_uuid: parameterId,
  device_name: "Boiler room",
  label: "Temperature",
  unit: "C",
  data_type: "number",
  precision: 1,
  color: "#2563eb",
  base: { label: "Normal", color: "#64748b" },
  thresholds: [10, 30, 80].map((value) => ({
    value,
    label: `Band ${value}`,
    color: "#2563eb",
  })),
}
const panel = (
  id: string,
  type: DashboardWidget["type"],
  title: string,
): DashboardWidget => ({
  id,
  type,
  title,
  description: "",
  schema_version: 2,
  config: { sources: [structuredClone(source)] },
})

// Library and per-user fields the list and show endpoints return.
const libraryFields = {
  tags: [] as string[],
  folder: null as string | null,
  starred: false,
  last_viewed_at: null as string | null,
  created_by: 1,
  created_by_name: "Dashboard operator",
  updated_by_name: null,
}

async function setup(
  page: Page,
  manage = true,
  options: { historyDelayMs?: number } = {},
) {
  const dashboards: Dashboard[] = [
    {
      uuid: "first",
      name: "Plant overview",
      widgets: [
        panel("status", "status", "Current temperature"),
        panel("chart", "timeseries", "Temperature history"),
      ],
      layouts: {
        lg: [
          { i: "status", x: 0, y: 0, w: 6, h: 6 },
          { i: "chart", x: 6, y: 0, w: 6, h: 6 },
        ],
      },
      defaults: {
        range: { mode: "relative", preset: "6h" },
        timezone: "utc",
        refresh: 0,
      },
      revision: 1,
      ...libraryFields,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      uuid: "second",
      name: "Utilities",
      widgets: [],
      layouts: {},
      defaults: {
        range: { mode: "relative", preset: "24h" },
        timezone: "browser",
        refresh: 0,
      },
      revision: 1,
      ...libraryFields,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
  ]
  const calls = {
    writes: 0,
    latest: 0,
    history: 0,
    conflict: false,
    historyWindows: [] as string[],
    increase: [] as URLSearchParams[],
  }
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      errors.push(message.text())
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method(),
      path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Dashboard operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          is_super_admin: false,
          capabilities: { platform_administration: false },
          organizations: [
            {
              uuid: org,
              name: "Acme Manufacturing",
              slug: "acme",
              capabilities: { devices: { manage, view: true } },
            },
          ],
        },
      })
    if (path.endsWith("/dashboards")) {
      if (method === "POST") {
        calls.writes++
        const created = {
          ...libraryFields,
          ...route.request().postDataJSON(),
          uuid: `created-${dashboards.length}`,
          revision: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        dashboards.push(created)
        return json({ data: created })
      }
      return json({ data: dashboards })
    }
    if (path.includes("/dashboards/")) {
      const id = path.split("/").at(-1),
        index = dashboards.findIndex((d) => d.uuid === id)
      if (index < 0) return json({ message: "Not found" }, 404)
      if (method === "PUT") {
        calls.writes++
        if (calls.conflict) return json({ message: "Concurrent change" }, 409)
        dashboards[index] = {
          ...dashboards[index],
          ...route.request().postDataJSON(),
          revision: dashboards[index].revision + 1,
        }
      }
      return json({ data: dashboards[index] })
    }
    if (path.endsWith("/measurements/latest")) {
      calls.latest++
      return json({
        data: [
          {
            parameter_uuid: parameterId,
            key: "temperature",
            label: "Temperature",
            data_type: "number",
            unit: "C",
            value: 23.5,
            quality: "invalid",
            received_at: "2026-09-09T12:05:00Z",
            observed_at: "2026-09-09T11:00:00Z",
            last_valid_received_at: "2026-09-09T12:00:00Z",
            diagnostic: "Retained valid value",
            historical: false,
          },
        ],
        presence: "online",
      })
    }
    if (path.endsWith("/measurements/history")) {
      calls.history++
      calls.historyWindows.push(url.search)
      if (calls.history > 1 && options.historyDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, options.historyDelayMs),
        )
      const start = Date.parse(url.searchParams.get("from")!),
        end = Date.parse(url.searchParams.get("to")!)
      return json({
        data: [
          {
            configuration_uuid: "configuration-1",
            unit: "C",
            data_type: "number",
            points: [0, 1, 2, 3, 4].map((i) => ({
              at: new Date(start + ((end - start) * i) / 4).toISOString(),
              value: i === 2 ? null : 20 + i,
              count: i === 2 ? 0 : 5,
            })),
          },
        ],
      })
    }
      if (path.endsWith("/measurements/increase")) {
      calls.increase.push(url.searchParams)
      // Three days of usage from the start of the requested range; the last is still counting.
      const from = Date.parse(url.searchParams.get("from")!)
      return json({
        data: {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          bucket: url.searchParams.get("bucket"),
          timezone: url.searchParams.get("timezone") ?? "America/Toronto",
          unit: "kWh",
          points: [12.5, 9, 4.25].map((increase, day) => ({
            at: new Date(from + day * 86400000).toISOString(),
            increase,
            samples: 96,
            resets: day === 1 ? 1 : 0,
            partial: day === 2,
          })),
        },
      })
    }
      if (path.endsWith("/measurements/state-history")) {
      const parameter = url.searchParams.get("parameter_uuid")
      const from = url.searchParams.get("from")!
      const to = url.searchParams.get("to")!
      const colour = parameter === colourParameter
      return json({
        data: {
          from,
          to,
          durations: colour
            ? []
            : [
                {
                  value: true,
                  known: true,
                  data_type: "boolean",
                  duration_ms: Date.parse(to) - Date.parse(from),
                  percentage: 100,
                },
              ],
          timeline: [
            {
              from,
              to,
              value: colour ? "#22C55E" : true,
              known: true,
              data_type: colour ? "string" : "boolean",
              configuration_uuid: "configuration-1",
            },
          ],
          sampled: false,
        },
        })
      }
      if (path.endsWith("/commands")) return json({ data: [] })
      if (path.endsWith("/devices"))
      return json({
        data:
          url.searchParams.get("page") === "2"
            ? [{ uuid: deviceId, name: "Boiler room" }]
            : [{ uuid: "other", name: "Other device" }],
        meta: {
          current_page: Number(url.searchParams.get("page") ?? 1),
          last_page: 2,
          total: 2,
        },
      })
    if (path.includes("/devices/"))
      return json({
        data: {
          uuid: deviceId,
          name: "Boiler room",
          applied_configuration_uuid: "configuration-1",
          last_applied_configuration_uuid: "configuration-1",
          configurations: [
            {
              uuid: "configuration-1",
              revision: 1,
              definition: {
                profile_canonical_json: JSON.stringify({
                  parameters: [
                    {
                      uuid: parameterId,
                      key: "temperature",
                      label: "Temperature",
                      data_type: "number",
                      unit: "C",
                    },
                    {
                      uuid: secondParameter,
                      key: "return_temp",
                      label: "Return temperature",
                      data_type: "number",
                      unit: "C",
                    },
                    {
                      uuid: energyParameter,
                      key: "energy",
                      label: "Energy",
                      data_type: "number",
                      unit: "kWh",
                      kind: "counter",
                    },
                  {
                    uuid: stateParameter,
                    key: "power",
                    label: "Power",
                    data_type: "boolean",
                    unit: null,
                    kind: "state",
                    accepts_command: true,
                    reports_state: true,
                  },
                    {
                      uuid: colourParameter,
                      key: "colour",
                      label: "Colour",
                    data_type: "string",
                    unit: null,
                    format: "hex_color",
                    display: { widget: "color" },
                    kind: "state",
                    accepts_command: true,
                    reports_state: true,
                    },
                  ],
                }),
                mappings: [stateParameter, colourParameter].map(
                  (parameterUuid) => ({
                    parameter_uuid: parameterUuid,
                    metric: parameterUuid,
                    command_metric: parameterUuid,
                  }),
                ),
              },
            },
          ],
          retention: { days: 90, source: "platform" },
          reporting_timezone: "America/Toronto",
        },
      })
    return json({ data: [] })
  })
  return { dashboards, calls, errors }
}

async function menu(page: Page, title = "Current temperature") {
  await page
    .getByRole("button", { name: `Panel menu: ${title}`, exact: true })
    .click()
}

const addDialog = (page: Page) => page.getByRole("dialog", { name: "Add panel" })

/** Picks a panel that uses no device parameters from the Add panel dialog. */
async function addOther(page: Page, label: string) {
  await addDialog(page).getByRole("button", { name: label, exact: true }).click()
}

/** Ticks Boiler room parameters in the Add panel dialog. */
async function chooseParameters(page: Page, labels: RegExp[]) {
  const dialog = addDialog(page)
  const device = dialog.getByRole("button", { name: "Boiler room", exact: true })
  await expect(dialog.getByRole("button", { name: "Other device", exact: true })).toBeVisible()
  // The fixture lists Boiler room on the second page.
  if (!(await device.isVisible()))
    await dialog.getByRole("button", { name: "Show more devices", exact: true }).click()
  await device.click()
  for (const label of labels) await dialog.getByRole("checkbox", { name: label }).click()
  return dialog
}

test("GPS panels use the full-page editor and long canvas drafts survive kiosk mode", async ({ page }) => {
  const { dashboards, calls, errors } = await setup(page)
  dashboards[0].layouts.lg![1].y = 24
  await page.route("**/location-bindings", route => route.fulfill({ json: { data: [{ device_uuid: deviceId, device_name: "Field tracker" }] } }))
  await page.route("**/geofences?**", route => route.fulfill({ json: { data: [{ uuid: parameterId, name: "Pasture" }] } }))
  await page.route("**/location-map/query", route => route.fulfill({ json: { data: { devices: [], geofence: null, trail_window: "24h" } } }))
  await page.goto(basePath + "/first")
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click()
  await page.getByRole("button", { name: "Add panel below", exact: true }).click()
  await addOther(page, "GPS map")
  await expect(page.getByRole("heading", { name: "Edit GPS map panel", exact: true })).toBeVisible()
  await page.getByRole("combobox", { name: "GPS devices", exact: true }).click()
  await page.getByRole("option", { name: "Field tracker", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("combobox", { name: "Geofence overlay", exact: true }).click()
  await page.getByRole("option", { name: "Pasture", exact: true }).click()
  await page.getByRole("button", { name: "Apply to dashboard", exact: true }).click()
  await expect(page.getByRole("button", { name: "Panel menu: GPS map", exact: true })).toBeInViewport()
  expect(calls.writes).toBe(0)
  await page.getByRole("button", { name: "Kiosk", exact: true }).click()
  await expect(page.locator("[data-kiosk]")).toBeFocused()
  await expect(page.locator("#root")).toHaveAttribute("inert", "")
  expect(await page.locator("[data-kiosk]").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press("Escape")
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()
  await expect(page.locator("[data-slot=page-header]")).toHaveCSS("position", "sticky")
  await page.getByRole("button", { name: "Save dashboard", exact: true }).click()
  await expect.poll(() => calls.writes).toBe(1)
  const added = dashboards[0].widgets.at(-1)!
  expect(added.config.location_device_uuids).toEqual([deviceId])
  expect(added.config.geofence_uuid).toBe(parameterId)
  expect(dashboards[0].layouts.lg?.find(item => item.i === added.id)?.y).toBeGreaterThanOrEqual(30)
  await page.reload()
  await page.getByRole("button", { name: "Panel menu: GPS map", exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole("button", { name: "Panel menu: GPS map", exact: true })).toBeInViewport()
  expect(errors).toEqual([])
})

test("multiple dashboards, explicit apply/save, and save before switching", async ({
  page,
}, info) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath)
  await expect(page.getByText("Plant overview", { exact: true })).toBeVisible()
  await expect(page.getByText("Utilities", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New dashboard", exact: true }).click()
  await page.getByLabel("Dashboard name", { exact: true }).fill("Cooling plant")
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create dashboard", exact: true })
    .click()
  await expect(page).toHaveURL(/dashboards\/created-2$/)
  expect(dashboards).toHaveLength(3)
  await page.goto(basePath + "/first")
  await expect(page.getByText("23.5", { exact: false }).first()).toBeVisible()
  const before = calls.writes
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await menu(page)
  await page.getByRole("menuitem", { name: "Edit panel", exact: true }).click()
  await page.getByLabel("Panel title", { exact: true }).fill("Cooling status")
  await page.getByRole("button", { name: "Add threshold", exact: true }).click()
  await page.getByLabel("From", { exact: true }).nth(3).fill("50")
  await page
    .getByRole("button", { name: "Apply to dashboard", exact: true })
    .click()
  expect(calls.writes).toBe(before)
  await page.getByRole("button", { name: "Plant overview", exact: true }).click()
  await page.getByRole("option", { name: "Utilities", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page
    .getByRole("button", { name: "Save and leave", exact: true })
    .click()
  await expect(page).toHaveURL(/dashboards\/second$/)
  expect(calls.writes).toBe(before + 1)
  expect(dashboards[0].widgets[0].title).toBe("Cooling status")
  expect(dashboards[0].widgets[0].config.sources[0].thresholds).toHaveLength(4)
  expect(dashboards[1].widgets).toHaveLength(0)
  await page.goto(basePath + "/first")
  await expect(page.getByText("Cooling status", { exact: true })).toBeVisible()
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible()
  await page.screenshot({ path: info.outputPath("dashboard-desktop.png") })
  expect(errors).toEqual([])
})

test("time travel changes chart queries, never latest values or saved defaults", async ({
  page,
}, info) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible()
  await expect(page.getByText("Latest", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Time range", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/last valid value received/)).toBeVisible()
  const defaults = structuredClone(dashboards[0].defaults),
    latest = calls.latest
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  await page.getByLabel("From", { exact: true }).fill("2026-09-01T00:00")
  await page.getByLabel("To", { exact: true }).fill("2026-09-02T00:00")
  await page
    .getByRole("button", { name: "Apply time range", exact: true })
    .click()
  await expect(page).toHaveURL(/from=2026-09-01/)
  await expect
    .poll(() => calls.historyWindows.some((w) => w.includes("2026-09-01")))
    .toBe(true)
  expect(calls.latest).toBe(latest)
  expect(calls.writes).toBe(0)
  expect(dashboards[0].defaults).toEqual(defaults)
  await expect(
    page.getByText(/last valid value received/).locator("time"),
  ).toHaveAttribute("title", /12:00/)
  await page.goBack()
  await expect(
    page.getByRole("radio", { name: "Last 6 hours", exact: true }),
  ).toHaveAttribute("aria-checked", "true")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true)
  await page.screenshot({
    path: info.outputPath("dashboard-mobile.png"),
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test("cancel and conflict preserve saved data and unsaved drafts", async ({
  page,
}) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Dashboard settings", exact: true })
    .click()
  await page.getByLabel("Dashboard name", { exact: true }).fill("Local draft")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Discard and reload", exact: true })
    .click()
  expect(calls.writes).toBe(0)
  await expect(
    page.getByRole("heading", { name: "Plant overview", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Dashboard settings", exact: true })
    .click()
  await page
    .getByLabel("Dashboard name", { exact: true })
    .fill("Preserved draft")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  calls.conflict = true
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Reload saved dashboard…", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Dashboard settings", exact: true })
    .click()
  await expect(page.getByLabel("Dashboard name", { exact: true })).toHaveValue(
    "Preserved draft",
  )
  expect(dashboards[0].name).toBe("Plant overview")
  expect(errors).toEqual([])
})

test("paginated selectors, no-reading parameters, per-source copying, and panel preview", async ({
  page,
}, info) => {
  const { calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await menu(page)
  await page.getByRole("menuitem", { name: "Edit panel", exact: true }).click()
  await page.getByRole("combobox", { name: "Device", exact: true }).click()
  await page
    .getByRole("button", { name: "Next device options", exact: true })
    .click()
  await page.getByRole("option", { name: "Boiler room", exact: true }).click()
  await page.getByRole("combobox", { name: "Parameter", exact: true }).click()
  await page.getByRole("option", { name: /Return temperature/ }).click()
  await page.getByRole("button", { name: "Add parameter", exact: true }).click()
  await expect(
    page.getByText("Waiting for a reading", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("combobox", { name: "Configure parameter", exact: true })
    .click()
  await page
    .getByRole("option", { name: "Temperature · Boiler room", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Copy thresholds", exact: true })
    .click()
  await page.getByRole("checkbox", { name: /Return temperature/ }).check()
  await page
    .getByRole("button", { name: "Replace selected thresholds", exact: true })
    .click()
  await page.screenshot({ path: info.outputPath("panel-editor.png") })
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  expect(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([])
  await page
    .getByRole("button", { name: "Apply to dashboard", exact: true })
    .click()
  expect(calls.writes).toBe(0)
  expect(errors).toEqual([])
})

test("state and colour history panels select only compatible parameters", async ({
  page,
}) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()

  async function addHistoryPanel(
    type: "State history" | "Colour history",
    parameter: RegExp,
    other: { type: string; reason: string },
  ) {
    await page.getByRole("button", { name: "Add panel", exact: true }).click()
    const dialog = await chooseParameters(page, [parameter])
    // The other history panel cannot show this parameter and says why.
    await dialog.getByRole("combobox", { name: /^Visualization:/ }).click()
    const unavailable = page.getByRole("option", { name: new RegExp(`^${other.type}`) })
    await expect(unavailable).toHaveAttribute("aria-disabled", "true")
    await expect(unavailable).toContainText(other.reason)
    await page.keyboard.press("Escape")
    await dialog
      .getByRole("article", { name: `${type} suggestion` })
      .getByRole("button", { name: "Add panel", exact: true })
      .click()
    await expect(dialog).toHaveCount(0)
  }

  await addHistoryPanel("State history", /^Power/, { type: "Colour history", reason: "Needs colour parameters." })
  await expect(page.getByText("On (1)", { exact: true })).toBeVisible()
  await addHistoryPanel("Colour history", /^Colour/, { type: "State history", reason: "Needs boolean or enum parameters." })
  await expect(page.getByText("#22C55E", { exact: true })).toBeVisible()

  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click()
  await expect.poll(() => calls.writes).toBe(1)
  expect(dashboards[0].widgets.map((widget) => widget.type)).toEqual(
    expect.arrayContaining(["state_history", "color_history"]),
  )
  expect(errors).toEqual([])
})

test("consumption panels show counter usage per day in the site's time zone", async ({
  page,
}, info) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click()
  await page.getByRole("button", { name: "Add panel", exact: true }).click()
  const dialog = await chooseParameters(page, [/^Energy/])
  // A running total leads with consumption, previewed with its data.
  const suggestion = dialog.getByRole("article", { name: "Consumption suggestion" })
  await expect(suggestion).toContainText("Best fit")
  await expect(suggestion).toContainText("meter resets handled")
  await expect(dialog.getByRole("article", { name: "Gauge suggestion" })).toHaveCount(0)
  await suggestion.getByRole("button", { name: "Customize", exact: true }).click()

  await page.getByRole("combobox", { name: "Period", exact: true }).click()
  await page.getByRole("option", { name: "Last 7 days", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Bars", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Apply to dashboard", exact: true }).click()

  const panel = page.locator(".react-grid-item").filter({ has: page.getByRole("button", { name: "Panel menu: Energy", exact: true }) })
  await expect(panel.getByText("Last 7 days so far · per day")).toBeVisible()
  await expect(panel.getByText(/^25\.75\s*kWh$/)).toBeVisible()
  await expect(panel.getByRole("note")).toContainText("1 meter reset or rollover handled.")
  await expect(panel.getByRole("note")).toContainText("Days start at midnight, America/Toronto time.")
  const chart = panel.getByRole("img", { name: /^Energy: kWh per day/ })
  await expect(chart.locator("svg")).toBeVisible()
  // Three bars for the three days with readings, drawn as SVG paths.
  await expect.poll(() => chart.locator("svg path[fill]").count()).toBeGreaterThanOrEqual(3)
  // A screen-reader table carries every day; days without readings stay empty, not zero.
  const rows = panel.locator("table.sr-only tbody tr")
  await expect(rows).toHaveCount(7)
  await expect(rows.nth(2)).toContainText("4.25 kWh (partial)")
  await expect(rows.nth(6)).toContainText("No readings")
  // The calendar week is cut at Toronto midnight and asks for that zone.
  const request = calls.increase.at(-1)!
  expect(request.get("bucket")).toBe("1d")
  expect(request.get("timezone")).toBe("America/Toronto")
  expect(new Date(request.get("from")!).getUTCHours()).toBe(4)
  await page.screenshot({ path: info.outputPath("consumption.png") })
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([])

  await page.getByRole("button", { name: "Save dashboard", exact: true }).click()
  await expect.poll(() => calls.writes).toBe(1)
  const saved = dashboards[0].widgets.find((w) => w.type === "consumption")!
  expect(saved.config).toMatchObject({ period: "7d", bucket: "auto" })
  expect(saved.config.sources.map((s) => s.parameter_uuid)).toEqual([energyParameter])
  expect(errors).toEqual([])
})

test("viewers can explore dashboards but cannot create or edit", async ({
  page,
}) => {
  const { errors } = await setup(page, false)
  await page.goto(basePath)
  await expect(page.getByText("Plant overview", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "New dashboard", exact: true }),
  ).toHaveCount(0)
  await page.goto(basePath + "/first?edit-panel=status")
  await expect(page).not.toHaveURL(/edit-panel/)
  await expect(page.getByLabel("Panel title", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Edit dashboard", exact: true }),
  ).toHaveCount(0)
  await menu(page)
  await expect(
    page.getByRole("menuitem", { name: "Edit panel", exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole("menuitem", { name: "View fullscreen", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  expect(errors).toEqual([])
})

test("control panels group devices and persist responsive card columns", async ({
  page,
}) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await page.getByRole("button", { name: "Add panel", exact: true }).click()
  const dialog = await chooseParameters(page, [/^Power/, /^Colour/])
  // Writable parameters lead with controls, previewed with their data.
  const suggestion = dialog.getByRole("article", { name: "Controls suggestion" })
  await expect(suggestion).toContainText("Best fit")
  await expect(suggestion).toContainText("All writable")
  await suggestion.getByRole("button", { name: "Customize", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Visualization: Controls" })).toBeVisible()
  const columns = page.locator('[aria-label="Cards per row"]')
  await expect(columns.locator('[data-state="on"]')).toHaveText("Auto")
  await columns.getByText("3", { exact: true }).click()
  await page
    .getByRole("button", { name: "Apply to dashboard", exact: true })
    .click()

  const grid = page.locator('.device-controls-grid[data-columns="3"]')
  await expect(grid).toBeVisible()
  await expect(grid.locator(":scope > div")).toHaveCount(2)
  await expect(grid.locator("xpath=../../..").locator("h3")).toHaveCount(1)
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click()

  await expect.poll(() => calls.writes).toBe(1)
  expect(
    dashboards[0].widgets.find((widget) => widget.type === "controls")?.config
      .columns,
  ).toBe(3)
  expect(errors).toEqual([])
})

test("dashboard settings use a side sheet and panels expose fit height", async ({
  page,
}) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()

  await expect(
    page.getByRole("heading", { name: "Dashboard settings", exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole("button", { name: "Dashboard settings", exact: true })
    .click()
  const settings = page.getByRole("dialog", { name: "Dashboard settings" })
  await expect(settings).toBeVisible()
  await expect(settings.getByText("Current viewing settings")).toBeVisible()
  await settings.getByLabel("Dashboard name", { exact: true }).fill("Plant floor")
  await settings.getByRole("button", { name: "Close", exact: true }).click()

  const panel = page.locator(".react-grid-item").first()
  await expect(panel.locator(".react-resizable-handle-s")).toBeVisible()
  await expect(panel.locator(".react-resizable-handle-e")).toBeVisible()
  await expect(panel.locator(".react-resizable-handle-se")).toBeVisible()
  await menu(page)
  await page
    .getByRole("menuitem", { name: "Fit height to content", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click()

  await expect.poll(() => calls.writes).toBe(1)
  expect(dashboards[0].name).toBe("Plant floor")
  expect(
    Object.values(dashboards[0].layouts)
      .flat()
      .some((item) => item?.i === "status" && item.h < 6),
  ).toBe(true)
  expect(errors).toEqual([])
})

test("dragging and duplication stay in the draft until Save", async ({
  page,
}) => {
  const { calls, dashboards, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  const handle = await page
    .getByLabel("Drag panel", { exact: true })
    .first()
    .boundingBox()
  expect(handle).not.toBeNull()
  await page.mouse.move(handle!.x + 5, handle!.y + 5)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 100, handle!.y + 160, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()
  expect(calls.writes).toBe(0)
  await menu(page)
  await page
    .getByRole("menuitem", { name: "Duplicate panel", exact: true })
    .click()
  await expect(
    page.getByText("Current temperature (copy)", { exact: true }),
  ).toBeVisible()
  expect(calls.writes).toBe(0)
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click()
  await expect.poll(() => calls.writes).toBe(1)
  expect(dashboards[0].widgets).toHaveLength(3)
  expect(Object.keys(dashboards[0].layouts)).toContain("md")
  expect(errors).toEqual([])
})

test("plot zoom updates history and manual refresh keeps absolute bounds", async ({
  page,
}) => {
  const { calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  const plot = page.locator(".recharts-wrapper")
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible()
  const box = await plot.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 85, box!.y + 60)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width - 70, box!.y + 60, { steps: 8 })
  await page.mouse.up()
  await expect(page).toHaveURL(/from=/)
  const before = calls.history
  const bounds = new URL(page.url()).searchParams
  await page
    .getByRole("button", { name: "Refresh dashboard", exact: true })
    .click()
  await expect.poll(() => calls.history).toBeGreaterThan(before)
  const after = new URL(page.url()).searchParams
  expect(after.get("from")).toBe(bounds.get("from"))
  expect(after.get("to")).toBe(bounds.get("to"))
  expect(calls.writes).toBe(0)
  expect(errors).toEqual([])
})

test("relative charts poll in place without replacing rendered data", async ({
  page,
}) => {
  const { calls, errors } = await setup(page, true, { historyDelayMs: 500 })
  await page.goto(basePath + "/first?refresh=5")
  const chart = page.locator(".recharts-wrapper").first()
  await expect(chart).toBeVisible()
  const initialHistoryCalls = calls.history

  await expect
    .poll(() => calls.history, { timeout: 8000 })
    .toBeGreaterThan(initialHistoryCalls)
  await expect(chart).toBeVisible()
  expect(errors).toEqual([])
})

test("browser timezone rejects nonexistent daylight-saving input", async ({
  browser,
}) => {
  const context = await browser.newContext({ timezoneId: "America/Edmonton" })
  const page = await context.newPage()
  await setup(page)
  await page.goto(basePath + "/first")
  await page.getByRole("radio", { name: "Browser", exact: true }).click()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  await page.getByLabel("From", { exact: true }).fill("2026-03-08T02:30")
  await page.getByLabel("To", { exact: true }).fill("2026-03-08T04:00")
  await page
    .getByRole("button", { name: "Apply time range", exact: true })
    .click()
  await expect(page.getByRole("alert")).toContainText("Enter valid")
  await page.getByLabel("From", { exact: true }).fill("2026-03-08T01:30")
  await page
    .getByRole("button", { name: "Apply time range", exact: true })
    .click()
  await expect(page).toHaveURL(/from=2026-03-08T08/)
  await context.close()
})


test("workflow panels preview, persist, refresh failures and remain usable on mobile", async ({ page }, info) => {
  const { dashboards, calls, errors } = await setup(page)
  // Saved workflow location panels remain readable; new location panels use GPS maps.
  dashboards[0].widgets.push({ id: "legacy-location", type: "location", schema_version: 2, title: "Legacy location", description: "", config: { sources: [], workflow_uuid: "workflow-one" } })
  dashboards[0].layouts.lg.push({ i: "legacy-location", x: 0, y: 12, w: 6, h: 6 })
  let unavailable = false
  let locationReads = 0
  await page.route("**/workflows**", async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/location-overview")) {
      locationReads++
      return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable
        ? { message: "Location evidence unavailable" }
        : { data: { workflow_name: "Pasture boundary", deployment_status: "inactive", snapshot: null } } })
    }
    if (path.endsWith("/alert-overview")) return route.fulfill({ json: { data: {
      workflow_name: "Pasture boundary", active: 1, unacknowledged_active: 0, total: 2,
      checked_at: new Date().toISOString(), recent: [
        { uuid: "alert-one", episode: 1, activated_at: new Date().toISOString(), cleared_at: null, acknowledged_at: new Date().toISOString() },
        { uuid: "alert-two", episode: 2, activated_at: new Date().toISOString(), cleared_at: new Date().toISOString(), acknowledged_at: null }
      ]
    } } })
    return route.fulfill({ json: { data: [{ uuid: "workflow-one", name: "Pasture boundary" }], meta: { current_page: 1, last_page: 1, total: 1 } } })
  })
  await page.goto(basePath + "/first")
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click()
  for (const type of ["Alerts"]) {
    await page.getByRole("button", { name: "Add panel", exact: true }).click()
    await addOther(page, type)
    await expect(page.getByRole("button", { name: "Apply to dashboard", exact: true })).toBeDisabled()
    await page.getByRole("combobox", { name: "Workflow", exact: true }).click()
    await page.getByRole("option", { name: "Pasture boundary", exact: true }).click()
    await expect(page.getByText("1 active", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Apply to dashboard", exact: true }).click()
  }
  expect(calls.writes).toBe(0)
  await page.getByRole("button", { name: "Save dashboard", exact: true }).click()
  await expect.poll(() => calls.writes).toBe(1)
  expect(dashboards[0].widgets.slice(-2).map(w => w.config)).toEqual([
    { sources: [], workflow_uuid: "workflow-one" }, { sources: [], workflow_uuid: "workflow-one" }
  ])
  await page.reload()
  await expect(page.getByText("No applied workflow", { exact: true })).toBeVisible()
  await expect(page.getByText("0 active, unacknowledged", { exact: true })).toBeVisible()
  await expect(page.getByText("Cleared", { exact: true })).toBeVisible()
  await page.screenshot({ fullPage: true })
  await page.screenshot({ path: info.outputPath("workflow-panels-desktop.png") })
  const before = locationReads
  unavailable = true
  await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click()
  await expect.poll(() => locationReads).toBeGreaterThan(before)
  await expect(page.getByRole("button", { name: "Retry location" })).toBeVisible()
  await expect(page.getByText("No applied workflow", { exact: true })).toHaveCount(0)
  await expect(page.getByText("1 active", { exact: true })).toBeVisible()
  unavailable = false
  await page.getByRole("button", { name: "Retry location" }).click()
  await expect(page.getByText("No applied workflow", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click()
  await page.getByRole("button", { name: "Add panel", exact: true }).click()
  await addOther(page, "Alerts")
  await page.getByRole("combobox", { name: "Workflow", exact: true }).click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page.getByText("1 active", { exact: true })).toBeVisible()
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  expect(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("workflow-editor-mobile.png"), fullPage: true })
  expect(errors).toEqual([])
})


test("location marker expires with polling paused and newer incomplete evidence stays unknown", async ({ page }) => {
  const { dashboards } = await setup(page)
  dashboards[0].widgets = [{ id: "location", type: "location", schema_version: 2, title: "Location", description: "", config: { sources: [], workflow_uuid: "workflow-one" } }]
  dashboards[0].layouts = { lg: [{ i: "location", x: 0, y: 0, w: 6, h: 10 }] }
  let incomplete = false
  await page.route("**/workflows/workflow-one/location-overview", route => {
    const now = new Date().toISOString()
    return route.fulfill({ json: { data: { workflow_name: "Boundary", deployment_status: "applied", snapshot: {
      evaluated_at: now, max_age_seconds: 3,
      geometry: { coordinates: [[[-115,51],[-113,51],[-113,52],[-115,52],[-115,51]]] },
      fix: { event_id: "event-one", status: incomplete ? "unknown" : "valid", reason: incomplete ? "incomplete_event" : "valid", observed_at: now, received_at: now, historical: false, point: incomplete ? null : { latitude: 51.5, longitude: -114.1, accuracy_metres: null } },
      execution: { enabled: true, stopped_reason: null, consumer_healthy: true, state: { last_event_id: "event-one", condition: "inside", active: false, expires_at: new Date(Date.now()+3000).toISOString() } }
    } } } })
  })
  await page.goto(basePath + "/first")
  await expect(page.getByRole("img", { name: "Geofence outline and reported location", exact: true })).toBeVisible()
  await expect(page.getByText("51.500000", { exact: true })).toBeVisible()
  await expect(page.getByText("Unknown location", { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole("img", { name: "Geofence outline; no current location marker", exact: true })).toBeVisible()
  incomplete = true
  await page.getByRole("button", { name: "Refresh dashboard", exact: true }).click()
  await expect(page.getByText("incomplete event", { exact: true })).toBeVisible()
  await expect(page.getByText("51.500000", { exact: true })).toHaveCount(0)
})


test("chart labels survive repeated layout changes, full-page capture and refresh", async ({ page }) => {
  const { errors, calls } = await setup(page)
  await page.goto(basePath + "/first")
  for (const width of [1440, 1000, 390, 1440]) {
    await page.setViewportSize({width, height: 900})
    await expect(page.getByRole("list", {name: "Chart legend"})).toContainText("Temperature")
    await expect(page.locator(".recharts-line-curve").first()).toBeVisible()
    await expect.poll(() => page.locator(".react-grid-item").evaluateAll(items =>
      items.every(item => getComputedStyle(item).transitionDuration === "0s")
    )).toBe(true)
    await page.screenshot({fullPage: true})
    const before = calls.history
    await page.getByRole("button", {name: "Refresh dashboard", exact: true}).click()
    await expect.poll(() => calls.history).toBeGreaterThan(before)
  }
  expect(errors).toEqual([])
})

test("enabling a primary button restores full contrast immediately", async ({page}) => {
  await setup(page)
  await page.goto(basePath + "/first")
  await page.getByRole("button", {name: "Edit dashboard", exact: true}).click()
  const save = page.getByRole("button", {name: "Save dashboard", exact: true})
  await expect(save).toBeDisabled()
  await expect(save).toHaveCSS("opacity", "0.5")
  // Sample the first painted frame after enabling, not the end of a transition.
  await save.evaluate(button => {
    (window as any).__enabledOpacity = null
    new MutationObserver((_, observer) => {
      if (!(button as HTMLButtonElement).disabled) {
        observer.disconnect()
        requestAnimationFrame(() => { (window as any).__enabledOpacity = getComputedStyle(button).opacity })
      }
    }).observe(button, {attributes: true, attributeFilter: ["disabled"]})
  })
  await page.getByRole("button", {name: "Dashboard settings", exact: true}).click()
  await page.getByLabel("Dashboard name", {exact: true}).fill("Changed name")
  await expect.poll(() => page.evaluate(() => (window as any).__enabledOpacity)).not.toBeNull()
  expect(await page.evaluate(() => (window as any).__enabledOpacity)).toBe("1")
})

test("editor links open saved panels and drop unknown ones", async ({
  page,
}) => {
  const { calls, errors } = await setup(page)
  await page.goto(basePath + "/first?edit-panel=chart")
  await expect(
    page.getByRole("heading", { name: "Edit Time series panel", level: 1 }),
  ).toBeVisible()
  await expect(page.getByLabel("Panel title", { exact: true })).toHaveValue(
    "Temperature history",
  )
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page).not.toHaveURL(/edit-panel/)
  await expect(
    page.getByRole("button", { name: "Save dashboard", exact: true }),
  ).toBeVisible()
  await page.goto(basePath + "/first?edit-panel=missing")
  await expect(page).not.toHaveURL(/edit-panel/)
  await expect(
    page.getByRole("button", { name: "Edit dashboard", exact: true }),
  ).toBeVisible()
  expect(calls.writes).toBe(0)
  expect(errors).toEqual([])
})

test("panel exports, kiosk, new panel types, editor back and undo", async ({
  page,
}) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath + "/first")
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible()
  const download = page.waitForEvent("download")
  await menu(page, "Temperature history")
  await page.getByRole("menuitem", { name: "Download CSV", exact: true }).click()
  expect((await download).suggestedFilename()).toBe("temperature-history.csv")
  await menu(page)
  await page.getByRole("menuitemradio", { name: "Table", exact: true }).click()
  await expect(page.getByRole("columnheader", { name: "Band" })).toBeVisible()

  await page.getByRole("button", { name: "Kiosk", exact: true }).click()
  await expect(page).toHaveURL(/kiosk=1/)
  // Focus moves into kiosk and the shell behind it is inert.
  await expect(page.locator("[data-kiosk]")).toBeFocused()
  await expect(page.locator("#root")).toHaveAttribute("inert", "")
  await expect(page.getByRole("button", { name: "Exit kiosk" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).not.toHaveURL(/kiosk=1/)
  await expect(page.getByRole("button", { name: "Kiosk", exact: true })).toBeFocused()
  await expect(page.locator("#root")).not.toHaveAttribute("inert")

  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click()
  await page.getByRole("button", { name: "Add panel", exact: true }).click()
  await addOther(page, "Text")
  await page.getByLabel("Text", { exact: true }).fill("<b>Call Ext 4410</b>")
  await page.getByRole("button", { name: "Apply to dashboard", exact: true }).click()
  // Stored as plain text and rendered as text, never as HTML.
  await expect(page.getByText("<b>Call Ext 4410</b>", { exact: true })).toBeVisible()
  await expect(page.locator("b", { hasText: "Call Ext 4410" })).toHaveCount(0)

  await page.getByRole("button", { name: "Add panel", exact: true }).click()
  const dialog = await chooseParameters(page, [/^Temperature/])
  // Without a profile range the gauge is not suggested but stays one pick away.
  await expect(dialog.getByRole("article", { name: "Status suggestion" })).toContainText("Best fit")
  await expect(dialog.getByRole("article", { name: "Gauge suggestion" })).toHaveCount(0)
  await dialog.getByRole("combobox", { name: "Visualization: Status" }).click()
  await page.getByRole("option", { name: /^Gauge/ }).click()
  await expect(page.getByRole("combobox", { name: "Visualization: Gauge" })).toBeVisible()
  await page.getByLabel("Maximum", { exact: true }).fill("40")
  await page.getByRole("button", { name: "Apply to dashboard", exact: true }).click()
  await expect(page.getByRole("meter", { name: "Temperature" })).toHaveAttribute(
    "aria-valuenow",
    "23.5",
  )

  // The editor is a page of its own; Back returns to edit mode with the draft.
  await menu(page)
  await page.getByRole("menuitem", { name: "Edit panel", exact: true }).click()
  await expect(page).toHaveURL(/edit-panel=status/)
  await page.getByRole("link", { name: "Back to Plant overview", exact: true }).click()
  await expect(page).not.toHaveURL(/edit-panel/)
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()

  await menu(page, "Text")
  await page.getByRole("menuitem", { name: "Remove panel", exact: true }).click()
  await expect(page.getByText("<b>Call Ext 4410</b>", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByText("<b>Call Ext 4410</b>", { exact: true })).toBeVisible()

  expect(calls.writes).toBe(0)
  await page.getByRole("button", { name: "Save dashboard", exact: true }).click()
  await expect.poll(() => calls.writes).toBe(1)
  const widgets = dashboards[0].widgets
  expect(widgets.find((w) => w.type === "text")?.config).toEqual({
    sources: [],
    text: "<b>Call Ext 4410</b>",
  })
  expect(widgets.find((w) => w.type === "gauge")?.config).toMatchObject({
    min: 0,
    max: 40,
  })
  expect(errors).toEqual([])
})

// Library: setup() plus star, duplicate, delete, device list and profile groups.
async function library(page: Page, manage = true) {
  const state = await setup(page, manage)
  const { dashboards } = state
  Object.assign(dashboards[0], {
    tags: ["energy", "boiler"],
    folder: "Plant floor",
    starred: true,
    last_viewed_at: new Date(Date.now() - 60000).toISOString(),
  })
  Object.assign(dashboards[1], {
    created_by: 2,
    created_by_name: "Someone else",
    updated_at: "2026-09-05T00:00:00Z",
  })
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      method = request.method(),
      path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, json: data })
    const body = request.postDataJSON()
    if (method !== "GET") writes.push({ method, path, body })
    const match = /\/dashboards\/([^/]+)(?:\/(star|duplicate))?$/.exec(path)
    const index = match ? dashboards.findIndex((d) => d.uuid === match[1]) : -1
    if (match?.[2] === "star") {
      dashboards[index].starred = body.starred === true
      return json({ data: dashboards[index] })
    }
    if (match?.[2] === "duplicate") {
      const copy = {
        ...structuredClone(dashboards[index]),
        uuid: `copy-${dashboards.length}`,
        name: String(body.name),
        starred: false,
        last_viewed_at: null,
      }
      dashboards.push(copy)
      return json({ data: copy }, 201)
    }
    if (match && method === "DELETE") {
      dashboards.splice(index, 1)
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith("/dashboards") && method === "POST" && body.name === "Rejected import")
      return json(
        {
          message: "The given data was invalid.",
          errors: {
            "widgets.0.config.sources.0.device_uuid": [
              "Choose a device in this organization.",
            ],
          },
        },
        422,
      )
    if (path.endsWith("/devices"))
      return json({
        data: [
          {
            uuid: deviceId,
            name: "Boiler room",
            code: "boiler-1",
            profile: { uuid: "profile-1", name: "Boiler profile", revision: 2 },
          },
          { uuid: "other", name: "Other device", code: "other-1", profile: null },
        ],
        meta: { current_page: 1, last_page: 1, total: 2 },
      })
    if (path.endsWith("/device-profiles/profile-1"))
      return json({
        data: {
          uuid: "profile-1",
          parameter_groups: [{ uuid: "g1", label: "Temperatures" }],
          parameters: [parameterId, secondParameter].map((uuid) => ({
            uuid,
            parameter_group_uuid: "g1",
          })),
        },
      })
    return route.fallback()
  })
  return { ...state, writes }
}

async function downloaded(page: Page, click: () => Promise<void>) {
  const { readFile } = await import("node:fs/promises")
  const event = page.waitForEvent("download")
  await click()
  const file = await event
  return {
    name: file.suggestedFilename(),
    data: JSON.parse(await readFile(await file.path(), "utf8")),
  }
}

test("library views, filters, stars and row actions", async ({ page }) => {
  const { dashboards, writes, calls, errors } = await library(page)
  await page.goto(basePath)
  const views = page.getByRole("navigation", { name: "Dashboard views" })
  const plant = page.getByRole("link", { name: "Plant overview", exact: true })
  const utilities = page.getByRole("link", { name: "Utilities", exact: true })
  await expect(plant).toBeVisible()
  await expect(utilities).toBeVisible()
  await expect(page.getByRole("heading", { name: "Dashboards", level: 1 })).toBeVisible()
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  expect(scan.violations).toEqual([])

  await views.getByRole("link", { name: /^Starred/ }).click()
  await expect(page).toHaveURL(/view=starred/)
  await expect(utilities).toHaveCount(0)
  await views.getByRole("link", { name: /^Created by me/ }).click()
  await expect(plant).toBeVisible()
  await expect(utilities).toHaveCount(0)
  await views.getByRole("link", { name: /^Unfiled/ }).click()
  await expect(plant).toHaveCount(0)
  await expect(utilities).toBeVisible()
  await views.getByRole("link", { name: /^All dashboards/ }).click()

  const search = page.getByRole("searchbox", { name: "Search dashboards" })
  await search.fill("boiler room")
  await expect(utilities).toHaveCount(0)
  await search.fill("nothing like this")
  await expect(page.getByText("No matching dashboards")).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(utilities).toBeVisible()
  await page.getByRole("button", { name: /^Tags/ }).click()
  await page.getByRole("option", { name: "energy" }).click()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/tag=energy/)
  await expect(utilities).toHaveCount(0)
  await page.goto(basePath + "?sort=name")

  await page.getByRole("button", { name: "Star Utilities" }).click()
  await expect(page.getByRole("button", { name: "Star Utilities" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(dashboards[1].starred).toBe(true)

  await page.getByRole("button", { name: "Actions for Utilities" }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Dashboard name").fill("Utilities east")
  await dialog.getByLabel("Tags").fill("water, Water, power")
  await dialog.getByLabel("Folder").fill("Plant floor")
  calls.conflict = true
  await dialog.getByRole("button", { name: "Save settings" }).click()
  await expect(dialog.getByText("This dashboard changed since the list loaded.")).toBeVisible()
  calls.conflict = false
  await dialog.getByRole("button", { name: "Reload dashboards" }).click()
  await expect(dialog.getByLabel("Tags")).toHaveValue("water, Water, power")
  await dialog.getByRole("button", { name: "Save settings" }).click()
  await expect(page.getByRole("link", { name: "Utilities east", exact: true })).toBeVisible()
  expect(writes.at(-1)).toMatchObject({
    method: "PUT",
    path: expect.stringMatching(/dashboards\/second$/),
    body: { revision: 1, tags: ["water", "power"], folder: "Plant floor", name: "Utilities east" },
  })

  await page.getByRole("button", { name: "Actions for Plant overview" }).click()
  await page.getByRole("menuitem", { name: "Move to folder" }).click()
  await dialog.getByLabel("Folder").fill("Energy")
  await dialog.getByRole("button", { name: "Move" }).click()
  await expect(views.getByRole("link", { name: /^Energy/ })).toBeVisible()

  await page.getByRole("button", { name: "Actions for Plant overview" }).click()
  await page.getByRole("menuitem", { name: "Duplicate" }).click()
  await dialog.getByRole("button", { name: "Duplicate" }).click()
  await expect(page.getByRole("link", { name: "Plant overview copy", exact: true })).toBeVisible()
  expect(dashboards).toHaveLength(3)

  const single = await downloaded(page, async () => {
    await page.getByRole("button", { name: "Actions for Plant overview", exact: true }).click()
    await page.getByRole("menuitem", { name: "Export JSON" }).click()
  })
  expect(single.name).toBe("plant-overview.json")
  expect(Object.keys(single.data).sort()).toEqual(
    ["defaults", "folder", "layouts", "name", "tags", "widgets"],
  )
  expect(single.data.widgets).toHaveLength(2)

  await page.getByRole("checkbox", { name: "Select all dashboards" }).click()
  await expect(page.getByText("3 selected")).toBeVisible()
  const bulk = await downloaded(page, () =>
    page.getByRole("button", { name: "Export JSON" }).click(),
  )
  expect(bulk.name).toBe("dashboards.json")
  expect(bulk.data).toHaveLength(3)
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toContainText("Delete 3 dashboards?")
  await page.getByRole("button", { name: "Delete dashboards" }).click()
  await expect(page.getByText("No dashboards yet")).toBeVisible()
  expect(dashboards).toHaveLength(0)
  await expect(page.getByRole("button", { name: "Browse templates" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Browse templates" })).toBeVisible()
  expect(errors).toEqual([])
})

test("new dashboards from a device profile, a template and imported JSON", async ({ page }) => {
  const { dashboards, writes, errors } = await library(page)
  await page.goto(basePath)
  const more = page.getByRole("button", { name: "More ways to create a dashboard" })
  await more.click()
  await page.getByRole("menuitem", { name: "From device profile" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox", { name: "Device profile" }).click()
  await page.getByRole("option", { name: "Boiler profile" }).click()
  await expect(dialog.getByRole("checkbox", { name: /Boiler room/ })).toBeChecked()
  const panels = dialog.getByRole("list", { name: "Generated panels" })
  await expect(panels.getByRole("listitem")).toHaveCount(5)
  await dialog.getByRole("checkbox", { name: /Latest values/ }).click()
  await expect(dialog.getByLabel("Dashboard name")).toHaveValue("Boiler profile overview")
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  expect(scan.violations).toEqual([])
  await dialog.getByRole("button", { name: "Create dashboard" }).click()
  await expect(page).toHaveURL(/dashboards\/created-2$/)
  const fromProfile = dashboards[2]
  expect(fromProfile.widgets.map((w) => [w.type, w.title, w.config.sources.length])).toEqual([
    ["status", "Temperatures", 2],
    ["timeseries", "Temperatures (C)", 2],
    // The ungrouped energy counter becomes usage per period, not a running-total line.
    ["consumption", "Usage (kWh)", 1],
    ["controls", "Controls", 2],
  ])
  expect(fromProfile.layouts.lg?.map((l) => l.i)).toEqual(fromProfile.widgets.map((w) => w.id))

  await page.goto(basePath + "?view=templates")
  await page.getByRole("button", { name: "Use template RGB light controls" }).click()
  await expect(dialog.getByRole("list", { name: "Generated panels" })).toHaveCount(0)
  await dialog.getByRole("checkbox", { name: /Boiler room/ }).click()
  await expect(dialog.getByRole("list", { name: "Generated panels" }).getByRole("listitem")).toHaveCount(3)
  await dialog.getByLabel("Folder").fill("Lighting")
  await dialog.getByRole("button", { name: "Create dashboard" }).click()
  await expect(page).toHaveURL(/dashboards\/created-3$/)
  expect(dashboards[3]).toMatchObject({ name: "RGB light controls", folder: "Lighting" })
  expect(dashboards[3].widgets.map((w) => w.type)).toEqual([
    "controls",
    "state_history",
    "color_history",
  ])

  await page.goto(basePath)
  await more.click()
  await page.getByRole("menuitem", { name: "Import JSON" }).click()
  const file = dialog.getByLabel("JSON file")
  const upload = (name: string, data: unknown) =>
    file.setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
    })
  await file.setInputFiles({
    name: "huge.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, " "),
  })
  await expect(dialog.getByRole("alert")).toContainText("Choose a file of 2 MB or less.")
  await upload("bad.json", { name: "", widgets: {} })
  await expect(dialog.getByRole("alert")).toContainText("name must be text of 1 to 120 characters.")
  await upload("nested.json", {
    name: "Nested",
    widgets: [{ id: "t", schema_version: 2, type: "text", title: "Notes", config: { sources: [], text: { html: "<b>" } } }],
  })
  await expect(dialog.getByRole("alert")).toContainText(
    "Panel 1 (Notes) · config.text must be text of 1 to 4000 characters.",
  )
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled()
  const exported = {
    name: "Rejected import",
    widgets: [structuredClone(dashboards[0].widgets[0])],
    layouts: {},
    defaults: dashboards[0].defaults,
    tags: [],
    folder: null,
  }
  await upload("rejected.json", exported)
  await dialog.getByRole("button", { name: "Import" }).click()
  await expect(dialog.getByRole("alert")).toContainText(
    "Panel 1 (Current temperature) · config.sources.0.device_uuid: Choose a device in this organization.",
  )
  const before = dashboards.length
  await upload("two.json", [
    { ...exported, name: "Imported A" },
    { ...exported, name: "Imported B" },
  ])
  await dialog.getByRole("button", { name: "Import 2 dashboards" }).click()
  await expect(page.getByRole("link", { name: "Imported B", exact: true })).toBeVisible()
  expect(dashboards.length).toBe(before + 2)
  expect(writes.filter((w) => w.method === "POST").map((w) => w.body?.name)).toEqual([
    "Boiler profile overview",
    "RGB light controls",
    "Rejected import",
    "Imported A",
    "Imported B",
  ])
  expect(errors).toEqual([])
})

test("viewers browse the library without create or manage actions", async ({ page }, info) => {
  const { dashboards, errors } = await library(page, false)
  await page.goto(basePath + "?view=templates")
  await expect(page.getByRole("link", { name: "Plant overview", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New dashboard" })).toHaveCount(0)
  await expect(
    page.getByRole("navigation", { name: "Dashboard views" }).getByRole("link", { name: /^Templates/ }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Actions for Utilities" }).click()
  await expect(page.getByRole("menuitem")).toHaveText(["Open", "Export JSON"])
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Star Utilities" }).click()
  await expect.poll(() => dashboards[1].starred).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true)
  await page.screenshot({ path: info.outputPath("library-mobile.png") })
  dashboards.splice(0)
  await page.reload()
  await expect(page.getByText("No dashboards yet")).toBeVisible()
  await expect(
    page.getByText("People who manage devices can create dashboards for this organization."),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "New dashboard" })).toHaveCount(0)
  expect(errors).toEqual([])
})

test("version history previews a revision and restores after a conflict reload", async ({ page }) => {
  const { dashboards, errors } = await setup(page)
  dashboards[0].revision = 3
  const bodies: unknown[] = []
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const snapshot = (revision: number) => ({
      revision,
      name: "Plant overview",
      widget_count: revision === 1 ? 1 : 2,
      updated_by_name: "Dashboard operator",
      created_at: "2026-09-01T00:00:00Z",
    })
    if (path.endsWith("/dashboards/first/revisions"))
      return route.fulfill({ json: { data: [3, 2, 1].map(snapshot) } })
    if (path.endsWith("/dashboards/first/revisions/1"))
      return route.fulfill({
        json: {
          data: {
            ...snapshot(1),
            widgets: [dashboards[0].widgets[0]],
            layouts: {},
            defaults: dashboards[0].defaults,
            tags: [],
            folder: null,
          },
        },
      })
    if (path.endsWith("/dashboards/first/revisions/1/restore")) {
      bodies.push(route.request().postDataJSON())
      if (bodies.length === 1) {
        dashboards[0].revision = 4
        return route.fulfill({ status: 409, json: { message: "Changed in another session." } })
      }
      dashboards[0] = { ...dashboards[0], widgets: [dashboards[0].widgets[0]], revision: 5 }
      return route.fulfill({ json: { data: dashboards[0] } })
    }
    return route.fallback()
  })
  await page.goto(basePath + "/first")
  const open = async () => {
    await page.getByRole("button", { name: "More dashboard actions" }).click()
    await page.getByRole("menuitem", { name: "Version history" }).click()
  }
  const sheet = page.getByRole("dialog", { name: "Version history" })
  const restore = async () => {
    await sheet.getByRole("button", { name: "Restore version 1" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore version" }).click()
  }
  await open()
  await expect(sheet.getByRole("button", { name: /^v3/ })).toContainText("Current")
  await expect(sheet.getByRole("button", { name: "Restore version 3" })).toHaveCount(0)
  await sheet.getByRole("button", { name: /^v1/ }).click()
  await expect(sheet.getByRole("list", { name: "Panels in version 1" })).toContainText(
    "Current temperature",
  )
  await restore()
  await expect(sheet.getByText("This dashboard changed since you opened it.")).toBeVisible()
  await sheet.getByRole("button", { name: "Reload dashboard" }).click()
  await expect(sheet).toHaveCount(0)
  await open()
  await restore()
  await expect(sheet).toHaveCount(0)
  expect(bodies).toEqual([{ revision: 3 }, { revision: 4 }])
  expect(errors).toEqual([])
})


test("GPS map loads its worker, colours membership, and queries selectable dashed trails", async ({ page }, info) => {
  const { dashboards, errors } = await setup(page)
  const ids = [deviceId, "11111111-1111-4111-8111-111111111112", "11111111-1111-4111-8111-111111111113"]
  dashboards[0].widgets = [{ id: "gps", schema_version: 2, type: "location", title: "GPS monitoring", description: "", config: {
    sources: [], location_device_uuids: ids, geofence_uuid: "fence", show_trails: true, trail_window: "24h"
  } }]
  dashboards[0].layouts = { lg: [{ i: "gps", x: 0, y: 0, w: 12, h: 14 }] }
  const requests: { trail_window: string; include_trails: boolean }[] = []
  await page.route("**/location-map/query", route => {
    const input = route.request().postDataJSON()
    requests.push(input)
    return route.fulfill({ json: { data: {
      schema_version: "location-map.v1", trail_window: input.trail_window,
      geofence: { uuid: "fence", name: "Demo boundary", revision: 1, geometry: { type: "Polygon", coordinates: [[[-114.01,50.99],[-113.99,50.99],[-113.99,51.01],[-114.01,51.01],[-114.01,50.99]]] } },
      devices: ids.map((id, index) => ({ device_uuid: id, device_name: `Tracker ${index + 1}`, binding_uuid: id,
        condition: ["inside", "outside", "unknown"][index], wandering: false, active_alert: null, deployment_status: "applied",
        latest: { point: { longitude: -114 + index * 0.012, latitude: 51, accuracy_metres: 5 }, live_eligible: index < 2,
          received_at: new Date().toISOString(), observed_at: new Date().toISOString(), reason: index < 2 ? "eligible" : "stale" },
        trail: { sampled: false, segments: input.include_trails ? [[{ point: { longitude: -114, latitude: 50.996 } }, { point: { longitude: -114 + index * 0.012, latitude: 51 } }]] : [] }
      }))
    } } })
  })
  const workerResponse = page.waitForResponse(response => /maplibre-gl-worker.*\.js/.test(response.url()))
  await page.goto(basePath + "/first")
  expect((await workerResponse).ok()).toBe(true)
  await expect(page.getByRole("button", { name: "Tracker 1: inside", exact: true })).toHaveCSS("background-color", "rgb(22, 163, 74)")
  await expect(page.getByRole("button", { name: "Tracker 2: outside", exact: true })).toHaveCSS("background-color", "rgb(220, 38, 38)")
  await expect(page.getByRole("button", { name: "Tracker 3: unknown", exact: true })).toHaveCSS("background-color", "rgb(100, 116, 139)")
  await page.getByRole("radio", { name: "Last 1h of movement", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.trail_window).toBe("1h")
  await page.getByRole("switch", { name: "Movement trails", exact: true }).click()
  await expect.poll(() => requests.at(-1)?.include_trails).toBe(false)
  await page.getByRole("switch", { name: "Movement trails", exact: true }).click()
  await expect(page.getByRole("switch", { name: "Movement trails", exact: true })).toBeChecked()
  await expect(page.getByRole("region", { name: "GPS monitoring map", exact: true }).getByText("Off", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("gps-trails-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("switch", { name: "Movement trails", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("gps-trails-mobile.png"), fullPage: true })
  expect(errors).toEqual([])
})
