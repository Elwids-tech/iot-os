# Tasks: Billing Accounts

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md),
[contracts/billing-accounts-api.md](contracts/billing-accounts-api.md),
[quickstart.md](quickstart.md)

**Tests**: part of the feature (SC-002, SC-004, SC-005, SC-006; constitution III and
IX). Write each test with its task and see it fail first. PHPUnit runs on PostgreSQL:
the backfill, the partial unique index and the row lock behave differently on SQLite.

**Delivery**: four pull requests, each based on `main` and opened after the one
before it merges, never stacked (plan, Delivery):

1. Phase 1 is the **documents** pull request.
2. Phases 2 to 6 are **Billing accounts (API)**.
3. Phases 7 to 9 are **Billing accounts in admin**.
4. Phases 10 and 11 are **Owner self-service in the portal**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US3)

---

## Phase 1: Documents pull request

- [X] T001 Run `/speckit-analyze` over `specs/023-billing-accounts/spec.md`, `plan.md` and `tasks.md`, and fix what it finds in those files
- [X] T002 Open the documents pull request from `main` with `specs/023-billing-accounts/`, `docs/adr/ADR-026-billing-accounts.md` and its row in `docs/adr/README.md`; `./taskw lint` (docs link check) passes; once the owner approves, set ADR-026's status and its index row to Accepted before merging

**Checkpoint**: the design is on `main`; implementation pull requests start from it.

---

## Phase 2: Foundation, storage and the invariant (blocks every story)

**Purpose**: every organization belongs to exactly one billing account, whichever path creates it (FR-001, FR-002, FR-003, FR-020).

- [X] T003 [P] Models in `apps/api/app/Domain/Billing/Models/`: `BillingAccount.php` (`HasFactory`, `SoftDeletes`, uuid set on `creating`, `getRouteKeyName()` `uuid`, fillable `name`, `contact_email`, `notes`, `organization_limit`; `owners()` `belongsToMany(User::class, 'billing_account_owners')->withPivot(['added_by', 'created_at'])` without `withTimestamps()`, because the table has no `updated_at`; `organizations()` `hasMany(Organization::class)`; `assignments()` `hasMany(BillingAccountAssignment::class)`) and `BillingAccountAssignment.php` (`$timestamps = false`, `started_at` and `ended_at` cast to `immutable_datetime`, `billingAccount()` and `organization()` relations)
- [X] T004 [P] `apps/api/app/Domain/Billing/Services/BillingAccountBackfill.php` `run()`: query builder only, never models, so hooks cannot fire. For every organization, trashed included, ordered by id, whose `billing_account_id` is null:
  - insert a `billing_accounts` row (new uuid, `name` = organization name, `organization_limit` 1, `created_at`/`updated_at` now);
  - set `organizations.billing_account_id`;
  - insert an open `billing_account_assignments` row (`organization_id`, `organization_uuid`, `organization_name`, `started_at` = the organization's `created_at`, `assigned_by` null).

  A second run adds nothing (R10).
- [X] T005 Migration `apps/api/database/migrations/2026_10_31_000000_create_billing_accounts.php` with the columns in [data-model.md](data-model.md) (depends on T004):
  - `billing_accounts`: `uuid` unique; `name` string(255); `contact_email` string(255) nullable; `notes` text nullable; `organization_limit` "unsigned smallint, default 1"; `timestampsTz`; `softDeletesTz`.
  - `billing_account_owners`: `billing_account_id` and `user_id` foreign keys with cascade on delete; `added_by` nullable FK `users`, set null on delete; `created_at` timestampTz; primary key `(billing_account_id, user_id)`; index on `user_id`.
  - `billing_account_assignments`:
    - `billing_account_id` FK, restrict on delete;
    - `organization_id` nullable FK, set null on delete;
    - `organization_uuid` uuid, `organization_name` string(255);
    - `started_at` timestampTz, `ended_at` nullable timestampTz;
    - `assigned_by` and `ended_by` nullable FKs to `users`, set null on delete;
    - indexes `(organization_uuid, started_at)` and `(billing_account_id, started_at)`.
  - Add `organizations.billing_account_id` as nullable `constrained('billing_accounts')->restrictOnDelete()` with an index. Call `BillingAccountBackfill::run()`, then make the column `NOT NULL`.
  - Add the unique index `billing_account_assignments_open` on `(organization_uuid) where ended_at is null` through `DB::statement`, and an index on `device_audit_events (resource_uuid, created_at)`.
  - `down()` drops the indexes, the column and the three tables.
  - The migration must also run on the SQLite database that `contract:export` migrates.
- [X] T006 `apps/api/app/Domain/Shared/Models/Organization.php`: `billingAccount()` `belongsTo(BillingAccount::class)`. `billing_account_id` stays out of `$fillable`; callers set it explicitly. In `booted()`:
  - `creating`: when `billing_account_id` is unset, create a `BillingAccount` named after the organization with `organization_limit` 1, and set the key;
  - `created`: insert the open assignment (`started_at` now, `assigned_by` `auth()->id()`, uuid and name snapshots).

  In `apps/api/app/Domain/Shared/Models/User.php`, add `ownedBillingAccounts()`, a `belongsToMany(BillingAccount::class, 'billing_account_owners')` (soft-deleted accounts drop out through the related model's scope). Depends on T003.
- [X] T007 [P] `apps/api/database/factories/BillingAccountFactory.php` (company name, `organization_limit` 1, a `limit(int)` state, and an `ownedBy(User $user)` state that attaches the owner with `created_at`); `forBillingAccount(BillingAccount $account)` state in `apps/api/database/factories/OrganizationFactory.php` that sets `billing_account_id` (depends on T003)
- [X] T008 `apps/api/app/Domain/Billing/Services/BillingAccounts.php` with `create(array $values, ?User $actor): BillingAccount`. It records `DeviceAudit::record('billing_account.created', null, $actor?->id, $account->uuid, ['name' => …, 'organization_limit' => …])`. The other methods come in T018. Depends on T003.
- [X] T009 `apps/api/app/Domain/Administration/Services/OrganizationDeletion.php`:
  - add `billing_account_assignments` to `KEPT`;
  - in `delete()`, before `forceDelete`, set `ended_at` = now and `ended_by` = the actor on the organization's open assignment.

  Depends on T005.
- [X] T010 [P] `apps/api/tests/Feature/Domain/Billing/BillingAccountBackfillTest.php`, following `InvitedAccountVerificationBackfillTest`:
  - inside the test transaction, drop `NOT NULL` on `organizations.billing_account_id` (PostgreSQL DDL is transactional);
  - insert three organizations with the query builder, one of them trashed;
  - run `BillingAccountBackfill::run()` twice.

  Then assert:
  - one account per organization, named after it, with limit 1 and no owners;
  - the foreign key is set;
  - one open assignment starting at the organization's `created_at` with a null `assigned_by`;
  - the second run added nothing.
- [X] T011 [P] `apps/api/tests/Feature/Domain/Billing/AssertsBillingAssignments.php`, a trait with `assertBillingAssignmentInvariants(Organization|string $organization)` for the three invariants in [data-model.md](data-model.md). Use it in `apps/api/tests/Feature/Domain/Billing/BillingAssignmentHistoryTest.php`. The test covers:
  - `Organization::factory()->create()` and `Organization::query()->create([...])` without an account each get a new account named after the organization, with one open assignment that matches the foreign key;
  - `forBillingAccount()` shares an account;
  - `assigned_by` is the acting user under `actingAs` and null otherwise;
  - the partial unique index rejects a second open row for one organization;
  - the quickstart's SC-002 query returns no rows.
- [X] T012 [P] Add a case to `apps/api/tests/Feature/Domain/Administration/OrganizationDeletionApiTest.php`: after deletion the assignment is kept, with `organization_id` null, `ended_at` set, `ended_by` the actor, and its uuid and name snapshots unchanged. `OrganizationDeletionInventoryTest` passes unchanged. Depends on T009.
- [X] T013 `cd apps/api && php artisan test --compact` on PostgreSQL, and fix any test that the new hook or column breaks (for example, tests that count rows or create organizations with raw inserts)

**Checkpoint**: every organization, old and new, has exactly one account and one open assignment.

---

## Phase 3: User Story 1, the API for creating an organization under a new or existing account (Priority: P1)

**Goal**: `POST /v1/admin/organizations` takes a new or existing billing account, and the admin list shows each organization's account.

**Independent Test**: create one organization with `new_billing_account`, and a second with that account's `billing_account_uuid`. `GET admin/billing-accounts/{account}` (Phase 4) or the database lists both; `GET admin/organizations` shows the account on each row.

- [X] T014 [US1] `apps/api/app/Domain/Administration/Http/Requests/StoreOrganizationRequest.php` gains:
  - `billing_account_uuid`: `['nullable', 'uuid', Rule::exists('billing_accounts', 'uuid')->whereNull('deleted_at'), 'prohibits:new_billing_account']`;
  - `new_billing_account`: `['nullable', 'array:name,contact_email']`;
  - `new_billing_account.name`: `['required_with:new_billing_account', 'string', 'max:255']`, trimmed;
  - `new_billing_account.contact_email`: `['nullable', 'email', 'max:255']`.

  Sending both fields is 422 on `billing_account_uuid`.
- [X] T015 [US1] `apps/api/app/Domain/Administration/Http/Controllers/PlatformOrganizationController.php`. Depends on T008 and T014.
  - `store`: inside the existing `DB::transaction`, resolve the account. That is the named account; or `BillingAccounts::create` with `new_billing_account`; or, with neither, `BillingAccounts::create(['name' => $name], $request->user())`, so every account the API creates starts its history with `created`. Then create the organization from `$request->safe()->only(['name', 'slug'])` with `billing_account_id` set explicitly. The organization limit is not checked (FR-008). Load `billingAccount` before returning.
  - `index`: `->with('billingAccount:id,uuid,name')`.
- [X] T016 [P] [US1] `apps/api/app/Domain/Shared/Http/Resources/OrganizationResource.php`: `'billing_account' => $this->whenLoaded('billingAccount', fn () => ['uuid' => …, 'name' => …])`. No other route loads the relation (R9).
- [X] T017 [P] [US1] `apps/api/tests/Feature/Domain/Billing/BillingAccountAdministrationTest.php` (organization creation):
  - a new account with a contact email;
  - an existing account;
  - neither, which creates an account named after the organization, with a `billing_account.created` event by the admin;
  - both fields, which is 422 on `billing_account_uuid`;
  - an unknown or soft-deleted `billing_account_uuid`, which is 422;
  - an existing account at its limit still accepts the organization (FR-008);
  - when a listener registered in the test with `Event::listen('eloquent.created: '.Organization::class, …)` throws, neither the organization nor the new account exists (FR-006). `OrganizationDefaultRoles` is `final`, so it cannot be mocked;
  - `index` rows carry `billing_account`;
  - FR-019: as an ordinary member, `/me` and `organizations/{organization}/context` carry no `billing_account`.

  Every case runs `assertBillingAssignmentInvariants`.

**Checkpoint**: platform administrators can group organizations by account through the API.

---

## Phase 4: User Story 2, the API for managing billing accounts (Priority: P1)

**Goal**: platform administrators list, open, edit, delete, staff and regroup billing accounts, with history.

**Independent Test**: create an account, add an owner, set the limit to 10, and move an organization into it. `GET admin/billing-accounts/{account}` shows the organization, the owner and history entries naming who did each step. The organization's members, roles and devices are unchanged.

- [X] T018 [US2] Complete `apps/api/app/Domain/Billing/Services/BillingAccounts.php`. Every event below is written with `DeviceAudit::record` and a null `organization_id`.
  - `update(BillingAccount, array, User)`: write only changed fields. Record `billing_account.updated` with `changes: {field: {from, to}}`, and record nothing when nothing changed.
  - `delete(BillingAccount, User)`: lock the row and count its organizations. When there are any, throw a 409 with "Move this billing account's N organizations before deleting it." Otherwise soft delete and record `billing_account.deleted` (`name`).
  - `addOwner` and `removeOwner(BillingAccount, User $owner, User $actor)` are idempotent. They record `billing_account.owner_added` or `owner_removed` (`user_id`, `user_name`) only when something changed. Memberships are never touched.
  - `move(Organization, BillingAccount, User)`: in one transaction, lock the organization. When the target is the current account, do nothing. Otherwise take one timestamp, `$at = now()`, and:
    - close the open assignment (`ended_at = $at`, `ended_by`);
    - open one on the target (`started_at = $at`, `organization_name` = the current name). Two `now()` calls would differ by microseconds and break invariant 1;
    - update `billing_account_id`;
    - record `organization.billing_account_changed` with the organization's uuid and `from` and `to` (`{uuid, name}`).
- [X] T019 [P] [US2] `apps/api/app/Domain/Billing/Services/BillingAccountHistory.php` `for(BillingAccount)`:
  - the audit rows whose `resource_uuid` is the account's uuid, mapped to `created`, `updated`, `owner_added` and `owner_removed` (a deleted account answers 404, so `billing_account.deleted` is never shown);
  - the account's assignments, as `organization_joined` at `started_at` by `assigned_by`, and `organization_left` at `ended_at` by `ended_by`, with `organization` from the snapshots. Each entry carries only its own field: `changes` (a list of `{field, from, to}` as text), `user` or `organization`.

  Merge them newest first, keep 100, and load the actors in one query; the actor is null when unknown.
- [X] T020 [P] [US2] Requests in `apps/api/app/Domain/Billing/Http/Requests/`:
  - `StoreBillingAccountRequest`: `name` required, string, "at most 255 characters, trimmed"; `contact_email` nullable, email, at most 255 characters; `notes` nullable, string, "at most 2,000 characters"; `organization_limit` "Integer from 0 to 1000", default 1.
  - `UpdateBillingAccountRequest`: the same rules under `sometimes`.
  - `MoveOrganizationRequest`: `billing_account_uuid` required, uuid, an account that has not been deleted.
- [X] T021 [P] [US2] Resources in `apps/api/app/Domain/Billing/Http/Resources/`, with the contract's shapes; owners are integer `id`, `name` and `email` (ADR-013):
  - `BillingAccountResource`: the list row, with `organizations_count` and `owners`;
  - `BillingAccountDetailResource`: owners with `added_at`; organizations with `users_count`, `devices_count` and `assigned_at`; `history`;
  - `BillingAccountHistoryResource`.
- [X] T022 [US2] Controllers in `apps/api/app/Domain/Billing/Http/Controllers/`, each calling `Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)` as `PlatformOrganizationController` does. Depends on T018 to T021.
  - `PlatformBillingAccountController`:
    - `index`: `search` over name and contact email; `per_page` from 1 to 100, default 25; ordered by name; `withCount('organizations')`, `with('owners:id,name,email')`.
    - `store` answers 201; `show`; `update`.
    - `destroy` answers 204, or 409 with the message.
  - `PlatformBillingAccountOwnerController`: `update` (PUT) answers 200 with `{data: [owners]}`; `destroy` answers 204. An unknown user is 404.
  - `PlatformOrganizationBillingAccountController`: `update` (PUT) answers 204. New operations need fully described bodies, and `OrganizationResource`'s capabilities are not described yet, so it returns none.
- [X] T023 [US2] `apps/api/app/Domain/Billing/routes/api.php`, required from `apps/api/routes/api.php`:
  - `v1` and `auth:sanctum`, as `apps/api/app/Domain/Administration/routes/api.php` sets them up;
  - an `admin.` group with `can:` `MANAGE_ORGANIZATIONS` on each route;
  - `whereUuid` on `{account}` and `{organization}`, and `whereNumber` on `{user}`;
  - names `api.v1.admin.billing-accounts.*` and `api.v1.admin.organizations.billing-account.update`.

  Depends on T022.
- [X] T024 [US2] Extend `apps/api/tests/Feature/Domain/Billing/BillingAccountAdministrationTest.php`. Depends on T023.
  - **List**: list, search and pagination; counts and owners.
  - **Detail**: the detail shape.
  - **Update**: audits only the changed fields; a no-op writes nothing; a limit below the count is accepted (US2 scenario 6).
  - **Delete**:
    - deleting an empty account gives 204, and afterwards the account is 404, absent from the list, and refused as `billing_account_uuid`;
    - deleting an account that has organizations gives 409 with the message.
  - **Owners**: adding twice and removing a non-owner each give one event or none; memberships are unchanged; an unknown user is 404.
  - **Move**:
    - after a move, the old and new assignments meet with no gap, and the invariants hold;
    - moving to the current account is a no-op;
    - a move ignores the limit;
    - members, roles, devices, dashboards and automations are unchanged, and so are the organization's id and uuid, which telemetry is keyed by (SC-005).
  - **History**: merges the audit and assignment entries newest first and caps at 100; the rollout's entries have a null actor.
  - **Permissions**: every route is 403 without `PlatformAdministration.manageOrganizations`.

**Checkpoint**: the admin API for billing accounts is complete.

---

## Phase 5: User Story 3, the API for owners (Priority: P2)

**Goal**: owners list their accounts and create organizations under them, within the limit, as Organization Admin.

**Independent Test**: as an owner of an account below its limit, `POST billing-accounts/{account}/organizations` answers 201. The owner is Organization Admin of the new organization. At the limit it answers 422 naming the limit.

- [X] T025 [US3] `apps/api/app/Domain/Billing/Services/OwnerOrganizations.php` `create(User, BillingAccount, string $name, ?string $slug): Organization`, in one transaction:
  1. `lockForUpdate` the account row;
  2. abort 404 unless the user still owns it and it has not been deleted;
  3. count the account's non-trashed organizations; when the count is at or above `organization_limit`, throw a `ValidationException` on `billing_account` with "This billing account allows N organizations. Ask the platform operator to raise the limit.";
  4. resolve the slug. A given slug must be unique among all organizations including trashed ones, or it is 422 on `slug`. Otherwise use `Str::slug($name)`, adding `-2`, `-3` and so on until free;
  5. create the organization with `billing_account_id` set;
  6. `OrganizationDefaultRoles::ensure`, `$user->organizations()->attach`, then `OrganizationRoleManager::syncMemberRoles($organization, $user, [$roles['organization-admin']->id])`.

  No welcome email (R13).
- [X] T026 [P] [US3] In `apps/api/app/Domain/Billing/Http/`:
  - `Requests/StoreOwnedOrganizationRequest.php`: `name` required, string, at most 255 characters; `slug` optional, "`alpha_dash`, at most 255 characters";
  - `Resources/OwnedBillingAccountResource.php`: the contract's shape; each organization's `member` flag comes from one query over the person's memberships.
- [X] T027 [US3] `OwnedBillingAccountController@index` and `OwnedBillingAccountOrganizationController@store` in `apps/api/app/Domain/Billing/Http/Controllers/`, plus the owner routes in `apps/api/app/Domain/Billing/routes/api.php`: `billing-accounts` and `billing-accounts/{account}/organizations`, under `auth:sanctum` with no admin permission.
  - Look the account up through `$request->user()->ownedBillingAccounts()->where('uuid', …)->firstOrFail()`, so any other account is 404.
  - `index` is ordered by name, not paginated, and eager-loads organizations.
  - `store` answers 201 with `OwnerOrganizationResource` (`uuid`, `name`, `slug`); the portal reloads the session for the capabilities.

  Depends on T025, T026 and T023.
- [X] T028 [P] [US3] `apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php`: `capabilities.billing_accounts` is `$this->resource->ownedBillingAccounts()->exists()`
- [X] T029 [US3] `apps/api/tests/Feature/Domain/Billing/BillingAccountOwnerTest.php`. Depends on T027 and T028.
  - **Listing**: lists only the person's own accounts, with correct `member` flags.
  - **Creating below the limit**:
    - answers 201;
    - the built-in roles exist, and the owner holds `organization-admin`;
    - the assignment's `assigned_by` is the owner;
    - no welcome email is queued.
  - **Limit**: a creation at the limit is 422 with the message; a platform administrator who is also an owner is bound on this route.
  - **Slugs**:
    - a generated slug avoids taken ones, including a trashed organization's (`-2`);
    - a taken given slug is 422 on `slug`.
  - **Ownership**:
    - a non-owner gets 404 on create and does not see the account in the list;
    - an owner removed between page load and submit is refused with 404;
    - a soft-deleted account answers 404.
  - **Concurrency (SC-004)**: two sequential creations at limit − 1 leave exactly one new organization. The query log for owner creation shows `for update` on `billing_accounts`. A comment in the test says why: `RefreshDatabase` keeps the test in one transaction on one connection, so two truly parallel requests cannot run here, and the row lock is what serializes them in production.
  - **Isolation (constitution III, FR-018, SC-006)**: an owner who is not a member of an organization on their account gets 403 from `organizations/{organization}/context` and from a tenant route such as the devices list.
  - **Session**: `/me` reports `billing_accounts` true for an owner, and false for everyone else and after the account is deleted.

**Checkpoint**: all API behaviour is in place.

---

## Phase 6: Contract, client, API docs and verification (finishes the API pull request)

- [X] T030 Contract (depends on T029):
  - `cd apps/api && php artisan contract:export`;
  - write `contracts/openapi/supplements/billing.yaml` with the 409 on `DELETE admin/billing-accounts/{billingAccount}` (the 422 responses and request bodies are inferred; tags follow the controllers);
  - `contract:export --check` and `contract:check --base=origin/main` pass, and `contracts/openapi/pending-schemas.json` is unchanged.
- [X] T031 [P] `packages/api-client/src/billing.ts`, with the types `BillingAccountSummary`, `BillingAccountDetail`, `BillingAccountHistoryEntry`, `OwnedBillingAccount` and `BillingAccountValues`. Changes in `packages/api-client/src/index.ts`:
  - methods `adminBillingAccounts({search, page, per_page})`, `createBillingAccount`, `adminBillingAccount`, `updateBillingAccount`, `deleteBillingAccount`, `addBillingAccountOwner`, `removeBillingAccountOwner`, `moveOrganizationBillingAccount`, `ownedBillingAccounts` and `createOwnedOrganization`;
  - `createAdminOrganization` values gain `billing_account_uuid?` and `new_billing_account?`;
  - `Organization` gains `billing_account?: {uuid, name}`;
  - `AuthenticatedUser.capabilities` gains `billing_accounts: boolean`.
- [X] T032 [P] Docs:
  - in `docs/features/access.md`, a **Billing accounts** section: the model, the invariant, that an account grants no access, owners and the limit; plus, in its API table, the ten new operations (eight for platform administrators, two for owners) and the three changed ones (organization creation, the organization list, `/me`);
  - in `docs/dev/gotchas.md`, an entry: creating an `Organization` creates a billing account unless `billing_account_id` is set, so use `forBillingAccount()` in tests that need a shared account.
- [X] T033 Verify the API pull request:
  - `./taskw lint`;
  - `cd apps/api && vendor/bin/pint --test && php artisan test --compact` on PostgreSQL;
  - `pnpm --filter @iot-os/admin lint` and `pnpm --filter @iot-os/portal lint`, which type-check against the client;
  - rebuild `api` and the API-image services with the stack's env files and overlays ([local setup](../../docs/dev/local-setup.md#rebuild-one-service)), so the migration runs;
  - rebuild `admin` and `portal` as well, because both images bundle `packages/api-client` (constitution IX), and check that both still load and sign in;
  - run both SC-002 queries from [quickstart.md](quickstart.md) section 1 in `timescaledb` (one current assignment per organization; no gap or overlap) and expect no rows;
  - call `POST /api/v1/admin/organizations` with only `name` and `slug` from the signed-in admin session (D3).

**Checkpoint**: the API pull request is ready to open from `main`.

---

## Phase 7: Kit and User Story 1 in the admin app (opens the admin pull request)

**Goal**: the New organization dialog creates an organization under a new or existing billing account, and the list shows each organization's account (FR-005, FR-014).

**Independent Test**: steps 1 and 2 of [quickstart.md](quickstart.md) section 2.

- [X] T034 [P] [US1] `packages/ui/src/lib/slug.ts` exports `slugify`. Move the current function from `apps/admin/src/components/OrganizationDialog.tsx` unchanged: lower-case, trim, runs of non `[a-z0-9]` become `-`, and leading and trailing `-` are stripped. Add `packages/ui/src/lib/slug.test.ts` covering spaces, punctuation, accents and an empty result.
- [X] T035 [US1] `apps/admin/src/components/OrganizationDialog.tsx` (depends on T034). Import `slugify` from `@iot-os/ui/lib/slug`. When creating, add a **Billing account** field:
  - two `ChoiceCard`s, **New billing account** (the default) and **Existing billing account**;
  - New shows a name input that follows the organization name until edited, and an optional contact email;
  - Existing shows a `SearchableSelect` fed by `apiClient.adminBillingAccounts({ search })`, with each option showing "N of M organizations", and a warning when the chosen account is already at its limit (R6);
  - the request sends `new_billing_account` or `billing_account_uuid`;
  - 422 messages map to `billing_account_uuid`, `new_billing_account.name` and `new_billing_account.contact_email`;
  - editing an organization does not show the field.
- [X] T036 [US1] `apps/admin/src/pages/OrganizationsPage.tsx`: a **Billing account** column with a `RefLink` to `/billing-accounts/{uuid}`
- [X] T037 [US1] Creating with **New billing account** (the account name following the organization name, the request body) and with **Existing billing account** (the search, the at-limit warning, `billing_account_uuid`) is tested in `apps/admin/e2e/billing-accounts.spec.ts`, with the billing column's link. `apps/admin/e2e/admin.spec.ts` only looks up the organization's **Name** field exactly, since **Account name** now matches too; its existing organization tests pass. Depends on T035 and T036.

**Checkpoint**: US1 works end to end with the API pull request merged.

---

## Phase 8: User Story 2 in the admin app (finishes the admin pull request)

**Goal**: platform administrators manage billing accounts and move organizations from the admin app (FR-009 to FR-013).

**Independent Test**: steps 3 to 6 of [quickstart.md](quickstart.md) section 2.

- [X] T038 [P] [US2] `apps/admin/src/components/BillingAccountDialog.tsx`, which creates and edits:
  - fields: name, contact email, notes (`Textarea`, 2,000 characters at most), and organization limit (a number from 0 to 1000);
  - `useDiscardGuard` as `OrganizationDialog` uses it;
  - 422 messages map to the fields.
- [X] T039 [P] [US2] `apps/admin/src/components/ChangeBillingAccountDialog.tsx`:
  - a `SearchableSelect` over `adminBillingAccounts({ search })` that excludes the current account;
  - confirm calls `moveOrganizationBillingAccount`, invalidates the organization and billing account queries, and shows a toast.
- [X] T040 [US2] `apps/admin/src/pages/BillingAccountsPage.tsx` (depends on T038). `CollectionPage` + `DataTable` through `useDirectoryTable` (`apps/admin/src/components/ResourceDirectory.tsx`).
  - Columns: Name (a `RefLink` to the account), Organizations ("3 of 10"), Owners, Contact.
  - A header action, **New billing account**.
  - Row actions **Edit** and **Delete**. **Delete** is disabled with a tooltip while the account has organizations, and shows the 409 message if it races.
- [X] T041 [US2] `apps/admin/src/pages/BillingAccountPage.tsx` at `/billing-accounts/:billingAccountUuid`: `EntityPage` with four `Panel`s, using the named type scale. Depends on T038 and T039.
  - **Details**: name, contact, notes, limit, created; **Edit** opens `BillingAccountDialog`.
  - **Organizations**: a `DataTable` with name, slug, users, devices and assigned (`RelativeTime`), and a **Change billing account** row action.
  - **Owners**: add through a `SearchableSelect` over `apiClient.adminUsers({ search })`, and remove with an `AlertDialog` confirmation.
  - **History**: actor ("System" when null), a readable action with the organization or user it names, and `RelativeTime`.
  - An unknown account shows the not-found state.
- [X] T042 [US2] `apps/admin/src/pages/OrganizationsPage.tsx`: a **Change billing account** row action that opens `ChangeBillingAccountDialog` (depends on T036 and T039)
- [X] T043 [US2] Navigation (depends on T040 and T041):
  - `apps/admin/src/layout/AdminLayout.tsx`: a **Billing accounts** item after Organizations, with `WalletIcon` from `lucide-react`;
  - `apps/admin/src/App.tsx`: the `billing-accounts` and `billing-accounts/:billingAccountUuid` routes inside `AdminLayout`.
- [X] T044 [US2] `apps/admin/e2e/billing-accounts.spec.ts` with route mocks. Depends on T042 and T043.
  - **List**: the list, search and counts; create through the dialog; edit the limit.
  - **Delete**: disabled with organizations; works when the account is empty.
  - **Account page**: the panels render; adding an owner sends `PUT owners/{id}`; removing confirms first; the history lists entries.
  - **Move**: **Change billing account** from Organizations and from the account page sends the move.
  - **Checks**: at 375 px neither page scrolls sideways. The admin app has no axe package, so there is no axe check here.

**Checkpoint**: US1 and US2 work in the admin app.

---

## Phase 9: Admin pull request checks

- [X] T045 Verify the admin pull request:
  - `pnpm --filter @iot-os/ui test`;
  - `pnpm --filter @iot-os/admin lint` (`tsc` plus `check-ui`);
  - `pnpm --filter @iot-os/portal lint`;
  - `pnpm --filter @iot-os/admin test:e2e`;
  - `./taskw lint`;
  - rebuild `admin` and `portal` (the kit changed) with the stack's env files and overlays, then walk [quickstart.md](quickstart.md) section 2 in the running admin app without discarding anyone's unsaved edits, timing step 1 (SC-001).

**Checkpoint**: the admin pull request is ready to open from `main`.

---

## Phase 10: User Story 3, owner self-service in the portal (Priority: P2)

**Goal**: an owner creates organizations under their billing account from the portal and lands in them as Organization Admin (FR-015 to FR-019).

**Independent Test**: [quickstart.md](quickstart.md) section 3.

- [ ] T046 [US3] `apps/portal/src/billing/NewOrganizationDialog.tsx`:
  - fields: Name, and Address (the slug; it follows `slugify(name)` from `@iot-os/ui/lib/slug` until edited), with the hint "A number is added if this address is taken.";
  - the request sends `slug` only when the owner edited it, so the server picks a free address otherwise (spec edge case "Slug already taken");
  - errors map to `name` and `slug`, and the `billing_account` limit message shows on the form;
  - a 404 (the person no longer owns the account) shows "You no longer own this billing account." and invalidates the billing query;
  - on success: invalidate the `["session"]` query and the billing query, show a toast, and navigate to `/organizations/{uuid}/home`.
- [ ] T047 [US3] `apps/portal/src/billing/BillingAccountsPage.tsx`, a `CollectionPage` titled "Billing accounts" (depends on T046):
  - one line saying the account groups organizations for billing and gives no access to them;
  - with several accounts, a `SearchableSelect` above the table picks one, kept in `?account=`;
  - the header shows "N of M organizations" and **New organization**, which is disabled at the limit with a tooltip naming it and telling the owner to contact the platform operator;
  - a `DataTable` with Name, Created (`RelativeTime`), and an Open link to `/organizations/{uuid}/home` for organizations the person belongs to, or "Not a member" in `text-meta` for the others;
  - loading, error and empty states from the kit.
- [ ] T048 [US3] `apps/portal/src/App.tsx` (depends on T047):
  - the `billing` route inside `PortalShell`, lazy-loaded like `NotificationCenter`;
  - a **Billing accounts** `DropdownMenuItem` with `WalletIcon` in the user menu, above Administration, shown only when `user.capabilities.billing_accounts`;
  - the empty state of `OrganizationLinks` ("You don't belong to an organization yet. Ask your organization administrator for an invitation.") takes the capability. When it is set, the text says to create an organization under the billing account, with a link to `/billing` (US3 scenario 7).
- [ ] T049 [P] [US3] `apps/portal/e2e/billing-accounts.spec.ts` with route mocks. Depends on T048.
  - **Menu**: the item is hidden without the capability and shown with it.
  - **Landing**: an owner with no organizations sees the link to **Billing accounts**; a non-owner with none still sees the invitation text.
  - **Page**: shows "2 of 10 organizations"; a non-member organization shows "Not a member" with no link.
  - **Several accounts**: the account selector switches between them.
  - **Create**: with the address untouched the dialog posts only `name`; after editing the address it also posts `slug`; either way it lands on the new organization's home. A 422 limit response shows its message on the form, and a 404 shows the no-longer-owner message.
  - **At the limit**: **New organization** is disabled and names the limit.
  - **Checks**: an axe check; at 375 px nothing scrolls sideways.

  Existing portal specs still pass.
- [ ] T050 [P] [US3] `docs/features/access.md`: the owner's portal page (where to find it, the limit, "Not a member", how to get access to an organization on the account)

**Checkpoint**: US3 works in the portal.

---

## Phase 11: Portal pull request checks

- [ ] T051 Verify the portal pull request:
  - `pnpm --filter @iot-os/portal lint` and `test`;
  - `pnpm --filter @iot-os/portal test:e2e`;
  - `./taskw lint`;
  - rebuild `portal` with the stack's env files and overlays;
  - walk [quickstart.md](quickstart.md) section 3 as a non-administrator owner in the running portal, without discarding anyone's unsaved edits: the landing in step 1, timing step 4 (SC-003), the server refusal in step 5, step 6 (SC-006) and step 7 (FR-019).

**Checkpoint**: the portal pull request is ready to open from `main`.

---

## Dependencies

- Phase 1 merges before any implementation pull request.
- Phase 2 blocks Phases 3 to 5.
- Phase 3 (US1) and Phase 4 (US2) can overlap once T008 exists. They share `BillingAccountAdministrationTest.php`, so T017 and T024 run one after the other.
- Phase 5 (US3) needs T023's routes file.
- Phase 6 needs Phases 3 to 5.
- The admin pull request (Phases 7 to 9) needs the API pull request merged. Within it, T034 comes first; T038 and T039 can start alongside Phase 7; Phase 9 comes last.
- The portal pull request (Phases 10 and 11) needs the API pull request merged, and needs `slug.ts` from the admin pull request. If the portal work starts first, move T034 into it instead. Phase 11 comes last.

## Parallel opportunities

- **Phase 2**: T003 and T004 together; after them, T006, T007 and T008 together. Then T010, T011 and T012 together once T005 and T009 are done.
- **US1 API**: T016 and T017 while T015 is in review.
- **US2 API**: T019, T020 and T021 together, while T018 is written.
- **US3 API**: T026 and T028 alongside T025.
- **API finish**: T031 and T032 together.
- **Admin**: T034, T038 and T039 together.
- **Portal**: T049 and T050 together.

## Implementation strategy

- **MVP (US1)**: Phases 2, 3 and 7, with Phase 6 for the US1 operations. Every organization has an account, administrators choose it when creating organizations, and the list shows it. That already answers the request for platform administrators.
- **Planned order**: the API pull request carries the endpoints for all three stories (Phases 2 to 6). The admin pull request adds US1 and US2 to the admin app. The portal pull request adds US3, which needs the owners and limits that US2 sets.
- **If the API pull request grows too large**: ship Phases 2, 3 and 6 first. Phases 4 and 5 then follow in their own pull request from `main`, each with their part of T030 to T032. Never stack.
