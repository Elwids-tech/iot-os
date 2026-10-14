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
Accepting an invitation links straight into the organization.

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
organizations and their ceilings and roles, users, invitations, the platform
team (super administrators only) and telemetry retention
(`PlatformAdministration.manage-retention`).

A platform administrator sets up an organization from **Organizations**: create it
(it gets the three built-in roles), then use the row's actions to open its **Roles**,
add a **New role** (name and permissions from the organization's ceiling) or
**Invite user** with any of its roles. A role's page edits its permissions and offers
**Rename** (not Organization Admin) and **Delete role** (custom roles that no member
holds and no pending invitation uses).

Routes are under `/api/v1/admin` and mostly need
`PlatformAdministration.manage-organizations`. Creating, renaming and deleting roles,
and changing or removing members, use the organization routes above: they accept
platform administrators without membership and let them grant the whole ceiling.

The first administrator of a new deployment is created with
`php artisan deployment:administrator EMAIL --output=<new private file>`
([release](../ops/release.md)).
