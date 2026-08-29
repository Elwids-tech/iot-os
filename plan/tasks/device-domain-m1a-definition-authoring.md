# Device Domain M1a Definition Authoring and Registration

**Status:** M1a-D4R3 complete; dynamic tenant authoring UI pending
**Last updated:** 2026-08-29  
**Parent:** [Device Domain M1a](./device-domain-m1a.md)  
**Decisions:** [ADR-013](../decisions/ADR-013-logical-devices-stable-parameters-and-gateway-routing.md), [ADR-014](../decisions/ADR-014-pre-production-device-domain-canonical-cutover.md)

## Outcome

Deliver a clean, API-first Device Domain for dynamically defining telemetry, properties, events, and Commands; mapping manufacturer MQTT payloads; routing one authenticated Gateway to one or more logical Devices; and registering Devices against an exact compiled Runtime Bundle.

The guided CRUD and onboarding experience must be correct before AI/MCP onboarding resumes. This milestone stops before live broker credentials, ingestion, time-series writes, command delivery, bulk onboarding, Sparkplug, and admin-managed templates.

## Locked model

- A Gateway is the authenticated MQTT communication identity.
- A Device is a tenant-owned logical identity independent of physical packaging.
- A Gateway Route links one Gateway to one Device and supplies route path, topic variables, and inbound selectors.
- A Device Profile dynamically defines measured parameters, derived parameters, properties, events, and Commands.
- Every measured and derived parameter has a stable UUID used for canonical telemetry and time-series identity.
- A Native MQTT Binding targets an exact Profile Version and owns topics, JSONPath extraction, calibration, invalid/missing behavior, Command encoding, correlation, and response extraction.
- Calibration runs before same-Device derivation. Cross-Device calculations belong to a later calculated-Device model.
- Labels, units, constraints, presentation hints, formulas, and required markers are metadata; they are not copied into MQTT payloads.
- Published Profile and Binding Versions are immutable. Compatible Profile clones preserve parameter UUIDs; semantic replacements receive new UUIDs.
- Laravel owns public APIs, tenancy, authorization, persistence, and publication intent. Go owns deterministic compilation and later runtime execution.

## Pre-production cutover rules

- The corrected model is the only Device Domain.
- Public JSON Schema and OpenAPI identities use the first canonical `v1` contract.
- Internal PHP, Go, and TypeScript names are unversioned.
- There are no compatibility aliases, duplicate APIs, or compatibility-only database columns.
- Fresh disposable databases are used for migration verification. The persistent developer database is not reset automatically.
- Git history, not runtime compatibility code, retains rejected implementations.

## Milestones

| Milestone | Deliverable | Status |
| --- | --- | --- |
| M1a-D4R0 | Corrected identity, routing, stable-parameter, and cutover decisions | Complete |
| M1a-D4R1 | Canonical JSON Schemas, OpenAPI, fixtures, generated types, and vocabulary checks | Complete |
| M1a-D4R2 | Canonical Laravel persistence, DDD services, DTOs, policies, ETags, and CRUD APIs | Complete |
| M1a-D4R3 | Route-aware Go compiler and immutable Runtime Bundle | Complete |
| M1a-D4R4 | Dynamic tenant authoring and Gateway-routed Device onboarding UI | Pending |
| M1a-D4R5 | End-to-end local acceptance, browser verification, and handoff | Pending |
| M1a-D5 | Laravel AI chat and authenticated Laravel MCP server | Blocked by D4R3-D4R5 |
| M1a-D6 | Security, observability, idempotency, and operational hardening | Pending |

Each milestone must be independently reviewable and committed. Evidence must distinguish static contract validation, local tests, browser behavior, live runtime behavior, deployment, and physical-device verification.

## M1a-D4R0 — decisions and boundary correction

Delivered:

- ADR-013 defines Gateway communication identity, logical Device identity, stable parameter UUIDs, route fan-out, calibration, derivation, Command encoding, and canonical telemetry.
- ADR-014 records the pre-production hard cutover and removes migration and backward-compatibility requirements.
- Rejected fixed compiler and UI behavior are not considered acceptance evidence for the canonical model.

## M1a-D4R1 — executable canonical contracts

Delivered:

- JSON Schema 2020-12 contracts for shared vocabulary, Device Profile authoring/artifacts, Native MQTT Binding authoring/artifacts, Gateway, Gateway Route, compile request/preview, Runtime Bundle, and canonical telemetry.
- Stable parameter UUIDs, structured calibration, restricted CEL, explicit missing/invalid policies, UI presentation hints, route selectors, and Command request/response mappings.
- Golden fixtures for Gateway fan-out, temperature and humidity Devices, a multi-parameter three-phase meter, divide-by-ten calibration, same-Device derivation, and a thermostat Command.
- Invalid fixtures for duplicate identities, unsafe formulas, cycles, unresolved targets, missing policies, incompatible types, invalid keys, and unsupported wildcards.
- One OpenAPI surface, one generated TypeScript file, and one cross-language vocabulary.

Acceptance criteria:

- All JSON Schemas compile.
- Every manifest case matches its expected schema and semantic result.
- Both OpenAPI documents pass Redocly.
- Generated TypeScript and PHP/Go vocabulary checks pass.

## M1a-D4R2 — Laravel persistence, domain, and API

Delivered:

- Clean migrations for Profile/Binding catalogs, Devices, Gateways, Gateway Routes, and exact definition assignments.
- Composite Organization foreign keys and route-resolution indexes.
- Dynamic immutable authoring DTOs and JSON-shape preservation.
- Tenant-safe Profile, Binding, Gateway, Route, Device, and assignment services and APIs.
- Optimistic concurrency through revisions and ETags.
- Registration invariant requiring published definitions, an enabled matching route, and a complete identity-matched Runtime Bundle.
- Route deletion clears route and runtime pins while the Device remains a mutable draft.

Acceptance criteria:

- Fresh SQLite and PostgreSQL migrations pass without touching the persistent developer database.
- No version-selection or compatibility-only columns exist.
- Tenant isolation, policy, ETag, lifecycle, JSON-shape, composite-key, and route-registration tests pass.
- Laravel exposes one authenticated `/api/v1` Device Domain route set.
- Public resources do not expose removed implementation metadata.

Verification evidence (2026-08-29):

- Contract validation passed for 13 schemas and 18 fixture cases; both OpenAPI documents passed Redocly.
- TypeScript generation was byte-stable across consecutive runs.
- The full Laravel suite passed 55 tests and 351 assertions on its disposable SQLite test database.
- A clean migration and 14 canonical API/schema tests passed 158 assertions on an isolated PostgreSQL 17 container; the container was removed afterward and the persistent development database was not reset.
- Go passed 5 tests across 4 packages and `go vet ./...`.
- Workspace typecheck, lint, build, and test completed 16 of 16 tasks; the portal canonical-route smoke test and 11 admin E2E tests passed.
- Browser inspection confirmed the canonical tenant Device Domain placeholder rendered at the expected route without relevant console warnings. Dynamic authoring remains explicitly pending in D4R4.

## M1a-D4R3 — Go compiler and Runtime Bundle

Tasks:

- Define canonical Go request, Profile, Binding, Gateway, Route, artifact, preview, and Runtime Bundle models directly from the validated contract.
- Compile parameter mappings by UUID rather than display key.
- Compile JSONPath extraction, structured calibration, and restricted CEL with deterministic limits and diagnostics.
- Topologically sort same-Device derivations and reject cycles or undeclared dependencies.
- Compile inbound route selectors and resolved topics using authenticated Gateway and route context.
- Compile minimal Command request encoders plus correlated response decoders; PUBACK remains distinct from Device success.
- Canonicalize artifacts and produce reproducible source, route, and Runtime Bundle hashes.
- Re-enable the authenticated internal compile endpoint only after the canonical compiler suite passes.

Acceptance criteria:

- Golden and invalid contract fixtures pass in Go.
- Repeated compilation produces byte-identical canonical artifacts and hashes.
- Runtime Bundle identity matches exact Organization, Gateway, Route, Device, Profile Version, and Binding Version inputs.
- Laravel internal-client tests distinguish diagnostics, transport failure, and authentication failure.
- No live EMQX, TimescaleDB, deployment, or physical-device behavior is claimed.

Delivered:

- Canonical unversioned Go models compile Profile, Binding, Gateway, Route, fixtures, artifacts, preview, and Runtime Bundle contracts under their first public `v1` identities.
- Measured mappings target stable parameter UUIDs and execute restricted JSONPath, wire coercion, structured calibration, restricted CEL, semantic constraints, and explicit missing/invalid policies.
- Same-Device derivations are topologically ordered and reject cycles, missing dependencies, and CEL UUID references omitted from dependency declarations.
- Gateway identity and Route context resolve exact MQTT topics, payload scopes, and optional selectors into an immutable logical-Device Runtime Bundle.
- Command pipelines encode only correlation, routing, and mapped values; decode correlated terminal Device responses; and never treat MQTT PUBACK as Device success.
- Profile source, Binding source, Profile artifact, Binding artifact, authenticated route source, compile input, and Runtime Bundle identities use RFC 8785 canonical JSON and SHA-256.
- The Go runtime exposes authenticated `POST /internal/v1/definitions/compile`; Laravel calls it through an unversioned typed client boundary.

Verification evidence (2026-08-29):

- Go race-enabled suite passed 28 tests across 4 packages; `go vet ./...` passed.
- Golden hub fan-out Runtime Bundle matched checked-in canonical JSON and real hashes; three-phase calibration/derivation, route selector, restricted CEL, command encoding/correlation, invalid contract fixtures, repeated byte-stable compilation, and exact identity tests passed.
- Laravel suite passed 61 tests and 367 assertions on SQLite, including 6 internal compiler-client tests and 16 focused assertions for domain, authentication, network, HTTP, and malformed-response boundaries.
- A live local cross-language smoke call through the real Laravel client and authenticated Go endpoint returned the exact humidity logical-Device UUID and the checked-in Runtime Bundle hash.
- Contract validation passed 13 schemas and 18 fixture cases; both OpenAPI documents passed Redocly.
- Device Domain TypeScript generation was byte-stable across consecutive runs; workspace typecheck, lint, build, and test passed.
- Clean migration and the full 61-test Laravel suite passed on a disposable PostgreSQL 17 container at isolated port 55433; the container was removed and the persistent development TimescaleDB on port 5432 was not reset.
- EMQX ingestion, TimescaleDB writes, deployed runtime behavior, command delivery, and physical-device verification remain outside this milestone.

## M1a-D4R4 — dynamic tenant authoring and onboarding UI

Tasks:

- Build dynamic repeaters for measured parameters, derived parameters, properties, events, and Commands.
- Generate stable UUIDs once per draft item and preserve them across edits, reordering, save, and reload.
- Add type-aware constraints, units, presentation presets, missing/invalid policies, structured calibration steps, formula editing, and derivation dependency selection.
- Separate semantic Profile authoring from MQTT Binding authoring while keeping target UUID selection understandable.
- Show synchronized read-only canonical JSON for Profile, Binding, Gateway Route, and compile preview.
- Add Gateway selection/creation, route-path configuration, Device draft creation, exact definition assignment, compile preview, Runtime Bundle pinning, and explicit registration.
- Add route previews explaining which topic/payload paths populate each logical Device parameter.
- Cover keyboard use, error/loading states, destructive confirmation, optimistic-concurrency conflicts, tenant switching, and responsive layouts.

Acceptance criteria:

- Frontend typecheck, lint, production build, and focused tests pass.
- Browser tests cover Gateway fan-out, the three-phase meter, calibration, derivation, and Command authoring.
- Browser evidence uses the canonical Laravel API; mocked and live-local evidence are reported separately.
- No live broker or physical-device behavior is claimed.

## M1a-D4R5 — integration, acceptance, and handoff

Tasks:

- Run contract, OpenAPI, generated-artifact, PHP, Go, and TypeScript suites from a fresh checkout and disposable databases.
- Verify Profile, Binding, Gateway, Route, Device assignment, compile, pin, registration, cloning, and deletion flows through the browser.
- Confirm generated artifacts are clean after regeneration.
- Review database indexes, PostgreSQL constraints, tenant isolation, ETags, and safe error responses.
- Record deferred EMQX ingestion, TimescaleDB persistence, command delivery, bulk onboarding, admin templates, AI/MCP, deployment, and physical-device verification.

There is no rejected-model migration task in D4R5.

## M1a-D5 — AI chat and MCP onboarding

This milestone starts only after D4R3-D4R5 pass.

- Convert a prompt into a draft Profile, Binding, Gateway Route, and Device onboarding proposal using canonical DTOs.
- Present normalized JSON and diagnostics for human confirmation before any durable mutation.
- Create resources through the same application services and authorization paths used by the UI.
- Never publish, register, or issue a Command without explicit confirmation and policy checks.

## Current evidence boundary

Canonical contracts, Laravel CRUD, and the route-aware Go compiler/internal client are verified local evidence. Until later milestones complete, this plan does not claim a dynamic authoring UI, live EMQX connectivity, telemetry ingestion, TimescaleDB writes, command delivery, deployment, or physical-device verification.
