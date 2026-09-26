# External telemetry reads

Delivered with TypeScript SDK 0.4.0. These read-only endpoints use the existing
application identity, organization/device grants, token expiry and shared request
quota. Both the token and current application grant must include `telemetry:read`.
Existing applications do not gain this ability automatically; update grants and
issue a new token. No platform database or runtime credentials reach consumers.

Base: `/api/integration/v1/organizations/{organization_uuid}`.

## Latest

`GET /devices/{device_uuid}/telemetry/latest`

Returns `schema_version: telemetry-latest.v1`, `device_uuid`, nullable
`configuration_uuid`, `presence`, and `data` (readings). Readings expose
`parameter_uuid`, `key`, `label`, `data_type`, nullable `unit`, `value`, `quality`,
`observed_at`, `received_at`, `historical`, and optional `timestamp_source` and
`last_valid_received_at`. Internal diagnostic fields are omitted.

Quality and timestamps describe the retained value; receiving this HTTP response
does not make the measurement fresh. Inactive ingestion can retain values with
`inactive` quality. Device presence is separate from measurement quality. An
unconfigured device returns an empty array, never synthetic zero measurements.
The runtime chooses the active configuration, or the last applied configuration
when inactive. This is a current read, not a transactional snapshot with history.

## Chart history

`GET /devices/{device_uuid}/telemetry/history?parameter_uuid=...&from=...&to=...&max_points=500`

- Required UUID parameter and RFC3339 timestamps with seconds and explicit offset
  or `Z`; fractional seconds are not supported in request bounds.
- `to` must follow `from`; the requested window cannot exceed 31 days.
- `max_points` is an aggregation target, 10–1000 (default 500), not a guaranteed
  result count. The runtime rejects more than 2000 resulting points with 422.
- History is selected and bucketed by **receipt time**, with inclusive boundaries.
  Numeric values are bucket averages with `min`, `max`, and `count`; nonnumeric
  values retain individual entries. Numeric gaps may have null value and count 0.
- Results remain separated by configuration, type and unit. Never merge them
  without interpreting configuration changes.
- The runtime clips bounds to effective organization retention and current time.
  The response includes `retention_days` and the effective `from`/`to`; when the
  clipped interval is empty, both bounds are null and `data` is empty.

Response: `schema_version: telemetry-history.v1`, `device_uuid`, `parameter_uuid`,
the metadata above, and `data: [{configuration_uuid, data_type, unit, points}]`.
Each point has `at`, `value`, `count`, and optional `min`/`max`. Empty data means no
available observations in the effective interval; it does not mean zero.

An unknown parameter on an authorized device returns an empty history. Unknown
or ungranted devices and foreign organizations return 404. Missing ability returns
403; invalid credentials return 401. Runtime failure returns 503, never empty data.

## SDK

```ts
const latest = await client.latestTelemetry(deviceUuid);
const history = await client.telemetryHistory(deviceUuid, {
  parameterUuid,
  from: '2026-09-25T10:00:00Z',
  to: '2026-09-25T11:00:00Z',
  maxPoints: 500,
});
```

Both methods support cancellation, validate the public response, and retain the
SDK's existing timeout/error behavior. They do not retry automatically.

SDK 0.5.0 adds [raw observation pagination and stored paired fixes](integration-raw-location.md). Telemetry streaming/webhooks and complete ML export remain pending. Do not combine independent latest
latitude/longitude values or aggregated history into a GPS fix. Those require
separate source-fix/provenance contracts. Alert events remain the durable external
event feed.

## Local verification

Rebuild API and workers using the normal Devices Compose stack. Run
`tooling/verify-integration-sdk.php` in the API container with
`IOT_VERIFY_TELEMETRY=1`, copy its private fixture JSON to `/tmp/iot-sdk-fixture.json`,
then run `node tooling/verify-telemetry-sdk.mjs`. `IOT_SDK_MODULE` can select an
independently installed SDK build. Signal `/tmp/iot-sdk-release` in the container
and remove the host JSON afterward. The fixture uses isolated synthetic telemetry
rows and deletes them and all temporary credentials on exit; it does not command
hardware. Unit/API checks additionally cover validation and runtime failure.
