# Data Model: Structural Tenant Scoping

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md) section 13

Paths are relative to `apps/api/`. Only two things are persisted: one new table
(section 6) and new rows for a platform permission and role (section 7). Everything
else is a runtime object, a model classification or a test fixture.

## Overview

| # | Entity | Kind | Spec entity |
| --- | --- | --- | --- |
| 1 | `OrganizationContext` | Runtime object, scoped to one request, job or tool call | Organization context |
| 2 | `Principal` | Value object | Principal |
| 3 | `PermissionSnapshot` | Runtime object, memoized in the context | Permission set |
| 4 | `PlatformWork` | PHP enum | Platform-wide work declaration |
| 5 | Model classification | Traits on Eloquent models, checked by an architecture test | Tenant-owned record, Shared data |
| 6 | `platform_access_events` | New table | Platform grant (its record) |
| 7 | `super-administrator` role and `PlatformAdministration.act-in-organizations` permission | New rows | Platform grant |
| 8 | `IntegrationEventType` | PHP enum | Integration event |
| 9 | Isolation fixtures | Test support files | Isolation exemption |

## 1. `OrganizationContext`

`App\Domain\Authorization\Tenancy\OrganizationContext`, bound with `scoped()`. The full
interface is in [contracts/organization-context.md](contracts/organization-context.md).

| Field | Type | Rules |
| --- | --- | --- |
| `mode` | `none` \| `organization` \| `platform` | `none` at the start of every request and job |
| `organization` | `?Organization` | Set only in `organization` mode; never soft-deleted |
| `principal` | `?Principal` | Required in `organization` and `platform` modes |
| `work` | `?PlatformWork` | Required in `platform` mode |
| `snapshots` | `array<int, PermissionSnapshot>` | Keyed by organization id; discarded with the context |

**Transitions**:

- `none → organization`: through `EnterOrganization`, `AuthenticateApplication`,
  `EnterOrganizationForJob` or `run()`.
- `none → platform`: through `platform(PlatformWork, Closure)`.
- Nested `run()` or `platform()` calls push the previous state and restore it in
  `finally`, together with the permission registrar's team id.

**Invariants**:

- The registrar's team id equals `organization->id` in organization mode and is null
  otherwise.
- A queue worker starts every job in `none` mode.
- An organization-owned model queried in `none` mode throws `MissingOrganizationContext`.

## 2. `Principal`

| Kind | Fields | Created by |
| --- | --- | --- |
| `user` | `User $user` | Session requests; jobs that act for a person |
| `application` | `IntegrationApplication $application`, `PersonalAccessToken $token` | `AuthenticateApplication` |
| `platform` | `PlatformWork $work` | Declared platform work; system jobs inside one organization (for example `adapter-deployment`) |

A principal never comes from a request body. A job builds its principal from its own
stored identifiers (FR-018).

## 3. `PermissionSnapshot`

| Field | Type | Source |
| --- | --- | --- |
| `organizationId` | int | context |
| `member` | bool | Query 1: `organization_user` left joined to `model_has_roles` for the organization's team (membership and role ids together) |
| `permissions` | `array<string, true>` | The role permissions from the package's cached role-permission registry (no query), plus query 2: direct permissions from `model_has_permissions` for the team |
| `grant` | bool | `PlatformAdministration.act-in-organizations` held through platform roles (PR 10) |
| `grantUsed` | `array<string, true>` | Permissions allowed only because of `grant`; written to `platform_access_events` when the context ends |
| `abilities` | `array<string, true>` | Applications only: abilities held by both the application and the token |

**Rules**:

- A snapshot is built at most once per principal and organization in a context
  (FR-013).
- A tool call refreshes it (FR-015).
- `allows($permission)` is `member && in permissions`, or `grant` (which marks the
  permission in `grantUsed` when membership or roles would deny it).
- Outcomes must equal today's per-service results; an equivalence test enforces this
  in PR 2.

## 4. `PlatformWork`

`App\Domain\Authorization\Tenancy\PlatformWork`, a string-backed enum. Each case has a
`reason()`. Adding a case is a reviewed change (FR-021).

| Case | Value | Reason |
| --- | --- | --- |
| `RuntimeSync` | `runtime-sync` | The runtime reads `/internal/devices/state` and claims outbox events for every organization |
| `RuntimeEvents` | `runtime-events` | Runtime events name their organization; each is applied inside that organization after its identities match |
| `AdapterEvents` | `adapter-events` | The adapter tenant token identifies the organization; the event is applied inside it |
| `AdapterDeployment` | `adapter-deployment` | A system job deploys an adapter revision a person approved |
| `AutomationDispatch` | `automation-dispatch` | The automation worker scans every organization's accepted actions; each runs as the deployment's creator |
| `WebhookDispatch` | `webhook-dispatch` | The webhook worker scans every enabled webhook; each runs as its application |
| `OperatorNotifications` | `operator-notifications` | Platform alerts emailed to super administrators |
| `Account` | `account` | Password reset and other account mail; no tenant data |
| `Scheduler` | `scheduler` | Heartbeat, `assistant:recover`, `devices:prune-ledgers`, ops bucket cleanup and `platform_access_events` pruning |
| `OpsMetrics` | `ops-metrics` | `/internal/ops/metrics` counts across organizations |
| `PlatformAdministration` | `platform-administration` | `/api/v1/admin` routes |
| `AccountOverview` | `account-overview` | `/api/v1/me` lists the user's organizations with capabilities |
| `NotificationCentre` | `notification-centre` | `/api/v1/notifications/events` reads several organizations through per-organization snapshots |
| `Console` | `console` | Bootstrap, staging, profile preparation and broker commands; each organization step uses `run()` |
| `Seeding` | `seeding` | Database seeders |
| `Backfill` | `backfill` | Data migrations and backfills such as `DashboardPermissionBackfill` |
| `TestFixtures` | `test-fixtures` | Tests that build fixtures outside a request (testing environment only) |

## 5. Model classification

Every Eloquent model under `app/Domain/*/Models` belongs to exactly one class. An
architecture test fails for an unclassified model (FR-011).

### 5.1 Organization-owned: `BelongsToOrganization` (23)

`OrganizationInvitation`, `AssistantConversation`, `Alert`, `Workflow`, `Dashboard`,
`AdapterCandidate`, `AdapterCredential`, `AdapterOperation`, `AdapterTenant`,
`DeviceAdapter`, `DeviceInstallation`, `DeviceProfile`, `Device`, `DeviceOnboarding`,
`DiscoveryCandidate`, `Site`, `SparkplugConnection`, `SparkplugGateway`, `Geofence`,
`GeofenceActivationBatch`, `GeofenceAssignment`, `LocationBinding`,
`IntegrationApplication`.

The trait gives these models:

- The `OrganizationScope` global scope.
- A `creating` hook: `organization_id` defaults to the context's organization, and a
  different value throws.
- An `updating` hook: changing `organization_id` throws.

`device_profiles.organization_id` is nullable; its platform rows are invisible in
organization mode.

### 5.2 Through a parent: `BelongsToOrganizationThrough` (20)

These models are looked up directly by an identifier from a request.

| Model | Parent relation |
| --- | --- |
| `DeviceCommand`, `DeviceOperation`, `DeviceConfiguration` | `device` |
| `Deployment`, `Scenario` | `workflow` |
| `AlertDelivery` | `alert` |
| `DashboardRevision` | `dashboard` |
| `Webhook` | `application` |
| `WebhookDelivery` | `webhook` |
| `DeviceProfileArtifact`, `ProfileParameter`, `ProfileParameterGroup`, `ProfileAlarmTemplate`, `TransportBinding` | `profile` |
| `BindingParameterMapping` | `binding` |
| `AssistantProposal`, `AssistantRun`, `AssistantSource` | `conversation` |
| `AdapterProposal`, `AdapterRevision` | `adapter` |

### 5.3 Reached only through a scoped parent (5)

`DashboardShare`, `ProfileAlarmTemplateParameter`, `ProfileCalculation`,
`ProfileCalculationInput`, `DeviceProfileActivationOutbox`. No trait. A direct lookup
by identifier from input is forbidden, and a test asserts each is only reached through
its parent relation.

### 5.4 Platform, shared or explicitly scoped (7)

| Model | Why it is not globally scoped |
| --- | --- |
| `Organization` | It is the tenant |
| `User` | Spans organizations; `{member}` binds through `organization->users()` |
| `PlatformRole` | Platform administration |
| `Role` (permission package) | Team-keyed and loaded across teams by the package's cache; scoped by `OrganizationRoleManager` and `organization->roles()` |
| `TelemetryRetentionSetting` | A platform default row plus per-organization rows; read only by `RetentionService` |
| `NotificationEvent` | Platform rows plus several organizations; filtered explicitly per organization snapshot |
| `DeviceOutbox` | The runtime ledger, claimed across organizations under `runtime-sync` |

`DeviceModel` is the abstract base class and is not classified.

### 5.5 Raw tables with an organization column

These are read and written through `TenantTable::query()` in organization mode:
`automation_actions`, `automation_settings`, `integration_streams`,
`integration_events`, `geofence_events`, `device_audit_events`, `devices`,
`organization_invitations`, `organizations` (platform work only). An architecture test
lists every `DB::table()` call on these tables outside `TenantTable` and declared
platform work, and fails when that list grows. PR 12 makes the list strict (empty).

### 5.6 Relations for scoped bindings and parent scopes

Many tenant models have no relations today; `Workflow`, `Geofence`, `Scenario`,
`Deployment` and `Webhook` define none. Relations that already exist are marked
"exists". The rest are added in the domain pull request that needs them.

| On | Child relations (scoped bindings; named after the route parameter) |
| --- | --- |
| `Organization` | `devices`, `profiles`, `workflows`, `adapters`, `dashboards`, `conversations`, `applications`, `alerts`, `geofences`, `sites`, `connections`, `gateways`, `candidates` (discovery), `invitations`, `members` (over the `organization_user` pivot), `roles` (exists) |
| `DeviceProfile` | `parameters` (exists). `{group}`, `{alarm}` and `{binding}` map to `parameterGroups`, `alarmTemplates` and `transportBindings` (exist) through a `childRouteBindingRelationshipName()` override |
| `Device` | `commands` (exists) |
| `DeviceAdapter` | `candidates` (exists), `credentials`, `proposals` |
| `AssistantConversation` | `proposals`, `runs` and `sources` (exist) |
| `Workflow` | `scenarios` |
| `Geofence` | `batches` |

| On | Parent relation (`belongsTo`, for `BelongsToOrganizationThrough`) |
| --- | --- |
| `DeviceCommand`, `DeviceOperation`, `DeviceConfiguration` | `device` |
| `Deployment`, `Scenario` | `workflow` |
| `AlertDelivery` | `alert` |
| `DashboardRevision` | `dashboard` |
| `Webhook` | `application` |
| `WebhookDelivery` | `webhook` |
| Profile children and `DeviceProfileArtifact` | `profile` |
| `BindingParameterMapping` | `binding` |
| `AssistantProposal`, `AssistantRun`, `AssistantSource` | `conversation` |
| `AdapterProposal`, `AdapterRevision` | `adapter` |

## 6. `platform_access_events` (new table, PR 10)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint, primary key | |
| `uuid` | uuid | unique |
| `user_id` | bigint, foreign key `users`, `nullOnDelete` | integer user id (ADR-013) |
| `organization_id` | bigint, foreign key `organizations`, `cascadeOnDelete` | the organization acted in |
| `context` | string(16) | one of `request`, `job`, `tool` |
| `operation` | string(255) | `METHOD /path` from the contract key for requests; the job class or tool name otherwise |
| `permissions` | jsonb | sorted list of the tenant permissions that were allowed only because of the grant; at least one |
| `write` | boolean | true when the request method is not GET or HEAD, or the job or tool changed data |
| `request_id` | uuid, nullable | correlates with logs |
| `occurred_at` | timestampTz | when the context ended |

Indexes: `(organization_id, occurred_at)` and `(user_id, occurred_at)`.

Retention: rows older than `authorization.platform_access_retention_days` (default 365,
owner decision 2) are pruned daily by the `Scheduler` platform work. There is no API or
user interface in this spec.

## 7. Platform grant rows (data migration, PR 10)

- A permission `PlatformAdministration.act-in-organizations` (guard `web`), added to
  `PlatformAdministrationPermission`.
  `PlatformRoleName::PLATFORM_ADMINISTRATOR->permissions()` excludes it explicitly.
- A system platform role, key `super-administrator` and display name "Super
  Administrator", holding every `PlatformAdministrationPermission` case, including the
  grant.
- Every user with `is_super_admin = true` is attached to the role. The migration is
  idempotent and logs the count. `deployment:administrator` and `BootstrapStaging`
  attach it to the users they create.
- `is_super_admin` stays in the table as the platform-team identity. It is removed from
  `User`'s `#[Fillable]` and grants nothing by itself.

## 8. `IntegrationEventType` (PR 11)

| Case value | Required ability (application and, for the feed, token) |
| --- | --- |
| `alert.activated.v1`, `alert.cleared.v1`, `alert.acknowledged.v1` | `alerts:read` |
| `geofence.entered.v1`, `geofence.exited.v1`, `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1` | `geofences:read` |
| `automation.triggered.v1` | `events:read` (no other) |

Rules: [contracts/event-abilities.md](contracts/event-abilities.md).

## 9. Isolation fixtures (PR 1)

| File | Content | Format |
| --- | --- | --- |
| `tests/Support/Isolation/RecordKinds.php` | Route parameter or reference field → factory, parent parameter, marker | [contracts/isolation-walker.md](contracts/isolation-walker.md#record-kinds) |
| `tests/Support/Isolation/requests/<operationId>.php` | A valid request (query and body) for an operation with reference fields | [contracts/isolation-walker.md](contracts/isolation-walker.md#request-fixtures) |
| `tests/Support/Isolation/known-gaps.php` | `operationKey => [check, ...]` expected to fail; must shrink to empty | [contracts/isolation-walker.md](contracts/isolation-walker.md#known-gaps-and-exemptions) |
| `tests/Support/Isolation/exemptions.php` | `operationKey => reason` | [contracts/isolation-walker.md](contracts/isolation-walker.md#known-gaps-and-exemptions) |

## 10. Spec requirements to structures

| Requirement | Structure |
| --- | --- |
| FR-001 to FR-004 | `EnterOrganization`, `AuthenticateApplication`, `OrganizationContext` modes |
| FR-005, FR-006, FR-010 | `OrganizationScope`, `BelongsToOrganizationThrough`, `TenantTable`, the uniform not-found body |
| FR-007 | `scopeBindings()` with the relations in section 5.6 |
| FR-008 | `TenantRecord::exists()`, plus scoped Eloquent lookups |
| FR-009 | Scoped key lookups and collision handling (research D10) |
| FR-011 | Model classification (section 5) |
| FR-012 | `creating` and `updating` hooks |
| FR-013 to FR-017 | `PermissionSnapshot`, `run()`, and the domain services reading the snapshot |
| FR-018 to FR-022 | `RunsInOrganization`, `PlatformWide`, `EnterOrganizationForJob`, `PlatformWork`, the `JobProcessing` reset |
| FR-023 to FR-025 | `AuthenticateApplication`, `IntegrationEventType` |
| FR-026 to FR-028 | Sections 6 and 7 |
| FR-029 to FR-033 | Section 9 and the walker |
