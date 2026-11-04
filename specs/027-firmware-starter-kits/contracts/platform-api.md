# Contract: Platform API

All routes are under `/api/v1/organizations/{organization}/`, behind the usual session or
token authentication and organization resolution (constitution III). They are registered
from a new `app/Domain/Firmware/routes/api.php`, which `routes/api.php` requires like
the other domains. Each lands in the OpenAPI export and in `packages/api-client` in the
same pull request (constitution IV).

Responses that carry an archive use the existing kit shape, in `data` like the
connection kit:

```json
{
  "data": {
    "filename": "wm-200-esp32-esp-idf-starter.zip",
    "manifest": { "...": "iotos-starter.json, as in the data model" },
    "archive_base64": "UEsDB…"
  }
}
```

All archive responses send `Cache-Control: no-store, private` and `Pragma: no-cache`.

## `GET firmware/targets`

**Permission**: `DeviceProfile.view-any`.

**200**:

```json
{
  "data": [
    {"id": "esp32-esp-idf", "name": "ESP32 (ESP-IDF)", "kind": "built", "roles": ["direct", "gateway"], "toolchain": "ESP-IDF v5.4.1"},
    {"id": "stm32", "name": "STM32", "kind": "ai_assisted", "roles": ["direct", "gateway"], "toolchain": null}
  ]
}
```

Only available targets are listed (data model). The order is built targets first, then
AI-assisted, by `order`.

## `POST firmware/starters`

**Throttle**: 10 per minute.

**Request**:

```json
{
  "target": "esp32-esp-idf",
  "role": "gateway",
  "node_artifact_uuid": "… or null for the SDK default health table (gateway only)",
  "device_type_artifact_uuids": ["…", "…"],
  "gateway_uuid": "optional: saves the selection on this gateway (needs Device.manage-connections)"
}
```

**Permission**: `DeviceProfile.view` on every referenced profile. With `gateway_uuid`,
also `Device.manage-connections` on that gateway.

**Responses**:
- **200**: archive response.
- **404**: an artifact or gateway that is not in this organization, or not published.
- **422**, with a field-level message:
  - unknown or unavailable target;
  - a role the target does not support;
  - `device_type_artifact_uuids` with `role: direct`;
  - zero or more than 8 device types for a gateway;
  - duplicate profiles;
  - a type over 64 metrics, naming `IOTOS_MAX_METRICS_PER_TYPE`;
  - more than 8 types, naming `IOTOS_MAX_DEVICE_TYPES`.

**Side effect**: with `gateway_uuid`, writes `firmware_selection` on that gateway.

## `POST devices/{device}/connection-settings`

**Permission**: `Device.manage-connections`.

**Throttle**: 10 per minute.

**Body**: none.

**Responses**:
- **200**: archive response, with `manifest: null`.
- **404**: another organization's device.
- **422**:
  - not a direct device;
  - not provisioned (the portal provisions first, as `ConnectionKit.tsx` does);
  - archived.
- **503**: public MQTT endpoint or CA not configured (the messages from
  `DeviceConnectionKit`).

**Activity**: `device.connection-settings.downloaded`.

## `POST gateways/{gateway}/connection-settings`

The same as above for a gateway. The endpoint applies the gateway's broker access
(idempotent, as `gateways/{gateway}/provision`) first.

**422**:
- a gateway without platform-issued credentials;
- a connection that is not ready.

**Activity**: `gateway.connection-settings.downloaded`.

## `POST devices/{device}/firmware-kit`

**Permission**: `Device.manage-connections`.

**Throttle**: 10 per minute.

**Body**: `{"target": "esp32-esp-idf"}`.

**Behaviour**: the node type is the device's published profile revision: its applied
configuration's artifact, otherwise its onboarding artifact.

**Responses**:
- **200**: archive response.
- **422**: the union of the starter and settings errors.

**Activity**: `device.firmware-kit.downloaded`.

## `POST gateways/{gateway}/firmware-kit`

**Permission**: `Device.manage-connections`.

**Throttle**: 10 per minute.

**Body**: the same as `firmware/starters`, without `role` (always `gateway`) and without
`gateway_uuid` (implied). Missing fields default to the gateway's saved selection.

**Side effect**: writes `firmware_selection`.

**Activity**: `gateway.firmware-kit.downloaded`.

## `GET gateways`

Each item in the existing list (which the gateway page reads) gains
`firmware_selection`: `{target, node_profile_uuid, device_profile_uuids[]}` or `null`,
with profiles the person may not view removed. The portal derives the first-choice
suggestion from the devices it already loads for the gateway page (their profiles), so
the API adds no suggestion field.

## Assistant: `OnboardingTools` action `offer_firmware`

**Arguments**: `{profile_uuid, target, role}`.

**Checks**:
- the conversation's organization;
- `DeviceProfile.view` for the run's user;
- a published revision exists;
- the target is available for the role.

**On success**: writes `onboarding_state.firmware_offer` and emits the `firmware_offer`
event. The tool returns `{shown: true, profile: {name, revision}, target: {name, kind}}`.

**Never**: settings, credentials or archive contents.

**Scopes**: `ProfileAssistantTools` gains the same action for the `profile` scope.

**Portal**: renders an `ActionCard` whose button calls `POST firmware/starters` with the
person's session.

## Unchanged

- `POST devices/{device}/connection-kit` and its `archive` GET keep their behaviour and
  files (FR-033).
- `POST gateways/{gateway}/provision` is unchanged.
- The server command `devices:export-gateway` keeps working (FR-034).
