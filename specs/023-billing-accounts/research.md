# Research: Billing Accounts

The spec has no open clarifications. These are the design questions the plan had to
settle, each answered from the code as it is on `main` (8dab125).

## R1. Where billing lives

- **Decision**: a new `App\Domain\Billing` domain. Its routes file is required from
  `routes/api.php`, like the other domains.
- **Rationale**: billing accounts will later carry metering and pricing, which are
  not organization administration. `Administration` keeps organizations, members,
  roles and invitations. The shared `Organization` model gains only a relation and
  two hooks.
- **Alternatives**: put it in `Administration`, which mixes payer concerns into
  organization administration (the roadmap's "Module boundaries" item already works
  against domains that hold unrelated concerns). Put it in `Shared`, which is for
  kernel models only.

## R2. Keeping "every organization has exactly one account"

- **Decision**:
  - `organizations.billing_account_id` is `NOT NULL` with a foreign key;
  - `Organization::creating` creates an account named after the organization when
    none is set;
  - `Organization::created` opens the first assignment.
- **Rationale**: organizations are created in the admin API,
  `OrganizationFactory` (used by most feature tests), seeders, and
  `BootstrapStaging::handle` (`Organization::create`). The constraint makes a gap
  impossible, and the hook keeps factories, seeders and `BootstrapStaging` working
  unchanged. The hook's accounts are not audited. The admin API does not rely on it:
  it creates accounts through `BillingAccounts::create`, so their history starts with
  `created` (R7).
- **Alternatives**:
  - A `CreateOrganization` service called everywhere: it is easy to bypass, and
    hundreds of factory calls would need changing.
  - A nullable column with a scheduled repair: it breaks FR-002 between runs.

## R3. Current account and history

- **Decision**: keep the current account on `organizations.billing_account_id`, and
  the history in `billing_account_assignments` (open while `ended_at` is null). A
  partial unique index allows one open row per organization, and a move closes and
  opens rows in one transaction with the organization locked.
- **Rationale**: most reads (list column, owner page, limit count) want the current
  account and stay simple joins. FR-020 needs the account at any moment, which the
  rows answer with `started_at <= t < coalesce(ended_at, ∞)`. Snapshots of the
  organization's uuid and name keep the history readable after the organization is
  deleted.
- **Alternatives**:
  - History only, which makes every read a range query.
  - Day-granular assignments: that is metering's concern (ADR-026 leaves it to
    later), and moment precision converts to days whenever needed.

## R4. Deleting billing accounts

- **Decision**: soft delete, allowed only when the account has no organizations
  (409 otherwise). Deleted accounts disappear from lists, search, owner pages and
  `billing_account_uuid` validation.
- **Rationale**: assignment rows reference accounts. A hard delete would cascade
  them, losing FR-020 history, or need a nullable key.
- **Alternatives**: forbid deleting any account that ever had an organization. The
  rollout and moves would then leave many empty accounts nobody could remove.

## R5. Deleting an organization

- **Decision**: add `billing_account_assignments` to `OrganizationDeletion::KEPT`
  (`organization_id` set null on delete), and close the open assignment
  (`ended_at = now()`, `ended_by = actor`) before `forceDelete`.
- **Rationale**: `OrganizationDeletionInventoryTest` requires every foreign key to
  `organizations` to cascade or be classified, and KEPT keys must be `set null`. The
  account keeps the history of what it paid for.
- **Audit placement**: billing audit events use a null `organization_id`, as
  `organization.deleted` does, because `device_audit_events.organization_id`
  restricts deletion.

## R6. Enforcing the organization limit

- **Decision**:
  - `organization_limit` is an unsigned small integer from 0 to 1000, default 1;
  - owner creation locks the account row (`lockForUpdate`) and counts its
    non-trashed organizations before inserting;
  - at or above the limit, it returns 422 on `billing_account` with "This billing
    account allows N organizations. Ask the platform operator to raise the limit.";
  - platform administrators bypass the check, and the admin dialog warns when the
    account is already at its limit.
- **Rationale**: the row lock serializes concurrent owner creations on the same
  account (FR-017, SC-004) without a global lock. `AdapterService::tenant` already
  locks organizations for port allocation; this lock is narrower.
- **Alternatives**: no lock, which lets two creations pass at limit − 1. A unique
  "slot" table is more machinery for the same guarantee.

## R7. The create organization request

- **Decision**: `POST /v1/admin/organizations` accepts either `billing_account_uuid`
  or `new_billing_account: {name, contact_email?}`. With neither, a new account is
  created, named after the organization. Both together is 422. Unless an existing
  account is named, the controller creates the account with `BillingAccounts::create`
  inside its existing transaction, so the account is audited as created by the
  administrator.
- **Rationale**: existing clients (the admin app before its pull request, scripts)
  keep working (D3), and FR-006 holds because one transaction covers both rows.
- **Alternatives**: a required field, which breaks clients. A separate "create
  account" call before the organization, which is not atomic.

## R8. Owner access and the portal entry point

- **Decision**:
  - owners are rows in `billing_account_owners` with integer `user_id`;
  - owner routes look the account up inside `ownedBillingAccounts()` and answer 404
    otherwise;
  - `/me` gains `capabilities.billing_accounts`;
  - the portal page is `/billing` under `PortalShell`, reached from the user menu.
- **Rationale**: 404 avoids confirming that an account exists (the same rule spec
  003 uses for tenant records). The page sits outside any organization because an
  account spans organizations. `NotificationCenter` already sits at `/notifications`
  in the same way.
- **Owner access inside organizations**: none. `ResolveOrganizationContext` is
  unchanged; the owner page shows "Not a member" without a link (D1).

## R9. Keeping billing invisible to members

- **Decision**: `OrganizationResource` emits `billing_account` only when the relation
  is loaded, and only the admin index loads it. The owner endpoint uses its own
  resource.
- **Rationale**: `OrganizationResource` also serves `/me` and the tenant routes, so
  an unconditional field would show every member their account (FR-019). A test walks
  `/me` and the organization context as a member and asserts the field is absent.

## R10. Rollout backfill

- **Decision**: `BillingAccountBackfill::run()`, called from the migration and
  covered by its own test. For each organization, trashed included, it:
  - inserts one account (name = organization name, limit 1, no owners);
  - sets the foreign key;
  - inserts an open assignment from the organization's `created_at`, with no actor.
- **Rationale**: starting at `created_at` leaves no organization without an account
  at any time it existed, which matches "its own account" before billing accounts
  existed. The query builder avoids model hooks during the migration. Trashed
  organizations need a value for the `NOT NULL` column.
- **Alternatives**: start at the migration time, which leaves a gap before rollout
  that SC-002's check would need to excuse.

## R11. Account history

- **Decision**: the account page's history merges:
  - `DeviceAudit` events whose `resource_uuid` is the account's uuid (created,
    updated with changed fields, owner added or removed). Deletion is audited too,
    but a deleted account answers 404 (R4), so its history is never shown;
  - the account's assignment rows, "joined" at `started_at` by `assigned_by`, and
    "left" at `ended_at` by `ended_by`.
  It shows the latest 100. A new index on
  `device_audit_events (resource_uuid, created_at)` serves the lookup.
- **Rationale**: platform actions already audit through `DeviceAudit`
  (`SuperAdministrators`, `PlatformAdministrators`, `OrganizationDeletion`,
  `AssistantSettings`). Assignments already hold who and when for moves, so a move
  needs no account-side audit row. One `organization.billing_account_changed` event,
  with the organization as the resource, records it for the organization.
- **Alternatives**: a billing audit table, which splits the platform audit trail.

## R12. Slugs for owner-created organizations

- **Decision**: the portal shows `slugify(name)` as the suggested address. The kit's
  `lib/slug.ts` takes over the function the admin dialog uses today. The portal sends
  `slug` only when the owner edited it. The server validates a given slug like the
  admin request does, or generates a free one (`-2`, `-3`…) when none is sent. The
  uniqueness check includes trashed organizations, because the column's unique index
  does.
- **Rationale**: the same rules in both apps. An owner who leaves the field alone
  never sees a slug error, because the client cannot know which slugs are taken.

## R13. Making the owner the Organization Admin

- **Decision**: `OrganizationDefaultRoles::ensure` (which returns the built-in roles
  by name), `$user->organizations()->attach`, then
  `OrganizationRoleManager::syncMemberRoles($organization, $user,
  [$roles['organization-admin']->id])`. This is the same sequence invitation
  acceptance uses, without the welcome email.
- **Rationale**: membership and roles come through the existing paths, so ceilings,
  role caches and permission resolution behave as for any member.

## R14. Permissions

- **Decision**: admin billing endpoints require
  `PlatformAdministration.manageOrganizations`, like the other organization admin
  endpoints. There is no new platform permission.
- **Rationale**: the spec's assumption, and the people who create organizations are
  the people who choose their accounts. A dedicated billing permission can come with
  pricing.
