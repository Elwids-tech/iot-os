---

description: "Tasks for spec 034, two-step sign-in and passkeys"
---

# Tasks: Two-Step Sign-In and Passkeys

**Input**: Design documents from `/specs/034-two-factor-passkeys/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/auth-api.md](contracts/auth-api.md),
[quickstart.md](quickstart.md)

**Tests**: included, because the constitution requires them:

- isolation tests for tenant data (III);
- the OpenAPI drift check (IV);
- verification in the rebuilt stack (IX).

API tests run on PostgreSQL only. In a worktree, follow the worktree API test recipe:
copy `vendor`, run `composer install`, and use a throwaway `APP_KEY`.

**Organization**: phases follow the six pull requests in the plan's **Delivery**
section. Each pull request is based on `main`, opened after the one it depends on
merges, and never stacked. Story labels map tasks to the spec's user stories (US1 to
US4).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1 to US4 from [spec.md](spec.md).
- Paths are from the repository root.
- Every verification task takes the stack rebuild lock (`.local/stack-rebuild.lock`)
  before any `docker compose` build and removes it afterwards.

---

## Phase 1: Documents (pull request 1)

**Purpose**: merge the spec, plan, tasks and ADR before any code. Merging accepts the
plan.

- [x] T001 Run `/speckit-analyze` on `specs/034-two-factor-passkeys/` and fix every finding in `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/auth-api.md`, `quickstart.md` and `tasks.md`
- [x] T002 Confirm `ADR-048` is still free: list `docs/adr/` on `main` and on every local and remote branch (`git for-each-ref`, then `git ls-tree`). If it is taken, renumber `docs/adr/ADR-048-two-step-sign-in-and-passkeys.md` and every reference in `docs/adr/README.md`, `docs/adr/ADR-008-laravel-sanctum-authentication.md`, `docs/roadmap.md` and `specs/034-two-factor-passkeys/`
- [x] T003 Rebase branch `spec/034-two-factor-passkeys` onto the latest `origin/main`, resolve `docs/roadmap.md` and `docs/adr/README.md` (check `git diff --diff-filter=U`), and commit only `specs/034-two-factor-passkeys/`, `docs/adr/ADR-048-two-step-sign-in-and-passkeys.md`, `docs/adr/README.md`, `docs/adr/ADR-008-laravel-sanctum-authentication.md` and `docs/roadmap.md`
- [x] T004 Push with `rtk proxy git push`, confirm with `git ls-remote`, and open the documents pull request

**Checkpoint**: documents merged; pull request 2 may start.

---

## Phase 2: Foundational (pull request 2, first half)

**Purpose**: the packages, schema and shared services every story needs. No story
works until this phase is done.

- [x] T005 Add `laravel/fortify` ^1.42 to `apps/api/composer.json` and run `composer update laravel/fortify --with-dependencies`. Record the `laravel/passkeys`, `pragmarx/google2fa` and `bacon/bacon-qr-code` versions Composer resolves in `specs/034-two-factor-passkeys/research.md` R4
- [x] T006 Publish Fortify's two-factor migration as `apps/api/database/migrations/2026_11_23_000100_add_two_factor_columns_to_users.php` (dated after the latest migration on `main`), adding `two_factor_secret` (text, null), `two_factor_recovery_codes` (text, null) and `two_factor_confirmed_at` (timestamp, null) to `users`, with a working `down()`
- [x] T007 Create `apps/api/config/fortify.php` with only `'features' => [Features::twoFactorAuthentication(['confirm' => true])]` (Fortify's routes are off, so our routes apply `password.confirm` themselves), and set `password_timeout` to 900 in `apps/api/config/auth.php`
- [x] T008 In `apps/api/app/Providers/AppServiceProvider.php` (or a new `apps/api/app/Domain/Authentication/AuthenticationServiceProvider.php` registered in `apps/api/bootstrap/providers.php`): call `Fortify::ignoreRoutes()`, and bind `Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider` to `App\Domain\Authentication\Services\PerUserTwoFactorProvider`
- [x] T009 [P] Create `apps/api/app/Domain/Authentication/Services/PerUserTwoFactorProvider.php`. It extends Fortify's `TwoFactorAuthenticationProvider` and overrides `verify($secret, $code)` to key the replay cache by a hash of the secret and the code (research R6), so Fortify's confirm action is covered too. The window stays at 1. Unit test in `apps/api/tests/Unit/Authentication/PerUserTwoFactorProviderTest.php`: the same code is refused the second time for one secret and accepted for another, and the container binds the subclass
- [x] T010 Update `apps/api/app/Domain/Shared/Models/User.php`:
  - use `Laravel\Fortify\TwoFactorAuthenticatable`;
  - add `two_factor_secret` and `two_factor_recovery_codes` to `$hidden`;
  - cast `two_factor_confirmed_at` to datetime;
  - override `replaceRecoveryCode($code)` to remove the used code from the encrypted list instead of replacing it;
  - add `remainingRecoveryCodes(): int` and `twoStepSatisfied(): bool` (confirmed two-step only for now; passkeys join in T045)
- [x] T011 Extract `apps/api/app/Domain/Authentication/Services/CompleteSignIn.php` from `SessionController::store`. It takes a `User`, the `remember` flag and the request, then ends the previous kept sign-in, regenerates the session, logs in on the `web` guard and issues the kept sign-in, as `apps/api/app/Domain/Authentication/Http/Controllers/SessionController.php` does today. `SessionController::store` calls it, with no behaviour change, and `apps/api/tests/Feature/Domain/Authentication/SessionAuthenticationTest.php` and `KeptSignInTest.php` still pass
- [x] T012 Extract `apps/api/app/Domain/Authentication/Services/EndSignIns.php` from `PasswordRecoveryController::reset`:
  - `everywhere(User $user, string $reason)`: the person's database sessions and live kept sign-ins, and the current `web` guard only when its user is that person (an administrator running a reset stays signed in);
  - `elsewhere(User $user, Request $request, string $reason)`: keeps the current session id and the current kept sign-in.

  Switch `apps/api/app/Domain/Authentication/Http/Controllers/PasswordRecoveryController.php` to `everywhere(…, KeptSignIn::PASSWORD_RESET)`. Push devices of the ended sign-ins are removed by `EndSignIns` too; agent revocation and the remember-token rotation stay in the controller. `PasswordRecoveryTest.php` still passes
- [x] T013 [P] Add the end reasons `TWO_STEP_CHANGED = 'two_step_changed'` and `TWO_STEP_RESET = 'two_step_reset'` to `apps/api/app/Domain/Authentication/Models/KeptSignIn.php`
- [x] T014 [P] Create `apps/api/app/Domain/Authentication/Notifications/SecurityChanged.php`, a queued mail notification sent after commit, with one variant per event: two-step on, two-step off, recovery codes regenerated, recovery code used (with remaining count), passkey added (name), passkey removed (name), and reset by an administrator or the server. The text never contains codes, secrets or credential ids
- [x] T015 [P] Add `person.two_step_enabled`, `person.two_step_disabled`, `person.recovery_codes_regenerated`, `person.recovery_code_used`, `person.passkey_added`, `person.passkey_removed`, `person.two_step_reset` and `organization.two_step_required_changed` with labels to `apps/api/app/Domain/Audit/Services/ActivityCatalogue.php`
- [x] T016 Create `apps/api/app/Domain/Authentication/Services/SecurityAudit.php`, which records one `person.*` activity entry (subject the person by integer id, no organization, causer the actor or none, properties as in `data-model.md`) and queues `SecurityChanged`. Covered in `apps/api/tests/Feature/Domain/Authentication/TwoStepSettingsTest.php` and `TwoStepSignInTest.php`: each entry has no `organization_id`, the person as subject and causer, no secret in its properties, and every mail variant is free of codes and secrets
- [x] T017 Create `apps/api/app/Domain/Authentication/Http/Controllers/ConfirmationController.php` with `POST auth/confirm-password` (validates `password`, calls `$request->session()->passwordConfirmed()`, returns `204`, or `422` for a wrong password), and register it in `apps/api/app/Domain/Authentication/routes/api.php` under `auth:sanctum`. Confirm that Laravel's `password.confirm` middleware returns `423` for JSON requests and again after 15 minutes, with a test in `apps/api/tests/Feature/Domain/Authentication/TwoStepSettingsTest.php`

**Checkpoint**: Fortify is wired, the schema exists, and sign-in still behaves exactly
as before.

---

## Phase 3: User Story 1, authenticator codes in the API (Priority: P1), pull request 2, second half

**Goal**: people can turn on two-step sign-in, and sign-in asks for a code before any
session exists (FR-001 to FR-015).

**Independent Test**: with `curl` and the TOTP one-liner from `quickstart.md`:

1. set up and confirm two-step;
2. sign in and get `202`;
3. finish with a code, then with a recovery code;
4. check that a reused code, five wrong codes and an expired pending sign-in are
   refused.

### Tests for User Story 1 (API)

- [x] T018 [P] [US1] Write `apps/api/tests/Feature/Domain/Authentication/TwoStepSignInTest.php` covering:
  - `202 {"two_step_required": true, "expires_in": 300, "methods": ["code", "recovery_code"]}` and no authenticated session after a right password;
  - `me` returns `401` while pending, and `oauth/authorize` treats the pending person as a guest (the agent-consent path, SC-002);
  - a valid code signs in, and **Keep me signed in** issues the kept sign-in cookie only when `remember` was set at the password step;
  - a recovery code signs in once, returns `recovery_codes_remaining`, and fails on reuse;
  - a code reused within its window is refused;
  - five wrong codes discard the pending sign-in;
  - after 5 minutes (`travel(301)->seconds()`), `422 pending`;
  - wrong codes count toward the `login` limiter;
  - a password reset does not turn two-step off (FR-014)
- [x] T019 [P] [US1] Write `apps/api/tests/Feature/Domain/Authentication/TwoStepSettingsTest.php` covering:
  - setup needs confirmation (`423` without it);
  - setup returns `qr_svg`, `setup_key` and `otpauth_url`;
  - an unconfirmed setup is replaced on restart (FR-002);
  - confirm returns eight codes once, and they never appear in `GET me/security`;
  - confirm, regenerate and turn-off end the person's other sessions and kept sign-ins (`two_step_changed`) but keep the current one;
  - every action writes its activity entry and queues `SecurityChanged`;
  - `409` when setup is started while two-step is already on

### Implementation for User Story 1 (API)

- [x] T020 [US1] Change `SessionController::store` in `apps/api/app/Domain/Authentication/Http/Controllers/SessionController.php` to check the password with `Auth::guard('web')->validate()` and the `User` provider:
  - **two-step confirmed**: store `two_step.pending` = `{user_id, remember, methods, expires_at: now()+5 minutes, attempts: 0}` in the session, replacing any earlier one, and return `202 {"two_step_required": true, "expires_in": 300, "methods": ["code", "recovery_code"]}`;
  - **otherwise**: call `CompleteSignIn`.

  Keep the wrong-password message and limiter as they are
- [x] T021 [US1] Create `apps/api/app/Domain/Authentication/Http/Controllers/TwoStepChallengeController.php` (`POST auth/two-step`, `throttle:login`, guest) with a form request `apps/api/app/Domain/Authentication/Http/Requests/TwoStepChallengeRequest.php` that requires exactly one of `code` (six digits) or `recovery_code`:
  1. load the pending entry; if it is missing or past `expires_at`, `422 {"errors": {"pending": [...]}}`;
  2. verify through `PerUserTwoFactorProvider::verifyFor`, or match the recovery code with `hash_equals` against `recoveryCodes()`;
  3. on a recovery code, call `replaceRecoveryCode()` and `SecurityAudit` (`person.recovery_code_used`, `remaining`);
  4. on failure, increment `attempts`. The route's `throttle:login` counts every attempt against the password step's keys: the `login` limiter in `apps/api/app/Providers/AppServiceProvider.php` takes the email from `two_step.pending.email` when the request carries none; at five, forget the entry; return `422` with `attempts_left`;
  5. on success, forget the entry and call `CompleteSignIn` with the stored `remember`, returning the user, plus `recovery_codes_remaining` when a recovery code was used
- [x] T022 [US1] Create `apps/api/app/Domain/Authentication/Http/Controllers/TwoStepController.php` with:
  - **`store`** (`POST me/two-step`, `password.confirm`): `409` if confirmed; otherwise `EnableTwoFactorAuthentication($user, force: true)`, returning `qr_svg` (`twoFactorQrCodeSvg()`), `setup_key` (the decrypted secret, grouped in fours) and `otpauth_url`;
  - **`confirm`** (`POST me/two-step/confirm`): `ConfirmTwoFactorAuthentication` through the bound provider, then `EndSignIns::elsewhere(…, KeptSignIn::TWO_STEP_CHANGED)`, then `SecurityAudit` (`person.two_step_enabled`); returns `{"recovery_codes": [...]}`;
  - **`recoveryCodes`** (`POST me/two-step/recovery-codes`, `password.confirm`): `GenerateNewRecoveryCodes`, `EndSignIns::elsewhere`, `SecurityAudit`, returning the new codes;
  - **`destroy`** (`DELETE me/two-step`, `password.confirm`): `DisableTwoFactorAuthentication`, `EndSignIns::elsewhere`, `SecurityAudit`, `204`. The `409 two_step_required` guard is added in T062
- [x] T023 [US1] Create `apps/api/app/Domain/Authentication/Http/Controllers/SecurityController.php` (`GET me/security`) returning the `two_step` block from `contracts/auth-api.md`. For now `required` is false, `required_by` is `[]` and `satisfied` is `twoStepSatisfied()`. The `passkeys` block is left out until T048 adds it (never a false `not_https`). Register every route from T020 to T023 in `apps/api/app/Domain/Authentication/routes/api.php` with the names in the contract
- [x] T024 [P] [US1] Add the routes, schemas (`TwoStepRequired`, `TwoStepChallenge`, `SecuritySettings`, `TwoStepSetup`, `RecoveryCodes`), the `202` login response and the `423` response to the OpenAPI supplements in `contracts/openapi/supplements/`, regenerate `contracts/openapi/openapi.json`, and pass the drift check
- [x] T025 [P] [US1] In `packages/api-client/src/security.ts` (new) and `packages/api-client/src/index.ts`:
  - `login()` still returns `AuthenticatedUser`, and throws a typed `TwoStepRequiredError` (`expiresIn`, `methods`) on `202`, so the apps keep type-checking until pull request 3 handles it;
  - add `twoStepChallenge({ code } | { recoveryCode })`, `confirmPassword(password)`, `security()`, `startTwoStep()`, `confirmTwoStep(code)`, `regenerateRecoveryCodes()` and `disableTwoStep()` on `ApiClient`, with the types in `security.ts`;
  - map `423` to a typed `ConfirmationRequiredError`.

  Vitest in `packages/api-client/src/security.test.ts`
- [x] T026 [P] [US1] Add a **Two-step sign-in** section to `docs/features/access.md`, after **Keep me signed in**: setup, codes, recovery codes, the pending step, ending other sign-ins, password reset, and the routes
- [x] T027 [US1] Verify pull request 2:
  - run the full API suite on PostgreSQL and `pnpm --filter @iot-os/api-client test`;
  - rebuild the API family (`api`, workers, scheduler) with the command in `AGENTS.md`;
  - run `quickstart.md` US1 steps 3, 4, 7 and 8 against `http://localhost` with `curl` and the TOTP one-liner;
  - confirm the emails in Mailpit and the activity entries.

  Then open pull request 2

**Checkpoint**: two-step works through the API; the apps still sign in people without
two-step exactly as before.

---

## Phase 4: User Story 1, authenticator codes in the portal and admin (Priority: P1), pull request 3

**Goal**: people set up two-step and sign in with codes in both apps.

**Independent Test**: `quickstart.md` US1 steps 1 to 8 in the browser pane.

- [x] T028 [P] [US1] Add `packages/ui/src/components/input-otp.tsx` from shadcn `input-otp` (add the `input-otp` dependency to `packages/ui/package.json`), styled with the kit tokens, with a story in `apps/storybook/src/components/InputOTP.stories.tsx` covering six digits, an error and disabled
  - Done: also exports `SixDigitCode` (two groups of three, `one-time-code` autofill); the caret keyframe is in `globals.css`.
- [x] T029 [P] [US1] Add the statuses `enabled` and `not_set_up` to `packages/ui/src/lib/status.ts`, and add them to `apps/storybook/src/foundations/Status.stories.tsx`
- [x] T030 [P] [US1] Create `packages/auth/src/TwoStepChallenge.tsx`:
  - the `InputOTP` code field, a **Use a recovery code** toggle switching to a text field, and an attempts-left message;
  - on `pending` errors, **Start again** returns to the password step;
  - on success, it shows "n recovery codes left" when the response includes the count; at zero it says none are left and links to **Account → Security** to regenerate them;
  - it shows only the methods the `202` lists (PR4 adds the passkey option).
  - Done: also used in the portal's session-restore dialog; **Back to password** keeps the email and **Keep me signed in**.

  Export it from `packages/auth/package.json`
- [x] T031 [P] [US1] Create `packages/auth/src/RecoveryCodes.tsx`: the eight codes in a monospace grid, **Copy** and **Download** (a `.txt` file named after the deployment host, not the product), and a "I have saved these codes" checkbox before **Done**
- [x] T032 [P] [US1] Create `packages/auth/src/TwoStepSetup.tsx`:
  1. render the QR code as an `<img src="data:image/svg+xml;base64,…">`, never injected HTML;
  2. show the setup key with **Copy**;
  3. confirm a code with `InputOTP`;
  4. show `RecoveryCodes`.

  Export it from `packages/auth/package.json`
- [x] T033 [P] [US1] Create `packages/auth/src/ConfirmIdentityDialog.tsx`: a password dialog opened on `ConfirmationRequiredError`, which calls `confirmPassword`, then retries the original action
  - Done: `useConfirmedAction(apiClient)` wraps a change and opens the dialog on `423`; closing it rejects with `ConfirmationCancelled`.
- [x] T034 [US1] Update the portal sign-in route in `apps/portal/src/App.tsx`. On `{ twoStepRequired: true }`, swap the form for `TwoStepChallenge` without losing the email or the **Keep me signed in** choice (`apps/portal/src/components/KeepSignedIn.tsx` stays on the first step), and continue to the original location on success
- [x] T035 [US1] Create `apps/portal/src/account/SecurityPage.tsx` at `/account/security`, linked from the user menu in `apps/portal/src/App.tsx`, with `Panel` sections:
  - **Authenticator app**: `Status` from `statusOf`, **Set up** opening `TwoStepSetup` in a dialog, **Turn off**;
  - **Recovery codes**: remaining count (a warning at zero) and **Regenerate**, showing `RecoveryCodes`.
  - Done: the page composes `SettingsPage` (title **Account**, one **Security** section); the user menu item is **Security**.

  Wrap actions with `ConfirmIdentityDialog`, and show success toasts bottom-right
- [x] T036 [US1] Update `apps/admin/src/auth/LoginPage.tsx` to handle `{ twoStepRequired: true }` with `TwoStepChallenge`, and add a **Security settings** link to the admin user menu pointing at the portal's `/account/security` via `apps/admin/src/lib/portal.ts`
- [x] T037 [P] [US1] Write `apps/portal/e2e/two-step.spec.ts` (generate codes in the test from the setup key with an `otpauth` dev dependency):
  - set up, save codes, sign out, sign in with a code;
  - sign in with a recovery code and see the count;
  - **Keep me signed in** survives a new context;
  - a second context is signed out after two-step is turned on;
  - turn off
  - Done: against a mocked API, like the other portal specs; the fake API is `apps/portal/e2e/support/two-step-api.ts`. Added: five wrong codes, and a wrong confirmation password.
- [x] T038 [P] [US1] Write `apps/admin/e2e/two-step-admin.spec.ts`: a person with two-step on signs in to the admin app with a code
- [x] T039 [P] [US1] Write the help guide `apps/api/resources/help/two-step-sign-in.md` (setup, recovery codes, losing your phone, turning it off) without naming the product, and register it in `apps/api/app/Domain/Help/Services/HelpCatalog.php`
  - Done: `HelpCatalog` loads every guide file, so nothing is registered there; the page context `account.security` is in `resources/help/contexts.json` and `apps/portal/src/help/context.ts`.
- [x] T040 [US1] Verify pull request 3:
  - run `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/admin lint` (with `check-ui`), the Storybook build, and both e2e specs;
  - rebuild `portal` and `admin` without discarding open browser edits;
  - run all of `quickstart.md` US1 in the browser pane;
  - time setup from opening the security page to saving the codes (SC-001, under 2 minutes);
  - take screenshots of the sign-in code step, the security page and the recovery codes for the designer review.
  - Done: lints, the Storybook build, 266 mocked portal specs and 76 admin specs pass. Live on the rebuilt stack as a seeded member: steps 1, 3, 4, 6 and 8 in the browser pane, with the emails in Mailpit and the `person.*` activity entries. Steps 2 and 5 need a second browser and are covered by `two-step.spec.ts`; step 7 was checked against the API in pull request 2. Setup took 22.6 s (SC-001). The run found three problems, now fixed: Tailwind did not scan `packages/auth`; a refused code dropped focus from the code field; and six boxes did not fit a 320 px phone.

  Then open pull request 3

**Checkpoint**: User Story 1 is complete and usable end to end.

---

## Phase 5: User Story 2, passkeys (Priority: P2), pull request 4

**Goal**: people add passkeys and sign in with one alone (FR-016 to FR-019).

**Independent Test**: `quickstart.md` US2 with Chrome's virtual authenticator and with
Touch ID on `localhost`.

### Tests for User Story 2

- [x] T041 [US2] Spike the `laravel/passkeys` version resolved in T005: confirm the signatures of `GenerateRegistrationOptions`, `StorePasskey`, `GenerateVerificationOptions`, `VerifyPasskey` and `DeletePasskey`, plus `Passkeys::ignoreRoutes()`, `useUserModel()` and the `passkeys` migration. Record the results in `research.md` R4, and adjust T046 to T050 if they differ
  - Done: `laravel/passkeys` 0.3.0 matched the plan (signatures in research R4). Fortify's provider already ignores the package routes and sets the user model. `@laravel/passkeys` 0.4.1 takes routes per call and parses every answer as JSON, so `POST auth/confirm-passkey` answers `200 {"confirmed": true}`, not `204` (contract updated).
- [x] T042 [P] [US2] Write `apps/api/tests/Feature/Domain/Authentication/PasskeySignInTest.php` with WebAuthn fixtures from `web-auth/webauthn-lib` test helpers:
  - options are stored in the session;
  - a valid assertion signs in through `CompleteSignIn` and counts as both steps for a person with two-step on;
  - `remember` issues a kept sign-in, not Laravel's remember token;
  - `last_used_at` updates;
  - an invalid assertion gives `422`;
  - both routes give `404` when passkeys are unavailable;
  - a 7th attempt in a minute gives `429`
  - Done: the fixtures are our own `tests/Support/VirtualAuthenticator.php` (an ES256 key that answers the API's options with `none` attestation, built with the CBOR classes `web-auth` already depends on); the library ships no test helpers. Also covers a removed passkey, a foreign origin, a stale challenge, and the 202 offering `passkey`.
- [x] T043 [P] [US2] Write `apps/api/tests/Feature/Domain/Authentication/PasskeyManagementTest.php`:
  - add (`name` "1 to 60 characters"), list, remove;
  - `423` without confirmation;
  - another person's passkey gives `404`;
  - a duplicate gives `422`;
  - add and remove write activity entries with the name and no credential id, queue `SecurityChanged`, and do not end other sessions;
  - `GET me/security` reports `unavailable_reason: "not_https"` with an `http://` front-end URL;
  - a person with two-step confirmed and a passkey gets `"passkey"` in the login `202` `methods`;
  - `POST auth/confirm-passkey` confirms
  - Done: also: someone else's credential cannot be claimed, a passkey alone adds no step to the password, and `not_https` keeps the list (to remove) but stops counting passkeys toward `satisfied`.

### Implementation for User Story 2

- [x] T044 [US2] Publish the `laravel/passkeys` migration as `apps/api/database/migrations/2026_11_17_000002_create_passkeys_table.php` (`id`, `user_id` foreign key cascade on delete, `name`, `credential_id` unique, `credential` json, `last_used_at` nullable, timestamps, index on `user_id`). Add a `passkeys` block to `apps/api/config/fortify.php` (Fortify's provider copies it into `passkeys.*` at register time, research R4):
  - `relying_party_id` = `env('PASSKEYS_RP_ID', parse_url(env('FRONTEND_URL', 'http://localhost'), PHP_URL_HOST))`;
  - `allowed_origins` = `[env('FRONTEND_URL'), env('ADMIN_FRONTEND_URL')]`;
  - `user_handle_secret` = `env('PASSKEYS_USER_HANDLE_SECRET', env('APP_KEY'))`;
  - `limiters.passkeys` for the 6-a-minute limit
  - Done: migration `2026_11_23_000200_create_passkeys_table.php` (dated after the two-step migration on `main`, not `2026_11_17_000002`). The limit is a named `passkeys` limiter in `AuthenticationServiceProvider`: 6 a minute per route, per address before sign-in and per person after, so fetching options does not use up the answer. The contract generator only describes ip/user/email keys, which ruled out a per-browser key.
- [x] T045 [US2] In the provider from T008:
  - check that Fortify's provider has already called `Passkeys::ignoreRoutes()` and set the user model (research R4), and add both only if it has not;
  - update `apps/api/app/Domain/Shared/Models/User.php` to use `Laravel\Fortify\PasskeyAuthenticatable` and implement `Laravel\Fortify\Contracts\PasskeyUser`;
  - change `twoStepSatisfied()` to also return true when the person has at least one passkey
  - Done: nothing to add to the provider. `twoStepSatisfied()` counts passkeys only while `PasskeyAvailability` allows them.
- [x] T046 [P] [US2] Create `apps/api/app/Domain/Authentication/Services/PasskeyAvailability.php`: available when `FRONTEND_URL` and `ADMIN_FRONTEND_URL` are both `https`, or their host is `localhost`; otherwise `unavailable_reason: "not_https"`
  - Done: `.localhost` hosts count as localhost too.
- [x] T047 [US2] Create `apps/api/app/Domain/Authentication/Http/Controllers/PasskeySignInController.php`. Both routes are guest, `throttle:6,1`, and `404` when unavailable:
  - `GET auth/passkeys/options`: `GenerateVerificationOptions`, kept in the session;
  - `POST auth/passkeys`: `VerifyPasskey`, then `Passkeys::allowsLogin`, then forget any pending sign-in and call `CompleteSignIn` with `remember`, and set `last_used_at`.
  - Done: both sign-in routes and both confirm routes sit behind `EnsurePasskeysAvailable` (404) and the `passkeys` limiter; the package's form requests parse the credential. `last_used_at` is set by `VerifyPasskey` itself. `"passkey"` is added in `TwoStepChallengeController::begin()`, which `SessionController::store` calls.

  In `SessionController::store`, add `"passkey"` to the pending `methods` when the person has a passkey and `PasskeyAvailability` allows it

  Add `GET auth/confirm-passkey/options` and `POST auth/confirm-passkey` (session) to `ConfirmationController`; these call `passwordConfirmed()` on success
- [x] T048 [US2] Create `apps/api/app/Domain/Authentication/Http/Controllers/PasskeyController.php` (`GET me/passkeys/options`, `POST me/passkeys`, `DELETE me/passkeys/{passkey}`, all `password.confirm`), scoped to `$request->user()->passkeys()` (`404` otherwise). It validates `name` as required, string, 1 to 60 characters, and calls `SecurityAudit` (`person.passkey_added` / `person.passkey_removed` with `name`). Fill the `passkeys` block of `GET me/security` in `SecurityController` from `PasskeyAvailability` and the person's passkeys (`id`, `name`, `created_at`, `last_used_at`)
  - Done: `DELETE` stays open where passkeys are unavailable, so old passkeys can still be removed. Add/remove and their audit entry run in one transaction.
- [x] T049 [P] [US2] Add the passkey routes and schemas to the OpenAPI supplements in `contracts/openapi/supplements/`, regenerate `contracts/openapi/openapi.json`, and pass the drift check. Add `passkeyOptions()`, `addPasskey()`, `removePasskey()` and the passkey `security()` fields to `packages/api-client/src/security.ts`
  - Done: api-client has `passkeyEndpoints()` (absolute URLs of the three ceremonies) and `removePasskey()` instead of `passkeyOptions()`/`addPasskey()`: `@laravel/passkeys` fetches the options and posts the answer itself. `packages/auth/src/passkeys.ts` maps its errors to the client's (`423` to `ConfirmationRequiredError`, `404` to unavailable). Adding routes renumbers some Scramble operation ids.
- [x] T050 [P] [US2] Release tooling:
  - add `PASSKEYS_RP_ID: ${DOMAIN}` and `PASSKEYS_USER_HANDLE_SECRET: ${PASSKEYS_USER_HANDLE_SECRET:?}` to the API family environment in `deploy/release/compose.yml`, and document both in `deploy/release/environment.example`;
  - in `tooling/release/manage.py`, generate the secret once (64 random bytes, base64) and keep it across upgrades the way the push key is kept; a restore refuses a different secret;
  - set `PASSKEYS_RP_ID=localhost` in `tooling/release/verify_local.py`;
  - add tests in `tooling/release/test_release.py`
  - Done: `init` writes the secret; `manage.py passkeys-secret` adds it to an existing environment, and `deploy` adds it once when missing (the first release with passkeys), so an upgrade needs no manual step. `validate` refuses a missing or malformed secret. Six new tests.
- [x] T051 [P] [US2] Create `packages/auth/src/PasskeySignInButton.tsx` with `@laravel/passkeys` ^0.4 (add to `packages/auth/package.json`):
  - `configure` the routes to the API's `auth/passkeys/options` and `auth/passkeys`, with `credentials: "include"`;
  - pass `remember`;
  - set `autocomplete="email webauthn"` conditional UI on the email field;
  - hide the button when `isSupported` is false or the deployment reports passkeys unavailable;
  - map `UserCancelledError` to no message
  - Done: `@laravel/passkeys` ^0.4.1. The email fields use `username webauthn` (portal) and `email webauthn` (admin). The sign-in page learns that the deployment cannot offer passkeys from the options route's `404` (the autofill request on load, or the click), since a guest cannot read `me/security`.
- [x] T052 [US2] Add `PasskeySignInButton` to the portal sign-in route in `apps/portal/src/App.tsx` and to `apps/admin/src/auth/LoginPage.tsx`, below the password form, and to `packages/auth/src/TwoStepChallenge.tsx` when the `202` `methods` include `passkey` (alone, as "Continue with your passkey", when it is the only method)
  - Done: the portal's session-restore dialog passes **Keep me signed in** to `TwoStepChallenge` too. Existing e2e selectors for **Sign in** became `exact: true`.
- [x] T053 [US2] Add a **Passkeys** `Panel` to `apps/portal/src/account/SecurityPage.tsx`:
  - a `DataTable` of name, added and **Last used** (`RelativeTime`);
  - **Add a passkey** (name field, then `@laravel/passkeys` registration against `me/passkeys/options` and `me/passkeys`);
  - **Remove**, with confirmation;
  - the reason when passkeys cannot be used: the deployment's `unavailable_reason`, or "This browser does not support passkeys" when `isSupported` is false (FR-018).
  - Done: `useConfirmedAction(api, { passkey })` offers **Use a passkey** only when the person has one and passkeys are available.

  Wrap actions with `ConfirmIdentityDialog`, which also offers **Use a passkey** through `auth/confirm-passkey`
- [x] T054 [P] [US2] Write `apps/portal/e2e/passkeys.spec.ts` with a CDP virtual authenticator:
  - add a passkey, sign out, sign in with it on the portal, then on the admin app, remove it, and check that sign-in fails;
  - with `me/security` answered as `not_https` (route stub), the security page says passkeys need HTTPS and the sign-in page has no passkey button
  - Done: five specs against the mocked API (which checks challenge, type and origin): add/sign in/remove/refused, a passkey finishing a code step with **Keep me signed in**, the email field's autofill, **Use a passkey** in the confirmation dialog, and `not_https`. The admin app's passkey sign-in is in `apps/admin/e2e/passkeys-admin.spec.ts` (the credential is loaded with `WebAuthn.addCredential`), because one mocked spec cannot drive both apps.
- [x] T055 [P] [US2] Add a **Passkeys** section to `docs/features/access.md`. Add the new keys to `docs/ops/release.md`, with the warning that changing `DOMAIN` invalidates passkeys. Add the relying-party-ID and Fortify replay-key traps to `docs/dev/gotchas.md`, and add passkeys to `apps/api/resources/help/two-step-sign-in.md`
  - Done: the help guide gains steps 9 to 11 and two troubleshooting items (revision 2). Gotchas also cover WebAuthn refusing IP addresses and the virtual authenticator answering autofill.
- [x] T056 [US2] Verify pull request 4:
  - run the API suite on PostgreSQL, both lints, the release tooling tests and `passkeys.spec.ts`;
  - rebuild the API family, `portal` and `admin`;
  - run `quickstart.md` US2 steps 1 to 4 with the virtual authenticator and again with Touch ID on `localhost`, timing a passkey sign-in (SC-003, under 10 seconds); run step 5 too if pull request 5 has merged;
  - take designer screenshots of the passkey sign-in and the passkeys panel.

  Then open pull request 4
  - Done: the API suite on PostgreSQL (1617 tests), both lints, the release tooling tests (50), all 271 mocked portal specs and the admin specs pass. Rebuilt the API family, `portal` and `admin`; quickstart US2 steps 1 to 4 ran live on `localhost` with Chrome's virtual authenticator as `platform-admin@example.test`: passkey sign-in took 209 ms on the portal and 150 ms on the admin app (SC-003), the email field's autofill 206 ms; the mails and `person.passkey_*` entries arrived; the removed passkey was refused. The dev stack's `FRONTEND_URL` is `127.0.0.1`, which WebAuthn refuses, so `compose.app.yml` now sets `PASSKEYS_RP_ID=localhost` and localhost passkey origins, and availability is read from the passkey origins (they default to the two front-end URLs). The run found two problems, now fixed: the "or" divider had no lines, and a browser with no authenticator showed "does not support passkeys" on load. Not done: the Touch ID run (needs a person at the machine) and step 5 (pull request 5 has not merged). Designer screenshots are in the session notes (`pr4-screenshots`).

**Checkpoint**: User Story 2 is complete; passkeys sign in on both apps.

---

## Phase 6: User Story 3, required two-step (Priority: P2), pull request 5

**Goal**: platform staff and members of organizations that require it cannot use the
apps until they have two-step or a passkey (FR-020 to FR-023).

**Independent Test**: `quickstart.md` US3 steps 1 to 6.

### Tests for User Story 3

- [ ] T057 [P] [US3] Write `apps/api/tests/Feature/Domain/Authentication/RequireTwoStepTest.php` covering:
  - a super administrator, and a person with `PlatformAdministration.access`, without two-step get `403 {"code": "two_step_setup_required"}` on an ordinary route, but `200` on `me`, `me/security`, `me/two-step*`, `me/passkeys*`, `auth/confirm-password`, `auth/confirm-passkey` and `auth/logout`;
  - after confirming two-step, or adding a passkey, the routes open;
  - a required person with a passkey and no authenticator gets `202` with `methods: ["passkey"]` from a right password and no session, and a passkey sign-in then opens the routes (FR-022). If pull request 4 has not merged yet, pull request 4 adds this case;
  - `DELETE me/two-step` gives `409 two_step_required`;
  - an agent `mcp` token and an integration application token for a required person are not affected;
  - Passport's authorize route redirects a required, unsatisfied person to setup;
  - a new person accepting an invitation to an organization that requires it is gated
- [ ] T058 [P] [US3] Write `apps/api/tests/Feature/Domain/Administration/OrganizationTwoStepTest.php` covering:
  - `PUT organizations/{organization}/security` needs `Organization.update`;
  - `409` when the actor is not satisfied;
  - the change is recorded in that organization's activity log with `attribute_changes`;
  - the organization context returns `two_step_required`, and members return `two_step_enabled`;
  - isolation (constitution III): a member of organization B gets `404` for organization A;
  - a requirement in A applies to a person in A and B, but not to a person only in B;
  - removing a person from A lifts the requirement without turning their two-step off

### Implementation for User Story 3

- [ ] T059 [US3] Add the migration `apps/api/database/migrations/2026_11_17_000003_add_two_step_required_to_organizations_table.php` (`two_step_required` boolean, default false), and add the cast to the organization model in `apps/api/app/Domain/Shared/Models/`
- [ ] T060 [US3] Add `twoStepRequirement(): array` to `apps/api/app/Domain/Shared/Models/User.php`. It returns `required_by`: `"platform"` when `is_super_admin` or `PlatformAuthorization::canAccessAdministration()`, plus `{organization, name}` for each organization with `two_step_required`. It is memoised per request. Fill `required`, `required_by` and `satisfied` in `SecurityController`. In `SessionController::store`, a required person satisfied only by passkeys gets the pending sign-in with `methods: ["passkey"]` instead of a session; `twoStepSatisfied()` counts passkeys only while `PasskeyAvailability` allows them (both only once T045 is merged)
- [ ] T061 [US3] Create `apps/api/app/Domain/Authentication/Http/Middleware/RequireTwoStep.php` and register it in `apps/api/bootstrap/app.php`:
  - append it to the `api` group and place it after `AuthenticatesRequests` with `appendToPriorityList`, so it runs after `auth:sanctum` (see how `ResumeKeptSignIn` is placed); add it to the `oauth/authorize` route's middleware in `apps/api/routes/ai.php`, not to the whole `web` group;
  - act only when the request's user came from the `web` session guard (skip bearer tokens and the `mcp` guard);
  - skip the allowlisted route names;
  - answer `403 {"code": "two_step_setup_required", "message": "Set up two-step sign-in to continue."}` when required and not satisfied, or redirect to the portal's `/account/security/setup` for the authorize route
- [ ] T062 [US3] Add the `409 {"code": "two_step_required"}` guard to `TwoStepController::destroy`
- [ ] T063 [US3] Create `apps/api/app/Domain/Administration/Http/Controllers/OrganizationSecurityController.php` (`PUT organizations/{organization}/security`, `ResolveOrganizationContext`, `Organization.update`):
  - validate `two_step_required` as a boolean;
  - `409` when the actor is not satisfied;
  - otherwise save and record `organization.two_step_required_changed` in that organization.

  Add `two_step_required` to the organization context resource returned by `apps/api/app/Domain/Authorization/Http/Controllers/OrganizationContextController.php`, and `two_step_enabled` (satisfied) to `apps/api/app/Domain/Administration/Http/Resources/OrganizationMemberResource.php`
- [ ] T064 [P] [US3] Update the OpenAPI supplements in `contracts/openapi/supplements/` (the `403 two_step_setup_required` response on session routes, the organization security route, and the new context and member fields), regenerate `contracts/openapi/openapi.json`, and pass the drift check. In `packages/api-client/src/index.ts`:
  - map that `403` to a typed `TwoStepSetupRequiredError`, emitted on a client event;
  - add `setOrganizationTwoStep()`;
  - add the new fields
- [ ] T065 [US3] Create `apps/portal/src/account/SetupRequiredPage.tsx` at `/account/security/setup`: a full-page shell with an explanation (who requires it, from `required_by`), `TwoStepSetup`, an **Add a passkey instead** option when available, and **Sign out**. In `apps/portal/src/App.tsx`, route every `TwoStepSetupRequiredError` there, remembering the original location, and return to it after setup
- [ ] T066 [US3] In `apps/admin/src/App.tsx` (or its query client setup), send `TwoStepSetupRequiredError` to the portal's `/account/security/setup?return=<admin url>` through `apps/admin/src/lib/portal.ts`
- [ ] T067 [US3] Add a **Security** route to `apps/portal/src/settings/Settings.tsx` (`security`) with a `Panel` holding:
  - a **Require two-step sign-in** switch, disabled with an explanation when the viewer is not satisfied;
  - the count of members without it.

  Add a **Two-step** `Status` column (`enabled` / `not_set_up`) to `apps/portal/src/members/Members.tsx`
- [ ] T068 [P] [US3] Write `apps/portal/e2e/two-step-required.spec.ts`:
  - a platform administrator without two-step lands on setup and then reaches the app;
  - an organization administrator requires it, and a signed-in member is sent to setup on the next click;
  - an invited new member sets up before reaching the app
- [ ] T069 [P] [US3] Add a **Required two-step** section to `docs/features/access.md`, and a release-notes line to `docs/ops/release.md`: platform staff will be asked to set up two-step at their next sign-in
- [ ] T070 [US3] Verify pull request 5:
  - run the API suite on PostgreSQL, both lints, and `two-step-required.spec.ts`;
  - rebuild the API family, `portal` and `admin`;
  - run `quickstart.md` US3 steps 1 to 6, including the agent and application token check;
  - take designer screenshots of the setup-required page and the organization Security section.

  Then open pull request 5. It must not ship before pull request 3

**Checkpoint**: User Story 3 is complete.

---

## Phase 7: User Story 4, lock-out reset (Priority: P3), pull request 6

**Goal**: a platform administrator, or the server operator, can reset a locked-out
person's two-step sign-in (FR-024 to FR-026).

**Independent Test**: `quickstart.md` US4 steps 1 to 3.

### Tests for User Story 4

- [ ] T071 [P] [US4] Write `apps/api/tests/Feature/Domain/Administration/TwoStepResetTest.php` covering:
  - `POST admin/users/{user}/two-step/reset` needs `PlatformAdministration.reset-two-step`;
  - `reason` is required, up to 500 characters;
  - the reset clears the three two-factor columns, deletes passkeys and ends every session and kept sign-in (`two_step_reset`);
  - it records `person.two_step_reset` with the reason, `source: "admin"` and `passkeys_removed`, and queues `SecurityChanged`;
  - resetting yourself gives `403`;
  - a platform administrator resetting a super administrator gives `403`;
  - an unknown user gives `404`;
  - `two_step_enabled` and `passkey_count` appear in the platform users list
- [ ] T072 [P] [US4] Write `apps/api/tests/Feature/Console/ResetTwoStepCommandTest.php`: `auth:reset-two-step {email} --reason=` performs the same reset with no causer and `source: "console"`, fails for an unknown email, and requires `--reason`

### Implementation for User Story 4

- [ ] T073 [US4] Add `RESET_TWO_STEP = 'PlatformAdministration.reset-two-step'` to `apps/api/app/Domain/Authorization/Permissions/PlatformAdministrationPermission.php`, with a migration `apps/api/database/migrations/2026_11_17_000004_seed_reset_two_step_permission.php` that creates the permission and grants it to existing platform roles that hold `PlatformAdministration.manage-organizations`
- [ ] T074 [US4] Create `apps/api/app/Domain/Authentication/Actions/ResetTwoStep.php`. It takes the target, the actor (nullable), the reason and the source. In one transaction:
  1. refuse self;
  2. refuse a super administrator target unless the actor is one;
  3. run `DisableTwoFactorAuthentication`;
  4. delete passkeys;
  5. run `EndSignIns::everywhere(…, KeptSignIn::TWO_STEP_RESET)`;
  6. run `SecurityAudit` (`person.two_step_reset`)
- [ ] T075 [US4] Create `apps/api/app/Domain/Administration/Http/Controllers/TwoStepResetController.php` (`POST admin/users/{user}/two-step/reset`, integer `{user}`, `whereNumber`) in `apps/api/app/Domain/Administration/routes/api.php`. Add `two_step_enabled` and `passkey_count` to the platform users list returned by `apps/api/app/Domain/Administration/Http/Controllers/PlatformUserController.php`
- [ ] T076 [US4] Create `apps/api/app/Domain/Authentication/Console/ResetTwoStepCommand.php` (`auth:reset-two-step {email} {--reason=}`), which calls `ResetTwoStep` with no actor and source `console`
- [ ] T077 [P] [US4] Update the OpenAPI supplements in `contracts/openapi/supplements/` and `contracts/openapi/openapi.json`, pass the drift check, and add `resetTwoStep(userId, reason)`, the users list fields and the `reset_two_step` capability to `packages/api-client/src/index.ts`
- [ ] T078 [US4] In `apps/admin/src/pages/UsersPage.tsx`:
  - add **Two-step** (`Status`) and **Passkeys** columns;
  - add a **Reset two-step** row action, shown only with the permission (expose `reset_two_step` in the capabilities of `apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php`) and never on the viewer's own row;
  - the action opens a dialog with a required reason (up to 500 characters) and shows a success toast
- [ ] T079 [P] [US4] Write `apps/admin/e2e/two-step-reset.spec.ts`: an administrator resets a member's two-step with a reason, the row shows **Not set up**, and the action is absent on their own row
- [ ] T080 [P] [US4] Add a **Lock-out reset** section to `docs/features/access.md`, and write the lock-out procedure (how to check identity before a reset, and the console command) in `docs/ops/incident-runbook.md` under a new heading, with no hosts or names
- [ ] T081 [US4] Verify pull request 6:
  - run the API suite on PostgreSQL, the admin lint and `two-step-reset.spec.ts`;
  - rebuild the API family and `admin`;
  - run `quickstart.md` US4 steps 1 to 3.

  Then open pull request 6

**Checkpoint**: all four user stories are complete.

---

## Phase 8: Polish and acceptance (after the last of pull requests 4, 5 and 6 merges)

- [ ] T082 Run the offline check (SC-004): rebuild the stack from `main`, take the API container off every network except the stack's internal one, run `two-step.spec.ts` and `two-step-required.spec.ts`, and confirm the API logs show no outbound connection attempts. Record the result in `quickstart.md`
- [ ] T083 Run `/speckit-converge` on `specs/034-two-factor-passkeys/` and either build or explicitly defer every gap it reports
- [ ] T084 After the release that ships pull requests 3 and 5, confirm on the pilot that platform staff are sent to setup and that a passkey signs in over HTTPS on the real domain. Record the result in `docs/ops/release.md`
- [ ] T085 Move `ADR-048` to Accepted in `docs/adr/ADR-048-two-step-sign-in-and-passkeys.md` and `docs/adr/README.md`, mark the roadmap entry in `docs/roadmap.md` done, and freeze `specs/034-two-factor-passkeys/`

---

## Dependencies and Execution Order

### Pull request order

```text
PR1 Documents
 └─ PR2 Codes API                    (Phases 2–3: Foundational, US1 API)
     └─ PR3 Codes in portal and admin (Phase 4: US1 UI)
         ├─ PR4 Passkeys             (Phase 5: US2)
         ├─ PR5 Required two-step    (Phase 6: US3)
         └─ PR6 Lock-out reset       (Phase 7: US4; uses PR3's kit statuses)
PR4 + PR5 + PR6 ─ Phase 8
```

- PR4, PR5 and PR6 do not depend on each other and may be built at the same time.
  - PR4 and PR5 both edit `apps/portal/src/account/SecurityPage.tsx`,
    `apps/portal/src/App.tsx`, `packages/api-client/src/index.ts`,
    `apps/api/app/Domain/Shared/Models/User.php` and
    `apps/api/app/Domain/Authentication/Http/Controllers/SecurityController.php`.
  - PR4 and PR6 both touch the OpenAPI files.
  - Bring each onto the latest `main` before opening it, and check
    `git diff --diff-filter=U` after the merge.
- PR5's satisfied rule counts passkeys only once PR4's T045 is merged. If PR5 merges
  first, PR4 extends `twoStepSatisfied()`, adds the `methods: ["passkey"]` sign-in rule
  for required people with only a passkey (FR-022), and adds both tests from T057.
- PR5 must not ship before PR3, because the requirement needs the setup screens.

### Within a phase

- T005 to T008 come first. T010 needs T006. T011 and T012 come before every story
  task that signs in or ends sign-ins. T016 needs T014 and T015.
- In PR2: T020 and T021 need T011 and T009; T022 needs T012 and T016; T024 to T026
  run once the routes exist.
- In PR3: kit tasks (T028, T029) come before T030 to T032, which come before T034 to
  T036.
- In PR4: T041 comes first; T044 and T045 before T047 and T048; T051 before T052 and
  T053.
- In PR5: T059 and T060 come before T061 to T063; T064 before T065 to T067.
- In PR6: T073 and T074 come before T075 and T076.
- Verification tasks (T027, T040, T056, T070, T081) are last in their pull request.

### User story completion

- **US1** (P1): complete after Phase 4. It depends on nothing else.
- **US2** (P2): complete after Phase 5. It needs US1's security page.
- **US3** (P2): complete after Phase 6. It needs US1's setup components; passkeys
  satisfy it once US2 is merged.
- **US4** (P3): complete after Phase 7. It needs PR2's API and PR3's kit statuses.

## Parallel Examples

- **PR2**: T009, T013, T014 and T015 together; then T018 and T019 together; then
  T024, T025 and T026 together.
- **PR3**: T028, T029, T030, T031, T032 and T033 together; then T037, T038 and T039
  together.
- **PR4**: T042, T043, T046 and T050 together after T041; T049, T051, T054 and T055
  together.
- **PR5**: T057 and T058 together; T064, T068 and T069 together.
- **PR6**: T071 and T072 together; T077, T079 and T080 together.
- **Across pull requests**: after PR3 merges, PR4, PR5 and PR6 can be built in three
  separate worktrees.

## Implementation Strategy

- **MVP**: PR1 to PR3, which is User Story 1. People can protect their accounts with
  an authenticator app on every deployment, including on-premise ones with no
  internet.
- **Next**: PR5 (required two-step), because it turns protection into policy for the
  accounts that matter most. Then PR4 (passkeys) and PR6 (lock-out reset), in either
  order.
- Ship PR5 in a release together with, or after, PR3. Announce to platform staff
  before the release that they will be asked to set up two-step.
