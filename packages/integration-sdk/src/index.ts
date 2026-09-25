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
