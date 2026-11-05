import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// The gateway Firmware dialog (spec 027 US4), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const gatewayId = "66666666-6666-4666-8666-666666666666"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
// An empty ZIP: the browser only has to save it.
const emptyZip = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="

// Published profiles: uuid 5000000N, artifact 7000000N.
const uuid = (prefix: number, n: number) => `${prefix}000000${n}-0000-4000-8000-00000000000${n}`
const profile = (n: number, code: string, name: string) => ({
  uuid: uuid(5, n), code, name, description: null, category: "test", status: "published", revision: 1, draft_revision: 2,
  definition_hash: "hash", published_at: ago(86400), extensions: null, updated_at: ago(86400), parameters_count: 2, devices_count: 0,
})
const health = profile(0, "gateway-health", "Gateway health")
const water = profile(1, "water-meter", "Water meter")
const pump = profile(2, "pump-relay", "Pump relay")
const extra = [3, 4, 5, 6, 7, 8, 9].map((n) => profile(n, `sensor-${n}`, `Sensor ${n}`))
const artifact = (p: { uuid: string }) => p.uuid.replace(/^5/, "7")

const gateway = {
  uuid: gatewayId, name: "Line 2 gateway", edge_node_id: "line2-edge", connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: "plant", presence: "online", last_seen_at: ago(3), sources_count: 3,
}
const device = (n: number, p: { uuid: string; name: string }) => ({
  uuid: `d000000${n}-0000-4000-8000-00000000000${n}`, code: `meter-${n}`, name: `Meter ${n}`, serial_number: null, description: null,
  lifecycle: "active", presence: "online", last_seen_at: ago(5), tags: [], attributes: {}, site: null,
  profile: { uuid: p.uuid, name: p.name, revision: 1 },
  candidate: { uuid: `c000000${n}-0000-4000-8000-00000000000${n}`, source_device_id: `meter-${n}`, gateway },
})
const targets = [
  { id: "linux", name: "Linux or macOS", kind: "built", roles: ["direct", "gateway"], toolchain: "CMake 3.31" },
  { id: "nxp-imxrt1050-mcuxpresso", name: "NXP i.MX RT1050 (MCUXpresso SDK)", kind: "built", roles: ["direct", "gateway"], toolchain: "MCUXpresso SDK 26.09" },
  { id: "stm32", name: "STM32", kind: "ai_assisted", roles: ["direct", "gateway"], toolchain: null },
]
const manifest = {
  format: 1, sdk_version: "0.1.0", target: { id: "linux", kind: "built", name: "Linux or macOS" }, role: "gateway", generated_at: ago(0),
  node: { default_health: true, c_identifier: "gateway_health" }, device_types: [], metrics: {}, retired: {}, replaceable: [], developer_paths: ["app/"], warnings: [],
}

type Selection = { target: string; node_profile_uuid: string | null; device_profile_uuids: string[] } | null

async function setup(page: Page, { connections = true, healthProfile = true, selection = null as Selection } = {}) {
  const state = {
    errors: [] as string[],
    starters: [] as Record<string, unknown>[],
    kits: [] as Record<string, unknown>[],
    settings: 0,
    gatewayLoads: 0,
    selection,
  }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const context = {
    uuid: org, name: "Acme", slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: connections, connections, activate: false, command: false },
      device_profiles: { view_any: true, view: true, create: false, update: false, delete_draft: false, validate: false, publish: false },
      features: { device_adapters: false },
    },
  }
  const profiles = [...(healthProfile ? [health] : []), water, pump, ...extra]
  const devices = [device(1, water), device(2, water), device(3, pump)]
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) => json({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
    const archive = (filename: string, withManifest = true) =>
      json({ data: { filename, manifest: withManifest ? manifest : null, archive_base64: emptyZip } })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1, name: "Operator", email: "operator@example.test", email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false }, organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/firmware/targets")) return json({ data: targets })
    if (path.endsWith("/firmware/starters") && request.method() === "POST") {
      const body = request.postDataJSON()
      state.starters.push(body)
      if (body.gateway_uuid) state.selection = selectionOf(body)
      return archive("line-2-gateway-linux-starter.zip")
    }
    if (path.endsWith(`/gateways/${gatewayId}/firmware-kit`) && request.method() === "POST") {
      const body = request.postDataJSON()
      state.kits.push(body)
      state.selection = selectionOf(body)
      return archive("line-2-gateway-firmware-kit.zip")
    }
    if (path.endsWith(`/gateways/${gatewayId}/connection-settings`) && request.method() === "POST") {
      state.settings++
      return archive("line-2-gateway-connection-settings.zip", false)
    }
    if (path.endsWith("/gateways")) {
      state.gatewayLoads++
      return page1([{ ...gateway, firmware_selection: state.selection }])
    }
    if (path.endsWith("/sparkplug-connections"))
      return page1([{ uuid: gateway.connection_uuid, name: "Plant broker", group_id: "plant", host_id: "h", status: "ready", diagnostic: null }])
    if (path.endsWith("/devices")) return page1(devices)
    if (path.endsWith("/discovery-candidates")) return page1([])
    if (path.endsWith("/device-profiles")) {
      const search = (url.searchParams.get("search") ?? "").toLowerCase()
      return page1(profiles.filter((p) => !search || p.name.toLowerCase().includes(search) || p.code.includes(search)))
    }
    const found = profiles.find((p) => path.includes(`/device-profiles/${p.uuid}`))
    if (found && path.endsWith("/artifacts"))
      return page1([{ uuid: artifact(found), revision: 1, definition_hash: "hash", status: "active", compiled_at: ago(86400) }])
    if (found)
      return json({ data: { ...found, parameter_groups: [], parameters: [], calculations: [], alarm_templates: [], active_artifact: null } })
    return json({ data: [] })
  })
  return state
}

// What the API saves: the profiles behind the artifacts the request named.
function selectionOf(body: { target: string; node_artifact_uuid?: string | null; device_type_artifact_uuids: string[] }): Selection {
  const profileOf = (artifactUuid: string) => artifactUuid.replace(/^7/, "5")
  return {
    target: body.target,
    node_profile_uuid: body.node_artifact_uuid ? profileOf(body.node_artifact_uuid) : null,
    device_profile_uuids: body.device_type_artifact_uuids.map(profileOf),
  }
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("Firmware replaces Get credentials and downloads a starter in three actions", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/gateways/${gatewayId}`)
  await expect(page.getByRole("heading", { name: "Line 2 gateway", level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "Meter 3" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Get credentials" })).toHaveCount(0)

  // 1. Open Firmware: the health profile and the profiles of the gateway's devices are preselected.
  await page.getByRole("button", { name: "Firmware", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Gateway firmware" })
  await expect(dialog.getByRole("combobox", { name: "Gateway health" })).toHaveText("Gateway health")
  await expect(dialog.getByRole("combobox", { name: "Device type 1" })).toHaveText("Water meter")
  await expect(dialog.getByRole("combobox", { name: "Device type 2" })).toHaveText("Pump relay")
  await expect(dialog.getByRole("combobox", { name: "Device type 3" })).toHaveCount(0)
  await axe(page)
  // 2. Choose the target.
  await dialog.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await page.getByRole("option", { name: "NXP i.MX RT1050 (MCUXpresso SDK)" }).click()
  // 3. Download.
  const loads = state.gatewayLoads
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download starter" }).click()
  expect((await download).suggestedFilename()).toBe("line-2-gateway-linux-starter.zip")
  await expect(dialog.getByRole("status")).toHaveText("Starter downloaded.")

  // An admin's starter saves the choices on the gateway, and the gateway list reloads them.
  expect(state.starters).toEqual([
    {
      target: "nxp-imxrt1050-mcuxpresso",
      role: "gateway",
      node_artifact_uuid: artifact(health),
      device_type_artifact_uuids: [artifact(water), artifact(pump)],
      gateway_uuid: gatewayId,
    },
  ])
  await expect.poll(() => state.gatewayLoads).toBeGreaterThan(loads)
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click()
  await page.getByRole("button", { name: "Firmware", exact: true }).click()
  await expect(dialog.getByRole("combobox", { name: "Microcontroller or platform" })).toHaveText("NXP i.MX RT1050 (MCUXpresso SDK)")
  expect(state.errors).toEqual([])
})

test("saved choices come first and the full kit and settings use them", async ({ page }) => {
  const state = await setup(page, {
    selection: { target: "stm32", node_profile_uuid: null, device_profile_uuids: [pump.uuid] },
  })
  await page.goto(`${base}/gateways/${gatewayId}`)
  await page.getByRole("button", { name: "Firmware", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Gateway firmware" })
  // Saved: the SDK default health table, one type, STM32; the devices' profiles are not suggested.
  await expect(dialog.getByRole("combobox", { name: "Gateway health" })).toHaveText("SDK default health metrics")
  await expect(dialog.getByRole("combobox", { name: "Device type 1" })).toHaveText("Pump relay")
  await expect(dialog.getByRole("combobox", { name: "Device type 2" })).toHaveCount(0)
  await expect(dialog.getByRole("combobox", { name: "Microcontroller or platform" })).toHaveText(/STM32/)

  // Another type, found by searching, cannot repeat one already chosen.
  await dialog.getByRole("button", { name: "Add device type" }).click()
  await dialog.getByRole("combobox", { name: "Device type 2" }).click()
  await expect(page.getByRole("option", { name: "Pump relay" })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Search device type 2" }).fill("water")
  await page.getByRole("option", { name: "Water meter" }).click()

  const kit = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download full kit" }).click()
  expect((await kit).suggestedFilename()).toBe("line-2-gateway-firmware-kit.zip")
  await expect(dialog.getByRole("status")).toContainText("Its config/ folder holds the credentials")
  expect(state.kits).toEqual([
    { target: "stm32", node_artifact_uuid: null, device_type_artifact_uuids: [artifact(pump), artifact(water)] },
  ])
  expect(state.selection).toEqual({ target: "stm32", node_profile_uuid: null, device_profile_uuids: [pump.uuid, water.uuid] })

  const settings = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download settings" }).click()
  expect((await settings).suggestedFilename()).toBe("line-2-gateway-connection-settings.zip")
  expect(state.settings).toBe(1)

  // Server commands are for operators and are not shown in the portal.
  await expect(dialog).not.toContainText("artisan")
  await expect(dialog).not.toContainText("export-gateway")
  expect(state.errors).toEqual([])
})

test("without a gateway health profile the SDK default is used, and a gateway holds at most eight types", async ({ page }) => {
  const state = await setup(page, { healthProfile: false })
  await page.goto(`${base}/gateways/${gatewayId}`)
  await page.getByRole("button", { name: "Firmware", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Gateway firmware" })
  await expect(dialog.getByRole("combobox", { name: "Gateway health" })).toHaveText("SDK default health metrics")
  await expect(dialog.getByRole("combobox", { name: "Device type 2" })).toHaveText("Pump relay")

  for (let n = 3; n <= 8; n++) {
    await dialog.getByRole("button", { name: "Add device type" }).click()
    await dialog.getByRole("combobox", { name: `Device type ${n}` }).click()
    await page.getByRole("option", { name: `Sensor ${n}` }).click()
  }
  await expect(dialog.getByRole("button", { name: "Add device type" })).toBeDisabled()
  await dialog.getByRole("button", { name: "Remove device type 8" }).click()
  await expect(dialog.getByRole("button", { name: "Add device type" })).toBeEnabled()
  await expect(dialog.getByRole("combobox", { name: "Device type 8" })).toHaveCount(0)

  await dialog.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await page.getByRole("option", { name: "Linux or macOS" }).click()
  await dialog.getByRole("button", { name: "Download starter" }).click()
  await expect.poll(() => state.starters.length).toBe(1)
  expect(state.starters[0]).toMatchObject({
    target: "linux",
    node_artifact_uuid: null,
    device_type_artifact_uuids: [water, pump, ...extra.slice(0, 5)].map(artifact),
  })
  expect(state.errors).toEqual([])
})

test("a member downloads only the starter, from the gateway list too, without saving choices", async ({ page }) => {
  const state = await setup(page, { connections: false })
  await page.goto(`${base}/gateways`)
  await page.getByRole("button", { name: "Actions for Line 2 gateway" }).click()
  await expect(page.getByRole("menuitem", { name: "Get credentials" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Firmware" }).click()
  const dialog = page.getByRole("dialog", { name: "Gateway firmware" })
  await expect(dialog.getByRole("combobox", { name: "Device type 1" })).toHaveText("Water meter")
  await expect(dialog.getByRole("button", { name: "Download settings" })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "Download full kit" })).toHaveCount(0)
  await expect(dialog).toContainText("Connection settings and full kits need connection-management access.")

  await dialog.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await page.getByRole("option", { name: "Linux or macOS" }).click()
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download starter" }).click()
  await download
  expect(state.starters).toEqual([
    { target: "linux", role: "gateway", node_artifact_uuid: artifact(health), device_type_artifact_uuids: [artifact(water), artifact(pump)] },
  ])
  expect(state.selection).toBeNull()
  await axe(page)
  expect(state.errors).toEqual([])
})
