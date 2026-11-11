# Integrations

External applications read platform data through scoped machine credentials, a
versioned integration API, a durable event feed and signed webhooks. A server-side
TypeScript SDK wraps them.

Code: Laravel [`Domain/Integrations`](../../apps/api/app/Domain/Integrations); SDK
[`packages/integration-sdk`](../../packages/integration-sdk/README.md); sample host
[`apps/vertical-demo`](../../apps/vertical-demo/README.md); portal
[`src/integrations`](../../apps/portal/src/integrations). Event contracts are in the
[events reference](../reference/events.md#integration-events).

## Applications and grants

An **application** belongs to one organization and has:

- **abilities**, explicitly chosen, no wildcards:

  | Ability | Grants |
  | --- | --- |
  | `devices:read` | Device metadata |
  | `alerts:read` | Alert episodes |
  | `events:read` | The event feed; also needs `alerts:read` or `geofences:read` |
  | `telemetry:read` | Latest values (one device, or up to 100 in one request), chart history, raw records, location bindings and fixes |
  | `locations:read` | Location map query (current positions and trails) |
  | `geofences:read` | Geofences and activation status |
  | `geofences:manage`, `geofences:activate` | Create and update geofences; activation needs both |
  | `entities:read` | Sites (and, once spec 009 lands, the entity hierarchy) |
  | `telemetry:stream` | The live telemetry stream ([below](#the-telemetry-stream), [ADR-032](../adr/ADR-032-applications-follow-a-plant.md)); also needs `telemetry:read` |

- **a grant**: either 1–100 named devices of that organization, or a scope of 1–50
  of its sites ([grants by site](#grants-by-site)). Every request resolves the grant
  afresh through one resolver
  ([`ApplicationGrant`](../../apps/api/app/Domain/Integrations/Services/ApplicationGrant.php)),
  the only place a device is judged granted; alerts are scoped by their deployment's
  bound device.

Machine tokens use Sanctum's hashed token storage but a separate middleware
([`AuthenticateApplication`](../../apps/api/app/Domain/Integrations/Http/AuthenticateApplication.php)):
they cannot sign in to the portal or admin, and integration routes ignore user
cookies and user tokens. A request needs the ability on **both** the application
and the token.

- One active token per application, valid 1–90 days, with abilities that are a
  subset of the grants. Issuing a token immediately invalidates the previous one.
  The plaintext is returned once with `Cache-Control: no-store`.
- Changing grants bumps `grant_revision`, invalidates the token and event cursors,
  and disables the webhook. Revocation is permanent. At most 50 applications per
  organization, including revoked ones.
- Applications belong to the organization, not to the manager who created them.
- Limits: 60 requests per minute per application, 240 per minute per source IP;
  429 includes `Retry-After`. Limits use Laravel's shared cache. Open telemetry
  streams are limited separately: 2 per application, 10 per organization and
  `IOT_STREAMS_MAX_OPEN` (default 10) per deployment, counted on the
  `integration_stream_sessions` table ([the telemetry stream](#the-telemetry-stream)).

### Grants by site

A grant is a device list or a scope of sites, never both (spec 030, ADR-032). A
device counts as granted when it is in the list, or when its site is in the scope at
the time of the request: devices registered at a granted site later are covered
without touching the application, a device moved to another site stops being
visible at its next request, and a device with no site is never in a scope. A scope
has no ceiling; the limit of 100 is for named lists.

Every read, the event feed and webhook deliveries filter by the same resolved set.
Changing the scope bumps `grant_revision` with the consequences of changing the list
(token invalidated, event cursors rejected until rebuilt, webhook disabled). Deleting
a site removes it from every scope naming it with the same consequences, audited as
`application.grants_updated` with `reason: site_deleted`; a scope left empty stays
empty and the application reads nothing until a manager grants a site again. A scope
naming another organization's site is refused with the generic
"Every site must belong to this organization." message, as a foreign device is.

### Managing applications

**Connect → Integrations** (needs `Device.view` and `Device.manage`) creates
applications, picks abilities and either devices or sites (**Grant access by**),
issues tokens and configures the webhook. Secrets appear once in a masked panel and live only in component state;
dismissing it or leaving the page clears them. Saving grants explains that it
invalidates the token and disables the webhook. Conflicts keep your edits until
you choose **Reload latest state**.

Management API under `/api/v1/organizations/{organization}/applications`
(session auth, 30 requests per minute):

| Method and path | Purpose |
| --- | --- |
| `GET /`, `POST /` | List (never tokens); create `{name, abilities, device_uuids}` or `{name, abilities, site_uuids}` |
| `PUT /{application}` | Replace grants with `{revision, name, abilities, device_uuids \| site_uuids}`; the view carries both lists plus `devices[]` and `sites[]` |
| `POST /{application}/token` | Issue or rotate `{revision, abilities, expires_in_days}` |
| `POST /{application}/revoke` | Revoke permanently `{revision}` |
| `GET/PUT /{application}/webhook`, `POST .../webhook/disable` | Webhook endpoint |
| `GET .../webhook/deliveries`, `POST .../deliveries/{d}/retry` | Delivery history and manual retry |

## Integration API

The [public API contract](../../contracts/openapi/openapi.json) is the authority for
the integration API: every operation, parameter, limit, ability, response body, error
and header, the event envelope and the webhook delivery, generated from the code and
checked against real responses on every pull request
([API reference](../reference/api.md#contract)). Its `info.version` versions the
integration API. This page explains how the API behaves; where the two differ, the
contract (which follows the code) is right.

Base: `/api/integration/v1/organizations/{organization}` with
`Authorization: Bearer <application token>`. Use HTTPS; the SDK allows HTTP only
on loopback. Errors: 401 missing, expired or revoked credentials; 403 missing
ability; 404 foreign organization or ungranted resource; 409 a stale revision, a
reused operation UUID or (event feed) a grant change; 422 invalid input; 503 runtime
unavailable (never an empty result); 504 a history range the runtime could not read
in time. Responses to authenticated requests carry `Cache-Control: no-store`.

| Method and path | Ability | Contract |
| --- | --- | --- |
| `GET devices`, `GET devices/{uuid}` | `devices:read` | `uuid`, `code`, `name`, `lifecycle`, `presence`, `last_seen_at`; the single read adds `profile`, `site` and `parameters` (below) |
| `GET sites` | `entities:read` | Every site of the organization by name, not paginated, with `granted_devices_count` |
| `GET alerts`, `GET alerts/{uuid}` | `alerts:read` | Episode snapshot; `condition=active\|cleared` filter |
| `GET events/checkpoint`, `GET events?cursor=&limit=` | `events:read` | Ordered event feed (below) |
| `GET devices/{uuid}/telemetry/latest` | `telemetry:read` | `telemetry-latest.v1` |
| `POST telemetry/latest/query` | `telemetry:read` | `telemetry-latest-batch.v1`: the latest values of 1–100 granted devices in one request |
| `GET telemetry/stream` | `telemetry:stream` (+ `telemetry:read`) | Server-sent events: `open`, `reading` (`telemetry-stream.v1`), `reset`, `closed` ([below](#the-telemetry-stream)) |
| `GET devices/{uuid}/telemetry/history` | `telemetry:read` | `telemetry-history.v1` |
| `GET devices/{uuid}/telemetry/records` | `telemetry:read` | `telemetry-records.v1` |
| `GET devices/{uuid}/location-bindings` | `telemetry:read` | Successfully applied immutable bindings `{version_uuid, binding}` |
| `GET devices/{uuid}/locations/{event}?version_uuid=` | `telemetry:read` | `location-fix.v1` |
| `POST location-map/query` | `locations:read` | Positions and trails (1h, 6h, 24h, 7d) for granted devices |
| `GET geofences`, `GET geofences/{uuid}`, `GET geofences/{uuid}/activations/{batch}` | `geofences:read` | Geofences filtered to granted devices; activation status |
| `POST geofences`, `PUT geofences/{uuid}`, `POST .../items/{item}/retry` | `geofences:activate` (+ `geofences:manage`) | Save and activate (202), retry a failed item |

Device, alert and location-binding lists return
`{data, meta: {current_page, last_page, total}}`, ordered by creation, `page` 1–100000
and `per_page` 1–100. The geofence list is not paginated and is ordered by name. Lists
are current state, not snapshots.

### Parameters and sites

`GET devices/{uuid}` carries what an application can bind (spec 030): `profile`
(`uuid`, `name`, `revision`), `site` (`uuid`, `name`, `timezone`) and `parameters`,
each with `uuid`, `key`, `name` (the profile's label), `unit`, `data_type`, `decimals`
(the display precision, or null), `accepts_command` and `reports_state`, read from
the applied, else last-applied, configuration. `profile` and `site` are null when
absent; `parameters` is empty when the device has no profile revision, never an
error. The device list is unchanged. `GET sites` returns every site of the
organization ordered by name with `granted_devices_count`, the devices at the site
within the application's resolved grant; without `entities:read` it is 403.

### Telemetry semantics

- **Latest** returns retained values with their quality and timestamps; receiving
  the response does not make them fresh. An unconfigured device returns an empty
  array, never zeros. Presence is separate from quality.
- **Batch latest** (`POST telemetry/latest/query` with `{device_uuids: [1–100]}`)
  answers one entry per requested device, in request order, so a plant's first frame
  costs one request ([spec 030](../../specs/030-plant-following-applications/spec.md),
  [ADR-032](../adr/ADR-032-applications-follow-a-plant.md)). Each entry's `readings`
  is exactly the single-device read's `data` for that device, with the same stale
  rules applied by the runtime from one query over its latest table
  (`GET /internal/measurements/latest-batch`); a device that never reported has
  `readings: []` and `configuration_uuid: null`. Each entry also carries `presence`
  and `last_seen_at` as the device read returns them: `online`, `offline`, `unseen`,
  or `unknown` when the runtime has not been seen for 20 s, computed from the control
  plane's columns, whereas the single-device latest read's `presence` is the
  runtime's own word about the source session. Any device outside the grant refuses
  the whole request with 404 and reveals nothing; more than 100 devices, a repeated
  device or a malformed UUID is a 422 naming the rule; 503 when the runtime is
  unavailable, never an empty answer.
- **History** is selected and bucketed by **receipt time**, inclusive bounds, at
  most 31 days, `max_points` 10–1000 (more than 2000 resulting points is a 422).
  Series stay separated by configuration, type and unit. Bounds are clipped to
  retention and reported back. Empty means no observations, not zero.
- **Records** are unaggregated good-quality observations (diagnostics excluded),
  newest first by `(received_at, event_uuid)`, `page_size` 1–100, a total `limit`
  of 1–5000 with `limit_reached`, and a signed cursor bound to the query. Not a
  complete export.
- **Moved devices.** Points and records carry `recorded_in`. For a device moved into
  the organization with its readings shared ([moving devices](devices.md#measurements-and-history-across-a-move)),
  history also has the archived device's series from before the move, first, and
  records continue into its records under the same `limit`; those are `source`,
  read from the organization the device moved from under its retention. Everything
  else is `self`.
- **Location bindings** lists every binding version the runtime applied
  successfully, superseded and stopped versions included, so an older event can be
  read through the binding it was recorded under. A listed version's workflow may no
  longer be running. Pending and failed deployments are not listed, and there is no
  implicit newest version: choose the one that matches the event.
- **Location fixes** resolve one stored event through the selected immutable
  binding with the same resolver as geofencing ([automation](automation.md#location-bindings)).
  Consumers cannot submit coordinates or evaluation time; independent latest
  values are never paired into a fix.

### The telemetry stream

`GET telemetry/stream` follows the granted devices' readings as they are committed,
as server-sent events ([spec 030](../../specs/030-plant-following-applications/spec.md),
[contract](../../specs/030-plant-following-applications/contracts/telemetry-stream.md),
[ADR-032](../adr/ADR-032-applications-follow-a-plant.md)). It needs `telemetry:stream`
and `telemetry:read`, each on the application and the token, and
`Accept: text/event-stream` (406 otherwise). Code: the runtime's
[`stream.go`](../../services/runtime/internal/app/stream.go) and
[`broadcast.go`](../../services/runtime/internal/app/broadcast.go), Laravel's
[`StreamRelay`](../../apps/api/app/Domain/Integrations/Services/StreamRelay.php) and
[`TelemetryStreamController`](../../apps/api/app/Domain/Integrations/Http/TelemetryStreamController.php),
and the SDK's `telemetryStream()` ([README](../../packages/integration-sdk/README.md)).

- **Events.** Each frame is `event:`, an `id:` line for readings, one `data:` line of
  JSON and a blank line; `: keepalive` comments carry no event. `open` comes once,
  first, with the `position` the stream starts at and the size of its device set;
  `reading` carries one committed event of one granted device
  (`telemetry-stream.v1`: `position`, `event_id`, `device_uuid`, `configuration_uuid`,
  `generation`, `readings[]`), in storage order, derived from the internal
  [committed feed](../reference/events.md#committed-telemetry) without its internal
  fields; `reset` says a resumed position is no longer retained; `closed` says the
  platform is ending the stream and why. The four payloads are contracts under
  [`contracts/events/v1/`](../../contracts/events/v1/) (`telemetry-stream`, `-open`,
  `-reset`, `-closed`) that the Go producer, the Laravel relay and the SDK all test
  against.
- **Device subsets.** `devices[]` (or `devices=a,b`) narrows the stream to granted
  devices, at most 1000 distinct; any device outside the grant refuses the whole
  request with 404 and reveals nothing. Absent, the stream carries the whole resolved
  grant, which must hold 1 to 1000 devices (an emptied scope is 404, a larger scope a
  422 asking for a subset). A site scope is re-resolved every 30 s: a device moved
  into a granted site appears, one moved out disappears, with no second `open`.
- **Positions and resume.** The `id` of a reading is its position: the committed
  outbox sequence as a decimal string, unique and increasing in storage order with
  gaps, opaque to clients. Reconnecting with `Last-Event-ID` (or `?after=`) replays
  every retained event after it for the device set, in order, then continues live
  with no gap and no repeat within one stream. A fresh stream opens at the
  organization's current head (`0` when it has no retained events). Across
  reconnections the stream is at-least-once: an event arrives again only when the
  client reconnects from a position before it, so deduplicate by `event_id` when it
  matters.
- **Reset.** Retention is the committed outbox's (eight days, or the tenant's
  retention when shorter). A position older than the organization's oldest retained
  event is answered with `reset` carrying the head, and the stream closes: take a new
  snapshot and reconnect from that position. The rule is conservative: it fires when
  anything of the organization older than the position was pruned.
- **Order of work.** Open the stream, take the snapshot (`POST telemetry/latest/query`)
  after the `open` (or `reset`) position arrives, then apply readings with a greater
  position. Within one connection a reading of the same device with a later
  `received_at` only ever has a greater position.
- **Lifetime and close reasons.** A stream ends after `IOT_STREAM_LIFETIME_SECONDS`
  (default one hour) with `closed` `lifetime` and its last position; the client
  reconnects and loses nothing. The relay re-checks every 30 s and closes with
  `grant_changed` (the grant revision moved: reconnect, and rebuild event cursors as
  documented for grants), `credentials_changed` (the token was rotated or expired, or
  the application revoked: obtain credentials first), `runtime_unavailable` (the
  internal relay failed or the runtime stopped: reconnect with backoff; a reconnect
  may be answered 503) or `shutdown` (the serving worker is stopping). A client that
  disconnects is recorded as `client`; a `reset` as `reset`. The runtime writes
  `: keepalive` after 60 s of silence and the relay does the same when the runtime is
  quiet for longer, so proxies and clients can tell a quiet stream from a dead one.
- **Limits.** Opening a stream counts as one request against the per-minute limit;
  data on it does not. 2 open streams per application, 10 per organization and
  `IOT_STREAMS_MAX_OPEN` (default 10) per deployment; the 429 carries
  `Retry-After: 30` and names the limit. A stream is open while its session row is
  not closed and was touched within 90 s, so a worker that died frees its slot
  without a reaper. A stream whose client simply dropped the connection still counts
  until the relay's next write notices (the next reading, or the keepalive after
  60 s of silence), so a client that reconnects the instant it disconnected can be
  refused once while it holds another stream: keep the position and retry after
  `Retry-After`. Operators see open streams on the admin app's organization menu
  (**Telemetry streams**) and in `iot_integration_streams_open{organization}`
  ([release](../ops/release.md#telemetry-streams-and-the-api-pool)); the runtime's
  `GET /internal/status` reports `streams.open` and `streams.dropped`.
- **Behind proxies.** The response carries `Cache-Control: no-store` and
  `X-Accel-Buffering: no`, which nginx honours; Caddy flushes `text/event-stream` as
  it arrives. A proxy that buffers responses or times out idle connections under 60 s
  shows a stream that never delivers or drops hourly: raise its read timeout above the
  keepalive interval and disable buffering for this path. In development
  `php artisan serve` is single-threaded per worker, so the api image runs with
  `PHP_CLI_SERVER_WORKERS=8` ([gotchas](../dev/gotchas.md)).
- **How it is served.** The runtime fans committed events out in-process to one
  subscriber per stream, filtered by the organization and device set Laravel resolved
  (it never decides a grant), catching a resumed subscriber up from the committed
  outbox first and joining the live feed by sequence. A subscriber that falls 1000
  events behind is closed and resumes with catch-up. Laravel relays the frames byte for
  byte, re-checks authorization between them, and holds one PHP worker per stream for
  up to the lifetime, which is why the release's PHP-FPM pool is sized for
  `IOT_STREAMS_MAX_OPEN` ([release](../ops/release.md#telemetry-streams-and-the-api-pool)).

### Geofence activation

`POST geofences` and `PUT geofences/{uuid}` return 202 once the geofence is saved,
with an activation batch of one item per device. If the runtime rejects the geofence
itself, the request returns 422 and nothing is saved. After the save, an item the
runtime rejects, or that cannot be requested (its device or assignment is gone, or
the runtime is unreachable), is `failed` with a `diagnostic`; the other items are
still requested. Retry a failed item with `POST .../items/{item}/retry`; a pending
item cannot be retried. Coordinates and policy values may be sent as numeric
strings; they are stored and returned as numbers.

### Event feed

The feed is an ordered, per-organization journal of `integration-event.v1`
envelopes ([types](../reference/events.md#integration-events)). Writers lock the
organization's stream row until commit, so positions appear in commit order with
no gaps visible to readers.

- `GET events/checkpoint` returns a cursor at the current head; `GET events`
  returns `{data, next_cursor, has_more}` with `limit` 1–100.
- Cursors are encrypted and bound to the organization, application and grant
  revision. Token rotation keeps them; a grant change returns 409 (rebuild from a
  fresh checkpoint). A cursor from another application returns 422.
- Pages skip events for ungranted devices; save `next_cursor` even for empty pages.
  The feed filters by device, not by event type.
- To build a projection: take a checkpoint, read all current alert pages, then
  apply events after the checkpoint in order. Apply `data` as an authoritative
  snapshot. Record processed event IDs with your projection; the feed is
  at-least-once.
- Events are retained indefinitely for now; there is no retention floor or 410
  contract yet.

## Webhooks

One HTTPS receiver per application, which must grant `events:read` and
`alerts:read`. A separate `webhooks-worker` (`php artisan
integrations:webhooks-work`) scans the committed journal and persists each delivery
before sending, so ingestion and alert evaluation never wait for a receiver.

- **Every save rotates the signing secret, cancels pending deliveries and starts at
  the current journal head.** History is not replayed; recover gaps through the
  feed.
- **Destinations**: `IOT_WEBHOOK_ALLOWED_HOSTS` lists exact hostnames (empty allows
  none). HTTPS on port 443 only; no credentials, query, fragment or IP literal.
  Every send resolves IPv4 and rejects the whole result if any address is private,
  loopback, link-local or reserved, then pins the validated address. No proxies or
  redirects; 3 s connect and 5 s transfer timeouts. IPv6-only receivers are not
  supported. This is application-level egress control, not a network firewall.
- **Signature**: headers `X-Iot-Delivery-Id`, `X-Iot-Timestamp` (Unix seconds, per
  attempt) and `X-Iot-Signature: v1=<hex HMAC-SHA256>` over
  `timestamp + "." + deliveryId + "." + rawBody` with the secret as key. The SDK's
  `verifyWebhook` checks it with a 300-second skew window. A valid signature can
  be replayed; deduplicate by event ID before returning 2xx.
- **Retries**: 2xx is delivered. Timeouts, network errors, 408, 425, 429 and 5xx
  retry at 10 s, 30 s, 2 min and 10 min, up to five attempts within 24 hours. Other
  responses, including redirects, fail immediately. A failed delivery blocks newer
  ones for that endpoint until it succeeds or fails terminally. At most one send per
  second per endpoint. Managers can retry a failed delivery from the current
  endpoint revision.
- Revoking the application or changing its grants disables the endpoint and
  cancels pending work.

For local checks, `compose.webhook-verification.yml` adds a sink at
`http://webhook-sink:8080/events`, allowed only in local/testing with the
verification flag ([testing](../dev/testing.md#verification-scripts)).

## SDK and sample host

[`@iot-os/integration-sdk`](../../packages/integration-sdk/README.md) (0.5.0, Node
22.12+, not published to a registry) covers devices, alerts, the event feed,
webhook verification, telemetry (one device with `latestTelemetry()`, up to 100 with
`latestQuery()`), records, location bindings and fixes, the location map and
geofences; the 0.6.0 surface adds `sites()` and the device read's `profile`, `site`
and `parameters` (released with spec 030's last pull request). It validates responses at runtime, rejects redirects, has a
15-second default timeout and never retries automatically. It accepts every event
type in the contract, `automation.triggered.v1` included.

[`apps/vertical-demo`](../../apps/vertical-demo/README.md) is a server-rendered
sample host that uses only the SDK and `@iot-os/ui`, proving that portable
components and machine credentials work outside the portal. It is a local
single-organization example, not a product.
