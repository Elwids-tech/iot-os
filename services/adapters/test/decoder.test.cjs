const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const {
  decode,
  inputFromMessage,
  validateOutput,
} = require("../lib/decoder.cjs");
const profile = {
  parameters: [
    { uuid: "flow", key: "flow_rate", data_type: "number", unit: "L/min" },
    { uuid: "volume", key: "total_volume", data_type: "number", unit: "L" },
  ],
};
const sample = { serial: "WM-1042", flow_ml_min: 12000, total_ml: 8400000 };
const code = `function decode(input) { const p=input.payload; return { sourceDeviceId:p.serial, metrics:[{name:'flow_rate',value:p.flow_ml_min/1000},{name:'total_volume',value:p.total_ml/1000}] }; }`;
test("vendor water-meter fields become typed profile metrics without double conversion", async () => {
  const output = validateOutput(
    await decode(code, inputFromMessage(sample, "meter/live")),
    profile,
  );
  assert.equal(output.sourceDeviceId, "WM-1042");
  assert.deepEqual(
    output.metrics.map((m) => m.value),
    [12, 8400],
  );
});
test("binary decoding uses approved helpers", async () => {
  const result = await decode(
    `function decode(input, helpers) { return {value:helpers.uint16BE(input.bytes)} }`,
    inputFromMessage(Buffer.from([1, 2]), "meter/live"),
  );
  assert.equal(result.value, 258);
});
test("host capabilities and external modules are unavailable", async () => {
  for (const code of [
    "function decode(){ return process.env }",
    'function decode(){ return require("fs") }',
    'function decode(){ return fetch("http://localhost") }',
  ])
    await assert.rejects(decode(code, {}));
});
test("infinite loops are interrupted and later messages still decode", async () => {
  await assert.rejects(decode("function decode(){while(true){}}", {}));
  assert.equal(
    (await decode("function decode(){return {ok:true}}", {})).ok,
    true,
  );
});
test("time the worker spends without the CPU does not count against the decoder", async () => {
  // Runs the worker without decode()'s wall-clock deadline, which a loaded host
  // can still reach, so only the decoder's own budget is under test.
  const worker = new Worker(path.join(__dirname, "../lib/decoder-worker.cjs"), {
    workerData: {
      code: "function decode(){let total=0;for(let i=0;i<20000;i++)total+=i%7;return {total}}",
      input: {},
    },
    execArgv: ["--require", path.join(__dirname, "busy-host.cjs")],
  });
  const message = await new Promise((resolve, reject) => {
    worker.on("message", (message) => message.ready || resolve(message));
    worker.once("error", reject);
  });
  await worker.terminate();
  assert.deepEqual(message, { ok: true, result: { total: 59997 } });
});
test("memory exhaustion is bounded", async () => {
  await assert.rejects(
    decode(
      'function decode(){const values=[];while(true){values.push(new Array(100000).fill("x"))}}',
      {},
    ),
  );
});
test("fresh contexts do not preserve state", async () => {
  const code =
    "function decode(){globalThis.count=(globalThis.count||0)+1;return {count:globalThis.count}}";
  assert.equal((await decode(code, {})).count, 1);
  assert.equal((await decode(code, {})).count, 1);
});
test("missing values, unknown fields and wrong units fail without invented zeroes", () => {
  for (const metrics of [
    [{ name: "flow_rate" }],
    [{ name: "unknown", value: 1 }],
    [{ name: "flow_rate", value: 1, unit: "mL/min" }],
  ])
    assert.throws(() =>
      validateOutput({ sourceDeviceId: "WM-1042", metrics }, profile),
    );
});
test("retained flags and binary bytes survive input normalization", () => {
  const input = inputFromMessage(Buffer.from([0, 255]), "same/topic", {
    retain: true,
  });
  assert.equal(input.retained, true);
  assert.deepEqual(input.bytes, [0, 255]);
  assert.equal(input.payload, null);
});
