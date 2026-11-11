# Contract: Platform API for Moves and Hosted Devices

Public HTTP API changes for [spec 031](../spec.md). Every route is under
`/api/v1/organizations/{organization}` with `auth:sanctum` and
`ResolveOrganizationContext`, unless noted otherwise. Each pull request exports the
OpenAPI description (`php artisan contract:export`), with examples, and updates
`packages/api-client` in the same pull request (constitution IV). Errors use the
platform's usual shapes: 404 for anything outside the person's reach, 403 for a
missing permission, 409 for a conflict, and 422 with field errors.

## Targets (PR 031-1)

`GET device-move-targets` needs `Device.move` in `{organization}`.

```json
{
  "data": [{ "uuid": "…", "name": "Harbour Shop" }],
  "new_organization": { "billing_account_uuid": "…" }
}
```

- `data` lists the other organizations of `{organization}`'s billing account where
  the person is a member holding `Device.move`.
- `new_organization` is present only for an owner of the account with room under its
  organization limit (FR-003). The portal then creates the organization with the
  existing `POST /api/v1/billing-accounts/{uuid}/organizations`.

## Review (PR 031-1; items from 031-4; history from 031-9)

`POST device-moves/preview` needs `Device.move` in the source and the target. It
changes nothing.

Request:

```json
{
  "target_organization_uuid": "…",
  "device_uuids": ["…"],
  "devices": [{ "uuid": "…", "name": "Shop tracker", "code": "trk-0042", "site_uuid": null }],
  "items": [{ "kind": "dashboard", "uuid": "…", "action": "copy" }],
  "include_history": false
}
```

- `device_uuids` holds 1–100 devices.
- `devices` and `items` are optional overrides of the preselected values.

Response (`200`):

```json
{
  "preview_hash": "sha256…",
  "can_confirm": true,
  "devices": [{
    "uuid": "…", "name": "Tracker 42", "code": "trk-0042",
    "successor": { "name": "Shop tracker", "code": "trk-0042", "site_uuid": null },
    "reports_through": { "kind": "adapter", "name": "Vendor trackers", "owner_organization_name": "Integrator", "outcome": "stays" },
    "arrives_active": true,
    "blockers": []
  }],
  "items": [{
    "kind": "dashboard", "uuid": "…", "name": "Fleet", "uses_only_moving": false,
    "actions": ["copy", "keep"], "action": "copy",
    "omitted": { "panels": ["Fuel level (Tracker 7)"], "shares": [], "recipients": [], "references": [] },
    "other_devices": { "count": 38, "can_add": true }
  }],
  "ends": {
    "alerts": 1,
    "geofence_assignments": 0,
    "application_grants": [{ "name": "Fleet export", "devices": 2 }]
  },
  "profile_copies": [{
    "profile": "GPS tracker", "revision": 4, "code": "gps-tracker", "reused": false
  }],
  "pipe_owner_sees_raw_messages": true,
  "history": { "offered": true, "include": false },
  "summary": [
    "2 devices and 1 dashboard move to Harbour Shop.",
    "1 dashboard is copied with 3 of its 7 panels."
  ],
  "archives": []
}
```

Notes:

- `reports_through.kind` is `adapter`, `gateway` or `direct`. `outcome` is `stays` (a
  pipe stays with its owner) or `moves` (a direct device's own gateway).
- `blockers` hold plain sentences: "Archived", "Waiting for the runtime", "Already being
  moved", "Code already used in Harbour Shop", and before PRs 031-5 and 031-7, "Devices
  behind a gateway can't be moved yet" and "Directly connected devices can't be moved
  yet".
- `can_confirm` is false while any device has a blocker or a code clashes.
- A successor's code defaults to the device's, or to `<code>-2`, `-3`… when the target
  already has a device with it, archived ones included (a device moved back meets its
  archived predecessor's code). A code the person sets that the target uses is the
  blocker "Code already used in *target*".
- `items` and `archives` are refused when not empty, and `include_history` when true,
  until the pull requests that bring them.
- `items` is empty before PR 031-4. Until then every dashboard and automation stays,
  and `summary` says so.
- `history.offered` is false before PR 031-9.
- `archives` lists each item to be archived, so it can be confirmed on its own
  (FR-006).

## Confirm (PR 031-1)

`POST device-moves` takes the same body as the review, plus:

```json
{
  "operation_uuid": "…",
  "preview_hash": "sha256…",
  "confirmed_archives": [{ "kind": "automation", "uuid": "…" }],
  "origin": "devices",
  "proposal_uuid": null
}
```

Responses:

- `202` with the move (below). With no active device the move is already `completed`.
- `200` with the same move for a repeated identical request.
- `409` in these cases:
  - `operation_uuid` reused with another body;
  - `preview_hash` stale (the body carries a fresh review);
  - a device already in a move (its review is stale, so the body carries a fresh
    review with the blocker).
- While a device is in a stopping move, other changes to it (configuration, lifecycle,
  archive) are refused with 409.
- `422` for blockers, code clashes, a target site outside the target, or unconfirmed
  archives.
- `404` when the target is outside the account or the person isn't a member of it.

## Move (PR 031-1)

`GET device-moves/{move}` is readable by the mover, and by members holding
`Device.move` in `{organization}` when it is the move's source or target.

```json
{
  "uuid": "…",
  "status": "stopping",
  "source": { "uuid": "…", "name": "Integrator" },
  "target": { "uuid": "…", "name": "Harbour Shop" },
  "confirmed_at": "…",
  "cutover_at": null,
  "waiting_for": { "devices_stopping": 2 },
  "devices": [{
    "predecessor_uuid": "…",
    "successor_uuid": null,
    "name": "Shop tracker",
    "state": "stopping",
    "successor_state": null,
    "successor_reason": null
  }],
  "items": [{
    "kind": "dashboard", "name": "Fleet", "action": "copy",
    "target_uuid": "…", "arrives_running": null
  }],
  "needs_attention": [{
    "kind": "automation", "uuid": "…", "name": "Low temperature",
    "reason": "Turn it on in Harbour Shop"
  }],
  "failure_reason": null
}
```

What each side sees:

- A member of only one side sees the other organization's name and nothing else of
  it: `source.uuid` or `target.uuid` is null for the side they don't belong to.
  Successor uuids, states and reasons are shown only to members of the target, and
  predecessor uuids only to members of the source.
- `successor_state` is `pending`, `active`, `inactive` or `failed`, and
  `successor_reason` holds the runtime's reason, or the activation's refusal, for a
  failure. `needs_attention` lists, for members of the target, successors of active
  devices that arrived inactive or failed.
- `items` is empty until PR 031-4.

## Device reads (PR 031-1)

`GET devices/{device}` and list rows gain:

```json
"link": {
  "direction": "moved_from",
  "organization_name": "Integrator",
  "cutover_at": "…",
  "history": { "included": false, "stopped_at": null, "stopped_reason": null }
},
"pipe": {
  "kind": "adapter",
  "name": "Vendor trackers",
  "owner_organization_name": "Integrator",
  "online": true,
  "hosted": true
}
```

- `link` is null when the device has no link.
- `pipe` is null when the device has no source, or when it is direct.
- For a hosted device, `candidate.gateway` and the adapter reference are null. The
  candidate keeps its `metrics` and `birth_revision`. List rows carry `pipe` in place
  of the gateway column's adapter or gateway link.
- A hosted device's configuration snapshots keep `source.candidate_uuid` and
  `source.device_id` and its own installation, without the pipe owner's connection,
  edge node or adapter uuids; its installations' `adapter_revision_uuid` is null.
- `link.history` appears from PR 031-9.

## Pipe owner's views (PR 031-1; counts in 031-6)

- `GET discovery-candidates`, a candidate inside `GET devices/{device}`, and
  `GET device-adapters/{adapter}/candidates` (the Sources tab) gain
  `in_use_in: {"organization_name": "…"}` when the source's device is in another
  organization. `assigned_device_uuid`, the embedded device and `installation_uuid` are
  null then.
- Activating such a source through its adapter answers 409 "This source is in use in
  *organization*."

## Hosted gateway alerts (PR 031-5)

- A hosted organization's **Gateway offline** alert, and the `offline_alert` of its
  devices behind that gateway, carry `subject: {"type": "gateway", "uuid": null,
  "name": "…"}`: the pipe's gateway by name only. `OfflineAlertSubject.uuid` is
  nullable in OpenAPI and `AlertSubject.uuid` in `packages/api-client`; the portal shows
  the name without a link.
- A gateway's `offline_alert` in the owner's gateway reads is only its own
  organization's alert.
- The review's `ends.alerts` counts a gateway alert only when every device it lists is
  in the move; one that still lists a device staying behind the gateway stays open.

## Leaving the account (PR 031-1)

`PUT /v1/admin/organizations/{organization}/billing-account` answers 409 with
`hosted_devices: {organizations: [{name, devices: [names]}]}` while the organization has
hosted devices, its pipes serve another organization's devices, or a move involving it
is stopping. Organization deletion lists the same as the `hosted_devices` blocker.
- Adapter and gateway reads gain `hosted_devices: [{"organization_name": "…",
  "count": 2}]` (PR 031-6).

## Pipe guards (PR 031-6)

- Refused with 409 `pipe_serves_hosted_devices`, with `organizations: [{name, count}]`:
  - `DELETE device-adapters/{adapter}`;
  - archiving or deleting a gateway;
  - `PATCH discovery-candidates/{candidate}` (reject) and onboarding a source in use
    elsewhere.
- Answered with 409 `hosted_devices_affected` (same `organizations` list) until the
  body carries `confirm_hosted_devices: true`:
  - `POST device-adapters/{adapter}/deploy` (`deploy`, `pause`, `rollback`);
  - saving a decoder change;
  - rotating an adapter hardware credential;
  - `POST gateways/{gateway}/credentials/rotate`.

## Archive (PR 031-3)

| Route | Permission |
| --- | --- |
| `POST dashboards/{dashboard}/archive`, `POST dashboards/{dashboard}/restore` | the owner or `Dashboard.manage` |
| `POST workflows/{workflow}/archive` | `Workflow.manage` and `Workflow.activate` (it turns the workflow off) |
| `POST workflows/{workflow}/restore` | `Workflow.manage`; comes back off |

- `GET dashboards`, `GET workflows` and `GET workflows/dag` take `archived=only|include`.
  They hide archived items by default and return `meta.archived_count`.
- Items carry `archived_at` and `archived_by`: `{user_id, name}`, or null. Archive and
  restore return `{uuid, archived_at, archived_by}`; repeating either changes nothing.
- An archived dashboard has no `edit` or `share` ability; saves, version restores and
  access changes get 409. An archived automation's draft, layout and activation get
  409, and archiving one whose activation is pending gets 409.
- The organization context carries `capabilities.automation` (`view`, `manage`,
  `activate`), so clients hide what the API would refuse.

## Direct devices (PR 031-7)

- `POST gateways/{gateway}/credentials/rotate` needs `Device.manage-connections`.
  - It answers `200` with the gateway. The new settings are downloaded as today.
  - It records `gateway.credentials.rotated`.
- A gateway read carries `credentials_shared_with_previous_organization: true` until the
  first rotation after a move. A direct device's read carries it too.

## Onboarding into another organization (PR 031-8)

- `POST device-adapters/{adapter}/candidates/{candidate}/activate`,
  `POST device-onboardings` (gateway mode) and Discovery's single **Onboard** take an
  optional `organization_uuid`.
- Another organization needs `Device.move` in both, plus `Device.manage` and
  `Device.activate` in the chosen one. Otherwise the request gets 403, or 404 when the
  person isn't a member there.
- The response names the created device's organization.

## History (PR 031-9)

- `POST devices/{device}/link/history` with `{"enabled": false}`, on a predecessor,
  needs `Device.move` in its organization. It records `device_link.history_stopped`
  in both organizations and answers `200` with the device's `link`. Turning history
  back on isn't offered (`enabled: true` is 422); stopping again changes nothing; a
  device that isn't a predecessor is 404, and a link without history 409.
- History reads of a successor whose link includes history
  (`GET devices/{device}/measurements/history`, `records`, `state-history`,
  `increase`, which also serve exports and dashboard panels, and applications'
  `telemetry/history` and `telemetry/records`) return earlier readings with
  `"recorded_in": "source"`. Every other reading carries `"recorded_in": "self"`.
- `link.history` is `{included, stopped_at, stopped_reason}`, `stopped_reason` being
  `stopped` or `left_account`.
- With `include_history: true` the review's `summary` adds "*Target* can read the
  readings from before the move. They stay stored in *source*, for as long as
  *source* keeps readings."

## Assistant (PR 031-10)

- The device-side assistant (scope `onboarding`) gains a tool. Its proposal events carry a
  `device_move_proposal` card holding the review above and `content_hash`.
- `POST /api/v1/conversations/{conversation}/device-move-proposals/{proposal}/dismiss`
  dismisses a card.
- Confirming a card calls `POST device-moves` with `origin: "assistant"` and
  `proposal_uuid`, and changes the proposal to `applied`.
