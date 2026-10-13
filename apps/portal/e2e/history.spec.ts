import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import profile from "../../../contracts/definitions/device-profiles/rgb-light.v2.json" with { type: "json" }

const organization = "08b842d4-dbe9-44b7-a82f-8409bf31401a"
const deviceId = "11111111-1111-4111-8111-111111111111"
const configuration = "44444444-4444-4444-8444-444444444444"
const basePath = `/organizations/${organization}/devices/${deviceId}/history`

async function setup(page: Page) {
  const calls = { table: 0, export: 0 }
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    )
      errors.push(message.text())
  })
  const now = Date.now()
  const records = Array.from({ length: 125 }, (_, index) => ({
    event_uuid: `event-${String(index).padStart(3, "0")}`,
    configuration_uuid: configuration,
    parameter_uuid: profile.parameters[0].uuid,
    received_at: new Date(now - index * 60_000).toISOString(),
    observed_at: new Date(now - index * 60_000 - 2_000).toISOString(),
    data_type: "boolean",
    unit: null,
    value: index % 2 === 0,
    quality: index === 4 ? "stale" : "good",
    diagnostic: index === 4 ? "Delayed report" : "",
  }))

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      })
    if (path.endsWith("/context"))
      return json({
        data: {
          uuid: organization,
          name: "Acme",
          slug: "acme",
          capabilities: {
            devices: { view: true, manage: true, command: true },
          },
        },
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
    if (path.endsWith("/measurements/records")) {
      const pageSize = Number(url.searchParams.get("page_size") ?? 50)
      if (pageSize === 100) calls.export++
      else calls.table++
      const limit = Number(url.searchParams.get("limit") ?? 500)
      const offset = Number(url.searchParams.get("cursor")?.slice(1) ?? 0)
      const effective = records.slice(0, limit)
      const returned = effective.slice(offset, offset + Math.min(pageSize, 50))
      const consumed = offset + returned.length
      const next = consumed < effective.length ? `p${consumed}` : null
      return json({
        data: returned,
        meta: {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          limit,
          page_size: pageSize,
          returned: returned.length,
          consumed,
          next_cursor: next,
          has_more: Boolean(next),
          limit_reached: !next && records.length > limit,
        },
      })
    }
    if (path.endsWith("/measurements/state-history")) {
      const parameter = profile.parameters.find(
        (item) => item.uuid === url.searchParams.get("parameter_uuid"),
      )!
      const from = url.searchParams.get("from")!
      const to = url.searchParams.get("to")!
      const midpoint = new Date(
        (Date.parse(from) + Date.parse(to)) / 2,
      ).toISOString()
      const colour = parameter.key === "color"
      const mode = parameter.key === "mode"
      return json({
        data: {
          from,
          to,
          durations: colour
            ? []
            : [
                {
                  value: mode ? "solid" : true,
                  known: true,
                  data_type: mode ? "enum" : "boolean",
                  duration_ms: (Date.parse(to) - Date.parse(from)) / 2,
                  percentage: 50,
                },
                {
                  value: mode ? "blink" : false,
                  known: true,
                  data_type: mode ? "enum" : "boolean",
                  duration_ms: (Date.parse(to) - Date.parse(from)) / 2,
                  percentage: 50,
                },
              ],
          timeline: [
            {
              from,
              to: midpoint,
              value: colour ? "#FF0000" : mode ? "solid" : true,
              known: true,
              data_type: colour ? "string" : mode ? "enum" : "boolean",
              configuration_uuid: configuration,
            },
            {
              from: midpoint,
              to,
              value: colour ? "not-a-colour" : mode ? "blink" : false,
              known: true,
              data_type: colour ? "string" : mode ? "enum" : "boolean",
              configuration_uuid: configuration,
            },
          ],
          sampled: colour,
        },
      })
    }
    if (path.endsWith("/measurements/history")) return json({ data: [] })
    if (path.endsWith("/dashboards")) return json({ data: [] })
    if (path.endsWith(`/devices/${deviceId}`))
      return json({
        data: {
          uuid: deviceId,
          code: "rgb",
          name: "RGB example",
          lifecycle: "active",
          deployment_status: "applied",
          deployment_generation: 1,
          state_revision: 1,
          presence: "online",
          applied_configuration_uuid: configuration,
          last_applied_configuration_uuid: configuration,
          retention: { days: 90, source: "platform" },
          configurations: [
            {
              uuid: configuration,
              revision: 3,
              profile_artifact_uuid: "66666666-6666-4666-8666-666666666666",
              profile_uuid: "77777777-7777-4777-8777-777777777777",
              profile_name: "RGB LED",
              profile_revision: 2,
              definition: {
                profile_canonical_json: JSON.stringify(profile),
                mappings: [],
              },
            },
          ],
        },
      })
    if (path.endsWith("/devices"))
      return json({
        data: [{ uuid: deviceId, name: "RGB example" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    return json({ data: [] })
  })
  return { calls, errors }
}

async function choose(page: Page, label: string, option: RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option }).click()
}

test("history summarizes states, loads older records and exports the newest ones", async ({
  page,
}) => {
  const { calls, errors } = await setup(page)
  await page.goto(basePath)
  const summary = page.locator('[data-slot="panel"]', {
    has: page.getByRole("heading", { name: "Measurement history" }),
  })
  await expect(summary.getByText("On (1)", { exact: true })).toBeVisible()
  await expect(summary.getByText("Off (0)", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "Record limit" }),
  ).toHaveCount(0)

  // Records show without a toggle, newest first, in their own panel.
  const records = page.getByRole("table", { name: "Power records" })
  const count = page.getByRole("status").filter({ hasText: / records? · / })
  const received = records.getByRole("columnheader", { name: "Received" })
  await expect(received).toBeVisible()
  for (const aggregate of ["Minimum", "Maximum", "Samples"])
    await expect(
      records.getByRole("columnheader", { name: aggregate }),
    ).toHaveCount(0)
  await expect(count).toHaveText("50 records · newest first")
  // One heading per configuration run replaces two columns that repeated it.
  await expect(
    records.getByRole("cell", {
      name: "Device configuration 3 · Profile revision 2",
    }),
  ).toHaveCount(1)
  await expect(
    records.getByRole("row", { name: /stale Delayed report/ }),
  ).toBeVisible()

  // The rows scroll inside the panel, under a header that stays in view.
  const scroller = records.locator("xpath=..")
  await received.scrollIntoViewIfNeeded()
  expect((await scroller.boundingBox())!.height).toBeLessThanOrEqual(512)
  await scroller.evaluate((element) =>
    element.scrollTo(0, element.scrollHeight),
  )
  await expect(received).toBeInViewport()

  const older = page.getByRole("button", { name: "Load older", exact: true })
  await older.click()
  await expect(count).toHaveText("100 records · newest first")
  await older.click()
  await expect(count).toHaveText("125 records · all in this range")
  await expect(older).toHaveCount(0)
  expect(calls.table).toBe(3)

  await page.getByRole("button", { name: "Columns", exact: true }).click()
  await page.getByRole("menuitemcheckbox", { name: "Device time" }).click()
  await page.keyboard.press("Escape")
  await expect(
    records.getByRole("columnheader", { name: "Device time" }),
  ).toBeVisible()
  await expect(
    records.getByRole("cell", { name: /2s earlier$/ }).first(),
  ).toBeVisible()

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download CSV", exact: true }).click()
  await page.getByRole("menuitem", { name: "Newest 100 records" }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  if (!stream) throw new Error("Download stream was unavailable")
  let csv = ""
  for await (const chunk of stream) csv += chunk.toString()
  expect(download.suggestedFilename()).toBe("rgb-example-power-history.csv")
  expect(calls.export).toBe(2)
  expect(csv).toContain("event_uuid")
  expect(csv).toContain("profile_artifact_uuid")
  expect(csv.indexOf("event-099")).toBeLessThan(csv.indexOf("event-000"))
  expect(csv).not.toContain("event-100")
  await expect(page.getByText("Downloaded 100 records")).toBeVisible()
  await expect(
    page.getByText(/Older records in this range were left out/),
  ).toBeVisible()

  // Another parameter keeps the records on screen and starts from the newest again.
  await choose(page, "Parameter", /^Mode$/)
  await expect(page.getByRole("table", { name: "Mode records" })).toBeVisible()
  await expect(count).toHaveText("50 records · newest first")
  await expect(page.getByText("solid", { exact: true })).toBeVisible()
  await expect(page.getByText("blink", { exact: true })).toBeVisible()
  // Coming back starts from the newest records, not the batches loaded before.
  await choose(page, "Parameter", /^Power$/)
  await expect(page.getByRole("table", { name: "Power records" })).toBeVisible()
  await expect(count).toHaveText("50 records · newest first")
  await choose(page, "Parameter", /^Color$/)
  await expect(page.getByText("#FF0000", { exact: true })).toBeVisible()
  await expect(page.getByText("Invalid value", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("img", { name: /Invalid colour: not-a-colour/ }),
  ).toBeVisible()
  // The image label summarizes; screen readers also get each segment in order.
  const segments = page
    .getByRole("list", { name: "Colour history segments in order" })
    .getByRole("listitem")
  await expect(segments).toHaveCount(2)
  await expect(segments.first()).toContainText(/^#FF0000, .+ to .+, \S+/)
  await expect(segments.nth(1)).toContainText(/^Invalid colour: not-a-colour, /)
  await expect(page.getByText(/visual timeline is sampled/)).toBeVisible()

  // The download toast slides in; scan once no animation is running.
  await page.waitForFunction(() => document.getAnimations().length === 0)
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations).toEqual([])
  expect(errors).toEqual([])
})
