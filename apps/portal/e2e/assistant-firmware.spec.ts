import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// The assistant's firmware offer card (spec 027 US5), against a mocked API.
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const base = `/organizations/${org}`
const profileId = "55555555-5555-4555-8555-555555555555"
const artifactId = "77777777-7777-4777-8777-777777777777"
const healthId = "56565656-5656-4656-8656-565656565656"
const healthArtifactId = "78787878-7878-4878-8878-787878787878"
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString()
// An empty ZIP: the browser only has to save it.
const emptyZip = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="

const profile = (uuid: string, code: string, name: string) => ({
  uuid, code, name, description: null, category: "water-metering", status: "published", revision: 1, draft_revision: 2,
  definition_hash: "hash", published_at: ago(86400), extensions: null, updated_at: ago(86400), parameters_count: 2, devices_count: 0,
})
const water = profile(profileId, "water-meter", "Water meter")
const health = profile(healthId, "gateway-health", "Gateway health")
const targets = [
  { id: "linux", name: "Linux or macOS", kind: "built", roles: ["direct", "gateway"], toolchain: "CMake 3.31" },
  { id: "esp32-esp-idf", name: "ESP32 (ESP-IDF)", kind: "built", roles: ["direct", "gateway"], toolchain: "ESP-IDF v5.4.1" },
]
const run = {
  id: "r-1", request_id: "q-1", status: "completed", prompt: "I want to write ESP32 firmware for the water meter.",
  answer: "Here is a starter for the Water meter on ESP32.", source_ids: [], usage: null, cost_usd: 0.01,
  error_code: null, error_message: null, created_at: ago(120),
}

async function setup(page: Page, { enabled = true, role = "direct" } = {}) {
  const state = { errors: [] as string[], starters: [] as Record<string, unknown>[] }
  page.on("pageerror", (error) => state.errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) state.errors.push(message.text())
  })
  const capabilities = { view_any: true, view: true, create: true, update: true, delete_draft: true, validate: true, publish: true }
  const context = {
    uuid: org, name: "Acme", slug: "acme",
    capabilities: {
      manage_administration: false,
      devices: { view: true, manage: true, connections: true, activate: true, command: true },
      device_profiles: capabilities,
      features: { device_adapters: true },
    },
  }
  const offer = { profile_uuid: profileId, target: "esp32-esp-idf", role, at: ago(100) }
  const conversation = (scope: "profile" | "onboarding") => ({
    id: `c-${scope}`, title: "Water meter firmware", scope, profile_uuid: scope === "profile" ? profileId : null,
    profile_name: scope === "profile" ? "Water meter" : null, adapter_uuid: null, updated_at: ago(100),
  })
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    const json = (data: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) })
    const page1 = (data: unknown[]) => json({ data, meta: { current_page: 1, last_page: 1, total: data.length } })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1, name: "Developer", email: "developer@example.test", email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false }, organizations: [context],
        },
      })
    if (path.endsWith("/context")) return json({ data: context })
    if (path.endsWith("/help/page"))
      return json({ data: { key: url.searchParams.get("context"), title: "Help", overview: "help", articles: [] } })
    if (path.endsWith("/assistant/settings")) {
      const scope = url.searchParams.get("scope")
      return json({
        data: scope === "help"
          ? { enabled }
          : { enabled, provider: { label: "OpenAI" }, capabilities, schema: {}, supported_extensions: [], max_file_bytes: 100000 },
      })
    }
    if (path.endsWith("/assistant/conversations"))
      return json({ data: [conversation(url.searchParams.get("scope") === "onboarding" ? "onboarding" : "profile")] })
    const scope = path.endsWith("/assistant/conversations/c-profile") ? "profile" : path.endsWith("/assistant/conversations/c-onboarding") ? "onboarding" : null
    if (scope)
      return json({
        data: {
          ...conversation(scope), runs: [run], sources: [], proposals: [], adapter_proposals: [],
          onboarding_state: { firmware_offer: offer }, cursor: 0,
        },
      })
    if (path.endsWith("/events")) return json({ data: { events: [], active: false } })
    if (path.endsWith("/firmware/targets")) return json({ data: targets })
    if (path.endsWith("/firmware/starters") && request.method() === "POST") {
      state.starters.push(request.postDataJSON())
      return json({ data: { filename: "water-meter-esp32-esp-idf-starter.zip", manifest: null, archive_base64: emptyZip } })
    }
    if (path.endsWith("/device-profiles")) return page1([water, health])
    if (path.endsWith(`/device-profiles/${profileId}/artifacts`))
      return page1([{ uuid: artifactId, revision: 1, definition_hash: "hash", status: "active", compiled_at: ago(86400) }])
    if (path.endsWith(`/device-profiles/${healthId}/artifacts`))
      return page1([{ uuid: healthArtifactId, revision: 1, definition_hash: "hash", status: "active", compiled_at: ago(86400) }])
    if (path.endsWith(`/device-profiles/${profileId}`))
      return json({ data: { ...water, parameter_groups: [], parameters: [], calculations: [], alarm_templates: [], active_artifact: null } })
    if (path.endsWith("/device-adapters")) return json({ data: [], tenant: null, capabilities: context.capabilities.devices })
    return page1([])
  })
  return state
}

async function openConversation(page: Page, region: string) {
  await page.locator('[data-slot="page-header"]').first().getByRole("button", { name: "Assistant", exact: true }).click()
  const chat = page.getByRole("complementary", { name: "Assistant", exact: true }).getByRole("region", { name: region })
  await chat.getByRole("combobox", { name: "Conversation" }).click()
  await page.getByRole("option", { name: "Water meter firmware" }).click()
  await expect(chat.getByText("Here is a starter for the Water meter on ESP32.")).toBeVisible()
  return chat
}

test("the profile assistant's card downloads the starter in one press", async ({ page }) => {
  const state = await setup(page)
  await page.goto(`${base}/device-profiles/${profileId}`)
  const chat = await openConversation(page, "Profile assistant")

  await expect(chat.getByText("ESP32 (ESP-IDF) starter for Water meter")).toBeVisible()
  const download = page.waitForEvent("download")
  await chat.getByRole("button", { name: "Download starter" }).click()
  expect((await download).suggestedFilename()).toBe("water-meter-esp32-esp-idf-starter.zip")
  expect(state.starters).toEqual([{ target: "esp32-esp-idf", role: "direct", node_artifact_uuid: artifactId }])
  await expect(chat.getByRole("status").filter({ hasText: "Downloaded." })).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  expect((await new AxeBuilder({ page }).include('[aria-label="Profile assistant"]').analyze()).violations).toEqual([])
  expect(state.errors).toEqual([])
})

test("the onboarding assistant's card builds a gateway starter behind the health profile", async ({ page }) => {
  const state = await setup(page, { role: "gateway" })
  await page.goto(`${base}/devices/onboard`)
  const chat = await openConversation(page, "Onboarding assistant")

  await expect(chat.getByText("ESP32 (ESP-IDF) starter for Water meter")).toBeVisible()
  await expect(chat).toContainText("For a gateway that reads devices of this profile")
  await chat.getByRole("button", { name: "Download starter" }).click()
  await expect.poll(() => state.starters).toEqual([
    { target: "esp32-esp-idf", role: "gateway", node_artifact_uuid: healthArtifactId, device_type_artifact_uuids: [artifactId] },
  ])
  expect(state.errors).toEqual([])
})

test("nothing is offered while the assistant is disabled", async ({ page }) => {
  const state = await setup(page, { enabled: false })
  await page.goto(`${base}/device-profiles/${profileId}`)
  const chat = await openConversation(page, "Profile assistant")

  await expect(chat.getByText("Assistant unavailable")).toBeVisible()
  await expect(chat.getByText("ESP32 (ESP-IDF) starter for Water meter")).toHaveCount(0)
  await expect(chat.getByRole("button", { name: "Download starter" })).toHaveCount(0)
  expect(state.starters).toEqual([])
  expect(state.errors).toEqual([])
})
