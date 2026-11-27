// The adapter manager's OPC UA routes against the simulated building (spec 038 PR 3,
// contracts/manager-api.md): what Laravel sends and what it gets back.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const { Routes } = require("../lib/opcua/routes.cjs");
const { assertConforms } = require("./contract-check.cjs");
const { NAMESPACE, live, platformCertificate, start } = require("./opcua-simulator.cjs");

const CONNECTION = "5f2b8c1e-3c1a-4d8e-9a7b-2c4d6e8f0a1b";

describe("the manager's OPC UA routes", live(), () => {
  let sim;
  let routes;
  let pkiRoot;
  let platform;
  before(async () => {
    sim = await start();
    pkiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routes-"));
    routes = new Routes({ pkiRoot, allowPrivate: () => true, idleMs: 1500 });
    platform = await platformCertificate(CONNECTION);
  });
  after(async () => {
    await routes?.closeAll();
    await sim?.stop();
    fs.rmSync(pkiRoot, { recursive: true, force: true });
  });

  const body = (connection = {}, secrets = {}, extra = {}) => ({
    connection: { uuid: CONNECTION, endpoint_url: sim.url, security_policy: "None", security_mode: "None", identity: "anonymous", server_fingerprint: null, ...connection },
    secrets: { client_certificate: platform.certificate, client_private_key: platform.privateKey, ...secrets },
    private_ranges: [],
    ...extra,
  });

  test("lists what the server offers with its certificate", async () => {
    assertConforms("opcua-request.v1", body());
    const answer = await routes.handle("/opcua/endpoints", body());
    assertConforms("opcua-endpoints.v1", answer);
    const { endpoints } = answer;
    const encrypted = endpoints.find((e) => e.policy === "Basic256Sha256");
    assert.equal(encrypted.server_certificate.fingerprint, sim.serverFingerprint());
    assert.match(encrypted.server_certificate.subject, /Example Tower BMS simulator/);
    assert.ok(Date.parse(encrypted.server_certificate.valid_to) > Date.now());
    assert.equal(encrypted.server_certificate.application_uri, "urn:example:bms:example-tower");
    assert.ok(encrypted.server_certificate.der.length > 100);
  });

  test("tests a connection, then browses, reads and searches through one session", async () => {
    const tested = await routes.handle("/opcua/test", body({ security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", server_fingerprint: sim.serverFingerprint() }));
    assertConforms("opcua-test.v1", tested);
    assert.equal(tested.connected, true);
    assert.equal(tested.security.label, "Encrypted (Basic256Sha256)");
    assert.equal(tested.limits.MaxNodesPerRead, 10000);
    const settings = body({ security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", server_fingerprint: sim.serverFingerprint() });
    const top = await routes.handle("/opcua/browse", settings);
    assert.ok(top.items.some((i) => i.name === "Example Campus"));
    const zone = await routes.handle("/opcua/browse", { ...settings, parent: { node_id: "s=L03-VAV-2", namespace_uri: NAMESPACE } });
    assertConforms("opcua-browse.v1", zone);
    assert.equal(zone.items.length, 14);
    const { points } = await routes.handle("/opcua/read", { ...settings, points: [{ node_id: "s=L03-VAV-2.zone_temperature", namespace_uri: NAMESPACE }] });
    assertConforms("opcua-read.v1", { points });
    assert.equal(points[0].unit, "°C");
    const found = await routes.handle("/opcua/search", { ...settings, text: "VAV-2" });
    assertConforms("opcua-search.v1", found);
    assert.equal(found.matches.length, 2);
    assert.equal(routes.sessions.size, 1);
  });

  test("closes an idle session", async () => {
    await routes.handle("/opcua/browse", body());
    assert.equal(routes.sessions.size, 1);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(routes.sessions.size, 0);
  });

  test("answers a failure with its reason and fix", async () => {
    const refused = await routes.handle("/opcua/test", body({ identity: "username" }, { username: "operator", password: "not-it" }));
    assert.deepEqual(Object.keys(refused).sort(), ["fix", "message", "reason"]);
    assertConforms("opcua-failure.v1", refused);
    assert.equal(refused.reason, "sign_in_refused");
    const notAllowed = await new Routes({ pkiRoot }).handle("/opcua/test", body());
    assert.equal(notAllowed.reason, "address_not_allowed");
  });

  test("names a changed server certificate and shows the one presented", async () => {
    const changed = await routes.handle("/opcua/test", body({ security_policy: "Basic256Sha256", security_mode: "SignAndEncrypt", server_fingerprint: "ab".repeat(32) }));
    assertConforms("opcua-failure.v1", changed);
    assert.equal(changed.reason, "server_certificate_changed");
    assert.equal(changed.server_certificate.fingerprint, sim.serverFingerprint());
  });

  test("finds similar equipment and checks a point map", async () => {
    const equipment = { node_id: "s=L03-VAV-2", namespace_uri: NAMESPACE, path: ["Example Campus", "Example Tower", "L03", "L03-Z2", "L03-VAV-2"].map((name) => ({ namespace_uri: NAMESPACE, name })) };
    const points = [{ key: "zone_temperature", name: "zone_temperature" }, { key: "temperature_setpoint", name: "temperature_setpoint" }];
    const found = await routes.handle("/opcua/similar", { ...body(), equipment, points, by: "type" });
    assertConforms("opcua-similar.v1", found);
    assert.ok(found.matches.length > 1);
    assert.ok(found.matches.some((m) => m.address.node_id === "s=L03-VAV-2"));
    const reading = (key, unit = "°C") => ({ key, name: key, data_type: "number", unit, report: { sample_ms: 10000, deadband: { kind: "none", value: 0 } }, address: { relative_path: [{ namespace_uri: NAMESPACE, name: key }] } });
    const map = { version: 1, protocol: "opcua", rhythm_seconds: 300, readings: [reading("zone_temperature"), reading("temperature_setpoint")], equipment: found.matches.slice(0, 3).map(({ source_id, display_name, address }) => ({ source_id, display_name, address })) };
    const checked = await routes.handle("/opcua/check", { ...body(), point_map: map });
    assertConforms("opcua-check.v1", checked);
    assert.deepEqual(checked.problems, []);
    assert.equal(checked.valid, true);
    assert.deepEqual(checked.totals, { devices: 3, readings: 2, points: 6, rows_per_day: 6 * 288 });
    assert.equal(typeof checked.equipment[0].readings[0].value, "number");
    const broken = await routes.handle("/opcua/check", { ...body(), point_map: { ...map, readings: [reading("zone_temperature", null), reading("no_such_point")] } });
    assert.equal(broken.valid, false);
    assert.ok(broken.problems.some((p) => p.key === "zone_temperature" && /unit/.test(p.problem)));
    assert.ok(broken.problems.some((p) => p.key === "no_such_point" && /not found/i.test(p.problem)));
  });

  test("refuses a private range that reaches what is never reachable", async () => {
    await assert.rejects(routes.handle("/opcua/test", body({}, {}, { private_ranges: ["127.0.0.0/8"] })), /never reachable/);
  });
});
