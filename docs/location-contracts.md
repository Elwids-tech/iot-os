# Location contracts and deterministic fixtures

This is the location foundation for rules, not a geofence evaluator, alert engine,
GPS dashboard or hardware adapter. It resolves one committed event into a typed
location fix without reading a latest-value cache or changing runtime state.

## Binding and coordinate semantics

`contracts/location/v1/binding.schema.json` defines an immutable binding identity
and revision, organization/device/configuration/generation, latitude and longitude
parameter UUIDs, optional accuracy parameter, and explicit timing/accuracy policy.
Binding authoring, persistence and activation are future rule-engine work.

- Coordinates are WGS84 decimal degrees, bound to numeric parameters whose unit is
  exactly `deg`. Latitude is -90 through 90; longitude is -180 through 180.
- Output uses named `latitude` and `longitude` fields. GeoJSON fixture polygons
  use the standard `[longitude, latitude]` ordering.
- Accuracy is optional, numeric, nonnegative and measured in `m`. Missing accuracy
  stays `null`; `allow_unknown_accuracy` explicitly determines eligibility.
  A supplied invalid or mismatched accuracy reading is never silently ignored.
- `same_event` pairing is an explicit source/adapter assertion that the two
  parameters represent one fix. They must occur exactly once in the same committed
  event, with equal observation/receipt times, historical flags and time provenance.
  No cross-event or latest-value joining occurs. Batch adapters that cannot make
  this assertion need a future grouped-fix contract before using this binding.
- Configuration, generation and tenant/device identities must match. Changing a
  binding revision does not silently rewrite a historical result.

## Timestamp provenance and eligibility

New readings and committed projections carry optional `timestamp_source`:

| Value | Meaning |
| --- | --- |
| `source` | A source metric or payload timestamp was present; this does not prove clock synchronization |
| `receipt` | No source timestamp was available; existing ingestion used receipt time |
| `corrected_future` | Existing ingestion detected a source timestamp over five minutes ahead and substituted receipt time |
| `derived` | A calculation produced the reading at platform receipt time |
| absent | Legacy data; treated as unknown provenance |

This is an additive contract field. Existing fixtures and stored records without
the field remain readable. The runtime continues its existing timestamp fallback
behavior; provenance makes that behavior explicit rather than altering values.

The first resolver requires `source` provenance for GPS. Receipt fallbacks,
corrected clocks, calculated coordinates and unknown provenance produce unknown
fixes. This conservative policy can be revisited when a real adapter provides a
reliable fix-identity/time contract.

`max_age_seconds` is required (1–86400). Both observation and receipt must be within
that age at evaluation; the exact maximum is inclusive. `max_future_skew_seconds`
is required (0–300) and bounds source time relative to receipt. A timestamp beyond
evaluation time or a future receipt is ineligible even within that skew allowance.
This allows a slightly ahead source clock only after evaluation time catches up.

A structurally valid historical fix can retain coordinates for historical display,
but always has `live_eligible: false` and reason `historical`. A delayed unflagged
observation is stale according to its original observation time. Fresh receipt
alone cannot make an old location live.

Unknown fixes have `point: null` and cannot imply safe location or an escape. Device
connectivity, animal assignment and polygon membership are deliberately absent.

## Resolver interface

The Go `location.Resolve(binding, committedEvent, evaluatedAt)` function is pure
and deterministic. Its `location-fix.v1` result includes binding/event identities,
timing/provenance, `status`, `reason`, `historical`, `live_eligible`, and an optional
point. Invalid binding/envelope inputs return an error; well-formed but ineligible
fixes return an unknown result with a diagnostic reason.

The internal preview endpoint is `POST /internal/locations/resolve`, protected by
the existing runtime bearer token. Input has `binding`, `event`, `evaluated_at`.
It returns HTTP 200 for a resolved valid/unknown fix, 422 for invalid input and
401 without authentication. It does not fetch private state or activate anything.

An explicit evaluation time allows deterministic replay. Future live consumers
must supply their own current trusted time, not reuse a fixture time to grant
eligibility to old events. The resolver neither deduplicates delivery nor stores
rule state; future consumers retain responsibility for those concerns.

## Simulator fixtures

`contracts/location/v1/scenarios.fixture.json` contains 30 reproducible scenarios:
inside, outside, boundary, jitter on both sides, re-entry, no fix, missing or
incoherent coordinates, stale/delayed/history, fallback/corrected/legacy/derived
time, future clock, unknown/required/invalid accuracy, wrong units, invalid ranges,
tenant/configuration/generation changes, reconnect, duplicate delivery and restart.

The polygon is test data only. Inside/outside/boundary names identify intended
future geofence cases; current expected results assert coordinate validity and
eligibility, not polygon membership. Duplicate/restart scenarios verify deterministic
normalization, not completed stateful alert recovery.

```bash
rtk proxy python3 tooling/simulators/location_scenarios.py
rtk proxy python3 tooling/simulators/location_scenarios.py --scenario stale
rtk proxy python3 tooling/simulators/location_scenarios.py \
  --interval-seconds 60 --accuracy-metres 12
```

The generator emits fixture JSON to stdout and has no network or device side
effects. Defaults are a 30-second interval, 5-metre reported accuracy and a
three-interval age limit. These are test parameters, not claims about Laine's tags.
`--scenario` emits exactly the internal resolver request for one named case.

## Verification

- `rtk proxy python3 -m unittest discover -s tooling/simulators -p 'test_location_scenarios.py'`
- `rtk proxy .local/devices/python/bin/python tooling/verify-devices-contracts.py`
- `rtk proxy go test ./...` from `services/runtime`
- `rtk proxy node tooling/test-devices.mjs` for existing database/broker, command,
  browser and outage regressions after changing ingestion metadata.

The Go tests execute all shared scenarios, compare the output fixture, reject
nonfinite/string/boolean coordinates, check policy limits and enforce internal
authentication. Runtime image verification replays all cases through the protected
endpoint and validates the returned fix documents against the output schema.

No public API/UI, geofence decision, rule activation, alert delivery or device
command is introduced by this step.
