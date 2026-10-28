const path = require("node:path");
const crypto = require("node:crypto");
const mqtt = require("mqtt");
const { decodeBatch, inputFromMessage } = require("../lib/decoder.cjs");
const sparkplug = require("../lib/sparkplug.cjs");
const { brokerUrl, secureLookup } = require("../lib/broker.cjs");
const { DedupLog, readJson, writeJson } = require("../lib/state.cjs");
const poll = require("../lib/poll.cjs");

const DAY = 24 * 60 * 60 * 1000;
const dataDir = () => process.env.IOT_ADAPTER_DATA_DIR || "/data";
const allowPrivate = () => process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

// A source hands one input (or one polled page) at a time to the decoder and waits
// until the publisher settles it: published and acknowledged, a duplicate, or a
// recorded failure. Only then does an MQTT source acknowledge the packet and read
// the next one, so a busy decoder holds the backlog upstream instead of dropping it
// (spec 020, FR-063). Node-RED passes messages between nodes, not callbacks, so the
// waiting sources live in this registry.
const waiting = new Map();
let sequence = 0;
function track(callback) {
  const id = ++sequence;
  waiting.set(id, callback);
  return id;
}
function settle(msg, summary) {
  const callback = waiting.get(msg?._settle);
  if (!callback) return;
  waiting.delete(msg._settle);
  callback({ published: 0, duplicates: 0, failed: 0, ...summary });
}

// Whether an adapter's publisher is connected to the platform broker.
const upstreams = new Map();
function upstream(adapter) {
  if (!upstreams.has(adapter)) upstreams.set(adapter, { online: false, waiters: new Set() });
  return upstreams.get(adapter);
}
function setOnline(adapter, online) {
  const state = upstream(adapter);
  state.online = online;
  if (online) for (const waiter of [...state.waiters]) waiter(true);
}
function whenOnline(adapter, timeoutMs) {
  const state = upstream(adapter);
  if (state.online) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      state.waiters.delete(done);
      resolve(value);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    state.waiters.add(done);
  });
}

// One tenant runtime serves one organization, so this bucket is the organization's
// polling request budget (FR-036).
const budget = { tokens: 60, at: Date.now() };
async function takeBudget() {
  const perMinute = Number(process.env.IOT_ADAPTER_POLL_REQUESTS_PER_MINUTE) || 60;
  for (;;) {
    const now = Date.now();
    budget.tokens = Math.min(perMinute, budget.tokens + ((now - budget.at) / 60000) * perMinute);
    budget.at = now;
    if (budget.tokens >= 1) {
      budget.tokens -= 1;
      return;
    }
    await delay(Math.ceil(((1 - budget.tokens) * 60000) / perMinute));
  }
}

// What the platform may keep of an input that failed: the fixture shape with a
// bounded excerpt, so the person can turn it into a test sample (FR-071).
function captured(input, limit = 16 * 1024) {
  const bytes = Buffer.from(input.payloadBase64 || "", "base64");
  return {
    topic: input.topic || "",
    payload_base64: bytes.subarray(0, limit).toString("base64"),
    ...(bytes.length > limit ? { truncated: true } : {}),
    source: input.source || "mqtt",
    received_at: input.receivedAt,
    ...(input.http ? { http: input.http } : {}),
    ...(input.poll ? { poll: input.poll } : {}),
  };
}

function webhookInput(packet) {
  const properties = packet.properties?.userProperties || {};
  const one = (name) => [].concat(properties[name] ?? "")[0];
  const json = (name) => {
    try {
      return JSON.parse(one(name) || "{}");
    } catch {
      return {};
    }
  };
  return inputFromMessage(packet.payload, one("path"), {
    source: "webhook",
    receivedAt: one("received_at"),
    qos: 1,
    retain: false,
    http: {
      method: one("method") || "POST",
      path: one("path"),
      query: json("query"),
      contentType: one("content_type") || null,
      headers: json("headers"),
      deliveryId: one("delivery_id") || null,
    },
  });
}

module.exports = function (RED) {
  function Source(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const source = { ...config.source, ...node.credentials };
    const health = (connected, extra = {}) =>
      node.send([
        null,
        { payload: { kind: "health", adapter_uuid: config.adapter_uuid, source_connected: connected, ...extra } },
      ]);
    if (source.type === "poll") return pollSource(node, config, source, health);
    mqttSource(node, config, source, health);
  }

  function mqttSource(node, config, source, health) {
    const adapter = config.adapter_uuid;
    const webhook = source.type === "webhook";
    const statusTopic = webhook ? `${source.topics[0]}/status` : null;
    let client = null;
    let closed = false;
    let paused = false;
    function connect() {
      if (closed) return;
      const managed = source.managed || allowPrivate();
      const current = mqtt.connect(brokerUrl(source.url, managed), {
        protocolVersion: webhook ? 5 : 4,
        clientId: `adapter-${adapter}`,
        username: source.username,
        password: source.password,
        ca: source.ca_certificate || undefined,
        lookup: managed ? undefined : secureLookup,
        rejectUnauthorized: true,
        clean: false,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        ...(webhook
          ? {
              // MQTT 5 ends a session on disconnect unless it has an expiry.
              properties: { sessionExpiryInterval: 7 * 24 * 3600 },
              will: { topic: statusTopic, payload: Buffer.from("offline"), qos: 1, retain: true },
            }
          : {}),
      });
      client = current;
      // mqtt.js sends the PUBACK and reads the next packet only after this
      // callback, so the broker keeps everything not yet settled.
      current.handleMessage = (packet, callback) => {
        receive(current, packet).then((ok) => {
          if (ok && client === current) callback();
        });
      };
      current.on("connect", () => {
        current.subscribe(source.topics, { qos: 1 }, (error, granted) => {
          error = error || granted?.some((g) => g.qos >= 128);
          if (!error && webhook) current.publish(statusTopic, "online", { qos: 1, retain: true });
          node.status({
            fill: error ? "red" : "green",
            shape: "dot",
            text: error ? "Subscription failed" : "Broker connected",
          });
          health(!error);
        });
      });
      current.on("error", () => node.status({ fill: "red", shape: "ring", text: "MQTT connection failed" }));
      current.on("offline", () => {
        node.status({ fill: "yellow", shape: "ring", text: "MQTT disconnected" });
        health(false);
      });
    }
    async function receive(current, packet) {
      // While the publisher cannot reach the platform broker, stop reading: the
      // source broker keeps the messages in this adapter's persistent session.
      if (!(await whenOnline(adapter, 20000))) {
        pause(current);
        return false;
      }
      let input;
      try {
        input = webhook ? webhookInput(packet) : inputFromMessage(packet.payload, packet.topic, packet);
      } catch {
        node.warn("Input message exceeds the adapter limit");
        return true;
      }
      await new Promise((resolve) => node.send([{ inputs: [input], _settle: track(resolve) }, null]));
      return client === current;
    }
    async function pause(current) {
      if (paused || closed || client !== current) return;
      paused = true;
      client = null;
      current.end(true);
      node.status({ fill: "yellow", shape: "ring", text: "Waiting for the platform broker" });
      health(false);
      while (!closed && !(await whenOnline(adapter, 3600000)));
      paused = false;
      connect();
    }
    connect();
    node.on("close", (_, done) => {
      closed = true;
      const current = client;
      client = null;
      if (!current) return done();
      if (webhook && current.connected)
        current.publish(statusTopic, "offline", { qos: 1, retain: true }, () => current.end(false, {}, done));
      else current.end(false, {}, done);
    });
  }

  // Polls the vendor API on a schedule and commits the cursor only after every
  // record of a page is settled (FR-030 to FR-040).
  function pollSource(node, config, source, health) {
    const adapter = config.adapter_uuid;
    const settings = config.source;
    const secrets = {
      api_key: source.api_key,
      token: source.token,
      username: source.username,
      password: source.password,
      ca_certificate: source.ca_certificate,
    };
    const file = path.join(dataDir(), `poll-${adapter}.json`);
    const deployed = config.cursor || {};
    let state = readJson(file, null);
    if (!state || (deployed.generation ?? 0) > (state.generation ?? 0)) {
      let value = deployed.value ?? null;
      if (value === null && deployed.start_at && settings.cursor.kind !== "token")
        value = poll.formatTime(Date.parse(deployed.start_at), settings.time_format);
      if (value === null && deployed.fallback !== undefined) value = deployed.fallback;
      state = { generation: deployed.generation ?? 0, cursor: value, kind: settings.cursor.kind, committed_at: null, run_id: null };
      writeJson(file, state);
    }
    const interval = (settings.interval_seconds || 300) * 1000;
    const maxPages = settings.page?.max_pages || 20;
    let timer;
    let closed = false;
    let running = false;
    let failures = 0;
    let stopped = null;
    function schedule(ms) {
      if (closed || stopped) return;
      timer = setTimeout(run, ms);
      return new Date(Date.now() + ms).toISOString();
    }
    function report(run) {
      node.send([null, { payload: { kind: "poll_run", adapter_uuid: adapter, revision_uuid: config.revision_uuid, ...run } }]);
    }
    async function run() {
      if (running || closed) return;
      running = true;
      const run = {
        run_id: crypto.randomUUID(),
        started_at: new Date().toISOString(),
        cursor_before: state.cursor === null ? null : String(state.cursor).slice(0, 512),
        pages: 0,
        records: 0,
        published: 0,
        failed: 0,
        duplicates: 0,
      };
      let outcome = "ok";
      let error = null;
      let status = null;
      let retryAfter;
      let more = false;
      try {
        let cursor = state.cursor;
        while (run.pages < maxPages && !closed) {
          await takeBudget();
          const page = await poll.fetchPage(settings, secrets, cursor, { allowPrivate: allowPrivate() });
          status = page.status ?? status;
          if (page.outcome !== "ok") {
            outcome = page.outcome === "retry" ? "retrying" : "stopped";
            error = poll.redact(page.error, secrets);
            retryAfter = page.retryAfter;
            break;
          }
          run.pages++;
          run.records += page.records.length;
          const receivedAt = new Date().toISOString();
          const inputs = [];
          page.records.forEach((record, index) => {
            try {
              inputs.push(
                inputFromMessage(Buffer.from(JSON.stringify(record)), "", {
                  source: "poll",
                  receivedAt,
                  poll: { page: run.pages, index, count: page.records.length, cursor: cursor === null ? null : String(cursor) },
                }),
              );
            } catch {
              run.failed++;
            }
          });
          if (inputs.length) {
            const summary = await new Promise((resolve) => node.send([{ inputs, _settle: track(resolve) }, null]));
            if (closed) return;
            run.published += summary.published;
            run.duplicates += summary.duplicates;
            run.failed += summary.failed;
          }
          const next = page.nextCursor ?? cursor;
          state = { ...state, cursor: next, kind: settings.cursor.kind, committed_at: new Date().toISOString(), run_id: run.run_id };
          writeJson(file, state);
          more = page.more;
          if (more && next === cursor) {
            outcome = "partial";
            error = "Cursor did not advance";
            more = false;
            break;
          }
          if (!more) break;
          cursor = next;
        }
      } catch {
        outcome = "retrying";
        error = "The poll run failed";
      }
      running = false;
      if (closed) return;
      if (outcome === "ok" && run.records === 0) outcome = "empty";
      let next;
      if (outcome === "stopped") {
        stopped = { reason: error };
        health(false, { source_state: "stopped" });
      } else if (outcome === "retrying") {
        failures++;
        next = schedule(retryAfter !== undefined ? Math.max(1000, retryAfter * 1000) : Math.min(interval * 2 ** (failures - 1), 3600000));
        health(true, { source_state: "retrying" });
      } else {
        failures = 0;
        next = schedule(more && run.pages >= maxPages ? 5000 : interval * (0.9 + 0.2 * Math.random()));
        health(true, { source_state: "polling" });
      }
      report({
        ...run,
        finished_at: new Date().toISOString(),
        outcome,
        http_status: status,
        cursor_after: state.cursor === null ? null : String(state.cursor).slice(0, 512),
        committed_at: state.committed_at,
        error,
        state: stopped ? "stopped" : outcome === "retrying" ? "retrying" : "polling",
        reason: stopped?.reason ?? null,
        next_attempt_at: next ?? null,
      });
    }
    node.status({ fill: "green", shape: "dot", text: "Polling" });
    health(true, { source_state: "polling" });
    schedule(Math.random() * 0.1 * interval);
    node.on("close", () => {
      closed = true;
      clearTimeout(timer);
    });
  }

  function Decoder(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    let chain = Promise.resolve();
    node.on("input", (msg, send, done) => {
      chain = chain.then(async () => {
        const inputs = msg.inputs || (msg.payload ? [msg.payload] : []);
        let decoded;
        try {
          decoded = await decodeBatch(config.code, inputs, config.profile, { concurrency: 2 });
        } catch {
          settle(msg, { failed: inputs.length });
          return done();
        }
        const { results, failures } = decoded;
        const counts = { decoded: results.length };
        for (const failure of failures) {
          counts[failure.reason] = (counts[failure.reason] || 0) + 1;
          const input = inputs[failure.input];
          send([
            null,
            {
              payload: {
                kind: "failure",
                adapter_uuid: config.adapter_uuid,
                report_id: crypto.randomUUID(),
                source: input.source || "mqtt",
                received_at: input.receivedAt,
                reason: failure.reason,
                error: failure.error,
                input: captured(input),
                ...(input.http?.deliveryId ? { delivery_id: input.http.deliveryId } : {}),
              },
            },
          ]);
        }
        send([null, { payload: { kind: "count", adapter_uuid: config.adapter_uuid, counts } }]);
        if (failures.length)
          node.status({ fill: "red", shape: "ring", text: "Decoder rejected a payload" });
        if (results.length) {
          send([{ ...msg, decoded: results, failed: failures.length }, null]);
          node.status({ fill: "green", shape: "dot", text: "Payload decoded" });
        } else settle(msg, { failed: failures.length });
        done();
      });
    });
  }

  function Publisher(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const adapter = config.adapter_uuid;
    let seq = 0;
    let closed = false;
    let chain = Promise.resolve();
    const sources = new Map();
    const dir = dataDir();
    const dedup = new DedupLog(path.join(dir, `dedup-${adapter}.log`));
    const observedFile = path.join(dir, `observed-${adapter}.json`);
    const newest = readJson(observedFile, {});
    const bdFile = path.join(dir, `bdseq-${adapter}.json`);
    let bdSeq = ((readJson(bdFile, { bdSeq: -1 }).bdSeq ?? -1) + 1) % 256;
    writeJson(bdFile, { bdSeq }, 0o644);
    const root = `spBv1.0/${config.upstream.group_id}`;
    const edge = config.upstream.edge_node_id;
    let bd = sparkplug.metric("bdSeq", "Int64", bdSeq);
    setOnline(adapter, false);
    const client = mqtt.connect(brokerUrl(config.upstream.url, true), {
      protocolVersion: 4,
      username: node.credentials.username,
      password: node.credentials.password,
      ca: node.credentials.ca_certificate || undefined,
      rejectUnauthorized: true,
      clean: true,
      clientId: `publisher-${adapter}`,
      reconnectPeriod: 3000,
      will: {
        topic: `${root}/NDEATH/${edge}`,
        payload: sparkplug.encode(0, [bd]),
        qos: 1,
        retain: false,
      },
    });
    client.on("reconnect", () => {
      bdSeq = (bdSeq + 1) % 256;
      bd = sparkplug.metric("bdSeq", "Int64", bdSeq);
      writeJson(bdFile, { bdSeq }, 0o644);
      client.options.will.payload = sparkplug.encode(0, [bd]);
    });
    const report = (payload) =>
      node.send({ payload: { ...payload, adapter_uuid: adapter, revision_uuid: config.revision_uuid } });
    function publish(kind, id, metrics) {
      if (!client.connected) return;
      client.publish(`${root}/${kind}/${edge}${id ? "/" + id : ""}`, sparkplug.encode(seq, metrics), { qos: 1, retain: false });
      seq = (seq + 1) % 256;
    }
    // Resolves once the platform broker acknowledged the message; retries across
    // reconnects instead of dropping it.
    async function deliver(kind, id, metrics) {
      for (;;) {
        while (!closed && !upstream(adapter).online) await whenOnline(adapter, 3600000);
        if (closed) throw Error("Publisher closed");
        const ok = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 15000);
          client.publish(`${root}/${kind}/${edge}/${id}`, sparkplug.encode(seq, metrics), { qos: 1, retain: false }, (error) => {
            clearTimeout(timer);
            resolve(!error);
          });
          seq = (seq + 1) % 256;
        });
        if (ok) return;
        await delay(1000);
      }
    }
    function birth() {
      seq = 0;
      publish("NBIRTH", null, [bd, sparkplug.metric("Node Control/Rebirth", "Boolean", false)]);
      for (const [id, entry] of sources) publish("DBIRTH", id, entry.metrics);
    }
    client.on("connect", () => {
      client.subscribe([`${root}/NCMD/${edge}`, `spBv1.0/STATE/${config.upstream.host_id}`], { qos: 1 });
      birth();
      setOnline(adapter, true);
      report({ kind: "health", upstream_connected: true });
    });
    client.on("message", (topic, payload) => {
      try {
        if (topic.includes("/NCMD/")) {
          const command = sparkplug.Payload.decode(payload);
          if (command.metrics.some((m) => m.name === "Node Control/Rebirth" && m.booleanValue)) birth();
        } else if (JSON.parse(payload.toString()).online === true) birth();
      } catch {}
    });
    client.on("offline", () => {
      setOnline(adapter, false);
      report({ kind: "health", upstream_connected: false });
    });
    client.on("error", () => node.status({ fill: "red", shape: "ring", text: "Platform publisher disconnected" }));

    async function publishResult(decoded, input, summary) {
      const id = "src-" + hash(decoded.sourceDeviceId).slice(0, 32);
      const binding = (config.bindings || []).find((b) => b.source_device_id === decoded.sourceDeviceId);
      const provenance = binding
        ? { installation_uuid: binding.installation_uuid, adapter_revision_uuid: config.revision_uuid }
        : undefined;
      // Without observedAt the reading is receipt-timed: Sparkplug still needs a
      // timestamp, so the property tells the runtime it is the receipt (FR-050).
      const receipt = !decoded.observedAt;
      const timestamp = receipt ? Date.parse(input.receivedAt) : Date.parse(decoded.observedAt);
      if (!receipt && config.retention_days && timestamp < Date.now() - config.retention_days * DAY) {
        summary.failed++;
        report({
          kind: "failure",
          report_id: crypto.randomUUID(),
          source: input.source || "mqtt",
          received_at: input.receivedAt,
          reason: "validation_failed",
          error: "The observation is older than the organization's telemetry retention",
          input: captured(input),
        });
        return;
      }
      const key = decoded.messageId ? DedupLog.key(decoded.sourceDeviceId, decoded.messageId) : null;
      if (key && dedup.has(key)) {
        summary.duplicates++;
        report({ kind: "count", counts: { duplicate: 1 } });
        return;
      }
      // Older than what this source already published: history, not the latest
      // value (FR-053).
      const historical = newest[id] !== undefined && timestamp < newest[id];
      if (!historical) newest[id] = timestamp;
      if (historical) report({ kind: "count", counts: { historical: 1 } });
      const options = { historical, receipt };
      const metrics = decoded.metrics.map((m) => sparkplug.metric(m.name, m.datatype, m.value, timestamp, provenance, options));
      const { input: _index, ...preview } = decoded;
      report({
        kind: "sample",
        source_device_id: decoded.sourceDeviceId,
        sparkplug_device_id: id,
        preview,
        retained: input.retained,
        received_at: input.receivedAt,
      });
      // Retained data remains preview evidence and must not create live readings.
      if (input.retained) return;
      const previous = sources.get(id);
      if (sources.size >= 1000 && !previous) {
        report({ kind: "diagnostic", message: "Adapter discovery capacity reached" });
        summary.failed++;
        return;
      }
      const accumulated = new Map((previous?.metrics || []).map((m) => [m.name, m]));
      for (const [index, metric] of metrics.entries())
        if (!historical || !accumulated.has(metric.name))
          accumulated.set(
            metric.name,
            sparkplug.metric(decoded.metrics[index].name, decoded.metrics[index].datatype, decoded.metrics[index].value, timestamp, provenance, { receipt }),
          );
      const birthMetrics = [...accumulated.values()];
      const names = JSON.stringify(birthMetrics.map((m) => [m.name, m.datatype]).sort((a, b) => a[0].localeCompare(b[0])));
      sources.set(id, { metrics: birthMetrics, names });
      if (!previous || previous.names !== names) await deliver("DBIRTH", id, birthMetrics);
      if (binding) await deliver("DDATA", id, metrics);
      // Only stored readings count as seen: previews of a source that is not activated
      // yet can be fetched again and stored once it is (for example after a cursor reset).
      if (key && binding) dedup.add(key);
      summary.published++;
      node.status({
        fill: "green",
        shape: "dot",
        text: binding ? "Publishing activated device" : "Previewing discovered device",
      });
    }

    node.on("input", (msg, send, done) => {
      chain = chain.then(async () => {
        const summary = { published: 0, duplicates: 0, failed: msg.failed || 0 };
        const inputs = msg.inputs || (msg.payload ? [msg.payload] : []);
        try {
          for (const decoded of msg.decoded || []) await publishResult(decoded, inputs[decoded.input ?? 0] || inputs[0], summary);
          writeJson(observedFile, newest);
        } catch {
          if (closed) return done();
          report({ kind: "diagnostic", message: "Managed publisher rejected a message" });
        }
        settle(msg, summary);
        done();
      });
    });
    node.on("close", (_, done) => {
      closed = true;
      setOnline(adapter, false);
      if (client.connected) publish("NDEATH", null, [bd]);
      client.end(false, {}, done);
    });
  }

  function Reporter(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const last = new Map();
    let pending = 0;
    const health = { source_connected: false, upstream_connected: false };
    let counts = {};
    let reliable = [];
    async function post(payload) {
      const response = await fetch(config.callback_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${node.credentials.runtime_token}`,
          "X-Adapter-Tenant": config.tenant_uuid,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok && response.status !== 422) throw Error("Platform callback rejected the event");
    }
    // Run reports and outcome counts carry their own identifiers, so they are kept and
    // retried until the platform accepts them.
    async function drain() {
      while (reliable.length) {
        try {
          await post(reliable[0]);
          reliable.shift();
        } catch {
          node.status({ fill: "yellow", shape: "ring", text: "Platform callback unavailable" });
          return;
        }
      }
    }
    function flushCounts() {
      if (!Object.keys(counts).length) return;
      const hour = new Date();
      hour.setUTCMinutes(0, 0, 0);
      reliable.push({ kind: "outcomes", adapter_uuid: config.adapter_uuid, report_id: crypto.randomUUID(), bucket: hour.toISOString(), counts });
      counts = {};
      reliable = reliable.slice(-100);
      drain();
    }
    const timers = [
      setInterval(() => node.receive({ payload: { kind: "health", adapter_uuid: config.adapter_uuid, ...health } }), 10000),
      setInterval(flushCounts, 60000),
      setInterval(drain, 10000),
    ];
    node.on("close", () => {
      timers.forEach(clearInterval);
      flushCounts();
    });
    node.on("input", async (msg, send, done) => {
      const p = msg.payload;
      if (p.kind === "count") {
        for (const [name, n] of Object.entries(p.counts || {})) if (n) counts[name] = (counts[name] || 0) + n;
        return done();
      }
      if (p.kind === "poll_run") {
        reliable.push(p);
        reliable = reliable.slice(-100);
        await drain();
        return done();
      }
      if (p.kind === "health") {
        if (typeof p.source_connected === "boolean") health.source_connected = p.source_connected;
        if (typeof p.upstream_connected === "boolean") health.upstream_connected = p.upstream_connected;
        if (p.source_state) health.source_state = p.source_state;
      }
      const key =
        p.kind === "failure"
          ? "failure"
          : p.kind + ":" + (p.source_device_id || ("source_connected" in p ? "source" : "upstream"));
      if (Date.now() - (last.get(key) || 0) < 2000 || pending >= 4) return done();
      last.set(key, Date.now());
      pending++;
      try {
        await post(p);
      } catch {
        node.status({ fill: "yellow", shape: "ring", text: "Platform callback unavailable" });
      } finally {
        pending--;
        done();
      }
    });
  }
  const connectionCredentials = {
    username: { type: "text" },
    password: { type: "password" },
    ca_certificate: { type: "password" },
  };
  RED.nodes.registerType("iot-adapter-source", Source, {
    credentials: { ...connectionCredentials, api_key: { type: "password" }, token: { type: "password" } },
  });
  RED.nodes.registerType("iot-adapter-decoder", Decoder);
  RED.nodes.registerType("iot-adapter-publisher", Publisher, {
    credentials: connectionCredentials,
  });
  RED.nodes.registerType("iot-adapter-reporter", Reporter, {
    credentials: { runtime_token: { type: "password" } },
  });
};
