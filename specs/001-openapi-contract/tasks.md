---

description: "Task list for the public API contract (spec 001)"
---

# Tasks: Public API Contract

**Input**: Design documents from `/specs/001-openapi-contract/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. Checking real responses and failing CI on drift is the feature
(FR-018 to FR-024, SC-001 to SC-003), so test tasks are part of each story.

**Organization**: Tasks are grouped by user story. Each group names the pull request
(PR 1 to PR 9, see plan.md "Delivery") that carries it; PR order differs slightly from
story order (PR 5, the SDK half of US4, lands before PR 6 and PR 7 for US3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 to US5)
- Paths are repository-relative

## Before starting

The owner decisions in plan.md ("Decisions the owner must make") come first. The
dependency approval (decision 1) blocks T001, T023, T043 and T064.

---

## Phase 1: Setup (PR 1)

**Purpose**: Dependencies, directories and configuration

- [X] T001 Add exact-pinned dev dependencies `dedoc/scramble` `0.13.47` and `symfony/yaml` `^8.1` (locked at 8.1.8) to apps/api/composer.json and apps/api/composer.lock (PR 1 also adds `opis/json-schema` `2.6.0` from T023, because T010 and T013 validate files against the meta schemas)
- [X] T002 Create contracts/openapi/ with supplements/, meta/ and plugins/, and add `contracts/openapi/dist/` to .gitignore
- [X] T003 [P] Copy specs/001-openapi-contract/contracts/supplement.schema.json, pending-schemas.schema.json and breaking-exceptions.schema.json to contracts/openapi/meta/
- [X] T004 [P] Create apps/api/config/scramble.php: `api_path` `api`, a route resolver that keeps only `api/v1/*` and `api/integration/v1/*` (so `api/internal/*` is excluded), servers `[{url: "/api"}]`, title "IoT OS API"

---

## Phase 2: Foundational (PR 1, then PR 2)

**Purpose**: Export, inventory, ratchet and response checking. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### PR 1: export, inventory and ratchet

- [X] T005 Run the inference spike: export with the T004 config to a scratch path and record, for the 18 integration and 74 first `api/v1` operations, whether request parameters, statuses and bodies are inferred correctly (listing every validation rule Scramble misses, such as rules in helper methods), in a "R1 spike results" addendum to specs/001-openapi-contract/research.md; if more than half of the bodies need supplements, update the sizes in specs/001-openapi-contract/plan.md
- [X] T006 Create apps/api/app/Support/Contract/ContractServiceProvider.php, registered from apps/api/bootstrap/providers.php only when `class_exists(\Dedoc\Scramble\Scramble::class)`; it calls `Scramble::ignoreDefaultRoutes()` and registers the transformers and the `contract:*` commands
- [X] T007 Implement apps/api/app/Support/Contract/SecurityTransformer.php: map route middleware to `security` (`auth:sanctum` → `session`, `AuthenticateApplication:<ability>` → `applicationToken`, neither → `[]`), `x-audience`, `x-abilities.all`, `x-organization-scoped`, `x-platform-permission` (from `can:`), `x-rate-limits` (from `ThrottleRequests` and named limiters), and `$ref`s to the shared 401, 403, 404, 419 and 429 responses, as defined in specs/001-openapi-contract/contracts/openapi-extensions.md
- [X] T008 [P] Write contracts/openapi/supplements/shared.yaml: the `session` and `applicationToken` scheme descriptions (including the `GET /sanctum/csrf-cookie` bootstrap and "ignored session cookies and user tokens" on integration routes), schemas `ErrorMessage`, `ValidationError` (including the `runtime` field), `ProfileValidationError` (`diagnostics`), `DraftConflictError` (`code: profile.draft_conflict`), `CompactPage` (`meta: {current_page, last_page, total}`), `ResourcePage` (full metadata with links), and responses `Unauthenticated` 401, `CsrfExpired` 419, `Forbidden` 403, `NotFound` 404, `Conflict` 409, `ValidationFailed` 422, `TooManyRequests` 429 with a `Retry-After` header, `RuntimeUnavailable` 503 and `RangeTimeout` 504
- [X] T009 [P] Write contracts/openapi/supplements/info.yaml with `info.version: 1.0.0` ("`1.MINOR.PATCH`, the integration API version")
- [X] T010 Implement apps/api/app/Support/Contract/SupplementTransformer.php: validate each supplement against contracts/openapi/meta/supplement.schema.json, merge components, patch operations keyed `METHOD /path` ("a key must match a generated operation (otherwise the export fails)"), add webhooks, and apply the pending list (open success bodies plus `x-schema-status: pending`)
- [X] T011 [P] Implement apps/api/app/Support/Contract/PendingSchemas.php and apps/api/app/Support/Contract/OpenSchema.php, with the open-schema definition from specs/001-openapi-contract/contracts/ci-gate.md (G3)
- [X] T012 Implement `contract:export [--check]` in apps/api/app/Support/Contract/Console/ExportContract.php: stable pretty-printed JSON (two-space indent, unescaped slashes and Unicode, trailing newline) written to contracts/openapi/openapi.json; `--check` lists added, removed and changed operations and components and exits 1 on any difference
- [X] T013 Implement `contract:check [--base=]` in apps/api/app/Support/Contract/Console/CheckContract.php with the G3 rules from contracts/ci-gate.md: unlisted operation with an open schema; listed operation missing or closed; more entries than the base branch's list; list "sorted, unique"; and "no integration operation after phase 3" behind a config flag that starts off. Validate pending-schemas.json against contracts/openapi/meta/pending-schemas.schema.json
- [X] T014 Create contracts/openapi/pending-schemas.json with all 247 in-scope operations, sorted, each with its domain ("247 entries in phase 1")
- [X] T015 Run `php artisan contract:export` and commit contracts/openapi/openapi.json
- [X] T016 [P] Write apps/api/tests/Feature/Contract/RouteInventoryTest.php covering every G2 rule in contracts/ci-gate.md (missing operation, orphaned operation, security mismatch, ability mismatch, missing `x-organization-scoped`, out-of-scope path present)
- [X] T017 [P] Write apps/api/tests/Feature/Contract/ExportContractTest.php: two exports are byte-identical; an unknown supplement key fails; no `/internal/` path is exported; Scramble's `/docs/api` route is not registered
- [X] T018 Add steps to the API job in .github/workflows/ci.yml before the test run: `git fetch --depth=1 origin main`, `php artisan contract:export --check`, `php artisan contract:check --base=origin/main`
- [X] T019 [P] Write docs/adr/ADR-016-public-api-contract.md (contract generated from Laravel with supplements, checked by tests, enforced in CI) and list it in docs/adr/README.md
- [X] T020 [P] Update contracts/README.md (add the `openapi` row; remove "Public HTTP API" from "Not contracts here") and docs/reference/api.md (the contract exists, where it lives, how to change it, link to the quickstart)
- [X] T021 [P] Add to docs/dev/gotchas.md: generator pins change output and upgrades need their own pull request; never edit openapi.json by hand; PostgreSQL and SQLite serialise some values differently
- [X] T022 Verify PR 1: `php artisan route:list --json --path=api` gives the same `api/v1` and `api/integration/v1` routes as main; rebuild `api` following .agents/skills/local-container-verification/SKILL.md; confirm `/docs/api` returns 404 and portal sign-in still works

### PR 2: response checks in the suite

- [X] T023 Add the exact-pinned dev dependency `opis/json-schema` `2.6.0` to apps/api/composer.json and apps/api/composer.lock (already added in PR 1, see T001)
- [X] T024 Implement apps/api/tests/Support/Contract/ContractDocument.php: load contracts/openapi/openapi.json, index operations by method and URI template, and resolve internal and `../` `$ref`s through an opis loader rooted at contracts/
- [X] T025 Implement apps/api/tests/Support/Contract/ResponseChecker.php: status documented; for non-pending operations the JSON body validates and documented required headers are present; failure message in the G4 format from contracts/ci-gate.md
- [X] T026 [P] Implement apps/api/tests/Support/Contract/CoverageRecorder.php and the `#[WithoutContractCheck('reason')]` attribute in apps/api/tests/Support/Contract/WithoutContractCheck.php; the recorder appends `{operation, status, test}` and skipped `{test, reason}` to apps/api/storage/framework/testing/contract-coverage.json (git-ignored)
- [X] T027 Hook the checker into apps/api/tests/TestCase.php: listen for `RequestHandled` during each test, check in-scope routes only, honour the attribute
- [X] T028 Implement `contract:coverage` in apps/api/app/Support/Contract/Console/ContractCoverage.php with the required pairs from research R8 ("every integration operation: one 2xx, 401, 403 and 404, plus 422 when it has a request body or a required query parameter"; "every fully described `api/v1` operation: one 2xx"); integration requirements behind a flag that starts off
- [X] T029 Run the suite on PostgreSQL; add every undocumented status the suite produces to the matching supplement; create specs/001-openapi-contract/drift-log.md with the columns Operation, Source, Discrepancy, Resolution, Pull request and record what was found
- [X] T030 Add `php artisan contract:coverage` after `php artisan test --compact` in the API job of .github/workflows/ci.yml
- [X] T031 Verify PR 2: the suite passes on PostgreSQL in CI and on SQLite locally; rebuild `api`

**Checkpoint**: Export, inventory, ratchet and response checks run in CI with all 247 operations pending.

---

## Phase 3: User Story 1 - Integration API contract that matches the platform (Priority: P1) 🎯 MVP — PR 3

**Goal**: All 18 integration operations fully described and checked on every pull request.

**Independent Test**: quickstart.md B1: the contract, integration and geospatial tests then `php artisan contract:coverage` pass, and coverage lists a 2xx, 401, 403 and 404 (plus 422 where there is input) for all 18 operations.

- [X] T032 [P] [US1] Add integration payload components to contracts/openapi/supplements/integration.yaml: `IntegrationDevice`, `IntegrationAlert` (`episode` integer ≥ 1, `condition` `active`|`cleared`), `TelemetryLatest` (`telemetry-latest.v1`), `TelemetryHistory` (`telemetry-history.v1`), `TelemetryRecords` (`telemetry-records.v1` with its `meta` fields), `LocationBindingVersion` (`{version_uuid, binding: $ref ../location/v1/binding.schema.json}`) and the `IntegrationAbility` enum of 8 values; objects allow additional properties (FR-017)
- [X] T033 [P] [US1] Add event components to contracts/openapi/supplements/integration-events.yaml: `IntegrationEvent` (envelope with `type` enum of the 8 types and per-type `data`: alert snapshot, geofence event, `automation.triggered.v1` `{workflow_uuid, action_id, name, node_id}`), `EventPage` (`{data, next_cursor, has_more}`), `EventCheckpoint`, and the `GrantChanged` 409 response
- [X] T034 [US1] Patch the 14 integration read operations in contracts/openapi/supplements/integration.yaml: responses, summaries, `x-abilities.any_of` for `GET events` and `GET events/checkpoint`, the `Cache-Control: no-store` header, cursor and limit bounds, examples; check each operation's request parameters against its validation and, where Scramble misses one, add a Scramble parameter attribute in the controller plus a 422 case in T037
- [X] T035 [US1] Patch the 4 integration write operations and the location fix in contracts/openapi/supplements/integration.yaml: location-map query (device entries `x-runtime-shaped`); geofence create and update (202 `{data, activation}`, `x-abilities.all: [geofences:activate, geofences:manage]`, `x-async` polling the activation, `x-concurrency: expected_revision`); activation item retry; location fix (`data` `$ref ../location/v1/fix.schema.json`, `x-runtime-shaped`); check request parameters as in T034
- [X] T036 [US1] Add `webhooks.integrationEvent` to contracts/openapi/supplements/integration-events.yaml: headers `X-Iot-Delivery-Id`, `X-Iot-Timestamp` and `X-Iot-Signature: v1=<hex>`, body `IntegrationEvent`, retry and ordering rules in the description, `x-audience: integration`
- [X] T037 [US1] Write apps/api/tests/Feature/Contract/IntegrationContractTest.php: data providers over the 18 operations for 401 (no token), 403 (token without the ability, including both compound rules), 404 (another organization) and 422 for operations with input
- [X] T038 [US1] Fill the 2xx gaps that `contract:coverage` reports, in apps/api/tests/Feature/Domain/Integrations/*Test.php and apps/api/tests/Feature/Domain/Geospatial/GeofenceTest.php; location-fix runtime fakes use contracts/location/v1/fix.fixture.json
- [X] T039 [US1] Remove the 18 integration operations from contracts/openapi/pending-schemas.json (247 → 229), turn on the T013 and T028 integration flags, re-export contracts/openapi/openapi.json
- [X] T040 [US1] Record integration discrepancies (docs, SDK types, inference) in specs/001-openapi-contract/drift-log.md
- [X] T041 [P] [US1] Update docs/features/integrations.md to name the contract as the authority for the integration API and link it
- [ ] T042 [US1] Verify PR 3: quickstart.md B1 passes; rebuild `api`

**Checkpoint**: MVP. The integration contract is complete and enforced.

---

## Phase 4: User Story 2 - A pull request that changes the API without the contract fails (Priority: P2) — PR 4

**Goal**: Lint, the user-id rule, audience bundles, the integration breaking-change gate with its exception ledger, and the `api/v1` report.

**Independent Test**: quickstart.md B2: each of the 10 seeded changes fails with a line naming the operation; the excused break passes.

- [ ] T043 [US2] Add the exact-pinned root devDependency `@redocly/cli` `2.54.3` to package.json and pnpm-lock.yaml, with root scripts `contract:lint` and `contract:bundle`
- [ ] T044 [US2] Write contracts/openapi/redocly.yaml: API `integration` (`filter-in` with `applyTo: Operation`, `property: x-audience`, `value: [integration]`, plus `remove-unused-components`) and API `platform`; lint extends `recommended` with tuned rules and `no-invalid-media-type-examples`
- [ ] T045 [P] [US2] Write the lint rule `iot/user-reference-integer` in contracts/openapi/plugins/iot-rules.js (properties named `user_id`, `user_ids`, `recipient_ids`, `member_id`, matching `^(acknowledged|created|assigned|updated|decided|invited|requested)_(by|to)$`, or marked `x-user-reference: true` must be integers or integer arrays, nullable allowed), with fixture tests in tooling/contract/test/user-reference.test.mjs
- [ ] T046 [US2] Implement tooling/contract/breaking.mjs as specified for G7 and G8 in specs/001-openapi-contract/contracts/ci-gate.md: build base and head bundles, run `go run github.com/oasdiff/oasdiff@v1.32.1 breaking --fail-on ERR --format json`, match changes only against exception entries added in this pull request, require the SDK version to be "higher than on the base branch and equal to sdk_version", require an `info.version` change when the integration changelog is not empty, write a job summary, support `--report-only`
- [ ] T047 [P] [US2] Create contracts/openapi/breaking-exceptions.json as `{"exceptions": []}`, valid against contracts/openapi/meta/breaking-exceptions.schema.json
- [ ] T048 [P] [US2] Write tooling/contract/test/breaking.test.mjs with fixture specs: an unexcused break fails; an excused break with an SDK bump passes; an excused break without a bump fails; an added exception that matches nothing fails; an additive change without an `info.version` bump fails
- [ ] T049 [US2] Add `OASDIFF_VERSION=1.32.1` to tooling/versions.env and a `contract:check` task to Taskfile.yml that runs G1, G3, G5, G6 and G7
- [ ] T050 [US2] Add a Contract job to .github/workflows/ci.yml: setup-node, pnpm install, setup-go with cache, `git fetch --depth=1 origin main`, `pnpm contract:lint`, `node tooling/contract/breaking.mjs integration --base origin/main`, `node tooling/contract/breaking.mjs platform --base origin/main --report-only`, `node --test tooling/contract/test/`
- [ ] T051 [US2] Run the seeded drift exercise in quickstart.md B2 in a scratch branch (10 changes plus the excused break) and record the results in the pull request description; correct quickstart.md where a different gate fires
- [ ] T052 [US2] Verify PR 4: compare CI wall-clock with main (SC-008: no more than 3 minutes added)
- [ ] T053 [US2] Verify PR 4 containers: the root package.json and pnpm-lock.yaml changed, so rebuild `portal` and `admin` (their images install from them) following .agents/skills/local-container-verification/SKILL.md and load each app's home page

**Checkpoint**: Every gate except G6 and G9 is live.

---

## Phase 5: User Story 3 - Tenant and administration API described and verified (Priority: P2) — PR 6 and PR 7

**Goal**: The 74 first `api/v1` operations fully described; the other 155 stay in the checked inventory.

**Independent Test**: quickstart.md B3: `php artisan contract:check` and `RouteInventoryTest` pass, coverage shows a 2xx for all 74, and `pending-schemas.json` has 155 entries.

### PR 6: account, platform administration and Administration (44 operations)

- [ ] T054 [US3] Review the inferred schemas of the 11 account and public operations and supplement them in contracts/openapi/supplements/account.yaml (integer `id` in `GET /v1/me`; unit catalogue example taken from contracts/units/v1/units.json; notification preferences and events); check request parameters as in T034; at least one example per success response
- [ ] T055 [US3] Review and supplement the 19 platform-administration operations in contracts/openapi/supplements/platform-admin.yaml (`x-platform-permission` for the two platform-team operations that check inside the operation; telemetry-retention bodies); check request parameters as in T034; at least one example per success response
- [ ] T056 [US3] Review and supplement the 13 Administration organization operations and the organization context in contracts/openapi/supplements/administration.yaml, with `x-permissions` on each; check request parameters as in T034; at least one example per success response
- [ ] T057 [US3] Fill the 2xx gaps that `contract:coverage` reports in apps/api/tests/Feature/Domain/Authentication, Administration, Authorization and Notifications tests
- [ ] T058 [US3] Remove the 44 operations from contracts/openapi/pending-schemas.json (229 → 185), re-export, record discrepancies in specs/001-openapi-contract/drift-log.md
- [ ] T059 [US3] Verify PR 6: rebuild `api`

### PR 7: Device profiles (30 operations)

- [ ] T060 [US3] Review and supplement the 30 Device-profile operations in contracts/openapi/supplements/device-profiles.yaml: 422 `ProfileValidationError`, 409 `DraftConflictError`, `x-concurrency: draft_revision`, `x-permissions`; check request parameters as in T034; at least one example per success response
- [ ] T061 [US3] Fill the 2xx gaps that `contract:coverage` reports in apps/api/tests/Feature/Domain/DeviceProfiles/
- [ ] T062 [US3] Remove the 30 operations from contracts/openapi/pending-schemas.json (185 → 155), check the remaining entries match FR-019a by domain (Devices 47, Automation 42, Device adapters 17, Dashboards 13, Assistant 12, Geospatial 10, application management 10, Help 3, Overview 1), re-export, update the drift log
- [ ] T063 [US3] Verify PR 7: quickstart.md B3 passes; rebuild `api`

**Checkpoint**: Contract scope of this spec complete (92 fully described, 155 pending).

---

## Phase 6: User Story 4 - Client libraries use types generated from the contract (Priority: P3) — PR 5 and PR 8

**Goal**: The SDK and client library take their types from the contract; the SDK accepts `automation.triggered.v1` and returns unknown types as unknown events.

**Independent Test**: quickstart.md B4: types are fresh, the client library, portal and admin type-check, and the SDK and vertical-demo tests pass, including the known and unknown event cases.

### PR 5: SDK 0.6.0 (needs US1 and US2)

- [ ] T064 [US4] Add the exact-pinned root devDependency `openapi-typescript` `7.13.0`; implement tooling/contract/types.mjs (bundle with Redocly, then generate with `--root-types --enum-values`; header with `info.version` and bundle SHA-256; `CONTRACT_VERSION` export; `--check` mode) writing packages/integration-sdk/src/generated/contract.ts; add root scripts `contract:types`
- [ ] T065 [US4] Replace the hand-written payload interfaces in packages/integration-sdk/src/index.ts with aliases of the generated types, keeping every exported name
- [ ] T066 [US4] Implement the event behaviour table in specs/001-openapi-contract/contracts/sdk-events.md in packages/integration-sdk/src/index.ts: known types from `INTEGRATION_EVENT_TYPES`, `UnknownIntegrationEvent` (`type: "unknown"`, `event_type`, `data: unknown`) from both `events()` and `verifyWebhook()`, `IotContractError` still for an unsupported `schema_version` or a bad envelope
- [ ] T067 [P] [US4] Add tests in packages/integration-sdk/test/events.test.mjs: `automation.triggered.v1` typed; `example.future.v1` returned as unknown from the feed and from a verified webhook; unsupported `schema_version` rejected; known type with invalid `data` rejected
- [ ] T068 [US4] Bump packages/integration-sdk/package.json to `0.6.0`; document unknown events and `CONTRACT_VERSION` in packages/integration-sdk/README.md; update docs/features/integrations.md and docs/reference/events.md (the SDK accepts `automation.triggered.v1`); remove the "SDK event types" item from docs/roadmap.md
- [ ] T069 [US4] Add `pnpm contract:types --check` to the Contract job in .github/workflows/ci.yml; run the integration-sdk and vertical-demo tests
- [ ] T070 [US4] Verify PR 5 containers: rebuild `portal` and `admin` (lockfile changed), build deploy/docker/vertical-demo/Dockerfile and run tooling/verify-vertical-demo.mjs against the local stack

### PR 8: client library (needs US2 and US3)

- [ ] T071 [US4] Extend tooling/contract/types.mjs to write packages/api-client/src/generated/contract.ts from the `platform` bundle
- [ ] T072 [US4] Alias the client-library types for the 74 fully described operations' responses and for all request bodies in packages/api-client/src/index.ts and its domain modules, keeping exported names and method signatures; leave pending operations' types hand-written
- [ ] T073 [US4] Fix compile errors at call sites only where a hand-written type was wrong against real responses; record each in specs/001-openapi-contract/drift-log.md
- [ ] T074 [P] [US4] Update packages/api-client/README.md: types come from the contract; how to regenerate them
- [ ] T075 [US4] Run `pnpm --filter @iot-os/api-client typecheck`, then `lint` and `build` for `@iot-os/portal` and `@iot-os/admin`; confirm the Contract job's type-freshness step covers both packages
- [ ] T076 [US4] Verify PR 8: rebuild `portal` and `admin`; load the portal's devices, alerts and dashboards pages and the admin's organizations page with no console errors

**Checkpoint**: Both packages use generated types.

---

## Phase 7: User Story 5 - Published API reference (Priority: P4) — PR 9

**Goal**: An integration reference that may be published and an unpublished `api/v1` reference for developers.

**Independent Test**: quickstart.md B5: both references build; the integration one has the 18 operations and no `/v1/` path.

- [ ] T077 [US5] Add the root script `contract:docs`, building contracts/openapi/dist/integration-reference.html and contracts/openapi/dist/platform-reference.html with `redocly build-docs`
- [ ] T078 [US5] Add G9 to the Contract job in .github/workflows/ci.yml: build both, fail if the integration reference contains a `/v1/` path, upload `integration-reference` and `platform-reference` (14-day retention, never published) as workflow artefacts
- [ ] T079 [US5] SC-009: ask a reviewer outside the API work to find the abilities, parameters, errors and rate limits of three integration operations, including the event feed, using only the integration reference; record the outcome in the pull request

---

## Phase 8: Polish & Cross-Cutting Concerns (PR 9)

- [ ] T080 [P] Update docs/architecture/overview.md (remove "OpenAPI" from "What was not built"), docs/dev/specs.md (the first spec is done) and docs/roadmap.md (close the OpenAPI item; list the follow-up domain pull requests with operation counts)
- [ ] T081 Run every scenario in specs/001-openapi-contract/quickstart.md (B1 to B6) and record the results in the pull request
- [ ] T082 Close specs/001-openapi-contract/drift-log.md with a summary and tick all tasks in this file
- [ ] T083 Verify PR 9 containers: root package.json scripts changed, so rebuild `portal` and `admin` and load each app's home page

---

## Dependencies & Execution Order

### Pull-request order

```text
PR1 (Setup + Foundational part 1) ──▶ PR2 (Foundational part 2) ──▶ PR3 (US1) ──▶ PR4 (US2) ──▶ PR5 (US4 SDK) ──▶ PR9 (US5 + Polish)
                                              └──▶ PR6 (US3) ──▶ PR7 (US3) ─────────────────────────▶ PR8 (US4 client; needs PR4)
```

### Phase Dependencies

- **Setup (Phase 1)** and **Foundational (Phase 2)** block everything.
- **US1** needs Phase 2.
- **US2** needs Phase 2; its breaking-change gate is meaningful once US1 has described the integration API.
- **US3** needs Phase 2 only, so it can run in parallel with US1 and US2.
- **US4**: the SDK part needs US1 and US2 (bundles); the client part needs US2 and US3.
- **US5** needs US2 (Redocly config) and US1.
- **Polish** comes last.

### Within each story

- Supplements and components before patches that reference them (T032, T033 before T034 to T036).
- Coverage tests before removing operations from the pending list (T037, T038 before T039).
- Exported contract committed in the same pull request as its supplements.

### Parallel Opportunities

- T003 and T004; T008, T009 and T011; T016, T017, T019, T020 and T021.
- T032 and T033 (separate supplement files).
- T045, T047 and T048.
- Phases 5 (US3) and 3 to 4 (US1, US2) by different people.

---

## Parallel Example: User Story 1

```bash
Task: "Add integration payload components to contracts/openapi/supplements/integration.yaml (T032)"
Task: "Add event components to contracts/openapi/supplements/integration-events.yaml (T033)"
Task: "Update docs/features/integrations.md to name the contract as the authority (T041)"
```

## Parallel Example: User Story 3

```bash
Task: "Supplement the 11 account and public operations (T054)"
Task: "Supplement the 19 platform-administration operations (T055)"
Task: "Supplement the 13 Administration operations and the organization context (T056)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. PR 1 and PR 2: Setup and Foundational. Every operation is in the inventory and the
   ratchet, and responses are status-checked.
2. PR 3: User Story 1. Stop and validate with quickstart.md B1. This is the first
   contract integrators can rely on.

### Incremental Delivery

3. PR 4 (US2): full drift gate.
4. PR 5 (US4, SDK): SDK 0.6.0 on generated types.
5. PR 6 and PR 7 (US3): the 74 `api/v1` operations.
6. PR 8 (US4, client): client library on generated types.
7. PR 9 (US5 and Polish): references and documentation.

### After this spec

The 155 pending operations are described domain by domain in follow-up pull requests
(listed in plan.md); each removes its entries from `pending-schemas.json`, adds its
supplements and coverage, and, for Automation, types the portal's generic call path
(FR-028).

---

## Notes

- Every pull request rebuilds the containers its change affects (constitution IX) and
  leaves the in-scope route list unchanged (FR-033).
- Generated files (`openapi.json`, `generated/contract.ts`) change only through their
  commands; reviewers read the supplements and code.
- A discrepancy between the platform and a document or type is fixed in the contract or
  type, never the platform; platform bugs go to a separate issue (FR-033).
