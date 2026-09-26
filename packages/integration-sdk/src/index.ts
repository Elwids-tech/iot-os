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
export interface Page<T> {
  data: T[];
  meta: { current_page: number; last_page: number; total: number };
}
export interface IntegrationEvent {
  id: string;
  schema_version: "integration-event.v1";
  type: "alert.activated.v1" | "alert.cleared.v1" | "alert.acknowledged.v1";
  occurred_at: string;
  recorded_at: string;
  data: Alert;
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

function integrationEvent(item: unknown): IntegrationEvent {
  const value = fields(item, ["id", "schema_version", "type", "occurred_at", "recorded_at"], []);
  if (value.schema_version !== "integration-event.v1" || !["alert.activated.v1", "alert.cleared.v1", "alert.acknowledged.v1"].includes(String(value.type))) throw new IotContractError();
  return { ...value, data: alert(value.data) } as unknown as IntegrationEvent;
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
    const format = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
    const span = Date.parse(options.to) - Date.parse(options.from);
    if (!format.test(options.from) || !format.test(options.to) || !Number.isFinite(span) || span <= 0 || span > 31 * 86400000) throw new TypeError("Use RFC3339 timestamps and a history window of at most 31 days.");
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
}
