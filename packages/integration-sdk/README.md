# IoT OS integration SDK

Server-side TypeScript/Node.js client for scoped application access. Node 22.12+
with native fetch; no browser session, React, Laravel, database or broker dependency.
This package is available from the workspace or a local tarball; it has not been
published to a registry.

```sh
pnpm --filter @iot-os/integration-sdk build
pnpm --filter @iot-os/integration-sdk pack --pack-destination /tmp
# In an independent application:
npm install /tmp/iot-os-integration-sdk-0.6.0.tgz
```

```ts
import { IotClient, IotApiError } from '@iot-os/integration-sdk'
const client = new IotClient({
  baseUrl: 'https://api.example.com',
  organization: process.env.IOT_ORGANIZATION!,
  token: process.env.IOT_APPLICATION_TOKEN!,
})
for await (const device of client.allDevices({ perPage: 25 })) {
  console.log(device.uuid, device.name, device.presence)
}
const alerts = await client.alerts({ condition: 'active' })
const episode = await client.alert(alerts.data[0].uuid)
```

Keep tokens on your backend, never in frontend bundles. Use the management APIs
in [integrations](../../docs/features/integrations.md#managing-applications) to
create grants and issue a short-lived token.
Each method also accepts an AbortSignal (inside options for list methods).
`devices`, `alerts` return a page; `device`, `alert` read one authorized resource;
`allDevices`, `allAlerts` iterate bounded pages. Unknown timestamps stay `null`.
List results are current state, not a snapshot, durable event feed or checkpoint.

HTTPS is required. For local loopback only, set `allowInsecureLocalhost: true`.
The default timeout is 15 seconds (configurable up to 120 seconds). Credentials
are omitted and redirects rejected to prevent forwarding the bearer token.
No automatic retry is performed. `IotApiError` provides `status` and numeric
`retryAfterSeconds`; `IotTransportError` represents network failure/cancellation;
`IotContractError` represents an unsupported response. Error messages exclude
server response bodies and transport causes that might contain credentials.

A custom `fetch` implementation may be injected for tests or server observability;
it must honor AbortSignal and redirect handling, and must not log Authorization.
Runtime validators enforce the documented v1 field types and allow additive
fields. Tests cover pagination, malformed responses, timeout, safe URLs and
non-replay of HTTP failures. `examples/read.mjs` is a minimal external consumer.

## Durable alert events (0.2.0)

Grant `events:read` plus `alerts:read` (or `geofences:read`) to the application and token. Use
`eventCheckpoint()` before reading current alert state, then `events({cursor,
limit})` to reconcile and resume. Each page returns `data`, `next_cursor` and
`has_more`. Store the next cursor atomically with your processed snapshots, even
for empty pages. Do not advance it after a failed request. Rotation preserves a
cursor; grant changes return 409 and require rebuilding your projection.

The feed also carries geofence events and `automation.triggered.v1`, whose `data`
is `workflow_uuid`, `action_id`, `name` and `node_id`. Check `event.type` before
reading `data`.

The packed `examples/project.mjs` demonstrates bootstrap, single-writer locking,
atomic file replacement and restart across separate Node processes. Run it with
an output path and the same environment variables as `examples/read.mjs`; pass
`--rebuild` to replace old state after a grant change. After a crashed process,
confirm it is stopped before removing a stale `.lock`. For production, use a
transactional database and deduplicate business side effects by event ID.

The journal begins at deployment with no historical transition backfill. Existing
alerts are reconciled through the current-state API. Events are retained
indefinitely for now; configurable retention remains pending. Signed webhook delivery is available separately.
See [the event feed](../../docs/features/integrations.md#event-feed) for the contract and limits.

## Webhook verification (0.3.0)

Verify the exact raw request body before JSON parsing:

```ts
import { verifyWebhook } from '@iot-os/integration-sdk'
const event = await verifyWebhook({
  body: rawBody, // Uint8Array/Buffer, or the untouched UTF-8 body string
  secret: process.env.IOT_WEBHOOK_SECRET!,
  signature: request.headers.get('x-iot-signature') ?? '',
  timestamp: request.headers.get('x-iot-timestamp') ?? '',
  deliveryId: request.headers.get('x-iot-delivery-id') ?? '',
})
```

The default/max clock-skew window is 300 seconds. This verifies HMAC and the event
contract; it does not remember receipts. Deduplicate event IDs durably before
acknowledging a delivery. Retries can arrive out of order: use a verified webhook
as a wake-up for the cursor feed when maintaining an ordered projection.
See [webhooks](../../docs/features/integrations.md#webhooks) for destination policy,
configuration, key rotation and retries. No SDK package has been registry-published.

## Telemetry reads (0.4.0)

Grant `telemetry:read` and issue a token with that ability.

```js
const latest = await client.latestTelemetry(deviceUuid)
const history = await client.telemetryHistory(deviceUuid, {
  parameterUuid, from: '2026-09-25T10:00:00Z', to: '2026-09-25T11:00:00Z', maxPoints: 500,
})
```

History is receipt-time chart aggregation over at most 31 days, clipped by
retention. Empty data is not zero; latest quality/timestamps must be checked.
Independent parameter readings are not paired GPS fixes. See
[the telemetry contract](../../docs/features/integrations.md#telemetry-semantics) for bounds and semantics.

## Raw records and paired location fixes (0.5.0)

`telemetryRecords(deviceUuid, {parameterUuid, from, to, pageSize?, limit?, cursor?})`
reads unaggregated good-quality observations with signed keyset pagination. Check
`meta.limit_reached`; the total cap is not a complete export.

`locationBindings(deviceUuid)` lists approved immutable location bindings.
`locationFix(deviceUuid, eventUuid, versionUuid)` resolves stored evidence through
the selected binding. Incomplete or stale fixes remain unknown; historical fixes
are not live eligible. Both use the existing `telemetry:read` ability. See
[raw/location semantics](../../docs/features/integrations.md#telemetry-semantics).

## Batch latest (0.6.0)

`latestQuery(deviceUuids)` reads the latest values of 1 to 100 granted devices in one
request (`telemetry-latest-batch.v1`) under the existing `telemetry:read` ability, so
a plant's first frame costs one request instead of one per device. Entries follow the
request order; each carries `readings` exactly as `latestTelemetry()` returns `data`
for that device, plus the device's `presence` and `last_seen_at` as `device()`
returns them (the control plane's view, while `latestTelemetry()` reports the
runtime's own presence). A device that never reported has `readings: []` and
`configuration_uuid: null`, never zeros.

```js
const snapshot = await client.latestQuery(deviceUuids)
for (const entry of snapshot.data) {
  console.log(entry.device_uuid, entry.presence, entry.readings.length)
}
```

A device outside the grant refuses the whole request with 404; more than 100 devices
or a repeated device is a 422, which the client also rejects before sending.

## The telemetry stream (0.6.0)

`telemetryStream({ devices?, after?, signal?, maxRetryMs? })` follows the granted
devices' readings as the platform commits them, as an async iterator over a
server-sent event stream (`GET telemetry/stream`, abilities `telemetry:stream` and
`telemetry:read`). It yields three event types and nothing else:

| Event | Fields | Meaning |
| --- | --- | --- |
| `open` | `position`, `devices`, `openedAt` | Sent once per connection, first: where the stream starts (the position resumed from, or the current head) and how many devices it carries |
| `reading` | `position`, `eventId`, `deviceUuid`, `configurationUuid`, `generation`, `readings[]` | One committed event of one granted device, in storage order; `readings[]` items carry `parameter_uuid`, `key`, `data_type`, `unit`, `value`, `quality`, `observed_at`, `received_at` and `historical` |
| `reset` | `position` | The position resumed from is no longer retained; `position` is the current head |

```ts
for await (const event of client.telemetryStream({ devices, signal })) {
  switch (event.type) {
    case 'open':    snapshot = await client.latestQuery(devices); break // then apply readings
    case 'reading': apply(event); last = event.position; break
    case 'reset':   snapshot = await client.latestQuery(devices); break // the iterator continues from event.position
  }
}
```

**Resume and reset.** Positions are opaque strings: compare them for equality, never
compute with them. The iterator remembers the last `reading` position and reconnects
with it (`Last-Event-ID`) after the platform's hourly `closed` (`lifetime`), after a
`grant_changed` or `credentials_changed` close, after a dropped connection or a 503,
so the join is gapless: every retained event after the position arrives first, then
live ones. Pass `after` to resume a position you stored. When that position is older
than what the platform retains (eight days, or the organization's retention when
shorter), the iterator yields `reset` with the current head, takes it as its position
and reconnects: take a new snapshot (`latestQuery`) and apply readings from there. The
same event can arrive again only across a reconnection from an older position;
deduplicate by `eventId` when it matters.

**Order of work.** Open the stream, and take the snapshot after the `open` (or
`reset`) position arrives; readings with a greater position then update it. A
reading of the same device with a later `received_at` only ever has a greater
position within one connection.

**Failures and limits.** Reconnects back off from 1 s to 30 s and give up with
`IotTransportError` after `maxRetryMs` of consecutive failures (default 300 000;
`0` retries for ever). 401, 403, 404 (a device in `devices` is not granted), 422
(more than 1000 devices, a repeat, or a position the platform never issued) and 429
(the application already holds 2 open streams, or the organization 10; see
`retryAfterSeconds`) are thrown as `IotApiError`. Aborting `signal` ends the
iteration quietly. Opening a stream counts as one request against the per-minute
limit; data on an open stream does not. `examples/stream.mjs` prints a stream.

## Location map and geofences

`locationMap({deviceUuids, trailWindow, includeTrails, geofenceUuid})` needs
`locations:read`. `geofences()`, `geofence(id)` and `geofenceActivation(id, batch)`
need `geofences:read`; `createGeofence`, `updateGeofence` and
`retryGeofenceActivation` need `geofences:manage` and `geofences:activate` and return
an activation batch to poll. See [integrations](../../docs/features/integrations.md#integration-api).

## Parameters and sites (0.6.0)

`device(deviceUuid)` now carries what a twin can bind: `profile` (`uuid`, `name`,
`revision`), `site` (`uuid`, `name`, `timezone`) and `parameters`, each with `uuid`,
`key`, `name`, `unit`, `data_type`, `decimals`, `accepts_command` and `reports_state`.
`profile` and `site` are `null` when absent and `parameters` is empty when the device
has no profile revision; the device list is unchanged. The fields are validated when
present, so the client still reads a platform that does not send them.

```ts
const device = await client.device(deviceUuid)
for (const parameter of device.parameters ?? []) {
  console.log(parameter.key, parameter.unit, parameter.accepts_command ? 'setting' : 'reading')
}
const sites = await client.sites() // needs entities:read
```

`sites()` returns every site of the organization, ordered by name, with
`granted_devices_count`: the devices at the site within the application's grant. A
grant can now be a scope of sites instead of a device list, so an application
follows a plant as devices are added; see
[grants by site](../../docs/features/integrations.md#grants-by-site).

## Changelog

### 0.6.0

Additions, for applications that follow a plant (spec 030); nothing from 0.5 changed:

- `device()` carries `profile`, `site` and `parameters`; `sites()` lists the
  organization's sites with `granted_devices_count` (`entities:read`).
- `latestQuery(deviceUuids)` reads the latest values of 1 to 100 granted devices in one
  request (`telemetry-latest-batch.v1`).
- `telemetryStream(options)` follows readings as server-sent events with resume, reset
  and reconnection (`telemetry:stream`).
- Every 0.5 method keeps its signature, validators and errors; the test suite checks
  each against its contract example.

### 0.5.0 and earlier

Raw records and paired location fixes (0.5.0), telemetry reads (0.4.0), webhook
verification (0.3.0), durable alert events (0.2.0), devices and alerts (0.1.0).
