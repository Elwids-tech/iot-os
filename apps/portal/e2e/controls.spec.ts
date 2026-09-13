import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import profile from "../../../contracts/definitions/device-profiles/rgb-light.v2.json" with { type: "json" }

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a",
  deviceId = "11111111-1111-4111-8111-111111111111",
  configuration = "44444444-4444-4444-8444-444444444444"
const path = `/organizations/${org}`
async function setup(page: Page, commandPermission = true) {
  const state = {
    power: false,
    color: "#FF0000",
    mode: "solid",
    brightness: 100,
  } as Record<string, unknown>
  const controls = {
    online: true,
    outcome: "observed",
    sendCount: 0,
    commands: [] as Record<string, any>[],
    errors: [] as string[],
    state,
  }
  page.on("pageerror", (error) => controls.errors.push(error.message))
  const sources = profile.parameters.map((parameter) => ({
    device_uuid: deviceId,
    parameter_uuid: parameter.uuid,
    device_name: "RGB example",
    label: parameter.label,
    data_type: parameter.data_type,
    unit: parameter.unit,
    precision: null,
    color: "#2563eb",
    base: { label: "Current", color: "#64748b" },
    thresholds: [],
  }))
  const dashboard = {
    uuid: "rgb",
    name: "RGB controls",
    revision: 1,
    widgets: [
      {
        id: "controls",
        schema_version: 2,
        type: "controls",
        title: "RGB LED",
        description: "",
        config: { sources },
      },
    ],
    layouts: { lg: [{ i: "controls", x: 0, y: 0, w: 12, h: 16 }] },
    defaults: {
      range: { mode: "relative", preset: "6h" },
      timezone: "browser",
      refresh: 0,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      })
    if (p.endsWith("/context"))
      return json({
        data: {
          uuid: org,
          name: "Acme",
          slug: "acme",
          capabilities: {
            devices: { view: true, manage: true, command: commandPermission },
          },
        },
      })
    if (p === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [
            {
              uuid: org,
              name: "Acme",
              slug: "acme",
              capabilities: {
                devices: {
                  view: true,
                  manage: true,
                  command: commandPermission,
                },
              },
            },
          ],
        },
      })
    if (p.endsWith("/dashboards")) return json({ data: [dashboard] })
    if (p.endsWith("/dashboards/rgb")) return json({ data: dashboard })
    if (p.endsWith("/commands/send")) {
      controls.sendCount++
      const request = route.request().postDataJSON(),
        parameter = profile.parameters.find(
          (p) => p.uuid === request.parameter_uuid,
        )!
      const c = {
        ...request,
        uuid: `command-${controls.sendCount}`,
        actor_name: "Operator",
        status: "pending",
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        completed_at: null,
        expires_at: new Date(Date.now() + 30000).toISOString(),
        diagnostic: null,
      }
      controls.commands.unshift(c)
      await json({ data: c }, 201)
      setTimeout(() => {
        c.status = controls.outcome
        if (controls.outcome === "observed")
          state[parameter.key] = request.value
      }, 1200)
      return
    }
    if (p.endsWith("/commands")) return json({ data: controls.commands })
    if (p.endsWith("/measurements/latest"))
      return json({
        configuration_uuid: configuration,
        presence: controls.online ? "online" : "offline",
        data: profile.parameters.map((parameter) => ({
          parameter_uuid: parameter.uuid,
          key: parameter.key,
          label: parameter.label,
          data_type: parameter.data_type,
          unit: parameter.unit,
          value: state[parameter.key],
          quality: controls.online ? "good" : "stale",
          received_at: new Date().toISOString(),
          observed_at: new Date().toISOString(),
          historical: false,
        })),
      })
    if (p.endsWith("/devices"))
      return json({
        data: [{ uuid: deviceId, name: "RGB example" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    if (p.endsWith(`/devices/${deviceId}`))
      return json({
        data: {
          uuid: deviceId,
          code: "rgb",
          name: "RGB example",
          lifecycle: "active",
          deployment_status: "applied",
          deployment_generation: 1,
          state_revision: 1,
          presence: controls.online ? "online" : "offline",
          applied_configuration_uuid: configuration,
          configurations: [
            {
              uuid: configuration,
              revision: 1,
              definition: {
                profile_canonical_json: JSON.stringify(profile),
                mappings: profile.parameters.map((p) => ({
                  parameter_uuid: p.uuid,
                  metric: p.label,
                  command_metric: p.label,
                })),
              },
            },
          ],
        },
      })
    return json({ data: [] })
  })
  return controls
}
test("direct controls preserve actual state, deduplicate edits, and receive local changes", async ({
  page,
}) => {
  const controls = await setup(page)
  await page.goto(`${path}/devices/${deviceId}/controls`)
  await page.getByRole("switch", { name: "Power" }).click()
  await expect(page.getByText("Applying true…", { exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Power" })).toBeDisabled()
  await expect(page.getByRole("switch", { name: "Power" })).toBeEnabled()
  await expect(
    page.getByText("Power updated successfully.", { exact: true }),
  ).toBeAttached()
  await expect(
    page.getByText("Target state observed", { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText("online", { exact: true })).toHaveAttribute(
    "data-variant",
    "success",
  )
  expect(controls.sendCount).toBe(1)
  controls.state.power = false
  await expect(page.getByRole("switch", { name: "Power" })).not.toBeChecked()
  const brightness = page.getByRole("spinbutton", { name: "Brightness (%)" })
  await brightness.fill("42")
  controls.state.brightness = 17
  await expect(brightness).toHaveValue("42")
  await expect(page.getByText(/Reported:/)).toHaveCount(0)
  await brightness.press("Enter")
  await brightness.blur()
  await expect(brightness).toBeEnabled()
  await expect.poll(() => controls.sendCount).toBe(2)
  await page
    .getByRole("radio", { name: "blink", exact: true })
    .count()
    .then(async (count) => {
      await page
        .getByRole(count ? "radio" : "button", { name: "blink", exact: true })
        .click()
    })
  await expect.poll(() => controls.state.mode).toBe("blink")
  const selectedMode = page.locator(
    '[data-slot="toggle-group-item"][data-state="on"]',
  )
  await expect(selectedMode).toHaveCount(1)
  expect(
    await selectedMode.evaluate((element) => {
      const style = getComputedStyle(element)
      const channels = (color: string) =>
        (() => {
          const canvas = document.createElement("canvas")
          canvas.width = 1
          canvas.height = 1
          const context = canvas.getContext("2d")!
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
        })()
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4,
          )
      const luminance = (color: string) => {
        const [red, green, blue] = channels(color)
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      const foreground = luminance(style.color)
      const background = luminance(style.backgroundColor)
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      )
    }),
  ).toBeGreaterThanOrEqual(4.5)
  await page.getByLabel("Color", { exact: true }).fill("#aabbcc")
  await page.getByLabel("Color", { exact: true }).press("Enter")
  await expect.poll(() => controls.state.color).toBe("#AABBCC")
  await expect(page.getByLabel("Color picker")).toBeEnabled()
  await page.getByLabel("Color picker").fill("#112233")
  await expect.poll(() => controls.state.color).toBe("#112233")
  const slider = page.getByRole("slider", { name: "Brightness", exact: true })
  await expect(slider).toBeEnabled()
  expect((await slider.boundingBox())!.height).toBeGreaterThan(0)
  await slider.press("ArrowRight")
  await expect.poll(() => controls.state.brightness).toBe(43)
  expect(controls.sendCount).toBe(6)
  expect(controls.errors).toEqual([])

  controls.online = false
  await page.reload()
  await expect(page.getByText("offline", { exact: true })).toHaveAttribute(
    "data-variant",
    "destructive",
  )
})
test("dashboard controls disable offline and editing, without losing pending outcomes", async ({
  page,
}) => {
  const controls = await setup(page)
  await page.goto(`${path}/dashboards/rgb`)
  await page.getByRole("switch", { name: "Power" }).click()
  await expect(page.getByRole("switch", { name: "Power" })).toBeEnabled()
  controls.online = false
  await expect(page.getByRole("switch", { name: "Power" })).toBeDisabled()
  controls.online = true
  await expect(page.getByRole("switch", { name: "Power" })).toBeEnabled()
  controls.outcome = "uncertain"
  await page.getByRole("switch", { name: "Power" }).click()
  await expect(
    page.getByText("Update could not be confirmed.", { exact: true }),
  ).toBeVisible()
  expect(controls.sendCount).toBe(2)
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click()
  await expect(page.getByRole("switch", { name: "Power" })).toBeDisabled()
  await page.getByRole("button", { name: "Panel menu: RGB LED" }).click()
  await page.getByRole("menuitem", { name: "Edit panel", exact: true }).click()
  await page.getByLabel("Panel title", { exact: true }).fill("Living room")
  await page
    .getByRole("button", { name: "Apply to dashboard", exact: true })
    .click()
  await page.getByRole("link", { name: "All dashboards", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  expect(controls.sendCount).toBe(2)
  expect(controls.errors).toEqual([])
})
test("view-only controls remain disabled and accessible", async ({ page }) => {
  await setup(page, false)
  await page.goto(`${path}/devices/${deviceId}/controls`)
  await expect(page.getByRole("switch", { name: "Power" })).toBeDisabled()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
