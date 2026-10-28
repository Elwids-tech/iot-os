const { test } = require("node:test");
const assert = require("node:assert/strict");
const nodes = require("./fake-red.cjs");

const ADAPTER = "30000000-0000-4000-8000-000000000001";
const TENANT = "30000000-0000-4000-8000-000000000002";

// A Reporter whose platform callback answers with `respond`, recording each request body.
async function withReporter(respond, body) {
  const types = nodes();
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    posted.push(payload);
    return respond(payload, posted.length);
  };
  const reporter = new types["iot-adapter-reporter"]({
    callback_url: "http://api.test/api/internal/adapters/events",
    tenant_uuid: TENANT,
    adapter_uuid: ADAPTER,
    credentials_for_test: { runtime_token: "placeholder-runtime-token" },
  });
  const feed = (payload) => new Promise((resolve) => reporter.handlers.input({ payload }, () => {}, resolve));
  try {
    await body(feed, posted);
  } finally {
    reporter.handlers.close();
    globalThis.fetch = realFetch;
  }
}

const sample = (source) => ({
  kind: "sample",
  adapter_uuid: ADAPTER,
  source_device_id: source,
  sparkplug_device_id: "src-" + source,
  preview: { metrics: [{ name: "temperature", value: 21.5 }] },
  received_at: "2026-10-28T21:12:56.000Z",
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("every source's first preview reaches the platform when a backfill previews many at once", async () => {
  await withReporter(
    async () => {
      await wait(10);
      return { ok: true, status: 204 };
    },
    async (feed, posted) => {
      const sources = Array.from({ length: 12 }, (_, i) => `99000000010${String(i).padStart(4, "0")}`);
      await Promise.all(sources.map((source) => feed(sample(source))));
      const previewed = posted.filter((p) => p.kind === "sample").map((p) => p.source_device_id);
      assert.deepEqual([...previewed].sort(), [...sources].sort());

      // Later previews of a known source are still limited.
      await Promise.all([feed(sample(sources[0])), feed(sample(sources[0])), feed(sample(sources[0]))]);
      assert.equal(posted.filter((p) => p.source_device_id === sources[0]).length, 2);
    },
  );
});

test("previews still reach the platform after the periodic drain finds nothing to send", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  await withReporter(
    () => ({ ok: true, status: 204 }),
    async (feed, posted) => {
      t.mock.timers.tick(10000);
      await wait(0);
      await feed(sample("990000000020002"));
      assert.deepEqual(
        posted.filter((p) => p.kind === "sample").map((p) => p.source_device_id),
        ["990000000020002"],
      );
    },
  );
});

test("a first preview the platform could not take is sent again with the next run report", async () => {
  await withReporter(
    (payload, attempt) => (attempt === 1 ? { ok: false, status: 503 } : { ok: true, status: 204 }),
    async (feed, posted) => {
      await feed(sample("990000000020001"));
      assert.equal(posted.length, 1);
      await feed({ kind: "poll_run", adapter_uuid: ADAPTER, run_id: "30000000-0000-4000-8000-000000000009" });
      assert.deepEqual(
        posted.map((p) => p.kind),
        ["sample", "poll_run", "sample"],
      );
      assert.equal(posted[2].source_device_id, "990000000020001");
    },
  );
});
