---

description: "Task list for structural tenant scoping (spec 003)"
---

# Tasks: Structural Tenant Scoping

**Input**: Design documents from `/specs/003-tenant-scoping/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md)
(section 13), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md)

**Tests**: Required. The isolation check is itself a deliverable (FR-029 to FR-033),
and constitution principle III requires a cross-tenant test for every change that
touches tenant data. Test tasks are part of each story.

**Organization**: Tasks are grouped by user story. Each group names the pull request
(PR 1 to PR 12, plan.md "Delivery") that carries it. Phase order follows delivery
order, not story priority, because of dependencies:

- The walker (US1, P1) lands first.
- The foundation and US5 (P5) land together in PR 2, because every later story reads
  the context.
- Background work (US3, P3) lands before the domain migration (US2, P2), because
  global scopes fail closed without a context.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1 to US6)
- Paths are repository-relative; PHP paths are under `apps/api/`

## Before starting

Settle the owner decisions in plan.md ("Decisions the owner must make") first:

- Decision 1 (FR-009) blocks T063, T070 and T076.
- Decision 2 (retention) blocks T085.
- Decision 4 (the scope of the uniform 404) blocks T024.

Record the outcome of decision 1 in spec.md under Clarifications before PR 2 merges.

---

## Phase 1: Setup (PR 1)

**Purpose**: Test directories and shared helpers for the walker

- [ ] T001 Create apps/api/tests/Support/Isolation/ (with requests/), apps/api/tests/Feature/Isolation/, apps/api/tests/Feature/Architecture/ and apps/api/tests/Feature/Tenancy/
- [ ] T002 [P] Implement apps/api/tests/Support/Isolation/ResponseComparison.php: equal statuses, and JSON bodies equal after replacing every string or integer occurrence of the substituted identifier with `<id>` (contracts/isolation-walker.md, "Placeholder comparison")
- [ ] T003 [P] Implement apps/api/tests/Support/Isolation/OrganizationChecksum.php: an ordered hash of every row belonging to one organization, in every table with an organization column (research.md section 2.4, data-model.md section 5.5) and in the child tables of data-model.md section 5.2

---

## Phase 2: User Story 1 - Every tenant route is proven to keep organizations apart (Priority: P1) 🎯 MVP (PR 1)

**Goal**: One automated check enumerates every tenant operation (217) and proves that
organization B's records cannot be read, listed, changed or detected from organization
A, including through integration applications.

**Requirements**: FR-025 (C7), FR-029 to FR-033; SC-001, SC-003.

**Independent Test**: `php artisan test --filter='TenantIsolation(Self)?Test'` passes on
the current code with the known gaps listed (C2 non-member refusal, C1 404 bodies).
Removing one hand-written ownership check makes it fail and name the route.

### Tests and implementation for User Story 1

- [ ] T004 [US1] Implement apps/api/tests/Support/Isolation/RecordKinds.php: entries keyed by route parameter for the 29 bound kinds (`profile`, `device`, `workflow`, `adapter`, `dashboard`, `conversation`, `application`, `alert`, `geofence`, `parameter`, `credential`, `scenario`, `alarm`, `group`, `binding`, `command`, `candidate`, `adapter.candidate`, `batch`, `invitation`, `member`, `role`, `site`, `proposal`, `adapter.proposal`, `run`, `source`, `gateway`, `connection`), each with model, parent parameter, factory and route key; integration `{uuid}` resolved from the preceding path segment (`devices`, `geofences`, `alerts`); `FIELDS` (reference field → kind, including list fields such as `device_uuids` and `alert_uuids`); and `NOT_REFERENCES` with reasons (`request_uuid`, `operation_uuid`, `request_id`, `source_device_id`, `edge_node_id`, `group_id`, `session_id`, `execution_id`, `sample_ids`)
- [ ] T005 [US1] Implement apps/api/tests/Support/Isolation/IsolationWorld.php: organizations A and B and `unknownOrganization` (a random UUID); per organization `admin` (Organization Admin), `bare` (no roles) and a shared non-member `stranger`; one record per RecordKinds entry, parents first, with marker `iso-<org>-<kind>` in a name, code or title; `app` (every ability, every device) and `narrowApp` (no `alerts:read`, one device not granted) with tokens, where `narrowApp`'s token lacks one ability the application holds; events of every integration event type on granted and ungranted devices
- [ ] T006 [US1] Implement apps/api/tests/Support/Isolation/TenantOperations.php: `ContractRoutes::index()` filtered to operations marked `x-organization-scoped: true` in contracts/openapi/openapi.json; fail when a router route under `api/(integration/)?v1/organizations/{organization}` has no contract operation
- [ ] T007 [US1] Implement apps/api/tests/Support/Isolation/IsolationRequest.php: build the request for an operation key from its contract path parameters and A's records (path), the request fixture when present (query and body), and the actor (session `admin`, or an integration token)
- [ ] T008 [US1] Implement checks C1 (foreign path record against a random identifier; B's checksum for POST, PUT, PATCH and DELETE; and no audit or activity row created by the request, in `device_audit_events`, `notification_events` or `platform_access_events`, contains the substituted identifier, FR-006), C2 (non-member against unknown organization) and C3 (no B marker or identifier in 2xx bodies) in apps/api/tests/Feature/Isolation/TenantIsolationTest.php, with one data-provider case per operation and failure lines in the format of contracts/isolation-walker.md "Failure messages"
- [ ] T009 [US1] Implement check C4 in apps/api/tests/Feature/Isolation/TenantIsolationTest.php. For each contract-declared reference field (body properties and query parameters ending in `_uuid`, `_uuids`, `_id`, `_ids`), substitute B's record and a random identifier, replacing one element for list fields. Require the random response to differ from the response with A's own reference. Fail on an unclassified field ("classify `<field>` of `<operation>` in RecordKinds") and on a reference field without a request fixture
- [ ] T010 [P] [US1] Add request fixtures in apps/api/tests/Support/Isolation/requests/ for every tenant operation whose contract declares a reference field that is not in `NOT_REFERENCES` (27 operations at fd980fb, among them `device.store`, `device.update`, `device.index`, `device.saveConfiguration`, `device.activate`, `command.prepare`, `command.send`, `onboarding.store`, `discovery.storeGateway`, `telemetryCapture.store`, `locationBinding.update`, `locationMap.query`, `geospatial.map`, `alert.acknowledgeMany`, `alert.assign`, `notificationSettings.update`, `adapter.activate`, `adapter.deploy`, `profileParameterGroup.reorder`, `dag.resources`, `assistant.message` and the measurement history operations)
- [ ] T011 [US1] Implement checks C5 (B's application on A's operations → 404), C6 (ungranted device → 404, and absent from lists and the feed) and C7 (token without the operation's `x-abilities` → 403; a portal session cookie on an integration operation and an integration token on a portal operation → 401, FR-025) in apps/api/tests/Feature/Isolation/TenantIsolationTest.php
- [ ] T012 [US1] Create apps/api/tests/Support/Isolation/known-gaps.php from a baseline run (C2 for every portal operation; C1 for every bound record whose 404 body differs) and implement the ratchet: a listed check that passes, or an unlisted check that fails, fails the walker. Create apps/api/tests/Support/Isolation/exemptions.php with `['checks' => [...], 'reason' => '...']` entries (reason at least 20 characters) for shared-data operations such as `runtime-status` and `help/*`
- [ ] T013 [US1] Configure the walker environment in apps/api/tests/Feature/Isolation/TenantIsolationTest.php: `Queue::fake()`, `Http::preventStrayRequests()` with generic runtime and adapter-manager fakes (golden fixtures from contracts/ where they exist), rate limiting off (`ThrottleRequests` and named limiters), `Carbon::setTestNow()`, AI providers faked; never use `#[WithoutContractCheck]`, so G4 checks every walker response
- [ ] T014 [US1] Implement apps/api/tests/Feature/Isolation/TenantIsolationSelfTest.php: register test-only routes at runtime under `api/v1/organizations/{organization}/__isolation` (opting out of G4 with `#[WithoutContractCheck('test-only routes for the isolation self-test')]`). One reads a record through a raw unscoped query and must fail C1. One lacks the organization middleware and must fail C2
- [ ] T015 [US1] Run the full suite on PostgreSQL (docs/dev/testing.md "Laravel") and record the walker's added wall-clock in the PR description; it must stay under 3 minutes in CI (FR-032)
- [ ] T016 [P] [US1] Add a "Tenant isolation" section to docs/dev/testing.md: what the walker checks, how to add a RecordKinds entry and a request fixture, the known-gaps ratchet and the exemptions file

**Checkpoint**: The walker guards every later pull request.

---

## Phase 3: Foundational - organization context and entry before binding (PR 2)

**Purpose**: The context, the permission snapshot and the middleware that every later
story depends on. Implements FR-001 to FR-003 and Q3, the uniform not-found body
(FR-006, SC-002, SC-011) and the documentation and contract updates it needs (FR-035).

**⚠️ CRITICAL**: US2, US3 and US6 cannot start until this phase is complete.

- [ ] T017 Implement `OrganizationContext` (modes `none`, `organization`, `platform`; `run()`, `platform()`, `organization()`, `principal()`, `snapshot()`, `snapshotFor()`, `refresh()`), `Principal` and `MissingOrganizationContext` in apps/api/app/Domain/Authorization/Tenancy/ per contracts/organization-context.md. `run()` sets and restores the permission registrar's team in `finally`. Register the context with `scoped()` in apps/api/app/Providers/AppServiceProvider.php
- [ ] T018 Implement `PermissionSnapshot` in apps/api/app/Domain/Authorization/Tenancy/PermissionSnapshot.php with exactly 2 queries for a user: query 1 reads membership and role ids together (`organization_user` left joined to `model_has_roles` for the team); query 2 reads direct permissions; role permissions come from the package's cached registry. Add `abilities` for applications (application ∩ token) and `allows()`. Build it at most once per principal and organization (data-model.md section 3); `EnterOrganization` builds it and reads `member` from it
- [ ] T019 In the first commit of PR 2, before any service changes, generate apps/api/tests/Fixtures/permission-outcomes.json from the current `DeviceAuthorization`, `DeviceProfileAuthorization`, `DagAuthorization`, `DashboardAccess`, `HelpAccess`, `AssistantAccess` and `OrganizationAdministrationAuthorization` (every seeded role × every tenant permission enum case × member, non-member and super administrator). Then write apps/api/tests/Feature/Tenancy/PermissionSnapshotEquivalenceTest.php asserting the snapshot-backed services return exactly those outcomes (FR-014)
- [ ] T020 Implement apps/api/app/Domain/Authorization/Http/Middleware/EnterOrganization.php (alias `organization`). It loads the organization from the raw `{organization}` value, checks membership through the snapshot, aborts with the uniform 404 for unknown organizations, soft-deleted organizations (members included) and non-members, enters the context, puts the model back with `$route->setParameter()`, and restores the context afterwards. Register it with `$middleware->appendToPriorityList(AuthenticatesRequests::class, EnterOrganization::class)` in apps/api/bootstrap/app.php
- [ ] T021 Replace `ResolveOrganizationContext` with the `organization` middleware in every tenant group: app/Domain/{DeviceProfiles,Devices,Dashboards,Assistant,Automation,Geospatial}/routes/api.php, app/Domain/{DeviceAdapters,Help,Overview}/routes.php, the application-management group in app/Domain/Integrations/routes.php:14 (the integration API group keeps `AuthenticateApplication`), the context route in app/Domain/Authentication/routes/api.php, and the organization administration group in app/Domain/Administration/routes/api.php:72-95 (13 routes that have no middleware today)
- [ ] T022 Write apps/api/tests/Feature/Architecture/TenantRouteMiddlewareTest.php: every `api/(integration/)?v1/organizations/{organization}` route has exactly one of `EnterOrganization` and `AuthenticateApplication`, and no `api/v1/admin/*` route has either (FR-002)
- [ ] T023 Change apps/api/app/Domain/Integrations/Http/AuthenticateApplication.php to resolve the organization from the raw route value, run at the same priority as `EnterOrganization` (before `SubstituteBindings`), and enter the context with `Principal::application($application, $token)`; mismatch stays 404
- [ ] T024 Add one renderer in apps/api/bootstrap/app.php that answers every 404 on `api/*` (`ModelNotFoundException`, `NotFoundHttpException`, bare `abort(404)`) with `{"message": "Not Found"}`, and change tenant-related `abort(404, '<message>')` calls to the uniform body (contracts/error-responses.md)
- [ ] T025 Update contracts/openapi/supplements/shared.yaml (`NotFound` adds non-members and the example body; `Forbidden` drops "not a member of the organization") and the `x-organization-scoped` meaning in the apps/api/app/Support/Contract/SecurityTransformer.php docblock and docs/reference/api.md; run `php artisan contract:export` and commit contracts/openapi/openapi.json. Confirm packages/api-client needs no change (constitution IV): no status or type assumptions about non-members in packages/api-client/src, and generated types, if present, show no diff. Record this in the PR
- [ ] T026 [P] Update docs/features/access.md:48 ("404 for an unknown organization and for non-members, so a non-member cannot tell whether the organization exists")
- [ ] T027 [P] Write docs/adr/ADR-017-structural-tenant-scoping.md (research D1 to D4, D9, row-level security deferred; use the next free ADR number at merge time) and add it to docs/adr/README.md
- [ ] T028 Change apps/api/tests/TestCase.php to run each test body outside requests in `PlatformWork::TestFixtures` platform mode, and add a `withoutOrganizationContext(Closure)` helper for background-work tests
- [ ] T029 Remove every C2 entry and every C1 404-body entry from apps/api/tests/Support/Isolation/known-gaps.php; the walker and SC-011 pass

**Checkpoint**: Membership is checked before route binding, non-members get 404, and the
context exists in every request.

---

## Phase 4: User Story 5 - Permissions are decided once per request, from one place (Priority: P5) (PR 2)

**Goal**: Each request resolves a principal's permissions in an organization once, and
the domain services read that resolution. Outcomes are unchanged.

**Requirements**: FR-013 to FR-017; SC-004, SC-008 (request path).

**Independent Test**: `php artisan test --filter='PermissionResolution|PermissionSnapshotEquivalence'`
passes, and query counts drop (quickstart B5).

- [ ] T030 [US5] Change apps/api/app/Domain/Devices/Services/DeviceAuthorization.php: `capabilities()` and `authorize()` read `OrganizationContext::snapshot()` (or `snapshotFor()` for another organization); no team switching, no `unsetRelation`, no membership query
- [ ] T031 [P] [US5] The same for apps/api/app/Domain/DeviceProfiles/Services/DeviceProfileAuthorization.php; `authorize()` no longer reads an ambient team
- [ ] T032 [P] [US5] The same for apps/api/app/Domain/Automation/Services/DagAuthorization.php
- [ ] T033 [P] [US5] The same for apps/api/app/Domain/Dashboards/Services/DashboardAccess.php (`capabilities()`; `sharedLevels()` unchanged)
- [ ] T034 [P] [US5] The same for apps/api/app/Domain/Help/Services/HelpAccess.php
- [ ] T035 [P] [US5] The same for apps/api/app/Domain/Assistant/Services/AssistantAccess.php
- [ ] T036 [P] [US5] Change apps/api/app/Domain/Administration/Services/OrganizationAdministrationAuthorization.php: `allows()` reads the snapshot (no `fresh()`), and `withinOrganization()` delegates to `OrganizationContext::run()`
- [ ] T037 [US5] Define tenant permission gates over the snapshot in apps/api/app/Providers/AppServiceProvider.php, and set `register_permission_check_method` to false in apps/api/config/permission.php, so no check reads an ambient team
- [ ] T038 [US5] Delete apps/api/app/Domain/DeviceProfiles/Policies/DeviceProfilePolicy.php (FR-017: the domain services are the single definition)
- [ ] T039 [US5] Use `snapshotFor()` in apps/api/app/Domain/Shared/Http/Resources/OrganizationResource.php and AuthenticatedUserResource.php (`/me`, with memberships and roles batch-loaded for all the user's organizations), apps/api/app/Domain/Notifications/Http/Controllers/NotificationCenterController.php and apps/api/app/Domain/Automation/Http/Controllers/NotificationSettingsController.php
- [ ] T040 [US5] Write apps/api/tests/Feature/Tenancy/PermissionResolutionTest.php. Adapter candidate activation builds one snapshot. `GET devices/{device}` runs at most 2 authorization queries (baseline 4). `/me` resolves at most one snapshot per organization. A revoked role applies on the next request (FR-015). Measure with the query log and the array cache, as at baseline (SC-004)

**Checkpoint**: US5 acceptance scenarios 1 to 4 pass. Scenarios 5 and 6 complete in
PR 3 (T049, T050 and T056).

---

## Phase 5: User Story 3 - Background work and assistant tools act within one organization (Priority: P3) (PR 3)

**Goal**: Every job, worker step, scheduled task, runtime call and tool call runs in an
explicit context. Work that spans organizations is declared.

**Requirements**: FR-004, FR-016 (remaining copies), FR-018 to FR-022; SC-007, SC-008.

**Independent Test**: `php artisan test --filter=BackgroundIsolation` passes (quickstart
B3), and the rebuilt workers complete an alert email, an assistant answer and a webhook
delivery.

- [ ] T041 [US3] Add `RunsInOrganization`, `PlatformWide`, the job middleware `EnterOrganizationForJob` and the `PlatformWork` enum with its 17 cases and `reason()` (data-model.md section 4) in apps/api/app/Domain/Authorization/Tenancy/. The middleware loads the organization and principal in platform mode, re-establishes access (member or grant; application not revoked), runs the job in `run()`, and otherwise deletes the job, logging `job.principal_lost_access`
- [ ] T042 [US3] Add a `JobProcessing` listener in apps/api/app/Providers/AppServiceProvider.php that resets the permission registrar's team to null and asserts no active context (FR-022)
- [ ] T043 [P] [US3] Make apps/api/app/Domain/Assistant/Jobs/RunAssistant.php implement `RunsInOrganization` (the conversation's organization and owner) and use the middleware
- [ ] T044 [P] [US3] Make apps/api/app/Domain/Automation/Jobs/DeliverAlertEmail.php implement `RunsInOrganization` (the alert's organization and the recipient); a lost recipient still ends as `cancelled` with today's diagnostic
- [ ] T045 [P] [US3] Make apps/api/app/Domain/DeviceAdapters/Jobs/DeployAdapter.php implement `RunsInOrganization` (the adapter's organization and `Principal::platform(PlatformWork::AdapterDeployment)`)
- [ ] T046 [P] [US3] Make apps/api/app/Domain/Notifications/Jobs/DeliverNotificationEmail.php `PlatformWide` (`OperatorNotifications`) and apps/api/app/Domain/Authentication/Notifications/PasswordResetNotification.php `PlatformWide` (`Account`)
- [ ] T047 [US3] Wrap the scan in apps/api/app/Domain/Automation/Console/AutomationWorker.php in `platform(AutomationDispatch)`, and run each action in apps/api/app/Domain/Automation/Services/DagActions.php (`tick`, `authorizeDispatch`) inside `run($organization, Principal::user($deployment->creator))`
- [ ] T048 [US3] Wrap the scan in apps/api/app/Domain/Integrations/Console/WebhookWorker.php in `platform(WebhookDispatch)`, and run each webhook in apps/api/app/Domain/Integrations/Services/WebhookDispatch.php inside `run($organization, Principal::application(...))`
- [ ] T049 [US3] Run the scheduled tasks in apps/api/routes/console.php under `platform(Scheduler)`, and the commands in apps/api/app/Console/Commands/ under `platform(Console)`, using `run()` for each organization step. This replaces the switching block in BootstrapStaging.php:45-87
- [ ] T050 [P] [US3] Replace the switching blocks in apps/api/database/seeders/DevicePermissionSeeder.php, DeviceProfilePermissionSeeder.php and OrganizationSeeder.php (`platform(Seeding)` plus `run()`) and in apps/api/app/Domain/Dashboards/Services/DashboardPermissionBackfill.php (`platform(Backfill)` plus `run()`)
- [ ] T051 [US3] Run apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php under `platform(RuntimeSync)` (`state`, `claim`, `ack`, `automationCommandCheck`) and `platform(RuntimeEvents)` (`event`), with `run($organization, ...)` around the changes for each organization in `apply()`. Run `AdapterController::event` (apps/api/app/Domain/DeviceAdapters/Http/AdapterController.php) under `platform(AdapterEvents)` plus `run()` for the tenant's organization
- [ ] T052 [US3] Call `OrganizationContext::refresh()` at the start of each tool call in apps/api/app/Domain/Assistant/Tools/WorkflowAssistantTools.php, ProfileAssistantTools.php, AdapterAssistantTools.php and ApplyProfileSection.php (FR-015)
- [ ] T053 [US3] Run `/internal/ops/metrics` (apps/api/routes/web.php, apps/api/app/Support/Operations.php) under `platform(OpsMetrics)`, `GET /api/v1/me` under `platform(AccountOverview)` and `GET /api/v1/notifications/events` under `platform(NotificationCentre)`
- [ ] T054 [US3] Write apps/api/tests/Feature/Architecture/QueuedJobContextTest.php: every class implementing `ShouldQueue` implements exactly one of `RunsInOrganization` and `PlatformWide`
- [ ] T055 [US3] Write apps/api/tests/Feature/Tenancy/BackgroundIsolationTest.php with one case per inventory item: 5 job classes, 2 worker loops, 4 scheduled tasks, 4 tool classes and runtime events. Each item: it cannot act on B's record; with its principal's access lost, it has no side effects; with no context (`withoutOrganizationContext`), tenant work throws `MissingOrganizationContext`; a worker that processes B's job then A's keeps nothing of B (SC-007)
- [ ] T056 [US3] Write apps/api/tests/Feature/Architecture/OrganizationSwitchingTest.php: `setPermissionsTeamId` appears only in apps/api/app/Domain/Authorization/Tenancy/OrganizationContext.php across apps/api/app and apps/api/database (SC-008)

**Checkpoint**: Every entry point enters a context, so global scopes can now fail closed
safely.

---

## Phase 6: User Story 2 - Organization scoping is structural for every tenant request (Priority: P2) (PR 4 to PR 9)

**Goal**: Records, references and lists are confined by the scopes and scoped bindings
instead of hand-written checks. A record from another organization behaves exactly like
one that does not exist.

**Requirements**: FR-005 to FR-012, FR-033 (self-test cases); SC-002, SC-003, SC-006.

**Independent Test**: The walker passes with the domain's known gaps removed. The
self-test fails for each of the domain's models when its scope is disabled. A test-only
endpoint with no hand-written check passes the walker (SC-006).

### PR 4: primitives and the Devices domain (48 operations)

- [ ] T057 [US2] Implement `OrganizationScope` (organization mode filters by `<table>.organization_id`, platform mode applies no filter, no context throws), `BelongsToOrganization` ("`organization_id` defaults to the context's organization, and a different value throws" on creating; changing it throws on updating), `BelongsToOrganizationThrough` (`whereHas(<parent relation>)`), `TenantTable::query()` and the `TenantRecord::exists()` validation rule in apps/api/app/Domain/Authorization/Tenancy/, with tests in apps/api/tests/Feature/Tenancy/OrganizationScopeTest.php. The tests cover platform rows (null `organization_id`, for example a platform device profile) being invisible in organization mode (FR-011), the creating and updating guards (FR-012), and the no-context exception (FR-004). Add the testing-only hook `OrganizationScope::disableFor()`
- [ ] T058 [US2] Write apps/api/tests/Feature/Architecture/ModelClassificationTest.php (every model under app/Domain/*/Models is in exactly one class of data-model.md section 5; allow-list mode until T099) and apps/api/tests/Feature/Architecture/RawTenantTableTest.php (`DB::table()` on the tables in data-model.md section 5.5 outside `TenantTable` and declared platform work is listed; fails when the list grows)
- [ ] T059 [US2] Add `BelongsToOrganization` to `Device`, `Site`, `SparkplugConnection`, `SparkplugGateway`, `DiscoveryCandidate` and `DeviceOnboarding`. Add `BelongsToOrganizationThrough` (parent `device`) to `DeviceCommand`, `DeviceOperation` and `DeviceConfiguration`, adding their `device()` relations, in apps/api/app/Domain/Devices/Models/
- [ ] T060 [US2] Add `devices`, `sites`, `connections`, `gateways` and `candidates` relations to apps/api/app/Domain/Shared/Models/Organization.php, and `->scopeBindings()` to the tenant group in apps/api/app/Domain/Devices/routes/api.php and to apps/api/app/Domain/Overview/routes.php
- [ ] T061 [US2] Replace hand-written reference lookups with `TenantRecord::exists()` or scoped lookups in DeviceController, OnboardingController, DiscoveryController, TelemetryCaptureController and SiteController (apps/api/app/Domain/Devices/Http/Controllers/). Use `TenantTable` for `devices` and `device_audit_events` reads
- [ ] T062 [US2] Remove the hand-written organization and parent checks in the Devices controllers and OverviewController (apps/api/app/Domain/Overview/OverviewController.php), and the resource argument's organization comparison in `DeviceAuthorization::authorize()`, keeping the permission check
- [ ] T063 [US2] Answer `operation_uuid` collisions in apps/api/app/Domain/Devices/Services/DeviceLifecycleService.php and `request_uuid` collisions in OnboardingController with "409, 'This request identifier was already used for a different request.'" (contracts/error-responses.md, research D10), with a test that a key used only in B is answered exactly like a key A reused for a different request (FR-009)
- [ ] T064 [US2] Add self-test cases for the 9 Devices models to apps/api/tests/Feature/Isolation/TenantIsolationSelfTest.php, plus the SC-006 test-only route that reads a `Device` with no hand-written check and must pass C1 to C4. Remove the Devices known gaps. Record `EXPLAIN` for the `device_commands` and `device_configurations` parent scopes in the PR

### PR 5: device profiles (30 operations)

- [ ] T065 [US2] Add `BelongsToOrganization` to apps/api/app/Domain/DeviceProfiles/Models/DeviceProfile.php, and `BelongsToOrganizationThrough` to `DeviceProfileArtifact`, `ProfileParameter`, `ProfileParameterGroup`, `ProfileAlarmTemplate`, `TransportBinding` (parent `profile`) and `BindingParameterMapping` (parent `binding`). Map `{group}`, `{alarm}` and `{binding}` with `childRouteBindingRelationshipName()`. Add `Organization::profiles()`, and `->scopeBindings()` in apps/api/app/Domain/DeviceProfiles/routes/api.php
- [ ] T066 [US2] Remove `ensureOrganizationProfile()`, the parent `ensure*`/`authorizeGroup` checks and the inline organization check from the 8 controllers in apps/api/app/Domain/DeviceProfiles/Http/Controllers/, and delete `DeviceProfileAuthorization::ensureOrganizationProfile()`
- [ ] T067 [US2] Add self-test cases for the 7 profile models, and remove the profile known gaps

### PR 6: automation (42 operations)

- [ ] T068 [US2] Add `BelongsToOrganization` to apps/api/app/Domain/Automation/Models/Workflow.php and Alert.php, and `BelongsToOrganizationThrough` to `Deployment`, `Scenario` (parent `workflow`) and `AlertDelivery` (parent `alert`) with their relations. Add `Organization::workflows()`/`alerts()` and `Workflow::scenarios()`, and `->scopeBindings()` on both groups in apps/api/app/Domain/Automation/routes/api.php
- [ ] T069 [US2] Use `TenantTable` for `automation_actions` and `automation_settings` in DagController, DagAuthorization, DagActions and OverviewController. Make the command lookup in `DagController::reconcile` scoped
- [ ] T070 [US2] Answer deployment `operation_uuid` collisions in apps/api/app/Domain/Automation/Services/WorkflowDeploymentService.php and DagDeployment.php with the uniform 409. Remove the hand-written checks in WorkflowController, DagController, ScenarioController, AlertController and NotificationSettingsController. Use `TenantRecord` for `alert_uuids`, `user_id`, `recipient_ids` and workflow binding references; v1 and v2 permission families unchanged
- [ ] T071 [US2] Add self-test cases for the 5 automation models, and remove the automation known gaps

### PR 7: dashboards, geospatial, help and context (27 operations)

- [ ] T072 [US2] Add `BelongsToOrganization` to `Dashboard`, `Geofence`, `GeofenceActivationBatch`, `GeofenceAssignment` and `LocationBinding`, and `BelongsToOrganizationThrough` to `DashboardRevision` (parent `dashboard`). Add `Organization::dashboards()`/`geofences()` and `Geofence::batches()`, and `->scopeBindings()` in apps/api/app/Domain/{Dashboards,Geospatial}/routes/api.php and apps/api/app/Domain/Help/routes.php
- [ ] T073 [US2] Use `TenantTable` for `geofence_events`. Remove the organization comparison in `DashboardController::authorizeDashboard()`, the batch organization checks in GeofenceController, and the hand-written filters in LocationMapController and LocationBindingController. Validate dashboard share targets through scoped queries
- [ ] T074 [US2] Add self-test cases for the 6 models, and remove the known gaps

### PR 8: adapters, applications and the integration API (45 operations)

- [ ] T075 [US2] Add `BelongsToOrganization` to `DeviceAdapter`, `AdapterCandidate`, `AdapterCredential`, `AdapterOperation`, `AdapterTenant`, `DeviceInstallation` and `IntegrationApplication`. Add `BelongsToOrganizationThrough` to `AdapterProposal`, `AdapterRevision` (parent `adapter`), `Webhook` (parent `application`) and `WebhookDelivery` (parent `webhook`) with their relations. Add `Organization::adapters()`/`applications()` and `DeviceAdapter::credentials()`/`proposals()`, and `->scopeBindings()` in apps/api/app/Domain/DeviceAdapters/routes.php and the application group in apps/api/app/Domain/Integrations/routes.php
- [ ] T076 [US2] Use `TenantTable` for `integration_streams` and `integration_events` (EventJournal, GeofenceEventJournal, `DagActions::journal`, EventController, WebhookDispatch). Integration controllers drop their organization filters and keep their device-grant filters. Answer adapter `request_uuid` collisions with the uniform 409. Remove the parent checks in AdapterController
- [ ] T077 [US2] Add self-test cases for the 11 models (C5 to C7 stay green), and remove the known gaps

### PR 9: assistant and organization administration (25 operations)

- [ ] T078 [US2] Add `BelongsToOrganization` to `AssistantConversation` and `OrganizationInvitation`, and `BelongsToOrganizationThrough` to `AssistantProposal`, `AssistantRun` and `AssistantSource` (parent `conversation`). Add `Organization::conversations()`, `invitations()` and `members()` (over `organization_user`), and `->scopeBindings()` in apps/api/app/Domain/Assistant/routes/api.php and the organization group in apps/api/app/Domain/Administration/routes/api.php
- [ ] T079 [US2] Remove the organization comparison in `AssistantAccess::conversation()` (keep the owner check), the organization checks in OrganizationInvitationController and `OrganizationRoleController::ensureRoleBelongsToOrganization()` (now `organization->roles()`), and the duplicate membership check in OrganizationMembershipManager that the `members` binding now covers; `Role` stays explicitly scoped
- [ ] T080 [US2] Add self-test cases for the 5 models and the `member`, `role` and `invitation` bindings, and remove the known gaps

**Checkpoint**: All 217 operations are structurally scoped, and no hand-written
organization check remains in a controller.

---

## Phase 7: User Story 6 - Platform administrators act through explicit grants (Priority: P6) (PR 10)

**Goal**: Super administrators keep every capability through an explicit, recorded
platform grant, with no bypass.

**Requirements**: FR-026 to FR-028; SC-009.

**Independent Test**: `php artisan test --filter=PlatformGrant` passes (quickstart B6),
and removing the role from a test account turns its access to an unjoined organization
into 404.

- [ ] T081 [US6] Add `ACT_IN_ORGANIZATIONS = 'PlatformAdministration.act-in-organizations'` to apps/api/app/Domain/Authorization/Permissions/PlatformAdministrationPermission.php. Add `SUPER_ADMINISTRATOR = 'super-administrator'` to apps/api/app/Domain/Authorization/Enums/PlatformRoleName.php ("holding every `PlatformAdministrationPermission` case"), and exclude the grant from `PLATFORM_ADMINISTRATOR->permissions()`
- [ ] T082 [US6] Write a data migration in apps/api/database/migrations/ that creates the permission (guard `web`) and the system role, and attaches the role to every user with `is_super_admin = true`, idempotently, logging the count; with a test
- [ ] T083 [US6] Attach the role in apps/api/app/Console/Commands/BootstrapAdministrator.php (`deployment:administrator`), BootstrapStaging.php and apps/api/database/seeders/PlatformRoleSeeder.php
- [ ] T084 [US6] Evaluate the grant in apps/api/app/Domain/Authorization/Tenancy/PermissionSnapshot.php (`grant`, `grantUsed`; a non-member holder gets every tenant permission, including outside the ceiling; a member gets roles first), and admit a grant-holding non-member in EnterOrganization.php
- [ ] T085 [US6] Add the `platform_access_events` migration with the columns of data-model.md section 6: `user_id` bigint FK `nullOnDelete`; `organization_id` bigint FK `cascadeOnDelete`; `context` string(16) in `request`/`job`/`tool`; `operation` string(255); `permissions` jsonb with at least one entry; `write` boolean; `request_id` nullable uuid; `occurred_at` timestampTz; indexes `(organization_id, occurred_at)` and `(user_id, occurred_at)`. Add the `PlatformAccessEvent` model (platform class). Write one row when a request (middleware terminate), job (`finally`) or tool call ends with a non-empty `grantUsed`. Add config `authorization.platform_access_retention_days` (default 365) and daily pruning under `platform(Scheduler)` in apps/api/routes/console.php
- [ ] T086 [US6] Remove the 14 bypass sites (the 12 `is_super_admin ||` checks in the 6 services, the middleware's, `PlatformAuthorization::allows()`'s) and `Gate::before` in apps/api/app/Providers/AppServiceProvider.php. Take `is_super_admin` out of `#[Fillable]` in apps/api/app/Domain/Shared/Models/User.php
- [ ] T087 [US6] Migrate the tests that act as a super administrator (tests/Feature/Domain/Assistant/WorkflowAssistantTest.php, Automation/ScenarioTest.php, Devices/DeviceAdapterTest.php, Devices/DeviceOnboardingTest.php, Devices/RuntimeStatusTest.php, Geospatial/GeofenceTest.php) to members, or to an explicit grant holder where platform access is the point. Update tests/Feature/Domain/Authorization/SuperAdminAuthorizationTest.php to assert the grant instead of a bypass
- [ ] T088 [US6] Write apps/api/tests/Feature/Tenancy/PlatformGrantTest.php: every platform administrator journey of Story 6; a grant-holding non-member behaves like an Organization Admin on every portal operation (walker variant) and writes one row per request; a member with partial roles writes a row listing only the missing permissions; removing the role gives 404; a `platform-administrator` without the grant cannot enter an unjoined organization (SC-009)
- [ ] T089 [US6] Write apps/api/tests/Feature/Architecture/NoSuperAdminBypassTest.php: no `is_super_admin` in apps/api/app/Domain/**/Services, apps/api/app/Providers or apps/api/app/Domain/Authorization/Http/Middleware
- [ ] T090 [P] [US6] Update the platform administration section of docs/features/access.md (the grant, the role, the record, retention)

---

## Phase 8: User Story 4 - Integration applications see only their organization, devices and granted data (Priority: P4) (PR 11)

**Goal**: Event types in the feed and webhooks follow the application's read
abilities (Q1). Organization and device confinement are proven by C5 to C7 (PR 1) and
held by PR 8.

**Requirements**: FR-023 to FR-025, FR-035; SC-010.

**Independent Test**: `php artisan test --filter='TenantIsolation|IntegrationEventAbilities'`
passes for every combination in contracts/event-abilities.md (quickstart B4).

- [ ] T091 [US4] Add the `IntegrationEventType` enum with `ability()` (alert types → `alerts:read`, geofence types → `geofences:read`, `automation.triggered.v1` → `events:read` only) in apps/api/app/Domain/Integrations/IntegrationEventType.php
- [ ] T092 [US4] Make apps/api/app/Domain/Integrations/Services/EventJournal.php, apps/api/app/Domain/Geospatial/Services/GeofenceEventJournal.php and `DagActions::journal` take the enum, and add a test that the enum covers every type written and every type listed in docs/reference/events.md
- [ ] T093 [US4] Filter the feed in apps/api/app/Domain/Integrations/Http/EventController.php by the types readable with abilities held on both the application and the token; positions advance over skipped events, and cursors are unchanged
- [ ] T094 [US4] Filter the scan in apps/api/app/Domain/Integrations/Services/WebhookDispatch.php by the application's abilities, and cancel a pending delivery whose type is no longer readable, with the diagnostic "The application no longer reads this event type."
- [ ] T095 [US4] Add walker check C8 and apps/api/tests/Feature/Domain/Integrations/IntegrationEventAbilitiesTest.php covering the example table in contracts/event-abilities.md, events recorded before the change, and pending deliveries cancelled before sending (SC-010)
- [ ] T096 [US4] Update the `GET events` and webhook descriptions in contracts/openapi/supplements/integration.yaml, run `php artisan contract:export`, and confirm the breaking-change gate sees only description changes
- [ ] T097 [P] [US4] Update docs/features/integrations.md:125, add the ability column to docs/reference/events.md, add a release note to packages/integration-sdk/README.md, and close "Event feed scoping" in docs/roadmap.md

---

## Phase 9: Polish and close-out (PR 12)

**Requirements**: FR-011 (strict), FR-031, FR-034; SC-001, SC-002, SC-005.

- [ ] T098 Delete apps/api/app/Domain/Authorization/Http/Middleware/ResolveOrganizationContext.php and every remaining reference
- [ ] T099 Switch ModelClassificationTest and RawTenantTableTest to strict (no allow-list), and assert that apps/api/tests/Support/Isolation/known-gaps.php is empty (SC-001, SC-002)
- [ ] T100 [P] Close "Central tenant scoping" in docs/roadmap.md; add "global scopes need a context in console code" to docs/dev/gotchas.md; describe the organization context in docs/architecture/overview.md
- [ ] T101 Run quickstart B1 to B7 on the rebuilt stack (`api` plus every service built from the API image) and record the results in the PR: `php artisan test` on PostgreSQL, `php artisan contract:coverage`, `php artisan contract:export --check`, and `php artisan route:list --json` unchanged except for middleware names (SC-005)

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)** → **US1 (Phase 2)**: PR 1, no other dependencies.
- **Foundational (Phase 3)** and **US5 (Phase 4)**: PR 2, after PR 1.
- **US3 (Phase 5)**: PR 3, after PR 2.
- **US2 (Phase 6)**: PRs 4 to 9, after PR 3. T057 and T058 come first in PR 4; PRs 5 to
  9 depend on PR 4's primitives and can then run in any order or in parallel.
- **US6 (Phase 7)**: PR 10, after PR 2. It is simpler after PRs 4 to 9, but does not
  require them.
- **US4 (Phase 8)**: PR 11, after PR 1 only. It can run in parallel with PRs 2 to 10.
- **Polish (Phase 9)**: PR 12, after PRs 4 to 11.

### User story dependencies

- US1: none.
- US5: Foundational.
- US3: Foundational.
- US2: Foundational and US3 (global scopes fail closed without a context).
- US6: Foundational.
- US4: US1. Organization confinement for integration routes comes from PR 8 (US2).

### Within each phase

The walker or test task lands with, or before, the change it proves. Every domain
pull request removes its known gaps and adds self-test cases in the same pull request.

### Parallel opportunities

- T002 and T003. T010 (request fixtures) alongside T008 and T009.
- T026 and T027 alongside T020 to T025.
- T031 to T036: one service each.
- T043 to T046: one job each. T050 alongside T049.
- PRs 5 to 9 in parallel once PR 4 has merged.
- PR 11 in parallel with PRs 2 to 10.

## Parallel example: User Story 5

```text
Task: "T031 [P] [US5] DeviceProfileAuthorization reads the snapshot"
Task: "T032 [P] [US5] DagAuthorization reads the snapshot"
Task: "T033 [P] [US5] DashboardAccess reads the snapshot"
Task: "T034 [P] [US5] HelpAccess reads the snapshot"
Task: "T035 [P] [US5] AssistantAccess reads the snapshot"
Task: "T036 [P] [US5] OrganizationAdministrationAuthorization reads the snapshot"
```

## Implementation strategy

### MVP first

1. PR 1 (Phases 1 and 2): the walker on all 217 operations, with known gaps listed.
2. PR 2 (Phases 3 and 4): membership before binding, non-member 404, one not-found
   body and permissions resolved once.
3. **Stop and validate**: the known gaps hold only structural items, and quickstart B2
   and B5 pass on the stack.

### Incremental delivery

PR 3 makes background work safe. PRs 4 to 9 migrate one domain at a time, each green
and each shrinking `known-gaps.php`. PR 10 removes the bypass. PR 11 changes event
delivery. PR 12 closes out. Every pull request rebuilds `api` and the services built
from the API image, and exercises its quickstart scenario (constitution IX).

## Notes

- **Every pull request ends the same way (constitution IX)**: the PostgreSQL CI job is
  green; `api` and every service built from the API image are rebuilt (`automation-worker`,
  `alerts-worker`, `webhooks-worker`, `assistant-worker`, `scheduler`, and
  `adapter-worker` with the adapter overlay); and the quickstart scenario for the
  pull request is exercised on the stack and recorded in the PR (PR 1: B1; PR 2: B2
  and B5; PR 3: B3; PRs 4 to 9: B1 and B2 for the domain; PR 10: B6; PR 11: B4;
  PR 12: B1 to B7).
- [P] tasks touch different files and do not depend on incomplete tasks.
- Commit after each task or logical group; each pull request ticks its tasks here.
- Quote data-model.md constraints verbatim where a task creates a column or enum.
- The spec folder freezes when PR 12 merges (constitution, "Specs are history").
