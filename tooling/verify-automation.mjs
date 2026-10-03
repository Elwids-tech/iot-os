#!/usr/bin/env node
// Runs only against the disposable Devices harness and its MQTT simulator.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/portal/package.json"));
const { request } = require("@playwright/test");
const env = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.ok(
  env.directory.includes("iot-devices-v1-"),
  "Disposable harness required",
);
const resources = JSON.parse(
  readFileSync(join(env.directory, "verified-resources.json"), "utf8"),
);
const origin = `http://127.0.0.1:${env.ports.portal}`;
const context = await request.newContext({
  baseURL: `http://127.0.0.1:${env.ports.api}`,
  extraHTTPHeaders: {
    Accept: "application/json",
    Origin: origin,
    Referer: origin + "/",
  },
});
await context.get("/sanctum/csrf-cookie");
async function api(method, path, data, status) {
  const cookie = (await context.storageState()).cookies.find(
    (c) => c.name === "XSRF-TOKEN",
  );
  const r = await context.fetch(path, {
    method,
    data,
    headers: cookie ? { "X-XSRF-TOKEN": decodeURIComponent(cookie.value) } : {},
  });
  const body = await r.json();
  assert.equal(
    r.status(),
    status ?? 200,
    `${method} ${path}: ${JSON.stringify(body)}`,
  );
  return body;
}
async function until(label, read, predicate, seconds = 35) {
  const end = Date.now() + seconds * 1000;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
let saved;
const base = `/api/v1/organizations/${resources.org}/workflows`;
try {
  await api("POST", "/api/v1/auth/login", {
    email: "shared.operator@example.test",
    password: "password",
  });
  const settings = (await api("GET", base + "/dag/settings")).data;
  await api("PUT", base + "/dag/settings", {
    revision: settings.revision,
    enabled: true,
    stopped: false,
  });
  const fixture = JSON.parse(
    readFileSync(
      join(root, "contracts/rules/v2/workflow.fixture.json"),
      "utf8",
    ),
  );
  const choices = [resources.meter, resources.light, resources.light];
  const parameters = [
    resources.meter.artifact.definition.parameters.find(
      (p) => p.data_type === "number" && p.kind !== "derived",
    ),
    resources.light.artifact.definition.parameters.find(
      (p) => p.key === "brightness",
    ),
    resources.light.artifact.definition.parameters.find(
      (p) => p.key === "power",
    ),
  ];
  fixture.bindings = fixture.bindings.map((b, i) => ({
    ...b,
    device_uuid: choices[i].device.uuid,
    configuration_uuid: choices[i].device.applied_configuration_uuid,
    generation: choices[i].device.deployment_generation,
    parameter_uuid: parameters[i].uuid,
    data_type: i === 2 ? "boolean" : "number",
    unit: parameters[i].unit ?? "",
  }));
  const latest = (
    await api(
      "GET",
      `/api/v1/organizations/${resources.org}/devices/${resources.light.device.uuid}/measurements/latest`,
    )
  ).data;
  const target = !latest.find((r) => r.parameter_uuid === parameters[2].uuid)
    .value;
  for (const n of fixture.nodes) {
    if (n.type === "window.v1")
      Object.assign(n.config, {
        duration_seconds: 4,
        slide_seconds: 4,
        lateness_seconds: 1,
      });
    if (n.type === "compare.v1") n.config.value = -1;
    if (n.type === "action.command.v1") n.config.value = target;
  }
  const validation = await api("POST", base + "/dag/validate", {
    workflow: fixture,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation));
  saved = (
    await api(
      "POST",
      base,
      { name: "Cross-device automation verification", workflow: fixture },
      201,
    )
  ).data;
  const path = base + "/" + saved.uuid;
  const hash = saved.definition_hash;
  await api("PUT", path + "/layout", {
    layout_revision: 0,
    layout: { positions: { temperature: { x: 10, y: 20 } } },
  });
  assert.equal((await api("GET", path)).data.definition_hash, hash);
  const start = Math.floor(Date.now() / 4000) * 4000;
  const iso = (s) => new Date(start + s * 1000).toISOString();
  const steps = [
    { at: iso(0), event: null },
    ...fixture.bindings
      .slice(0, 2)
      .map((b) => ({
        at: iso(1),
        event: {
          schema_version: "telemetry.committed.v1",
          event_id: randomUUID(),
          telemetry_id: randomUUID(),
          sequence: "1",
          organization_uuid: resources.org,
          device_uuid: b.device_uuid,
          configuration_uuid: b.configuration_uuid,
          generation: b.generation,
          readings: [
            {
              parameter_uuid: b.parameter_uuid,
              key: b.role,
              data_type: b.data_type,
              unit: b.unit || null,
              value: 200,
              quality: "good",
              observed_at: iso(1),
              received_at: iso(1),
              historical: false,
            },
          ],
        },
      })),
    { at: iso(5), event: null },
  ];
  const sim = await api("POST", path + "/simulate", {
    draft_revision: saved.draft_revision,
    steps,
  });
  assert.ok(
    sim.steps
      .flatMap((s) => s.intents)
      .some((a) => a.kind === "action.command.v1"),
    "Simulation proposes command",
  );
  assert.equal(
    (await api("GET", path + "/actions")).data.length,
    0,
    "Simulation is side effect free",
  );
  const operation = {
    operation_uuid: randomUUID(),
    draft_revision: saved.draft_revision,
    expected_generation: 0,
    target_state: "active",
    command_grants: [
      {
        node_id: "stop_pump",
        binding: "pump",
        value: target,
        cooldown_seconds: 60,
        max_per_minute: 1,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ],
  };
  await api("POST", path + "/deployments", operation, 202);
  await api("POST", path + "/deployments", operation, 202);
  await until(
    "Applied deployment",
    () => api("GET", path),
    (r) => r.data.deployment_status === "applied",
  );
  const outcomes = await until(
    "MQTT command observed",
    () => api("GET", path + "/actions"),
    (r) =>
      r.data.some(
        (a) =>
          a.kind === "action.command.v1" && a.status === "observed_at_target",
      ),
  );
  assert.equal(
    outcomes.data.filter((a) => a.kind === "action.command.v1").length,
    1,
  );
  assert.ok(
    outcomes.data.some(
      (a) => a.kind === "action.alert.v1" && a.status === "succeeded",
    ),
  );
  const health = (await api("GET", base + "/dag/health")).data;
  assert.equal(health.consumer_healthy, true);
  console.log(
    "PASS v2 validation, immutable save/layout, side-effect-free cross-device window simulation",
  );
  console.log(
    "PASS real committed telemetry → finalized DAG join → durable alert + authorized MQTT command → observed target; activation retry deduplicated",
  );
} finally {
  if (saved) {
    const w = (await api("GET", base + "/" + saved.uuid)).data;
    await api(
      "POST",
      base + "/" + saved.uuid + "/deployments",
      {
        operation_uuid: randomUUID(),
        draft_revision: w.draft_revision,
        expected_generation: w.deployment_generation,
        target_state: "inactive",
        command_grants: [],
      },
      202,
    );
    await until(
      "Disable acknowledgement",
      () => api("GET", base + "/" + saved.uuid),
      (r) => r.data.deployment_status === "inactive",
    );
  }
  await context.dispose();
}
