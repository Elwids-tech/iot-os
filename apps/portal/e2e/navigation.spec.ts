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
  await page.getByRole("link", { name: "Devices" }).hover()
  await expect(page.getByRole("tooltip", { name: "Devices" })).toBeVisible()
  expect(errors).toEqual([])
})

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
