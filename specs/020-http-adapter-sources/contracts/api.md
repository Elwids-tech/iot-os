# Portal API: HTTP Adapter Sources

Under `/api/v1/organizations/{organization}/device-adapters/{adapter}` unless noted.
All routes return 404 when adapters are disabled, resolve the organization first, and
use the permission named (FR-081). Responses never include secret values except the
one-time `secret` on creation.

## Adapter create and update (changed)

`source` accepts the four types in the [data model](../data-model.md#source-settings);
`secrets` accepts `api_key`, `token`, `username`, `password` and `ca_certificate` for
polling. `fixtures` may be empty. The adapter view adds:

```json
{
  "source": { "type": "poll", "request": { "method": "GET", "url": "https://api.example.com/accounts/A1/streams/history", "query": [{ "name": "start", "value": "{cursor}" }] }, "...": "..." },
  "credentials_configured": true,
  "webhook": { "available": true, "ingest_url": "https://hooks.example.com/w/3Hk…", "state": "no_deliveries" },
  "polling": { "state": "polling", "reason": null, "next_run_at": "…", "cursor": { "value": "2026-10-27T09:12:00Z", "kind": "timestamp", "committed_at": "…" } },
  "checklist": [{ "step": "connect", "state": "waiting", "detail": "Waiting for the first delivery" }]
}
```

`webhook.available` is false when the operator has not configured an ingest address
(FR-003). The directory row adds `source_state`.

## Webhook

| Method and path | Permission | Result |
| --- | --- | --- |
| `GET webhook` | `Device.view` | `{ingest_url, auth, state, secrets: [{uuid, label, origin, created_at, created_by: {user_id, name}, last_used_at, expires_at, revoked_at}], counts: {"24h": {outcome: n}, "7d": {…}}}` |
| `POST webhook/secrets` `{label, value?}` | `Device.manage-connections` | `201 {secret: {uuid, …}, value, ingest_url}`; `value` is the generated secret or omitted when pasted; with two active secrets: `422` |
| `POST webhook/secrets/{secret}/revoke` | `Device.manage-connections` | `{revoked: true}`; refused for another adapter's secret (`404`) |
| `GET deliveries?kind=sample\|rejected\|failed` | `Device.view` | `{data: [{uuid, kind, reason, source, received_at, source_address?, path, content_type, size, delivery_id, error, input?}]}`, last 20 per kind |

## Polling

| Method and path | Permission | Result |
| --- | --- | --- |
| `POST fetch-now` `{draft_revision}` | `Device.manage-connections`; throttle 6/min per adapter (shared with the assistant) | `{status, duration_ms, headers, excerpt, truncated, record_count, records: [≤20], next_cursor, more, error?}` with credentials redacted |
| `GET poll-runs` | `Device.view` | `{data: [run…], state, cursor, next_run_at}` |
| `POST cursor` `{start_at}` | `Device.manage-connections` + `Device.manage` | `202 {operation}`; redeploys the applied revision with the next cursor generation; audited `device.adapter.cursor.reset` |
| `POST resume` | `Device.manage-connections` + `Device.manage` | `202 {operation}`; only when `stopped` |

`deploy` accepts `cursor_start_at` (≤ 30 days back) for the first deployment of a
polling adapter.

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
