# Implementation Plan: Canonical Telemetry and Internal Event Contracts

**Branch**: `spec/002-canonical-ingestion` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-canonical-ingestion/spec.md` (clarified 2026-10-11)

## Summary

Define, as JSON Schema 2020-12 contracts with golden examples, (1) a canonical telemetry
envelope with companion source presence and source announcement messages and a
rejection diagnostic, read strictly, and (2) every message the Laravel control plane and
the Go runtime exchange today (7 control types, 16 runtime event types, 7 wrappers and
the `/state` snapshot), read tolerantly. Correct the five drifted contracts to describe
today's output without touching producers. Enforce the contracts in the PHP and Go test
suites and in CI (producer conformance, consumer handling, catalogue coverage, version
compatibility against `main`). Add live checks on both sides that only log and count
violations, exposed through the existing runtime status, the ops metrics endpoint and an
artisan command. A Go reference reader for the envelope is built and tested but wired
into nothing. No other runtime behaviour changes. Decisions are in
[research.md §10](research.md#10-decisions-plan-step-2026-10-11).

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13 (`apps/api`); Go 1.27 (`services/runtime`);
Python 3.12 (`tooling/`).

**Primary Dependencies**: new: `opis/json-schema` ^2.4 (PHP, runtime dependency, exact
patch locked) and `github.com/santhosh-tekuri/jsonschema/v6` v6.0.x (Go, runtime
dependency, exact version in `go.mod`); existing: Python `jsonschema` 4.26.0,
`google.golang.org/protobuf` for Sparkplug fixtures.

**Storage**: one new control-plane table `contract_violations` (bounded by the catalogue
size); runtime counters in memory. No runtime schema change.

**Testing**: PHPUnit feature tests on PostgreSQL/TimescaleDB (`php artisan test`);
`go test -count=1 -p 1 ./...` with the CI database and NATS; Python `unittest` and
`tooling/verify-devices-contracts.py` in the CI `tooling` job.

**Target Platform**: Docker Compose stack (development) and the single-node release;
API and runtime containers built from source.

**Project Type**: Monorepo: web service (control plane), data-plane service (runtime),
shared contracts and tooling.

**Performance Goals**: live checks add at most 5% to per-message handling time
(SC-010); the snapshot check never delays reconciliation (background, one in flight).

**Constraints**: no change to live behaviour apart from violation logging and counting
(FR-032); no producer changes to fix drift (FR-022); envelope not used on any live path
(FR-033); checks never refuse, retry, delay or alter a message (FR-031); startup never
fails because contracts are missing (research D5).

**Scale/Scope**: 35 catalogued contracts (4 envelope family, 7 control, 16 events, 7
wrappers, 1 snapshot; `device.activate.v1` is an existing schema, corrected) plus 5
corrected supporting schemas (command payload, internal telemetry, committed telemetry,
configuration v1 and v2), each with a fixture and a cases file; internal message rates
at most about 100 control rows per second.

## Constitution Check

*GATE: checked before Phase 0 research and re-checked after Phase 1 design.*

| Principle | Assessment | Result |
| --- | --- | --- |
| I. Laravel owns intent; Go executes | No new channel between the sides; Laravel still has no NATS client and ingests nothing; the envelope's consumer is the runtime (reference reader only); clients are untouched | Pass |
| II. Immutable versions, explicit activation | Contract ids are immutable; a breaking change is a new id (research D4); the envelope carries the immutable adapter revision | Pass |
| III. Tenant isolation everywhere | Organization and device identity exist only in the trusted context; an invalid case proves another organization's identity cannot be smuggled into content; violation logs and metrics carry no tenant data or values; `contract_violations` is platform-level and has no tenant route | Pass |
| IV. Contracts first | This feature is the contracts-first work for these boundaries; fixtures and both sides' tests change together; consumers keep refusing unsupported types; no public HTTP API change, so `packages/api-client` is untouched; internal contracts contain no user references | Pass |
| V. AI proposes, people approve | Not affected | Pass |
| VI. Show uncertainty; never invent state | Envelope quality, explicit "no value" with reason, presence `unknown`, receipt-time labelling; checks never fabricate or alter data | Pass |
| VII. Durable, idempotent messaging | Delivery, acknowledgement, retry and dead-letter paths unchanged; live checks cannot create poison loops because they never fail a message; the violation table is bounded; message identity rules for the envelope are deterministic | Pass |
| VIII. One design system | No UI change (operators use existing status, metrics and an artisan command) | Pass |
| IX. Done means verified where it runs | Each PR that changes an image (PR2, PR3 onwards copy contracts into both images; PR9 adds live checks) rebuilds `api` and `runtime` and runs the quickstart checks with the Sparkplug and vendor simulators; CI runs on PostgreSQL/TimescaleDB | Pass |
| Engineering constraints | Stack unchanged; two library dependencies added; the unknown-field policy and live checks are recorded in ADR-015 in the first PR (no accepted ADR is contradicted); no secrets in fixtures (placeholders enforced) | Pass |

**Post-design re-check (after data-model, contracts and quickstart)**: no new
violations. Two points to watch in review: the snapshot contract describes decrypted
broker passwords (examples must use placeholders, enforced by the checker), and the
runtime's in-memory counters reset on restart (documented; Prometheus counters
tolerate resets).

## Project Structure

### Documentation (this feature)

```text
specs/002-canonical-ingestion/
├── spec.md              # clarified specification
├── plan.md              # this file
├── research.md          # inventory (§1–9) and decisions (§10)
├── data-model.md        # envelope, trusted context, address, lifecycle, catalogue
├── quickstart.md        # add/change a message; end-to-end validation
├── contracts/           # layout and naming conventions, illustrative examples
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
contracts/
├── README.md                          # rules updated (tolerant internal, strict envelope, live checks)
├── devices/v1/{activation,command,telemetry,configuration}.schema.json   # corrected + cases
├── devices/v2/configuration.schema.json                                   # corrected + cases
├── events/v1/telemetry-committed.schema.json                              # corrected + cases
├── ingestion/v1/                      # NEW envelope family + catalogue.json + MAPPING.md
└── internal/                          # NEW catalogue.json, common, control/, events/, wrappers/, state/

tooling/
├── verify-devices-contracts.py        # generic walker, cases, catalogue and secret rules
└── contracts/
    ├── compat.py                      # compatibility against origin/main
    ├── seeded_faults.py               # SC-003 exercise
    └── test_*.py                      # unittest for the checker and compat rules

services/runtime/
├── go.mod, go.sum                     # + santhosh-tekuri/jsonschema/v6
└── internal/
    ├── contracts/                     # registry (catalogue + compiled schemas), strict/tolerant validate, live Checker
    │   └── contractstest/             # test helpers: AssertProduced, ConsumeCases
    ├── devices/messages.go            # control and runtime event type constants (no behaviour change)
    ├── ingestion/envelope/            # reference reader, types, identity, announcement hash (not wired)
    └── app/{control.go,application.go,http.go}   # live checks, snapshot checker, status block

apps/api/
├── composer.json, composer.lock       # + opis/json-schema
├── config/devices.php                 # contract_checks switch
├── app/Support/Contracts/             # ContractRegistry, ContractValidator, ContractViolations
├── app/Domain/Devices/InternalMessageTypes.php
├── app/Domain/Devices/Http/Middleware/CheckInternalContract.php
├── app/Domain/Devices/routes/api.php  # middleware on internal/devices
├── app/Console/Commands/ShowContractViolations.php   # devices:contract-violations
├── app/Support/Operations.php         # iot_contract_* metrics
├── database/migrations/…_create_contract_violations.php
└── tests/Feature/Contracts/           # producer, consumer, coverage, live-check tests

deploy/docker/runtime/Dockerfile       # COPY contracts /contracts; IOT_CONTRACTS_PATH
deploy/compose/*.yml, deploy/release/environment.example   # IOT_CONTRACT_CHECKS
.github/workflows/ci.yml               # tooling job: fetch main, compat, contract unittests
docs/adr/ADR-015-internal-contract-validation.md, docs/adr/README.md
docs/reference/events.md, docs/dev/testing.md, docs/ops/monitoring.md,
docs/architecture/overview.md, docs/roadmap.md
```

**Structure Decision**: Contracts stay in the top-level `contracts/` directory read
directly by every language (no generated package, per
[overview](../../docs/architecture/overview.md#what-was-not-built)). Validation code
lives in one small module per side (`internal/contracts`, `App\Support\Contracts`) so
both test helpers and live checks share it.

## Implementation Phases (pull-request sized)

Each PR keeps CI green, updates the docs it affects, and is verified per principle IX.
Sizes: S < 300 changed lines, M 300 to 800, L > 800 (JSON fixtures dominate the large
ones).

| PR | Title | Delivers | Depends on | Size |
| --- | --- | --- | --- | --- |
| 1 | Contract rules, catalogue and generic checker | ADR-015; `contracts/README.md` rules; empty `internal/` and `ingestion/v1/` catalogues; checker walks all schemas, validates fixtures and cases, enforces catalogue and secret rules; checker unit tests in CI | — | M |
| 2 | Validators and contract registries on both sides | Go `internal/contracts` (+ v6 dependency) and PHP `App\Support\Contracts` (+ opis) with strict and tolerant modes; both validate every existing fixture; runtime image copies contracts; no live wiring | 1 | M |
| 3 | Correct the drifted contracts | Producer tests that fail on the old schemas (SC-007), then the five corrections in research D7 with fixtures and cases | 2 | M |
| 4 | Control messages, wrappers and snapshot | 6 new control message schemas, 7 wrappers, the snapshot; catalogue entries; control-plane producer tests; runtime consumer and request-producer tests | 2 (3 for activation and command) | L |
| 5 | Runtime event contracts | 16 event schemas, fixtures, cases, catalogue entries; runtime producer tests; control-plane consumer tests. May split into 5a (device, discovery, presence, command, heartbeat, retention) and 5b (workflow and automation) | 2 | L |
| 6 | Canonical envelope family | `ingestion/v1` common definitions, envelope, presence, announcement, rejection; fixtures and cases including the [examples](contracts/examples); `MAPPING.md`; catalogue | 1 | M |
| 7 | Envelope reference reader | Go `internal/ingestion/envelope`: types, strict reader with rejection diagnostics, semantic rules, identity and hash functions; tests over every case | 2, 6 | M |
| 8 | Coverage and compatibility enforcement | Go type constants and AST coverage test; PHP type list and coverage test; `compat.py` against `origin/main` and the schema-without-examples rule in CI; seeded-fault exercise recorded | 3, 4, 5, 7 | M |
| 9 | Live log-and-count checks | Control-plane middleware, `contract_violations` table, metrics, artisan command, switch; runtime client, consumer and background snapshot checks, status block, switch; tests that outcomes are unchanged; rebuilt-stack verification (SC-009) and overhead measurement (SC-010) | 3, 4, 5 | L |
| 10 | Close-out | `docs/reference/events.md`, overview "what was not built", roadmap (typed runtime events done), testing guide; quickstart run end to end | all | S |

Priority order follows the spec: US1 (PRs 6 and 7 after 1 and 2) is the MVP; US2 is PRs
3 to 5; US3 is PRs 8 and 9. PRs 3 to 6 can proceed in parallel after PR 2.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A correction makes a field required that some producer path omits | Producer tests cover both producers of each message (for activation, configure, rollback and resume); fields only become required when every path sends them |
| Live check cost on large snapshots | Background check with one in flight, skips counted; `IOT_CONTRACT_CHECKS=off` switch |
| Tolerant filtering hides a real error inside `oneOf` | `oneOf` branches must be told apart by `const`; the checker enforces it |
| Runtime starts without contract files | Checks disable themselves (`contracts.enabled=false`), log once, never block startup |
| Log noise from a broken producer | One entry per violation at bounded internal rates; counts make the rate visible; the switch turns checks off |
| Version numbers chosen at planning time are stale | PR 2 confirms the newest patch at least two weeks old and records it exactly |

## Complexity Tracking

No constitution violations to justify.
