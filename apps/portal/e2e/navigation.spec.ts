import { test, expect, type Page } from "@playwright/test"

const organization = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const dashboardsPath = `/organizations/${organization}/dashboards`

async function setup(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      errors.push(message.text())
  })
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      })
    if (path === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: "2026-01-01",
          capabilities: { platform_administration: false },
          organizations: [
            {
              uuid: organization,
              name: "Acme",
              slug: "acme",
              capabilities: {
                devices: { view: true, manage: true, command: true },
              },
            },
          ],
        },
      })
    if (path.endsWith("/context"))
      return json({
        data: {
          uuid: organization,
          name: "Acme",
          slug: "acme",
          capabilities: { devices: { view: true, manage: true, command: true } },
        },
      })
    if (path.endsWith("/dashboards")) return json({ data: [] })
    if (path.endsWith("/devices"))
      return json({
        data: [],
        meta: { current_page: 1, last_page: 1, total: 0 },
      })
    return json({ data: [] })
  })
  return errors
}

test("desktop navigation collapses to icon tooltips", async ({ page }) => {
  const errors = await setup(page)
  await page.goto(dashboardsPath)
  await page.locator('[data-sidebar="trigger"]').click()
  const sidebar = page.locator('[data-slot="sidebar"][data-state]')
  await expect(sidebar).toHaveAttribute("data-state", "collapsed")
  for (const label of await sidebar.locator('[data-sidebar="menu-button"] > span').all()) {
    await expect(label).toHaveCSS("position", "absolute")
    await expect(label).toHaveCSS("width", "1px")
    await expect(label).toHaveCSS("clip-path", "inset(50%)")
  }
  const brand = sidebar.getByRole("link", { name: "IoT OS Tenant portal" })
  await expect(brand).toHaveCSS("padding", "8px")
  await expect(sidebar.getByRole("button", { name: "Organization", exact: true }).locator("svg:visible")).toHaveCount(1)
  await page.getByRole("link", { name: "Devices" }).hover()
  await expect(page.getByRole("tooltip", { name: "Devices" })).toBeVisible()
  expect(errors).toEqual([])
})

for (const theme of ["light", "dark"]) {
  test(`${theme} navigation highlights only the current route and restores labels`, async ({ page }) => {
    const errors = await setup(page)
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme)
    await page.goto(dashboardsPath)
    const sidebar = page.locator('[data-slot="sidebar"][data-state]')
    const dashboard = sidebar.getByRole("link", { name: "Dashboards", exact: true })
    await expect(sidebar.locator('[data-active]')).toHaveCount(1)
    await expect(dashboard).toHaveAttribute("aria-current", "page")
    await expect(dashboard).toHaveAttribute("data-active", "true")
    const background = await sidebar.locator('[data-slot="sidebar-inner"]').evaluate(el => getComputedStyle(el).backgroundColor)
    expect(background).not.toBe("rgba(0, 0, 0, 0)")
    await page.locator('[data-sidebar="trigger"]').click()
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
    await page.locator('[data-sidebar="trigger"]').click()
    await expect(dashboard.locator("span")).toHaveCSS("position", "static")
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    expect(errors).toEqual([])
  })
}

test("mobile navigation opens, changes section, and closes", async ({ page }) => {
  const errors = await setup(page)
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
