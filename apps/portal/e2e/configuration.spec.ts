import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const deviceId = "13131313-1313-4313-8313-131313131313"
const profileId = "55555555-5555-4555-8555-555555555555"
const artifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const configurationId = "44444444-4444-4444-8444-444444444444"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const parameter = (uuid: string, key: string, label: string, data_type: string, unit: string) => ({
  uuid,
  key,
  label,
  kind: "measurement",
  data_type,
  format: null,
  unit,
  reports_state: true,
  accepts_command: false,
  validation: null,
  display: null,
  reporting: null,
  counter: null,
  ingress_conversion: null,
})
const parameters = [
  parameter("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", "pm2_5", "PM2.5", "number", "µg/m³"),
  parameter("a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2", "pm10", "PM10", "number", "µg/m³"),
  parameter("a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", "co2", "CO2", "integer", "ppm"),
  parameter("a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", "temperature", "Temperature", "number", "°C"),
]
const profile = {
  uuid: profileId,
  code: "air-quality-sensor",
  name: "Air quality sensor",
  description: null,
  category: null,
  status: "published",
  revision: 1,
  draft_revision: 1,
  definition_hash: "hash",
  published_at: ago(86400),
  extensions: null,
  updated_at: ago(86400),
}
const artifact = {
  uuid: artifactId,
  profile_uuid: profileId,
  revision: 1,
  definition_hash: "hash",
  status: "active",
  compiled_at: ago(86400),
  definition: {
    schema_version: "device-profile.v2",
    profile: { uuid: profileId, code: profile.code, name: profile.name, category: null, revision: 1 },
    parameters,
    calculations: [],
    alarm_templates: [],
  },
}
const gateway = {
  uuid: "66666666-6666-4666-8666-666666666666",
  name: "Office gateway",
  edge_node_id: "office",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: "office-group",
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 1,
}
const source = (metrics: Array<{ name: string; datatype: string; value: unknown }>) => ({
  uuid: "99999999-9999-4999-8999-999999999999",
  assigned_device_uuid: null,
  setup_device_uuid: deviceId,
  source_device_id: "air-1",
  status: "pending",
  presence: "online",
  session_id: null,
  birth_revision: 1,
  metrics,
  last_seen_at: ago(3),
  gateway,
})
// Temperature arrives as tenths in an Int16, so only its row offers a unit conversion.
const matching = [
  { name: "pm2_5", datatype: "Float", value: 12.5 },
  { name: "pm10", datatype: "Float", value: 20.1 },
  { name: "CO2", datatype: "UInt16", value: 640 },
  { name: "Temperature", datatype: "Int16", value: 215 },
]
const device = {
  uuid: deviceId,
  code: "air-1",
  name: "Office air",
  serial_number: null,
  description: null,
  lifecycle: "registered",
  presence: "unseen",
  deployment_status: "idle",
  draft_revision: 1,
  deployment_generation: 0,
  state_revision: 0,
  desired_configuration_uuid: null,
  applied_configuration_uuid: null,
  last_applied_configuration_uuid: null,
  diagnostic: null,
  last_seen_at: null,
  operation: null,
  candidate: null,
  profile: null,
  retention: { days: 90, source: "platform" },
  draft: null,
  draft_artifact: null,
  configurations: [],
}

type Call = { step: "save" | "validate" | "activate"; body: Record<string, any> }

async function setup(
  page: Page,
  { metrics = matching, problems }: { metrics?: typeof matching; problems?: Record<string, string[]> } = {},
) {
  const state = { errors: [] as string[], calls: [] as Call[] }
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
  const discovered = source(metrics)
  let current: Record<string, any> = device
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) =>
      json({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
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
    if (path.endsWith("/device-profiles")) return page1([profile])
    if (path.endsWith(`/device-profiles/${profileId}/artifacts`)) {
      const { definition: _definition, profile_uuid: _profile, ...summary } = artifact
      return page1([summary])
    }
    if (path.endsWith(`/device-profiles/${profileId}/artifacts/1`)) return json({ data: artifact })
    if (path.endsWith("/discovery-candidates")) return page1([discovered])
    if (path.endsWith(`/discovery-candidates/${discovered.uuid}`)) return json({ data: discovered })
    if (path.endsWith(`/devices/${deviceId}`)) return json({ data: current })
    if (path.endsWith(`/devices/${deviceId}/configuration`) && method === "PUT") {
      const { draft_revision, ...draft } = request.postDataJSON()
      state.calls.push({ step: "save", body: { draft_revision, ...draft } })
      if (draft_revision !== current.draft_revision) return json({ message: "Changed." }, 409)
      current = { ...current, draft, draft_artifact: artifact, draft_revision: draft_revision + 1 }
      return json({ data: current })
    }
    if (path.endsWith(`/devices/${deviceId}/validate`)) {
      const body = request.postDataJSON()
      state.calls.push({ step: "validate", body })
      if (body.draft_revision !== current.draft_revision) return json({ message: "Changed." }, 409)
      if (problems) return json({ message: "The given data was invalid.", errors: problems }, 422)
      return json({
        data: {
          draft_revision: current.draft_revision,
          definition: {},
          preview: {
            valid: true,
            readings: parameters.map((p, i) => ({
              parameter_uuid: p.uuid,
              key: p.key,
              label: p.label,
              data_type: p.data_type,
              unit: p.unit,
              value: matching[i].value,
              quality: "good",
              observed_at: ago(60),
              received_at: ago(60),
              historical: false,
            })),
          },
        },
      })
    }
    if (path.endsWith(`/devices/${deviceId}/activate`)) {
      const body = request.postDataJSON()
      state.calls.push({ step: "activate", body })
      if (body.draft_revision !== current.draft_revision) return json({ message: "Changed." }, 409)
      current = {
        ...current,
        lifecycle: "active",
        deployment_status: "pending",
        desired_configuration_uuid: configurationId,
        draft_revision: current.draft_revision + 1,
        configurations: [
          {
            uuid: configurationId,
            revision: 1,
            definition_hash: "hash",
            profile_artifact_uuid: artifactId,
            profile_uuid: profileId,
            profile_name: profile.name,
            profile_revision: 1,
            created_at: ago(1),
            definition: {
              profile_artifact_uuid: artifactId,
              profile_canonical_json: JSON.stringify(artifact.definition),
              birth_revision: 1,
              source: { candidate_uuid: discovered.uuid },
              mappings: current.draft.mappings,
            },
          },
        ],
      }
      return json({ data: current }, 202)
    }
    return json({ data: [] })
  })
  return state
}

async function chooseProfile(page: Page) {
  await page.goto(`${base}/devices/${deviceId}/configuration?candidate=99999999-9999-4999-8999-999999999999`)
  await page.getByRole("combobox", { name: "Device profile", exact: true }).click()
  await page.getByRole("option", { name: "Air quality sensor", exact: true }).click()
  await page.getByRole("combobox", { name: "Published revision", exact: true }).click()
  await page.getByRole("option", { name: /^Revision 1/ }).click()
}

test("a source whose metrics all match applies in one step", async ({ page }) => {
  const state = await setup(page)
  await chooseProfile(page)
  // Every parameter matched by name and type, so the table starts as a one-line summary.
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible()
  await expect(page.getByText("4 of 4 matched automatically").first()).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Source for PM2.5" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Validate/ })).toHaveCount(0)

  await page.getByRole("button", { name: "Review", exact: true }).click()
  const pm = page.getByRole("combobox", { name: "Source for PM2.5", exact: true })
  await expect(pm).toContainText("pm2_5")
  // The column header names the field; the row label stays for screen readers only.
  await expect(page.locator("label", { hasText: "Source for PM2.5" })).toHaveClass(/sr-only/)
  await expect(page.getByText(/Incoming conversion for/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Convert units for/ })).toHaveCount(1)
  await page.getByRole("button", { name: "Convert units for Temperature", exact: true }).click()
  await expect(
    page.getByRole("combobox", { name: "Conversion mode for Temperature", exact: true }),
  ).toContainText("Use profile default")
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.getByRole("button", { name: "Apply", exact: true }).click()
  await expect.poll(() => state.calls.map((c) => c.step)).toEqual(["save", "validate", "activate"])
  expect(state.calls[0].body).toMatchObject({
    draft_revision: 1,
    artifact_uuid: artifactId,
    candidate_uuid: "99999999-9999-4999-8999-999999999999",
    birth_revision: 1,
  })
  expect(state.calls[0].body.mappings.map((m: { metric: string }) => m.metric)).toEqual([
    "pm2_5",
    "pm10",
    "CO2",
    "Temperature",
  ])
  // Each step uses the revision the save returned.
  expect(state.calls[1].body).toEqual({ draft_revision: 2 })
  expect(state.calls[2].body).toMatchObject({ draft_revision: 2 })
  await expect(page.getByText("Draft 2 checked")).toBeVisible()
  await expect(
    page.getByRole("status").filter({ hasText: "Waiting for the runtime to confirm the last request" }),
  ).toBeVisible()
  expect(state.errors).toEqual([])
})

test("problems found by the check stop before apply and show on their row", async ({ page }) => {
  const state = await setup(page, {
    problems: {
      "mappings.2": ["The source datatype is incompatible with this profile parameter."],
      runtime: ["The runtime rejected this configuration."],
    },
  })
  await chooseProfile(page)
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  await expect.poll(() => state.calls.map((c) => c.step)).toEqual(["save", "validate"])
  const alert = page.getByRole("alert").filter({ hasText: "Not applied. Fix these first" })
  await expect(alert).toContainText("The runtime rejected this configuration.")
  await expect(alert).toContainText("1 mapping needs attention.")
  // The table opens on its own so the marked row is visible.
  const co2 = page.getByRole("row").filter({ has: page.getByRole("combobox", { name: "Source for CO2" }) })
  await expect(co2).toContainText("The source datatype is incompatible with this profile parameter.")
  await expect(page.getByRole("status").filter({ hasText: "Not applied: fix the problems above" })).toBeVisible()

  await co2.getByRole("combobox", { name: "Source for CO2" }).click()
  await page.getByRole("option", { name: "pm10 · Float" }).click()
  await expect(co2).not.toContainText("incompatible")
  expect(state.errors).toEqual([])
})

test("a partial match keeps the table open and saves a draft without applying", async ({ page }) => {
  const state = await setup(page, { metrics: matching.filter((m) => m.name !== "CO2") })
  await chooseProfile(page)
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Source for CO2" })).toContainText(
    "Choose a source metric",
  )
  await page.getByRole("button", { name: "Suggest matching metrics" }).click()
  await expect(page.getByRole("combobox", { name: "Source for PM10" })).toContainText("pm10")
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled()
  await expect(page.getByRole("status").filter({ hasText: "Map all 4 parameters first" })).toBeVisible()
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect.poll(() => state.calls.map((c) => c.step)).toEqual(["save"])
  expect(state.calls[0].body.mappings).toHaveLength(3)
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled()
  expect(state.errors).toEqual([])
})
