# Data Model: Activity Log

## `activity_log` (replaces `device_audit_events`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | Keyset cursor; copy keeps the old order |
| `log_name` | string, nullable, indexed | `audit` |
| `description` | text | The action code |
| `subject_type`, `subject_id` | nullable morph | Set when the recorder is given a model |
| `subject_uuid` | uuid, nullable | The resource's public UUID (was `resource_uuid`) |
| `subject_name` | string, nullable | Name snapshot at the time of the event |
| `event` | string | The action code, for example `device.updated` (was `action`) |
| `causer_type`, `causer_id` | nullable morph | The acting `User` by integer id (was `actor_id`); no foreign key, so deleting a user keeps the id |
| `organization_id` | bigint, nullable | Organization whose data changed; restrict on delete (organization deletion removes its events first) |
| `attribute_changes` | jsonb, nullable | `{"attributes": {...new}, "old": {...old}}` for edits |
| `properties` | jsonb, nullable | Details (was `details`) |
| `created_at`, `updated_at` | timestamptz | Event time |

Indexes: `(organization_id, id)`, `(causer_id, id)`, `(subject_uuid, created_at)`,
`(event, id)`, plus the package's `log_name` and morph indexes.

Dropped: `device_audit_events.uuid` (never read).

## Action codes

Existing codes are kept. New codes are listed in [plan.md](plan.md#new-recording-points).
Codes are `area.thing.verb` in snake case; the catalogue maps each to a sentence and a
subject kind.
