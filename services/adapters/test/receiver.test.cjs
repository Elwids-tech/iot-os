const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");
const { EventEmitter } = require("node:events");
const { createReceiver } = require("../receiver.cjs");
const { hashToken } = require("../lib/webhook.cjs");

const ADAPTER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ID = "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56";
const OTHER_ID = "Zz12Cd34Ef56Gh78Ij90Kl12Mn34Op99";
const KEY = "vendor-signing-secret-1234";

function route(adapter, state, secrets, auth = { mode: "hmac", signature_header: "x-signature", encoding: "hex", prefix: "sha256=" }) {
  return { adapter_uuid: adapter, tenant_uuid: TENANT, state, broker: { url: "mqtts://tenant:8883", username: "webhook-" + adapter, password: "p".repeat(64) }, topic: "iot-os/webhook/" + adapter, status_topic: "iot-os/webhook/" + adapter + "/status", auth, secrets };
}

// Stands in for the tenant broker: records publishes and acknowledges them.
function fakeBroker({ online = true, reason = 0, fail = false } = {}) {
  const published = [];
  const connect = () => {
    const client = new EventEmitter();
    client.connected = true;
    let next = 1;
    client.subscribe = (topic) => setImmediate(() => client.emit("message", topic, Buffer.from(online ? "online" : "offline")));
    client.publish = (topic, body, options, callback) => {
      const messageId = next++;
      published.push({ topic, body, properties: options.properties.userProperties });
      setImmediate(() => {
        client.emit("packetreceive", { cmd: "puback", messageId, reasonCode: reason });
        callback(fail ? Error("refused") : null, { messageId });
      });
    };
    client.end = () => {};
    setImmediate(() => client.emit("connect"));
    return client;
  };
  return { connect, published };
}

async function start(routes, broker, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receiver-"));
  const routesFile = path.join(dir, "routes.json");
  fs.writeFileSync(routesFile, JSON.stringify({ schema_version: "webhook-routes.v1", routes }));
  const receiver = createReceiver({ routesFile, connect: broker.connect, reportToken: "", ...options });
  receiver.reload();
  await new Promise((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${receiver.server.address().port}`;
  return { receiver, base, close: () => receiver.server.close() };
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const signed = (body, key = KEY) => ({ "x-signature": "sha256=" + crypto.createHmac("sha256", key).update(body).digest("hex") });

test("an authenticated delivery is handed to its tenant broker and answered 202 after the acknowledgement", async () => {
  const broker = fakeBroker();
  const { receiver, base, close } = await start({ [ID]: route(ADAPTER, "running", [{ uuid: "s1", key: KEY }]) }, broker);
  const body = JSON.stringify([{ deviceId: "SNS-2001", temperature_c: 21.5 }]);
  await post(`${base}/w/${ID}`, body, signed(body));
  await new Promise((r) => setTimeout(r, 20));
  const answer = await post(`${base}/w/${ID}/uplink?kind=env`, body, { ...signed(body), "x-vendor-event": "uplink", authorization: "Bearer leak" });
  close();
  assert.equal(answer.status, 202);
  assert.match(answer.body.delivery_id, /^[0-9a-f-]{36}$/);
  const last = broker.published.at(-1);
  assert.equal(last.topic, "iot-os/webhook/" + ADAPTER);
  assert.equal(last.body.toString(), body);
  assert.equal(last.properties.path, "/uplink");
  assert.deepEqual(JSON.parse(last.properties.query), { kind: "env" });
  const headers = JSON.parse(last.properties.headers);
  assert.equal(headers["x-vendor-event"], "uplink");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-signature"], undefined);
  await receiver.stop();
});

test("wrong methods, unknown URLs, wrong secrets and another adapter's secret are refused without detail", async () => {
  const broker = fakeBroker();
  const { receiver, base, close } = await start(
    { [ID]: route(ADAPTER, "running", [{ uuid: "s1", key: KEY }]), [OTHER_ID]: route(OTHER, "running", [{ uuid: "s2", key: "other-adapter-secret-5678" }]) },
    broker,
  );
  const body = "{}";
  const get = await new Promise((resolve) => http.get(`${base}/w/${ID}`, (res) => resolve(res.statusCode)));
  const unknown = await post(`${base}/w/Qq12Cd34Ef56Gh78Ij90Kl12Mn34Op00`, body, signed(body));
  const wrong = await post(`${base}/w/${ID}`, body, signed(body, "guessed-secret-000000"));
  const crossed = await post(`${base}/w/${ID}`, body, signed(body, "other-adapter-secret-5678"));
  close();
  assert.deepEqual([get, unknown.status, wrong.status, crossed.status], [405, 404, 401, 401]);
  assert.deepEqual(wrong.body, { error: "Unauthorized" });
  assert.equal(broker.published.length, 0);
  await receiver.stop();
});

test("bodies over 1 MiB, compressed bombs and paused adapters are refused; the tenant broker's refusal is 503", async () => {
  const { receiver, base, close } = await start(
    { [ID]: route(ADAPTER, "running", [{ uuid: "s1", key: KEY }]), [OTHER_ID]: route(OTHER, "paused", [{ uuid: "s2", key: KEY }]) },
    fakeBroker({ reason: 16 }),
  );
  const big = "x".repeat(1024 * 1024 + 1);
  const bomb = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024, 32));
  const bombAnswer = await post(`${base}/w/${ID}`, bomb, { ...signed(bomb), "content-encoding": "gzip" });
  const bigAnswer = await post(`${base}/w/${ID}`, big, signed(big));
  const paused = await post(`${base}/w/${OTHER_ID}`, "{}", signed("{}"));
  const noSubscriber = await post(`${base}/w/${ID}`, "{}", signed("{}"));
  close();
  assert.equal(bigAnswer.status, 413);
  assert.equal(bombAnswer.status, 413);
  assert.equal(paused.status, 503);
  assert.ok(paused.headers["retry-after"]);
  assert.equal(noSubscriber.status, 503);
  await receiver.stop();
});

test("an adapter's rate limit answers 429 with Retry-After, and repeated failures ban the address", async () => {
  const { receiver, base, close } = await start({ [ID]: route(ADAPTER, "running", [{ uuid: "s1", key: KEY }]) }, fakeBroker(), { adapterRate: 1, adapterBurst: 2, authFailures: 3 });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post(`${base}/w/${ID}`, "{}", signed("{}"))).status);
  for (let i = 0; i < 4; i++) await post(`${base}/w/${ID}`, "{}", signed("{}", "wrong-secret-0000000"));
  const banned = await post(`${base}/w/${ID}`, "{}", signed("{}"));
  close();
  assert.equal(codes[2], 429);
  assert.equal(banned.status, 429);
  assert.ok(Number(banned.headers["retry-after"]) > 0);
  await receiver.stop();
});

test("before deployment, deliveries are samples; while the runtime is offline, the backlog is bounded", async () => {
  const sampling = await start({ [ID]: route(ADAPTER, "sampling", [{ uuid: "s1", sha256: hashToken("token-with-enough-length") }], { mode: "url" }) }, fakeBroker());
  const sample = await post(`${sampling.base}/w/${ID}/token-with-enough-length/env`, '{"t":1}');
  sampling.close();
  assert.equal(sample.status, 202);
  await sampling.receiver.stop();
  const offline = await start({ [ID]: route(ADAPTER, "running", [{ uuid: "s1", key: KEY }]) }, fakeBroker({ online: false }), { backlogMessages: 2 });
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push((await post(`${offline.base}/w/${ID}`, "{}", signed("{}"))).status);
  offline.close();
  assert.deepEqual(answers, [202, 202, 503]);
  await offline.receiver.stop();
});

test("reports carry outcomes, rejections without bodies, samples and secret use", async () => {
  const received = [];
  const api = http.createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(text) });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const { receiver, base, close } = await start({ [ID]: route(ADAPTER, "sampling", [{ uuid: "s1", key: KEY }]) }, fakeBroker(), {
    reportToken: "receiver-token-".padEnd(40, "x"),
    reportUrl: `http://127.0.0.1:${api.address().port}/reports`,
  });
  await post(`${base}/w/${ID}`, '{"secret":"body"}', signed('{"secret":"body"}', "wrong-secret-0000000"));
  await post(`${base}/w/${ID}/env`, '{"t":1}', signed('{"t":1}'));
  await receiver.flush();
  close();
  api.close();
  const report = received[0].body;
  assert.equal(received[0].auth, "Bearer " + "receiver-token-".padEnd(40, "x"));
  assert.equal(report.schema_version, "receiver-report.v1");
  const entry = report.reports[0];
  assert.deepEqual(entry.outcomes, { unauthenticated: 1, accepted: 1 });
  assert.equal(JSON.stringify(entry.rejections).includes("secret"), false);
  assert.equal(entry.samples[0].path, "/env");
  assert.equal(Buffer.from(entry.samples[0].body_base64, "base64").toString(), '{"t":1}');
  assert.ok(entry.secrets_used.s1);
  await receiver.stop();
});

test("a report that was not acknowledged is resent with the same id; long paths are cut", async () => {
  const received = [];
  let fail = true;
  const api = http.createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      received.push(JSON.parse(text));
      res.writeHead(fail ? 503 : 204).end();
      fail = false;
    });
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const { receiver, base, close } = await start({ [ID]: route(ADAPTER, "sampling", [{ uuid: "s1", key: KEY }]) }, fakeBroker(), {
    reportToken: "receiver-token-".padEnd(40, "x"),
    reportUrl: `http://127.0.0.1:${api.address().port}/reports`,
  });
  await post(`${base}/w/${ID}/${"p".repeat(600)}`, "{}", signed("{}", "wrong-secret-0000000"));
  await receiver.flush();
  await post(`${base}/w/${ID}`, "{}", signed("{}"));
  await receiver.flush();
  await receiver.flush();
  close();
  api.close();
  assert.equal(received[0].report_id, received[1].report_id);
  assert.deepEqual(received[1].reports[0].outcomes, { unauthenticated: 1 });
  assert.deepEqual(received[2].reports[0].outcomes, { accepted: 1 });
  assert.equal(received[0].reports[0].rejections[0].path.length, 512);
  await receiver.stop();
});
