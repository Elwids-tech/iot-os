#!/usr/bin/env node
// Opt-in local hardware setup. Extends the existing RGB demo profile in place.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const require = createRequire(new URL("../../apps/portal/package.json", import.meta.url))
const { request } = require("@playwright/test")
const baseURL = process.env.RGB_API_URL ?? "http://localhost:8001"
const origin = process.env.RGB_PORTAL_URL ?? "http://localhost:5173"
for (const url of [baseURL, origin]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Local setup only")
const context = await request.newContext({ baseURL, extraHTTPHeaders: { Accept: "application/json", Origin: origin, Referer: origin + "/" } })
async function api(method, path, data) {
  const cookie = (await context.storageState()).cookies.find(c => c.name === "XSRF-TOKEN")
  const r = await context.fetch(path, { method, data, headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {} })
  const body = await r.json()
  assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${JSON.stringify(body)}`)
  return body
}
async function until(name, read, predicate, timeout = 40000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(r => setTimeout(r, 300))
  }
  throw Error(`${name} not confirmed`)
}
const fixture = JSON.parse(readFileSync(new URL("../../contracts/definitions/device-profiles/waveshare-audio.v1.json", import.meta.url)))
try {
  await context.get("/sanctum/csrf-cookie")
  const user = (await api("POST", "/api/v1/auth/login", { email: process.env.RGB_EMAIL ?? "super-admin@example.test", password: process.env.RGB_PASSWORD ?? "password" })).data
  const org = user.organizations.find(o => o.slug === "acme-manufacturing")
  assert.ok(org)
  const path = `/api/v1/organizations/${org.uuid}`
  const entry = (await api("GET", path + "/devices?search=rgb-controls-demo&per_page=100")).data.find(d => d.code === "rgb-controls-demo")
  assert.ok(entry, "The existing RGB controls demo must already be onboarded")
  let device = (await api("GET", `${path}/devices/${entry.uuid}`)).data
  let profile = (await api("GET", path + "/device-profiles?search=simulator-rgb-light-v2&per_page=100")).data.find(p => p.code === "simulator-rgb-light-v2")
  assert.ok(profile && profile.devices_count <= 1, "Only the dedicated RGB profile may be extended")
  const profilePath = `${path}/device-profiles/${profile.uuid}`
  profile = (await api("GET", profilePath)).data
  const backup = new URL("../../.local/devices/waveshare-before-setup.json", import.meta.url)
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify({ device, profile }, null, 2) + "\n", { mode: 0o600 })
  const candidates = (await until("Physical board discovery", () => api("GET", path + "/discovery-candidates?per_page=100"), r => r.data.some(c => c.gateway.edge_node_id === "simulator-rgb-edge" && c.source_device_id === "rgb-light" && fixture.parameters.every(p => c.metrics.some(m => m.name === p.label))))).data
  const candidate = candidates.find(c => c.gateway.edge_node_id === "simulator-rgb-edge" && c.source_device_id === "rgb-light")
  for (const [index, p] of fixture.parameters.entries()) {
    const existing = profile.parameters.find(x => x.key === p.key)
    if (existing) {
      assert.equal(existing.data_type, p.data_type, `Unexpected ${p.key} contract`)
      continue // Preserve existing RGB parameter UUIDs, controls, and history.
    }
    await api("POST", profilePath + "/parameters", {
      key: p.key, label: p.label, kind: p.kind, data_type: p.data_type, format: p.format,
      unit: p.unit, reports_state: true, accepts_command: true, validation_logic: p.validation,
      display_config: p.display, reporting_config: p.reporting, sort_order: index,
      draft_revision: profile.draft_revision,
    })
    profile = (await api("GET", profilePath)).data
  }
  let artifact = (await api("GET", profilePath + `/artifacts/${profile.revision}`)).data
  if (!fixture.parameters.every(p => artifact.definition.parameters.some(x => x.key === p.key))) {
    const validation = (await api("POST", profilePath + "/validate", { draft_revision: profile.draft_revision })).data
    assert.ok(validation.valid, JSON.stringify(validation.diagnostics))
    artifact = (await api("POST", profilePath + "/publish", { draft_revision: profile.draft_revision })).data
  }
  const mappings = artifact.definition.parameters.map(p => ({ parameter_uuid: p.uuid, metric: p.label, command_metric: p.accepts_command ? p.label : null }))
  if (device.deployment_status !== "applied" || device.draft?.artifact_uuid !== artifact.uuid || device.draft?.birth_revision !== candidate.birth_revision || process.argv.includes("--reactivate")) {
    device = (await api("PUT", `${path}/devices/${device.uuid}/configuration`, {
      draft_revision: device.draft_revision, artifact_uuid: artifact.uuid,
      candidate_uuid: candidate.uuid, birth_revision: candidate.birth_revision, mappings,
    })).data
    await api("POST", `${path}/devices/${device.uuid}/validate`, { draft_revision: device.draft_revision })
    await api("POST", `${path}/devices/${device.uuid}/activate`, { draft_revision: device.draft_revision })
    device = (await until("Runtime configuration", () => api("GET", `${path}/devices/${device.uuid}`), r => r.data.deployment_status === "applied")).data
  }
  const latest = () => api("GET", `${path}/devices/${device.uuid}/measurements/latest`)
  await until("Eight hardware states", latest, r => r.presence === "online" && fixture.parameters.every(p => r.data.some(v => v.key === p.key)))
  console.log("PASS physical source discovered, eight parameters mapped, configuration applied")
  const sources = artifact.definition.parameters.map(p => ({ device_uuid: device.uuid, parameter_uuid: p.uuid, device_name: device.name, label: p.label, unit: p.unit, data_type: p.data_type, precision: null, color: "#2563eb", base: { label: "Current", color: "#64748b" }, thresholds: [] }))
  let dashboard = (await api("GET", path + "/dashboards")).data.find(d => d.name === "Waveshare RGB and audio alarm")
  if (!dashboard) dashboard = (await api("POST", path + "/dashboards", {
    name: "Waveshare RGB and audio alarm",
    widgets: [{ id: "waveshare-controls", schema_version: 2, type: "controls", title: "Waveshare board", description: "RGB lights and speaker alarm. Alarm stops after the selected duration. BOOT stops both outputs.", config: { sources } }],
    layouts: { lg: [{ i: "waveshare-controls", x: 0, y: 0, w: 10, h: 24 }] },
    defaults: { range: { mode: "relative", preset: "6h" }, timezone: "browser", refresh: 5 },
  })).data
  const evidence = { device: `${origin}/organizations/${org.uuid}/devices/${device.uuid}/controls`, dashboard: `${origin}/organizations/${org.uuid}/dashboards/${dashboard.uuid}`, device_uuid: device.uuid, organization_uuid: org.uuid, configuration_uuid: device.applied_configuration_uuid, verified_at: new Date().toISOString() }
  writeFileSync(new URL("../../.local/devices/waveshare-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n")
  if (process.argv.includes("--test")) {
    async function send(key, value) {
      const p = artifact.definition.parameters.find(p => p.key === key)
      const command = (await api("POST", `${path}/devices/${device.uuid}/commands/send`, { configuration_uuid: device.applied_configuration_uuid, parameter_uuid: p.uuid, value, idempotency_key: randomUUID() })).data
      await until(`${key} confirmed`, () => api("GET", `${path}/devices/${device.uuid}/commands`), r => r.data.some(c => c.uuid === command.uuid && ["observed", "already_at_target"].includes(c.status)))
      await until(`${key} reported`, latest, r => r.presence === "online" && r.data.some(p => p.key === key && p.value === value))
      console.log(`PASS hardware reports ${key}=${value}`)
    }
    try {
      await send("alarm_active", false)
      await send("power", false)
      await send("brightness", 20)
      await send("color", "#FF0000")
      for (const mode of ["solid", "blink", "strobe"]) {
        await send("mode", mode)
        await send("power", true)
        await new Promise(r => setTimeout(r, 1200))
      }
      await send("volume", 15)
      await send("alarm_duration", 2)
      for (const mode of ["beep", "siren", "steady"]) {
        await send("alarm_mode", mode)
        await send("alarm_active", true)
        await until("Board timer stopped alarm", latest, r => r.data.some(p => p.key === "alarm_active" && p.value === false), 10000)
        console.log(`PASS ${mode} alarm automatically stopped`)
      }
    } finally {
      await send("alarm_active", false)
      await send("power", false)
      await send("mode", "solid")
      await send("alarm_mode", "beep")
      await send("alarm_duration", 5)
    }
    evidence.commands_verified_at = new Date().toISOString()
    writeFileSync(new URL("../../.local/devices/waveshare-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(JSON.stringify(evidence, null, 2))
} finally { await context.dispose() }
