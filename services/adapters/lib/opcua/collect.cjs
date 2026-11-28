// Collecting a point map's values (spec 038, research R6 and R12).
//
// One subscription per sampling interval; monitored items created in batches inside the
// server's limits with queue size 1 (newest kept) and a deadband on the server, or in the
// client when the server refuses it; changes grouped into one result per equipment per
// second. Every rhythm the points are also read and reported with the server's time, so
// a steady device still reports. Points beyond the server's limits are read at the
// rhythm only. Points the server refuses are listed with the reason.
//
// A result: { sourceDeviceId, observedAt, timestampSource: "source" | "server" | "receipt",
//             metrics: [{ name, value, quality: "good" | "uncertain" | "bad", reason }] }
const { EventEmitter } = require("node:events");
const {
  AttributeIds,
  DataChangeFilter,
  DataChangeTrigger,
  DeadbandType,
  TimestampsToReturn,
} = require("node-opcua-client");
const { quality } = require("./quality.cjs");
const { batches } = require("./nodes.cjs");

const DEFAULT_SAMPLE_MS = 10_000;
const CLOCK_AHEAD_MS = 5 * 60_000;
const CLOCK_BEHIND_MS = 24 * 60 * 60_000;
const FILTER_REFUSED = /BadFilterNotAllowed|BadMonitoredItemFilterUnsupported|BadMonitoredItemFilterInvalid|BadDeadbandFilterInvalid/;
const TOO_MANY = /BadTooManyMonitoredItems|BadTooManyOperations/;

function convert(reading, raw) {
  if (raw === null || raw === undefined) return null;
  switch (reading.data_type) {
    case "number": {
      const number = Number(typeof raw === "bigint" ? Number(raw) : raw);
      return Number.isFinite(number) ? number * (reading.scale ?? 1) + (reading.offset ?? 0) : null;
    }
    case "boolean":
      return Boolean(raw);
    case "state":
      return Number.isInteger(Number(raw)) ? Number(raw) : null;
    default:
      return raw?.text ?? String(raw);
  }
}

function threshold(reading) {
  const deadband = reading.report?.deadband;
  if (!deadband || deadband.kind === "none" || reading.data_type !== "number") return 0;
  if (deadband.kind === "absolute") return deadband.value;
  if (deadband.kind === "percent" && reading.range) return (Math.abs(reading.range[1] - reading.range[0]) * deadband.value) / 100;
  return 0;
}

function serverFilter(reading) {
  const deadband = reading.report?.deadband;
  if (!deadband || deadband.kind === "none" || reading.data_type !== "number")
    return new DataChangeFilter({ trigger: DataChangeTrigger.StatusValue, deadbandType: DeadbandType.None, deadbandValue: 0 });
  return new DataChangeFilter({
    trigger: DataChangeTrigger.StatusValue,
    deadbandType: deadband.kind === "percent" ? DeadbandType.Percent : DeadbandType.Absolute,
    deadbandValue: deadband.value,
  });
}

class Collector extends EventEmitter {
  /**
   * connection: from session.open(); map: a point map; resolved: from resolve.resolveMap().
   * Emits "result" for each result and "error" for a failed rhythm read.
   */
  constructor(connection, map, resolved, { flushMs = 1000 } = {}) {
    super();
    this.connection = connection;
    this.map = map;
    this.flushMs = flushMs;
    this.rhythmMs = (map.rhythm_seconds ?? 300) * 1000;
    const readings = new Map(map.readings.map((r) => [r.key, r]));
    this.items = [];
    for (const entry of resolved)
      for (const [key, node] of Object.entries(entry.points))
        if (node) this.items.push({ source_id: entry.source_id, reading: readings.get(key), node, last: undefined, clientDeadband: false });
    this.refused = resolved.flatMap((entry) => entry.problems.map((p) => ({ source_id: entry.source_id, key: p.key, reason: p.problem })));
    this.polled = [];
    this.subscriptions = [];
    this.pending = new Map();
    this.timers = [];
  }

  async start() {
    const groups = new Map();
    for (const item of this.items) {
      const ms = Math.max(1000, item.reading.report?.sample_ms ?? DEFAULT_SAMPLE_MS);
      if (!groups.has(ms)) groups.set(ms, []);
      groups.get(ms).push(item);
    }
    for (const [ms, items] of groups) await this._subscribe(ms, items);
    this.timers.push(setInterval(() => this._flush(), this.flushMs));
    this.timers.push(setInterval(() => this.rhythm().catch((error) => this.emit("error", error)), this.rhythmMs));
    for (const timer of this.timers) timer.unref?.();
    return this;
  }

  async _subscribe(ms, items) {
    const subscription = await this.connection.session.createSubscription2({
      requestedPublishingInterval: ms,
      // Keep-alive about every 30 seconds, well inside the session timeout.
      requestedMaxKeepAliveCount: Math.max(2, Math.ceil(30_000 / ms)),
      requestedLifetimeCount: Math.max(6, Math.ceil(30_000 / ms) * 3),
      maxNotificationsPerPublish: 0,
      publishingEnabled: true,
      priority: 1,
    });
    this.subscriptions.push(subscription);
    const limit = this.connection.limits?.MaxMonitoredItemsPerCall;
    for (const batch of batches(items, limit)) await this._monitor(subscription, ms, batch, true);
  }

  async _monitor(subscription, ms, items, withFilter) {
    // One monitored item a point, so each keeps its own deadband.
    const created = await Promise.all(items.map(async (item) => {
      const monitored = await subscription.monitor(
        { nodeId: item.node, attributeId: AttributeIds.Value },
        { samplingInterval: ms, discardOldest: true, queueSize: 1, filter: withFilter ? serverFilter(item.reading) : null },
        TimestampsToReturn.Both,
      ).catch((error) => ({ failed: error }));
      return { item, monitored };
    }));
    const retry = [];
    for (const { item, monitored } of created) {
      const status = monitored.failed ? String(monitored.failed.message) : monitored.statusCode?.isGood?.() === false ? monitored.statusCode.name : "";
      if (!status) {
        monitored.on("changed", (value) => this._change(item, value, "source"));
      } else if (withFilter && FILTER_REFUSED.test(status)) {
        item.clientDeadband = true; // the server cannot filter: compare here instead
        retry.push(item);
      } else if (TOO_MANY.test(status)) {
        this.polled.push({ source_id: item.source_id, key: item.reading.key, reason: "Beyond the server's monitored item limit; read at the rhythm" });
      } else {
        this.refused.push({ source_id: item.source_id, key: item.reading.key, reason: status });
        item.refused = true;
      }
    }
    if (retry.length) await this._monitor(subscription, ms, retry, false);
  }

  _change(item, dataValue, source) {
    const q = quality(dataValue.statusCode);
    const value = q.quality === "bad" ? null : convert(item.reading, dataValue.value?.value);
    // The server applies the deadband when it can; for the rest it is applied here.
    const last = item.last;
    const withinDeadband = item.clientDeadband && last && last.quality === q.quality &&
      typeof value === "number" && typeof last.value === "number" && Math.abs(value - last.value) <= threshold(item.reading);
    if (source === "source" && withinDeadband) return;
    item.last = { value, quality: q.quality };
    const time = (source === "server" ? dataValue.serverTimestamp : dataValue.sourceTimestamp) || dataValue.serverTimestamp || new Date();
    const key = `${item.source_id}\u0000${source}`;
    const result = this.pending.get(key) || { sourceDeviceId: item.source_id, observedAt: time, timestampSource: source, metrics: new Map() };
    if (time > result.observedAt) result.observedAt = time;
    result.metrics.set(item.reading.key, { name: item.reading.key, value, quality: q.quality, reason: q.reason });
    this.pending.set(key, result);
  }

  _flush() {
    const results = [...this.pending.values()];
    this.pending.clear();
    const now = Date.now();
    for (const result of results) {
      // A time more than 5 minutes ahead or a day behind is a wrong clock, not when the
      // value was seen: it is stored at receipt and labelled so (spec 038 T068).
      const at = result.observedAt.getTime();
      const wrong = !Number.isFinite(at) || at > now + CLOCK_AHEAD_MS || at < now - CLOCK_BEHIND_MS;
      this.emit("result", {
        ...result,
        observedAt: (wrong ? new Date(now) : result.observedAt).toISOString(),
        timestampSource: wrong ? "receipt" : result.timestampSource,
        metrics: [...result.metrics.values()],
      });
    }
    return results.length;
  }

  // Read every point once and report it with the server's time: the rhythm report.
  async rhythm() {
    const items = this.items.filter((item) => !item.refused);
    const limit = this.connection.limits?.MaxNodesPerRead;
    for (const batch of batches(items, limit)) {
      const values = await this.connection.session.read(batch.map((item) => ({ nodeId: item.node, attributeId: AttributeIds.Value })), 0);
      batch.forEach((item, i) => this._change(item, values[i], "server"));
    }
    this._flush();
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await Promise.all(this.subscriptions.map((s) => s.terminate().catch(() => {})));
    this.subscriptions = [];
    this._flush();
  }
}

module.exports = { Collector, convert };
