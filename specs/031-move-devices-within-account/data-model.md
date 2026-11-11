# Data Model: Move Devices Within a Billing Account

Storage for [spec 031](spec.md). Decisions are in [research.md](research.md). User
references are integer `user_id` (ADR-013). "PR" names the pull request that adds each
piece (plan § Delivery).

## Device move (new table `device_moves`, PR 031-1)

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid unique | |
| `operation_uuid` | uuid unique | Client idempotency key (R10) |
| `request_hash` | char(64) | Same `operation_uuid` with another hash → 409 |
| `source_organization_id`, `target_organization_id` | FK organizations, cascade | Differ; same billing account at confirmation and at cutover. Cascade satisfies the deletion inventory for a table without `organization_id`; an organization that took part in a move keeps a device, which blocks its deletion |
| `billing_account_id` | FK billing_accounts | The account both belonged to at confirmation |
| `mover_id` | FK users | Who confirmed |
| `origin` | enum `devices`, `device`, `assistant` | Started from the device list, a device page, or an assistant card |
| `device_move_proposal_id` | FK nullable | Set when `origin = assistant` (PR 031-10) |
| `include_history` | bool, default false | FR-050 (honoured from PR 031-9; refused as true before) |
| `status` | enum `stopping`, `completed`, `failed` | See state machine |
| `failure_reason` | string nullable | Plain sentence for **Done** |
| `review` | jsonb | The confirmed review (devices, items, endings, profile copies), kept for **Done** and the activity log |
| `confirmed_at`, `cutover_at`, `finished_at` | timestamptz | `cutover_at` set in the cutover transaction |

**State machine**: `stopping` → `completed` (cutover committed) | `failed` (a refused
deactivation, a failed re-check, or a cutover error; devices it stopped are resumed).
A move with no active device goes from confirmation straight to `completed` in one
request.

## Move device (new table `device_move_devices`, PR 031-1)

| Column | Type | Notes |
| --- | --- | --- |
| `device_move_id` | FK cascade | |
| `predecessor_device_id` | FK devices | Source device |
| `successor_device_id` | FK devices nullable | Set at cutover |
| `name`, `code` | string | Successor's; `code` unique in the target at confirmation and cutover, archived devices included (the `devices` unique index), so a prefilled code the target uses becomes `<code>-2`, `-3`… |
| `target_site_id` | FK sites nullable | Must be a target site |
| `was_active` | bool | Predecessor lifecycle `active` at confirmation |
| `arrives_active` | bool | `was_active` and mover holds `Device.activate` in the target (FR-008) |
| `stop_operation_uuid` | uuid nullable | The deactivation the move requested |
| `state` | enum `waiting`, `stopping`, `stopped`, `moved`, `failed` | Per device |
| `outstanding_key` | bigint nullable, unique | = `predecessor_device_id` while the move is `stopping`; cleared when it ends. One move per device (FR-004) |

## Carried item (new table `device_move_items`, PR 031-4)

| Column | Type | Notes |
| --- | --- | --- |
| `device_move_id` | FK cascade | |
| `kind` | enum `dashboard`, `automation` | |
| `source_item_id` | bigint | `dashboards.id` or `automation_workflows.id` |
| `uses_only_moving` | bool | FR-030 classification |
| `action` | enum `move`, `copy`, `keep`, `archive` | Allowed per kind and classification, see below |
| `omitted` | jsonb | `{panels: [...], shares: [...], recipients: [...], references: [...]}` listed before confirming |
| `target_item_id` | bigint nullable | The moved or copied item |
| `arrives_running` | bool nullable | Automations: running in the target after cutover |

Allowed actions (first is preselected, FR-030):

| Kind | Uses only moving | Actions |
| --- | --- | --- |
| dashboard | yes | `move`, `keep`, `archive` |
| dashboard | no | `copy`, `keep` (shown as **Don't copy**) |
| automation | yes | `move`, `keep`, `archive` |
| automation | no | `keep`, `archive` |

An action needing a permission the mover lacks is not offered; the item falls back to
`keep`.

## Device link (new table `device_links`, PR 031-1)

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `uuid` | | |
| `predecessor_device_id` | FK devices unique | |
| `successor_device_id` | FK devices unique | |
| `source_organization_id`, `target_organization_id` | FK organizations, cascade | As for moves |
| `device_move_id` | FK nullable | Null leaves room for spec 016's transfers |
| `cutover_at` | timestamptz | |
| `history_included` | bool | From the move (PR 031-9) |
| `history_stopped_at` | timestamptz nullable | |
| `history_stopped_by` | FK users nullable | |
| `history_stopped_reason` | enum `stopped`, `left_account` nullable | FR-052 |

A successor that moves again is the predecessor of a new link; links form a chain
but history is read one link at a time (R18).

## Profile copy (new table `device_profile_copies`, PR 031-1)

| Column | Type | Notes |
| --- | --- | --- |
| `source_profile_id`, `source_artifact_id` | FK | The version a successor used |
| `target_organization_id` | FK organizations, cascade | |
| `target_profile_id`, `target_artifact_id` | FK | The copy |
| `parameter_map` | jsonb | `{source parameter uuid: target parameter uuid}` |
| | unique `(source_artifact_id, target_organization_id)` | One copy per version and target (FR-011) |
| | index `(source_profile_id, target_organization_id)` | Later versions reuse the same target profile |

## Changed tables

| Table | Change | PR |
| --- | --- | --- |
| `device_installations` | `ended_reason` enum `archived`, `moved` nullable; unique index on `device_adapter_candidate_id` replaced by a partial unique index `WHERE ended_at IS NULL`; backfill ends the installations of archived devices with `archived` | 031-1 |
| `device_onboardings` | `released_at` timestamptz nullable; the unique index on `(sparkplug_gateway_id, source_device_id)` becomes partial `WHERE released_at IS NULL`; backfill releases rows of archived devices | 031-5 |
| `dashboards` | `archived_at`, `archived_by` (FK users) in 031-3; `archived_by_move_id` (FK `device_moves`, nullable) in 031-4, since 031-3 can merge before `device_moves` exists | 031-3, 031-4 |
| `automation_workflows` | `archived_at`, `archived_by` in 031-3; `archived_by_move_id` in 031-4 | 031-3, 031-4 |
| `automation_alerts` | `stopped_reason` gains `device_moved` (Laravel-set at cutover) | 031-1 |
| `automation_deployments` | `stopped_reason` gains `moved` and `device_moved` | 031-4 |
| `sparkplug_gateways` | `credentials_known_to_organization_id` (FK nullable), `credentials_rotated_at` | 031-7 |
| `device_move_proposals` (new) | `uuid`, `conversation_id`, `user_id`, `source_organization_id`, `preview` jsonb, `content_hash`, `status` (`proposed`, `applied`, `dismissed`) | 031-10 |
| Spatie `permissions` | `Device.move` for every guard but `mcp`; Admin roles reconciled by a backfill migration | 031-1 |

`devices` gets no new column: **Moved to/from** comes from `device_links`, and hosted
comes from the source's pipe (below).

## Derived: pipe and hosted device

`Pipes::for(Device)` (R2) resolves:

| Device's source | Pipe | Pipe owner |
| --- | --- | --- |
| none | none | — |
| open installation on an adapter source | the adapter | `device_adapters.organization_id` |
| source on a gateway in a user connection | that gateway | `sparkplug_gateways.organization_id` |
| its own gateway (direct device) | none: the gateway is part of the device | — |

**Hosted** = pipe owner ≠ device organization, both in one billing account. The
pipe owner's views show `in_use_in` for a source whose device is hosted elsewhere.

## Wire additions (see [contracts](contracts/platform-api.md))

- Device: `link`, `pipe`; candidate: `in_use_in`; adapter and gateway: `hosted_devices`
  (031-6).
- Internal: `internal.control-state.v1` connection `gateways[]` (031-7);
  `device.connectivity.v1` `subject.pipe_organization_uuid` (031-5).

## Validation rules

- Source ≠ target. Both in one billing account at confirmation and at cutover, or 404
  for a target outside it (FR-002).
- 1–100 devices, all in the source and not archived. None has a pending deployment, a
  pending operation or an outstanding move (FR-004).
- Successor codes unique in the target, archived devices included, and among the move's devices. Names required.
  Target site in the target.
- Before PR 031-5, every device reports through an adapter or has no source (R22).
  Before 031-7, no direct devices.
- `confirmed_archives` lists exactly the items whose action is `archive` (FR-006).
- `preview_hash` equals the current review's hash (R10).
- `include_history` must be false before PR 031-9.
