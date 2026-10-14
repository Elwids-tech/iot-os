const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { promisify } = require("node:util");
const { Worker } = require("node:worker_threads");
const execFile = promisify(require("node:child_process").execFile);
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
  // The decoder runs in a child process whose workers load busy-host.cjs.
  const code =
    "function decode(){let total=0;for(let i=0;i<20000;i++)total+=i%7;return {total}}";
  const { stdout } = await execFile(process.execPath, [
    "--require",
    path.join(__dirname, "busy-host.cjs"),
    "-e",
    `require(${JSON.stringify(path.join(__dirname, "../lib/decoder.cjs"))})
      .decode(${JSON.stringify(code)}, {})
      .then((result) => console.log(JSON.stringify(result)))`,
  ]);
  assert.deepEqual(JSON.parse(stdout), { total: 59997 });
});
// Mocked timers and CPU reads let time pass before the worker answers. Only
// microtasks run between steps, so the real worker's messages wait until the
// test awaits the decode.
function mockWorkerCpu(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const worker = { cpu: 0, online: true };
  t.mock.method(Worker.prototype, "cpuUsage", () =>
    worker.online
      ? Promise.resolve({ user: worker.cpu * 1000, system: 0 })
      : Promise.reject(Error("Worker is not running")),
  );
  worker.advance = async (ms, onStep = () => {}) => {
    for (let elapsed = 50; elapsed <= ms; elapsed += 50) {
      onStep(elapsed);
      t.mock.timers.tick(50);
      for (let i = 0; i < 3; i++) await null;
    }
  };
  return worker;
}
test("a worker that is slow to load QuickJS still decodes while it uses the CPU", async (t) => {
  // On a busy host, loading QuickJS took up to 22 s of wall time for at most
  // 190 ms of CPU. Here the worker gets 5 ms of CPU every 20 s for 100 s.
  const worker = mockWorkerCpu(t);
  const code = "function decode(){return {ok:true}}";
  const slow = decode(code, {});
  await worker.advance(100000, (elapsed) => {
    if (elapsed % 20000 === 0) worker.cpu += 5;
  });
  assert.equal((await slow).ok, true);
  // A worker whose CPU time cannot be read is stopped after 30 s.
  worker.online = false;
  let failure;
  decode(code, {}).catch((error) => (failure = error.message));
  await worker.advance(29950);
  assert.equal(failure, undefined);
  await worker.advance(50);
  assert.equal(failure, "Decoder worker did not start");
});
test("platform work before the decoder starts is capped at 5 s of the worker's CPU", async (t) => {
  // The worker spins without starting the decoder: 99 ms of CPU every 50 ms.
  const worker = mockWorkerCpu(t);
  let failure;
  decode("function decode(){return {ok:true}}", {}).catch(
    (error) => (failure = error.message),
  );
  await worker.advance(2500, () => (worker.cpu += 99));
  assert.equal(failure, undefined);
  await worker.advance(100, () => (worker.cpu += 99));
  assert.equal(failure, "Decoder setup exceeded its CPU limit");
});
// Decodes in a child process whose workers load stalled-worker.cjs. Its timers
// are mocked and move 1 s at a time once the worker has stalled, each step
// after the worker answered the last CPU read. The loop reaches QuickJS's
// interrupt check, where STALL_AT=decode stalls.
async function decodeWithStalledWorker(stallAt) {
  const code =
    "function decode(){let total=0;for(let i=0;i<20000;i++)total+=i%7;return {total}}";
  const { stdout } = await execFile(
    process.execPath,
    [
      "--require",
      path.join(__dirname, "stalled-worker.cjs"),
      "-e",
      `const { mock } = require("node:test");
      const { Worker, BroadcastChannel } = require("node:worker_threads");
      mock.timers.enable({ apis: ["setTimeout"] });
      const reads = [];
      const { cpuUsage } = Worker.prototype;
      Worker.prototype.cpuUsage = function () {
        const read = cpuUsage.call(this);
        reads.push(read);
        return read;
      };
      const channel = new BroadcastChannel("stalled-worker");
      let done = false;
      require(${JSON.stringify(path.join(__dirname, "../lib/decoder.cjs"))})
        .decode(${JSON.stringify(code)}, {})
        .then(() => "decoded", (error) => error.message)
        .then((outcome) => {
          done = true;
          channel.close();
          console.log(outcome);
        });
      channel.onmessage = async () => {
        while (!done) {
          await Promise.allSettled(reads.splice(0));
          await new Promise((resolve) => setImmediate(resolve));
          mock.timers.tick(1000);
        }
      };`,
    ],
    { env: { ...process.env, STALL_AT: stallAt }, timeout: 60000 },
  );
  return stdout.trim();
}
test("a worker that stops using the CPU before QuickJS loads is stopped", async () => {
  assert.equal(
    await decodeWithStalledWorker("load"),
    "Decoder worker did not start",
  );
});
test("a worker that stops using the CPU while decoding is stopped", async () => {
  assert.equal(
    await decodeWithStalledWorker("decode"),
    "Decoder worker stopped answering",
  );
});
test("work QuickJS cannot interrupt is stopped by the worker deadline", async () => {
  // A backtracking regular expression runs inside one QuickJS call, which the
  // decoder's own budget cannot interrupt.
  await assert.rejects(
    decode(
      "function decode(){return {match:/^(a+)+$/.test('a'.repeat(28)+'b')}}",
      {},
    ),
    { message: "Decoder exceeded its worker deadline" },
  );
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
