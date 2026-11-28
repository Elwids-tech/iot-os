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
// message may be a function, so a failure reports what a child printed while we waited.
async function until(check, message) {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw Error(typeof message === "function" ? message() : message);
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
  process.on("error", (error) => {
    diagnostic += `${error}\n`;
  });
  process.on("exit", (code, signal) => {
    diagnostic += `exited with ${signal || code}\n`;
  });
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
      }, () => `Broker ${label} failed: ${process.diagnostic()}`);
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
      }, () => `Node-RED ${label} failed: ${process.diagnostic()}`);
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
    await verifyOpcua(runtimeA, up, events, packets, callbackUrl, deploy);
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
// Spec 038 PR 5: an OPC UA data source collected by a real tenant runtime from the
// simulated building. Deploy, a birth per equipment, change and rhythm data once a source
// is bound, a bad value as null with its quality, and a redeploy that keeps the sources.
async function verifyOpcua(runtimeA, up, events, packets, callbackUrl, deploy) {
  const { live, start } = require("../test/opcua-simulator.cjs");
  if (live().skip) {
    console.log("Skipped the OPC UA scenario: " + live().skip);
    return;
  }
  const sim = await start();
  try {
    const map = JSON.parse(await fs.readFile(path.join(root, "contracts/pointmaps/v1/point-map.v1.fixture.json"), "utf8"));
    for (const reading of map.readings) reading.report.sample_ms = 1000;
    map.rhythm_seconds = 60;
    const types = { number: "number", boolean: "boolean", state: "integer", text: "string" };
    const body = {
      adapter_uuid: "10000000-0000-4000-8000-000000000003",
      revision_uuid: "20000000-0000-4000-8000-000000000003",
      name: "Zone controllers",
      tenant: { uuid: "30000000-0000-4000-8000-000000000001", runtime_token: "opcua-token" },
      code: "",
      profile: { parameters: map.readings.map((r) => ({ uuid: "p-" + r.key, key: r.key, data_type: types[r.data_type], unit: r.unit ?? null, reports_state: true })) },
      bindings: [],
    };
    const source = {
      type: "opcua",
      connection: { uuid: "50000000-0000-4000-8000-000000000001", endpoint_url: sim.url, security_policy: "None", security_mode: "None", identity: "anonymous", server_fingerprint: null },
      point_map: map,
      secrets: {},
      private_ranges: [],
      platform_ranges: [],
    };
    const upstream = { ...up, edge_node_id: "edge-opcua" };
    const id = (sourceId) => "src-" + crypto.createHash("sha256").update(sourceId).digest("hex").slice(0, 32);
    const [box, core] = map.equipment.map((e) => e.source_id);
    const mine = (kind, sourceId) => packets.filter((p) => p.topic === `spBv1.0/${upstream.group_id}/${kind}/${upstream.edge_node_id}/${id(sourceId)}`);
    const decoded = (p) => Payload.decode(Buffer.from(p.payload_base64, "base64"));
    const property = (metric, key) => {
      const i = metric.properties?.keys.indexOf(key) ?? -1;
      return i < 0 ? undefined : metric.properties.values[i].stringValue;
    };
    await deploy(runtimeA, body, source, upstream);
    await until(() => mine("DBIRTH", box).length && mine("DBIRTH", core).length, "No birth for each equipment");
    await until(() => events.some((e) => e.kind === "connection_status" && e.adapter_uuid === body.adapter_uuid && e.state === "connected"), "No connected status");
    await until(() => events.some((e) => e.kind === "refused_points" && e.adapter_uuid === body.adapter_uuid), "No refused points report");
    assert.equal(mine("DDATA", box).length, 0, "An unbound source stored readings");
    assert.ok(events.some((e) => e.kind === "sample" && e.source_device_id === box && e.preview.metrics.every((m) => m.quality)), "No sample preview with quality");
    // Bound: data flows, first the rhythm read with the server's time.
    const installation = "40000000-0000-4000-8000-000000000003";
    body.bindings = [{ source_device_id: box, installation_uuid: installation, virtual_device_uuid: "zone-device" }];
    await deploy(runtimeA, body, source, upstream);
    await until(() => mine("DDATA", box).some((p) => decoded(p).metrics.some((m) => property(m, "timestamp_source") === "server")), "No rhythm data with the server's time");
    const first = decoded(mine("DDATA", box)[0]).metrics[0];
    assert.equal(property(first, "installation_uuid"), installation);
    assert.equal(mine("DDATA", core).length, 0, "The unbound equipment stored readings");
    await sim.scenario("controller_offline", true, "L03-VAV-2");
    try {
      await until(() => mine("DDATA", box).some((p) => decoded(p).metrics.some((m) => m.name === "zone_temperature" && m.isNull && property(m, "quality") === "bad")), "No bad value as null");
      const bad = mine("DDATA", box).map(decoded).flatMap((d) => d.metrics).find((m) => m.name === "zone_temperature" && m.isNull);
      assert.equal(property(bad, "quality_reason"), "No communication with the device");
    } finally {
      await sim.scenario("controller_offline", false);
    }
    // A redeploy keeps both sources: the publisher births them again from its file.
    const before = packets.length;
    await deploy(runtimeA, { ...body, revision_uuid: "20000000-0000-4000-8000-000000000004" }, source, upstream);
    await until(() => packets.slice(before).filter((p) => p.topic.includes("/DBIRTH/edge-opcua/")).length >= 2, "A redeploy lost a source");
    console.log("Verified OPC UA: a birth per equipment, no data before binding, rhythm data with the server's time, a bad value as null with its reason, and sources kept across a redeploy.");
  } finally {
    await sim.stop();
  }
}
function processEnv(name, fallback) {
  return process.env[name] || fallback;
}
