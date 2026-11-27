// Resolving point maps on the simulated building: stored node ids, paths when ids move,
// overrides, missing readings and flat tag lists (spec 038 PR 2, research R7).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, test } = require("node:test");
const { fromNodeId } = require("../lib/opcua/nodes.cjs");
const { resolveMap } = require("../lib/opcua/resolve.cjs");
const { open } = require("../lib/opcua/session.cjs");
const { NAMESPACE, live, start } = require("./opcua-simulator.cjs");

const CONTRACT = path.resolve(__dirname, "../../../contracts/pointmaps/v1");
const fixture = () => JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.fixture.json"), "utf8"));
const flatMap = () => JSON.parse(fs.readFileSync(path.join(CONTRACT, "point-map.v1.cases.json"), "utf8"))[1].data;
const network = { allowPrivate: true };

async function withServer(args, run) {
  const sim = await start(args);
  try {
    const connection = await open({ endpointUrl: sim.url, network });
    try {
      return await run(connection, sim);
    } finally {
      await connection.close();
    }
  } finally {
    await sim.stop();
  }
}

const key = (connection, node) => node && fromNodeId(node, connection.namespaces).node_id;

describe("resolving a point map", live(), () => {
  test("finds every point of the golden map, with its override and without what is missing", () =>
    withServer([], async (connection) => {
      const [box, core] = await resolveMap(connection, fixture());
      assert.deepEqual(box.problems, []);
      assert.equal(key(connection, box.node), "s=L03-VAV-2");
      assert.equal(key(connection, box.points.zone_temperature), "s=L03-VAV-2.zone_temperature");
      assert.equal(key(connection, box.points.operating_state), "s=L03-VAV-2.operating_state");
      assert.equal(Object.keys(box.points).length, 6);
      assert.deepEqual(core.problems, []);
      assert.equal("zone_co2" in core.points, false);
      assert.equal(key(connection, core.points.temperature_setpoint), "s=L03-VAV-7.effective_setpoint");
    }));

  test("falls back to the path when a stored node id is stale", () =>
    withServer([], async (connection) => {
      const map = fixture();
      map.equipment[0].address.node_id = "s=L03-VAV-99"; // a node that is not there
      map.equipment[1].address.node_id = "s=L03-VAV-2"; // a node that is another equipment
      const [box, core] = await resolveMap(connection, map);
      assert.equal(key(connection, box.node), "s=L03-VAV-2");
      assert.equal(key(connection, core.node), "s=L03-VAV-7");
    }));

  test("names what it cannot find", () =>
    withServer([], async (connection) => {
      const map = fixture();
      map.equipment[0].address.node_id = "s=L09-VAV-2";
      map.equipment[0].address.path[2].name = "L09"; // not at the standard size
      map.readings[0].address.relative_path[0].name = "zone_humidity";
      const [box, core] = await resolveMap(connection, map);
      assert.deepEqual(box.problems, [{ key: null, problem: "The equipment was not found on the server" }, ...Object.keys(box.points).map((k) => ({ key: k, problem: "The point was not found on this equipment" }))]);
      assert.deepEqual(core.problems, [{ key: "zone_temperature", problem: "The point was not found on this equipment" }]);
    }));

  test("still resolves when the server renumbers its node ids", async () => {
    const folder = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bms-"));
    try {
      const map = fixture();
      // Store the numeric ids of a first start, as a map saved then would hold them.
      const first = await start(["--node-ids", "renumber"], { folder });
      try {
        const connection = await open({ endpointUrl: first.url, network });
        const [box] = await resolveMap(connection, map);
        assert.match(key(connection, box.node), /^i=\d+$/);
        map.equipment[0].address.node_id = key(connection, box.node);
        await connection.close();
      } finally {
        await first.stop();
      }
      const second = await start(["--node-ids", "renumber"], { folder });
      try {
        const connection = await open({ endpointUrl: second.url, network });
        const [box] = await resolveMap(connection, map);
        assert.notEqual(key(connection, box.node), map.equipment[0].address.node_id);
        assert.deepEqual(box.problems, []);
        const name = await connection.session.read({ nodeId: box.node, attributeId: 3 });
        assert.equal(name.value.value.name, "L03-VAV-2");
        await connection.close();
      } finally {
        await second.stop();
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test("resolves a flat tag list by its patterns", () =>
    withServer(["--style", "flat"], async (connection) => {
      const map = flatMap();
      map.equipment[0].address.path[0].name = "ET";
      const [box, core] = await resolveMap(connection, map);
      assert.equal(box.node, null); // flat equipment has no node of its own
      assert.equal(key(connection, box.points.zone_temperature), "s=ET_L03_VAV_2.ZN-T");
      assert.equal(key(connection, core.points.temperature_setpoint), "s=ET_L03_VAV_7.T-SP");
      assert.deepEqual([...box.problems, ...core.problems], []);
      assert.equal(map.equipment[0].address.namespace_uri, NAMESPACE);
    }));
});
