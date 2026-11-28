// The OPC UA source of a tenant runtime (spec 038 PR 5, research R3, R6 and R12).
//
// One session per connection, kept open by a Keeper and shared by every data source that
// reads through it; each data source registers its point map and gets its own collector
// on that session. A collector's results become decoder-output results (with each
// metric's quality and the result's timestampSource) shaped by the device type, so the
// publisher needs no decoder. Each data source also gets the connection's state, the
// points that could not be collected, and a server certificate that no longer matches.
const crypto = require("node:crypto");
const { Collector } = require("./collect.cjs");
const { resolveMap } = require("./resolve.cjs");
const { Keeper, REASONS } = require("./session.cjs");
const { certificateInfo, settingsOf } = require("./routes.cjs");

const DATATYPES = { number: "Double", integer: "Int64", boolean: "Boolean", string: "String" };
const STATUS_EVERY_MS = 60_000;

/**
 * A collector result as a decoder result: each metric gets its device type parameter's
 * datatype, uuid and unit. A value that does not fit the parameter is sent as bad, so
 * it is stored as unknown with the reason instead of being dropped.
 */
function shape(result, profile) {
  const parameters = new Map((profile?.parameters || []).filter((p) => p.reports_state !== false && p.kind !== "derived").map((p) => [p.key, p]));
  const metrics = [];
  for (const m of result.metrics) {
    const parameter = parameters.get(m.name);
    const datatype = parameter && DATATYPES[parameter.data_type];
    if (!datatype) continue;
    let { value, quality = "good", reason = null } = m;
    if (value !== null && value !== undefined && !fits(parameter.data_type, value)) {
      if (parameter.data_type === "integer" && typeof value === "number" && Number.isFinite(value)) value = Math.round(value);
      else if (parameter.data_type === "string") value = String(value);
      else [value, quality, reason] = [null, "bad", `The value does not fit ${parameter.data_type}`];
    }
    if (value === undefined) value = null;
    if (value === null && quality !== "bad") [quality, reason] = ["bad", reason || "No value"];
    metrics.push({ name: m.name, value, datatype, parameter_uuid: parameter.uuid, unit: parameter.unit ?? null, quality, reason: reason ? String(reason).slice(0, 300) : null });
  }
  if (!metrics.length) return null;
  return { sourceDeviceId: result.sourceDeviceId, observedAt: result.observedAt, timestampSource: result.timestampSource, metrics };
}

function fits(type, value) {
  switch (type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return typeof value === "string" && value.length <= 16384;
  }
}

// What a point map lists as not collected, one row a reading (the contract's key is never
// empty: equipment that was not found lists each of its readings).
function rows(list, map) {
  const out = [];
  for (const row of list) {
    const keys = row.key ? [row.key] : map.readings.map((r) => r.key);
    for (const key of keys) if (out.length < 1000) out.push({ source_id: String(row.source_id).slice(0, 1024), key, reason: String(row.reason).slice(0, 300) });
  }
  return out;
}

class Registration {
  constructor(adapter, map, profile, handlers) {
    this.adapter = adapter;
    this.map = map;
    this.profile = profile;
    this.handlers = handlers;
    this.collector = null;
    this.generation = 0;
    this.values = []; // when each value arrived, for values_last_minute
  }

  async start(connection) {
    const generation = ++this.generation;
    await this.stop(false);
    const resolved = await resolveMap(connection, this.map);
    if (generation !== this.generation) return;
    const collector = new Collector(connection, this.map, resolved);
    this.collector = collector;
    collector.on("result", (result) => {
      const decoded = shape(result, this.profile);
      if (!decoded) return;
      const now = Date.now();
      for (let i = 0; i < decoded.metrics.length; i++) this.values.push(now);
      this.handlers.result(decoded);
    });
    collector.on("error", () => {});
    await collector.start();
    if (generation !== this.generation) return collector.stop();
    this.handlers.event({ kind: "refused_points", points: rows(collector.refused, this.map), polled: rows(collector.polled, this.map) });
    // The first values with the server's time, so activated devices report at once.
    collector.rhythm().catch(() => {});
  }

  async stop(bump = true) {
    if (bump) this.generation++;
    const collector = this.collector;
    this.collector = null;
    await collector?.stop().catch(() => {});
  }

  counts() {
    const now = Date.now();
    this.values = this.values.filter((at) => at > now - 60_000);
    const items = (this.collector?.items || []).filter((item) => !item.refused);
    return {
      points_read: items.length,
      points_bad: items.filter((item) => item.last?.quality === "bad").length,
      values_last_minute: this.values.length,
    };
  }
}

/** One connection's session and the data sources reading through it. */
class Shared {
  constructor(uuid, key, settings) {
    this.uuid = uuid;
    this.key = key;
    this.registrations = new Map();
    this.connection = null;
    this.state = { state: "unreachable", reason: null, message: null, fix: null, since: new Date().toISOString() };
    this.keeper = new Keeper(settings);
    this.keeper.on("session", (connection) => {
      this.connection = connection;
      this._state("connected", null);
      for (const registration of this.registrations.values()) this._start(registration);
    });
    this.keeper.on("lost", () => {
      this.connection = null;
      for (const registration of this.registrations.values()) registration.stop();
      this._state("unreachable", "unreachable");
    });
    this.keeper.on("failed", (failure) => {
      if (failure.reason === "server_certificate_changed") {
        // Collecting stops until a person accepts the new certificate (FR-018).
        this.keeper.stop();
        this._state("stopped", failure.reason);
        if (failure.presented) {
          const presented = certificateInfo(failure.presented);
          for (const registration of this.registrations.values()) registration.handlers.event({ kind: "server_certificate", presented });
        }
        return;
      }
      this._state("unreachable", failure.reason);
    });
    this.timer = setInterval(() => this._report(), STATUS_EVERY_MS);
    this.timer.unref?.();
    this.keeper.start();
  }

  add(registration) {
    this.registrations.set(registration.adapter, registration);
    this._report(registration);
    if (this.connection) this._start(registration);
  }

  async remove(adapter) {
    const registration = this.registrations.get(adapter);
    this.registrations.delete(adapter);
    await registration?.stop();
    return this.registrations.size === 0;
  }

  async close() {
    clearInterval(this.timer);
    await Promise.all([...this.registrations.values()].map((r) => r.stop()));
    this.registrations.clear();
    await this.keeper.stop();
  }

  _start(registration) {
    registration.start(this.connection).catch((error) => {
      registration.handlers.event({ kind: "diagnostic", message: `The point map could not be collected: ${String(error?.message || error).slice(0, 200)}` });
    });
  }

  _state(state, reason) {
    if (this.state.state !== state || this.state.reason !== reason)
      this.state = { state, reason, message: reason ? REASONS[reason]?.message ?? null : null, fix: reason ? REASONS[reason]?.fix ?? null : null, since: new Date().toISOString() };
    for (const registration of this.registrations.values()) this._report(registration);
  }

  _report(only) {
    const connected = this.state.state === "connected" && this.connection;
    for (const registration of only ? [only] : this.registrations.values()) {
      registration.handlers.health(Boolean(connected));
      registration.handlers.event({
        kind: "connection_status",
        ...this.state,
        security: connected ? { policy: this.connection.security.policy, mode: this.connection.security.mode } : null,
        ...registration.counts(),
        clock_difference_ms: connected && Number.isFinite(this.connection.clockDifferenceMs) ? Math.round(this.connection.clockDifferenceMs) : null,
        limits: connected ? this.connection.limits ?? null : null,
      });
    }
  }
}

/** The tenant runtime's connections, by connection uuid. */
class Sources {
  constructor({ pkiRoot, allowPrivate = () => false }) {
    this.pkiRoot = pkiRoot;
    this.allowPrivate = allowPrivate;
    this.shared = new Map();
  }

  /**
   * Starts collecting a data source's point map. body: { connection, secrets,
   * private_ranges, platform_ranges } as Laravel sends them; handlers: { result(decoded),
   * event(payload), health(connected) }. Returns a function that stops it.
   */
  register(adapter, body, map, profile, handlers) {
    const settings = settingsOf(body, { pkiRoot: this.pkiRoot, allowPrivate: this.allowPrivate() });
    const uuid = body.connection.uuid;
    const key = crypto.createHash("sha256").update(JSON.stringify(settings)).digest("hex");
    let shared = this.shared.get(uuid);
    if (shared && shared.key !== key) {
      // The connection changed (a new certificate, a new password): every data source
      // reading through it moves to a session with the new settings.
      const stale = shared;
      const moving = [...stale.registrations.values()].filter((r) => r.adapter !== adapter);
      stale.registrations.clear();
      stale.close();
      shared = new Shared(uuid, key, settings);
      this.shared.set(uuid, shared);
      for (const registration of moving) {
        registration.stop();
        shared.add(registration);
      }
    }
    if (!shared) {
      shared = new Shared(uuid, key, settings);
      this.shared.set(uuid, shared);
    }
    shared.registrations.get(adapter)?.stop();
    const registration = new Registration(adapter, map, profile, handlers);
    shared.add(registration);
    return async () => {
      const current = this.shared.get(uuid);
      if (!current || current.registrations.get(adapter) !== registration) return registration.stop();
      if (await current.remove(adapter)) {
        this.shared.delete(uuid);
        await current.close();
      }
    };
  }

  async closeAll() {
    await Promise.all([...this.shared.values()].map((s) => s.close()));
    this.shared.clear();
  }
}

module.exports = { Sources, shape };
