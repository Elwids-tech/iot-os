const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mqtt = require("mqtt");
const {
  decode,
  inputFromMessage,
  validateOutput,
} = require("../lib/decoder.cjs");
const sparkplug = require("../lib/sparkplug.cjs");
const { brokerUrl, secureLookup } = require("../lib/broker.cjs");

module.exports = function (RED) {
  function Source(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const source = { ...config.source, ...node.credentials };
    const client = mqtt.connect(
      brokerUrl(
        source.url,
        source.managed ||
          process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true",
      ),
      {
        protocolVersion: 4,
        clientId: `adapter-${config.adapter_uuid}`,
        username: source.username,
        password: source.password,
        ca: source.ca_certificate || undefined,
        lookup:
          source.managed ||
          process.env.IOT_ADAPTER_ALLOW_PRIVATE_BROKERS === "true"
            ? undefined
            : secureLookup,
        rejectUnauthorized: true,
        clean: false,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
      },
    );
    client.on("connect", () =>
      client.subscribe(source.topics, { qos: 1 }, (error, granted) => {
        error = error || granted?.some((g) => g.qos === 128);
        node.status({
          fill: error ? "red" : "green",
          shape: "dot",
          text: error ? "Subscription failed" : "Broker connected",
        });
        node.send([
          null,
          {
            payload: {
              kind: "health",
              adapter_uuid: config.adapter_uuid,
              source_connected: !error,
            },
          },
        ]);
      }),
    );
    client.on("error", () =>
      node.status({
        fill: "red",
        shape: "ring",
        text: "MQTT connection failed",
      }),
    );
    client.on("offline", () => {
      node.status({ fill: "yellow", shape: "ring", text: "MQTT disconnected" });
      node.send([
        null,
        {
          payload: {
            kind: "health",
            adapter_uuid: config.adapter_uuid,
            source_connected: false,
          },
        },
      ]);
    });
    client.on("message", (topic, payload, packet) => {
      try {
        node.send({ payload: inputFromMessage(payload, topic, packet) });
      } catch {
        node.warn("Input message exceeds the adapter limit");
      }
    });
    node.on("close", (_, done) => client.end(false, {}, done));
  }
  function Decoder(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    let stopped = false;
    let queue = [];
    let processing = false;
    async function drain() {
      if (processing || stopped) return;
      processing = true;
      while (queue.length && !stopped) {
        const { msg, send, done } = queue.shift();
        try {
          const output = validateOutput(
            await decode(config.code, msg.payload),
            config.profile,
          );
          send({ ...msg, decoded: output });
          done();
          node.status({ fill: "green", shape: "dot", text: "Payload decoded" });
        } catch (error) {
          node.send([
            null,
            {
              payload: {
                kind: "diagnostic",
                adapter_uuid: config.adapter_uuid,
                message: "Payload failed decoder or profile validation",
                detail: String(error.message).slice(0, 300),
              },
            },
          ]);
          done();
          node.status({
            fill: "red",
            shape: "ring",
            text: "Decoder rejected payload",
          });
        }
      }
      processing = false;
    }
    node.on("input", (msg, send, done) => {
      if (queue.length >= 32) {
        done();
        node.status({ fill: "red", shape: "ring", text: "Decoder queue full" });
        return;
      }
      queue.push({ msg, send, done });
      drain();
    });
    node.on("close", () => {
      stopped = true;
      queue.forEach((item) => item.done());
      queue = [];
    });
  }
  function Publisher(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    let seq = 0;
    let online = false;
    let closed = false;
    const sources = new Map();
    const messageIds = new Map();
    const bdFile = path.join(
      process.env.IOT_ADAPTER_DATA_DIR || "/data",
      `bdseq-${config.adapter_uuid}.json`,
    );
    let bdSeq = 0;
    try {
      bdSeq = (JSON.parse(fs.readFileSync(bdFile)).bdSeq + 1) % 256;
    } catch {}
    fs.writeFileSync(`${bdFile}.tmp`, JSON.stringify({ bdSeq }));
    fs.renameSync(`${bdFile}.tmp`, bdFile);
    const root = `spBv1.0/${config.upstream.group_id}`;
    const edge = config.upstream.edge_node_id;
    let bd = sparkplug.metric("bdSeq", "Int64", bdSeq);
    const client = mqtt.connect(brokerUrl(config.upstream.url, true), {
      protocolVersion: 4,
      username: node.credentials.username,
      password: node.credentials.password,
      ca: node.credentials.ca_certificate || undefined,
      rejectUnauthorized: true,
      clean: true,
      clientId: `publisher-${config.adapter_uuid}`,
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
      fs.writeFileSync(`${bdFile}.tmp`, JSON.stringify({ bdSeq }));
      fs.renameSync(`${bdFile}.tmp`, bdFile);
      client.options.will.payload = sparkplug.encode(0, [bd]);
    });
    const report = (payload) =>
      node.send({
        payload: {
          ...payload,
          adapter_uuid: config.adapter_uuid,
          revision_uuid: config.revision_uuid,
        },
      });
    function publish(kind, id, metrics) {
      if (!client.connected) return;
      client.publish(
        `${root}/${kind}/${edge}${id ? "/" + id : ""}`,
        sparkplug.encode(seq, metrics),
        { qos: 1, retain: false },
      );
      seq = (seq + 1) % 256;
    }
    function birth() {
      seq = 0;
      publish("NBIRTH", null, [
        bd,
        sparkplug.metric("Node Control/Rebirth", "Boolean", false),
      ]);
      for (const [id, entry] of sources) publish("DBIRTH", id, entry.metrics);
    }
    client.on("connect", () => {
      client.subscribe(
        [`${root}/NCMD/${edge}`, `spBv1.0/STATE/${config.upstream.host_id}`],
        { qos: 1 },
      );
      online = true;
      birth();
      report({ kind: "health", upstream_connected: true });
    });
    client.on("message", (topic, payload) => {
      try {
        if (topic.includes("/NCMD/")) {
          const command = sparkplug.Payload.decode(payload);
          if (
            command.metrics.some(
              (m) => m.name === "Node Control/Rebirth" && m.booleanValue,
            )
          )
            birth();
        } else if (JSON.parse(payload.toString()).online === true) birth();
      } catch {}
    });
    client.on("offline", () => {
      online = false;
      report({ kind: "health", upstream_connected: false });
    });
    client.on("error", () =>
      node.status({
        fill: "red",
        shape: "ring",
        text: "Platform publisher disconnected",
      }),
    );
    node.on("input", (msg, send, done) => {
      try {
        const decoded = msg.decoded;
        if (!decoded) return done();
        const id =
          "src-" +
          crypto
            .createHash("sha256")
            .update(decoded.sourceDeviceId)
            .digest("hex")
            .slice(0, 32);
        const binding = (config.bindings || []).find(
          (b) => b.source_device_id === decoded.sourceDeviceId,
        );
        const provenance = binding
          ? {
              installation_uuid: binding.installation_uuid,
              adapter_revision_uuid: config.revision_uuid,
            }
          : undefined;
        const timestamp = decoded.observedAt
          ? Date.parse(decoded.observedAt)
          : Date.parse(msg.payload.receivedAt);
        const metrics = decoded.metrics.map((m) =>
          sparkplug.metric(m.name, m.datatype, m.value, timestamp, provenance),
        );
        report({
          kind: "sample",
          source_device_id: decoded.sourceDeviceId,
          sparkplug_device_id: id,
          preview: decoded,
          retained: msg.payload.retained,
          received_at: msg.payload.receivedAt,
        });
        // Retained data remains preview evidence and must not create live readings.
        if (msg.payload.retained || !online) return done();
        if (decoded.messageId) {
          const key = decoded.sourceDeviceId + "\0" + decoded.messageId;
          if (messageIds.has(key)) return done();
          messageIds.set(key, Date.now());
          if (messageIds.size > 10000)
            messageIds.delete(messageIds.keys().next().value);
        }
        const previous = sources.get(id);
        const accumulated = new Map(
          (previous?.metrics || []).map((m) => [m.name, m]),
        );
        for (const metric of metrics) accumulated.set(metric.name, metric);
        const birthMetrics = [...accumulated.values()];
        const names = JSON.stringify(
          birthMetrics
            .map((m) => [m.name, m.datatype])
            .sort((a, b) => a[0].localeCompare(b[0])),
        );
        if (sources.size >= 1000 && !previous) {
          report({
            kind: "diagnostic",
            message: "Adapter discovery capacity reached",
          });
          return done();
        }
        sources.set(id, { metrics: birthMetrics, names });
        if (!previous || previous.names !== names)
          publish("DBIRTH", id, birthMetrics);
        if (binding) publish("DDATA", id, metrics);
        node.status({
          fill: "green",
          shape: "dot",
          text: binding
            ? "Publishing activated device"
            : "Previewing discovered device",
        });
        done();
      } catch {
        report({
          kind: "diagnostic",
          message: "Managed publisher rejected a message",
        });
        done();
      }
    });
    node.on("close", (_, done) => {
      closed = true;
      if (client.connected) publish("NDEATH", null, [bd]);
      client.end(false, {}, done);
    });
  }
  function Reporter(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    let last = new Map();
    let pending = 0;
    const health = { source_connected: false, upstream_connected: false };
    const heartbeat = setInterval(
      () =>
        node.receive({
          payload: {
            kind: "health",
            adapter_uuid: config.adapter_uuid,
            ...health,
          },
        }),
      10000,
    );
    node.on("close", () => clearInterval(heartbeat));
    node.on("input", async (msg, send, done) => {
      const p = msg.payload;
      if (p.kind === "health") {
        if (typeof p.source_connected === "boolean")
          health.source_connected = p.source_connected;
        if (typeof p.upstream_connected === "boolean")
          health.upstream_connected = p.upstream_connected;
      }
      const key =
        p.kind +
        ":" +
        (p.source_device_id ||
          ("source_connected" in p ? "source" : "upstream"));
      if (Date.now() - (last.get(key) || 0) < 2000 || pending >= 4)
        return done();
      last.set(key, Date.now());
      pending++;
      try {
        const response = await fetch(config.callback_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${node.credentials.runtime_token}`,
            "X-Adapter-Tenant": config.tenant_uuid,
          },
          body: JSON.stringify(p),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error("Platform callback rejected the event");
      } catch {
        node.status({
          fill: "yellow",
          shape: "ring",
          text: "Platform callback unavailable",
        });
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
    credentials: connectionCredentials,
  });
  RED.nodes.registerType("iot-adapter-decoder", Decoder);
  RED.nodes.registerType("iot-adapter-publisher", Publisher, {
    credentials: connectionCredentials,
  });
  RED.nodes.registerType("iot-adapter-reporter", Reporter, {
    credentials: { runtime_token: { type: "password" } },
  });
};
