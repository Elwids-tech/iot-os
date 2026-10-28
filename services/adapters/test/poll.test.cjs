const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const poll = require("../lib/poll.cjs");

const base = {
  type: "poll",
  request: { method: "GET", url: "https://api.example.com/accounts/A1/streams/history", query: [{ name: "start", value: "{cursor}" }, { name: "end", value: "{now}" }] },
  credentials: { placement: "header", name: "x-api-key" },
  time_format: "iso",
  interval_seconds: 300,
  page: { size: 2, size_param: "limit", more: "full_page", max_pages: 20 },
  records: "/data",
  cursor: { kind: "timestamp", pointer: "/maxDate" },
};

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
const local = (url, extra = {}) => ({ ...base, ...extra, request: { ...base.request, url, ...(extra.request || {}) } });

test("settings refuse placeholders in the URL, unknown placeholders, credential headers and private literals", () => {
  assert.doesNotThrow(() => poll.validateSettings(base));
  const cases = [
    { request: { ...base.request, url: "https://api.example.com/{cursor}" } },
    { request: { ...base.request, query: [{ name: "start", value: "{secret}" }] } },
    { request: { ...base.request, headers: [{ name: "Authorization", value: "Bearer x" }] } },
    { request: { ...base.request, url: "https://10.0.0.5/history" } },
    { request: { ...base.request, url: "https://user:pass@api.example.com/history" } },
    { request: { ...base.request, url: "http://api.example.com/history" } },
    { cursor: { kind: "window" }, page: { size: 10, more: "full_page" } },
    { credentials: { placement: "header" } },
  ];
  for (const change of cases) assert.throws(() => poll.validateSettings({ ...base, ...change }));
  assert.doesNotThrow(() => poll.validateSettings({ ...base, request: { ...base.request, url: "http://10.0.0.5/history" } }, { allowPrivate: true }));
});

test("credentials go only where the settings place them, and placeholders are filled", () => {
  const values = poll.cursorValues(base, "2026-10-27T09:00:00.000Z", Date.parse("2026-10-27T10:00:00Z"));
  const header = poll.buildRequest(base, { api_key: "k-123456" }, values);
  assert.equal(header.headers["x-api-key"], "k-123456");
  assert.equal(header.url.searchParams.get("start"), "2026-10-27T09:00:00.000Z");
  assert.equal(header.url.searchParams.get("end"), "2026-10-27T10:00:00.000Z");
  assert.equal(header.url.searchParams.get("limit"), "2");
  const query = poll.buildRequest({ ...base, credentials: { placement: "query", name: "apiKey" } }, { api_key: "k-123456" }, values);
  assert.equal(query.url.searchParams.get("apiKey"), "k-123456");
  assert.deepEqual(query.credentialParams, ["apiKey"]);
  const basic = poll.buildRequest({ ...base, credentials: { placement: "basic" } }, { username: "u", password: "p" }, values);
  assert.equal(basic.headers.authorization, "Basic " + Buffer.from("u:p").toString("base64"));
  const epoch = poll.cursorValues({ ...base, time_format: "epoch_ms", cursor: { kind: "window", lag_seconds: 60 } }, "1000", 120000);
  assert.deepEqual([epoch.window_start, epoch.window_end, epoch.now], ["1000", "60000", "120000"]);
});

test("a page is split into records and the cursor comes from the response", async () => {
  const { s, url } = await server((req, res) => {
    assert.equal(req.headers["x-api-key"], "k-123456");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: 1 }, { id: 2 }], maxDate: "2026-10-27T09:15:00.000Z" }));
  });
  const page = await poll.fetchPage(local(url + "/history"), { api_key: "k-123456" }, "2026-10-27T09:00:00.000Z", { allowPrivate: true });
  s.close();
  assert.equal(page.outcome, "ok");
  assert.equal(page.records.length, 2);
  assert.equal(page.nextCursor, "2026-10-27T09:15:00.000Z");
  assert.equal(page.more, true);
  const result = poll.fetchResult(page, { api_key: "k-123456" });
  assert.equal(result.record_count, 2);
  assert.equal(result.next_cursor, "2026-10-27T09:15:00.000Z");
});

test("answers are classified: retry with Retry-After, stop on rejected credentials, stop on unusable bodies", async () => {
  const answers = [
    [429, { "retry-after": "120" }, "{}"],
    [503, {}, "{}"],
    [401, {}, "{}"],
    [200, {}, "<html>"],
    [200, {}, JSON.stringify({ items: [] })],
  ];
  const { s, url } = await server((req, res) => {
    const [status, headers, body] = answers.shift();
    res.writeHead(status, headers);
    res.end(body);
  });
  const settings = local(url + "/history");
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await poll.fetchPage(settings, {}, null, { allowPrivate: true }));
  s.close();
  assert.deepEqual(results.map((r) => r.outcome), ["retry", "retry", "stop", "stop", "stop"]);
  assert.equal(results[0].retryAfter, 120);
  assert.equal(results[2].error, "Credentials rejected");
  assert.equal(results[3].error, "The response is not JSON");
  assert.equal(results[4].error, "No records at the configured location");
});

test("an oversized or compressed-bomb response fails the page without moving the cursor", async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 32));
  const { s, url } = await server((req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end(bomb);
  });
  const page = await poll.fetchPage(local(url + "/history"), {}, "c", { allowPrivate: true });
  s.close();
  assert.equal(page.outcome, "stop");
  assert.match(page.error, /Response too large/);
  assert.equal(page.nextCursor, undefined);
});

test("redirects are re-checked and credentials stay with the original host", async () => {
  assert.throws(() => poll.redirectUrl("https://169.254.169.254/latest", new URL("https://api.example.com/"), false), /publicly reachable/);
  assert.throws(() => poll.redirectUrl("http://api.example.com/", new URL("https://api.example.com/"), false), /HTTPS/);
  const second = await server((req, res) => {
    res.end(JSON.stringify({ seen: req.headers["x-api-key"] ?? null, data: [] }));
  });
  const first = await server((req, res) => {
    res.writeHead(302, { location: second.url + "/elsewhere" });
    res.end();
  });
  const page = await poll.fetchPage(local(first.url + "/history"), { api_key: "k-123456" }, null, { allowPrivate: true });
  first.s.close();
  second.s.close();
  assert.equal(page.json.seen, null);
});

test("names that resolve to private addresses are refused before connecting", async () => {
  const request = poll.buildRequest(base, {}, poll.cursorValues(base, null, Date.now()));
  request.url = new URL("https://localhost/history");
  await assert.rejects(poll.safeRequest(request), /publicly reachable/);
  // A lookup that changes its answer cannot redirect the connection: the address it
  // returned is the one that is checked and connected.
  let calls = 0;
  const rebinding = (host, options, callback) => {
    calls++;
    require("../lib/broker.cjs").secureLookup("localhost", options, callback);
  };
  await assert.rejects(poll.safeRequest(request, { lookup: rebinding }), /publicly reachable/);
  assert.equal(calls, 1);
});

test("token cursors page until the token disappears; window cursors resume from the window end", async () => {
  const pages = [{ items: [1, 2], next: "t2" }, { items: [3], next: null }];
  const { s, url } = await server((req, res) => res.end(JSON.stringify(pages.shift())));
  const settings = local(url + "/events", { records: "/items", cursor: { kind: "token", pointer: "/next" }, page: { more: "token" } });
  const one = await poll.fetchPage(settings, {}, null, { allowPrivate: true });
  const two = await poll.fetchPage(settings, {}, one.nextCursor, { allowPrivate: true });
  s.close();
  assert.deepEqual([one.nextCursor, one.more, two.nextCursor, two.more], ["t2", true, "t2", false]);
  const window = poll.cursorValues({ ...base, cursor: { kind: "window", lag_seconds: 0 } }, "2026-10-27T09:00:00.000Z", Date.parse("2026-10-27T09:05:00Z"));
  assert.equal(window.window_start, "2026-10-27T09:00:00.000Z");
  assert.equal(window.window_end, "2026-10-27T09:05:00.000Z");
});

test("Fetch now results never show credentials", () => {
  const result = poll.fetchResult(
    { status: 200, durationMs: 5, headers: { "x-echo": "k-123456", "set-cookie": "s" }, body: Buffer.from('{"key":"k-123456","data":[{"k":"k-123456"}]}'), records: [{ k: "k-123456" }] },
    { api_key: "k-123456" },
  );
  assert.equal(JSON.stringify(result).includes("k-123456"), false);
  assert.equal(result.headers["set-cookie"], undefined);
});

test("JSON body templates are not mistaken for placeholders", () => {
  const post = { ...base, request: { ...base.request, method: "POST", body: '{"limit": 100, "since": "{cursor}"}' } };
  assert.doesNotThrow(() => poll.validateSettings(post));
  const request = poll.buildRequest(post, {}, poll.cursorValues(post, "c1", Date.now()));
  assert.deepEqual(JSON.parse(request.body.toString()), { limit: 100, since: "c1" });
  assert.throws(() => poll.validateSettings({ ...post, request: { ...post.request, body: '{"key": "{password}"}' } }), /Unknown placeholder/);
});
