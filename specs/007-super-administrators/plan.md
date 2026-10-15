# Implementation Plan: Super Administrators in Admin

**Branch**: `feat/super-administrators` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-super-administrators/spec.md`

## Summary

One service, `SuperAdministrators`, owns the flag: it grants and removes
`users.is_super_admin` under a lock on every super administrator, refuses to leave the
actor without access, and writes the audit event. Two admin routes call it for existing
users.

Super-administrator invitations reuse `organization_invitations`: a row with
`grants_super_admin = true` has no organization and no roles. They share the token,
mail, listing, revoke and acceptance code with organization invitations, so the public
accept link and the admin Invitations list need no second table. Acceptance calls the
same service instead of adding a membership.

The admin Users page gains the two row actions, **Invite user** gains a choice between
an organization member and a super administrator, and the shared accept page explains
the new kind.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: Laravel Sanctum (sessions), Laravel notifications (mail),
`@iot-os/ui` (`AlertDialog`, `ChoiceCard` in a `RadioGroup`, `DataTable` row actions)

**Storage**: PostgreSQL 17; one migration on `organization_invitations`

**Testing**: PHPUnit on PostgreSQL in CI (and locally against a throwaway
`timescale/timescaledb:2.29.2-pg17`); Playwright with a mocked API for admin

**Target Platform**: admin app, portal accept page and API (pilot release profile)

**Project Type**: web application

**Scale/Scope**: 1 service, 2 controllers, 1 request, 1 migration, 2 admin dialogs, the
shared accept page

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel only; the runtime never sees users. |
| II. Immutable versions | Pass. Nothing versioned is touched. |
| III. Tenant isolation | Pass. Super administrators already cross organizations by design; this changes who holds the flag, not what it allows. A super-administrator invitation adds no membership, and tests prove organization invitations and memberships are untouched by it. |
| IV. Contracts first | Pass. The three operations and the changed invitation shapes are exported to the OpenAPI description; `packages/api-client` gains the methods and nullable `organization`. User references are integer ids. |
| V. AI proposes | Pass. Not exposed to agents or the assistant. |
| VI. Show uncertainty | Pass. The Users list reloads after each change rather than assuming it. |
| VII. Durable messaging | Pass. No events are emitted. |
| VIII. One design system | Pass. Kit `AlertDialog`, `ChoiceCard`, `RadioGroup`, `DataTable` row actions; no new kit component. |
| IX. Verified where it runs | Pass. PostgreSQL CI, rebuilt `api`, `admin` and `portal`, browser walk-through of SC-001 and SC-002. |

## Design

### Data (`organization_invitations`)

A migration makes `organization_id` nullable and adds `grants_super_admin` (boolean,
default false). On PostgreSQL a check constraint
`organization_invitations_kind_check` enforces `(organization_id IS NULL) =
grants_super_admin`, so an organization invitation can never lose its organization and
grant super administrator access by accident. Organization invitations still cascade
when their organization is deleted; super-administrator invitations have no
organization to cascade from.

`OrganizationInvitation` casts `grants_super_admin` to boolean. The model keeps its name:
renaming it would touch every organization invitation path for no behaviour change.

### Service (`app/Domain/Administration/Services/SuperAdministrators.php`)

- `grant(User $actor, User $user)` and `revoke(User $actor, User $user)` run in a
  transaction that first locks every `is_super_admin` row in id order
  (`lockForUpdate`), then requires the actor to be among them (403 otherwise). This
  makes two super administrators removing each other serialize: the second sees its
  actor already removed. `revoke` refuses `$actor->is($user)` with a 422 field error on
  `user` before locking.
- `promote(User $user, ?int $actorId, array $details)` sets the flag with `forceFill`
  and records `user.super_admin_granted`; `revoke` records `user.super_admin_revoked`.
  Neither writes when the flag already has the target value. Events go through
  `DeviceAudit::record` with no organization, the actor id, and `user_id` and `email`
  in the details (users have no uuid, ADR-013), as `organization.deleted` does.

Spec 003's planned `NoSuperAdminBypassTest` (T089) bans `is_super_admin` from
`Domain/**/Services`; this service manages the flag rather than bypassing with it, so
that test must list it as an exception, and US6 (T086) must make `promote`/`revoke`
attach and detach the `super-administrator` platform role.

### Invitations (`OrganizationInvitationManager`)

- `inviteSuperAdministrator(User $invitedBy, string $email)`: lower-cases the email,
  refuses an email that belongs to a super administrator (422 on `email`), revokes any
  pending super-administrator invitation for that email, creates the row
  (`organization_id` null, `role_ids` `[]`, `grants_super_admin` true) and mails it.
- `revoke` skips the organization grant check for super-administrator invitations; the
  controller has already required a super administrator.
- `findPending` and `accept` treat a super-administrator invitation as inactive when
  its inviter is no longer a super administrator, so removing someone's access also
  voids the invitations they sent.
- `accept` creates or matches the account exactly as today, then, for a
  super-administrator invitation, calls `SuperAdministrators::promote` with the inviter
  as actor and the invitation uuid in the details, instead of attaching a membership.
- `OrganizationInvitationNotification` words the mail for the kind: "You have been
  invited to administer IoT OS" and what super administrators can do. The link is the
  same portal `/accept-invitation` URL.

### API

- `PUT /api/v1/admin/super-administrators/{user}` → 200 `PlatformUserResource` (with
  organizations and platform roles); `DELETE …/{user}` → 204, 422 for oneself.
  `whereNumber('user')`.
- `POST /api/v1/admin/super-administrators/invitations` (`email`) → 201
  `OrganizationInvitationResource`; 422 for an existing super administrator.
- All three: `SuperAdministratorController` / `SuperAdministratorInvitationController`
  call `abort_unless($user->is_super_admin, 403)`, as `PlatformTeamController` does.
- `PlatformInvitationController::destroy` requires a super administrator for a
  super-administrator invitation; `index` lists both kinds to platform administrators.
- `OrganizationInvitationResource` adds `grants_super_admin` and returns `organization`
  as `null` when there is none. The public `GET invitations/{token}` adds
  `grants_super_admin` and returns `organization: null` for that kind.
- The OpenAPI export picks the operations up from the routes; `contract:export --check`
  and `contract:check` must pass.

### Admin app

- `App.tsx` passes the signed-in user to `UsersPage`. `is_super_admin` on `/me` decides
  what is offered; the API re-checks.
- `UsersPage`: row actions **Make super administrator** or **Remove super
  administrator** (never on one's own row) for super administrators, after the existing
  member actions and a separator. `components/SuperAdministratorDialog.tsx` is the
  `AlertDialog` confirmation; on success a toast and a reload.
- `InviteUserDialog`: for super administrators, an "Invite as" `RadioGroup` of two
  `ChoiceCard`s, **Organization member** (default, today's fields) and **Super
  administrator** (email only, with a line on what the access allows). Platform
  administrators see the dialog unchanged.
- `PendingInvitations`: "All organizations" and "Super administrator" in the
  Organization and Roles columns; **Resend** calls the super-administrator invite;
  super-administrator invitations show no actions to platform administrators.

### Accept page (`packages/auth/src/AcceptInvitationPage.tsx`)

For `grants_super_admin`, the heading and text say the person is invited as a super
administrator; after accepting, the confirmation links to the admin app through a new
`adminUrl` prop. The portal passes its `adminUrl`; admin passes `/`.

## Project Structure

### Documentation (this feature)

```text
specs/007-super-administrators/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
apps/api/database/migrations/2026_10_14_120000_add_super_administrator_invitations.php  # new
apps/api/app/Domain/Administration/
├── Services/SuperAdministrators.php                              # new
├── Services/OrganizationInvitationManager.php
├── Http/Controllers/SuperAdministratorController.php             # new
├── Http/Controllers/SuperAdministratorInvitationController.php   # new
├── Http/Controllers/PlatformInvitationController.php
├── Http/Controllers/PublicOrganizationInvitationController.php
├── Http/Requests/StoreSuperAdministratorInvitationRequest.php    # new
├── Http/Resources/OrganizationInvitationResource.php
├── Models/OrganizationInvitation.php
├── Notifications/OrganizationInvitationNotification.php
└── routes/api.php
apps/api/tests/Feature/Domain/Administration/SuperAdministratorApiTest.php  # new
contracts/openapi/openapi.json
packages/api-client/src/index.ts
packages/auth/src/AcceptInvitationPage.tsx
apps/portal/src/App.tsx
apps/admin/src/App.tsx
apps/admin/src/pages/UsersPage.tsx
apps/admin/src/components/InviteUserDialog.tsx
apps/admin/src/components/PendingInvitations.tsx
apps/admin/src/components/SuperAdministratorDialog.tsx            # new
apps/admin/e2e/admin.spec.ts
docs/features/access.md, docs/architecture/glossary.md, apps/admin/README.md
```

**Structure Decision**: the Administration domain owns users' platform access and
invitations; no other domain changes.

## Delivery

1. One pull request based on `main` with the spec, plan, tasks and implementation
   together (the owner's choice for this small feature), then the release from `main`
   and the pilot deploy.

## Complexity Tracking

No violations.
