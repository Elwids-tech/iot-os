import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// Moving devices to another organization of the billing account (spec 031 US1 and US2), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const shop = "0c4f6d2e-58a1-4b9e-9c3d-7f2a1b6e8d40"
const created = "1d5e7f3a-69b2-4c0f-8d4e-8a3b2c7f9e51"
const account = "2e6f8a4b-7ac3-4d1a-9e5f-9b4c3d8a0f62"
const moveId = "3f7a9b5c-8bd4-4e2b-8f6a-ac5d4e9b1a73"
const base = `/organizations/${org}`
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const adapterGateway = {
  uuid: "66666666-6666-4666-8666-666666666666",
  name: "Vendor trackers",
  edge_node_id: "adapter-x",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: "adapters-x",
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 3,
  adapter: { uuid: "77777777-7777-4777-8777-777777777777", name: "Vendor trackers" },
}
const device = (n: number, name: string, extra: Record<string, unknown> = {}) => ({
  uuid: uuid(n),
  code: name.toLowerCase().replaceAll(" ", "-"),
  name,
  serial_number: null,
  description: null,
  lifecycle: "active",
  presence: "online",
  deployment_status: "applied",
  draft_revision: 2,
  deployment_generation: 1,
  state_revision: 1,
  desired_configuration_uuid: null,
  applied_configuration_uuid: null,
  last_applied_configuration_uuid: null,
  diagnostic: null,
  last_seen_at: ago(5),
  operation: null,
  candidate: {
    uuid: uuid(100 + n), assigned_device_uuid: uuid(n), source_device_id: `src-${n}`, status: "approved", presence: "online",
    session_id: null, birth_revision: 1, metrics: [], last_seen_at: ago(5), gateway: adapterGateway, adapter: null, in_use_in: null,
  },
  profile: null,
  pipe: { kind: "adapter", name: "Vendor trackers", owner_organization_name: "Integrator", online: true, hosted: false },
  link: null,
  ...extra,
})
const devices = [device(1, "Tracker 41"), device(2, "Tracker 42"), device(3, "Tracker 43", { deployment_status: "pending" }), device(4, "Tracker 44")]

// Dashboards and automations using Tracker 41 and 42 (spec 031 US2): Shop and Shop low flow
// use them only, Fleet and Fleet low flow also use Tracker 44.
const shopBoard = uuid(301), fleetBoard = uuid(302), fleetFlow = uuid(303), shopFlow = uuid(304), copiedBoard = uuid(305), movedFlow = uuid(306)
type ItemChoice = { kind: string; uuid: string; action: string }
type Body = { device_uuids: string[]; devices?: { uuid: string; code?: string }[]; items?: ItemChoice[]; include_history?: boolean }

function itemsFor(body: Body) {
  if (!body.device_uuids.includes(uuid(1))) return []
  const everything = body.device_uuids.includes(uuid(4))
  const omitted = (panels: string[] = []) => ({ panels, shares: [], recipients: [], references: [] })
  const rows = [
    { kind: "dashboard", uuid: fleetBoard, name: "Fleet", uses_only_moving: everything, actions: everything ? ["move", "keep", "archive"] : ["copy", "keep"],
      omitted: omitted(everything ? [] : ["Tracker 44 flow (Tracker 44)"]), other_devices: everything ? null : { count: 1, can_add: true, device_uuids: [uuid(4)] }, running: null },
    { kind: "dashboard", uuid: shopBoard, name: "Shop", uses_only_moving: true, actions: ["move", "keep", "archive"], omitted: omitted(), other_devices: null, running: null },
    { kind: "automation", uuid: fleetFlow, name: "Fleet low flow", uses_only_moving: everything, actions: everything ? ["move", "keep", "archive"] : ["keep", "archive"],
      omitted: omitted(), other_devices: everything ? null : { count: 1, can_add: true, device_uuids: [uuid(4)] }, running: true },
    { kind: "automation", uuid: shopFlow, name: "Shop low flow", uses_only_moving: true, actions: ["move", "keep", "archive"], omitted: omitted(), other_devices: null, running: true },
  ]
  return rows.map((row) => {
    const wanted = body.items?.find((choice) => choice.kind === row.kind && choice.uuid === row.uuid)?.action
    const action = wanted && row.actions.includes(wanted) ? wanted : row.actions[0]
    const outcome = {
      move: row.kind === "automation" ? "Moves to Harbour Shop and keeps running there once its devices are active." : "Moves to Harbour Shop.",
      copy: "Harbour Shop gets a copy with 1 of its 2 panels, owned by you and shared with no one.",
      keep: row.kind === "automation" ? "Stays in Integrator and is turned off until Tracker 41 and Tracker 42 are removed from it." : "Stays in Integrator and shows Tracker 41 and Tracker 42 up to the move.",
      archive: row.kind === "automation" ? "Turned off and archived in Integrator." : "Archived in Integrator.",
    }[action]
    return { ...row, action, arrives_running: row.kind === "automation" && action === "move" ? true : null, outcome }
  })
}

function reviewFor(body: Body) {
  const rows = body.device_uuids.map((id) => {
    const row = devices.find((d) => d.uuid === id)!
    const override = body.devices?.find((d) => d.uuid === id)
    const blockers = row.deployment_status === "pending" ? ["Waiting for the runtime"] : override?.code === "taken" ? ["Code already used in Harbour Shop"] : []
    return {
      uuid: id, name: row.name, code: row.code,
      successor: { name: row.name, code: override?.code ?? row.code, site_uuid: null },
      reports_through: { kind: "adapter", name: "Vendor trackers", owner_organization_name: "Integrator", outcome: "stays" },
      arrives_active: true,
      blockers,
    }
  })
  const items = itemsFor(body)
  const archived = items.filter((item) => item.action === "archive")
  return {
    preview_hash: (body.items ?? []).length || body.device_uuids.length > 2 ? "b".repeat(64) : "a".repeat(64),
    can_confirm: rows.every((r) => r.blockers.length === 0),
    devices: rows,
    items,
    ends: { alerts: 1, geofence_assignments: 0, application_grants: [{ name: "Fleet export", devices: 1 }] },
    profile_copies: [{ profile: "GPS tracker", revision: 4, code: "gps-tracker", reused: false }],
    pipe_owner_sees_raw_messages: true,
    history: { offered: true, include: Boolean(body.include_history) },
    summary: [
      `${rows.length} devices move to Harbour Shop.`,
      `${rows.length} devices keep reporting through the adapter Vendor trackers, which stays with Integrator.`,
      ...(archived.length ? [`${archived.length} automation is archived in Integrator.`] : []),
      ...(body.include_history ? ["Harbour Shop can read the readings from before the move. They stay stored in Integrator, for as long as Integrator keeps readings."] : []),
    ],
    archives: archived.map(({ kind, uuid, name }) => ({ kind, uuid, name })),
  }
}

function moveAt(stage: number, ids: string[]) {
  return {
    uuid: moveId,
    status: stage === 0 ? "stopping" : "completed",
    source: { uuid: org, name: "Integrator" },
    target: { uuid: shop, name: "Harbour Shop" },
    confirmed_at: ago(4),
    cutover_at: stage === 0 ? null : ago(1),
    waiting_for: { devices_stopping: stage === 0 ? ids.length : 0 },
    devices: ids.map((id, index) => ({
      predecessor_uuid: id,
      successor_uuid: stage === 0 ? null : uuid(200 + index),
      name: devices.find((d) => d.uuid === id)!.name,
      state: stage === 0 ? "stopping" : "moved",
      successor_state: stage === 0 ? null : "pending",
      successor_reason: null,
    })),
    items: ids.includes(uuid(1)) ? [
      { kind: "dashboard", name: "Fleet", action: "copy", source_uuid: fleetBoard, target_uuid: copiedBoard, arrives_running: null },
      { kind: "dashboard", name: "Shop", action: "move", source_uuid: null, target_uuid: shopBoard, arrives_running: null },
      { kind: "automation", name: "Fleet low flow", action: "archive", source_uuid: fleetFlow, target_uuid: null, arrives_running: null },
      { kind: "automation", name: "Shop low flow", action: "move", source_uuid: shopFlow, target_uuid: movedFlow, arrives_running: true },
    ] : [],
    needs_attention: [],
    failure_reason: null,
  }
}

async function setup(page: Page, { owner = false, detail }: { owner?: boolean; detail?: Record<string, unknown> } = {}) {
  const state = { errors: [] as string[], previews: [] as Record<string, unknown>[], confirmed: null as null | Record<string, unknown>, polls: 0, createdOrganization: null as null | Record<string, unknown>, stopped: null as null | Record<string, unknown> }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const context = {
    uuid: org,
    name: "Integrator",
    slug: "integrator",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: true, connections: true, activate: true, command: true, move: true },
      features: { device_adapters: true },
    },
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({ data: { id: 1, name: "Mover", email: "mover@example.test", email_verified_at: "2026-01-01", capabilities: { platform_administration: false }, organizations: [context] } })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/device-move-targets"))
      return json({
        data: state.createdOrganization ? [{ uuid: created, name: "Corner Shop" }] : owner ? [] : [{ uuid: shop, name: "Harbour Shop" }],
        ...(owner ? { new_organization: { billing_account_uuid: account } } : {}),
      })
    if (path === `/api/v1/billing-accounts/${account}/organizations` && request.method() === "POST") {
      state.createdOrganization = request.postDataJSON()
      return json({ data: { uuid: created, name: "Corner Shop", slug: "corner-shop" } }, 201)
    }
    if (path.endsWith("/device-moves/preview")) {
      const body = request.postDataJSON()
      state.previews.push(body)
      return json(reviewFor(body))
    }
    if (path.endsWith("/device-moves") && request.method() === "POST") {
      state.confirmed = request.postDataJSON()
      return json({ data: moveAt(0, state.confirmed!.device_uuids as string[]) }, 202)
    }
    if (path.endsWith(`/device-moves/${moveId}`)) {
      state.polls++
      return json({ data: moveAt(state.polls > 1 ? 1 : 0, (state.confirmed?.device_uuids as string[]) ?? []) })
    }
    if (/\/sites$/.test(path)) return json({ data: [] })
    if (path.endsWith("/devices")) return json({ data: devices, meta: { current_page: 1, last_page: 1, total: devices.length } })
    if (detail && path.endsWith(`/devices/${detail.uuid}/link/history`) && request.method() === "POST") {
      state.stopped = request.postDataJSON()
      const link = detail.link as Record<string, unknown>
      detail.link = { ...link, history: { included: true, stopped_at: ago(0), stopped_reason: "stopped" } }
      return json({ data: detail.link })
    }
    if (detail && path.endsWith(`/devices/${detail.uuid}`)) return json({ data: detail })
    return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("a mover selects two devices, picks the target, accepts what comes along and the move completes", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 42" }).check()
  await page.getByRole("checkbox", { name: "Select Tracker 44" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()

  const dialog = page.getByRole("dialog", { name: "Move 2 devices" })
  await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled()
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await dialog.getByRole("button", { name: "Next" }).click()

  // What comes along: the adapter stays with its owner, endings and copies are listed.
  await expect(dialog.getByRole("listitem", { name: "Tracker 42" })).toContainText("Adapter Vendor trackers stays with Integrator")
  await expect(dialog.getByText("No dashboard or automation uses these devices.")).toBeVisible()
  await expect(dialog.getByText("Fleet export keeps reading the archived device")).toBeVisible()
  await expect(dialog.getByText("GPS tracker · version 4 as")).toBeVisible()
  await axe(page)
  await dialog.getByRole("button", { name: "Next" }).click()

  await expect(dialog.getByText("2 devices move to Harbour Shop.")).toBeVisible()
  await dialog.getByRole("button", { name: "Move 2 devices" }).click()
  await expect.poll(() => state.confirmed).not.toBeNull()
  expect(state.confirmed!.preview_hash).toBe("a".repeat(64))
  expect(state.confirmed!.operation_uuid).toMatch(/^[0-9a-f-]{36}$/)
  expect(state.confirmed!.origin).toBe("devices")
  expect(state.confirmed!.device_uuids).toEqual([uuid(2), uuid(4)])
  expect(state.confirmed!.confirmed_archives).toEqual([])

  // Done waits for the runtime, then links the devices in the target.
  await expect(dialog.getByText(/Waiting for the runtime to stop 2 devices|Moved to Harbour Shop/)).toBeVisible()
  await expect(dialog.getByText("Moved to Harbour Shop", { exact: false })).toBeVisible({ timeout: 10000 })
  await expect(dialog.getByRole("link", { name: "Tracker 42" })).toHaveAttribute("href", `/organizations/${shop}/devices/${uuid(200)}/overview`)
  expect(state.errors).toEqual([])
})

test("dashboards and automations come along with their preselected choices, and an archive is confirmed on its own", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 41" }).check()
  await page.getByRole("checkbox", { name: "Select Tracker 42" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const dialog = page.getByRole("dialog", { name: "Move 2 devices" })
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await dialog.getByRole("button", { name: "Next" }).click()

  // Each one has its preselected choice: Shop moves, Fleet is copied, Fleet low flow stays.
  const row = (name: string) => dialog.getByRole("listitem", { name })
  await expect(row("Dashboard Shop").getByRole("combobox", { name: "What happens to Shop" })).toHaveText("Move to Harbour Shop")
  await expect(row("Dashboard Fleet").getByRole("combobox", { name: "What happens to Fleet" })).toHaveText("Copy the moving devices’ panels to Harbour Shop")
  await expect(row("Dashboard Fleet")).toContainText("Left out: Tracker 44 flow (Tracker 44)")
  await expect(row("Automation Fleet low flow").getByRole("combobox", { name: "What happens to Fleet low flow" })).toHaveText("Keep in Integrator")
  await expect(row("Automation Fleet low flow")).toContainText("is turned off until Tracker 41 and Tracker 42 are removed from it")
  await expect(row("Automation Fleet low flow").getByRole("button", { name: "Add 1 device to this move" })).toBeVisible()
  await expect(row("Automation Shop low flow")).toContainText("keeps running there once its devices are active")
  await axe(page)

  // Archiving Fleet low flow instead re-reviews, and Confirm asks for that archive on its own.
  await row("Automation Fleet low flow").getByRole("combobox", { name: "What happens to Fleet low flow" }).click()
  await page.getByRole("option", { name: "Archive in Integrator" }).click()
  await expect.poll(() => state.previews.at(-1)?.items).toEqual([{ kind: "automation", uuid: fleetFlow, action: "archive" }])
  await expect(row("Automation Fleet low flow")).toContainText("Turned off and archived in Integrator.")
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect(dialog.getByText("1 automation is archived in Integrator.")).toBeVisible()
  const move = dialog.getByRole("button", { name: "Move 2 devices" })
  await expect(move).toBeDisabled()
  await dialog.getByRole("checkbox", { name: "Archive automation Fleet low flow" }).check()
  await axe(page)
  await move.click()
  await expect.poll(() => state.confirmed).not.toBeNull()
  expect(state.confirmed!.items).toEqual([{ kind: "automation", uuid: fleetFlow, action: "archive" }])
  expect(state.confirmed!.confirmed_archives).toEqual([{ kind: "automation", uuid: fleetFlow }])

  // Done links what moved or was copied in the target, and what was archived here.
  await expect(dialog.getByRole("link", { name: "Shop", exact: true })).toHaveAttribute("href", `/organizations/${shop}/dashboards/${shopBoard}`, { timeout: 10000 })
  await expect(dialog.getByRole("link", { name: "Fleet", exact: true })).toHaveAttribute("href", `/organizations/${shop}/dashboards/${copiedBoard}`)
  await expect(dialog.getByRole("link", { name: "Fleet low flow" })).toHaveAttribute("href", `/organizations/${org}/automation/${fleetFlow}`)
  await expect(dialog.getByRole("listitem").filter({ hasText: "Shop low flow" })).toContainText("Moved to Harbour Shop and turns on once its devices are active")
  expect(state.errors).toEqual([])
})

test("adding an automation's other devices recomputes every row", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 41" }).check()
  await page.getByRole("checkbox", { name: "Select Tracker 42" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const dialog = page.getByRole("dialog", { name: "Move 2 devices" })
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await dialog.getByRole("button", { name: "Next" }).click()
  await dialog.getByRole("listitem", { name: "Automation Fleet low flow" }).getByRole("button", { name: "Add 1 device to this move" }).click()

  await expect.poll(() => state.previews.at(-1)?.device_uuids).toEqual([uuid(1), uuid(2), uuid(4)])
  const bigger = page.getByRole("dialog", { name: "Move 3 devices" })
  await expect(bigger.getByRole("listitem", { name: "Tracker 44" })).toBeVisible()
  await expect(bigger.getByRole("listitem", { name: "Automation Fleet low flow" }).getByRole("combobox")).toHaveText("Move to Harbour Shop")
  await expect(bigger.getByRole("listitem", { name: "Dashboard Fleet" }).getByRole("combobox")).toHaveText("Move to Harbour Shop")
  expect(state.errors).toEqual([])
})

test("a blocked device keeps Next disabled, and a code the target uses is refused in place", async ({ page }) => {
  await setup(page)
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 42" }).check()
  await page.getByRole("checkbox", { name: "Select Tracker 43" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const dialog = page.getByRole("dialog", { name: "Move 2 devices" })
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await dialog.getByRole("button", { name: "Next" }).click()

  await expect(dialog.getByRole("listitem", { name: "Tracker 43" })).toContainText("Waiting for the runtime")
  await expect(dialog.getByText("1 of 2 can’t move yet.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled()

  await page.keyboard.press("Escape")
  await page.getByRole("checkbox", { name: "Select Tracker 43" }).uncheck()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const single = page.getByRole("dialog", { name: "Move Tracker 42" })
  await single.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await single.getByRole("button", { name: "Next" }).click()
  await single.getByLabel("Device code").fill("taken")
  await expect(single.getByText("Code already used in Harbour Shop")).toBeVisible()
  await expect(single.getByRole("button", { name: "Next" })).toBeDisabled()
})

test("an owner of the billing account creates a new organization and moves into it", async ({ page }) => {
  const state = await setup(page, { owner: true })
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 41" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const dialog = page.getByRole("dialog", { name: "Move Tracker 41" })
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("combobox", { name: "Search organization" }).fill("Corner Shop")
  await page.getByRole("option", { name: "New organization “Corner Shop”" }).click()

  await expect.poll(() => state.createdOrganization).toEqual({ name: "Corner Shop" })
  await expect(dialog.getByRole("combobox", { name: "Organization" })).toContainText("Corner Shop")
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect.poll(() => state.previews.at(-1)?.target_organization_uuid).toBe(created)
})

test("a moved device shows where it came from and what it reports through", async ({ page }) => {
  const moved = {
    ...device(9, "Shop tracker"),
    candidate: { ...device(9, "Shop tracker").candidate, gateway: null, adapter: null },
    pipe: { kind: "adapter", name: "Vendor trackers", owner_organization_name: "Integrator", online: true, hosted: true },
    link: { direction: "moved_from", organization_name: "Integrator", cutover_at: ago(600), history: { included: false, stopped_at: null, stopped_reason: null } },
    retention: { days: 90, source: "platform" },
    draft: null,
    draft_artifact: null,
    configurations: [],
    installations: [],
  }
  const state = await setup(page, { detail: moved })
  await page.goto(`${base}/devices/${moved.uuid}/overview`)
  await expect(page.getByRole("alert").filter({ hasText: "Moved from Integrator" })).toBeVisible()
  await expect(page.getByText("Adapter Vendor trackers")).toBeVisible()
  await expect(page.getByText("· Integrator")).toBeVisible()
  await expect(page.getByRole("link", { name: "Vendor trackers" })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("the mover includes the readings from before the move, off by default", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices`)
  await page.getByRole("checkbox", { name: "Select Tracker 41" }).check()
  await page.getByRole("button", { name: "Move to organization" }).click()
  const dialog = page.getByRole("dialog", { name: "Move Tracker 41" })
  await dialog.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Harbour Shop" }).click()
  await dialog.getByRole("button", { name: "Next" }).click()

  const option = dialog.getByRole("checkbox", { name: "Include readings from before the move" })
  await expect(option).not.toBeChecked()
  await expect(dialog.getByText("marked as recorded in Integrator")).toBeVisible()
  await option.check()
  await expect.poll(() => state.previews.at(-1)?.include_history).toBe(true)
  await axe(page)
  await dialog.getByRole("button", { name: "Next" }).click()
  await expect(dialog.getByText("Harbour Shop can read the readings from before the move.", { exact: false })).toBeVisible()
  await dialog.getByRole("button", { name: "Move device" }).click()
  await expect.poll(() => state.confirmed?.include_history).toBe(true)
  expect(state.errors).toEqual([])
})

test("the archived device stops sharing its readings from before the move", async ({ page }) => {
  const archived = {
    ...device(8, "Tracker 48"),
    lifecycle: "archived",
    presence: "offline",
    link: { direction: "moved_to", organization_name: "Harbour Shop", cutover_at: ago(600), history: { included: true, stopped_at: null, stopped_reason: null } },
    retention: { days: 90, source: "platform" },
    draft: null,
    draft_artifact: null,
    configurations: [],
    installations: [],
  }
  const state = await setup(page, { detail: archived })
  await page.goto(`${base}/devices/${archived.uuid}/overview`)
  const notice = page.getByRole("alert").filter({ hasText: "Moved to Harbour Shop" })
  await expect(notice).toContainText("Harbour Shop can read these readings in the new device’s history.")
  await notice.getByRole("button", { name: "Stop sharing history" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Stop sharing history?" })
  await expect(confirm).toContainText("Sharing can’t be turned back on.")
  await confirm.getByRole("button", { name: "Stop sharing" }).click()

  await expect.poll(() => state.stopped).toEqual({ enabled: false })
  await expect(notice).toContainText("Sharing the readings from before the move with Harbour Shop stopped")
  await expect(notice.getByRole("button", { name: "Stop sharing history" })).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("a moved device says its history includes the readings shared from before the move", async ({ page }) => {
  const moved = {
    ...device(9, "Shop tracker"),
    candidate: { ...device(9, "Shop tracker").candidate, gateway: null, adapter: null },
    pipe: { kind: "adapter", name: "Vendor trackers", owner_organization_name: "Integrator", online: true, hosted: true },
    link: { direction: "moved_from", organization_name: "Integrator", cutover_at: ago(600), history: { included: true, stopped_at: null, stopped_reason: null } },
    retention: { days: 90, source: "platform" },
    draft: null,
    draft_artifact: null,
    configurations: [],
    installations: [],
  }
  await setup(page, { detail: moved })
  await page.goto(`${base}/devices/${moved.uuid}/overview`)
  const notice = page.getByRole("alert").filter({ hasText: "Moved from Integrator" })
  await expect(notice).toContainText("Its history includes that device’s readings from before the move, marked as recorded in Integrator")
  await expect(notice.getByRole("button", { name: "Stop sharing history" })).toHaveCount(0)
})
