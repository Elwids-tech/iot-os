# Contract: integration events

Two new `integration-event.v1` types, described in
`contracts/openapi/supplements/integration-events.yaml`, added to the SDK's type union
(`packages/integration-sdk`), and documented in `docs/reference/events.md`.

| Type | Written when |
| --- | --- |
| `connectivity.offline.v1` | a connectivity alert opens (not suppressed), once per affected device |
| `connectivity.online.v1` | that alert clears, once per affected device that received the offline event |

Suppressed alerts write nothing until revealed (D8); a stopped alert writes nothing.
Acknowledgement writes no connectivity event.

Each event's `device_uuid` is the affected device, so the feed's and webhook's device
grant filter applies unchanged. Its resource id is a UUID v5 of the alert UUID and the
device UUID, which keeps `(resource_uuid, type)` unique per device.

Delivery to an application requires `connectivity_events = true` and the
`events:read` and `alerts:read` abilities; otherwise the feed skips the event (its
cursor still advances, as it does for ungranted devices) and the webhook worker creates
no delivery.

```json
{
  "type": "connectivity.offline.v1",
  "data": {
    "alert_uuid": "…",
    "kind": "gateway_offline",
    "severity": "warning",
    "cause": "death_certificate",
    "device_uuid": "…",
    "gateway": { "uuid": "…", "name": "Line 2 gateway" },
    "adapter": null,
    "offline_since": "2026-10-25T14:02:11Z",
    "last_seen_at": "2026-10-25T14:02:09Z",
    "last_observed_at": null,
    "cleared_at": null
  }
}
```

`connectivity.online.v1` carries the same `data` with `cleared_at` set.

## Alert reads

`GET integration/v1/organizations/{organization}/alerts` and `alerts/{uuid}` return
connectivity kinds only to applications with `connectivity_events` on. For every other
application they are filtered out (and `alerts/{uuid}` returns 404), so the
`IntegrationAlert` schema those applications rely on, which requires `workflow_uuid`
and `workflow_name`, is unchanged for them. The OpenAPI supplement adds
`IntegrationConnectivityAlert` (`kind`, `subject`, `cause`, `devices`, with no workflow
fields), and the alert list's items become `oneOf` the two, discriminated by `kind`.
