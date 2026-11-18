# Research: Self Sign-Up

Decisions taken while planning [spec 035](spec.md), with what was rejected and why.
Code references are to `main` at `84137728`.

## R1. The form lives in the portal

**Decision**: `/sign-up` is a public portal route, next to `forgot-password`,
`reset-password` and `accept-invitation` in `apps/portal/src/App.tsx`. The landing
site links to `${portalUrl}/sign-up`.

**Rationale**: The portal already talks to the API with Sanctum's session cookie and
CSRF token (ADR-008), and the sign-up has to end with that session signed in
(FR-011). The landing site is static on GitHub Pages (ADR-021): a form posted from it
would cross sites without the CSRF cookie, could not read the answer, and could not
leave the browser signed in to the portal.

**Alternatives**: A form on the landing page posting to the API with CORS: needs a
second CSRF scheme for an unauthenticated cross-site POST and still ends on a portal
page that has no session. Rejected.

## R2. Nothing is created before the email is confirmed

**Decision**: Submitting stores a `sign_ups` row (name, email, organization name,
password hash, a hashed single-use token). The user, billing account, membership and
organization are created only when the link is opened (FR-008, FR-010).

**Rationale**:

- Alert email and push, billing emails, ticket emails and recipient pickers all skip
  users whose `email_verified_at` is null (`AlertRecipientCheck.php:56`,
  `DeliverPushSummary.php:71`, `DeliverBillingEmail.php:57`, `DeliverTicketEmail.php:52`).
  An unconfirmed Organization Admin would get none of them.
- No unconfirmed account, organization or billing account ever appears in the admin
  app, in counts or in usage. Abuse that never confirms costs a row that is pruned.
- Staff are notified only for real sign-ups (FR-020).
- Login needs no "unconfirmed user" branch in the `users` table.

**Alternatives**:

- Create the user at once with `MustVerifyEmail` and gate features until verified:
  every organization feature would need a verified check, and junk accounts land in
  `users`. Rejected.
- Laravel's built-in verification URL (`id` + `sha1(email)`, signed): not single-use,
  cannot be replaced by **Send it again** (FR-009), and needs the user row to exist.
  The invitation tokens already in the code (random token, stored hashed) are the
  closer model. Rejected.

## R3. Who is signed in by the link

**Decision**: Submitting stores `sign_up.pending = {uuid}` in the visitor's session.
Opening a valid link completes the sign-up. The session holding that pending sign-up,
and only it, is then signed in through `CompleteSignIn`, once: when the confirm call
comes from that browser, or on the waiting page's next status poll (every 3 seconds).
Any other browser gets `signed_in: false` and the sign-in page with the email filled
in (FR-011).

**Rationale**: The waiting session proves that browser typed the password. The link
alone proves only that someone can read the mailbox, which is not enough to start a
session (it would be a magic link, which the platform does not offer). People often
open the email on their phone while the computer waits, so the poll lets the computer
continue.

**Guards**: the automatic sign-in happens at most once per sign-up (`signed_in_at`),
only within 60 minutes of completion, and only when the new person has no confirmed
second step and no passkey (they cannot yet, but the check keeps FR-018 true if that
ever changes). Otherwise the browser is sent to the normal sign-in page.

## R4. Email that already has an account

**Decision**: The submit answers the same `202 {state: "waiting"}` whether or not the
address has an account, after the same password hashing work. For an existing
account it queues `SignUpAccountExists` (links to sign in and reset the password) and
stores nothing. The per-email limiter applies to both (FR-014, SC-004).

**At confirmation**: if an account appeared for the address since submitting (an
invitation accepted, a second sign-up completed), the link answers `409
{code: "account_exists"}`, the sign-up becomes `refused` with reason `account_exists`,
and the page offers sign-in. A sign-up never attaches an organization to an account
it did not create.

## R5. Reusing the owner path for the organization

**Decision**: `SignUps::complete()` runs, in one transaction:

1. `User::forceCreate` (name, lowercased email, the stored hash, `email_verified_at`
   now). `is_super_admin` is mass-assignable on `User`, so request input never
   reaches `create()`.
2. `BillingAccounts::create(['name' => organization name, 'contact_email' => email], $user)`.
3. `BillingAccounts::addOwner($account, $user, $user)`.
4. `OwnerOrganizations::create($user, $account->uuid, $organization name, null)`, which
   locks the account, checks the `organizations` allowance (1 with no plan), picks a
   free slug, ensures the default roles and makes the person Organization Admin.

It then writes `organization.created` (the owner path writes none today, a gap this
fixes for owners too) and `sign_up.completed` to the activity log, with the person as
actor.

**Rationale**: FR-017 asks for exactly what an administrator and an owner would create.
Spec 023's owner path already does steps 3 and 4 with the limit check under a lock.

## R6. Settings storage

**Decision**: A single-row `sign_up_settings` table with a `revision`, read through a
`SignUpSettings` service, like `assistant_settings` and `billing_settings`:
`open` (false), `free_beta` (true), `notify_push` (true), `notify_email` (false),
`daily_limit` (50), `updated_by`, `updated_at`. `GET/PUT /api/v1/admin/sign-up-settings`
for super administrators only, with a 409 on a stale revision.

**Rationale**: The owner switches these at run time without a deploy (SC-007), and
the existing settings pages already have the revision and conflict pattern.

**`free_beta` instead of reading billing state**: There is no billing on/off flag.
"Billing off" on the pilot means no Stripe keys (`Payments::enabled()`) and no plans.
Neither says whether the operator is charging (invoices can be issued without cards).
The beta message is a promise to customers, so staff set it explicitly. On by
default, it shows the beta text (FR-031); off, the operator text (FR-033).

## R7. Abuse protection without an outside service

**Decision**:

- **Limiter `sign-up`**: 5 an hour per address and 3 an hour per `sha256(email)`, with
  the `login` limiter's JSON 429 (`retry_after`). `sign-up-resend`: 1 a minute and 5 an
  hour per sign-up. Confirm: 10 a minute per address. Status poll: 40 a minute per
  session.
- **Form token**: `GET /api/v1/sign-up` returns `form_token`, an encrypted timestamp.
  A submit whose token is missing, unreadable, under 3 seconds old or over 2 hours old
  is refused, as is one with the hidden `website` field filled. Refusals answer `422`
  with a generic message, are stored as `refused` with the reason and no password, and
  are pruned after 30 days.
- **Daily ceiling**: sign-ups started today (UTC), waiting or completed, at or above
  `daily_limit` answer `503 {code: "sign_up_paused"}`; staff are notified once a day
  (a cache key per day).
- **Names**: person and organization names refuse `<`, `>`, `://` and `www.`
  (FR-043), so the notifications and the admin app never carry links.

**Alternatives**: Cloudflare Turnstile or hCaptcha: an outside service, scripts on the
page and a key per deployment, and on-premise deployments may have no internet.
Deferred until abuse is seen. Disposable-email lists: a maintained third-party list;
email confirmation and the ceiling cover the beta.

## R8. Password rules

**Decision**: `Password::defaults()` is set once in `AuthenticationServiceProvider` to
`min:12`, `max:256`, the reset page's rule, and sign-up uses `Password::defaults()`
plus `confirmed`. Invitation acceptance (`min:8` today) is left alone in this feature
and listed as a follow-up, since tightening it changes an existing flow.

`Password::uncompromised()` is not used: it calls an outside service.

## R9. Notifying super administrators

**Decision**:

- `SignUpCompleted` is dispatched after the completing transaction commits.
- `NotifyStaffOfSignUp` queues `DeliverSignUpPush` and `DeliverSignUpEmail`, one per
  super administrator per switched-on channel, on the `alerts` queue, as
  `TicketNotifier` does for support tickets. Each job re-reads the settings and the
  recipient (still a super administrator, verified email) when it runs.
- **Push** goes through `PushFanOut::send` to the person's `PushDevice` rows, when
  their `notification_preferences.push_enabled` is not false. Alert levels and
  organization mutes are not consulted (FR-023). It is retried like an alert push and
  removes gone devices the same way.
- **Email** is a queued `MailMessage` notification, `SignUpCompletedMail`.
- The daily-ceiling notice reuses both jobs with a `ceiling` kind.

The recipients are super administrators only (`users.is_super_admin`); platform
administrators are not notified (spec Assumptions).

## R10. Push to the admin app from the portal's worker

**Decision**: Staff register push devices where everyone does, on the portal's **My
notifications** page; the admin app has no service worker and gets none. The sign-up
push follows a new contract, `contracts/push/v1/sign-up-push.v1.schema.json`
(`kind: "sign_up" | "sign_up_paused"`). Its `url` is absolute, on the admin app's
origin. The portal worker's `toNotification` renders it, and its click handler opens
an absolute URL only when its origin equals the configured admin origin
(`apps/portal/src/lib/admin.ts`), always in a new window; every other URL still goes
through `safePath`.

**Rationale**: One push registry per person (ADR-047), no second worker or VAPID
subscription per origin, and the worker never opens arbitrary origins. An older
worker shows its generic notification for the unknown kind, so nothing is silent.

**Consequence**: A super administrator who is in no organization cannot open **My
notifications** today, because portal settings live under an organization. The admin
settings page says how many push devices the person has (FR-029), and links to the
portal's `/account/notifications` route, which this feature adds as an
organization-free path to the same push panel.

## R11. Where the person lands

**Decision**: Spec 021's guided journey is not built (0 of 77 tasks), so Home
(`/organizations/:uuid/home`) gets a **Connect your first device** panel while the
organization has no devices and the person has `Device.create`, linking to
`/organizations/:uuid/devices/onboard`. It also carries the beta message (FR-016,
FR-032).

## R12. Landing site switch

**Decision**: `apps/docs/hosted-release.json` gets `features.self_sign_up`. When true,
the hero's first action becomes **Start free** (`${portalUrl}/sign-up`, primary) with
**Sign in** beside it, and the header gains **Start free**. The `check-docs` hosted
switch check covers it. The static site cannot read the portal's `open` setting, so
the portal's page says when sign-up is closed (spec Assumptions).

## R13. Pruning

**Decision**: `sign-ups:prune`, daily at 04:10 UTC: deletes `waiting` sign-ups older
than 7 days (FR-013) and `refused` ones older than 30 days, and clears the password
hash of any completed sign-up still holding one. Completed rows stay as the record of
where an organization came from; their `user_id` and `organization_id` null out when
those are deleted.
