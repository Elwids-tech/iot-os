const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const mqtt = require("mqtt");
const {
  decode,
  inputFromMessage,
  validateOutput,
} = require("./lib/decoder.cjs");
const { brokerUrl, secureLookup } = require("./lib/broker.cjs");
const { flowNodes, replaceFlow } = require("./lib/flow.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const stateRoot = process.env.IOT_ADAPTER_STATE_DIR || "/state";
const hostStateRoot = process.env.IOT_ADAPTER_HOST_STATE_DIR || stateRoot;
const network = process.env.IOT_ADAPTER_DOCKER_NETWORK;
const runtimeImage =
  process.env.IOT_ADAPTER_RUNTIME_IMAGE || "iot-device-adapter-runtime:local";
const brokerImage =
  process.env.IOT_ADAPTER_BROKER_IMAGE ||
  "eclipse-mosquitto:2.0.22@sha256:199ea8ef2e35ec2b1b37e59cfd1dbae538ed4dfa4a2251a121a52215a6248a21";
const token = process.env.IOT_ADAPTER_MANAGER_TOKEN;
const project = process.env.IOT_ADAPTER_PROJECT || "development";
const scope = crypto
  .createHash("sha256")
  .update(project)
  .digest("hex")
  .slice(0, 8);
const locks = new Map();
let testsRunning = 0;
function ensure(condition, message) {
  if (!condition) throw Error(message);
}
function id(value) {
  ensure(uuid.test(value || ""), "Invalid resource identifier");
  return value;
}
function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      if (out.length < 200000) out += d;
    });
    child.stderr.resume();
    child.once("error", () => reject(Error("Runtime command unavailable")));
    child.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(Error("Runtime command failed")),
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Runtime command timed out"));
    }, 60000);
    child.once("exit", () => clearTimeout(timer));
  });
}
async function docker(args, env) {
  return run("docker", args, env);
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
async function tenantState(tenant) {
  id(tenant.uuid);
  ensure(
    Number.isInteger(tenant.listen_port) &&
      tenant.listen_port >= 1024 &&
      tenant.listen_port <= 65535,
    "Invalid tenant port",
  );
  const dir = path.join(stateRoot, tenant.uuid);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "manager.json");
  if (await exists(file))
    return { dir, ...JSON.parse(await fs.readFile(file, "utf8")) };
  const data = {
    adminToken: crypto.randomBytes(32).toString("hex"),
    credentialSecret: crypto.randomBytes(32).toString("hex"),
  };
  await fs.writeFile(file, JSON.stringify(data), { mode: 0o600 });
  return { dir, ...data };
}
function prefix(tenant) {
  return "adapter-" + scope + "-" + id(tenant.uuid);
}
async function ensureContainer(name, args, env) {
  let current;
  try {
    current = JSON.parse(await docker(["inspect", name]))[0];
  } catch {}
  if (current) {
    ensure(
      current.Config.Labels?.["iot.adapter.project"] === project,
      "Runtime resource ownership mismatch",
    );
    const image = args[args.length - 1];
    const desired = (
      await docker(["image", "inspect", "--format", "{{.Id}}", image])
    ).trim();
    if (current.Image === desired) {
      await docker(["start", name]);
      return;
    }
    await docker(["stop", "--time", "20", name]);
    await docker(["rm", name]);
  }
  await docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "iot.adapter.managed=true",
      "--label",
      "iot.adapter.project=" + project,
      "--restart",
      "unless-stopped",
      ...args,
    ],
    env,
  );
}
function control(url, ca, password, commands) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      username: "adapter-admin",
      password,
      ca,
      rejectUnauthorized: true,
      reconnectPeriod: 0,
      connectTimeout: 8000,
      protocolVersion: 5,
    });
    const timer = setTimeout(
      () => finish(Error("Tenant broker provisioning timed out")),
      15000,
    );
    let done = false;
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.end(true);
      error ? reject(error) : resolve();
    }
    client.on("error", () =>
      finish(Error("Tenant broker provisioning failed")),
    );
    client.on("connect", () =>
      client.subscribe(
        "$CONTROL/dynamic-security/v1/response",
        { qos: 1 },
        (error) => {
          if (error) return finish(Error("Broker administration unavailable"));
          client.publish(
            "$CONTROL/dynamic-security/v1",
            JSON.stringify({ commands }),
            { qos: 1 },
          );
        },
      ),
    );
    client.on("message", (_, payload) => {
      try {
        const response = JSON.parse(payload.toString());
        for (const item of response.responses || []) {
          if (
            item.error &&
            !["Client already exists", "Role already exists"].includes(
              item.error,
            )
          )
            return finish(Error("Tenant broker rejected provisioning"));
        }
        finish();
      } catch {
        finish(Error("Invalid broker administration response"));
      }
    });
  });
}
async function provisionTenant(tenant) {
  const state = await tenantState(tenant);
  const name = prefix(tenant);
  ensure(network, "Runtime Docker network is required");
  const tlsDir = path.join(state.dir, "tls");
  await fs.mkdir(tlsDir, { recursive: true, mode: 0o755 });
  const publicHost = process.env.IOT_ADAPTER_PUBLIC_HOST || "localhost";
  ensure(/^[a-zA-Z0-9.-]+$/.test(publicHost), "Invalid public MQTT host");
  if (!(await exists(path.join(tlsDir, "server.crt")))) {
    const caKey = path.join(state.dir, "ca.key");
    const caCert = path.join(tlsDir, "ca.crt");
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caCert,
      "-days",
      "365",
      "-subj",
      "/CN=IoT tenant " + tenant.uuid,
    ]);
    await run("openssl", [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(tlsDir, "server.key"),
      "-out",
      path.join(state.dir, "server.csr"),
      "-subj",
      "/CN=" + publicHost,
    ]);
    await fs.writeFile(
      path.join(state.dir, "server.ext"),
      `subjectAltName=${require("node:net").isIP(publicHost) ? "IP" : "DNS"}:${publicHost},DNS:${name}-mqtt\nextendedKeyUsage=serverAuth\n`,
    );
    await run("openssl", [
      "x509",
      "-req",
      "-in",
      path.join(state.dir, "server.csr"),
      "-CA",
      caCert,
      "-CAkey",
      caKey,
      "-CAcreateserial",
      "-out",
      path.join(tlsDir, "server.crt"),
      "-days",
      "365",
      "-extfile",
      path.join(state.dir, "server.ext"),
    ]);
    await fs.chmod(caKey, 0o600);
    await fs.chmod(path.join(tlsDir, "server.key"), 0o600);
    await fs.chown(path.join(tlsDir, "server.key"), 1883, 1883);
  }
  const hostDir = path.join(hostStateRoot, tenant.uuid);
  await fs.mkdir(path.join(state.dir, "broker"), {
    recursive: true,
    mode: 0o750,
  });
  await docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "-v",
      hostDir + "/broker:/data",
      "--env",
      "BOOTSTRAP_PASSWORD",
      brokerImage,
      "sh",
      "-c",
      'if [ ! -s /data/dynamic-security.json ]; then mosquitto_ctrl dynsec init /data/dynamic-security.json adapter-admin "$BOOTSTRAP_PASSWORD"; fi; chown -R 1883:1883 /data',
    ],
    { BOOTSTRAP_PASSWORD: tenant.ingress_admin_password },
  );
  await fs.writeFile(
    path.join(state.dir, "mosquitto.conf"),
    `listener 8883\nallow_anonymous false\ncertfile /certs/server.crt\nkeyfile /certs/server.key\nplugin /usr/lib/mosquitto_dynamic_security.so\nplugin_opt_config_file /mosquitto/data/dynamic-security.json\npersistence true\npersistence_location /mosquitto/data/\nmessage_size_limit 1048576\nmax_queued_messages 1000\nmax_inflight_messages 20\n`,
  );
  await ensureContainer(name + "-mqtt", [
    "--network",
    network,
    "--memory",
    "128m",
    "--cpus",
    "0.5",
    "--security-opt",
    "no-new-privileges",
    "-p",
    `${process.env.IOT_ADAPTER_BIND_ADDRESS || "127.0.0.1"}:${tenant.listen_port}:8883`,
    "-v",
    hostDir + "/broker:/mosquitto/data",
    "-v",
    hostDir + "/tls:/certs:ro",
    "-v",
    hostDir + "/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro",
    brokerImage,
  ]);
  const ca = await fs.readFile(path.join(tlsDir, "ca.crt"), "utf8");
  const url = `mqtts://${name}-mqtt:8883`;
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      await control(url, ca, tenant.ingress_admin_password, [
        {
          command: "setDefaultACLAccess",
          acls: [
            { acltype: "publishClientSend", allow: false },
            { acltype: "publishClientReceive", allow: false },
            { acltype: "subscribe", allow: false },
            { acltype: "unsubscribe", allow: true },
          ],
        },
      ]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  ensure(ready, "Tenant broker did not become ready");
  await fs.mkdir(path.join(state.dir, "runtime"), {
    recursive: true,
    mode: 0o700,
  });
  await fs.chown(path.join(state.dir, "runtime"), 1000, 1000);
  await ensureContainer(
    name + "-runtime",
    [
      "--network",
      network,
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "-v",
      hostDir + "/runtime:/data",
      "-e",
      "IOT_NODE_RED_ADMIN_TOKEN",
      "-e",
      "IOT_NODE_RED_CREDENTIAL_SECRET",
      "-e",
      `IOT_ADAPTER_ALLOW_PRIVATE_BROKERS=${process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS || "false"}`,
      runtimeImage,
    ],
    {
      IOT_NODE_RED_ADMIN_TOKEN: state.adminToken,
      IOT_NODE_RED_CREDENTIAL_SECRET: state.credentialSecret,
    },
  );
  // Starting an existing container preserves its original administrator key and encryption key.
  return {
    state,
    name,
    ca,
    url,
    broker_url: `mqtts://${publicHost}:${tenant.listen_port}`,
  };
}
function topics(values) {
  ensure(
    Array.isArray(values) && values.length > 0 && values.length <= 32,
    "Choose 1 to 32 topic filters",
  );
  for (const topic of values)
    ensure(
      typeof topic === "string" &&
        topic.length <= 255 &&
        !topic.startsWith("$") &&
        !topic.startsWith("spBv1.0/") &&
        !/\0/.test(topic) &&
        topic !== "#" &&
        !topic.startsWith("+") &&
        !topic.includes("#/") &&
        (!topic.includes("#") || topic.endsWith("/#")),
      "Invalid or reserved MQTT topic",
    );
  return values;
}
async function provisionClient(
  tenant,
  username,
  password,
  filters,
  subscriber,
  context,
) {
  const ctx = context || await provisionTenant(tenant);
  ensure(
    /^(adapter|device)-[a-f0-9-]{36}$/.test(username) && password.length >= 32,
    "Invalid ingress credential",
  );
  const acls = topics(filters).flatMap((topic) =>
    subscriber
      ? [
          { acltype: "subscribeLiteral", topic, allow: true, priority: 0 },
          { acltype: "publishClientReceive", topic, allow: true, priority: 0 },
        ]
      : [{ acltype: "publishClientSend", topic, allow: true, priority: 0 }],
  );
  await control(ctx.url, ctx.ca, tenant.ingress_admin_password, [
    { command: "createRole", rolename: username },
    { command: "createClient", username },
    { command: "disableClient", username },
    { command: "modifyRole", rolename: username, acls },
    {
      command: "modifyClient",
      username,
      password,
      roles: [{ rolename: username, priority: 0 }],
      groups: [],
    },
    { command: "enableClient", username },
  ]);
  return ctx;
}
async function admin(ctx, method, url, body) {
  const response = await fetch(`http://${ctx.name}-runtime:1880${url}`, {
    method,
    headers: {
      Authorization: "Bearer " + ctx.state.adminToken,
      "Content-Type": "application/json",
      "Node-RED-API-Version": "v2",
      "Node-RED-Deployment-Type": "flows",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  ensure(response.ok, "Node-RED deployment failed");
  return response.status === 204 ? {} : response.json();
}
async function runtimeReady(ctx) {
  for (let i = 0; i < 30; i++) {
    try {
      return await admin(ctx, "GET", "/flows");
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw Error("Tenant Node-RED runtime did not become ready");
}
async function deploy(body) {
  const adapter = id(body.adapter_uuid);
  const ctx = await provisionTenant(body.tenant);
  const current = await runtimeReady(ctx);
  let source;
  if (body.source.type === "platform") {
    await provisionClient(
      body.tenant,
      "adapter-" + adapter,
      body.source.password,
      body.source.topics,
      true,
      ctx,
    );
    for (const hardware of body.hardware_credentials || []) {
      await provisionClient(body.tenant, hardware.username, hardware.password, body.source.topics, false, ctx);
    }
    source = {
      url: ctx.url,
      username: "adapter-" + adapter,
      password: body.source.password,
      ca_certificate: ctx.ca,
      topics: topics(body.source.topics),
      managed: true,
    };
  } else {
    source = {
      url: brokerUrl(
        body.source.url,
        process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true",
      ),
      username: body.source.username,
      password: body.source.password,
      ca_certificate: body.source.ca_certificate,
      topics: topics(body.source.topics),
      managed: false,
    };
  }
  const tab = "adapter-" + adapter;
  const nodeId = (kind) => tab + "-" + kind;
  if (body.action !== "pause") {
    id(body.revision_uuid);
    ensure(
      body.profile && Array.isArray(body.profile.parameters),
      "Profile required",
    );
  }
  const flows = replaceFlow(
    current.flows,
    body,
    flowNodes(
      body,
      source,
      body.upstream,
      process.env.IOT_ADAPTER_CALLBACK_URL,
    ),
  );
  await admin(ctx, "POST", "/flows", { rev: current.rev, flows });
  const applied = await admin(ctx, "GET", "/flows");
  ensure(
    body.action === "pause"
      ? !applied.flows.some((n) => n.id === tab)
      : applied.flows.some(
          (n) =>
            n.id === nodeId("publisher") &&
            n.revision_uuid === body.revision_uuid,
        ),
    "Applied revision mismatch",
  );
  return { applied: true, broker_url: ctx.broker_url, ca_certificate: ctx.ca };
}
async function connectionTest(source) {
  const url = brokerUrl(
    source.url,
    process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true",
  );
  topics(source.topics);
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      username: source.username,
      password: source.password,
      ca: source.ca_certificate || undefined,
      rejectUnauthorized: true,
      lookup:
        process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true"
          ? undefined
          : secureLookup,
      reconnectPeriod: 0,
      connectTimeout: 8000,
    });
    let complete = false;
    const timer = setTimeout(
      () => finish(Error("Could not connect to the vendor broker")),
      10000,
    );
    function finish(error) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      client.end(true);
      error ? reject(error) : resolve({ connected: true });
    }
    client.on("connect", () =>
      client.subscribe(source.topics, { qos: 1 }, (error, granted) =>
        finish(
          error || granted?.some((g) => g.qos === 128)
            ? Error("Broker rejected the topic subscription")
            : null,
        ),
      ),
    );
    client.on("error", () =>
      finish(Error("Broker authentication or TLS validation failed")),
    );
  });
}
async function handle(route, body) {
  if (route === "/test") {
    ensure(testsRunning < 4, "Decoder test capacity reached");
    testsRunning++;
    try {
      ensure(
        Array.isArray(body.fixtures) &&
          body.fixtures.length > 0 &&
          body.fixtures.length <= 10,
        "Provide 1 to 10 test fixtures",
      );
      const results = [];
      for (const fixture of body.fixtures) {
        try {
          const payload = fixture.payload_base64
            ? Buffer.from(fixture.payload_base64, "base64")
            : fixture.payload;
          const input = inputFromMessage(payload, fixture.topic || "sample");
          const output = validateOutput(
            await decode(body.code, input),
            body.profile,
          );
          const expected = fixture.expected;
          ensure(
            !expected ||
              (Array.isArray(expected) &&
                expected.length === output.metrics.length &&
                expected.every((e) =>
                  output.metrics.some(
                    (m) => m.name === e.name && Object.is(m.value, e.value),
                  ),
                )),
            "Output does not match expected metrics",
          );
          results.push({ passed: !fixture.expect_error, output });
        } catch (error) {
          results.push({
            passed: !!fixture.expect_error,
            error: String(error.message).slice(0, 300),
          });
        }
      }
      return {
        valid:
          results.every((r) => r.passed) &&
          results.some((r) => r.output && r.passed),
        results,
      };
    } finally {
      testsRunning--;
    }
  }
  if (route === "/connection-test") return connectionTest(body);
  if (route === "/provision")
    return provisionTenant(body.tenant).then((ctx) => ({
      broker_url: ctx.broker_url,
      ca_certificate: ctx.ca,
    }));
  if (route === "/credential") {
    const ctx = await provisionClient(
      body.tenant,
      body.username,
      body.password,
      body.topics,
      false,
    );
    return { broker_url: ctx.broker_url, ca_certificate: ctx.ca };
  }
  if (route === "/revoke") {
    const ctx = await provisionTenant(body.tenant);
    ensure(
      /^(adapter|device)-[a-f0-9-]{36}$/.test(body.username),
      "Invalid ingress identity",
    );
    await control(ctx.url, ctx.ca, body.tenant.ingress_admin_password, [
      { command: "disableClient", username: body.username },
    ]);
    return { revoked: true };
  }
  if (route === "/deploy") return deploy(body);
  throw Error("Unknown manager operation");
}
const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(token ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ready: !!token }));
  }
  const expected = Buffer.from("Bearer " + (token || ""));
  const received = Buffer.from(req.headers.authorization || "");
  if (
    !token ||
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    res.writeHead(401);
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  try {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      ensure(Buffer.byteLength(data) <= 8 * 1024 * 1024, "Request too large");
    }
    const body = JSON.parse(data);
    const key = body.tenant?.uuid;
    let result;
    if (key) {
      id(key);
      const previous = locks.get(key) || Promise.resolve();
      const job = previous.catch(() => {}).then(() => handle(req.url, body));
      locks.set(key, job);
      try {
        result = await job;
      } finally {
        if (locks.get(key) === job) locks.delete(key);
      }
    } else result = await handle(req.url, body);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(error.message).slice(0, 300) }));
  }
});
if (require.main === module) {
  ensure(
    token && token.length >= 32,
    "A manager bearer token of at least 32 characters is required",
  );
  server.listen(Number(process.env.PORT || 8090), "0.0.0.0");
}
module.exports = { topics, handle, server };
