const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DedupLog, readJson, writeJson } = require("../lib/state.cjs");

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
