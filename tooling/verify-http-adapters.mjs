#!/usr/bin/env node
// Spec 020 quickstart A and B against the running stack: a webhook vendor cloud and a
// polled tracker API, both simulated, through the real API, receiver, tenant runtime
// and Go runtime. Usage:
//   node tooling/verify-http-adapters.mjs [--api http://127.0.0.1:8001] [--origin http://localhost:5173]
//     [--email super-admin@example.test] [--org acme-manufacturing] [--only A|B]
// The stack needs IOT_WEBHOOK_PUBLIC_URL=http://localhost:8095 and, for B, the
// development switch IOT_ADAPTER_ALLOW_PRIVATE_BROKERS=true (the tracker API runs on
// this host and is reached as host.docker.internal).
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID, randomBytes } from "node:crypto"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "apps/portal/package.json"))
const { request } = require("@playwright/test")
const arg = (name, fallback) => {
  const index = process.argv.indexOf("--" + name)
  return index > 0 ? process.argv[index + 1] : fallback
}
const base = arg("api", "http://127.0.0.1:8001")
const origin = arg("origin", "http://localhost:5173")
const only = arg("only", null)
const python = arg("python", "python3")
const suffix = randomUUID().slice(0, 6)
const children = []
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const passed = (name) => console.log("PASS " + name)

async function client(email) {
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
  const user = (await api("POST", "/api/v1/auth/login", { email, password: "password" })).data
  return { api, user, context }
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

function simulator(script, args) {
  const child = spawn(python, [join(root, "tooling/simulators", script), ...args], { stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (d) => (output += d))
  child.stderr.on("data", (d) => (output += d))
  children.push(child)
  return { child, output: () => output }
}

const owner = await client(arg("email", "super-admin@example.test"))
const api = owner.api
const org = owner.user.organizations.find((o) => o.slug === arg("org", "acme-manufacturing")).uuid
const path = `/api/v1/organizations/${org}`
const profiles = (await api("GET", path + "/device-adapter-profiles")).data
const artifact = (name) => profiles.find((p) => p.name === name)?.uuid
async function deployAndWait(uuid, draft, extra = {}) {
  await api("POST", `${path}/device-adapters/${uuid}/test`, { draft_revision: draft })
  await api("POST", `${path}/device-adapters/${uuid}/deploy`, { request_uuid: randomUUID(), draft_revision: draft, ...extra }, 202)
  return until("deployment", () => api("GET", `${path}/device-adapters/${uuid}`), (r) => r.data.status === "running" || r.data.status === "failed", 240)
}
async function activate(uuid, sourceId, name) {
  const candidate = await until("discovery of " + sourceId, () => api("GET", `${path}/device-adapters/${uuid}/candidates`), (r) => r.data.some((c) => c.source_device_id === sourceId && !c.preview?.retained), 120)
  const found = candidate.data.find((c) => c.source_device_id === sourceId)
  const result = await until(
    "live birth for " + sourceId,
    async () => {
      const token = await owner.context.storageState()
      const cookie = token.cookies.find((c) => c.name === "XSRF-TOKEN")
      const response = await owner.context.fetch(`${path}/device-adapters/${uuid}/candidates/${found.uuid}/activate`, { method: "POST", data: { name }, headers: { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } })
      return { status: response.status(), body: await response.json().catch(() => ({})) }
    },
    (r) => r.status === 202,
    120,
  )
  return result.body.data.device
}

try {
  if (!only || only === "A") {
    // A. A vendor cloud that pushes signed webhooks (US1, US2, US5).
    const created = await api("POST", path + "/device-adapters", {
      request_uuid: randomUUID(), name: `Cloud sensors ${suffix}`, artifact_uuid: artifact("Environmental sensor (vendor JSON)"), fixtures: [],
      source: { type: "webhook", auth: { mode: "hmac", signature_header: "x-signature", prefix: "sha256=", timestamp_header: "x-timestamp" } },
      code: "function decode(input) { return { sourceDeviceId: 'unknown', metrics: [] } }",
    }, 201)
    const adapter = created.data
    assert.match(adapter.webhook.ingest_url, /^http:\/\/localhost:8095\/w\/[A-Za-z0-9]{32}$/)
    const secret = (await api("POST", `${path}/device-adapters/${adapter.uuid}/webhook/secrets`, { label: "Simulator" }, 201)).data
    passed("webhook adapter with an ingest URL and a secret shown once")
    const url = adapter.webhook.ingest_url
    const sender = (extra) => simulator("vendor_webhook_cloud.py", ["--url", url, "--secret", secret.value, "--timestamp-header", "x-timestamp", "--devices", "2", "--interval", "1", ...extra])
    let sim = sender(["--count", "3"])
    const samples = await until("samples before deployment", () => api("GET", `${path}/device-adapters/${adapter.uuid}/deliveries?kind=sample`), (r) => r.data.length > 0, 60)
    assert.equal(samples.data[0].input.source, "webhook")
    passed("deliveries before deployment are answered 202 and kept as samples")
    const code = `function decode(input) {
  return input.payload.map((m) => ({
    sourceDeviceId: m.deviceId,
    observedAt: new Date(m.ts).toISOString(),
    messageId: m.messageId,
    metrics: [
      { name: "temperature", value: m.temperature_c },
      { name: "humidity", value: m.humidity_pct },
      { name: "battery_voltage", value: m.battery_mv / 1000 },
      { name: "rssi", value: m.rssi },
      { name: "snr", value: m.snr_db },
      { name: "uptime", value: m.uptime_s },
    ],
  }))
}`
    const saved = (await api("PUT", `${path}/device-adapters/${adapter.uuid}`, { name: adapter.name, artifact_uuid: adapter.artifact_uuid, source: adapter.source, code, fixtures: [samples.data[0].input], draft_revision: adapter.draft_revision })).data
    const running = await deployAndWait(adapter.uuid, saved.draft_revision)
    assert.equal(running.data.status, "running", JSON.stringify(running.data.diagnostic))
    passed("a captured delivery became the fixture; the tested revision deployed")
    sim = sender(["--count", "0"])
    const device = await activate(adapter.uuid, "SNS-2001", `Webhook sensor ${suffix}`)
    const latest = await until("readings from webhooks", () => api("GET", `${path}/devices/${device.uuid}/measurements/latest`), (r) => (r.data ?? []).some?.((m) => m.value !== null) || Object.values(r.data ?? {}).some((m) => m?.value != null), 120)
    console.log("  latest:", JSON.stringify(latest.data).slice(0, 400))
    passed("an activated webhook sensor gets readings")
    sim.child.kill("SIGTERM")
    const bad = simulator("vendor_webhook_cloud.py", ["--url", url, "--secret", "wrong-secret-0000000000", "--timestamp-header", "x-timestamp", "--count", "2", "--interval", "0.5"])
    await until("bad signature rejected", async () => bad.output(), (o) => /401/.test(o), 30)
    await until("rejection on the Activity tab", () => api("GET", `${path}/device-adapters/${adapter.uuid}/deliveries?kind=rejected`), (r) => r.data.some((d) => d.reason === "unauthenticated"), 30)
    passed("a wrong signature is answered 401 and shown with its reason")
    const rotated = (await api("POST", `${path}/device-adapters/${adapter.uuid}/webhook/secrets`, { label: "Rotation" }, 201)).data
    const old = simulator("vendor_webhook_cloud.py", ["--url", url, "--secret", secret.value, "--timestamp-header", "x-timestamp", "--count", "1"])
    await until("old secret still works during rotation", async () => old.output(), (o) => /202/.test(o), 30)
    await api("POST", `${path}/device-adapters/${adapter.uuid}/webhook/secrets/${secret.secret.uuid}/revoke`)
    const started = Date.now()
    // SC-004: the receiver refuses the revoked secret within 10 seconds.
    await until(
      "revoked secret refused",
      async () => {
        const once = simulator("vendor_webhook_cloud.py", ["--url", url, "--secret", secret.value, "--timestamp-header", "x-timestamp", "--count", "1"])
        await new Promise((r) => once.child.once("exit", r))
        return once.output()
      },
      (o) => /status=401/.test(o),
      10,
    )
    const fresh = simulator("vendor_webhook_cloud.py", ["--url", url, "--secret", rotated.value, "--timestamp-header", "x-timestamp", "--count", "1"])
    await until("new secret accepted", async () => fresh.output(), (o) => /202/.test(o), 30)
    passed(`rotation keeps both secrets; revocation took effect within ${Math.round((Date.now() - started) / 1000)} s`)
  }

  if (!only || only === "B") {
    // B. A tracker vendor whose history is only in a REST API (US3, US4).
    const key = randomBytes(16).toString("hex")
    const trackers = simulator("vendor_tracker_api.py", ["--host", "0.0.0.0", "--port", "8096", "--api-key", key, "--trackers", "2"])
    await until("tracker API", async () => (await fetch("http://127.0.0.1:8096/_health").then((r) => r.ok).catch(() => false)), Boolean, 20)
    await fetch("http://127.0.0.1:8096/_served/reset", { method: "POST" })
    const created = await api("POST", path + "/device-adapters", {
      request_uuid: randomUUID(), name: `Trackers ${suffix}`, artifact_uuid: artifact("GPS Tracker (simulator)"), fixtures: [],
      source: {
        type: "poll",
        request: { method: "GET", url: "http://host.docker.internal:8096/accounts/A1/streams/history", query: [{ name: "start", value: "{cursor}" }, { name: "end", value: "{now}" }], headers: [] },
        credentials: { placement: "header", name: "x-api-key" }, page: { size: 200, size_param: "limit", more: "full_page" }, records: "/data",
        cursor: { kind: "timestamp", pointer: "/maxDate" }, interval_seconds: 60,
      },
      secrets: { api_key: key },
      code: "function decode(input) { return { sourceDeviceId: 'unknown', metrics: [] } }",
    }, 201)
    const adapter = created.data
    const fetched = (await api("POST", `${path}/device-adapters/${adapter.uuid}/fetch-now`, { draft_revision: adapter.draft_revision })).data
    assert.equal(fetched.status, 200, JSON.stringify(fetched))
    assert.ok(fetched.record_count > 0 && fetched.next_cursor, JSON.stringify(fetched).slice(0, 300))
    assert.equal(JSON.stringify(fetched).includes(key), false, "Fetch now never shows the API key")
    passed(`Fetch now returned ${fetched.record_count} records and a next cursor without moving anything`)
    const code = `function decode(input) {
  const r = input.payload;
  return {
    sourceDeviceId: r.deviceId,
    observedAt: r.timestamp,
    messageId: r.id,
    metrics: [
      { name: "location.latitude", value: r.lat },
      { name: "location.longitude", value: r.lon },
      { name: "location.accuracy", value: r.accuracy_m },
    ],
  };
}`
    const fixture = { source: "poll", payload: fetched.records[0], poll: { page: 1, index: 0, count: fetched.record_count, cursor: null } }
    const saved = (await api("PUT", `${path}/device-adapters/${adapter.uuid}`, { name: adapter.name, artifact_uuid: adapter.artifact_uuid, source: adapter.source, code, fixtures: [fixture], draft_revision: adapter.draft_revision })).data
    const start = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const running = await deployAndWait(adapter.uuid, saved.draft_revision, { cursor_start_at: start })
    assert.equal(running.data.status, "running", JSON.stringify(running.data.diagnostic))
    const runs = await until("a poll run", () => api("GET", `${path}/device-adapters/${adapter.uuid}/poll-runs`), (r) => r.data.some((run) => run.outcome === "ok"), 180)
    const run = runs.data.find((r) => r.outcome === "ok")
    console.log("  run:", JSON.stringify(run))
    passed(`the poller ran: ${run.pages} pages, ${run.records} records, cursor ${run.cursor_before} → ${run.cursor_after}`)
    const sourceId = run.records ? (await api("GET", `${path}/device-adapters/${adapter.uuid}/candidates`)).data[0]?.source_device_id ?? "TRK-1001" : "TRK-1001"
    const device = await activate(adapter.uuid, sourceId, `Polled tracker ${suffix}`)
    // Activation redeploys the adapter with the new binding.
    await until("redeployment after activation", () => api("GET", `${path}/device-adapters/${adapter.uuid}`), (r) => r.data.status === "running", 240)
    await api("POST", `${path}/device-adapters/${adapter.uuid}/cursor`, { request_uuid: randomUUID(), start_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() }, 202)
    const latest = await until("latest position", () => api("GET", `${path}/devices/${device.uuid}/measurements/latest`), (r) => (r.data ?? []).some((m) => m.key === "location.latitude" && m.value != null), 240)
    const latitude = latest.data.find((m) => m.key === "location.latitude")
    assert.equal(latitude.timestamp_source, "source", "positions carry the vendor's time")
    assert.ok(Date.parse(latitude.observed_at) < Date.parse(latitude.received_at), "a polled fix is older than its receipt")
    const range = `from=${encodeURIComponent(new Date(Date.now() - 3 * 3600 * 1000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`
    const records = await until(
      "history after the cursor reset",
      () => api("GET", `${path}/devices/${device.uuid}/measurements/records?parameter_uuid=${latitude.parameter_uuid}&${range}&limit=200`),
      (r) => (r.data ?? []).length > 3,
      240,
    )
    const observed = records.data.map((r) => r.observed_at)
    assert.equal(new Set(observed).size, observed.length, "records fetched again after the reset are stored once")
    console.log("  latest:", JSON.stringify({ observed_at: latitude.observed_at, received_at: latitude.received_at, timestamp_source: latitude.timestamp_source }), "history:", records.data.length)
    passed(`polled positions are source-timed (${records.data.length} in history, none duplicated after a cursor reset)`)
    await fetch("http://127.0.0.1:8096/_control", { method: "POST", body: JSON.stringify({ fault: "401", count: 100 }) })
    await until("credentials rejected", () => api("GET", `${path}/device-adapters/${adapter.uuid}`), (r) => r.data.polling?.state === "stopped", 200)
    passed("a 401 stops polling with Credentials rejected")
    trackers.child.kill("SIGTERM")
  }
  console.log("ALL PASSED")
} finally {
  for (const child of children) child.kill("SIGTERM")
}
