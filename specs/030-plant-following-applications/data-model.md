# Data Model: Applications That Follow a Plant

What is stored, what is computed per request, and what crosses the wire. Decisions in
[research](research.md); wire shapes in [contracts](contracts/).

## Application grant (stored on `integration_applications`)

| Column | Type | Rules |
| --- | --- | --- |
| `device_uuids` | json, existing | 1 to 100 distinct UUIDs of the organization's devices, or empty |
| `site_uuids` | json, nullable, **new** | 1 to 50 distinct UUIDs of the organization's sites, or empty |
| `grant_revision` | integer, existing | Bumped on any change to either column |

**Validity**: exactly one of the two lists is non-empty. The portal and the management
API refuse anything else with a field error naming the rule.

**Resolution** (`ApplicationGrant`, computed per request, never stored):

- `kind`: `devices` when `device_uuids` is non-empty, else `sites`.
- `covers(device)`: `device.uuid ∈ device_uuids`, or `device.site_id ∈ sites(site_uuids)`.
  A device with `site_id = null` is never covered by a site scope.
- `deviceQuery(builder)`: `whereIn('uuid', ...)` or `whereIn('site_id', ...)`, always
  inside `where('organization_id', ...)`.
- `resolveUuids()`: the device UUIDs covered right now, for the feed page filter, the
  webhook delivery check and the stream's device set. No ceiling for a site scope.

**Transitions**:

| Event | Effect |
| --- | --- |
| Manager saves a list or a scope | `revision` and `grant_revision` bump, tokens deleted, webhook disabled, cursors rejected, audit `application.grants_updated` |
| A site in a scope is deleted | The site leaves every scope naming it; same effects as a save, audit reason `site_deleted`. An emptied scope stays empty and resolves to no device |
| A device moves between sites | No stored change; the next request, feed page, delivery or stream re-resolution reflects it (streams within a minute) |

## Stream session (new table `integration_stream_sessions`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `integration_application_id` | fk | restrict on delete |
| `organization_id` | fk | |
| `opened_at` | timestamp | |
| `last_seen_at` | timestamp | Refreshed every 30 s by the relay |
| `last_position` | string(20), nullable | The last `id` written |
| `device_count` | integer | Size of the device set at open |
| `closed_at` | timestamp, nullable | |
| `close_reason` | string(32), nullable | `lifetime`, `grant_changed`, `credentials_changed`, `runtime_unavailable`, `shutdown`, `client` |

**Open stream**: `closed_at IS NULL AND last_seen_at > now() - 90 s`. Limits are counted
on open streams inside one transaction with the application row locked: 2 per
application, 10 per organization, `IOT_STREAMS_MAX_OPEN` (default 10) per deployment.
Rows older than 30 days are pruned.

## Position

A decimal string, `^(0|[1-9][0-9]{0,19})$`, equal to the committed outbox `sequence`
(`device_runtime.telemetry_outbox.sequence`, a global identity). Unique, increasing in
storage order, gaps allowed. Opaque to clients. The organization's head is its greatest
retained sequence, or `0` when it has none; `0` presented as a resume position means
"from the oldest retained event", and is answered with a `reset` once the organization
holds events older than the client could have seen.

## Stream events (wire; see [the stream contract](contracts/telemetry-stream.md))

| Event | Carries |
| --- | --- |
| `open` | `position`, `devices`, `opened_at` |
| `reading` | `telemetry-stream.v1`: `position`, `event_id`, `device_uuid`, `configuration_uuid`, `generation`, `readings[]` |
| `reset` | `position` (the head) |
| `closed` | `reason`, `position` |

`readings[]` items: `parameter_uuid`, `key`, `data_type`, `unit`, `value`, `quality`,
`observed_at`, `received_at`, `historical`; derived from `telemetry.committed.v1` by
dropping `telemetry_id`, `organization_uuid`, `installation_uuid`,
`adapter_revision_uuid`, `manufacturer_serial`, `timestamp_source` and `diagnostic`.

## Snapshot: `telemetry-latest-batch.v1` (wire)

Request: `{ "device_uuids": [<1..100 distinct UUIDs>] }`.

Response: `{ "schema_version": "telemetry-latest-batch.v1", "data": [ <entry> ] }`, one
entry per requested device in request order:

| Field | Notes |
| --- | --- |
| `device_uuid` | |
| `configuration_uuid` | nullable: the applied, else last-applied configuration |
| `presence` | `online`, `offline` or `unknown`, as the device read computes it (Laravel's columns, `unknown` when the runtime has not been seen for 20 s) |
| `last_seen_at` | RFC 3339 or null |
| `readings` | the single-device latest read's `data[]`, same whitelist of fields; empty when nothing is retained |

Refusals: 404 for the whole request when any device is outside the resolved grant; 422
for more than 100, a repeat, or a malformed UUID; 503 when the runtime is unavailable.

## Device read (wire, additive)

`GET devices/{uuid}` keeps `uuid`, `code`, `name`, `lifecycle`, `presence`,
`last_seen_at` and adds:

| Field | Notes |
| --- | --- |
| `profile` | `{uuid, name, revision}` or null |
| `site` | `{uuid, name, timezone}` or null |
| `parameters[]` | `uuid`, `key`, `name`, `unit`, `data_type`, `decimals`, `accepts_command`, `reports_state`; empty when the device has no profile revision |

## Site view for applications (wire)

`GET sites` → `{ "data": [ {uuid, name, timezone, address, latitude, longitude,
granted_devices_count} ] }`, ordered by name, not paginated, every site of the
organization. `granted_devices_count` is the count within the application's resolved
grant.

## Abilities (stored on `integration_applications.abilities` and the token)

`devices:read`, `alerts:read`, `events:read`, `telemetry:read`, `locations:read`,
`geofences:read`, `geofences:manage`, `geofences:activate`, **`entities:read`**,
**`telemetry:stream`**. Rules: `events:read` needs `alerts:read` or `geofences:read`;
`geofences:activate` needs `geofences:manage`; `telemetry:stream` needs
`telemetry:read`. Validation caps move from 8 to 10.

## Runtime (no stored change)

- `GET /internal/measurements/latest-batch`: one query over `device_runtime.latest`.
- `GET /internal/telemetry/stream`: catch-up reads `device_runtime.telemetry_outbox`
  by organization, device set and sequence; live events come from the in-process
  broadcaster fed by the relay. No new table, no new JetStream consumer.
- `GET /internal/status` adds `streams: {open}`.
