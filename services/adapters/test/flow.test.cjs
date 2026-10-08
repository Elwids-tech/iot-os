const { test } = require("node:test");
const assert = require("node:assert/strict");
const { flowNodes, replaceFlow } = require("../lib/flow.cjs");

test("managed flow preserves other adapters and puts secrets only in registered credentials", () => {
  const body = {
    adapter_uuid: "a",
    revision_uuid: "r",
    name: "Meter",
    tenant: { uuid: "t", runtime_token: "callback-secret" },
    code: "code",
    profile: {},
    bindings: [],
  };
  const nodes = flowNodes(
    body,
    { url: "mqtt://ingress", password: "source-secret" },
    { url: "mqtt://platform", password: "platform-secret" },
    "http://api/events",
  );
  const safe = nodes.map(({ credentials, ...node }) => node);
  assert.equal(JSON.stringify(safe).includes("secret"), false);
  assert.equal(
    nodes.find((n) => n.type === "iot-adapter-source").credentials.password,
    "source-secret",
  );
  const other = [
    { id: "adapter-b", type: "tab" },
    { id: "b-node", z: "adapter-b", credentials: { password: "other-secret" } },
  ];
  const flows = replaceFlow(
    [...other, { id: "old", z: "adapter-a" }],
    body,
    nodes,
  );
  assert.deepEqual(flows.slice(0, 2), other);
  assert.equal(
    flows.some((n) => n.id === "old"),
    false,
  );
  assert.deepEqual(replaceFlow(flows, { ...body, action: "pause" }, []), other);
});
