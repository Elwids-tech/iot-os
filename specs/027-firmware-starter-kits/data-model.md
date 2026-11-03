# Data Model: Firmware Starter Kits

Starters, settings and kits are generated on request and never stored. The only new
stored data is a gateway's saved firmware selection, plus one field in an assistant
conversation's state. Everything else is files in the repository or in the developer's
project.

## Target (file: `firmware/starters/targets.json`)

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | `[a-z0-9-]{2,40}`, unique, stable (used in URLs and manifests) |
| `name` | string | Shown in the picker |
| `kind` | `built` \| `ai_assisted` | |
| `roles` | array of `direct`, `gateway` | At least one |
| `example` | string | Built only: path under `firmware/sdk/examples/` |
| `developer_paths` | string[] | Built: for example `["main/"]`; AI-assisted: `["app/"]` |
| `toolchain` | string | Built only: the exact version CI uses, such as `ESP-IDF v5.4.1` |
| `family_notes` | string \| null | AI-assisted only: path under `firmware/starters/families/` |
| `order` | integer | Picker order within its group |

**Available**: an entry is listed by the API only if its `example` (built) or its
`family_notes` (named AI-assisted) exists in the image's firmware copy (R2). The `other`
entry is always available.

The registry ships in the first wave with `linux`, `esp32-esp-idf`, `stm32`, `rpi-pico`,
`nordic-nrf` and `other`. `nxp-imxrt1050-mcuxpresso` is added by spec 026 PR 4.

## Firmware starter (generated archive)

**Input**: `target`, `role`, `node_artifact` (a published artifact UUID; for a gateway,
optional when the SDK's default health table is used) and `device_types[]` (gateway only;
published artifact UUIDs).

**Validation**:
- The target exists, is available and supports `role`.
- Every artifact is a published revision of a profile in the request's organization, and
  the person has `DeviceProfile.view`. Anything else gives a 404, not a 403, as other
  tenant lookups do.
- `role: direct` takes no `device_types`. `role: gateway` takes 1 to 8 distinct
  profiles (`IOTOS_MAX_DEVICE_TYPES`), refused above that with the limit and the macro
  that raises it.
- Each type has at most 64 reported, non-derived parameters (`IOTOS_MAX_METRICS_PER_TYPE`).
  Above that it is refused with the macro.
- A type whose DBIRTH at the default ID length would exceed 4 KiB gives a manifest
  warning (026 kit layout).

**Contents**: [starter layout](contracts/starter-layout.md).

**Metric selection**: parameters that report state and are not derived, typed per
026-R20. `writable` comes from `accepts_command`. Identifiers follow 026-R20 (profile
code to `[a-z0-9_]`, numeric suffix on a clash).

## Starter manifest (`iotos-starter.json`)

Schema `contracts/firmware/starter-manifest.v1.schema.json`.

| Field | Type | Notes |
| --- | --- | --- |
| `format` | `1` | |
| `sdk_version` | string | `firmware/sdk/VERSION` |
| `target` | `{id, kind, name}` | |
| `role` | `direct` \| `gateway` | |
| `generated_at` | RFC 3339 UTC | The only field allowed to differ between equal starters |
| `node` | `{code, name, revision, artifact_uuid}` \| `{default_health: true}` | |
| `device_types[]` | `{code, c_identifier, name, revision, artifact_uuid}` | Gateway only |
| `metrics{code}[]` | `{key, datatype, unit, writable, introduced_in, changed_in}` | `changed_in` is the last revision that changed datatype or unit |
| `retired{code}[]` | `{key, retired_in}` | Keys removed since the first published revision |
| `replaceable[]` | string[] | `sdk/`, `generated/`, `.iotos/`, `AGENTS.md`, `CLAUDE.md` |
| `developer_paths[]` | string[] | From the target |
| `warnings[]` | `{code, message, subject}` | For example `birth_over_tx_buffer` |

No credentials, broker address, namespace or device identity (FR-004, FR-050).

## Connection settings (generated archive)

For one provisioned direct device or gateway.

| File | Contents |
| --- | --- |
| `config/iotos_settings.h` | Broker host and port (from `devices.broker_public_url`), group, edge node, host ID, client ID and username, password, CA PEM, `IOTOS_KIT_GATEWAY` |
| `config/iotos_settings.c` | `const iotos_settings iotos_kit_settings` with `node_type` NULL, and `iotos_kit_settings_present = 1`; `main.c` copies it and sets `node_type` |
| `config/README.md` | What the files are; that they are useful only inside a starter or full kit's `config/` folder; keep them out of version control; how to replace leaked credentials by re-registering |
| `device-config.json`, `ca.crt`, `quickstart.md` | Direct device only, byte-for-byte as today's kit (FR-033) |

**Rules**:
- `Device.manage-connections` is required.
- The device or gateway must be provisioned, its connection ready, and not archived.
- The response is private and not cacheable, and is recorded in the activity log.

## Full kit (generated archive)

A starter for the device's or gateway's profiles and a chosen target, with the settings
files placed in its `config/`. For a direct device:
- the node type is the device's published profile revision (its onboarding or applied
  artifact);
- the existing three files sit at the kit root.

For a gateway, the node type and device types come from the request (as for a starter),
and default to the gateway's saved selection.

## Gateway firmware selection (new column)

`sparkplug_gateways.firmware_selection`, `jsonb`, nullable.

```json
{"format": 1, "target": "esp32-esp-idf", "node_profile_uuid": "…", "device_profile_uuids": ["…", "…"], "saved_by_user_id": 42, "saved_at": "2026-11-20T10:00:00Z"}
```

- **Written** when a starter or full kit is downloaded from the gateway's Firmware
  dialog.
- **Stores profile UUIDs, not artifacts**, so the next download offers each profile's
  current published revision.
- **On read**, profiles that were deleted or that the person may not view are dropped.
- `saved_by_user_id` is the integer user id (ADR-013).

**Preselection in the dialog** (FR-042):
1. **Saved**: the saved selection, for the node, the device types and the target.
2. **Nothing saved**: device types are suggested from the profiles of devices already
   onboarded under the gateway (their current applied configuration's profile, from the
   device list the gateway page already loads). The node is the organization's published
   `gateway-health` profile, otherwise the SDK default health table.

## Assistant conversation state

`onboarding_state.firmware_offer`: `{profile_uuid, target, role, at}`, written by the
`offer_firmware` tool action and read by the portal to render the card. It holds no
artifact contents or settings.

## Device brief (developer's project, never stored by the platform)

`<developer path>/device-brief.yaml`, validated against
`contracts/firmware/device-brief.v1.schema.json` ([device brief contract](contracts/device-brief.md)).

```text
format: 1
device:             {board, mcu, framework, framework_version, memory_notes}
uplink:             {kind: ethernet|wifi|cellular_modem|other, modem_runs_mqtt: bool|unknown, notes}
time_source:        sntp|modem|gps|rtc|unknown
credential_storage: compiled|flash|secure_element|unknown
device_types:       {<profile code>: DeviceType}
power:              {mode, notes}
watchdog:           {enabled, timeout_s}
instructions:       free text
unconfirmed:        [paths of answers not yet proved by a reading]

DeviceType:
  addressing:       {bus, port, addresses, device_id_pattern}
  poll_interval_s:  number
  report:           {mode: on_change|interval, deadband?, interval_s?}
  offline_after:    {missed_polls}
  metrics:          {<metric key>: Metric}
  commands:         {<metric key>: {effect, read_back}}
  instructions:     free text

Metric.source: modbus {function, register, type, byte_order, word_order, scale, offset}
             | analog {pin, calibration} | digital {pin, active_low}
             | i2c {part, address} | spi {part} | can {id, signal} | pulse {pin, per_unit}
             | computed {from, how} | unknown {}
```

**Validation**:
- Every key in `metrics` and `commands` must be a metric in the manifest for that type.
- `commands` keys must be writable metrics.
- `unknown` is allowed for any leaf fact.

## Activity log entries

| Code | Subject | Properties (no secrets) |
| --- | --- | --- |
| `device.connection-settings.downloaded` | device | — |
| `gateway.connection-settings.downloaded` | gateway | — |
| `device.firmware-kit.downloaded` | device | `target`, `sdk_version`, profile codes and revisions |
| `gateway.firmware-kit.downloaded` | gateway | `target`, `sdk_version`, profile codes and revisions |

These replace spec 026's planned `gateway.kit.downloaded`. Today's
`device.connection-kit.downloaded` is unchanged. Each new code gets an
`ActivityCatalogue` entry.

## State and lifecycle

Nothing here has a lifecycle on the platform. Starters follow profile revisions:
- A newer published revision changes what the next starter contains, and the manifest's
  `introduced_in`, `changed_in` and `retired` record it.
- Devices keep their applied configuration until a birth no longer matches, which then
  needs review as today (constitution II).
