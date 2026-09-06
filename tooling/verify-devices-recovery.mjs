#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, openSync } from "node:fs"
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  require = createRequire(join(root, "apps/portal/package.json"))
const { request } = require("@playwright/test")
const env = JSON.parse(readFileSync(process.argv[2], "utf8")),
  resources = JSON.parse(
    readFileSync(join(env.directory, "verified-resources.json"), "utf8"),
  )
assert.ok(
  env.project.startsWith("iot-devices-test-"),
  "Recovery checks require the disposable deployment",
)
const base = `http://127.0.0.1:${env.ports.api}`,
  runtime = `http://127.0.0.1:${env.ports.runtime}`,
  origin = `http://127.0.0.1:${env.ports.portal}`
const context = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: {
      Accept: "application/json",
      Origin: origin,
      Referer: origin + "/",
    },
  }),
  replacements = [],
  checks = []
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(name, action, predicate, seconds = 30) {
  const end = Date.now() + seconds * 1000
  let last
  while (Date.now() < end) {
    last = await action()
    if (predicate(last)) return last
    await pause(500)
  }
  throw new Error(`${name} did not recover: ${JSON.stringify(last)}`)
}
async function api(method, path, data, expected) {
  const cookie = (await context.storageState()).cookies.find(
    (c) => c.name === "XSRF-TOKEN",
  )
  const response = await context.fetch(path, {
    method,
    data,
    headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {},
  })
  const body = await response.json().catch(() => ({}))
  if (expected)
    assert.ok(
      [expected].flat().includes(response.status()),
      `${path}: expected ${expected}, got ${response.status()} ${JSON.stringify(body)}`,
    )
  else
    assert.ok(
      response.ok(),
      `${path}: ${response.status()} ${JSON.stringify(body)}`,
    )
  return body
}
function passed(name) {
  checks.push(name)
  console.log("PASS " + name)
}
async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (b) => (output += b))
    child.stderr.on("data", (b) => (output += b))
    child.on("error", reject)
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} failed: ${output.slice(-3000)}`)),
    )
  })
}
const compose = [
  "compose",
  "--project-name",
  env.project,
  "--env-file",
  join(env.directory, "devices.env"),
  "-f",
  join(root, "deploy/compose/compose.devices-test.yml"),
]
async function docker(...args) {
  return run("docker", [...compose, ...args])
}
async function restart(name, options = {}) {
  const file = join(env.directory, name + "-process.json"),
    spec = JSON.parse(readFileSync(file, "utf8"))
  try {
    process.kill(spec.pid, options.crash ? "SIGKILL" : "SIGTERM")
  } catch (e) {
    if (e.code !== "ESRCH") throw e
  }
  await pause(1000)
  const args = spec.args.filter((a) => a !== "--ignore-commands")
  if (options.ignoreCommands) args.push("--ignore-commands")
  const log = openSync(join(env.directory, name + ".log"), "a", 0o600)
  const child = spawn(spec.command, args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", log, log],
  })
  replacements.push(child)
  writeFileSync(file, JSON.stringify({ ...spec, pid: child.pid, args }), {
    mode: 0o600,
  })
  if (name === "runtime")
    await until(
      "Runtime readiness",
      async () =>
        (await fetch(runtime + "/health/ready").catch(() => null))?.status,
      (status) => status === 200,
    )
}
const lightPath = `/api/v1/organizations/${resources.org}/devices/${resources.light.device.uuid}`
async function live() {
  return until(
    "Fresh light state",
    () => api("GET", lightPath + "/measurements/latest"),
    (r) =>
      r.presence === "online" &&
      r.data.some(
        (v) =>
          v.key === "power" &&
          v.quality === "good" &&
          Date.now() - Date.parse(v.received_at) < 5000,
      ),
  )
}
async function command(value) {
  const device = (await api("GET", lightPath)).data,
    parameter = resources.light.artifact.definition.parameters.find(
      (p) => p.key === "power",
    )
  const body = {
    configuration_uuid: device.applied_configuration_uuid,
    parameter_uuid: parameter.uuid,
    value,
    idempotency_key: randomUUID(),
  }
  const prepared = (await api("POST", lightPath + "/commands", body)).data
  const confirmed = (
    await api("POST", lightPath + `/commands/${prepared.uuid}/confirm`, {
      confirmed: true,
    })
  ).data
  return confirmed
}
async function status(uuid, expected, seconds = 45) {
  return until(
    "Command " + expected,
    () => api("GET", lightPath + "/commands"),
    (r) => r.data.find((c) => c.uuid === uuid)?.status === expected,
    seconds,
  )
}
try {
  await context.get("/sanctum/csrf-cookie")
  await api("POST", "/api/v1/auth/login", {
    email: "shared.operator@example.test",
    password: "password",
  })
  assert.equal(
    (await fetch(runtime + "/internal/measurements/latest")).status,
    401,
  )
  await api("GET", "/api/internal/devices/state", undefined, 401)
  passed(
    "Internal runtime interfaces reject browser and unauthenticated access",
  )
  const python = JSON.parse(
    readFileSync(join(env.directory, "simulator-process.json"), "utf8"),
  ).command
  console.log(
    (
      await run(python, [
        "tooling/simulators/verify_broker.py",
        "--config",
        join(env.directory, "simulator.json"),
      ])
    ).trim(),
  )
  passed("Broker TLS certificate checks and namespace ACL isolation")
  // A new profile publication is inert until an explicit device activation.
  const profilePath = `/api/v1/organizations/${resources.org}/device-profiles/${resources.light.artifact.profile_uuid}`
  const profile = (await api("GET", profilePath)).data
  const currentDevice = (await api("GET", lightPath)).data,
    previousConfiguration = currentDevice.applied_configuration_uuid
  const edited = (
    await api("PATCH", profilePath, {
      name: profile.name + " revised",
      draft_revision: profile.draft_revision,
    })
  ).data
  await api("POST", profilePath + "/publish", {
    draft_revision: edited.draft_revision,
  })
  assert.equal(
    (await api("GET", lightPath)).data.applied_configuration_uuid,
    previousConfiguration,
  )
  const published = (await api("GET", profilePath)).data
  const artifact = (
    await api("GET", profilePath + `/artifacts/${published.revision}`)
  ).data
  const candidate = (
    await api(
      "GET",
      `/api/v1/organizations/${resources.org}/discovery-candidates`,
    )
  ).data.find((c) => c.uuid === resources.light.candidate.uuid)
  let device = (
    await api("PUT", lightPath + "/configuration", {
      ...currentDevice.draft,
      artifact_uuid: artifact.uuid,
      birth_revision: candidate.birth_revision,
      draft_revision: currentDevice.draft_revision,
    })
  ).data
  await api("POST", lightPath + "/activate", {
    draft_revision: device.draft_revision,
  })
  device = (
    await until(
      "Explicit profile upgrade",
      () => api("GET", lightPath),
      (r) =>
        r.data.deployment_status === "applied" &&
        r.data.applied_configuration_uuid !== previousConfiguration,
    )
  ).data
  const upgraded = device.applied_configuration_uuid
  await api("POST", lightPath + "/activate", {
    draft_revision: device.draft_revision,
    rollback_configuration_uuid: previousConfiguration,
  })
  device = (
    await until(
      "Historical profile rollback",
      () => api("GET", lightPath),
      (r) =>
        r.data.deployment_status === "applied" &&
        r.data.applied_configuration_uuid !== upgraded,
    )
  ).data
  assert.equal(
    device.configurations.find(
      (c) => c.uuid === device.applied_configuration_uuid,
    ).definition.profile_artifact_uuid,
    currentDevice.configurations.find((c) => c.uuid === previousConfiguration)
      .definition.profile_artifact_uuid,
  )
  passed(
    "Publication does not activate devices; explicit upgrade and historical rollback apply",
  )
  await restart("simulator", { ignoreCommands: true })
  await live()
  const timeout = await command(true)
  await status(timeout.uuid, "timed_out")
  passed("30-second execution deadline produces timeout without matching state")
  const uncertain = await command(true)
  await status(uncertain.uuid, "sent", 15)
  const before = (
    readFileSync(join(env.directory, "simulator.log"), "utf8").match(
      /State command received/g,
    ) ?? []
  ).length
  await restart("runtime", { crash: true })
  await status(uncertain.uuid, "uncertain", 20)
  await api("POST", lightPath + `/commands/${uncertain.uuid}/confirm`, {
    confirmed: true,
  })
  await pause(3000)
  const after = (
    readFileSync(join(env.directory, "simulator.log"), "utf8").match(
      /State command received/g,
    ) ?? []
  ).length
  assert.equal(
    after,
    before,
    "No command replay after an uncertain dispatch or duplicate confirmation",
  )
  passed(
    "Crash after dispatch becomes uncertain and is never automatically replayed",
  )
  await docker("stop", "-t", "2", "emqx")
  await until(
    "Broker disconnect visible",
    () => api("GET", lightPath),
    (r) => r.data.presence !== "online",
    20,
  )
  await api(
    "POST",
    lightPath + "/commands",
    {
      configuration_uuid: device.applied_configuration_uuid,
      parameter_uuid: resources.light.artifact.definition.parameters.find(
        (p) => p.key === "power",
      ).uuid,
      value: true,
      idempotency_key: randomUUID(),
    },
    422,
  )
  await docker("start", "emqx")
  await live()
  passed(
    "Broker disconnect blocks controls and TLS reconnect restores a fresh source session",
  )
  await docker("stop", "-t", "2", "nats")
  await until(
    "JetStream health failure",
    async () => (await fetch(runtime + "/health/ready")).status,
    (s) => s === 503,
  )
  await docker("start", "nats")
  await until(
    "JetStream health recovery",
    async () => (await fetch(runtime + "/health/ready")).status,
    (s) => s === 200,
  )
  await live()
  passed("JetStream interruption is exposed and durable consumers recover")
  await docker("stop", "-t", "2", "timescaledb")
  await until(
    "Database health failure",
    async () => (await fetch(runtime + "/health/ready")).status,
    (s) => s === 503,
  )
  await docker("start", "timescaledb")
  await until(
    "Database health recovery",
    async () => (await fetch(runtime + "/health/ready")).status,
    (s) => s === 200,
  )
  await live()
  passed("Database interruption and durable latest-state recovery")
  await restart("simulator")
  await live()
  const final = await command(true)
  await status(final.uuid, "observed")
  passed(
    "Observed command completion still works after all interruption checks",
  )
  writeFileSync(
    join(env.directory, "recovery-verification.json"),
    JSON.stringify(checks, null, 2),
  )
} finally {
  for (const child of replacements) child.kill("SIGTERM")
  await context.dispose()
}
