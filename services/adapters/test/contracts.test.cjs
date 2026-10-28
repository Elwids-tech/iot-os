const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { inputFromMessage, validateResults } = require("../lib/decoder.cjs");
const poll = require("../lib/poll.cjs");
const { authenticate, hashToken } = require("../lib/webhook.cjs");
const { createReceiver } = require("../receiver.cjs");

// Contract tests for contracts/adapters/v1 (spec 020). Each test builds the real
// object with the code that produces it and checks it against the schema as written
// (closed objects, so every key the producer emits must be declared and every
// required key present) and against the golden fixture's keys.

const DIRECTORY = path.resolve(__dirname, "../../../contracts/adapters/v1");
const ID_BASE = "https://iot-os.local/contracts/adapters/v1/";

const documents = new Map();
function document(stem) {
  if (!documents.has(stem)) {
    documents.set(stem, JSON.parse(fs.readFileSync(path.join(DIRECTORY, `${stem}.schema.json`), "utf8")));
  }
  return documents.get(stem);
}
const read = (name) => JSON.parse(fs.readFileSync(path.join(DIRECTORY, name), "utf8"));
const contract = (stem) => ({
  schema: document(stem),
  fixture: read(`${stem}.fixture.json`),
  cases: read(`${stem}.cases.json`),
});
const caseData = (stem, description) => {
  const found = contract(stem).cases.find((c) => c.description === description);
  assert.ok(found, `${stem} has no case "${description}"`);
  return found.data;
};

// A small recursive checker, not a general validator: $ref, type, const, enum,
// required, properties, patternProperties, additionalProperties, items, the size
// limits, pattern, allOf, oneOf, anyOf, not and if/then/else. Formats are limited
// to uuid and date-time. It returns the problems it finds.
const jsonType = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isType = (v, t) => (t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" : jsonType(v) === t);
const FORMATS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
};

function follow(ref, ctx) {
  const [file, fragment = ""] = ref.split("#");
  const doc = file ? document(path.basename(file, ".schema.json")) : ctx.doc;
  let node = doc;
  for (const part of fragment.split("/").filter(Boolean)) node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  return { schema: node, ctx: { doc } };
}

function conform(schema, value, ctx, at = "") {
  if (schema.$ref) {
    const target = follow(schema.$ref, ctx);
    return conform(target.schema, value, target.ctx, at);
  }
  const problems = [];
  const fail = (message) => problems.push(`${at || "/"}: ${message}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (schema.type && ![].concat(schema.type).some((t) => isType(value, t))) return [`${at || "/"}: expected ${[].concat(schema.type).join("|")}, got ${jsonType(value)}`];
  if ("const" in schema && !same(schema.const, value)) fail(`not the constant ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) fail("not one of the allowed values");
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail("too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
    if (FORMATS[schema.format] && !FORMATS[schema.format].test(value)) fail(`not a ${schema.format}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...conform(schema.items, item, ctx, `${at}/${i}`)));
  }
  if (jsonType(value) === "object") {
    const keys = Object.keys(value);
    for (const name of schema.required || []) if (!(name in value)) fail(`missing required ${name}`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail(`more than ${schema.maxProperties} properties`);
    for (const key of keys) {
      const own = schema.properties && key in schema.properties;
      const patterns = Object.entries(schema.patternProperties || {}).filter(([pattern]) => new RegExp(pattern).test(key));
      if (own) problems.push(...conform(schema.properties[key], value[key], ctx, `${at}/${key}`));
      for (const [, sub] of patterns) problems.push(...conform(sub, value[key], ctx, `${at}/${key}`));
      if (!own && !patterns.length) {
        if (schema.additionalProperties === false) fail(`undeclared key ${key}`);
        else if (schema.additionalProperties) problems.push(...conform(schema.additionalProperties, value[key], ctx, `${at}/${key}`));
      }
    }
  }
  for (const sub of schema.allOf || []) problems.push(...conform(sub, value, ctx, at));
  if (schema.anyOf && !schema.anyOf.some((sub) => !conform(sub, value, ctx, at).length)) fail("matches none of anyOf");
  if (schema.oneOf) {
    const matching = schema.oneOf.filter((sub) => !conform(sub, value, ctx, at).length).length;
    if (matching !== 1) {
      const closest = schema.oneOf.map((sub) => conform(sub, value, ctx, at)).sort((a, b) => a.length - b.length)[0];
      fail(`matches ${matching} of oneOf; closest: ${closest.slice(0, 3).join("; ")}`);
    }
  }
  if (schema.not && !conform(schema.not, value, ctx, at).length) fail("matches a `not` schema");
  if (schema.if) {
    const branch = !conform(schema.if, value, ctx, at).length ? schema.then : schema.else;
    if (branch) problems.push(...conform(branch, value, ctx, at));
  }
  return problems;
}

const check = (stem, value) => {
  const { schema } = contract(stem);
  return conform(schema, value, { doc: schema });
};
const assertConforms = (stem, value) => assert.deepEqual(check(stem, value), [], `${stem}`);
const keys = (value) => Object.keys(value).sort();

test("the checker reports undeclared keys, missing keys, wrong types and the wrong oneOf branch", () => {
  const { fixture } = contract("fetch-result.v1");
  assert.deepEqual(check("fetch-result.v1", fixture), []);
  assert.match(check("fetch-result.v1", { ...fixture, pages: 1 }).join(), /undeclared key pages/);
  const { excerpt, ...without } = fixture;
  assert.match(check("fetch-result.v1", without).join(), /missing required excerpt/);
  assert.match(check("fetch-result.v1", { ...fixture, more: "false" }).join(), /expected boolean/);
  assert.match(check("runtime-event.v1", { kind: "metric", adapter_uuid: fixture.status }).join(), /oneOf/);
});

test("every fixture and valid case conforms, and every invalid case is refused", () => {
  for (const stem of ["decoder-input.v1", "decoder-output.v1", "source-settings.v1", "webhook-routes.v1", "receiver-report.v1", "runtime-event.v1", "fetch-result.v1"]) {
    const { fixture, cases } = contract(stem);
    assert.deepEqual(check(stem, fixture), [], `${stem} fixture`);
    for (const c of cases) {
      const problems = check(stem, c.data);
      if (c.valid) assert.deepEqual(problems, [], `${stem}: ${c.description}`);
      else assert.notDeepEqual(problems, [], `${stem}: ${c.description} should be refused`);
    }
  }
});

const PROFILE = {
  parameters: [
    { key: "latitude", uuid: "30000000-0000-4000-8000-000000000007", data_type: "number" },
    { key: "longitude", uuid: "30000000-0000-4000-8000-000000000008", data_type: "number" },
    { key: "battery_percent", uuid: "30000000-0000-4000-8000-000000000006", data_type: "integer", unit: "%" },
    { key: "temperature_c", uuid: "30000000-0000-4000-8000-000000000009", data_type: "number", unit: "degC" },
    { key: "moving", uuid: "30000000-0000-4000-8000-000000000010", data_type: "boolean" },
    { key: "fix_status", uuid: "30000000-0000-4000-8000-000000000015", data_type: "string", unit: null },
  ],
};

test("decoder inputs built for a webhook delivery, a polled record and an MQTT packet match decoder-input.v1", () => {
  const { fixture } = contract("decoder-input.v1");
  const webhook = inputFromMessage(Buffer.from(fixture.bytes), fixture.topic, {
    source: "webhook",
    receivedAt: fixture.receivedAt,
    qos: 1,
    http: fixture.http,
  });
  assertConforms("decoder-input.v1", webhook);
  assert.deepEqual(webhook, fixture);

  const record = caseData("decoder-input.v1", "a polled record with its page position");
  const polled = inputFromMessage(Buffer.from(JSON.stringify(record.payload)), "", { source: "poll", receivedAt: record.receivedAt, poll: record.poll });
  assertConforms("decoder-input.v1", polled);
  assert.deepEqual(polled, record);

  const mqtt = caseData("decoder-input.v1", "an MQTT packet has neither http nor poll");
  const packet = inputFromMessage(Buffer.from(mqtt.bytes), mqtt.topic, { receivedAt: mqtt.receivedAt, qos: 1 });
  assertConforms("decoder-input.v1", packet);
  assert.deepEqual(packet, mqtt);
  assert.deepEqual(keys(packet), keys(mqtt));

  // Anything the decoder cannot parse is null with its bytes intact.
  const binary = inputFromMessage(Buffer.from([1, 2, 255]), "", { source: "webhook", qos: 1, http: { method: "POST", path: "", query: {}, contentType: null, headers: {}, deliveryId: null } });
  assertConforms("decoder-input.v1", binary);
  assert.equal(binary.payload, null);
});

test("validated decoder results and the sample event's preview match decoder-output.v1 and runtime-event.v1", () => {
  const { fixture } = contract("decoder-output.v1");
  assertConforms("decoder-output.v1", fixture);
  const { results, failures } = validateResults(fixture, PROFILE);
  assert.deepEqual(failures, []);
  assert.equal(results.length, fixture.length);
  for (const [i, result] of results.entries()) {
    // The validator keeps the decoder's keys and adds the profile's datatype and parameter_uuid.
    for (const key of Object.keys(result)) assert.ok(key in document("decoder-output.v1").$defs.result.properties, `result key ${key}`);
    for (const metric of result.metrics) {
      const { datatype, parameter_uuid, ...rest } = metric;
      assert.ok(datatype && parameter_uuid);
      for (const key of Object.keys(rest)) assert.ok(key in document("decoder-output.v1").$defs.result.properties.metrics.items.properties, `metric key ${key}`);
    }
    assert.equal(result.sourceDeviceId, fixture[i].sourceDeviceId);
  }
  assert.equal(validateResults(fixture[1], PROFILE).results.length, 1);
  const { failures: partial } = validateResults([fixture[1], { sourceDeviceId: "TRK-1001", metrics: [{ name: "unknown", value: 1 }] }], PROFILE);
  assert.deepEqual(partial.map((f) => f.index), [1]);
  for (const c of contract("decoder-output.v1").cases.filter((c) => c.valid)) {
    const mapped = [].concat(c.data).map((r) => ({ ...r, metrics: r.metrics.filter((m) => PROFILE.parameters.some((p) => p.key === m.name)) }));
    assert.deepEqual(validateResults(mapped, PROFILE).failures, [], c.description);
  }

  // The Publisher reports a validated result as the sample event's preview (nodes/adapter.js publishResult).
  const [{ input, ...preview }] = results.map((r, index) => ({ ...r, input: index }));
  const hash = crypto.createHash("sha256").update(preview.sourceDeviceId).digest("hex");
  const sample = {
    kind: "sample",
    adapter_uuid: "30000000-0000-4000-8000-000000000001",
    revision_uuid: "30000000-0000-4000-8000-000000000003",
    source_device_id: preview.sourceDeviceId,
    sparkplug_device_id: "src-" + hash.slice(0, 32),
    preview,
    retained: false,
    received_at: "2026-10-27T09:12:01.250Z",
  };
  assertConforms("runtime-event.v1", sample);
  assert.deepEqual(sample, caseData("runtime-event.v1", "a decoded device"));
});

function vendor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("Fetch now results of a page, a rejected credential and an unreachable API match fetch-result.v1", async () => {
  const settings = (url) => {
    const source = structuredClone(contract("source-settings.v1").fixture);
    source.request.url = url + "/accounts/A1/streams/history";
    return source;
  };
  const key = "vendor-api-key-123456";
  const records = [
    { id: "TRK-1001-1", deviceId: "TRK-1001", battery: 87 },
    { id: "TRK-1001-2", deviceId: "TRK-1001", battery: 86 },
  ];
  const answers = [
    [200, { "content-type": "application/json", "set-cookie": "sid=1", "x-ratelimit-remaining": "58" }, { data: records, maxDate: "2026-10-27T09:12:00.000Z", echo: key }],
    [401, { "content-type": "application/json" }, { error: "invalid key" }],
  ];
  const { server, url } = await vendor((req, res) => {
    const [status, headers, body] = answers.shift();
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  });
  const secrets = { api_key: key };
  const options = { allowPrivate: true, now: Date.parse("2026-10-27T09:15:00Z") };
  const ok = poll.fetchResult(await poll.fetchPage(settings(url), secrets, "2026-10-27T09:00:00.000Z", options), secrets);
  const rejected = poll.fetchResult(await poll.fetchPage(settings(url), secrets, "2026-10-27T09:00:00.000Z", options), secrets);
  server.close();
  const closed = await vendor(() => {});
  closed.server.close();
  const unreachable = poll.fetchResult(await poll.fetchPage(settings(closed.url), secrets, null, options), secrets);

  for (const result of [ok, rejected, unreachable]) {
    assertConforms("fetch-result.v1", result);
    assert.deepEqual(keys(result), keys(contract("fetch-result.v1").fixture));
    assert.equal(JSON.stringify(result).includes(key), false, "credentials are redacted");
  }
  assert.equal(ok.status, 200);
  assert.equal(ok.record_count, 2);
  assert.equal(ok.headers["set-cookie"], undefined);
  assert.equal(ok.next_cursor, "2026-10-27T09:12:00.000Z");
  assert.equal(rejected.error, "Credentials rejected");
  assert.equal(unreachable.status, null);
  assert.equal(unreachable.duration_ms, null);
  assert.deepEqual(unreachable.headers, {});
});

const HMAC_KEY = "placeholder-hmac-signing-key-1";
const signed = (body, key = HMAC_KEY) => ({ "x-signature": "sha256=" + crypto.createHmac("sha256", key).update(body).digest("hex") });
const post = (url, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(body);
  });

// Stands in for the tenant broker: acknowledges every publish.
function fakeBroker() {
  return () => {
    const client = new EventEmitter();
    client.connected = true;
    let next = 1;
    client.subscribe = (topic) => setImmediate(() => client.emit("message", topic, Buffer.from("online")));
    client.publish = (topic, body, options, callback) => {
      const messageId = next++;
      setImmediate(() => {
        client.emit("packetreceive", { cmd: "puback", messageId, reasonCode: 0 });
        callback(null, { messageId });
      });
    };
    client.end = () => {};
    setImmediate(() => client.emit("connect"));
    return client;
  };
}

test("the receiver reads the golden routing file, authenticates with it, and its report matches receiver-report.v1", async () => {
  const routes = contract("webhook-routes.v1").fixture;
  const [hmacId, urlId] = Object.keys(routes.routes);
  const hmac = routes.routes[hmacId];
  const urlRoute = routes.routes[urlId];

  // The hash the manager writes is the receiver's own hashToken; the route authenticates.
  assert.equal(urlRoute.secrets[0].sha256, hashToken("placeholder-url-token"));
  assert.equal(authenticate(urlRoute, { headers: {}, body: Buffer.from("{}"), segments: ["placeholder-url-token", "uplink"] }).ok, true);
  assert.equal(authenticate(hmac, { headers: signed("{}"), body: Buffer.from("{}"), segments: [] }).ok, true);
  assert.equal(authenticate(hmac, { headers: signed("{}", "placeholder-wrong-key"), body: Buffer.from("{}"), segments: [] }).ok, false);

  // The receiver loads the golden file as it is.
  const loaded = createReceiver({ routesFile: path.join(DIRECTORY, "webhook-routes.v1.fixture.json"), connect: fakeBroker(), reportToken: "" });
  loaded.reload();
  assert.deepEqual(Object.keys(loaded.routes()).sort(), [hmacId, urlId].sort());
  await loaded.stop();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contracts-"));
  const routesFile = path.join(dir, "routes.json");
  const paused = { ...structuredClone(hmac), state: "paused", adapter_uuid: "30000000-0000-4000-8000-000000000014" };
  const file = structuredClone(routes);
  file.routes[urlId] = paused;
  fs.writeFileSync(routesFile, JSON.stringify(file));

  const received = [];
  const api = http.createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      received.push(JSON.parse(text));
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const receiver = createReceiver({
    routesFile,
    connect: fakeBroker(),
    reportToken: "placeholder-receiver-token".padEnd(40, "x"),
    reportUrl: `http://127.0.0.1:${api.address().port}/reports`,
  });
  receiver.reload();
  await new Promise((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${receiver.server.address().port}`;

  const body = '[{"deviceId":"SNS-2001","temperature_c":21.5}]';
  await post(`${base}/w/${hmacId}`, body, signed(body)); // opens the tenant broker connection
  await new Promise((resolve) => setTimeout(resolve, 20));
  const statuses = [
    await post(`${base}/w/${hmacId}/uplink?kind=env`, body, { ...signed(body), "x-vendor-event": "uplink" }),
    await post(`${base}/w/${hmacId}`, "{}", signed("{}", "placeholder-wrong-key")),
    await post(`${base}/w/${hmacId}`, "x".repeat(1024 * 1024 + 1), signed("x")),
    await post(`${base}/w/${urlId}`, body, signed(body)),
  ];
  assert.deepEqual(statuses, [202, 401, 413, 503]);
  await receiver.flush();
  receiver.server.close();
  api.close();
  await receiver.stop();

  const report = received[0];
  assertConforms("receiver-report.v1", report);
  const golden = contract("receiver-report.v1").fixture;
  assert.deepEqual(keys(report), keys(golden));
  assert.deepEqual(keys(report.reports[0]), keys(golden.reports[0]));
  const entry = report.reports.find((r) => r.adapter_uuid === hmac.adapter_uuid);
  assert.deepEqual(keys(entry.rejections[0]), keys(golden.reports[0].rejections[0]));
  assert.ok(entry.secrets_used["30000000-0000-4000-8000-000000000004"]);
  assert.ok(Object.keys(entry.outcomes).every((name) => name in document("receiver-report.v1").properties.reports.items.properties.outcomes.properties));
  assert.deepEqual(
    entry.rejections.map((r) => r.reason),
    ["unauthenticated", "too_large"],
  );
  assert.equal(report.reports.find((r) => r.adapter_uuid === paused.adapter_uuid).rejections[0].reason, "paused");
});

// A sampling route keeps the delivery instead of handing it off, so the report carries a sample.
test("a sampling receiver reports samples that match receiver-report.v1", async () => {
  const routes = contract("webhook-routes.v1").fixture;
  const [id] = Object.keys(routes.routes);
  const route = { ...structuredClone(routes.routes[id]), state: "sampling" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contracts-"));
  const routesFile = path.join(dir, "routes.json");
  fs.writeFileSync(routesFile, JSON.stringify({ ...routes, routes: { [id]: route } }));
  const received = [];
  const api = http.createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      received.push(JSON.parse(text));
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const receiver = createReceiver({ routesFile, connect: fakeBroker(), reportToken: "placeholder-receiver-token".padEnd(40, "x"), reportUrl: `http://127.0.0.1:${api.address().port}/reports` });
  receiver.reload();
  await new Promise((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${receiver.server.address().port}`;
  const body = '[{"deviceId":"SNS-2001","temperature_c":21.5}]';
  assert.equal(await post(`${base}/w/${id}/uplink?kind=env&kind=air`, body, { ...signed(body), "x-vendor-event": "uplink" }), 202);
  await receiver.flush();
  receiver.server.close();
  api.close();
  await receiver.stop();
  const report = received[0];
  assertConforms("receiver-report.v1", report);
  const sample = report.reports[0].samples[0];
  assert.deepEqual(keys(sample), keys(contract("receiver-report.v1").fixture.reports[0].samples[0]));
  assert.deepEqual(sample.query, { kind: ["env", "air"] });
  assert.equal(sample.size, body.length);
  assert.deepEqual(report.reports[0].outcomes, { accepted: 1 });
});

// A fake Node-RED: it records the node types the adapter module registers.
function nodes() {
  const types = {};
  const RED = {
    nodes: {
      createNode(node, config) {
        node.handlers = {};
        node.sent = [];
        node.send = (message) => node.sent.push(message);
        node.credentials = config.credentials_for_test || {};
        node.on = (event, handler) => (node.handlers[event] = handler);
        node.status = () => {};
        node.warn = () => {};
      },
      registerType(name, constructor) {
        types[name] = constructor;
      },
    },
  };
  require("../nodes/adapter.js")(RED);
  return types;
}

const ADAPTER = "30000000-0000-4000-8000-000000000001";
const TENANT = "30000000-0000-4000-8000-000000000002";
const REVISION = "30000000-0000-4000-8000-000000000003";

// The Reporter node posts every event to Laravel; this collects the request bodies.
function callbackNode(types, posted) {
  const reporter = new types["iot-adapter-reporter"]({
    callback_url: "http://api.test/api/internal/adapters/events",
    tenant_uuid: TENANT,
    adapter_uuid: ADAPTER,
    credentials_for_test: { runtime_token: "placeholder-runtime-token" },
  });
  let closed = false;
  return {
    feed: (payload) => new Promise((resolve) => reporter.handlers.input({ payload }, () => {}, resolve)),
    close: async () => {
      if (closed) return;
      closed = true;
      reporter.handlers.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

test("events the runtime nodes send match runtime-event.v1: a failure, outcome counts, health and polling runs", async () => {
  const types = nodes();
  const posted = [];
  const emitted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push({ headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  };
  const environment = { IOT_ADAPTER_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "contracts-")), IOT_ADAPTER_ALLOW_PRIVATE_BROKERS: "true" };
  const saved = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]));
  Object.assign(process.env, environment);
  const reporter = callbackNode(types, posted);
  const servers = [];
  const input = caseData("decoder-input.v1", "a webhook delivery with its HTTP details");
  try {
    // A webhook input whose decoder throws: the Decoder node reports a failure and a count.
    const decoder = new types["iot-adapter-decoder"]({
      adapter_uuid: ADAPTER,
      code: "function decode(input) { return input.payload.missing.deviceId; }",
      profile: PROFILE,
    });
    const sent = [];
    await new Promise((resolve) => decoder.handlers.input({ inputs: [input] }, (message) => sent.push(message), resolve));
    const events = sent.map((message) => message[1]?.payload).filter(Boolean);
    const count = events.find((e) => e.kind === "count");
    assert.deepEqual(count.counts, { decoded: 0, decode_failed: 1 });
    for (const event of events) await reporter.feed(event);
    emitted.push(...events.filter((e) => e.kind !== "count"));

    // A polling source: an empty page, then a rejected credential.
    for (const [status, body] of [
      [200, { data: [], maxDate: "2026-10-27T09:12:00.000Z" }],
      [401, { error: "invalid key" }],
    ]) {
      const vendorApi = await vendor((req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
      servers.push(vendorApi.server);
      const source = structuredClone(contract("source-settings.v1").fixture);
      source.request.url = vendorApi.url + "/accounts/A1/streams/history";
      source.interval_seconds = 0.05;
      const node = new types["iot-adapter-source"]({
        adapter_uuid: ADAPTER,
        revision_uuid: REVISION,
        source,
        cursor: { generation: 1, start_at: "2026-10-27T08:00:00.000Z" },
        credentials_for_test: { api_key: "placeholder-vendor-api-key" },
      });
      const output = () => node.sent.map((message) => message[1]?.payload).filter(Boolean);
      for (let waited = 0; !output().some((e) => e.kind === "poll_run") && waited < 5000; waited += 10) await new Promise((r) => setTimeout(r, 10));
      node.handlers.close();
      assert.ok(output().some((e) => e.kind === "poll_run"), "the poll run was reported");
      for (const event of output()) {
        emitted.push(event);
        await reporter.feed(event);
      }
      await new Promise((r) => setTimeout(r, 100)); // a run already under way ends
    }
  } finally {
    await reporter.close();
    globalThis.fetch = realFetch;
    for (const [name, value] of Object.entries(saved)) value === undefined ? delete process.env[name] : (process.env[name] = value);
    servers.forEach((server) => server.close());
  }

  assert.ok(posted.every((p) => p.headers.Authorization === "Bearer placeholder-runtime-token" && p.headers["X-Adapter-Tenant"] === TENANT));
  const bodies = posted.map((p) => p.body);
  for (const kind of ["failure", "outcomes", "health", "poll_run"]) assert.ok(bodies.some((b) => b.kind === kind), `a ${kind} event was sent`);
  for (const event of [...bodies, ...emitted]) assertConforms("runtime-event.v1", event);

  const golden = contract("runtime-event.v1").cases.filter((c) => c.valid).map((c) => c.data);
  const sameKeys = (kind, where = () => true) => {
    const sent = bodies.find((b) => b.kind === kind && where(b));
    const expected = golden.find((g) => g.kind === kind && where(g));
    assert.ok(sent && expected, `a ${kind} event`);
    assert.deepEqual(keys(sent), keys(expected), `${kind} keys`);
    return sent;
  };
  const failure = sameKeys("failure");
  assert.deepEqual(keys(failure.input), keys(golden.find((g) => g.kind === "failure" && g.source === "webhook").input));
  assert.equal(failure.reason, "decode_failed");
  assert.equal(failure.delivery_id, input.http.deliveryId);
  sameKeys("outcomes");
  sameKeys("poll_run", (e) => e.outcome !== "stopped");
  const stopped = sameKeys("poll_run", (e) => e.outcome === "stopped");
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.http_status, 401);
  assert.equal(stopped.reason, "Credentials rejected");
  // The source reports its state with every run; the reporter throttles repeats, so check what the node emitted.
  assert.ok(emitted.some((e) => e.kind === "health" && e.source_state === "polling" && e.source_connected === true));
  assert.ok(emitted.some((e) => e.kind === "health" && e.source_state === "stopped" && e.source_connected === false));
  assert.deepEqual(keys(emitted.find((e) => e.kind === "health")), keys(golden.find((g) => g.kind === "health" && "source_state" in g)));
});
