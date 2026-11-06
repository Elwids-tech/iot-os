import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// "I’m writing the firmware" on Add device's connection step (spec 027 US4), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const deviceId = "12121212-1212-4212-8212-121212121212"
const profileId = "55555555-5555-4555-8555-555555555555"
const artifactId = "77777777-7777-4777-8777-777777777777"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
// An empty ZIP: the browser only has to save it.
const emptyZip = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="

const device = {
  uuid: deviceId, code: "pump-relay-1", name: "Pump relay 1", serial_number: null, description: null, lifecycle: "draft",
  presence: "offline", last_seen_at: null, tags: [], attributes: {}, site: null, profile: null, candidate: null,
  deployment_status: "draft", draft_revision: 1, desired_configuration_uuid: null, applied_configuration_uuid: null,
  last_applied_configuration_uuid: null, configurations: [], draft: null, diagnostic: null,
}
// The direct device's own Edge Node.
const gateway = {
  uuid: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", name: "Pump relay 1", edge_node_id: "pump-relay-1", connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: "plant", presence: "offline", last_seen_at: null, sources_count: 0,
}
const artifact = {
  uuid: artifactId, profile_uuid: profileId, revision: 2, definition_hash: "hash", status: "active", compiled_at: ago(86400),
  definition: {
    schema_version: "device-profile.v2",
    profile: { uuid: profileId, code: "relay", name: "Relay", category: "test", revision: 2 },
    parameters: [{ uuid: "p1", key: "relay_state", label: "Relay state", kind: "state", data_type: "boolean", unit: null, reports_state: true }],
    calculations: [],
    alarm_templates: [],
  },
}
const targets = [
  { id: "linux", name: "Linux or macOS", kind: "built", roles: ["direct", "gateway"], toolchain: "CMake 3.31" },
  { id: "esp32-esp-idf", name: "ESP32 (ESP-IDF)", kind: "built", roles: ["direct", "gateway"], toolchain: "ESP-IDF v5.4.1" },
  { id: "stm32", name: "STM32", kind: "ai_assisted", roles: ["direct", "gateway"], toolchain: null },
]

async function setup(page: Page, { connections = true } = {}) {
  const state = {
    errors: [] as string[],
    calls: [] as string[],
    starters: [] as Record<string, unknown>[],
    kits: [] as Record<string, unknown>[],
    provisioned: false,
  }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const context = {
    uuid: org, name: "Acme", slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: true, connections, activate: true, command: false },
      device_profiles: { view_any: true, view: true, create: false, update: false, delete_draft: false, validate: false, publish: false },
      features: { device_adapters: false },
    },
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    const onboarding = () => ({
      uuid: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0", mode: "direct", source_device_id: "", provisioned: state.provisioned, diagnostic: null,
      broker_url: "ssl://mqtt.example.test:8883", device, gateway, candidate: null, artifact,
    })
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
      state.calls.push("starter")
      state.starters.push(request.postDataJSON())
      return json({ data: { filename: "relay-esp32-esp-idf-starter.zip", manifest: null, archive_base64: emptyZip } })
    }
    if (path.endsWith(`/devices/${deviceId}/onboarding/provision`)) {
      state.calls.push("provision")
      state.provisioned = true
      return json({ data: onboarding() })
    }
    if (path.endsWith(`/devices/${deviceId}/onboarding`)) return json({ data: onboarding() })
    if (path.endsWith(`/devices/${deviceId}/firmware-kit`) && request.method() === "POST") {
      state.calls.push("firmware-kit")
      state.kits.push(request.postDataJSON())
      return json({ data: { filename: "pump-relay-1-esp32-esp-idf-firmware-kit.zip", manifest: null, archive_base64: emptyZip } })
    }
    if (path.endsWith(`/devices/${deviceId}/connection-kit`) && request.method() === "POST") {
      state.calls.push("connection-kit")
      return json({
        data: {
          filename: "pump-relay-1-connection-kit.zip", archive_base64: emptyZip, ca_certificate: "test-ca",
          config: {
            broker_url: "ssl://mqtt.example.test:8883", client_id: "pump-relay-1", username: "user", password: "pass", ca_file: "ca.crt",
            group_id: "plant", host_id: "h", edge_node_id: "pump-relay-1", device_id: "", metrics: [],
          },
        },
      })
    }
    if (path.endsWith(`/devices/${deviceId}/connection-kit/archive`)) {
      state.calls.push("connection-kit-archive")
      return route.fulfill({
        status: 200, contentType: "application/zip", body: Buffer.from(emptyZip, "base64"),
        headers: { "Content-Disposition": 'attachment; filename="pump-relay-1-connection-kit.zip"' },
      })
    }
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("writing the firmware reveals a target picker, then the starter and the kit", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices/onboard/${deviceId}`)
  await expect(page.getByRole("heading", { name: "Add these settings to your device" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Microcontroller or platform" })).toHaveCount(0)

  // 1. Choose "I’m writing the firmware".
  await page.getByRole("checkbox", { name: "I’m writing the firmware" }).click()
  // 2. Choose the target.
  await page.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await expect(page.getByRole("option", { name: "STM32 · no tested example" })).toBeVisible()
  await page.getByRole("option", { name: "ESP32 (ESP-IDF)" }).click()
  await axe(page)
  // 3. Download the starter: the device's profile artifact, credential-free.
  const starter = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download starter" }).click()
  expect((await starter).suggestedFilename()).toBe("relay-esp32-esp-idf-starter.zip")
  expect(state.starters).toEqual([{ target: "esp32-esp-idf", role: "direct", node_artifact_uuid: artifactId }])

  // The kit provisions the connection first, as the setup bundle does. Leave the starter first: when its
  // tooltip is still open, Radix takes a single move from it to the next button as heading for that tooltip.
  await page.mouse.move(0, 0, { steps: 5 })
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await page.getByRole("button", { name: "Download firmware kit" }).hover()
  await expect(page.getByRole("tooltip")).toContainText("this device's connection settings already in config/")
  const kit = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download firmware kit" }).click()
  expect((await kit).suggestedFilename()).toBe("pump-relay-1-esp32-esp-idf-firmware-kit.zip")
  expect(state.calls).toEqual(["starter", "provision", "firmware-kit"])
  expect(state.kits).toEqual([{ target: "esp32-esp-idf" }])
  await expect(page.getByText("Firmware kit downloaded. Its config/ folder holds the credentials: keep it private.")).toBeVisible()

  // The wizard continues as before.
  await expect(page.getByRole("button", { name: "Next: Check connection" })).toBeVisible()
  expect(state.errors).toEqual([])
})

test("the setup bundle still downloads as before", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices/onboard/${deviceId}`)
  const bundle = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download setup bundle" }).click()
  expect((await bundle).suggestedFilename()).toBe("pump-relay-1-connection-kit.zip")
  expect(state.calls).toEqual(["provision", "connection-kit", "connection-kit-archive"])
  expect(state.starters).toEqual([])
  expect(state.errors).toEqual([])
})

test("without connection access the step offers only the starter", async ({ page }) => {
  const state = await setup(page, { connections: false })
  await page.goto(`${base}/devices/onboard/${deviceId}`)
  await expect(page.getByRole("button", { name: "Download setup bundle" })).toBeDisabled()
  await page.getByRole("checkbox", { name: "I’m writing the firmware" }).click()
  await page.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await page.getByRole("option", { name: "Linux or macOS" }).click()
  await expect(page.getByRole("button", { name: "Download firmware kit" })).toHaveCount(0)
  await expect(page.getByText("Its connection settings come from an administrator.")).toBeVisible()
  const starter = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download starter" }).click()
  await starter
  expect(state.starters).toEqual([{ target: "linux", role: "direct", node_artifact_uuid: artifactId }])
  expect(state.calls).toEqual(["starter"])
  expect(state.errors).toEqual([])
})
