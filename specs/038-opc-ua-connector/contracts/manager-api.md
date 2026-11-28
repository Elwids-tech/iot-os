# Contract: Adapter manager and runtime

Private routes on `adapter-manager`, called by Laravel with the manager token, in the
style of `/poll-test`. Schemas, fixtures and cases are added to
`contracts/adapters/v1` in the pull request that adds each route.

Every body carries `tenant` (uuid), `connection` (uuid, endpoint, security, identity,
pinned fingerprint), its secrets, and `private_ranges`. The manager uses the tenant
runtime's live session when the connection is deployed, otherwise a session of its own
that closes after 2 idle minutes.

| Route | Returns |
| --- | --- |
| `POST /opcua/endpoints` | Offered security choices, sign-in methods, the server certificate (subject, fingerprint, validity) |
| `POST /opcua/test` | `{connected: true, limits, clock_difference_ms}` or `{reason, detail}` |
| `POST /opcua/browse` | Children of `parent` with a cursor |
| `POST /opcua/read` | Attributes and values for up to 200 node addresses |
| `POST /opcua/search` | Matches within a branch, with `truncated` |
| `POST /opcua/similar` | Candidate equipment with missing readings |
| `POST /opcua/check` | The review check for a point map: per point value, status, problem |

`/deploy` for an `opcua` adapter carries `connection`, its secrets and PKI material,
`point_map` and `bindings`; the flow has no decoder node.

## Results the source emits (decoder-output v1, additive)

```json
{
  "sourceDeviceId": "ExampleTower/Floor3/Zone2/ZoneController",
  "observedAt": "2026-11-25T10:15:02.120Z",
  "timestampSource": "source",
  "metrics": [
    { "name": "zone_temperature", "value": 22.4, "unit": "°C" },
    { "name": "damper_position", "value": null, "quality": "bad", "reason": "No communication with the device" },
    { "name": "supply_flow", "value": 118.0, "quality": "uncertain", "reason": "Last usable value" }
  ]
}
```

`timestampSource` is `source`, `server` (rhythm reports and values without a usable
source time) or `receipt`. `quality` defaults to `good`.

## Sparkplug metric properties the publisher adds

| Property | Type | Values |
| --- | --- | --- |
| `quality` | String | `uncertain`, `bad` (absent for good) |
| `quality_reason` | String | Plain words, at most 120 characters |
| `timestamp_source` | String | `receipt` (existing), `server` (new) |

A bad metric is sent with `is_null`.

## Runtime events (runtime-event v1, additive kinds)

- `connection_status`: connection uuid, state, reason with its message and fix, since,
  security, points read, points bad, values in the last minute, clock difference,
  server limits. Sent when the state changes and every minute.
- `refused_points`: connection uuid, adapter uuid, a list of source id, reading key
  and reason (replaces the previous list for that adapter).
- `server_certificate`: connection uuid and the certificate now presented, when it
  differs from the pinned one. Collecting has already stopped.
