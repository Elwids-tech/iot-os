const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BirthStore, DedupLog, readJson, writeJson } = require("../lib/state.cjs");

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), "adapter-state-"));

test("message identifiers survive a restart and expire after their window", () => {
  const file = path.join(directory(), "dedup.log");
  let clock = 1000;
  const log = new DedupLog(file, { now: () => clock, maxAgeMs: 10000 });
  const key = DedupLog.key("TRK-1001", "m-1");
  assert.equal(log.has(key), false);
  log.add(key);
  const reloaded = new DedupLog(file, { now: () => clock, maxAgeMs: 10000 });
  assert.equal(reloaded.has(key), true);
  clock += 10001;
  assert.equal(new DedupLog(file, { now: () => clock, maxAgeMs: 10000 }).has(key), false);
  assert.notEqual(DedupLog.key("TRK-1001", "m-1"), DedupLog.key("TRK-1002", "m-1"));
});

test("the log keeps at most its key limit and compacts itself", () => {
  const file = path.join(directory(), "dedup.log");
  const log = new DedupLog(file, { maxKeys: 5 });
  for (let i = 0; i < 2500; i++) log.add(DedupLog.key("s", String(i)));
  assert.equal(log.keys.size, 5);
  assert.equal(log.has(DedupLog.key("s", "2499")), true);
  assert.equal(log.has(DedupLog.key("s", "0")), false);
  assert.ok(fs.readFileSync(file, "utf8").split("\n").length < 2100);
  assert.equal(new DedupLog(file, { maxKeys: 5 }).keys.size, 5);
});

test("a partial line from a crash is ignored", () => {
  const file = path.join(directory(), "dedup.log");
  fs.writeFileSync(file, `${Date.now()} ${DedupLog.key("s", "1")}\n${Date.now()} abc`);
  const log = new DedupLog(file);
  assert.equal(log.has(DedupLog.key("s", "1")), true);
});

test("JSON state is replaced atomically and missing state reads as the fallback", () => {
  const file = path.join(directory(), "poll.json");
  assert.deepEqual(readJson(file, { cursor: null }), { cursor: null });
  writeJson(file, { cursor: "2026-10-27T09:12:00Z" });
  assert.deepEqual(readJson(file), { cursor: "2026-10-27T09:12:00Z" });
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
});

test("source births survive a redeploy and still encode as a Sparkplug birth", () => {
  const sparkplug = require("../lib/sparkplug.cjs");
  const file = path.join(directory(), "births.json");
  let clock = 1000;
  const births = new BirthStore(file, { intervalMs: 30000, now: () => clock });
  const provenance = { installation_uuid: "inst-1", adapter_revision_uuid: "rev-1" };
  const metrics = [
    sparkplug.metric("ambient_temperature", "Double", 24.375, 1793201136040, provenance),
    sparkplug.metric("battery_voltage", "Double", null, 1793201136040, undefined, { receipt: true }),
  ];
  births.set("src-a", { metrics, names: '[["ambient_temperature",10]]' });
  births.flush();
  births.set("src-b", { metrics: metrics.slice(0, 1), names: "[]" });
  births.flush();
  assert.deepEqual([...new BirthStore(file).sources.keys()], ["src-a"], "writes at most once per interval");
  births.flush(true);
  const reloaded = new BirthStore(file).sources;
  assert.deepEqual([...reloaded.keys()], ["src-a", "src-b"]);
  const decoded = sparkplug.Payload.decode(sparkplug.encode(0, reloaded.get("src-a").metrics));
  assert.equal(decoded.metrics[0].doubleValue, 24.375);
  assert.equal(Number(decoded.metrics[0].timestamp), 1793201136040);
  assert.deepEqual(decoded.metrics[0].properties.keys, ["installation_uuid", "adapter_revision_uuid"]);
  assert.equal(decoded.metrics[1].isNull, true);
  assert.deepEqual(decoded.metrics[1].properties.keys, ["timestamp_source"]);
});

test("a malformed birth file is ignored", () => {
  const file = path.join(directory(), "births.json");
  fs.writeFileSync(file, JSON.stringify({ good: { metrics: [], names: "[]" }, bad: { metrics: "x" }, worse: null }));
  assert.deepEqual([...new BirthStore(file).sources.keys()], ["good"]);
  fs.writeFileSync(file, "{not json");
  assert.equal(new BirthStore(file).sources.size, 0);
});
