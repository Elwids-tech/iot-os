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
| M1a-D2 | Go compiler and Laravel internal client | Pending |
| M1a-D3 | Tenant CRUD, validation, publication, Device and assignment APIs | Pending |
| M1a-D4 | Tenant Profile/Binding authoring and single-Device registration UI | Pending |
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
M1a-D2 is the next implementation milestone.
