---

description: "Task list for platform administrators in admin (spec 008)"
---

# Tasks: Platform Administrators in Admin

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: Required (SC-002, SC-003). Constitution principle III needs T002's proof that
memberships and organization roles are untouched.

**Delivery**: every task lands in the single pull request (plan.md "Delivery"), except
T010.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an open task)
- **[Story]**: US1 or US2

## Phase 1: Foundational

- [x] T001 `PlatformAdministrators` service in `apps/api/app/Domain/Administration/Services/`: `grant`, `revoke` (lock actor and user in id order, actor re-check, no-op without an event), audit events (plan.md "Service")
- [x] T002 [P] API tests in `PlatformAdministratorApiTest.php` covering every acceptance scenario and edge case of the spec: grant and revoke with audit rows; repeats write no event; the user can open admin after a grant and is refused after a removal; memberships and organization roles are unchanged; a demoted actor is refused under the lock; platform administrators and tenant users get 403; a non-numeric or unknown id is 404

## Phase 2: User Stories 1 and 2 - Make and remove platform administrators (P1) 🎯 MVP

- [x] T003 [US1] [US2] `PlatformTeamController::update` calls the service; `whereNumber('user')` on the route
- [x] T004 [US1] [US2] Contract: fully type `PlatformTeamMemberResource`; remove `PUT /v1/admin/platform-team/{user}` from `pending-schemas.json`; `contract:export --check` and `contract:check` pass
- [x] T005 [US1] [US2] `packages/api-client`: `PlatformTeamMember`, `grantPlatformAdministrator`, `revokePlatformAdministrator`
- [x] T006 [US1] [US2] Admin: signed-in user passed to `UsersPage`; **Make platform administrator** / **Remove platform administrator** row actions and `components/PlatformAdministratorDialog.tsx`
- [x] T007 [US1] [US2] Playwright: promote a tenant user, remove the role again, no action on a super administrator's row, no actions for a platform administrator

## Phase 3: Polish

- [x] T008 [P] Docs: platform administrators in `docs/features/access.md` (Platform administration), `docs/architecture/glossary.md` and `apps/admin/README.md`
- [x] T009 Checks: `php artisan test --compact` on PostgreSQL, `pint --test`, `contract:export --check`, `contract:check`, admin and portal lint, admin Playwright; rebuild `api` and `admin` and walk SC-001 and SC-002 in the browser
- [ ] T010 Release from `main`, deploy to the pilot

## Dependencies

T001 before T002 and T003. T003–T005 before T006–T007. T008–T010 last.
