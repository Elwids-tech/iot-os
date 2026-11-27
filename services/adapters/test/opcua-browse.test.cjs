// Browsing the simulated building: pages of children, what points are, a name search
// and similar equipment (spec 038 PR 2).
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { children, read, search, similar } = require("../lib/opcua/browse.cjs");
const { open } = require("../lib/opcua/session.cjs");
const { NAMESPACE, live, start } = require("./opcua-simulator.cjs");

const network = { allowPrivate: true };
const at = (...names) => names.map((name) => ({ namespace_uri: NAMESPACE, name }));
const point = (key) => ({ node_id: `s=${key}`, namespace_uri: NAMESPACE });

describe("browsing a structured server", live(), () => {
  let sim;
  let connection;
  before(async () => {
    sim = await start();
    connection = await open({ endpointUrl: sim.url, network });
  });
  after(async () => {
    await connection?.close();
    await sim?.stop();
  });

  test("starts at the Objects folder and walks down to a zone box", async () => {
    const top = await children(connection);
    const campus = top.items.find((item) => item.name === "Example Campus");
    assert.equal(campus.kind, "folder");
    assert.equal(campus.has_children, true);
    assert.equal(campus.namespace_uri, NAMESPACE);
    const zone = (await children(connection, { node_id: "s=L03-Z2", namespace_uri: NAMESPACE })).items;
    assert.deepEqual(zone.map((item) => [item.name, item.kind, item.type]), [
      ["L03-VAV-2", "object", "Zone box with reheat"],
      ["L03-LTG-2", "object", "Lighting zone"],
      ["L03-BLD-2", "object", "Blind group"],
    ]);
    const box = (await children(connection, { node_id: "s=L03-VAV-2", namespace_uri: NAMESPACE })).items;
    assert.equal(box.length, 14);
    assert.ok(box.every((item) => item.kind === "point" && item.has_children === false));
    assert.equal(box.find((item) => item.name === "zone_temperature").type, "AnalogItemType");
  });

  test("reads what points are: type, unit, range, labels and whether they are stored", async () => {
    const [temperature, state, occupancy, alarm, missing] = await read(connection, [
      point("L03-VAV-2.zone_temperature"), point("L03-VAV-2.operating_state"), point("L03-VAV-2.occupancy"),
      point("L03-VAV-2.communication_alarm"), point("L03-VAV-2.nothing_here"),
    ]);
    assert.equal(temperature.data_type, "number");
    assert.equal(temperature.unit, "°C");
    assert.deepEqual(temperature.range, [10, 35]);
    assert.equal(temperature.quality, "good");
    assert.ok(temperature.storable && temperature.value > 10 && temperature.source_time);
    assert.equal(state.data_type, "state");
    assert.deepEqual(state.states, ["Cooling", "Heating", "Deadband", "Unoccupied", "Hand"]);
    assert.equal(typeof state.value, "number");
    assert.deepEqual(occupancy.states, ["False", "True"]);
    assert.deepEqual(alarm.states, ["Normal", "Alarm"]);
    assert.equal(missing.storable, false);
    assert.equal(missing.not_storable, "The point was not found");
  });

  test("reports bad and uncertain values with their reasons", async () => {
    await sim.scenario("controller_offline", true, "L03-VAV-2");
    await sim.scenario("uncertain_value", true, "L03-VAV-3.zone_temperature");
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const [offline, uncertain] = await read(connection, [point("L03-VAV-2.zone_temperature"), point("L03-VAV-3.zone_temperature")]);
      assert.deepEqual([offline.quality, offline.reason, offline.value], ["bad", "No communication with the device", null]);
      assert.equal(uncertain.quality, "uncertain");
      assert.ok(uncertain.value > 10);
    } finally {
      await sim.scenario("controller_offline", false);
      await sim.scenario("uncertain_value", false);
    }
  });

  test("searches a branch by name and stops at its limit", async () => {
    const found = await search(connection, null, "VAV-2");
    assert.deepEqual(found.matches.map((m) => m.source_id).sort(), [
      "Example Campus/Example Tower/L02/L02-Z2/L02-VAV-2",
      "Example Campus/Example Tower/L03/L03-Z2/L03-VAV-2",
    ]);
    assert.equal(found.truncated, false);
    const cut = await search(connection, null, "VAV", { limit: 50 });
    assert.equal(cut.truncated, true);
    assert.equal(cut.visited, 50);
  });

  test("finds similar equipment by declared type and by matching names", async () => {
    const equipment = { ...point("L03-VAV-2"), path: at("Example Campus", "Example Tower", "L03", "L03-Z2", "L03-VAV-2") };
    const points = [{ key: "zone_temperature", name: "zone_temperature" }, { key: "zone_co2", name: "zone_co2" }, { key: "damper_position", name: "damper_position" }];
    const byType = await similar(connection, equipment, points, { by: "type" });
    assert.equal(byType.length, 8); // the zone boxes with reheat on levels 2 and 3
    assert.ok(byType.every((e) => e.missing.length === 0));
    const byNames = await similar(connection, equipment, points, { by: "names" });
    assert.equal(byNames.length, 14); // every zone box; the core boxes lack carbon dioxide
    assert.deepEqual(byNames.filter((e) => e.missing.length).map((e) => [e.display_name, e.missing]), [
      ["L02-VAV-7", ["zone_co2"]], ["L03-VAV-7", ["zone_co2"]],
    ]);
  });
});

describe("browsing a flat server", live(), () => {
  let sim;
  let connection;
  before(async () => {
    sim = await start(["--style", "flat"]);
    connection = await open({ endpointUrl: sim.url, network });
  });
  after(async () => {
    await connection?.close();
    await sim?.stop();
  });

  test("pages through one folder of 706 tags, 200 at a time", async () => {
    const folder = { node_id: "s=ET_tags", namespace_uri: NAMESPACE };
    const sizes = [];
    const names = new Set();
    let cursor = null;
    do {
      const page = await children(connection, folder, { cursor });
      sizes.push(page.items.length);
      page.items.forEach((item) => names.add(item.name));
      cursor = page.cursor;
    } while (cursor);
    assert.deepEqual(sizes, [200, 200, 200, 106]);
    assert.equal(names.size, 706);
    assert.ok(names.has("ET_L03_VAV_2.ZN-T"));
  });

  test("finds similar equipment by a tag pattern", async () => {
    const equipment = { node_id: null, namespace_uri: NAMESPACE, path: at("ET", "ET_L03_VAV_2") };
    const found = await similar(connection, equipment, [
      { key: "zone_temperature", pattern: "{equipment}.ZN-T" },
      { key: "zone_co2", pattern: "{equipment}.ZN-CO2" },
    ], { by: "pattern" });
    assert.equal(found.length, 14);
    assert.deepEqual(found.find((e) => e.display_name === "ET_L03_VAV_7").missing, ["zone_co2"]);
    assert.equal(found.find((e) => e.display_name === "ET_L03_VAV_2").source_id, "ET/ET_L03_VAV_2");
  });
});
