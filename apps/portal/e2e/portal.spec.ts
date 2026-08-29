import { expect, test as base, type Page, type Route } from "@playwright/test"

const organizations = [
  {
    uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Acme Manufacturing",
    slug: "acme-manufacturing",
  },
  {
    uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Northstar Utilities",
    slug: "northstar-utilities",
  },
]

const user = {
  id: 7,
  name: "Tenant Engineer",
  email: "engineer@example.test",
  email_verified_at: "2026-08-28T12:00:00Z",
  is_super_admin: false,
  capabilities: { platform_administration: false },
  organizations,
}

const ids = {
  profile: "11111111-1111-4111-8111-111111111111",
  profileVersion: "11111111-1111-4111-8111-111111111112",
  binding: "22222222-2222-4222-8222-222222222221",
  bindingVersion: "22222222-2222-4222-8222-222222222222",
  device: "55555555-5555-4555-8555-555555555551",
  assignment: "55555555-5555-4555-8555-555555555552",
}

type MockOptions = {
  initiallyAuthenticated?: boolean
  publishedDefinition?: boolean
}

type DefinitionPayload = {
  profile: {
    profile: { uuid?: string; name: string; key: string; description?: string | null }
    version: {
      uuid?: string
      version: number
      components: Array<{
        commands: Array<{
          fields: Array<{ key: string }>
        }>
      }>
    }
  }
  binding: {
    binding: { uuid?: string; name: string; key: string; description?: string | null }
    version: { uuid?: string; version: number }
  }
}

type MockEvidence = {
  organizationHeaders: string[]
  definitionPayload: DefinitionPayload | null
  onboardingSequence: string[]
  assignmentIfMatch: string | null
  registrationIfMatch: string | null
}

function paginated(data: unknown[]) {
  return {
    data,
    meta: {
      current_page: 1,
      from: data.length ? 1 : null,
      last_page: 1,
      per_page: 100,
      to: data.length || null,
      total: data.length,
    },
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

function versionResource(
  type: "profile" | "binding",
  state: "draft" | "published",
  definition: Record<string, unknown>,
) {
  return {
    uuid: type === "profile" ? ids.profileVersion : ids.bindingVersion,
    ...(type === "profile"
      ? { profile_uuid: ids.profile }
      : { binding_uuid: ids.binding, profile_version_uuid: ids.profileVersion }),
    version: 1,
    state,
    definition,
    revision: state === "published" ? 2 : 1,
    etag: `"${type}-version-r${state === "published" ? 2 : 1}"`,
    artifact: state === "published" ? {} : null,
    artifact_hash: state === "published" ? "a".repeat(64) : null,
    source_hash: state === "published" ? "b".repeat(64) : null,
    compiler: state === "published" ? { name: "iot-runtime", version: "test" } : null,
    published_at: state === "published" ? "2026-08-28T18:00:00Z" : null,
    retired_at: null,
    created_at: "2026-08-28T17:00:00Z",
    updated_at: "2026-08-28T18:00:00Z",
  }
}

async function mockApi(page: Page, options: MockOptions = {}): Promise<MockEvidence> {
  let authenticated = options.initiallyAuthenticated ?? true
  let definitionState: "none" | "draft" | "published" = options.publishedDefinition
    ? "published"
    : "none"
  let definitionPayload: DefinitionPayload | null = options.publishedDefinition
    ? {
        profile: {
          profile: {
            uuid: ids.profile,
            name: "Environment Sensor and Thermostat",
            key: "environment_thermostat",
          },
          version: { uuid: ids.profileVersion, version: 1, components: [] },
        },
        binding: {
          binding: {
            uuid: ids.binding,
            name: "Native MQTT firmware v1",
            key: "native_mqtt_v1",
          },
          version: { uuid: ids.bindingVersion, version: 1 },
        },
      }
    : null
  let device: Record<string, unknown> | null = null
  const evidence: MockEvidence = {
    organizationHeaders: [],
    definitionPayload: null,
    onboardingSequence: [],
    assignmentIfMatch: null,
    registrationIfMatch: null,
  }

  function profileResource() {
    if (!definitionPayload) throw new Error("Definition payload missing")

    return {
      uuid: definitionPayload.profile.profile.uuid ?? ids.profile,
      key: definitionPayload.profile.profile.key,
      name: definitionPayload.profile.profile.name,
      description: definitionPayload.profile.profile.description ?? null,
      revision: 1,
      etag: '"profile-r1"',
      archived_at: null,
      created_at: "2026-08-28T17:00:00Z",
      updated_at: "2026-08-28T18:00:00Z",
      versions_count: 1,
      versions: [
        versionResource(
          "profile",
          definitionState === "published" ? "published" : "draft",
          definitionPayload.profile.version,
        ),
      ],
    }
  }

  function currentProfileUuid() {
    return definitionPayload?.profile.profile.uuid ?? ids.profile
  }

  function currentBindingUuid() {
    return definitionPayload?.binding.binding.uuid ?? ids.binding
  }

  function bindingResource() {
    if (!definitionPayload) throw new Error("Definition payload missing")

    return {
      uuid: definitionPayload.binding.binding.uuid ?? ids.binding,
      profile_uuid: definitionPayload.profile.profile.uuid ?? ids.profile,
      key: definitionPayload.binding.binding.key,
      name: definitionPayload.binding.binding.name,
      description: definitionPayload.binding.binding.description ?? null,
      transport: "native_mqtt_json",
      revision: 1,
      etag: '"binding-r1"',
      archived_at: null,
      created_at: "2026-08-28T17:00:00Z",
      updated_at: "2026-08-28T18:00:00Z",
      versions_count: 1,
      versions: [
        versionResource(
          "binding",
          definitionState === "published" ? "published" : "draft",
          definitionPayload.binding.version,
        ),
      ],
    }
  }

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (!url.pathname.startsWith("/api/") && url.pathname !== "/sanctum/csrf-cookie") {
      await route.continue()
      return
    }

    const organizationHeader = request.headers()["x-organization-uuid"]

    if (organizationHeader) evidence.organizationHeaders.push(organizationHeader)

    if (url.pathname === "/sanctum/csrf-cookie") {
      await route.fulfill({ status: 204 })
      return
    }

    if (url.pathname === "/api/v1/me" && request.method() === "GET") {
      await fulfillJson(route, authenticated ? { data: user } : { message: "Unauthenticated." }, authenticated ? 200 : 401)
      return
    }

    if (url.pathname === "/api/v1/auth/login" && request.method() === "POST") {
      authenticated = true
      await fulfillJson(route, { data: user })
      return
    }

    if (url.pathname === "/api/v1/auth/logout" && request.method() === "POST") {
      authenticated = false
      await fulfillJson(route, {})
      return
    }

    if (url.pathname === "/api/v1/device-profiles" && request.method() === "GET") {
      await fulfillJson(route, paginated(definitionState === "none" ? [] : [profileResource()]))
      return
    }

    if (url.pathname === "/api/v1/transport-bindings" && request.method() === "GET") {
      await fulfillJson(route, paginated(definitionState === "none" ? [] : [bindingResource()]))
      return
    }

    if (
      url.pathname === `/api/v1/device-profiles/${currentProfileUuid()}` &&
      request.method() === "GET"
    ) {
      await fulfillJson(route, { data: profileResource() })
      return
    }

    if (
      url.pathname === `/api/v1/transport-bindings/${currentBindingUuid()}` &&
      request.method() === "GET"
    ) {
      await fulfillJson(route, { data: bindingResource() })
      return
    }

    if (url.pathname === "/api/v1/definition-drafts" && request.method() === "POST") {
      definitionPayload = request.postDataJSON() as DefinitionPayload
      evidence.definitionPayload = definitionPayload
      definitionState = "draft"
      await fulfillJson(route, { data: definitionPayload, etag: '"definition-r1"' }, 201)
      return
    }

    if (
      /^\/api\/v1\/definition-drafts\/[^/]+$/.test(url.pathname) &&
      request.method() === "GET"
    ) {
      await fulfillJson(route, { data: definitionPayload, etag: '"definition-r1"' })
      return
    }

    if (
      /^\/api\/v1\/definition-drafts\/[^/]+$/.test(url.pathname) &&
      request.method() === "PUT"
    ) {
      definitionPayload = request.postDataJSON() as DefinitionPayload
      evidence.definitionPayload = definitionPayload
      await fulfillJson(route, { data: definitionPayload, etag: '"definition-r1"' })
      return
    }

    if (
      /^\/api\/v1\/definition-drafts\/[^/]+\/validate$/.test(url.pathname) &&
      request.method() === "POST"
    ) {
      const fixtures = (request.postDataJSON() as { fixtures: Array<{ input: unknown }> }).fixtures
      await fulfillJson(route, {
        schema: "iot.definition-preview.v1",
        valid: true,
        input_hash: "c".repeat(64),
        compiler: {
          name: "iot-runtime",
          version: "test",
          cel_environment: "iot-os.v1",
          jsonpath_version: "restricted-v1",
          unit_registry: "ucum-v1",
        },
        diagnostics: [],
        artifact_hashes: { profile: "a".repeat(64), binding: "b".repeat(64) },
        previews: [
          {
            name: "Temperature and humidity telemetry",
            kind: "telemetry",
            valid: true,
            source: fixtures[0]?.input,
            canonical: {
              device_id: "sensor-001",
              observed_at: "2026-08-28T18:00:00Z",
              values: { "environment.temperature": 22.4, "environment.humidity": 47.8 },
            },
            stages: [
              { stage: "envelope", status: "passed", target: null },
              { stage: "extraction", status: "passed", target: "environment.temperature" },
            ],
          },
        ],
      })
      return
    }

    if (
      /^\/api\/v1\/definition-drafts\/[^/]+\/publish$/.test(url.pathname) &&
      request.method() === "POST"
    ) {
      definitionState = "published"
      await fulfillJson(route, { data: definitionPayload, etag: '"definition-r2"' })
      return
    }

    if (url.pathname === "/api/v1/devices" && request.method() === "GET") {
      await fulfillJson(route, paginated(device ? [device] : []))
      return
    }

    if (url.pathname === "/api/v1/devices" && request.method() === "POST") {
      evidence.onboardingSequence.push("create")
      const payload = request.postDataJSON() as {
        name: string
        external_id: string
        description: string | null
      }
      device = {
        uuid: ids.device,
        ...payload,
        lifecycle_state: "draft",
        revision: 1,
        etag: '"device-r1"',
        registered_at: null,
        archived_at: null,
        created_at: "2026-08-28T18:00:00Z",
        updated_at: "2026-08-28T18:00:00Z",
        definition_assignment: null,
      }
      await fulfillJson(route, { data: device }, 201)
      return
    }

    if (
      url.pathname === `/api/v1/devices/${ids.device}/definition-assignment` &&
      request.method() === "PUT"
    ) {
      evidence.onboardingSequence.push("assign")
      evidence.assignmentIfMatch = request.headers()["if-match"] ?? null
      const assignment = {
        uuid: ids.assignment,
        device_uuid: ids.device,
        profile_version_uuid: ids.profileVersion,
        binding_version_uuid: ids.bindingVersion,
        revision: 1,
        etag: '"assignment-r1"',
        locked_at: null,
        created_at: "2026-08-28T18:00:01Z",
        updated_at: "2026-08-28T18:00:01Z",
      }
      device = { ...device, revision: 2, etag: '"device-r2"', definition_assignment: assignment }
      await fulfillJson(route, { data: assignment })
      return
    }

    if (url.pathname === `/api/v1/devices/${ids.device}` && request.method() === "GET") {
      evidence.onboardingSequence.push("read")
      await fulfillJson(route, { data: device })
      return
    }

    if (
      url.pathname === `/api/v1/devices/${ids.device}/register` &&
      request.method() === "POST"
    ) {
      evidence.onboardingSequence.push("register")
      evidence.registrationIfMatch = request.headers()["if-match"] ?? null
      device = {
        ...device,
        lifecycle_state: "registered",
        revision: 3,
        etag: '"device-r3"',
        registered_at: "2026-08-28T18:00:02Z",
      }
      await fulfillJson(route, { data: device })
      return
    }

    await fulfillJson(route, { message: `Unhandled mock route: ${request.method()} ${url.pathname}` }, 404)
  })

  return evidence
}

const test = base.extend<{ consoleMessages: string[] }>({
  consoleMessages: [
    async ({ page }, use) => {
      const messages: string[] = []

      page.on("console", (message) => {
        const expectedUnauthenticatedResponse =
          message.type() === "error" &&
          message.location().url.includes("/api/v1/me") &&
          message.text().includes("401 (Unauthorized)")

        if (["error", "warning"].includes(message.type()) && !expectedUnauthenticatedResponse) {
          messages.push(`${message.type()}: ${message.text()}`)
        }
      })
      page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`))

      await use(messages)
      expect(messages).toEqual([])
    },
    { auto: true },
  ],
})

test("authenticates and switches explicit Organization context", async ({ page }) => {
  const evidence = await mockApi(page, { initiallyAuthenticated: false })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Sign in to IoT OS" })).toBeVisible()
  await page.getByRole("textbox", { name: "Email" }).fill(user.email)
  await page.getByLabel("Password").fill("password")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByRole("heading", { name: "Device definitions" })).toBeVisible()
  await page.getByRole("combobox", { name: "Organization" }).click()
  await page.getByRole("option", { name: "Northstar Utilities" }).click()

  await expect(page).toHaveURL(
    new RegExp(`/organizations/${organizations[1].uuid}/definitions$`),
  )
  await expect(page.getByText("No Device definitions yet")).toBeVisible()
  expect(evidence.organizationHeaders).toContain(organizations[1].uuid)
})

test("creates, validates, and publishes a coordinated definition", async ({ page }) => {
  const evidence = await mockApi(page)

  await page.goto(`/organizations/${organizations[0].uuid}/definitions`)
  await page.getByRole("link", { name: "Create definition" }).first().click()
  await page.getByLabel("Profile name").fill("Boiler Environment Controller")
  await page.getByLabel("Telemetry sample payload").fill(
    JSON.stringify({
      device_id: "sensor-001",
      timestamp: "2026-08-28T18:00:00Z",
      temperature: 23.1,
      humidity: 47.8,
    }),
  )
  await page.getByRole("button", { name: "Validate" }).click()

  await page.getByRole("tab", { name: "Validation" }).click()
  await expect(page.getByText("Contract validation passed")).toBeVisible()
  await expect(page.getByLabel("Telemetry sample payload")).toHaveValue(/23\.1/)
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled()
  await page.getByLabel("Binding description").fill("Updated firmware mapping.")
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled()
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled()
  await page.getByRole("button", { name: "Publish" }).click()

  await expect(page).toHaveURL(
    new RegExp(`/organizations/${organizations[0].uuid}/definitions$`),
  )
  await expect(page.getByRole("row", { name: /Boiler Environment Controller/ })).toBeVisible()
  expect(evidence.definitionPayload?.profile.profile.name).toBe("Boiler Environment Controller")
  expect(
    evidence.definitionPayload?.profile.version.components
      .flatMap((component) => component.commands)
      .flatMap((command) => command.fields)
      .some((field) => field.key === "temp_level"),
  ).toBe(true)
})

test("onboards a Device through draft, assignment, fresh read, and registration", async ({
  page,
}) => {
  const evidence = await mockApi(page, { publishedDefinition: true })

  await page.goto(`/organizations/${organizations[0].uuid}/devices/onboard`)
  await page.getByLabel("Device name").fill("Boiler room environment controller")
  await page.getByLabel("External Device ID").fill("sensor-001")
  await page.getByRole("button", { name: "Onboard Device" }).click()

  await expect(page.getByRole("heading", { name: "Device registered" })).toBeVisible()
  await expect(page.getByText("sensor-001")).toBeVisible()
  expect(evidence.onboardingSequence).toEqual(["create", "assign", "read", "register"])
  expect(evidence.assignmentIfMatch).toBe('"device-r1"')
  expect(evidence.registrationIfMatch).toBe('"device-r2"')
})

test("keeps the tenant navigation usable at a 390px mobile viewport", async ({ page }) => {
  await mockApi(page, { publishedDefinition: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/organizations/${organizations[0].uuid}/definitions`)

  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  const sidebar = page.getByRole("dialog")
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole("link", { name: "Devices" }).click()

  await expect(page).toHaveURL(new RegExp(`/organizations/${organizations[0].uuid}/devices$`))
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible()
  await expect(sidebar).toBeHidden()
})
