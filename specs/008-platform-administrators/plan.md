# Implementation Plan: Platform Administrators in Admin

**Branch**: `feat/platform-administrators` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-platform-administrators/spec.md`

## Summary

A small service, `PlatformAdministrators`, owns the role change: it locks the actor and
the user, re-checks that the actor is a super administrator, attaches or detaches the
`platform-administrator` platform role, and records an audit event when something
changed. `PlatformTeamController::update` calls it; the route and its request and
response shapes stay as they are.

The admin Users page gains **Make platform administrator** / **Remove platform
administrator** row actions for super administrators, with an `AlertDialog`
confirmation, in the same shape as spec 007's super-administrator actions.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: Laravel Sanctum (sessions), `@iot-os/ui` (`AlertDialog`,
`DataTable` row actions)

**Storage**: PostgreSQL 17; no migration (`platform_role_user` exists)

**Testing**: PHPUnit on PostgreSQL in CI (and locally against a throwaway
`timescale/timescaledb:2.29.2-pg17`); Playwright with a mocked API for admin

**Target Platform**: admin app and API (pilot release profile)

**Project Type**: web application

**Scale/Scope**: 1 service, 1 controller change, 1 resource typed, 1 admin dialog

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel only; the runtime never sees users. |
| II. Immutable versions | Pass. Nothing versioned is touched. |
| III. Tenant isolation | Pass. The role is cross-organization by design; this changes who holds it, not what it allows. Tests prove memberships and organization roles are untouched. |
| IV. Contracts first | Pass. The platform-team resource is fully typed, so the update leaves the pending-schema list; `packages/api-client` gains typed calls. User references are integer ids. |
| V. AI proposes | Pass. Not exposed to agents or the assistant. |
| VI. Show uncertainty | Pass. The Users list reloads after each change rather than assuming it. |
| VII. Durable messaging | Pass. No events are emitted. |
| VIII. One design system | Pass. Kit `AlertDialog` and `DataTable` row actions; no new kit component. |
| IX. Verified where it runs | Pass. PostgreSQL CI, rebuilt `api` and `admin`, browser walk-through of SC-001 and SC-002. |

## Design

### Service (`app/Domain/Administration/Services/PlatformAdministrators.php`)

- `grant(User $actor, User $user)` and `revoke(User $actor, User $user)` run in one
  transaction that locks the actor's and the user's rows in id order
  (`lockForUpdate`) and requires the locked actor to be a super administrator (403
  otherwise). Spec 007's `SuperAdministrators` locks every super administrator in id
  order, so the two serialize without deadlocking: a grant racing the removal of its
  actor's access either finishes first or sees the actor already removed. Locking the
  user's row also serializes two changes to the same person, so the no-op check below
  is exact.
- The role is looked up by `PlatformRoleName::PLATFORM_ADMINISTRATOR`. When the user
  already holds it (grant) or does not (revoke), nothing is written. Otherwise the
  pivot row is attached or detached and `user.platform_administrator_granted` or
  `user.platform_administrator_revoked` is recorded through `DeviceAudit::record` with
  no organization, the actor id, and `user_id` and `email` in the details (users have
  no uuid, ADR-013), as spec 007's events are.
- Platform permissions are read from the database on every check
  (`PlatformAuthorization::allows`), so there is no cache to clear.

### API

- `PlatformTeamController::update` keeps its `abort_unless($user->is_super_admin, 403)`
  (the export infers the 403 from it, so the supplement needs no entry) and calls the
  service. The response stays `PlatformTeamMemberResource`.
- `platform-team/{user}` gains `whereNumber('user')`: a non-numeric id is 404 at the
  route rather than a PostgreSQL type error.
- `PlatformTeamMemberResource` is fully typed the way spec 007 types
  `PlatformUserResource` (role summaries from a private method with a
  `@return list<array{...}>` docblock, `(int)` and `(bool)` casts).
  `PUT /v1/admin/platform-team/{user}` then has a closed body and leaves
  `pending-schemas.json`. `GET /v1/admin/platform-team` stays pending: the paginated
  collection wraps each item in an `allOf` the check counts as open, as it does for
  `GET /v1/admin/users`, and no first-party client calls it. `contract:export --check`
  and `contract:check` must pass.

### Admin app

- `App.tsx` passes the signed-in user to `UsersPage` (the same change spec 007 makes).
  `is_super_admin` on `/me` decides what is offered; the API re-checks.
- `UsersPage`: for super administrators, rows of users who are not super
  administrators get **Make platform administrator** or **Remove platform
  administrator** (destructive) after the member actions and a separator.
  `components/PlatformAdministratorDialog.tsx` is the `AlertDialog` confirmation; on
  success a toast and a reload.
- `packages/api-client`: `grantPlatformAdministrator(userId)` and
  `revokePlatformAdministrator(userId)` call the `PUT` with `is_platform_administrator`
  `true` or `false` and return a `PlatformTeamMember`.

## Project Structure

### Documentation (this feature)

```text
specs/008-platform-administrators/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/app/Domain/Administration/
├── Services/PlatformAdministrators.php                  # new
├── Http/Controllers/PlatformTeamController.php
├── Http/Resources/PlatformTeamMemberResource.php
└── routes/api.php
apps/api/tests/Feature/Domain/Administration/PlatformAdministratorApiTest.php  # new
contracts/openapi/openapi.json, contracts/openapi/pending-schemas.json
packages/api-client/src/index.ts
apps/admin/src/App.tsx
apps/admin/src/pages/UsersPage.tsx
apps/admin/src/components/PlatformAdministratorDialog.tsx  # new
apps/admin/e2e/admin.spec.ts
docs/features/access.md, docs/architecture/glossary.md, apps/admin/README.md
```

**Structure Decision**: the Administration domain owns users' platform access; no other
domain changes.

## Delivery

One pull request based on `main` with these documents and the implementation, then the
release from `main` and the pilot deploy. Spec 007's pull request edits the same admin
files (`App.tsx`, `UsersPage.tsx`, `admin.spec.ts`, the API client and the access
docs); whichever merges second is rebased onto the other, keeping both sets of row
actions.

## Complexity Tracking

No violations.
