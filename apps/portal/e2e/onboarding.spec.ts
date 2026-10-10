import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const gatewayId = "66666666-6666-4666-8666-666666666666"
const profileId = "55555555-5555-4555-8555-555555555555"
const settingUp = "12121212-1212-4212-8212-121212121212"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()

const gateway = {
  uuid: gatewayId,
  name: "Boiler room gateway",
  edge_node_id: "boiler-room",
  connection_uuid: "88888888-8888-4888-8888-888888888888",
  group_id: `org-${org}`,
  presence: "online",
  last_seen_at: ago(3),
  sources_count: 2,
}
const waiting = {
  uuid: "99999999-9999-4999-8999-999999999999",
  assigned_device_uuid: null,
  setup_device_uuid: null,
  source_device_id: "boiler-2",
  status: "pending",
  presence: "online",
  session_id: null,
  birth_revision: 1,
  metrics: [{ name: "temperature", datatype: "Double", value: 61.5 }],
  last_seen_at: ago(5),
  gateway,
}
// A direct device mid-setup: its own node-level source, not yet reserved.
const claimed = {
  ...waiting,
  uuid: "abababab-abab-4bab-8bab-abababababab",
  source_device_id: "",
  setup_device_uuid: settingUp,
  gateway: { ...gateway, uuid: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", name: "Water meter" },
}
const profile = {
  uuid: profileId,
  code: "water-meter",
  name: "Water meter",
  description: null,
  category: "water-metering",
  status: "published",
  revision: 1,
  draft_revision: 3,
  definition_hash: "hash",
  published_at: ago(172800),
  extensions: null,
  updated_at: ago(172800),
  parameters_count: 2,
  devices_count: 1,
}

async function setup(page: Page, { adapters = true, status = "published" } = {}) {
  const state = { errors: [] as string[] }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource"))
      state.errors.push(message.text())
  })
  const context = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: true, connections: true, activate: true, command: true },
      device_profiles: { view_any: true, view: true, create: true, update: true, delete_draft: true, validate: true, publish: true },
      features: { device_adapters: adapters },
    },
  }
  const current = { ...profile, status }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) =>
      json({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
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
    if (path.endsWith("/discovery-candidates"))
      return page1(url.searchParams.get("available") === "1" ? [waiting] : [waiting, claimed])
    if (path.endsWith("/gateways")) return page1([gateway])
    if (path.endsWith("/sparkplug-connections"))
      return page1([
        { uuid: gateway.connection_uuid, name: "Plant broker", group_id: `org-${org}`, host_id: "h", status: "ready", diagnostic: null },
      ])
    if (path.endsWith("/device-adapters"))
      return adapters
        ? json({ data: [], tenant: null, capabilities: context.capabilities.devices })
        : json({ message: "Not found." }, 404)
    if (path.endsWith("/device-profiles")) return page1([current])
    if (path.endsWith(`/device-profiles/${profileId}`))
      return json({ data: { ...current, parameter_groups: [], parameters: [], alarm_templates: [], active_artifact: null } })
    if (path.endsWith("/devices") || path.endsWith("/artifacts")) return page1([])
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("adding a device starts from how it sends data", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/devices/onboard`)
  await expect(page.getByRole("heading", { name: "How does this device send data?" })).toBeVisible()
  const choices = page.getByRole("radiogroup", { name: "How the device sends data" })
  await expect(choices.getByRole("radio")).toHaveCount(4)
  await expect(choices.getByText("1 waiting")).toBeVisible()
  await axe(page)

  await choices.getByText("It’s already sending data").click()
  const sources = page.getByRole("region", { name: "Sources waiting to be added" })
  await expect(sources.getByRole("row", { name: /boiler-2/ })).toBeVisible()
  await expect(page.getByLabel("Device name")).toHaveCount(0)
  await sources.getByRole("button", { name: "Add boiler-2 as a device" }).click()
  await expect(page.getByRole("dialog", { name: "Onboard boiler-2" })).toBeVisible()
  await page.keyboard.press("Escape")

  await choices.getByText("Sparkplug B", { exact: false }).first().click()
  await expect(page.getByRole("link", { name: "Create or publish a profile" })).toHaveAttribute(
    "href",
    `${base}/device-profiles?returnTo=${encodeURIComponent(`${base}/devices/onboard`)}`,
  )

  await choices.getByText("Manufacturer MQTT / JSON").click()
  await page.getByRole("link", { name: "Continue to device adapters" }).click()
  await expect(page).toHaveURL(`${base}/device-adapters`)
  expect(state.errors).toEqual([])
})

test("the adapter choice is hidden when device adapters are off", async ({ page }) => {
  const state = await setup(page, { adapters: false })
  await page.goto(`${base}/devices/onboard`)
  const choices = page.getByRole("radiogroup", { name: "How the device sends data" })
  await expect(choices.getByRole("radio")).toHaveCount(3)
  await expect(page.getByText("Manufacturer MQTT / JSON")).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("profile setup keeps a way back to device setup", async ({ page }) => {
  const state = await setup(page, { status: "draft" })
  const back = `${base}/devices/onboard`
  await page.goto(`${base}/device-profiles?returnTo=${encodeURIComponent(back)}`)
  await expect(page.getByText("Setting up a device")).toBeVisible()
  const row = page.getByRole("row", { name: /Water meter/ })
  await expect(row.getByRole("cell", { name: "Water metering", exact: true })).toBeVisible()
  await row.getByRole("link", { name: "Water meter" }).click()
  await expect(page).toHaveURL(/returnTo=/)
  await expect(page.getByText("Publish this profile, then return to device setup.")).toBeVisible()
  await expect(page.getByText("Live: version 1", { exact: true })).toBeVisible()
  await expect(page.getByText(/^Draft changes saved 2 d ago$/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Publish as version 2", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Review and publish" }).click()
  await expect(page).toHaveURL(/\/review\?returnTo=/)
  await expect(page.getByRole("link", { name: "Back to device setup" })).toHaveAttribute("href", back + "?profile=" + profileId)
  await axe(page)

  // An open returnTo pointing elsewhere is ignored.
  await page.goto(`${base}/device-profiles/${profileId}/overview?returnTo=${encodeURIComponent("https://evil.example/organizations/x")}`)
  await expect(page.getByRole("heading", { name: "Water meter", level: 1 })).toBeVisible()
  await expect(page.getByText("Setting up a device")).toHaveCount(0)
  expect(state.errors).toEqual([])
})

test("a live profile with no changes points back to device setup", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/device-profiles/${profileId}/overview?returnTo=${encodeURIComponent(`${base}/devices/onboard`)}`)
  await expect(page.getByText("Version 1 is live", { exact: true })).toBeVisible()
  await expect(page.getByText("No changes since version 1", { exact: true })).toBeVisible()
  const publish = page.getByRole("button", { name: "Publish as version 2", exact: true })
  await expect(publish).toBeDisabled()
  await expect(publish).toHaveAttribute("data-variant", "outline")
  await expect(page.getByRole("link", { name: "Back to device setup" })).toHaveAttribute("data-variant", "default")
  await axe(page)
  expect(state.errors).toEqual([])
})

test("discovery and gateways use plain language and keep identifiers in details", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/discovery`)
  const claimedRow = page.getByRole("row", { name: /Measurements from Water meter/ })
  await expect(claimedRow.getByRole("link", { name: "Resume setup" })).toHaveAttribute(
    "href",
    `${base}/devices/onboard/${settingUp}?step=3`,
  )
  await expect(claimedRow.getByRole("button")).toHaveCount(0)
  await expect(page.getByRole("row", { name: /boiler-2/ }).getByRole("button", { name: "Onboard" })).toBeVisible()
  await expect(page.getByText("Announced revision")).toHaveCount(0)
  await axe(page)

  await page.goto(`${base}/gateways?gateway=${gatewayId}`)
  await expect(page.getByRole("columnheader", { name: "Group" })).toHaveCount(0)
  await expect(page.getByText(`org-${org}`)).toHaveCount(0)
  const rail = page.getByRole("complementary", { name: "Selected gateway" })
  await rail.getByRole("button", { name: "Technical details" }).click()
  await expect(rail.getByText(`org-${org}`)).toBeVisible()
  await expect(rail.getByRole("button", { name: "Copy Group ID" })).toBeVisible()
  await axe(page)
  expect(state.errors).toEqual([])
})
