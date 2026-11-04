import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// Firmware starters from a device profile (spec 027 US1), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const profileId = "55555555-5555-4555-8555-555555555555"
const artifactId = "77777777-7777-4777-8777-777777777777"
const healthId = "56565656-5656-4656-8656-565656565656"
const healthArtifactId = "78787878-7878-4878-8878-787878787878"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
// An empty ZIP: the browser only has to save it.
const emptyZip = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="

const profile = (revision: number) => ({
  uuid: profileId, code: "water-meter", name: "Water meter", description: null, category: "water-metering",
  status: revision ? "published" : "draft", revision, draft_revision: revision + 1, definition_hash: "hash",
  published_at: revision ? ago(86400) : null, extensions: null, updated_at: ago(86400), parameters_count: 2, devices_count: 0,
})
const targets = [
  { id: "linux", name: "Linux or macOS", kind: "built", roles: ["direct", "gateway"], toolchain: "CMake 3.31, GCC 13 (ubuntu-24.04 runner)" },
  { id: "stm32", name: "STM32", kind: "ai_assisted", roles: ["direct", "gateway"], toolchain: null },
  { id: "other", name: "Other microcontroller", kind: "ai_assisted", roles: ["direct", "gateway"], toolchain: null },
]
const manifest = (warnings: unknown[] = []) => ({
  format: 1, sdk_version: "0.1.0", target: { id: "linux", kind: "built", name: "Linux or macOS" }, role: "direct",
  generated_at: ago(0), node: { default_health: true, c_identifier: "gateway_health" }, device_types: [], metrics: {}, retired: {},
  replaceable: ["sdk/", "generated/", ".iotos/", "AGENTS.md", "CLAUDE.md"], developer_paths: ["app/"], warnings,
})

async function setup(page: Page, { revision = 1, health = false, warnings = [] as unknown[] } = {}) {
  const state = { errors: [] as string[], starters: [] as Record<string, unknown>[] }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const context = {
    uuid: org, name: "Acme", slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: false, connections: false, activate: false, command: false },
      device_profiles: { view_any: true, view: true, create: false, update: false, delete_draft: false, validate: false, publish: false },
      features: { device_adapters: false },
    },
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1, name: "Developer", email: "developer@example.test", email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false }, organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/firmware/targets")) return json({ data: targets })
    if (path.endsWith("/firmware/starters") && request.method() === "POST") {
      state.starters.push(request.postDataJSON())
      return json({ data: { filename: "water-meter-linux-starter.zip", manifest: manifest(warnings), archive_base64: emptyZip } })
    }
    if (path.endsWith("/device-profiles")) {
      const rows = [profile(revision), ...(health ? [{ ...profile(1), uuid: healthId, code: "gateway-health", name: "Gateway health" }] : [])]
      return json({ data: rows, meta: { current_page: 1, last_page: 1, total: rows.length } })
    }
    if (path.endsWith(`/device-profiles/${profileId}/artifacts`))
      return json({ data: revision ? [{ uuid: artifactId, revision, definition_hash: "hash", status: "active", compiled_at: ago(86400) }] : [], meta: { current_page: 1, last_page: 1, total: revision ? 1 : 0 } })
    if (path.endsWith(`/device-profiles/${healthId}/artifacts`))
      return json({ data: [{ uuid: healthArtifactId, revision: 1, definition_hash: "hash", status: "active", compiled_at: ago(86400) }], meta: { current_page: 1, last_page: 1, total: 1 } })
    if (path.endsWith(`/device-profiles/${profileId}`))
      return json({ data: { ...profile(revision), parameter_groups: [], parameters: [], calculations: [], alarm_templates: [], active_artifact: null } })
    return json({ data: [] })
  })
  return state
}

async function axe(page: Page) {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
}

test("a published profile downloads a starter for a target in three actions", async ({ page }) => {
  const state = await setup(page, { warnings: [{ code: "birth_over_tx_buffer", message: "A birth of Water meter can reach about 4300 bytes.", subject: "water-meter" }] })
  await page.goto(`${base}/device-profiles/${profileId}`)

  // 1. Open Firmware.
  await page.getByRole("tablist", { name: "Profile sections" }).getByRole("tab", { name: "Firmware", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Firmware", exact: true })).toBeVisible()
  await expect(page.getByText("The starter holds no credentials.")).toBeVisible()
  // 2. Choose the target: built targets first, AI-assisted ones marked.
  await page.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  const groups = page.getByRole("group")
  await expect(groups.first()).toContainText("Built")
  await expect(groups.first().getByRole("option")).toHaveText(["Linux or macOS"])
  await expect(groups.nth(1).getByRole("option")).toHaveText(["STM32 · no tested example", "Other microcontroller · no tested example"])
  await page.getByRole("option", { name: "Linux or macOS" }).click()
  await expect(page.getByText("Builds as downloaded with CMake 3.31")).toBeVisible()
  // 3. Download.
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download starter" }).click()
  expect((await download).suggestedFilename()).toBe("water-meter-linux-starter.zip")

  expect(state.starters).toEqual([{ target: "linux", role: "direct", node_artifact_uuid: artifactId }])
  await expect(page.getByText("A birth of Water meter can reach about 4300 bytes.")).toBeVisible()
  await axe(page)
  expect(state.errors).toEqual([])
})

test("behind a gateway, the profile is a device type and the gateway health profile is the node", async ({ page }) => {
  const state = await setup(page, { health: true })
  await page.goto(`${base}/device-profiles/${profileId}/firmware`)
  await page.getByRole("combobox", { name: "Microcontroller or platform" }).click()
  await page.getByRole("option", { name: /STM32/ }).click()
  await page.getByRole("radio", { name: "Behind a gateway" }).check()
  await page.getByRole("button", { name: "Download starter" }).click()

  await expect.poll(() => state.starters).toEqual([
    { target: "stm32", role: "gateway", node_artifact_uuid: healthArtifactId, device_type_artifact_uuids: [artifactId] },
  ])
  expect(state.errors).toEqual([])
})

test("a profile without a published version asks to publish first", async ({ page }) => {
  const state = await setup(page, { revision: 0 })
  await page.goto(`${base}/device-profiles/${profileId}/firmware`)

  await expect(page.getByText("Publish to download firmware.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Download starter" })).toHaveCount(0)
  expect(state.starters).toEqual([])
  expect(state.errors).toEqual([])
})

