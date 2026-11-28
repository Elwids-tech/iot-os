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

const ingestUrl = "https://hooks.example.com/w/3HkQ7mZ2pV9xT4bN";
const minutes = (n: number) => new Date(Date.now() - n * 60000).toISOString();
const checklist = [
  { step: "type", state: "done", detail: "Water meter profile" },
  { step: "connect", state: "waiting", detail: "Waiting for the first delivery" },
  { step: "samples", state: "attention", detail: "2 samples captured but not added" },
  { step: "decoder", state: "todo", detail: null },
  { step: "deploy", state: "todo", detail: null },
  { step: "activate", state: "todo", detail: null },
];
const pollSource = {
  type: "poll",
  request: {
    method: "GET",
    url: "https://api.vendor.example/accounts/A1/streams/history",
    query: [{ name: "start", value: "{cursor}" }],
    headers: [],
  },
  credentials: { placement: "header", name: "x-api-key" },
  time_format: "iso",
  interval_seconds: 300,
  page: { size: 500, size_param: "limit", more: "full_page", max_pages: 20 },
  records: "/data",
  cursor: { kind: "timestamp", pointer: "/maxDate" },
  initial_lookback_seconds: 3600,
};
const trackerRecords = [
  { deviceId: "TRK-1001", ts: "2026-10-27T09:12:00Z", lat: 48.8584, lon: 2.2945, temp: 21.5 },
  { deviceId: "TRK-1002", ts: "2026-10-27T09:14:00Z", lat: 48.8606, lon: 2.3376, temp: 19.75 },
];
const fetchResult = {
  status: 200,
  duration_ms: 412,
  headers: { "content-type": "application/json", "x-api-key": "[redacted]" },
  excerpt: JSON.stringify({ data: trackerRecords, maxDate: "2026-10-27T09:14:00Z" }),
  truncated: false,
  record_count: 2,
  records: trackerRecords,
  next_cursor: "2026-10-27T09:14:00Z",
  more: false,
  error: null,
};
const pollRuns = [
  {
    uuid: "run-3",
    run_id: "r-0003",
    started_at: minutes(2),
    finished_at: minutes(2),
    outcome: "retrying",
    http_status: 503,
    pages: 0,
    records: 0,
    published: 0,
    failed: 0,
    duplicates: 0,
    cursor_before: "2026-10-27T09:14:00Z",
    cursor_after: null,
    error: "HTTP 503",
    next_attempt_at: new Date(Date.now() + 600000).toISOString(),
  },
  {
    uuid: "run-2",
    run_id: "r-0002",
    started_at: minutes(7),
    finished_at: minutes(7),
    outcome: "ok",
    http_status: 200,
    pages: 2,
    records: 640,
    published: 636,
    failed: 1,
    duplicates: 3,
    cursor_before: "2026-10-27T08:40:00Z",
    cursor_after: "2026-10-27T09:14:00Z",
    error: null,
    next_attempt_at: null,
  },
];
const deliveries = [
  {
    uuid: "delivery-rejected",
    kind: "rejected",
    reason: "unauthenticated",
    source: "webhook",
    received_at: minutes(3),
    source_address: "203.0.113.7",
    path: "/uplink",
    content_type: "application/json",
    size: 412,
    delivery_id: "d-1",
    error: null,
    input: null,
  },
  {
    uuid: "delivery-failed",
    kind: "failed",
    reason: "decode_failed",
    source: "webhook",
    received_at: minutes(5),
    source_address: null,
    path: "/uplink",
    content_type: "application/json",
    size: 96,
    delivery_id: "d-2",
    error: "Missing meter serial",
    input: {
      topic: "/uplink",
      payload_base64: btoa('{"flow":12}'),
      source: "webhook",
      received_at: minutes(5),
      http: {
        method: "POST",
        path: "/uplink",
        query: {},
        content_type: "application/json",
        headers: { "user-agent": "vendor-cloud" },
      },
    },
  },
];

/** The review check of a point map: one current value per reading of each equipment. */
function opcuaCheck(map: any) {
  const points = map.equipment.reduce((n: number, e: any) => n + map.readings.length - (e.missing ?? []).length, 0);
  return {
    valid: true,
    equipment: map.equipment.map((e: any) => ({
      source_id: e.source_id,
      display_name: e.display_name,
      readings: map.readings.map((r: any, i: number) => ({ key: r.key, value: r.data_type === "boolean" ? true : 20 + i, unit: r.unit ?? null, data_type: r.data_type, quality: "good", status: "Good", reason: null, source_time: new Date().toISOString(), problem: null })),
    })),
    problems: [],
    totals: { devices: map.equipment.length, readings: map.readings.length, points, rows_per_day: points * 288 },
    limit: { max: 10000, used: 0, adding: points, over: 0 },
  };
}

async function setup(
  page: Page,
  retained = false,
  kind: "platform" | "webhook" | "poll" = "platform",
  overrides: Record<string, unknown> = {},
) {
  const errors: string[] = [],
    requests: { path: string; body: any }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const organization = {
    uuid: org,
    name: "Acme",
    slug: "acme",
    capabilities: {
      features: { device_adapters: true },
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
    source:
      kind === "webhook"
        ? { type: "webhook", auth: { mode: "hmac", signature_header: "x-signature", encoding: "hex" } }
        : kind === "poll"
          ? pollSource
          : { type: "platform", topics: ["meters/+/telemetry"] },
    draft_revision: 1,
    credentials_configured: true,
    saved_secrets: {
      api_key: kind === "poll",
      token: false,
      username: false,
      password: false,
      ca_certificate: false,
    },
    webhook: { available: true, ingest_url: null, state: null, last_delivery_at: null, active_secrets: null },
    polling: null,
    source_state: { state: "connected", label: "Connected", detail: null },
    checklist: [],
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
    deletion: { allowed: true, reason: null },
    ...overrides,
  };
  let linked = false;
  let deleted = false;
  let secrets: any[] = [];
  let secretCount = 0;
  // Derived fields the API computes from the saved source.
  const derive = () => {
    const type = adapter.source.type;
    adapter.webhook =
      type === "webhook"
        ? {
            available: true,
            ingest_url: ingestUrl,
            state: secrets.some((s) => s.active) ? "receiving" : "no_deliveries",
            last_delivery_at: null,
            active_secrets: secrets.filter((s) => s.active).length,
          }
        : { available: true, ingest_url: null, state: null, last_delivery_at: null, active_secrets: null };
    if (type === "poll" && !adapter.polling)
      adapter.polling = { state: "not_deployed", reason: null, next_run_at: null, last_run_at: null, cursor: null };
    if (type !== "poll") adapter.polling = null;
    adapter.source_state =
      type === "webhook"
        ? { state: "no_deliveries", label: "No deliveries yet", detail: null }
        : type === "poll"
          ? { state: adapter.polling.state, label: adapter.polling.state === "stopped" ? "Stopped: credentials rejected" : "Polling", detail: adapter.polling.reason }
          : { state: "connected", label: "Connected", detail: null };
  };
  if (kind === "webhook") {
    secrets = [
      {
        uuid: "secret-0",
        label: "Vendor cloud",
        origin: "generated",
        created_at: minutes(60 * 24),
        created_by: { user_id: 1, name: "Operator" },
        last_used_at: minutes(3),
        expires_at: null,
        revoked_at: null,
        active: true,
      },
    ];
    secretCount = 1;
    adapter.checklist = checklist;
  }
  if (kind === "poll") {
    adapter.polling = {
      state: "stopped",
      reason: "Credentials rejected",
      next_run_at: null,
      last_run_at: minutes(2),
      cursor: { value: "2026-10-27T09:14:00Z", kind: "timestamp", committed_at: minutes(7), run_id: "r-0002" },
    };
  }
  derive();
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
        const { secrets: saved, request_uuid, ...values } = route.request().postDataJSON();
        adapter = {
          ...adapter,
          ...values,
          uuid: id,
          status: "draft",
          applied_revision_uuid: null,
          desired_revision_uuid: null,
          saved_secrets: { ...adapter.saved_secrets, api_key: !!saved?.api_key },
        };
        derive();
        return data(adapter, 201);
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: deleted ? [] : [{ ...adapter, deletable: adapter.deletion.allowed }],
          tenant: null,
          capabilities: organization.capabilities.devices,
        }),
      });
    }
    if (path.endsWith(`/device-adapters/${id}`)) {
      if (method === "DELETE") {
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      if (method === "PUT") {
        const { secrets: saved, ...values } = route.request().postDataJSON();
        adapter = {
          ...adapter,
          ...values,
          saved_secrets: {
            ...adapter.saved_secrets,
            api_key: adapter.saved_secrets.api_key || !!saved?.api_key,
          },
          draft_revision: adapter.draft_revision + 1,
          revision: {
            ...adapter.revision,
            revision: adapter.draft_revision + 1,
            tested_at: null,
            test_result: null,
          },
        };
        derive();
      }
      return data(adapter);
    }
    if (path.endsWith("/webhook"))
      return data({
        ingest_url: ingestUrl,
        auth: adapter.source.auth ?? null,
        state: adapter.webhook.state,
        secrets,
        counts: {
          "24h": { accepted: 42, unauthenticated: 3, decode_failed: 1 },
          "7d": { accepted: 310, unauthenticated: 9, decode_failed: 4, rate_limited: 2 },
        },
      });
    if (path.endsWith("/webhook/secrets")) {
      const body = route.request().postDataJSON();
      const active = secrets.filter((s) => s.active);
      if (active.length >= 2)
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ message: "Revoke a secret before creating another." }),
        });
      for (const s of active)
        s.expires_at = new Date(Date.now() + 7 * 86400000).toISOString();
      secretCount += 1;
      const secret = {
        uuid: `secret-${secretCount}`,
        label: body.label,
        origin: body.value ? "vendor" : "generated",
        created_at: new Date().toISOString(),
        created_by: { user_id: 1, name: "Operator" },
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        active: true,
      };
      secrets = [secret, ...secrets];
      derive();
      return data(
        {
          secret,
          value: body.value ? null : `whsec_test_generated_${secretCount}`,
          ingest_url: ingestUrl,
        },
        201,
      );
    }
    if (path.includes("/webhook/secrets/") && path.endsWith("/revoke")) {
      const secret = secrets.find((s) => path.includes(`/secrets/${s.uuid}/`));
      if (!secret) return data(null, 404);
      secret.revoked_at = new Date().toISOString();
      secret.active = false;
      secret.expires_at = null;
      derive();
      return data({ revoked: true });
    }
    if (path.endsWith("/deliveries")) {
      const kindParam = url.searchParams.get("kind");
      if (kindParam === "sample") return data([]);
      return data(deliveries.filter((d) => !kindParam || d.kind === kindParam));
    }
    if (path.endsWith("/fetch-now")) return data(fetchResult);
    if (path.endsWith("/poll-runs"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: pollRuns, polling: adapter.polling }),
      });
    if (path.endsWith("/cursor") || path.endsWith("/resume")) {
      if (path.endsWith("/resume"))
        adapter.polling = { ...adapter.polling, state: "polling", reason: null };
      derive();
      return data({ uuid: "operation", status: "queued", action: "deploy" }, 202);
    }
    if (path.endsWith("/test")) {
      // An OPC UA source is tested by its review check (spec 038).
      const result = adapter.source.type === "opcua" ? opcuaCheck(adapter.source.point_map) : sampleResult;
      adapter.revision = {
        ...adapter.revision,
        tested_at: new Date().toISOString(),
        test_result: result,
      };
      adapter.revisions = [adapter.revision];
      return data(result);
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
    // Nothing reported yet unless a test says otherwise, so Activate does not ask.
    if (path.endsWith("/last-report")) return data({ observed_at: null, readings: [] });
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
  return { errors, requests, current: () => adapter };
}

test("first-time onboarding saves, tests, reviews and protects an unsaved decoder", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await page.goto(base + "/new");
  // One question first: the five sources, and nothing else to fill in yet.
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.getByLabel("Adapter name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Adapter name", { exact: true })
    .fill("Workshop manufacturer meter");
  await page
    .getByRole("combobox", { name: "Published device profile" })
    .click();
  await page.getByRole("option", { name: "Water meter · revision 1" }).click();
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
  await page.getByRole("tab", { name: "Decode" }).click();
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
  await page.getByRole("tab", { name: "Decode" }).click();
  const editor = page.locator(".cm-content[contenteditable=true]").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "function decode(input){throw Error('Review this draft')} ",
  );
  await page.getByRole("tab", { name: "Deploy" }).click();
  await expect(
    page.getByRole("button", { name: "Deploy tested revision" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to Device adapters" }).click();
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
  // A live adapter opens on its overview; the kits sit with the source.
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await page.getByLabel("Hardware credential label").fill("Meter WM-1042");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create & download kit" }).click();
  expect((await downloaded).suggestedFilename()).toContain("device-connection");
  await expect(
    page.getByText("test-only-password", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Devices" }).click();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  const activate = page.getByRole("dialog", { name: "Activate WM-1042" });
  await expect(activate.getByLabel("Device name", { exact: true })).toHaveValue("WM-1042");
  await activate.getByLabel("Device name", { exact: true }).fill("Workshop water meter");
  await activate.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Workshop water meter", exact: true }),
  ).toHaveAttribute("href", `/organizations/${org}/devices/${device}/overview`);
  expect(requests.find((r) => r.path.endsWith("/activate"))?.body).toEqual({
    name: "Workshop water meter",
    keep_last_readings: false,
  });
  expect(errors).toEqual([]);
  // The activation toast fades in; axe reads mid-fade colours as low contrast.
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Discovery shows an adapter's source by serial and activates it keeping what it last reported", async ({ page }) => {
  const { errors, requests } = await setup(page);
  const source = {
    uuid: "50000000-0000-4000-8000-000000000001",
    source_device_id: "src-4f2a9c",
    status: "pending",
    presence: "online",
    session_id: "s-1",
    birth_revision: 1,
    metrics: [{ name: "flow_rate", datatype: "Double", value: 12 }],
    last_seen_at: new Date().toISOString(),
    assigned_device_uuid: null,
    setup_device_uuid: null,
    gateway: { uuid: "60000000-0000-4000-8000-000000000001", name: "Manufacturer water meter", edge_node_id: `adapter-${id}`, presence: "online", last_seen_at: null, connection_uuid: "c", group_id: "adapters-acme", sources_count: 1 },
    adapter: { uuid: id, name: "Manufacturer water meter", candidate_uuid: candidate, serial: "WM-1042" },
  };
  await page.route("**/discovery-candidates**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [source], meta: { current_page: 1, last_page: 1, total: 1 } }),
    }),
  );
  const reported = new Date(Date.now() - 26 * 3600_000).toISOString();
  await page.route(`**/candidates/${candidate}/last-report`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { observed_at: reported, readings: [{ key: "flow_rate", label: "Flow rate", unit: "L/min", value: 12.5, observed_at: reported }] } }),
    }),
  );
  await page.goto(`/organizations/${org}/discovery`);
  const row = page.getByRole("row", { name: /WM-1042/ });
  await expect(row).not.toContainText("src-4f2a9c");
  await row.getByRole("button", { name: "Activate", exact: true }).click();
  const activate = page.getByRole("dialog", { name: "Activate WM-1042" });
  await expect(activate).toContainText("Manufacturer water meter decodes this device");
  await activate.getByRole("button", { name: "Activate", exact: true }).click();
  // The source reported a day ago: Activate asks whether that report becomes the first readings.
  const keep = page.getByRole("alertdialog", { name: "Keep what WM-1042 last reported?" });
  await expect(keep).toContainText("1 d ago");
  await expect(keep).toContainText("Flow rate");
  await expect(keep).toContainText("12.5 L/min");
  // All three choices sit on one line inside the footer.
  const tops = await keep.getByRole("button").evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await keep.getByRole("button", { name: "Back" }).click();
  await expect(keep).toHaveCount(0);
  expect(requests.some((r) => r.path.endsWith("/activate"))).toBe(false);
  await activate.getByRole("button", { name: "Activate", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep and activate" }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${org}/devices/${device}`));
  expect(requests.find((r) => r.path.endsWith(`/candidates/${candidate}/activate`))?.body).toEqual({ name: "WM-1042", keep_last_readings: true });
  expect(errors).toEqual([]);
});

test("an adapter's publisher is left out of Gateways, and its gateway page opens the adapter", async ({ page }) => {
  const { errors } = await setup(page);
  const publisher = { uuid: "60000000-0000-4000-8000-000000000001", name: "Manufacturer water meter", edge_node_id: `adapter-${id}`, presence: "online", last_seen_at: null, connection_uuid: "c", group_id: "adapters-acme", sources_count: 1, adapter: { uuid: id, name: "Manufacturer water meter" } };
  const line = { ...publisher, uuid: "60000000-0000-4000-8000-000000000002", name: "Line 2 gateway", edge_node_id: "line2-edge", connection_uuid: "p", group_id: "plant", sources_count: 0, adapter: null };
  const kinds: (string | null)[] = [];
  const page1 = (rows: unknown[]) => ({ contentType: "application/json", body: JSON.stringify({ data: rows, meta: { current_page: 1, last_page: 1, total: rows.length } }) });
  await page.route((url) => url.pathname.startsWith("/api/") && url.pathname.endsWith("/gateways"), (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    kinds.push(kind);
    return route.fulfill(page1([publisher, line].filter((g) => !kind || (kind === "adapter") === Boolean(g.adapter))));
  });
  await page.route((url) => url.pathname.startsWith("/api/") && url.pathname.endsWith("/sparkplug-connections"), (route) =>
    route.fulfill(page1([
      { uuid: "c", name: "Device adapter connections", group_id: "adapters-acme", host_id: "h", status: "ready", diagnostic: null },
      { uuid: "p", name: "Plant broker", group_id: "plant", host_id: "h2", status: "ready", diagnostic: null },
    ])),
  );
  await page.goto(`/organizations/${org}/gateways`);
  const table = page.getByRole("table", { name: "Gateways" });
  await expect(table.getByRole("link", { name: "Line 2 gateway" })).toBeVisible();
  await expect(table).not.toContainText("Manufacturer water meter");
  expect(kinds).toEqual(["gateway"]);
  // Gateways register on the organization's own connections only.
  await page.getByRole("button", { name: "Register gateway" }).click();
  const sheet = page.getByRole("dialog", { name: "Register gateway" });
  await sheet.getByRole("combobox", { name: "Connection" }).click();
  await expect(page.getByRole("option")).toHaveText(["Select connection", "Plant broker"]);
  await page.keyboard.press("Escape");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  // An older link or an alert that points at the publisher's gateway page opens the adapter.
  await page.goto(`/organizations/${org}/gateways/${publisher.uuid}`);
  await expect(page).toHaveURL(`${base}/${id}`);
  await expect(page.getByRole("button", { name: "More adapter actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Firmware", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("retained samples cannot activate physical devices", async ({ page }) => {
  const { requests } = await setup(page, true);
  await page.goto(base + "/" + id);
  await page.getByRole("tab", { name: "Devices" }).click();
  await expect(
    page.getByRole("button", { name: "Activate", exact: true }),
  ).toBeDisabled();
  expect(requests.some((r) => r.path.endsWith("/activate"))).toBe(false);
});

const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().length === 0);

async function newAdapter(page: Page, name: string, source?: string) {
  await page.goto(base + "/new");
  if (source) await page.getByRole("radio", { name: source }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Adapter name", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: "Published device profile" })
    .click();
  await page.getByRole("option", { name: "Water meter · revision 1" }).click();
}

test("a webhook source shows its ingest URL and manages secrets shown once", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await newAdapter(page, "Vendor cloud meter", "Vendor cloud sends webhooks");
  await expect(page.getByLabel("Signature header")).toHaveValue("x-signature");
  await expect(page.getByLabel("Manufacturer topic filters")).toHaveCount(0);
  await page.getByLabel("Timestamp header").fill("X-Timestamp");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/" + id);
  const created = requests.find((r) => r.path.endsWith("/device-adapters"));
  expect(created?.body.source).toEqual({
    type: "webhook",
    auth: {
      mode: "hmac",
      signature_header: "x-signature",
      encoding: "hex",
      timestamp_header: "x-timestamp",
    },
  });
  expect(created?.body.secrets).toBeUndefined();
  await expect(
    page.getByRole("group", { name: "Ingest URL", exact: true }),
  ).toContainText(ingestUrl);

  // Toolbar buttons show only their icon; the tooltip and accessible name say what they do.
  const createButton = page.getByRole("button", { name: "Create secret" });
  await expect(createButton).toHaveText("");
  await createButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Create secret");
  await createButton.click();
  const create = page.getByRole("dialog", { name: "Create a webhook secret" });
  await create.getByLabel("Label").fill("Vendor cloud");
  await create.getByRole("button", { name: "Create secret" }).click();
  const shown = page.getByRole("dialog", { name: "Copy the new secret now" });
  await expect(shown).toContainText("whsec_test_generated_1");
  await expect(shown).toContainText("will not be shown again");
  await shown.getByRole("button", { name: "I've stored it" }).click();
  await expect(page.getByText("whsec_test_generated_1")).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /Vendor cloud/ }),
  ).toContainText("Active");

  await page.getByRole("button", { name: "Rotate secret", exact: true }).click();
  const rotate = page.getByRole("dialog", { name: "Rotate the webhook secret" });
  await expect(rotate).toContainText("keeps working for 7 days");
  await rotate.getByRole("button", { name: "Rotate secret" }).click();
  await expect(
    page.getByRole("dialog", { name: "Copy the new secret now" }),
  ).toContainText("whsec_test_generated_2");
  await page.getByRole("button", { name: "I've stored it" }).click();
  await expect(
    page.getByRole("row", { name: /Vendor cloud/ }),
  ).toContainText("Expiring");
  const rotateButton = page.getByRole("button", { name: "Rotate secret", exact: true });
  await expect(rotateButton).toBeDisabled();
  await expect(page.getByText("Two secrets are active.")).toBeVisible();
  // A disabled icon button still names itself on hover.
  await rotateButton.hover({ force: true });
  await expect(page.getByRole("tooltip")).toHaveText("Rotate secret");
  await page.mouse.move(0, 0, { steps: 4 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page.getByRole("button", { name: "Revoke Vendor cloud" }).click();
  const confirm = page.getByRole("alertdialog", { name: /Revoke “Vendor cloud”/ });
  await expect(confirm).toContainText("refused within 10 seconds");
  await confirm.getByRole("button", { name: "Revoke secret" }).click();
  await expect(
    page.getByRole("row", { name: /Vendor cloud/ }),
  ).toContainText("Revoked");
  expect(
    requests.some((r) => r.path.endsWith("/webhook/secrets/secret-1/revoke")),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Rotate secret", exact: true }),
  ).toBeEnabled();
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a polling source saves only its settings, fetches records and adds one as a fixture", async ({
  page,
}) => {
  const { errors, requests } = await setup(page);
  await newAdapter(page, "Asset trackers", "Poll a vendor API");
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://api.vendor.example/accounts/A1/streams/{start}");
  await expect(
    page.getByText("Put placeholders in query parameters, not in the URL."),
  ).toBeVisible();
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://api.vendor.example/accounts/A1/streams/history");
  await page.getByRole("button", { name: "Add query parameter" }).click();
  await page.getByLabel("Query parameters: name 1").fill("start");
  await page.getByLabel("Query parameters: value 1").click();
  await page.getByRole("button", { name: "{cursor}", exact: true }).click();
  await expect(page.getByLabel("Query parameters: value 1")).toHaveValue(
    "{cursor}",
  );
  await page
    .getByRole("combobox", { name: "How the API key is sent" })
    .click();
  await page.getByRole("option", { name: "API key in a header" }).click();
  await expect(page.getByLabel("Header name")).toHaveValue("x-api-key");
  await page.getByLabel("API key", { exact: true }).fill("test-only-api-key");
  await page.getByLabel("Records location").fill("/data");
  await page.getByLabel("Cursor location").fill("/maxDate");
  await expect(page.getByRole("button", { name: "Fetch now" })).toBeDisabled();
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/" + id);
  const created = requests.find((r) => r.path.endsWith("/device-adapters"))?.body;
  expect(created.source).toEqual({
    type: "poll",
    request: {
      method: "GET",
      url: "https://api.vendor.example/accounts/A1/streams/history",
      query: [{ name: "start", value: "{cursor}" }],
      headers: [],
    },
    credentials: { placement: "header", name: "x-api-key" },
    time_format: "iso",
    interval_seconds: 300,
    page: { more: "none", max_pages: 20 },
    records: "/data",
    cursor: { kind: "timestamp", pointer: "/maxDate" },
    initial_lookback_seconds: 3600,
  });
  expect(created.secrets).toEqual({ api_key: "test-only-api-key" });
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute(
    "placeholder",
    "Saved · enter to replace",
  );

  await page.getByRole("button", { name: "Fetch now" }).click();
  await expect(
    page.getByRole("cell", { name: "TRK-1001", exact: true }),
  ).toBeVisible();
  expect(requests.find((r) => r.path.endsWith("/fetch-now"))?.body).toEqual({
    draft_revision: 1,
  });
  await expect(page.getByText("412 ms")).toBeVisible();
  await expect(
    page.getByText("2026-10-27T09:14:00Z", { exact: true }).first(),
  ).toBeVisible();
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Add record 1 as fixture" }).click();
  await expect(page.getByText("Added as fixture 2.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fetch now" })).toBeDisabled();

  await page.getByRole("tab", { name: "Decode" }).click();
  await expect(page.locator(".cm-content").nth(1)).toContainText("TRK-1001");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: false })).toBeVisible();
  const saved = requests.filter((r) => r.path.endsWith(`/device-adapters/${id}`)).at(-1)?.body;
  expect(saved.fixtures).toHaveLength(2);
  expect(saved.fixtures[1]).toMatchObject({
    payload: trackerRecords[0],
    source: "poll",
    poll: { page: 1, index: 0, count: 2 },
  });
  expect(saved.fixtures[1].topic).toBeUndefined();

  await page.getByRole("button", { name: "Run sample tests" }).click();
  await page.getByRole("button", { name: "Review deployment" }).click();
  const start = page.getByLabel("Start polling from");
  await expect(start).toHaveAttribute("min", /T/);
  await page.getByRole("button", { name: "Deploy tested revision" }).click();
  // The click returns before the request is sent.
  await expect.poll(() => requests.find((r) => r.path.endsWith("/deploy"))).toBeDefined();
  const deploy = requests.find((r) => r.path.endsWith("/deploy"))?.body;
  const startAt = Date.parse(deploy.cursor_start_at);
  expect(Math.abs(Date.now() - 3_600_000 - startAt)).toBeLessThan(5 * 60_000);
  expect(errors).toEqual([]);
});

test("setup shows four steps with their states, says what is next and opens its tab", async ({
  page,
}) => {
  const { errors, current } = await setup(page, false, "webhook");
  // Not deployed yet, so the page is still the setup steps.
  Object.assign(current(), { applied_revision_uuid: null, status: "draft" });
  const empty = (r: any) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  await page.route("**/deliveries**", empty);
  await page.route("**/candidates", empty);
  await page.goto(base + "/" + id);
  const steps = page.getByRole("tablist", { name: "Adapter setup" });
  await expect(steps.getByRole("tab")).toHaveCount(5);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveCount(0);
  // Each step takes the state of its first unfinished part.
  await expect(steps.getByRole("tab", { name: "Waiting: Source" })).toHaveAttribute("aria-selected", "true");
  await expect(steps.getByRole("tab", { name: "Needs attention: Decode" })).toBeVisible();
  await expect(steps.getByRole("tab", { name: "Not started: Deploy" })).toBeVisible();
  await expect(steps.getByRole("tab", { name: "Not started: Devices" })).toBeVisible();
  const next = page.locator('[data-slot="setup-next"]');
  await expect(next).toContainText("Next:");
  await expect(next).toContainText("Waiting for the first delivery");
  await steps.getByRole("tab", { name: "Deploy" }).click();
  await next.getByRole("button", { name: "Connect" }).click();
  await expect(steps.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await steps.getByRole("tab", { name: "Decode" }).click();
  const waiting = page.locator('[data-slot="empty-state"]').filter({
    hasText: "Waiting for the first delivery",
  });
  await expect(waiting).toContainText(ingestUrl);
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("an unused adapter is deleted after confirming", async ({ page }) => {
  const { errors, requests } = await setup(page);
  await page.goto(base + "/" + id);
  await page.getByRole("button", { name: "More adapter actions" }).click();
  await page.getByRole("menuitem", { name: "Delete adapter" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete Manufacturer water meter?" });
  await expect(confirm).toContainText("No device uses it.");
  await confirm.getByRole("button", { name: "Delete adapter" }).click();
  await expect(page).toHaveURL(base);
  expect(requests.some((r) => r.path.endsWith(`/device-adapters/${id}`) && r.body === null)).toBe(true);
  await expect(page.getByText("Connect your first manufacturer device")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an adapter that devices use cannot be deleted and says why", async ({ page }) => {
  const reason = "A device was activated through this adapter.";
  const { errors, requests } = await setup(page, false, "platform", { deletion: { allowed: false, reason } });
  await page.goto(base);
  await page.getByRole("button", { name: "Actions for Manufacturer water meter" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete (devices use it)" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.goto(base + "/" + id);
  await page.getByRole("button", { name: "More adapter actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete adapter" })).toBeDisabled();
  await expect(page.getByRole("menu")).toContainText(`${reason} Adapters in use cannot be deleted.`);
  expect(requests.some((r) => r.body === null)).toBe(false);
  expect(errors).toEqual([]);
});

test("the onboarding assistant works in the workspace panel beside the workbench", async ({
  page,
}) => {
  const { errors, requests } = await setup(page, false, "webhook");
  const empty = (r: any) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  await page.route("**/deliveries**", empty);
  await page.route("**/candidates", empty);
  const conversation = {
    id: "c-1",
    title: "Water meters",
    scope: "onboarding",
    adapter_uuid: id,
    profile_uuid: null,
    profile_name: null,
    updated_at: minutes(5),
  };
  let applied = false;
  const detail = () => ({
    ...conversation,
    runs: [
      {
        id: "r-1",
        request_id: "q-1",
        status: "completed",
        prompt: "Draft the decoder from the captured samples.",
        answer: "I proposed a decoder that reads the flow rate.",
        source_ids: [],
        usage: null,
        cost_usd: 0.01,
        error_code: null,
        error_message: null,
        created_at: minutes(3),
      },
    ],
    sources: [],
    proposals: [],
    adapter_proposals: [
      {
        uuid: "p-1",
        kind: "change",
        name: null,
        artifact_uuid: null,
        code: "function decode(input) {return {sourceDeviceId:input.payload.serial,metrics:[{name:'flow_rate',value:input.payload.flow_ml_min/1000}]};}",
        source: null,
        fixtures: [{ topic: "meters/fixed/telemetry", payload: { serial: "WM-1042", flow_ml_min: 12000 } }],
        summary: "Read the flow rate in litres per minute",
        evidence: [],
        content_hash: "hash-1",
        draft_revision: 1,
        status: applied ? "applied" : "pending",
        adapter_uuid: id,
        adapter_name: "Manufacturer water meter",
        created_at: minutes(2),
      },
    ],
    onboarding_state: applied
      ? { next_step: { step: "secret", message: "Create a secret and paste it into the vendor cloud.", adapter_uuid: id, at: minutes(0) } }
      : null,
    cursor: 0,
  });
  await page.route("**/assistant/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: value }) });
    if (route.request().method() === "POST") {
      requests.push({ path, body: route.request().postDataJSON() });
      applied = true;
      return data({ status: "applied", adapter: null, run: null, notice: null });
    }
    if (path.endsWith("/settings"))
      return data({ enabled: true, provider: { label: "OpenAI" }, supported_extensions: [], max_file_bytes: 1 });
    if (path.endsWith("/conversations")) return data([conversation]);
    if (path.endsWith("/conversations/c-1")) return data(detail());
    return data([]);
  });
  await page.route("**/help/page**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { key: "adapters", title: "Device adapters", overview: "adapters", articles: [] } }),
    }),
  );
  await page.goto(base + "/" + id);
  // The assistant is a conversation in the panel, not a tab of the workbench.
  await expect(page.getByRole("tab", { name: "Assistant" })).toHaveCount(0);
  await page.getByRole("button", { name: "More adapter actions" }).click();
  await page.getByRole("menuitem", { name: "Ask the assistant" }).click();
  const chat = page
    .getByRole("complementary", { name: "Assistant", exact: true })
    .getByRole("region", { name: "Onboarding assistant" });
  await expect(chat).toContainText("I proposed a decoder that reads the flow rate.");
  await expect(chat).toContainText("Change the adapter draft");
  await chat.getByRole("button", { name: "Review", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Change the adapter draft" });
  await expect(review.getByText("Current decoder")).toBeVisible();
  await expect(review.getByText("Proposed decoder")).toBeVisible();
  await expect(review.getByText("1 test sample to add")).toBeVisible();
  await review.getByRole("button", { name: "Apply to draft" }).click();
  await expect(review).toBeHidden();
  expect(requests.find((r) => r.path.endsWith("/adapter-proposals/p-1/decision"))?.body).toMatchObject({
    action: "apply",
    content_hash: "hash-1",
  });
  await expect(chat).toContainText("Applied a change to the adapter draft");
  // The suggested step opens its workbench tab beside the panel.
  await page.getByRole("tab", { name: "Deploy" }).click();
  await chat.getByRole("button", { name: "Create a webhook secret" }).click();
  await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

type Conversation = { id: string; title: string; adapter_uuid: string | null; detail: () => Record<string, unknown> };
const assistantRun = (id: string, prompt: string, answer: string | null, status = "completed", at = minutes(5)) => ({
  id,
  request_id: `q-${id}`,
  status,
  prompt,
  answer,
  source_ids: [],
  usage: null,
  cost_usd: 0.01,
  error_code: null,
  error_message: null,
  created_at: at,
});

/** The onboarding assistant's API: conversations whose details the test changes as it goes. */
async function onboardingAssistant(
  page: Page,
  requests: { path: string; body: any }[],
  conversations: Conversation[],
  decide: (path: string, body: any) => unknown = () => ({ status: "applied", adapter: null, run: null, notice: null }),
) {
  await page.route("**/help/page**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { key: "adapters", title: "Device adapters", overview: "adapters", articles: [] } }),
    }),
  );
  await page.route("**/assistant/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data: value }) });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      requests.push({ path, body });
      if (path.endsWith("/messages")) return data(assistantRun("r-sent", body.text, null, "queued"), 202);
      return data(decide(path, body));
    }
    if (path.endsWith("/settings"))
      return data({ enabled: true, provider: { label: "OpenAI" }, supported_extensions: [], max_file_bytes: 1 });
    // The list as it was loaded: bindings made since then show only in each conversation's detail.
    if (path.endsWith("/conversations"))
      return data(
        conversations.map(({ id, title, adapter_uuid }) => ({
          id, title, scope: "onboarding", adapter_uuid, profile_uuid: null, profile_name: null, updated_at: minutes(5),
        })),
      );
    const conversation = conversations.find((item) => path.endsWith(`/conversations/${item.id}`));
    if (conversation)
      return data({
        id: conversation.id,
        title: conversation.title,
        scope: "onboarding",
        adapter_uuid: conversation.adapter_uuid,
        profile_uuid: null,
        profile_name: null,
        updated_at: minutes(5),
        sources: [],
        proposals: [],
        adapter_proposals: [],
        onboarding_state: null,
        cursor: 0,
        ...conversation.detail(),
      });
    return data([]);
  });
}

/** Opens Ask from the page header and picks a conversation from the panel's list. */
async function openConversation(page: Page, title: string) {
  await page.locator('[data-slot="page-header"]').first().getByRole("button", { name: "Assistant", exact: true }).click();
  const chat = page
    .getByRole("complementary", { name: "Assistant", exact: true })
    .getByRole("region", { name: "Onboarding assistant" });
  await chat.getByRole("combobox", { name: "Conversation" }).click();
  await page.getByRole("option", { name: title }).click();
  return chat;
}

test("applying a proposal and activating from the chat keep the same conversation across pages", async ({ page }) => {
  const { errors, requests, current } = await setup(page);
  let applied = false;
  const older: Conversation = {
    id: "c-1",
    title: "Older meters",
    adapter_uuid: id,
    detail: () => ({ runs: [assistantRun("r-old", "An older setup.", "The older conversation.")] }),
  };
  const setupConversation: Conversation = {
    id: "c-2",
    title: "WM-200 water meters",
    adapter_uuid: null,
    detail: () => ({
      adapter_uuid: applied ? id : null,
      runs: [
        assistantRun("r-1", "We bought WM-200 water meters that publish JSON to our broker.", "I proposed a new adapter for them."),
        ...(applied ? [assistantRun("r-2", "I created this adapter draft. Continue onboarding.", "Next I will test the decoder with your sample.", "completed", minutes(1))] : []),
      ],
      adapter_proposals: [
        {
          uuid: "p-2", kind: "create", name: "WM-200 water meters", artifact_uuid: artifact, code: null, source: null, fixtures: null,
          summary: "A new adapter for the WM-200 meters", evidence: [], content_hash: "hash-2", draft_revision: null,
          status: applied ? "applied" : "pending", adapter_uuid: applied ? id : null, adapter_name: applied ? "Manufacturer water meter" : null, created_at: minutes(4),
        },
      ],
    }),
  };
  await onboardingAssistant(page, requests, [setupConversation, older], () => {
    applied = true;
    return { status: "applied", adapter: current(), run: null, notice: null };
  });
  await page.goto(base);
  const chat = await openConversation(page, "WM-200 water meters");
  await expect(chat).toContainText("I proposed a new adapter for them.");
  await chat.getByRole("button", { name: "Create draft" }).click();
  // The new adapter's page opens beside the same conversation, not the adapter's older one or a new one.
  await expect(page).toHaveURL(new RegExp(`${base}/${id}$`));
  await expect(chat).toContainText("Next I will test the decoder with your sample.");
  await expect(chat).toContainText("Created the draft adapter");
  await expect(chat).not.toContainText("The older conversation.");
  expect(requests.find((r) => r.path.endsWith("/adapter-proposals/p-2/decision"))?.body).toMatchObject({ action: "apply" });

  // Activating opens the device, and the conversation stays open beside it.
  await chat.getByRole("button", { name: "Activate", exact: true }).click();
  await page.getByRole("dialog", { name: "Activate WM-1042" }).getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${org}/devices/${device}`));
  await expect(chat).toContainText("Next I will test the decoder with your sample.");
  expect(errors).toEqual([]);
});

test("optional questions never block, and Escape closes only the answer picker", async ({ page }) => {
  const { errors, requests } = await setup(page);
  await onboardingAssistant(page, requests, [
    {
      id: "c-3",
      title: "Meters",
      adapter_uuid: null,
      detail: () => ({
        runs: [assistantRun("r-1", "We have new water meters.", "A few details first.")],
        onboarding_state: {
          questions: [
            { id: "transport", prompt: "How does the meter send data?", required: true, options: ["Its own JSON over MQTT", "Sparkplug B"] },
            { id: "units", prompt: "Which unit is the flow in?", required: false, options: ["L/min", "m³/h"] },
          ],
        },
      }),
    },
  ]);
  await page.goto(base);
  const chat = await openConversation(page, "Meters");
  const panel = page.getByRole("complementary", { name: "Assistant", exact: true });
  const picker = chat.getByRole("combobox", { name: "Suggested answer" }).first();
  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(picker).toBeFocused();
  await chat.getByRole("combobox", { name: "Conversation" }).click();
  await expect(page.getByRole("option", { name: "Meters" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "Meters" })).toBeHidden();
  await expect(panel).toBeVisible();

  const next = chat.getByRole("button", { name: "Continue with these answers" });
  await expect(next).toBeDisabled();
  await picker.click();
  await page.getByRole("option", { name: "Its own JSON over MQTT" }).click();
  await expect(panel).toBeVisible();
  // The optional question is unanswered and does not hold the card.
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => requests.find((r) => r.path.endsWith("/conversations/c-3/messages"))?.body.answers).toEqual([
    { id: "transport", answer: "Its own JSON over MQTT" },
    { id: "units", answer: "Skip for now" },
  ]);
  expect(errors).toEqual([]);
});

test("a message written while the assistant answers is sent when the answer ends", async ({ page }) => {
  const { errors, requests } = await setup(page);
  let running = true;
  await onboardingAssistant(page, requests, [
    {
      id: "c-4",
      title: "Meters",
      adapter_uuid: null,
      detail: () => ({
        runs: [assistantRun("r-1", "I dismissed this proposal. Help me adjust it.", running ? null : "What should change?", running ? "running" : "completed")],
      }),
    },
  ]);
  await page.goto(base);
  const chat = await openConversation(page, "Meters");
  await expect(chat.getByRole("button", { name: "Stop" })).toBeVisible();
  const composer = chat.getByLabel("Message the onboarding assistant");
  await composer.fill("The topic is meters/WM-2001/telemetry.");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(chat).toContainText("Sends when the assistant finishes.");
  expect(requests.some((r) => r.path.endsWith("/messages"))).toBe(false);
  running = false;
  await expect
    .poll(() => requests.find((r) => r.path.endsWith("/conversations/c-4/messages"))?.body.text, { timeout: 15000 })
    .toBe("The topic is meters/WM-2001/telemetry.");
  await expect(chat).not.toContainText("Sends when the assistant finishes.");
  expect(errors).toEqual([]);
});

test("the assistant publishes the profile it drafted once checks pass, then hands back", async ({ page }) => {
  const { errors, requests } = await setup(page);
  const drafted = "50000000-0000-4000-8000-000000000001";
  let published = false;
  await onboardingAssistant(page, requests, [
    {
      id: "c-5",
      title: "Tank sensors",
      adapter_uuid: null,
      detail: () => ({
        profile_uuid: drafted,
        profile_name: "Tank level sensor",
        runs: [assistantRun("r-1", "Draft a profile for our tank level sensors.", "I saved every section of the profile draft.")],
      }),
    },
  ]);
  await page.route(`**/device-profiles/${drafted}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: value }) });
    if (route.request().method() === "POST") requests.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith("/validate")) return data({ draft_revision: 2, valid: true, diagnostics: [] });
    if (path.endsWith("/compile"))
      return data({ draft_revision: 2, definition: {}, definition_hash: "a".repeat(64), revision: 1 });
    if (path.endsWith("/publish")) {
      published = true;
      return data({ uuid: "a-1", revision: 1 });
    }
    return data({
      uuid: drafted,
      code: "tank-level",
      name: "Tank level sensor",
      status: published ? "published" : "draft",
      revision: published ? 1 : 0,
      draft_revision: 2,
      parameters: [{ uuid: "level", key: "level", label: "Level", data_type: "number", unit: "%" }],
      parameter_groups: [],
      alarm_templates: [],
      active_artifact: null,
    });
  });
  await page.goto(base);
  const chat = await openConversation(page, "Tank sensors");
  await expect(chat).toContainText("Checks passed. Version 1 can be used for devices once it is published.");
  await chat.getByRole("button", { name: "Publish version 1" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Publish version 1?" });
  await expect(confirm).toContainText("Tank level sensor becomes available when you add devices.");
  await confirm.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(chat).toContainText("Version 1 is live");
  expect(requests.find((r) => r.path.endsWith(`/device-profiles/${drafted}/publish`))?.body).toEqual({
    draft_revision: 2,
  });
  await chat.getByRole("button", { name: "Continue setup" }).click();
  await expect
    .poll(() => requests.find((r) => r.path.endsWith("/conversations/c-5/messages"))?.body.text)
    .toBe("I published Tank level sensor version 1.");
  expect(errors).toEqual([]);
});

test("Activity lists webhook outcomes and rejections, and a failed delivery becomes a fixture", async ({
  page,
}) => {
  const { errors } = await setup(page, false, "webhook");
  await page.goto(base + "/" + id);
  await page.getByRole("tab", { name: "Activity" }).click();
  const accepted = page.getByRole("listitem").filter({ hasText: "Accepted" });
  await expect(accepted).toContainText("42");
  await expect(accepted).toContainText("310 in 7 days");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Rate limited" }),
  ).toContainText("2 in 7 days");
  const table = page.getByRole("table", { name: "Rejected and failed deliveries" });
  await expect(
    table.getByRole("row").filter({ hasText: "203.0.113.7" }),
  ).toContainText("Unauthenticated");
  await expect(
    table.getByRole("row").filter({ hasText: "Missing meter serial" }),
  ).toContainText("Decode failed");
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await table
    .getByRole("button", { name: "Add failed delivery /uplink as fixture" })
    .click();
  await expect(page.getByText("Added as fixture 2.", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Decode" }).click();
  await expect(page.locator(".cm-content").nth(1)).toContainText("vendor-cloud");
  expect(errors).toEqual([]);
});

test("Activity shows poll runs and the cursor, resets it within 30 days and resumes a stopped source", async ({
  page,
}) => {
  const { errors, requests } = await setup(page, false, "poll");
  await page.goto(base + "/" + id);
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByText("Stopped: credentials rejected").first()).toBeVisible();
  const runs = page.getByRole("table", { name: "Poll runs" });
  await expect(runs.getByRole("row").filter({ hasText: "HTTP 503" })).toContainText(
    "Retrying",
  );
  await expect(runs.getByRole("row").filter({ hasText: "640" })).toContainText(
    "2026-10-27T08:40:00Z → 2026-10-27T09:14:00Z",
  );
  await expect(page.getByText(/^committed /)).toBeVisible();
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Reset cursor" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset the polling cursor" });
  const input = dialog.getByLabel("Start reading from");
  await expect(input).toHaveAttribute("min", /T/);
  await expect(input).toHaveAttribute("max", /T/);
  const old = new Date(Date.now() - 40 * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await input.fill(
    `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())}T08:00`,
  );
  await expect(dialog).toContainText("Choose a time within the last 30 days.");
  await expect(dialog.getByRole("button", { name: "Reset cursor" })).toBeDisabled();
  const recent = new Date(Date.now() - 2 * 86400000);
  await input.fill(
    `${recent.getFullYear()}-${pad(recent.getMonth() + 1)}-${pad(recent.getDate())}T08:00`,
  );
  await dialog.getByRole("button", { name: "Reset cursor" }).click();
  await expect(dialog).toHaveCount(0);
  const reset = requests.find((r) => r.path.endsWith("/cursor"))?.body;
  expect(reset.request_uuid).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Date(reset.start_at).getDate()).toBe(recent.getDate());

  await page.getByRole("button", { name: "Resume polling" }).click();
  await expect
    .poll(() => requests.some((r) => r.path.endsWith("/resume")))
    .toBe(true);
  expect(errors).toEqual([]);
});

test("an OPC UA server connects, has its certificate reviewed, and is browsed with live values", async ({ page }) => {
  const { errors } = await setup(page);
  const conn = "50000000-0000-4000-8000-000000000001";
  const fingerprint = "8598fc68c9a75d9c4cad944c72a9a04759108a886edc8f5deee52b40406bdd72";
  const ns = "urn:example:bms:example-tower";
  const certificate = { subject: "CN=Example Tower BMS simulator", fingerprint, valid_from: minutes(60), valid_to: "2030-01-01T00:00:00Z", application_uri: ns };
  let connection: any = null;
  let tests = 0;
  const sent: { path: string; body: any }[] = [];
  await page.route("**/api/v1/organizations/*/adapter-connections**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*adapter-connections/, "");
    const method = route.request().method();
    const body = method === "GET" ? null : route.request().postDataJSON();
    sent.push({ path, body });
    const data = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data: value }) });
    if (path === "" && method === "GET") return data(connection ? [connection] : []);
    if (path === "" && method === "POST") {
      connection = {
        uuid: conn, name: body.name, protocol: "opcua", endpoint_url: body.endpoint_url, runs_at: "platform",
        security_policy: body.security_policy, security_mode: body.security_mode, security_label: "Encrypted (Basic256Sha256)",
        unencrypted_confirmed_by: null, identity: body.identity, username: body.username ?? null, has_password: Boolean(body.password),
        has_user_certificate: false, client_certificate: { fingerprint: "ab".repeat(32), expires_at: "2031-11-27T00:00:00Z" },
        server_certificate: null, pending_server_certificate: null, state: "draft", status: null, refused_points: [], created_at: minutes(0), updated_at: minutes(0),
      };
      return data(connection, 201);
    }
    if (path === `/${conn}/endpoints`) {
      connection = { ...connection, pending_server_certificate: certificate, state: "awaiting_trust" };
      return data({
        connection,
        endpoints: [
          { policy: "Basic256Sha256", mode: "SignAndEncrypt", label: "Encrypted (Basic256Sha256)", strength: 32, refused: null, warning: null, server_certificate: certificate },
          { policy: "Basic256Sha256", mode: "Sign", label: "Signed (Basic256Sha256)", strength: 22, refused: null, warning: null, server_certificate: certificate },
          { policy: "None", mode: "None", label: "Not encrypted", strength: 0, refused: null, warning: "Values and sign-in travel unencrypted", server_certificate: certificate },
          { policy: "Basic128Rsa15", mode: "SignAndEncrypt", label: "Basic128Rsa15", strength: 0, refused: "This policy is broken; the platform never uses it.", warning: null, server_certificate: certificate },
        ],
      });
    }
    if (path === `/${conn}/server-certificate/accept`) {
      connection = { ...connection, server_certificate: certificate, pending_server_certificate: null, state: "draft" };
      return data(connection);
    }
    if (path === `/${conn}/test`) {
      tests += 1;
      if (tests === 1) {
        connection = { ...connection, state: "unreachable", status: { reason: "client_certificate_untrusted", message: "The server refused the platform's certificate.", fix: "Move the platform's certificate to the server's trusted list, then test again.", checked_at: minutes(0) } };
        return data({ connected: false, reason: "client_certificate_untrusted", message: connection.status.message, fix: connection.status.fix, connection });
      }
      connection = { ...connection, state: "connected", status: { reason: null, checked_at: minutes(0), clock_difference_ms: -41, limits: { MaxNodesPerRead: 10000 }, security: { policy: "Basic256Sha256", mode: "SignAndEncrypt", label: "Encrypted (Basic256Sha256)", warning: null } } };
      return data({ connected: true, limits: { MaxNodesPerRead: 10000 }, clock_difference_ms: -41, connection });
    }
    if (path === `/${conn}/nodes`) {
      const parent = url.searchParams.get("parent");
      if (!parent) return data({ items: [{ node_id: "s=L03-VAV-2", namespace_uri: ns, name: "L03-VAV-2", display_name: "L03-VAV-2", kind: "object", type: "Zone box with reheat", has_children: true }], cursor: null });
      return data({
        items: [
          { node_id: "s=L03-VAV-2.zone_temperature", namespace_uri: ns, name: "zone_temperature", display_name: "Zone temperature", kind: "point", type: null, has_children: false },
          { node_id: "s=L03-VAV-2.schedule", namespace_uri: ns, name: "schedule", display_name: "Schedule", kind: "point", type: null, has_children: false },
        ],
        cursor: null,
      });
    }
    if (path === `/${conn}/nodes/read`)
      return data({
        points: [
          { node_id: "s=L03-VAV-2.zone_temperature", namespace_uri: ns, value: 22.5, data_type: "number", unit: "°C", status: "Good", quality: "good", source_time: minutes(0), storable: true, not_storable: null },
          { node_id: "s=L03-VAV-2.schedule", namespace_uri: ns, value: null, data_type: null, unit: null, status: "Good", quality: "good", source_time: minutes(0), storable: false, not_storable: "A structure cannot be stored as a reading" },
        ],
      });
    if (path === `/${conn}/nodes/search`)
      return data({ matches: [{ node_id: "s=L03-VAV-2", namespace_uri: ns, name: "L03-VAV-2", display_name: "L03-VAV-2", kind: "object", type: "Zone box with reheat", has_children: true, path: [{ namespace_uri: ns, name: "Example Tower" }, { namespace_uri: ns, name: "L03-VAV-2" }] }], visited: 40, truncated: false });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not mocked" }) });
  });

  await page.goto(base + "/new");
  await page.getByRole("radio", { name: /OPC UA server/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Example Tower BMS");
  await page.getByLabel("Server address").fill("opc.tcp://bms.example.com:4840");
  await page.getByRole("combobox", { name: "Sign-in" }).click();
  await page.getByRole("option", { name: "User name and password" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Enter the user name. Enter the password.")).toBeVisible();
  await page.getByLabel("User name").fill("operator");
  await page.getByLabel("Password").fill("test-only-password");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Certificate", { exact: false }).first()).toBeVisible();
  expect(sent.find((r) => r.path === "" && r.body)?.body).toMatchObject({ security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", identity: "username", username: "operator" });

  // The server's offer: the strongest is chosen, the broken one is refused, unencrypted asks first.
  await page.getByRole("button", { name: "Ask the server" }).click();
  await expect(page.getByRole("radio", { name: /Encrypted \(Basic256Sha256\)/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Basic128Rsa15/ })).toBeDisabled();
  await page.getByRole("radio", { name: /Not encrypted/ }).click();
  await expect(page.getByRole("button", { name: "Use Not encrypted" })).toBeDisabled();
  await page.getByRole("radio", { name: /Encrypted \(Basic256Sha256\)/ }).click();
  await expect(page.getByRole("button", { name: /^Use / })).toHaveCount(0);

  await expect(page.getByText("Review the server’s certificate")).toBeVisible();
  await expect(page.getByText(fingerprint).first()).toBeVisible();
  await page.getByRole("button", { name: "Trust this certificate" }).click();
  // The route records the request after the click returns, so wait for it.
  await expect.poll(() => sent.find((r) => r.path.endsWith("/accept"))?.body).toEqual({ fingerprint });
  await expect(page.getByRole("button", { name: "Trust this certificate" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download (.der)" })).toHaveAttribute("href", /client-certificate\?format=der/);

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("The server does not trust the platform yet")).toBeVisible();
  await expect(page.getByText("Move the platform's certificate to the server's trusted list")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("The server does not trust the platform yet")).toHaveCount(0);

  const tree = page.getByRole("treegrid", { name: "Address space" });
  await expect(tree.getByText("L03-VAV-2")).toBeVisible();
  await tree.getByRole("button", { name: "Show what is in L03-VAV-2" }).click();
  await expect(tree.getByText("22.5 °C")).toBeVisible();
  await expect(tree.getByRole("row", { name: /Schedule/ })).toHaveAttribute("data-muted", "");
  await page.getByLabel("Find a node by name").fill("VAV-2");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Example Tower / L03-VAV-2")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("a point map is picked from one equipment, applied to similar ones, given a device type and reviewed", async ({ page }) => {
  const { errors, requests } = await setup(page);
  const conn = "50000000-0000-4000-8000-000000000002";
  const ns = "urn:example:bms:example-tower";
  const zoneType = "60000000-0000-4000-8000-000000000001";
  let created = false;
  const connection = {
    uuid: conn, name: "Example Tower BMS", protocol: "opcua", endpoint_url: "opc.tcp://bms.example.com:4840", runs_at: "platform",
    security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", security_label: "Encrypted (Basic256Sha256)", unencrypted_confirmed_by: null,
    identity: "anonymous", username: null, has_password: false, has_user_certificate: false, client_certificate: { fingerprint: "ab".repeat(32), expires_at: "2031-11-27T00:00:00Z" },
    server_certificate: { subject: "CN=Example Tower BMS simulator", fingerprint: "cd".repeat(32), valid_from: null, valid_to: "2030-01-01T00:00:00Z", application_uri: ns },
    pending_server_certificate: null, state: "connected", status: { reason: null, checked_at: minutes(1) }, refused_points: [], created_at: minutes(60), updated_at: minutes(1),
  };
  const point = (id: string, name: string, display: string) => ({ node_id: `s=L03-VAV-2.${id}`, namespace_uri: ns, name, display_name: display, kind: "point", type: null, has_children: false });
  const sent: Record<string, any> = {};
  await page.route("**/api/v1/organizations/*/device-adapter-profiles", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: created ? [{ uuid: zoneType, name: "Zone controller", revision: 1, definition: { parameters: [
      { uuid: "p1", key: "zone_temperature", data_type: "number", unit: "°C", reports_state: true, kind: "measurement" },
      { uuid: "p2", key: "temperature_setpoint", data_type: "number", unit: "°C", reports_state: true, kind: "measurement" },
    ] } }] : [] }) }),
  );
  await page.route("**/api/v1/organizations/*/device-adapters/point-map/device-type", async (route) => {
    sent.deviceType = route.request().postDataJSON();
    created = true;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { artifact_uuid: zoneType, profile_uuid: "70000000-0000-4000-8000-000000000001", name: "Zone controller", revision: 1 } }) });
  });
  await page.route("**/api/v1/organizations/*/adapter-connections**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*adapter-connections/, "");
    const data = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: value }) });
    if (path === "") return data([connection]);
    if (path === `/${conn}/nodes`) {
      const parent = url.searchParams.get("parent");
      if (!parent) return data({ items: [{ node_id: "s=L03-VAV-2", namespace_uri: ns, name: "L03-VAV-2", display_name: "L03-VAV-2", kind: "object", type: "Zone box with reheat", has_children: true }], cursor: null });
      return data({ items: [point("zone_temperature", "zone_temperature", "Zone temperature"), point("temperature_setpoint", "temperature_setpoint", "Temperature setpoint"), point("schedule", "schedule", "Schedule")], cursor: null });
    }
    if (path === `/${conn}/nodes/read`) {
      const nodes: string[] = route.request().postDataJSON().nodes;
      return data({ points: nodes.map((n) => {
        const node_id = n.split(";").slice(1).join(";");
        const schedule = node_id.endsWith("schedule");
        return { node_id, namespace_uri: ns, value: schedule ? null : 21.5, data_type: schedule ? null : "number", unit: schedule ? null : "°C", status: "Good", quality: "good", source_time: minutes(0), storable: !schedule, not_storable: schedule ? "A structure cannot be stored as a reading" : null };
      }) });
    }
    if (path === `/${conn}/point-map/suggest`) {
      sent.suggest = route.request().postDataJSON();
      return data({ readings: sent.suggest.points.map((p: any) => ({ key: p.name, name: p.display_name, data_type: "number", unit: "°C", range: [10, 35], report: { sample_ms: 10000, deadband: { kind: "percent", value: 0.5 } } })), refused: [] });
    }
    if (path === `/${conn}/nodes/similar`) {
      sent.similar = route.request().postDataJSON();
      const box = (level: string, n: number, missing: string[] = []) => ({ source_id: `Example Tower/${level}/${level}-VAV-${n}`, display_name: `${level}-VAV-${n}`, address: { node_id: `s=${level}-VAV-${n}`, namespace_uri: ns, path: [{ namespace_uri: ns, name: "Example Tower" }, { namespace_uri: ns, name: level }, { namespace_uri: ns, name: `${level}-VAV-${n}` }] }, missing });
      return data({ matches: [box("L03", 1), box("L02", 1), box("L02", 2, ["temperature_setpoint"])], truncated: false });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not mocked" }) });
  });

  await page.goto(base + "/new");
  await page.getByRole("radio", { name: /OPC UA server/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const tree = page.getByRole("treegrid", { name: "Address space" });
  await tree.getByRole("button", { name: "Map this" }).click();
  await expect(page.getByText("A structure cannot be stored as a reading")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Schedule" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Zone temperature" }).click();
  await page.getByRole("checkbox", { name: "Temperature setpoint" }).click();
  await page.getByRole("button", { name: "Use 2 points" }).click();
  expect(sent.suggest.points.map((p: any) => p.node)).toEqual([`nsu=${ns};s=L03-VAV-2.zone_temperature`, `nsu=${ns};s=L03-VAV-2.temperature_setpoint`]);

  const readings = page.getByRole("table", { name: "Readings" });
  await expect(readings.getByLabel("Key of reading 1")).toHaveValue("zone_temperature");
  await readings.getByLabel("Name of reading 2").fill("Setpoint");
  await page.getByRole("button", { name: "Find similar" }).click();
  await expect(page.getByText("3 found, 3 new.")).toBeVisible();
  expect(sent.similar).toMatchObject({ by: "type", equipment: { node: `nsu=${ns};s=L03-VAV-2` }, points: [{ key: "zone_temperature", name: "zone_temperature" }, { key: "temperature_setpoint", name: "temperature_setpoint" }] });
  const equipment = page.getByRole("table", { name: "Equipment" });
  await expect(equipment.getByRole("row")).toHaveCount(5);
  await expect(equipment.getByRole("row", { name: /L02-VAV-2/ })).toContainText("Setpoint");
  await equipment.getByRole("button", { name: "Remove L02-VAV-1" }).click();
  await expect(equipment.getByRole("row")).toHaveCount(4);

  await page.getByLabel("New device type").fill("Zone controller");
  await page.getByRole("button", { name: "Create and publish" }).click();
  await expect(page.getByRole("combobox", { name: "Device type" })).toContainText("Zone controller · revision 1");
  expect(sent.deviceType.readings.map((r: any) => [r.key, r.name, r.unit])).toEqual([["zone_temperature", "Zone temperature", "°C"], ["temperature_setpoint", "Setpoint", "°C"]]);
  await expect(page.getByLabel("Data source name")).toHaveValue("Zone controller");
  await page.getByRole("button", { name: "Save point map" }).click();
  await expect(page).toHaveURL(base + "/" + id);
  const saved = requests.find((r) => r.path.endsWith("/device-adapters"))?.body;
  expect(saved.code).toBe("");
  expect(saved.fixtures).toEqual([]);
  expect(saved.artifact_uuid).toBe(zoneType);
  expect(saved.source.type).toBe("opcua");
  expect(saved.source.connection_uuid).toBe(conn);
  expect(saved.source.point_map.equipment.map((e: any) => e.source_id)).toEqual(["L03-VAV-2", "Example Tower/L03/L03-VAV-1", "Example Tower/L02/L02-VAV-2"]);
  expect(saved.source.point_map.equipment[2].missing).toEqual(["temperature_setpoint"]);
  expect(saved.source.point_map.readings[0]).toMatchObject({ key: "zone_temperature", unit: "°C", scale: 1, offset: 0, address: { relative_path: [{ namespace_uri: ns, name: "zone_temperature" }] } });

  await page.getByRole("tab", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Check the point map" }).click();
  await expect(page.getByText("Passed", { exact: true })).toBeVisible();
  await expect(page.getByText("5 of this organization's 10,000")).toBeVisible();
  await expect(page.getByRole("table", { name: "Current values of L03-VAV-2" })).toContainText("20 °C");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("an OPC UA data source's waiting equipment is activated together, with uncertain and unknown values shown", async ({ page }) => {
  const ns = "urn:example:bms:example-tower";
  const map = {
    version: 1, protocol: "opcua", rhythm_seconds: 300,
    readings: [{ key: "zone_temperature", name: "Zone temperature", data_type: "number", unit: "°C", scale: 1, offset: 0, report: { sample_ms: 10000, deadband: { kind: "none", value: 0 } }, address: { relative_path: [{ namespace_uri: ns, name: "zone_temperature" }] } }],
    equipment: ["L03-VAV-2", "L03-VAV-7"].map((name) => ({ source_id: `Example Tower/L03/${name}`, display_name: name, address: { namespace_uri: ns, path: [{ namespace_uri: ns, name }] } })),
  };
  const { errors, requests } = await setup(page, false, "platform", { source: { type: "opcua", connection_uuid: "50000000-0000-4000-8000-000000000002", point_map: map } });
  const source = (n: number, name: string, metric: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    uuid: `70000000-0000-4000-8000-00000000000${n}`, source_device_id: `Example Tower/L03/${name}`, name, status: "discovered", last_seen_at: minutes(1),
    preview: { sourceDeviceId: `Example Tower/L03/${name}`, timestampSource: "server", metrics: [{ name: "zone_temperature", unit: "°C", ...metric }] },
    installation_uuid: null, device: null, in_use_in: null, ...extra,
  });
  let activated = false;
  const sources = () => [
    source(1, "L03-VAV-2", { value: null, quality: "bad", reason: "No communication with the device" }, activated ? { device: { uuid: device, name: "L03-VAV-2", lifecycle: "active" } } : {}),
    source(2, "L03-VAV-7", { value: 21.4, quality: "uncertain", reason: "Uncertain value (UncertainLastUsableValue)" }, activated ? { device: { uuid: "40000000-0000-4000-8000-000000000002", name: "L03-VAV-7", lifecycle: "active" } } : {}),
  ];
  await page.route(`**/api/v1/organizations/*/device-adapters/${id}/candidates`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: sources() }) }),
  );
  const batch = "80000000-0000-4000-8000-000000000001";
  const results = () => sources().map((s) => ({ candidate_uuid: s.uuid, outcome: "activated", message: null, device: { uuid: s.device?.uuid ?? device, name: s.name } }));
  await page.route(`**/api/v1/organizations/*/device-adapters/${id}/candidates/activate`, (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { uuid: batch, status: "queued", total: 2, results: [] } }) });
  });
  await page.route(`**/api/v1/organizations/*/device-adapters/${id}/candidates/activations/${batch}`, (route) => {
    activated = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { uuid: batch, status: "done", total: 2, results: results() } }) });
  });
  await page.goto(`${base}/${id}`);
  await page.getByRole("tab", { name: "Devices" }).click();
  const table = page.getByRole("table", { name: "Equipment" });
  await expect(table.getByText("Unknown", { exact: true })).toBeVisible();
  await expect(table.getByText("Uncertain", { exact: true })).toBeVisible();
  await expect(table.getByText("21.4 °C")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: "Activate 2" }).click();
  await expect(page.getByText("2 devices activated.")).toBeVisible();
  await expect(table.getByRole("link", { name: "L03-VAV-2" })).toHaveAttribute("href", `/organizations/${org}/devices/${device}/overview`);
  expect(requests.find((r) => r.path.endsWith("/candidates/activate"))?.body).toEqual({ sources: sources().map((s) => ({ candidate_uuid: s.uuid })) });
  expect(errors).toEqual([]);
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
