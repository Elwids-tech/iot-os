import { readFileSync } from "node:fs"
import { expect, test, type Page, type Route } from "@playwright/test"

const organization = {
  uuid: "170eb66d-100e-458d-b7e2-b510a12e9c9f",
  name: "Acme Manufacturing",
  slug: "acme-manufacturing",
  capabilities: { manage_administration: true },
}

const threePhaseProfile = fixture("three-phase-meter/profile.json")
const threePhaseBinding = fixture("three-phase-meter/binding.json")
const humidityProfile = fixture("hub-fanout/humidity-profile.json")
const humidityBinding = fixture("hub-fanout/humidity-binding.json")
const northGateway = fixture("hub-fanout/gateway.json")

type CatalogState = {
  profiles?: unknown[]
  bindings?: unknown[]
  devices?: unknown[]
  gateways?: unknown[]
  routes?: unknown[]
  profileCollection?: (route: Route) => Promise<void>
  profileMember?: (route: Route) => Promise<void>
}

function fixture(path: string) {
  return JSON.parse(
    readFileSync(new URL(`../../../contracts/fixtures/device-onboarding/valid/${path}`, import.meta.url), "utf8"),
  )
}

function profileResource(document: Record<string, unknown>, state = "published", etag = '"profile-r1"') {
  return {
    ...document,
    meta: {
      profile_revision: 1,
      version_revision: 1,
      state,
      artifact_hash: state === "published" ? "a".repeat(64) : null,
      etag,
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    },
  }
}

function bindingResource(document: Record<string, unknown>, state = "published", etag = '"binding-r1"') {
  return {
    ...document,
    meta: {
      binding_revision: 1,
      version_revision: 1,
      state,
      artifact_hash: state === "published" ? "b".repeat(64) : null,
      etag,
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    },
  }
}

function gatewayResource(document: Record<string, unknown>) {
  return {
    ...document,
    meta: {
      revision: 1,
      etag: '"gateway-r1"',
      routes_count: 2,
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    },
  }
}

function collection(data: unknown[]) {
  return {
    data,
    meta: {
      current_page: 1,
      from: data.length ? 1 : null,
      last_page: 1,
      per_page: 50,
      to: data.length || null,
      total: data.length,
    },
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function mockApi(page: Page, state: CatalogState = {}) {
  await page.route("**/api/v1/me", async (route) => {
    await fulfillJson(route, {
      data: {
        id: 1,
        name: "Acme Administrator",
        email: "admin@example.test",
        email_verified_at: "2026-08-29T00:00:00Z",
        is_super_admin: false,
        capabilities: { platform_administration: false },
        organizations: [organization],
      },
    })
  })

  await page.route("**/api/v1/device-profiles", async (route) => {
    if (state.profileCollection) return state.profileCollection(route)
    await fulfillJson(route, collection(state.profiles ?? []))
  })
  await page.route("**/api/v1/device-profiles/*", async (route) => {
    if (state.profileMember) return state.profileMember(route)
    await fulfillJson(route, { message: "Unexpected Profile member request." }, 500)
  })
  await page.route("**/api/v1/native-mqtt-bindings", async (route) => {
    await fulfillJson(route, collection(state.bindings ?? []))
  })
  await page.route("**/api/v1/devices", async (route) => {
    await fulfillJson(route, collection(state.devices ?? []))
  })
  await page.route("**/api/v1/gateways", async (route) => {
    await fulfillJson(route, collection(state.gateways ?? []))
  })
  await page.route("**/api/v1/gateway-routes", async (route) => {
    await fulfillJson(route, collection(state.routes ?? []))
  })
}

async function openDeviceDomain(page: Page) {
  await page.goto(`/organizations/${organization.uuid}/device-domain`)
  await expect(page.getByRole("heading", { name: "Device Domain" }).last()).toBeVisible()
}

test("authors Commands and preserves stable parameter UUIDs through reorder, save, and reload", async ({ page }) => {
  let savedProfile: Record<string, unknown> | null = null
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await mockApi(page, {
    profileCollection: async (route) => {
      if (route.request().method() === "POST") {
        const document = route.request().postDataJSON() as Record<string, unknown>
        savedProfile = profileResource(document, "draft", '"profile-r1"')
        return fulfillJson(route, { data: savedProfile }, 201)
      }
      return fulfillJson(route, collection(savedProfile ? [savedProfile] : []))
    },
  })
  await openDeviceDomain(page)

  await page.getByLabel("Profile name").fill("Climate controller")
  await page.getByRole("button", { name: "Add first parameter" }).click()
  await page.getByRole("button", { name: "Parameter 1" }).click()
  await page.getByLabel("Label", { exact: true }).fill("Temperature")

  await page.getByRole("button", { name: "Add parameter" }).click()
  await page.getByRole("button", { name: "Parameter 2" }).click()
  await page.getByLabel("Label", { exact: true }).nth(1).fill("Humidity")

  const beforeReorder = JSON.parse(await page.getByTestId("profile-json-preview").innerText())
  const parameterIds = Object.fromEntries(
    beforeReorder.version.parameters.map((parameter: { label: string; uuid: string }) => [parameter.label, parameter.uuid]),
  )
  await page.getByRole("button", { name: "Move Humidity up" }).click()
  const afterReorder = JSON.parse(await page.getByTestId("profile-json-preview").innerText())
  expect(afterReorder.version.parameters.map((parameter: { label: string }) => parameter.label)).toEqual([
    "Humidity",
    "Temperature",
  ])
  expect(Object.fromEntries(afterReorder.version.parameters.map((parameter: { label: string; uuid: string }) => [parameter.label, parameter.uuid]))).toEqual(parameterIds)

  await page.getByRole("tab", { name: "Commands (0)" }).click()
  await page.getByRole("button", { name: "Add first Command" }).click()
  await page.getByRole("button", { name: "Command 1" }).click()
  await page.getByLabel("Command label").fill("Set thermostat")
  await page.getByRole("button", { name: "Add Command field" }).click()
  await page.getByLabel("Label", { exact: true }).last().fill("Temperature level")

  const commandDraft = JSON.parse(await page.getByTestId("profile-json-preview").innerText())
  expect(commandDraft.version.commands[0]).toMatchObject({
    key: "set_thermostat",
    fields: [{ key: "temperature_level", direction: "input", required: true }],
  })

  await page.getByRole("button", { name: "Create Profile draft" }).click()
  await expect(page.getByText(/saved as a draft Profile/)).toBeVisible()
  await page.getByRole("button", { name: "Reload catalogs" }).click()
  await expect(page.getByText("Catalogs reloaded from the tenant API.")).toBeVisible()

  const reloaded = JSON.parse(await page.getByTestId("profile-json-preview").innerText())
  expect(Object.fromEntries(reloaded.version.parameters.map((parameter: { label: string; uuid: string }) => [parameter.label, parameter.uuid]))).toEqual(parameterIds)
  expect(reloaded.version.commands[0].fields[0].key).toBe("temperature_level")
  expect(consoleErrors).toEqual([])
})

test("shows three-phase derivation and divide-by-ten transport calibration", async ({ page }) => {
  await mockApi(page, {
    profiles: [profileResource(threePhaseProfile)],
    bindings: [bindingResource(threePhaseBinding)],
  })
  await openDeviceDomain(page)

  await page.getByLabel("Saved profile").click()
  await page.getByRole("option", { name: /Three-phase energy meter/ }).click()
  await page.getByRole("tab", { name: "Derived (1)" }).click()
  await page.getByRole("button", { name: "Average phase voltage" }).click()
  await expect(page.getByLabel("Restricted CEL formula")).toHaveValue(/\/ 3\.0/)
  await expect(page.getByLabel("L1 voltage")).toBeChecked()
  await expect(page.getByLabel("L2 voltage")).toBeChecked()
  await expect(page.getByLabel("L3 voltage")).toBeChecked()

  await page.getByRole("tab", { name: /MQTT Bindings/ }).click()
  await page.getByRole("button", { name: "Open saved Binding" }).click()
  await page.getByRole("tab", { name: "Parameters (7)" }).click()
  await page.getByRole("button", { name: "L1 voltage" }).click()
  await expect(page.getByLabel("Source JSONPath")).toHaveValue("$.voltages.l1")
  await expect(page.getByRole("combobox", { name: "Operation" }).first()).toContainText("divide")
  await expect(page.getByLabel("Value").first()).toHaveValue("10")
})

test("routes one shared Gateway topic to a logical hub Device with an inbound selector", async ({ page }) => {
  await mockApi(page, {
    profiles: [profileResource(humidityProfile)],
    bindings: [bindingResource(humidityBinding)],
    gateways: [gatewayResource(northGateway)],
  })
  await openDeviceDomain(page)

  await page.getByRole("tab", { name: /Onboarding/ }).click()
  await page.getByLabel("Device Profile").click()
  await page.getByRole("option", { name: /Humidity sensor/ }).click()
  await page.getByLabel("Gateway", { exact: true }).click()
  await page.getByRole("option", { name: /North plant hub/ }).click()
  await page.getByLabel("Device name").fill("North hub humidity")
  await page.getByLabel("External ID").fill("humidity-01")
  await page.getByLabel("Route path").fill("sensors/humidity")
  await page.getByLabel("Route payload JSONPath").fill("$.sensors.humidity")
  await page.getByLabel("Use a payload selector").check()

  await expect(page.getByText("gateways/north-hub-001/telemetry")).toBeVisible()
  const context = JSON.parse(await page.getByTestId("onboarding-json-preview").innerText())
  expect(context.gateway.gateway.uuid).toBe(northGateway.gateway.uuid)
  expect(context.route.route).toMatchObject({
    route_path: "sensors/humidity",
    inbound_scopes: [
      {
        channel: "telemetry",
        payload_path: "$.sensors.humidity",
        selector: { source: { scope: "message", json_path: "$.sensor_id" }, equals: "sensor-1" },
      },
    ],
  })
})

test("persists, compiles, pins, and registers a Gateway-routed Device", async ({ page }) => {
  const calls: string[] = []
  const inputHash = "c".repeat(64)
  const runtimeHash = "d".repeat(64)
  let createdDevice: Record<string, unknown> | null = null
  let createdRoute: Record<string, unknown> | null = null
  let assignment: Record<string, unknown> | null = null

  const preview = {
    schema: "iot.definition-preview.v1",
    valid: true,
    input_hash: inputHash,
    compiler: {
      name: "iot-os-definition-compiler",
      version: "1.0.0",
      cel_environment: "cel-go-v0.26-restricted-v1",
      jsonpath_version: "ojg-v1-restricted-v1",
      unit_registry: "ucum-essence-2026",
    },
    diagnostics: [],
    artifact_hashes: { profile: "a".repeat(64), binding: "b".repeat(64), runtime_bundle: runtimeHash },
    previews: [],
  }

  await mockApi(page, {
    profiles: [profileResource(humidityProfile)],
    bindings: [bindingResource(humidityBinding)],
    gateways: [gatewayResource(northGateway)],
  })
  await page.route("**/api/v1/devices", async (route) => {
    if (route.request().method() === "POST") {
      calls.push("device")
      const document = route.request().postDataJSON() as Record<string, unknown>
      createdDevice = {
        ...document,
        lifecycle_state: "draft",
        revision: 1,
        etag: '"device-r1"',
        registered_at: null,
        archived_at: null,
        created_at: "2026-08-29T00:00:00Z",
        updated_at: "2026-08-29T00:00:00Z",
        definition_assignment: null,
      }
      return fulfillJson(route, { data: createdDevice }, 201)
    }
    return fulfillJson(route, collection(createdDevice ? [createdDevice] : []))
  })
  await page.route("**/api/v1/gateway-routes", async (route) => {
    if (route.request().method() === "POST") {
      calls.push("route")
      const document = route.request().postDataJSON() as Record<string, unknown>
      createdRoute = gatewayResource(document)
      return fulfillJson(route, { data: createdRoute }, 201)
    }
    return fulfillJson(route, collection(createdRoute ? [createdRoute] : []))
  })
  await page.route("**/api/v1/devices/*/definition-assignment", async (route) => {
    calls.push("assignment")
    const device = createdDevice as { uuid: string }
    const routeDocument = createdRoute as { route: { uuid: string } }
    assignment = {
      uuid: "90000000-0000-4000-8000-000000000001",
      device_uuid: device.uuid,
      profile_version_uuid: humidityProfile.version.uuid,
      binding_version_uuid: humidityBinding.version.uuid,
      gateway_route_uuid: routeDocument.route.uuid,
      profile_artifact_hash: "a".repeat(64),
      binding_artifact_hash: "b".repeat(64),
      route_source_hash: "e".repeat(64),
      runtime_bundle_hash: null,
      runtime_bundle: null,
      runtime_compiled_at: null,
      revision: 2,
      etag: '"assignment-r2"',
      locked_at: null,
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    }
    await fulfillJson(route, { data: assignment })
  })
  await page.route("**/api/v1/devices/*/definition-assignment/compile", async (route) => {
    calls.push("compile")
    await fulfillJson(route, { data: preview })
  })
  await page.route("**/api/v1/devices/*/definition-assignment/pin", async (route) => {
    calls.push("pin")
    assignment = {
      ...assignment,
      runtime_bundle_hash: runtimeHash,
      runtime_bundle: { schema: "iot.runtime-bundle.v1", runtime_bundle_hash: runtimeHash },
      runtime_compiled_at: "2026-08-29T00:01:00Z",
      revision: 3,
      etag: '"assignment-r3"',
    }
    await fulfillJson(route, { data: { assignment, compile: preview } })
  })
  await page.route("**/api/v1/devices/*/register", async (route) => {
    calls.push("register")
    createdDevice = {
      ...createdDevice,
      lifecycle_state: "registered",
      revision: 2,
      etag: '"device-r2"',
      registered_at: "2026-08-29T00:02:00Z",
      definition_assignment: assignment,
    }
    await fulfillJson(route, { data: createdDevice })
  })

  await openDeviceDomain(page)
  await page.getByRole("tab", { name: /Onboarding/ }).click()
  await page.getByLabel("Device Profile").click()
  await page.getByRole("option", { name: /Humidity sensor/ }).click()
  await page.getByLabel("Gateway", { exact: true }).click()
  await page.getByRole("option", { name: /North plant hub/ }).click()
  await page.getByLabel("Device name").fill("North hub humidity")
  await page.getByLabel("External ID").fill("humidity-02")
  await page.getByLabel("Route path").fill("sensors/humidity-02")

  await page.getByRole("button", { name: "Create Gateway, Device, and Route" }).click()
  await expect(page.getByText("Route saved")).toBeVisible()
  await expect(page.getByLabel("Gateway", { exact: true })).toBeDisabled()
  await expect(page.getByLabel("Device name")).toBeDisabled()
  await expect(page.getByLabel("External ID")).toBeDisabled()
  await expect(page.getByLabel("Route path")).toBeDisabled()
  await page.getByRole("button", { name: "Compile saved assignment" }).click()
  await expect(page.getByText(/Persisted-assignment compile/)).toBeVisible()
  await page.getByRole("button", { name: "Pin Runtime Bundle" }).click()
  await expect(page.getByText("Bundle pinned")).toBeVisible()
  await page.getByRole("button", { name: "Register Device" }).click()
  await expect(page.getByText("North hub humidity is registered")).toBeVisible()

  expect(calls).toEqual(["device", "route", "assignment", "compile", "pin", "register"])
})

test("surfaces ETag conflicts and remains usable at a mobile viewport", async ({ page }) => {
  const draft = profileResource(threePhaseProfile, "draft", '"profile-r1"')
  await mockApi(page, {
    profiles: [draft],
    profileMember: async (route) => {
      expect(route.request().headers()["if-match"]).toBe('"profile-r1"')
      await fulfillJson(
        route,
        { message: "The supplied If-Match value is stale. Reload the resource and retry." },
        412,
      )
    },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await openDeviceDomain(page)

  await page.getByLabel("Saved profile").click()
  await page.getByRole("option", { name: /Three-phase energy meter/ }).click()
  await page.getByLabel("Profile name").fill("Changed meter")
  await page.getByRole("button", { name: "Save Profile draft" }).click()

  await expect(page.getByText(/changed in another session/)).toBeVisible()
  await expect(page.getByRole("tab", { name: /Profiles/ })).toBeVisible()
  await expect(page.getByRole("tab", { name: /Onboarding/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
