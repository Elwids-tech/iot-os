const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const sparkplug = require("../lib/sparkplug.cjs");

// The platform broker: every publish is acknowledged and recorded, decoded.
const published = [];
const clients = [];
require.cache[require.resolve("mqtt")] = {
  loaded: true,
  exports: {
    connect(url, options) {
      const client = new EventEmitter();
      clients.push(client);
      client.connected = false;
      client.options = options;
      client.subscribe = () => {};
      client.publish = (topic, payload, _options, callback) => {
        published.push({ topic, metrics: sparkplug.Payload.decode(payload).metrics.map((m) => m.name).sort() });
        callback?.();
      };
      client.end = (_force, _options, done) => done?.();
      setImmediate(() => {
        client.connected = true;
        client.emit("connect");
      });
      return client;
    },
  },
};
const nodes = require("./fake-red.cjs");

const ADAPTER = "30000000-0000-4000-8000-000000000001";
const config = {
  adapter_uuid: ADAPTER,
  revision_uuid: "30000000-0000-4000-8000-000000000003",
  upstream: { url: "mqtts://platform.example.com:8883", group_id: "tenant", edge_node_id: "adapter", host_id: "iot-os" },
  bindings: [{ source_device_id: "TRK-1001", installation_uuid: "30000000-0000-4000-8000-000000000004" }],
  retention_days: 30,
  credentials_for_test: { username: "publisher", password: "placeholder-password" },
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const record = (...names) => ({
  sourceDeviceId: "TRK-1001",
  observedAt: new Date().toISOString(),
  metrics: names.map((name) => ({ name, datatype: "Double", value: 1 })),
});
const feed = (publisher, ...decoded) =>
  new Promise((resolve) => publisher.handlers.input({ decoded, inputs: [{ receivedAt: new Date().toISOString(), source: "poll" }] }, () => {}, resolve));
const births = (from) => published.slice(from).filter((p) => p.topic.includes("/DBIRTH/"));

// A polled record without one reading, then one with it, both within the store's
// 30 s write interval. The process then dies without closing (a device activation
// redeploys the adapter; a crash skips the close). The restarted publisher must not
// announce the source with fewer metrics than it already had: on the pilot that
// partial birth put the activated device in review (ADR-025).
test("a source's birth never loses metrics across a publisher restart", async (t) => {
  process.env.IOT_ADAPTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-"));
  t.after(() => fs.rmSync(process.env.IOT_ADAPTER_DATA_DIR, { recursive: true, force: true }));
  const types = nodes();
  const before = new types["iot-adapter-publisher"](config);
  await tick();
  await feed(before, record("battery", "temperature"));
  await feed(before, record("battery", "rssi", "temperature"));
  assert.deepEqual(births(0).map((b) => b.metrics), [["battery", "temperature"], ["battery", "rssi", "temperature"]]);

  const restarted = published.length;
  const after = new types["iot-adapter-publisher"](config);
  await tick();
  await tick();
  await feed(after, record("temperature"));
  assert.deepEqual(births(restarted).map((b) => b.metrics), [["battery", "rssi", "temperature"]]);
  assert.ok(published.slice(restarted).some((p) => p.topic.includes("/DDATA/")), "the record is still published");
  await new Promise((resolve) => after.handlers.close(false, resolve));
});

// A polled tracker reports hourly to daily. After an adapter restart or a platform
// deploy the publisher must announce every source it knows, or the platform treats
// each one as offline until its next reading (pilot, 2026-10-30, ADR-027). It does
// so when it connects, when the platform asks for a rebirth, and when the platform's
// host comes back online.
test("a restarted publisher announces every known source on connect, rebirth and host online", async (t) => {
  process.env.IOT_ADAPTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "publisher-"));
  t.after(() => fs.rmSync(process.env.IOT_ADAPTER_DATA_DIR, { recursive: true, force: true }));
  const settings = { ...config, adapter_uuid: "30000000-0000-4000-8000-000000000011", bindings: [] };
  const announced = (from) =>
    published
      .slice(from)
      .filter((p) => p.topic.includes("/DBIRTH/"))
      .map((p) => p.topic)
      .sort();
  const types = nodes();
  const first = published.length;
  const before = new types["iot-adapter-publisher"](settings);
  await tick();
  await feed(before, record("battery"), { ...record("battery", "latitude"), sourceDeviceId: "TRK-2002" });
  const sources = announced(first);
  assert.equal(sources.length, 2);
  await new Promise((resolve) => before.handlers.close(false, resolve));
  assert.ok(fs.existsSync(path.join(process.env.IOT_ADAPTER_DATA_DIR, `births-${settings.adapter_uuid}.json`)));

  const restarted = published.length;
  const after = new types["iot-adapter-publisher"](settings);
  await tick();
  await tick();
  assert.deepEqual(announced(restarted), sources, "on connect");
  const client = clients.at(-1);
  for (const [trigger, topic, payload] of [
    ["Node Control/Rebirth", "spBv1.0/tenant/NCMD/adapter", sparkplug.encode(0, [sparkplug.metric("Node Control/Rebirth", "Boolean", true)])],
    ["host STATE online", "spBv1.0/STATE/iot-os", Buffer.from(JSON.stringify({ online: true, timestamp: Date.now() }))],
  ]) {
    const from = published.length;
    client.emit("message", topic, payload);
    assert.ok(published.slice(from)[0]?.topic.includes("/NBIRTH/"), `${trigger}: NBIRTH first`);
    assert.deepEqual(announced(from), sources, trigger);
  }
  await new Promise((resolve) => after.handlers.close(false, resolve));
});
