# Research: Two-Step Sign-In and Passkeys

Decisions made while planning [spec 034](spec.md). Package facts were read from
source on 2026-11-16: `laravel/fortify` v1.42.0 (2026-11-10), `laravel/passkeys`
(the PHP server package, repository `laravel/passkeys-server`) v0.3.0 (2026-11-10),
and `@laravel/passkeys` (the browser client) v0.4.1.

## R1. In-house sign-in, not a hosted identity service

- **Decision**: build two-step sign-in and passkeys inside the Laravel API with
  Laravel's first-party packages.
- **Rationale**:
  - Single-VM and on-premise deployments (ADR-006) must sign people in with no
    internet connection.
  - Identity data stays in the deployment's region.
  - Agent and partner connections (ADR-018, ADR-033) and application grants (ADR-032)
    stay as they are.
- **Alternatives considered**: WorkOS AuthKit with `laravel/workos` v0.6, evaluated
  on 2026-11-16 and set aside:
  - it is a US-hosted service and cannot be self-hosted;
  - the package is a thin starter-kit helper that keeps a second copy of users and
    organizations;
  - its session check calls WorkOS on token refresh, which conflicts with the 30-day
    per-device kept sign-in (ADR-047).

  Corporate SSO through WorkOS stays possible later as an optional connector.

## R2. Authenticator codes and recovery codes: Fortify's two-factor pieces

- **Decision**: install `laravel/fortify` ^1.42 and use its two-factor pieces with its
  routes switched off (`Fortify::ignoreRoutes()`). Our controllers call:
  - Fortify's actions: `EnableTwoFactorAuthentication`,
    `ConfirmTwoFactorAuthentication`, `GenerateNewRecoveryCodes` and
    `DisableTwoFactorAuthentication`;
  - its `TwoFactorAuthenticationProvider`, which verifies codes through
    `pragmarx/google2fa`.

  `User` uses `TwoFactorAuthenticatable`. Fortify's migration adds
  `two_factor_secret`, `two_factor_recovery_codes` and `two_factor_confirmed_at` to
  `users`. Two-factor is enabled with `confirm => true`, so two-step only counts once
  confirmed (FR-002).
- **Recovery codes**:
  - Fortify generates eight per set, so the spec now says eight.
  - They are encrypted with the application key. They are not hashed, because the
    setup secret must be decryptable anyway. Anyone holding both the database and the
    key can already compute codes, and anyone holding only the database can read
    neither.
  - Fortify's `replaceRecoveryCode()` swaps a used code for a fresh one that the person
    never sees. `User` overrides it to remove the used code instead, so the count goes
    down and the person is told how many remain (FR-009).
  - We never register Fortify's "show recovery codes" route. Codes appear only in the
    responses that create them (FR-003, FR-006).
- **Alternatives considered**:
  - `pragmarx/google2fa` used directly with our own code. Rejected: it duplicates
    tested first-party actions and events.
  - Hashed recovery codes in a table of our own. Rejected: it forks Fortify's storage
    for no real gain, as explained above.

## R3. Fitting the second step into our own sign-in

- **Decision**: keep `SessionController` as the only password sign-in endpoint.
  - When the password is right and the person has confirmed two-step, it creates no
    session. It stores a pending sign-in in the session (`two_step.pending`: user id,
    the **Keep me signed in** choice, expiry 5 minutes, attempts) and answers
    `202 {"two_step_required": true}`.
  - `POST auth/two-step` takes `code` or `recovery_code` and finishes the sign-in.
  - One `CompleteSignIn` service is shared by the password, two-step and passkey
    paths. It regenerates the session, logs in on the `web` guard, issues the kept
    sign-in (spec 033) when asked, and returns the user.
- **Rationale**:
  - Our login has its own throttle messages and kept-sign-in handling, and the portal
    and admin clients already speak its JSON.
  - Fortify's login pipeline (`RedirectIfTwoFactorAuthenticatable`,
    `PrepareAuthenticatedSession`) logs in with Laravel's remember token, which
    ADR-047 rejected.
- **Alternatives considered**: Fortify's `/login` and `/two-factor-challenge` routes.
  Rejected: they replace our controller and bring back the remember token.

## R4. Passkeys: `laravel/passkeys` actions behind our routes

- **Decision**: use the `laravel/passkeys` server package with its routes switched off
  (`Passkeys::ignoreRoutes()`). Our controllers call its actions:
  - `GenerateRegistrationOptions` and `StorePasskey` to add a passkey;
  - `GenerateVerificationOptions` and `VerifyPasskey` to sign in or confirm;
  - `DeletePasskey` to remove one.

  The package's `passkeys` table stores name, credential id, credential JSON,
  `last_used_at` and timestamps. A passkey sign-in ends in `CompleteSignIn` (R3), not
  the package's `$guard->login($user, $remember)`.

  Browsers use `@laravel/passkeys` 0.4 with its routes pointed at our API, plus
  `credentials: "include"` and its Sanctum `XSRF-TOKEN` header support.
- **Versions** (resolved in pull request 2, 2026-11-17): `laravel/fortify` 1.43.0,
  which brings `laravel/passkeys` 0.3.0, `pragmarx/google2fa` 9.1.0,
  `bacon/bacon-qr-code` 3.1.1 and `web-auth/webauthn-lib` 5.3.12. No existing package
  changed version.
  - Fortify 1.43 allows `laravel/passkeys` 0.3, not only 0.2. Both are before 1.0.
  - We wrap them behind our own routes and contract, pin the version Composer
    resolves, and upgrade when Fortify allows.
  - Fortify's service provider already calls `Passkeys::ignoreRoutes()`, sets the user
    model, and overwrites `passkeys.*` config at register time from
    `fortify.passkeys.*` (relying party ID, allowed origins, user-handle secret) and
    `fortify.guard`. Pull request 4 sets these under `fortify.passkeys` in
    `config/fortify.php`, not in a separate `config/passkeys.php`.
  - The PR 4 spike confirms the 0.3 action signatures.
- **Alternatives considered**:
  - `spatie/laravel-passkeys`. Rejected: it is built around Livewire and is not
    first-party.
  - `web-auth/webauthn-lib` directly. Rejected: much more ceremony code that the
    package already tests.

## R5. Relying party, origins and when passkeys are offered

- **Decision**:
  - **Relying party ID**: `PASSKEYS_RP_ID`, set by release tooling to `${DOMAIN}`, the
    parent of `app.`, `admin.` and `api.`. It is `localhost` on the dev stack.
  - **Allowed origins**: `FRONTEND_URL` and `ADMIN_FRONTEND_URL`.
  - **When passkeys are offered**: only when both front-end URLs are `https`, or their
    host is `localhost`. `GET me/security` reports this with a reason, and the sign-in
    page hides the button otherwise (FR-018).
  - **User handle secret**: `PASSKEYS_USER_HANDLE_SECRET`, generated once by release
    tooling and kept across upgrades like the push key (ADR-047), so rotating
    `APP_KEY` does not break passkeys.
- **Rationale**:
  - The package defaults the ID to `APP_URL`'s host (`api.${DOMAIN}`). Browsers would
    refuse that ID on `app.${DOMAIN}`.
  - The parent domain covers both apps, so one passkey works in the portal and the
    admin app.
- **Consequence**: changing `DOMAIN` makes existing passkeys stop working. The
  operator docs say so, and people fall back to password and code.

## R6. Code window and replays

- **Decision**:
  - Keep google2fa's default window of 1, which accepts the previous, current and next
    30-second step (FR-008).
  - Bind our own subclass of Fortify's provider (`PerUserTwoFactorProvider`) whose
    replay cache key is a hash of the person's secret and the code, so a used code is
    refused for that person for the rest of its window. Fortify's own key is the code
    alone. Keying by secret rather than user id keeps Fortify's `verify($secret, $code)`
    signature, so its confirm action gets the same protection with no extra method.
  - Concurrent submissions are serialized with a cache lock per person, and recovery
    codes are matched under a row lock, so one code never signs in twice (SC-007).
  - The cache store is `database` in every profile, so all Octane workers see the same
    replay entries (ADR-038).
- **Alternatives considered**: Fortify's provider as is. Rejected: two people who
  happen to get the same six digits within one window would refuse each other's code.

## R7. Enforcing "required"

- **Decision**: add `RequireTwoStep` middleware to the `api` group, placed after
  authentication in the middleware priority list (as `ResumeKeptSignIn` is), and to
  Passport's authorize route in `routes/ai.php`.
  - It applies only to people authenticated by a session (the `web` guard through
    Sanctum's stateful check).
  - A person is **required** when they are a super administrator, have platform
    administration access, or belong to an organization with `two_step_required`.
  - They are **satisfied** with confirmed two-step, or with at least one passkey while
    passkeys are available on the deployment.
  - A required person who is not satisfied gets
    `403 {"code": "two_step_setup_required"}` on every route except `me`,
    `me/security`, `me/two-step*`, `me/passkeys*`, `auth/confirm-password`,
    `auth/confirm-passkey*` and `auth/logout`.
  - Clients react to that code by opening setup.
  - **A passkey counts only when it is used.** A required person whose only second
    step is a passkey gets `202` with `methods: ["passkey"]` after the password, and
    finishes by signing in with the passkey. Otherwise owning a passkey would let the
    password alone through.
- **Rationale**: one check covers every way in, including invitation acceptance and
  agent consent, without touching each controller.
- **Not affected**: `mcp` guard tokens (agents), partner tokens and integration
  application tokens, as FR-032 requires.

## R8. Confirming the password in a single-page app

- **Decision**:
  - Use Laravel's `password.confirm` middleware (`RequirePassword`), which answers
    `423` to JSON requests.
  - Add `POST auth/confirm-password`, which checks the password and calls
    `$request->session()->passwordConfirmed()`.
  - A passkey can confirm too, through `GenerateVerificationOptions` and
    `VerifyPasskey` on `POST auth/confirm-passkey`.
  - `auth.password_timeout` drops to 900 seconds.
- **Applies to**: starting two-step setup, regenerating codes, turning two-step off,
  and adding or removing passkeys.

## R9. Ending other sign-ins

- **Decision**: extract the code in `PasswordRecoveryController::reset` that deletes
  sessions and ends kept sign-ins into an `EndSignIns` service with two methods:
  - `everywhere($user, $reason)` for the password reset and the administrator reset;
  - `elsewhere($user, $request, $reason)`, which keeps the current session id and kept
    sign-in.

  `KeptSignIn` gains the end reasons `two_step_changed` and `two_step_reset`.
- **Applies to**: turning two-step on or off, regenerating codes and the administrator
  reset (FR-013). Adding or removing a passkey does not end other sign-ins.

## R10. Lock-out reset

- **Decision**: add a `PlatformAdministrationPermission::RESET_TWO_STEP`
  (`PlatformAdministration.reset-two-step`). Super administrators hold it implicitly.
  - `POST admin/users/{user}/two-step/reset` with a reason.
  - Only super administrators may reset a super administrator, and nobody may reset
    themselves.
  - `php artisan auth:reset-two-step {email} --reason=` does the same from the server.
  - Both run `ResetTwoStep`:
    1. disable two-step (Fortify action);
    2. delete passkeys;
    3. end every sign-in;
    4. write the activity entry;
    5. queue the email.
- **Identity check**: a human process, written in `docs/ops/`. The platform records
  who did it and why.

## R11. Notices and the activity log

- **Decision**:
  - **Activity events** (ADR-028), with the person as subject and no organization:
    `person.two_step_enabled`, `person.two_step_disabled`,
    `person.recovery_codes_regenerated`, `person.recovery_code_used`,
    `person.passkey_added`, `person.passkey_removed`, `person.two_step_reset`.
  - **Organization setting**: `organization.two_step_required_changed` belongs to the
    organization.
  - **Server resets**: no causer, with `properties.source = "console"`.
  - **No secrets**: no code, secret, credential or credential id is logged. Passkeys
    are named by their label.
  - **Email**: one queued mail notification, `SecurityChanged`, with a variant per
    event. It is sent after commit, and a rare duplicate is harmless.

## R12. Slowing down guessing

- **Decision**:
  - `POST auth/two-step` uses the same `login` limiter as the password step. When a
    request carries no email, the limiter takes it from the pending sign-in, so every
    code attempt counts against the same account-and-address key (5 a minute) and
    address key (30 a minute) as passwords. Like the password step, every attempt
    counts, not only wrong ones: a password and four codes use up a minute's tries.
  - The pending sign-in also counts its own attempts and is discarded after five, or
    after 5 minutes (FR-010, FR-011).
  - Passkey sign-in has its own limiter of 6 a minute per address, the package
    default.
