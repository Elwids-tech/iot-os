import { test, expect, type Page } from "@playwright/test"

const organization = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const northstar = "5d0c1f9e-7a44-4f7e-9d6b-0c1f2a3b4c5d"
const dashboardsPath = `/organizations/${organization}/dashboards`
const homePath = `/organizations/${organization}/home`
const overview = (unacknowledged = 0) => ({
  devices: { active: 3, online: 2, offline: 0, unknown: 1, registered: 0, deactivated: 0, silent: 0 },
  alerts: { active: unacknowledged, active_unacknowledged: unacknowledged, unacknowledged, last_24_hours: unacknowledged, latest_active: [] },
  automations: { applied: 1 },
  discovery: { pending: 0 },
  commands: { uncertain: 0, recent: [] },
})
const acme = {
  uuid: organization,
  name: "Acme",
  slug: "acme",
  capabilities: { devices: { view: true, manage: true, command: true } },
}

async function setup(
  page: Page,
  options: {
    organizations?: (typeof acme)[]
    platformAdministration?: boolean
    unacknowledgedAlerts?: number
  } = {},
) {
  const errors: string[] = []
  let signedIn = true
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      errors.push(message.text())
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      })
    if (path === "/api/v1/auth/logout") {
      signedIn = false
      return json({})
    }
    if (path === "/api/v1/me")
      return signedIn
        ? json({
            data: {
              id: 1,
              name: "Operator",
              email: "operator@example.test",
              email_verified_at: "2026-01-01",
              capabilities: {
                platform_administration: options.platformAdministration ?? false,
              },
              organizations: options.organizations ?? [acme],
            },
          })
        : json({ message: "Unauthenticated." }, 401)
    if (path.endsWith("/context")) return json({ data: acme })
    if (path.endsWith("/overview")) return json({ data: overview(options.unacknowledgedAlerts) })
    if (path.endsWith("/runtime-status"))
      return json({ data: { state: "operational", live_data: "available", automations: "running", automation_fault: null, since: null, checked_at: "2026-10-09T00:00:00Z" } })
    if (path.endsWith("/dashboards")) return json({ data: [] })
    if (path.endsWith("/devices"))
      return json({
        data: [],
        meta: { current_page: 1, last_page: 1, total: 0 },
      })
    return json({ data: [] })
  })
  return { errors, signIn: () => { signedIn = true } }
}

test("desktop navigation collapses to icon tooltips", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(dashboardsPath)
  await page.locator('[data-sidebar="rail"]').click()
  const sidebar = page.locator('[data-slot="sidebar"][data-state]')
  await expect(sidebar).toHaveAttribute("data-state", "collapsed")
  const labels = sidebar
    .getByRole("navigation", { name: "Workspace" })
    .locator('[data-sidebar="menu-button"] > span')
  // Home, Dashboards, Alerts · Devices, Gateways, Sites, Geofences · Automations, Device profiles ·
  // Discovery, Integrations · Telemetry viewer. Device adapters needs the organization feature.
  await expect(labels).toHaveCount(12)
  for (const label of await labels.all()) {
    await expect(label).toHaveCSS("position", "absolute")
    await expect(label).toHaveCSS("width", "1px")
    await expect(label).toHaveCSS("clip-path", "inset(50%)")
  }
  const switcher = sidebar.getByRole("button", { name: "Organization: Acme" })
  await expect(switcher).toHaveCSS("width", "32px")
  await expect(switcher.locator("svg:visible")).toHaveCount(0)
  await page.getByRole("link", { name: "Devices" }).hover()
  await expect(page.getByRole("tooltip", { name: "Devices" })).toBeVisible()
  expect(errors).toEqual([])
})

for (const theme of ["light", "dark"]) {
  test(`${theme} navigation highlights only the current route and restores labels`, async ({ page }) => {
    const { errors } = await setup(page)
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme)
    await page.goto(dashboardsPath)
    const sidebar = page.locator('[data-slot="sidebar"][data-state]')
    const dashboard = sidebar.getByRole("link", { name: "Dashboards", exact: true })
    await expect(sidebar.locator('[data-active]')).toHaveCount(1)
    await expect(dashboard).toHaveAttribute("aria-current", "page")
    await expect(dashboard).toHaveAttribute("data-active", "true")
    const background = await sidebar.locator('[data-slot="sidebar-inner"]').evaluate(el => getComputedStyle(el).backgroundColor)
    expect(background).not.toBe("rgba(0, 0, 0, 0)")
    await page.locator('[data-sidebar="rail"]').click()
    const devices = sidebar.getByRole("link", { name: "Devices", exact: true })
    await devices.click()
    await expect(page).toHaveURL(`/organizations/${organization}/devices`)
    await expect(sidebar.locator('[data-active]')).toHaveCount(1)
    await expect(devices).toHaveAttribute("data-active", "true")
    await expect(devices).toHaveAttribute("aria-current", "page")
    // Move away from the links so hover cannot mask the active background.
    await page.getByRole("main").hover({ position: { x: 300, y: 100 } })
    await expect(dashboard).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    expect(await devices.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
    await page.goBack()
    await expect(dashboard).toHaveAttribute("data-active", "true")
    await page.locator('[data-sidebar="rail"]').click()
    await expect(dashboard.locator("span")).toHaveCSS("position", "static")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    expect(errors).toEqual([])
  })
}

test("mobile navigation opens, changes section, and closes", async ({ page }) => {
  const { errors } = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(dashboardsPath)
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  const devices = page.getByRole("link", { name: "Devices" })
  await expect(devices).toBeVisible()
  await devices.click()
  await expect(page).toHaveURL(`/organizations/${organization}/devices`)
  await expect(devices).not.toBeVisible()
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})

test("mobile page header opens the sidebar to choose an organization", async ({ page }) => {
  const { errors } = await setup(page, {
    organizations: [acme, { ...acme, uuid: northstar, name: "Northstar", slug: "northstar" }],
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Choose an organization", level: 1 })).toBeVisible()
  await expect(page).toHaveTitle("Choose an organization · IoT OS")
  await expect(page.getByRole("link", { name: /Northstar/ })).toHaveAttribute("href", `/organizations/${northstar}/home`)
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await page.getByRole("button", { name: "Choose organization" }).click()
  await page.getByRole("menuitemradio", { name: "Northstar" }).click()
  await expect(page).toHaveURL(`/organizations/${northstar}/home`)
  expect(errors).toEqual([])
})

test("organization switcher keeps the section and marks the current organization", async ({ page }) => {
  const { errors } = await setup(page, {
    organizations: [acme, { ...acme, uuid: northstar, name: "Northstar", slug: "northstar" }],
  })
  await page.goto(`/organizations/${organization}/devices`)
  await page.getByRole("button", { name: "Organization: Acme" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Acme" })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("menuitemradio", { name: "Northstar" })).toHaveAttribute("aria-checked", "false")
  await page.getByRole("menuitemradio", { name: "Northstar" }).click()
  await expect(page).toHaveURL(`/organizations/${northstar}/devices`)
  await expect(page.getByRole("button", { name: "Organization: Northstar" })).toBeVisible()
  expect(errors).toEqual([])
})

test("sign-in lands on home and an unknown workspace lists organizations", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto("/")
  await expect(page).toHaveURL(homePath)
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible()
  await expect(page.getByText("All clear. Nothing needs attention right now.")).toBeVisible()
  await page.goto("/organizations/unknown/devices")
  await expect(page.getByRole("heading", { name: "Workspace unavailable", level: 1 })).toBeVisible()
  await page.getByRole("link", { name: /Acme/ }).click()
  await expect(page).toHaveURL(homePath)
  expect(errors).toEqual([])
})

test("the last organization is remembered across sign-outs", async ({ page }) => {
  const { errors, signIn } = await setup(page, {
    organizations: [acme, { ...acme, uuid: northstar, name: "Northstar", slug: "northstar" }],
  })
  await page.goto(`/organizations/${northstar}/devices`)
  await page.getByRole("button", { name: "Operator" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
  signIn()
  await page.reload()
  await expect(page).toHaveURL(`/organizations/${northstar}/home`)
  expect(errors).toEqual([])
})

test("alert count, integrations and administration follow the session", async ({ page }) => {
  const { errors } = await setup(page, {
    organizations: [{ ...acme, capabilities: { devices: { view: true, manage: false, command: false } } }],
    platformAdministration: true,
    unacknowledgedAlerts: 3,
  })
  await page.goto(dashboardsPath)
  await expect(page.getByRole("link", { name: "Alerts 3 unacknowledged" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Integrations" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Discovery" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Telemetry viewer" })).toHaveCount(0)
  await page.getByRole("button", { name: "Operator" }).click()
  await expect(page.getByRole("menuitem", { name: "Administration" })).toHaveAttribute("href", /^http/)
  expect(errors).toEqual([])
})

test("user menu changes theme and skin, then signs out", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(dashboardsPath)
  await expect(page.locator("html")).toHaveAttribute("data-skin", "console")
  await page.getByRole("button", { name: "Operator" }).click()
  await expect(page.getByRole("menuitem", { name: "Administration" })).toHaveCount(0)
  await page.getByRole("menuitemradio", { name: "Dark" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("button", { name: "Operator" }).click()
  await page.getByRole("menuitemradio", { name: "Flight deck" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-skin", "flight-deck")
  expect(await page.evaluate(() => localStorage.getItem("iot-skin"))).toBe("flight-deck")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-skin", "flight-deck")
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("B612")
  await page.getByRole("button", { name: "Operator" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
  expect(errors).toEqual([])
})

test("session recovery offers sign out", async ({ page }) => {
  const { errors } = await setup(page)
  await page.goto(dashboardsPath)
  await expect(page.getByRole("link", { name: "Dashboards", exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event("iot-session-expired")))
  const dialog = page.getByRole("dialog", { name: "Restore your session" })
  await dialog.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Welcome to your workspace" })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})
