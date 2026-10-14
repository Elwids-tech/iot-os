---

description: "Task list for organization roles in admin (spec 005)"
---

# Tasks: Organization Roles in Admin

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: Required (FR-008, SC-002). Constitution principle III needs the
cross-organization checks in T001.

**Delivery**: every task lands in the single implementation pull request
(plan.md "Delivery", step 2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an open task)
- **[Story]**: US1 to US3

## Phase 1: Foundational

- [x] T001 [P] API tests in `apps/api/tests/Feature/Domain/Administration/PlatformOrganizationRoleApiTest.php`: a non-member platform administrator creates an organization, reads its `role-permissions`, creates a custom role, finds it in `GET /admin/roles`, invites with it and the invitee accepts holding it; renames (duplicate name rejected), deletes only when unused, cannot delete a built-in role; a ceiling-external permission is rejected; a role from another organization is 404; a member of one organization gets 403 creating roles in another
- [x] T002 Document the `422` from `DELETE /v1/organizations/{organization}/roles/{role}` in `contracts/openapi/supplements/administration.yaml`, run `php artisan contract:export`, record it in `specs/001-openapi-contract/drift-log.md`

## Phase 2: User Story 1 - Create a role (P1) 🎯 MVP

- [x] T003 [US1] `apps/admin/src/pages/NewRolePage.tsx`: organization select (preselected from `?organization=`), role name, `PermissionMatrix` from `organizationRolePermissions`, sticky bar with `keepToastsAbove`, discard guard, field errors; on success toast and replace to `/roles/{id}`
- [x] T004 [US1] Route `roles/new` in `apps/admin/src/App.tsx` before `roles/:roleId`
- [x] T005 [US1] **New role** on `apps/admin/src/pages/RolesPage.tsx`, carrying the organization filter
- [x] T006 [US1] **Roles** and **New role** row actions on `apps/admin/src/pages/OrganizationsPage.tsx`
- [x] T007 [US1] Playwright: create a role from the Roles page and from an organization row; duplicate-name error keeps input (`apps/admin/e2e/admin.spec.ts`)

## Phase 3: User Story 2 - Invite with the organization's roles (P2)

- [x] T008 [US2] `initialOrganizationUuid` on `apps/admin/src/components/InviteUserDialog.tsx`
- [x] T009 [US2] **Invite user** row action on `OrganizationsPage.tsx`; `UsersPage.tsx` passes its organization filter
- [x] T010 [US2] Playwright: invite from an organization row preselects it and lists its custom role; the admin specs now run in CI's end-to-end job

## Phase 4: User Story 3 - Rename and delete (P3)

- [x] T011 [US3] `apps/admin/src/components/RoleDialogs.tsx`: rename dialog (sends saved permissions) and delete confirmation, both showing API errors
- [x] T012 [US3] Header actions on `apps/admin/src/pages/RolePermissionsPage.tsx`: **Rename** except Organization Admin, **Delete role** for custom roles
- [x] T013 [US3] Playwright: rename keeps unsaved ticks; delete returns to Roles; a role in use shows the API reason

## Phase 5: Polish

- [x] T014 [P] Docs: `docs/features/access.md` (Platform administration) and `apps/admin/README.md`
- [x] T015 `./taskw lint`-equivalent checks: `pnpm --filter @iot-os/admin lint`, admin Playwright, `php artisan test --compact`, `pint --test`, `contract:export --check`
- [x] T016 Rebuild the `admin` container and walk SC-001 in the browser: new organization → new role → invite
- [ ] T017 Release from `main` and deploy to the pilot (docs/ops/pilot.md); check the admin flow there

## Dependencies

T001–T002 first (they define what the UI relies on). US1, US2 and US3 are
independent after that; T014–T017 last.
