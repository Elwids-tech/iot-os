# Access: authentication, organizations, roles

How people sign in, how organizations manage their members and roles, and how
platform administrators set what each organization may use. Machine access is in
[integrations](integrations.md).

Code: [`Domain/Authentication`](../../apps/api/app/Domain/Authentication),
[`Domain/Administration`](../../apps/api/app/Domain/Administration),
[`Domain/Authorization`](../../apps/api/app/Domain/Authorization),
[`Domain/Shared`](../../apps/api/app/Domain/Shared); portal
[`src/members`](../../apps/portal/src/members), [`src/settings`](../../apps/portal/src/settings);
admin [`apps/admin`](../../apps/admin); shared auth pages
[`packages/auth`](../../packages/auth). Decision: [ADR-008](../adr/ADR-008-laravel-sanctum-authentication.md).

## Signing in

The portal and admin use Laravel Sanctum's stateful sessions: an HTTP-only session
cookie plus CSRF protection (`/sanctum/csrf-cookie`). Browsers never hold bearer
tokens. Allowed origins come from `SANCTUM_STATEFUL_DOMAINS` and
`CORS_ALLOWED_ORIGINS`; change them together with the frontend URLs. Use the same
hostname (`localhost` or `127.0.0.1`) in every tab so cookies are shared.

- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/me`
  (returns the user's integer `id`, organizations and capabilities).
- `GET /api/v1/organizations/{organization}/context` returns the organization's
  capabilities, which the UI uses to show or hide features. The API enforces the
  same rules independently.

### Password recovery

Both sign-in pages link to **Forgot password?**, hosted by the portal at
`/forgot-password`.

- `POST /api/v1/auth/forgot-password` always returns the same message. Limits:
  10 per minute per IP, 5 per hour per email, one email per account per minute.
- Links use `FRONTEND_URL` and carry the token in the URL fragment, so it stays out
  of server logs and referrers. Tokens are hashed, expire after 60 minutes and are
  single-use.
- Passwords need 12–256 characters. A reset rotates the remember token, deletes
  personal access tokens and database sessions, and requires a fresh sign-in.
- Reset mail goes through the `alerts` queue and `alerts-worker`; notification
  preferences never suppress it. Queued mail is encrypted with `APP_KEY`, so API and
  workers must share it.

## Organizations, members and roles

An organization is the tenant boundary. Every organization route resolves the
organization and requires membership (404 for unknown, 403 for non-members), then
checks a permission.

### Permissions

Permissions are enums under each domain's `Permissions/` directory:

| Family | Permissions |
| --- | --- |
| `Organization.*`, `User.*`, `Role.*` | View, create, update, delete members, roles and organization settings |
| `Device.*` | `view`, `manage`, `manage-connections`, `activate`, `command` ([devices](devices.md#permissions)) |
| `DeviceProfile.*`, `TransportBinding.manage` | Profile authoring and publication ([profiles](device-profiles.md#permissions)) |
| `Workflow.*` | `view`, `manage`, `activate` for DAG automations ([automation](automation.md#api)) |
| `Dashboard.*` | `view`, `create`, `manage` ([dashboards](dashboards.md#access-and-sharing)) |
| `PlatformAdministration.*` | `access`, `manage-organizations`, `manage-retention` (admin app only) |

Built-in roles: **Organization Admin** (always holds exactly the organization's
ceiling), **Moderator** and **Member**, defined in
[`OrganizationRoleName`](../../apps/api/app/Domain/Authorization/Enums/OrganizationRoleName.php).
Custom roles can bundle any grantable permissions.

### Permission ceiling

Each organization has a **ceiling**: the tenant permissions its roles may hold.
Platform administrators edit it in admin under **Organizations → Permissions**.

- **All permissions** (default): every tenant permission, including ones added by
  future features.
- **Only selected permissions**: an allow-list (`organization_permission`,
  `permissions_restricted`). Permissions added later stay unavailable until
  selected.

Narrowing the ceiling removes dropped permissions from every role in the same
transaction. Widening re-grants nothing except to Organization Admin. A migration or
seeder that grants new tenant permissions to existing roles must reconcile
restricted organizations afterwards
([`OrganizationPermissionCeiling::reconcile`](../../apps/api/app/Domain/Administration/Services/OrganizationPermissionCeiling.php)).

### No escalation

Platform administrators can grant the whole ceiling. Anyone else can grant only
permissions that are inside the ceiling **and held by them** in that organization
([`OrganizationGrants`](../../apps/api/app/Domain/Administration/Services/OrganizationGrants.php)):

| Action | Requires | Also requires |
| --- | --- | --- |
| Create or edit a role | `Role.create` / `Role.update` | New (and, when editing, current) permissions are grantable |
| Delete a role | `Role.delete` | Custom, unused, not on a pending invitation, permissions grantable |
| Change a member's roles | `User.update` | Selected roles and everything the member holds now are grantable |
| Remove a member | `User.delete` | Everything the member holds is grantable |
| Invite, resend, revoke | `User.create` | Every role on the invitation is grantable |

An organization always keeps at least one Organization Admin; changes that could
remove the last one run under a lock. Violations return 422 with a field error.

### In the portal

**Settings → Members** has People (search, change roles, remove) and Invitations
(resend, revoke). **Invite people** takes an email and roles; roles with
permissions you don't hold are shown locked. **Settings → Roles** edits built-in and
custom roles with the shared permission matrix; Organization Admin is read-only.
Accepting an invitation links straight into the organization and queues a welcome
email ([`OrganizationWelcomeNotification`](../../apps/api/app/Domain/Administration/Notifications/OrganizationWelcomeNotification.php))
on the `alerts` queue after the acceptance commits. It describes only what the
person's roles there allow, read when `alerts-worker` sends it, links to the
organization's Home and is skipped if they have left the organization by then.
Super-administrator invitations send none. Like password resets, it ignores email
preferences.

Invitations expire after seven days; resending issues a new token with the same
UUID and stops the old link. Inviting is limited to 20 per minute per user and 200
per day per organization. Invitation acceptance is public
(`GET/POST /api/v1/invitations/{token}`).

### API

Under `/api/v1/organizations/{organization}`: `members` (search, paging; each with
`is_current_user` and `manageable`), `PUT/DELETE members/{user_id}` (integer ids,
[ADR-013](../adr/ADR-013-integer-user-ids.md)), `roles`, `role-permissions`
(the ceiling with `grantable` flags), `invitations`, `invitations/{uuid}/resend`.
The organization context adds `capabilities.administration` flags that drive
the Members and Roles pages.

## Platform administration

The admin app ([`apps/admin`](../../apps/admin)) requires
`PlatformAdministration.access`, granted by the `platform-administrator` platform
role; super administrators (`users.is_super_admin`) pass every check. It covers
organizations and their ceilings and roles, users, invitations, super administrators
and platform administrators (both managed by super administrators only), telemetry
retention
(`PlatformAdministration.manage-retention`), and, for super administrators, the
[support ticket](support.md) queue.

A platform administrator sets up an organization from **Organizations**: create it
(it gets the three built-in roles), then use the row's actions to open its **Roles**,
add a **New role** (name and permissions from the organization's ceiling) or
**Invite user** with any of its roles. A role's page edits its permissions and offers
**Rename** (not Organization Admin) and **Delete role** (custom roles that no member
holds and no pending invitation uses).

### Super administrators

Super administrators add and remove other super administrators in admin under
**Users** ([spec 007](../../specs/007-super-administrators/spec.md)):

- **Make super administrator** on any user's row promotes an existing account; it keeps
  its organization memberships and roles. **Remove super administrator** takes the
  access away on the person's next request; it is never offered on your own row, and
  the API refuses it with 422, so at least one super administrator remains.
- **Invite user → Super administrator** invites someone by email with no organization.
  They accept like any invitation (a new account chooses its name and password; an
  existing account signs in with the invited email) and land in admin. The
  **Invitations** list shows these as "All organizations" / "Super administrator";
  they expire after seven days and can be resent and revoked. When the inviter loses
  super administrator access, their pending super-administrator invitations stop
  working.

Platform administrators see none of this, and the API answers them 403. Every grant
and removal records `user.super_admin_granted` or `user.super_admin_revoked` (no
organization, the acting user, and the affected `user_id` and email); an accepted
invitation records the inviter as the actor. Routes:
`PUT/DELETE /api/v1/admin/super-administrators/{user_id}` and
`POST /api/v1/admin/super-administrators/invitations` (`email`). A
super-administrator invitation is an `organization_invitations` row with
`grants_super_admin` and no organization or roles.

### Platform administrators

Super administrators grant and remove the `platform-administrator` role in admin under
**Users** ([spec 008](../../specs/008-platform-administrators/spec.md)):

- **Make platform administrator** on the row of a user who is not a super
  administrator opens the admin app to them on their next request; they keep their
  organization memberships and roles. **Remove platform administrator** takes it away
  again.
- Super administrators' rows offer neither: they pass every check anyway. A super
  administrator who also holds the role keeps it when their super administrator
  access is removed.

Platform administrators see neither action, and the API answers them 403. Every change
records `user.platform_administrator_granted` or `user.platform_administrator_revoked`
(no organization, the acting user, and the affected `user_id` and email); a request
that changes nothing records none. Route:
`PUT /api/v1/admin/platform-team/{user_id}` (`is_platform_administrator`, returns the
user with their platform roles); `GET /api/v1/admin/platform-team` lists users with
their platform roles.

### Deleting an organization

**Delete organization** on an Organizations row removes an organization permanently
([spec 006](../../specs/006-delete-empty-organizations/spec.md)). The list's
**Devices** column shows which organizations are empty.

Deletion is refused while the organization holds anything that is still people's work
or that lives outside Laravel's database and has no teardown yet: devices (archived
ones too), broker connections, gateways, adapter runtimes and device adapters, device
profiles (soft-deleted ones too), automations, integrations, geofences, or an
assistant reply still running. The dialog lists each blocker with its count.

Otherwise the dialog lists what goes and asks for the organization's slug. Deletion
removes, in one transaction:
- memberships (accounts stay), roles and their assignments, and invitations;
- the permission ceiling, dashboards, sites, and automation and retention settings;
- notification events and audit events;
- AI-agent connections, whose Passport tokens are revoked first;
- assistant conversations, with their stored files and SDK rows.

One `organization.deleted` audit event, with no organization, records who deleted
which one (uuid, name and slug). The slug can then be reused. There is no restore:
recover from a checkpoint.

`OrganizationDeletion` holds the classification. `OrganizationDeletionInventoryTest`
fails when a foreign key to `organizations` neither cascades nor appears there.

Routes are under `/api/v1/admin` and mostly need
`PlatformAdministration.manage-organizations`. Creating, renaming and deleting roles,
and changing or removing members, use the organization routes above: they accept
platform administrators without membership and let them grant the whole ceiling.
Deletion uses `GET organizations/{uuid}/deletion` (blockers and removed data, each
with a count) and `DELETE organizations/{uuid}?slug=<slug>` (204, 409 with
`blockers`, or 422 for a wrong slug).

The first administrator of a new deployment is created with
`php artisan deployment:administrator EMAIL --output=<new private file>`
([release](../ops/release.md)); further super administrators are added from admin.

### Billing accounts

Every organization belongs to exactly one billing account, the payer of record
([spec 023](../../specs/023-billing-accounts/spec.md),
[ADR-026](../adr/ADR-026-billing-accounts.md)). An account groups the organizations
one customer of the platform pays for, such as an integrator's customers, each in an
organization of its own. **An account grants no access**: owning it changes nothing
anyone can read or do inside its organizations, and members never see their
organization's account.

- **Creating an organization** picks a new billing account (named after the
  organization, with an optional contact email) or an existing one. A request that
  names neither gets a new account, so older API clients keep working. Platform
  administrators are not bound by an account's limit.
- **Billing accounts** in the admin app lists accounts with their organizations,
  owners and limit. An account's page edits its name, contact email, notes and
  **organization limit** (0 to 1000, default 1), adds and removes **owners**, moves
  organizations to another account (nothing inside the organization changes) and
  shows its history: changes, owner changes, and organizations joining and leaving,
  with who and when. Only an account with no organizations can be deleted.
- **Owners** create organizations under their account themselves, while it is below
  its limit, and become each new organization's Organization Admin as an ordinary
  member.
- Each account change is one audit event with no organization
  (`billing_account.created`, `updated`, `deleted`, `owner_added`, `owner_removed`,
  and `organization.billing_account_changed` on a move).
  `billing_account_assignments` records which account each organization belonged to
  from when to when; deleting an organization closes its period and keeps the row.
  The rollout gave every existing organization an account of its own, with no owners
  and a limit of 1, from the organization's creation.

Admin routes need `PlatformAdministration.manage-organizations`:
`GET/POST admin/billing-accounts`, `GET/PATCH/DELETE admin/billing-accounts/{uuid}`
(409 while it has organizations), `PUT/DELETE admin/billing-accounts/{uuid}/owners/{user_id}`,
and `PUT admin/organizations/{uuid}/billing-account` (204). `POST admin/organizations`
takes `billing_account_uuid` or `new_billing_account: {name, contact_email}`, and the
admin organization list carries `billing_account`. Owners use
`GET billing-accounts` and `POST billing-accounts/{uuid}/organizations` (`name`, and
an optional `slug`; 422 on `billing_account` at the limit). Any account the person
does not own answers 404. `GET me` reports `capabilities.billing_accounts`.
