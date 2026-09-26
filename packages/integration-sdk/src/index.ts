export interface TelemetryRecord {
  event_uuid: string; configuration_uuid: string; parameter_uuid: string;
  received_at: string; observed_at: string; data_type: string; unit: string | null;
  value: unknown; quality: string; timestamp_source: string; historical: boolean;
}
export interface RecordOptions extends Omit<HistoryOptions, "maxPoints"> {
  limit?: number; pageSize?: number; cursor?: string;
}
export interface TelemetryRecords {
  schema_version: "telemetry-records.v1"; device_uuid: string; parameter_uuid: string; data: TelemetryRecord[];
  meta: { from: string; to: string; limit: number; page_size: number; returned: number;
    consumed: number; next_cursor: string | null; has_more: boolean; limit_reached: boolean };
}
export interface LocationBinding {
  version_uuid: string;
  binding: { schema_version: "location-binding.v1"; uuid: string; revision: number;
    organization_uuid: string; device_uuid: string; configuration_uuid: string; generation: number;
    latitude_parameter_uuid: string; longitude_parameter_uuid: string; accuracy_parameter_uuid: string | null;
    pairing: "same_event"; max_age_seconds: number; max_future_skew_seconds: number; allow_unknown_accuracy: boolean };
}
export interface LocationFix {
  schema_version: "location-fix.v1"; binding_uuid: string; binding_revision: number;
  event_id: string; organization_uuid: string; device_uuid: string; configuration_uuid: string;
  generation: number; evaluated_at: string; observed_at: string | null; received_at: string | null;
  timestamp_source: string; historical: boolean; status: "unknown" | "valid"; reason: string;
  live_eligible: boolean; point: { latitude: number; longitude: number; accuracy_metres: number | null } | null;
}
export interface TelemetryReading {
  parameter_uuid: string; key: string; label: string; data_type: string; unit: string | null;
  value: unknown; quality: string; observed_at: string; received_at: string;
  historical: boolean; timestamp_source?: string; last_valid_received_at?: string;
}
export interface LatestTelemetry {
  schema_version: "telemetry-latest.v1"; device_uuid: string; configuration_uuid: string | null;
  presence: string; data: TelemetryReading[];
}
export interface HistoryPoint { at: string; value: unknown; count: number; min?: number; max?: number }
export interface TelemetryHistory {
  schema_version: "telemetry-history.v1"; device_uuid: string; parameter_uuid: string;
  retention_days: number; from: string | null; to: string | null;
  data: { configuration_uuid: string; unit: string | null; data_type: string; points: HistoryPoint[] }[];
}
export interface HistoryOptions {
  parameterUuid: string; from: string; to: string; maxPoints?: number; signal?: AbortSignal;
}
export interface Device {
  uuid: string; code: string; name: string; lifecycle: string; presence: string;
  last_seen_at: string | null;
}
export interface Alert {
  uuid: string; episode: number; condition: "active" | "cleared";
  activated_at: string | null; cleared_at: string | null; acknowledged_at: string | null;
  workflow_uuid: string; workflow_name: string; device_uuid: string;
  execution_stopped_reason: string | null;
}
export type TrailWindow = "1h" | "6h" | "24h" | "7d";
export interface GeofencePolicy { outside_for_seconds: number; max_gap_seconds: number; minimum_samples: number; uncertainty_metres: number }
export interface GeofenceEvent { uuid: string; geofence_uuid: string; geofence_name: string; assignment_uuid: string; device_uuid: string;
  type: "entered" | "exited" | "wandering_started" | "wandering_resolved"; source_event_uuid: string | null; occurred_at: string }
export interface GeofenceAssignment { uuid: string; device: { uuid: string; name: string; code: string }; workflow_uuid: string; policy: GeofencePolicy;
  desired_geofence_revision: number; applied_geofence_revision: number | null; status: string; diagnostic: string | null; deployment_status: string }
export interface Geofence { uuid: string; name: string; geometry: { type: "Polygon"; coordinates: number[][][] }; revision: number;
  assignments: GeofenceAssignment[]; created_at: string; updated_at: string }
export interface GeofenceInput { operation_uuid: string; expected_revision: number; name: string; geometry: Geofence["geometry"];
  assignments: Array<{ device_uuid: string; policy: GeofencePolicy }> }
export interface GeofenceActivationBatch { uuid: string; geofence_revision: number; status: "pending" | "partial_failure" | "succeeded";
  items: Array<{ id: number; assignment_uuid: string; device_uuid: string; operation_uuid: string; target: string; status: string; diagnostic: string | null }> }
export interface LocationMapSnapshot { schema_version: "location-map.v1"; trail_window: TrailWindow; geofence: Geofence | null;
  devices: Array<{ device_uuid: string; device_name: string; binding_uuid: string; latest: LocationFix | null; condition: "inside" | "outside" | "unknown";
    active: boolean; trail: { sampled: boolean; segments: Array<Array<{ event_id: string; observed_at: string | null; received_at: string | null; historical: boolean;
      point: { latitude: number; longitude: number; accuracy_metres: number | null } }>> } }> }
export interface Page<T> {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
}
export interface IntegrationEvent {
  id: string;
  schema_version: "integration-event.v1";
  type: "alert.activated.v1" | "alert.cleared.v1" | "alert.acknowledged.v1" | "geofence.entered.v1" | "geofence.exited.v1" | "geofence.wandering_started.v1" | "geofence.wandering_resolved.v1";
  occurred_at: string;
  recorded_at: string;
  data: Alert | GeofenceEvent;
}
export interface EventPage { data: IntegrationEvent[]; next_cursor: string; has_more: boolean }
export interface EventOptions { cursor?: string; limit?: number; signal?: AbortSignal }
export interface PageOptions { page?: number; perPage?: number; signal?: AbortSignal }
export interface AlertOptions extends PageOptions { condition?: "active" | "cleared" }
export class IotApiError extends Error {
  constructor(public readonly status: number, public readonly retryAfterSeconds: number | null) {
    super(`IoT API request failed (${status}).`);
    this.name = "IotApiError";
  }
}
export class IotTransportError extends Error {
  constructor() { super("IoT API request could not be completed; it was not retried."); this.name = "IotTransportError"; }
}
export class IotContractError extends Error {
  constructor() { super("IoT API returned an unsupported response."); this.name = "IotContractError"; }
}
const uuid = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new TypeError("A UUID is required.");
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IotContractError();
  return value as Record<string, unknown>;
};
function fields(value: unknown, strings: string[], nullable: string[]): Record<string, unknown> {
  const result = record(value);
  if (strings.some(key => typeof result[key] !== "string") || nullable.some(key => result[key] !== null && typeof result[key] !== "string")) throw new IotContractError();
  return result;
}
function device(value: unknown): Device {
  return fields(value, ["uuid", "code", "name", "lifecycle", "presence"], ["last_seen_at"]) as unknown as Device;
}
function alert(value: unknown): Alert {
  const result = fields(value, ["uuid", "workflow_uuid", "workflow_name", "device_uuid"], ["activated_at", "cleared_at", "acknowledged_at", "execution_stopped_reason"]);
  if (!Number.isSafeInteger(result.episode) || Number(result.episode) < 1 || !["active", "cleared"].includes(String(result.condition))) throw new IotContractError();
  return result as unknown as Alert;
}
function page<T>(value: unknown, parse: (item: unknown) => T): Page<T> {
  const result = record(value); const meta = record(result.meta);
  if (!Array.isArray(result.data) || result.data.length > 100 || !["current_page", "last_page", "total"].every(key => Number.isSafeInteger(meta[key])) || Number(meta.current_page) < 1 || Number(meta.last_page) < 1 || Number(meta.total) < 0) throw new IotContractError();
  return { data: result.data.map(parse), meta: meta as unknown as Page<T>["meta"] };
}

function historyWindow(options: Pick<HistoryOptions, "from" | "to">): void {
    const format = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
    const span = Date.parse(options.to) - Date.parse(options.from);
    if (!format.test(options.from) || !format.test(options.to) || !Number.isFinite(span) || span <= 0 || span > 31 * 86400000) throw new TypeError("Use RFC3339 timestamps and a history window of at most 31 days.");
}

function integrationEvent(item: unknown): IntegrationEvent {
  const value = fields(item, ["id", "schema_version", "type", "occurred_at", "recorded_at"], []);
  const types = ["alert.activated.v1", "alert.cleared.v1", "alert.acknowledged.v1", "geofence.entered.v1", "geofence.exited.v1", "geofence.wandering_started.v1", "geofence.wandering_resolved.v1"];
  if (value.schema_version !== "integration-event.v1" || !types.includes(String(value.type))) throw new IotContractError();
  const data = String(value.type).startsWith("alert.") ? alert(value.data) : fields(value.data, ["uuid", "geofence_uuid", "geofence_name", "assignment_uuid", "device_uuid", "type", "occurred_at"], ["source_event_uuid"]);
  return { ...value, data } as unknown as IntegrationEvent;
}

/** Verify raw request bytes before parsing. Receivers must also deduplicate IDs. */
export async function verifyWebhook(options: {
  body: string | Uint8Array; secret: string; signature: string; timestamp: string;
  deliveryId: string; nowSeconds?: number; toleranceSeconds?: number;
}): Promise<IntegrationEvent> {
  const fail = () => { throw new Error("Invalid webhook signature or timestamp."); };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 300 || !/^\d{1,12}$/.test(options.timestamp) || Math.abs(now - Number(options.timestamp)) > tolerance || !/^v1=[a-f0-9]{64}$/.test(options.signature) || !/^[a-f0-9-]{36}$/i.test(options.deliveryId) || options.secret.length < 16) return fail();
  const encoder = new TextEncoder();
  const body = typeof options.body === "string" ? encoder.encode(options.body) : options.body;
  if (body.length > 1048576) return fail();
  const prefix = encoder.encode(`${options.timestamp}.${options.deliveryId}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix); message.set(body, prefix.length);
  const signature = new Uint8Array(options.signature.slice(3).match(/../g)!.map(byte => parseInt(byte,16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(options.secret), {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC",key,signature,message)) return fail();
  try { return integrationEvent(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body))); }
  catch { throw new IotContractError(); }
}

/** Server-only. Store the application token in your backend secret store. */
export class IotClient {
  #base: string; #token: string; #fetch: typeof fetch; #timeout: number;
  constructor(options: { baseUrl: string; organization: string; token: string; timeoutMs?: number; fetch?: typeof fetch; allowInsecureLocalhost?: boolean }) {
    const url = new URL(options.baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && local && options.allowInsecureLocalhost))) throw new TypeError("Use HTTPS, or explicitly allow HTTP on loopback for local development.");
    if (url.pathname !== "/") throw new TypeError("baseUrl must be an API origin without a path.");
    if (!options.token || /[\r\n]/.test(options.token)) throw new TypeError("A valid application token is required.");
    const timeout = options.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new TypeError("timeoutMs must be between 1 and 120000.");
    this.#base = `${url.origin}/api/integration/v1/organizations/${uuid(options.organization)}`;
    this.#token = options.token; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = timeout;
  }
  async eventCheckpoint(signal?: AbortSignal): Promise<string> {
    const response = record(await this.#request("events/checkpoint", signal));
    if (typeof response.cursor !== "string" || !response.cursor || response.cursor.length > 4096) throw new IotContractError();
    return response.cursor;
  }
  async events(options: EventOptions = {}): Promise<EventPage> {
    const query = new URLSearchParams();
    if (options.cursor !== undefined) {
      if (!options.cursor || options.cursor.length > 4096) throw new TypeError("Invalid event cursor.");
      query.set("cursor", options.cursor);
    }
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new TypeError("Invalid event limit.");
      query.set("limit", String(options.limit));
    }
    const response = record(await this.#request("events" + (query.size ? "?" + query : ""), options.signal));
    if (!Array.isArray(response.data) || response.data.length > (options.limit ?? 100) || typeof response.next_cursor !== "string" || !response.next_cursor || response.next_cursor.length > 4096 || typeof response.has_more !== "boolean" || (response.has_more && !response.data.length)) throw new IotContractError();
    const data = response.data.map(integrationEvent);
    return { data, next_cursor: response.next_cursor, has_more: response.has_more };
  }
  async telemetryRecords(id: string, options: RecordOptions): Promise<TelemetryRecords> {
    historyWindow(options);
    const limit = options.limit ?? 500, size = options.pageSize ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(size) || size < 1 || size > 100) throw new TypeError("Invalid record limits.");
    if (options.cursor !== undefined && (!options.cursor || options.cursor.length > 512)) throw new TypeError("Invalid record cursor.");
    const query = new URLSearchParams({ parameter_uuid: uuid(options.parameterUuid), from: options.from, to: options.to, limit: String(limit), page_size: String(size) });
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    const response = record(await this.#request(`devices/${uuid(id)}/telemetry/records?${query}`, options.signal));
    const meta = fields(response.meta, ["from", "to"], ["next_cursor"]);
    if (response.schema_version !== "telemetry-records.v1" || response.device_uuid !== id || response.parameter_uuid !== options.parameterUuid || !Array.isArray(response.data) || response.data.length > size || meta.limit !== limit || meta.page_size !== size || meta.returned !== response.data.length || !Number.isInteger(meta.consumed) || Number(meta.consumed) < response.data.length || Number(meta.consumed) > limit || typeof meta.has_more !== "boolean" || typeof meta.limit_reached !== "boolean" || meta.has_more !== (meta.next_cursor !== null) || (meta.has_more && (!response.data.length || Number(meta.consumed) >= limit || meta.limit_reached)) || (meta.limit_reached && Number(meta.consumed) !== limit) || (typeof meta.next_cursor === "string" && (!meta.next_cursor || meta.next_cursor.length > 512 || meta.next_cursor === options.cursor))) throw new IotContractError();
    const data = response.data.map(item => {
      const row = fields(item, ["event_uuid", "configuration_uuid", "parameter_uuid", "received_at", "observed_at", "data_type", "quality", "timestamp_source"], ["unit"]);
      if (row.parameter_uuid !== options.parameterUuid || !("value" in row) || typeof row.historical !== "boolean") throw new IotContractError();
      return row as unknown as TelemetryRecord;
    });
    return { ...response, data, meta } as unknown as TelemetryRecords;
  }
  async locationBindings(id: string, options: PageOptions = {}): Promise<Page<LocationBinding>> {
    return page(await this.#request(`devices/${uuid(id)}/location-bindings` + this.#query(options), options.signal), item => {
      const version = fields(item, ["version_uuid"], []);
      const binding = fields(version.binding, ["uuid", "organization_uuid", "device_uuid", "configuration_uuid", "latitude_parameter_uuid", "longitude_parameter_uuid"], ["accuracy_parameter_uuid"]);
      if (binding.schema_version !== "location-binding.v1" || binding.pairing !== "same_event" || binding.device_uuid !== id || !["revision", "generation", "max_age_seconds"].every(key => Number.isInteger(binding[key]) && Number(binding[key]) > 0) || !Number.isInteger(binding.max_future_skew_seconds) || Number(binding.max_future_skew_seconds) < 0 || typeof binding.allow_unknown_accuracy !== "boolean") throw new IotContractError();
      return { version_uuid: version.version_uuid, binding } as unknown as LocationBinding;
    });
  }
  async locationFix(id: string, eventId: string, versionUuid: string, signal?: AbortSignal): Promise<LocationFix> {
    const response = record(await this.#request(`devices/${uuid(id)}/locations/${uuid(eventId)}?version_uuid=${uuid(versionUuid)}`, signal));
    const fix = fields(response.data, ["binding_uuid", "event_id", "organization_uuid", "device_uuid", "configuration_uuid", "evaluated_at", "timestamp_source", "reason"], ["observed_at", "received_at"]);
    if (response.version_uuid !== versionUuid || fix.schema_version !== "location-fix.v1" || fix.event_id !== eventId || fix.device_uuid !== id || !["binding_revision", "generation"].every(key => Number.isInteger(fix[key]) && Number(fix[key]) > 0) || !["valid", "unknown"].includes(String(fix.status)) || typeof fix.historical !== "boolean" || typeof fix.live_eligible !== "boolean") throw new IotContractError();
    if (fix.status === "unknown") {
      if (fix.point !== null || fix.live_eligible) throw new IotContractError();
    } else {
      const point = record(fix.point);
      if (typeof point.latitude !== "number" || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || typeof point.longitude !== "number" || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 || (point.accuracy_metres !== null && (typeof point.accuracy_metres !== "number" || !Number.isFinite(point.accuracy_metres) || point.accuracy_metres < 0)) || (fix.historical && fix.live_eligible)) throw new IotContractError();
    }
    return fix as unknown as LocationFix;
  }
  async latestTelemetry(id: string, signal?: AbortSignal): Promise<LatestTelemetry> {
    const response = fields(await this.#request(`devices/${uuid(id)}/telemetry/latest`, signal), ["device_uuid", "presence"], ["configuration_uuid"]);
    if (response.schema_version !== "telemetry-latest.v1" || response.device_uuid !== id || !Array.isArray(response.data)) throw new IotContractError();
    const data = response.data.map(item => {
      const reading = fields(item, ["parameter_uuid", "key", "label", "data_type", "quality", "observed_at", "received_at"], ["unit"]);
      if (!("value" in reading) || typeof reading.historical !== "boolean" || ["timestamp_source", "last_valid_received_at"].some(key => reading[key] !== undefined && typeof reading[key] !== "string")) throw new IotContractError();
      return reading as unknown as TelemetryReading;
    });
    return { ...response, data } as unknown as LatestTelemetry;
  }
  async telemetryHistory(id: string, options: HistoryOptions): Promise<TelemetryHistory> {
    historyWindow(options);
    const max = options.maxPoints ?? 500;
    if (!Number.isInteger(max) || max < 10 || max > 1000) throw new TypeError("maxPoints must be between 10 and 1000.");
    const query = new URLSearchParams({ parameter_uuid: uuid(options.parameterUuid), from: options.from, to: options.to, max_points: String(max) });
    const response = fields(await this.#request(`devices/${uuid(id)}/telemetry/history?${query}`, options.signal), ["device_uuid", "parameter_uuid"], ["from", "to"]);
    if (response.schema_version !== "telemetry-history.v1" || response.device_uuid !== id || response.parameter_uuid !== options.parameterUuid || !Number.isInteger(response.retention_days) || Number(response.retention_days) < 1 || !Array.isArray(response.data)) throw new IotContractError();
    let total = 0;
    const data = response.data.map(item => {
      const series = fields(item, ["configuration_uuid", "data_type"], ["unit"]);
      if (!Array.isArray(series.points)) throw new IotContractError();
      total += series.points.length;
      if (total > 2000) throw new IotContractError();
      const points = series.points.map(item => {
        const point = fields(item, ["at"], []);
        if (!("value" in point) || !Number.isSafeInteger(point.count) || Number(point.count) < 0 || ["min", "max"].some(key => point[key] !== undefined && (typeof point[key] !== "number" || !Number.isFinite(point[key])))) throw new IotContractError();
        return point as unknown as HistoryPoint;
      });
      return { ...series, points };
    });
    return { ...response, data } as unknown as TelemetryHistory;
  }
  async locationMap(input: { deviceUuids: string[]; trailWindow?: TrailWindow; includeTrails?: boolean; geofenceUuid?: string; signal?: AbortSignal }): Promise<LocationMapSnapshot> {
    if (!input.deviceUuids.length || input.deviceUuids.length > 100) throw new TypeError("Choose between 1 and 100 devices.");
    const response = record(await this.#write("location-map/query", "POST", { device_uuids: input.deviceUuids.map(uuid), trail_window: input.trailWindow ?? "24h", include_trails: input.includeTrails ?? true, geofence_uuid: input.geofenceUuid }, input.signal));
    return record(response.data) as unknown as LocationMapSnapshot;
  }
  async geofences(signal?: AbortSignal): Promise<Geofence[]> {
    const response = record(await this.#request("geofences", signal));
    if (!Array.isArray(response.data) || response.data.length > 100) throw new IotContractError();
    return response.data.map(item => record(item) as unknown as Geofence);
  }
  async geofence(id: string, signal?: AbortSignal): Promise<Geofence> {
    return record(record(await this.#request(`geofences/${uuid(id)}`, signal)).data) as unknown as Geofence;
  }
  async createGeofence(input: GeofenceInput, signal?: AbortSignal): Promise<{ data: Geofence; activation: GeofenceActivationBatch }> {
    return await this.#write("geofences", "POST", input, signal) as { data: Geofence; activation: GeofenceActivationBatch };
  }
  async updateGeofence(id: string, input: GeofenceInput, signal?: AbortSignal): Promise<{ data: Geofence; activation: GeofenceActivationBatch }> {
    return await this.#write(`geofences/${uuid(id)}`, "PUT", input, signal) as { data: Geofence; activation: GeofenceActivationBatch };
  }
  async geofenceActivation(id: string, batch: string, signal?: AbortSignal): Promise<GeofenceActivationBatch> {
    return record(record(await this.#request(`geofences/${uuid(id)}/activations/${uuid(batch)}`, signal)).data) as unknown as GeofenceActivationBatch;
  }
  async retryGeofenceActivation(id: string, batch: string, item: number, signal?: AbortSignal): Promise<GeofenceActivationBatch> {
    if (!Number.isSafeInteger(item) || item < 1) throw new TypeError("A valid activation item is required.");
    return record(record(await this.#write(`geofences/${uuid(id)}/activations/${uuid(batch)}/items/${item}/retry`, "POST", {}, signal)).data) as unknown as GeofenceActivationBatch;
  }
  async devices(options: PageOptions = {}): Promise<Page<Device>> {
    return page(await this.#request("devices" + this.#query(options), options.signal), device);
  }
  async device(id: string, signal?: AbortSignal): Promise<Device> {
    return device(record(await this.#request(`devices/${uuid(id)}`, signal)).data);
  }
  async alerts(options: AlertOptions = {}): Promise<Page<Alert>> {
    return page(await this.#request("alerts" + this.#query(options), options.signal), alert);
  }
  async alert(id: string, signal?: AbortSignal): Promise<Alert> {
    return alert(record(await this.#request(`alerts/${uuid(id)}`, signal)).data);
  }
  async *allDevices(options: Omit<PageOptions, "page"> = {}): AsyncGenerator<Device> {
    for (let current = 1; current <= 100000; current++) {
      const response = await this.devices({ ...options, page: current });
      if (response.meta.current_page !== current) throw new IotContractError();
      yield* response.data;
      if (current >= response.meta.last_page) return;
    }
    throw new IotContractError();
  }
  async *allAlerts(options: Omit<AlertOptions, "page"> = {}): AsyncGenerator<Alert> {
    for (let current = 1; current <= 100000; current++) {
      const response = await this.alerts({ ...options, page: current });
      if (response.meta.current_page !== current) throw new IotContractError();
      yield* response.data;
      if (current >= response.meta.last_page) return;
    }
    throw new IotContractError();
  }
  #query(options: AlertOptions): string {
    const result = new URLSearchParams();
    for (const [name, value, max] of [["page", options.page, 100000], ["per_page", options.perPage, 100]] as const) {
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`Invalid ${name}.`);
        result.set(name, String(value));
      }
    }
    if (options.condition !== undefined) {
      if (!["active", "cleared"].includes(options.condition)) throw new TypeError("Invalid condition.");
      result.set("condition", options.condition);
    }
    return result.size ? "?" + result.toString() : "";
  }
  async #request(path: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await this.#fetch(`${this.#base}/${path}`, {
        method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${this.#token}` },
        credentials: "omit", redirect: "error", signal: controller.signal,
      });
      if (!response.ok) {
        const raw = response.headers.get("Retry-After");
        const retry = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
        throw new IotApiError(response.status, retry);
      }
      try { return await response.json(); } catch { throw new IotContractError(); }
    } catch (error) {
      if (error instanceof IotApiError || error instanceof IotContractError) throw error;
      // Do not expose fetch errors that can contain authorization headers.
      throw new IotTransportError();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async #write(path: string, method: "POST" | "PUT", body: unknown, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.#timeout); const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
    try {
      const response = await this.#fetch(`${this.#base}/${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.#token}` },
        credentials: "omit", redirect: "error", body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) { const raw = response.headers.get("Retry-After"); throw new IotApiError(response.status, raw !== null && /^\d+$/.test(raw) ? Number(raw) : null); }
      try { return await response.json(); } catch { throw new IotContractError(); }
    } catch (error) {
      if (error instanceof IotApiError || error instanceof IotContractError) throw error;
      throw new IotTransportError();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
}
