import type {
  AdapterFixture,
  AdapterSecrets,
  AdapterSource,
  AdapterSourceType,
  ChecklistStep,
  PollParam,
  PollSettings,
  WebhookAuth,
} from "@iot-os/api-client";

export type PollSource = Extract<AdapterSource, { type: "poll" }>;
export type WebhookSource = Extract<AdapterSource, { type: "webhook" }>;
export type MqttSource = Extract<AdapterSource, { type: "platform" | "vendor" }>;

export const isMqtt = (source: AdapterSource): source is MqttSource =>
  source.type === "platform" || source.type === "vendor";

const labels: Record<AdapterSourceType, string> = {
  platform: "Tenant MQTT broker",
  vendor: "Vendor MQTT broker",
  webhook: "HTTP webhook",
  poll: "HTTP polling",
};
export const sourceLabel = (type: AdapterSourceType | undefined) =>
  (type && labels[type]) || "Unknown source";

export const authLabels: Record<WebhookAuth["mode"], string> = {
  hmac: "HMAC signature",
  header: "Secret in a header",
  url: "Token in the URL",
};

export function defaultAuth(mode: WebhookAuth["mode"]): WebhookAuth {
  if (mode === "hmac")
    return { mode, signature_header: "x-signature", encoding: "hex" };
  if (mode === "header") return { mode, header: "authorization", scheme: "Bearer" };
  return { mode };
}

export const defaultPoll: PollSettings = {
  request: { method: "GET", url: "", query: [], headers: [] },
  credentials: { placement: "none" },
  time_format: "iso",
  interval_seconds: 300,
  page: { size: null, size_param: "", more: "none", max_pages: 20 },
  records: "",
  cursor: { kind: "timestamp", pointer: "" },
  initial_lookback_seconds: 3600,
};

export function defaultSource(type: AdapterSourceType): AdapterSource {
  if (type === "platform") return { type, topics: [] };
  if (type === "vendor") return { type, url: "", topics: [] };
  if (type === "webhook") return { type, auth: defaultAuth("hmac") };
  return { type, ...structuredClone(defaultPoll) };
}

const clean = (value: string | null | undefined) => (value ?? "").trim();
const rows = (list: PollParam[]) =>
  list
    .map((row) => ({ name: row.name.trim(), value: row.value }))
    .filter((row) => row.name);

function authForSave(auth: WebhookAuth): WebhookAuth {
  if (auth.mode === "hmac")
    return {
      mode: "hmac",
      signature_header: clean(auth.signature_header).toLowerCase(),
      encoding: auth.encoding,
      ...(clean(auth.prefix) ? { prefix: clean(auth.prefix) } : {}),
      ...(clean(auth.timestamp_header)
        ? { timestamp_header: clean(auth.timestamp_header).toLowerCase() }
        : {}),
    };
  if (auth.mode === "header")
    return {
      mode: "header",
      header: clean(auth.header).toLowerCase() || "authorization",
      scheme: auth.scheme,
    };
  return { mode: "url" };
}

function pollForSave(source: PollSource): PollSource {
  const { request, credentials, page, cursor } = source;
  const size = Number(page.size) || null;
  return {
    type: "poll",
    request: {
      method: request.method,
      url: clean(request.url),
      query: rows(request.query),
      headers: rows(request.headers),
      ...(request.method === "POST" && clean(request.body)
        ? { body: request.body! }
        : {}),
    },
    credentials:
      credentials.placement === "header" || credentials.placement === "query"
        ? { placement: credentials.placement, name: clean(credentials.name) }
        : { placement: credentials.placement },
    time_format: source.time_format,
    interval_seconds: source.interval_seconds,
    page: {
      ...(size ? { size } : {}),
      ...(size && clean(page.size_param) ? { size_param: clean(page.size_param) } : {}),
      more: page.more,
      max_pages: page.max_pages,
    },
    records: clean(source.records),
    cursor:
      cursor.kind === "window"
        ? {
            kind: "window",
            ...(cursor.lag_seconds ? { lag_seconds: cursor.lag_seconds } : {}),
          }
        : { kind: cursor.kind, pointer: clean(cursor.pointer) },
    initial_lookback_seconds: source.initial_lookback_seconds,
  };
}

/** Only the chosen type's settings go to the server; the API refuses unknown fields. */
export function sourceForSave(source: AdapterSource, topics: string[]): AdapterSource {
  if (source.type === "platform") return { type: "platform", topics };
  if (source.type === "vendor")
    return { type: "vendor", url: clean(source.url), topics };
  if (source.type === "webhook")
    return { type: "webhook", auth: authForSave(source.auth) };
  return pollForSave(source);
}

/** The secret fields the chosen source and credential placement use. */
export function secretKeys(source: AdapterSource): (keyof AdapterSecrets)[] {
  if (source.type === "vendor") return ["username", "password", "ca_certificate"];
  if (source.type !== "poll") return [];
  const placement = source.credentials.placement;
  const keys: (keyof AdapterSecrets)[] =
    placement === "header" || placement === "query"
      ? ["api_key"]
      : placement === "bearer"
        ? ["token"]
        : placement === "basic"
          ? ["username", "password"]
          : [];
  return [...keys, "ca_certificate"];
}

/** Blank values keep the saved ones, so they are left out. */
export function secretsForSave(
  source: AdapterSource,
  secrets: AdapterSecrets | undefined,
): AdapterSecrets | undefined {
  const kept = Object.fromEntries(
    secretKeys(source)
      .map((key) => [key, secrets?.[key]] as const)
      .filter(([, value]) => value && value.trim()),
  ) as AdapterSecrets;
  return Object.keys(kept).length ? kept : undefined;
}

/** Hints shown beside the polling form; the server has the final word. */
export function pollIssues(source: PollSource): Record<string, string> {
  const issues: Record<string, string> = {};
  const url = source.request.url.trim();
  if (/[{}]/.test(url))
    issues.url = "Put placeholders in query parameters, not in the URL.";
  else if (url && !/^https:\/\//i.test(url))
    issues.url = /^http:\/\//i.test(url)
      ? "Use HTTPS. Plain HTTP is accepted only when the operator allows development addresses."
      : "Enter an HTTPS URL, for example https://api.vendor.example/v1/history.";
  else if (url && /^https:\/\/[^/]*@/i.test(url))
    issues.url = "Remove the credentials from the URL and enter them under Credentials.";
  if (source.cursor.kind === "window" && source.page.more === "full_page")
    issues.more = "A time window pages with a next-page token or not at all.";
  if (source.page.more === "token" && source.cursor.kind !== "token")
    issues.more = "Paging by next-page token needs a next-page token cursor.";
  if (source.page.more === "full_page" && !Number(source.page.size))
    issues.more = "Set a page size to page by full pages.";
  return issues;
}

export const placeholders = [
  "cursor",
  "window_start",
  "window_end",
  "now",
  "page_size",
] as const;

/** One Fetch now record as the decoder input it would become (FR-035). */
export function pollFixture(
  record: unknown,
  index: number,
  count: number,
  receivedAt: string,
  cursor: string | null | undefined,
): AdapterFixture {
  return {
    payload: record,
    source: "poll",
    received_at: receivedAt,
    poll: { page: 1, index, count, ...(cursor ? { cursor } : {}) },
  };
}

/** Appends a fixture to the editor's JSON; throws when the JSON is not an array. */
export function appendFixture(text: string, fixture: AdapterFixture) {
  let fixtures: unknown;
  try {
    fixtures = JSON.parse(text);
  } catch {
    throw new Error("Fix the sample fixtures JSON before adding another fixture.");
  }
  if (!Array.isArray(fixtures))
    throw new Error("Sample fixtures must be an array before adding another fixture.");
  const next = [...fixtures, fixture];
  return { text: JSON.stringify(next, null, 2), count: next.length };
}

export const checklistSteps: Record<ChecklistStep, { label: string; tab: string }> = {
  type: { label: "Device type", tab: "type" },
  connect: { label: "Connect", tab: "source" },
  samples: { label: "Capture samples", tab: "decoder" },
  decoder: { label: "Decoder", tab: "decoder" },
  deploy: { label: "Test and deploy", tab: "deploy" },
  activate: { label: "Activate devices", tab: "devices" },
};

/** "2026-10-27T09:12" in the browser's zone, for datetime-local inputs. */
export function localInput(at: number) {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const DAY = 86_400_000;
