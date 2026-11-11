# Contract: Internal Messages

Changes to the Laravel–runtime contracts in `contracts/internal/`, and one to the
runtime's internal HTTP reads. All are additive and optional. Each contract changes its
schema, fixture and cases together with the Go and PHP tests that read them, in the
same pull request (constitution IV, ADR-015). The activation, configuration and adapter
deploy payloads don't change: a successor is an ordinary device whose definition names
its own organization.

## `internal.control-state.v1`: a gateway's own organization (PR 031-7)

Each item in `connections[]` gains an optional `gateways` list. It names only the
gateways whose organization differs from the connection's, which today means direct
devices that moved:

```json
{
  "uuid": "…",
  "organization_uuid": "<source organization>",
  "group_id": "onboarding-<source organization uuid>",
  "host_id": "…",
  "username": "…",
  "password": "…",
  "broker_url": "…",
  "gateways": [
    { "edge_node_id": "device-…", "organization_uuid": "<target organization>" }
  ]
}
```

- The runtime keeps `edgeOrganization(connection, edge)`. It is the override when one
  exists, else the connection's organization.
- It uses that organization for capture checks and recording
  (`internal/app/telemetry.go`, `internal/app/application.go`) and for gateway episodes
  (below).
- An absent or empty `gateways` behaves as today.
- Cases: the field absent; an empty list; an override; an edge listed twice (refused).

## `device.connectivity.v1`: hosted gateway episodes (PR 031-5)

A gateway episode is attributed to the gateway's organization, no longer to its first
member's (`internal/app/connectivity.go`). In PR 031-5 that is the connection's
organization, which the tracker learns from the control state's `connections[]`
(`connectivityTracker.organize`, called in `syncState` before any gateway is
evaluated); PR 031-7 makes it `edgeOrganization`, with the per-edge override. When an
offline gateway also carries devices of other organizations, the runtime keeps one
more episode per such organization:

- it is keyed `gateway:<connection>/<edge>@<organization uuid>`;
- it holds only that organization's devices;
- its event carries that organization and a new optional subject field.

```json
{
  "organization_uuid": "<hosted device's organization>",
  "subject": {
    "kind": "gateway",
    "device_uuid": null,
    "connection_uuid": "…",
    "edge_node_id": "gw-7",
    "adapter_uuid": null,
    "pipe_organization_uuid": "<gateway's organization>"
  }
}
```

The rest of the payload is unchanged: `episode`, `transition`, `affected_device_uuids`
and so on.

- `pipe_organization_uuid` is null or absent on every other episode.
- The owner's episode then holds only the owner's devices; when every device behind
  the gateway is hosted, the owner has no episode.
- The projector (`ConnectivityProjector`) takes the subject from the event's
  organization as today. When `pipe_organization_uuid` is set, it resolves the gateway
  there instead, through `Pipes::hostedGateway`. It accepts the subject only when both
  organizations share a billing account and every affected device is a hosted device of
  that gateway. It stores the alert in the hosted organization with the episode key
  `gateway:<connection>/<edge>@<organization uuid>#<episode>`, showing the pipe's name
  only (`subject.uuid` is null, [platform API](platform-api.md#hosted-gateway-alerts-pr-031-5)).
- A stored hosted row that no device claims any more is stopped as
  `definition_removed` in its organization, with `pipe_organization_uuid` from the
  connection.
- Existing episode keys `gateway:<connection>/<edge>` keep meaning the gateway owner's
  episode, so stored rows (`device_runtime.connectivity`) need no migration.
- Cases: a hosted subject with and without the field; the field on a device subject
  (refused).

## `GET /internal/measurements/history`: a chosen bucket width (PR 031-9)

The history read takes an optional `bucket_seconds`, from 1 to a year, that replaces
the width the range would give. Laravel passes one width to both reads of a moved
device's history (research R18), so their buckets share edges. A width that would give
more than `max_points` buckets in the range is 422. Without it the read behaves as
today.
