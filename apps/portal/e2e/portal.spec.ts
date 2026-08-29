import { expect, test } from "@playwright/test"

const organization = {
  uuid: "170eb66d-100e-458d-b7e2-b510a12e9c9f",
  name: "Acme Manufacturing",
  slug: "acme-manufacturing",
  capabilities: {
    manage_administration: true,
  },
}

test("shows the canonical Device Domain placeholder", async ({ page }) => {
  const consoleErrors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: 1,
          name: "Acme Administrator",
          email: "admin@example.test",
          email_verified_at: "2026-08-29T00:00:00Z",
          is_super_admin: false,
          capabilities: {
            platform_administration: false,
          },
          organizations: [organization],
        },
      }),
    })
  })

  await page.goto(`/organizations/${organization.uuid}/device-domain`)

  await expect(page.getByRole("heading", { name: "Device Domain" }).last()).toBeVisible()
  await expect(
    page.getByText(/The fixed definition editor has been removed\./),
  ).toBeVisible()
  await expect(page.getByText(organization.name).last()).toBeVisible()
  expect(consoleErrors).toEqual([])
})
