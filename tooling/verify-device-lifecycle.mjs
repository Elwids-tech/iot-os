import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

// Runs against the disposable simulator stack through the real rendered UI.
export async function verifyLifecycle({
  page,
  context,
  expect,
  api,
  apiPath,
  deviceUUID,
  shot,
  healthy,
}) {
  const path = `${apiPath}/${deviceUUID}`
  const initial = (await api("GET", path)).data
  const originalDraft = initial.draft
  const configuration = initial.applied_configuration_uuid
  const revisionCount = initial.configurations.length
  const operationURL = new RegExp(`/devices/${deviceUUID}/operations/`)
  const deviceURL = new RegExp(`/devices/${deviceUUID}$`)
  const button = (name) => page.getByRole("button", { name, exact: true })
  await page.getByRole("tab", { name: "Overview", exact: true }).click()
  await button("Deactivate device").click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "Unsent commands will be cancelled",
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  assert.equal(
    (await api("GET", path)).data.deployment_generation,
    initial.deployment_generation,
  )
  await page
    .getByLabel("Description", { exact: true })
    .fill("Unsaved lifecycle verification note")

  // Accept the POST, lose its response, then fail status reads temporarily.
  let failures = true
  await page.route(operationURL, async (route) =>
    failures
      ? route.fulfill({ status: 503, json: { message: "Test interruption" } })
      : route.continue(),
  )
  await page.route(
    new RegExp(`/devices/${deviceUUID}/lifecycle$`),
    async (route) => {
      await route.fetch()
      await route.abort("failed")
    },
    { times: 1 },
  )
  await button("Deactivate device").click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Deactivate device", exact: true })
    .click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(button("Deactivating…")).toBeDisabled()
  await expect
    .poll(async () => (await api("GET", path)).data.lifecycle, {
      timeout: 20000,
    })
    .toBe("deactivated")
  await expect(button("Deactivating…")).toBeDisabled()
  failures = false
  await expect(button("Activate device")).toBeEnabled({ timeout: 15000 })
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Unsaved lifecycle verification note",
  )
  await expect(
    page.getByText("Inactive", { exact: true }).first(),
  ).toBeVisible()
  await shot("devices-lifecycle-inactive-desktop-light")
  await healthy()
  await expect(page.getByText("Newer saved values are available")).toHaveCount(0)
  const stopped = (await api("GET", path + "/measurements/latest")).data
  assert.ok(stopped.length && stopped.every((r) => r.quality === "inactive"))

  // A changed saved draft must not become the resumed immutable snapshot.
  const inactive = (await api("GET", path)).data
  await api("PUT", path + "/configuration", {
    ...originalDraft,
    mappings: [],
    draft_revision: inactive.draft_revision,
  })
  const stale = (await api("GET", path)).data
  let hold = true,
    captured = false
  await page.route(deviceURL, async (route) => {
    if (route.request().method() !== "GET" || captured) return route.continue()
    captured = true
    while (hold) await new Promise((resolve) => setTimeout(resolve, 25))
    await route.fulfill({ json: { data: stale } })
  })
  await button("Activate device").click()
  await expect(page.getByRole("alertdialog")).toContainText(
    "Saved draft changes will not be applied",
  )
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate device", exact: true })
    .click()
  await expect(button("Deactivate device")).toBeEnabled({ timeout: 20000 })
  hold = false
  await page.unroute(deviceURL)
  await expect(button("Deactivate device")).toBeEnabled()
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Unsaved lifecycle verification note",
  )
  const resumed = (await api("GET", path)).data
  assert.equal(resumed.applied_configuration_uuid, configuration)
  assert.equal(resumed.configurations.length, revisionCount)
  assert.deepEqual(resumed.draft.mappings, [])
  await expect
    .poll(
      async () => {
        const readings = (await api("GET", path + "/measurements/latest")).data
        return readings.some(
          (r) =>
            r.quality === "good" &&
            Date.parse(r.received_at) >
              Date.parse(resumed.operation.completed_at),
        )
      },
      { timeout: 15000 },
    )
    .toBe(true)
  await api("PUT", path + "/configuration", {
    ...originalDraft,
    draft_revision: resumed.draft_revision,
  })
  // Discard only the note created in this isolated test, never a user's form.
  await page.getByRole("button", { name: "Cancel", exact: true }).click()

  // A request that never reached the API stays unresolved, even after 60s.
  const current = (await api("GET", path)).data
  await page.evaluate(
    ({ key, request }) => sessionStorage.setItem(key, JSON.stringify(request)),
    {
      key: `device-lifecycle:${apiPath.split("/")[4]}:${deviceUUID}`,
      request: {
        operation_uuid: randomUUID(),
        target_state: "inactive",
        expected_generation: current.deployment_generation,
        submitted_at: new Date(Date.now() - 65000).toISOString(),
      },
    },
  )
  await page.reload()
  await expect(page.getByText(/Confirmation delayed/)).toBeVisible()
  await expect(button("Deactivating…")).toBeDisabled()
  await expect(button("Retry the same request")).toBeVisible()
  await button("Retry the same request").click()
  await expect(button("Activate device")).toBeEnabled({ timeout: 20000 })
  await page.getByRole("button", { name: /theme/i }).click()
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await button("Activate device").focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await shot("devices-lifecycle-confirm-mobile-dark")
  await healthy()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate device", exact: true })
    .click()
  await expect(button("Deactivate device")).toBeEnabled({ timeout: 20000 })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: /theme/i }).click()
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click()
  await page.unroute(operationURL)
  console.log(
    "PASS lifecycle toggles without reload, cancel, unsaved edits, lost response, failed status recovery, retained snapshot, stale reads, delayed confirmation, idempotent retry, mobile dark keyboard and accessibility",
  )
}
