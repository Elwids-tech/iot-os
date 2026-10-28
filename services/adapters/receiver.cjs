// Webhook receiver (ADR-022, spec 020): checks a delivery's size, limits and secret,
// then hands it to the adapter's tenant ingress broker with MQTT 5 at QoS 1. It
// holds no Docker access and no database credentials; its routing table is a file
// adapter-manager writes.
const http = require("node:http");
const net = require("node:net");
const zlib = require("node:zlib");
const fs = require("node:fs");
const crypto = require("node:crypto");
const mqtt = require("mqtt");
const {
  Buckets,
  FailureLimiter,
  authenticate,
  decoderHeaders,
  parsePath,
} = require("./lib/webhook.cjs");

const MAX_BODY = 1024 * 1024;
const SAMPLE_BYTES = 64 * 1024;
const env = (name, fallback) => process.env[name] ?? fallback;
const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function createReceiver(options = {}) {
  const config = {
    routesFile: options.routesFile ?? env("IOT_WEBHOOK_ROUTES_FILE", "/routes/routes.json"),
    reportUrl: options.reportUrl ?? env("IOT_WEBHOOK_REPORT_URL", "http://api:8000/api/internal/adapters/receiver-reports"),
    reportToken: options.reportToken ?? env("IOT_WEBHOOK_RECEIVER_TOKEN", ""),
    trusted: options.trustedProxies ?? env("IOT_WEBHOOK_TRUSTED_PROXIES", "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128"),
    adapterRate: options.adapterRate ?? number("IOT_WEBHOOK_ADAPTER_RATE", 10),
    adapterBurst: options.adapterBurst ?? number("IOT_WEBHOOK_ADAPTER_BURST", 100),
    organizationRate: options.organizationRate ?? number("IOT_WEBHOOK_ORGANIZATION_RATE", 50),
    authFailures: options.authFailures ?? number("IOT_WEBHOOK_AUTH_FAILURES", 30),
    backlogMessages: options.backlogMessages ?? number("IOT_WEBHOOK_OFFLINE_BACKLOG", 500),
    backlogBytes: options.backlogBytes ?? number("IOT_WEBHOOK_OFFLINE_BACKLOG_BYTES", 32 * 1024 * 1024),
    publishTimeoutMs: options.publishTimeoutMs ?? 5000,
    connectWaitMs: options.connectWaitMs ?? 3000,
    reportEveryMs: options.reportEveryMs ?? 10000,
    reloadEveryMs: options.reloadEveryMs ?? 1000,
    now: options.now ?? Date.now,
    connect: options.connect ?? mqtt.connect,
  };
  const trusted = new net.BlockList();
  for (const cidr of config.trusted.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [address, prefix] = cidr.split("/");
    const type = net.isIP(address) === 6 ? "ipv6" : "ipv4";
    trusted.addSubnet(address, Number(prefix ?? (type === "ipv6" ? 128 : 32)), type);
  }
  let routes = {};
  let routesMtime = 0;
  const brokers = new Map();
  const adapterLimits = new Buckets(config.adapterRate, config.adapterBurst, config.now);
  const organizationLimits = new Buckets(config.organizationRate, config.organizationRate * 2, config.now);
  const failures = new FailureLimiter(config.authFailures, 5 * 60 * 1000, config.now);
  const metrics = { deliveries: {}, handoff: [], unknown: 0 };
  let pending = new Map();
  let inflight = null;

  function reload() {
    try {
      const stat = fs.statSync(config.routesFile);
      if (stat.mtimeMs === routesMtime) return;
      const parsed = JSON.parse(fs.readFileSync(config.routesFile, "utf8"));
      if (parsed.schema_version !== "webhook-routes.v1") return;
      routes = parsed.routes || {};
      routesMtime = stat.mtimeMs;
      for (const [adapter, broker] of brokers) {
        const route = Object.values(routes).find((r) => r.adapter_uuid === adapter);
        if (!route || route.state !== "running" || fingerprint(route) !== broker.fingerprint) {
          broker.client.end(true);
          brokers.delete(adapter);
        }
      }
    } catch {}
  }

  const fingerprint = (route) => JSON.stringify([route.broker, route.topic]);

  function report(adapter) {
    if (!pending.has(adapter))
      pending.set(adapter, { adapter_uuid: adapter, outcomes: {}, secrets_used: {}, rejections: [], samples: [] });
    return pending.get(adapter);
  }

  function count(route, outcome) {
    metrics.deliveries[outcome] = (metrics.deliveries[outcome] || 0) + 1;
    if (!route) return;
    const entry = report(route.adapter_uuid);
    entry.outcomes[outcome] = (entry.outcomes[outcome] || 0) + 1;
  }

  function reject(route, outcome, details) {
    count(route, outcome);
    if (!route) return;
    const entry = report(route.adapter_uuid);
    if (entry.rejections.length < 20)
      entry.rejections.push({ at: new Date(config.now()).toISOString(), reason: outcome, ...details, path: String(details.path ?? "").slice(0, 512) });
  }

  // A broker connection per adapter, publishing as that adapter's receiver identity
  // and following the runtime's retained online/offline status.
  function broker(route) {
    const existing = brokers.get(route.adapter_uuid);
    if (existing) {
      existing.lastUsed = config.now();
      return existing;
    }
    const state = {
      fingerprint: fingerprint(route),
      online: false,
      backlog: 0,
      backlogBytes: 0,
      lastUsed: config.now(),
      reasons: new Map(),
    };
    state.client = config.connect(route.broker.url, {
      protocolVersion: 5,
      clientId: `webhook-${route.adapter_uuid}-${crypto.randomBytes(4).toString("hex")}`,
      username: route.broker.username,
      password: route.broker.password,
      ca: route.broker.ca || undefined,
      rejectUnauthorized: true,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
    });
    state.client.on("connect", () => state.client.subscribe(route.status_topic, { qos: 1 }));
    state.client.on("message", (topic, payload) => {
      if (topic !== route.status_topic) return;
      const online = payload.toString() === "online";
      if (online) {
        state.backlog = 0;
        state.backlogBytes = 0;
      }
      state.online = online;
    });
    state.client.on("packetreceive", (packet) => {
      if (packet.cmd === "puback") state.reasons.set(packet.messageId, packet.reasonCode || 0);
    });
    state.client.on("error", () => {});
    brokers.set(route.adapter_uuid, state);
    return state;
  }

  // A new or reconnecting broker connection gets a moment before the delivery is
  // refused, so the first delivery after a deployment is not answered 503.
  function connected(state, ms) {
    if (state.client.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        state.client.removeListener("connect", onConnect);
        resolve(value);
      };
      const onConnect = () => done(true);
      const timer = setTimeout(() => done(state.client.connected), ms);
      state.client.on("connect", onConnect);
    });
  }

  async function publish(route, body, properties) {
    const state = broker(route);
    if (!state.online && (state.backlog >= config.backlogMessages || state.backlogBytes + body.length > config.backlogBytes))
      return "backlog";
    if (!(await connected(state, config.connectWaitMs))) return "unavailable";
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish("unavailable"), config.publishTimeoutMs);
      state.client.publish(route.topic, body, { qos: 1, retain: false, properties: { userProperties: properties } }, (error, packet) => {
        if (error) return finish("unavailable");
        const reason = state.reasons.get(packet?.messageId);
        state.reasons.delete(packet?.messageId);
        if (reason === 16) return finish("unavailable");
        if (!state.online) {
          state.backlog++;
          state.backlogBytes += body.length;
        }
        finish("accepted");
      });
    });
  }

  function address(req) {
    const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    const isTrusted = (ip) => net.isIP(ip) && trusted.check(ip, net.isIP(ip) === 6 ? "ipv6" : "ipv4");
    if (!isTrusted(remote)) return remote;
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim().replace(/^::ffff:/, ""))
      .filter((s) => net.isIP(s));
    for (let i = forwarded.length - 1; i >= 0; i--) if (!isTrusted(forwarded[i])) return forwarded[i];
    return forwarded[0] || remote;
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          failed = true;
          req.pause();
          resolve({ tooLarge: true });
          return;
        }
        if (!failed) chunks.push(chunk);
      });
      req.on("end", () => {
        if (failed) return;
        const raw = Buffer.concat(chunks);
        const encoding = String(req.headers["content-encoding"] || "identity").toLowerCase();
        if (encoding === "identity") return resolve({ body: raw });
        const inflate = { gzip: zlib.gunzipSync, "x-gzip": zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync }[encoding];
        if (!inflate) return resolve({ bad: true });
        try {
          resolve({ body: inflate(raw, { maxOutputLength: MAX_BODY }) });
        } catch (error) {
          resolve(error.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|Cannot create a Buffer/.test(error.message) ? { tooLarge: true } : { bad: true });
        }
      });
      req.on("error", () => resolve({ bad: true }));
    });
  }

  function answer(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(body === undefined ? "" : JSON.stringify(body));
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://receiver");
    if (url.pathname === "/health" && req.method === "GET") return answer(res, 200, { ready: true });
    const parsed = parsePath(url.pathname);
    const route = parsed && Object.prototype.hasOwnProperty.call(routes, parsed.id) ? routes[parsed.id] : null;
    if (!route) {
      metrics.unknown++;
      req.resume();
      return answer(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST") {
      req.resume();
      count(route, "bad_request");
      return answer(res, 405, { error: "Use POST" }, { Allow: "POST" });
    }
    const from = address(req);
    if (failures.banned(from)) {
      req.resume();
      reject(route, "rate_limited", { address: from, path: "", size: 0, content_type: null });
      return answer(res, 429, { error: "Too many requests" }, { "Retry-After": String(failures.retryAfter(from)) });
    }
    const received = new Date(config.now()).toISOString();
    const read = await readBody(req);
    const contentType = String(req.headers["content-type"] || "").slice(0, 255) || null;
    if (read.tooLarge) {
      reject(route, "too_large", { address: from, path: "", size: MAX_BODY + 1, content_type: contentType });
      return answer(res, 413, { error: "Payload too large" }, { Connection: "close" });
    }
    if (read.bad) {
      reject(route, "bad_request", { address: from, path: "", size: 0, content_type: contentType });
      return answer(res, 400, { error: "Bad request" });
    }
    const body = read.body;
    const auth = authenticate(route, { headers: req.headers, body, segments: parsed.segments, now: config.now() });
    const path = "/" + (auth.segments || (route.auth?.mode === "url" ? parsed.segments.slice(1) : parsed.segments)).join("/");
    if (!auth.ok) {
      failures.fail(from);
      reject(route, auth.reason, { address: from, path: path === "/" ? "" : path, size: body.length, content_type: contentType });
      return answer(res, 401, { error: "Unauthorized" });
    }
    report(route.adapter_uuid).secrets_used[auth.secret.uuid] = received;
    if (route.state === "paused") {
      reject(route, "paused", { address: from, path, size: body.length, content_type: contentType });
      return answer(res, 503, { error: "Unavailable" }, { "Retry-After": "60" });
    }
    for (const [limits, key] of [[adapterLimits, route.adapter_uuid], [organizationLimits, route.tenant_uuid]]) {
      const limit = limits.take(key);
      if (!limit.ok) {
        reject(route, "rate_limited", { address: from, path, size: body.length, content_type: contentType });
        return answer(res, 429, { error: "Too many requests" }, { "Retry-After": String(limit.retryAfter) });
      }
    }
    const deliveryId = crypto.randomUUID();
    const query = {};
    for (const [name, value] of url.searchParams) query[name] = name in query ? [].concat(query[name], value) : value;
    const headers = decoderHeaders(req.headers, route.auth);
    const subPath = path === "/" ? "" : path;
    if (route.state === "sampling") {
      count(route, "accepted");
      const entry = report(route.adapter_uuid);
      if (entry.samples.length < 20)
        entry.samples.push({ at: received, delivery_id: deliveryId, path: subPath.slice(0, 512), query, content_type: contentType, headers, size: body.length, body_base64: body.subarray(0, SAMPLE_BYTES).toString("base64") });
      return answer(res, 202, { delivery_id: deliveryId });
    }
    const started = process.hrtime.bigint();
    const result = await publish(route, body, {
      delivery_id: deliveryId,
      received_at: received,
      method: "POST",
      path: subPath,
      query: JSON.stringify(query),
      content_type: contentType || "",
      headers: JSON.stringify(headers),
    });
    if (result === "accepted") {
      metrics.handoff.push(Number(process.hrtime.bigint() - started) / 1e9);
      if (metrics.handoff.length > 10000) metrics.handoff.splice(0, 5000);
      count(route, "accepted");
      return answer(res, 202, { delivery_id: deliveryId });
    }
    reject(route, "broker_unavailable", { address: from, path, size: body.length, content_type: contentType });
    return answer(res, 503, { error: "Unavailable" }, { "Retry-After": "30" });
  }

  // A report keeps its id until the API accepts it, so a lost acknowledgement never
  // counts twice; newer outcomes wait for the next report.
  let sending = false;
  async function flush() {
    if (sending || !config.reportToken) return;
    if (!inflight && pending.size) {
      inflight = { schema_version: "receiver-report.v1", report_id: crypto.randomUUID(), reports: [...pending.values()] };
      pending = new Map();
    }
    if (!inflight) return;
    sending = true;
    try {
      const response = await fetch(config.reportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.reportToken}` },
        body: JSON.stringify(inflight),
        signal: AbortSignal.timeout(10000),
      });
      // A report the API can never accept is dropped rather than retried forever.
      if (response.ok || response.status === 422) inflight = null;
    } catch {
    } finally {
      sending = false;
    }
    while (pending.size > 1000) pending.delete(pending.keys().next().value);
  }

  function metricsText() {
    const lines = ["# TYPE iot_webhook_deliveries_total counter"];
    for (const [outcome, n] of Object.entries(metrics.deliveries)) lines.push(`iot_webhook_deliveries_total{outcome="${outcome}"} ${n}`);
    lines.push(`iot_webhook_deliveries_total{outcome="unknown_url"} ${metrics.unknown}`);
    lines.push("# TYPE iot_webhook_handoff_seconds histogram");
    let cumulative = 0;
    const sorted = [...metrics.handoff].sort((a, b) => a - b);
    for (const bound of [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]) {
      while (cumulative < sorted.length && sorted[cumulative] <= bound) cumulative++;
      lines.push(`iot_webhook_handoff_seconds_bucket{le="${bound}"} ${cumulative}`);
    }
    lines.push(`iot_webhook_handoff_seconds_bucket{le="+Inf"} ${sorted.length}`);
    lines.push(`iot_webhook_handoff_seconds_count ${sorted.length}`);
    lines.push(`iot_webhook_handoff_seconds_sum ${sorted.reduce((a, b) => a + b, 0)}`);
    lines.push("# TYPE iot_webhook_routes gauge", `iot_webhook_routes ${Object.keys(routes).length}`);
    return lines.join("\n") + "\n";
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) =>
    handle(req, res).catch(() => {
      if (!res.headersSent) answer(res, 503, { error: "Unavailable" }, { "Retry-After": "30" });
    }),
  );
  server.on("clientError", (error, socket) => {
    if (!socket.writable) return socket.destroy();
    socket.end(
      error.code === "HPE_HEADER_OVERFLOW"
        ? "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        : "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  const timers = [];
  function start() {
    reload();
    timers.push(setInterval(reload, config.reloadEveryMs));
    timers.push(setInterval(flush, config.reportEveryMs));
    timers.push(
      setInterval(() => {
        for (const [adapter, state] of brokers)
          if (config.now() - state.lastUsed > 10 * 60 * 1000) {
            state.client.end(true);
            brokers.delete(adapter);
          }
      }, 60000),
    );
  }
  async function stop() {
    timers.forEach(clearInterval);
    await flush();
    for (const state of brokers.values()) state.client.end(true);
    brokers.clear();
  }
  return { server, start, stop, reload, flush, metricsText, routes: () => routes, brokers };
}

if (require.main === module) {
  const receiver = createReceiver();
  receiver.start();
  receiver.server.listen(Number(process.env.PORT || 8095), "0.0.0.0");
  http
    .createServer((req, res) => {
      if (req.url !== "/metrics") return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(receiver.metricsText());
    })
    .listen(Number(process.env.METRICS_PORT || 9105), "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => receiver.stop().finally(() => process.exit(0)));
}

module.exports = { createReceiver };
