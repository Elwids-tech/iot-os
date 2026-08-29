# Device Domain M1a Definition Authoring and Registration

**Status:** Rectification in implementation
**Last updated:** 2026-08-29
**Parent:** [Device Domain M1a](./device-domain-m1a.md)

## Outcome

Rectify M1a around dynamically authored Device Profile v2 parameters, stable parameter UUIDs, Gateway-to-logical-Device routing, deterministic calibration and derivation, separate Command mappings, and generated presentation metadata. The guided CRUD and onboarding experience must be correct before AI/MCP onboarding resumes. This slice still stops before broker credentials, live ingestion, live command dispatch, bulk onboarding, Sparkplug, and admin templates.

The D0-D4 completion evidence below records the locally verified v1 implementation. Product review rejected its fixed authoring and direct Device-to-Binding assumptions, so that evidence is historical rather than acceptance of the current model.

## Locked rectification boundary

- A Gateway is the authenticated MQTT communicator; a Device is a logical platform identity independent of physical composition.
- One Gateway message may route values to one or many logical Devices through explicit Gateway Routes.
- Profile v2 dynamically defines measured parameters, derived parameters, properties, events, and Commands.
- Every measured and derived parameter has a stable UUID used in canonical telemetry and time-series identity.
- Binding mappings target parameter UUIDs and own JSONPath extraction, structured calibration or restricted CEL, and explicit `on_missing`/`on_invalid` policies.
- Derived parameters use normalized same-Device values; cross-Device derivation is deferred to a virtual/calculated Device aggregate.
- Command semantics live in the Profile; request/response topics, payload placement, correlation, and extraction live in the Binding.
- Labels, units, constraints, presentation hints, formulas, and required markers are metadata and are not copied into MQTT wire payloads.
- Go remains the authoritative compiler; Laravel owns definitions, authorization, API, orchestration, and publication intent.
- Published Versions remain immutable. Compatible clones preserve parameter UUIDs; semantic replacements receive new UUIDs.
- AI/MCP confirmation remains draft-only and M1a-D5 is blocked until rectification is complete.

## Milestones

| Milestone | Deliverable | Status |
| --- | --- | --- |
| M1a-D0 | ADRs, JSON Schemas, OpenAPI, fixtures, and cross-language vocabulary checks | Complete v1 baseline |
| M1a-D1 | PostgreSQL migrations, aggregates, DTOs, policies, lifecycle, and ETags | Complete v1 baseline |
| M1a-D2 | Go compiler and Laravel internal client | Complete v1 baseline |
| M1a-D3 | Tenant CRUD, validation, publication, Device and assignment APIs | Complete v1 baseline |
| M1a-D4 | Tenant Profile/Binding authoring and single-Device registration UI | Complete v1; superseded |
| M1a-D4R0 | ADR-013, corrected boundaries, and executable rectification plan | Complete |
| M1a-D4R1 | Profile v2, Gateway routing, canonical telemetry schemas, and fixtures | Complete |
| M1a-D4R2 | Laravel Gateway routing persistence, domain model, DTOs, and API | Complete |
| M1a-D4R3 | Go v2 compiler and route-aware Runtime Bundle | Pending |
| M1a-D4R4 | Dynamic React Profile, Binding, Command, and onboarding forms | Pending |
| M1a-D4R5 | v1 migration policy, end-to-end local verification, and handoff | Pending |
| M1a-D5 | Laravel AI chat and authenticated Laravel MCP server | Blocked by D4R0-D4R5 |
| M1a-D6 | Contract, API, browser, security, observability, and handoff hardening | Pending |

Each milestone is implemented, verified, and committed separately. Completion evidence must distinguish contract validation, local tests, browser behavior, live runtime behavior, and deployed verification.

## Rectification execution plan

### M1a-D4R0 — decision and boundary correction

- Add ADR-013 for Gateway communication identity, logical Device identity, stable parameter UUIDs, route fan-out, calibration, derivation, Command encoding, and canonical telemetry.
- Mark only the conflicting scopes of ADR-009 and ADR-010 as superseded; preserve their Profile/Binding separation and immutable-version decisions.
- Record D4R1-D4R5 as the blocking path before AI/MCP work resumes.
- Validate all new Mermaid source and documentation links.

Exit evidence: Markdown and Mermaid validation pass; the decision and plan are committed without claiming runtime behavior.

### M1a-D4R1 — executable v2 contracts

- Introduce versioned JSON Schema contracts for Profile v2 measured parameters, derived parameters, properties, events, Commands, constraints, policies, and presentation hints.
- Introduce Binding v2 schemas for parameter-UUID mappings, structured calibration operations, restricted CEL, telemetry channels, and Command request/response mappings.
- Define Gateway, Gateway Route, route assignment, Runtime Bundle, and canonical telemetry schemas without silently changing v1 documents.
- Update OpenAPI/DTO vocabulary and generated TypeScript types only from validated schemas.
- Add golden fixtures for a hub routing temperature and humidity to separate Devices, one three-phase meter with multiple parameters, divide-by-ten calibration, same-Device derivation, and a `temp_level` thermostat Command.
- Add invalid fixtures for duplicate UUIDs/keys, missing policies, dependency cycles, incompatible types, unsafe expressions, and unresolved mapping targets.

Exit evidence: schema, OpenAPI, generated-type, fixture, and cross-language vocabulary checks pass. No persistence, compiler runtime, or UI behavior is claimed.

D4R1 completion evidence on 2026-08-29:

- Eleven additive JSON Schema 2020-12 v2 contracts cover common vocabulary, dynamic Profile authoring/artifacts, Binding authoring/artifacts, Gateway identity, Gateway Route assignment, compile request/preview, Runtime Bundle, and canonical telemetry without changing v1 identities.
- The fixture manifest validates 19 total schemas and 25 total cases. Eighteen v2 cases cover hub fan-out, divide-by-ten calibration, minimal thermostat Command encoding, the multi-parameter three-phase meter, same-Device derivation, Runtime Bundle/canonical output, and six intentional invalid cases.
- Contract validation adds semantic checks for stable UUID/key uniqueness, dependency resolution and cycles, forbidden CEL symbols, mapping coverage/targets/types, channel direction/purpose, Command field/response coverage, route identity/channel uniqueness, and topic-variable resolution.
- Redocly validates additive public and internal OpenAPI v2 descriptions. `openapi-typescript` generates the committed v2 client surface, and workspace TypeScript typecheck/lint pass.
- PHP v2 vocabulary parity passes 2 tests with 4 assertions. Go definition tests pass 25 tests and `go vet ./...` reports no issues.

This is local contract evidence only. D4R1 adds no migrations, API handlers, Go v2 compiler behavior, React forms, broker ingestion, time-series writes, deployed behavior, or physical-device verification.

### M1a-D4R2 — Laravel persistence, domain, and API

- Add tenant-owned Gateway and Gateway Route persistence with composite Organization foreign keys and indexes for gateway/topic route resolution.
- Evolve definition assignment so a registered logical Device pins exact Profile v2, Binding v2, route, and compiled artifact identities.
- Add immutable DTOs and aggregate services for Profile cloning, including preservation of compatible parameter UUIDs and explicit replacement with new UUIDs.
- Add policies, ETags, validation requests, resources, and tenant APIs for Gateway CRUD, route CRUD, and route-aware Device onboarding.
- Preserve v1 records and make compatibility state explicit; do not reinterpret or destructively rewrite them.

Exit evidence: migrations run from clean and existing databases; feature, policy, tenant-isolation, lifecycle, optimistic-concurrency, and rollback tests pass. Broker connectivity is not claimed.

### M1a-D4R3 — Go compiler and Runtime Bundle v2

- Compile mappings by parameter UUID rather than display key.
- Compile structured calibration pipelines and restricted CEL with type checks, dependency checks, operation limits, and deterministic error paths.
- Build and topologically sort same-Device derived-parameter graphs; reject cycles and cross-Device references.
- Compile inbound route matchers and outbound Command encoders/response correlators into an immutable Runtime Bundle.
- Emit canonical telemetry values with Gateway, Device, parameter, Profile Version, timestamp, quality, message, and Runtime Bundle identities.
- Keep PUBACK distinct from a correlated Device Command result.

Exit evidence: Go unit, golden, determinism, invalid-fixture, and Laravel-client contract tests pass. Live EMQX, TimescaleDB writes, and physical Devices are not claimed.

### M1a-D4R4 — dynamic tenant authoring and onboarding UI

- Replace static template fields with repeaters for measured and derived parameters, preserving generated UUIDs while drafts are edited and reordered.
- Add type-aware constraints, missing/invalid policies, unit metadata, presentation presets, structured calibration steps, restricted formula editing, dependency selection, and inline validation.
- Add a separate Commands section for semantic request/response fields, generated control hints, publish/response topics, payload mappings, and correlation settings.
- Keep generated Profile, Binding, and Runtime Bundle JSON read-only and synchronized with the guided form.
- Add Gateway selection/creation and route-path configuration to Device onboarding, including previews showing which payload paths populate which logical Device parameters.
- Cover keyboard operation, destructive-action confirmation, responsive layout, loading/error states, and tenant-safe navigation in the existing React/shadcn language.

Exit evidence: frontend unit tests, production build, API integration tests, and browser smoke tests pass for the hub, three-phase meter, calibration, derivation, and Command fixtures. No mockups or live broker behavior are claimed.

### M1a-D4R5 — migration, acceptance, and handoff

- Provide an explicit v1 compatibility report and supported clone/re-authoring workflow; do not fabricate parameter UUID continuity where semantics cannot be proven.
- Run the full PHP, Go, TypeScript, schema, OpenAPI, and generated-artifact checks from a clean database.
- Browser-test tenant CRUD, publication, Gateway routing, onboarding, cloning, and read-only JSON previews with retained evidence.
- Record deferred live EMQX ingestion, TimescaleDB persistence, Command delivery, bulk onboarding, admin templates, and AI/MCP work as separate evidence levels and later milestones.

Exit evidence: all local suites and browser acceptance scenarios pass, migration behavior is documented, and the rectification is committed before M1a-D5 is unblocked.

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

## M1a-D4R2 implementation evidence

M1a-D4R2 establishes the Laravel control-plane persistence and API boundary for the corrected route-aware Device Domain v2 model:

- Tenant-owned Gateway and Gateway Route aggregates use public UUIDs, optimistic-concurrency revisions and ETags, Organization-scoped lookup, policies, permissions, validation requests, immutable authoring DTOs, resources, and CRUD APIs.
- Device Profile v2 and Native MQTT Binding v2 catalogs accept dynamically authored parameters, derived parameters, Properties, Events, Commands, channels, calibration mappings, and route-aware request/response mappings while retaining stable authored parameter UUIDs.
- Profile-compatible cloning creates new Profile Version identity while preserving compatible parameter UUIDs. Published or referenced definition identity remains immutable.
- Gateway Routes coordinate one authenticated Gateway with one logical Device and exact published Profile v2 and Binding v2 Versions. Route creation attaches the Device assignment; safe route deletion returns a draft Device to `v2_route_pending`.
- Device definition assignments explicitly distinguish `v1_unmigrated`, `v2_route_pending`, and `v2_route_aware`; logical v2 Device registration requires an enabled matching route and a complete, identity-matched Runtime Bundle pin.
- Platform-owned Properties are intentionally not transport-mapped. Desired Properties require platform-to-Device mappings and reported Properties require Device-to-platform mappings.
- Ambiguous Event active/cleared status values and ambiguous Command accepted/running/succeeded/failed status values are rejected during authoring.
- JSON object shape is preserved for valid empty `constraints`, channel `envelope`, Command `request_template`, route-variable-path, and Gateway Route `topic_variables` objects across DTO, PostgreSQL persistence, and API serialization boundaries.
- PostgreSQL adds composite Organization foreign keys, route-resolution indexes, immutable-version contract markers, Device identity markers, assignment/runtime pin fields, JSON-shape checks, hash checks, compatibility-state coherence, and atomic Runtime Bundle pin constraints. Existing v1 rows are not reinterpreted or destructively rewritten.

Verification completed locally on 2026-08-29:

- D4R2-focused SQLite API, schema, and authorization coverage passes: 19 tests, 203 assertions.
- Complete Laravel coverage passes: 84 tests, 583 assertions.
- Real PostgreSQL/TimescaleDB Profile v2, Binding v2, Gateway, and Gateway Route API coverage passes: 13 tests, 159 assertions.
- Disposable SQLite and PostgreSQL databases both pass fresh migration, existing-v1 upgrade, populated rollback, and re-apply lifecycles. Preserved rows return as `v1_direct`, `v1`, `v1`, and `v1_unmigrated` with no fabricated route or Runtime Bundle pins.
- PostgreSQL catalog inspection confirms all D4R2 check constraints are validated, all new-table composite foreign keys have full-prefix index coverage, assignment foreign keys retain deliberate ID-leading indexes, and the D4R2 tables report zero uncovered foreign keys.
- Twelve deliberately invalid PostgreSQL writes are rejected across compatibility state, assignment shape, atomic Runtime Bundle pins, hash format, JSON object/array shape, route path, Gateway key/client/revision, and cross-tenant composite foreign-key constraints.
- Laravel route inspection exposes 25 authenticated `/api/v2` Profile, Binding, Gateway, and Gateway Route operations.
- Contract validation passes 19 JSON Schemas and 25 fixture cases. All four public/internal v1/v2 OpenAPI documents pass Redocly, and `openapi-typescript` regeneration produces no generated-client diff.
- Workspace tests, lint, TypeScript typecheck, and production builds pass. Go runtime coverage passes 29 tests across 4 packages and `go vet ./...` passes.
- D4R2-scoped Pint validation passes all 51 changed PHP files and the working diff passes whitespace validation. Repository-wide Pint still reports only two pre-existing Administration formatting failures outside this milestone; those files remain unchanged.

This is local persistence, domain, API, contract, migration, and static/runtime-test evidence only. M1a-D4R2 does not add or verify the dynamic React authoring/onboarding UI, route-aware Go v2 compiler behavior, live EMQX connectivity, ingestion, TimescaleDB telemetry writes, Command delivery, AI/MCP onboarding, deployment, or physical Devices. Those remain later milestones.
