# Portal API: HTTP Adapter Sources

Under `/api/v1/organizations/{organization}/device-adapters/{adapter}` unless noted.
All routes return 404 when adapters are disabled, resolve the organization first, and
use the permission named (FR-081). Responses never include secret values except the
one-time `secret` on creation.

## Adapter create and update (changed)

`source` accepts the four types in the [data model](../data-model.md#source-settings);
`secrets` accepts `api_key`, `token`, `username`, `password` and `ca_certificate` for
polling. `fixtures` may be empty. The adapter view (`GET`, `POST`, `PUT`) adds:

```json
{
  "source": { "type": "poll", "request": { "method": "GET", "url": "https://api.example.com/accounts/A1/streams/history", "query": [{ "name": "start", "value": "{cursor}" }], "headers": [] }, "credentials": { "placement": "header", "name": "x-api-key" }, "time_format": "iso", "interval_seconds": 300, "page": { "size": 500, "size_param": "limit", "more": "full_page", "max_pages": 20 }, "records": "/data", "cursor": { "kind": "timestamp", "pointer": "/maxDate" }, "initial_lookback_seconds": 3600 },
  "credentials_configured": true,
  "saved_secrets": { "api_key": true, "token": false, "username": false, "password": false, "ca_certificate": false },
  "webhook": { "available": true, "ingest_url": "https://hooks.example.com/w/3Hk…", "state": "no_deliveries", "last_delivery_at": null, "active_secrets": 0 },
  "polling": { "state": "polling", "reason": null, "next_run_at": "…", "last_run_at": "…", "cursor": { "value": "2026-10-27T09:12:00Z", "kind": "timestamp", "committed_at": "…" } },
  "source_state": { "state": "polling", "label": "Polling", "detail": null },
  "checklist": [
    { "step": "type", "state": "done", "detail": "Tracker profile" },
    { "step": "connect", "state": "waiting", "detail": "Waiting for the first delivery" },
    { "step": "samples", "state": "todo", "detail": null },
    { "step": "decoder", "state": "todo", "detail": null },
    { "step": "deploy", "state": "todo", "detail": null },
    { "step": "activate", "state": "todo", "detail": null }
  ]
}
```

- `webhook` is present for every adapter: `available` is false when the operator has
  not configured an ingest address (FR-003); the other fields are null unless the
  source is a webhook. In URL token mode `ingest_url` ends at the identifier.
- `polling` is null unless the source is polling; `state` is `not_deployed` before the
  first deployment.
- `source_state.state`: `connected`, `disconnected`, `receiving`, `no_deliveries`,
  `rejecting`, `idle`, `polling`, `retrying`, `stopped`, `not_deployed`.
- `checklist[].state`: `done`, `waiting`, `attention`, `todo`.
- The directory row adds `source_state`.
- `deploy` accepts `cursor_start_at` (ISO 8601, at most 30 days back) for the first
  deployment of a polling adapter.

## Webhook

| Method and path | Permission | Result |
| --- | --- | --- |
| `GET webhook` | `Device.view` | `{data: {ingest_url, auth, state, secrets: [Secret], counts: {"24h": {outcome: n}, "7d": {outcome: n}}}}` |
| `POST webhook/secrets` `{label, value?}` | `Device.manage-connections` | `201 {data: {secret: Secret, value, ingest_url}}`; `value` is the generated secret (shown once) or null when pasted; `ingest_url` includes the token in URL token mode; with two active secrets: `422` |
| `POST webhook/secrets/{secret}/revoke` | `Device.manage-connections` | `{data: {revoked: true}}`; another adapter's secret: `404` |
| `GET deliveries?kind=sample\|rejected\|failed` | `Device.view` | `{data: [Delivery]}`, the last 20 of that kind (all kinds when omitted, 20 each) |

`Secret`: `{uuid, label, origin: generated|vendor, created_at, created_by: {user_id, name} | null, last_used_at, expires_at, revoked_at, active}`.

`Delivery`: `{uuid, kind, reason, source: webhook|poll|mqtt, received_at, source_address, path, content_type, size, delivery_id, error, input}` where `input` is a fixture (`{topic, payload_base64, truncated?, source, received_at, http?, poll?}`) or null (rejected deliveries never keep a body).

Outcome names: `accepted`, `unauthenticated`, `stale_signature`, `too_large`,
`rate_limited`, `paused`, `broker_unavailable`, `bad_request`, `decoded`,
`decode_failed`, `validation_failed`, `duplicate`, `historical`.

## Polling

| Method and path | Permission | Result |
| --- | --- | --- |
| `POST fetch-now` `{draft_revision}` | `Device.manage-connections`; 6 a minute per adapter, shared with the assistant (`429` beyond) | `{data: FetchResult}` |
| `GET poll-runs` | `Device.view` | `{data: [Run], polling: Polling}` |
| `POST cursor` `{request_uuid, start_at}` | `Device.manage-connections` + `Device.manage` | `202 {data: Operation}`; redeploys the applied revision with the next cursor generation; audited `device.adapter.cursor.reset` |
| `POST resume` `{request_uuid}` | `Device.manage-connections` + `Device.manage` | `202 {data: Operation}`; `422` unless polling is `stopped` |

`FetchResult`: `{status, duration_ms, headers, excerpt, truncated, record_count, records: [≤ 20], next_cursor, more, error}` (credentials redacted; `status` null when nothing answered).

`Run`: `{uuid, run_id, started_at, finished_at, outcome: ok|empty|partial|retrying|stopped, http_status, pages, records, published, failed, duplicates, cursor_before, cursor_after, error, next_attempt_at}`.

## Onboarding assistant (changed)

- `GET /assistant/settings?scope=onboarding`, `GET /assistant/conversations?scope=onboarding`,
  `POST /assistant/conversations` `{scope: "onboarding", adapter_uuid?}`; `scope=adapter`
  is accepted as an alias for one release.
- `GET device-adapter-proposals?conversation={id}` lists the person's proposals in an
  onboarding conversation, including `create` ones that have no adapter yet.
- `POST device-adapter-proposals/{proposal}/decision` `{action: apply|reject,
  content_hash, draft_revision?}` (organization level): `reuse` binds the conversation;
  `create` creates the draft (`Device.manage` + `Device.manage-connections`) and binds
  it; `change` saves one draft revision. The adapter-scoped decision route stays for
  `change` proposals.

## Internal

- `POST /api/internal/adapters/events` (tenant runtime token) accepts the new kinds in
  [runtime-events.md](runtime-events.md).
- `POST /api/internal/adapters/receiver-reports` (`IOT_WEBHOOK_RECEIVER_TOKEN`)
  accepts [receiver reports](receiver.md#reports).
