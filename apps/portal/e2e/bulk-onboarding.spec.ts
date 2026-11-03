import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// Bulk onboarding of discovered sources (spec 026 US5), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const gatewayId = "66666666-6666-4666-8666-666666666666"
const profileId = "55555555-5555-4555-8555-555555555555"
const artifactId = "77777777-7777-4777-8777-777777777777"
const runId = "12121212-1212-4212-8212-121212121212"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const gateway = {
  uuid: gatewayId,
  name: "Line 1 gateway",
  edge_node_id: "line-1",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: `org-${org}`,
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 30,
}
const meterMetrics = [
  { name: "flow_rate", datatype: "Double", value: 1.5 },
  { name: "total_volume", datatype: "Double", value: 120 },
]
const id = (n: number) => `meter-${String(n).padStart(3, "0")}`
// 30 meters over two pages: meter-028 lacks a metric, meter-029 is already a device.
const sources = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1
  return {
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    assigned_device_uuid: n === 29 ? "44444444-4444-4444-8444-444444444444" : null,
    setup_device_uuid: null,
    source_device_id: id(n),
    status: n === 29 ? "approved" : "pending",
    presence: "online",
    session_id: "s1",
    birth_revision: 1,
    metrics: n === 28 ? meterMetrics.slice(0, 1) : meterMetrics,
    last_seen_at: ago(5),
    gateway,
    adapter: null,
  }
})
const parameter = (uuid: string, key: string, label: string, kind: string) => ({
  uuid, key, label, kind, data_type: "number", format: null, unit: null, reports_state: true, accepts_command: false,
  validation: null, display: null, reporting: null, counter: null, ingress_conversion: null,
})
const profile = {
  uuid: profileId, code: "water-meter", name: "Water meter", description: null, category: "water-metering",
  status: "published", revision: 1, draft_revision: 2, definition_hash: "hash", published_at: ago(86400),
  extensions: null, updated_at: ago(86400), parameters_count: 2, devices_count: 0,
}
const artifact = {
  uuid: artifactId, profile_uuid: profileId, revision: 1, definition_hash: "hash", status: "active", compiled_at: ago(86400),
  definition: {
    schema_version: "device-profile.v2",
    profile: { uuid: profileId, code: "water-meter", name: "Water meter", category: "water-metering", revision: 1 },
    parameters: [
      parameter("10000000-0000-4000-8000-000000000001", "flow_rate", "Flow rate", "measurement"),
      parameter("10000000-0000-4000-8000-000000000002", "total_volume", "Total volume", "counter"),
    ],
    calculations: [], alarms: [], groups: [],
  },
}

function run(stage: number, selected: string[]) {
  const counts =
    stage === 0
      ? { pending: 18, activation_requested: 10, active: 0, skipped: 0, failed: 0 }
      : stage === 1
        ? { pending: 0, activation_requested: 26, active: 20, skipped: 1, failed: 1 }
        : { pending: 0, activation_requested: 27, active: 27, skipped: 1, failed: 0 }
  return {
    uuid: runId,
    status: stage === 0 ? "running" : "partial_failure",
    gateway_uuid: gatewayId,
    artifact_uuid: artifactId,
    profile: { uuid: profileId, name: "Water meter", revision: 1 },
    name_pattern: "Meter {device_id}",
    created_by: 1,
    created_at: ago(30),
    started_at: ago(29),
    finished_at: stage === 0 ? null : ago(2),
    counts,
    items: selected.map((source) => ({
      source_device_id: source,
      status: source === id(28) ? "skipped" : source === id(3) && stage === 1 ? "failed" : stage === 0 ? "pending" : "active",
      reason: source === id(28) ? "missing metric total_volume" : source === id(3) && stage === 1 ? "The device runtime is unavailable." : null,
      device_uuid: null,
      attempts: source === id(3) && stage === 2 ? 1 : 0,
    })),
    next_cursor: null,
  }
}

async function setup(page: Page, { activate = true } = {}) {
  const state = { errors: [] as string[], created: null as null | Record<string, unknown>, stage: 0, polls: 0, retried: 0 }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const context = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: true, connections: true, activate, command: true },
      device_profiles: { view_any: true, view: true, create: false, update: false, delete_draft: false, validate: false, publish: false },
      features: { device_adapters: false },
    },
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1, name: "Operator", email: "operator@example.test", email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false }, organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/discovery-candidates")) {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      const perPage = Number(url.searchParams.get("per_page") ?? 100)
      const pageNumber = Number(url.searchParams.get("page") ?? 1)
      const matching = sources.filter((s) => s.source_device_id.includes(search))
      return json({
        data: matching.slice((pageNumber - 1) * perPage, pageNumber * perPage),
        meta: { current_page: pageNumber, last_page: Math.max(1, Math.ceil(matching.length / perPage)), total: matching.length },
      })
    }
    if (path.endsWith("/gateways")) return json({ data: [gateway], meta: { current_page: 1, last_page: 1, total: 1 } })
    if (path.endsWith("/device-profiles")) return json({ data: [profile], meta: { current_page: 1, last_page: 1, total: 1 } })
    if (path.endsWith(`/device-profiles/${profileId}`))
      return json({ data: { ...profile, parameter_groups: [], parameters: [], alarm_templates: [], active_artifact: null } })
    if (path.endsWith(`/device-profiles/${profileId}/artifacts/1`)) return json({ data: artifact })
    if (path.endsWith(`/gateways/${gatewayId}/bulk-onboardings`) && request.method() === "POST") {
      state.created = request.postDataJSON()
      return json({ data: run(0, state.created!.source_device_ids as string[]) }, 202)
    }
    const selected = (state.created?.source_device_ids as string[] | undefined) ?? []
    if (path.endsWith(`/bulk-onboardings/${runId}/retry`)) {
      state.retried++
      state.stage = 2
      return json({ data: { ...run(2, selected), status: "queued" } }, 202)
    }
    if (path.endsWith(`/bulk-onboardings/${runId}`)) {
      state.polls++
      // The run finishes on the second poll.
      if (state.stage === 0 && state.polls > 1) state.stage = 1
      return json({ data: run(state.stage, selected) })
    }
    if (path.endsWith("/devices")) return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("operators select every matching source across pages and onboard them in one run", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/discovery?gateway=${gatewayId}`)
  await page.getByRole("checkbox", { name: `Select ${id(1)}` }).check()
  await expect(page.getByText("1 selected")).toBeVisible()
  await page.getByRole("button", { name: "Select all 30 matching" }).click()
  // The source that is already a device is left out.
  await expect(page.getByText("29 selected")).toBeVisible()
  await expect(page.getByText("1 matching source was left out")).toBeVisible()
  await expect(page.getByRole("button", { name: "Select all 30 matching" })).toHaveCount(0)
  // The selection spans pages.
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.getByRole("checkbox", { name: `Select ${id(28)}` })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: `Select ${id(29)}` })).toBeDisabled()
  await expect(page.getByText("29 selected")).toBeVisible()
  await axe(page)

  await page.getByRole("button", { name: "Onboard selected" }).click()
  const dialog = page.getByRole("dialog", { name: "Onboard 29 sources" })
  await dialog.getByRole("combobox", { name: "Device profile" }).click()
  await page.getByRole("option", { name: "Water meter" }).click()
  await dialog.getByLabel("Device names").fill("Meter {device_id}")
  const preview = dialog.getByLabel("Name preview")
  await expect(preview).toContainText("Meter meter-001")
  await expect(preview).toContainText("Meter meter-003")
  await expect(preview).toContainText("and 26 more")
  // A source from the second page is flagged before starting.
  const summary = dialog.getByRole("status", { name: "Match summary" })
  await expect(summary).toContainText("1 of 29 sources lack what this profile needs and will be skipped.")
  await expect(summary).toContainText(`${id(28)}: missing metric total_volume`)
  await dialog.getByLabel("Device names").fill("Meter")
  await expect(dialog.getByText("The name pattern must contain {device_id}.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Onboard 29" })).toBeDisabled()
  await dialog.getByLabel("Device names").fill("Meter {device_id}")
  await axe(page)
  await dialog.getByRole("button", { name: "Onboard 29" }).click()

  await expect.poll(() => state.created).not.toBeNull()
  expect(state.created!.artifact_uuid).toBe(artifactId)
  expect(state.created!.name_pattern).toBe("Meter {device_id}")
  expect(state.created!.operation_uuid).toMatch(/^[0-9a-f-]{36}$/)
  const ids = state.created!.source_device_ids as string[]
  expect(ids).toHaveLength(29)
  expect(ids).toContain(id(28))
  expect(ids).not.toContain(id(29))
  await expect(page).toHaveURL(new RegExp(`run=${runId}`))
  await expect(dialog).toHaveCount(0)

  // The panel polls until the run finishes.
  const panel = page.getByRole("region", { name: "Bulk onboarding run" })
  const counts = panel.getByLabel("Bulk onboarding counts")
  await expect(counts).toContainText("Pending18")
  await expect(panel.getByText("Partly failed")).toBeVisible()
  await expect(counts).toContainText("Failed1")
  await expect(panel.getByRole("cell", { name: "missing metric total_volume" })).toBeVisible()
  await expect(panel.getByRole("cell", { name: "The device runtime is unavailable." })).toBeVisible()
  await axe(page)
  await panel.getByRole("button", { name: "Retry 1 failed" }).click()
  await expect.poll(() => state.retried).toBe(1)
  await expect(counts).toContainText("Active27")
  await expect(counts).toContainText("Failed0")
  await expect(panel.getByRole("button", { name: /Retry/ })).toHaveCount(0)
  await panel.getByRole("button", { name: "Close bulk onboarding" }).click()
  await expect(page).not.toHaveURL(/run=/)
  expect(state.errors).toEqual([])
})

test("bulk onboarding is offered only to people who may activate devices, and only per gateway", async ({ page }) => {
  const state = await setup(page, { activate: false })
  await page.goto(`${base}/discovery?gateway=${gatewayId}`)
  await expect(page.getByRole("cell", { name: id(1) })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: `Select ${id(1)}` })).toHaveCount(0)
  await expect(page.getByText("Filter by a gateway to select its sources")).toHaveCount(0)

  const allowed = await setup(page)
  await page.goto(`${base}/discovery`)
  await expect(page.getByRole("cell", { name: id(1) })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: `Select ${id(1)}` })).toHaveCount(0)
  await expect(page.getByText("Filter by a gateway to select its sources and onboard them together.")).toBeVisible()
  expect([...state.errors, ...allowed.errors]).toEqual([])
})
