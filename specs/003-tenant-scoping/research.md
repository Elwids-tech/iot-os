# Research: Structural Tenant Scoping

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-11, decisions added 2026-10-12 | **Baseline**: `main` at `51b1604` (inventory), `fd980fb` (decisions)

A factual inventory of how the control plane (`apps/api`) keeps one organization's
data away from another today: where the organization is resolved, how membership and
permissions are checked, how records named in a request are tied to the organization,
how integration applications, background work and the assistant are confined, and
what the existing tests prove. Paths are relative to `apps/api/` unless they start
with another top-level directory, and line numbers refer to the baseline commit.
Route counts come from `php artisan route:list --json -v` on the baseline. Query
counts come from a throwaway test run against the seeded demo organizations on
SQLite with the array cache (not committed). Sections 1 to 12 are the inventory
written for the specify step. Section 9 lists the options that were open at the
time. Section 13 records the plan step's decisions, which supersede section 9, in
the form Decision / Rationale / Alternatives.

Two roadmap items are this feature: **Central tenant scoping** and **Event feed
scoping** (`docs/roadmap.md:43-45,60-63`). The related **Module boundaries** item,
which covers controllers calling controllers and assistant tools building synthetic
requests (`docs/roadmap.md:46-49`), stays separate.

## 1. Key findings

1. **No unchecked record was found, and every check is hand-written.** On the 198
   portal routes under `api/v1/organizations/{organization}`, 140 routes bind 165
   records of 29 model types. Every binding is tied to the organization or to its
   parent by code in the controller or in a per-domain service, using 8 different
   mechanisms (section 5.2). This agrees with the earlier audit of all 57 controller
   files. On top of that, 127 hand-written `where('organization_id', $organization->id)`
   filters are spread over 45 files, along with 18 inline `organization_id ===` aborts
   and 38 parent-key aborts. Only 2 validation rules scope a referenced id to the
   organization (`Rule::exists(...)->where('organization_id', ...)`,
   `app/Domain/Devices/Http/Controllers/DeviceController.php:57`,
   `app/Domain/Automation/Http/Controllers/AlertController.php:108`).
2. **Route model binding is global and runs before the membership check.** Bound
   models resolve by `uuid` with no organization condition. There is no
   `scopeBindings()`, no custom binding resolver, and no global scope anywhere in
   `app/`. `Organization` defines only `users()`, `roles()` and `permissions()`
   (`app/Domain/Shared/Models/Organization.php:42-63`), so scoped bindings have no
   relations to use yet. Laravel's `SubstituteBindings` runs before the route-level
   `ResolveOrganizationContext`. A measured `GET devices/{device}` runs
   `select organizations where uuid`, then `select devices where uuid` (no
   organization filter), then the membership query. **Consequence (low severity):**
   an authenticated user who knows the UUID of an organization they do not belong to
   can tell whether any device UUID exists anywhere on the platform (403 if it
   exists, 404 if it does not). This was measured, and it applies to all 29 bound
   model types. **Members get a second signal (measured, debug off):** naming another
   organization's device returns `404 {"message": ""}`, because `DeviceAuthorization`
   calls `abort(404)`. A device that does not exist returns
   `404 {"message": "No query results for model [App\\Domain\\Devices\\Models\\Device] <uuid>"}`,
   from Laravel's `ModelNotFoundException` rendering
   (`vendor/laravel/framework/src/Illuminate/Foundation/Exceptions/Handler.php:773,1142-1143`).
   The bodies differ, and the second leaks a class name. The portal shows its friendly
   "This isn't available" text only for an empty or `Not Found` message
   (`apps/portal/src/components/forms.tsx:63-64`).
3. **The organization-switching block is copied into 9 files in `app/`**: 7 on the
   request path and 2 in maintenance code. It also appears in 3 seeders and 6 test
   files (section 4). The 7 request-path copies differ. Some reload the user's role
   relations (`unsetRelation`), one reloads the whole user (`fresh()`), and one
   method uses whatever organization happens to be active
   (`DeviceProfileAuthorization::authorize`, section 4.2).
4. **Membership and permissions are resolved again by every check.** Each
   per-domain capability call runs a membership query and then reloads the user's
   roles and direct permissions: 3 queries per call, measured. The middleware has
   already checked membership. A plain `GET devices/{device}` runs 4 authorization
   queries out of 12, and `AdapterController::activate` resolves permissions 3 times
   (10 authorization queries). A static count finds 31 portal routes that resolve
   twice and 7 that resolve three or more times. `GET /api/v1/me` resolves 5
   capability sets for every organization the user can see, which for a super
   administrator means every organization (section 6).
5. **Super administrators pass by bypass, not by grant.** They pass
   `ResolveOrganizationContext:24` without membership. They also pass a
   `$user->is_super_admin ||` short-circuit in 12 tenant permission checks across 6
   services, plus `Gate::before` (`app/Providers/AppServiceProvider.php:82`). In
   every organization this gives them every tenant permission, including device
   commands. 6 feature-test files act as a super administrator, so those tests never
   exercise the membership or permission paths (section 7).
6. **`DeviceProfilePolicy` is discovered but never called.** Laravel's naming
   convention discovers it (`Gate::getPolicyFor(DeviceProfile::class)` returns it),
   but nothing calls `can`, `authorize` or `@can` for a profile. It is the only
   policy in the codebase, and `Gate::policies()` is empty
   (`app/Domain/DeviceProfiles/Policies/DeviceProfilePolicy.php:11-37`).
7. **The integration event feed and webhooks filter by device, not by event type.**
   An application with `events:read` plus either `alerts:read` or `geofences:read`
   receives all 8 event types for its granted devices. A webhook application must
   hold `events:read` and `alerts:read`, and it receives geofence and automation
   events too, even without `geofences:read`. The documentation states this
   behaviour (`docs/features/integrations.md:125`), and the owner has not decided
   whether event types should follow abilities (section 8.3).
8. **Background work re-checks authorization by hand, with HTTP helpers, and never
   sets an organization context.** Assistant runs and tools, automation actions,
   alert emails and webhook deliveries each re-resolve the acting user or application
   and call `abort_unless` inside queue workers and console loops. Assistant tools
   call controllers directly with synthetic requests, so no route middleware runs
   (`app/Domain/Assistant/Tools/WorkflowAssistantTools.php:51-60`, section 10).
   Middleware alone therefore cannot carry scoping.
9. **The test suite already walks routes, but not for isolation.**
   `tests/Feature/OrganizationRouteParametersTest.php` walks every organization route
   for parameter patterns, and `tests/Feature/Contract/RouteInventoryTest.php`
   compares every route with the OpenAPI contract. Cross-tenant assertions exist in
   about 20 domain test files, each written by hand for some routes (section 11).
10. **Postgres row-level security is not cheap here** (section 9.6). The API role
    owns every table, so policies would need `FORCE ROW LEVEL SECURITY` or a split
    owner role. 58 of 95 tables have no organization column. php-fpm and the queue
    workers reuse connections, so every request and job would have to set and reset
    a session variable. About 10 legitimate cross-organization paths would need a
    bypass, and local tests run on SQLite.

## 2. Surface inventory

### 2.1 Routes by family (262 routes)

| Family | Routes | How the organization is established | Authorization |
| --- | ---: | --- | --- |
| Portal tenant routes `api/v1/organizations/{organization}/…` with `ResolveOrganizationContext` | 185 | Route binding plus middleware membership check | Per-domain service called by each controller |
| Organization administration (`administration`, `roles`, `role-permissions`, `members`, `invitations`) | 13 | **No middleware.** `OrganizationAdministrationAuthorization::allows` in each controller (`app/Domain/Administration/routes/api.php:72-95`) | Same service; platform administrators with `manage-organizations` pass |
| Integration API `api/integration/v1/organizations/{organization}/…` | 18 | `AuthenticateApplication`: the token's application must belong to the route organization, else 404 (`app/Domain/Integrations/Http/AuthenticateApplication.php:30-31`) | One ability per route; device grant filtered in each controller |
| Platform administration `api/v1/admin/…` | 19 | None, cross-organization by design | `can:PlatformAdministration.*` (17); `is_super_admin` in the controller (2, `PlatformTeamController.php:54-60`) |
| Other signed-in routes (`me`, `auth/logout`, `units`, `notifications/*` ×3) | 6 | None, or several organizations (section 6.3) | Self |
| Public (`auth/login`, `auth/forgot-password`, `auth/reset-password`, `invitations/{token}` ×2) | 5 | Token in the URL for invitations | — |
| Internal machine routes `api/internal/…` | 9 | Runtime token (5, `AuthenticateDeviceRuntime.php:12-17`), adapter tenant token (1, `AdapterController.php:230-234`), monitoring ingest token (3, `MonitoringIngestController.php:14-18`) | Token only |
| Non-API (`/`, `/up`, `health/ready`, `internal/ops/metrics`, `sanctum/csrf-cookie`, `storage` ×2) | 7 | — | Ops token for metrics (`routes/web.php:16-21`) |

The middleware is attached per route group in 11 route files:
`DeviceProfiles/routes/api.php:22`, `Devices/routes/api.php:19`,
`Dashboards/routes/api.php:9`, `Assistant/routes/api.php:7`,
`Automation/routes/api.php:13,48`, `Geospatial/routes/api.php:11`,
`DeviceAdapters/routes.php:7`, `Help/routes.php:7`, `Integrations/routes.php:14`,
`Overview/routes.php:9` and `Authentication/routes/api.php:26-29` (all under
`app/Domain/`). If a new group forgets it, nothing fails.

### 2.2 Portal tenant routes by authorization service (198)

| Service | Routes | Evidence |
| --- | ---: | --- |
| `DeviceAuthorization` (`Device.*`); includes 6 workflow routes that hand v2 workflows to `DagController` | 107 | `app/Domain/Devices/Services/DeviceAuthorization.php:16-46` |
| `DeviceProfileAuthorization` (`DeviceProfile.*`, `TransportBinding.manage`); 1 route also reads `DeviceAuthorization` capabilities | 30 | `app/Domain/DeviceProfiles/Services/DeviceProfileAuthorization.php:16-51` |
| `DagAuthorization` (`Workflow.*`); 3 also call `DeviceAuthorization`, including `WorkflowController@deployment`, which picks a family by schema version | 18 | `app/Domain/Automation/Services/DagAuthorization.php:15-31`; delegation e.g. `WorkflowController.php:44-49` |
| `DashboardAccess` (`Dashboard.*` plus shares) | 13 | `app/Domain/Dashboards/Services/DashboardAccess.php:35-127` |
| `AssistantAccess` (delegates by conversation scope) | 12 | `app/Domain/Assistant/Services/AssistantAccess.php:19-84` |
| `HelpAccess` through `HelpRetrieval` | 3 | `app/Domain/Help/Services/HelpAccess.php:15-40` |
| `OrganizationAdministrationAuthorization` | 13 | `app/Domain/Administration/Services/OrganizationAdministrationAuthorization.php:17-49` |
| Membership only (`context`, `runtime-status`) | 2 | `OrganizationContextController.php:12-15`, `RuntimeStatusController.php:12-16` |

Workflows have two permission families. A v1 workflow is governed by `Device.*`;
a v2 (DAG) workflow is governed by `Workflow.*`. The same `{workflow}` routes switch
on `schema_version` (`app/Domain/Automation/Http/Controllers/WorkflowController.php:44-49,
71-76, 136-141, 161-166, 173-182, 203-208`).

### 2.3 Controllers by pattern (56 controllers plus the base `Controller.php` = 57 files)

| Pattern | Count | Controllers |
| --- | ---: | --- |
| `DeviceAuthorization` | 17 | Device, Command, Discovery, Onboarding, Site, TelemetryCapture, Alert, NotificationSettings, Workflow (v1, delegates v2), Geofence, LocationBinding, LocationMap, Adapter, Application, Webhook, Overview, NotificationCenter (events only) |
| `DeviceProfileAuthorization` | 8 | DeviceProfile, DeviceProfileArtifact, ProfileAlarmTemplate, ProfileCalculation, ProfileParameter, ProfileParameterGroup, ProfilePreview, TransportBinding |
| `DagAuthorization` | 2 | Dag, Scenario |
| `DashboardAccess` / `AssistantAccess` / `HelpAccess` | 1 / 1 / 1 | Dashboard / Assistant / Help |
| `OrganizationAdministrationAuthorization` | 4 | OrganizationAdministration, OrganizationInvitation, OrganizationMember, OrganizationRole |
| Platform gate or super administrator | 9 | PlatformInvitation, PlatformOrganization, PlatformOrganizationPermission, PlatformOrganizationRole, PlatformRole, PlatformRolePermission, PlatformUser, Retention (route `can:`), PlatformTeam (`is_super_admin`) |
| Integration application token | 5 | Event, Geospatial, Location, Read, Telemetry (integration namespace) |
| Machine token | 2 | Runtime, MonitoringIngest (AdapterController's `event` action also takes a token) |
| Membership only | 2 | OrganizationContext, RuntimeStatus |
| Public or self | 4 | Session, PasswordRecovery, PublicOrganizationInvitation, UnitCatalogue |

### 2.4 Tenant-owned data

95 tables (92 from the scan of `database/migrations`, plus 3 created by the
permission package's migration through variables). 37 carry an organization column:
34 named `organization_id`, plus the permission package's `roles`, `model_has_roles`
and `model_has_permissions`, which use `organization_id` as their team key
(`config/permission.php:113,151`). 5 of these allow a null organization, meaning a
platform-level row: `device_profiles`, `notification_events`, `device_audit_events`,
`telemetry_retention_settings` and `roles`. The other 58 tables reach their
organization only through a parent, for example `profile_parameters` → `device_profiles`,
`device_commands` → `devices`, `automation_scenarios` → `automation_workflows`,
`assistant_runs` → `assistant_conversations`, `dashboard_revisions` → `dashboards`,
`integration_webhook_deliveries` → `integration_webhooks` →
`integration_applications`. Of 56 Eloquent models, 26 map to a table with an
organization column.

## 3. Organization resolution and membership

`ResolveOrganizationContext` (`app/Domain/Authorization/Http/Middleware/ResolveOrganizationContext.php`):

- Returns 404 when the route organization did not bind (`:17-21`). Unknown or
  soft-deleted organizations end up there.
- Returns 403 "You do not belong to this organization." unless the user is a super
  administrator or a member (`:23-28`). The documentation states this as 404 for an
  unknown organization and 403 for a non-member (`docs/features/access.md:48`).
- Sets the permission package's active team to the organization, drops the user's
  cached `roles`/`permissions` relations, calls the controller, then restores the
  previous team and drops the relations again (`:30-43`).
- Stores the organization as a request attribute (`:36`) that no code reads.

Order of evaluation, measured on the baseline with a Member of Acme probing
Northstar paths:

| Request | Result |
| --- | --- |
| `GET /organizations/{northstar}/devices/{existing device of any organization}` | 403 (binding succeeded, then membership failed) |
| `GET /organizations/{northstar}/devices/{random uuid}` | 404 (binding failed before membership) |
| `GET /organizations/{northstar}/devices` | 403 |
| `GET /organizations/{random uuid}/devices` | 404 |
| A member of Acme: `GET /organizations/{acme}/devices/{Northstar device}` | 404 after 3 queries (organization, global device lookup, membership); `DeviceAuthorization::authorize` compares `organization_id` before permissions (`DeviceAuthorization.php:42-44`) |

`bootstrap/app.php:23-27` leaves the middleware priority at its default, so
`SubstituteBindings` (in the `api` group) always runs before route middleware that is
not in the priority list.

## 4. Organization switching

### 4.1 Copies of the switching block

| File | Lines | Context | Variant |
| --- | --- | --- | --- |
| `app/Domain/Authorization/Http/Middleware/ResolveOrganizationContext.php` | 30-43 | Request | set, `unsetRelation`, restore |
| `app/Domain/Devices/Services/DeviceAuthorization.php` | 18-37 | Request, jobs, workers, tools | set, `unsetRelation`, membership query, restore |
| `app/Domain/DeviceProfiles/Services/DeviceProfileAuthorization.php` | 18-40 | Request, tools | same |
| `app/Domain/Automation/Services/DagAuthorization.php` | 21-30 | Request, automation worker, tools | membership first, then switch |
| `app/Domain/Dashboards/Services/DashboardAccess.php` | 37-56 | Request | same as DeviceAuthorization |
| `app/Domain/Help/Services/HelpAccess.php` | 25-39 | Request, assistant job | after calling two other services that each switch |
| `app/Domain/Administration/Services/OrganizationAdministrationAuthorization.php` | 37-49 (`withinOrganization`) | Request | switch only; caller uses `$user->fresh()` (`:30`) instead of `unsetRelation` |
| `app/Console/Commands/BootstrapStaging.php` | 45-87 | Console | seeding loop |
| `app/Domain/Dashboards/Services/DashboardPermissionBackfill.php` | 58-73 | Migration/backfill | per-role loop |

The block also appears in `database/seeders/DevicePermissionSeeder.php:23-41`,
`DeviceProfilePermissionSeeder.php:22-46` and `OrganizationSeeder.php:49-78`, and in 6
test files. `app/` has 12 `unsetRelation('roles')` sites and 11
`organizations()->whereKey(...)->exists()` membership queries.

### 4.2 Checks that rely on whichever organization is active

- `DeviceProfileAuthorization::authorize` calls `hasPermissionTo` without switching
  (`DeviceProfileAuthorization.php:43-46`). It is correct only because all 30 profile
  routes run behind the middleware.
- `DeviceProfilePolicy` calls `$user->can(...)` (`DeviceProfilePolicy.php:34-35`),
  which the permission package answers for the active team
  (`config/permission.php:121`).
- In long-lived workers (`queue:work` with `--max-time=3600`,
  `deploy/release/compose.yml:121-149`) the permission registrar is a process
  singleton. Every service restores the previous team in `finally`, so nothing leaks
  today. Any new code that checks a permission without switching would read whatever
  team the previous job left. The container already has a precedent for state that
  lives exactly one request or job: `$this->app->scoped(PublishedParameters::class)`
  (`app/Providers/AppServiceProvider.php:30`).

## 5. Tying records to the organization

### 5.1 How records are found

- Every bound tenant model binds by `uuid` through `getRouteKeyName`. Most extend
  `DeviceModel` (`app/Domain/Devices/Models/DeviceModel.php:21-24`), and profile
  models and `Organization` override it themselves. `Role` and `User` (`{member}`)
  bind by integer id.
- `whereUuid`/`whereNumber` constraints exist on every organization route parameter.
  `OrganizationRouteParametersTest` enforces this so that a malformed id is a 404
  rather than a Postgres 500.
- `DeviceProfile` uses soft deletes (`app/Domain/DeviceProfiles/Models/DeviceProfile.php:21`),
  so binding already excludes deleted profiles. `Organization` uses them too.

### 5.2 Ownership mechanisms for the 165 bound records (140 portal routes)

| Mechanism | Bindings | Models | Evidence |
| --- | ---: | --- | --- |
| `DeviceAuthorization::authorize($user, $perm, $org, $resource)` compares `organization_id` and returns 404 | 77 | Device 25, DeviceAdapter 14, Workflow (v1) 12, IntegrationApplication 8, Alert 7, Geofence 5, Site 2, DiscoveryCandidate 2, SparkplugGateway 1, SparkplugConnection 1 | `DeviceAuthorization.php:40-46` |
| `DeviceProfileAuthorization::ensureOrganizationProfile` (27) or an inline equivalent (1) | 28 | DeviceProfile | `DeviceProfileAuthorization.php:48-51`; `ProfileCalculationController.php:30` |
| Parent foreign key (`$child->parent_id === $parent->id`) | 23 | ProfileParameter 4, AdapterCredential 3, Scenario 3, ProfileAlarmTemplate 2, ProfileParameterGroup 2, TransportBinding 2, DeviceCommand 2, AdapterCandidate 1, AdapterProposal 1, AssistantProposal/Run/Source 1 each | e.g. `CommandController.php:49,58`, `ProfileParameterController.php:121-124`, `AdapterController.php:141,168,182,191,210` |
| `DashboardController::authorizeDashboard` inline | 10 | Dashboard | `DashboardController.php:200-206` |
| `DagAuthorization::authorize(..., $resource)` | 10 | Workflow (v2) | `DagAuthorization.php:17-19` |
| `AssistantAccess::conversation` (owner **and** organization) | 9 | AssistantConversation | `AssistantAccess.php:31-33` |
| Inline `abort_unless($x->organization_id === …)` in the controller | 6 | Role 2, OrganizationInvitation 2, GeofenceActivationBatch 2 | `OrganizationRoleController.php:120-123`, `OrganizationInvitationController.php:73,84`, `GeofenceController.php:56,75` |
| Membership check inside a service | 2 | User (`{member}`) | `OrganizationMembershipManager.php:27,54` |

The order varies between domains. Device-family checks compare the organization
before the permission (foreign record → 404 for everyone). Profile routes check the
permission first (`DeviceProfileArtifactController.php:97-101`), so a user without
the permission gets 403 whether or not the record is theirs. Neither order reveals
another organization's record to a member, but the behaviour is not uniform.

### 5.3 Path parameters resolved by hand (15 portal routes)

`{delivery}` (alerts, webhooks), `{number}` (dashboard revisions, 2 routes),
`{revision}` (profile artifacts), `{operation}` (devices, workflows), `{item}`
(geofence activation retry), `{slug}` (help), `{capture}` (3 routes),
`{command}` (DAG reconcile) and `{evaluation}` (2 timeline routes). All are scoped
through a parent, or sent to the runtime together with the organization's UUID. One
looks up the record globally first and then requires its device to belong to the
organization: `DeviceCommand::where('uuid', $command)` followed by
`Device::where('organization_id', …)->whereKey($c->device_id)->firstOrFail()`
(`DagController.php:230-231`).

### 5.4 References in request bodies

Request bodies name tenant records by `*_uuid`, `*_uuids` and integer `*_id(s)`
fields (device, site, artifact, profile, workflow, adapter, gateway, configuration,
parameter, role and user references). Apart from the 2 scoped `Rule::exists` rules
above, each is checked by a hand-written organization filter or a count comparison
in a controller or service, for example
`ApplicationController.php:116-123` ("Every device must belong to this organization"),
`OnboardingController.php:52,66`, `WorkflowController.php:118-120` and
`DashboardController.php:233-237`. A foreign reference usually gets the same
response as a missing one: 422 or 404, depending on the field.

### 5.5 Client-chosen idempotency keys are global

`operation_uuid` and `request_uuid` values are looked up across all organizations.
Some paths return 404 when the key belongs to another organization
(`AdapterController.php:58-59`, `OnboardingController.php:45-47`). Others return 409
"already used for a different request" (`DeviceLifecycleService.php:18-21`,
`WorkflowDeploymentService.php:22-24`, `DagDeployment.php:24-28`), which differs from
the response for an unused key. This is a low-severity existence signal, because it
requires knowing another organization's random UUID.

## 6. Permission resolution per request

### 6.1 Cost per resolution (measured)

- One `DeviceAuthorization::capabilities` call = 3 queries: the membership
  `exists`, the user's direct permissions and the user's roles. This is because the
  service drops the cached relations before and after (`DeviceAuthorization.php:21,36`).
  `DeviceProfileAuthorization` and `DashboardAccess` have the same shape.
- `GET devices/{device}` as a Moderator: 12 queries, of which 4 are authorization
  (2 membership, 1 permissions, 1 roles).
- Three resolutions in a row, as in `AdapterController::activate`, cost 9 queries
  plus the middleware's membership query: **10 authorization queries**
  (`AdapterController.php:31-35,136-141`).
- `OrganizationAdministrationAuthorization::allows` asks the platform gate (a
  `platform_roles` query), queries membership, reloads the user with `fresh()`, then
  checks the permission (`:19-30`). `OrganizationRoleController::index` calls it up
  to 3 times (`:43-44`).

### 6.2 Routes that resolve more than once

This is a static count of resolution calls in each controller method and its
private helpers, after the middleware's own membership query.
`AssistantController` counts include mutually exclusive branches.

| Resolutions | Routes | Examples |
| ---: | ---: | --- |
| 0 | 34 | profile routes (ambient-team check), help, `context`, `runtime-status` |
| 1 | 126 | most routes |
| 2 | 31 | `ApplicationController` and `WebhookController` call `authorize()` with MANAGE and then VIEW (`ApplicationController.php:25-29`, `WebhookController.php:23-27`); `TelemetryCaptureController` with VIEW then MANAGE (`:22-27`); `DashboardController@index/store` |
| 3+ | 7 | `TelemetryCaptureController@update` up to 5 (`:65-71`, calls `show()` which authorizes again); `WebhookController@disable` 4 (`:66-79`); `AdapterController@activate` 3; `DashboardController@duplicate` 3 (`:79-82`); `AssistantController@store/settings/index` (branches) |

### 6.3 Endpoints that span organizations

- `GET /api/v1/me` returns every organization the user belongs to, or every
  organization for a super administrator (`AuthenticatedUserResource.php:31-35`).
  Each carries capabilities from 5 services (`OrganizationResource.php:31-40`), so
  the cost grows with the number of organizations.
- `GET /api/v1/notifications/events` resolves `DeviceAuthorization` capabilities for
  each of the user's organizations (`NotificationCenterController.php:62-64`).
- Per-user fan-out: notification recipients are filtered by resolving capabilities
  for each candidate user (`NotificationSettingsController.php:35,56`), and alert
  emails do the same for each recipient (`DeliverAlertEmail.php:57`).

## 7. Policies, gates and platform administration

- **Gates.** `Gate::before` grants every ability to super administrators
  (`AppServiceProvider.php:82`). The `PlatformAdministration.*` gates are defined
  over `PlatformAuthorization` (`AppServiceProvider.php:84-88`,
  `PlatformAuthorization.php:17-26`, where super administrators short-circuit at `:19`).
  The permission package also registers tenant permissions as gate abilities
  (`config/permission.php:121`).
- **Policies.** Only `DeviceProfilePolicy` exists, and nothing calls it (key
  finding 6). It handles `organization_id === null` profiles as super-administrator
  only (`:30-32`); no route exposes such profiles today.
- **Super-administrator bypass sites in tenant authorization:**
  `ResolveOrganizationContext.php:24`; `DeviceAuthorization.php:23,27`;
  `DeviceProfileAuthorization.php:23,30,45`; `DagAuthorization.php:20,26`;
  `DashboardAccess.php:42,46`; `HelpAccess.php:17,34`; `AssistantAccess.php:26`.
  Platform administrators who are not super administrators get no tenant access,
  except organization administration through `manage-organizations`
  (`OrganizationAdministrationAuthorization.php:19-21`). `docs/features/access.md:129`
  documents that super administrators "pass every check".
- **What depends on the bypass.** The portal lists every organization for a super
  administrator and opens any of them with full capabilities. The admin app uses
  only `/api/v1/admin` routes. Tests that act as a super administrator:
  `WorkflowAssistantTest`, `ScenarioTest`, `DeviceAdapterTest`,
  `DeviceOnboardingTest`, `RuntimeStatusTest` and `GeofenceTest`. The bypass itself
  is asserted by `SuperAdminAuthorizationTest.php:19-37`.
- `is_super_admin` is mass-assignable (`app/Domain/Shared/Models/User.php:18`). No
  request path assigns it (`OrganizationInvitationManager.php:165-170` lists fields
  explicitly), so this is latent only.

## 8. Integration API

### 8.1 Application tokens

- Applications are organization-owned (`integration_applications.organization_id`)
  and have no `HasApiTokens`, so their tokens cannot authenticate portal routes
  (`app/Domain/Integrations/Models/IntegrationApplication.php:11-12`). Tokens are
  personal access token rows whose tokenable is the application, with an expiry and
  token abilities that must be a subset of the application's grants
  (`ApplicationController.php:72-89`).
- `AuthenticateApplication` (`:22-48`) requires a bearer token of at most 256
  characters, an application that is not revoked, and an unexpired token. It
  requires the route organization to equal the application's organization (404),
  and the route ability on **both** the application and the token (403).
  `events:read` additionally needs `alerts:read` or `geofences:read` (`:33-36`), and
  `geofences:activate` needs `geofences:manage` (`:37-39`). There is a 60/min limit
  per application.
- Abilities: `devices:read`, `alerts:read`, `events:read`, `telemetry:read`,
  `locations:read`, `geofences:read`, `geofences:manage`, `geofences:activate`
  (`ApplicationController.php:21`). Route counts by ability: `telemetry:read` 5,
  `geofences:read` 3, `geofences:activate` 3, `events:read` 2, `devices:read` 2,
  `alerts:read` 2, `locations:read` 1.

### 8.2 Device grants

Each application lists at most 100 devices, checked to belong to its organization
when granted (`ApplicationController.php:116-123`). Every integration controller
filters by organization **and** grant by hand: `ReadController.php:50-60`,
`TelemetryController.php:18-23`, `LocationController.php:18-30`,
`GeospatialController.php:126-134`, `EventController.php:33`. The integration
`{uuid}` parameters are plain strings, not bound models, so they bypass route
binding entirely.

### 8.3 Event feed and webhooks: event types versus abilities

| Event type | Producer | `GET events` delivers it to an app with `events:read` and… | Webhook (app must hold `events:read` + `alerts:read`) |
| --- | --- | --- | --- |
| `alert.activated.v1`, `alert.cleared.v1`, `alert.acknowledged.v1` | `app/Domain/Integrations/Services/EventJournal.php:29-35` | `alerts:read` **or** `geofences:read` | Delivered |
| `geofence.entered.v1`, `geofence.exited.v1`, `geofence.wandering_started.v1`, `geofence.wandering_resolved.v1` | `app/Domain/Geospatial/Services/GeofenceEventJournal.php:34-39` | `alerts:read` **or** `geofences:read` | Delivered, even without `geofences:read` |
| `automation.triggered.v1` | `app/Domain/Automation/Services/DagActions.php:183-189` | either | Delivered |

The feed query filters by organization and granted devices only
(`EventController.php:33-34`). So does the webhook scan (`WebhookDispatch.php:40`,
with the send-time re-check at `:62-66`). Webhook eligibility requires `events:read`
and `alerts:read` on the application (`WebhookDispatch.php:103`,
`WebhookController.php:48`). Cursors are encrypted and bound to the application,
organization and `grant_revision`, and a grant change invalidates them with 409
(`EventController.php:48-65`). Filtering by ability would therefore fit the existing
cursor contract: changing abilities already bumps `grant_revision`
(`ApplicationController.php:61`).

## 9. Options for the plan step (superseded by section 13)

### 9.1 One context per request or job

A scoped container service (the `PublishedParameters` precedent) would hold the
acting principal, the organization and a memoized permission set. HTTP middleware,
queue job middleware, console commands and assistant tools would fill it
explicitly. Code that needs it and finds it empty would fail closed. This would
replace the 9 switching copies with one helper.

### 9.2 Automatic record scoping

- **Global scope on organization-owned models.** A trait on the 26 models with an
  organization column, reading the context. Child models would be scoped through
  their parent (`whereHas`), or by adding an organization column (58 tables, with a
  migration and backfill). Cross-organization code (section 10, platform
  administration, `/me`) would opt out explicitly and be auditable.
- **Scoped route bindings.** `->scopeBindings()` on the tenant groups needs
  relations on `Organization` named after the parameters (`devices`, `profiles`,
  `workflows`, `adapters`, `dashboards`, `conversations`, `applications`, `alerts`,
  `geofences`, `sites`, `candidates`, `connections`, `gateways`, `roles`,
  `invitations`, `members`). Children would bind through the previous parameter,
  for example `adapter->candidates()` and `profile->parameters()`. Alternatively, a
  shared `resolveRouteBindingQuery` override could read the context.
- **Membership before binding.** Either resolve the organization and membership in
  middleware placed ahead of `SubstituteBindings` in the priority list, or make every
  binding organization-scoped. The latter removes the existence signal in key
  finding 2 regardless of order.

### 9.3 One decision point for permissions

A request-scoped permission snapshot per (principal, organization) would be loaded
once: roles, direct permissions, membership, plus the ceiling, which today is
applied when roles are edited, not at check time. The per-domain services would
become thin views over it. Policies (one per tenant model, or one generic) could
then express "may the principal do X to this record". Laravel's built-in
`authorize`/`can` and the existing `can:` middleware would keep working.

### 9.4 Platform administration as a grant

For example, a platform permission ("act in any organization") evaluated by the
same decision point, granted to super administrators. It would make
cross-organization access visible in decisions and attributable in the audit trail
(`DeviceAudit::record` already stores the actor), instead of the 13 short-circuits
(12 in services, 1 in the middleware) and `Gate::before`.

### 9.5 Route walker

Precedents: `OrganizationRouteParametersTest` (route iteration) and
`RouteInventoryTest` (route list versus contract). Request bodies and examples
could come from the committed OpenAPI contract (`contracts/openapi/openapi.json`,
spec 001). Seeding two organizations with one record of every bound type, the
walker would, for each tenant route and method:

- substitute the other organization's ids into path parameters, and optionally into
  body reference fields named in the contract, expecting the same response as for a
  random id;
- call the other organization's path as a non-member;
- for integration routes, use an application of the other organization, a token
  lacking the route ability, and an ungranted device;
- fail when a new tenant route has no fixture.

The DB-level assertion is "no row of the other organization changed". This has to
run on PostgreSQL to catch Postgres-only failures. CI already runs the suite on
pgsql (`.github/workflows/ci.yml:33`); local runs default to SQLite
(`tests/TestCase.php:16-23`).

### 9.6 Postgres row-level security (assessment)

| Requirement | Today | Cost |
| --- | --- | --- |
| Policies must apply to the API role | `iot_api` creates and owns all public tables (`deploy/release/init-db.sql:3-6`), and migrations run as the same role (`deploy/release/compose.yml:23-24,120`). Owners bypass RLS. | `FORCE ROW LEVEL SECURITY` on every table, or split a migration-owner role from the runtime role |
| Organization column on every protected table | 37 of 95 tables | Policies on 58 child tables need `EXISTS` joins to the parent, or a new column with backfill and write paths |
| Context per transaction | php-fpm reuses connections (`deploy/docker/api/Dockerfile.release:19`); queue workers live up to an hour | `SET LOCAL` inside a transaction for every request and job, or `SET`/`RESET` around each; a pooler would be incompatible with session state |
| Legitimate cross-organization access | Runtime `/state` and inbound events, automation and webhook workers scanning all organizations, scheduled pruning, platform administration, `/me`, notification center, ops metrics | A bypass role or flag, carefully confined |
| Tests | Local tests on SQLite; CI on pgsql | Policies are testable only on pgsql |
| Runtime schema | `device_runtime` is owned by `iot_runtime`; the API only reads it for metrics (`init-db.sql:7-9`, `app/Support/Operations.php:78-89`) | Out of scope |

Conclusion: RLS is a sound later defence in depth. Once the application layer has a
single context (9.1), RLS could reuse it. It is not cheap enough to include in this
feature.

## 10. Work outside HTTP

| Context | Acts as | Re-check today | Evidence |
| --- | --- | --- | --- |
| `RunAssistant` job (assistant queue, `--tries=1`, 120 s) | Conversation owner | `AssistantAccess::conversation` at start and again before saving a help answer | `app/Domain/Assistant/Jobs/RunAssistant.php:64,78` |
| Assistant tools | Conversation owner | Every call: `AssistantAccess::conversation`/`write`; workflow tools call portal controllers with a synthetic request whose user resolver returns the owner (no middleware, no route binding) | `WorkflowAssistantTools.php:46,51-60,97-98`; `ProfileAssistantTools.php:49,57,82`; `AdapterAssistantTools.php:40`; `ProfileProposalService.php:43,102`; `WorkflowProposalService.php:22,27` |
| `automation:work` console loop | User who created the deployment | `DagAuthorization` (`activate`) plus `DeviceAuthorization` (`COMMAND`) on every action tick and on the runtime's dispatch check | `app/Domain/Automation/Console/AutomationWorker.php:28-36`; `DagActions.php:82-86,103,157-168` |
| `DeliverAlertEmail` job | Recipient | Verified email, membership, `Device.view` at send time | `app/Domain/Automation/Jobs/DeliverAlertEmail.php:55-57` |
| `DeliverNotificationEmail` job | Platform operator | Super administrator only | `app/Domain/Notifications/Jobs/DeliverNotificationEmail.php:40` |
| `integrations:webhooks-work` console loop | Integration application | Grants, revision and device grant at selection and at send | `WebhookWorker.php:32-45`; `WebhookDispatch.php:40,62-66,98-106` |
| `DeployAdapter` job | System, after the user's authorized request | None (operation state only) | `app/Domain/DeviceAdapters/Jobs/DeployAdapter.php:26-44` |
| Scheduler | System, all organizations | None (heartbeat, `assistant:recover`, `devices:prune-ledgers`, ops bucket cleanup) | `routes/console.php:24-33` |
| Runtime inbound events | Runtime (platform) | Identities in the payload are matched against stored relations: the workflow must be in the organization and the deployment in the workflow; the device must match both UUIDs | `RuntimeController.php:97-139,212`; `DagActions.php:28-32` |

None of these contexts sets an organization context. All of them signal denial
with `abort`/`abort_unless` (HTTP exceptions), including inside console loops and
jobs.

## 11. Existing tests

- About 20 feature-test files contain cross-organization assertions, written per
  domain (Alert, Workflow, Dashboard, Device, Onboarding, Application, Assistant and
  others). No test enumerates every tenant route for isolation.
- `OrganizationRouteParametersTest.php:16-38` iterates
  `Router::getRoutes()` filtered by `^api/(integration/)?v1/organizations/\{organization\}`,
  which is the natural seed for an isolation walker.
- 6 test files act as a super administrator (section 7), which skips membership and
  permissions entirely.
- Constitution principle III requires a cross-tenant test for any change that
  touches tenant data (`.specify/memory/constitution.md:31-40`).

## 12. Security observations

| Observation | Severity | Recommendation |
| --- | --- | --- |
| Event feed and webhooks deliver event types the application holds no read ability for (8.3), as documented | Medium (exposure inside one organization, not across organizations) | Owner decision (clarification Q1). Until then, it is documented behaviour. |
| Existence signal across organizations: binding before membership (key finding 2) | Low (needs another organization's UUID and a guessed or leaked record UUID; reveals existence only) | Fixed structurally by this feature; a small early fix is possible (9.2) |
| Existence signal for members: a foreign record's 404 body (`""`) differs from a missing record's (`No query results for model [...] <uuid>`) (key finding 2) | Low (needs a leaked record UUID) | Fixed by D10: one not-found body for every tenant 404 |
| Global idempotency keys answer 409 instead of 404 for another organization's key (5.5) | Low | Covered by this feature's indistinguishability requirement |
| `is_super_admin` is mass-assignable (7) | Latent | Make it guarded when platform administration becomes a grant |
| Super administrators can act, including sending device commands, in every organization without membership (7) | By design today | This feature makes it explicit |

No unchecked tenant record, no request path that trusts a payload's organization,
and no route that misses its organization check was found. Nothing here needs a fix
before this feature lands.

## 13. Plan decisions (2026-10-12)

These decisions resolve the plan's open questions after the clarification session
(spec.md, "Clarifications"). They supersede the options in section 9. Paths are
relative to `apps/api/` unless stated otherwise.

### Summary of decisions

| # | Concern | Decision |
| --- | --- | --- |
| D1 | Where the organization lives | One scoped `OrganizationContext` per request, job, scheduled step and tool call; `run()` is the only switching mechanism |
| D2 | When it is established | `EnterOrganization` middleware runs before route binding; non-members get not found |
| D3 | How records are confined | Global scopes on organization-owned models **and** scoped route bindings for parent chains, plus a scoped query helper and a scoped validation rule |
| D4 | How permissions are resolved | One `PermissionSnapshot` per principal and organization, reused by the existing domain services |
| D5 | Work outside requests | Jobs declare their organization and principal; workers, scheduler, runtime and seeders declare platform work; tool calls refresh the snapshot |
| D6 | The proof | A route walker driven by the router and the OpenAPI contract, reusing the response checker |
| D7 | Super administrators | An explicit platform permission through a `super-administrator` platform role, recorded per request in `platform_access_events` |
| D8 | Integration events | An `IntegrationEventType` enum maps each type to its ability; the feed and webhooks filter by it |
| D9 | Not-found responses | One body, `{"message": "Not Found"}`, for every tenant 404 |
| D10 | Client-chosen request identifiers | Scoped lookups; a collision with another organization is answered like a reuse within the organization |
| D11 | Row-level security | Deferred; the context provides the value a later policy would read |
| D12 | Decision record | ADR-017 in PR 2 |

No new dependency is needed. Everything uses Laravel 13.35, `spatie/laravel-permission`
7.4.2, Sanctum 4.3 and the spec 001 contract tooling already in the repository.

### D1. One organization context

**Decision**: Add `App\Domain\Authorization\Tenancy\OrganizationContext`, registered with
`$this->app->scoped()`. It holds:

- the organization, or none;
- the principal (`Principal`: a user, an integration application with its token, or the
  platform with a `PlatformWork` case);
- the mode (organization, platform, or none);
- the memoized `PermissionSnapshot` objects (D4), keyed by organization.

Its methods:

- `run(Organization, Principal, Closure)` is the only switching mechanism (FR-016). It
  sets the permission registrar's team, swaps the context, and restores both in
  `finally`.
- `platform(PlatformWork, Closure)` runs declared platform-wide work.
- `organization()` throws `MissingOrganizationContext` when there is none (FR-004).
- `snapshot()` and `snapshotFor(Organization)` return permission snapshots.

The queue worker already forgets scoped instances before each job
(`vendor/laravel/framework/src/Illuminate/Queue/QueueServiceProvider.php:263`). A
`JobProcessing` listener also resets the registrar's team to null and asserts that no
context is active, so nothing carries from one job to the next (FR-022).

**Rationale**: It gives one place to switch, replacing the 9 copies in `app/` and 3 in
seeders. Tenant code fails closed when there is no context. The context lives exactly
one request or job, as `PublishedParameters` already does (`app/Providers/AppServiceProvider.php:30`).

**Alternatives considered**:

- **Laravel's `Context` facade alone.** It propagates into jobs implicitly
  (`Illuminate/Log/Context/ContextServiceProvider.php`), so a job would inherit the
  requester as its principal, which is wrong for work that acts for someone else (an
  alert email acts for its recipient). It is also untyped.
- **The permission package's team resolver.** It covers permissions but not records.
- **Keeping per-service switching.** That is the status quo.

### D2. Entering the context before route binding

**Decision**: An `EnterOrganization` middleware (alias `organization`) replaces
`ResolveOrganizationContext` on every portal tenant route group, including the 13
organization administration routes that have no middleware today. It is placed in the
priority list right after `AuthenticatesRequests`
(`$middleware->appendToPriorityList(AuthenticatesRequests::class, EnterOrganization::class)`
in `bootstrap/app.php`), so it runs before `SubstituteBindings`.

It works in this order:

1. Read the raw `{organization}` value and load the organization.
2. Check membership, or the platform grant (D7).
3. Enter the context for the request and restore it afterwards. This matters in tests,
   where one application instance serves many requests.
4. Put the model back with `$route->setParameter()`. Implicit binding then skips it
   (`ImplicitRouteBinding.php:36-38`).

An unknown organization, a non-member and a malformed value all receive the D9
not-found response (Q3, FR-003).

`AuthenticateApplication` gets the same priority and enters the context with the
application principal. Extending `OrganizationRouteParametersTest`, a route test
asserts that every `api/(integration/)?v1/organizations/{organization}` route carries
exactly one of the two middlewares, and that `api/v1/admin/...` routes carry neither.

**Rationale**: Checking membership before any record lookup removes the non-member
existence signal (finding 2) and gives Q3's 404 in one place. Explicit middleware on
each group, plus a test, is easier to review than a global middleware that guesses
which routes are tenant routes: `api/v1/admin/organizations/{organization}` is a
platform route.

**Alternatives considered**:

- **A global `api` middleware acting on any `{organization}` parameter.** It would
  catch platform routes and depend on naming.
- **Keeping binding first and only scoping the bindings.** That confines records but
  leaves the organization-level signal.

### D3. Confining records: global scopes and scoped bindings

**Decision**: Combine five mechanisms, each giving one guarantee.

1. **`BelongsToOrganization` trait on the 23 organization-owned models.** These are
   the 26 models with an organization column minus three: the permission package's
   `Role` (team-keyed and loaded across teams by the package's cache),
   `TelemetryRetentionSetting` (platform-managed, with a shared default row) and
   `NotificationEvent` (a feed that spans organizations, with platform rows). The
   full classification is in [data-model.md](data-model.md). The trait adds
   `OrganizationScope`, which filters by
   `<table>.organization_id = <context organization>` in organization mode, applies no
   filter in declared platform mode, and throws `MissingOrganizationContext` with no
   context. A `creating` hook fills `organization_id` from the context and refuses a
   different value, and an `updating` hook refuses any change to it (FR-012).
   `device_profiles` has a nullable organization column, so its platform rows are
   hidden automatically (FR-011). `RetentionService` stays the only reader of
   `TelemetryRetentionSetting`. The notification centre keeps its explicit filter by
   per-organization snapshot (D4).
2. **`BelongsToOrganizationThrough` trait on child models looked up directly by
   identifier from input.** These are `DeviceCommand`, `DeviceOperation`,
   `DeviceConfiguration`, `Deployment`, `Scenario`, `DashboardRevision`,
   `AlertDelivery`, `WebhookDelivery`, `DeviceProfileArtifact`, the profile children,
   the assistant children, `AdapterProposal` and `AdapterRevision`. It adds a
   `whereHas(<parent relation>)` scope, so the parent's organization scope applies.
   Children reached only through an already-scoped parent need nothing.
3. **`->scopeBindings()` on every tenant route group.** `Organization` gains relations
   named after the route parameters (`devices`, `profiles`, `workflows`, `adapters`,
   `dashboards`, `conversations`, `applications`, `alerts`, `geofences`, `sites`,
   `connections`, `gateways`, `candidates`, `invitations`, and `members` over the user
   pivot). Parents gain theirs: profile → parameters, groups, alarms and bindings;
   device → commands; adapter → candidates, credentials and proposals; conversation →
   proposals, runs and sources; workflow → scenarios; geofence → batches. Where a
   parameter name and a relation differ, the parent overrides
   `childRouteBindingRelationshipName`. Laravel resolves each bound child through the
   parameter before it (`ImplicitRouteBinding.php:48-60`), which implements FR-007
   and replaces the 23 parent checks.
4. **`TenantTable::query($table)` for raw access.** About 50 of the 136
   `DB::table(...)` calls address the 9 tables with an organization column
   (`automation_actions`, `automation_settings`, `integration_streams`,
   `integration_events`, `geofence_events`, `device_audit_events`, ...). These go
   through a helper that applies the same rule. An architecture test fails on
   `DB::table('<table with an organization column>')` outside declared platform work.
5. **`TenantRecord::exists(Model::class, 'uuid')` validation rule.** It queries
   through Eloquent, so the scopes apply, and it replaces `Rule::exists` for
   references. A foreign reference and an unknown one get the same message (FR-008).
   Laravel's `exists` rule uses the query builder, which ignores global scopes.

`Role` stays scoped by `OrganizationRoleManager` and by scoped bindings
(`organization->roles()`). `User` is never scoped; `{member}` binds through the
organization's users. The walker (D6) proves both.

**Rationale**: Once the context exists before binding (D2), global scopes confine
every Eloquent query: implicit binding, body references, lists and counts (FR-005,
FR-008, FR-010). Implicit binding goes through `resolveRouteBindingQuery`, so the
scopes apply to it. Scoped bindings add the parent integrity a per-organization scope
cannot give: a parameter of profile P1 requested under profile P2, both in the same
organization. Together they replace the 165 hand-written binding checks and the 127
hand-written filters.

**Alternatives considered**:

- **Scoped bindings only.** They cover path parameters but not body references,
  lists or lookups inside services.
- **Global scopes only.** They miss parent integrity.
- **Adding `organization_id` to the 58 child tables.** That is a large migration and
  backfill. It is deferred, and it would also be groundwork for row-level security.
- **Row-level security.** Deferred (section 9.6).

### D4. Permissions resolved once

**Decision**: A `PermissionSnapshot` per principal and organization is built on first
use and memoized in the context. For a user it costs 3 queries: membership (reused
from D2) and the roles and direct permissions under the organization's team, via one
`getAllPermissions()`. For an application it is the abilities held by both the
application and the token. For the platform principal it is the declared work.

The seven domain services (`DeviceAuthorization`, `DeviceProfileAuthorization`,
`DagAuthorization`, `DashboardAccess`, `HelpAccess`, `AssistantAccess` and
`OrganizationAdministrationAuthorization`) keep their public methods and outcomes.
They read the snapshot instead of switching teams, dropping relations and querying
membership. They remain the single definition per record kind (FR-017), and the
dormant `DeviceProfilePolicy` is deleted.

Tenant permission abilities checked with `$user->can()` resolve through gates defined
over the snapshot. The permission package's `register_permission_check_method` is
turned off (`config/permission.php:121`), so no check reads an ambient team.
Endpoints that span organizations (`/me`, the notification centre, recipient lists)
call `snapshotFor($organization)` once per organization, and `/me` batch-loads the
user's memberships and roles in one pass.

**Rationale**: A request costs 3 authorization queries instead of 4 to 10 or more
(SC-004). Super-administrator evaluation (D7) happens in one place. Outcomes stay the
same because the snapshot uses the same permission package calls.

**Alternatives considered**:

- **Caching permissions across requests.** It would go stale after a role change,
  which FR-015 forbids.
- **One policy per tenant model.** That is 26 classes of churn; with ownership
  structural, they would only restate permission names.

### D5. Work outside requests

**Decision**:

- **Queued jobs.** A tenant job implements `RunsInOrganization`, exposing its
  organization and principal from its own data, captured when it is created
  (FR-018). The job middleware `EnterOrganizationForJob` re-establishes the
  principal's access when the job runs; a person who has lost access ends the job
  with no side effects, as today (FR-019). A job that spans organizations implements
  `PlatformWide` and returns a `PlatformWork` case instead. An architecture test
  requires every `ShouldQueue` class to implement exactly one of the two (SC-007).
  The assignments:
  - `RunAssistant`: the conversation's organization and owner.
  - `DeliverAlertEmail`: the alert's organization and the recipient.
  - `DeployAdapter`: the adapter's organization and the platform principal
    `adapter-deployment`.
  - `DeliverNotificationEmail`: platform work `operator-notifications`.
  - `PasswordResetNotification`: platform work `account`.
- **Workers.** `automation:work` and `integrations:webhooks-work` declare platform
  work for their scans across organizations. Each item then runs inside
  `run($organization, $principal)`: the deployment's creator, or the integration
  application.
- **Scheduler, console commands, seeders and backfills.** These run under declared
  platform work and use `run()` wherever they act as one organization. This replaces
  the switching copies in `BootstrapStaging`, `DashboardPermissionBackfill` and the
  3 seeders.
- **Runtime.** Inbound events and `/internal/devices/state` declare platform work
  `runtime-sync`. Once an event's identities match the stored relationships (rules
  unchanged), the handler updates the organization's records inside
  `run($organization, Principal::platform(RuntimeEvents))`.
- **Assistant tools.** `RunAssistant` runs in the conversation's context. Each tool
  call refreshes the snapshot, so access lost between calls applies at the next call
  (FR-015). The synthetic requests the workflow tools build run inside that context,
  so the controllers they call are confined structurally. Restructuring module
  boundaries stays out of scope.
- **Declarations.** The `PlatformWork` enum is the list FR-021 asks for. Each case
  carries its reason and is listed in [contracts/organization-context.md](contracts/organization-context.md).

**Rationale**: An explicit principal never inherits the requester's identity into work
that acts for someone else. The middleware keeps jobs small. An enum can be listed and
tested.

**Alternatives considered**:

- **Implicit propagation through Laravel's `Context`.** It would give alert emails
  the wrong principal.
- **Checks written into each job.** That is the status quo.

### D6. The isolation walker

**Decision**: `tests/Feature/Isolation/TenantIsolationTest.php`, with support classes in
`tests/Support/Isolation/`. The full rules are in
[contracts/isolation-walker.md](contracts/isolation-walker.md).

- **Which operations it checks.** The router's operations (`ContractRoutes::index()`)
  that the contract marks `x-organization-scoped`: 217 today on 216 routes.
  `RouteInventoryTest` already keeps the router and the contract in step.
- **The world it builds.** `IsolationWorld` seeds organizations A and B and an
  unknown organization UUID. Each organization gets an Organization Admin member, a
  member without permissions, one record of every kind from the `RecordKinds`
  registry (route parameter → factory, parent chain, a marker string), and two
  integration applications: one with every ability and device, one missing an ability
  and a device.
- **The five checks per operation.**
  1. Path substitution: each record parameter is replaced in turn by B's record and
     by a random identifier. The two responses must be equal, and B's rows must be
     unchanged (a checksum of B's rows before and after).
  2. Non-member: A's member calls B's operation, and the response must equal the
     unknown-organization response.
  3. Leakage: every response to A is scanned for B's markers and identifiers.
  4. Body and query references: for each field the contract declares for the
     operation that names a record kind, B's and a random identifier are substituted
     into a valid request from `tests/Support/Isolation/requests/`. A declared
     reference field with no request fixture fails the walker (FR-030).
  5. Integration: B's application on A's operations gets 404. A's application on an
     ungranted device gets 404, and the feed and webhooks never include that device.
     A token without the operation's ability gets 403.
- **Comparison.** The statuses are equal, and the bodies are equal once the
  substituted identifier is replaced by a placeholder.
- **Contract checks come for free.** Every walker request also passes the existing G4
  response check (`tests/TestCase.php:42-52`), so every isolation status must be
  documented, and the coverage recorder sees the 403 and 404 pairs.
- **Known gaps** (`tests/Support/Isolation/known-gaps.php`) list the failures expected
  at PR 1. A listed gap that passes, or an unlisted failure, fails the walker, so the
  list can only shrink.
- **Exemptions** (`tests/Support/Isolation/exemptions.php`) list routes that serve
  shared data or platform work, each with its reason (FR-031).
- **Self-test.** `TenantIsolationSelfTest` disables one record kind's scope, or one
  entry point's context, at a time through a testing-only hook. It also adds
  test-only routes that lack a check. Each case must make the walker fail (FR-033,
  SC-003).
- **Test environment.** Runtime and adapter-manager calls are faked with
  `Http::fake()` plus `preventStrayRequests()`, queues are faked, and rate limiting is
  off for the walker. It runs in the existing PHP suite; CI's PostgreSQL job is
  authoritative (FR-032). The time budget is under 3 minutes.

**Rationale**: It reuses spec 001's router index, contract and response checker.
Comparing a foreign identifier with a random one is the definition of "indistinguishable",
so no per-route expectation needs writing. The marker scan proves lists. Request
fixtures are needed only where a body must reach the reference.

**Alternatives considered**:

- **Hand-written isolation tests per domain.** That is the status quo, and it misses
  routes.
- **Generating request bodies from the contract.** All 247 operations are still
  pending with open bodies, so most generated requests would stop at 422 before
  reaching the reference.
- **Fuzzing.** It is not deterministic enough for a gate.

### D7. The explicit platform grant

**Decision**:

- **The grant.** A new platform permission, `PlatformAdministration.act-in-organizations`,
  is held through a new system platform role, `super-administrator`, which also holds
  every other platform permission. The grant is kept out of the
  `platform-administrator` role's bundle (`app/Domain/Authorization/Enums/PlatformRoleName.php`).
- **Who holds it.** A data migration assigns the role to every user with
  `is_super_admin = true`, and `deployment:administrator` and the staging bootstrap
  assign it to the users they create.
- **How it is evaluated.**
  - A non-member who holds the grant gets every tenant permission, including
    permissions outside the organization's ceiling, as today.
  - A member gets their roles, plus the grant only where those roles fall short.
  - `EnterOrganization` admits a non-member who holds the grant.
- **How it is recorded.** Each request, job or tool call that relied on the grant
  writes one `platform_access_events` row when it ends ([data-model.md](data-model.md),
  [contracts/platform-access.md](contracts/platform-access.md)). This meets FR-028's
  "reads are recorded at most once per request". A daily scheduled task prunes rows
  older than the retention period.
- **What is removed.** The 12 service short-circuits, the one in the middleware, the
  one in `PlatformAuthorization::allows` (`:19`) and `Gate::before` (`AppServiceProvider.php:82`).
  `is_super_admin` remains as the platform-team identity (platform team management,
  operator notifications), grants nothing by itself, and leaves `#[Fillable]`.
- **Tests.** Tests that act as a super administrator move to members, or act
  explicitly as a grant holder.

**Rationale**: It answers Q2: the same capabilities, explicit and recorded. A
platform role reuses the existing platform-role model and admin screens. A dedicated
table keeps platform access queryable and gives it its own retention.

**Alternatives considered**:

- **Keeping `is_super_admin` as the grant.** It is still a flag, not a permission.
- **Reusing `device_audit_events`.** It mixes platform access into device history and
  cannot aggregate per request.
- **Read-only access with elevation.** The owner deferred it as later hardening.

### D8. Event types follow abilities

**Decision**:

- **The map.** An `IntegrationEventType` enum lists the 8 types with the ability each
  needs: `alert.*` needs `alerts:read`, `geofence.*` needs `geofences:read`, and
  `automation.triggered.v1` needs `events:read` only. The three writers
  (`EventJournal`, `GeofenceEventJournal`, `DagActions::journal`) take the enum, and a
  test asserts that every type written is in it.
- **The feed.** The query adds `whereIn('type', readableTypes(application, token))`,
  using abilities held on both.
- **Webhooks.** The scan uses the application's abilities, and the send-time re-check
  cancels a pending delivery whose type is no longer readable.
- **What stays.** The conditions for reaching the feed and configuring a webhook. The
  cursor format, because skipped types advance the position the way ungranted devices
  already do.
- **Contract, docs and release notes.** The `GET events` description in
  `contracts/openapi/supplements/integration.yaml`, `docs/features/integrations.md:125`
  and `docs/reference/events.md`, plus a release note for integrators. The rules are
  in [contracts/event-abilities.md](contracts/event-abilities.md).

**Rationale**: It answers Q1, and the enum forces a new event type to declare its
ability.

**Alternatives considered**:

- **Filtering the feed only.** Webhooks would still deliver every type.
- **Per-type opt-in.** It is new API surface.

### D9. One not-found response

**Decision**: On `api/*` routes, every 404 renders as `{"message": "Not Found"}`
(Laravel's status text), through one renderer in `bootstrap/app.php`. That includes a
`ModelNotFoundException`, a failed scoped binding, a non-member, an unknown
organization and a bare `abort(404)`. Domain code that returns 404 with a custom
message for a tenant reason switches to the uniform body. The contract changes too:
the shared `NotFound` and `Forbidden` descriptions in
`contracts/openapi/supplements/shared.yaml`, and the meaning of `x-organization-scoped`
(non-member: 403 becomes 404), are regenerated with `contract:export`.
`docs/features/access.md:48` and `docs/reference/api.md` change with them.

**Rationale**: SC-002 requires identical bodies. The portal already shows its
friendly message for `Not Found` (`apps/portal/src/components/forms.tsx:63-64`), and
the class-name leak disappears.

**Alternatives considered**:

- **Keeping Laravel's model message.** It leaks class names and repeats the requested
  identifier, and differs whenever any path aborts by hand.

### D10. Client-chosen request identifiers (FR-009)

**Decision**: `operation_uuid` and `request_uuid` lookups are scoped (D3). A key that
exists only in another organization surfaces as a unique-constraint violation on
insert. It is caught and answered exactly like a key the organization itself used for
a different request: 409, same body. The 404 and 409 answers that different paths give
today converge on that one response.

**Rationale**: These identifiers are globally unique, and they double as public
identifiers (operation polling, runtime messages). Making them unique per organization
would change successful responses (FR-034).

**Residual**: An unused key succeeds, while a key used anywhere returns 409. Telling
the two apart requires already knowing the other organization's random UUID. The plan
asks the owner to accept this reading of FR-009.

**Alternatives considered**:

- **A per-organization key namespace.** It changes the identifiers returned to
  clients.

### D11. Row-level security deferred

Section 9.6 stands. `OrganizationContext::run()` is the natural place to issue
`SET LOCAL app.organization_id` later, so a future policy can reuse the context
without redesign.

### D12. Decision record

PR 2 adds ADR-017, "Structural tenant scoping", recording D1 to D4, D9 and the
row-level security deferral, and linking this research.
