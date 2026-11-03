# Contract: Platform API Changes

All routes are under `/api/v1/organizations/{organization}/`. The organization comes
from the route and membership is checked before permission (constitution III). Each
route lands in the OpenAPI export and in `packages/api-client` in the same PR
(constitution IV).

## Gateway kit

### `POST gateways/{gateway}/kit`

Permission `Device.manage-connections`. Throttle 10/min.

```json
{
  "health_artifact_uuid": "<published revision of a profile, usually gateway-health>",
  "device_types": [
    { "artifact_uuid": "<published revision>" }
  ]
}
```

- `device_types`: 0–8 entries, all distinct profiles.
- Every artifact must be a published revision of a profile in this organization (otherwise
  404).

**200** (`Cache-Control: no-store, private`, `Pragma: no-cache`):

```json
{
  "filename": "<edge>-gateway-kit.zip",
  "archive_base64": "…",
  "sdk_version": "0.1.0",
  "device_types": [ { "code": "water_meter", "profile_code": "water-meter", "revision": 3, "birth_bytes": 812, "warning": null } ]
}
```

| Response | When |
| --- | --- |
| **404** | The gateway or an artifact is in another organization |
| **422** | The gateway has no credentials (platform-managed); its connection is not `ready`; there is no public `ssl://` broker URL; or the CA is missing or invalid (the messages used today) |
| **403** | Permission missing |

Records `gateway.kit.downloaded`.

The portal calls this endpoint once, when the person clicks **Download kit**, and never
to preview a selection. Every call returns the credentials, records a download and
counts against the throttle. The birth-size warnings in `device_types` are shown with the
result. The portal then fetches the file from the archive URL below, as the direct-kit
dialog does.

### `GET gateways/{gateway}/kit/archive?health=<uuid>&types[]=<uuid>`

Same rules. Returns `application/zip` with `Content-Disposition: attachment`, for the
browser download (the pattern of `connection-kit/archive`).

## The gateway's own source

### `POST device-onboardings` (changed)

Gateway mode accepts `"source": "node"` instead of `source_device_id`. Exactly one of
the two is required in gateway mode. It is stored as `source_device_id = ''`. The
existing one-setup-per-(gateway, source) rule applies, so a gateway's own metrics can be
onboarded once. Direct mode is unchanged.

## Gateway health profile

### `POST device-profiles/gateway-health`

Permissions `DeviceProfile.create` and `DeviceProfile.publish`. The request has no body.
Idempotent: it creates and publishes the profile once per organization, and later calls
return it.

**200/201**: `{ "profile_uuid": "…", "artifact_uuid": "<latest published revision>", "created": true|false }`.

If a profile with code `gateway-health` exists but was edited, its latest published
revision is returned unchanged and `created: false`. The portal shows it as the
organization's own.

## Bulk onboarding

### `POST gateways/{gateway}/bulk-onboardings`

Permissions `Device.manage` and `Device.activate`. Throttle 5/min.

```json
{
  "operation_uuid": "<client-generated>",
  "artifact_uuid": "<published revision>",
  "name_pattern": "Meter {device_id}",
  "source_device_ids": ["p1-001", "p1-002"]
}
```

- `source_device_ids`: 1–500 distinct, non-empty IDs, each a discovered source of this
  gateway.
- `name_pattern` must contain `{device_id}`.
- Device codes are generated as `<gateway edge node id>-<device id>`, lowercased with
  invalid characters replaced; a clash with an existing code gets a numeric suffix.

| Response | When |
| --- | --- |
| **202** | The run was queued (the run body below); a repeated request returns the same run |
| **409** | `operation_uuid` was already used with a different request |
| **422** | Unknown IDs (per index, `source_device_ids.3`), an unknown revision, a pattern without `{device_id}` or with another placeholder, or a gateway whose connection is not provisioned or that belongs to a device adapter |

Records `device.bulk_onboarding.started`.

### `GET bulk-onboardings/{run}`

Permission `Device.view`.

```json
{
  "data": {
    "uuid": "…", "status": "running", "gateway_uuid": "…", "artifact_uuid": "…",
    "profile": { "uuid": "…", "name": "Water meter", "revision": 3 },
    "name_pattern": "Meter {device_id}", "created_by": 12,
    "created_at": "…", "started_at": "…", "finished_at": null,
    "counts": { "pending": 10, "activation_requested": 230, "active": 200, "skipped": 7, "failed": 0 },
    "items": [ { "source_device_id": "p1-017", "status": "skipped", "reason": "missing metric flow_rate", "device_uuid": null, "attempts": 0 } ],
    "next_cursor": "…"
  }
}
```

Items are paged with `?cursor=` (100 per page; pass `next_cursor`). `active` is derived
from the device's applied configuration, not stored, and is the part of
`activation_requested` the runtime has acknowledged. An item whose activation the
runtime refused keeps `activation_requested` and shows the runtime's reason. The store
and retry responses carry the same body.

### `POST bulk-onboardings/{run}/retry`

Same permissions as create, throttle 5/min. Re-queues the `failed` items only,
incrementing their `attempts`; 409 while the run is still working or when it has no
failed items. `skipped` items need a new run, because their sources do not match the
profile. Records `device.bulk_onboarding.retried`.
