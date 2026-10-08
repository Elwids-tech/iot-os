import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const org = "08b842d4-dbe9-44b7-a82f-8409bf31401a";
const id = "10000000-0000-4000-8000-000000000001";
const artifact = "20000000-0000-4000-8000-000000000001";
const candidate = "30000000-0000-4000-8000-000000000001";
const device = "40000000-0000-4000-8000-000000000001";
const base = `/organizations/${org}/device-adapters`;
const profile = {
  parameters: [
    {
      uuid: "flow",
      key: "flow_rate",
      data_type: "number",
      unit: "L/min",
      reports_state: true,
      kind: "measurement",
    },
    {
      uuid: "volume",
      key: "total_volume",
      data_type: "number",
      unit: "L",
      reports_state: true,
      kind: "measurement",
    },
  ],
};
const sampleResult = {
  valid: true,
  results: [
    {
      passed: true,
      output: {
        sourceDeviceId: "WM-1042",
        metrics: [
          { name: "flow_rate", value: 12, unit: "L/min", datatype: "Double" },
          { name: "total_volume", value: 8400, unit: "L", datatype: "Double" },
        ],
      },
    },
  ],
};

async function setup(page: Page, retained = false) {
  const errors: string[] = [],
    requests: { path: string; body: any }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const organization = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      devices: {
        view: true,
        manage: true,
        connections: true,
        activate: true,
        command: true,
      },
      device_profiles: {
        view: true,
        view_any: true,
        create: true,
        update: true,
        validate: true,
        publish: true,
      },
    },
  };
  let adapter: any = {
    uuid: id,
    name: "Manufacturer water meter",
    artifact_uuid: artifact,
    profile_name: "Water meter",
    profile,
    code: "function decode(input) {return {sourceDeviceId:input.payload.serial,metrics:[]};}",
    fixtures: [
      {
        topic: "meters/fixed/telemetry",
        payload: { serial: "WM-1042", flow_ml_min: 12000, total_ml: 8400000 },
      },
    ],
    source: { type: "platform", topics: ["meters/+/telemetry"] },
    draft_revision: 1,
    credentials_configured: true,
    status: "running",
    applied_revision_uuid: "revision-1",
    desired_revision_uuid: "revision-1",
    revision: {
      uuid: "revision-1",
      revision: 1,
      content_hash: "hash",
      tested_at: null,
      test_result: null,
    },
    revisions: [],
    operations: [],
    health: { source_connected: true, upstream_connected: true },
    diagnostic: null,
  };
  let linked = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    const data = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data: value }),
      });
    if (method !== "GET")
      requests.push({ path, body: route.request().postDataJSON() });
    if (path === "/api/v1/me")
      return data({
        id: 1,
        name: "Operator",
        email: "operator@example.test",
        email_verified_at: "2026-01-01",
        capabilities: { platform_administration: false },
        organizations: [organization],
      });
    if (path.endsWith("/context")) return data(organization);
    if (path.endsWith("/device-adapter-profiles"))
      return data([
        {
          uuid: artifact,
          name: "Water meter",
          revision: 1,
          definition: profile,
        },
      ]);
    if (path.endsWith("/device-adapters")) {
      if (method === "POST") {
        adapter = {
          ...adapter,
          ...route.request().postDataJSON(),
          uuid: id,
          status: "draft",
          applied_revision_uuid: null,
          desired_revision_uuid: null,
        };
        return data(adapter, 201);
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [adapter],
          tenant: null,
          capabilities: organization.capabilities.devices,
        }),
      });
    }
    if (path.endsWith(`/device-adapters/${id}`)) {
      if (method === "PUT") {
        const { secrets, ...values } = route.request().postDataJSON();
        adapter = {
          ...adapter,
          ...values,
          draft_revision: adapter.draft_revision + 1,
          revision: {
            ...adapter.revision,
            revision: adapter.draft_revision + 1,
            tested_at: null,
            test_result: null,
          },
        };
      }
      return data(adapter);
    }
    if (path.endsWith("/test")) {
      adapter.revision = {
        ...adapter.revision,
        tested_at: new Date().toISOString(),
        test_result: sampleResult,
      };
      adapter.revisions = [adapter.revision];
      return data(sampleResult);
    }
    if (path.endsWith("/connection-test")) return data({ connected: true });
    if (path.endsWith("/deploy")) {
      adapter.status = "pending";
      return data({ uuid: "operation", status: "queued" }, 202);
    }
    if (path.endsWith("/credentials")) {
      if (method === "POST")
        return data({
          broker_url: "mqtts://localhost:19000",
          credential_uuid: candidate,
          username: "hardware",
          password: "test-only-password",
          ca_certificate: "test-ca",
          publish_topics: ["meters/+/telemetry"],
          instructions: "Use TLS",
        });
      return data([]);
    }
    if (path.endsWith("/candidates"))
      return data([
        {
          uuid: candidate,
          source_device_id: "WM-1042",
          status: linked ? "activated" : "discovered",
          preview: { ...sampleResult.results[0].output, retained },
          last_seen_at: new Date().toISOString(),
          installation_uuid: linked ? "installation" : null,
          device: linked
            ? {
                uuid: device,
                name: "Workshop water meter",
                lifecycle: "active",
              }
            : null,
        },
      ]);
    if (path.endsWith("/activate")) {
      linked = true;
      return data(
        {
          installation_uuid: "installation",
          device: { uuid: device, name: "Workshop water meter" },
        },
        202,
      );
    }
    if (path.endsWith("/devices"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          meta: { current_page: 1, last_page: 1, total: 0, per_page: 20 },
        }),
      });
    if (path.endsWith("/settings")) return data({ enabled: false });
    if (path.endsWith("/proposals") || path.endsWith("/conversations"))
      return data([]);
    return data([]);
  });
  return { errors, requests };
}

test("first-time onboarding saves, tests, reviews and protects an unsaved decoder", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await page.goto(base + "/new");
  await page
    .getByLabel("Adapter name", { exact: true })
    .fill("Workshop manufacturer meter");
  await page
    .getByRole("combobox", { name: "Published device profile" })
    .click();
  await page.getByRole("option", { name: "Water meter · revision 1" }).click();
  await page.getByRole("button", { name: "Continue to connection" }).click();
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/" + id);
  await expect(
    page.getByRole("dialog", { name: "Leave without saving?" }),
  ).toHaveCount(0);
  expect(
    requests.find((r) => r.path.endsWith("/device-adapters"))?.body.code,
  ).toContain("input.payload");
  await page.getByRole("tab", { name: "3 · Decode & test" }).click();
  await page.getByRole("button", { name: "Run sample tests" }).click();
  await expect(
    page.getByText("All samples passed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "8400", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review deployment" }).click();
  await expect(
    page.getByRole("button", { name: "Deploy tested revision" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "3 · Decode & test" }).click();
  const editor = page.locator(".cm-content[contenteditable=true]").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "function decode(input){throw Error('Review this draft')} ",
  );
  await page.getByRole("tab", { name: "4 · Review & deploy" }).click();
  await expect(
    page.getByRole("button", { name: "Deploy tested revision" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "All adapters" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Leave without saving?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(errors).toEqual([]);
});

test("hardware kit download and discovered serial activation stay in the tenant workbench", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await page.goto(base + "/" + id);
  await page.getByLabel("Hardware credential label").fill("Meter WM-1042");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create & download kit" }).click();
  expect((await downloaded).suggestedFilename()).toContain("device-connection");
  await expect(
    page.getByText("test-only-password", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "5 · Devices" }).click();
  await page.getByRole("button", { name: "Review & activate" }).click();
  await page
    .getByLabel("Device name", { exact: true })
    .fill("Workshop water meter");
  await page.getByRole("button", { name: "Activate & start storing" }).click();
  await expect(
    page.getByRole("link", { name: "Workshop water meter", exact: true }),
  ).toHaveAttribute("href", `/organizations/${org}/devices/${device}/overview`);
  expect(requests.find((r) => r.path.endsWith("/activate"))?.body).toEqual({
    name: "Workshop water meter",
  });
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("retained samples cannot activate physical devices", async ({ page }) => {
  const { requests } = await setup(page, true);
  await page.goto(base + "/" + id);
  await page.getByRole("tab", { name: "5 · Devices" }).click();
  await expect(
    page.getByRole("button", { name: "Review & activate" }),
  ).toBeDisabled();
  expect(requests.some((r) => r.path.endsWith("/activate"))).toBe(false);
});
