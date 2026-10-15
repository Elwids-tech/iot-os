---

description: "Task list for super administrators in admin (spec 007)"
---

# Tasks: Super Administrators in Admin

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: Required (SC-002, SC-003). Constitution principle III needs T003's proof that
organization invitations and memberships are untouched.

**Delivery**: every task lands in the single pull request (plan.md "Delivery"),
except T017.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an open task)
- **[Story]**: US1, US2 or US3

## Phase 1: Foundational

- [x] T001 Migration `2026_10_14_120000_add_super_administrator_invitations.php`: nullable `organization_invitations.organization_id`, `grants_super_admin` boolean, PostgreSQL check constraint; `OrganizationInvitation` fillable and cast
- [x] T002 `SuperAdministrators` service in `apps/api/app/Domain/Administration/Services/`: `grant`, `revoke` (self-refusal, lock on every super administrator in id order, actor re-check), `promote`, audit events (plan.md "Service")
- [x] T003 [P] API tests in `SuperAdministratorApiTest.php` covering every acceptance scenario and edge case of the spec: grant and revoke with audit rows; repeats write no event; self-removal 422; a demoted actor is refused under the lock; platform administrators and tenant users get 403 on all three operations and on revoking a super-administrator invitation; invite, re-invite revokes the earlier one, existing super administrator 422; listing shows `organization: null`; accept creates a super administrator without membership; a signed-in existing account is promoted and keeps memberships; an inviter who lost access voids the link; organization invitations and other organizations' memberships are unchanged

## Phase 2: User Stories 1 and 2 - Make and remove super administrators (P1) 🎯 MVP

- [x] T004 [US1] [US2] `SuperAdministratorController` (`update`, `destroy`) and routes with `whereNumber('user')`
- [x] T005 [US1] [US2] `packages/api-client`: `grantSuperAdministrator`, `revokeSuperAdministrator`
- [x] T006 [US1] [US2] Admin: signed-in user passed to `UsersPage`; **Make super administrator** / **Remove super administrator** row actions and `components/SuperAdministratorDialog.tsx`
- [x] T007 [US1] [US2] Playwright: promote a tenant user, remove a super administrator, no removal on one's own row, no actions for a platform administrator

## Phase 3: User Story 3 - Invite a new super administrator (P2)

- [x] T008 [US3] `OrganizationInvitationManager::inviteSuperAdministrator`, kind-aware `revoke`, `findPending` and `accept`; notification wording
- [x] T009 [US3] `SuperAdministratorInvitationController::store`, `StoreSuperAdministratorInvitationRequest`, route; `PlatformInvitationController::destroy` check; `OrganizationInvitationResource` and public `show` shapes
- [x] T010 [US3] Contract: export the three operations; `contract:export --check` and `contract:check` pass
- [x] T011 [US3] `packages/api-client`: `inviteSuperAdministrator`; nullable `organization` and `grants_super_admin` on `OrganizationInvitation` and `InvitationDetails`
- [x] T012 [US3] Admin: "Invite as" choice in `InviteUserDialog`; super-administrator rows and resend in `PendingInvitations`
- [x] T013 [US3] Shared accept page: super-administrator wording and `adminUrl` link; portal and admin pass it
- [x] T014 [US3] Playwright: invite a super administrator; the invitation lists as "All organizations"; platform administrators see only the organization flow

## Phase 4: Polish

- [x] T015 [P] Docs: super administrators in `docs/features/access.md` (Platform administration), `docs/architecture/glossary.md` and `apps/admin/README.md`
- [x] T016 Checks: `php artisan test --compact` on PostgreSQL, `pint --test`, `contract:export --check`, `contract:check`, admin and portal lint, admin Playwright; rebuild `api`, `admin` and `portal` and walk SC-001 and SC-002 in the browser
- [ ] T017 Release from `main`, deploy to the pilot

## Dependencies

T001 before T002 and T008. T002 before T003, T004 and T008. T004–T005 before T006–T007.
T008–T011 before T012–T014. T015–T017 last.
