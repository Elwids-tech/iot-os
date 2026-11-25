# Data Model: Entity Hierarchy

PostgreSQL 17. Every table is organization-scoped and cascades on organization delete
(spec 006). User references are integer `user_id`s (ADR-013), set null when the user is
deleted. No table in this document has a column for a protocol, a node address or a
key into another feature's records (FR-025); a test asserts it (SC-007).

Limits are in [research R20](research.md#r20-limits).

## `entity_types` (new, PR 1)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | `uuid` unique |
| `organization_id` | fk | cascade |
| `key` | string(40) | lower-case `a-z0-9_`, unique per organization, immutable; `site` is reserved for the Site type |
| `name` | string(80) | unique per organization ignoring case |
| `top_level` | bool | may sit at the top of the tree |
| `parent_type_keys` | json | list of type keys it may sit under |
| `member_type_keys` | json | list of type keys it may hold as members (FR-023) |
| `accepts_devices` | bool | placements and parameter placements allowed |
| `carries_timezone`, `carries_location` | bool | whether entities of the type may set them |
| `naming_template`, `naming_example`, `naming_description` | string(120), string(64), string(240), null | [R10](research.md#r10-naming-rules-are-templates-not-user-regular-expressions); the example must match |
| `preset_keys` | json | presets that contributed to the type, for display |
| `created_by`, `updated_by` | user_id, null | |
| timestamps | | |

Rules:
- The Site type (`key = site`) always exists (R4); its `top_level`, `accepts_devices`,
  `carries_timezone` and `carries_location` are true and cannot change.
- Keys referenced in `parent_type_keys` and `member_type_keys` must exist; a type
  cannot be deleted while any entity uses it or any type references it.
- A rule change never changes an entity (FR-008). "Outside current rules" is computed
  on read: an entity whose parent type is no longer allowed, whose path name no longer
  matches the template, or that holds placements while its type no longer accepts
  devices.

## `entities` (new, PR 1)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | `uuid` unique, never changes; migrated sites keep theirs |
| `organization_id` | fk | cascade |
| `entity_type_id` | fk → `entity_types` | restrict |
| `parent_id` | fk → `entities`, null | restrict; same organization (checked) |
| `name` | string(120) | display name, any script |
| `path_name` | string(64) | `[A-Za-z0-9._-]+` |
| `depth` | smallint | 0 at the top, ≤ 11 |
| `path` | text | path names from the top joined by `/`, rewritten for the branch on rename and move |
| `description` | text, null | ≤ 2,000 |
| `timezone` | string(64), null | IANA; only when the type carries one; required for Site entities |
| `address` | text, null; `latitude`, `longitude` decimal(9,6), null | only when the type carries a location; both coordinates or neither |
| `custom_attributes` | json | ≤ 30 `{key: value}` (served as `attributes`; the column name avoids Eloquent's own `attributes`) |
| `archived_at` | timestamp, null | with `archived_by` |
| `created_by`, `updated_by` | user_id, null | |
| timestamps | | |

Indexes: partial unique `(organization_id, coalesce(parent_id, 0), lower(path_name))
where archived_at is null`; `(organization_id, parent_id, lower(name))` for paging
children; GIN trigram on `lower(name)` and `lower(path)` (R16).

States: **active** → **archived** (no children and no current placements, parameter
placements or memberships ending at that time) → **active** again by restore (needs a
free path name). An entity that never had children, placements or parameter placements
can be deleted (its change rows go with it).

## `entity_closure` (new, PR 1)

| Field | Type | Notes |
| --- | --- | --- |
| `ancestor_id` | fk → `entities` | cascade |
| `descendant_id` | fk → `entities` | cascade |
| `depth` | smallint | 0 for the entity itself |

Primary key `(ancestor_id, descendant_id)`; index `(descendant_id, depth)`. Maintained
only by `EntityTree` (R2). Archived entities keep their rows (they have no
descendants).

## `entity_changes` (new, PR 1)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `organization_id`, `entity_id` | fk | cascade |
| `kind` | string | `created`, `moved`, `renamed`, `retyped`, `archived`, `restored` |
| `old_parent_id`, `new_parent_id` | fk → `entities`, null | for `created` and `moved` |
| `old_path_name`, `new_path_name` | string(64), null | for `created` and `renamed` |
| `old_type_id`, `new_type_id` | fk → `entity_types`, null | for `created` and `retyped` |
| `user_id` | user_id, null | |
| `changed_at` | timestamp | |

Index `(entity_id, changed_at)`. Display-name edits are not path history; they go to
the activity log only.

## `entity_placements` (new, PR 2)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | |
| `organization_id` | fk | cascade |
| `device_id` | fk → `devices` | cascade |
| `entity_id` | fk → `entities` | restrict |
| `leaf_names` | json | `{parameter_uuid: leaf}` overrides for this placement (FR-011) |
| `started_at` | timestamp, null | null: "since before placement history was kept" (migration only) |
| `ended_at` | timestamp, null | |
| `end_reason` | string, null | `moved`, `unplaced`, `device_archived`, `moved_out`, `entity_archived` |
| `started_by`, `ended_by` | user_id, null | |

Partial unique `(device_id) where ended_at is null`; index `(entity_id) where ended_at
is null`. The entity's type must accept devices and belong to the device's organization
when the placement starts.

## `parameter_placements` (new, PR 4)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | |
| `organization_id` | fk | cascade |
| `device_id` | fk → `devices` | cascade |
| `parameter_uuid` | uuid | `profile_parameters.uuid`; no foreign key, so history survives profile edits |
| `parameter_key` | string | the key when placed, for history display |
| `entity_id` | fk → `entities` | restrict |
| `leaf_name` | string(64) | defaults to the key |
| `started_at`, `ended_at`, `end_reason`, `started_by`, `ended_by` | | as placements |

Partial unique `(device_id, parameter_uuid) where ended_at is null`; index `(entity_id)
where ended_at is null`. A parameter placement whose parameter is missing from the
device's current profile revision is reported **Not in the current configuration**
(computed on read).

## `entity_memberships` (new, PR 5)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigint | |
| `organization_id` | fk | cascade |
| `member_id`, `group_id` | fk → `entities` | restrict |
| `group_type_id` | fk → `entity_types` | the group's type when the membership started |
| `started_at`, `ended_at`, `started_by`, `ended_by` | | |

Partial unique `(member_id, group_type_id) where ended_at is null` (one division at a
time). The group's type must list the member's type in `member_type_keys`; the two may
not be the same entity or related in the tree.

## Changed tables

### `devices` (PR 2)

| Field | Change |
| --- | --- |
| `site_id` | foreign key moves from `sites` to `entities` (set null); now derived: the nearest Site-type entity at or above `entity_id` (R5) |
| `entity_id` | new, fk → `entities`, null, set null; the anchor: current placement, or last placement when archived (R5) |

Index `(organization_id, entity_id)`. Only `DeviceAnchors` writes either column.

### `device_move_devices` (PR 2)

`target_site_id` is renamed `target_entity_id` with its foreign key moved to `entities`
(R7). The move preview accepts `site_uuid` or `entity_uuid`.

### `integration_applications` (PR 8)

`site_uuids` is renamed `entity_uuids` (json, 1–50 entity UUIDs of the organization,
any type). The application API reads and writes `site_uuids` as an alias restricted to
Site-type entities (R19).

### `sites` (PR 2, dropped in PR 8)

Renamed `legacy_sites` and no longer written (R4). `Site` the model is removed; site
views are built from Site-type entities by `SiteView`.

## Derived values (not stored)

| Value | Rule |
| --- | --- |
| Reporting time zone | nearest ancestor-or-self of `devices.entity_id` with a `timezone`, else the organization's, else UTC (R6) |
| A device's site | `devices.site_id` |
| Points at an entity | [R9](research.md#r9-points-are-computed-not-stored) |
| Coverage | the entity's branch plus, one step, the branches of its current members |
| Outside current rules | see `entity_types` rules |

## Activity log actions (spec 024)

New entries in `ActivityCatalogue`, subject kind `entity` unless noted:

| Action | When |
| --- | --- |
| `entity.created`, `entity.updated`, `entity.moved`, `entity.retyped`, `entity.archived`, `entity.restored`, `entity.deleted` | tree changes |
| `entity_type.created`, `entity_type.updated`, `entity_type.deleted` (kind `entity type`), `entity_type.preset_applied` | types and presets |
| `device.placed`, `device.unplaced` (kind `device`) | placements, with the entity's path |
| `parameter.placed`, `parameter.unplaced` (kind `device`) | parameter placements |
| `entity.membership_started`, `entity.membership_ended` | memberships |

`site.created`, `site.updated` and `site.deleted` stay for changes made through the
site compatibility routes. A batch apply writes one entry per change with
`context.batch` set to the batch's UUID.
