# Implementation Plan: Delete Empty Organizations

**Branch**: `feat/delete-empty-organizations` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-delete-empty-organizations/spec.md`

## Summary

One service, `OrganizationDeletion`, owns the rules. It classifies everything that
refers to an organization and either reports it or deletes it:

- **Blockers** are counted per organization. Any non-zero count refuses the delete.
- **Removed data** is counted for the confirmation dialog, then deleted with the
  organization. Most of it cascades from `organizations`; audit events and retention
  settings use restrictive keys and are deleted explicitly first.
- **Side effects** outside cascading rows: agent tokens are revoked before the delete;
  assistant files and SDK conversation rows are removed and the permission cache is
  cleared after commit.

Two admin routes expose it, the Organizations list gains a Devices column and a
**Delete organization** action, and a schema test keeps the classification complete.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: spatie/laravel-permission (teams), Laravel Passport (agent
tokens), `@iot-os/ui` (`AlertDialog`, `TextField`, `DataTable`)

**Storage**: PostgreSQL 17; no migration

**Testing**: PHPUnit on PostgreSQL in CI (and locally against a throwaway
`timescale/timescaledb:2.29.2-pg17`); Playwright with a mocked API for admin

**Target Platform**: admin app and API (pilot release profile)

**Project Type**: web application

**Scale/Scope**: 1 service, 1 controller, 2 resources, 1 dialog, 1 column

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Only Laravel rows change. Runtime tables (`device_runtime`, read-only to the API in release) hold rows only for organizations with devices, which block. |
| II. Immutable versions | Pass. Organizations with profiles, automations or deployments block; nothing activated is touched. |
| III. Tenant isolation | Pass. Platform administrators only; every query is scoped by `organization_id`. A test proves another organization's members, roles, audit events and agent tokens survive. |
| IV. Contracts first | Pass. Both operations are described in the export with their 409/422 responses (not added to the pending list), and `packages/api-client` gains both methods. |
| V. AI proposes | Pass. Not exposed to agents or the assistant. |
| VI. Show uncertainty | Pass. The dialog shows live counts and re-checks on confirm. |
| VII. Durable messaging | Pass. No events are emitted; organizations with outbox-producing resources block. |
| VIII. One design system | Pass. Kit `AlertDialog`, `TextField`, `DataTable` column; no new kit component. |
| IX. Verified where it runs | Pass. PostgreSQL CI, rebuilt `api` and `admin`, browser walk-through, then the pilot (SC-001). |

## Design

### Classification (`app/Domain/Administration/Services/OrganizationDeletion.php`)

**Blockers** (label, count query by `organization_id`):

| Blocker | Tables |
| --- | --- |
| Devices | `devices` |
| Broker connections | `sparkplug_connections` |
| Gateways | `sparkplug_gateways`, `device_discovery_candidates` |
| Adapter runtimes | `device_adapter_tenants` |
| Device profiles | `device_profiles` including soft-deleted (its key sets null, which would turn them into platform templates) |
| Automations | `automation_workflows`, `automation_alerts`, `automation_actions` |
| Integrations | `integration_applications`, `integration_streams`, `integration_events` |
| Geofences | `geofences`, `geofence_assignments`, `geofence_activation_batches`, `geofence_events`, `device_location_bindings` |
| Assistant runs in progress | `assistant_runs` with `reserved_usd > 0` on the organization's conversations |

**Removed data** (counted for the dialog): members (`organization_user`), roles,
invitations, dashboards, sites, AI-agent connections, assistant conversations, audit
events (`device_audit_events`). Retention settings, the permission ceiling, automation
settings, notification events and role assignments are removed without being listed.

**Delete order** inside `DB::transaction` with the organization row locked
(`lockForUpdate`) and blockers re-counted:

1. Revoke each agent connection's Passport tokens (`AgentConnection::revokeTokens`).
2. Collect assistant conversation ids and SDK conversation ids; delete the SDK
   message and conversation rows.
3. Delete `device_audit_events` and `telemetry_retention_settings` rows.
4. `forceDelete()` the organization; the remaining rows cascade.
5. Insert the `organization.deleted` audit event (organization null).

After commit: delete `assistant/<conversation id>` directories on the `local` disk and
call `forgetCachedPermissions()`.

### Guard test (FR-008)

`OrganizationDeletionInventoryTest` lists every foreign key that references
`organizations` through `Schema::getTables()` and `Schema::getForeignKeys()` (works on
SQLite and PostgreSQL). Each key that does not cascade must belong to a blocker or to
the explicitly removed tables. A new table fails the test until it is classified.

### API

- `GET /api/v1/admin/organizations/{organization}/deletion` →
  `OrganizationDeletionResource`: `organization` (uuid, name, slug), `deletable`,
  `blockers[]` and `removes[]` (`key`, `label`, `count`; only non-zero entries).
- `DELETE /api/v1/admin/organizations/{organization}` with `{"slug": "<slug>"}` → 204;
  422 for a wrong slug; 409 with `blockers[]` when blocked.
- Both gated by `can:PlatformAdministration.manage-organizations`, with
  `whereUuid('organization')`.
- `GET /api/v1/admin/organizations` adds `devices_count` (a subquery, so the shared
  `OrganizationResource` only sends it when selected).

### Admin app

- `OrganizationsPage`: **Devices** column (links to nothing; a count) and a destructive
  **Delete organization** row action after a separator.
- `components/DeleteOrganizationDialog.tsx`: loads the deletion check; blocked → the
  list of blockers and a Close button; deletable → the removed-data list, "This cannot
  be undone", a slug field and a destructive **Delete organization** button enabled
  only when the slug matches. A 409 on confirm swaps to the blocked view with the
  returned blockers.

## Project Structure

### Documentation (this feature)

```text
specs/006-delete-empty-organizations/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/app/Domain/Administration/
├── Services/OrganizationDeletion.php                 # new
├── Http/Controllers/PlatformOrganizationDeletionController.php  # new
├── Http/Requests/DeleteOrganizationRequest.php       # new
├── Http/Resources/OrganizationDeletionResource.php   # new
├── Http/Controllers/PlatformOrganizationController.php  # devices_count
└── routes/api.php
apps/api/app/Domain/Shared/Http/Resources/OrganizationResource.php  # devices_count when selected
apps/api/tests/Feature/Domain/Administration/OrganizationDeletionApiTest.php
apps/api/tests/Feature/Domain/Administration/OrganizationDeletionInventoryTest.php
contracts/openapi/openapi.json, contracts/openapi/supplements/platform-admin.yaml
packages/api-client/src/index.ts
apps/admin/src/pages/OrganizationsPage.tsx
apps/admin/src/components/DeleteOrganizationDialog.tsx
apps/admin/e2e/admin.spec.ts
docs/features/access.md
```

**Structure Decision**: the Administration domain owns organization lifecycle; it
reads other domains' tables only to count and delete by `organization_id`.

## Delivery

1. This documents-only pull request.
2. One implementation pull request based on `main`, then the release from `main` and
   the pilot deploy.

## Complexity Tracking

No violations.
