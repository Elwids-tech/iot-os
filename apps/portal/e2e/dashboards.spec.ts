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

test("multiple dashboards, explicit apply/save, and save before switching", async ({
  page,
}, info) => {
  const { dashboards, calls, errors } = await setup(page)
  await page.goto(basePath)
  await expect(page.getByText("Plant overview", { exact: true })).toBeVisible()
  await expect(page.getByText("Utilities", { exact: true })).toBeVisible()
  await page
    .getByRole("button", { name: "Create dashboard", exact: true })
    .click()
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
  await page.getByRole("tab", { name: "Thresholds", exact: true }).click()
  await page.getByRole("button", { name: "Add threshold", exact: true }).click()
  await page.getByLabel("From", { exact: true }).nth(3).fill("50")
  await page
    .getByRole("button", { name: "Apply to dashboard", exact: true })
    .click()
  expect(calls.writes).toBe(before)
  await page.getByRole("combobox", { name: "Dashboard", exact: true }).click()
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
  await expect(page.getByText(/Last valid value received:/)).toBeVisible()
  const defaults = structuredClone(dashboards[0].defaults),
    latest = calls.latest
  await page.getByRole("button", { name: "Last 6 hours", exact: true }).click()
  await page.getByRole("tab", { name: "Absolute range", exact: true }).click()
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
  await expect(page.getByText(/Last valid value received:/)).toContainText(
    "12:00",
  )
  await page.goBack()
  await expect(
    page.getByRole("button", { name: "Last 6 hours", exact: true }),
  ).toBeVisible()
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
  await page.getByRole("tab", { name: "Data", exact: true }).click()
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
  await page.getByRole("tab", { name: "Thresholds", exact: true }).click()
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
  ) {
    await page.getByRole("button", { name: "Add widget", exact: true }).click()
    await page.getByRole("button", { name: `Add ${type}`, exact: true }).click()
    await page.getByRole("combobox", { name: "Device", exact: true }).click()
    await page
      .getByRole("button", { name: "Next device options", exact: true })
      .click()
    await page.getByRole("option", { name: "Boiler room", exact: true }).click()
    await page.getByRole("combobox", { name: "Parameter", exact: true }).click()
    await page.getByRole("option", { name: parameter }).click()
    await page
      .getByRole("button", { name: "Add parameter", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Apply to dashboard", exact: true })
      .click()
  }

  await addHistoryPanel("State history", /Power/)
  await expect(page.getByText("On (1)", { exact: true })).toBeVisible()
  await addHistoryPanel("Colour history", /Colour/)
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

test("viewers can explore dashboards but cannot create or edit", async ({
  page,
}) => {
  const { errors } = await setup(page, false)
  await page.goto(basePath)
  await expect(page.getByText("Plant overview", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Create dashboard", exact: true }),
  ).toHaveCount(0)
  await page.goto(basePath + "/first")
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
  await page.getByRole("button", { name: "Add widget", exact: true }).click()
  await page
    .getByRole("button", { name: "Add Controls", exact: true })
    .click()
  await page.getByRole("combobox", { name: "Device", exact: true }).click()
  await page
    .getByRole("button", { name: "Next device options", exact: true })
    .click()
  await page.getByRole("option", { name: "Boiler room", exact: true }).click()

  for (const parameter of [/Power/, /Colour/]) {
    await page
      .getByRole("combobox", { name: "Parameter", exact: true })
      .click()
    await page.getByRole("option", { name: parameter }).click()
    await page
      .getByRole("button", { name: "Add parameter", exact: true })
      .click()
  }
  await page.getByRole("tab", { name: "Display", exact: true }).click()
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
  await page.getByRole("button", { name: "Last 6 hours", exact: true }).click()
  await page.getByRole("combobox", { name: "Timezone", exact: true }).click()
  await page.getByRole("option", { name: /Browser time/ }).click()
  await page.getByRole("tab", { name: "Absolute range", exact: true }).click()
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
