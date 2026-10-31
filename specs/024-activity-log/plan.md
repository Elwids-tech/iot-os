# Implementation Plan: Activity Log

**Branch**: `feat/024-activity-log` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/024-activity-log/spec.md`; decision in
[ADR-028](../../docs/adr/ADR-028-activity-log.md)

## Summary

Install `spatie/laravel-activitylog` 5.1 and make its `activity_log` table the
platform's one audit trail. A migration copies `device_audit_events` into it and drops
the old table. A new `Audit` domain owns a custom activity model with three extra
columns (`organization_id`, `subject_uuid`, `subject_name`) and one recorder,
`ActivityLog::record()`. `DeviceAudit::record()` keeps its signature and delegates to
it, so the 75 existing calls and their action codes are untouched. The readers of the
old table move to the new one.

New calls cover organization members, roles, invitations, platform organization
changes, dashboards and device profiles, and the edits of devices, sites and
organizations record their field changes. A paged admin endpoint lists events with an
actor, filtered by user and organization. The admin app gets an **Activity** page: a
day-grouped timeline built from a new kit component, `ActivityTimeline`, with
searchable Person and Organization selectors and a Load older button.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript / React 19
**Primary Dependencies**: `spatie/laravel-activitylog` ^5.1 (new); `@iot-os/ui`,
`@iot-os/api-client`, TanStack Query
**Storage**: PostgreSQL 17 (`activity_log`, jsonb `properties` and `attribute_changes`)
**Testing**: PHPUnit feature tests (`php artisan test --compact`), contract coverage
(G4), Playwright with mocked API in `apps/admin/e2e`
**Target Platform**: single-node Docker Compose (api, admin)
**Project Type**: web application (Laravel API + React admin)
**Performance Goals**: first timeline page under 1 s with 100k events (keyset paging on
`id` with `(organization_id, id)` and `(causer_id, id)` indexes)
**Constraints**: public repo hygiene; integer user ids (ADR-013); no stacked PRs
**Scale/Scope**: ~30 new recording points, 1 endpoint, 1 page, 1 kit component

## Constitution Check

| Principle | Check |
| --- | --- |
| I. Laravel owns intent | Recording and reading stay in Laravel; the runtime is untouched. ✅ |
| II. Immutable versions | Unchanged; publishing and activation events are recorded, not altered. ✅ |
| III. Tenant isolation | The endpoint is platform-admin only. Recording takes the organization from the resolved route organization, never the payload. A test proves an organization filter never returns another organization's events. ✅ |
| IV. Contracts first | The endpoint is added to the OpenAPI export and `packages/api-client` in the same PR; the actor is the integer `user_id`. ✅ |
| V. AI proposes | Changes applied from assistant proposals are recorded with the approving person as actor. ✅ |
| VI. Never invent state | A deleted actor shows as "Deleted user", a missing subject name shows its kind only. ✅ |
| VII. Durable, idempotent | Events are written inside the change's transaction. The log is not pruned (as before); a retention period is a separate decision (ADR-028). ✅ |
| VIII. One design system | Page composes `PageHeader`, `Panel`, `SearchableSelect`, `RelativeTime`; the timeline is a kit component with a story. ✅ |
| IX. Verified where it runs | api and admin rebuilt and the page exercised in the running stack. ✅ |

## Design

### Storage (`2026_10_31_120000_create_activity_log.php`)

`activity_log` follows the package's schema (`log_name`, `description`, nullable
morphs `subject` and `causer`, `event`, `attribute_changes`, `properties`, timestamps)
with jsonb columns, plus:

- `organization_id` nullable, foreign key restricting organization deletion (as
  `device_audit_events` did; organization deletion removes them first);
- `subject_uuid` nullable uuid, `subject_name` nullable string.

Indexes: `(organization_id, id)`, `(causer_id, id)`, `(subject_uuid, created_at)` (billing
history), `(event, id)` (retention inspection). The migration copies every
`device_audit_events` row ordered by id (`event` and `description` = action,
`causer_type` = the User class when `actor_id` is set, `properties` = details,
`subject_uuid` = resource UUID, both timestamps = `created_at`) and drops the old table.
`down()` recreates the old table and copies back.

### Domain (`app/Domain/Audit`)

- `Models/Activity` extends the package model: table, casts, `organization` relation.
  `config/activitylog.php` points `activity_model` at it, default log name `audit`.
- `Services/ActivityLog::record(string $action, ?int $organization, User|int|null $actor,
  Model|string|null $subject, array $details = [], array $changes = [])`: builds the
  activity through `activity()`, sets the causer only when given (no implicit auth
  causer, so system events stay system events), the subject morph when a model is
  passed, `subject_uuid` and `subject_name` from the model or the UUID.
- `Services/ActivityChanges`: turns a model's `getPrevious()`/`getChanges()` or two
  arrays into the package's `{attributes, old}` shape for listed fields, dropping
  secret-looking keys (`password`, `secret`, `token`, `key`, `credential`).
- `Services/ActivityCatalogue`: action code → sentence ("updated device") and subject
  kind ("device"); unknown codes are humanised.
- `Services/ActivityFeed`: the admin query (actor not null, filters, keyset cursor
  paging, eager actors and organizations, current subject names per kind).
- `Http/Controllers/PlatformActivityController@index`, `Http/Resources/ActivityResource`,
  `routes/api.php`: `GET /api/v1/admin/activity?user_id=&organization=&cursor=`, gated by
  `PlatformAdministration.manage-organizations`.

`DeviceAudit::record()` delegates to `ActivityLog::record()`.

### Readers moved

`BillingAccountHistory` (by `subject_uuid`, `event`, `properties`), `RetentionService`
(`event = retention.cleanup`, `properties->status`), `OrganizationDeletion`
(`REMOVED_FIRST` and the inspection count), `tooling/verify-workflow-execution.php`,
`tooling/verify-integration-sdk.php`.

### New recording points

| Area | Where | Actions |
| --- | --- | --- |
| Members | `OrganizationMembershipManager` | `organization.member.roles_changed` (roles before/after), `organization.member.removed` |
| Roles | `OrganizationRoleManager` | `organization.role.created`, `.updated` (name, permissions added/removed), `.deleted`; platform `role.permissions_updated` |
| Invitations | `OrganizationInvitationManager` | `organization.invitation.sent`, `.resent`, `.revoked`, `.accepted`; `super_administrator.invited` |
| Organizations | `PlatformOrganizationController`, `OrganizationPermissionCeiling`, `BillingAccounts::move` | `organization.created`, `organization.updated` (changes), `organization.permissions_updated`; `organization.billing_account_changed` gains its organization |
| Platform team | `PlatformTeamController` / `PlatformAdministrators` | already recorded; checked |
| Dashboards | `SaveDashboard`, `DashboardController` | `dashboard.created`, `.updated` (name, folder, tags; layout/widgets as changed), `.duplicated`, `.restored`, `.access_changed`, `.deleted` |
| Device profiles | `CreateDeviceProfile`, `UpdateDeviceProfile`, `DeviceProfileAuthoring::mutate`, `PublishDeviceProfile`, destroy | `device_profile.created`, `.updated` (changes), `.draft_changed` (what: e.g. `parameter.created` with its key), `.published`, `.archived`/`.deleted` |
| Devices, sites, settings | `DeviceController@update`, `SiteController` | existing events gain `changes` |

### Contract and client

OpenAPI export picks up the route; a supplement entry in
`contracts/openapi/supplements/platform-admin.yaml` describes it if the exporter needs
one. `packages/api-client/src/activity.ts`: `ActivityEntry`, `ActivityPage`,
`listPlatformActivity(query)` on the client.

### Kit (`packages/ui`)

`components/activity-timeline.tsx`: `ActivityTimeline` (days with sticky labels),
`ActivityDay`, `ActivityItem` (avatar initials, sentence slot, meta slot with
`RelativeTime`, collapsible changes list) and `ActivityChanges`. Story
`apps/storybook/src/components/ActivityTimeline.stories.tsx`.

### Admin (`apps/admin`)

`pages/ActivityPage.tsx` at `/activity`, nav item "Activity" (History icon) for people
who can manage organizations. `PageHeader` with the two `SearchableSelect`s (server
search through `useSearchOptions` on `/admin/users` and `/admin/organizations`), filters
in the URL (`?user=&organization=`), `useInfiniteQuery` on the cursor, timeline in a
`Panel`, Load older, empty/filtered-empty/error states. E2E:
`apps/admin/e2e/activity.spec.ts` with a mocked API.

### Documentation

`docs/features/activity-log.md` (what is recorded and where to see it), ADR index,
`docs/dev/gotchas.md` (record through `ActivityLog`; the old table is gone; no causer
FK), API reference/supplement.

## Project Structure

### Documentation (this feature)

```text
specs/024-activity-log/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/admin-activity.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/app/Domain/Audit/{Models,Services,Http,routes}
apps/api/config/activitylog.php
apps/api/database/migrations/2026_10_31_120000_create_activity_log.php
apps/api/tests/Feature/Domain/Audit/
packages/api-client/src/activity.ts
packages/ui/src/components/activity-timeline.tsx
apps/storybook/src/components/ActivityTimeline.stories.tsx
apps/admin/src/pages/ActivityPage.tsx
apps/admin/e2e/activity.spec.ts
```

## Delivery

One pull request against `main` (the owner merges PR lists at once, so no stacked
PRs), with one commit each for the documents, the API, and the kit and admin app. ADR-028
stays Proposed until the owner accepts it.

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| Spec, plan and implementation in one PR instead of a documents PR first | The owner asked for the feature in one PR and merges PR lists at once | Two PRs would land together anyway |
| Three columns added to the package's table | Organization filter, UUID lookups for billing history, and names for deleted subjects | Querying JSON properties for every filter cannot use plain indexes |
