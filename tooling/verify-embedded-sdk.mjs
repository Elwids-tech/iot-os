#!/usr/bin/env node
// End-to-end check of the embedded SDK against a local stack (spec 026 R21, quickstart 7).
// It registers a gateway, downloads its full firmware kit (spec 027), builds the kit's
// desktop simulator with CMake and runs 500 simulated devices of two types through it:
// discovery, a restart, bulk onboarding, the gateway's own source, one command and
// going offline. Local only.
//
//   node tooling/verify-embedded-sdk.mjs [environment.json] [--keep]
//
// With an environment.json from tooling/test-devices.mjs it uses that harness; without
// one, the dev stack (API on localhost:8001). Each run uses a new gateway, and its files
// (kit, build, simulator log, evidence) go under .local/embedded-sdk/<run>/. The devices
// it creates are deactivated and archived at the end unless --keep is given; the gateway
// and its discovered sources stay, as gateways cannot be deleted.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "apps/portal/package.json"))
const { request } = require("@playwright/test")
const args = process.argv.slice(2)
const keep = args.includes("--keep")
const environmentFile = args.find((a) => !a.startsWith("--"))
const env = environmentFile ? JSON.parse(readFileSync(environmentFile, "utf8")) : null
const base = process.env.EMBEDDED_API_URL ?? (env ? `http://127.0.0.1:${env.ports.api}` : "http://localhost:8001")
const origin = process.env.EMBEDDED_PORTAL_URL ?? (env ? `http://127.0.0.1:${env.ports.portal}` : "http://localhost:5173")
for (const url of [base, origin])
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "This check is local-only.")

const DEVICES_PER_TYPE = 250
// Seconds between each device's values. The runtime reports each source's presence to the API one
// event at a time; the dev API (php artisan serve) answers one request at a time, about 43 events/s,
// so 500 devices every 10 s (the simulator's default) outrun it and every outcome lags by minutes.
const INTERVAL_S = Number(process.env.EMBEDDED_INTERVAL_S ?? 30)
const BULK = 247
const REANNOUNCE_LIMIT_S = 300
const suffix = randomUUID().slice(0, 8)
const edge = `embedded-sdk-${suffix}`
const work = join(root, ".local/embedded-sdk", edge)
const timings = {}
const created = []
let simulator = null
let simulatorLog = ""
let lastRebirthAt = 0

function passed(name) {
  console.log("PASS " + name)
}
function seconds(since) {
  return Math.round((Date.now() - since) / 100) / 10
}
async function until(name, read, predicate, limit = 120) {
  const deadline = Date.now() + limit * 1000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`${name} did not happen within ${limit} s: ${JSON.stringify(value)?.slice(0, 600)}`)
}
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} failed:\n${(result.stdout + result.stderr).slice(-4000)}`)
  return result.stdout
}

const context = await request.newContext({ baseURL: base, extraHTTPHeaders: { Accept: "application/json", Origin: origin, Referer: origin + "/" } })
async function api(method, path, data, expected) {
  const cookie = (await context.storageState()).cookies.find((c) => c.name === "XSRF-TOKEN")
  const response = await context.fetch(path, { method, data, headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {} })
  const body = await response.json().catch(() => ({}))
  if (expected) assert.equal(response.status(), expected, `${method} ${path}: ${JSON.stringify(body).slice(0, 600)}`)
  else assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(body).slice(0, 600)}`)
  return body
}

/** Runs the kit's simulator; its log is kept for the rebirth count. */
function startSimulator(binary, types) {
  const log = openSync(join(work, "simulator.log"), "a", 0o600)
  simulator = spawn(binary, [...types.flatMap((t) => ["--devices", `${t}=${DEVICES_PER_TYPE}`]), "--interval", String(INTERVAL_S), "--state-file", join(work, "state")], { stdio: ["ignore", "pipe", "pipe"] })
  for (const stream of [simulator.stdout, simulator.stderr])
    stream.on("data", (bytes) => {
      simulatorLog += bytes
      if (String(bytes).includes("event: rebirth requested")) lastRebirthAt = Date.now()
      writeFileSync(log, bytes)
    })
  const child = simulator
  child.expected = true
  child.exited = new Promise((r) => child.on("exit", r))
  return child
}
/** Fails at once, with the simulator's output, when it stops by itself. */
function checkSimulator() {
  if (simulator?.expected && simulator.exitCode !== null)
    throw new Error(`The simulator exited with status ${simulator.exitCode}:\n${simulatorLog.slice(-2000)}`)
}
async function stopSimulator() {
  if (!simulator || simulator.exitCode !== null) return
  const child = simulator
  child.expected = false
  child.kill("SIGINT")
  await Promise.race([child.exited, new Promise((r) => setTimeout(r, 10000))])
  if (child.exitCode === null) child.kill("SIGKILL")
}
const rebirths = () => (simulatorLog.match(/event: rebirth requested/g) ?? []).length
/** No rebirth for 40 s: the SDK's paced announcement (25 s) and the runtime's 30 s rebirth window are over. */
const birthsSettled = () => until("the births to settle", async () => Date.now() - lastRebirthAt, (quiet) => quiet >= 40000, 180)

try {
  for (const tool of ["cc", "cmake", "unzip"])
    assert.equal(spawnSync("sh", ["-c", `command -v ${tool}`]).status, 0, `${tool} is needed on the PATH.`)
  mkdirSync(join(work, "state"), { recursive: true, mode: 0o700 })
  await context.get("/sanctum/csrf-cookie")
  const user = (
    await api("POST", "/api/v1/auth/login", {
      email: process.env.EMBEDDED_EMAIL ?? "super-admin@example.test",
      password: process.env.EMBEDDED_PASSWORD ?? "password",
    })
  ).data
  const organization = user.organizations.find((o) => o.slug === (process.env.EMBEDDED_ORGANIZATION ?? "acme-manufacturing"))
  assert.ok(organization, "The acme-manufacturing demo organization is required.")
  const path = `/api/v1/organizations/${organization.uuid}`

  // Profiles: the gateway health profile is the node type; a water meter and a valve, which takes commands, are the device types.
  const health = (await api("POST", path + "/device-profiles/gateway-health")).data
  assert.ok(health.artifact_uuid, "The gateway-health profile has no published revision.")
  const profiles = (await api("GET", path + "/device-profiles?search=&per_page=100")).data
  const waterProfile = profiles.find((p) => p.code === "water-meter-onboarding-example" && p.revision > 0)
  assert.ok(waterProfile, "Run php artisan devices:prepare-water-meter-profile first.")
  const water = (await api("GET", `${path}/device-profiles/${waterProfile.uuid}/artifacts/${waterProfile.revision}`)).data
  let valveProfile = profiles.find((p) => p.code === "embedded-sdk-valve")
  if (!valveProfile) {
    valveProfile = (await api("POST", path + "/device-profiles", { code: "embedded-sdk-valve", name: "Valve (embedded SDK check)", category: "valves" })).data
    for (const parameter of [
      { key: "open", label: "Open", kind: "state", data_type: "boolean", unit: null, reports_state: true, accepts_command: true },
      { key: "pressure", label: "Pressure", kind: "measurement", data_type: "number", unit: "bar", reports_state: true, accepts_command: false },
    ]) {
      const current = (await api("GET", `${path}/device-profiles/${valveProfile.uuid}`)).data
      await api("POST", `${path}/device-profiles/${valveProfile.uuid}/parameters`, { ...parameter, draft_revision: current.draft_revision })
    }
  }
  if (!valveProfile.revision) {
    const current = (await api("GET", `${path}/device-profiles/${valveProfile.uuid}`)).data
    await api("POST", `${path}/device-profiles/${valveProfile.uuid}/publish`, { draft_revision: current.draft_revision })
    valveProfile = (await api("GET", `${path}/device-profiles/${valveProfile.uuid}`)).data
  }
  const valve = (await api("GET", `${path}/device-profiles/${valveProfile.uuid}/artifacts/${valveProfile.revision}`)).data

  // 1. A new gateway and its full kit.
  const connection = (await api("GET", path + "/sparkplug-connections?per_page=100")).data.find(
    (c) => c.status === "ready" && (process.env.EMBEDDED_CONNECTION_UUID ? c.uuid === process.env.EMBEDDED_CONNECTION_UUID : !/^(onboarding|adapters)-/.test(c.group_id)),
  )
  assert.ok(connection, "A ready Sparkplug connection is required; set EMBEDDED_CONNECTION_UUID to choose one.")
  const gateway = (await api("POST", path + "/gateways", { connection_uuid: connection.uuid, name: `Embedded SDK check ${suffix}`, edge_node_id: edge }, 201)).data
  await api("POST", `${path}/gateways/${gateway.uuid}/provision`)
  let started = Date.now()
  const kit = (
    await api("POST", `${path}/gateways/${gateway.uuid}/firmware-kit`, {
      target: "linux",
      node_artifact_uuid: health.artifact_uuid,
      device_type_artifact_uuids: [water.uuid, valve.uuid],
    })
  ).data
  writeFileSync(join(work, kit.filename), Buffer.from(kit.archive_base64, "base64"), { mode: 0o600 })
  run("unzip", ["-q", "-o", join(work, kit.filename), "-d", join(work, "kit")])
  const [kitRoot] = readdirSync(join(work, "kit")).map((name) => join(work, "kit", name))
  assert.ok(existsSync(join(kitRoot, "config/iotos_settings.c")), "The full kit has connection settings in config/.")
  assert.equal(kit.manifest.role, "gateway")
  assert.equal(kit.manifest.node.artifact_uuid, health.artifact_uuid)
  // --devices takes the type's code, which is the profile code; device IDs are sim-<first 14 characters>-<nnn>.
  const types = kit.manifest.device_types.map((t) => t.code)
  assert.equal(types.length, 2)
  timings.kit_download_s = seconds(started)
  passed(`gateway ${edge} registered and its full kit downloaded (SDK ${kit.manifest.sdk_version}, types ${types.join(", ")})`)

  // 2. Build the desktop simulator from the kit.
  started = Date.now()
  run("cmake", ["-S", join(kitRoot, "sdk/examples/desktop-simulator"), "-B", join(work, "build"), "-DCMAKE_BUILD_TYPE=Release"])
  run("cmake", ["--build", join(work, "build"), "--parallel"])
  const binary = join(work, "build/gateway-sim")
  assert.ok(existsSync(binary))
  timings.build_s = seconds(started)
  passed("desktop simulator built from the kit with CMake")

  // 3. 500 devices of two types are discovered with no runtime diagnostics.
  const sources = async () => {
    checkSimulator()
    const all = []
    for (let page = 1; ; page++) {
      const body = await api("GET", `${path}/discovery-candidates?gateway_uuid=${gateway.uuid}&per_page=100&page=${page}`)
      all.push(...body.data)
      if (page >= body.meta.last_page) return all
    }
  }
  const devicesOf = (list) => list.filter((c) => c.source_device_id !== "")
  const bdSeqOf = (candidate) => Number(candidate.session_id?.split(":").at(-3))
  started = Date.now()
  startSimulator(binary, types)
  let discovered = await until("500 discovered sources", sources, (list) => devicesOf(list).filter((c) => c.presence === "online").length === 2 * DEVICES_PER_TYPE && list.some((c) => c.source_device_id === ""), 300)
  timings.discovery_s = seconds(started)
  const capture = (await api("POST", path + "/telemetry-captures", { gateway_uuid: gateway.uuid, duration_seconds: 60 }, 201)).data
  await new Promise((r) => setTimeout(r, Math.min(INTERVAL_S + 5, 55) * 1000)) // at least one round of values
  const samples = (await api("GET", `${path}/telemetry-captures/${capture.id}`)).data.samples ?? []
  await api("POST", `${path}/telemetry-captures/${capture.id}`, { action: "delete" })
  assert.ok(samples.length > 0, "The telemetry capture saw the gateway's traffic.")
  const flagged = samples.filter((s) => s.diagnostic || !["decoded", "received"].includes(s.status))
  assert.deepEqual(flagged.map((s) => `${s.kind} ${s.source_device_id}: ${s.status} ${s.diagnostic ?? ""}`), [], "Runtime diagnostics")
  discovered = await sources()
  assert.ok(discovered.every((c) => c.presence === "online"), "Every source stays online.")
  const firstBd = bdSeqOf(discovered.find((c) => c.source_device_id === ""))
  passed(`${devicesOf(discovered).length} device sources and the gateway's own discovered in ${timings.discovery_s} s; ${samples.length} captured packets, no runtime diagnostics`)

  // 4. A restart with the same state file re-announces every source with the next bdSeq (SC-004).
  await stopSimulator()
  started = Date.now()
  startSimulator(binary, types)
  const nextBd = (firstBd + 1) % 256
  await until("every source re-announced with the next bdSeq", sources, (list) => list.length === 2 * DEVICES_PER_TYPE + 1 && list.every((c) => c.presence === "online" && bdSeqOf(c) === nextBd), REANNOUNCE_LIMIT_S)
  timings.reannouncement_s = seconds(started)
  passed(`after a restart all ${2 * DEVICES_PER_TYPE + 1} sources were announced again in ${timings.reannouncement_s} s with bdSeq ${firstBd} → ${nextBd}`)

  // 5. Bulk onboarding of 247 water meters, counting rebirths (R19).
  const waterIds = devicesOf(await sources()).map((c) => c.source_device_id).filter((id) => id.startsWith(`sim-${types[0].slice(0, 14)}-`)).sort().slice(0, BULK)
  assert.equal(waterIds.length, BULK)
  const rebirthsBefore = rebirths()
  started = Date.now()
  let bulk = (await api("POST", `${path}/gateways/${gateway.uuid}/bulk-onboardings`, { operation_uuid: randomUUID(), artifact_uuid: water.uuid, name_pattern: "Embedded SDK {device_id}", source_device_ids: waterIds }, 202)).data
  bulk = (await until("bulk onboarding to finish", () => api("GET", `${path}/bulk-onboardings/${bulk.uuid}`), (r) => ["succeeded", "partial_failure", "failed"].includes(r.data.status), 300)).data
  // Recorded before any wait that can fail, so the cleanup archives them.
  const items = []
  for (let cursor = null, page; ; cursor = page.next_cursor) {
    page = (await api("GET", `${path}/bulk-onboardings/${bulk.uuid}${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`)).data
    items.push(...page.items)
    if (!page.next_cursor) break
  }
  created.push(...items.map((i) => i.device_uuid).filter(Boolean))
  assert.equal(bulk.status, "succeeded")
  // Each activation requests a rebirth, and the SDK paces its births (20/s), so the runtime refuses an
  // activation it checks before that device's next birth. Refused devices are activated again, and
  // the count per round goes into the evidence until the runtime waits for the birth. Each round runs
  // between rebirths: once the births settle, its first activation starts a rebirth; the water meters,
  // the first type, are announced again within 250 / 20 s of it, and the rest go in before the
  // runtime's 30 s window lets another rebirth through. Those that miss the window go to the next round.
  const states = async (uuids) => {
    const wanted = new Set(uuids)
    const list = []
    for (let page = 1; ; page++) {
      const body = await api("GET", `${path}/devices?search=${edge}-sim-&per_page=100&page=${page}`)
      list.push(...body.data.filter((d) => wanted.has(d.uuid)))
      if (page >= body.meta.last_page) return list
    }
  }
  const settle = (uuids) => until("every activation to be applied or refused", () => states(uuids), (list) => list.length === uuids.length && list.every((d) => d.deployment_status !== "pending"), 600)
  const reactivate = (device) => api("POST", `${path}/devices/${device.uuid}/activate`, { draft_revision: device.draft_revision }, 202)
  let refused = (await settle(created)).filter((d) => d.deployment_status === "failed")
  const refusals = [refused.length]
  // The bulk run's own rebirths (R19) are counted once they settle, before any retry adds one.
  await birthsSettled()
  const bulkRebirths = rebirths() - rebirthsBefore
  for (let round = 0; refused.length && round < 5; round++) {
    if (round) await birthsSettled()
    const quietSince = Date.now()
    await reactivate(refused[0])
    const rebirthAt = await until("the rebirth that activation requests", async () => lastRebirthAt, (at) => at >= quietSince, 30)
    await new Promise((r) => setTimeout(r, Math.max(0, rebirthAt + (DEVICES_PER_TYPE / 20 + 3) * 1000 - Date.now())))
    for (let i = 1; i < refused.length; i += 10) await Promise.all(refused.slice(i, i + 10).map(reactivate))
    refused = (await settle(refused.map((d) => d.uuid))).filter((d) => d.deployment_status === "failed")
    refusals.push(refused.length)
  }
  assert.deepEqual(refused.map((d) => `${d.name}: ${d.diagnostic}`), [], `Still refused after ${refusals.length - 1} rounds (${refusals.join(" → ")})`)
  bulk = (await until(`all ${BULK} bulk-onboarded devices to be active`, () => api("GET", `${path}/bulk-onboardings/${bulk.uuid}`), (r) => r.data.counts.active === BULK, 300)).data
  timings.bulk_active_s = seconds(started)
  const sampled = created.slice(0, 3)
  for (const device of sampled)
    await until("stored readings for a bulk-onboarded device", () => api("GET", `${path}/devices/${device}/measurements/latest`), (r) => r.data.length === 2 && r.data.every((m) => m.value !== null), 120)
  passed(`${BULK} water meters bulk-onboarded and active in ${timings.bulk_active_s} s with ${bulkRebirths} rebirths; activations refused before their birth, per round: ${refusals.join(" → ")}`)

  // 6. The gateway's own source, onboarded with the health profile.
  started = Date.now()
  const setup = (
    await api("POST", path + "/device-onboardings", { request_uuid: randomUUID(), name: `Embedded SDK ${suffix} gateway health`, artifact_uuid: health.artifact_uuid, mode: "gateway", gateway_uuid: gateway.uuid, source: "node" }, 201)
  ).data
  created.push(setup.device.uuid)
  assert.equal(setup.source_device_id, "")
  const node = (await sources()).find((c) => c.source_device_id === "")
  const activate = async (device, artifact, candidate) => {
    const current = (await api("GET", `${path}/devices/${device}`)).data
    const mappings = artifact.definition.parameters.filter((p) => p.reports_state && p.kind !== "derived")
      .map((p) => ({ parameter_uuid: p.uuid, metric: p.key, ...(p.accepts_command ? { command_metric: p.key } : {}) }))
    const saved = (await api("PUT", `${path}/devices/${device}/configuration`, { draft_revision: current.draft_revision, artifact_uuid: artifact.uuid, candidate_uuid: candidate.uuid, birth_revision: candidate.birth_revision, mappings })).data
    await api("POST", `${path}/devices/${device}/validate`, { draft_revision: saved.draft_revision })
    await birthsSettled() // otherwise the source can be refused as in step 5
    await api("POST", `${path}/devices/${device}/activate`, { draft_revision: saved.draft_revision }, 202)
    return (await until("the device to be applied", () => api("GET", `${path}/devices/${device}`), (r) => r.data.deployment_status === "applied" && r.data.lifecycle === "active", 120)).data
  }
  const healthArtifact = (await api("GET", `${path}/device-profiles/${health.profile_uuid}/artifacts/${kit.manifest.node.revision}`)).data
  await activate(setup.device.uuid, healthArtifact, node)
  const healthReadings = (await until("gateway health readings", () => api("GET", `${path}/devices/${setup.device.uuid}/measurements/latest`), (r) => ["uptime", "connection_type", "sdk_version", "devices_configured"].every((key) => r.data.some((m) => m.key === key && m.value !== null)), 180)).data
  assert.equal(healthReadings.find((m) => m.key === "sdk_version").value, kit.manifest.sdk_version)
  assert.equal(healthReadings.find((m) => m.key === "devices_configured").value, 2 * DEVICES_PER_TYPE)
  timings.node_onboarding_s = seconds(started)
  passed(`the gateway's own source onboarded with the gateway health profile in ${timings.node_onboarding_s} s (SDK ${kit.manifest.sdk_version}, ${2 * DEVICES_PER_TYPE} devices configured)`)

  // 7. One command to a valve is observed.
  started = Date.now()
  const valveSource = devicesOf(await sources()).find((c) => c.source_device_id === `sim-${types[1].slice(0, 14)}-000`)
  const valveDevice = (await api("POST", path + "/devices", { name: `Embedded SDK ${suffix} valve`, code: `${edge}-valve` }, 201)).data
  created.push(valveDevice.uuid)
  const applied = await activate(valveDevice.uuid, valve, valveSource)
  // The activation's own rebirth resets every device's birth, and a command before the valve is
  // announced again gets 422 ("needs a current compatible birth certificate").
  await birthsSettled()
  const open = valve.definition.parameters.find((p) => p.accepts_command)
  const command = (await api("POST", `${path}/devices/${valveDevice.uuid}/commands/send`, { configuration_uuid: applied.applied_configuration_uuid, parameter_uuid: open.uuid, value: true, idempotency_key: randomUUID() })).data
  await until("the command to be observed", () => api("GET", `${path}/devices/${valveDevice.uuid}/commands`), (r) => r.data.some((c) => c.uuid === command.uuid && c.status === "observed"), 120)
  assert.match(simulatorLog, new RegExp(`command: ${valveSource.source_device_id} ${open.key} applied`))
  timings.command_s = seconds(started)
  passed(`a command to ${valveSource.source_device_id} was applied by the simulator and observed in ${timings.command_s} s`)

  // 8. Stopping the simulator takes the gateway and its devices offline.
  started = Date.now()
  await stopSimulator()
  await until("the gateway to go offline", () => api("GET", `${path}/gateways?search=${edge}`), (r) => r.data.find((g) => g.uuid === gateway.uuid)?.presence === "offline", 120)
  await until("its sources to go offline", sources, (list) => list.every((c) => c.presence === "offline"), 120)
  for (const device of [setup.device.uuid, valveDevice.uuid, created[0]])
    await until("a device to go offline", () => api("GET", `${path}/devices/${device}/measurements/latest`), (r) => r.presence === "offline", 120)
  timings.offline_s = seconds(started)
  passed(`stopping the simulator took the gateway and its devices offline in ${timings.offline_s} s`)

  const evidence = { gateway: { uuid: gateway.uuid, edge_node_id: edge }, sdk_version: kit.manifest.sdk_version, devices: 2 * DEVICES_PER_TYPE, bulk: BULK, rebirths: bulkRebirths, refused_activations: refusals, timings, verified_at: new Date().toISOString() }
  writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 })
  console.log(`Timings (s): ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(", ")}`)
  console.log(`Rebirths during the ${BULK}-device bulk onboarding: ${bulkRebirths}; activations refused before their birth: ${refusals.join(" → ")}`)
  console.log(`Evidence: ${join(work, "evidence.json")}`)
} catch (error) {
  console.error(error.stack ?? error.message)
  console.error(`Files and the simulator log are in ${work}`)
  process.exitCode = 1
} finally {
  await stopSimulator()
  if (!keep && created.length) {
    // Deactivate, wait for the runtime's acknowledgement, then archive, so the sources are free again.
    const path = `/api/v1/organizations/${(await api("GET", "/api/v1/me")).data.organizations.find((o) => o.slug === (process.env.EMBEDDED_ORGANIZATION ?? "acme-manufacturing")).uuid}`
    const cleanup = async (device) => {
      let current = (await api("GET", `${path}/devices/${device}`)).data
      if (current.applied_configuration_uuid || current.desired_configuration_uuid)
        await api("POST", `${path}/devices/${device}/deactivate`, { draft_revision: current.draft_revision })
      current = (await until("deactivation", () => api("GET", `${path}/devices/${device}`), (r) => !r.data.applied_configuration_uuid && !r.data.desired_configuration_uuid && r.data.deployment_status !== "pending", 180)).data
      await api("POST", `${path}/devices/${device}/archive`, { draft_revision: current.draft_revision })
    }
    try {
      for (let i = 0; i < created.length; i += 10) await Promise.all(created.slice(i, i + 10).map(cleanup))
      console.log(`Archived the ${created.length} devices this run created.`)
    } catch (error) {
      console.error(`Cleanup stopped: ${error.message}`)
      process.exitCode = 1
    }
  }
  await context.dispose()
}
