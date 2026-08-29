# Device Domain M1a Definition Authoring and Registration

**Status:** In implementation
**Last updated:** 2026-08-28
**Parent:** [Device Domain M1a](./device-domain-m1a.md)

## Outcome

Deliver tenant-owned Device Profile and Native MQTT Binding CRUD, deterministic contract previews, immutable publication, single-Device registration, and draft-first Laravel AI/MCP onboarding. This slice deliberately stops before broker credentials, live ingestion, command dispatch, Gateways, bulk onboarding, Sparkplug, and admin templates.

## Locked boundary

- Profiles contain optional one-level components plus telemetry, properties, events, and Commands.
- Bindings contain MQTT channels, manufacturer JSON mappings, restricted CEL, event dispatch, and command correlation.
- Firmware JSON remains manufacturer-owned.
- Go is the authoritative JSONPath/CEL compiler; Laravel owns definitions, authorization, API, AI orchestration, and publication intent.
- Published Profile and Binding Versions are immutable and a registered Device pins their exact artifacts.
- AI/MCP confirmation creates editable drafts only.

## Milestones

| Milestone | Deliverable | Status |
| --- | --- | --- |
| M1a-D0 | ADRs, JSON Schemas, OpenAPI, fixtures, and cross-language vocabulary checks | Complete |
| M1a-D1 | PostgreSQL migrations, aggregates, DTOs, policies, lifecycle, and ETags | Complete |
| M1a-D2 | Go compiler and Laravel internal client | Complete |
| M1a-D3 | Tenant CRUD, validation, publication, Device and assignment APIs | Complete |
| M1a-D4 | Tenant Profile/Binding authoring and single-Device registration UI | Complete |
| M1a-D5 | Laravel AI chat and authenticated Laravel MCP server | Pending |
| M1a-D6 | Contract, API, browser, security, observability, and handoff hardening | Pending |

Each milestone is implemented, verified, and committed separately. Completion evidence must distinguish contract validation, local tests, browser behavior, live runtime behavior, and deployed verification.

## M1a-D0 completion evidence

- ADR-009 through ADR-012 lock the capability model, versioning, compiler, and
  draft-first AI boundaries.
- JSON Schema 2020-12 contracts cover Profile authoring/artifacts, Native MQTT
  Binding authoring/artifacts, deterministic previews, and onboarding
  proposals.
- Golden fixtures cover temperature/humidity telemetry, two-way thermostat
  Commands, bounded multi-event dispatch, and intentional invalid cases.
- Redocly validates the planned OpenAPI 3.1 surface and `openapi-typescript`
  generates the committed Device Domain types.
- PHP, Go, and TypeScript checks lock their vocabulary to the common schema.

This is local contract evidence only. M1a-D0 adds no migrations, API handlers,
screens, compiler runtime, broker integration, or deployed behavior.

## M1a-D1 implementation evidence

M1a-D1 establishes the persistence and domain layer needed by the later API and
UI milestones:

- PostgreSQL migrations create tenant-owned Device Profiles, Profile Versions,
  Transport Bindings, Binding Versions, validation evidence, Devices, and
  immutable current definition assignments.
- Version authoring definitions and compiler artifacts remain JSONB aggregates;
  composite Organization foreign keys prevent cross-tenant references at the
  database boundary.
- Device Profile, Native MQTT Binding, compiler-result, and Device draft DTOs
  establish the PHP communication boundary around the D0 JSON contracts.
- DDD-style authoring, publication, retirement, assignment, registration, and
  archive services enforce `draft -> published -> retired` definition state and
  `draft -> registered -> archived` Device state.
- Published definition Versions and registered Device assignments are immutable.
  Archived catalogs cannot be edited, published, or assigned to new Devices.
- Strong revision ETags require `If-Match`, reject stale writes, and advance when
  an aggregate or assignment changes. Transaction locks use a consistent order
  across publication and registration paths.
- Tenant-aware policies and seeded permissions cover Profile, Binding, Version,
  Device, assignment, publish, retire, register, and archive actions without
  granting tenant access to platform administrators implicitly.
- Foreign-key columns have supporting indexes; JSONB GIN indexes are deferred
  until a real query requires document-level filtering because D1 loads each
  definition as an aggregate.

Verification completed locally:

- Disposable PostgreSQL migration up, rollback, and re-apply succeeded. The
  resulting schema contains 7 D1 tables, 17 validated CHECK constraints, 22
  validated foreign keys, 20 unique constraints, 39 indexes, 11 JSONB columns,
  24 timezone-aware timestamp columns, and no unindexed foreign-key columns.
- SQLite in-memory `migrate:fresh` succeeded for the complete migration chain.
- Focused Device Domain tests pass: 14 tests and 63 assertions.
- Full Laravel suite passes: 55 tests and 250 assertions.
- D1-scoped Pint validation passes. Repository-wide Pint still reports two
  pre-existing Administration formatting failures outside this milestone;
  those unrelated files were not changed.
- `pnpm contracts:check`, contract regeneration, API-client typecheck, and the
  workspace typecheck pass.

This remains local persistence and domain-layer evidence. M1a-D1 adds no Device
Domain API handlers, tenant/admin screens, Go compiler runtime, broker behavior,
live device ingestion, command delivery, deployed behavior, or browser evidence.
## M1a-D2 implementation evidence

M1a-D2 establishes the deterministic compiler boundary used by later tenant
authoring APIs and UI:

- The Go compiler strictly decodes coordinated Profile/Binding authoring DTOs,
  validates persisted identities and cross-document relationships, builds the
  capability catalog, validates channel purpose/direction and mapping
  completeness, and rejects invalid definitions without producing artifacts.
- Restricted JSONPath supports root, object children, numeric indexes, and a
  final `[*]` record selector only. Restricted CEL has bounded cost and output,
  deterministic derivation ordering, and cycle detection.
- Fixture replay covers telemetry, events, desired/reported properties, and
  one-way/two-way Command request/response behavior. Command response success
  requires correlation and normalized terminal status; broker PUBACK is not
  treated as device success.
- RFC 8785 canonical JSON and SHA-256 produce deterministic input, Profile
  artifact, and Binding artifact hashes with explicit compiler environment
  metadata.
- `POST /internal/v1/definitions/compile` is an internal Go runtime endpoint
  protected by a constant-time-compared static bearer token of at least 32
  bytes. The request body is limited to 2 MiB. Definition failures return HTTP
  200 with `valid: false`; authentication, malformed requests, size limits, and
  runtime failures use infrastructure HTTP statuses.
- JSON Schema 2020-12 owns `iot.definition-compile-request.v1`; a separate
  OpenAPI 3.1 document owns the internal runtime surface. The preview contract
  now accurately permits null artifact hashes for invalid compilations.
- Laravel sends existing Profile and Binding authoring DTOs plus fixtures with
  bounded connection/total timeouts and at most three configured attempts. It
  returns `DefinitionTestResultData` for both valid and domain-invalid HTTP 200
  responses and throws one dedicated transport exception for network, HTTP, or
  malformed-response failures.

Verification completed locally:

- Go tests pass: 28 tests across 4 packages; `go vet ./...` passes.
- Compiler coverage includes the committed temperature/humidity/thermostat and
  multi-event fixtures, deterministic repeated hashes, Command generation and
  correlation, unsupported wildcard rejection, invalid CEL, derivation cycles,
  numeric path placement, and type/constraint/missing-value failures.
- Laravel compiler-client tests pass: 6 tests, 37 assertions. The full Laravel
  suite passes: 61 tests, 287 assertions.
- `pnpm contracts:check` validates 8 schemas and 7 fixture cases; both public and
  internal OpenAPI documents pass Redocly. Contract regeneration, API-client
  typecheck, and workspace typecheck pass.
- D2-scoped Pint validation passes. Repository-wide Pint still reports the same
  two pre-existing Administration formatting failures outside this milestone;
  those files remain unchanged.
- Combined Docker Compose configuration validates and the Taskfile exposes the
  authenticated runtime development command.
- A live local Go process returned `200` for health, `401` for an unauthenticated
  compile request, and `200` with `valid: true`, zero diagnostics, one preview,
  and both artifact hashes for the real telemetry fixture.

This is compiler, internal HTTP, Laravel-client, contract, and local-process
evidence only. M1a-D2 adds no public Device Domain API handlers, tenant/admin
screens, browser evidence, broker integration, live device ingestion, Command
delivery, deployed behavior, or physical-device verification.

## M1a-D3 implementation evidence

M1a-D3 exposes the D1 aggregates and D2 compiler through the tenant API
boundary:

- The 38 Profile, Binding, coordinated-definition, Device, and
  definition-assignment operations already specified in the public OpenAPI
  document are registered under `/api/v1` with Sanctum authentication.
- `X-Organization-UUID` selects an authenticated Organization membership and
  team-permission context. UUID lookup remains Organization-scoped so
  cross-tenant resource identifiers resolve as `404`, while a known
  Organization without membership resolves as `403`.
- Device Profile and Native MQTT Binding catalogs support tenant list, create,
  read, metadata replacement, archive, and safe deletion. Draft Versions
  support list, create, read, full replacement, clone, and reference-safe
  deletion.
- Coordinated Profile/Binding draft creation and replacement use one strong
  composite ETag. Validation calls the internal Go compiler, persists every
  valid or invalid `DefinitionTestRun`, and returns domain-invalid compiler
  results as HTTP `200`. Publication requires valid evidence for both current
  draft revisions before atomically publishing both Versions.
- Device drafts support create, read, full replacement, safe deletion,
  definition assignment, registration, and archive. The first assignment uses
  the Device ETag, later draft replacements use the assignment ETag, and
  registration locks the exact published Profile/Binding Versions against
  later mutation.
- Missing `If-Match` returns RFC 9457-style `428`; stale values return `412`
  plus the current ETag; lifecycle/reference conflicts return `409`; compiler
  transport failures return `503`.
- Contracted create, clone, publish, register, and archive routes enforce an
  `Idempotency-Key` of 8-255 characters. Durable response replay,
  payload-conflict detection, and key retention remain an explicit M1a-D6
  hardening item.

Verification completed locally:

- D3 public API feature coverage passes: 6 tests with 111 assertions covering
  authentication, Organization context, permissions, cross-tenant isolation,
  catalog/version CRUD, cloning/deletion, ETags, compiler
  validation/publication, compiler outage mapping, and Device
  assignment/registration/archive.
- Focused Device Domain coverage passes: 24 tests with 205 assertions.
- Complete Laravel coverage passes: 67 tests with 398 assertions.
- All 38 D3 public operations are present in Laravel route inspection.
  Contract validation passes for 8 JSON Schemas and 7 fixture cases; both
  OpenAPI documents pass Redocly.
- Workspace TypeScript typecheck and lint pass. Go compiler/runtime tests pass:
  28 tests across 4 packages; `go vet ./...` passes.
- D3-scoped Pint validation passes. Repository-wide Pint continues to report
  only the same two pre-existing Administration formatting failures outside
  this milestone; those files remain unchanged.

This is local API/domain/compiler evidence only. M1a-D3 adds no tenant/admin
authoring screens, browser evidence, AI/MCP onboarding, durable idempotency
replay store, broker integration, live ingestion, command delivery, deployed
behavior, or physical-device verification.

## M1a-D4 implementation evidence

M1a-D4 adds the first tenant Device Domain experience on top of the D3 API:

- A dedicated React/Vite tenant portal uses explicit
  `/organizations/{organizationUuid}/...` URLs, validates memberships from the
  authenticated session, switches tenant API context before child requests,
  and reuses the existing shadcn admin design language at desktop and mobile
  widths.
- The definition catalog loads Profile and Binding summaries in parallel, then
  loads all detailed Version resources concurrently. Draft Versions can be
  reopened; published coordinated definitions lead directly into Device
  onboarding.
- Guided authoring starts from the validated temperature, humidity, timestamp,
  Device ID, and optional two-way `temp_level` thermostat contract. Tenant
  engineers edit semantic constraints, MQTT topics, supported JSONPath fields,
  and a real telemetry fixture while reviewing the exact generated DTO as
  read-only JSON.
- Coordinated draft creation/replacement, compiler validation, and publication
  preserve one composite ETag. HTTP `412` conflicts stop mutation and offer an
  explicit server-draft reload/review path. Versioned Organization-scoped local
  storage preserves only the editable form and current draft identities.
- Single-Device onboarding visibly executes Device draft creation, immutable
  Profile/Binding Version assignment with the Device ETag, a fresh Device read,
  and explicit registration with the advanced Device ETag. Partial progress is
  retained and can be resumed after a refresh so a failed later step can be
  retried without silently creating another Device.
- Shared UI additions remain shadcn primitives: Textarea, Tabs, and Spinner.
  Browser verification caught and corrected both stale Organization headers on
  tenant switching and incorrect Tabs orientation selectors.

Verification completed locally:

- Tenant portal Playwright coverage passes 4 scenarios: authentication and
  Organization switching; create/validate/publish; Device
  draft/assignment/fresh-read/registration with exact ETags; and 390x844 mobile
  sidebar navigation. The suite rejects unexpected console warnings and errors.
- The in-app browser loaded the local sign-in surface at its default viewport
  and at 390x844 with meaningful DOM, no framework overlay, and no console
  warnings or errors. Authenticated Device Domain workflows were verified with
  mocked API responses, not a live Laravel browser session.
- Workspace lint, TypeScript typecheck, and production builds pass for the
  admin portal, tenant portal, API client, contracts, and shared UI packages.
- Contract validation still passes 8 JSON Schemas and 7 fixture cases; both
  OpenAPI documents pass Redocly.
- Complete Laravel coverage passes: 67 tests and 398 assertions. Go compiler and
  runtime coverage passes 28 tests across 4 packages; `go vet ./...` passes.

This is local UI, mocked-browser-workflow, API/domain, and compiler evidence.
M1a-D4 adds no AI/MCP onboarding, durable idempotency replay store, broker
integration, live telemetry ingestion, Command delivery, deployed behavior, or
physical-Device verification. M1a-D5 is the next implementation milestone.
