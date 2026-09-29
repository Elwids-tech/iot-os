import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a",
  id = "11111111-1111-4111-8111-111111111111",
  gateway = "22222222-2222-4222-8222-222222222222",
  device = "33333333-3333-4333-8333-333333333333"
const sampleId = "44444444-4444-4444-8444-444444444444"

test("capture, filtering, stage evidence, AI review, suspension and export", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  let started = false,
    suspended = false,
    stopped = false
  const at = new Date().toISOString()
  const sample = {
    id: sampleId,
    kind: "DDATA",
    topic: "spBv1.0/factory/DDATA/gateway/compressor",
    source_device_id: "compressor",
    received_at: at,
    payload_bytes: 3,
    wire_base64: "AAH/",
    seq: 148,
    birth_session: "birth-1",
    status: "decoded",
    metrics: [{ name: "temperature", datatype: "Double", value: 71.8 }],
    outcomes: [
      {
        device_uuid: device,
        configuration_uuid: id,
        status: "stored",
        stages: [
          {
            parameter_uuid: id,
            metric: "temperature",
            key: "temperature",
            raw: 71.8,
            converted: 72.6,
            conversion: { multiplier: 1, offset: 0.8 },
            unit: "°C",
            quality: "good",
          },
        ],
        readings: [
          {
            parameter_uuid: id,
            key: "temperature",
            value: 72.6,
            quality: "good",
            unit: "°C",
          },
        ],
      },
    ],
  }
  const capture = () => ({
    id,
    scope: {
      organization_uuid: org,
      gateway_uuid: gateway,
      connection_uuid: id,
      edge_node_id: "Gateway 01",
      source_device_id: "compressor",
      device_uuid: device,
      user_id: 1,
    },
    started_at: at,
    expires_at: new Date(Date.now() + 300000).toISOString(),
    purge_at: new Date(Date.now() + 2100000).toISOString(),
    stopped,
    suspended,
    captured: 1,
    dropped: 0,
    samples: [sample],
  })
  const context = {
    uuid: org,
    name: "Acme Manufacturing",
    slug: "acme-manufacturing",
    capabilities: {
      devices: {
        view: true,
        manage: true,
        activate: true,
        connections: true,
        command: true,
      },
    },
  }
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname,
      m = route.request().method(),
      body = route.request().postDataJSON()
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      })
    if (p === "/api/v1/me")
      return json({
        data: {
          id: 1,
          name: "Operator",
          email: "operator@example.test",
          email_verified_at: at,
          capabilities: { platform_administration: false },
          organizations: [context],
        },
      })
    if (p.endsWith("/context")) return json({ data: context })
    if (p.endsWith("/gateways"))
      return json({
        data: [{ uuid: gateway, name: "Gateway 01" }],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    if (p.endsWith("/discovery-candidates"))
      return json({
        data: [
          {
            uuid: id,
            source_device_id: "compressor",
            assigned_device_uuid: device,
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      })
    if (p.endsWith("/diagnose"))
      return json({
        data: {
          explanation: "The applied offset adds 0.8 °C.",
          evidence_ids: [sampleId],
          sample_ids: [sampleId],
          suggested_review:
            "Confirm the reference temperature before changing the offset.",
          next_check: "Compare against a reference thermometer.",
          changes_applied: false,
        },
      })
    if (p.endsWith("/telemetry-captures")) {
      if (m === "POST") {
        started = true
        return json({ data: capture() }, 201)
      }
      return json({ data: started ? [capture()] : [] })
    }
    if (p.endsWith("/telemetry-captures/" + id)) {
      if (m === "POST") {
        if (body.action === "suspend") {
          expect(body.confirm).toBe(true)
          suspended = true
        }
        if (body.action === "resume") suspended = false
        if (body.action === "stop") {
          stopped = true
          suspended = false
        }
        return json({ ok: true })
      }
      return json({ data: capture() })
    }
    return json({
      data: [],
      meta: { total: 0, current_page: 1, last_page: 1 },
    })
  })
  await page.goto(`/organizations/${org}/telemetry`)
  await expect(
    page.getByRole("heading", { name: "Telemetry viewer", exact: true }),
  ).toBeVisible()
  await page.getByRole("combobox", { name: "Gateway", exact: true }).click()
  await page.getByRole("option", { name: "Gateway 01", exact: true }).click()
  await page.getByRole("combobox", { name: "Device", exact: true }).click()
  await page.getByRole("option", { name: "compressor", exact: true }).click()
  await page.getByRole("button", { name: "Start capture", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Stop capture", exact: true }),
  ).toBeVisible()
  await page.getByRole("textbox", { name: "Filter messages" }).fill("not found")
  await expect(page.getByText("No matching messages")).toBeVisible()
  await page.getByRole("textbox", { name: "Filter messages" }).fill("")
  await page.getByRole("tab", { name: "Wire bytes", exact: true }).click()
  await expect(page.getByText("00 01 ff", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Pause view", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Resume view", exact: true }),
  ).toBeVisible()
  await page
    .getByRole("tab", { name: "Processing stages", exact: true })
    .click()
  await expect(
    page.getByRole("cell", { name: "72.6 °C", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("cell", { name: "× 1 + 0.8", exact: true }),
  ).toBeVisible()
  await page.getByRole("tab", { name: "AI troubleshoot", exact: true }).click()
  await page
    .getByLabel("Ask about this sample", { exact: true })
    .fill("Why is the stored temperature higher?")
  await page.getByRole("button", { name: "Analyze", exact: true }).click()
  await expect(page.getByText("The applied offset adds 0.8 °C.")).toBeVisible()
  await page.getByRole("button", { name: "Review suggested change" }).click()
  await expect(
    page.getByRole("link", { name: "Open device configuration" }),
  ).toHaveAttribute(
    "href",
    `/organizations/${org}/devices/${device}/configuration`,
  )
  await page.getByRole("button", { name: "Dismiss", exact: true }).click()
  await page.getByRole("button", { name: "Suspend…", exact: true }).click()
  await page.getByRole("button", { name: "Suspend until capture ends" }).click()
  await expect(
    page.getByText("Production ingestion is temporarily suspended", {
      exact: true,
    }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Resume ingestion", exact: true })
    .click()
  await expect(
    page.getByText("Production ingestion is temporarily suspended", {
      exact: true,
    }),
  ).not.toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export capture" }).click()
  expect((await download).suggestedFilename()).toContain(id)
  await page.getByRole("button", { name: "Stop capture", exact: true }).click()
  await expect(page.getByText("Capture stopped", { exact: true })).toBeVisible()
  const violations = (
    await new AxeBuilder({ page }).analyze()
  ).violations.filter((v) => v.impact === "critical" || v.impact === "serious")
  expect(violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole("heading", { name: "Telemetry viewer", exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})
