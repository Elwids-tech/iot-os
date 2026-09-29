#!/usr/bin/env node
// Run against the disposable Devices harness only, after verify-devices.mjs.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve, join } from "node:path"
const require = createRequire(resolve("apps/portal/package.json"))
const { request } = require("@playwright/test")
const env = JSON.parse(readFileSync(process.argv[2], "utf8"))
assert.equal(env.ports.api, 8016, "Refusing a non-test API")
const resources = JSON.parse(
  readFileSync(join(env.directory, "verified-resources.json"), "utf8"),
)
const context = await request.newContext({
  baseURL: "http://127.0.0.1:8016",
  extraHTTPHeaders: {
    Accept: "application/json",
    Origin: "http://127.0.0.1:4176",
    Referer: "http://127.0.0.1:4176/",
  },
})
await context.get("/sanctum/csrf-cookie")
async function api(method, path, data, status = 200) {
  const cookie = (await context.storageState()).cookies.find(
    (c) => c.name === "XSRF-TOKEN",
  )
  const response = await context.fetch(path, {
    method,
    data,
    headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {},
  })
  const body = await response.json()
  assert.equal(
    response.status(),
    status,
    `${method} ${path}: ${JSON.stringify(body)}`,
  )
  return body
}
async function until(label, fn, check, seconds = 30) {
  const end = Date.now() + seconds * 1000
  let value
  while (Date.now() < end) {
    value = await fn()
    if (check(value)) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(label + " timed out")
}
let capture
const base = `/api/v1/organizations/${resources.org}`,
  path = base + "/telemetry-captures"
try {
  await api("POST", "/api/v1/auth/login", {
    email: "super-admin@example.test",
    password: "password",
  })
  let meter = (
    await api("GET", base + "/devices/" + resources.meter.device.uuid)
  ).data
  const config = meter.configurations.find(
    (c) => c.uuid === meter.applied_configuration_uuid,
  )
  const mapping = config.definition.mappings.find((m) =>
    m.metric.toLowerCase().includes("voltage"),
  )
  assert.ok(mapping, "numeric voltage mapping required")
  const profile = JSON.parse(config.definition.profile_canonical_json)
  const parameter = profile.parameters.find(
    (p) => p.uuid === mapping.parameter_uuid,
  )
  const mappings = config.definition.mappings.map((m) => ({
    ...m,
    ...(m.parameter_uuid === mapping.parameter_uuid
      ? {
          conversion_mode: "custom",
          ingress_conversion: {
            source_unit: parameter.unit,
            multiplier: 1,
            offset: 0.8,
          },
        }
      : {}),
  }))
  meter = (
    await api("PUT", base + `/devices/${meter.uuid}/configuration`, {
      draft_revision: meter.draft_revision,
      artifact_uuid:
        config.profile_artifact_uuid ?? config.definition.profile_artifact_uuid,
      candidate_uuid: meter.candidate.uuid,
      birth_revision: meter.candidate.birth_revision,
      mappings,
    })
  ).data
  await api(
    "POST",
    base + `/devices/${meter.uuid}/activate`,
    { draft_revision: meter.draft_revision },
    202,
  )
  meter = (
    await until(
      "configuration apply",
      () => api("GET", base + `/devices/${meter.uuid}`),
      (r) => r.data.deployment_status === "applied",
    )
  ).data
  capture = (
    await api(
      "POST",
      path,
      {
        gateway_uuid: meter.candidate.gateway.uuid,
        device_uuid: meter.uuid,
        duration_seconds: 60,
      },
      201,
    )
  ).data
  let result = await until(
    "stored capture",
    () => api("GET", path + "/" + capture.id),
    (r) =>
      r.data.samples.some((s) =>
        s.outcomes?.some((o) => o.status === "stored"),
      ),
  )
  const sample = result.data.samples.find((s) =>
    s.outcomes?.some((o) => o.status === "stored"),
  )
  const outcome = sample.outcomes.find((o) => o.status === "stored")
  const trace = outcome.stages.find(
    (t) => t.parameter_uuid === mapping.parameter_uuid,
  )
  assert.ok(Math.abs(trace.converted - trace.raw - 0.8) < 1e-9)
  assert.ok(sample.wire_base64.length > 0)
  assert.ok(sample.birth_session)
  assert.ok(sample.seq >= 0 && sample.seq <= 255)
  assert.equal(
    outcome.readings.find((r) => r.parameter_uuid === mapping.parameter_uuid)
      .value,
    trace.converted,
  )
  console.log(
    "PASS received binary, alias resolution, actual +0.8 conversion, calculations and confirmed storage",
  )
  await api(
    "GET",
    `/api/v1/organizations/${resources.northstar}/telemetry-captures/${capture.id}`,
    undefined,
    422,
  )
  console.log("PASS cross-tenant capture denied")
  await api("POST", path + "/" + capture.id, {
    action: "suspend",
    confirm: true,
  })
  result = await until(
    "suspended evidence",
    () => api("GET", path + "/" + capture.id),
    (r) =>
      r.data.samples.some((s) =>
        s.outcomes?.some((o) => o.status === "suspended"),
      ),
  )
  const latestPath = base + `/devices/${meter.uuid}/measurements/latest`
  const before = (await api("GET", latestPath)).data
  await new Promise((r) => setTimeout(r, 3000))
  const after = (await api("GET", latestPath)).data
  assert.deepEqual(
    after.map((r) => r.received_at),
    before.map((r) => r.received_at),
  )
  console.log(
    "PASS suspended samples still captured without updating production latest",
  )
  await api("POST", path + "/" + capture.id, { action: "resume" })
  const resumeAt = Date.now()
  await until(
    "resumed storage",
    () => api("GET", path + "/" + capture.id),
    (r) =>
      r.data.samples.some(
        (s) =>
          Date.parse(s.received_at) > resumeAt &&
          s.outcomes?.some((o) => o.status === "stored"),
      ),
  )
  console.log("PASS explicit resume restores persistence")
  await api("POST", path + "/" + capture.id, {
    action: "suspend",
    confirm: true,
  })
  await until(
    "automatic expiry",
    () => api("GET", path + "/" + capture.id),
    (r) => r.data.stopped && !r.data.suspended,
    70,
  )
  await until(
    "automatic production resume",
    () => api("GET", latestPath),
    (r) =>
      r.data.some(
        (s) => Date.parse(s.received_at) > Date.parse(capture.expires_at),
      ),
  )
  console.log(
    "PASS expiry automatically resumes ingestion without a browser action",
  )
} finally {
  if (capture)
    await api("POST", path + "/" + capture.id, { action: "stop" }).catch(
      () => {},
    )
  await context.dispose()
}
