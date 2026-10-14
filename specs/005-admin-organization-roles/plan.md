# Implementation Plan: Organization Roles in Admin

**Branch**: `feat/admin-organization-roles` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-admin-organization-roles/spec.md`

## Summary

Add role creation, renaming and deletion to the admin app, and connect the
Organizations list to roles and invitations. No endpoint is added: the admin app
calls the organization role routes, which already authorize platform administrators
and grant them the whole ceiling, the same way it already calls the member routes.

- **New role page** (`/roles/new?organization=<uuid>`): an organization select, a name
  and the shared `PermissionMatrix` fed by `organizationRolePermissions`, with a
  sticky action bar. Saving calls `createOrganizationRole` and opens the role.
- **Role page**: **Rename** (a dialog that sends the saved permissions with the new
  name through `updateOrganizationRole`) and **Delete role** (custom roles, a
  confirmation, `deleteOrganizationRole`).
- **Entry points**: **New role** on the Roles page; **Roles**, **New role** and
  **Invite user** in the Organizations row actions; the invite dialog takes an
  initial organization, which the Users page sets from its filter.
- **API**: tests only, plus the 422 that `DELETE roles/{role}` returns, which the
  contract does not list yet.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: `@iot-os/ui` (`PageHeader`, `Panel`, `PermissionMatrix`,
`SelectField`, `Dialog`, `AlertDialog`, `keepToastsAbove`), `@iot-os/api-client`

**Storage**: unchanged

**Testing**: PHPUnit feature tests (`apps/api/tests/Feature/Domain/Administration`),
Playwright with a mocked API (`apps/admin/e2e/admin.spec.ts`)

**Target Platform**: the admin app (dev 5174, pilot `admin.elwids.xyz`)

**Project Type**: web application (Laravel API + React admin)

**Scale/Scope**: 3 admin pages changed or added, 2 dialogs, 1 test file

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. The admin app talks only to Laravel. |
| II. Immutable versions | Not affected. |
| III. Tenant isolation | Pass. The role routes check organization authority before permission, and roles are looked up within the organization (404 otherwise). The new API test proves a member of one organization gets 403 creating roles in another, and a role from another organization is 404. |
| IV. Contracts first | Pass. No new endpoint; the missing `422` on `DELETE roles/{role}` is added to `supplements/administration.yaml` and exported. `packages/api-client` already has the methods. |
| V. AI proposes | Not affected. |
| VI. Show uncertainty | Not affected. |
| VII. Durable messaging | Not affected. |
| VIII. One design system | Pass. Pages use `PageHeader`, `Panel`, `PermissionMatrix` and kit form fields; the sticky bar uses `keepToastsAbove`; `check-ui` runs in lint. No new kit component. |
| IX. Verified where it runs | Pass. CI on PostgreSQL, the admin container rebuilt and the flow exercised in the browser; then the pilot deploy. |

## Design notes

- **Why the organization routes, not new `/admin` routes.** They already enforce the
  ceiling, unique names, the Organization Admin baseline and the delete rules in
  `OrganizationRoleManager`. Duplicating them under `/admin` would add contract
  surface for no behaviour. Spec 003 plans to replace the platform administrator's
  implicit authority with an explicit grant; it must keep these routes working, as it
  must for the member routes admin already uses (spec Assumptions).
- **Rename sends the saved permissions.** `PATCH roles/{role}` replaces the name and
  the bundle together. The dialog sends the role's saved permissions, so unsaved
  ticks on the page stay unsaved and are not committed by a rename.
- **Organization select.** The admin app lists organizations through
  `useOrganizationOptions` (first 100) with a plain select, as the invite dialog and
  directory filters do. The same select is used here.
- **Built-in roles.** Moderator and Member can be renamed (as in the portal);
  Organization Admin cannot. Only custom roles can be deleted (the API refuses others).

## Project Structure

### Documentation (this feature)

```text
specs/005-admin-organization-roles/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/admin/src/
├── App.tsx                         # + roles/new route
├── pages/NewRolePage.tsx           # new
├── pages/RolePermissionsPage.tsx   # + Rename, Delete role
├── pages/RolesPage.tsx             # + New role
├── pages/OrganizationsPage.tsx     # + Roles, New role, Invite user row actions
├── pages/UsersPage.tsx             # invite preselects the filter
├── components/InviteUserDialog.tsx # + initialOrganizationUuid
└── components/RoleDialogs.tsx      # new: rename and delete
apps/admin/e2e/admin.spec.ts        # US1–US3
apps/api/tests/Feature/Domain/Administration/PlatformOrganizationRoleApiTest.php
contracts/openapi/supplements/administration.yaml, contracts/openapi/openapi.json
docs/features/access.md, apps/admin/README.md
```

**Structure Decision**: admin pages and components only; no API code changes.

## Delivery

1. This documents-only pull request (spec, plan, tasks).
2. One implementation pull request based on `main` with the API test, the contract
   status, the admin changes, the e2e tests and the docs. Then the release from
   `main` and the pilot deploy.

## Complexity Tracking

No violations.
