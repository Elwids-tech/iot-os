# Data Model: HTTP Adapter Sources

## Source settings

`device_adapters.source` and each revision's `definition.source`. Secrets never appear
here: polling credentials go in `device_adapters.secrets` and the revision's
`secret_snapshot`; webhook secrets have their own table.

| Type | Settings |
| --- | --- |
| `platform` | `topics` (1–32 filters) — unchanged |
| `vendor` | `url`, `topics` — unchanged |
| `webhook` | `auth` (below) |
| `poll` | `request`, `credentials`, `time_format`, `interval_seconds`, `page`, `records`, `cursor`, `initial_lookback_seconds` (below) |

Topic filters of every type refuse the reserved prefix `iot-os/`.

### Webhook `auth`

| Field | Rule |
| --- | --- |
| `mode` | `hmac` (recommended), `header` or `url` |
| `header` | header mode: header name, default `authorization`; lower-case token characters, ≤ 64 |
| `scheme` | header mode: `Bearer` (default) or empty for the raw secret |
| `signature_header` | hmac mode: required, ≤ 64 (for example `x-signature`) |
| `encoding` | hmac mode: `hex` (default) or `base64` |
| `prefix` | hmac mode: optional, ≤ 32 printable characters (for example `sha256=`) |
| `timestamp_header` | hmac mode: optional; when set the signed string is `<timestamp>.<body>` and the timestamp (epoch seconds or ISO 8601) must be within 5 minutes |

### Polling settings

| Field | Rule |
| --- | --- |
| `request.method` | `GET` or `POST` |
| `request.url` | `https:` (or `http:` only with the development switch), host required, no user info, no fragment, no placeholders, ≤ 2,000 characters; literal non-public addresses refused |
| `request.query`, `request.headers` | ≤ 20 `{name, value}` each; values ≤ 1,000 and may use `{cursor}`, `{window_start}`, `{window_end}`, `{now}`, `{page_size}`; header names refuse `authorization`, `cookie`, `host` and proxy headers |
| `request.body` | `POST` only: a JSON template ≤ 16 KiB with the same placeholders |
| `credentials.placement` | `none`, `header` (with `name`), `query` (with `name`), `bearer` or `basic` |
| `time_format` | `iso` (default), `epoch_s`, `epoch_ms`: how `{now}`, window bounds and generated cursors are written |
| `interval_seconds` | 60–86,400, default 300 |
| `page.size`, `page.size_param` | optional page size 1–5,000 sent as that query parameter |
| `page.more` | `full_page` (default when a size is set), `token` or `none` |
| `page.max_pages` | 1–100, default 20 |
| `records` | JSON Pointer to the records array; empty for a top-level array |
| `cursor.kind` | `timestamp` (with `pointer`), `token` (with `pointer`) or `window` (with optional `lag_seconds` 0–3,600) |
| `initial_lookback_seconds` | 60–2,592,000 (30 days), default 3,600 |

Polling secrets (`secrets`): `api_key` (header or query placement), `token` (bearer),
`username` and `password` (basic), `ca_certificate` (optional private CA). Blank
values keep the saved ones, as for vendor brokers.

## Fixtures

Each fixture: `topic?`, `payload?` or `payload_base64?`, `expect_error?`, `expected?`,
and new optional `source` (`mqtt`, `webhook`, `poll`), `received_at`, `http`
`{method, path, query, content_type, headers}` and `poll`
`{page, index, count, cursor}`. A draft may have no fixtures; testing needs 1–10.

## New and changed tables

### `device_adapters` (changed)

| Column | Type | Notes |
| --- | --- | --- |
| `ingest_id` | string(40), unique, nullable | set on the first save as a webhook source; never reused |
| `poll_state` | jsonb, nullable | `{state: polling\|retrying\|stopped, reason?, next_run_at?, last_run_at?, cursor: {value, kind, committed_at, run_id}}` from runtime reports |
| `cursor_generation` | integer, default 0 | increases on first deploy, reset and resume |
| `cursor_start` | timestamptz, nullable | the start chosen for the next generation |

### `device_adapter_webhook_secrets` (new)

`id`, `uuid`, `organization_id`, `device_adapter_id` (cascade), `label` (≤ 80),
`origin` (`generated` \| `vendor`), `secret` (encrypted text), `created_by`
(`user_id`), `last_used_at`, `expires_at`, `revoked_at`, timestamps. At most two rows
with `revoked_at` null and `expires_at` null or in the future. Rotation sets the
previous active secret's `expires_at` to now + 7 days.

### `device_adapter_deliveries` (new)

`id`, `uuid`, `organization_id`, `device_adapter_id` (cascade), `kind` (`sample` \|
`rejected` \| `failed`), `reason` (≤ 40: `unauthenticated`, `stale_signature`,
`too_large`, `rate_limited`, `paused`, `broker_unavailable`, `bad_request`,
`decode_failed`, `validation_failed`), `source` (`webhook` \| `poll` \| `mqtt`),
`received_at`, `source_address` (≤ 45, rejected only), `path` (≤ 512), `content_type`
(≤ 255), `size`, `delivery_id` (≤ 64), `error` (≤ 300), `input` (jsonb: the fixture
shape above; body excerpt ≤ 64 KiB for samples, ≤ 16 KiB for failures, never for
unauthenticated deliveries), `report_id` (unique per adapter, for idempotency),
`created_at`. Pruned after 7 days.

### `device_adapter_outcome_counts` (new)

Primary key (`device_adapter_id`, `bucket` hour, `outcome`); `organization_id`,
`count`. Outcomes: `accepted`, `unauthenticated`, `stale_signature`, `too_large`,
`rate_limited`, `paused`, `broker_unavailable`, `bad_request`, `decoded`,
`decode_failed`, `validation_failed`, `duplicate`, `historical`. Pruned after 8 days.

### `device_adapter_poll_runs` (new)

`id`, `uuid`, `organization_id`, `device_adapter_id` (cascade), `run_id` (unique per
adapter), `revision_uuid`, `started_at`, `finished_at`, `outcome` (`ok`, `empty`,
`partial`, `retrying`, `stopped`), `http_status`, `pages`, `records`, `published`,
`failed`, `duplicates`, `cursor_before`, `cursor_after` (≤ 512), `error` (≤ 300),
`next_attempt_at`. Pruned after 7 days.

### `device_adapter_proposals` (changed)

`device_adapter_id` becomes nullable (create proposals have none yet); new `kind`
(`change` default, `create`, `reuse`), `name`, `artifact_uuid`, `source` (jsonb,
non-secret settings) and `fixtures` (jsonb). `code` becomes nullable. The content hash
covers every field.

### `assistant_conversations` (data only)

`scope = 'adapter'` rows become `'onboarding'`. `device_adapter_id` and
`device_profile_id` may both be null at the start of an onboarding conversation.
`onboarding_state` gains `path` (`direct` \| `gateway` \| `adapter`) and
`source_type`.

## Runtime state files (tenant `/data`)

| File | Content |
| --- | --- |
| `poll-<adapter>.json` | `{generation, cursor, kind, committed_at, run_id}` |
| `dedup-<adapter>.log` | `<epoch ms> <key>` lines |
| `observed-<adapter>.json` | `{<sourceDeviceId hash>: newest observedAt ms}` |
| `bdseq-<adapter>.json` | unchanged |

## States

### Polling source

```text
deployed ─▶ polling ─(network, 408, 429, 5xx)─▶ retrying ─(success)─▶ polling
                 └─(400, 401, 403, 404, not JSON, no records location)─▶ stopped
stopped ─(new revision deployed, or resume)─▶ polling
```

### Webhook source

| State | Rule |
| --- | --- |
| `no_deliveries` | no accepted delivery yet |
| `receiving` | an accepted delivery in the last 24 hours and no rejection in the last hour |
| `rejecting` | a rejection in the last hour |
| `idle` | the last accepted delivery is older than 24 hours |

Receiver route states: `sampling` (no deployed revision: answer `202`, report samples),
`running`, `paused` (`503`), removed (`404`).

### Setup checklist (FR-100)

| Step | Done when | Waiting / attention |
| --- | --- | --- |
| Device type | adapter saved with a published profile | — |
| Connect | MQTT: tenant ready or vendor connection test passed; webhook: an active secret; polling: saved credentials (or `none`) and a successful Fetch now | webhook: **Waiting for the first delivery**; polling: last Fetch now failed |
| Capture samples | ≥ 1 fixture | samples captured but not added |
| Decoder | the draft's decoder differs from the starter and its last test had output | test failed |
| Test and deploy | applied revision is the current draft and running | pending deployment; failed deployment |
| Activate devices | ≥ 1 activated installation | discovered sources waiting |

## Validation summary

- Webhook settings refuse unknown fields; a URL-token adapter's ingest URL is shown
  with its token only when a secret is created.
- Polling settings refuse placeholders in the URL, unknown placeholders, embedded
  credentials, credential headers, literal private addresses and out-of-range limits.
- Proposals' `source` passes the same validation as a save; their `fixtures` pass the
  fixture rules.
