---

description: "Tasks for spec 035, self sign-up"
---

# Tasks: Self Sign-Up

**Input**: Design documents from `/specs/035-self-sign-up/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/sign-up-api.md](contracts/sign-up-api.md),
[contracts/sign-up-push.md](contracts/sign-up-push.md), [quickstart.md](quickstart.md)

**Tests**: included, because the constitution requires them:

- isolation tests for tenant data (III);
- the OpenAPI drift check and the push contract's fixtures (IV);
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

- [x] T001 Write the spec, research, data model, contracts, quickstart, checklist, plan and tasks in specs/035-self-sign-up/
- [x] T002 [P] Add docs/adr/ADR-049-self-sign-up.md, its row in docs/adr/README.md, and the status lines of docs/adr/ADR-026-billing-accounts.md and docs/adr/ADR-047-progressive-web-app-before-native-apps.md
- [x] T003 [P] Add the **Self sign-up** entry under **Control plane** in docs/roadmap.md

**Checkpoint**: pull request 1 merged.

---

## Phase 2: Foundations (pull request 2)

**Purpose**: the tables, settings and domain every story needs.

- [x] T004 Create migration apps/api/database/migrations/2026_11_26_000100_create_sign_ups_table.php with the columns of data-model.md (`name` string(120), `email` string(255) lowercased, `organization_name` string(80), `password` nullable, `state` string(16) `waiting`|`completed`|`refused`, `refusal_reason` string(32) nullable, `token_hash` char(64) nullable, `token_expires_at`, `sends` smallint, `last_sent_at`, `ip_address` inet nullable, `user_agent` string(255) nullable, `confirmed_at`, `completed_at`, `signed_in_at`, `user_id`/`organization_id`/`billing_account_id` FKs nullOnDelete), a partial unique index on `email` where `state = 'waiting'`, a partial unique index on `token_hash` where not null, and an index on `(state, created_at)`
- [x] T005 [P] Create migration apps/api/database/migrations/2026_11_26_000200_create_sign_up_settings_table.php with one row `id = 1`: `open` false, `free_beta` true, `notify_push` true, `notify_email` false, `daily_limit` 50, `revision` 1, `updated_by` FK users nullable
- [x] T006 Create the `SignUp` domain skeleton: apps/api/app/Domain/SignUp/SignUpServiceProvider.php (registered in apps/api/bootstrap/providers.php), routes/api.php required from apps/api/routes/api.php, and models Models/SignUp.php (uuid route key, hidden `password` and `token_hash`, `isExpired()`) and Models/SignUpSetting.php
- [x] T007 Implement apps/api/app/Domain/SignUp/Services/SignUpSettings.php: `current()`, and `update(array $values, int $revision, User $actor)` that answers 409 `stale_revision` on a stale revision, bumps the revision and writes `sign_up_settings.updated` with the changed fields through `ActivityLog::record` (no organization)
- [x] T008 [P] Set `Password::defaults()` to `min(12)->max(256)` in apps/api/app/Domain/Authentication/AuthenticationServiceProvider.php (research R8)
- [x] T009 [P] Add `organization.created` with `source` (`owner` or `sign_up`) to apps/api/app/Domain/Billing/Services/OwnerOrganizations.php through `ActivityLog::record`, and labels for `sign_up.completed` and `sign_up_settings.updated` in apps/api/app/Domain/Audit/Services/ActivityCatalogue.php
- [ ] T010 [P] (Not needed in pull request 2: tests create rows directly; drop at converge if still unused.) Add `SignUpFactory` in apps/api/database/factories/SignUpFactory.php with `waiting()`, `completed()` and `refused()` states

**Checkpoint**: migrations run on PostgreSQL; the settings row exists.

---

## Phase 3: User Story 1 - Sign up and land in my own organization (P1) 🎯 MVP

**Goal**: A visitor signs up, confirms the email and is signed in to a new organization
they administer, under a billing account they own.

**Independent Test**: quickstart scenarios 1, 3, 4, 5, 8 and 11.

### API (pull request 2)

- [x] T011 [P] [US1] Write apps/api/tests/Feature/SignUp/StartSignUpTest.php: closed answers 403 `sign_up_closed`; field rules (name 1 to 120, organization name 2 to 80, no `<`, `>`, `://` or `www.`; password by `Password::defaults()` and confirmed); a waiting row with a bcrypt hash and a token hash, the session holding its uuid, one `SignUpConfirmation` queued; an existing account gets the same 202, `SignUpAccountExists` and no row; a second submit for a waiting email replaces it and only the newest token works; `GET sign-up` returns `open`, `free_beta`, `form_token` and `password_min`
- [x] T012 [P] [US1] Write apps/api/tests/Feature/SignUp/ConfirmSignUpTest.php: a valid token creates exactly one user (email verified, `is_super_admin` false), one billing account (named after the organization, contact email, the person as owner, no plan, organizations allowance 1), one organization under it with the person as `organization-admin`, and the activity entries; the same session is signed in and other sessions are not; a second open answers 410 `used`; expired and replaced tokens answer 410; an account created for the email since answers 409 `account_exists` and refuses the sign-up; it still works while sign-up is closed; two parallel confirms create one organization
- [x] T013 [P] [US1] Write apps/api/tests/Feature/SignUp/SignUpStatusTest.php: 404 without a pending sign-up; `waiting`; completed signs the waiting session in once (`signed_in_at`), never after 60 minutes, and never a session that did not submit; `resend` replaces the token, sends once a minute and 5 an hour
- [x] T014 [P] [US1] Write apps/api/tests/Feature/SignUp/SignUpIsolationTest.php: a sign-up whose organization name equals an existing organization's creates a new one and joins nothing; the new owner's `GET billing-accounts` lists only their account; `GET me` lists only the new organization; a guest session cannot read another session's status by any input
- [x] T015 [P] [US1] Write apps/api/tests/Feature/SignUp/SignUpLoginTest.php: `POST auth/login` with a waiting sign-up's email and right password answers 403 `sign_up_unconfirmed` and puts the sign-up in the session; a wrong password answers 422 as today; a completed sign-up signs in normally, including the two-step `202` when the person later turns two-step on
- [x] T016 [US1] Implement apps/api/app/Domain/SignUp/Services/SignUps.php: `start()` (research R4 and R7 checks are in US4's tasks; here the existing-account branch, create-or-replace under the partial unique index, a 40-character token stored as SHA-256 with a 24-hour expiry, `sends`, session key `sign_up.pending`), `resend()`, `confirm()` (row lock, states, `complete()`, the R3 sign-in through `CompleteSignIn` when the session holds the sign-up and the person has no confirmed two-step and no passkey), `complete()` (`User::forceCreate`, `BillingAccounts::create`, `addOwner`, `OwnerOrganizations::create` with `source` `sign_up`, `sign_up.completed`, clear the hash and token, dispatch `SignUpCompleted` after commit) and `statusFor()`
- [x] T017 [US1] Implement apps/api/app/Domain/SignUp/Http/Requests/StartSignUpRequest.php and Http/Controllers/SignUpController.php (`show`, `store`, `status`, `resend`, `confirm`) with the responses of contracts/sign-up-api.md, and the routes in apps/api/app/Domain/SignUp/routes/api.php
- [x] T018 [US1] Define the limiters `sign-up` (5 an hour per address, 3 an hour per `sha256(email)`), `sign-up-resend` (1 a minute, 5 an hour per sign-up), `sign-up-confirm` (10 a minute per address) and `sign-up-status` (120 a minute per address) in apps/api/app/Domain/SignUp/SignUpServiceProvider.php, with the `login` limiter's 429 body
- [x] T019 [US1] Add the `sign_up_unconfirmed` branch to apps/api/app/Domain/Authentication/Http/Controllers/SessionController.php
- [x] T020 [P] [US1] Write the queued mail notifications apps/api/app/Domain/SignUp/Notifications/SignUpConfirmation.php (link `${FRONTEND_URL}/sign-up/confirm#token=…`, 24 hours), SignUpAccountExists.php (sign-in and reset links) and SignUpWelcome.php (organization link, quickstart, help, the beta line while `free_beta`), none naming the product
- [x] T021 [P] [US1] Implement apps/api/app/Domain/SignUp/Console/PruneSignUps.php (`sign-ups:prune`: waiting after 7 days, refused after 30, clear any completed hash) scheduled daily at 04:10 UTC in apps/api/routes/console.php, with a test in apps/api/tests/Feature/SignUp/PruneSignUpsTest.php
- [x] T022 [US1] Export OpenAPI (`php artisan contract:export`), add `signUpConfig`, `signUp`, `signUpStatus`, `resendSignUp` and `confirmSignUp` with types in packages/api-client/src/sign-up.ts and packages/api-client/src/index.ts, skip `sign-up` paths in the 419 retry, and add Vitest cases in packages/api-client
- [x] T023 [US1] Add a **Signing up** section to docs/features/access.md (flow, routes, limits, settings) and note under **Billing accounts** that a sign-up creates an account owned by its person; add the `User::$fillable` `is_super_admin` trap to docs/dev/gotchas.md
- [x] T024 [US1] Verify pull request 2: rebuild the API family; run quickstart 1, 2 (by `curl`), 3–5 and 8–10 against the API with the log mailer

### Portal (pull request 4)

- [ ] T025 [P] [US1] Build packages/auth/src/SignUpPage.tsx: step 1 (name, email, password, confirm) and step 2 (organization name) on one page in the auth card layout, field errors beside fields, a hidden `website` field, the form token, the closed state, and *Check your email* with **Send it again** (counting down `resend_after`), **Use a different email** and a 3-second status poll that sets the session and opens the organization
- [ ] T026 [P] [US1] Build packages/auth/src/ConfirmSignUpPage.tsx for `/sign-up/confirm`: signed in → organization; completed and signed out → *Your organization is ready* with sign-in (email filled in); expired or replaced → **Send a new link** or start again; used → sign in; account exists → sign in or reset the password
- [ ] T027 [US1] Wire the public routes `sign-up` and `sign-up/confirm` in apps/portal/src/App.tsx, add *New here? Start free* to the sign-in card while open, and handle `403 sign_up_unconfirmed` at sign-in with **Send it again**
- [ ] T028 [P] [US1] Build apps/portal/src/home/FirstDevicePanel.tsx (shown on Home while the organization has no devices and the person may create devices, linking to `devices/onboard`) and add it to apps/portal/src/home/HomePage.tsx
- [ ] T029 [US1] Write apps/portal/e2e/sign-up.spec.ts: closed page; both steps with errors; *Check your email*; resend countdown; the poll signing in and opening Home with the panel; the confirm page's five outcomes; the sign-in page's link and unconfirmed state; phone width fits without sideways scrolling
- [ ] T030 [P] [US1] Write apps/api/resources/help/signing-up.md (what sign-up creates, confirming the email, the beta, what an owner can do; never naming the product) and map the sign-up paths to it in apps/portal/src/help/context.ts; add the sign-up row to docs/features/portal-on-phones.md
- [ ] T031 [US1] Verify pull request 4: rebuild `portal`; run quickstart 1, 3, 4, 5 and 11 in the browser pane at desktop and phone width

**Checkpoint**: a person signs up and lands in their own organization.

---

## Phase 4: User Story 2 - Platform staff hear about every sign-up (P1) (pull request 3)

**Goal**: Each completed sign-up pushes to every super administrator, and emails them
when switched on.

**Independent Test**: quickstart scenarios 6 and 7, and the paused push of 9.

- [ ] T032 [P] [US2] Add contracts/push/v1/sign-up-push.v1.schema.json, sign-up-push.v1.fixture.json and sign-up-push.v1.cases.json per contracts/sign-up-push.md (`kind` `sign_up`|`sign_up_paused`, `person` name only, absolute admin `url`), and list it in contracts/README.md
- [ ] T033 [P] [US2] Write apps/api/tests/Feature/SignUp/StaffNotificationTest.php: with defaults, one push job per super administrator with push devices and none for platform administrators or members; no email; with email on, one `SignUpStaffMail` each; both off sends nothing; a recipient demoted before the job runs gets nothing; push off everywhere gets no push; alert levels and organization mutes do not matter; gone devices are removed; an unconfirmed sign-up notifies no one; the ceiling notice is sent once a day
- [ ] T034 [P] [US2] Write apps/api/tests/Feature/SignUp/SignUpPushPayloadTest.php validating `SignUpPushPayload` output against the schema and fixture
- [ ] T035 [US2] Implement apps/api/app/Domain/SignUp/Events/SignUpCompleted.php, Listeners/NotifyStaffOfSignUp.php, Jobs/DeliverSignUpPush.php (through `PushFanOut::send`, `Topic` `sign-up`, TTL 24 hours, retries and gone-device removal as in `DeliverAlertPush`), Jobs/DeliverSignUpEmail.php, Notifications/SignUpStaffMail.php and Services/SignUpPushPayload.php, on the `alerts` queue, each job re-checking the recipient and settings
- [ ] T036 [US2] Send the once-a-day `sign_up_paused` notice from `SignUps::start()` when the ceiling is reached, through the same jobs
- [ ] T037 [P] [US2] Render `sign_up` and `sign_up_paused` in apps/portal/src/pwa/notification.ts, open absolute URLs only on the admin origin (apps/portal/src/lib/admin.ts) in a new window from apps/portal/src/sw.ts, and render every case in apps/portal/src/pwa/notification.test.ts
- [ ] T038 [US2] Add the organization-free `/account/notifications` route in apps/portal/src/App.tsx showing the push panels from apps/portal/src/alerts/MyNotifications.tsx
- [ ] T039 [US2] Document staff notifications in docs/features/access.md (**Signing up**) and the platform push in docs/features/portal-on-phones.md (**Push**)
- [ ] T040 [US2] Verify pull request 3: rebuild the API family and `portal`; run quickstart 6, 7 and the paused push with a real push in Chrome

**Checkpoint**: staff are told of every sign-up.

---

## Phase 5: User Story 3 - Understand what it costs (P2)

**Goal**: The beta message is on the sign-up page, Home and the billing account page.

**Independent Test**: spec US3's independent test.

- [ ] T041 [P] [US3] In pull request 4: show the free beta message (or the operator message when `free_beta` is off) beside the form in packages/auth/src/SignUpPage.tsx and in apps/portal/src/home/FirstDevicePanel.tsx, read from `GET sign-up`
- [ ] T042 [P] [US3] In pull request 4: add the free beta `Alert` at the top of the Plan panel in apps/portal/src/billing/BillingAccountsPage.tsx, keeping *No plan*, and cover it in apps/portal/e2e/sign-up.spec.ts
- [ ] T043 [US3] In pull request 4: add the free beta setting to docs/features/billing.md

---

## Phase 6: User Story 4 - Platform staff control sign-up (P2)

**Goal**: Super administrators open and close sign-up, set the channels and ceiling,
and see the sign-up list.

**Independent Test**: quickstart scenarios 2, 5, 7 and 9.

### API (pull request 2)

- [x] T044 [P] [US4] Write apps/api/tests/Feature/SignUp/SignUpSettingsTest.php: super administrators read and save; a stale revision answers 409; platform administrators and members get 403; the activity entry names the changed fields; `push_available`, `mail_available` and `my_push_devices` reflect the deployment and the caller
- [x] T045 [P] [US4] Write apps/api/tests/Feature/SignUp/AbuseProtectionTest.php: the hidden field, a missing or unreadable token, under 3 seconds and over 2 hours old are refused with the generic 422 and stored as `refused` with no password; the per-address and per-email limits answer 429 with `retry_after`; the ceiling answers 503 `sign_up_paused`; names with links are refused
- [x] T046 [P] [US4] Write apps/api/tests/Feature/SignUp/PlatformSignUpListTest.php: `manage-organizations` lists newest first with state filter (expired computed) and search; others get 403; no password or token in the response
- [x] T047 [US4] Implement the form token, hidden field and daily ceiling checks in `SignUps::start()` (research R7)
- [x] T048 [US4] Implement apps/api/app/Domain/SignUp/Http/Controllers/SignUpSettingsController.php (super administrators only), Http/Requests/UpdateSignUpSettingsRequest.php (`daily_limit` 1 to 10,000), Http/Resources/SignUpSettingsResource.php, Http/Controllers/PlatformSignUpController.php and Http/Resources/SignUpResource.php, with routes under `v1/admin`
- [x] T049 [US4] Add `capabilities.manage_sign_up` to `GET me`, and `signUpSettings`, `updateSignUpSettings` and `signUps` to packages/api-client

### Admin (pull request 5)

- [ ] T050 [P] [US4] Build apps/admin/src/pages/SignUpSettingsPage.tsx like BillingSettingsPage: **Sign-up** panel (**Allow sign-up**, **Free beta**, **Daily limit** with today's count) and **Notify super administrators** panel (**Push**, **Email**, each saying when it can't work here, the caller's push device count and a link to the portal's `/account/notifications`), revision, discard guard and conflict
- [ ] T051 [P] [US4] Build apps/admin/src/pages/SignUpsPage.tsx with `CollectionPage` + `DataTable`: Person, Email, Organization (linked once completed), State (`Status`, new kit statuses `waiting`, `expired`, `completed`, `refused` in packages/ui with a story if added), Started (`RelativeTime`); state filter and search
- [ ] T052 [US4] Route and navigate both pages in apps/admin/src/App.tsx, apps/admin/src/layout/AdminLayout.tsx and apps/admin/src/lib/access.ts (`manage_sign_up` for settings, `manage_organizations` for the list)
- [ ] T053 [US4] Write apps/admin/e2e/sign-up-settings.spec.ts: save, conflict, unavailable channels, no push device, the list and its filter, and a platform administrator without super administrator rights
- [ ] T054 [US4] Verify pull request 5: rebuild `admin`; run quickstart 2, 5, 7 and 9

---

## Phase 7: Landing call to action and polish (pull request 6)

- [ ] T055 [P] Add `features.self_sign_up` to apps/docs/hosted-release.json and apps/docs/schemas/hosted-release.schema.json, false until the pilot runs pull request 4
- [ ] T056 Add **Start free** (`${docsConfig.portalUrl}/sign-up`) as the hero's first action in apps/docs/src/pages/index.astro, to the header in apps/docs/src/components/docs/SocialIcons.astro and to apps/docs/src/components/landing/LandingFooter.astro, only with the switch on; start the quickstart from signing up
- [ ] T057 Update apps/docs/tests/e2e/landing.spec.ts and apps/docs/tests/e2e/chrome.spec.ts for both switch values
- [ ] T058 [P] Note in docs/ops/release.md that sign-up stays closed after an upgrade until a super administrator opens it and needs working mail, and that `features.self_sign_up` and `DOCS_HOSTED_REF` move after the pilot runs pull request 4
- [ ] T059 Verify pull request 6: `pnpm --filter @iot-os/docs build` with the switch on and off; the landing page in the browser pane
- [ ] T060 Run `/speckit-converge` after the last pull request merges and freeze the folder

---

## Dependencies & Execution Order

- **Pull request 1** (T001–T003) first.
- **Pull request 2** (T004–T024, T044–T049) after 1: foundations, US1 API and US4 API.
- **Pull requests 3** (T032–T040) **and 4** (T025–T031, T041–T043) after 2, in
  parallel: they touch different files except apps/portal/src/App.tsx, where 3 adds
  one route and 4 adds two; whichever merges second rebases.
- **Pull request 5** (T050–T054) after 3, since the settings page shows push devices
  and the portal link.
- **Pull request 6** (T055–T060) after 4.

Within pull request 2: T004–T010 first; the tests T011–T015 and T044–T046 in parallel;
then T016–T019 and T047–T048; T022 after the routes exist.

## Parallel Example: pull request 2

```text
Tests together: T011, T012, T013, T014, T015, T044, T045, T046
Then: T020 and T021 beside T016–T019
```

## Implementation Strategy

- **MVP**: pull requests 1, 2 and 4 give a working sign-up (US1, US3) with
  notifications held back. Sign-up stays closed until staff open it, so nothing reaches
  the public early.
- **Then**: 3 (staff push), 5 (admin pages), 6 (landing).
- Nothing ships to the pilot without the owner's approval.
