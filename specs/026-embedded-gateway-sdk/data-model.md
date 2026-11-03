# Data Model: Embedded Gateway SDK

## Platform (PostgreSQL)

### `device_bulk_onboardings` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `uuid` | uuid, unique | Public id; equals the request's `operation_uuid` |
| `organization_id` | bigint FK | From the route organization, never the payload |
| `sparkplug_gateway_id` | bigint FK | Every selected source belongs to this gateway |
| `device_profile_artifact_id` | bigint FK | The published profile revision applied to every item |
| `name_pattern` | string(120) | Must contain `{device_id}`; also allows `{gateway}` and `{n}` |
| `request_hash` | char(64) | SHA-256 of the normalised request; a reused `operation_uuid` with a different hash is 409 |
| `status` | string | `queued` → `running` → `succeeded` \| `partial_failure` \| `failed` |
| `created_by` | bigint | Integer `user_id` (ADR-013) |
| `started_at`, `finished_at` | timestamptz, nullable | |
| `created_at`, `updated_at` | timestamptz | |

Index: `(organization_id, created_at)`.

### `device_bulk_onboarding_items` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `device_bulk_onboarding_id` | bigint FK, cascade | |
| `source_device_id` | string(128) | The Sparkplug device ID; `''` is not allowed here (node sources use single onboarding) |
| `discovery_candidate_id` | bigint FK, nullable | Resolved when the item runs |
| `device_id` | bigint FK, nullable | Set once the device is created |
| `status` | string | `pending` → `activation_requested` → (`active` read from the device) \| `skipped` \| `failed` |
| `reason` | string(500), nullable | Why it was skipped or failed, for example `missing metric flow_rate`, `datatype String for number parameter level`, `already onboarded` |
| `attempts` | smallint | Retries through the retry endpoint |
| `created_at`, `updated_at` | timestamptz | |

Unique: `(device_bulk_onboarding_id, source_device_id)`. A source never gets two
devices: the existing onboarding uniqueness (gateway, source) and the candidate
reservation are checked inside each item's transaction.

**Run status roll-up**: `succeeded` when every item is `activation_requested` or later;
`partial_failure` when at least one item is `skipped` or `failed` and at least one
succeeded; `failed` when none succeeded. Item `active` is not stored. The API reads it
from the device's applied configuration, so it never claims activation the runtime has
not acknowledged.

### Existing tables

- `device_onboardings`: unchanged schema. In gateway mode, `source_device_id = ''`
  now also means "the gateway's own metrics" (R16).
- `device_profiles`: one row per organization with `code = 'gateway-health'`, created
  on request (R17).
- `activity_log`: new action codes:

| Code | Subject | Properties (no secrets) |
| --- | --- | --- |
| `gateway.kit.downloaded` | gateway | `sdk_version`, `health_profile_revision`, `device_types` (profile code + revision) |
| `device.bulk_onboarding.started` | gateway | `run_uuid`, `profile_revision`, `count` |
| `device.bulk_onboarding.finished` | gateway | `run_uuid`, `status`, counts per item status |
| `device.onboarding.started` | device | existing; gains `bulk_run_uuid` when created by a run |
| `device_profile.gateway_health.created` | device profile | `revision` |

## Gateway health profile

Code `gateway-health`, name "Gateway health", category `gateways`. Every parameter
`reports_state = true`, `accepts_command = false`:

| Key | Label | Data type | Unit | Kind | Notes |
| --- | --- | --- | --- | --- | --- |
| `uptime` | Uptime | integer | s | counter (monotonic, resets on reboot) | Seconds since `iotos_start`, which for most firmware is boot |
| `connection_type` | Connection | enum | — | state | `ethernet`, `wifi`, `cellular`, `other` |
| `signal_strength` | Signal strength | number | dBm | measurement | Sent as a Sparkplug null when the network does not report it (Ethernet), which the platform shows as unknown (constitution VI) |
| `firmware_version` | Firmware version | string | — | state | Integrator-supplied |
| `sdk_version` | SDK version | string | — | state | From the SDK |
| `devices_configured` | Devices configured | integer | — | measurement | Devices added |
| `devices_online` | Devices online | integer | — | measurement | Devices not marked offline |
| `reconnects` | Reconnects | integer | — | counter | Since `iotos_start` |

Configuration the profile validator requires or the metrics need:
- `uptime` and `reconnects` set `counter_config` to `{"monotonic": true,
  "reset_behavior": "new_segment"}`. A reboot then starts a new segment instead of
  raising a diagnostic every time.
- `connection_type` lists its four values in `validation_logic`
  (`{"rule": {"in": [{"var": "value"}, ["ethernet", "wifi", "cellular", "other"]]}}`),
  which every enum parameter needs.
- Every parameter sets `reporting_config.stale_after_seconds` to 180: three times the
  default health interval.

The NBIRTH also carries `bdSeq` and `Node Control/Rebirth`, which the onboarding does
not map.

## Kit contents

See [contracts/kit-layout.md](contracts/kit-layout.md). Kits are not stored. Each
download is recorded in the activity log.

## SDK (in memory, C)

### `iotos_gateway` (one per gateway, caller-allocated)

| Field | Notes |
| --- | --- |
| settings | Pointer to the kit's `const iotos_settings` (broker, identities, credentials, CA) |
| ports | Network (stream or MQTT level), clock, storage, log, lock |
| session | `bd_seq` (0–255), `seq` (0–255), host online flag, connection state, reconnect count, back-off timer |
| node | Health metric values, integrator node metrics, birth state |
| types | Up to `IOTOS_MAX_DEVICE_TYPES` pointers to `const iotos_device_type` |
| devices | Array of `IOTOS_MAX_DEVICES` device slots |
| birth queue | Ring of slot indexes waiting for DBIRTH, plus the NBIRTH flag |
| buffers | `IOTOS_TX_BUFFER` and `IOTOS_RX_BUFFER` bytes; the RX buffer is also coreMQTT's fixed buffer |
| mqtt | coreMQTT's context, used at the stream level |

The library has no other writable static data and never uses the heap.

### Device slot

| Field | Size at defaults | Notes |
| --- | --- | --- |
| `id` | 24 bytes | Validated against `[A-Za-z0-9_.:-]`, unique per gateway |
| `type` | 1 byte | Index into `types` |
| `state` | 1 byte | `free`, `offline`, `birth_pending`, `born` |
| padding | 2 bytes | |

About 28 bytes per device: 512 slots take about 14 KB.

### `iotos_device_type` (generated, `const`, in flash)

| Field | Notes |
| --- | --- |
| `code`, `profile_revision` | From the published profile the kit used |
| `metrics[]` | `{name, datatype, unit, writable}` in profile order; the index is the alias low half (R9) |

### Datatypes

The SDK writes Boolean, Int8–64, UInt8–64, Float, Double, String, DateTime and Bytes.
Values are checked before encoding: finite numbers, 64-bit integers within ±2^53, UInt8/16
in range, strings at most 64 KiB. A failed check is an error returned to the caller,
never a silent default.

### Session states

```text
disconnected ──connect ok──▶ waiting_for_host ──STATE online──▶ birthing ──queue empty──▶ online
     ▲                              │                               │                       │
     └──────── connection lost / auth failure (back-off) ◀──────────┴───────────────────────┘
online ──NCMD Rebirth or STATE online again──▶ birthing (new NBIRTH, seq 0, all devices queued)
```

A device slot moves `free → birth_pending` on `iotos_device_add`, `birth_pending →
born` when its DBIRTH is sent, `born → offline` on `iotos_device_offline` (DDEATH), and
`offline → birth_pending` on the next publish for it. Every NBIRTH moves every
non-free, non-offline slot back to `birth_pending`.
