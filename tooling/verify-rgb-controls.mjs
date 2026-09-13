#!/usr/bin/env node
// Opt-in local acceptance. Creates/reuses only the dedicated RGB controls demo.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
const require = createRequire(
  new URL("../apps/portal/package.json", import.meta.url),
)
const { request } = require("@playwright/test")
const baseURL = process.env.RGB_API_URL ?? "http://localhost:8001"
const origin = process.env.RGB_PORTAL_URL ?? "http://localhost:5173"
const simulator = process.env.RGB_SIMULATOR_URL ?? "http://127.0.0.1:8766"
for (const url of [baseURL, origin, simulator])
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "This acceptance script is local-only.",
  )
const context = await request.newContext({
  baseURL,
  extraHTTPHeaders: {
    Accept: "application/json",
    Origin: origin,
    Referer: origin + "/",
  },
})
async function api(method, path, data) {
  const cookie = (await context.storageState()).cookies.find(
    (c) => c.name === "XSRF-TOKEN",
  )
  const response = await context.fetch(path, {
    method,
    data,
    headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {},
  })
  const body = await response.json()
  assert.ok(
    response.ok(),
    `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`,
  )
  return body
}
async function until(name, read, predicate) {
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw Error(`${name} was not confirmed within 40 seconds.`)
}
async function local(changes) {
  const response = await fetch(simulator + "/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
  assert.ok(response.ok)
  return response.json()
}
try {
  await context.get("/sanctum/csrf-cookie")
  const user = (
    await api("POST", "/api/v1/auth/login", {
      email: process.env.RGB_EMAIL ?? "super-admin@example.test",
      password: process.env.RGB_PASSWORD ?? "password",
    })
  ).data
  const organization = user.organizations.find(
    (o) => o.slug === "acme-manufacturing",
  )
  assert.ok(organization, "Acme local demo organization is required.")
  const path = `/api/v1/organizations/${organization.uuid}`
  const candidates = (
    await until(
      "RGB discovery",
      () => api("GET", path + "/discovery-candidates?per_page=100"),
      (r) =>
        r.data.some(
          (c) =>
            c.gateway.edge_node_id === "simulator-rgb-edge" &&
            c.source_device_id === "rgb-light",
        ),
    )
  ).data
  const candidate = candidates.find(
    (c) =>
      c.gateway.edge_node_id === "simulator-rgb-edge" &&
      c.source_device_id === "rgb-light",
  )
  const profile = (
    await api("GET", path + "/device-profiles?per_page=100")
  ).data.find((p) => p.code === "simulator-rgb-light-v2")
  assert.ok(profile, "Run devices:prepare-simulator --rgb-controls first.")
  const artifact = (
    await api(
      "GET",
      `${path}/device-profiles/${profile.uuid}/artifacts/${profile.revision}`,
    )
  ).data
  let device = (
    await api("GET", path + "/devices?search=rgb-controls-demo&per_page=100")
  ).data.find((d) => d.code === "rgb-controls-demo")
  if (device) device = (await api("GET", `${path}/devices/${device.uuid}`)).data
  else
    device = (
      await api("POST", path + "/devices", {
        name: "RGB LED · Controls demo",
        code: "rgb-controls-demo",
      })
    ).data
  if (!device.applied_configuration_uuid) {
    await api("PATCH", `${path}/discovery-candidates/${candidate.uuid}`, {
      status: "approved",
      birth_revision: candidate.birth_revision,
    })
    const mappings = artifact.definition.parameters.map((p) => ({
      parameter_uuid: p.uuid,
      metric: p.label,
      command_metric: p.label,
    }))
    device = (
      await api("PUT", `${path}/devices/${device.uuid}/configuration`, {
        draft_revision: device.draft_revision,
        artifact_uuid: artifact.uuid,
        candidate_uuid: candidate.uuid,
        birth_revision: candidate.birth_revision,
        mappings,
      })
    ).data
    await api("POST", `${path}/devices/${device.uuid}/validate`, {
      draft_revision: device.draft_revision,
    })
    await api("POST", `${path}/devices/${device.uuid}/activate`, {
      draft_revision: device.draft_revision,
    })
    device = (
      await until(
        "Applied configuration",
        () => api("GET", `${path}/devices/${device.uuid}`),
        (r) => r.data.deployment_status === "applied",
      )
    ).data
  }
  const latest = () =>
    api("GET", `${path}/devices/${device.uuid}/measurements/latest`)
  await until(
    "Online state",
    latest,
    (r) => r.presence === "online" && r.data.length === 4,
  )
  console.log("PASS RGB discovery, profile mapping, and runtime activation")
  const changes = {
    power: true,
    color: "#2244AA",
    mode: "blink",
    brightness: 37,
  }
  await local(changes)
  await until("Local changes reported", latest, (r) =>
    Object.entries(changes).every(([key, value]) =>
      r.data.some((p) => p.key === key && p.value === value),
    ),
  )
  console.log(
    "PASS all four local controls report through MQTT to the platform",
  )
  const targets = {
    power: false,
    color: "#AA44CC",
    mode: "strobe",
    brightness: 62,
  }
  for (const [key, value] of Object.entries(targets)) {
    const parameter = artifact.definition.parameters.find((p) => p.key === key)
    const input = {
      configuration_uuid: device.applied_configuration_uuid,
      parameter_uuid: parameter.uuid,
      value,
      idempotency_key: randomUUID(),
    }
    const command = (
      await api("POST", `${path}/devices/${device.uuid}/commands/send`, input)
    ).data
    const duplicate = (
      await api("POST", `${path}/devices/${device.uuid}/commands/send`, input)
    ).data
    assert.equal(duplicate.uuid, command.uuid)
    await until(
      `${key} target observed`,
      () => api("GET", `${path}/devices/${device.uuid}/commands`),
      (r) =>
        r.data.some((c) => c.uuid === command.uuid && c.status === "observed"),
    )
    const state = await (await fetch(simulator + "/state")).json()
    assert.equal(state.values[key], value)
  }
  console.log(
    "PASS four platform commands observed on the device; duplicate submissions send once",
  )
  await local({ brightness: 0, mode: "solid" })
  await until("Local override", latest, (r) =>
    r.data.some((p) => p.key === "brightness" && p.value === 0),
  )
  assert.equal(
    (await (await fetch(simulator + "/state")).json()).values.power,
    false,
  )
  console.log(
    "PASS local overrides remain authoritative and editing settings retains power-off",
  )
  const sources = artifact.definition.parameters.map((p) => ({
    device_uuid: device.uuid,
    parameter_uuid: p.uuid,
    device_name: device.name,
    label: p.label,
    unit: p.unit,
    data_type: p.data_type,
    precision: null,
    color: "#2563eb",
    base: { label: "Current", color: "#64748b" },
    thresholds: [],
  }))
  let dashboard = (await api("GET", path + "/dashboards")).data.find(
    (d) => d.name === "RGB LED controls demo",
  )
  if (!dashboard)
    dashboard = (
      await api("POST", path + "/dashboards", {
        name: "RGB LED controls demo",
        widgets: [
          {
            id: "rgb-controls",
            schema_version: 2,
            type: "controls",
            title: "RGB LED",
            description:
              "Control the simulator here or from its local device panel.",
            config: { sources },
          },
        ],
        layouts: { lg: [{ i: "rgb-controls", x: 0, y: 0, w: 8, h: 18 }] },
        defaults: {
          range: { mode: "relative", preset: "6h" },
          timezone: "browser",
          refresh: 5,
        },
      })
    ).data
  const evidence = {
    device: `${origin}/organizations/${organization.uuid}/devices/${device.uuid}/controls`,
    dashboard: `${origin}/organizations/${organization.uuid}/dashboards/${dashboard.uuid}`,
    simulator,
    verified_at: new Date().toISOString(),
  }
  writeFileSync(
    new URL("../.local/devices/rgb-controls-evidence.json", import.meta.url),
    JSON.stringify(evidence, null, 2) + "\n",
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await context.dispose()
}
