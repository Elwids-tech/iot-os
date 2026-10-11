# Implementation Plan: Public API Contract

**Branch**: `spec/001-openapi-contract` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-openapi-contract/spec.md`

## Summary

Produce `contracts/openapi/openapi.json`, an OpenAPI 3.1 description of the 18
integration operations and the 229 `api/v1` operations. Scramble generates it from the
Laravel routes and code; hand-written supplements describe what code cannot. Real
responses are checked against it in the existing PostgreSQL test suite. CI enforces it
with nine gates: export freshness, route inventory, a pending-schema ratchet, response
conformance and coverage, lint (including integer user ids), type freshness,
integration breaking changes with a reviewed-exception ledger, an `api/v1` breaking
report, and reference builds.

`openapi-typescript` generates the SDK's and the client library's types from Redocly
bundles of the contract, keeping both packages' public names and methods. The SDK
learns `automation.triggered.v1` and returns unknown event types as unknown events. Two
Redoc references are built: the integration one may be published; the `api/v1` one is
for developers only.

No endpoint changes behaviour. The work lands in nine pull requests of one to four days
each, about 19 to 24 engineer-days in total. The 155 `api/v1` operations whose bodies stay
pending are described afterwards in about six small follow-up pull requests. Decisions
and versions are in [research.md](research.md).

## Technical Context

**Language/Version**: PHP 8.4 on Laravel 13.35 (`apps/api`); TypeScript 5.9 on Node
22.23 with pnpm 11.19 (`packages/*`, `tooling/contract`); Go 1.27 (only to run oasdiff).

**Primary Dependencies** (all new, all dev-only, exact pins; see research R1 to R6):
`dedoc/scramble` 0.13.47, `opis/json-schema` 2.6.0, `symfony/yaml` 8.1.8 (made
explicit), `@redocly/cli` 2.54.3, `openapi-typescript` 7.13.0, `oasdiff` v1.32.1.

**Storage**: none. Repository files (contract, supplements, ledgers, generated types)
and CI-only files (coverage record, bundles, references).

**Testing**: PHPUnit 12.5 feature tests (PostgreSQL in CI, SQLite locally) with
automatic response checks; `node --test` for the SDK and the gate scripts; `tsc` type
checks for the client library, portal, admin and SDK.

**Target Platform**: GitHub Actions CI (`.github/workflows/ci.yml`) and developer
machines. Nothing new runs in production: the release image installs PHP dependencies
with `--no-dev`.

**Project Type**: monorepo with a web service (Laravel control plane) and two TypeScript
client libraries.

**Performance Goals**: export of the full contract in under 60 seconds; added CI
wall-clock under 3 minutes (SC-008), expected under 2.

**Constraints**: no change to any endpoint's behaviour, route list, headers or error
format (FR-033); no new route in any environment (Scramble's `/docs/api` is disabled);
generated files byte-stable across machines; exact tool pins.

**Scale/Scope**: 247 operations (92 fully described in this spec, 155 pending), about 880
JSON requests in the API suite, 194 client-library types and about 25 SDK types to
replace with aliases, 9 pull requests.

All Technical Context unknowns were resolved in [research.md](research.md); none remain
marked NEEDS CLARIFICATION.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate question for this feature | Before research | After design |
| --- | --- | --- | --- | --- |
| I | Laravel owns intent; Go executes | Does the contract describe only Laravel's public API, with no client talking to the runtime? | Pass: `/api/internal` excluded; runtime output is described only where Laravel passes it through, and marked `x-runtime-shaped`. | Pass |
| II | Immutable versions, explicit activation | Does anything change definition versioning or activation? | Pass (not affected) | Pass |
| III | Tenant isolation everywhere | Does it touch tenant data or weaken organization checks? | Pass: read-only description; integration 404 for another organization is verified for all 18 operations. | Pass: G2 checks `x-organization-scoped` on every organization route. |
| IV | Contracts first | Is there a versioned contract in `contracts/`, updated with consumers in the same pull request, with fixtures, and do consumers reject unsupported versions? | Pass: this feature creates the contract and its drift check. | Pass: examples validated by lint act as fixtures; generated types and the client library change in the same pull request; the SDK still rejects an unsupported `schema_version`. Returning an unknown event *type* inside v1 matches the contracts rule that additive changes stay within a version (research R9). |
| V | AI proposes, people approve | Any AI path? | Pass (not affected) | Pass |
| VI | Show uncertainty; never invent state | Does the contract claim shapes nobody checked? | Pass | Pass: pending operations get open bodies and `x-schema-status: pending` instead of inferred guesses (R7); nullable and runtime-shaped fields described as they are. |
| VII | Durable, idempotent messaging | Any messaging change? | Pass (not affected) | Pass: unknown event types no longer stop a consumer's cursor. |
| VIII | One design system | Any UI built outside `@iot-os/ui`? | Justified deviation | Justified deviation: the references are static Redoc pages, generated developer documentation rather than product UI (Complexity Tracking). |
| IX | Done means verified where it runs | CI on PostgreSQL, rebuilt containers, exercised in the running app? | Pass | Pass: each pull request lists its container rebuilds (api for PHP and contract changes, portal and admin for client-library types) and checks that the route list is unchanged and `/docs/api` is absent. |
| — | Decisions are ADRs | Is a lasting decision recorded? | Action | Pass: phase 1 adds ADR-015 (contract generated from Laravel, checked by tests, enforced in CI). |
| — | Small, reviewable changes | Can each pull request be reviewed alone? | Pass | Pass: nine pull requests, generated files kept separate from hand-written ones in each diff (Complexity Tracking: one spec, several pull requests). |

**Result**: passes, with two justified deviations in Complexity Tracking and owner
decisions listed below.

## Project Structure

### Documentation (this feature)

```text
specs/001-openapi-contract/
├── spec.md
├── plan.md              # this file
├── research.md          # tool decisions and versions
├── data-model.md        # repository files and their rules
├── quickstart.md        # developer workflow and validation scenarios
├── contracts/           # gate contract, x- vocabulary, file formats, SDK events
├── checklists/requirements.md
├── drift-log.md         # created in phase 2, filled through phase 8
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
apps/api/
├── app/Support/Contract/
│   ├── ContractServiceProvider.php     # registered only when Scramble is installed
│   ├── SecurityTransformer.php         # middleware → security, x-audience, x-abilities, limits, shared errors
│   ├── SupplementTransformer.php       # merges supplements, shared components, pending list
│   ├── PendingSchemas.php
│   ├── OpenSchema.php                  # "open schema" rule (contracts/ci-gate.md, G3)
│   └── Console/
│       ├── ExportContract.php          # contract:export [--check]
│       ├── CheckContract.php           # contract:check [--base=]
│       └── ContractCoverage.php        # contract:coverage
├── bootstrap/providers.php             # adds ContractServiceProvider (guarded)
├── config/scramble.php
└── tests/
    ├── TestCase.php                    # RequestHandled hook for response checks
    ├── Support/Contract/               # ContractDocument, ResponseChecker, CoverageRecorder, WithoutContractCheck
    └── Feature/Contract/               # RouteInventoryTest, IntegrationContractTest, ExportContractTest
contracts/openapi/
├── openapi.json                        # generated, committed
├── pending-schemas.json
├── breaking-exceptions.json
├── redocly.yaml                        # apis: integration, platform; lint rules
├── plugins/iot-rules.js                # iot/user-reference-integer
├── meta/                               # JSON Schemas for the three hand-edited formats
├── supplements/                        # info, shared, integration, account, platform-admin, administration, device-profiles
└── dist/                               # git-ignored: bundles and references
packages/integration-sdk/src/generated/contract.ts
packages/api-client/src/generated/contract.ts
tooling/contract/                       # breaking.mjs, types.mjs, tests and fixtures
.github/workflows/ci.yml                # API job steps; new Contract job
docs/adr/ADR-015-public-api-contract.md
```

**Structure Decision**: PHP pieces live in `apps/api/app/Support/Contract` because they
serve every domain (as `app/Support/Operations.php` does) and are dev tooling, not a
domain. Contract files sit beside the other cross-language contracts in `contracts/`.
Generated types live inside each consuming package so the SDK stays self-contained when
packed. Gate scripts join the other verification scripts under `tooling/`.

## Delivery: phases as pull requests

Each phase is one pull request, independently reviewable and green on its own. Sizes are
hand-written lines (generated files excluded) and engineer-days.

| # | Pull request | Stories / requirements | Depends on | Size |
| --- | --- | --- | --- | --- |
| 1 | **Contract skeleton and export check.** Half-day inference spike first. Scramble (dev) with routes limited to `api/v1` and `api/integration/v1`, default routes off; security transformer; shared components; `contract:export --check`; `contract:check`; route inventory test; `openapi.json` committed with all 247 operations pending; CI API job steps; ADR-015; `contracts/README.md` and `docs/reference/api.md` updated. | US2 (G1, G2, G3), FR-001 to FR-008, FR-018, FR-020 to FR-022 | — | M: ~900 lines, 2–3 days |
| 2 | **Response checks in the suite.** opis checker on `RequestHandled`; status checks for every operation; coverage recorder and `contract:coverage`; opt-out attribute; undocumented statuses found by the suite fixed in supplements; drift log started. | FR-019 (mechanism), G4 | 1 | M: ~600 lines, 2 days |
| 3 | **Integration API fully described.** `supplements/integration.yaml` (responses, abilities, rate limits, event envelope with 8 types, webhook, `$ref`s to location schemas, runtime-shaped marks, examples); data-driven 401/403/404/422 tests and 2xx gaps; 18 operations leave the pending list (247 → 229); rule "no integration operation pending" on; `info.version` 1.0.0; `docs/features/integrations.md` links the contract. | US1, FR-009 to FR-017, FR-019, SC-001 | 2 | L: ~1,300 lines, 3–4 days (can split reads / writes and events) |
| 4 | **Contract job: lint, bundles, breaking-change gate.** `redocly.yaml` with both APIs and lint rules; user-id plugin; `tooling/contract/breaking.mjs` with tests; exception ledger and SDK-version and `info.version` checks; `api/v1` report; `oasdiff` pin in `tooling/versions.env`; `./taskw contract:check`; seeded drift exercise run and recorded. | US2 (G5, G7, G8), FR-011, FR-023, FR-024, FR-032, SC-003, SC-007 | 1 (meaningful after 3) | M: ~700 lines, 2 days |
| 5 | **SDK on generated types (0.6.0).** `pnpm contract:types` for the SDK; aliases; `INTEGRATION_EVENT_TYPES`, `CONTRACT_VERSION`; unknown events in `events()` and `verifyWebhook()`; tests; README and release notes; roadmap item "SDK event types" closed; G6 for the SDK. | US4 (SDK), FR-025, FR-026, FR-029, SC-006 | 3, 4 | M: ~500 lines, 2 days |
| 6 | **Account, platform-admin and Administration operations (44).** Check inference, supplement hand-built bodies (notifications, retention, platform team), `x-permissions`; 2xx coverage; 44 leave the list (229 → 185). | US3 (part), FR-007, FR-019 | 2 | M: ~700 lines, 2–3 days |
| 7 | **Device-profile operations (30).** Mostly resource-backed; profile validation and draft-conflict error variants; artifacts; 30 leave the list (185 → 155). | US3 (rest), SC-002 | 2 | M: ~500 lines, 2 days |
| 8 | **Client library on generated types.** `pnpm contract:types` for the client library; aliases for the 74 operations' types and all request bodies; drift log; README; G6 for the client library; rebuild portal and admin and smoke-test. | US4 (client), FR-025, FR-027, SC-004 | 4, 6, 7 | M: ~600 lines, 2–3 days |
| 9 | **References and documentation.** `pnpm contract:docs`, G9, artefact upload; `dist/` ignored; `docs/architecture/overview.md`, `docs/roadmap.md` (OpenAPI item closed, follow-up domains listed), `docs/dev/specs.md`; SC-009 reviewer check; drift log closed. | US5, FR-030, FR-031 | 3, 4 | S: ~250 lines, 1 day |

Phases 6 and 7 can run in parallel with 3 to 5. **MVP**: phases 1 to 3 (an integration
contract checked on every pull request).

**After this spec** (follow-up pull requests, documenting existing behaviour only):
Devices 47 (two pull requests; includes the runtime-shaped telemetry captures),
Automation 42 (two; includes FR-028's 22 portal call sites), Device adapters 17,
Dashboards 13 with Help 3 and Overview 1, Assistant 12, Geospatial 10 with application
management 10. About 12 to 16 engineer-days.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Scramble infers less than assumed (helper-method validation, mapped collections) | More supplements; phases 3, 6 and 7 grow by up to a third | Spike in phase 1 measures it before the rest is sized; request parameters it misses are added with Scramble parameter attributes and caught by G4 failures |
| Generated output differs between machines or versions | G1 flaps | Exact pins; export normalises JSON formatting; CI's export is authoritative; generator upgrades get their own pull request |
| Response checks expose real bugs or doc errors | Pressure to "fix" behaviour | FR-033: record in the drift log, describe what the platform does, raise a separate issue; opt-outs need a reason and are counted |
| PostgreSQL and SQLite serialise some values differently (decimals, JSON key order) | Local and CI results differ | CI on PostgreSQL is authoritative; schemas describe what PostgreSQL returns; gotcha added to `docs/dev/gotchas.md` |
| Runtime fakes in tests drift from the real runtime | Runtime-shaped schemas checked against fiction | Use `contracts/` golden fixtures in fakes (location fix); telemetry captures stay pending until spec 002 gives them fixtures |
| oasdiff misreads external `$ref`s or 3.1 constructs | False breaking changes | Diff Redocly bundles (references inlined), not the raw file |
| CI time | SC-008 missed | Contract job runs in parallel; Go build cache for `go run`; export measured in phase 1 |

## Decisions the owner must make before implementation

1. **Approve the new dev dependencies.** `apps/api/AGENTS.md` says not to change the
   application's dependencies without approval: `dedoc/scramble`, `opis/json-schema` and
   an explicit `symfony/yaml` (PHP, dev), `@redocly/cli` and `openapi-typescript`
   (root dev dependencies), and `oasdiff` through `go run`.
2. **One spec across nine pull requests.** The workflow says a spec folder freezes when
   "its pull request" merges. Proposed: the folder stays open until phase 9 merges; each
   pull request ticks its tasks in `tasks.md`.
3. **Who reviews breaking-change exceptions.** Ordinary pull-request review (proposed
   default), or a `CODEOWNERS` entry for `contracts/openapi/breaking-exceptions.json` so
   a named owner must approve.
4. **Where the integration reference is published** (CI artefact only, a docs page, or a
   website). It doesn't block implementation: phase 9 produces the artefact either way.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Principle VIII: references rendered by Redoc, not `@iot-os/ui` | Generated, static developer documentation that must follow the contract exactly with no hand maintenance | Building a reference renderer from `@iot-os/ui` is weeks of work and a second thing to drift; the reference is not product UI and adds no route |
| Workflow: one spec delivered in nine pull requests (the folder freezes after the last) | "Small, reviewable changes": one pull request would mix tooling, ~250 operations of schemas, tests, two packages and CI | A single pull request would be unreviewable; separate specs per phase would split one outcome (an enforced contract) across specs that cannot stand alone |
