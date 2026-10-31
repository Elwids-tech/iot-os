# Portal API: Data-First Device Onboarding

Routes are under `/api/v1/organizations/{organization}` unless noted.

- Every route resolves the organization and checks membership before permission.
- Adapter connectors' routes return 404 when device adapters are disabled.
- Responses never include secret values.
- Every change is additive and updates `contracts/openapi/openapi.json` (through
  `php artisan contract:export`), its supplements and `packages/api-client` in the
  same pull request (FR-120).

## Connectors (new)

### `GET connectors` (`Device.view`)

```json
{
  "data": [
    {
      "key": "webhook",
      "answer": "vendor_cloud.webhook",
      "title": "Their cloud sends to a web address",
      "summary": "We give you an address and a secret to paste into the vendor's webhook settings.",
      "needs": ["Access to the vendor cloud's webhook or integration settings"],
      "availability": { "available": false, "reason": "webhooks_not_configured", "message": "Webhooks need the operator to set a public address for this platform." },
      "capture": "webhook_samples",
      "readings": "field_mapping",
      "reasons": [{ "code": "signature_invalid", "title": "Signature does not match", "explanation": "…", "fix": "…" }]
    }
  ]
}
```

- Unavailable connectors are listed with their reason (FR-006 and US8 scenario 1).
- With device adapters disabled, only the two native connectors are returned
  (FR-006).

## Setups (new)

### `GET device-setups?status=unfinished` (`Device.view`)

Returns up to 50 setups, newest first. Each has `{uuid, kind, connector, step,
status, waiting_permission, adapter: {uuid, name}?, device: {uuid, name}?,
started_by: {user_id, name}, updated_at}`. The Devices page and Home use it.

### `POST device-setups` (`Device.manage`)

```json
{ "request_uuid": "…", "kind": "new", "connector": null, "start_answer": null, "copy_from_adapter_uuid": null, "another_of_adapter_uuid": null, "pasted_sample": { "topic_or_path": "sensors/ENV-0042/telemetry", "payload": "{\"device_id\":\"ENV-0042\",\"ts\":1761638400,\"temperature\":21.7}" } }
```

- The request is idempotent on `request_uuid`.
- **`copy`** also needs `Device.manage-connections`. It creates the draft adapter as
  described in [research R14](../research.md#r14-another-device-of-a-type-and-copying-a-setup).
- **`another`** needs `Device.manage-connections` for tenant-broker sources, because
  it creates a hardware credential.

It returns the setup view (next section).

### `GET device-setups/{setup}` (`Device.view`)

```json
{
  "uuid": "…", "kind": "new", "connector": "tenant_mqtt", "step": "data", "status": "open",
  "steps": [
    { "key": "connect", "state": "done", "detail": "Kit downloaded · credential ENV-0042" },
    { "key": "data", "state": "waiting", "detail": "Listening on every topic your device uses" },
    { "key": "readings", "state": "todo", "detail": null },
    { "key": "collect", "state": "todo", "detail": null }
  ],
  "adapter": { "…": "the adapter view, with mode and status" },
  "onboarding": null,
  "capture": { "until": "2026-10-28T10:42:00Z", "state": "listening", "reasons": [{ "code": "credentials_rejected", "at": "…", "subject": "ENV-0042" }] },
  "pasted_samples": [],
  "activation_selection": [],
  "rollout": null,
  "cards": { "open": 1, "applied": 4 },
  "conversation_uuid": "…",
  "waiting_permission": null
}
```

- `steps[].state` is one of `todo`, `waiting`, `attention` or `done`. It is derived
  as described in the [data model](../data-model.md#device_setups-new).
- `onboarding` is the native onboarding view, for native connectors.
- `capture.state` is one of `listening`, `stopped`, `paused` or `not_applicable`.
- `capture.reasons[].code` comes from the connector's catalogue.

### `PATCH device-setups/{setup}` (`Device.manage`)

The body takes any of `connector`, `start_answer`, `step`, `pasted_samples` (the
whole list, at most 10) and `activation_selection`. It returns the setup view.

- `connector` can change only while no source is saved.
- `step` records step times. It cannot move past a step whose prerequisites are not
  done (422 with the step).

### `DELETE device-setups/{setup}` (`Device.manage`)

Discards the setup. The draft adapter is deleted only when it was never applied and
nothing uses it; otherwise it stays and opens in Manage. Returns 204.

### `POST device-setups/{setup}/capture` (`Device.manage`)

Starts or renews the capture lease for 30 minutes. Returns
`{until, state, reasons}`. The portal calls it every 60 seconds while See data or
Choose readings is open.

### `POST device-setups/{setup}/device-type/matches` (`Device.view`)

The body is `{readings: [{key, label, data_type, unit}]}`. It returns up to 5
published profiles:

```json
{ "data": [ { "profile_uuid": "…", "artifact_uuid": "…", "name": "Environment sensor", "revision": 3, "score": 0.83,
  "matched": [{ "reading": "temperature", "key": "temperature", "unit": "°C", "unit_difference": null }],
  "missing": ["battery_v"], "extra": ["pressure"],
  "unit_differences": [{ "reading": "battery_v", "from": "mV", "to": "V", "scale": 0.001, "offset": 0 }] } ] }
```

### `PUT device-setups/{setup}/device-type` (`DeviceProfile.create`, or `DeviceProfile.update` for an existing draft)

The body takes either `{reuse: {artifact_uuid}}` or `{draft: {name, readings: [{key,
label, data_type, unit}], draft_revision?}}`.

- `draft` creates or updates the setup's draft profile. It is a 409 if the profile
  changed since `draft_revision`.
- Either way the adapter's `artifact_uuid` or `draft_profile_uuid` is set in a new
  adapter draft revision.

It returns the setup view.

### `POST device-setups/{setup}/start` (permissions per step, below)

```json
{ "request_uuid": "…", "draft_revision": 7, "serials": [{ "source_device_id": "ENV-0042", "name": "Lab sensor 1" }] }
```

- Returns 202 with the rollout.
- Confirming again with the same `request_uuid` returns the same rollout.
- Confirming a failed or waiting rollout with a new `request_uuid` resumes it.
- The route is not in the agent-access tool catalogue (spec 004). No assistant tool
  calls it (FR-074).

The permission is checked when each step runs:

| Step | Permission |
| --- | --- |
| `check`, `bind` | `Device.manage` |
| `publish` | `DeviceProfile.publish` |
| `deploy` | `Device.manage` and `Device.manage-connections` |
| `activate` | `Device.activate`, `Device.manage` and `Device.manage-connections` |

The rollout view:

```json
{ "uuid": "…", "kind": "start", "status": "waiting",
  "steps": [
    { "key": "check", "label": "Test", "state": "done", "finished_at": "…", "actor": { "user_id": 12 } },
    { "key": "publish", "label": "Publish device type", "state": "done" },
    { "key": "bind", "label": "Test the final revision", "state": "done" },
    { "key": "deploy", "label": "Deploy", "state": "done" },
    { "key": "activate", "label": "Activate devices", "state": "waiting", "reason": "permission_missing", "permission": "Device.activate", "fix": "Ask someone who can activate devices to open this setup and confirm." } ],
  "serials": [{ "source_device_id": "ENV-0042", "name": "Lab sensor 1", "state": "waiting" }],
  "first_readings": [{ "device_uuid": "…", "parameter": "temperature", "value": 21.7, "unit": "°C", "stored_at": "…" }],
  "diagnosis": null }
```

`diagnosis` is set when no reading has been stored 2 minutes after activation
(FR-054). It looks like `{received_at, decoded_at, published_at, stored_at,
first_failure: {hop, reason, at}}`, and each time is null when unknown.

### `GET device-setups/{setup}/conversation` (`Device.manage`, assistant enabled)

Returns the setup's one onboarding conversation, creating it if needed
(`assistant_conversations.device_setup_id` is unique). The panel opens this
conversation on every page of the setup and its source (FR-071).

### `GET device-setups/{setup}/cards?state=open` (`Device.view`)

Returns the setup's action cards ([tools contract](onboarding-tools.md#cards-suggestcard)):
`{uuid, card, step, fields, summary, evidence, state, content_hash, draft_revision,
result?, created_at}`.

- `state` is one of `open`, `applied`, `out_of_date` or `dismissed`.
- `result` is set once applied and never holds a secret.

### Applying a card

There is no separate "apply" route. The card's control calls the step's own endpoint
with `suggestion: {uuid, content_hash}`, exactly as the form's save does:

| Card | Endpoint |
| --- | --- |
| `connector` | `PATCH device-setups/{setup}` |
| `settings`, `credentials`, `mapping`, `code`, `fixtures` | `POST` or `PUT device-adapters/{adapter}` |
| `device_type` | `PUT device-setups/{setup}/device-type` |
| `secret` | the webhook secret route (spec 020) |
| `kit` | the hardware credential route |
| `native_device` and `native_matches` | the native onboarding routes |
| `start` | `POST device-setups/{setup}/start` |
| `activate` | `POST device-adapters/{adapter}/candidates/activate` |

Each of these routes:

- accepts the optional `suggestion` object;
- refuses a stale `content_hash` with 409;
- records the card as applied with its result;
- adds the event message that continues the conversation (FR-130).

The `start` and `activate` routes, and the secret and credential routes, are
session-only. No assistant tool or agent-access token reaches them (principle V).

### `POST device-setups/{setup}/cards/{proposal}/dismiss` (`Device.manage`)

Takes `{content_hash}` and records the card as dismissed. The event message asks the
assistant what to change.

## Device adapters (changed)

All routes are under `device-adapters`.

- **`POST` and `PUT {adapter}`**:
  - `artifact_uuid` becomes optional; `draft_profile_uuid`, `mapping`, `code_origin`
    and `suggestion: {uuid, content_hash}` are new (see the
    [data model](../data-model.md#device_adapters-changed)).
  - A `platform` source may have no topics before its first deploy.
  - It is a 422 when `code_origin = mapping` and the code is not the compiled
    mapping.
- **The view** adds `mode`, `status`, `capture_until`, `mapping`, `code_origin` and
  `draft_profile`. The index adds `mode` and `status`. The index drops nothing;
  `source_state` remains for older clients.
- **`GET {adapter}/captures?limit=20`** (`Device.view`): captured input for every
  source type, newest first.
  - Each item is `{uuid, source, received_at, topic_or_path, size, retained, qos,
    off_filter, truncated, content_type, input}`.
  - It also returns `counts: {received, off_filter, ignored, rejected}` for the last
    hour.
  - It replaces the portal's use of `deliveries?kind=sample` for See data.
- **`POST {adapter}/capture`** (`Device.manage`): renews the capture lease for a
  Manage draft.
- **`POST {adapter}/candidates/activate`**:
  - Needs `Device.activate`, `Device.manage` and `Device.manage-connections`.
  - The body is `{candidates: [{uuid, name, device_uuid?}]}`, with 1–50 candidates.
  - It returns 202 with one operation.
  - The single-candidate route stays and calls the same service.
- **`POST {adapter}/apply`** (permissions per step, as for Start collecting, without
  `activate`): Apply changes in Manage. It has the same body and rollout view as
  `start`, without serials.
- **`POST {adapter}/copy`** (`Device.manage` and `Device.manage-connections`): the
  same as `POST device-setups` with `copy_from_adapter_uuid`.

## Overview and discovery (changed)

- `GET overview` adds `setups: {unfinished}`.
- `discovery.pending` and `discovery-candidates?available=1` count the same rows
  (FR-065).

## Platform administration (new)

### `GET /api/admin/onboarding/summary?from&to` (platform administrator)

```json
{ "data": [ { "connector": "tenant_mqtt", "started": 14, "reached": { "connect": 14, "data": 12, "readings": 10, "collect": 9 }, "completed": 8,
  "median_minutes_to_first_reading": 7.5, "assistant_share": 0.36, "code_share": 0.12 } ] }
```

It holds no payloads, names or organization identifiers. The time range is at most
366 days.
