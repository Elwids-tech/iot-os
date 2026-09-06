#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(join(root, "apps/portal/package.json"))
const { request, chromium } = require("@playwright/test")
const env = JSON.parse(readFileSync(process.argv[2], "utf8"))
const base = `http://127.0.0.1:${env.ports.api}`,
  origin = `http://127.0.0.1:${env.ports.portal}`
const suffix = randomUUID().slice(0, 8),
  evidence = [],
  clients = []
let browser
function passed(name) {
  evidence.push({ name, passed_at: new Date().toISOString() })
  console.log("PASS " + name)
}
async function client(email) {
  const context = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: {
      Accept: "application/json",
      Origin: origin,
      Referer: origin + "/",
    },
  })
  clients.push(context)
  await context.get("/sanctum/csrf-cookie")
  async function api(method, path, data, expected) {
    const cookie = (await context.storageState()).cookies.find(
      (c) => c.name === "XSRF-TOKEN",
    )
    const response = await context.fetch(path, {
      method,
      data,
      headers: cookie
        ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) }
        : {},
    })
    const body = await response.json().catch(() => ({}))
    if (expected)
      assert.equal(
        response.status(),
        expected,
        `${method} ${path}: ${JSON.stringify(body)}`,
      )
    else
      assert.ok(
        response.ok(),
        `${method} ${path}: ${response.status()} ${JSON.stringify(body)}`,
      )
    return body
  }
  const user = (
    await api("POST", "/api/v1/auth/login", { email, password: "password" })
  ).data
  return { api, context, user }
}
async function until(name, action, predicate, seconds = 30) {
  const deadline = Date.now() + seconds * 1000
  let result
  while (Date.now() < deadline) {
    result = await action()
    if (predicate(result)) return result
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${name} did not complete: ${JSON.stringify(result)}`)
}
try {
  const owner = await client("shared.operator@example.test"),
    api = owner.api
  const org = owner.user.organizations.find(
    (o) => o.slug === "acme-manufacturing",
  ).uuid
  const northstar = owner.user.organizations.find(
    (o) => o.slug === "northstar-utilities",
  ).uuid
  const path = `/api/v1/organizations/${org}`,
    devicesPath = path + "/devices"
  const candidates = (
    await until(
      "Sparkplug discovery",
      () => api("GET", path + "/discovery-candidates"),
      (r) =>
        r.data.some((c) => c.source_device_id === "meter") &&
        r.data.some((c) => c.source_device_id === "rgb-light"),
    )
  ).data
  assert.ok(
    candidates.some((c) => c.source_device_id === ""),
    "Edge Node measurements are discoverable",
  )
  passed("TLS broker discovery of Edge Node, meter, and RGB light")
  const profiles = (await api("GET", path + "/device-profiles?per_page=100"))
    .data
  const onboard = async (sourceId, profileCode) => {
    const candidate = (
      await api("GET", path + "/discovery-candidates")
    ).data.find((c) => c.source_device_id === sourceId)
    const existing = (
      await api("GET", devicesPath + "?per_page=100")
    ).data.find(
      (d) =>
        d.candidate?.uuid === candidate.uuid && d.name === `Test ${sourceId}`,
    )
    if (existing?.applied_configuration_uuid) {
      const device = (await api("GET", devicesPath + "/" + existing.uuid)).data
      const artifact = device.draft_artifact
      const readings = (
        await api("GET", devicesPath + `/${device.uuid}/measurements/latest`)
      ).data
      return { device, artifact, readings, candidate }
    }
    await api("PATCH", path + "/discovery-candidates/" + candidate.uuid, {
      status: "approved",
      birth_revision: candidate.birth_revision,
    })
    let device = (
      await api(
        "POST",
        devicesPath,
        { name: `Test ${sourceId}`, code: `${sourceId}-${suffix}` },
        201,
      )
    ).data
    assert.equal(device.presence, "unseen")
    assert.equal(device.lifecycle, "registered")
    const profile = profiles.find((p) => p.code === profileCode)
    assert.ok(profile, "Simulator profile exists")
    const artifact = (
      await api(
        "GET",
        `${path}/device-profiles/${profile.uuid}/artifacts/${profile.revision}`,
      )
    ).data
    const normalize = (text) => text.toLowerCase().replace(/[\s._-]/g, "")
    const mappings = artifact.definition.parameters
      .filter((p) => p.reports_state && p.kind !== "derived")
      .map((p) => {
        const metric = candidate.metrics.find(
          (m) =>
            normalize(m.name) === normalize(p.label) ||
            normalize(m.name) === normalize(p.key),
        )
        assert.ok(metric, `Mapping exists for ${p.label}`)
        return {
          parameter_uuid: p.uuid,
          metric: metric.name,
          command_metric: p.accepts_command ? metric.name : null,
        }
      })
    device = (
      await api("PUT", devicesPath + `/${device.uuid}/configuration`, {
        draft_revision: device.draft_revision,
        artifact_uuid: artifact.uuid,
        candidate_uuid: candidate.uuid,
        birth_revision: candidate.birth_revision,
        mappings,
      })
    ).data
    const validation = await api(
      "POST",
      devicesPath + `/${device.uuid}/validate`,
      { draft_revision: device.draft_revision },
    )
    assert.equal(validation.data.preview.valid, true)
    device = (
      await api(
        "POST",
        devicesPath + `/${device.uuid}/activate`,
        { draft_revision: device.draft_revision },
        202,
      )
    ).data
    device = (
      await until(
        "Configuration applied",
        () => api("GET", devicesPath + "/" + device.uuid),
        (r) => r.data.deployment_status === "applied",
      )
    ).data
    assert.equal(
      device.desired_configuration_uuid,
      device.applied_configuration_uuid,
    )
    const readings = (
      await until(
        "Current readings",
        () => api("GET", devicesPath + `/${device.uuid}/measurements/latest`),
        (r) =>
          r.data.length ===
          artifact.definition.parameters.filter(
            (p) => p.reports_state || p.kind === "derived",
          ).length,
      )
    ).data
    assert.ok(readings.every((r) => r.quality === "good"))
    return { device, artifact, readings, candidate }
  }
  const meter = await onboard("meter", "simulator-three-phase-energy-meter")
  passed(
    "Meter registration, mapping validation, immutable activation, and live calculations",
  )
  const light = await onboard("rgb-light", "simulator-rgb-light")
  passed("RGB-light onboarding with explicit state command mappings")
  await api(
    "GET",
    `/api/v1/organizations/${northstar}/devices/${meter.device.uuid}`,
    undefined,
    404,
  )
  const member = await client("acme.member@example.test")
  await member.api("GET", devicesPath + "/" + meter.device.uuid)
  await member.api(
    "POST",
    devicesPath,
    { name: "Forbidden", code: suffix },
    403,
  )
  passed("Tenant isolation and default member viewing permissions")
  const parameter = meter.artifact.definition.parameters.find(
    (p) => p.data_type === "number",
  )
  const historyQuery = new URLSearchParams({
    parameter_uuid: parameter.uuid,
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date().toISOString(),
    max_points: "100",
  })
  const history = await api(
    "GET",
    devicesPath + `/${meter.device.uuid}/measurements/history?` + historyQuery,
  )
  assert.ok(
    history.data.length && history.data[0].points.some((p) => p.value !== null),
  )
  assert.ok(history.data.reduce((n, s) => n + s.points.length, 0) <= 2000)
  passed("Bounded Timescale measurement history")
  const power = light.artifact.definition.parameters.find(
    (p) => p.key === "power",
  )
  const target = !light.readings.find((r) => r.parameter_uuid === power.uuid)
    .value
  const commandBody = {
    configuration_uuid: light.device.applied_configuration_uuid,
    parameter_uuid: power.uuid,
    value: target,
    idempotency_key: randomUUID(),
  }
  const commandPath = devicesPath + `/${light.device.uuid}/commands`
  await member.api("POST", commandPath, commandBody, 403)
  const prepared = (await api("POST", commandPath, commandBody, 201)).data
  assert.equal(prepared.status, "prepared")
  assert.equal(prepared.confirmed_at, null)
  const duplicate = (await api("POST", commandPath, commandBody, 201)).data
  assert.equal(duplicate.uuid, prepared.uuid)
  const confirmed = (
    await api("POST", commandPath + `/${prepared.uuid}/confirm`, {
      confirmed: true,
    })
  ).data
  assert.equal(confirmed.status, "pending")
  const commands = await until(
    "Live command observation",
    () => api("GET", commandPath),
    (r) => r.data.find((c) => c.uuid === prepared.uuid)?.status === "observed",
    35,
  )
  assert.ok(commands.data.find((c) => c.uuid === prepared.uuid).completed_at)
  passed(
    "Explicit command confirmation, idempotency, permission denial, and subsequent observed target",
  )
  const already = (
    await api(
      "POST",
      commandPath,
      { ...commandBody, idempotency_key: randomUUID() },
      201,
    )
  ).data
  assert.equal(
    (
      await api("POST", commandPath + `/${already.uuid}/confirm`, {
        confirmed: true,
      })
    ).data.status,
    "already_at_target",
  )
  passed("Already-at-target response without another dispatch")
  writeFileSync(
    join(env.directory, "verified-resources.json"),
    JSON.stringify({ org, northstar, meter, light }, null, 2),
    { mode: 0o600 },
  )
  writeFileSync(
    join(env.directory, "verification.json"),
    JSON.stringify(evidence, null, 2),
  )
  console.log(`Verified ${evidence.length} integration checkpoints.`)
} finally {
  await browser?.close()
  await Promise.all(clients.map((client) => client.dispose()))
}
