# Data Model: Data-First Device Onboarding

New tables, changed columns, configuration objects and state machines. Each table
has `organization_id` with cascading delete. Every query resolves the organization
from the route first (principle III).

## `device_setups` (new)

A setup is one person's journey for one source ([research R1](research.md#r1-where-the-journey-lives-and-how-a-setup-is-saved)).

| Column | Type | Rule |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | `uuid` is unique |
| `organization_id` | foreign key | cascade |
| `kind` | string 16 | `new`, `another` (add another device of this type), `copy` |
| `connector` | string 40 | A connector key from the registry ([connectors](contracts/connectors.md)); null until it is chosen on the start screen |
| `start_answer` | string 40, nullable | The start-screen answer, kept for the report |
| `device_adapter_id` | foreign key, nullable | Set when an adapter connector's source is first saved; null on delete |
| `device_onboarding_id` | foreign key, nullable | Set for native paths; null on delete |
| `copied_from_adapter_id` | foreign key, nullable | `copy` only; null on delete |
| `step` | string 16 | The step reached: `start`, `connect`, `data`, `readings`, `collect` or `done` |
| `status` | string 24 | See the states below |
| `waiting_permission` | string 64, nullable | The permission a rollout waits for (FR-052) |
| `pasted_samples` | JSON | Up to 10 entries `{topic_or_path, payload, pasted_at}`, each payload at most 64 KiB; labelled as pasted and never counted as received |
| `activation_selection` | JSON | Up to 50 entries `{source_device_id, name}`: the person's draft choice while the setup is open. Start collecting copies it into the rollout's `serials`, which is the record from then on |
| `step_times` | JSON | `{<step>: {reached_at, completed_at}}` |
| `assistant_used`, `code_edited` | boolean | Both default to false |
| `cards_applied`, `form_saves` | integer | Steps approved in the conversation and in forms (FR-110) |
| `first_reading_at` | timestamp, nullable | The first stored reading of any device the setup activated |
| `started_by_user_id` | foreign key to users, nullable | An integer `user_id` (ADR-013); null on delete |
| `completed_at`, `discarded_at` | timestamp, nullable | |
| `created_at`, `updated_at` | timestamps | |

Indexes are `(organization_id, status, updated_at)` and `(device_adapter_id)`.

**States**:

```text
open ──(rollout waits for a permission)──▶ waiting ──(confirmed by someone with it)──▶ open
open ──(first reading stored)──▶ done
open | waiting ──(Discard)──▶ discarded
```

- **Unfinished setups** are those with status `open` or `waiting`. The Devices page
  and Home list them (FR-004), and `overview.setups.unfinished` counts them.
- **Discard** deletes the draft adapter only if it has no applied revision and no
  installation. Otherwise the setup is discarded and the adapter stays, opening in
  Manage.
- **Pruning**: `done` setups go 365 days after `completed_at` and `discarded` setups
  after 30 days (`setups:prune`, daily).

**Mapping derived steps** (adapter connectors). The step states come from spec
020's checklist, and the setup row adds only `step` and the rollout:

| Journey step | Checklist steps | Done when |
| --- | --- | --- |
| Connect | `connect` | The source is saved and its connection check passes, or input has arrived |
| See data | `samples` | At least one captured or pasted sample exists |
| Choose readings | `type`, `decoder` | The mapping or code is saved, a device type is chosen or drafted, and every checked sample decodes |
| Start collecting | `deploy`, `activate` | A revision is applied and every selected serial is active |

For native paths, the step comes from the `device_onboardings` row and the device
state: provisioned, then a birth seen, then the configuration valid, then active.

## `device_adapter_rollouts` (new)

One ordered Start collecting or Apply changes run ([R7](research.md#r7-start-collecting-an-ordered-resumable-rollout)).

| Column | Type | Rule |
| --- | --- | --- |
| `id`, `uuid` | bigint, uuid | |
| `organization_id`, `device_adapter_id` | foreign keys | cascade |
| `device_setup_id` | foreign key, nullable | null for Apply changes started in Manage |
| `kind` | string 8 | `start` or `apply` (`apply` has no activation step) |
| `request_uuid` | uuid | unique per adapter, so a repeated confirmation is idempotent |
| `draft_revision` | integer | The adapter draft the person confirmed; a later save fails the rollout with `draft_changed` |
| `steps` | JSON | An ordered list of `{key, state, started_at, finished_at, actor_user_id, reason, fix}`; keys are `check`, `publish`, `bind`, `deploy` and `activate` |
| `status` | string 16 | `queued`, `running`, `waiting`, `failed`, `done` or `cancelled` |
| `revision_uuid` | uuid, nullable | The bound, tested revision that deploys |
| `artifact_uuid` | uuid, nullable | The published or reused profile |
| `serials` | JSON | `{source_device_id, name, state: waiting\|activated\|in_use\|failed, device_uuid?}`, the snapshot confirmed with Start collecting; later edits to `activation_selection` take effect only when someone confirms again |
| `confirmed_by_user_id` | foreign key to users | The person who confirmed last |
| `created_at`, `updated_at` | timestamps | |

**Step states**: `todo`, `running`, `done`, `skipped`, `waiting` (for a permission or
a serial's birth) and `failed`.

- One rollout per adapter can be `queued`, `running` or `waiting` at a time. A
  second confirmation returns that rollout.
- Confirming a `failed` or `waiting` rollout re-runs from its first step that is not
  done.

```text
queued → running → (each step) → done
              ├─▶ failed  (reason + fix; confirm again resumes)
              └─▶ waiting (permission or serial; confirm or the event resumes)
```

**Reasons** use the connector's codes plus the rollout's own:

| Code | Meaning |
| --- | --- |
| `test_failed` | The check or the bound test failed |
| `profile_invalid` | The device type failed validation |
| `profile_changed` | The device type changed after the check |
| `draft_changed` | The draft changed after confirmation |
| `deploy_failed` | Deployment failed; carries the operation's diagnostic |
| `permission_missing` | A step needs a permission the person lacks |
| `serial_in_use` | The serial belongs to a device activated through another source |
| `serial_silent` | Shown after 10 minutes of waiting; never fails the rollout |

## `device_adapters` (changed)

| Column | Change |
| --- | --- |
| `device_profile_artifact_id` | Becomes nullable. A draft may have no profile (FR-011). Test and deploy still need one. |
| `device_profile_id` | New, nullable: the draft device type the setup created, until it is published |
| `mapping` | New JSON, nullable: the current draft's `field-mapping.v1` |
| `code_origin` | New string 8, default `code`: `mapping` when the code was compiled from `mapping` |
| `capture_until` | New timestamp, nullable: the capture lease ([R2](research.md#r2-capturing-mqtt-input-before-any-revision-is-deployed)) |

`AdapterService::fields`:

- **Profile**: `artifact_uuid` becomes `nullable|uuid`, and `draft_profile_uuid`
  (`nullable|uuid`) is new. They are mutually exclusive.
- **Mapping**: `mapping` is validated against `field-mapping.v1`. Its reading keys
  must be unique, and when a profile is set they must be its keys.
- **Code**: when `code_origin = mapping`, `code` must equal
  `FieldMappingCompiler::compile(mapping)`, or the save gets a 422.
- **Topic filters** for `platform` sources may be empty while the adapter has no
  applied revision. Deploy still requires at least one.

The **view** gains:

- `mode` (`setup` or `manage`);
- `status` (`{tone, sentence, hop, since}`);
- `capture_until`;
- `mapping`, `code_origin` and `draft_profile`.

The index gains `status` and `mode`.

## `device_adapter_revisions` (changed, no migration)

`definition` gains `mapping` (nullable) and `code_origin`, which are part of
`content_hash`. A revision stays immutable. A revision with `artifact_uuid = null`
can be tested against a draft profile's compiled definition (the rollout's `check`
step) but never deployed.

## `device_adapter_deliveries` (changed)

Captured input from every connector shares this table.

- **MQTT captures** use `kind = sample` and `source = mqtt`. `path` holds the topic,
  and `input` holds the fixture-shaped input (`topic`, `payload_base64`,
  `received_at`, `source`).
- **New columns**: `retained` (boolean, nullable), `qos` (tiny integer, nullable),
  `off_filter` (boolean, default false) and `truncated` (boolean, default false).
- **Unchanged**: limits and pruning (newest 100 per kind, pruned after 7 days, 20
  shown).
- **Unauthenticated input** never keeps a body (FR-020). The tenant broker
  authenticates every client.
- **Fetch now records** are stored as captured input: up to 20 records from each
  Fetch now.
  - Columns: `kind = sample`, `source = poll`, `path` set to the request URL's path
    without its query, and `input` in fixture shape with `poll`.
  - Fetch now results are already redacted, and the records are vendor data, not
    credentials.
  - They count as received input, never as pasted (FR-023), and survive Resume
    (FR-004).

## `device_adapter_proposals` (changed)

| Column | Change |
| --- | --- |
| `kind` | Adds `step` |
| `card` | New string 24: `connector`, `settings`, `credentials`, `secret`, `kit`, `mapping`, `code`, `fixtures`, `device_type`, `native_device`, `native_matches`, `start` or `activate` ([tools contract](contracts/onboarding-tools.md#cards-suggestcard)) |
| `state` | New string 16: `open`, `applied`, `out_of_date` or `dismissed` |
| `result` | New JSON, nullable: what applying produced (saved revision, test summary, "Secret created 10:42", rollout uuid, device uuids); never a secret value |
| `device_setup_id` | New foreign key, nullable; `device_adapter_id` becomes nullable for `step` proposals made before the source is saved |
| `step` | New string 16: `connect`, `data`, `readings` or `collect` |
| `fields` | New JSON: the suggested form values, keyed by the step form's field names; validated by that step's save rules; secrets refused |
| `applied_revision` | New integer, nullable: the draft revision in which the person saved it |

`content_hash` covers `card`, `step` and `fields`. A decision of `applied` with no
`applied_revision` is refused for cards that save a draft. `fields` never holds a
secret value: `credentials` and `secret` cards name the fields only.

## `assistant_conversations` (changed)

`device_setup_id` is a new nullable foreign key, unique among onboarding
conversations: one conversation per setup (FR-071). An onboarding conversation opened
from a setup binds to it. `device_adapter_id` follows when the setup's source is
saved. Applied and dismissed cards add event messages with the card's title and
result, never a secret.

## Connector definition (configuration, not a table)

A definition is platform configuration, served read-only by `GET connectors`
([contract](contracts/connectors.md)).

| Field | Meaning |
| --- | --- |
| `key` | `tenant_mqtt`, `vendor_mqtt`, `webhook`, `poll`, `sparkplug_direct`, `sparkplug_gateway` (`lab_mqtt` in test environments only) |
| `source_type` | The adapter `source.type` it creates (`source-settings.v1`): `tenant_mqtt` and `lab_mqtt` use `platform`, `vendor_mqtt` uses `vendor`, `webhook` uses `webhook`, and `poll` uses `poll`. The two native connectors create no adapter and have none |
| `answer` | Where it sits on the start screen: `server_address`, `vendor_cloud.webhook`, `vendor_cloud.api_key`, `vendor_cloud.mqtt`, `plant_network` or `already_sending` |
| `title`, `summary`, `needs` | Plain words; `needs` lists what the person must have (for example "Access to the vendor cloud's webhook settings") |
| `availability` | `{available, reason?}` for this organization and person: the adapters feature, a public webhook address, and the permissions for Connect |
| `settings` | The JSON Schema reference of its settings (`source-settings.v1` per type) and its secret field names |
| `capture` | `broker_capture`, `webhook_samples`, `fetch_now` or `sparkplug_birth` |
| `readings` | `field_mapping`, `point_map` or `profile_metrics` |
| `reasons` | `{code, title, explanation, fix}`, at least `no_input`, plus the transport's own codes |
| `assistant` | The onboarding actions allowed for setups of this connector |

## Field mapping

The format is the `field-mapping.v1` contract ([contract](contracts/field-mapping.md)).
It is stored in the adapter's draft and in each revision's definition.

## Cards and suggested fields in the portal (not stored)

An open `step` proposal is shown twice:

- **In the conversation**: an `ActionCard`.
- **In the step's form**: fields marked `suggested` until the person keeps, edits or
  discards them.

Either the card's control or the form's save sends the proposal's `uuid` and
`content_hash` to the step's route. The other view then shows it as applied.
**Dismiss** on the card, or discarding every suggested field, records `dismissed`.
