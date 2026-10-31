# Tasks: Activity Log

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/admin-activity.md](contracts/admin-activity.md)

Delivered in one pull request against `main`, one commit per phase group.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: US1 timeline, US2 filters, US3 recording gaps

## Phase 1: Documents

- [x] T001 ADR-028 (Proposed) and its row in `docs/adr/README.md`
- [x] T002 `specs/024-activity-log/` spec, plan, research, data model, contract, quickstart, tasks

## Phase 2: Foundation (blocks every story)

- [x] T003 Require `spatie/laravel-activitylog` ^5.1 in `apps/api/composer.json`; add `apps/api/config/activitylog.php` (custom model, log name `audit`)
- [x] T004 Migration `2026_10_31_120000_create_activity_log.php`: create `activity_log` with the extra columns and indexes, copy `device_audit_events` in id order, drop it; `down()` reverses
- [x] T005 `app/Domain/Audit/Models/Activity` (table, casts, `organization` relation)
- [x] T006 `app/Domain/Audit/Services/ActivityLog::record()` and `ActivityChanges`; `DeviceAudit::record()` delegates
- [x] T007 Move readers: `BillingAccountHistory`, `RetentionService`, `OrganizationDeletion`, `tooling/verify-workflow-execution.php`, `tooling/verify-integration-sdk.php`
- [x] T008 Replace every `device_audit_events` query in `apps/api/tests` with the activity model
- [x] T009 Test: the migration copies rows with their fields and order (`tests/Feature/Domain/Audit/ActivityLogMigrationTest.php`)
- [x] T010 Test: `ActivityLog::record()` writes causer, organization, subject, changes; never takes the signed-in user implicitly; drops secret keys

## Phase 3: User Story 3, record what is missing (P1)

- [x] T011 [US3] Members: `OrganizationMembershipManager` roles changed and removed
- [x] T012 [US3] Roles: `OrganizationRoleManager` created, updated, deleted, platform role permissions
- [x] T013 [US3] Invitations: `OrganizationInvitationManager` sent, resent, revoked, accepted, super administrator invited
- [x] T014 [US3] Organizations: `PlatformOrganizationController` created and updated, `OrganizationPermissionCeiling` updated, `BillingAccounts::move` carries the organization
- [x] T015 [US3] Dashboards: created, updated, duplicated, restored, access changed, deleted
- [x] T016 [US3] Device profiles: created, updated, draft changed, published, deleted
- [x] T017 [US3] Devices and sites: existing `device.updated`, `site.updated` record changes
- [x] T018 [US3] Tests for T011–T017 (`tests/Feature/Domain/Audit/ActivityRecordingTest.php`), including an organization isolation check

## Phase 4: User Stories 1 and 2, the admin API (P1)

- [x] T019 [US1] `ActivityCatalogue` (sentence and subject kind per action, humanised fallback)
- [x] T020 [US1] `ActivityFeed` query: actor only, newest first, cursor paging, eager actor and organization, current subject names per kind
- [x] T021 [US1] [US2] `PlatformActivityController@index`, `ActivityResource`, route `GET /api/v1/admin/activity`, request validation
- [x] T022 [US1] [US2] Tests: permission, system events excluded, paging, filters, deleted actor, cross-organization filter (`tests/Feature/Domain/Audit/PlatformActivityApiTest.php`)
- [x] T023 [P] OpenAPI export (`php artisan contract:export`), supplement entry, `contract:check`
- [x] T024 [P] `packages/api-client/src/activity.ts` and client method

## Phase 5: User Stories 1 and 2, the admin app (P1)

- [x] T025 [P] [US1] Kit `ActivityTimeline` in `packages/ui/src/components/activity-timeline.tsx` with a story in `apps/storybook/src/components/ActivityTimeline.stories.tsx`
- [x] T026 [US1] `apps/admin/src/pages/ActivityPage.tsx`, route `/activity`, nav item
- [x] T027 [US2] Person and Organization `SearchableSelect`s with server search, kept in the URL, Clear filters
- [x] T028 [US1] [US2] Playwright `apps/admin/e2e/activity.spec.ts` (mocked API: timeline, changes, load older, filters in URL, empty state)

## Phase 6: Polish and verification

- [x] T029 `docs/features/activity-log.md`, `docs/dev/gotchas.md`, docs index links
- [x] T030 `php artisan test --compact`, `vendor/bin/pint --test`, `pnpm --filter @iot-os/admin lint`, `pnpm --filter @iot-os/ui` checks, admin e2e
- [x] T031 Rebuild api family and admin; verify the page in the running stack (quickstart)
- [ ] T032 Open the pull request against `main`

## Dependencies

Phase 2 blocks everything. Phase 3 and Phase 4 can proceed in parallel after it.
Phase 5 needs T021 and T024. Phase 6 last.
