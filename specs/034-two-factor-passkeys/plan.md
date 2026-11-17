# Implementation Plan: Two-Step Sign-In and Passkeys

**Branch**: `spec/034-two-factor-passkeys` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/034-two-factor-passkeys/spec.md`

## Summary

People get a second step at sign-in and can sign in with passkeys. Platform staff must
use one, and an organization can require it for its members. It is built into the
Laravel API, with nothing outside the deployment:

- Fortify's two-factor actions and code provider handle authenticator codes and
  recovery codes.
- `laravel/passkeys` actions handle WebAuthn.

Both packages' routes are switched off, and our `Authentication` domain controllers
call their actions. Our own sign-in stays in charge:

- After a right password it holds a 5-minute pending sign-in, and the session starts
  only after a valid code.
- Password, code and passkey sign-ins all end in one completion path, which issues the
  per-device kept sign-in from spec 033.
- A middleware sends required people who are not set up to setup.
- Every change emails the person and is written to the activity log.

ADR-048 amends ADR-008.

## Technical Context

**Language/Version**: PHP 8.4 with Laravel 13 (API); TypeScript with React 19
(portal, admin, `packages/auth`, `packages/ui`, `packages/api-client`).

**Primary Dependencies**:

- New: `laravel/fortify` ^1.42, which brings `pragmarx/google2fa` ^9,
  `bacon/bacon-qr-code` ^3 and `laravel/passkeys` ^0.2 (with `web-auth/webauthn-lib`).
- New: `@laravel/passkeys` ^0.4 in `packages/auth`.
- New: shadcn `input-otp` in `packages/ui`.
- Existing: Sanctum, Passport (unchanged), `spatie/laravel-activitylog`,
  `spatie/laravel-permission`.

**Storage**: PostgreSQL 17.

- Three columns on `users`, a new `passkeys` table, and one column on
  `organizations`.
- The pending sign-in lives in the session (database driver).
- Replay entries live in the `database` cache.

**Testing**:

- Pest feature tests on PostgreSQL/TimescaleDB (never SQLite).
- Vitest for `api-client` and the shared auth components.
- Playwright in `apps/portal` and `apps/admin`, using Chrome's virtual authenticator
  for passkeys.

**Target Platform**: the single-node Docker Compose release and the dev stack. Both
the portal and admin app run in current Chrome, Safari, Firefox and Edge, plus the
installed portal (spec 033).

**Project Type**: web application (Laravel API plus two React single-page apps sharing
one session).

**Performance Goals**: the code step adds one request, and a passkey sign-in two. No
measurable cost on other requests: the requirement check uses data already loaded for
the authenticated user and is computed once per request.

**Constraints**:

- No outbound network calls.
- Secrets are never returned after issue and never logged.
- Passkeys only over HTTPS or on `localhost`.
- No Laravel remember token (ADR-047).

**Scale/Scope**:

- 15 new API routes, 1 changed (login) and 1 admin route.
- 1 console command and 4 migrations (three schema, one permission seed).
- 1 new kit component (`InputOTP`), 5 shared sign-in components in `packages/auth`,
  2 new portal pages, plus changes to the sign-in pages, members list, organization
  settings and the admin users list.

## Constitution Check

*Checked before research and again after the design. Both pass.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Everything is in the Laravel API. The runtime, adapters and broker are untouched. |
| II. Immutable versions | Pass. Nothing versioned changes. |
| III. Tenant isolation | Pass. The organization requirement goes through `ResolveOrganizationContext` and `Organization.update`. A person's security settings and passkeys are reachable only by that person (404 otherwise). The member list shows only a boolean. Tests cover: a member of another organization reading or changing the setting; someone else's passkey; an organization administrator without platform rights resetting anyone; and a requirement in organization A applying to a person in A and B but not to a person only in B. |
| IV. Contracts first | Pass. [contracts/auth-api.md](contracts/auth-api.md) is the route contract. The OpenAPI description and `packages/api-client` change in the pull request that adds each route. The admin reset addresses users by integer id (ADR-013). No cross-language data contract changes. |
| V. AI proposes | Pass. No AI tool reads or changes security settings. The assistant and MCP tool lists are unchanged. Agent tokens are not subject to the requirement (FR-032), and agent consent now happens in a session that has passed the second step. |
| VI. Show uncertainty | Pass. Nothing is cached or inferred. Recovery code counts are exact. When passkeys are unavailable, the reason is stated. |
| VII. Durable, idempotent messaging | Pass. Notices are queued mail sent after commit, and a rare duplicate email is harmless. The pending sign-in and replay entries expire on their own. Nothing streams between components. |
| VIII. One design system | Pass. The new kit component `InputOTP` gets a story. The security page uses `Panel`. The passkey list is a `DataTable` in a `Panel`, with `RelativeTime` for **Last used**. Two-step status comes from `statusOf`/`Status`, with new kit statuses `enabled`/`not_set_up`. `check-ui` passes. |
| IX. Verified where it runs | Pass. PostgreSQL CI. Each pull request rebuilds the API family, `portal` and `admin` and runs its [quickstart](quickstart.md) steps, with real Touch ID on `localhost` in addition to the virtual authenticator. |

## Decisions

Full reasoning, with rejected alternatives, is in [research.md](research.md).

| Decision | Chosen | Research |
| --- | --- | --- |
| Identity provider | In-house with Laravel's packages; WorkOS set aside | R1 |
| Codes | Fortify actions and provider, routes off, eight encrypted recovery codes, used codes removed | R2 |
| Sign-in shape | Our `SessionController`, `202` plus a pending sign-in in the session, shared `CompleteSignIn` | R3 |
| Passkeys | `laravel/passkeys` actions behind our routes; `@laravel/passkeys` client | R4 |
| Relying party | `PASSKEYS_RP_ID=${DOMAIN}`, portal and admin origins, dedicated user-handle secret | R5 |
| Replays | ±1 step window; replay key per user and code in the database cache | R6 |
| Enforcement | `RequireTwoStep` middleware on session requests, with an allowlist | R7 |
| Confirmation | `password.confirm` (423), confirm by password or passkey, 15 minutes | R8 |
| Other sign-ins | `EndSignIns` service, extracted from password reset | R9 |
| Lock-out | New platform permission, admin route and console command, never self | R10 |
| Audit | `person.*` events with no organization; organization setting in its organization; queued mail | R11 |
| Guessing | Code attempts share the login limiter; five per pending sign-in; 5-minute expiry | R12 |

## Design

### Sign-in (API, `Domain/Authentication`)

- **`SessionController::store`**:
  - validates the password with `Auth::guard('web')->validate()` instead of
    `attempt()`;
  - if the user has confirmed two-step, it stores `two_step.pending` and returns `202`
    with the allowed `methods`;
  - if the user is required and satisfied only by passkeys, it does the same with
    `methods: ["passkey"]`, so the password alone never starts their session (FR-022);
  - otherwise it calls `CompleteSignIn`.
- **`CompleteSignIn`** takes the code that now follows a successful `attempt()`:
  ending the previous kept sign-in, regenerating the session and issuing the kept
  sign-in. All three sign-in paths use it.
- **`TwoStepChallengeController`** (`POST auth/two-step`):
  1. loads and checks the pending entry (expiry, attempts);
  2. verifies `code` through the bound provider (R6), or `recovery_code` against the
     decrypted list;
  3. on a recovery code, calls the overridden `replaceRecoveryCode()` (removal), logs
     `person.recovery_code_used` and queues the email;
  4. on failure, hits the `login` limiter keys and increments attempts;
  5. on success, clears the entry and calls `CompleteSignIn` with the stored
     `remember`.
- **`PasskeySignInController`**:
  - `GET auth/passkeys/options` returns `GenerateVerificationOptions` and keeps the
    options in the session;
  - `POST auth/passkeys` runs `VerifyPasskey`, then `Passkeys::allowsLogin`, then
    `CompleteSignIn`;
  - it returns `404` when passkeys are unavailable.
- **`ConfirmationController`**: `POST auth/confirm-password`, plus the passkey
  confirm pair; `config/auth.php` sets `password_timeout` to 900.
- **Service provider** (`AuthenticationServiceProvider`, or the existing
  `AppServiceProvider` section):
  - `Fortify::ignoreRoutes()` and `Passkeys::ignoreRoutes()`;
  - `Passkeys::useUserModel(User::class)`;
  - binds `TwoFactorAuthenticationProvider` to `PerUserTwoFactorProvider`;
  - `config/fortify.php` keeps only `features => [twoFactorAuthentication(['confirm' => true])]`;
  - `config/fortify.php`'s `passkeys` block reads `PASSKEYS_RP_ID`, the allowed
    origins from `FRONTEND_URL`/`ADMIN_FRONTEND_URL`, and
    `PASSKEYS_USER_HANDLE_SECRET`; Fortify's provider copies it into `passkeys.*`.
- **`User`**:
  - uses `TwoFactorAuthenticatable` and `PasskeyAuthenticatable`, and implements
    `PasskeyUser`;
  - hides the two secret columns;
  - overrides `replaceRecoveryCode()`;
  - adds `twoStepSatisfied()` and `twoStepRequirement()`, which returns the reasons
    (`platform` and the organizations).
- **Password reset**: `PasswordRecoveryController::reset` calls
  `EndSignIns::everywhere()` and otherwise does not touch two-step (FR-014).
- **Invitation acceptance** is unchanged. The new person is signed in, and
  `RequireTwoStep` sends them to setup when required.

### Security settings (API)

- **`SecurityController`** (`GET me/security`): returns the shape in the contract.
  Passkey availability comes from `PasskeyAvailability`, which reads the front-end
  URLs.
- **`TwoStepController`**:
  - **`store`**: the `EnableTwoFactorAuthentication` action with `force: true`
    (discards unconfirmed setup), then returns the QR SVG, setup key and URL.
  - **`confirm`**: `ConfirmTwoFactorAuthentication`, then
    `EndSignIns::elsewhere()`, the activity entry and the mail. It returns the
    decrypted codes once.
  - **`recoveryCodes`**: `GenerateNewRecoveryCodes`, plus the same side effects.
  - **`destroy`**: refused with `409` while required, otherwise
    `DisableTwoFactorAuthentication` plus the side effects.
- **`PasskeyController`**: options, `StorePasskey` and `DeletePasskey`, scoped to
  `$request->user()->passkeys()`. Each one writes the activity entry and queues the
  mail. Neither ends other sign-ins.
- **`SecurityAudit`**: one place that writes `person.*` activity entries
  (`ActivityCatalogue` gains the labels) and queues `SecurityChanged` notifications.

### Requirement (API)

- **`RequireTwoStep` middleware**:
  - appended to the `api` group and placed after `AuthenticatesRequests` in the
    priority list, so it runs once `auth:sanctum` has resolved a `User` (the way
    `ResumeKeptSignIn` is placed before it);
  - added to Passport's authorize route in `routes/ai.php`, not the whole `web`
    group;
  - skips the allowlisted route names, token-authenticated requests and the `mcp`
    guard;
  - answers `403 two_step_setup_required` when the person is required and not
    satisfied.
- **Organizations**:
  - `OrganizationSecurityController` (`PUT organizations/{organization}/security`),
    behind `ResolveOrganizationContext` and `Organization.update`;
  - refuses with `409` when the actor is not satisfied, and records
    `organization.two_step_required_changed`;
  - the organization context resource returns `two_step_required`;
  - `OrganizationMemberResource` returns `two_step_enabled`.

### Lock-out (API)

- **`ResetTwoStep` action**, used by `Administration\TwoStepResetController` and the
  `auth:reset-two-step` command:
  1. checks: never self, and super administrators only by super administrators;
  2. `DisableTwoFactorAuthentication`;
  3. deletes passkeys;
  4. `EndSignIns::everywhere(…, two_step_reset)`;
  5. the activity entry with reason and source;
  6. the mail.
- **Permission**: `PlatformAdministrationPermission::RESET_TWO_STEP` is added, with a
  migration seeding it for existing platform roles that hold `manage-organizations`.
- **Admin users list**: `PlatformUserController::index` returns `two_step_enabled` and
  `passkey_count`.

### Shared sign-in UI (`packages/auth`, `packages/ui`)

- **`packages/ui`**: `InputOTP` (shadcn `input-otp`), with a story covering six
  digits, an error and disabled. `statusOf` gains `enabled` and `not_set_up`.
- **`packages/auth`**:
  - **`TwoStepChallenge`**: the code input, a **Use a recovery code** toggle, attempts
    left, and **Start again**.
  - **`PasskeySignInButton`**: wraps `@laravel/passkeys`, configured with our routes,
    `credentials: "include"` and the API base URL. It is hidden when the browser or
    deployment cannot use passkeys. It also turns on conditional UI on the email field
    (`autocomplete="email webauthn"`).
  - **`TwoStepSetup`**: the QR code (rendered as an `img` from a data URL, never
    injected HTML), the setup key with copy, code confirmation, and the recovery codes
    panel with copy and download.
  - **`RecoveryCodes`**: shown once, with a "Saved them" confirmation before closing.
- **`packages/api-client`**:
  - `login()` returns `AuthenticatedUser | {twoStepRequired: true}`;
  - new methods for every route in the contract;
  - a `two_step_setup_required` 403 raises a typed `TwoStepSetupRequiredError`, which
    the apps' query clients route to setup;
  - `423` raises `ConfirmationRequiredError`, which opens a confirm dialog and retries.

### Portal (`apps/portal`)

- **Sign-in page** (`App.tsx` sign-in route): handles the `202` by showing
  `TwoStepChallenge`, and adds `PasskeySignInButton`. **Keep me signed in** stays on
  the first step, and its value travels with the pending sign-in.
- **`src/account/SecurityPage.tsx`** at `/account/security`, linked from the user
  menu. It has three panels:
  - **Authenticator app**: status, set up, turn off, required-by note;
  - **Recovery codes**: remaining count, regenerate;
  - **Passkeys**: the table, add, remove, unavailable reason.

  Confirm dialogs use `ConfirmationRequiredError`.
- **Setup-required screen** at `/account/security/setup`: a full-page shell with only
  `TwoStepSetup` and sign-out. It is reached from the global error handler and
  returns to the original location.
- **Organization settings**: a **Security** section with a **Require two-step
  sign-in** switch and the members-without-it count. The members table gets a
  **Two-step** status column.

### Admin (`apps/admin`)

- **`auth/LoginPage.tsx`**: the same `TwoStepChallenge` and `PasskeySignInButton`.
- **Setup required**: links to the portal's `/account/security/setup` through the
  existing `portalUrl` helper. The two apps share the session, so the person comes
  back already set up.
- **`UsersPage`**: two-step and passkey columns, and a **Reset two-step** action
  (dialog with a reason, shown only with the permission and never on yourself).

### Release tooling

- `deploy/release/compose.yml`: `PASSKEYS_RP_ID: ${DOMAIN}` and
  `PASSKEYS_USER_HANDLE_SECRET`.
- `tooling/release/manage.py`: generates the secret once and keeps it across
  upgrades, as it does the push key. A restore refuses a different secret.
- `verify_local.py`: `PASSKEYS_RP_ID=localhost`.
- `environment.example` documents both keys.

### Documentation

- `docs/features/access.md`: **Two-step sign-in**, **Passkeys**, **Required two-step**
  and **Lock-out reset** sections, with the routes.
- `docs/ops/release.md`: the new keys, and that changing `DOMAIN` invalidates passkeys.
- `docs/ops/` lock-out procedure: how an administrator checks identity before a reset.
- `apps/api/resources/help/two-step-sign-in.md`: a help guide that does not name the
  product.
- `docs/dev/gotchas.md`: passkeys need the parent-domain relying party ID, and
  Fortify's replay key is global (R5, R6).
- Release notes: platform staff will be asked to set up two-step at their next
  sign-in.

## Project Structure

### Documentation (this feature)

```text
specs/034-two-factor-passkeys/
├── spec.md
├── plan.md              # This file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── auth-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks, not created by this command
docs/adr/ADR-048-two-step-sign-in-and-passkeys.md
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Authentication/
│   ├── Actions/ResetTwoStep.php
│   ├── Console/ResetTwoStepCommand.php
│   ├── Http/Controllers/{SessionController,TwoStepChallengeController,PasskeySignInController,
│   │                     ConfirmationController,SecurityController,TwoStepController,PasskeyController}.php
│   ├── Http/Middleware/RequireTwoStep.php
│   ├── Notifications/SecurityChanged.php
│   ├── Services/{CompleteSignIn,EndSignIns,PasskeyAvailability,PerUserTwoFactorProvider,SecurityAudit}.php
│   └── routes/api.php
├── app/Domain/Administration/Http/Controllers/{TwoStepResetController,OrganizationSecurityController}.php
├── app/Domain/Authorization/Permissions/PlatformAdministrationPermission.php   # RESET_TWO_STEP
├── app/Domain/Shared/Models/User.php
├── app/Domain/Audit/Services/ActivityCatalogue.php
├── config/{fortify,auth}.php
├── database/migrations/                       # users two-factor columns, passkeys, organizations.two_step_required, permission seed
├── resources/help/two-step-sign-in.md
├── tests/Feature/Domain/Authentication/      # TwoStepSignInTest, TwoStepSettingsTest, SecurityAuditTest,
│                                             # ConfirmationTest, PasskeySignInTest, PasskeyManagementTest,
│                                             # RequireTwoStepTest
├── tests/Feature/Domain/Administration/      # OrganizationTwoStepTest, TwoStepResetTest
├── tests/Feature/Console/ResetTwoStepCommandTest.php
└── tests/Unit/Authentication/PerUserTwoFactorProviderTest.php
packages/ui/src/components/input-otp.tsx (+ story), status additions
packages/auth/src/{TwoStepChallenge,PasskeySignInButton,TwoStepSetup,RecoveryCodes,ConfirmIdentityDialog}.tsx
packages/api-client/src/{index.ts,security.ts}
apps/portal/src/account/{SecurityPage,SetupRequiredPage}.tsx, sign-in in App.tsx, settings Security section, members column
apps/portal/e2e/{two-step,passkeys,two-step-required}.spec.ts
apps/admin/src/auth/LoginPage.tsx, src/pages/UsersPage.tsx, e2e/{two-step-admin,two-step-reset}.spec.ts
deploy/release/{compose.yml,environment.example}, tooling/release/{manage.py,verify_local.py}
```

**Structure Decision**:

- The API work lives in the existing `Authentication` domain, with the two
  administration controllers in `Administration`.
- Sign-in UI shared by both apps goes in `packages/auth`, beside the password-recovery
  and invitation pages it already holds.
- The one new kit component goes in `packages/ui`.

## Delivery

Each pull request is based on `main` and opened after the one it depends on merges.
None is stacked.

1. **Documents**: this folder, ADR-048 and its index row, ADR-008's status line, and
   the roadmap entry.
2. **Authenticator codes: API** (US1 API), after 1:
   - **Contents**:
     - Fortify, its migration and config; `User` changes;
     - `CompleteSignIn`, the pending sign-in, the challenge route and confirmation;
     - `EndSignIns` (refactoring password reset);
     - the setup, confirm, regenerate and turn-off routes and `GET me/security` (codes
       part);
     - `SecurityAudit`, `SecurityChanged`, the activity catalogue entries;
     - OpenAPI, `api-client`, Pest tests, and the access doc sections for codes.
   - **Verify**: rebuild the API family; run quickstart US1 steps 3, 4, 7 and 8
     against the API with `curl` and the TOTP one-liner.
3. **Authenticator codes: portal and admin** (US1 UI), after 2:
   - **Contents**:
     - `InputOTP` and its story;
     - `TwoStepChallenge`, `TwoStepSetup`, `RecoveryCodes`;
     - both sign-in pages, the portal security page and confirm dialog;
     - `two-step.spec.ts` and the admin spec, and the help guide.
   - **Verify**: rebuild `portal` and `admin`; run all of quickstart US1 in the browser
     pane.
4. **Passkeys** (US2), after 3:
   - **Contents**:
     - a short spike confirming the `laravel/passkeys` 0.2 action signatures that
       Fortify allows (R4);
     - passkey config, `PasskeyAvailability`, the sign-in, confirm and management
       routes;
     - `@laravel/passkeys`, `PasskeySignInButton`, the passkeys panel;
     - release tooling keys and the secret;
     - `passkeys.spec.ts` with the virtual authenticator;
     - docs, including release and gotchas.
   - **Verify**: rebuild the API family, `portal` and `admin`; run quickstart US2 with
     the virtual authenticator and with Touch ID on `localhost`.
5. **Required two-step** (US3), after 3:
   - **Contents**:
     - `RequireTwoStep`, platform staff requirement, the organization column, setting
       route and activity entry;
     - the context and member resource fields;
     - the setup-required screen, the organization Security section, the members
       column, admin redirect to setup;
     - `two-step-required.spec.ts`, docs, and release notes for staff.
   - **Verify**: rebuild the API family, `portal` and `admin`; run quickstart US3,
     including the agent and application token check.
6. **Lock-out reset** (US4), after 3 (its users list uses the `enabled` and
   `not_set_up` statuses that pull request 3 adds to the kit):
   - **Contents**:
     - the permission and its seed migration, `ResetTwoStep`, the admin route and
       command;
     - the admin user columns and dialog;
     - tests, the ops lock-out procedure, and access docs.
   - **Verify**: rebuild the API family and `admin`; run quickstart US4.

Pull requests 4, 5 and 6 do not depend on each other. The offline check (SC-004) runs
on `main` after the last of them merges, against everything merged by then.

Pull requests 4 and 5 together close the passkey-only case in FR-022. Whichever
merges second adds the `methods: ["passkey"]` sign-in rule and its test.

Platform staff are required to use two-step from the release that ships pull request
5. Ship pull requests 3 and 5 together, or 5 after 3, so the setup screen exists when
the requirement starts.

## Complexity Tracking

No constitution principle is broken; nothing to justify.
