#!/usr/bin/env node
// Opt-in demo: a simulated thermal fire-watch box whose detections raise alerts,
// email the people on watch and wait for someone to acknowledge them.
// Everything is created through the public API and is safe to rerun.
//
// Local stack (default): creates its own organization and two demo accounts.
// Hosted environment: FIRE_WATCH_API_URL and FIRE_WATCH_PORTAL_URL point at it and
// --organization names an existing organization. You sign in interactively; no
// accounts are created, and you (plus any --recipients members) receive the email.
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { Writable } from "node:stream"
import { fileURLToPath } from "node:url"

const env = process.env
const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const apiURL = env.FIRE_WATCH_API_URL ?? "http://localhost:8001"
const portal = env.FIRE_WATCH_PORTAL_URL ?? "http://localhost:5173"
const mailpit = env.FIRE_WATCH_MAILPIT_URL ?? "http://127.0.0.1:8026"
const local = (url) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname)
const hosted = !local(apiURL)
if (hosted) {
  assert.ok(env.FIRE_WATCH_PORTAL_URL, "Set FIRE_WATCH_PORTAL_URL to the hosted portal.")
  for (const url of [apiURL, portal]) assert.equal(new URL(url).protocol, "https:", "A hosted environment must use https.")
  assert.match(option("--organization") ?? "", /^[0-9a-f-]{36}$/, "A hosted environment needs --organization <uuid> of an existing organization.")
} else {
  for (const url of [portal, mailpit]) assert.ok(local(url), "Point every URL at the local stack, or all of them at a hosted environment.")
}
const organization = { name: env.FIRE_WATCH_ORG_NAME ?? "Fire watch demo (simulated)", slug: env.FIRE_WATCH_ORG_SLUG ?? "fire-watch-demo" }
const deviceName = env.FIRE_WATCH_DEVICE_NAME ?? "Fire-watch box 01 · Hot work area"
const admin = { email: env.FIRE_WATCH_ADMIN_EMAIL ?? "super-admin@example.test", password: env.FIRE_WATCH_ADMIN_PASSWORD ?? "password" }
// The people on watch. New accounts get generated passwords, kept in the private demo folder.
const people = [
  { name: "Site Supervisor", email: "site.supervisor@example.test" },
  { name: "Fire Watch Lead", email: "fire.watch.lead@example.test" },
]
// Each environment keeps its own box identity and kit.
const folder = new URL(hosted ? `../.local/demos/fire-watch-${new URL(apiURL).hostname}-${option("--organization").slice(0, 8)}/` : "../.local/demos/fire-watch/", import.meta.url)
const controlPort = hosted ? 8768 : 8767
mkdirSync(folder, { recursive: true, mode: 0o700 })
const statePath = new URL("demo.json", folder)
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { accounts: {} }
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 })

const detected = [{ value: true, label: "Detected", tone: "critical" }, { value: false, label: "Clear", tone: "good" }]
// Metric names are what the box announces in its NBIRTH (tooling/simulators/fire_watch_box.py).
const parameters = [
  { key: "thermal_max", label: "Hottest point", metric: "Thermal/Max temperature", kind: "measurement", data_type: "number", unit: "°C", display: { precision: 1, min: 0, max: 160 } },
  { key: "thermal_scene", label: "Scene temperature", metric: "Thermal/Scene temperature", kind: "measurement", data_type: "number", unit: "°C", display: { precision: 1 } },
  { key: "flame", label: "Flame", metric: "Detection/Flame", kind: "state", data_type: "boolean", display: { states: detected } },
  { key: "flame_confidence", label: "Flame confidence", metric: "Detection/Flame confidence", kind: "measurement", data_type: "number", unit: "%", display: { precision: 0, min: 0, max: 100 } },
  { key: "smoke", label: "Smoke", metric: "Detection/Smoke", kind: "state", data_type: "boolean", display: { states: detected } },
  { key: "person_in_zone", label: "Person in exclusion zone", metric: "Detection/Person in zone", kind: "state", data_type: "boolean", display: { states: detected } },
  { key: "camera_blocked", label: "Camera view", metric: "Camera/View blocked", kind: "state", data_type: "boolean", display: { states: [{ value: true, label: "Blocked", tone: "warning" }, { value: false, label: "Clear", tone: "good" }] } },
  { key: "battery", label: "Battery", metric: "Power/Battery", kind: "measurement", data_type: "number", unit: "%", display: { precision: 0, min: 0, max: 100 } },
  { key: "on_battery", label: "Power source", metric: "Power/On battery", kind: "state", data_type: "boolean", display: { states: [{ value: true, label: "Battery", tone: "warning" }, { value: false, label: "Mains", tone: "good" }] } },
  { key: "detections", label: "Detections", metric: "Detection/Count", kind: "counter", data_type: "integer", display: {} },
]
// One alert per automation; each is a short chain ending in an alert action.
const automations = [
  { name: "Flame detected", source: "flame", steps: [["sustained.v1", { seconds: 2 }]] },
  { name: "Hot spot above 80 °C", source: "thermal_max", steps: [["hysteresis.v1", { activate_above: 80, clear_below: 60 }], ["sustained.v1", { seconds: 2 }]] },
  { name: "Smoke detected", source: "smoke", steps: [["sustained.v1", { seconds: 2 }]] },
  { name: "Person in exclusion zone", source: "person_in_zone", steps: [["sustained.v1", { seconds: 3 }]] },
  { name: "Camera view blocked", source: "camera_blocked", steps: [["sustained.v1", { seconds: 5 }]] },
  { name: "Battery low", source: "battery", steps: [["compare.v1", { operator: "lt", value: 20 }], ["sustained.v1", { seconds: 10 }]] },
]

function client() {
  const jar = new Map()
  async function call(method, path, data, expected) {
    const headers = { Accept: "application/json", Origin: portal, Referer: portal + "/" }
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
    if (jar.has("XSRF-TOKEN")) headers["X-XSRF-TOKEN"] = decodeURIComponent(jar.get("XSRF-TOKEN"))
    if (data !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetch(apiURL + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: "manual" })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1))
    }
    const text = await response.text()
    const ok = expected ? response.status === expected : response.ok
    assert.ok(ok, `${method} ${path}: ${response.status} ${text.slice(0, 600)}`)
    return text ? JSON.parse(text) : null
  }
  return {
    call,
    async login(email, password) {
      await call("GET", "/sanctum/csrf-cookie")
      return (await call("POST", "/api/v1/auth/login", { email, password })).data
    },
  }
}
async function until(name, read, predicate, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw Error(`${name} was not confirmed within ${timeout / 1000} seconds.`)
}
async function invitationToken(email, after) {
  const search = async () => (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages ?? []
  const message = (await until(`Invitation email to ${email}`, search, (m) => m.some((x) => new Date(x.Created) >= after))).find((x) => new Date(x.Created) >= after)
  const body = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json()
  const token = (body.Text + body.HTML).match(/accept-invitation\?token=([^\s"&<]+)/)?.[1]
  assert.ok(token, `No invitation link in the email to ${email}`)
  return decodeURIComponent(token)
}

async function ask(question, hidden = false) {
  assert.ok(process.stdin.isTTY, "Signing in to a hosted environment needs an interactive terminal.")
  // Readline redraws its own prompt line, so a label written before it would be erased.
  if (hidden) process.stdout.write(question)
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() })
  const prompt = createInterface({ input: process.stdin, output: hidden ? muted : process.stdout, terminal: true })
  const answer = await new Promise((resolve) => prompt.question(hidden ? "" : question, resolve))
  prompt.close()
  if (hidden) process.stdout.write("\n")
  return hidden ? answer : answer.trim()
}

// 1. The organization and the people on watch.
let org
const sessions = []
if (hosted) {
  const session = client()
  console.log(`Sign in to ${new URL(portal).host}`)
  const email = env.FIRE_WATCH_EMAIL ?? await ask("Email: ")
  const user = await session.login(email, await ask("Password (not shown): ", true))
  org = user.organizations.find((o) => o.uuid === option("--organization"))
  assert.ok(org, "You are not a member of that organization.")
  sessions.push({ name: user.name, email: user.email, id: user.id, session })
  // Your personal email preferences are yours to change; only say when they would block alert mail.
  const preferences = (await session.call("GET", "/api/v1/notifications/preferences")).data
  if (!preferences.email_enabled || !preferences.grid.workflow.warning || !preferences.grid.workflow.recovery)
    console.log("WARN Your email preferences turn off workflow warnings or recovery mail; turn them on in Settings → Email to receive these alerts.")
  const members = (await session.call("GET", `/api/v1/organizations/${org.uuid}/members?per_page=100`)).data
  for (const address of (option("--recipients") ?? "").split(",").map((a) => a.trim()).filter((a) => a && a !== user.email)) {
    const member = members.find((m) => m.email === address)
    assert.ok(member, `${address} is not a member of ${org.name}.`)
    sessions.push({ name: member.name, email: member.email, id: member.id })
  }
} else {
  const platform = client()
  await platform.login(admin.email, admin.password)
  org = (await platform.call("GET", `/api/v1/admin/organizations?search=${encodeURIComponent(organization.slug)}&per_page=100`)).data.find((o) => o.slug === organization.slug)
  if (!org) org = (await platform.call("POST", "/api/v1/admin/organizations", organization)).data
  else if (org.name !== organization.name) org = (await platform.call("PATCH", `/api/v1/admin/organizations/${org.uuid}`, { name: organization.name })).data
  const adminRole = (await platform.call("GET", `/api/v1/admin/organizations/${org.uuid}/roles`)).data.find((r) => r.key === "organization-admin")
  assert.ok(adminRole, "The organization has no administrator role.")
  for (const person of people) {
    const session = client()
    let password = state.accounts[person.email]
    let user = password ? await session.login(person.email, password).catch(() => null) : null
    if (!user?.organizations.some((o) => o.uuid === org.uuid)) {
      const sent = new Date(Date.now() - 2000)
      await platform.call("POST", `/api/v1/admin/organizations/${org.uuid}/invitations`, { email: person.email, role_ids: [adminRole.id] })
      const token = await invitationToken(person.email, sent)
      await session.call("GET", "/sanctum/csrf-cookie")
      password ??= randomBytes(12).toString("base64url")
      user = (await session.call("POST", `/api/v1/invitations/${encodeURIComponent(token)}/accept`, user ? {} : { name: person.name, password, password_confirmation: password })).data
      state.accounts[person.email] = password
      save()
    }
    // Workflow alerts are "warning" events; make sure this demo account receives them and their recovery mail.
    const preferences = (await session.call("GET", "/api/v1/notifications/preferences")).data
    if (!preferences.email_enabled || !preferences.grid.workflow.warning || !preferences.grid.workflow.recovery)
      await session.call("PUT", "/api/v1/notifications/preferences", { revision: preferences.revision, email_enabled: true, grid: { ...preferences.grid, workflow: { ...preferences.grid.workflow, warning: true, recovery: true } } })
    sessions.push({ ...person, id: user.id, session })
  }
}
const presenter = sessions[0].session
const path = `/api/v1/organizations/${org.uuid}`
console.log(hosted ? `PASS signed in to "${org.name}" as ${sessions[0].name}` : `PASS organization "${org.name}" with ${people.map((p) => p.name).join(" and ")} as administrators`)

// 2. The device profile: what a fire-watch box reports.
let profile = (await presenter.call("GET", `${path}/device-profiles?per_page=100`)).data.find((p) => p.code === "fire-watch-box")
if (!profile) {
  profile = (await presenter.call("POST", `${path}/device-profiles`, { code: "fire-watch-box", name: "Thermal fire-watch box", category: "fire-safety", description: "Edge-AI fire-watch kit: colour and thermal cameras with on-board flame, smoke and person detection, on battery or mains. Simulated." })).data
  for (const [index, p] of parameters.entries()) {
    profile = (await presenter.call("GET", `${path}/device-profiles/${profile.uuid}`)).data
    await presenter.call("POST", `${path}/device-profiles/${profile.uuid}/parameters`, {
      key: p.key, label: p.label, kind: p.kind, data_type: p.data_type, unit: p.unit ?? null,
      reports_state: true, accepts_command: false, display_config: p.display,
      reporting_config: { stale_after_seconds: 15 },
      counter_config: p.kind === "counter" ? { monotonic: true, reset_behavior: "diagnose" } : null,
      sort_order: index, draft_revision: profile.draft_revision,
    })
  }
  profile = (await presenter.call("GET", `${path}/device-profiles/${profile.uuid}`)).data
  const validation = (await presenter.call("POST", `${path}/device-profiles/${profile.uuid}/validate`, { draft_revision: profile.draft_revision })).data
  assert.ok(validation.valid, JSON.stringify(validation.diagnostics))
  await presenter.call("POST", `${path}/device-profiles/${profile.uuid}/publish`, { draft_revision: profile.draft_revision })
  profile = (await presenter.call("GET", `${path}/device-profiles/${profile.uuid}`)).data
}
const artifact = (await presenter.call("GET", `${path}/device-profiles/${profile.uuid}/artifacts/${profile.revision}`)).data
const parameter = (key) => artifact.definition.parameters.find((p) => p.key === key)
console.log(`PASS published profile "${profile.name}" revision ${profile.revision}`)

// 3. The box: a direct Sparkplug edge node with its own connection kit.
state.onboarding ??= randomUUID()
save()
let setup = (await presenter.call("POST", `${path}/device-onboardings`, { request_uuid: state.onboarding, name: deviceName, artifact_uuid: artifact.uuid, mode: "direct" })).data
let device = setup.device
if (!setup.provisioned) setup = (await presenter.call("POST", `${path}/devices/${device.uuid}/onboarding/provision`)).data
assert.ok(setup.provisioned, setup.diagnostic ?? "The box's broker account was not provisioned.")
const kit = new URL("kit/", folder)
async function connectionKit() {
  // An environment without a broker CA answers 503 until an administrator configures one, and a deploy
  // that fixes it drops connections for a moment, so wait through both.
  for (let waited = 0; ; waited += 60) {
    try {
      return (await presenter.call("POST", `${path}/devices/${device.uuid}/connection-kit`)).data
    } catch (error) {
      if (!(error.message.includes(": 503 ") || error.message === "fetch failed") || waited >= 3 * 3600) throw error
      if (!waited) console.log(`WAIT ${new URL(apiURL).host} cannot issue connection kits yet (503); retrying every minute for up to three hours…`)
      await new Promise((resolve) => setTimeout(resolve, 60000))
    }
  }
}
if (!existsSync(new URL("device-config.json", kit))) {
  const { config, ca_certificate } = await connectionKit()
  mkdirSync(kit, { recursive: true, mode: 0o700 })
  writeFileSync(new URL("device-config.json", kit), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  writeFileSync(new URL("ca.crt", kit), ca_certificate, { mode: 0o600 })
}
device = (await presenter.call("GET", `${path}/devices/${device.uuid}`)).data
if (device.deployment_status !== "applied") {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const demo = fileURLToPath(folder).slice(root.length)
  console.log(`\nStart the box in another terminal, from ${root}:\n\n  .local/devices/python/bin/python tooling/simulators/fire_watch_box.py --config ${demo}kit/device-config.json --state-file ${demo}box-state --control-port ${controlPort}\n\nWaiting for its birth certificate…`)
  setup = (await until("The box's NBIRTH", async () => (await presenter.call("GET", `${path}/devices/${device.uuid}/onboarding`)).data, (s) => parameters.every((p) => s.candidate?.metrics.some((m) => m.name === p.metric)), 300000))
  const candidate = setup.candidate
  if (candidate.status !== "approved") await presenter.call("PATCH", `${path}/discovery-candidates/${candidate.uuid}`, { status: "approved", birth_revision: candidate.birth_revision })
  device = (await presenter.call("PUT", `${path}/devices/${device.uuid}/configuration`, {
    draft_revision: device.draft_revision, artifact_uuid: artifact.uuid, candidate_uuid: candidate.uuid, birth_revision: candidate.birth_revision,
    mappings: parameters.map((p) => ({ parameter_uuid: parameter(p.key).uuid, metric: p.metric })),
  })).data
  await presenter.call("POST", `${path}/devices/${device.uuid}/validate`, { draft_revision: device.draft_revision })
  await presenter.call("POST", `${path}/devices/${device.uuid}/activate`, { draft_revision: device.draft_revision })
  device = (await until("Applied configuration", () => presenter.call("GET", `${path}/devices/${device.uuid}`), (r) => r.data.deployment_status === "applied")).data
}
await until("Live readings", () => presenter.call("GET", `${path}/devices/${device.uuid}/measurements/latest`), (r) => r.presence === "online" && parameters.every((p) => r.data.some((v) => v.key === p.key && v.value !== null)))
console.log(`PASS "${device.name}" is online and reporting ${parameters.length} parameters over Sparkplug B`)

// 4. Automations: each detection raises an alert and emails the people on watch.
const workflows = `${path}/workflows`
const settings = (await presenter.call("GET", `${workflows}/dag/settings`)).data
if (!settings.enabled || settings.stopped) await presenter.call("PUT", `${workflows}/dag/settings`, { revision: settings.revision, enabled: true, stopped: false })
const existing = (await presenter.call("GET", `${workflows}/dag`)).data
// The API lists exactly who may receive alert email: verified members who can view devices.
// A super administrator who is not a member, or an unverified invitee, is not among them.
const eligibleRecipients = async (uuid) => new Set((await presenter.call("GET", `${workflows}/${uuid}/notification-recipients`)).data.map((u) => u.id))
async function emailTo(uuid, ids) {
  const current = (await presenter.call("GET", `${workflows}/${uuid}/notifications`)).data
  if (ids.length && (!current.enabled || !current.notify_on_clear || ids.some((id) => !current.recipient_ids.includes(id))))
    await presenter.call("PUT", `${workflows}/${uuid}/notifications`, { revision: current.revision, enabled: true, notify_on_clear: true, recipient_ids: [...new Set([...current.recipient_ids, ...ids])] })
}
let recipients // decided once the first automation exists
const created = {}
for (const automation of automations) {
  let workflow = existing.find((w) => w.name === automation.name)
  if (!workflow) {
    const p = parameter(automation.source)
    const nodes = [{ id: "box", type: "source.parameter.v1", config: { binding: "box" } }]
    const edges = []
    for (const [index, [type, config]] of [...automation.steps, ["action.alert.v1", { title: automation.name }]].entries()) {
      const id = type === "action.alert.v1" ? "alert" : type.split(".")[0]
      edges.push({ source: nodes.at(-1).id, source_port: "out", target: id, target_port: "in" })
      nodes.push({ id, type, config })
      assert.ok(index < 5)
    }
    const graph = {
      schema_version: "automation-workflow.v2",
      bindings: [{ role: "box", device_uuid: device.uuid, configuration_uuid: device.applied_configuration_uuid, generation: device.deployment_generation, parameter_uuid: p.uuid, data_type: p.data_type === "boolean" ? "boolean" : "number", unit: p.unit ?? "", fresh_seconds: 30 }],
      nodes, edges,
    }
    workflow = (await presenter.call("POST", workflows, { name: automation.name, workflow: graph })).data
    await presenter.call("PUT", `${workflows}/${workflow.uuid}/layout`, { layout_revision: workflow.layout_revision ?? 0, layout: { positions: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 280, y: 80 }])) } })
  }
  workflow = (await presenter.call("GET", `${workflows}/${workflow.uuid}`)).data
  if (workflow.deployment_status !== "applied") {
    await presenter.call("POST", `${workflows}/${workflow.uuid}/deployments`, { operation_uuid: randomUUID(), draft_revision: workflow.draft_revision, expected_generation: workflow.deployment_generation ?? 0, target_state: "active", command_grants: [] }, 202)
    workflow = (await until(`"${automation.name}" activation`, () => presenter.call("GET", `${workflows}/${workflow.uuid}`), (r) => r.data.deployment_status === "applied")).data
  }
  if (!recipients) {
    const eligible = await eligibleRecipients(workflow.uuid)
    recipients = sessions.filter((p) => eligible.has(p.id)).map((p) => p.id)
    for (const p of sessions.filter((p) => !eligible.has(p.id)))
      console.log(`WARN ${p.email} cannot receive alert email in ${org.name} (only verified members can); alerts still appear in the inbox.`)
  }
  await emailTo(workflow.uuid, recipients)
  created[automation.name] = workflow.uuid
}
console.log(`PASS ${automations.length} automations active; each emails ${sessions.filter((p) => recipients.includes(p.id)).map((p) => p.name).join(" and ") || "nobody yet"} on alert and on recovery`)

// 5. A dashboard for the site.
// A threshold band runs from its value upward; the base band covers everything below the first one.
const source = (key, color, base = "Current", thresholds = []) => {
  const p = parameter(key)
  return { device_uuid: device.uuid, parameter_uuid: p.uuid, device_name: device.name, label: p.label, unit: p.unit, data_type: p.data_type, precision: null, color, base: { label: base, color: base === "Low" ? "#d97706" : "#64748b" }, thresholds }
}
const dashboardName = "Fire watch · Hot work area"
const definition = {
  name: dashboardName,
  widgets: [
    { id: "thermal", schema_version: 2, type: "timeseries", title: "Hottest point", description: "Thermal camera maximum and scene temperature. Alerts above 80 °C.", config: { sources: [source("thermal_max", "#dc2626", "Normal", [{ value: 80, label: "Hot spot alert", color: "#dc2626" }]), source("thermal_scene", "#2563eb")] } },
    { id: "detections", schema_version: 2, type: "status", title: "On-board detection", description: "What the box's detectors see right now.", config: { sources: ["flame", "smoke", "person_in_zone", "camera_blocked", "on_battery"].map((key) => source(key, "#dc2626")) } },
    { id: "history", schema_version: 2, type: "state_history", title: "Detection history", description: "", config: { sources: ["flame", "smoke", "person_in_zone", "camera_blocked"].map((key) => source(key, "#dc2626")) } },
    { id: "battery", schema_version: 2, type: "gauge", title: "Battery", description: "Alerts below 20 %.", config: { sources: [source("battery", "#16a34a", "Low", [{ value: 20, label: "OK", color: "#16a34a" }])], min: 0, max: 100 } },
    { id: "flame-alerts", schema_version: 2, type: "alerts", title: "Flame alerts", description: "", config: { sources: [], workflow_uuid: created["Flame detected"] } },
    { id: "health", schema_version: 2, type: "device_health", title: "Box health", description: "", config: { sources: [], devices: [{ device_uuid: device.uuid }] } },
  ],
  layouts: { lg: [
    { i: "thermal", x: 0, y: 0, w: 8, h: 6 }, { i: "detections", x: 8, y: 0, w: 4, h: 6 },
    { i: "history", x: 0, y: 6, w: 8, h: 5 }, { i: "battery", x: 8, y: 6, w: 4, h: 5 },
    { i: "flame-alerts", x: 0, y: 11, w: 8, h: 5 }, { i: "health", x: 8, y: 11, w: 4, h: 5 },
  ] },
  defaults: { range: { mode: "relative", preset: "15m" }, timezone: "browser", refresh: 5 },
}
let dashboard = (await presenter.call("GET", `${path}/dashboards`)).data.find((d) => d.name === dashboardName)
if (!dashboard) dashboard = (await presenter.call("POST", `${path}/dashboards`, definition)).data
else if (process.argv.includes("--refresh-dashboard")) {
  const current = (await presenter.call("GET", `${path}/dashboards/${dashboard.uuid}`)).data
  dashboard = (await presenter.call("PUT", `${path}/dashboards/${dashboard.uuid}`, { ...definition, revision: current.revision })).data
}

const links = {
  dashboard: `${portal}/organizations/${org.uuid}/dashboards/${dashboard.uuid}`,
  alerts: `${portal}/organizations/${org.uuid}/alerts`,
  device: `${portal}/organizations/${org.uuid}/devices/${device.uuid}`,
  automations: `${portal}/organizations/${org.uuid}/automations`,
  box_controls: `http://127.0.0.1:${controlPort}`,
  ...(hosted ? {} : { mail: mailpit }),
}
Object.assign(state, { organization_uuid: org.uuid, device_uuid: device.uuid, workflows: created, links })
save()
const signIn = hosted ? `Alert email goes to ${sessions.filter((p) => recipients.includes(p.id)).map((p) => p.email).join(" and ") || "nobody yet"}.` : `Sign in as ${people.map((p) => p.email).join(" or ")}; passwords are in .local/demos/fire-watch/demo.json.`
console.log(`PASS dashboard "${dashboardName}"\n\nDemo ready. ${signIn}\n${JSON.stringify(links, null, 2)}`)

// Listed members who are not verified yet get the email as soon as they are, for example once a
// deploy fixes their accounts. Deploys drop connections for a moment, so keep checking through them.
let pending = hosted ? sessions.slice(1).filter((p) => !recipients.includes(p.id)) : []
if (pending.length) console.log(`\nWAIT ${pending.map((p) => p.email).join(" and ")} will get alert email once verified; checking every minute for up to three hours…`)
for (let waited = 0; pending.length && waited < 3 * 3600; waited += 60) {
  await new Promise((resolve) => setTimeout(resolve, 60000))
  let eligible
  try {
    eligible = await eligibleRecipients(Object.values(created)[0])
  } catch (error) {
    if (error.message === "fetch failed" || /: 5\d\d /.test(error.message)) continue
    throw error
  }
  const ready = pending.filter((p) => eligible.has(p.id))
  if (!ready.length) continue
  for (const uuid of Object.values(created)) await emailTo(uuid, ready.map((p) => p.id))
  recipients.push(...ready.map((p) => p.id))
  pending = pending.filter((p) => !ready.includes(p))
  console.log(`PASS ${ready.map((p) => p.name).join(" and ")} now get alert email from all ${automations.length} automations`)
}
if (pending.length) console.log(`WARN ${pending.map((p) => p.email).join(" and ")} still cannot receive alert email; rerun this script once they are verified members.`)
