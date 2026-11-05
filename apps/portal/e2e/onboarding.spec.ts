import { test, expect, type Page, type Route } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const gatewayId = "66666666-6666-4666-8666-666666666666"
const profileId = "55555555-5555-4555-8555-555555555555"
const settingUp = "12121212-1212-4212-8212-121212121212"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const gateway = {
  uuid: gatewayId,
  name: "Boiler room gateway",
  edge_node_id: "boiler-room",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: `org-${org}`,
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 2,
}
const waiting = {
  uuid: "99999999-9999-4999-8999-999999999999",
  assigned_device_uuid: null,
  setup_device_uuid: null,
  source_device_id: "boiler-2",
  status: "pending",
  presence: "online",
  session_id: null,
  birth_revision: 1,
  metrics: [{ name: "temperature", datatype: "Double", value: 61.5 }],
  last_seen_at: ago(5),
  gateway,
}
// A direct device mid-setup: its own node-level source, not yet reserved.
const claimed = {
  ...waiting,
  uuid: "abababab-abab-4bab-8bab-abababababab",
  source_device_id: "",
  setup_device_uuid: settingUp,
  gateway: { ...gateway, uuid: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", name: "Water meter" },
}
const profile = {
  uuid: profileId,
  code: "water-meter",
  name: "Water meter",
  description: null,
  category: "water-metering",
  status: "published",
  revision: 1,
  draft_revision: 3,
  definition_hash: "hash",
  published_at: ago(172800),
  extensions: null,
  updated_at: ago(172800),
  parameters_count: 2,
  devices_count: 1,
}

async function setup(page: Page, { adapters = true, status = "published" } = {}) {
  const state = { errors: [] as string[] }
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
      manage_administration: false,
      devices: { view: true, manage: true, connections: true, activate: true, command: true },
      device_profiles: { view_any: true, view: true, create: true, update: true, delete_draft: true, validate: true, publish: true },
      features: { device_adapters: adapters },
    },
  }
  const current = { ...profile, status }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
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
    if (path.endsWith("/discovery-candidates"))
      return page1(url.searchParams.get("available") === "1" ? [waiting] : [waiting, claimed])
    if (path.endsWith("/gateways")) return page1([gateway])
    if (path.endsWith("/sparkplug-connections"))
      return page1([
        { uuid: gateway.connection_uuid, name: "Plant broker", group_id: `org-${org}`, host_id: "h", status: "ready", diagnostic: null },
      ])
    if (path.endsWith("/device-adapters"))
      return adapters
        ? json({ data: [], tenant: null, capabilities: context.capabilities.devices })
        : json({ message: "Not found." }, 404)
    if (path.endsWith("/device-profiles")) return page1([current])
    if (path.endsWith(`/device-profiles/${profileId}`))
      return json({ data: { ...current, parameter_groups: [], parameters: [], alarm_templates: [], active_artifact: null } })
    if (path.endsWith(`/device-profiles/${profileId}/validate`))
      return json({ data: { draft_revision: current.draft_revision, valid: true, diagnostics: [] } })
    if (path.endsWith(`/device-profiles/${profileId}/compile`))
      return json({
        data: {
          draft_revision: current.draft_revision,
          definition: {
            schema_version: "device-profile.v2",
            profile: { uuid: profileId, code: current.code, name: current.name, category: current.category, revision: 2 },
            parameters: [],
            calculations: [],
            alarm_templates: [],
          },
          definition_hash: "a".repeat(64),
          revision: 2,
        },
      })
    if (path.endsWith("/devices") || path.endsWith("/artifacts")) return page1([])
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("adding a device starts from how it sends data", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices/onboard`)
  await expect(page.getByRole("heading", { name: "How does this device send data?" })).toBeVisible()
  const choices = page.getByRole("radiogroup", { name: "How the device sends data" })
  await expect(choices.getByRole("radio")).toHaveCount(4)
  await expect(choices.getByText("1 waiting")).toBeVisible()
  await axe(page)

  await choices.getByText("It’s already sending data").click()
  const sources = page.getByRole("region", { name: "Sources waiting to be added" })
  await expect(sources.getByRole("row", { name: /boiler-2/ })).toBeVisible()
  await expect(page.getByLabel("Device name")).toHaveCount(0)
  await sources.getByRole("button", { name: "Add boiler-2 as a device" }).click()
  await expect(page.getByRole("dialog", { name: "Onboard boiler-2" })).toBeVisible()
  await page.keyboard.press("Escape")

  await choices.getByText("Sparkplug B", { exact: false }).first().click()
  await expect(page.getByRole("link", { name: "Create or publish a profile" })).toHaveAttribute(
    "href",
    `${base}/device-profiles?returnTo=${encodeURIComponent(`${base}/devices/onboard`)}`,
  )

  await choices.getByText("Manufacturer data (MQTT, webhook or vendor API)").click()
  await page.getByRole("link", { name: "Continue to device adapters" }).click()
  await expect(page).toHaveURL(`${base}/device-adapters`)
  expect(state.errors).toEqual([])
})

test("the adapter choice is hidden when device adapters are off", async ({ page }) => {
  const state = await setup(page, { adapters: false })
  await page.goto(`${base}/devices/onboard`)
  const choices = page.getByRole("radiogroup", { name: "How the device sends data" })
  await expect(choices.getByRole("radio")).toHaveCount(3)
  await expect(page.getByText("Manufacturer data (MQTT, webhook or vendor API)")).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("profile setup keeps a way back to device setup", async ({ page }) => {
  const state = await setup(page, { status: "draft" })
  const back = `${base}/devices/onboard`
  await page.goto(`${base}/device-profiles?returnTo=${encodeURIComponent(back)}`)
  await expect(page.getByText("Setting up a device")).toBeVisible()
  const row = page.getByRole("row", { name: /Water meter/ })
  await expect(row.getByRole("cell", { name: "Water metering", exact: true })).toBeVisible()
  await row.getByRole("link", { name: "Water meter" }).click()
  await expect(page).toHaveURL(/returnTo=/)
  await expect(page.getByText("Publishing takes you back to device setup with this profile selected.")).toBeVisible()
  await expect(page.getByText("Live: version 1", { exact: true })).toBeVisible()
  await expect(page.getByText(/^Draft changes saved 2 d ago$/)).toBeVisible()
  // The saved draft is checked without a Validate step, and Publish returns to setup.
  await expect(page.getByText("Ready to publish", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Validate draft" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Publish and continue setup", exact: true })).toBeEnabled()
  await page.getByRole("tab", { name: "Review", exact: true }).click()
  await expect(page.getByText("Checks passed", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/review\?returnTo=/)
  await expect(page.getByRole("link", { name: "Back to device setup" })).toHaveAttribute("href", back + "?profile=" + profileId)
  await axe(page)

  // An open returnTo pointing elsewhere is ignored.
  await page.goto(`${base}/device-profiles/${profileId}/overview?returnTo=${encodeURIComponent("https://evil.example/organizations/x")}`)
  await expect(page.getByRole("heading", { name: "Water meter", level: 1 })).toBeVisible()
  await expect(page.getByText("Setting up a device")).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("a live profile with no changes continues device setup", async ({ page }) => {
  const state = await setup(page)
  const back = `${base}/devices/onboard`
  await page.goto(`${base}/device-profiles/${profileId}/overview?returnTo=${encodeURIComponent(back)}`)
  await expect(page.getByText("Version 1 is live", { exact: true })).toBeVisible()
  await expect(page.getByText("No changes since version 1", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Publish/ })).toHaveCount(0)
  const next = page.getByRole("link", { name: "Continue setup with version 1", exact: true })
  await expect(next).toHaveAttribute("href", back + "?profile=" + profileId)
  await expect(next).toHaveAttribute("data-variant", "default")
  await expect(page.getByRole("link", { name: "Back to device setup" })).toHaveAttribute("data-variant", "ghost")
  await axe(page)
  expect(state.errors).toEqual([])
})

test("discovery and gateways use plain language and keep identifiers in details", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/discovery`)
  const claimedRow = page.getByRole("row", { name: /Measurements from Water meter/ })
  await expect(claimedRow.getByRole("link", { name: "Resume setup" })).toHaveAttribute(
    "href",
    `${base}/devices/onboard/${settingUp}?step=3`,
  )
  await expect(claimedRow.getByRole("button")).toHaveCount(0)
  await expect(page.getByRole("row", { name: /boiler-2/ }).getByRole("button", { name: "Onboard" })).toBeVisible()
  await expect(page.getByText("Announced revision")).toHaveCount(0)
  await axe(page)

  await page.goto(`${base}/gateways`)
  await expect(page.getByRole("columnheader", { name: "Group" })).toHaveCount(0)
  await expect(page.getByText(`org-${org}`)).toHaveCount(0)
  await page.goto(`${base}/gateways/${gatewayId}`)
  await expect(page.getByText(`org-${org}`)).toHaveCount(0)
  const rail = page.getByRole("complementary", { name: "Properties" })
  await rail.getByRole("button", { name: "Technical details" }).click()
  await expect(rail.getByText(`org-${org}`)).toBeVisible()
  await expect(rail.getByRole("button", { name: "Copy Group ID" })).toBeVisible()
  await axe(page)
  expect(state.errors).toEqual([])
})

const healthId = "77777777-7777-4777-8777-777777777777"
const healthArtifactId = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a"
const nodeDeviceId = "7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d"
const health = { ...profile, uuid: healthId, code: "gateway-health", name: "Gateway health", category: "gateways", parameters_count: 8, devices_count: 0 }
const healthParameters = [
  ["uptime", "Uptime", "integer", "counter", "s"],
  ["connection_type", "Connection", "enum", "state", null],
  ["signal_strength", "Signal strength", "number", "measurement", "dBm"],
  ["firmware_version", "Firmware version", "string", "state", null],
  ["sdk_version", "SDK version", "string", "state", null],
  ["devices_configured", "Devices configured", "integer", "measurement", null],
  ["devices_online", "Devices online", "integer", "measurement", null],
  ["reconnects", "Reconnects", "integer", "counter", null],
].map(([key, label, data_type, kind, unit], i) => ({
  uuid: `7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b0${i}`,
  key,
  label,
  data_type,
  kind,
  unit,
  reports_state: true,
  accepts_command: false,
}))
const healthArtifact = {
  uuid: healthArtifactId,
  profile_uuid: healthId,
  revision: 1,
  definition_hash: "b".repeat(64),
  definition: {
    schema_version: "device-profile.v2",
    profile: { uuid: healthId, code: health.code, name: health.name, category: health.category, revision: 1 },
    parameters: healthParameters,
    calculations: [],
    alarm_templates: [],
  },
  status: "active",
  compiled_at: ago(60),
}

/** The gateway health profile, existing or created through the page, and the node setup the wizard starts. */
async function gatewayItself(page: Page, { exists = false } = {}) {
  const state = { created: exists, creations: 0, onboardings: [] as Record<string, unknown>[] }
  const json = (route: Route, data: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
  const nodeSetup = (name: string) => ({
    uuid: "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c",
    mode: "gateway",
    source_device_id: "",
    provisioned: true,
    diagnostic: null,
    broker_url: "ssl://mqtt.example.test:8883",
    device: {
      uuid: nodeDeviceId, name, code: `device-${nodeDeviceId}`, lifecycle: "registered", deployment_status: null,
      applied_configuration_uuid: null, draft_revision: 1, draft: { artifact_uuid: healthArtifactId, candidate_uuid: null, birth_revision: null, mappings: [] },
      draft_artifact: null, configurations: [], retention: { days: 90, source: "platform" },
    },
    gateway,
    candidate: null,
    artifact: { ...healthArtifact, profile_uuid: healthId },
  })
  // Registered after setup(), so these answer first.
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    if (path.endsWith("/device-profiles/gateway-health") && request.method() === "POST") {
      state.creations += 1
      const created = !state.created
      state.created = true
      return json(route, { data: { profile_uuid: healthId, artifact_uuid: healthArtifactId, created } }, created ? 201 : 200)
    }
    if (path.endsWith("/device-profiles"))
      return json(route, { data: state.created ? [profile, health] : [profile], meta: { current_page: 1, last_page: 1, total: state.created ? 2 : 1 } })
    if (path.endsWith(`/device-profiles/${healthId}`))
      return json(route, { data: { ...health, parameter_groups: [], parameters: [], alarm_templates: [], active_artifact: null } })
    if (path.endsWith(`/device-profiles/${healthId}/artifacts/1`)) return json(route, { data: healthArtifact })
    if (path.endsWith("/device-onboardings") && request.method() === "POST") {
      const body = request.postDataJSON()
      state.onboardings.push(body)
      return json(route, { data: nodeSetup(body.name) }, 201)
    }
    if (path.endsWith(`/devices/${nodeDeviceId}/onboarding`))
      return json(route, { data: nodeSetup(state.onboardings.at(-1)?.name as string) })
    return route.fallback()
  })
  return state
}

async function chooseGateway(page: Page) {
  await page.getByRole("radiogroup", { name: "How the device sends data" }).getByText("Through a gateway", { exact: true }).click()
  await page.getByRole("combobox", { name: "Gateway", exact: true }).click()
  await page.getByRole("option", { name: "Boiler room gateway" }).click()
}

test("the gateway itself onboards with a gateway health profile created on the spot", async ({ page }) => {
  const errors = await setup(page)
  const state = await gatewayItself(page)
  await page.goto(`${base}/devices/onboard`)
  await chooseGateway(page)
  await expect(page.getByLabel("Device ID on gateway")).toBeVisible()
  await page.getByRole("checkbox", { name: "The gateway itself" }).check()
  await expect(page.getByLabel("Device ID on gateway")).toHaveCount(0)
  const suggestion = page.getByRole("alert").filter({ hasText: "Create the gateway health profile" })
  await expect(suggestion).toBeVisible()
  await axe(page)

  await suggestion.getByRole("button", { name: "Create gateway health profile" }).click()
  await expect(page.getByRole("combobox", { name: "Device profile", exact: true })).toHaveText(/Gateway health/)
  await expect(page.getByText("Version 1 is live", { exact: false })).toBeVisible()
  await expect(page.getByText("Create the gateway health profile")).toHaveCount(0)
  expect(state.creations).toBe(1)

  await page.getByLabel("Device name").fill("Boiler room gateway health")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page).toHaveURL(`${base}/devices/onboard/${nodeDeviceId}?step=2`)
  expect(state.onboardings).toHaveLength(1)
  expect(state.onboardings[0]).toMatchObject({ mode: "gateway", gateway_uuid: gatewayId, source: "node", artifact_uuid: healthArtifactId })
  expect(state.onboardings[0]).not.toHaveProperty("source_device_id")

  await expect(page.getByRole("heading", { name: "Report the gateway’s own metrics" })).toBeVisible()
  const metrics = page.getByRole("region", { name: "Metrics in the node birth" })
  await expect(metrics.getByRole("row")).toHaveCount(8)
  await expect(metrics.getByRole("row", { name: /Uptime/ })).toContainText("integer · s")
  await expect(page.getByRole("region", { name: "Gateway", exact: true })).toContainText("boiler-room")
  await expect(page.getByText("DBIRTH")).toHaveCount(0)
  await axe(page)
  expect(errors.errors).toEqual([])
})

test("an existing gateway health profile is suggested for the gateway itself", async ({ page }) => {
  const errors = await setup(page)
  const state = await gatewayItself(page, { exists: true })
  await page.goto(`${base}/devices/onboard`)
  await chooseGateway(page)
  // With no profile chosen yet, choosing the gateway itself selects the health profile.
  await page.getByRole("checkbox", { name: "The gateway itself" }).check()
  await expect(page.getByRole("combobox", { name: "Device profile", exact: true })).toHaveText(/Gateway health/)
  await expect(page.getByRole("alert").filter({ hasText: "Gateway health" })).toHaveCount(0)

  // Another profile gets a suggestion back to it, without creating anything.
  await page.getByRole("combobox", { name: "Device profile", exact: true }).click()
  await page.getByRole("option", { name: "Water meter" }).click()
  const suggestion = page.getByRole("alert").filter({ hasText: "Use Gateway health" })
  await suggestion.getByRole("button", { name: "Use Gateway health" }).click()
  await expect(page.getByRole("combobox", { name: "Device profile", exact: true })).toHaveText(/Gateway health/)
  expect(state.creations).toBe(0)

  // Leaving the gateway itself brings the device ID back, and it is required again.
  await page.getByRole("checkbox", { name: "The gateway itself" }).uncheck()
  await page.getByLabel("Device name").fill("Boiler 3")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByText("Enter the device ID used on the gateway.")).toBeVisible()
  expect(state.onboardings).toHaveLength(0)
  expect(errors.errors).toEqual([])
})
