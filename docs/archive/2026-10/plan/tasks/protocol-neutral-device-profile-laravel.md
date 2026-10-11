# Protocol-Neutral Device Profiles — Laravel Delivery Plan

**Status:** Proposed — planning only  
**Scope:** Database schema, Laravel control plane, APIs, compilation, caching, and a contract-driven shadcn mock UI  
**Depends on:** Administration roles and permissions baseline  
**Related plans:** [Sparkplug-First Device Domain](./sparkplug-first-device-domain.md), [Responsibility Boundaries](../architecture/responsibility-boundaries.md), [Data Ingestion and Adapters](../architecture/data-ingestion-and-adapters.md), [Definition Activation](../contracts/definition-activation.md)

## 1. Outcome

Create a protocol-neutral Device Profile domain that can describe an RGB light, a three-phase energy meter, and future device types without embedding MQTT topics, Sparkplug metric names, HTTP paths, CoAP resources, or Modbus registers.

Laravel is the authoritative control plane. It owns profile authoring, tenant authorization, validation, publication, auditing, compiled artifacts, and public APIs. Go services consume immutable activated definitions for high-throughput validation, derivation, ingestion, and command handling without querying Laravel for every message.

The delivery sequence is:

```text
Profile contract and fixtures
          ↓
Normalized database and Laravel domain
          ↓
Authoring, validation, and publication APIs
          ↓
Contract-driven shadcn mock UI
          ↓
Protocol bindings and onboarding flows
```

The database and API contract should come before a polished mock UI. A thin UI can follow as soon as the contract is stable; it must not establish a second, frontend-only data model.

## 2. Architectural decisions

### 2.1 Device Profile boundary

A Device Profile describes the platform meaning and behavior of a device's parameters:

- stable parameter identities and keys;
- data types, semantic formats, and engineering units;
- whether each parameter reports state and/or accepts commands;
- value validation and counter semantics;
- pure derived calculations;
- presentation hints; and
- optional reusable alarm templates.

A Device Profile does **not** contain:

- MQTT topics, Sparkplug metric names, HTTP paths, CoAP resources, Modbus registers, payload codecs, credentials, or TLS settings;
- Sparkplug `group_id`, `edge_node_id`, `device_id`, aliases, `bdSeq`, or `seq`;
- active rules, automations, or notification actions;
- widget dependencies such as disabling Brightness while Power is off;
- site tariffs, alarm thresholds, nominal voltage, or installation-specific CT/PT ratios; or
- tenant or entity ownership inferred from an untrusted device payload.

Protocol-specific concerns belong to **Transport Bindings**. Tenant-, entity-, and device-specific values belong to their respective assignments/settings. Active operational rules belong to a future **Rule Engine**.

### 2.2 Validation with JSON Logic

Parameter validation uses JSON Logic for value constraints. Runtime evaluation receives a deliberately narrow context:

```json
{
  "value": 7,
  "previous_value": 6
}
```

Rules may reference `value` and, where counter semantics require it, `previous_value`. They must not reference unrelated parameters or other devices. Cross-parameter and cross-device behavior belongs to the Rule Engine.

Primitive decoding happens before JSON Logic:

- supported primitives: Boolean, integer, number, string, timestamp, and bytes;
- semantic formats such as `hex_color` are validated after primitive decoding; and
- unit conversion and transport-specific scaling happen in the binding/mapping layer.

Validation returns a Boolean result plus a stable diagnostic code. The user-facing message is metadata rather than logic output.

Example:

```json
{
  "engine": "json_logic",
  "rule": {
    "and": [
      { ">=": [{ "var": "value" }, 1] },
      { "<=": [{ "var": "value" }, 10] }
    ]
  },
  "diagnostic_code": "brightness_out_of_range",
  "message": "Brightness must be between 1 and 10."
}
```

The initial operator allowlist should be small and identical in PHP and Go. Shared fixtures will prove that both implementations accept and reject the same values.

### 2.3 Calculations and derivations

Pure deterministic calculations may remain in a profile when all inputs are current canonical parameter values. Examples include average phase voltage, phase imbalance, and estimated output percentage.

Initial restrictions:

- one approved expression engine;
- explicit parameter dependencies;
- one derived target parameter per calculation;
- deterministic output;
- no network, database, filesystem, clock, or arbitrary code access;
- no historical/windowed queries; and
- dependency-cycle detection before publication.

Windowed analytics, business rules, automations, and actions are deferred to the Rule Engine or analytics services.

### 2.4 Alarm templates

Alarm templates are normalized reusable suggestions, not active executable rules. A profile may suggest alarms such as meter staleness or phase imbalance. The future Rule Engine will instantiate a template for a tenant, entity, or device and own its thresholds, evaluation state, actions, and notification routing.

### 2.5 Configuration schema

Do not add a formal `configuration_schema` in the first implementation.

- `device_profiles.extensions` holds uncommon vendor/profile extension metadata.
- Future device assignments may hold device-specific `settings` JSON.
- Entity/site records may hold installation and business settings.

Introduce a configuration schema only when the platform must dynamically render and validate arbitrary installation settings. Adding it now would create an abstraction without a validated use case.

### 2.6 Drafts, publication, and internal revisions

The UI exposes a simple **Draft / Published / Archived** lifecycle rather than a visible Profile → Schema Version hierarchy.

Internally, every published definition must still be immutable and revision-addressable so Go can cache it, restart safely, roll back, and report the exact loaded definition. A flat internal revision is operational metadata, not a user-managed schema hierarchy.

## 3. Database design

Follow the existing Laravel conventions:

- numeric primary keys for internal joins;
- unique UUIDs for public API identities;
- organization scoping in queries and policies;
- timestamps on mutable records;
- soft deletes only on aggregate roots where restoration is meaningful;
- PostgreSQL `jsonb` for flexible documents; and
- relational references as foreign keys, not IDs hidden only inside JSON.

### 3.1 `device_profiles`

Aggregate root for authoring and publication.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Public/API identity |
| `organization_id` | bigint nullable FK | `null` for platform templates; otherwise tenant-owned |
| `code` | varchar | Stable scoped code, e.g. `three-phase-energy-meter` |
| `name` | varchar | Human-readable name |
| `description` | text nullable | Authoring description |
| `category` | varchar nullable | Loose device category, never a protocol |
| `status` | varchar | `draft`, `published`, or `archived` |
| `revision` | unsigned integer | Incremented by successful publication |
| `definition_hash` | char(64) nullable | SHA-256 of canonical compiled JSON |
| `extensions` | jsonb nullable | Rare vendor/profile extension metadata |
| `published_at` | timestamp nullable | Last successful publication |
| `created_by` | bigint nullable FK | Audit actor |
| `updated_by` | bigint nullable FK | Audit actor |
| `created_at`, `updated_at` | timestamps | Laravel timestamps |
| `deleted_at` | timestamp nullable | Soft deletion of eligible profiles |

Constraints and indexes:

- unique `code` within platform-owned or organization-owned scope;
- indexes on `organization_id`, `status`, and `category`;
- `revision >= 0`;
- a published profile requires `published_at`, `definition_hash`, and an active artifact; and
- deletion is rejected while the profile is referenced by a device, binding, or active assignment.

### 3.2 `profile_parameter_groups`

Optional authoring and presentation grouping.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Public identity |
| `device_profile_id` | bigint FK | Owning profile |
| `code` | varchar | Stable group code |
| `label` | varchar | Display label |
| `description` | text nullable | Optional help text |
| `sort_order` | integer | Deterministic UI order |
| timestamps | timestamps | Laravel timestamps |

Use a unique constraint on `(device_profile_id, code)`.

### 3.3 `profile_parameters`

Stable platform parameters referenced by calculations, alarm templates, devices, and transport mappings.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Stable public identity across compatible edits |
| `device_profile_id` | bigint FK | Owning profile |
| `parameter_group_id` | bigint nullable FK | Optional presentation group |
| `key` | varchar | Stable profile-local key, e.g. `voltage.l1` |
| `label` | varchar | Human-readable label |
| `description` | text nullable | Help/documentation |
| `kind` | varchar | `state`, `measurement`, `counter`, `event`, or `derived` |
| `data_type` | varchar | Canonical primitive type |
| `format` | varchar nullable | Semantic format such as `hex_color` |
| `unit` | varchar nullable | Canonical engineering unit |
| `reports_state` | boolean | Device/runtime may report values |
| `accepts_command` | boolean | Authorized commands may target it |
| `validation_logic` | jsonb nullable | JSON Logic rule and diagnostics |
| `display_config` | jsonb nullable | Widget hint, precision, step, and help text |
| `reporting_config` | jsonb nullable | Reporting mode/interval and staleness hints |
| `counter_config` | jsonb nullable | Monotonic/reset/delta semantics |
| `sort_order` | integer | Deterministic order |
| timestamps | timestamps | Laravel timestamps |

Constraints:

- unique `(device_profile_id, key)`;
- group and profile ownership must match;
- only `derived` parameters may be calculation targets;
- derived parameters cannot accept commands; and
- enum options live in validation/display JSON until querying them relationally becomes necessary.

### 3.4 `profile_calculations`

One calculation produces one derived parameter.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Public identity |
| `device_profile_id` | bigint FK | Profile scope |
| `target_parameter_id` | bigint unique FK | Derived output parameter |
| `engine` | varchar | Initially one approved engine |
| `expression` | jsonb | Pure expression document |
| `evaluation_mode` | varchar | Initially `on_input_change` |
| `failure_policy` | varchar | Initially `mark_invalid` |
| timestamps | timestamps | Laravel timestamps |

### 3.5 `profile_calculation_inputs`

Normalized dependency graph for cycle checks and runtime scheduling.

| Column | Type | Purpose |
| --- | --- | --- |
| `profile_calculation_id` | bigint FK | Calculation |
| `profile_parameter_id` | bigint FK | Input parameter |
| `alias` | varchar | Variable name used in the expression |

Composite uniqueness prevents duplicate inputs and aliases. Every input must belong to the same profile as the calculation.

### 3.6 `profile_alarm_templates`

Reusable suggestions that may later be instantiated by the Rule Engine.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Public identity |
| `device_profile_id` | bigint FK | Owning profile |
| `code` | varchar | Stable profile-local code |
| `name` | varchar | Human-readable name |
| `type` | varchar | E.g. `threshold`, `staleness`, `counter_reset` |
| `severity` | varchar | Suggested default severity |
| `condition_config` | jsonb | Flexible template condition |
| `enabled_by_default` | boolean | Suggestion for future instantiation |
| timestamps | timestamps | Laravel timestamps |

Use a unique constraint on `(device_profile_id, code)`.

### 3.7 `profile_alarm_template_parameters`

Relational references from alarm templates to profile parameters.

| Column | Type | Purpose |
| --- | --- | --- |
| `profile_alarm_template_id` | bigint FK | Alarm template |
| `profile_parameter_id` | bigint FK | Referenced parameter |
| `role` | varchar | E.g. `subject`, `input`, or `reference` |

Every referenced parameter must belong to the template's profile.

### 3.8 `device_profile_artifacts`

Immutable compiled read model generated during publication. This is not a user-managed schema version.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigint PK | Internal identity |
| `uuid` | uuid unique | Public artifact identity |
| `device_profile_id` | bigint FK | Source profile |
| `revision` | unsigned integer | Compiled profile revision |
| `definition_hash` | char(64) | Hash of canonical JSON |
| `definition` | jsonb | Complete protocol-neutral runtime document |
| `status` | varchar | `active` or `retired` |
| `compiled_at` | timestamp | Compilation time |
| `compiled_by` | bigint nullable FK | User or system actor |
| timestamps | timestamps | Laravel timestamps |

Constraints:

- unique `(device_profile_id, revision)`;
- unique `(device_profile_id, definition_hash)`; and
- only one active artifact per profile.

### 3.9 Generic transport tables

Transport bindings remain separate from profile semantics:

- `transport_bindings`: profile, adapter key, name, lifecycle, adapter configuration, and compile status;
- `binding_parameter_mappings`: binding, stable profile parameter, direction, transport locator, codec/type mapping, and scaling/transform configuration; and
- later assignment tables: logical device, binding, connection, external identity, and entity placement.

The same parameter UUID can be mapped differently without altering the profile:

```json
{ "protocol": "sparkplug_b", "locator": { "metric": "Voltage L1" } }
```

```json
{ "protocol": "http", "locator": { "path": "$.measurements.voltage_l1" } }
```

```json
{ "protocol": "coap", "locator": { "resource": "/meter/voltage/l1" } }
```

Do not add protocol columns to `device_profiles` or `profile_parameters`.

## 4. Migration order

Create independently reviewable migrations in this order:

1. `create_device_profiles_table`
2. `create_profile_parameter_groups_table`
3. `create_profile_parameters_table`
4. `create_profile_calculations_table`
5. `create_profile_calculation_inputs_table`
6. `create_profile_alarm_templates_table`
7. `create_profile_alarm_template_parameters_table`
8. `create_device_profile_artifacts_table`
9. `create_transport_bindings_table`
10. `create_binding_parameter_mappings_table`

Migration acceptance criteria:

- clean migrate and rollback on the production database engine;
- constraints reject invalid cross-profile relations;
- domain lifecycle safely blocks deletion of referenced profiles;
- fixtures pass on the production database engine, not SQLite alone; and
- JSON columns do not rely on incompatible database defaults.

## 5. Laravel structure

Keep domain behavior cohesive while leaving HTTP concerns in conventional Laravel locations.

```text
apps/api/app/
├── Domain/DeviceProfiles/
│   ├── Actions/
│   │   ├── CreateDeviceProfile.php
│   │   ├── UpdateDeviceProfile.php
│   │   ├── ValidateDeviceProfile.php
│   │   ├── CompileDeviceProfile.php
│   │   └── PublishDeviceProfile.php
│   ├── Data/
│   ├── Enums/
│   ├── Events/
│   ├── Exceptions/
│   ├── Models/
│   ├── Policies/
│   ├── Services/
│   │   ├── JsonLogicValidator.php
│   │   ├── CalculationGraphValidator.php
│   │   ├── ProfileDefinitionCompiler.php
│   │   └── ProfileArtifactCache.php
│   └── Support/
│       └── CanonicalJson.php
├── Http/Controllers/Api/V1/DeviceProfiles/
├── Http/Requests/Api/V1/DeviceProfiles/
└── Http/Resources/Api/V1/DeviceProfiles/
```

### 5.1 Responsibilities

- Models own relationships, casts, UUID route keys, and small invariants.
- Actions orchestrate one business operation and its transaction.
- The compiler converts normalized rows into canonical JSON.
- JSON Logic sits behind a Laravel service interface so PHP and Go can share fixtures.
- The graph validator checks ownership, missing dependencies, duplicate aliases, and cycles.
- Publication records artifact, lifecycle, audit, and outbox changes atomically.
- Cache population occurs after commit through an idempotent listener.

Public APIs expose UUIDs, never internal numeric IDs.

### 5.2 Authorization

Every query is scoped to the selected organization unless the actor is authorized to manage platform templates.

Initial permissions:

- `DeviceProfile.view-any`
- `DeviceProfile.view`
- `DeviceProfile.create`
- `DeviceProfile.update`
- `DeviceProfile.delete-draft`
- `DeviceProfile.validate`
- `DeviceProfile.publish`
- `TransportBinding.manage`

Published artifacts are immutable. Editing a published profile resumes or creates draft authoring state and never mutates the active artifact.

## 6. API plan

Use `/api/v1` and UUID route identifiers.

### 6.1 Profile authoring

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/device-profiles` | Tenant-scoped paginated directory |
| `POST` | `/device-profiles` | Create a draft profile |
| `GET` | `/device-profiles/{profile}` | Read authoring state and published summary |
| `PATCH` | `/device-profiles/{profile}` | Update draft metadata |
| `DELETE` | `/device-profiles/{profile}` | Delete an unused draft only |

### 6.2 Nested resources

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/device-profiles/{profile}/parameter-groups` | Add a group |
| `POST` | `/device-profiles/{profile}/parameters` | Add a parameter |
| `PATCH` | `/device-profiles/{profile}/parameters/{parameter}` | Update a parameter |
| `DELETE` | `/device-profiles/{profile}/parameters/{parameter}` | Remove a draft parameter |
| `PUT` | `/device-profiles/{profile}/parameter-order` | Reorder groups and parameters |
| `PUT` | `/device-profiles/{profile}/parameters/{parameter}/calculation` | Define a derivation |
| `DELETE` | `/device-profiles/{profile}/parameters/{parameter}/calculation` | Remove a derivation |
| `POST` | `/device-profiles/{profile}/alarm-templates` | Add an alarm template |
| `PATCH` | `/device-profiles/{profile}/alarm-templates/{alarm}` | Update a template |
| `DELETE` | `/device-profiles/{profile}/alarm-templates/{alarm}` | Remove a draft template |

### 6.3 Validation and publication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/device-profiles/{profile}/validate` | Validate structure, logic, references, and calculations |
| `POST` | `/device-profiles/{profile}/compile` | Preview canonical compiled JSON |
| `POST` | `/device-profiles/{profile}/publish` | Atomically publish an immutable revision |
| `GET` | `/device-profiles/{profile}/artifacts/active` | Read active revision and hash |
| `GET` | `/device-profiles/{profile}/artifacts/{revision}` | Read an authorized historical artifact |

Transport Binding APIs use a separate controller/resource group, even if the UI presents profiles and bindings in one onboarding flow.

API principles:

- return stable UUIDs and parameter keys;
- keep authoring responses relational/resource-shaped;
- return one canonical runtime document from compile/artifact endpoints;
- report errors with stable codes, JSON pointers or UUIDs, and readable messages;
- establish tenant scope from authenticated context, never a request-supplied tenant ID; and
- use ETags, `updated_at`, or an explicit draft revision for optimistic concurrency.

## 7. Compilation, caching, and activation

### 7.1 Canonical compilation

The compiler produces deterministic JSON containing profile identity, parameters, validation, ordered calculation dependencies, counter/reporting semantics, and alarm-template metadata. It must not include internal numeric IDs, authoring-only data, or protocol binding configuration.

Canonical key ordering and number encoding produce a stable SHA-256 hash.

### 7.2 Cache model

```text
device-profile:{profile_uuid}:{revision}
device-profile:{profile_uuid}:active
```

- Revisioned artifacts are immutable and may use a long TTL.
- The active pointer stores the current revision and hash.
- A cache miss rebuilds from `device_profile_artifacts`, not mutable authoring tables.
- Cache updates and invalidation are idempotent.
- Go consumes the artifact through the activation contract and maintains its own runtime cache.

### 7.3 Publication transaction

1. Lock the draft profile.
2. Authorize the actor within the selected organization.
3. Validate parameters, JSON Logic, calculations, alarm references, and lifecycle.
4. Compile canonical JSON and calculate its hash.
5. Insert the next immutable artifact revision.
6. Retire the previous active artifact.
7. Update profile status, revision, hash, and `published_at`.
8. Write audit and outbox records.
9. Commit.
10. Populate cache and publish the activation event idempotently.

No runtime consumer should observe a partially published profile.

## 8. Authoritative fixtures

Build two fixtures before the UI. The same fixtures drive Laravel contract tests, frontend mock data, and later Go runtime tests.

### 8.1 RGB light

- Power: Boolean, reported and commandable.
- Color: `hex_color` string, reported and commandable.
- Mode: enum of `blink`, `strobe`, and `rainbow`, reported and commandable.
- Brightness: integer from 1 to 10 using JSON Logic, reported and commandable.
- Estimated output: optional pure derived parameter.
- No cross-parameter Power/Brightness rule or initial widget dependency.

### 8.2 Three-phase energy meter

- Phase voltages L1/L2/L3.
- Phase currents L1/L2/L3.
- Active power and frequency.
- Imported/exported monotonic energy counters.
- Average voltage and phase-imbalance derivations.
- Broad physical validation only.
- Optional staleness and imbalance alarm templates.
- No tariff, nominal voltage, or installation-specific CT/PT values in the reusable profile.

## 9. shadcn mock UI

Build the mock once read/write/compile API shapes are accepted. Use the project-local shadcn foundation and actual shadcn components rather than native HTML substitutes.

The editor uses horizontal steps:

1. **Profile details** — name, code, category, and description.
2. **Parameters** — groups, types, units, capabilities, validation, and display hints.
3. **Calculations** — targets, inputs, expressions, and sample evaluation.
4. **Alarm templates** — reusable suggestions, clearly distinguished from active rules.
5. **Review and publish** — diagnostics, compiled preview, revision, and publication.

UI requirements:

- use shadcn `Card`, `Table`, `Field`, `Select`/`Combobox`, `Switch`, `Input`, `Textarea`, `Badge`, `Alert`, `Dialog`, and `Button` components;
- provide searchable parameter lists and deterministic reordering;
- offer structured range/enum inputs plus an advanced JSON view;
- show generated JSON Logic and validation results before save;
- show calculation dependency/cycle errors before publication;
- label alarm templates as suggestions, not active alarms;
- render loading, empty, invalid, permission-denied, and conflict states; and
- hide tenant selection in a tenant-scoped session.

After the profile editor is proven, adapt Sparkplug onboarding to select the profile, map discovered metrics to stable parameter UUIDs, review the compiled profile plus binding, and activate a logical device without making the Sparkplug topic hierarchy the ownership hierarchy.

## 10. Verification strategy

### 10.1 Database and domain tests

- organization-scoped uniqueness and tenant isolation;
- stable parameter UUIDs;
- rejected cross-profile calculation/alarm references;
- calculation-cycle rejection;
- protected artifacts and deletion restrictions;
- clean production-engine migration/rollback;
- JSON Logic range, enum, missing-value, invalid-expression, and operator-allowlist cases;
- canonical JSON determinism and stable hashing; and
- compilation without protocol fields.

### 10.2 API and browser tests

- authenticated tenant CRUD and negative cross-tenant access;
- permission checks for validation and publication;
- stable validation diagnostics and compile preview;
- atomic revision increment and cache refresh after commit;
- immutable active artifacts;
- golden RGB-light and energy-meter responses;
- create/edit/reorder profile parameters in the browser;
- configure and exercise JSON Logic validation;
- detect a calculation cycle; and
- review and publish a valid profile.

## 11. Delivery tasks

Each task is independently reviewable. Do not start a task until the previous task's acceptance evidence exists.

### Task 0 — Contract and fixtures

**Work:** Define canonical JSON, supported kinds/types/formats/units, the JSON Logic allowlist and diagnostics, calculation restrictions, alarm-template semantics, and both fixtures.

**Acceptance:** Both fixtures are reviewed; no protocol, Rule Engine, configuration-schema, or widget-dependency concern leaks into the profile contract; PHP and Go can consume the same fixture corpus.

### Task 1 — Core schema and models

**Work:** Add migrations through `device_profile_artifacts`, plus Eloquent models, relationships, casts, factories, and tenant policies.

**Acceptance:** Migration, rollback, model, relationship, tenant-isolation, and constraint tests pass; public resources expose UUIDs.

### Task 2 — Validation and compiler

**Work:** Add JSON Logic validation, the operator allowlist, calculation graph validation, deterministic compilation/hashing, and compiled fixture outputs.

**Acceptance:** Golden artifacts are deterministic; invalid logic, references, and cycles fail with stable diagnostics.

### Task 3 — Authoring APIs

**Work:** Add resource endpoints, form requests, API resources, policies, optimistic concurrency, and auditing.

**Acceptance:** Feature tests cover positive and negative tenant/permission cases; generated client types match the accepted contract.

### Task 4 — Publication and cache

**Work:** Add validate, compile-preview, publish, and artifact-read endpoints; implement atomic publication, cache keys, outbox events, and idempotent listeners.

**Acceptance:** Tests prove partial publication is impossible; active artifacts survive cache flush/restart; the Go activation payload is fixture-tested.

### Task 5 — shadcn profile mock

**Work:** Build the five-step editor against fixture-compatible API services using actual shared shadcn components.

**Acceptance:** UI and Laravel tests consume the same fixtures; no frontend-only profile schema exists; browser tests pass for draft, validation, calculation, and publication flows.

### Task 6 — Generic Transport Binding foundation

**Work:** Add generic binding/mapping persistence and APIs, implement Sparkplug B first, and preserve extension points for native MQTT JSON, HTTP, CoAP, Modbus, and adapter-backed protocols.

**Acceptance:** The same profile parameter UUIDs work with at least two binding fixtures without profile changes; no protocol field leaks into profile tables or APIs.

## 12. Explicit deferrals

- Rule Engine persistence, evaluation, actions, and active alarms.
- Cross-parameter and cross-device validation.
- Widget dependencies and dashboard composition.
- Formal dynamic configuration schema.
- Tenant tariff, billing, carbon, and site electrical configuration.
- Windowed or historical calculations.
- Automatic profile changes after Sparkplug rebirth messages.
- Fleet rollout and bulk profile migration.
- Unreviewed AI-generated definitions.

## 13. First implementation slice

Start with **Task 0 and Task 1 only**.

The first production pull request should contain:

- the accepted canonical profile contract;
- RGB-light and three-phase-meter fixtures;
- migrations and Eloquent models through `device_profile_artifacts`;
- tenant policies and factories; and
- focused database and domain tests.

Do not add Transport Bindings or production UI in the first pull request. Once the source-of-truth model and compile response are stable, build the thin shadcn editor against those same fixtures before continuing protocol onboarding.
