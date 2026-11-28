#!/usr/bin/env node
// Spec 038 quickstart C to E against the running stack and its simulated building: an
// OPC UA connection, a point map made from one zone box and applied to the similar ones,
// its review, collecting, batch activation, and one automated check for each simulator
// scenario the connector must handle (SC-004). Usage:
//   node tooling/verify-opcua.mjs [--api http://127.0.0.1:8001] [--origin http://localhost:5173]
//     [--email super-admin@example.test] [--password <seed password>] [--org acme-manufacturing]
//     [--connection "Example Tower BMS"] [--controls http://127.0.0.1:4841] [--adapter <data source name>]
// The stack runs the bms-simulator service (deploy/compose/compose.bms-simulator.yml) in its
// structured style, and an OPC UA connection to it that tests Connected (quickstart C).
// The organization keeps the data source and its devices afterwards; the name is unique
// per run, and --adapter runs C to E again on one an earlier run made. Scenarios are switched off again whatever happens.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "apps/portal/package.json"))
const { request } = require("@playwright/test")
const arg = (name, fallback) => {
  const index = process.argv.indexOf("--" + name)
  return index > 0 ? process.argv[index + 1] : fallback
}
const base = arg("api", "http://127.0.0.1:8001")
const origin = arg("origin", "http://localhost:5173")
const controls = arg("controls", "http://127.0.0.1:4841")
const suffix = randomUUID().slice(0, 6)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const passed = (name) => console.log("PASS " + name)
const NS = "urn:example:bms:example-tower"
const READINGS = ["zone_temperature", "temperature_setpoint", "damper_position", "occupancy"]

async function client(email, password) {
  const context = await request.newContext({ baseURL: base, extraHTTPHeaders: { Accept: "application/json", Origin: origin, Referer: origin + "/" } })
  await context.get("/sanctum/csrf-cookie")
  async function api(method, path, data, expected) {
    const cookie = (await context.storageState()).cookies.find((c) => c.name === "XSRF-TOKEN")
    const response = await context.fetch(path, { method, data, headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {} })
    const body = await response.json().catch(() => ({}))
    if (expected) assert.equal(response.status(), expected, `${method} ${path}: ${JSON.stringify(body).slice(0, 500)}`)
    else assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body).slice(0, 800)}`)
    return body
  }
  const user = (await api("POST", "/api/v1/auth/login", { email, password })).data
  return { api, user }
}

async function until(name, action, predicate, seconds = 60) {
  const deadline = Date.now() + seconds * 1000
  let result
  while (Date.now() < deadline) {
    result = await action()
    if (predicate(result)) return result
    await delay(1000)
  }
  throw new Error(`${name} did not happen in ${seconds} s: ${JSON.stringify(result).slice(0, 800)}`)
}

async function control(method, route, body) {
  const response = await fetch(controls + route, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
  assert.ok(response.ok, `simulator ${method} ${route}: ${response.status}`)
  return response.json()
}
const scenario = (name, on = true, target = null) => control("POST", `/scenarios/${name}`, { on, target })
const write = (point, value) => control("POST", "/write", { point, value })

const { api, user } = await client(arg("email", "super-admin@example.test"), arg("password", process.env.SEED_PASSWORD || "password"))
const org = user.organizations.find((o) => o.slug === arg("org", "acme-manufacturing")).uuid
const path = `/api/v1/organizations/${org}`

// C. The connection tests Connected.
const connection = (await api("GET", `${path}/adapter-connections`)).data.find((c) => c.name === arg("connection", "Example Tower BMS"))
assert.ok(connection, "Create the OPC UA connection to the simulator first (quickstart C)")
const conn = `${path}/adapter-connections/${connection.uuid}`
assert.equal((await api("POST", `${conn}/test`)).data.connected, true, "The connection does not connect")
passed("C the connection connects")

// D. One zone box, its points, readings suggested, similar boxes found, a device type.
// With --adapter, a data source an earlier run made is used again instead.
const reuse = arg("adapter", null)
let adapter, equipment, readings, first
if (reuse) {
  const found = (await api("GET", `${path}/device-adapters`)).data.find((a) => a.name === reuse)
  assert.ok(found, `No data source named ${reuse}`)
  adapter = `${path}/device-adapters/${found.uuid}`
  const detail = (await api("GET", adapter)).data
  assert.equal(detail.status, "running", "The data source is not collecting")
  ;({ readings, equipment } = detail.source.point_map)
  first = equipment.find((e) => e.display_name === "L03-VAV-2")
  passed(`D reusing ${reuse}: ${equipment.length} devices, ${readings.length} readings`)
} else {
  const box = (await api("POST", `${conn}/nodes/search`, { text: "L03-VAV-2" })).data.matches.find((n) => n.display_name === "L03-VAV-2" && n.kind !== "point")
  assert.ok(box, "L03-VAV-2 not found on the server")
  const children = (await api("GET", `${conn}/nodes?parent=${encodeURIComponent(`nsu=${box.namespace_uri};${box.node_id}`)}`)).data.items
  const points = READINGS.map((key) => children.find((n) => n.name === key)).filter(Boolean)
  assert.equal(points.length, READINGS.length, "The zone box lacks a reading: " + JSON.stringify(children.map((n) => n.name)))
  const suggested = (await api("POST", `${conn}/point-map/suggest`, { points: points.map((p) => ({ node: `nsu=${p.namespace_uri};${p.node_id}`, name: p.name, display_name: p.display_name })) })).data
  assert.equal(suggested.refused.length, 0)
  readings = suggested.readings.map((r, i) => ({ ...r, scale: 1, offset: 0, address: { relative_path: [{ namespace_uri: NS, name: points[i].name }] } }))
  first = { source_id: box.path.map((s) => s.name).join("/"), display_name: box.display_name, address: { node_id: box.node_id, namespace_uri: box.namespace_uri, path: box.path } }
  const similar = (await api("POST", `${conn}/nodes/similar`, { equipment: { node: `nsu=${box.namespace_uri};${box.node_id}`, path: box.path }, points: readings.map((r) => ({ key: r.key, name: r.address.relative_path[0].name })), by: "names" })).data
  equipment = [first, ...similar.matches.filter((m) => m.source_id !== first.source_id).map((m) => ({ ...m, address: { ...m.address, namespace_uri: m.address.namespace_uri ?? NS, path: m.address.path.map((s) => ({ ...s, namespace_uri: s.namespace_uri ?? NS })) }, ...(m.missing?.length ? { missing: m.missing } : { missing: undefined }) }))]
  assert.ok(equipment.length >= 10, `Only ${equipment.length} zone boxes found`)
  const type = (await api("POST", `${path}/device-adapters/point-map/device-type`, { name: `Zone controller ${suffix}`, readings: readings.map((r) => ({ key: r.key, name: r.name, data_type: r.data_type, unit: r.unit ?? null })) })).data
  const map = { version: 1, protocol: "opcua", rhythm_seconds: 300, readings, equipment: equipment.map((e) => JSON.parse(JSON.stringify(e))) }
  const saved = (await api("POST", `${path}/device-adapters`, { request_uuid: randomUUID(), name: `Zone controllers ${suffix}`, artifact_uuid: type.artifact_uuid, source: { type: "opcua", connection_uuid: connection.uuid, point_map: map } }, 201)).data
  adapter = `${path}/device-adapters/${saved.uuid}`
  const review = (await api("POST", `${adapter}/test`, { draft_revision: saved.draft_revision })).data
  assert.equal(review.valid, true, JSON.stringify(review.problems))
  passed(`D ${equipment.length} devices, ${readings.length} readings, ${review.totals.points} points; review passed`)

  // E1. Deploy: every equipment waits in Devices.
  await api("POST", `${adapter}/deploy`, { request_uuid: randomUUID(), draft_revision: saved.draft_revision }, 202)
  await until("deployment", () => api("GET", adapter), (r) => r.data.status === "running" || r.data.status === "failed", 240).then((r) => assert.equal(r.data.status, "running", r.data.diagnostic))
}
const sources = await until("every equipment reporting", () => api("GET", `${adapter}/candidates`), (r) => r.data.length >= equipment.length, 120)
assert.ok(sources.data.every((c) => c.name && (!c.name.includes("/") || c.name.includes(" / "))), "Sources are named by their equipment")
const waiting = sources.data.filter((c) => !c.device && !c.in_use_in)
passed(`E1 ${equipment.length} sources reported, ${waiting.length} waiting to be activated`)

// E2. Activate the waiting ones at once: each gets a device with its readings.
const devices = Object.fromEntries(sources.data.filter((c) => c.device).map((c) => [c.source_device_id, c.device.uuid]))
if (waiting.length) {
  const started = (await api("POST", `${adapter}/candidates/activate`, { sources: waiting.map((c) => ({ candidate_uuid: c.uuid })) }, 202)).data
  const batch = await until("batch activation", () => api("GET", `${adapter}/candidates/activations/${started.uuid}`), (r) => r.data.status === "done" || r.data.status === "failed", 180)
  const failures = batch.data.results.filter((r) => r.outcome === "failed")
  assert.equal(failures.length, 0, JSON.stringify(failures))
  assert.equal(batch.data.results.length, waiting.length)
  for (const c of waiting) devices[c.source_device_id] = batch.data.results.find((r) => r.candidate_uuid === c.uuid).device.uuid
}
const latest = async (sourceId) => (await api("GET", `${path}/devices/${devices[sourceId]}/measurements/latest`)).data
const reading = (rows, key) => rows.find((r) => r.key === key)
await until("readings on every device", async () => Promise.all(Object.keys(devices).map(latest)), (all) => all.every((rows) => rows.filter((r) => r.value !== null).length >= 1), 120)
passed(`E2 ${waiting.length} activated in one batch; all ${Object.keys(devices).length} devices store readings`)

const scenarios = []
try {
  // E3. A setpoint changed at the building arrives within 15 s (SC-002).
  const target = 20 + Math.round(Math.random() * 50) / 10
  const changedAt = Date.now()
  await write("L03-VAV-2.temperature_setpoint", target)
  await until("the new setpoint", () => latest(first.source_id), (rows) => Math.abs((reading(rows, "temperature_setpoint")?.value ?? 0) - target) < 0.01, 15)
  passed(`E3 a setpoint change arrived in ${((Date.now() - changedAt) / 1000).toFixed(1)} s`)

  // E4. A controller that stops answering: its readings are unknown with the reason.
  const other = equipment.find((e) => e.source_id !== first.source_id && !e.missing?.includes("zone_temperature")).source_id
  scenarios.push(["controller_offline"])
  await scenario("controller_offline", true, "L03-VAV-2")
  const dead = await until("unknown readings", () => latest(first.source_id), (rows) => reading(rows, "zone_temperature")?.quality === "invalid", 60)
  assert.equal(reading(dead, "zone_temperature").value, null)
  assert.equal(reading(dead, "zone_temperature").diagnostic, "No communication with the device")
  assert.equal(reading(await latest(other), "zone_temperature").quality, "good")
  await scenario("controller_offline", false)
  await until("values back", () => latest(first.source_id), (rows) => reading(rows, "zone_temperature")?.quality === "good", 60)
  passed("E4 controller_offline: unknown with 'No communication with the device', the others good, then back")

  // E5. An uncertain value is stored and shown with its quality.
  scenarios.push(["uncertain_value"])
  await scenario("uncertain_value", true, "L03-VAV-2.zone_temperature")
  const unsure = await until("an uncertain reading", () => latest(first.source_id), (rows) => reading(rows, "zone_temperature")?.quality === "uncertain", 60)
  assert.equal(typeof reading(unsure, "zone_temperature").value, "number")
  await scenario("uncertain_value", false)
  passed("E5 uncertain_value: stored with its value, labelled uncertain")

  // E7. The server restarts: Server unreachable, then collecting resumes by itself.
  const restartAt = new Date().toISOString()
  await scenario("server_restart", true, 30)
  await until("Server unreachable", () => api("GET", conn), (r) => r.data.state === "unreachable", 90)
  await until("connected again", () => api("GET", conn), (r) => r.data.state === "connected" && r.data.status?.since > restartAt, 240)
  const resumed = Date.now()
  await write("L03-VAV-2.temperature_setpoint", target + 1)
  await until("values after the restart", () => latest(first.source_id), (rows) => Math.abs((reading(rows, "temperature_setpoint")?.value ?? 0) - (target + 1)) < 0.01 && Date.parse(reading(rows, "temperature_setpoint").received_at) > resumed - 1000, 60)
  passed("E7 server_restart: unreachable, then collecting resumed by itself")

  // T068. A source clock 10 minutes ahead: stored at receipt time and labelled so.
  scenarios.push(["clock_wrong"])
  await scenario("clock_wrong", true, 600)
  await write("L03-VAV-2.temperature_setpoint", target)
  const receipt = await until("a receipt-timed reading", () => latest(first.source_id), (rows) => reading(rows, "temperature_setpoint")?.timestamp_source === "receipt", 60)
  assert.ok(Math.abs(Date.parse(reading(receipt, "temperature_setpoint").observed_at) - Date.now()) < 120_000)
  await scenario("clock_wrong", false)
  passed("clock_wrong: a time 10 minutes ahead is stored at receipt and labelled so")

  // Refused points and the connection's counts reach the connection.
  const status = (await api("GET", conn)).data
  assert.ok(status.status.points_read >= readings.length * equipment.length - equipment.reduce((n, e) => n + (e.missing?.length ?? 0), 0))
  passed(`connection status: ${status.status.points_read} points read, ${status.status.values_last_minute} values in the last minute`)
} finally {
  for (const [name] of scenarios) await scenario(name, false).catch(() => {})
}
console.log(`Kept: the data source and its ${Object.keys(devices).length} devices (${adapter}).`)
