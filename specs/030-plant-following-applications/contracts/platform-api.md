# Contract: platform API additions

The request-based additions of [spec 030](../spec.md). The stream has
[its own contract](telemetry-stream.md). Every operation below is described in the
OpenAPI contract (`contracts/openapi/supplements/integration.yaml`) with an example that
is its golden fixture, and lands in `packages/api-client` and the SDK in the same pull
request (constitution IV). Base path for applications:
`/api/integration/v1/organizations/{organization}`.

## Batch latest

`POST telemetry/latest/query` · ability `telemetry:read`

Request:

```json
{ "device_uuids": ["<uuid>", "<uuid>"] }
```

Rules: 1 to 100 distinct UUIDs. Any UUID outside the application's resolved grant
refuses the whole request with 404 and reveals nothing. 422 names the limit or the
repeat.

Response `200`, `telemetry-latest-batch.v1`, one entry per requested device in request
order:

```json
{
  "schema_version": "telemetry-latest-batch.v1",
  "data": [
    {
      "device_uuid": "<uuid>",
      "configuration_uuid": "<uuid>",
      "presence": "online",
      "last_seen_at": "2026-11-07T09:41:58Z",
      "readings": [
        {
          "parameter_uuid": "<uuid>", "key": "vibration", "label": "Vibration",
          "data_type": "float", "unit": "mm/s", "value": 1.8, "quality": "good",
          "observed_at": "2026-11-07T09:41:57Z", "received_at": "2026-11-07T09:41:58Z",
          "last_valid_received_at": "2026-11-07T09:41:58Z",
          "timestamp_source": "device", "historical": false
        }
      ]
    },
    { "device_uuid": "<uuid>", "configuration_uuid": null, "presence": "unknown",
      "last_seen_at": null, "readings": [] }
  ]
}
```

`readings[]` is the single-device latest read's `data[]`, unchanged. `presence` and
`last_seen_at` are the device read's values. 503 when the runtime is unavailable, never
an empty answer.

## Device read with parameters (additive)

`GET devices/{uuid}` · ability `devices:read`

```json
{
  "data": {
    "uuid": "<uuid>", "code": "P-201", "name": "Filler pump P-201",
    "lifecycle": "active", "presence": "online", "last_seen_at": "2026-11-07T09:41:58Z",
    "profile": { "uuid": "<uuid>", "name": "Pump", "revision": 3 },
    "site": { "uuid": "<uuid>", "name": "Packaging hall", "timezone": "Asia/Colombo" },
    "parameters": [
      { "uuid": "<uuid>", "key": "vibration", "name": "Vibration", "unit": "mm/s",
        "data_type": "float", "decimals": 1, "accepts_command": false, "reports_state": false },
      { "uuid": "<uuid>", "key": "setpoint", "name": "Speed setpoint", "unit": "rpm",
        "data_type": "integer", "decimals": 0, "accepts_command": true, "reports_state": true }
    ]
  }
}
```

`profile` and `site` are null when absent; `parameters` is empty when the device has
no profile revision. The device list (`GET devices`) is unchanged.

## Sites

`GET sites` · ability `entities:read` (new)

```json
{
  "data": [
    { "uuid": "<uuid>", "name": "Packaging hall", "timezone": "Asia/Colombo",
      "address": "Example Road 1", "latitude": 6.9, "longitude": 79.8,
      "granted_devices_count": 212 }
  ]
}
```

Every site of the organization, ordered by name, not paginated.
`granted_devices_count` counts devices in the application's resolved grant. 403 without
the ability.

## Grants by site (management API, session)

`PUT /api/v1/organizations/{organization}/applications/{application}` (existing) accepts
either list:

```json
{ "revision": 4, "name": "Twin Studio", "abilities": ["devices:read", "telemetry:read", "telemetry:stream", "entities:read"],
  "device_uuids": [], "site_uuids": ["<uuid>", "<uuid>"] }
```

Rules: exactly one of `device_uuids` (1 to 100) and `site_uuids` (1 to 50) is
non-empty; every site belongs to the organization (422 otherwise). The application
view returns both lists plus `devices[]` and `sites[]` (`uuid`, `name`). Saving a scope
has the consequences of saving a list: revision and grant revision bump, tokens
deleted, webhook disabled, cursors rejected. Deleting a site removes it from every
scope naming it with the same consequences and the audit reason `site_deleted`.

`POST .../applications` (create) accepts the same two lists.

## Abilities

Two new abilities: `entities:read` and `telemetry:stream`. `telemetry:stream` requires
`telemetry:read` on both the application and the token. `x-abilities` in the contract
and the hardcoded lists in `IntegrationContractTest` are updated with them.

## Platform status

`GET /internal/ops/metrics` (operators) gains `integration_streams_open` per
organization; the admin app's organization page lists open streams (application,
opened, devices, last position). The runtime's `GET /internal/status` gains
`streams: {open}`.

## SDK 0.6 surface

```ts
client.latestQuery(deviceUuids: string[], signal?): Promise<LatestBatch>
client.sites(signal?): Promise<Site[]>
client.device(id): Promise<Device>            // now with profile, site, parameters
client.telemetryStream(options): AsyncIterable<StreamEvent>   // see the stream contract
```

Version `0.6.0`; everything in 0.5 is unchanged.
