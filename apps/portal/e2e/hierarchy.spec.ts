import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// Spec 009 PR 6: Devices → Hierarchy with a mocked API. An empty organization starts from a
// preset, builds a branch, moves it after reading the impact, and places a parameter apart
// from its device, renaming it past a leaf name clash.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const deviceId = "11111111-1111-4111-8111-111111111111"
const parameterId = "22222222-2222-4222-8222-222222222222"
const configuration = "44444444-4444-4444-8444-444444444444"

type Row = {
  uuid: string
  name: string
  path_name: string
  type: { key: string; name: string }
  parent_uuid: string | null
}

const site = { key: "site", name: "Site", top_level: true, parent_type_keys: [] as string[], accepts_devices: true, carries_timezone: true, carries_location: true }
const presetTypes = [
  { key: "building", name: "Building", top_level: true, parent_type_keys: ["site"], accepts_devices: true, carries_timezone: false, carries_location: true },
  { key: "floor", name: "Floor", top_level: false, parent_type_keys: ["building"], accepts_devices: true, carries_timezone: false, carries_location: false },
  { key: "zone", name: "Zone", top_level: false, parent_type_keys: ["floor"], accepts_devices: true, carries_timezone: false, carries_location: false },
]
const typeView = (type: typeof site, count: number) => ({
  uuid: `type-${type.key}`,
  member_type_keys: [],
  naming: null,
  preset_keys: type.key === "site" ? [] : ["buildings"],
  entities_count: count,
  ...type,
})
const pathName = (name: string) => name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase()).replace(/^./, (c) => c.toUpperCase())

async function setup(page: Page) {
  const state = {
    applied: false,
    entities: [] as Row[],
    moved: null as null | { uuid: string; parent: string | null },
    placed: null as null | { entity: string; leaf: string },
  }
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const pathOf = (row: Row): string => {
    const parent = state.entities.find((candidate) => candidate.uuid === row.parent_uuid)
    return parent ? `${pathOf(parent)}/${row.path_name}` : row.path_name
  }
  const summary = (row: Row) => ({
    ...row,
    path: pathOf(row),
    depth: pathOf(row).split("/").length - 1,
    children_count: state.entities.filter((child) => child.parent_uuid === row.uuid).length,
    archived_at: null,
  })
  const ancestors = (row: Row): { uuid: string; name: string; path_name: string }[] => {
    const parent = state.entities.find((candidate) => candidate.uuid === row.parent_uuid)
    return parent ? [...ancestors(parent), { uuid: parent.uuid, name: parent.name, path_name: parent.path_name }] : []
  }
  const detail = (row: Row) => ({
    ...summary(row),
    ancestors: ancestors(row),
    description: null,
    timezone: row.type.key === "site" ? "Europe/Berlin" : null,
    effective_timezone: "Europe/Berlin",
    address: null,
    latitude: null,
    longitude: null,
    attributes: {},
    outside_rules: [],
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  })
  const page1 = (data: unknown[]) => ({ data, meta: { current_page: 1, last_page: 1, per_page: 100, total: data.length } })
  const context = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      devices: { view: true, manage: true, command: true },
      entities: { view: true, manage: true, manage_types: true },
    },
  }

  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const body = request.postDataJSON?.() ?? null
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/entity-types"))
      return json({
        data: [site, ...(state.applied ? presetTypes : [])].map((type) =>
          typeView(type, state.entities.filter((row) => row.type.key === type.key).length),
        ),
      })
    if (path.endsWith("/entity-presets"))
      return json({
        data: [
          {
            key: "buildings",
            name: "Buildings",
            description: "Sites, buildings, floors and zones.",
            version: 1,
            types: presetTypes.map((type) => ({ key: type.key, name: type.name, outcome: state.applied ? "present" : "add" })),
          },
        ],
      })
    if (path.endsWith("/entity-presets/buildings/apply")) {
      state.applied = true
      return json({ data: { added: presetTypes.map((type) => type.key), merged: ["site"] } })
    }
    if (path.endsWith("/entities/path-name-suggestion"))
      return json({ data: { path_name: pathName(url.searchParams.get("name") ?? "") } })
    if (path.endsWith("/entities/search")) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase()
      return json(page1(state.entities.filter((row) => row.name.toLowerCase().includes(q) || pathOf(row).toLowerCase().includes(q)).map(summary)))
    }
    if (path.endsWith("/entities") && method === "POST") {
      const all = [site, ...presetTypes]
      const type = all.find((candidate) => candidate.key === body.type_key)!
      const row: Row = {
        uuid: `00000000-0000-4000-8000-${String(state.entities.length + 1).padStart(12, "0")}`,
        name: body.name,
        path_name: body.path_name || pathName(body.name),
        type: { key: type.key, name: type.name },
        parent_uuid: body.parent_uuid ?? null,
      }
      state.entities.push(row)
      return json({ data: detail(row) }, 201)
    }
    if (path.endsWith("/entities")) {
      const parent = url.searchParams.get("parent")
      return json(page1(state.entities.filter((row) => row.parent_uuid === parent).map(summary)))
    }
    const entity = path.match(/\/entities\/([0-9a-f-]{36})(\/.*)?$/)
    if (entity) {
      const row = state.entities.find((candidate) => candidate.uuid === entity[1])
      if (!row) return json({ message: "Not found." }, 404)
      const rest = entity[2] ?? ""
      if (rest === "/move-impact")
        return json({
          data: { entities: 2, devices: 1, devices_changing_site: 1, devices_changing_timezone: 0, applications: [] },
        })
      if (rest === "/move") {
        row.parent_uuid = body.parent_uuid
        state.moved = { uuid: row.uuid, parent: body.parent_uuid }
        return json({ data: detail(row) })
      }
      if (rest === "/points")
        return json({
          data: state.placed
            ? [
                {
                  leaf_name: state.placed.leaf,
                  path: `${pathOf(row)}/${state.placed.leaf}`,
                  relative_path: state.placed.leaf,
                  device: { uuid: deviceId, name: "Energy meter" },
                  parameter: { uuid: parameterId, key: "temperature", label: "Temperature", unit: "°C" },
                  via: "parameter_placement",
                  state: "placed",
                  latest: { value: 21.5, quality: "good", observed_at: new Date().toISOString(), received_at: new Date().toISOString() },
                },
              ]
            : [],
          meta: { current_page: 1, last_page: 1, per_page: 50, total: state.placed ? 1 : 0 },
        })
      if (rest === "/devices") return json(page1([]))
      if (rest === "/memberships") return json({ data: { groups: [], members: [] } })
      return json({ data: detail(row) })
    }
    if (path.endsWith(`/parameters/${parameterId}/placement`) && method === "PUT") {
      // Zone A already has a point named temperature: the first try clashes.
      if (body.leaf_name === "temperature" || !body.leaf_name)
        return json(
          { message: "The leaf name is taken here.", errors: { leaf_name: ["Zone A already has a point named temperature. Choose another leaf name."] } },
          422,
        )
      state.placed = { entity: body.entity_uuid, leaf: body.leaf_name }
      const target = state.entities.find((candidate) => candidate.uuid === body.entity_uuid)!
      return json({
        data: {
          uuid: "pp-1",
          parameter_uuid: parameterId,
          parameter_key: "temperature",
          leaf_name: body.leaf_name,
          path: `${pathOf(target)}/${body.leaf_name}`,
          entity: { uuid: target.uuid, name: target.name, path: pathOf(target) },
          started_at: new Date().toISOString(),
          ended_at: null,
        },
      })
    }
    if (path.endsWith("/measurements/latest"))
      return json({
        data: [
          {
            parameter_uuid: parameterId,
            key: "temperature",
            label: "Temperature",
            data_type: "number",
            unit: "°C",
            value: 21.5,
            quality: "good",
            observed_at: new Date().toISOString(),
            received_at: new Date().toISOString(),
            historical: false,
          },
        ],
        presence: "online",
      })
    if (path.endsWith(`/devices/${deviceId}`))
      return json({
        data: {
          uuid: deviceId,
          code: "em-1",
          name: "Energy meter",
          lifecycle: "active",
          deployment_status: "applied",
          deployment_generation: 1,
          state_revision: 1,
          presence: "online",
          applied_configuration_uuid: configuration,
          last_applied_configuration_uuid: configuration,
          retention: { days: 90, source: "platform" },
          entity: null,
          parameter_placements: [],
          configurations: [],
        },
      })
    if (path.endsWith("/devices")) return json(page1([]))
    return json({ data: [] })
  })
  return { state, errors }
}

async function create(page: Page, button: string, type: string | null, name: string) {
  await page.getByRole("button", { name: button, exact: true }).first().click()
  const sheet = page.getByRole("dialog")
  if (type) {
    await sheet.getByRole("combobox", { name: "Type" }).click()
    await page.getByRole("option", { name: type, exact: true }).click()
  }
  await sheet.getByLabel("Name", { exact: true }).fill(name)
  await expect(sheet.getByText(`Leave it empty to use ${pathName(name)}.`)).toBeVisible()
  await sheet.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
}

test("an empty organization starts from a preset, builds a branch and moves it after reading the impact", async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.goto(`/organizations/${org}/hierarchy`)
  // Only the Site type and no entities: the page offers presets first.
  await expect(page.getByRole("heading", { name: "Start from a preset" })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole("button", { name: "Use Buildings" }).click()
  await expect(page.getByText("Nothing in the hierarchy yet", { exact: true })).toBeVisible()
  expect(state.applied).toBe(true)

  // Build Riverside plant (site) → North hall (building) → Floor 3 (floor).
  await create(page, "New entity", "Site", "Riverside plant")
  await create(page, "Add inside", "Building", "North hall")
  await create(page, "Add inside", null, "Floor 3")
  await expect(page.locator("header").getByText("RiversidePlant/NorthHall/Floor3", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Riverside plant")

  // The tree opens a level at a time and answers the arrow keys.
  await page.goto(`/organizations/${org}/hierarchy`)
  const tree = page.getByRole("treegrid", { name: "Hierarchy" })
  const plant = tree.getByRole("row", { name: /Riverside plant/ })
  await plant.focus()
  await page.keyboard.press("ArrowRight")
  await expect(tree.getByRole("row", { name: /North hall/ })).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(tree.getByRole("row", { name: /North hall/ })).toBeFocused()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  // A second building, then move North hall's floor under it: the impact shows first.
  await page.goto(`/organizations/${org}/hierarchy/${state.entities[0]!.uuid}`)
  await create(page, "Add inside", "Building", "South hall")
  const floor = state.entities.find((row) => row.name === "Floor 3")!
  await page.goto(`/organizations/${org}/hierarchy/${floor.uuid}/details`)
  await page.getByRole("button", { name: "More actions for Floor 3" }).click()
  await page.getByRole("menuitem", { name: "Move…" }).click()
  const dialog = page.getByRole("dialog", { name: "Move Floor 3" })
  await dialog.getByRole("combobox", { name: "Move under" }).click()
  await page.getByRole("combobox", { name: "Search move under" }).fill("South")
  await page.getByRole("option", { name: /^South hall/ }).click()
  await expect(dialog.getByText("Floor 3 and 1 entity below it get new paths.")).toBeVisible()
  await expect(dialog.getByText("1 device changes site.")).toBeVisible()
  await dialog.getByRole("button", { name: "Move", exact: true }).click()
  await expect(page.locator("header").getByText("RiversidePlant/SouthHall/Floor3", { exact: true })).toBeVisible()
  expect(state.moved?.parent).toBe(state.entities.find((row) => row.name === "South hall")!.uuid)
  expect(errors).toEqual([])
})

test("a parameter is placed apart from its device, renamed past a leaf name clash", async ({ page }) => {
  const { state, errors } = await setup(page)
  state.applied = true
  state.entities.push(
    { uuid: "00000000-0000-4000-8000-000000000001", name: "Riverside plant", path_name: "RiversidePlant", type: { key: "site", name: "Site" }, parent_uuid: null },
    { uuid: "00000000-0000-4000-8000-000000000002", name: "Zone A", path_name: "ZoneA", type: { key: "zone", name: "Zone" }, parent_uuid: "00000000-0000-4000-8000-000000000001" },
  )
  await page.goto(`/organizations/${org}/devices/${deviceId}/data`)
  await page.getByRole("button", { name: "Place Temperature" }).click()
  const dialog = page.getByRole("dialog", { name: "Place Temperature" })
  await dialog.getByRole("combobox", { name: "Place" }).click()
  await page.getByRole("combobox", { name: "Search place" }).fill("Zone")
  await page.getByRole("option", { name: /^Zone A/ }).click()
  await dialog.getByRole("button", { name: "Place", exact: true }).click()
  await expect(dialog.getByText("Zone A already has a point named temperature. Choose another leaf name.", { exact: true })).toBeVisible()
  await dialog.getByLabel("Leaf name").fill("SupplyTemperature")
  await dialog.getByRole("button", { name: "Place", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(state.placed).toEqual({ entity: "00000000-0000-4000-8000-000000000002", leaf: "SupplyTemperature" })

  // Zone A's points list it under its new name, with its value.
  await page.goto(`/organizations/${org}/hierarchy/00000000-0000-4000-8000-000000000002`)
  await expect(page.getByText("SupplyTemperature", { exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: /21\.5/ })).toBeVisible()
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  }
  expect(errors).toEqual([])
})
