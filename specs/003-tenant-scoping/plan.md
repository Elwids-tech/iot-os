# Implementation Plan: Structural Tenant Scoping

**Branch**: `spec/003-tenant-scoping` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-tenant-scoping/spec.md`

## Summary

Organization scoping moves from hand-written checks in each controller to structure.
There are seven parts:

- **One context.** A scoped `OrganizationContext` per request, job, scheduled step
  and assistant tool call. It is entered by middleware that runs **before route
  binding**, so non-members get the same 404 as an unknown organization (Q3).
- **Automatic confinement.** Global scopes on the 23 organization-owned models
  (parent scopes on 20 child models) and `scopeBindings()` on every tenant route
  group, plus a scoped raw-query helper and a scoped `exists` rule. Foreign records,
  references and lists behave like missing ones, with one not-found body.
- **Permissions once.** A `PermissionSnapshot` resolved once per principal and
  organization. The seven existing domain services read it, so outcomes stay the
  same. One `run()` replaces the 9 copies of the organization-switching block.
- **Background work.** Jobs declare their organization and principal; workers,
  scheduler, runtime and seeders declare platform-wide work; assistant tool calls
  refresh the snapshot.
- **Explicit grant.** Super administrators keep everything through a
  `super-administrator` platform role holding `PlatformAdministration.act-in-organizations`.
  Each request that relies on it is recorded in `platform_access_events` (Q2). The 14
  bypass sites go.
- **Event abilities.** Integration event types follow abilities in the feed and
  webhooks (Q1).
- **The walker** (the spec's isolation check). A route walker driven by the router and the OpenAPI contract
  (spec 001) proves all of this on all 217 tenant operations. It lands first, with a
  known-gaps ratchet, and its self-test proves it catches a removed scope.

No dependency is added and no route is added. The only schema change is one table,
plus rows for a platform role and permission. The work lands in 12 pull requests of
1 to 4 days each, about 27 to 33 engineer-days. Decisions and alternatives are in
[research.md](research.md) section 13.

## Technical Context

**Language/Version**: PHP 8.4 on Laravel 13.35 (`apps/api`).

**Primary Dependencies**: existing only: `spatie/laravel-permission` 7.4.2 (teams on,
team key `organization_id`), Sanctum 4.3.3, `opis/json-schema` 2.6.0 and the spec 001
contract test support (`tests/Support/Contract`). No new packages.

**Storage**: PostgreSQL 17 with TimescaleDB. One new table, `platform_access_events`,
and one data migration (platform role and permission). No change to existing tables.

**Testing**: PHPUnit 12.5 feature tests (PostgreSQL in CI, SQLite locally) with the G4
response checks on every request. The new isolation walker and its self-test,
architecture tests (route middleware, job interfaces, model classification, raw-table
access, no `is_super_admin` bypass) and a snapshot equivalence test.

**Target Platform**: The control plane's API (php-fpm in release), its queue workers
(`queue:work`, up to an hour per process), the `automation:work` and
`integrations:webhooks-work` loops, and the scheduler.

**Project Type**: Web service in a monorepo; no front-end change.

**Performance Goals**:

- Authorization runs at most one snapshot per principal and organization: 2 queries
  (membership with role ids, then direct permissions; role permissions come from the
  package's cache), against 4 to 10 or more today (SC-004).
- Global scopes add one indexed condition; parent scopes add one `EXISTS` on an
  indexed foreign key.
- The walker adds under 3 minutes to the CI suite.

**Constraints**:

- Successful responses are unchanged (FR-034).
- Error changes are limited to [contracts/error-responses.md](contracts/error-responses.md)
  and event delivery ([contracts/event-abilities.md](contracts/event-abilities.md)).
- No new route; the route list changes only in middleware names.
- Each pull request is green on the PostgreSQL CI job, and the affected containers are
  rebuilt and exercised (constitution IX).

**Scale/Scope**:

- 217 tenant operations on 216 routes.
- 56 models: 23 organization-owned, 20 through a parent, 5 parent-only, 7 platform.
- 136 raw `DB::table` calls, about 50 of them on tables with an organization column.
- 5 queued job classes, 2 worker loops, 4 scheduled tasks, 4 assistant tool classes.
- 14 super-administrator bypass sites.
- 12 pull requests.

All Technical Context unknowns are resolved in [research.md](research.md) section 13;
none remain marked NEEDS CLARIFICATION.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.0.1.

| # | Principle | Gate question for this feature | Before research | After design |
| --- | --- | --- | --- | --- |
| I | Laravel owns intent; Go executes | Does anything move authorization or tenant identity out of Laravel, or make a client talk to the runtime? | Pass: all changes are in `apps/api`. | Pass: runtime-facing internal routes keep their token checks and run as declared platform work; the runtime is unchanged. |
| II | Immutable versions, explicit activation | Does anything change versioning or activation? | Pass (not affected) | Pass |
| III | Tenant isolation everywhere | Does every tenant route resolve the organization and check membership before permission? Does every change that touches tenant data carry a test that another organization cannot read or change it? | Pass: this feature exists to strengthen III. | Pass: membership is checked before route binding (stricter than today). The walker checks every tenant operation and lands in PR 1, so each later pull request is guarded. Each domain pull request removes that domain's known gaps and adds self-test cases. Tenant identity still comes only from the session, the application token or the job's stored identifiers. |
| IV | Contracts first | Do public API changes update the contract, `packages/api-client` and docs in the same pull request? | Action | Pass: PR 2 updates the `NotFound`/`Forbidden` descriptions and `x-organization-scoped` meaning and runs `contract:export`. PR 11 updates the event-feed description. Neither changes a schema or status set, so the client library's generated types do not change (verified with spec 001's type freshness gate where present). The access and integration docs change in the same pull requests. User references stay integer `user_id` (`platform_access_events.user_id`). |
| V | AI proposes, people approve | Do assistant tools run with the requesting user's permissions and re-check them when they execute? | Pass | Pass, strengthened: each tool call refreshes the snapshot, and the global scopes confine the controllers tools call. |
| VI | Show uncertainty; never invent state | — | Pass (not affected) | Pass |
| VII | Durable, idempotent messaging | Do jobs and webhooks stay at-least-once and idempotent? | Pass | Pass: jobs re-establish access at execution and end without side effects when it is lost (as today). A webhook delivery whose type is no longer readable is cancelled, never retried forever. Inbox and outbox handling is unchanged. |
| VIII | One design system | Any UI? | Pass (none) | Pass (none) |
| IX | Done means verified where it runs | CI on PostgreSQL, containers rebuilt, exercised in the running app? | Pass | Pass: each pull request lists its rebuilds: `api` plus every service built from the API image (`automation-worker`, `alerts-worker`, `webhooks-worker`, `assistant-worker`, `scheduler`, and `adapter-worker` with the adapter overlay). Each also lists the quickstart scenario to exercise on the stack (B2 to B6). |
| — | Decisions are ADRs | Is a lasting decision recorded? | Action | Pass: PR 2 adds ADR-017 "Structural tenant scoping" (D1 to D4, D9, row-level security deferred). |
| — | Small, reviewable changes | Can each pull request be reviewed alone? | Pass | Pass: 12 pull requests; mechanical removals of hand-written checks stay in their domain's pull request, separate from the foundation. |
| — | Secrets never enter git | — | Pass | Pass: walker fixtures use placeholder tokens. |

**Result**: passes with no violations. Complexity Tracking is empty. Owner decisions are
listed below.

## Project Structure

### Documentation (this feature)

```text
specs/003-tenant-scoping/
├── spec.md
├── plan.md                 # this file
├── research.md             # inventory (sections 1-12) and decisions (section 13)
├── data-model.md           # context, snapshot, PlatformWork, model classification, new table, grant rows
├── quickstart.md           # developer workflow and validation scenarios
├── contracts/
│   ├── organization-context.md
│   ├── isolation-walker.md
│   ├── platform-access.md
│   ├── event-abilities.md
│   └── error-responses.md
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks output
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Authorization/
│   ├── Tenancy/                                # new
│   │   ├── OrganizationContext.php             # scoped; run(), platform(), snapshot()
│   │   ├── Principal.php
│   │   ├── PermissionSnapshot.php
│   │   ├── PlatformWork.php                    # enum of declared platform-wide work
│   │   ├── MissingOrganizationContext.php
│   │   ├── OrganizationScope.php               # global scope
│   │   ├── BelongsToOrganization.php           # trait: scope + creating/updating guards
│   │   ├── BelongsToOrganizationThrough.php    # trait: parent scope
│   │   ├── TenantTable.php                     # scoped raw queries
│   │   ├── TenantRecord.php                    # scoped exists rule
│   │   ├── RunsInOrganization.php, PlatformWide.php
│   │   └── EnterOrganizationForJob.php         # job middleware
│   ├── Http/Middleware/EnterOrganization.php   # replaces ResolveOrganizationContext
│   ├── Models/PlatformAccessEvent.php          # PR 10
│   └── Permissions/PlatformAdministrationPermission.php  # + ACT_IN_ORGANIZATIONS
├── app/Domain/*/Services/*Authorization*.php, DashboardAccess.php, HelpAccess.php,
│   AssistantAccess.php                         # read the snapshot
├── app/Domain/*/Models/*.php                   # traits and relations (data-model §5)
├── app/Domain/Integrations/IntegrationEventType.php  # PR 11
├── app/Domain/Integrations/Http/AuthenticateApplication.php  # enters the context
├── app/Providers/AppServiceProvider.php        # scoped binding, gates over the snapshot, no Gate::before
├── bootstrap/app.php                           # priority list, not-found renderer
├── config/permission.php                       # register_permission_check_method false
├── database/migrations/                        # platform_access_events; super-administrator role
└── tests/
    ├── TestCase.php                            # TestFixtures platform mode outside requests
    ├── Support/Isolation/                      # IsolationWorld, RecordKinds, requests/, known-gaps.php, exemptions.php
    ├── Feature/Isolation/                      # TenantIsolationTest, TenantIsolationSelfTest
    ├── Feature/Architecture/                   # route middleware, jobs, models, raw tables, bypass
    └── Feature/Tenancy/                        # context, snapshot equivalence, background isolation, platform grant
contracts/openapi/supplements/shared.yaml, integration.yaml   # descriptions only
contracts/openapi/openapi.json                  # regenerated
docs/adr/ADR-017-structural-tenant-scoping.md
docs/features/access.md, docs/features/integrations.md, docs/reference/api.md,
docs/reference/events.md, docs/dev/testing.md, docs/roadmap.md
```

**Structure Decision**: The tenancy primitives live in `app/Domain/Authorization/Tenancy`.
Authorization already owns `ResolveOrganizationContext`, the permission enums and
`PlatformAuthorization`, and every domain depends on it, so this adds no new
cross-domain edge. Domain services keep their place and their public methods. Isolation
tests sit beside the spec 001 contract tests in `tests/Feature` and `tests/Support`.

## Delivery: phases as pull requests

Each phase is one pull request, independently reviewable and green on PostgreSQL CI.
Sizes are hand-written lines and engineer-days.

| # | Pull request | Stories / requirements | Depends on | Size |
| --- | --- | --- | --- | --- |
| 1 | **Isolation walker.** `IsolationWorld`, `RecordKinds` (the 29 bound kinds plus reference-only kinds), request fixtures for operations with declared reference fields, checks C1 to C7, placeholder comparison, B's checksum, `known-gaps.php` seeded from the baseline (C2 everywhere, C1 bodies) with the ratchet, `exemptions.php`, self-test with test-only routes, runtime and adapter-manager fakes, and a "Tenant isolation" section in `docs/dev/testing.md`. | US1; FR-029 to FR-033; SC-001, SC-003 | — | L: ~1,300 lines, 3–4 days |
| 2 | **Organization context, permission snapshot, entry before binding.** `OrganizationContext`, `Principal`, `PermissionSnapshot`, `run()` replacing the 7 request-path switching copies. `EnterOrganization` on every portal tenant group, including the 13 administration routes, in the priority list; non-member 404; uniform not-found renderer. `AuthenticateApplication` enters the context. Domain services read the snapshot (equivalence test); `/me`, the notification centre and recipient lists use `snapshotFor`. Gates over the snapshot, and the permission package's gate registration off. `DeviceProfilePolicy` removed. Contract descriptions and export; `docs/features/access.md`, `docs/reference/api.md`; ADR-017. Known gaps: every C2 and every C1 body entry removed. | US5, US2 (FR-001 to FR-003); FR-013 to FR-017; SC-004, SC-008 (request path), SC-011 | 1 | L: ~1,100 lines, 3–4 days |
| 3 | **Context for work outside requests.** `RunsInOrganization`, `PlatformWide`, `EnterOrganizationForJob`, the `JobProcessing` reset; the 5 job classes assigned; `PlatformWork` enum; workers run each item in `run()`; scheduler, console commands, seeders and the dashboard backfill under platform work, replacing the remaining 5 switching copies; runtime internal routes and `AdapterController::event` under platform work plus `run()`; assistant tool calls `refresh()`; architecture test for `ShouldQueue`; background isolation tests (inventory, lost access, no context). | US3; FR-004, FR-018 to FR-022; SC-007, SC-008 (all code) | 2 | M: ~800 lines, 2–3 days |
| 4 | **Devices domain** (48 operations including overview). Traits on `Device`, `Site`, `SparkplugConnection`, `SparkplugGateway`, `DiscoveryCandidate`, `DeviceOnboarding`; parent scopes on `DeviceCommand`, `DeviceOperation`, `DeviceConfiguration`; `Organization` relations; `scopeBindings()`; `TenantRecord` for `site_uuid`, `gateway_uuid`, `device_uuid(s)`, `artifact_uuid` and other references; `TenantTable` for `devices` and `device_audit_events`; operation and request-key collisions; hand-written checks removed from the Devices and Overview controllers; self-test cases. | US2; FR-005 to FR-012 | 3 | L: ~900 lines, 3 days |
| 5 | **Device profiles** (30). Trait on `DeviceProfile`; parent scopes on the profile children and artifacts; `{group}`, `{alarm}` and `{binding}` relation mapping; `ensureOrganizationProfile` and the parent checks removed from 8 controllers. | US2 | 3 | M: ~600 lines, 2 days |
| 6 | **Automation** (42). Traits on `Workflow` and `Alert`; parent scopes on `Deployment`, `Scenario` and `AlertDelivery`; `TenantTable` for `automation_actions` and `automation_settings`; the `reconcile` command lookup; v1 and v2 permission families unchanged; deployment-key collisions. | US2 | 3 | L: ~900 lines, 3 days |
| 7 | **Dashboards, geospatial, help, context** (27). Traits on `Dashboard`, `Geofence`, `GeofenceActivationBatch`, `GeofenceAssignment` and `LocationBinding`; parent scope on `DashboardRevision`; `TenantTable` for `geofence_events`; dashboard share-target references. | US2 | 3 | M: ~600 lines, 2 days |
| 8 | **Adapters, applications and the integration API** (45). Traits on `DeviceAdapter`, `AdapterCandidate`, `AdapterCredential`, `AdapterOperation`, `AdapterTenant`, `DeviceInstallation` and `IntegrationApplication`; parent scopes on `AdapterProposal`, `AdapterRevision`, `Webhook` and `WebhookDelivery`; `TenantTable` for `integration_streams` and `integration_events`; integration controllers keep their device-grant filters but lose their organization filters; adapter-key collisions. | US2, US4 (C5 to C7) | 3 | L: ~800 lines, 3 days |
| 9 | **Assistant and organization administration** (25). Traits on `AssistantConversation` and `OrganizationInvitation`; parent scopes on the assistant children; `members`, `roles` and `invitations` scoped bindings; `OrganizationMembershipManager::ensureMembership` relies on binding; `Role` stays explicit. | US2 | 3 | M: ~600 lines, 2 days |
| 10 | **Explicit platform grant.** Permission and `super-administrator` role with a data migration; bootstrap commands assign it; snapshot evaluation and `EnterOrganization` admission; `platform_access_events` model, writer and daily pruning; the 14 bypass sites and `Gate::before` removed; `is_super_admin` out of `#[Fillable]`; the 6 test files that act as super administrator migrated; architecture test against bypasses; `docs/features/access.md`. | US6; FR-026 to FR-028; SC-009 | 2 (after 4–9 is easier, not required) | M: ~800 lines, 2–3 days |
| 11 | **Event types follow abilities.** `IntegrationEventType`; writers use it; feed and webhook filters; send-time cancel; walker check C8 and an ability-combination test; `integration.yaml` description and export; `docs/features/integrations.md`, `docs/reference/events.md`; SDK README release note; roadmap item closed. | US4; FR-024; SC-010 | 1 | S: ~400 lines, 1–2 days |
| 12 | **Close-out.** Delete `ResolveOrganizationContext`; flip the raw-table and model-classification tests to strict; assert `known-gaps.php` is empty; `docs/roadmap.md` ("Central tenant scoping" closed), `docs/dev/gotchas.md` (scopes in console code), `docs/architecture/overview.md`; final quickstart B1 to B7 run recorded in the pull request. | Polish; SC-001, SC-002, SC-005 | 4–11 | S: ~300 lines, 1 day |

**Order and parallelism**:

- PR 1 lands first, so the walker guards every later change.
- PR 3 comes before the domain pull requests. Global scopes fail closed without a
  context, so every job, worker, scheduled task and tool must already enter one. This
  is why the background-work phase moves ahead of the domain migration.
- PRs 4 to 9 depend only on PR 3 and can be reviewed in any order or in parallel.
- PR 10 needs only PR 2.
- PR 11 needs only PR 1 and can land any time, for example in parallel with PR 2.

**MVP**: PRs 1 and 2. With the walker on every tenant operation and membership checked
before binding, the non-member existence signal and the different 404 bodies are gone,
and permissions are resolved once.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| A code path touches an organization-owned model with no context (a console command, a rarely used job) | `MissingOrganizationContext` in production after a domain pull request | PR 3 makes every entry point enter a context first, with architecture tests for jobs and routes. Each domain pull request runs its workers on the rebuilt stack (constitution IX). The exception names the model, so a miss is quick to find. |
| The snapshot and today's services disagree in an edge case (wildcards, `PermissionDoesNotExist`, the ceiling) | A legitimate request is denied or allowed differently | The PR 2 equivalence test compares old and new outcomes for every seeded role × every tenant permission × member and non-member, plus a super administrator. The old services stay callable in the test until it passes. |
| Global scopes interfere with the permission package or Laravel internals (role cache, `exists` rules, eager loads across organizations) | Broken permission checks or empty relations | `Role` is excluded. `TenantRecord` replaces `Rule::exists`. Relations inside a scoped organization read only that organization's rows by design. Platform work is used where cross-organization reads are intended. |
| Walker false positives or flakiness (runtime fakes, rate limits, timestamps in bodies) | Noisy gate | A deterministic world, a frozen clock (`Carbon::setTestNow`), placeholder comparison, faked HTTP with stray requests prevented, rate limits off. Budget measured in PR 1. |
| Walker misses an operation whose bodies never reach the reference (validation stops first) | C4 passes trivially | Request fixtures must be valid; C4 asserts that the random-identifier response differs from the response with A's own valid reference, which proves the field was reached. |
| `whereHas` parent scopes are slow on large child tables | Latency on detail pages | Foreign keys are indexed; PR 4 measures `EXPLAIN` on `device_commands` and `device_configurations` and records it in the pull request. |
| Integrators notice fewer events (Q1) | Support questions | A release note, documentation, and unchanged cursors. Only applications missing the matching read ability see a difference. |
| The super-administrator data migration misses a user | A super administrator loses tenant access | The migration is idempotent and logs counts. `deployment:administrator` assigns the role. A test seeds super administrators and asserts the role after migration. |
| Tests that act as super administrator stop exercising what they meant to | False confidence | PR 10 migrates the 6 files to members, or to an explicit grant holder where platform access is the point. The architecture test forbids new `is_super_admin` bypasses. |

## Decisions the owner must make before implementation

1. **The reading of FR-009** (research D10). A request identifier that only another
   organization has used is answered exactly like a reuse within the organization
   (409). An unused key succeeds. Telling the two apart requires knowing the other
   organization's random UUID, and closing that fully would change identifiers returned
   to clients. Proposed: accept this reading, and record it in the spec's
   Clarifications when the plan merges.
2. **How long `platform_access_events` rows are kept.** Proposed default: 365 days,
   configurable. Also confirm that a database query is enough for now (no screen in
   this spec).
3. **`is_super_admin` stays as the platform-team identity.** It no longer grants
   anything; the grant is the `super-administrator` role. Alternative: replace the
   column entirely by role membership, which needs changes to platform-team
   management and operator notifications and is not proposed here.
4. **The uniform `{"message": "Not Found"}` body applies to every `api/*` 404**,
   including non-tenant ones such as a disabled feature, not only tenant routes.
   Proposed: yes, for one rule and no class-name leaks.
5. **Integrator communication for Q1.** Proposed: a release note in the SDK README
   and the integration docs in PR 11. Say whether a notice must go out before
   deployment.

## Complexity Tracking

No constitution violations. Using two scoping mechanisms (global scopes for the
organization, scoped bindings for parent chains) is a deliberate design choice, not a
violation; research D3 records why one alone is not enough.
