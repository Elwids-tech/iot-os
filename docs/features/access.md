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

### Keep me signed in

The portal's sign-in and its **Restore your session** dialog offer **Keep me signed
in**, off by default, with the hint *Don't tick this on a shared device.* Without it
the session ends after 2 hours idle, as before. With it, that browser or installed app
stays signed in for 30 days from sign-in, however long it sits idle
([spec 033](../../specs/033-pwa-web-push/spec.md) FR-011a, research R11).

- `POST /api/v1/auth/login` takes `remember: true`. It creates a `kept_sign_ins` row
  and sets the `iot_kept` cookie (`{uuid}.{secret}`, encrypted, HttpOnly, on the
  session's domain with its Secure and SameSite flags). Only the secret's SHA-256 is
  stored.
- `ResumeKeptSignIn`, in the `api` middleware group after Sanctum's stateful middleware,
  signs a portal or admin request that has lost its session back in from a live
  record, and signs a session out as soon as its record has ended or expired. It
  ignores bearer tokens and requests that are not from a stateful frontend.
- The 30 days run from sign-in and use never extends them. Signing out on that browser
  ends only its record (`signed_out`); other devices stay signed in. A password reset
  ends every record of the person (`password_reset`). Signing in again on the browser
  replaces its record. Removing a push device will end the record linked to it
  (`device_removed`, pull request 5 of spec 033).
- The admin app shares the session cookie's domain, so a browser kept signed in on the
  portal is signed in to the admin app too, as the shared session already is within
  its 2 hours ([ADR-047](../adr/ADR-047-progressive-web-app-before-native-apps.md)).
  The admin sign-in has no checkbox.
- `auth:prune-kept-sign-ins` runs daily at 03:55 UTC and deletes records that ended or
  expired more than 30 days ago.

### Two-step sign-in

A person can turn on two-step sign-in, with codes from an authenticator app and
one-time recovery codes. A right password then only starts a pending sign-in; the
session begins after a valid code
([spec 034](../../specs/034-two-factor-passkeys/spec.md),
[ADR-048](../adr/ADR-048-two-step-sign-in-and-passkeys.md)). Fortify supplies the
actions and the code check; its routes are off, and the `Authentication` domain's
routes call them.

- **Setup.** `POST /api/v1/me/two-step` returns a QR code (SVG), the setup key and the
  `otpauth://` URL. Starting again replaces an unconfirmed secret. Two-step takes
  effect only at `POST /api/v1/me/two-step/confirm` with a valid code. That response
  holds eight recovery codes, shown once.
- **Storage.** The secret and the recovery codes are encrypted with `APP_KEY` in
  `users.two_factor_secret` and `users.two_factor_recovery_codes`;
  `two_factor_confirmed_at` marks it on. A used recovery code is removed, not replaced.
- **Sign-in.** For a person with two-step on, `POST /api/v1/auth/login` answers
  `202 {"two_step_required": true, "expires_in": 300, "methods": [...]}` and stores
  `two_step.pending` in the session (who, **Keep me signed in**, expiry, wrong codes).
  `POST /api/v1/auth/two-step` takes `code` or `recovery_code`:
  - a valid one starts the session through `CompleteSignIn`, the same path as a
    password-only sign-in, which also issues the kept sign-in;
  - codes from the previous and next 30-second step are accepted, and a code that
    signed the person in is refused for the rest of its window
    (`PerUserTwoFactorProvider` keys the replay check by secret, not by code alone);
  - five wrong codes, or 5 minutes, end the pending sign-in (`422`, `errors.pending`);
  - code attempts count toward the `login` limiter's per-account and per-address keys,
    so a password and four codes use up a minute's five tries.
- **Changes need the password again.** `POST /api/v1/auth/confirm-password` confirms
  it for 15 minutes (`auth.password_timeout`). Starting setup, new recovery codes and
  turning two-step off answer `423` without it.
- **Other sign-ins end.** Turning two-step on or off and new recovery codes end the
  person's other database sessions, kept sign-ins (`two_step_changed`) and their push
  devices. The browser making the change stays signed in (`EndSignIns::elsewhere`).
- **A password reset** never turns two-step off; the next sign-in still asks for a
  code.
- **Notices.** Each change, and each sign-in with a recovery code, emails the person
  (`SecurityChanged`, on the `alerts` queue) and writes a `person.*` entry to the
  [activity log](activity-log.md) with no organization, the person as subject and no
  secret.
- `GET /api/v1/me/security` reports whether two-step is on, when it was confirmed, how
  many recovery codes remain and whether it is required, plus the person's
  [passkeys](#passkeys). It never returns a secret, a code or credential material.

**Screens.** People manage two-step on the portal's **Account → Security** page
(`/account/security`, **Security** in the user menu). The admin app's user menu links
there as **Security settings**. The shared pieces are in `@iot-os/auth`:

- `TwoStepChallenge` is the code step. Both sign-in pages and the portal's
  session-restore dialog show it when `login()` throws `TwoStepRequiredError`. It
  offers only the methods the `202` lists, says how many tries are left, and sends the
  person back to the password on `errors.pending`, keeping the email and **Keep me
  signed in**. After a recovery code it shows how many are left, and with none left it
  links to the security page.
- `TwoStepSetup` shows the QR code as an `<img>` from a `data:` URL, never as injected
  HTML. It also shows the setup key and confirms a code. `RecoveryCodes` then shows
  the eight codes with **Copy** and **Download** (a `.txt` named after the deployment's
  host) and asks the person to confirm they saved them.
- `useConfirmedAction` runs a change. On `423` (`ConfirmationRequiredError`) it opens
  `ConfirmIdentityDialog` for the password, or **Use a passkey** when the person has
  one, and then retries the change.

The code field is the kit's `InputOTP` (`SixDigitCode`). The status uses the kit
values `enabled` ("On") and `not_set_up` ("Not set up"). The help guide is
`two-step-sign-in`.

### Passkeys

A person can add passkeys and sign in with one alone: the browser checks their
fingerprint, face or screen lock, and the passkey counts as both steps
([spec 034](../../specs/034-two-factor-passkeys/spec.md) US2,
[ADR-048](../adr/ADR-048-two-step-sign-in-and-passkeys.md)). `laravel/passkeys`
(through Fortify) supplies the WebAuthn actions behind our own routes; the browser
side is `@laravel/passkeys`.

- **Relying party.** Passkeys are bound to `PASSKEYS_RP_ID`, the parent domain of the
  portal and admin app (the release's `DOMAIN`), so one passkey works in both. The
  allowed origins are `FRONTEND_URL` and `ADMIN_FRONTEND_URL`. Changing the domain
  makes every passkey stop working; people sign in with their password and code.
- **When they are offered.** Only when both front-end URLs are `https`, or their host
  is `localhost` (`PasskeyAvailability`). Otherwise every passkey route answers `404`,
  `GET /api/v1/me/security` says `unavailable_reason: "not_https"`, the sign-in pages
  hide the button, and existing passkeys no longer count toward two-step.
- **Sign-in.** `GET /api/v1/auth/passkeys/options` keeps WebAuthn request options in
  the session; `POST /api/v1/auth/passkeys` takes the browser's assertion and
  `remember`. A valid one starts the session through `CompleteSignIn`, like every other
  sign-in, so **Keep me signed in** issues a kept sign-in and never Laravel's remember
  token. It also replaces a pending password sign-in, and the password step's `202`
  lists `passkey` in `methods` for a person with two-step on who has a passkey. Both
  routes allow 6 requests a minute per address, each counted on its own.
- **Adding and removing.** `GET /api/v1/me/passkeys/options`, `POST /api/v1/me/passkeys`
  (`name`, 1 to 60 characters, and the attestation) and
  `DELETE /api/v1/me/passkeys/{passkey}` need a confirmation from the last 15 minutes.
  The browser is told to skip the person's existing passkeys, and one already
  registered to anyone is refused (`422`). Another person's passkey is not found.
  Adding or removing emails the person and writes `person.passkey_added` or
  `person.passkey_removed` with the name and never the credential; it does not end
  other sign-ins.
- **Confirming with a passkey.** `GET /api/v1/auth/confirm-passkey/options` offers
  only the person's own passkeys; `POST /api/v1/auth/confirm-passkey` confirms them
  for 15 minutes, as the password does. It answers `200 {"confirmed": true}` because
  the browser client reads a JSON body.
- **Storage.** The `passkeys` table holds the name, the credential id (unique), the
  public key credential, `last_used_at` and timestamps. The credential and its id never
  leave the API. The user handle is an HMAC of the person's id with
  `PASSKEYS_USER_HANDLE_SECRET`, generated once per deployment, so rotating `APP_KEY`
  leaves passkeys alone.

**Screens.** `PasskeySignInButton` (`@iot-os/auth`) sits below the password form on
both sign-in pages and in `TwoStepChallenge` (**Use a passkey instead**, or **Continue
with your passkey** when it is the only method). The email field carries
`autocomplete="… webauthn"`, so the browser also lists saved passkeys there. The button
hides when the browser cannot use passkeys or the API answers `404`, and closing the
browser's prompt shows no error. The portal's **Account → Security** page has a
**Passkeys** panel: a table of name, added and last used, **Add a passkey** with a
name, **Remove** with a confirmation, and the reason when passkeys can't be used here
(no HTTPS, or a browser without passkeys).

### Password recovery

Both sign-in pages link to **Forgot password?**, hosted by the portal at
`/forgot-password`.

- `POST /api/v1/auth/forgot-password` always returns the same message. Limits:
  10 per minute per IP, 5 per hour per email, one email per account per minute.
- Links use `FRONTEND_URL` and carry the token in the URL fragment, so it stays out
  of server logs and referrers. Tokens are hashed, expire after 60 minutes and are
  single-use.
- Passwords need 12–256 characters. A reset rotates the remember token, deletes
  the person's database sessions, ends every kept sign-in, revokes their agent
  connections with those connections' Passport access and refresh tokens, and requires
  a fresh sign-in.
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
| `Device.*` | `view`, `manage`, `manage-connections`, `activate`, `command`, `move` ([devices](devices.md#permissions)) |
| `DeviceProfile.*`, `TransportBinding.manage` | Profile authoring and publication ([profiles](device-profiles.md#permissions)) |
| `Workflow.*` | `view`, `manage`, `activate` for DAG automations ([automation](automation.md#api)) |
| `Dashboard.*` | `view`, `create`, `manage` ([dashboards](dashboards.md#access-and-sharing)) |
| `PlatformAdministration.*` | `access`, `manage-organizations`, `manage-retention` (admin app only; `GET me` sends `capabilities.manage_organizations` and `manage_retention`, and admin shows only the pages they allow) |

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

- **Moving devices** between organizations of one account needs `Device.move` in both;
  the account itself still grants nothing ([devices](devices.md#moving-devices)). A
  device can then report through an adapter or gateway another organization of the
  account owns (a hosted device), and an organization with hosted devices, or in a
  move, can't leave the account or be deleted until they are moved back or archived.
- **Creating an organization** picks a new billing account (named after the
  organization, with an optional contact email) or an existing one. A request that
  names neither gets a new account, so older API clients keep working. A new account
  can start on a plan or a trial ([Billing](billing.md)). Platform administrators are
  not bound by an account's limit.
- **Billing accounts** in the admin app lists accounts with their organizations,
  owners, plan and limit, filtered by plan, usage, payment and trial. An account's page
  edits its name, contact email and notes, sets its **plan**, **trial**,
  **allowances**, **prices** and **billing details**, lists its **invoices** and card
  ([Billing](billing.md)), adds and removes **owners**, moves organizations to another
  account (nothing inside the organization changes) and shows its history: changes,
  owner changes, and organizations joining and leaving, with who and when. Only an
  account with no organizations and no issued invoices can be deleted.
- **Owners** create organizations under their account themselves, while it is below
  its limit, and become each new organization's Organization Admin as an ordinary
  member. In the portal, the user menu shows **Billing accounts** to anyone who owns
  one; an owner who belongs to no organization yet is pointed there from the
  landing page. The page lists the account's organizations with "N of M
  organizations", and a selector picks the account when the person owns several. It
  also shows the plan, usage, prices, invoices and card ([Billing](billing.md)).
  - **New organization** asks for a name and an address. The address follows the
    name until edited; left alone, the server picks a free one, adding a number when
    it is taken. The owner then lands in the new organization.
  - At the limit, **New organization** is disabled and says to ask the platform
    operator to raise it. A request that races past it is refused with the same
    message.
  - An organization the owner is not a member of shows **Not a member** and cannot
    be opened from here: owning the account still grants no access. To get in, the
    owner asks that organization's administrator for an invitation, as anyone
    would.
- Each account change is one audit event with no organization
  (`billing_account.created`, `updated`, `deleted`, `owner_added`, `owner_removed`,
  and `organization.billing_account_changed` on a move).
  `billing_account_assignments` records which account each organization belonged to
  from when to when; deleting an organization closes its period and keeps the row.
  The rollout gave every existing organization an account of its own, with no owners
  and a limit of 1, from the organization's creation.
- **Plans and allowances** ([Billing](billing.md), ADR-035): an account's
  organization limit is its `organizations` allowance, from its override, its plan or
  the default of 1. It is raised or lowered as an override on the account's page; the
  account's `organization_limit` field only reads it.

Admin routes need `PlatformAdministration.manage-organizations`:
`GET/POST admin/billing-accounts`, `GET/PATCH/DELETE admin/billing-accounts/{uuid}`
(409 while it has organizations or issued invoices), `PUT/DELETE admin/billing-accounts/{uuid}/owners/{user_id}`,
and `PUT admin/organizations/{uuid}/billing-account` (204). `POST admin/organizations`
takes `billing_account_uuid` or `new_billing_account: {name, contact_email}` (a new
account also takes `plan_uuid` or `trial`), and the admin organization list carries
`billing_account`. Owners use
`GET billing-accounts` and `POST billing-accounts/{uuid}/organizations` (`name`, and
an optional `slug`; 422 on `billing_account` at the limit). Any account the person
does not own answers 404. `GET me` reports `capabilities.billing_accounts`, and
`capabilities.manage_organizations` for the admin app, which hides Organizations,
Billing accounts, Plans, Invoices, Users, Roles, Activity and Settings → Billing (entries
and routes) from a platform administrator without that permission (spec 028 US1/AC6).
