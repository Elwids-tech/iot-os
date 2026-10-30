# Implementation Plan: Billing Accounts

**Branch**: `spec/023-billing-accounts` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/023-billing-accounts/spec.md`

## Summary

A new **Billing** domain in Laravel adds `billing_accounts`, their owners, and an
append-only `billing_account_assignments` history. `organizations.billing_account_id`
holds the current account and is `NOT NULL`. The `Organization` model fills it on
`creating` with a new account named after the organization when the caller named
none, and opens the first assignment on `created`. That way every path that creates
an organization keeps the invariant: the admin API, factories, seeders and
`BootstrapStaging`. A migration backfills one account per existing organization
through a reusable `BillingAccountBackfill`.

Platform administrators get billing account endpoints under `/v1/admin` and a
billing account choice in `POST /v1/admin/organizations`. In the admin app this is a
**New/Existing** choice in `OrganizationDialog`, a **Billing accounts** collection, an
account page (details, organizations, owners, history), and a **Change billing
account** row action on Organizations.

Owners get two account-level endpoints: list the accounts they own, and create an
organization under one. The create locks the account row, checks the organization
limit, creates the organization with its default roles, and makes the owner its
Organization Admin through the same role manager invitations use. In the portal this
is a **Billing accounts** page outside any organization, reached from the user menu.

Billing information never enters the tenant-facing `OrganizationResource` unless the
admin index loads it, so members see nothing (FR-019). Owners get no organization
access; `ResolveOrganizationContext` is unchanged.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13 (`apps/api`); TypeScript, React 19 (`apps/admin`,
`apps/portal`, `packages/*`)

**Primary Dependencies**: Eloquent (soft deletes, model events, `lockForUpdate`),
Spatie permission teams (through `OrganizationDefaultRoles` and
`OrganizationRoleManager`), `DeviceAudit`; TanStack Query 5; `@iot-os/ui`
(`CollectionPage`, `EntityPage`, `DataTable`, `Panel`, `SearchableSelect`,
`ChoiceCard`, `Dialog`, `Field`, `RelativeTime`)

**Storage**: PostgreSQL 17. Three new tables (`billing_accounts`,
`billing_account_owners`, `billing_account_assignments`), one new column
(`organizations.billing_account_id`), and one index on
`device_audit_events.resource_uuid`.

**Testing**: PHPUnit on PostgreSQL (`cd apps/api && php artisan test --compact`);
`contract:export --check` and `contract:check`; Playwright with route mocks for admin
and portal; `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint`;
a manual run in the rebuilt stack.

**Target Platform**: `api` and the API-image services, `admin`, `portal`

**Project Type**: web application

**Performance Goals**: the admin list in one paginated query with counts. Owner
creation is one locked row plus one count. The owner page is one query for the
person's accounts and their organizations.

**Constraints**: no runtime (Go) or adapter change. The tenant middleware and the
tenant-facing organization payload stay unchanged. Existing API clients that create
organizations without naming an account keep working (D3).

**Scale/Scope**: 1 migration, 1 backfill class, 2 models, 3 services, 6 controllers,
4 resources, 1 routes file, 1 model change, 2 factories; 2 admin pages and 2 dialogs,
1 dialog change, 1 column; 1 portal page, 1 dialog, 1 menu item.

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel only; the runtime is untouched. |
| II. Immutable versions | Pass. Nothing versioned changes. Assignments are append-only history. |
| III. Tenant isolation | Pass. Billing accounts are not tenant-owned records. Admin routes need `PlatformAdministration.manageOrganizations`. Owner routes resolve the account among the signed-in person's own accounts, and answer 404 otherwise. Owning an account adds nothing to `ResolveOrganizationContext`, so a non-member owner is refused inside the organization. Tests cover: an owner refused in a non-member organization and on a tenant route, a non-owner getting 404, and members seeing no billing in `/me` or the organization context. `OrganizationResource` emits billing only when the relation is loaded, which only the admin index does. |
| IV. Contracts first | Pass. Typed resources, so the new operations export with real bodies; `contract:export` and `contract:check --base=origin/main`; `packages/api-client` in the same pull request. Owners are referenced by integer `user_id` (ADR-013). |
| V. AI proposes | Pass. Neither the assistant nor agent tools read or change billing accounts. |
| VI. Show uncertainty | Pass. Counts are exact database counts. No telemetry is involved. |
| VII. Durable, idempotent messaging | Pass. No messaging. Assignment history is kept on purpose and grows only when organizations are created or moved. |
| VIII. One design system | Pass. `CollectionPage` + `DataTable` for lists, `EntityPage` with `Panel`s for the account, `SearchableSelect` for account and user search (AGENTS.md), `ChoiceCard` for New/Existing, `RelativeTime`, named type scale; `check-ui` passes. No new kit component. `slugify` moves into the kit's `lib`. |
| IX. Verified where it runs | Pass. PostgreSQL CI. Rebuild `api` with the API-image services, then `admin` and `portal`. Exercise creation, owners, moving and owner self-service in the running stack. |

## Decisions

Details and alternatives are in [research.md](research.md).

| Decision | Chosen | Rejected because |
| --- | --- | --- |
| Domain | New `App\Domain\Billing` (models, services, admin and owner routes) | Administration would mix organization administration with billing, which metering and pricing will extend later. |
| Invariant | `organizations.billing_account_id NOT NULL`, filled by an `Organization::creating` hook when unset | An explicit service call at every creation site misses factories, seeders and `BootstrapStaging`, and hundreds of tests use the factory. |
| Current account and history | Denormalized FK on `organizations` + an append-only `billing_account_assignments` with `started_at`, `ended_at`, `assigned_by`, `ended_by`, and organization uuid and name snapshots | History alone makes every "current account" read a range query. Day-based assignments belong to metering, which is out of scope. |
| Deleting accounts | Soft delete, only when the account has no organizations | A hard delete would orphan or cascade the assignment history that FR-020 keeps. |
| Organization deletion | `billing_account_assignments` joins `OrganizationDeletion::KEPT` (`organization_id` set null). Deletion closes the open assignment first. | Cascading would erase which account paid for a deleted organization. |
| Limit | `organization_limit` (0–1000, default 1), checked under `lockForUpdate` on the account row, counting non-trashed organizations. Platform administrators skip it. | An unlocked count lets two owners pass at once (FR-017). |
| Create organization API | `billing_account_uuid` or `new_billing_account {name, contact_email}`; neither means a new account named after the organization; both is 422 | A required field would break existing clients (D3). |
| Owner routes | `GET /v1/billing-accounts`, `POST /v1/billing-accounts/{account}/organizations`; 404 unless owner | 403 would confirm that an account exists. |
| History | Assignments plus `DeviceAudit` rows whose `resource_uuid` is the account's uuid, with a new index on `resource_uuid` | A separate billing audit table duplicates `device_audit_events`, which platform actions already use. |
| Portal entry | `/billing` under `PortalShell`, a user menu item shown when `/me` reports `capabilities.billing_accounts` | Inside an organization's Settings it would suggest the account belongs to that organization. |

## Design

### Storage (`2026_10_31_000000_create_billing_accounts.php`)

Full columns in [data-model.md](data-model.md).

1. Create `billing_accounts` (uuid, name, contact email, notes, organization limit
   default 1, timestamps, soft deletes), `billing_account_owners` (account, user,
   `added_by`, `created_at`, composite primary key), and `billing_account_assignments`.
2. Add `organizations.billing_account_id` as nullable with
   `constrained()->restrictOnDelete()` and an index.
3. Run `BillingAccountBackfill::run()`. For every organization, trashed included and
   ordered by id, it inserts an account named after it with limit 1, sets the
   foreign key, and inserts an open assignment that starts at the organization's
   `created_at` with no `assigned_by`. It uses the query builder, not models, so
   model hooks cannot run twice.
4. Make `billing_account_id` `NOT NULL`.
5. Add a partial unique index, one open assignment per organization:
   `(organization_uuid) where ended_at is null`. Add an index on
   `device_audit_events (resource_uuid, created_at)`.

`down()` drops the index, the column and the three tables.

### Models (`app/Domain/Billing/Models`)

- `BillingAccount`:
  - `HasFactory`, `SoftDeletes`, uuid set on `creating`, route key `uuid`;
  - `owners()` is a `belongsToMany(User)` through `billing_account_owners`, with
    `added_by` and `created_at`;
  - `organizations()` is a `hasMany(Organization)`;
  - `assignments()` is a `hasMany`.
- `BillingAccountAssignment`: timestamps off; casts for `started_at` and `ended_at`.
  Only `BillingAccounts` writes to it.
- `Organization` (`app/Domain/Shared/Models`):
  - `billingAccount()` is a `belongsTo`;
  - `creating`: when `billing_account_id` is unset, create a `BillingAccount` named
    after the organization (limit 1) and set it;
  - `created`: insert the open assignment with `assigned_by = auth()->id()`.

  `billing_account_id` is not fillable; services set it explicitly.
- `User`: `ownedBillingAccounts()` is a `belongsToMany`.
- Factories: `BillingAccountFactory`, and `OrganizationFactory::forBillingAccount()`.

### Services (`app/Domain/Billing/Services`)

- `BillingAccounts`:
  - `create`, `update`, `delete` (refuses an account with organizations, then soft
    deletes);
  - `addOwner` and `removeOwner` (idempotent);
  - `move(Organization, BillingAccount, User $actor)`: in one transaction, locks the
    organization, closes its open assignment (`ended_at`, `ended_by`), opens a new
    one and updates the foreign key. The closing and opening times are the same
    timestamp, taken once. Moving to the current account is a no-op.
  - Each change records one `DeviceAudit` event with a null `organization_id`, the
    same way `organization.deleted` does, so audit rows never block deleting an
    organization:
    - `billing_account.created`;
    - `billing_account.updated` (the changed fields with their old and new values);
    - `billing_account.deleted`;
    - `billing_account.owner_added` and `billing_account.owner_removed` (the user's
      id and name);
    - `organization.billing_account_changed`, with the organization's uuid as the
      resource and the from and to account uuids and names in the details.
- `BillingAccountHistory`: an account's latest 100 events, merged from its audit
  events (`resource_uuid` = account uuid) and its assignments:
  - "joined" at `started_at`, by `assigned_by`;
  - "left" at `ended_at`, by `ended_by`.
  Actors are loaded in one query.
- `OwnerOrganizations::create(User, BillingAccount, name, ?slug)`: in one
  transaction:
  1. lock the account row;
  2. check ownership again (404) and the limit (422 on `billing_account`, naming the
     limit);
  3. resolve the slug: the given one is validated as unique, including trashed
     organizations; otherwise generate `Str::slug(name)`, adding `-2`, `-3` and so on
     until free;
  4. create the organization with this `billing_account_id`;
  5. `OrganizationDefaultRoles::ensure`, attach the owner, then
     `OrganizationRoleManager::syncMemberRoles` with the `organization-admin` role.
  No welcome email is sent, because the person created the organization themselves.

### HTTP (`app/Domain/Billing/Http`, `app/Domain/Billing/routes/api.php`)

Required from `routes/api.php`. Admin routes use the `admin.` name prefix and
`can:PlatformAdministration.manageOrganizations`, like the existing admin routes.
Bodies are in [the contract](contracts/billing-accounts-api.md).

| Route | Controller |
| --- | --- |
| `GET/POST /v1/admin/billing-accounts` | `PlatformBillingAccountController@index/store` |
| `GET/PATCH/DELETE /v1/admin/billing-accounts/{account}` | `PlatformBillingAccountController@show/update/destroy` |
| `PUT/DELETE /v1/admin/billing-accounts/{account}/owners/{user}` | `PlatformBillingAccountOwnerController` |
| `PUT /v1/admin/organizations/{organization}/billing-account` | `PlatformOrganizationBillingAccountController` |
| `GET /v1/billing-accounts` | `OwnedBillingAccountController@index` |
| `POST /v1/billing-accounts/{account}/organizations` | `OwnedBillingAccountOrganizationController@store` |

Changes outside the domain:

- `StoreOrganizationRequest` accepts `billing_account_uuid` (an existing, non-trashed
  account) or `new_billing_account.name` and `new_billing_account.contact_email`;
  both together is 422.
- `PlatformOrganizationController@store`, unless an existing account is named,
  creates the account first with `BillingAccounts::create` (audited), inside its
  existing transaction, so a failure rolls both back (FR-006). The model hook is only
  the fallback for factories, seeders and `BootstrapStaging`.
- `PlatformOrganizationController@index` eager-loads `billingAccount:id,uuid,name`.
- `OrganizationResource` adds `billing_account` only `whenLoaded`. Tenant routes never
  load it.
- `AuthenticatedUserResource` adds `capabilities.billing_accounts` (true when the
  person owns an account that has not been deleted).
- `OrganizationDeletion`: `KEPT` gains `billing_account_assignments`, and the open
  assignment is closed before `forceDelete`.

### Contract and client

- `php artisan contract:export` adds ten operations (eight for platform administrators,
  two for owners) and changes three (organization creation, the organization list and
  `/me`), under new tags `Billing` and `Platform billing`. Supplements go in
  `contracts/openapi/supplements/billing.yaml` for:
  - the "one of" body on organization creation;
  - the 409 on delete;
  - the 422 limit response.
- `packages/api-client/src/billing.ts`: the `BillingAccountSummary`,
  `BillingAccountDetail`, `BillingAccountHistoryEntry`, `OwnedBillingAccount` and
  `BillingAccountValues` types.
- `index.ts`: `adminBillingAccounts`, `createBillingAccount`, `adminBillingAccount`,
  `updateBillingAccount`, `deleteBillingAccount`, `addBillingAccountOwner`,
  `removeBillingAccountOwner`, `moveOrganizationBillingAccount`,
  `ownedBillingAccounts` and `createOwnedOrganization`.
- `createAdminOrganization` values gain the two optional fields. `Organization` gains an
  optional `billing_account`, and the session user's capabilities gain
  `billing_accounts`.

### Kit

`slugify` moves from `apps/admin/src/components/OrganizationDialog.tsx` to
`packages/ui/src/lib/slug.ts` (with a unit test), and the admin dialog imports it.
There is no new component.

### Admin (`apps/admin`)

- `OrganizationDialog`, when creating: a **Billing account** field.
  - Two `ChoiceCard`s, **New billing account** (the default) and **Existing billing
    account**.
  - New shows a name input that follows the organization name until edited, and an
    optional contact email.
  - Existing shows a `SearchableSelect` fed by `adminBillingAccounts({ search })`, with
    the organization count in each option.
  - Validation errors map to the fields. Editing an organization does not show the
    field.
- `OrganizationsPage`:
  - a **Billing account** column, a `RefLink` to the account page;
  - a **Change billing account** row action, which opens a
    `ChangeBillingAccountDialog` (a `SearchableSelect` that excludes the current
    account) and calls `moveOrganizationBillingAccount`.
- `BillingAccountsPage` (`/billing-accounts`): `CollectionPage` + `DataTable` through
  `useDirectoryTable`.
  - Columns: Name, Organizations ("3 of 10"), Owners, Contact.
  - A **New billing account** action and row actions **Edit** and **Delete**. Delete
    is disabled with a tooltip while the account has organizations.
  - `BillingAccountDialog` handles create and edit (name, contact email, notes,
    organization limit).
- `BillingAccountPage` (`/billing-accounts/:billingAccountUuid`): `EntityPage` with
  four `Panel`s.
  - **Details**: Edit opens `BillingAccountDialog`.
  - **Organizations**: a `DataTable` with name, slug, users and devices, and the same
    Change billing account action.
  - **Owners**: a `SearchableSelect` over `adminUsers({ search })` to add, and remove
    with a confirmation.
  - **History**: actor, action and `RelativeTime`.
- `AdminLayout`: a **Billing accounts** item after Organizations (`WalletIcon`).
  `App.tsx` gains the two routes.

### Portal (`apps/portal`)

- `billing/BillingAccountsPage.tsx` at `/billing` under `PortalShell`:
  - a `CollectionPage` titled "Billing accounts";
  - with several accounts, a `SearchableSelect` above the table picks the account,
    kept in `?account=`;
  - the header shows "N of M organizations" and **New organization**, which is
    disabled with the reason when the account is at its limit;
  - the `DataTable` has Name, Created (`RelativeTime`) and an Open link for
    organizations the person belongs to, or "Not a member" text for the others.
- `billing/NewOrganizationDialog.tsx`:
  - fields: Name, and Address (the slug, following `slugify(name)` until edited);
    `slug` is sent only when edited, so the server picks a free address otherwise;
  - errors map to fields; the limit message shows on the form; a 404 (no longer an
    owner) shows a message and refreshes the billing query;
  - on success it invalidates the `["session"]` query (`/me`) and the billing query,
    shows a toast, and navigates to `/organizations/{uuid}/home`.
- `App.tsx`: the route, and a **Billing accounts** item in the user menu (above
  Administration) when `user.capabilities.billing_accounts`. The landing for someone
  with no organizations ("You don't belong to an organization yet…") points owners to
  **Billing accounts** instead of telling them to ask for an invitation.

### Documentation

- `docs/features/access.md`: a **Billing accounts** section covering the model, the
  invariant, owners, the limit and the portal page, plus the API rows.
- No in-product help article. Help is served per organization
  (`v1/organizations/{organization}/help`) and filtered by organization capabilities,
  so it cannot target a page outside any organization or only owners. The owner page
  carries its own one-line explanation instead.
- `docs/dev/gotchas.md`: creating an `Organization` creates a billing account unless
  `billing_account_id` is set. Use `forBillingAccount()` in tests that need a shared
  account.
- `docs/adr/ADR-026-billing-accounts.md` moves to Accepted when the documents pull
  request merges.

## Project Structure

### Documentation (this feature)

```text
specs/023-billing-accounts/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/billing-accounts-api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/database/migrations/2026_10_31_000000_create_billing_accounts.php       # new
apps/api/database/factories/BillingAccountFactory.php                            # new
apps/api/database/factories/OrganizationFactory.php
apps/api/app/Domain/Billing/                                                       # new domain
├── Models/BillingAccount.php, BillingAccountAssignment.php
├── Services/BillingAccounts.php, BillingAccountHistory.php, OwnerOrganizations.php,
│   BillingAccountBackfill.php
├── Http/Controllers/PlatformBillingAccountController.php,
│   PlatformBillingAccountOwnerController.php,
│   PlatformOrganizationBillingAccountController.php,
│   OwnedBillingAccountController.php, OwnedBillingAccountOrganizationController.php
├── Http/Requests/StoreBillingAccountRequest.php, UpdateBillingAccountRequest.php,
│   MoveOrganizationRequest.php, StoreOwnedOrganizationRequest.php
├── Http/Resources/BillingAccountResource.php, BillingAccountDetailResource.php,
│   BillingAccountHistoryResource.php, OwnedBillingAccountResource.php
└── routes/api.php
apps/api/routes/api.php
apps/api/app/Domain/Shared/Models/Organization.php, User.php
apps/api/app/Domain/Shared/Http/Resources/OrganizationResource.php
apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php
apps/api/app/Domain/Administration/Http/Controllers/PlatformOrganizationController.php
apps/api/app/Domain/Administration/Http/Requests/StoreOrganizationRequest.php
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/tests/Feature/Domain/Billing/                                            # new
├── BillingAccountAdministrationTest.php, BillingAccountOwnerTest.php,
│   BillingAccountBackfillTest.php, BillingAssignmentHistoryTest.php
apps/api/tests/Feature/Domain/Administration/OrganizationDeletionInventoryTest.php (KEPT)
contracts/openapi/openapi.json, contracts/openapi/supplements/billing.yaml (new)
packages/api-client/src/billing.ts (new), packages/api-client/src/index.ts
packages/ui/src/lib/slug.ts, slug.test.ts                                         # new
apps/admin/src/App.tsx, layout/AdminLayout.tsx, components/OrganizationDialog.tsx,
  pages/OrganizationsPage.tsx
apps/admin/src/pages/BillingAccountsPage.tsx, BillingAccountPage.tsx              # new
apps/admin/src/components/BillingAccountDialog.tsx, ChangeBillingAccountDialog.tsx  # new
apps/portal/src/billing/BillingAccountsPage.tsx, NewOrganizationDialog.tsx        # new
apps/portal/src/App.tsx
apps/admin/e2e/admin.spec.ts, apps/admin/e2e/billing-accounts.spec.ts (new)
apps/portal/e2e/billing-accounts.spec.ts                                          # new
docs/features/access.md, docs/dev/gotchas.md, docs/adr/ADR-026-billing-accounts.md
```

**Structure Decision**: billing is its own Laravel domain, and the shared
`Organization` model only gains the relation and the two hooks. The admin and portal
pages live with the apps; no kit component is added.

## Delivery

Each pull request is based on `main` and opened after the previous one merges; none
is stacked.

1. **Documents**: this folder, ADR-026 and its index row.
2. **Billing accounts (API)**:
   - migration and backfill, models, hooks, services, routes, resources;
   - organization creation fields, the deletion change, the `/me` capability;
   - contract export and supplements, api-client;
   - the API rows in `docs/features/access.md`, the gotcha, tests.

   Rebuild `api` and the API-image services, and check that every organization has
   an account. This is useful on its own: the invariant and history start at once.
3. **Billing accounts in admin**: the dialog choice, the column and row action, the
   two pages, the slug move into the kit, Playwright. Rebuild `admin`, then create and
   move organizations.
4. **Owner self-service in the portal**: the page, the dialog, the menu item, the rest
   of `docs/features/access.md`, Playwright. Rebuild `portal`, then create an
   organization as an owner and check the limit.

## Complexity Tracking

No violations.
