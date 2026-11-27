// Collecting from the simulated building: change reports, rhythm reports with the
// server's time, bad and uncertain quality, refused points, and collecting again after a
// server restart (spec 038 PR 2, research R6 and R12).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const { Collector } = require("../lib/opcua/collect.cjs");
const { resolveMap } = require("../lib/opcua/resolve.cjs");
const { Keeper, open } = require("../lib/opcua/session.cjs");
const { live, start } = require("./opcua-simulator.cjs");

const CONTRACT = path.resolve(__dirname, "../../../contracts/pointmaps/v1");
// The golden map, sampled every second so the tests do not wait on the publish cycle.
const fixture = () => {
  const map = JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.fixture.json"), "utf8"));
  for (const reading of map.readings) reading.report.sample_ms = 1000;
  return map;
};
const network = { allowPrivate: true };
const BOX = "Example Campus/Example Tower/L03/L03-Z2/L03-VAV-2";
const CORE = "Example Campus/Example Tower/L03/L03-Z7/L03-VAV-7";

async function until(check, timeout = 20_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function metric(result, name) {
  return result.metrics.find((m) => m.name === name);
}

describe("collecting a point map", live(), () => {
  let sim;
  let connection;
  let collector;
  const results = [];
  before(async () => {
    sim = await start();
    connection = await open({ endpointUrl: sim.url, network });
    collector = new Collector(connection, fixture(), await resolveMap(connection, fixture()), { flushMs: 200 });
    collector.on("result", (result) => results.push(result));
    await collector.start();
  });
  after(async () => {
    await collector?.stop();
    await connection?.close();
    await sim?.stop();
  });

  test("reports each equipment's values as they change, with the source time", async () => {
    const first = await until(() => results.find((r) => r.sourceDeviceId === BOX && r.timestampSource === "source" && metric(r, "operating_state")));
    assert.ok(Number.isFinite(Date.parse(first.observedAt)));
    assert.equal(typeof metric(first, "zone_temperature").value, "number");
    assert.equal(typeof metric(first, "occupancy").value, "boolean");
    assert.ok(Number.isInteger(metric(first, "operating_state").value));
    assert.equal(metric(first, "zone_temperature").quality, "good");
    const core = await until(() => results.find((r) => r.sourceDeviceId === CORE && metric(r, "temperature_setpoint")));
    assert.equal(metric(core, "zone_co2"), undefined);
    // A written setpoint arrives as a change.
    await sim.write("L03-VAV-2.temperature_setpoint", 24);
    const written = await until(() => results.find((r) => r.sourceDeviceId === BOX && metric(r, "temperature_setpoint")?.value === 24));
    assert.equal(written.timestampSource, "source");
  });

  test("groups one equipment's changes into at most one result per flush", async () => {
    const before = results.length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const recent = results.slice(before);
    const perFlush = new Map();
    for (const r of recent) perFlush.set(`${r.sourceDeviceId}|${r.timestampSource}`, (perFlush.get(`${r.sourceDeviceId}|${r.timestampSource}`) || 0) + 1);
    assert.ok([...perFlush.values()].every((count) => count <= Math.ceil(1500 / 200) + 1));
  });

  test("reads every point at the rhythm and reports it with the server's time", async () => {
    const before = results.length;
    await collector.rhythm();
    const rhythm = results.slice(before).filter((r) => r.timestampSource === "server");
    assert.deepEqual(rhythm.map((r) => r.sourceDeviceId).sort(), [BOX, CORE]);
    assert.equal(rhythm.find((r) => r.sourceDeviceId === BOX).metrics.length, 6);
    assert.equal(rhythm.find((r) => r.sourceDeviceId === CORE).metrics.length, 5);
    const time = Date.parse(rhythm[0].observedAt);
    assert.ok(Math.abs(time - Date.now()) < 60_000, "stamped with the server's own clock");
  });

  test("reports bad and uncertain values with their reasons", async () => {
    await sim.scenario("controller_offline", true, "L03-VAV-2");
    await sim.scenario("uncertain_value", true, "L03-VAV-7.zone_temperature");
    try {
      const bad = await until(() => results.find((r) => r.sourceDeviceId === BOX && metric(r, "zone_temperature")?.quality === "bad"));
      assert.deepEqual(metric(bad, "zone_temperature"), { name: "zone_temperature", value: null, quality: "bad", reason: "No communication with the device" });
      const uncertain = await until(() => results.find((r) => r.sourceDeviceId === CORE && metric(r, "zone_temperature")?.quality === "uncertain"));
      assert.equal(typeof metric(uncertain, "zone_temperature").value, "number");
    } finally {
      await sim.scenario("controller_offline", false);
      await sim.scenario("uncertain_value", false);
    }
    await until(() => results.find((r) => r.sourceDeviceId === BOX && metric(r, "zone_temperature")?.quality === "good" && results.indexOf(r) > results.findIndex((x) => metric(x, "zone_temperature")?.quality === "bad")));
  });
});

describe("points a server refuses", live(), () => {
  test("are listed with the reason, and the rest are collected", async () => {
    const sim = await start();
    try {
      const connection = await open({ endpointUrl: sim.url, network });
      const map = fixture();
      map.readings[0].address.relative_path[0].name = "zone_humidity"; // no such point
      const collector = new Collector(connection, map, await resolveMap(connection, map), { flushMs: 200 });
      const results = [];
      collector.on("result", (r) => results.push(r));
      await collector.start();
      try {
        assert.deepEqual(collector.refused.map((r) => [r.source_id, r.key]), [[BOX, "zone_temperature"], [CORE, "zone_temperature"]]);
        const first = await until(() => results.find((r) => r.sourceDeviceId === BOX));
        assert.equal(metric(first, "zone_temperature"), undefined);
      } finally {
        await collector.stop();
        await connection.close();
      }
    } finally {
      await sim.stop();
    }
  });
});

describe("collecting across a server restart", live(), () => {
  test("rebuilds its session and subscriptions and reports again", async () => {
    const sim = await start();
    const keeper = new Keeper({ endpointUrl: sim.url, network }, { delays: { first: 500, max: 2000 } });
    const results = [];
    let collector = null;
    let sessions = 0;
    keeper.on("session", async (connection) => {
      sessions += 1;
      const map = fixture();
      collector = new Collector(connection, map, await resolveMap(connection, map), { flushMs: 200 });
      collector.on("result", (r) => results.push({ ...r, session: sessions }));
      await collector.start();
    });
    keeper.on("lost", () => collector?.stop());
    keeper.start();
    try {
      await until(() => results.some((r) => r.session === 1));
      await sim.scenario("server_restart", true, 2);
      await until(() => results.some((r) => r.session === 2), 40_000);
      await sim.write("L03-VAV-2.temperature_setpoint", 21);
      await until(() => results.some((r) => r.session === 2 && metric(r, "temperature_setpoint")?.value === 21));
    } finally {
      await collector?.stop();
      await keeper.stop();
      await sim.stop();
    }
  });
});
