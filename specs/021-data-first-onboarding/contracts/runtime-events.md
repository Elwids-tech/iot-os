# Tenant Runtime Events (changed)

These are sent to `POST /api/internal/adapters/events` with the tenant runtime token,
using the schema in `contracts/adapters/v1/runtime-event.v1.schema.json`. The existing
kinds keep their shape. The changes are additive within `v1`, and the schema's
fixture and cases gain the new kind.

## `capture` (new)

| Field | Rule |
| --- | --- |
| `report_id` | A unique string of at most 80 characters; Laravel inserts each one once |
| `adapter_uuid` | Required |
| `revision_uuid` | Null for a capture tab; the applied revision for a deployed source copying input in Manage |
| `source` | `mqtt` |
| `received_at` | An ISO time |
| `topic` | At most 512 characters |
| `qos` | 0, 1 or 2 |
| `retained` | Boolean |
| `size` | The bytes received |
| `payload_base64` | At most 64 KiB of the payload |
| `truncated` | True when the payload was longer than 64 KiB |
| `off_filter` | True when the topic is outside the source's filters |

**What Laravel does with it**:

- It stores the event as a `device_adapter_deliveries` row: kind `sample`, source
  `mqtt`, `path` set to the topic, and `input` in fixture shape.
- It does this only while the adapter's `capture_until` is in the future. Otherwise
  the event is dropped, logged once per adapter per hour.
- A capture event with a `revision_uuid` that is neither applied nor desired is
  dropped, as for the other kinds.
- A capture never creates candidates or telemetry.

**Throttle**: at most one per second and 20 every 10 seconds per adapter. The reporter
drops what it cannot send and counts it in the next `outcomes` report as
`capture_dropped`.

## `outcomes` (changed)

`counts` gains `ignored` (results that skip a message on purpose, see the
[field mapping](field-mapping.md#decoder-output-changed)), `off_filter` and
`capture_dropped`.

## `health` (changed)

For capture tabs, `source_state` uses the existing values plus `capturing`. The
vendor capture connection reports `credentials_rejected`, `not_connected` and
`subscribe_refused` with the broker's reason code.
