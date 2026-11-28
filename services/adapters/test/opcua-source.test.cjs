// The tenant runtime's OPC UA source (spec 038 PR 5): one session per connection shared by
// its data sources, results shaped by the device type with each value's quality, the
// connection's state and refused points as events, and the publisher's Sparkplug
// properties for quality and server time. The live tests run against the simulator.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const sparkplug = require("../lib/sparkplug.cjs");
const { flowNodes } = require("../lib/flow.cjs");
const { Sources } = require("../lib/opcua/source.cjs");
const { live, start } = require("./opcua-simulator.cjs");

const CONTRACT = path.resolve(__dirname, "../../../contracts/pointmaps/v1");
const BOX = "Example Campus/Example Tower/L03/L03-Z2/L03-VAV-2";
const TYPES = { number: "number", boolean: "boolean", state: "integer", text: "string" };

const fixture = () => {
  const map = JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.fixture.json"), "utf8"));
  for (const reading of map.readings) reading.report.sample_ms = 1000;
  return map;
};
const profileOf = (map) => ({
  parameters: map.readings.map((r, i) => ({ uuid: `30000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, key: r.key, kind: "measurement", data_type: TYPES[r.data_type], unit: r.unit ?? null, reports_state: true })),
});

async function until(check, timeout = 20_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const property = (metric, key) => {
  const i = metric.properties?.keys.indexOf(key) ?? -1;
  return i < 0 ? undefined : metric.properties.values[i].stringValue;
};

test("the publisher sends a bad value as null with its quality and reason, and labels a server time", () => {
  const bad = sparkplug.Payload.decode(sparkplug.encode(0, [sparkplug.metric("zone_temperature", "Double", 21.5, 1, undefined, { server: true, quality: "bad", reason: "No communication with the device" })])).metrics[0];
  assert.equal(bad.isNull, true);
  assert.equal(property(bad, "quality"), "bad");
  assert.equal(property(bad, "quality_reason"), "No communication with the device");
  assert.equal(property(bad, "timestamp_source"), "server");
  const uncertain = sparkplug.Payload.decode(sparkplug.encode(0, [sparkplug.metric("zone_temperature", "Double", 21.5, 1, undefined, { quality: "uncertain", reason: "x".repeat(200) })])).metrics[0];
  assert.equal(uncertain.doubleValue, 21.5);
  assert.equal(property(uncertain, "quality"), "uncertain");
  assert.equal(property(uncertain, "quality_reason").length, 120);
  const good = sparkplug.Payload.decode(sparkplug.encode(0, [sparkplug.metric("zone_temperature", "Double", 21.5, 1, undefined, { quality: "good" })])).metrics[0];
  assert.equal(good.properties, null);
});

test("an OPC UA flow is source, publisher and reporter, with the connection's secrets as one credential", () => {
  const nodes = flowNodes(
    { adapter_uuid: "30000000-0000-4000-8000-000000000001", revision_uuid: "r", name: "Zone controllers", profile: { parameters: [] }, tenant: { uuid: "t", runtime_token: "token" } },
    { type: "opcua", connection: { uuid: "c" }, point_map: fixture(), secrets: { password: "secret" }, private_ranges: [], platform_ranges: [] },
    { url: "mqtts://platform.example.com:8883", username: "u", password: "p" },
    "http://api.test/callback",
  );
  assert.deepEqual(nodes.map((n) => n.type), ["tab", "iot-adapter-source", "iot-adapter-publisher", "iot-adapter-reporter"]);
  const source = nodes[1];
  assert.deepEqual(source.wires, [["adapter-30000000-0000-4000-8000-000000000001-publisher"], ["adapter-30000000-0000-4000-8000-000000000001-reporter"]]);
  assert.deepEqual(JSON.parse(source.credentials.opcua_secrets), { password: "secret" });
  assert.ok(!JSON.stringify(source.source).includes("secret"));
  assert.deepEqual(source.profile, { parameters: [] });
});

describe("collecting through the runtime's connections", live(), () => {
  let sim;
  let sources;
  const pkiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opcua-source-"));
  const body = () => ({ connection: { uuid: "30000000-0000-4000-8000-000000000021", endpoint_url: sim.url, security_policy: "None", security_mode: "None", identity: "anonymous" }, secrets: {}, private_ranges: [], platform_ranges: [] });
  before(async () => {
    sim = await start();
    sources = new Sources({ pkiRoot, allowPrivate: () => true });
  });
  after(async () => {
    await sources?.closeAll();
    await sim?.stop();
    fs.rmSync(pkiRoot, { recursive: true, force: true });
  });

  test("shares one session, shapes values by the device type and reports the connection", async () => {
    const map = fixture();
    const profile = profileOf(map);
    const results = [];
    const events = [];
    const handlers = (into) => ({ result: (r) => into.push(r), event: (e) => events.push(e), health: () => {} });
    const stop = sources.register("30000000-0000-4000-8000-000000000001", body(), map, profile, handlers(results));
    const others = [];
    const stopOther = sources.register("30000000-0000-4000-8000-000000000002", body(), map, profile, handlers(others));
    try {
      assert.equal(sources.shared.size, 1);
      const first = await until(() => results.find((r) => r.sourceDeviceId === BOX && r.timestampSource === "server"));
      const temperature = first.metrics.find((m) => m.name === "zone_temperature");
      assert.equal(temperature.datatype, "Double");
      assert.equal(temperature.parameter_uuid, profile.parameters[0].uuid);
      assert.equal(temperature.unit, "°C");
      assert.equal(temperature.quality, "good");
      assert.equal(first.metrics.find((m) => m.name === "operating_state").datatype, "Int64");
      await until(() => others.length);
      const status = await until(() => events.find((e) => e.kind === "connection_status" && e.state === "connected"));
      assert.equal(status.reason, null);
      assert.deepEqual(status.security, { policy: "None", mode: "None" });
      const refused = await until(() => events.find((e) => e.kind === "refused_points"));
      assert.deepEqual(refused.polled, []);

      await sim.scenario("controller_offline", true, "L03-VAV-2");
      try {
        const bad = await until(() => results.find((r) => r.sourceDeviceId === BOX && r.metrics.find((m) => m.name === "zone_temperature")?.quality === "bad"));
        assert.deepEqual(bad.metrics.find((m) => m.name === "zone_temperature"), { name: "zone_temperature", value: null, datatype: "Double", parameter_uuid: profile.parameters[0].uuid, unit: "°C", quality: "bad", reason: "No communication with the device" });
      } finally {
        await sim.scenario("controller_offline", false);
      }
    } finally {
      await stop();
      assert.equal(sources.shared.size, 1, "the other data source keeps the session");
      await stopOther();
    }
    assert.equal(sources.shared.size, 0);
  });

  test("a source clock out of bounds is stored at receipt and labelled so", async () => {
    await sim.scenario("clock_wrong", true, 600);
    const results = [];
    const stop = sources.register("30000000-0000-4000-8000-000000000003", body(), fixture(), profileOf(fixture()), { result: (r) => results.push(r), event: () => {}, health: () => {} });
    try {
      await sim.write("L03-VAV-2.temperature_setpoint", 23);
      const changed = await until(() => results.find((r) => r.sourceDeviceId === BOX && r.timestampSource !== "server"));
      assert.equal(changed.timestampSource, "receipt");
      assert.ok(Math.abs(Date.parse(changed.observedAt) - Date.now()) < 60_000);
    } finally {
      await stop();
      await sim.scenario("clock_wrong", false);
      await sim.write("L03-VAV-2.temperature_setpoint", 21);
    }
  });
});
