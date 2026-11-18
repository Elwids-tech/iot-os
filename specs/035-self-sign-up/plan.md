# Implementation Plan: Self Sign-Up

**Branch**: `spec/035-self-sign-up` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/035-self-sign-up/spec.md`

## Summary

A person signs up in the portal and gets their own organization. The landing site's
**Start free** leads to `/sign-up` in the portal. Submitting stores a waiting sign-up
and emails a single-use link. Opening the link creates, in one transaction:

- the person;
- a billing account they own, with no plan;
- the organization under it, with the person as Organization Admin.

This goes through the same services platform administrators and billing account owners
use today (spec 023). The browser that started the sign-up then signs in through the
normal sign-in path and opens the new organization's Home, where a panel leads to the
first device.

Super administrators are notified of every completed sign-up:

- by web push, through the portal's push registry with a new push contract that opens
  the admin app;
- by email, which ships off.

They control everything on a new **Settings → Sign-up** page in the admin app: open or
closed (closed by default), free beta, the daily ceiling and both channels. A
**Sign-ups** list shows who signed up. Abuse protection is first-party: limits per
address and per email, a server-issued form token with a minimum fill time, a hidden
field, a daily ceiling, and the email confirmation itself.

ADR-049 amends ADR-026, because a person can now become a billing account owner
without platform staff. It also amends ADR-047, because push now carries a platform
notice that is not an alert.

## Technical Context

**Language/Version**: PHP 8.4 with Laravel 13 (API); TypeScript with React 19
(portal, admin, `packages/auth`, `packages/api-client`, `packages/ui`); Astro 5 with
Starlight (`apps/docs`).

**Primary Dependencies**: All existing. Sanctum, Fortify (lowercase usernames only;
its registration feature stays off, see R2), `spatie/laravel-permission`,
`spatie/laravel-activitylog`, `minishlink/web-push` through `PushSender`, and
vite-plugin-pwa for the portal worker. Nothing new is added.

**Storage**: PostgreSQL 17. New tables: `sign_ups` and `sign_up_settings`
([data-model.md](data-model.md)). The pending sign-up lives in the database session.
The day's ceiling notice is a cache key.

**Testing**:

- Pest feature tests on PostgreSQL/TimescaleDB (never SQLite).
- Vitest for `api-client` and the portal worker's notification rendering, against the
  push contract's cases.
- Playwright: portal `e2e/sign-up.spec.ts`, admin `e2e/sign-up-settings.spec.ts` and
  docs `tests/e2e/landing.spec.ts`.

**Target Platform**: the single-node Docker Compose release and the dev stack, in
current Chrome, Safari, Firefox and Edge, plus the installed portal.

**Project Type**: web service and web apps in the monorepo.

**Performance Goals**: The submit answers within the login endpoint's time, since it
does the same bcrypt work. Staff pushes are queued within a minute (SC-003).

**Constraints**:

- No outside services: no captcha, no breached-password check.
- On-premise deployments keep sign-up closed unless staff open it.
- The pilot's free mail tier: confirmation, welcome and optional staff emails count
  toward it, and the daily ceiling bounds them.

**Scale/Scope**: Tens of sign-ups a day in the beta. The ceiling defaults to 50 a day.

## Constitution Check

*Checked before research and again after the design. Both pass.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Everything is in the Laravel API and the React apps. The landing site only links. The runtime, adapters and broker are untouched; a new organization gets no runtime until it adds an adapter, as today. |
| II. Immutable versions | Pass. Nothing versioned changes. |
| III. Tenant isolation | Pass. A sign-up creates a new organization, and its creator becomes a member through the owner path. The new routes are guest routes that touch only the caller's own sign-up: the session's pending sign-up, or the one the token names. The admin list is platform-only. Tests prove: a sign-up never joins an existing organization; a session cannot read or complete another session's sign-up; the waiting browser is the only one signed in; the new owner sees no other organization of any account; and the sign-up list and settings are refused to organization members. |
| IV. Contracts first | Pass. [contracts/sign-up-api.md](contracts/sign-up-api.md) is the route contract. OpenAPI and `packages/api-client` change in the pull request that adds each route. The push body is a new versioned contract, `contracts/push/v1/sign-up-push.v1`, with a schema, a fixture and cases. Its producer (PHP) and consumer (the portal worker) test against them in the same pull request. Users are referred to by integer `user_id`. |
| V. AI proposes | Pass. No AI tool signs anyone up. The assistant is not involved and stays off by default. |
| VI. Show uncertainty | Pass. The admin page says when a channel can't work here: no push key, no mail, or no push device for the caller. The list shows expired sign-ups as **Expired**, not waiting. |
| VII. Durable, idempotent messaging | Pass. Staff notifications are queued after commit, one job per recipient and channel. Each job re-checks its recipient. Gone push devices are removed, not retried. Confirmation is idempotent: a second open answers `410 used`, and the transaction plus a row lock prevent a double organization. `sign_ups` is pruned (R13). |
| VIII. One design system | Pass. Sign-up pages reuse the auth card layout of `packages/auth`, with `TextField`, `Field` and `Alert`. Admin pages use `PageHeader`, `Panel`, `SwitchField`, and `CollectionPage` with `DataTable`. Sign-up states come from `statusOf`/`Status`, with new kit statuses `waiting`, `expired`, `completed` and `refused` (checked against existing names first). Times use `RelativeTime`. No new kit component is planned; if one appears, it gets a story. `check-ui` passes. |
| IX. Verified where it runs | Pass. PostgreSQL CI. Each pull request rebuilds its containers and runs its [quickstart](quickstart.md) steps in the browser pane, with a real push on Chrome. |

## Decisions

The full reasoning, with rejected alternatives, is in [research.md](research.md).

| Decision | Chosen | Research |
| --- | --- | --- |
| Where the form lives | Portal `/sign-up`; the landing site links | R1 |
| When things are created | Only when the link is opened; a `sign_ups` row until then | R2 |
| Who is signed in | Only the session that submitted, once, within 60 minutes | R3 |
| Existing accounts | Same answer, a different email, nothing created | R4 |
| Organization and account | `BillingAccounts::create` + `addOwner` + `OwnerOrganizations::create` | R5 |
| Settings | A single-row `sign_up_settings` with a revision; `free_beta` instead of guessing billing state | R6 |
| Abuse | Limiters, encrypted form token (3 s to 2 h), hidden field, daily ceiling | R7 |
| Passwords | `Password::defaults()` = 12 to 256 characters | R8 |
| Staff notices | Queued per recipient and channel, super administrators only | R9 |
| Staff push | The portal worker renders `sign-up-push.v1` and opens the admin origin only | R10 |
| Landing in the organization | A **Connect your first device** panel on Home (spec 021 is unbuilt) | R11 |
| Landing site | `features.self_sign_up` hosted switch | R12 |
| Pruning | Daily: waiting after 7 days, refused after 30 | R13 |

## Design

### Sign-up flow (API, new `Domain/SignUp`)

The new domain keeps sign-up out of `Authentication`, which is about sign-in, and
`Billing`, which owns accounts. It calls both.

- **`SignUpSettings`** service and `SignUpSetting` model: `current()`, `update($values,
  $revision, $actor)` (409 on a stale revision, activity log).
- **`SignUps`** service:
  - `start($input, $request)`: the checks of R7, then the existing-account branch of
    R4, or create or replace the waiting row, then send `SignUpConfirmation`.
  - `resend($signUp)`.
  - `confirm($token, $session)`: locks the row, checks the state, runs `complete()`,
    and decides `signed_in` by R3.
  - `complete($signUp)`: R5, in one transaction with the row lock, then dispatches
    `SignUpCompleted` after commit.
  - `statusFor($session)`.
- **Controllers**: `SignUpController` with `show`, `store`, `status`, `resend` and
  `confirm`. A `StartSignUpRequest` uses `Password::defaults()` and the name rules.
- **Limiters**: `sign-up`, `sign-up-resend`, `sign-up-confirm` and `sign-up-status`,
  defined in `SignUpServiceProvider::boot` with the `login` limiter's 429 body.
- **`SessionController::store`**: when the credentials fail and a waiting sign-up for
  the email has a matching hash, it answers `403 sign_up_unconfirmed` and puts the
  sign-up in the session. Every other failure answers as today.
- **Mail**: three queued notifications on the `alerts` queue, written so they never
  name the product (the help-guide rule):
  - `SignUpConfirmation`: the link is `${FRONTEND_URL}/sign-up/confirm#token=…`, valid
    for 24 hours;
  - `SignUpAccountExists`: sign-in and reset links;
  - `SignUpWelcome`: the organization, the quickstart, help, and the beta line while
    `free_beta` is on (FR-019).
- **Activity**:
  - `organization.created` from `OwnerOrganizations` (with `source`);
  - `sign_up.completed`;
  - `sign_up_settings.updated`;
  - the catalogue labels for all three.
- **Prune**: the `sign-ups:prune` command, scheduled daily at 04:10 UTC.
- **`Password::defaults()`** is set in `AuthenticationServiceProvider`.

### Staff notifications (API)

- `SignUpCompleted` event, handled by the `NotifyStaffOfSignUp` listener, which queues
  `DeliverSignUpPush` and `DeliverSignUpEmail` per super administrator, per switched-on
  channel.
- The ceiling notice is `SignUpsPaused`, once per UTC day by cache key, through the
  same jobs.
- `SignUpPushPayload` builds `sign-up-push.v1`, and a contract test validates it
  against the schema and fixture.
- The push goes through `PushFanOut::send` with `Topic: sign-up` and a 24-hour TTL.
  Gone devices are removed as in `DeliverAlertPush`. The jobs skip a recipient who is
  no longer a super administrator, has no verified email, or (for push) has turned
  push off.

### Admin API

- `GET/PUT admin/sign-up-settings`: super administrators only, with `abort_unless` as
  in `AssistantSettingsController`.
- `GET admin/sign-ups`: `can:PlatformAdministration.manage-organizations`, paginated,
  filtered and searched.
- `GET me` gains `capabilities.manage_sign_up`.

### Portal (`apps/portal`, `packages/auth`)

- **`packages/auth/src/SignUpPage.tsx`** (shared, like `AcceptInvitationPage`):
  - **Step 1, You**: name, email, password and confirm.
  - **Step 2, Organization**: the organization name.
  - Below the form: the beta or operator message, and links to sign in and back to
    step 1.
  - Hidden `website` field (`aria-hidden`, `tabIndex=-1`, off-screen) and the
    `form_token`.
  - The **closed** state.
  - *Check your email*: the address, **Send it again** (counts down `resend_after`)
    and **Use a different email**. It polls `GET sign-up/status` every 3 seconds
    while visible, then sets the session query and navigates to the organization.
- **`packages/auth/src/ConfirmSignUpPage.tsx`** (`/sign-up/confirm`): posts the
  token, then shows one of:
  - signed in: go to the organization;
  - completed but signed out: *Your organization is ready. Sign in* (email filled
    in);
  - expired or replaced: **Send a new link** when the session has the sign-up, else
    start again;
  - used: sign in;
  - account exists: sign in, or reset the password.
- **`App.tsx`**:
  - public routes `sign-up` and `sign-up/confirm`;
  - the sign-in card's footer gets *New here? Start free* while `open`;
  - `403 sign_up_unconfirmed` on sign-in shows *Confirm your email first* with
    **Send it again**.
- **Home**: `FirstDevicePanel` while the organization has no devices and the person
  has `Device.create`. It links to `devices/onboard` and shows the beta line.
- **Billing account page**: a `free_beta` `Alert` at the top of the Plan panel, and
  *No plan* stays as it is.
- **`/account/notifications`**: the push panels without an organization, for staff
  in no organization (R10).
- **Worker**: `toNotification` handles `sign_up` and `sign_up_paused`. The click
  handler opens an absolute URL only on the admin origin (`lib/admin.ts`), in a new
  window.
- **`api-client`**: `signUp`, `signUpStatus`, `resendSignUp`, `confirmSignUp`,
  `signUpConfig`, `signUpSettings`, `updateSignUpSettings`, `signUps`, and types in
  `src/sign-up.ts`. The 419 retry skips `sign-up` paths, as it skips login.

### Admin (`apps/admin`)

- **Settings → Sign-up** (`SignUpSettingsPage.tsx`), shown with `manage_sign_up`. It
  is built like `BillingSettingsPage`, with a revision, a discard guard and a 409
  conflict. It has two panels:
  - **Sign-up**: **Allow sign-up**, **Free beta**, and the **Daily limit** with
    today's count;
  - **Notify super administrators**: **Push** and **Email** switches. Each says when
    it can't work here, and the page shows the caller's push device count with a link
    to the portal's `/account/notifications`.
- **Sign-ups** (`SignUpsPage.tsx`) in the organizations group, with
  `manage_organizations`: `CollectionPage` + `DataTable` with columns **Person**,
  **Email**, **Organization** (a link once completed), **State** (`Status`) and
  **Started** (`RelativeTime`). It has a state filter and search.

### Landing site (`apps/docs`)

- `hosted-release.json` and its schema gain `features.self_sign_up`.
- With it on:
  - the hero's first action is **Start free** (primary,
    `${docsConfig.portalUrl}/sign-up`), then **Sign in**;
  - the header and the landing footer gain **Start free**;
  - the quickstart's first step says to sign up.
- `landing.spec.ts` and `chrome.spec.ts` cover both values.

### Documentation

- `docs/features/access.md`: a **Signing up** section with the flow, routes, limits
  and settings. **Billing accounts** notes that sign-up creates an account.
- `docs/features/billing.md`: the free beta setting.
- `docs/features/portal-on-phones.md`: the sign-up pages fit a phone.
- `docs/ops/release.md`: sign-up is closed after an upgrade until staff open it, and
  needs working mail.
- `apps/api/resources/help/signing-up.md`: what sign-up creates, confirming the email,
  the beta, and what an owner can do. It never names the product.
- `docs/dev/gotchas.md`: `User::$fillable` includes `is_super_admin`, so never pass
  request input to `create()`.

## Project Structure

### Documentation (this feature)

```text
specs/035-self-sign-up/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── sign-up-api.md
│   └── sign-up-push.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/SignUp/
│   ├── SignUpServiceProvider.php
│   ├── routes/api.php
│   ├── Models/{SignUp,SignUpSetting}.php
│   ├── Services/{SignUps,SignUpSettings,SignUpPushPayload}.php
│   ├── Http/Controllers/{SignUpController,PlatformSignUpController,SignUpSettingsController}.php
│   ├── Http/Requests/{StartSignUpRequest,UpdateSignUpSettingsRequest}.php
│   ├── Http/Resources/{SignUpResource,SignUpSettingsResource}.php
│   ├── Events/SignUpCompleted.php
│   ├── Listeners/NotifyStaffOfSignUp.php
│   ├── Jobs/{DeliverSignUpPush,DeliverSignUpEmail}.php
│   ├── Notifications/{SignUpConfirmation,SignUpAccountExists,SignUpWelcome,SignUpStaffMail}.php
│   └── Console/PruneSignUps.php
├── app/Domain/Billing/Services/OwnerOrganizations.php      # activity entry
├── app/Domain/Authentication/Http/Controllers/SessionController.php  # unconfirmed hint
├── database/migrations/2026_11_25_0001xx_*.php
├── resources/help/signing-up.md
└── tests/Feature/SignUp/*.php
contracts/push/v1/sign-up-push.v1.{schema,fixture,cases}.json
packages/api-client/src/{index.ts,sign-up.ts}
packages/auth/src/{SignUpPage,ConfirmSignUpPage}.tsx
apps/portal/src/{App.tsx,sw.ts,pwa/notification.ts,home/FirstDevicePanel.tsx,billing/BillingAccountsPage.tsx}
apps/portal/e2e/sign-up.spec.ts
apps/admin/src/pages/{SignUpSettingsPage,SignUpsPage}.tsx, src/App.tsx, src/layout/AdminLayout.tsx, src/lib/access.ts
apps/admin/e2e/sign-up-settings.spec.ts
apps/docs/{hosted-release.json,schemas/hosted-release.schema.json,src/pages/index.astro,src/components/...}
docs/adr/ADR-049-self-sign-up.md, docs/features/{access,billing}.md
```

**Structure Decision**: The existing monorepo layout. A new `SignUp` domain sits
beside `Authentication` and `Billing` and calls their services.

## Delivery

Each pull request is based on `main` and opened after the one it depends on merges.
None is stacked.

1. **Documents**: this folder, ADR-049 and its index row, the status lines of ADR-026
   and ADR-047, and the roadmap entry.
2. **Sign-up API** (US1, US4 API), after 1:
   - **Contents**:
     - both tables;
     - the settings service and admin settings routes;
     - the public routes, limiters, form token, ceiling, mail, completion and prune;
     - the sign-in hint, `Password::defaults()` and the activity entries;
     - `GET admin/sign-ups` and `capabilities.manage_sign_up`;
     - OpenAPI, `api-client`, Pest tests, and the access doc's **Signing up** section.
   - **Verify**: rebuild the API family; run quickstart 1, 2 (by `curl`), 3–5, 8–10
     against the API with the log mailer.
3. **Staff notifications** (US2), after 2:
   - **Contents**:
     - the event, listener and jobs;
     - `sign-up-push.v1` with schema, fixture and cases;
     - the payload and its contract test;
     - the portal worker's rendering and admin-origin click, with its Vitest cases;
     - `/account/notifications`.
   - **Verify**: rebuild the API family and `portal`; quickstart 6, 7 and the paused
     push, with a real push in Chrome.
4. **Portal sign-up pages** (US1, US3 UI), after 2, alongside 3:
   - **Contents**:
     - `SignUpPage`, `ConfirmSignUpPage` and the routes;
     - the sign-in link and the unconfirmed state;
     - `FirstDevicePanel`, the billing beta notice;
     - `e2e/sign-up.spec.ts`;
     - the help guide and the phones doc row.
   - **Verify**: rebuild `portal`; quickstart 1, 3, 4, 5 and 11 in the browser pane,
     at desktop and phone width.
5. **Admin sign-up pages** (US4 UI), after 3:
   - **Contents**: **Settings → Sign-up**, **Sign-ups**, navigation and access, and
     `e2e/sign-up-settings.spec.ts`.
   - **Verify**: rebuild `admin`; quickstart 2, 5, 7 and 9.
6. **Landing call to action**, after 4:
   - **Contents**:
     - the hosted switch and the hero, header and footer links;
     - the quickstart step and landing tests;
     - the release doc note.
   - **Verify**: `pnpm --filter @iot-os/docs build` with the switch on and off, and
     the landing page in the browser pane.

Nothing reaches the pilot without the owner's approval. When it ships:

- sign-up stays closed until a super administrator opens it in the admin app;
- `features.self_sign_up` is turned on in `hosted-release.json` only after the release
  with pull request 4 is live on the pilot, and `DOCS_HOSTED_REF` moves with it.

## Complexity Tracking

No constitution principle is broken. ADR-026 (who may create organizations) and
ADR-047 (push carries only alerts) change through ADR-049.
