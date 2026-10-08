// Real Mosquitto + Node-RED + Go-parser verification in disposable localhost processes.
// No existing broker, database, runtime checkpoint or simulator is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const mqtt = require("mqtt");
const { flowNodes } = require("../lib/flow.cjs");
const { Payload } = require("../lib/sparkplug.cjs");
const root = path.resolve(__dirname, "../../..");
const red =
  process.env.NODE_RED_ENTRY ||
  path.join(root, ".local/adapter-tests/node_modules/node-red/red.js");
const children = [];
const clients = [];
let callback;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error(message);
}
async function port() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const n = server.address().port;
      server.close(() => resolve(n));
    });
  });
}
function child(command, args, env = {}) {
  const process = spawn(command, args, {
    env: { ...global.process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(process);
  let diagnostic = "";
  process.stdout.on("data", (data) => {
    diagnostic += data;
  });
  process.stderr.on("data", (data) => {
    diagnostic += data;
  });
  process.on("error", () => {});
  process.diagnostic = () => diagnostic.slice(-5000);
  return process;
}
async function connect(url, username, password, ca) {
  const client = mqtt.connect(url, {
    username,
    password,
    ca,
    rejectUnauthorized: true,
    reconnectPeriod: 0,
    connectTimeout: 3000,
  });
  clients.push(client);
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  return client;
}
async function subscribe(client, topic) {
  await new Promise((resolve, reject) =>
    client.subscribe(topic, { qos: 1 }, (e, result) =>
      e || result.some((r) => r.qos === 128)
        ? reject(e || Error("Subscription denied"))
        : resolve(),
    ),
  );
}
async function publish(client, topic, payload) {
  await new Promise((resolve, reject) =>
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (e) =>
      e ? reject(e) : resolve(),
    ),
  );
}

(async () => {
  await fs.access(red);
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "iot-adapter-verification-"),
  );
  try {
    const cert = path.join(dir, "server.crt");
    const key = path.join(dir, "server.key");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const ca = await fs.readFile(cert, "utf8");
    async function broker(label, users, acl) {
      const listen = await port();
      const passwords = path.join(dir, label + ".passwords");
      users.forEach((user, i) =>
        execFileSync(
          "mosquitto_passwd",
          [
            "-b",
            ...(i === 0 ? ["-c"] : []),
            passwords,
            user.username,
            user.password,
          ],
          { stdio: "ignore" },
        ),
      );
      const aclPath = path.join(dir, label + ".acl");
      await fs.writeFile(aclPath, acl);
      const config = path.join(dir, label + ".conf");
      await fs.writeFile(
        config,
        `listener ${listen} 127.0.0.1\nallow_anonymous false\npassword_file ${passwords}\nacl_file ${aclPath}\ncertfile ${cert}\nkeyfile ${key}\n`,
      );
      const process = child(
        processEnv("MOSQUITTO_BIN", "/opt/homebrew/sbin/mosquitto"),
        ["-c", config],
      );
      await until(async () => {
        try {
          const client = await connect(
            `mqtts://127.0.0.1:${listen}`,
            users[0].username,
            users[0].password,
            ca,
          );
          await client.endAsync();
          return true;
        } catch {
          return false;
        }
      }, `Broker ${label} failed: ${process.diagnostic()}`);
      return `mqtts://127.0.0.1:${listen}`;
    }
    const pass = () => crypto.randomBytes(24).toString("hex");
    const a = { username: "hardware-a", password: pass() },
      b = { username: "hardware-b", password: pass() },
      upstream = { username: "platform", password: pass() };
    const urlA = await broker(
      "a",
      [a],
      "user hardware-a\ntopic readwrite meters/#\n",
    );
    const urlB = await broker(
      "b",
      [b],
      "user hardware-b\ntopic readwrite meters/#\n",
    );
    const platform = await broker(
      "platform",
      [upstream],
      "user platform\ntopic readwrite spBv1.0/#\n",
    );
    await assert.rejects(connect(urlB, a.username, a.password, ca));
    const clientA = await connect(urlA, a.username, a.password, ca),
      clientB = await connect(urlB, b.username, b.password, ca);
    await subscribe(clientB, "meters/#");
    let tenantBPackets = 0;
    clientB.on("message", () => tenantBPackets++);
    const monitor = await connect(
      platform,
      upstream.username,
      upstream.password,
      ca,
    );
    await subscribe(monitor, "spBv1.0/#");
    const packets = [];
    monitor.on("message", (topic, bytes) =>
      packets.push({ topic, payload_base64: bytes.toString("base64") }),
    );
    const events = [];
    callback = http.createServer(async (req, res) => {
      let data = "";
      for await (const part of req) data += part;
      events.push({
        tenant: req.headers["x-adapter-tenant"],
        ...JSON.parse(data),
      });
      res.writeHead(204);
      res.end();
    });
    await new Promise((resolve) => callback.listen(0, "127.0.0.1", resolve));
    const callbackUrl = `http://127.0.0.1:${callback.address().port}/events`;
    async function runtime(label) {
      const data = path.join(dir, label);
      await fs.mkdir(data);
      const listen = await port();
      const adminToken = pass();
      const process = child(
        global.process.execPath,
        [
          red,
          "--userDir",
          data,
          "--settings",
          path.join(root, "services/adapters/runtime-settings.cjs"),
          "--port",
          String(listen),
        ],
        {
          IOT_NODE_RED_ADMIN_TOKEN: adminToken,
          IOT_NODE_RED_CREDENTIAL_SECRET: pass(),
          IOT_ADAPTER_DATA_DIR: data,
          IOT_ADAPTER_NODES_DIR: path.join(root, "services/adapters/nodes"),
          IOT_ADAPTER_ALLOW_PRIVATE_BROKERS: "true",
        },
      );
      const url = `http://127.0.0.1:${listen}`;
      async function admin(method, body) {
        const r = await fetch(url + "/flows", {
          method,
          headers: {
            Authorization: "Bearer " + adminToken,
            "Content-Type": "application/json",
            "Node-RED-API-Version": "v2",
            "Node-RED-Deployment-Type": "flows",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!r.ok) throw Error(`Node-RED ${r.status}: ${await r.text()}`);
        return r.json();
      }
      await until(async () => {
        try {
          await admin("GET");
          return true;
        } catch {
          return false;
        }
      }, `Node-RED ${label} failed: ${process.diagnostic()}`);
      assert.equal((await fetch(url + "/flows")).status, 401);
      return { admin, data };
    }
    const runtimeA = await runtime("runtime-a"),
      runtimeB = await runtime("runtime-b");
    const body = {
      adapter_uuid: "10000000-0000-4000-8000-000000000001",
      revision_uuid: "20000000-0000-4000-8000-000000000001",
      name: "Vendor meter",
      tenant: {
        uuid: "30000000-0000-4000-8000-000000000001",
        runtime_token: pass(),
      },
      code: 'function decode(input){const p=input.payload;return {sourceDeviceId:p.serial,metrics:[{name:"flow_rate",value:p.flow_ml_min/1000,unit:"L/min"},{name:"total_volume",value:p.total_ml/1000,unit:"L"}]};}',
      profile: {
        parameters: [
          {
            uuid: "flow",
            key: "flow_rate",
            data_type: "number",
            unit: "L/min",
            reports_state: true,
          },
          {
            uuid: "volume",
            key: "total_volume",
            data_type: "number",
            unit: "L",
            reports_state: true,
          },
        ],
      },
      bindings: [],
    };
    const sourceA = {
      url: urlA,
      ...a,
      ca_certificate: ca,
      topics: ["meters/+/telemetry"],
      managed: true,
    };
    const sourceB = {
      url: urlB,
      ...b,
      ca_certificate: ca,
      topics: ["meters/+/telemetry"],
      managed: false,
    };
    const up = {
      url: platform,
      ...upstream,
      ca_certificate: ca,
      group_id: "tenant-a",
      host_id: "host-a",
      edge_node_id: "edge-a",
    };
    async function deploy(runtime, definition, source, upstream) {
      const current = await runtime.admin("GET");
      await runtime.admin("POST", {
        rev: current.rev,
        flows: flowNodes(definition, source, upstream, callbackUrl),
      });
    }
    await deploy(runtimeA, body, sourceA, up);
    const bodyB = {
      ...body,
      adapter_uuid: "10000000-0000-4000-8000-000000000002",
      tenant: { ...body.tenant, uuid: "30000000-0000-4000-8000-000000000002" },
    };
    await deploy(runtimeB, bodyB, sourceB, {
      ...up,
      group_id: "tenant-b",
      edge_node_id: "edge-b",
      host_id: "host-b",
    });
    await until(
      () =>
        events.filter((e) => e.kind === "health" && e.source_connected === true)
          .length >= 2 &&
        packets.filter((p) => p.topic.includes("/NBIRTH/")).length >= 2,
      "Runtimes did not connect",
    );
    const sample = { serial: "WM-1042", flow_ml_min: 12000, total_ml: 8400000 };
    await publish(clientA, "meters/fixed/telemetry", sample);
    await until(
      () => packets.some((p) => p.topic.includes("tenant-a/DBIRTH/")),
      "Unknown device did not produce a birth preview",
    );
    assert.equal(
      packets.some((p) => p.topic.includes("/DDATA/")),
      false,
    );
    assert.equal(tenantBPackets, 0, "Tenant A payload crossed into tenant B");
    const preview = events.find(
      (e) => e.kind === "sample" && e.tenant === body.tenant.uuid,
    );
    await until(
      () =>
        events.some(
          (e) => e.kind === "sample" && e.tenant === body.tenant.uuid,
        ),
      "Platform discovery callback missing",
    );
    const p = events.find(
      (e) => e.kind === "sample" && e.tenant === body.tenant.uuid,
    );
    assert.deepEqual(
      p.preview.metrics.map((m) => m.value),
      [12, 8400],
    );
    const installation = "40000000-0000-4000-8000-000000000001";
    body.bindings = [
      {
        source_device_id: "WM-1042",
        installation_uuid: installation,
        virtual_device_uuid: "stable-device",
      },
    ];
    await deploy(runtimeA, body, sourceA, up);
    await delay(500);
    await publish(clientA, "meters/fixed/telemetry", sample);
    await until(
      () => packets.some((p) => p.topic.includes("tenant-a/DDATA/")),
      "Activated device did not publish telemetry",
    );
    const data = Payload.decode(
      Buffer.from(
        packets.find((p) => p.topic.includes("tenant-a/DDATA/")).payload_base64,
        "base64",
      ),
    );
    assert.deepEqual(
      data.metrics.map((m) => m.doubleValue),
      [12, 8400],
    );
    assert.equal(
      data.metrics[0].properties.values[0].stringValue,
      installation,
    );
    await publish(clientB, "meters/fixed/telemetry", {
      ...sample,
      serial: "WM-B",
    });
    await until(
      () => packets.some((p) => p.topic.includes("tenant-b/DBIRTH/")),
      "Vendor broker path did not decode",
    );
    assert.equal(
      packets.some((p) => p.topic.includes("tenant-b/DDATA/")),
      false,
    );
    const saved = JSON.stringify(await runtimeA.admin("GET"));
    assert.equal(saved.includes(a.password), false);
    assert.equal(saved.includes(upstream.password), false);
    // A stale Node-RED revision cannot overwrite the current deployment.
    await assert.rejects(
      runtimeA.admin("POST", { rev: "stale-revision", flows: [] }),
      /409/,
    );
    const capture = path.join(dir, "packets.json");
    await fs.writeFile(
      capture,
      JSON.stringify(
        packets.filter((p) => p.topic.startsWith("spBv1.0/tenant-a/")),
      ),
    );
    execFileSync(
      "go",
      [
        "test",
        "./internal/sparkplug",
        "-run",
        "TestLiveVendorAdapterCapture",
        "-count=1",
      ],
      {
        cwd: path.join(root, "services/runtime"),
        env: { ...process.env, ADAPTER_CAPTURE_PATH: capture },
        stdio: "inherit",
      },
    );
    console.log(
      "Verified: tenant topic isolation, invalid cross-tenant credentials, both broker paths, discovery gating, 12 L/min and 8,400 L, encrypted flow credentials, stale revisions, and Go Sparkplug ingestion.",
    );
  } finally {
    await Promise.allSettled(clients.map((c) => c.endAsync(true)));
    if (callback) callback.close();
    for (const process of children) process.kill("SIGTERM");
    await delay(300);
    for (const process of children)
      if (process.exitCode === null) process.kill("SIGKILL");
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
function processEnv(name, fallback) {
  return process.env[name] || fallback;
}
