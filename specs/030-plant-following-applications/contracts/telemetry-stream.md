# Contract: the telemetry stream

The server-sent events an application receives from
`GET /api/integration/v1/organizations/{organization}/telemetry/stream`, and the
internal stream the runtime serves to Laravel behind it. Decisions are in
[research](../research.md) (R1 to R6) and [ADR-032](../../../docs/adr/ADR-032-applications-follow-a-plant.md).

## Request

| Part | Value |
| --- | --- |
| Method and path | `GET /api/integration/v1/organizations/{organization}/telemetry/stream` |
| Abilities | `telemetry:stream` on the application and the token; `telemetry:read` is required alongside it |
| `Accept` | `text/event-stream` (any other value is answered 406) |
| `devices[]` (query, optional) | Granted device UUIDs to narrow the stream to; at most 1 000 distinct values. Absent means the whole resolved grant |
| `Last-Event-ID` (header, optional) | The position of the last `reading` the client received; also accepted as `?after=` for clients that cannot set headers |

Refusals, before any event is sent:

| Status | When |
| --- | --- |
| 401 | Missing, expired or revoked credentials |
| 403 | `telemetry:stream` missing on the application or the token |
| 404 | A device in `devices[]` is not granted or not in the organization. The whole request is refused and nothing about the device is revealed |
| 406 | `Accept` does not allow `text/event-stream` |
| 422 | More than 1 000 devices, a repeated device, or a `Last-Event-ID` that is not a position this platform issued |
| 429 | The application already holds 2 open streams, or the organization 10; `Retry-After` is set and the body names the limit |
| 503 | The runtime is unavailable; never answered with an empty stream |

Opening a stream counts as one request against the application's per-minute limit.
Data on an open stream does not count.

## Response

Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`, `Connection: keep-alive`. The body is a standard SSE stream:
each event is `event:`, optional `id:`, one `data:` line holding one JSON object, and
a blank line. Comment lines (`: keepalive`) carry no event.

| Event | `id` | `data` | Meaning |
| --- | --- | --- | --- |
| `open` | none | `{ "schema_version": "telemetry-stream-open.v1", "position": "<string>", "devices": <int>, "opened_at": "<RFC 3339>" }` | Sent once, first. `position` is where the stream starts: the position the client resumed from, or the current head for a fresh stream. `devices` is the size of the resolved set the stream will carry |
| `reading` | the position | one `telemetry-stream.v1` object (below) | One committed telemetry event of one granted device, in storage order |
| `reset` | none | `{ "schema_version": "telemetry-stream-reset.v1", "position": "<string>" }` | The position the client resumed from is no longer retained. `position` is the current head. The client takes a new snapshot and reconnects from this position. The stream closes after it |
| `closed` | none | `{ "schema_version": "telemetry-stream-closed.v1", "reason": "<reason>", "position": "<string>" }` | The platform is ending the stream. `position` is the last reading sent (or the `open` position when none was). The client reconnects with it |
| comment `: keepalive` | | | Sent after 60 s without an event |

`closed.reason` is one of:

| Reason | Cause | Client's move |
| --- | --- | --- |
| `lifetime` | One hour since `open` | Reconnect with the position; nothing is lost |
| `grant_changed` | The application's grant revision changed | Reconnect; the new grant applies; event cursors must be rebuilt as documented for grants |
| `credentials_changed` | The token was rotated, expired, or the application was revoked | Obtain credentials, then reconnect |
| `runtime_unavailable` | The relay to the runtime failed | Reconnect with backoff; a reconnect may be answered 503 |
| `shutdown` | The serving process is stopping | Reconnect with the position |

Events are written to the socket as they arrive, never batched beyond what the
transport does. A `reading` may follow another with the same `device_uuid` and a
later `received_at` only if its position is greater.

## `telemetry-stream.v1`

Derived from the runtime's `telemetry.committed.v1` event
([schema](../../../contracts/events/v1/telemetry-committed.schema.json)) by dropping the
fields that are internal or already known to the client. The organization is the path's.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `"telemetry-stream.v1"` | |
| `position` | string, `^(0\|[1-9][0-9]{0,19})$` | The committed sequence; equal to the SSE `id`. Opaque: compare for equality, never compute with it. `0` appears only in `open` for an organization with no retained events |
| `event_id` | UUID | The committed event's id; the same event is never sent twice on one stream, and at-least-once across reconnections, so clients deduplicate by it when they must |
| `device_uuid` | UUID | A granted device |
| `configuration_uuid` | UUID | The device configuration the readings were mapped by |
| `generation` | integer | That configuration's generation |
| `readings` | array, 1 to 2 000 | |
| `readings[].parameter_uuid` | UUID | |
| `readings[].key` | string | The parameter key in its profile |
| `readings[].data_type` | string | As the profile declares it |
| `readings[].unit` | string or null | |
| `readings[].value` | number, string, boolean or null | As stored |
| `readings[].quality` | `good` or another quality the runtime stored | A reading other than `good` was stored as a diagnostic, not as an observation |
| `readings[].observed_at` | RFC 3339 | When the device says it measured |
| `readings[].received_at` | RFC 3339 | When the platform stored it |
| `readings[].historical` | boolean | True for a backfilled reading that must not be treated as current |

Dropped from the committed event: `telemetry_id`, `organization_uuid`,
`installation_uuid`, `adapter_revision_uuid`, `manufacturer_serial`,
`timestamp_source`, `diagnostic`.

Schemas, fixtures and cases live under `contracts/events/v1/` beside
`telemetry-committed` ([research R10](../research.md)): `telemetry-stream`,
`telemetry-stream-open`, `telemetry-stream-reset` and `telemetry-stream-closed`, each
with a fixture, and a case file that the Go producer, the PHP relay and the TypeScript
SDK all read.

## Ordering, positions and resume

- Positions are the storage outbox's sequence: unique, increasing in storage order,
  with gaps (the number is shared by every organization). A client treats it as an
  opaque string.
- A fresh stream starts at the head: the first `reading` is the first event stored
  after `open`. An organization with no retained events has head `0`; resuming from
  `0` means from the oldest retained event, and is answered with `reset` once events
  the client could not have seen have been pruned.
- The device set is re-resolved every 30 s on the platform side; when it changes (a
  device moved into or out of a granted site), the platform reopens its internal
  stream from the last position with the new set and relays no second `open`. The
  client sees the device appear or disappear, nothing else.
- A resumed stream (`Last-Event-ID` or `after`) sends every retained event with a
  greater position for the resolved set, in order, then continues live. The join is
  gapless and duplicate-free within one stream.
- Retention is the committed outbox's: eight days, or the tenant's retention when it
  is shorter. A position older than that is answered with `reset`.
- The platform never resends an event on the same stream. Across a reconnection the
  same event may arrive again only if the client reconnects from a position before
  it; a client that always resumes from the last `id` it processed sees no duplicates.

## The internal stream (runtime to Laravel)

`GET /internal/telemetry/stream?organization=<uuid>&devices=<uuid>,<uuid>&after=<position>`
on the runtime, bearer `DEVICE_RUNTIME_TOKEN`, answered as the same SSE framing with
`open`, `reading`, `reset` and keepalive comments. `devices` is required (Laravel always
resolves the set; the runtime never decides a grant). Up to 1 000 devices, as the
connectivity endpoint accepts. The runtime does not send `closed`; Laravel writes it
when it ends the relay for a reason of its own, and treats the runtime closing the
connection as `runtime_unavailable`. Laravel relays the runtime's `open` only for the
first internal stream of a client stream; when it reopens the internal stream with a
changed device set, it drops that `open` and relays from the first `reading`.

The runtime answers 401 without the token, 400 for a malformed request, and 503 when
its storage is unavailable. It lifts its 10-second write deadline for this handler
only, and ends every stream it serves when the process stops.

## SDK (0.6)

```ts
for await (const event of client.telemetryStream({ devices, signal })) {
  switch (event.type) {
    case 'open':    // { position, devices, openedAt }
    case 'reading': // { position, eventId, deviceUuid, configurationUuid, generation, readings }
    case 'reset':   // { position } — take a new snapshot, the iterator continues from position
  }
}
```

The iterator opens the stream, remembers the last position, reconnects after a
`closed`, a dropped connection or the hourly lifetime (backoff 1 s to 30 s), and only
ever surfaces `open`, `reading` and `reset`. A 401, 403, 404, 422 or 429 refusal is
thrown as `IotApiError`; a 503 is retried with backoff up to the configured limit.
