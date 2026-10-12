---
description: "Task list for spec 002: canonical telemetry and internal event contracts"
---

# Tasks: Canonical Telemetry and Internal Event Contracts

**Input**: Design documents from `specs/002-canonical-ingestion/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md) (§10 decisions), [data-model.md](data-model.md), [contracts/README.md](contracts/README.md), [quickstart.md](quickstart.md)

**Tests**: Required. The spec makes conformance tests the deliverable (FR-025 to FR-029, SC-003, SC-004, SC-007, SC-009), so test tasks are included and, where marked, written before the change they prove.

**Organization**: Phases follow the plan's pull requests (PR n) and the spec's user stories: US1 = envelope family (P1), US2 = internal message contracts (P2), US3 = enforcement and live checks (P3).

**Rules for every PR**: keep CI green; change docs in the same PR as the behaviour; do not change any producer to fix drift (FR-022); do not change live behaviour except the violation logging and counting of PR 9 (FR-032); when a PR changes what goes into the `api` or `runtime` image (contracts are copied into both from PR 2), rebuild those services with the stack's env files and overlays (AGENTS.md) and run the matching quickstart step (principle IX).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2 or US3; Setup, Foundational and Polish tasks have none

---

## Phase 1: Setup — PR 1 "Contract rules, catalogue and generic checker"

**Purpose**: Rules, decision record, empty catalogues and a checker that can carry every new contract.

- [X] T001 Write ADR-015 "Internal contract validation and evolution" (JSON Schema 2020-12; tolerant internal readers, strict envelope readers; live log-and-count checks; validator choices; compatibility rules from research D4) in docs/adr/ADR-015-internal-contract-validation.md and add it to docs/adr/README.md
- [ ] T002 [P] Update the rules in contracts/README.md: catalogue, cases files, tolerant internal and strict envelope reading, `oneOf` branches told apart by `const`, secret fields marked `"$comment": "secret"` with `placeholder-` example values, new `ingestion/v1` and `internal/` rows in the directory table
- [X] T003 [P] Create contracts/internal/catalogue.json and contracts/ingestion/v1/catalogue.json as empty arrays, plus contracts/internal/catalogue.schema.json describing an entry (fields in data-model.md §7.4: `id`, `group` ∈ control|event|wrapper|state, `schema`, `producer`, `consumer`, `dedup`, `fences`, `reading` ∈ tolerant|strict, `live_check`, `producer_tests`, `consumer_tests`)
- [ ] T004 Write checker unit tests first (they fail against today's script) in tooling/contracts/test_verify.py: discovers schemas in any `contracts/**/v*/` or `contracts/internal/**` directory; validates `*.fixture.json` and `*.cases.json`; an invalid case passes only when it fails on its declared `keyword` and `instance_location`; `tolerant_valid` cases fail closed and pass tolerant; a catalogue entry without schema, fixture, cases (≥1 valid and ≥1 invalid) or existing test files that mention its id fails; a secret-marked property without a `placeholder-` value fails; a `oneOf` whose branches lack a distinguishing `const` fails
- [ ] T005 Generalise tooling/verify-devices-contracts.py to satisfy T004 while keeping every existing check (devices, events negative checks, location, rules, profile hash, command expiry, Sparkplug proto hash) and printing per-directory counts
- [ ] T006 [P] Add `python -m unittest discover -s tooling/contracts -p 'test_*.py'` to the `tooling` job in .github/workflows/ci.yml
- [ ] T007 [P] Update docs/dev/testing.md: what the checker validates (only files with a schema), the cases format and the catalogue

**Checkpoint**: `rtk .local/devices/python/bin/python tooling/verify-devices-contracts.py` passes with unchanged contract counts; CI green.

---

## Phase 2: Foundational — PR 2 "Validators and contract registries on both sides"

**Purpose**: Shared validation code used by every later phase. No live wiring yet.

**⚠️ CRITICAL**: No user story phase can start until this phase is complete.

- [ ] T008 Add `github.com/santhosh-tekuri/jsonschema/v6` at the newest v6.0.x patch released at least two weeks earlier (at least v6.0.1) to services/runtime/go.mod and go.sum; record the exact version in the PR description
- [ ] T009 Add `opis/json-schema` (constraint `^2.4`, newest patch at least two weeks old) to apps/api/composer.json and composer.lock; record the exact version in the PR description
- [ ] T010 [P] Implement the Go registry in services/runtime/internal/contracts/registry.go: load both catalogues and every schema under a contracts root (`IOT_CONTRACTS_PATH`, default `/contracts`; tests pass the repository path), compile once, resolve `$ref` across files by `$id`; expose `Validate(id, value, mode)` with `Strict` and `Tolerant` modes, where tolerant drops errors whose keyword is `additionalProperties` or `unevaluatedProperties`; return `{keyword, instance_location}` pairs, never values
- [ ] T011 [P] Implement the PHP registry and validator in apps/api/app/Support/Contracts/ContractRegistry.php and ContractValidator.php with the same modes and error shape, reading `config('devices.contracts_path')`, caching compiled schemas per worker
- [ ] T012 [P] Go test helpers in services/runtime/internal/contracts/contractstest/assert.go: `AssertProduced(t, id, value)` (strict; the failure message names the contract id and each failing keyword and instance location, so a missing field is named) and `Cases(t, id)` iterating fixture and cases with their expected verdicts
- [ ] T013 [P] PHP test helpers in apps/api/tests/Support/AssertsContracts.php: `assertProduced($id, $value)` (failure message names the contract id and each failing keyword and data path) and `contractCases($id)`
- [ ] T014 [P] Go registry tests in services/runtime/internal/contracts/registry_test.go: every existing fixture validates strictly; every case matches its verdict in both modes; a missing contracts root yields a disabled registry, not an error
- [ ] T015 [P] PHP validator tests in apps/api/tests/Unit/Support/ContractValidatorTest.php: same assertions as T014 for the PHP side
- [ ] T016 Copy contracts into the runtime image (`COPY contracts /contracts`, `ENV IOT_CONTRACTS_PATH=/contracts`) in deploy/docker/runtime/Dockerfile; rebuild `runtime` and `api` and confirm both start normally (quickstart step C.5 rebuild command)

**Checkpoint**: both registries validate every existing fixture; images build and start; no behaviour change.

---

## Phase 3: User Story 1 — Adapter authors target one versioned telemetry envelope (Priority: P1) 🎯 MVP — PRs 6 and 7

**Goal**: The envelope, presence, announcement and rejection contracts with examples, a source mapping, and a reference reader that accepts every valid example and refuses every invalid one with the documented code.

**Independent Test**: quickstart steps C.1 and C.2: the checker passes the `ingestion/v1` contracts, and `go test ./internal/ingestion/envelope/...` accepts every valid example and refuses every invalid one with its code, recomputing `message_id` for the Sparkplug, vendor and HTTP JSON examples.

### Contracts (PR 6)

- [ ] T017 [US1] Write contracts/ingestion/v1/common.schema.json with `$defs` from data-model.md §1 to §3: trusted context (`organization_uuid` uuid required; `ingress` `{kind ∈ broker_connection|adapter_deployment|device_credential|api_token, uuid}` required; `adapter {adapter_uuid, revision_uuid}`; `installation_uuid`; `device {device_uuid, basis ∈ credential|binding}`), source (`protocol` ∈ sparkplug_b|vendor_mqtt|http_json|opcua|polling; `address` required), the address union by `scheme` (`sparkplug`: `group_id` 1 to 128, `edge_node_id` 1 to 128, `device_id` 0 to 128; `device_key`: `key` 1 to 128; `topic`: `topic` 1 to 512; `endpoint`: `endpoint` 1 to 512, optional `path` 1 to 256), provenance (`transport` ∈ mqtt|http|opcua|poll required; `topic` 1 to 512; `qos` 0 to 2; `retained`; `raw_payload_ref` 1 to 256), identity (`basis` ∈ session_sequence|source_message_id|observed_time|ingress_assigned with the per-basis required facts), and value (`name` 1 to 256; `type` ∈ boolean|integer|number|string|timestamp|bytes; `value` "integer: JSON integer within ±9,007,199,254,740,991", "string: up to 65,536 characters", "bytes: base64, decoded size up to 65,536 bytes"; `no_value_reason` ∈ null_reported|decode_failed|out_of_range|unsupported_type "present if and only if value is absent"; `quality` ∈ good|uncertain|bad "must not be good when value is absent"; `quality_code` 1 to 64; `quality_reason` 1 to 256; `unit {symbol 1 to 32, custom}`; `observed_at`; `time_source` ∈ source|receipt|corrected_future|derived; `historical` required); every date-time property uses `format: date-time` plus a pattern requiring UTC (`Z`) and at least millisecond precision (data-model.md conventions); every object closed
- [ ] T018 [P] [US1] Write contracts/ingestion/v1/telemetry.envelope.v1.schema.json (`schema_version` const, `message_id`, `identity`, `trusted`, `source`, `provenance`, `received_at` required; `observed_at` optional; `values` 1 to 2,000; description lists the reader-only rules: 1 MiB, unique name and effective time)
- [ ] T019 [P] [US1] Write contracts/ingestion/v1/source.presence.v1.schema.json (`presence` ∈ online|offline|unknown required; `reason` 1 to 256; `session` 1 to 128; `observed_at`)
- [ ] T020 [P] [US1] Write contracts/ingestion/v1/source.announcement.v1.schema.json (`parameters` 1 to 2,000 of `{name, type, unit?, writable?}`; `parameters_hash` lowercase hex SHA-256; `session` 1 to 128; no values)
- [ ] T021 [P] [US1] Write contracts/ingestion/v1/ingestion.rejection.v1.schema.json (`stage` ∈ decode|version|schema|semantic|identity|binding|policy; `code` ∈ malformed|too_large|unsupported_version|schema_violation|unknown_field|identity_in_content|identity_mismatch|duplicate_value|too_many_values|device_mismatch|parameters_hash_mismatch; `explanation` 1 to 512; optional `message_id`, `declared_version` 1 to 64, `organization_uuid`, `adapter_revision_uuid`, `locations` up to 10, `raw_payload_ref`; `rejected_at` required)
- [ ] T022 [US1] Add fixtures and cases for the four contracts in contracts/ingestion/v1/*.fixture.json and *.cases.json, starting from specs/002-canonical-ingestion/contracts/examples/; invalid cases must include: organization or device identity inside `values` or `source` (`unknown_field`, proves cross-organization smuggling fails), unknown `schema_version`, a value with `quality: good` and no value, more than 2,000 values, an integer beyond the safe range, `time_source: source` without any observation time, and reader-only cases (`duplicate_value`, `too_large`, `identity_mismatch`, `parameters_hash_mismatch`); the rejection fixture and cases include a `device_mismatch` example (stage `binding`) documenting the FR-004 rule the ingestion spec will enforce
- [ ] T023 [P] [US1] Write contracts/ingestion/v1/MAPPING.md (FR-016): field-by-field mapping from Sparkplug NBIRTH, DBIRTH, NDATA, DDATA, NDEATH, DDEATH (deterministic session `<group>/<edge>:<bdSeq>:<NBIRTH payload timestamp>`, `seq`, payload and metric timestamps, `is_historical`, `is_null`, datatypes, aliases resolved before mapping) and from the vendor decoder output (`sourceDeviceId`, `metrics[]`, `observedAt`, `messageId`, input `topic`, `qos`, `retained`, `receivedAt`) to the envelope and lifecycle contracts, with a table of information intentionally not carried (DataSets, Templates, Sparkplug properties other than provenance) and why
- [ ] T024 [US1] Register the four contracts in contracts/ingestion/v1/catalogue.json (`reading: strict`, `producer: adapter`, `consumer: ingestion`, consumer test services/runtime/internal/ingestion/envelope/reader_test.go) and run the checker

### Reference reader (PR 7)

- [ ] T025 [US1] Write reader tests first in services/runtime/internal/ingestion/envelope/reader_test.go: every valid fixture and case accepted; every invalid case refused with its declared keyword or reader code mapped to an `ingestion.rejection.v1` code; unsupported version refused with stage `version`; recomputed `message_id` equals the example for `session_sequence`, `source_message_id` and `observed_time`; announcement `parameters_hash` recomputed
- [ ] T026 [P] [US1] Define typed structs for the four contracts in services/runtime/internal/ingestion/envelope/types.go
- [ ] T027 [P] [US1] Implement message identity and announcement hash in services/runtime/internal/ingestion/envelope/identity.go exactly as data-model.md §1.4 and §4.2 (UUIDv5, namespace `8fb29609-1d16-49c4-b21f-e75dec46ea03`, `\n`-joined facts, sorted names for `observed_time`)
- [ ] T028 [US1] Implement the strict reader in services/runtime/internal/ingestion/envelope/reader.go: size check (1 MiB) before decoding, version dispatch, strict schema validation via the registry, semantic rules (unique name and effective time, identity recomputation, hash recomputation, announcement names unique, a `unit` with `custom: false` must be a symbol in contracts/units/v1/units.json, else `schema_violation`), returning either the typed message or a rejection diagnostic; not referenced from any live code path (FR-033)

- [ ] T029 [US1] Reviewer walkthrough (SC-006): someone who has not worked on the platform writes a valid HTTP JSON envelope using only contracts/ingestion/v1 (schemas, MAPPING.md, examples) and the reader's error output; record the time (target under 30 minutes) in the PR and fix any documentation gap found in contracts/ingestion/v1/MAPPING.md or contracts/README.md

**Checkpoint**: US1 independently testable; nothing in the runtime calls the reader.

---

## Phase 4: User Story 2 — Every internal control-plane and runtime message has a versioned contract (Priority: P2) — PRs 3, 4 and 5

**Goal**: Contracts with fixtures and cases for 7 control types, 16 runtime event types, 7 wrappers and the snapshot; the five drifted contracts corrected to today's output; producer and consumer tests on both sides.

**Independent Test**: every catalogue entry validates as labelled in the checker; every producer test validates real output strictly; every consumer test feeds every valid example through the real handler successfully.

### Drift corrections (PR 3) — producer tests first (SC-007)

- [ ] T030 [P] [US2] Go test, written first and failing on today's schema, in services/runtime/internal/devices/committed_test.go: project a reading with `installation_uuid`, `adapter_revision_uuid` and `manufacturer_serial` and assert it with `AssertProduced` against `telemetry.committed.v1`
- [ ] T031 [P] [US2] Go test, written first, in services/runtime/internal/devices/telemetry_contract_test.go: a `devices.Telemetry` for an adapter device with a `device-configuration.v2` definition, `generation`, `capture_id`, an `enum` reading and a `counter_event` validates strictly against contracts/devices/v1/telemetry.schema.json
- [ ] T032 [P] [US2] Laravel test, written first, in apps/api/tests/Feature/Domain/Devices/Contracts/DriftedControlMessageTest.php: outbox rows written by configure, rollback and resume (`device.activate.v1`) and by command confirmation with and without a session (`device.command.v1`) validate strictly; the definition of an adapter-backed device validates against configuration v2
- [ ] T033 [US2] Correct contracts/events/v1/telemetry-committed.schema.json: reading gains optional `installation_uuid` (uuid), `adapter_revision_uuid` (uuid), `manufacturer_serial` (string 1 to 128); add events/v1/telemetry-committed.cases.json with an adapter reading; keep the checker's negative checks
- [ ] T034 [US2] Correct contracts/devices/v1/telemetry.schema.json: required `generation` (integer ≥ 1), optional `capture_id`, `definition` oneOf configuration v1 or v2, reading gains the three provenance fields, optional `last_valid_received_at` (date-time) and `counter_event` (string), `data_type` adds `enum`; add cases
- [ ] T035 [US2] Correct contracts/devices/v1/activation.schema.json: payload gains required `organization_uuid`, `device_uuid`, `operation_uuid` (uuid); message gains optional `lease_token` (uuid); add `$id`; update the fixture and add cases
- [ ] T036 [US2] Correct contracts/devices/v1/command.schema.json: required `generation` (integer ≥ 1); `session_id` string (min length 1) or null; update fixture and cases
- [ ] T037 [US2] Correct contracts/devices/v1/configuration.schema.json and contracts/devices/v2/configuration.schema.json: optional closed `adapter {installation_uuid, adapter_uuid, manufacturer_serial}`; add cases with an adapter binding
- [ ] T038 [US2] Consumer tests for the corrected contracts in services/runtime/internal/app/contracts_drift_test.go (constitution IV): decode every new case of activation, command, configuration v1 and v2 (with adapter binding), internal telemetry and committed telemetry through the real decoders (`handleControl` payload decoding in services/runtime/internal/app/application.go, `storage.Decode` into `devices.Telemetry`, `devices.ParseProfile` for definitions, the committed consumer in services/runtime/cmd/committed-consumer and services/runtime/internal/committedconsumer, and the workflow evaluator decode in services/runtime/internal/app/rule_consumer.go) and assert they are handled as today
- [ ] T039 [US2] Confirm T030 to T032 now pass, record the before/after CI runs in the PR (SC-007), and update the payload schema references in docs/reference/events.md

### Control messages, wrappers and snapshot (PR 4)

- [ ] T040 [P] [US2] Write contracts/internal/common.schema.json: `$defs` for uuid, date-time, generation (integer ≥ 1), the control message shell `{uuid, type, payload, lease_token?}` and the runtime event shell `{uuid, type, payload}`
- [ ] T041 [P] [US2] Write control message schemas, fixtures and cases in contracts/internal/control/: device.deactivate.v1, device.command.v1 (payload `$ref` devices/v1/command), workflow.deploy.v1 (payload `$ref` rules/v1/deployment), workflow.deploy.v2 (definition `$ref` rules/v2/workflow), connection.changed.v1 (`connection_uuid`), settings.retention.changed.v1 (`scope`, `revision`), with payload fields as in data-model.md §7.1 and producer evidence in research §4.3
- [ ] T042 [P] [US2] Write wrapper schemas, fixtures and cases in contracts/internal/wrappers/ for the seven ids in data-model.md §7.3 (claim request empty object; claim response `data` at most 100 rows of `{uuid, type, payload, lease_token}`; ack request `lease_token` uuid; ack response `ok`; runtime event response `ok` with optional `duplicate`, `stale`, `ignored: "unknown_reference"`; automation check request `action_id` 64 lowercase hex and `command_uuid`; response `allowed`), documenting the 409 stale-lease and 422 outcomes in descriptions
- [ ] T043 [P] [US2] Write contracts/internal/state/internal.control-state.v1.schema.json with fixture and cases: `connections[]` (`uuid, organization_uuid, group_id, host_id, username, password` marked secret, `broker_url`), `devices[]` (`uuid, organization_uuid, generation, operation_uuid` nullable, `lifecycle, deployment_status, desired, applied` each configuration v1, v2 or null), `retention[]` (`organization_uuid, days, source, override_days, revision, platform_days, cutoff`); the fixture spans two organizations and uses `placeholder-` passwords
- [ ] T044 [US2] Register the control, wrapper and snapshot contracts in contracts/internal/catalogue.json with producer, consumer, dedup, fences, live-check location and test files (data-model.md §7.1 and §7.3)
- [ ] T045 [P] [US2] Laravel producer tests in apps/api/tests/Feature/Domain/Devices/Contracts/ControlMessageProducerTest.php: drive every control producer (activation, rollback, resume, deactivation, command, geofence deployment, DAG deployment, broker provisioning, retention change) and assert each outbox row strictly; assert the claim, ack, automation-check responses and `GET /api/internal/devices/state` strictly
- [ ] T046 [P] [US2] Runtime consumer tests in services/runtime/internal/app/contracts_control_test.go: feed every valid control fixture and case to the `devices-control` handler path (`handleControl`) and assert it is handled as today; assert a control message with an unsupported type (for example `device.activate.v9`) is still a permanent error that is dead-lettered (FR-031, SC-004); feed every valid wrapper and snapshot example through `ControlClient` decoding and `syncState` structures
- [ ] T047 [P] [US2] Runtime request-producer tests in services/runtime/internal/app/contracts_requests_test.go: capture the claim, ack, automation-check and events request bodies with an `httptest` server and assert them strictly

### Runtime events (PR 5)

- [ ] T048 [P] [US2] Write device, discovery and presence event schemas, fixtures and cases in contracts/internal/events/: connection.presence.v1, discovery.presence.v1, discovery.birth.v1, gateway.presence.v1, device.presence.v1, device.applied.v1, device.failed.v1, device.deactivated.v1, command.status.v1, runtime.heartbeat.v1, retention.cleanup.v1 (fields and optionality from the emitters in research §4.4, including the legacy outcomes re-emitted by `ReplayOutcome` in services/runtime/internal/storage/store.go:1124-1146, which omit `operation_uuid`; where emitter and handler differ, follow the emitter and say so in the description)
- [ ] T049 [P] [US2] Write workflow and automation event schemas, fixtures and cases in contracts/internal/events/: workflow.deployment.v1, workflow.suspended.v1, workflow.transition.v1 and workflow.membership.v1 (transition `$ref` rules/v1/transition), automation.intent.v1 (fields of `dag.Intent`)
- [ ] T050 [US2] Register the 16 event contracts in contracts/internal/catalogue.json (data-model.md §7.2)
- [ ] T051 [P] [US2] Runtime producer tests for store-emitted events in services/runtime/internal/storage/contracts_events_integration_test.go: trigger apply, fail, deactivate, command status, workflow deployment, suspension, transition, membership and intent, read `device_runtime.outbox` rows and assert each strictly
- [ ] T052 [P] [US2] Runtime producer tests for application-emitted events in services/runtime/internal/app/contracts_events_test.go: presence, discovery, gateway, connection, heartbeat and retention cleanup payloads assert strictly
- [ ] T053 [P] [US2] Laravel consumer tests in apps/api/tests/Feature/Domain/Devices/Contracts/RuntimeEventConsumerTest.php: post every valid fixture and case to `POST /api/internal/devices/events` (with the referenced records seeded) and assert the response and stored effects are as today; assert an unknown type is still refused with 422 (FR-031)

**Checkpoint**: US2 independently testable; all five drift cases corrected; catalogue has 31 internal entries.

---

## Phase 5: User Story 3 — Both sides prove conformance automatically and refuse unsupported versions (Priority: P3) — PRs 8 and 9

**Goal**: Coverage and compatibility checks that block merging; live log-and-count checks that never change processing.

**Independent Test**: the seeded-fault exercise catches every mutation (SC-003); in the rebuilt stack the simulators produce zero violations and one malformed heartbeat raises the count by exactly one with an unchanged response (SC-009).

### Coverage and compatibility (PR 8)

- [ ] T054 [P] [US3] Move control and runtime event type strings to constants in services/runtime/internal/devices/messages.go and use them in `handleControl` (services/runtime/internal/app/application.go) and every emitter; no behaviour change
- [ ] T055 [US3] Go coverage test in services/runtime/internal/devices/messages_test.go: constants equal the catalogue's control and event ids; an AST scan of services/runtime/internal finds no other string literal matching `^[a-z]+(\.[a-z_]+)+\.v[0-9]+$` used as a message type
- [ ] T056 [P] [US3] Move the accepted event list and the control types to apps/api/app/Domain/Devices/InternalMessageTypes.php and use it in `RuntimeController::event`; no behaviour change
- [ ] T057 [US3] Laravel coverage test in apps/api/tests/Feature/Domain/Devices/Contracts/ContractCoverageTest.php: `InternalMessageTypes` equals the catalogue; every `DeviceAudit::enqueue` call site in apps/api/app uses a catalogued type
- [ ] T058 [US3] Write compatibility checker tests first in tooling/contracts/test_compat.py, then implement tooling/contracts/compat.py: for each schema changed against `--base` (default `origin/main`), unless its id is new, all of the base's valid fixtures and cases still validate (tolerant mode for internal, strict for envelope), no property removed, no new required property, no enum value removed, no type or `const` change, no tightened limit; a changed schema whose fixture and cases are unchanged fails
- [ ] T059 [US3] Run compat.py in the `tooling` job of .github/workflows/ci.yml with `main` fetched (`git fetch --no-tags --depth=1 origin main`); confirm from the PR's CI run that the `tooling`, `api` and `runtime` jobs stay within their `timeout-minutes` (SC-008) and ask the owner to make them required status checks on `main` if they are not (FR-029)
- [ ] T060 [US3] Write tooling/contracts/seeded_faults.py: applies at least ten mutations in a scratch copy (drop a required property from a fixture, add an undeclared property to a producer example, rename a type in the catalogue, bump a version without a consumer, edit a schema without its examples, remove an enum value, tighten a limit, add a required field under the same id, break a `$ref`, drop a catalogue test file) and reports each as caught by the checker or compat; run it plus two manual producer mutations (remove `operation_uuid` from a Go emitter; remove `generation` from a Laravel outbox payload) and record all results in the PR (SC-003)

### Live log-and-count checks (PR 9)

- [ ] T061 [US3] Laravel tests first in apps/api/tests/Feature/Domain/Devices/Contracts/LiveContractCheckTest.php: every invalid runtime event case raises `contract_violations.count` for its id by exactly one and returns the same status and body as with checks off; an unknown property is ignored and not counted; an exception inside the validator is counted as a check failure and the request still succeeds as today; nothing is checked when `IOT_CONTRACT_CHECKS=off`
- [ ] T062 [P] [US3] Create the migration apps/api/database/migrations/2026_10_20_000000_create_contract_violations.php with columns from data-model.md §6 (`side` varchar(16), `contract` varchar(128), `count` bigint, `first_seen_at`, `last_seen_at` timestamptz, `last_message_id` uuid null, `last_locations` jsonb "up to 10 `{keyword, instance_location}`; never values"; primary key (`side`, `contract`))
- [ ] T063 [US3] Implement apps/api/app/Support/Contracts/ContractViolations.php (atomic upsert-increment; structured `contract.violation` and `contract.check_failed` warnings with side, contract, message id and at most ten locations, never values) and apps/api/app/Domain/Devices/Http/Middleware/CheckInternalContract.php (tolerant check of claim, ack, automation-check and events request bodies; skips unknown event types; catches every throwable)
- [ ] T064 [US3] Register the middleware on the `internal/devices` group in apps/api/app/Domain/Devices/routes/api.php after `AuthenticateDeviceRuntime`, and add `contract_checks` (`IOT_CONTRACT_CHECKS`, default `on`) to apps/api/config/devices.php
- [ ] T065 [P] [US3] Runtime tests first in services/runtime/internal/app/contracts_live_test.go: an invalid control message is counted once and handled exactly as today (same handler result and dead-letter behaviour); invalid claim, ack, events and automation-check responses are counted without changing the client's return; a snapshot check runs in the background, never delays `syncState`, and a second snapshot during a running check is counted as skipped; checks off when `IOT_CONTRACT_CHECKS=off`; a missing contracts root sets `enabled=false`
- [ ] T066 [US3] Implement the runtime live checker in services/runtime/internal/contracts/live.go (counters per contract id, check failures, skipped snapshots; structured slog warnings without values) and call it from `ControlClient.request` and the `devices-control` handler in services/runtime/internal/app/control.go and from `syncState` in services/runtime/internal/app/application.go
- [ ] T067 [US3] Add the `contracts` block (`enabled`, `violations_since_start`, `check_failures_since_start`, `snapshot_checks_skipped`) to `statusHTTP` in services/runtime/internal/app/http.go
- [ ] T068 [P] [US3] Export `iot_contract_violations_total{side,contract}` and `iot_contract_check_failures_total{side}` for both sides in apps/api/app/Support/Operations.php (runtime counts read from `/internal/status`; labels only from the catalogue, else `unknown`)
- [ ] T069 [P] [US3] Implement `php artisan devices:contract-violations` in apps/api/app/Console/Commands/ShowContractViolations.php (both sides; passes `php artisan help:validate`)
- [ ] T070 [P] [US3] Add `IOT_CONTRACT_CHECKS` to deploy/compose/compose.devices.yml, deploy/compose/compose.app.yml and deploy/release/environment.example
- [ ] T071 [US3] Document the checks, the switch, the status block, the metrics and the command in docs/ops/monitoring.md and docs/reference/events.md
- [ ] T072 [US3] Rebuild `api` and `runtime` (and the adapter overlay if enabled), run quickstart step C.5 (simulators through activation, command, deployment and deactivation → zero violations; malformed heartbeat → +1, unchanged response; telemetry shown as before) and step C.6 (overhead at most 5%), and record results in the PR (SC-005, SC-009, SC-010)

**Checkpoint**: US3 complete; CI blocks contract breakage; live checks visible and inert.

---

## Phase 6: Polish & Cross-Cutting Concerns — PR 10

- [ ] T073 [P] Update docs/architecture/overview.md "What was not built": the canonical envelope contract exists, but ingestion still accepts only Sparkplug
- [ ] T074 [P] Update docs/roadmap.md: remove "Typed runtime events" (done); add the follow-ups recorded in research §9 and the data-integrity defects (random telemetry ids, QoS 0, unretried hand-off, replay ids) under the ingestion spec
- [ ] T075 [P] Update contracts/README.md "Not contracts here" (canonical ingestion now has a contract; runtime read endpoints remain uncontracted, roadmap "typed runtime gateway")
- [ ] T076 Run quickstart.md sections A to C end to end on a clean checkout and fix any step that does not work as written

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (PR 1)** → **Foundational (PR 2)** → user stories.
- **US1** (PRs 6, 7): needs PR 1 for contracts and PR 2 for the reader's registry.
- **US2** (PRs 3, 4, 5): needs PR 2. PR 4's activation and command entries reuse PR 3's corrections.
- **US3**: PR 8 needs PRs 3, 4, 5 and 7 (coverage spans every contract); PR 9 needs PRs 3, 4 and 5 (zero violations requires the corrections and every internal contract).
- **Polish (PR 10)**: after all.

### Within phases

- Producer tests T030 to T032 before corrections T033 to T037 (SC-007).
- Reader tests T025 before reader code T026 to T028.
- Live-check tests T061 and T065 before T062 to T067.
- Checker tests T004 before T005; compat tests before compat code (T058).

### Parallel opportunities

- PR 1: T002, T003, T006, T007 in parallel after T001 starts.
- PR 2: T010 to T015 in parallel after T008 and T009.
- After PR 2: PRs 3, 4, 5 and 6 can run in parallel; within PR 4, T040 to T043 and T045 to T047; within PR 5, T048, T049 and T051 to T053.

## Parallel Example: User Story 2 (PR 5)

```bash
Task: "Write device, discovery and presence event schemas in contracts/internal/events/ (T048)"
Task: "Write workflow and automation event schemas in contracts/internal/events/ (T049)"
Task: "Runtime producer tests in services/runtime/internal/storage/contracts_events_integration_test.go (T051)"
Task: "Laravel consumer tests in apps/api/tests/Feature/Domain/Devices/Contracts/RuntimeEventConsumerTest.php (T053)"
```

## Implementation Strategy

### MVP (User Story 1)

1. PR 1 (Setup) and PR 2 (Foundational).
2. PRs 6 and 7 (US1): the envelope family and its reference reader.
3. Validate with quickstart C.1 and C.2. The next spec (canonical ingestion in the runtime) can start.

### Incremental delivery

1. US2 (PRs 3, 4, 5): drift fixed, every internal message contracted and tested.
2. US3 (PRs 8, 9): enforcement in CI, then live log-and-count checks with the rebuilt-stack verification.
3. PR 10: docs close-out and a full quickstart run.

## Notes

- Every task's file paths are relative to the repository root.
- No task changes a producer's output; T054 and T056 only move string constants.
- Commit after each task or logical group; stop at any checkpoint to validate the story.
