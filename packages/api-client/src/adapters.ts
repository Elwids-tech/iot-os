import type { CompiledDeviceProfileDefinition, Device } from "./index";
export type AdapterSourceType = "platform" | "vendor" | "webhook" | "poll";
/** How a webhook delivery proves it comes from the customer's vendor account. */
export type WebhookAuth =
  | {
      mode: "hmac";
      signature_header: string;
      encoding: "hex" | "base64";
      prefix?: string | null;
      /** When set, the signed string is `<timestamp>.<body>` and the timestamp must be within 5 minutes. */
      timestamp_header?: string | null;
    }
  | { mode: "header"; header: string; scheme: "Bearer" | "" }
  | { mode: "url" };
export type PollParam = { name: string; value: string };
export type PollPlaceholder = "cursor" | "window_start" | "window_end" | "now" | "page_size";
export type PollCredentials =
  | { placement: "none" | "bearer" | "basic" }
  | { placement: "header" | "query"; name: string };
export type PollCursorSettings =
  | { kind: "timestamp" | "token"; pointer: string }
  | { kind: "window"; lag_seconds?: number | null };
export type PollSettings = {
  request: {
    method: "GET" | "POST";
    url: string;
    query: PollParam[];
    headers: PollParam[];
    /** POST only: a JSON template with the same placeholders, at most 16 KiB. */
    body?: string | null;
  };
  credentials: PollCredentials;
  time_format: "iso" | "epoch_s" | "epoch_ms";
  interval_seconds: number;
  page: {
    size?: number | null;
    size_param?: string | null;
    more: "full_page" | "token" | "none";
    max_pages: number;
  };
  /** JSON Pointer to the records array; empty for a top-level array. */
  records: string;
  cursor: PollCursorSettings;
  initial_lookback_seconds: number;
};
export type AdapterSource =
  | { type: "platform"; topics: string[] }
  | { type: "vendor"; url?: string | null; topics: string[] }
  | { type: "webhook"; auth: WebhookAuth }
  | ({ type: "poll" } & PollSettings);
export type AdapterFixture = {
  /** Optional for sources without topics (webhooks without a path, polled records). */
  topic?: string;
  payload?: unknown;
  payload_base64?: string;
  expect_error?: boolean;
  expected?: { name: string; value: unknown }[];
  source?: "mqtt" | "webhook" | "poll";
  received_at?: string;
  http?: {
    method: string;
    path: string;
    query: Record<string, string | string[]>;
    content_type: string | null;
    headers: Record<string, string>;
  };
  poll?: { page: number; index: number; count: number; cursor?: string | null };
  /** The body was cut to the capture limit. */
  truncated?: boolean;
};
export type AdapterTest = {
  valid: boolean;
  results: {
    passed: boolean;
    output?: {
      sourceDeviceId: string;
      metrics: {
        name: string;
        value: unknown;
        datatype: string;
        unit: string | null;
      }[];
    };
    error?: string;
  }[];
};
export type AdapterRevision = {
  uuid: string;
  revision: number;
  content_hash: string;
  tested_at: string | null;
  test_result: AdapterTest | null;
};
export type AdapterDraft = {
  name: string;
  artifact_uuid: string;
  code: string;
  fixtures: AdapterFixture[];
  source: AdapterSource;
  secrets?: AdapterSecrets;
};
/** Write-only: blank values keep the saved ones. */
export type AdapterSecrets = {
  username?: string;
  password?: string;
  ca_certificate?: string;
  api_key?: string;
  token?: string;
};
export type AdapterSourceStateValue =
  | "connected"
  | "disconnected"
  | "receiving"
  | "no_deliveries"
  | "rejecting"
  | "idle"
  | "polling"
  | "retrying"
  | "stopped"
  | "not_deployed";
export type AdapterSourceState = {
  state: AdapterSourceStateValue;
  label: string;
  detail: string | null;
};
export type ChecklistStep = "type" | "connect" | "samples" | "decoder" | "deploy" | "activate";
export type ChecklistItem = {
  step: ChecklistStep;
  state: "done" | "waiting" | "attention" | "todo";
  detail: string | null;
};
/** Present for every adapter; the fields after `available` are null unless the source is a webhook. */
export type AdapterWebhook = {
  available: boolean;
  /** In URL token mode this ends at the identifier; the token is shown only when a secret is created. */
  ingest_url: string | null;
  state: "no_deliveries" | "receiving" | "rejecting" | "idle" | null;
  last_delivery_at: string | null;
  active_secrets: number | null;
};
export type AdapterPolling = {
  state: "not_deployed" | "polling" | "retrying" | "stopped";
  reason: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  cursor: {
    value: string | null;
    kind: string;
    committed_at: string | null;
    run_id?: string | null;
  } | null;
};
export type DeviceAdapter = AdapterDraft & {
  uuid: string;
  draft_revision: number;
  profile_name: string;
  profile: CompiledDeviceProfileDefinition;
  status: string;
  diagnostic: string | null;
  credentials_configured: boolean;
  saved_secrets: Record<"api_key" | "token" | "username" | "password" | "ca_certificate", boolean>;
  webhook: AdapterWebhook;
  /** Null unless the source is polling. */
  polling: AdapterPolling | null;
  source_state: AdapterSourceState;
  checklist: ChecklistItem[];
  applied_revision_uuid: string | null;
  desired_revision_uuid: string | null;
  revision: AdapterRevision;
  revisions: AdapterRevision[];
  health: {
    source_connected?: boolean;
    upstream_connected?: boolean;
    last_message_at?: string;
    checked_at?: string;
  } | null;
  operations: {
    uuid: string;
    action: string;
    status: string;
    diagnostic: string | null;
    revision_uuid: string;
  }[];
};
export type AdapterDirectory = {
  data: Pick<
    DeviceAdapter,
    | "uuid"
    | "name"
    | "status"
    | "profile_name"
    | "source"
    | "health"
    | "diagnostic"
    | "source_state"
  >[];
  tenant: {
    uuid: string;
    status: string;
    broker_url: string | null;
    diagnostic: string | null;
  } | null;
  capabilities: {
    view: boolean;
    manage: boolean;
    connections: boolean;
    activate: boolean;
  };
};
export type AdapterProfile = {
  uuid: string;
  name: string;
  revision: number;
  definition: CompiledDeviceProfileDefinition;
};
export type AdapterCandidate = {
  uuid: string;
  source_device_id: string;
  status: string;
  last_seen_at: string;
  preview: {
    sourceDeviceId: string;
    metrics: { name: string; value: unknown; unit: string | null }[];
    retained?: boolean;
  };
  installation_uuid: string | null;
  device: Device | null;
  /** The latest decoder input for this source, when kept, so it can become a fixture. */
  input?: AdapterFixture | null;
};
export type AdapterCredential = {
  uuid: string;
  name: string;
  username: string;
  revoked_at: string | null;
};
export type AdapterKit = {
  filename?: string;
  archive_base64?: string;
  broker_url: string;
  ca_certificate: string;
  credential_uuid: string;
  username: string;
  password: string;
  publish_topics: string[];
  instructions: string;
};
export type AdapterProposal = {
  uuid: string;
  code: string;
  summary: string;
  evidence: {
    origin: string;
    note?: string;
    source_id?: string;
    location?: string;
  }[];
  content_hash: string;
  draft_revision: number;
  status: string;
};
export type WebhookSecret = {
  uuid: string;
  label: string;
  origin: "generated" | "vendor";
  created_at: string;
  created_by: { user_id: number; name: string } | null;
  last_used_at: string | null;
  /** Set on the previous secret by a rotation: it keeps working until then. */
  expires_at: string | null;
  revoked_at: string | null;
  active: boolean;
};
export type AdapterOutcome =
  | "accepted"
  | "unauthenticated"
  | "stale_signature"
  | "too_large"
  | "rate_limited"
  | "paused"
  | "broker_unavailable"
  | "bad_request"
  | "decoded"
  | "decode_failed"
  | "validation_failed"
  | "duplicate"
  | "historical";
export type WebhookDetail = {
  ingest_url: string | null;
  auth: WebhookAuth | null;
  state: AdapterWebhook["state"];
  secrets: WebhookSecret[];
  counts: {
    "24h": Partial<Record<AdapterOutcome, number>>;
    "7d": Partial<Record<AdapterOutcome, number>>;
  };
};
export type CreatedWebhookSecret = {
  secret: WebhookSecret;
  /** The generated secret, shown once; null when the person pasted a vendor secret. */
  value: string | null;
  /** Includes the token in URL token mode. */
  ingest_url: string | null;
};
export type AdapterDelivery = {
  uuid: string;
  kind: "sample" | "rejected" | "failed";
  reason: string | null;
  source: "webhook" | "poll" | "mqtt";
  received_at: string;
  source_address: string | null;
  path: string | null;
  content_type: string | null;
  size: number | null;
  delivery_id: string | null;
  error: string | null;
  /** A fixture; rejected deliveries never keep a body. */
  input: AdapterFixture | null;
};
export type FetchResult = {
  /** Null when nothing answered. */
  status: number | null;
  duration_ms: number | null;
  headers: Record<string, string>;
  excerpt: string;
  truncated: boolean;
  record_count: number;
  records: unknown[];
  next_cursor: string | null;
  more: boolean;
  error: string | null;
};
export type PollRun = {
  uuid: string;
  run_id: string;
  started_at: string;
  finished_at: string | null;
  outcome: "ok" | "empty" | "partial" | "retrying" | "stopped";
  http_status: number | null;
  pages: number;
  records: number;
  published: number;
  failed: number;
  duplicates: number;
  cursor_before: string | null;
  cursor_after: string | null;
  error: string | null;
  next_attempt_at: string | null;
};
export type AdapterOperation = {
  uuid: string;
  status: string;
  action?: string;
  diagnostic?: string | null;
  revision_uuid?: string;
};
