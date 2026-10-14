---

description: "Task list for deleting empty organizations (spec 006)"
---

# Tasks: Delete Empty Organizations

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: Required (FR-008, SC-002, SC-003). Constitution principle III needs the
cross-organization check in T002.

**Delivery**: every task lands in the single implementation pull request
(plan.md "Delivery", step 2), except T014.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an open task)
- **[Story]**: US1 or US2

## Phase 1: Foundational

- [x] T001 `OrganizationDeletion` service in `apps/api/app/Domain/Administration/Services/`: blocker and removed-data counts, `deletable()`, `delete(Organization, User)` with the lock, re-check, ordered deletes, token revocation, audit event and after-commit cleanup (plan.md "Design")
- [x] T002 [P] API tests in `OrganizationDeletionApiTest.php`: deletes an organization holding members, custom and built-in roles, invitations, a dashboard, a site, a retention override, audit events, an agent connection with tokens and an assistant conversation with a stored file; members keep accounts; tokens are revoked; the invitation no longer resolves; the slug is reusable; one `organization.deleted` event; another organization's rows are untouched; devices, a connection, a gateway, an adapter tenant, a soft-deleted profile, a workflow and an assistant reservation each block with 409; wrong slug is 422; non-administrators get 403; unknown uuid 404
- [x] T003 [P] Guard test `OrganizationDeletionInventoryTest.php` (FR-008)

## Phase 2: User Story 1 - Delete an empty organization (P1) 🎯 MVP

- [x] T004 [US1] `PlatformOrganizationDeletionController` (`show`, `destroy`), `DeleteOrganizationRequest`, `OrganizationDeletionResource`, routes with `whereUuid`
- [x] T005 [US1] `devices_count` on `GET /admin/organizations`
- [x] T006 [US1] Contract: export both operations with their 409/422 responses; `contract:check` passes without growing the pending list
- [x] T007 [US1] `packages/api-client`: `adminOrganizationDeletion`, `deleteAdminOrganization`, types; `devices_count` on `Organization`
- [x] T008 [US1] Admin: Devices column and **Delete organization** row action in `OrganizationsPage.tsx`; `components/DeleteOrganizationDialog.tsx` (removed-data list, slug field, destructive confirm)
- [x] T009 [US1] Playwright: delete an empty organization after typing its slug; the row disappears

## Phase 3: User Story 2 - See why it cannot be deleted (P2)

- [x] T010 [US2] Blocked view in the dialog; a 409 on confirm switches to it with the returned blockers
- [x] T011 [US2] Playwright: an organization with devices shows its blockers and no delete button; a blocker appearing before confirm shows the blocked view

## Phase 4: Polish

- [x] T012 [P] Docs: deletion rules in `docs/features/access.md` (Platform administration) and `apps/admin/README.md`
- [x] T013 Checks: `php artisan test --compact` on PostgreSQL, `pint --test`, `contract:export --check`, `contract:check`, admin and portal lint, admin Playwright; rebuild `api` and `admin` and walk US1 and US2 in the browser
- [ ] T014 Release from `main`, deploy to the pilot, and check SC-001 there

## Dependencies

T001 before T002–T004. T004–T007 before T008–T011. T012–T014 last.
