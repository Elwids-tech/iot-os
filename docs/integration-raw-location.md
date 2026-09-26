# Raw observations and stored location fixes

SDK 0.5.0 extends [telemetry reads](integration-telemetry.md). Every endpoint below
requires `telemetry:read` on both the application and token, plus the device grant
and current organization ownership. Existing credentials with this ability can
read these contracts. No new write or command permission is introduced.

Base: `/api/integration/v1/organizations/{organization_uuid}`.

## Raw observation pages

`GET /devices/{device_uuid}/telemetry/records`

Required query: `parameter_uuid`, `from`, `to`. Timestamp syntax and the 31-day
maximum window match chart history. Optional `page_size` is 1–100 (default 50),
`limit` is 1–5000 total records across pages (default 500), and `cursor` is an
opaque signed string, at most 512 characters.

The response has `schema_version: telemetry-records.v1`, device/parameter UUIDs,
`data`, and `meta`. Rows expose event/configuration/parameter UUIDs, receipt and
observation timestamps, data type, nullable unit, original value, quality,
timestamp source and historical flag. Legacy rows without timestamp provenance
return an empty source string, not an inferred trusted source. Internal
diagnostics are omitted.

Rows are the unaggregated **good-quality observation store**, not every attempted
ingestion reading. Invalid measurements live in diagnostics and are not included.
An empty page means no available good observations, never a zero measurement or
proof that no invalid input occurred. Retention limits availability.

Ordering is descending `(received_at, event_uuid)`, with keyset pagination to
avoid duplicates when timestamps tie. Keep device, parameter, original bounds
and total `limit` unchanged when passing `meta.next_cursor`. The cursor signature
binds these fields and organization; changing them or tampering returns 422.
Authorization is checked anew on every page. Runtime signing-key rotation can
invalidate cursors; callers must restart a bounded query and deduplicate.

Metadata includes effective retention-clipped `from`/`to`, `page_size`, `limit`,
`returned`, cumulative `consumed`, `next_cursor`, `has_more` and `limit_reached`.
When the total cap hides additional records, `limit_reached` is true and there is
no continuation cursor. Use smaller time windows and deduplicate their inclusive
boundaries; do not treat a capped result as a complete export.

This is not a frozen snapshot or durable stream checkpoint. Concurrent retention
cleanup and new writes can change available rows between pages. Stable IDs allow
reconciliation; this contract makes no complete ML-export guarantee.

## Approved location bindings

`GET /devices/{device_uuid}/location-bindings?page=1&per_page=25`

Returns the standard paginated envelope containing `{version_uuid, binding}`.
`version_uuid` identifies an immutable, successfully applied workflow deployment.
The binding contains its pinned device configuration/generation, coordinate
parameters, optional accuracy parameter, pairing policy and freshness limits.
Workflow geometry, actions, people and notification settings are not exposed.

Historical/superseded/stopped applied versions remain available for interpreting
their evidence. Listing a binding does not mean that its workflow is currently
active. Draft, failed and inactive-target deployments are excluded. There is no
implicit choice of the newest version; the consumer selects the matching version.
Standalone location-binding authoring is not introduced by this slice.

## Resolve a stored event

`GET /devices/{device_uuid}/locations/{event_uuid}?version_uuid={version_uuid}`

The API loads the approved immutable binding, then the runtime retrieves the
persisted committed event by event ID, tenant and device. Consumers cannot submit
replacement coordinates, bindings or evaluation time. Evidence outside the
effective retention window, absent evidence, ungranted devices, or unrelated
binding versions return 404. Storage failures remain 503.

Response: `{version_uuid, data: LocationFix}`. The `location-fix.v1` data includes
binding identity/revision, event/device/configuration identity and generation,
server evaluation time, source observation/receipt times, timestamp provenance,
historical flag, `status`, `reason`, `live_eligible` and nullable `point`.

Resolution reuses the same deterministic resolver as geofencing:

- `same_event` is an explicit approved adapter/binding assertion, not a universal
  assumption that any packet's coordinates belong together.
- Both axes must be present, good quality, in degrees, in range, and share fix
  timestamps/provenance. Scope/configuration/generation must match the binding.
- Missing/incoherent/invalid/stale evidence returns `unknown` with a null point
  and reason. Independent latest values are never combined; no fallback to an
  older valid event is performed.
- Unknown accuracy remains null and is accepted only when the binding allows it.
- Historical coherent evidence can return a valid point but is never live eligible.
  Old nonhistorical evidence is evaluated at server time and may be stale/unknown;
  this endpoint does not reclassify it as historical to manufacture a point.

`live_eligible` describes source-fix eligibility at the returned evaluation time,
not device presence, workflow activation, geofence membership or authorization to
act. Reads do not evaluate live rule state or cause notifications or commands.

The retained committed-event outbox supplies event evidence; its sequence and
internal message payload are not exposed as a public stream. Read access is
retention-filtered even while internal rows are retained longer. A future outbox
cleanup/archive policy may make an old event unavailable.

## SDK example

```ts
const page = await client.telemetryRecords(deviceUuid, {
  parameterUuid: latitudeParameterUuid,
  from: '2026-09-25T10:00:00Z', to: '2026-09-25T11:00:00Z',
  pageSize: 50, limit: 500,
});
const bindings = await client.locationBindings(deviceUuid);
// Select the approved version matching the record's configuration and intended binding.
const fix = await client.locationFix(deviceUuid, eventUuid, versionUuid);
```

The SDK preserves raw provenance, validates pagination and fix semantics, and
supports cancellation. It does not automatically retry or hide the total cap.

## Verification

The existing local `IOT_VERIFY_TELEMETRY=1` fixture and
`tooling/verify-telemetry-sdk.mjs` now cover same-time keyset pages, signed cursor
tampering/scope, total caps, a complete paired fix, an incomplete fix returning
unknown, and binding/device isolation. Synthetic committed events are already
marked published and never enter the live broker/rules pipeline. Fixture cleanup
removes all temporary telemetry, grants and credentials.

The isolated Devices suite tests database scope/retention/provenance and retains
the location resolver's existing scenario coverage. No production deployment or
package-registry publication is implied.
