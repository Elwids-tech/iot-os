---

description: "Tasks for spec 033, installable portal and push alerts"
---

# Tasks: Installable Portal and Push Alerts

**Input**: Design documents from `/specs/033-pwa-web-push/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: included. The constitution requires isolation tests for tenant data (III),
contract fixtures (IV) and verification in the rebuilt stack (IX). API tests run on
PostgreSQL only.

**Organization**: phases follow the six pull requests in the plan's **Delivery**
section. Each pull request is based on `main`, opened after the one it depends on
merges, and never stacked. Story labels map tasks to the spec's user stories. Kept
sign-in (FR-011a) is labelled US2, because it serves tapping a push when signed out.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 to US5 from [spec.md](spec.md)
- Paths are from the repository root.

---

## Phase 1: Documents (pull request 1)

**Purpose**: merge the spec, plan, tasks and ADR before any code. Merging accepts the
plan.

- [ ] T001 Run `/speckit-analyze` on `specs/033-pwa-web-push/` and fix every finding in `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/*.md`, `quickstart.md` and `tasks.md`
- [ ] T002 Confirm `ADR-047` is still free: list `docs/adr/` on `main` and on every local and remote branch (`git for-each-ref` then `git ls-tree`). If it is taken, renumber `docs/adr/ADR-047-progressive-web-app-before-native-apps.md` and every reference in `docs/adr/README.md`, `docs/roadmap.md` and `specs/033-pwa-web-push/`
- [ ] T003 Branch `spec/033-pwa-web-push` from `main`. Commit only `specs/033-pwa-web-push/`, `docs/adr/ADR-047-progressive-web-app-before-native-apps.md`, `docs/adr/README.md` and `docs/roadmap.md`, leaving the unrelated `docs/hardware/waveshare-audio-board.md` and `.vscode/` alone. Open the documents pull request

**Checkpoint**: documents merged; pull requests 2, 3 and 4 may start in parallel.

---

## Phase 2: Foundational, phone rules in the kit (opens pull request 2)

**Purpose**: the shared phone rules that US1 and US4 build on. All of them apply below
768 px (`max-md:`), so no class changes at `md` and up.

- [x] T004 [P] Phone sizing in `packages/ui/src/components/button.tsx` (every size, plus `max-md:min-w-11`; inline link buttons exempt), `input.tsx`, `select.tsx` (`SelectTrigger` and `SearchableSelect`), `toggle.tsx`, `tabs.tsx`, `input-group.tsx`, the sidebar's menu rows, `switch.tsx`, `checkbox.tsx` and `radio-group.tsx` (hit area, the `after` box, not the track or box) and `textarea.tsx` (its `min-h-16` is already above 44 px): `max-md:min-h-11` (44 px) on interactive controls and `text-base` below `md` (16 px) on text inputs, so iOS does not zoom on focus. Phone and computer stories in `Button.stories.tsx` cover the buttons and the input; Storybook's preview gains Phone, Small phone and Computer viewports
- [x] T005 [P] `packages/ui/src/components/page-header.tsx`: below 768 px an app bar (menu, back, a title of up to three lines and the trigger slot on the first row; meta and actions under it), and one action stays in view, the primary `Button` (default variant) or else the first, and the others go into a popover behind an icon button named "More actions". It is a popover, not a `DropdownMenu`, because actions are buttons rather than menu items; choosing one closes it unless the action opens its own dialog or menu, which opens above it. The trigger slot (bell, Assistant, Help) and `SidebarTrigger` stay visible. `apps/storybook/src/components/PageHeader.stories.tsx` has phone and computer viewports
- [x] T006 [P] `packages/ui/src/templates/collection-page.tsx`: new `filters?: ReactNode`, `activeFilterCount?: number` and `onResetFilters` props. Filters render inline at `md` and up, and below 768 px inside a bottom `Sheet` opened by **Filters** with the count when above zero. The sheet is a new kit component, `packages/ui/src/components/filter-sheet.tsx` (`FilterSheet`, story `FilterSheet.stories.tsx`), which `DataTable` also uses for its own filters on phones. `apps/storybook/src/templates/CollectionPage.stories.tsx` gains computer and phone stories with filters
- [x] T007 [P] `packages/ui/src/components/notification-bell.tsx`: below 768 px the popover is `calc(100vw - 1rem)` wide with `max-h-[80dvh]` and scrolls inside. Phone story in `apps/storybook/src/components/NotificationBell.stories.tsx`
- [x] T008 [P] `packages/ui/src/styles/globals.css`: under `html.standalone`, `env(safe-area-inset-top|right|bottom|left)` padding on the sidebar sheet, the page header, bottom sheets and sticky bottom bars (`[data-sticky-bar]`, now on the sticky bars in `forms.tsx`, notification settings, new ticket, device configuration and the Alerts bulk bar)
- [x] T009 `packages/ui/scripts/check-ui.mjs`: a rule, `phone-target`, that interactive kit components (`button`, `input`, `select`) carry `max-md:min-h-11`, `switch` its 44 px hit area and `textarea` a minimum of at least 44 px, with a message naming the Phones section (depends on T004). It reads the kit's sources, so every app's lint runs it
- [x] T010 [P] `docs/dev/design-system.md`: a **Phones** section covering the 768 px breakpoint, 44 px targets, 16 px inputs, header overflow, the filter sheet, full-width panels, safe areas, and that rules apply only under `max-md`

**Checkpoint**: kit stories render at 375 px; `pnpm --filter @iot-os/ui test` and the Storybook accessibility addon pass.

---

## Phase 3: User Story 1, act on an alert from a phone (Priority: P1) 🎯 MVP

**Goal**: from an alert email link on a phone, sign in, read, acknowledge, assign and
comment, and browse alerts, all without zooming or sideways scrolling.

**Independent Test**: at 360 px, open an alert link signed out, sign in, acknowledge,
assign and comment; open Alerts, filter to active and unacknowledged, open another.

- [x] T011 [US1] Sign-in in `apps/portal/src/App.tsx` (`Login`): the card is full width with 16 px side padding below 768 px; the "Forgot password?" link and the submit button meet 44 px
- [x] T012 [P] [US1] `packages/auth/src/PasswordRecoveryPage.tsx` and `packages/auth/src/AcceptInvitationPage.tsx`: fix any overflow at 320 px (both inherit kit sizing from T004)
- [x] T013 [P] [US1] `apps/portal/src/home/HomePage.tsx`: below 768 px the summary is compact tiles two to a row and the panels stack in one column, with nothing wider than the screen
- [x] T014 [US1] Alerts list in `apps/portal/src/alerts/Alerts.tsx`:
  - below 768 px the filters (`condition`, acknowledgement, assignee, kind, view) move into a bottom `FilterSheet` behind **Filters (n)**, offering every filter the computer layout has;
  - the bulk **Acknowledge selected** bar moves to the foot of the list and sticks to the bottom of the screen with `ref={keepToastsAbove}` (the list panel clips with `overflow-clip` so it can stick).
- [x] T015 [US1] Alert detail (`AlertDetail` in `apps/portal/src/alerts/Alerts.tsx`):
  - below 768 px the facts `<dl>` reads as label and value rows, the timeline is one column, the assignee `SearchableSelect` is full width, and **Acknowledge alert** sits in a bar stuck to the bottom of the screen;
  - the email deliveries `Table` becomes a `DataTable` with columns recipient (`mobile: "title"`, with the diagnostic and **Retry email** under it on phones), email, status (`"badge"`), attempts and last attempt (`"meta"`), and **Retry email** for failed rows;
  - the not-found state (404, or 403 once access is lost) reads *This alert isn't available* and shows nothing about the alert.
- [x] T016 [P] [US1] `apps/portal/src/help/HelpPanel.tsx`: the Help and Assistant `Sheet` is full width below 768 px (FR-005)
- [x] T017 [P] [US1] `apps/portal/src/devices/DeviceDirectory.tsx`: its filters are `DataTable` filters, which open in the same `FilterSheet` on phones (T006), so the page needed no change; `phone.spec.ts` checks its sheet
- [x] T018 [US1] `apps/portal/e2e/phone.spec.ts` with route mocks:
  - **Helpers**: `expectPhoneFit(page)` asserts `document.scrollingElement.scrollWidth <= innerWidth`, and that every visible `button`, `[role=button]`, `input`, `select` and `textarea` is at least 44 × 44 px.
  - **Viewports**: run each case at 320, 360 and 390 px, and once more at 360 px with the root font size at 200% (`document.documentElement.style.fontSize = "200%"`), which still passes `expectPhoneFit` apart from text wrapping (spec edge case: large text).
  - **Cases**: a signed-out alert link renders sign-in and then the alert at the same path; acknowledge, assign and comment post the right requests; the filters sheet holds every filter; the menu, organization switcher, bell and user menu are reachable from Alerts, alert detail, Devices and Home; a member who can only view devices sees no acknowledge, assign or comment controls.

**Checkpoint**: US1 works at phone width against the mocked API.

---

## Phase 4: User Story 4, check a device and its dashboards from a phone (Priority: P2)

**Goal**: from an alert, see the device's status, last report and latest readings,
then read a dashboard top to bottom.

**Independent Test**: at phone width, go from an alert to its device, read status and
readings with ages, open a dashboard and read every widget by scrolling down only.

- [x] T019 [US4] `apps/portal/src/devices/DeviceOverview.tsx`: below 768 px the order is status and last seen, `LatestReadout` with ages, active alerts, then Location, Details, Connectivity, Physical installation, Used in and Recent commands
- [x] T020 [US4] `apps/portal/src/dashboards/DashboardWorkspace.tsx`: below 768 px the **Edit** button is not rendered; in its place **More actions** shows *Editing needs a larger screen* (`text-meta`), and the header scrolls with the page. A `location.state.edit` arriving at phone width does not enter edit mode. The desktop header is unchanged
- [x] T021 [US4] `apps/portal/src/dashboards/model.ts` (`responsiveLayouts`, with a `phone` option that `DashboardGrid` passes below 768 px): in the `xs` and `xxs` layouts, panels keep the computer layout's reading order (by `y`, then `x`) and get minimum heights by widget kind (`PHONE_MIN_ROWS`): stat 3 rows, chart and map 6 rows, table and alert list 8 rows. Only phones get it: a computer's dashboard grid can be one column too (a 1024 px window with the sidebar open), and its layouts stay as saved. A table widget scrolls sideways inside its panel (`apps/portal/src/dashboards/DashboardGrid.tsx` or the table widget). Unit cases in `apps/portal/src/dashboards/model.test.ts`
- [x] T022 [P] [US4] `apps/portal/src/dashboards/TimeControls.tsx`: below 768 px the presets, compare, refresh and auto-refresh collapse into one button that opens the existing range `Popover` holding them all
- [x] T023 [P] [US4] `apps/portal/src/dashboards/LibraryPage.tsx`: the dashboards list is usable at 320 px (cards via `DataTable` `mobile` options or stacked panels)
- [x] T024 [US4] Extend `apps/portal/e2e/phone.spec.ts`:
  - device detail shows status, last seen, readings and alerts before other sections;
  - a dashboard renders one column in reading order with no **Edit**;
  - a table widget scrolls inside itself while the page passes `expectPhoneFit`;
  - at 1280 px the dashboard's panel positions equal those from the computer layout fixture (SC-008).

**Checkpoint**: US1 and US4 complete; pull request 2's code is done.

---

## Phase 5: Finish pull request 2 (phone layouts)

- [x] T025 [P] `docs/features/portal-on-phones.md` (new): which pages work at phone width, what stays desktop-only (editing dashboards, automations, profiles and adapters), and the filter sheet. Link it from `docs/README.md` beside the other feature docs
- [x] T026 Verify pull request 2 (done 2026-11-16: no Android phone was connected, so the walk used Playwright's mobile emulation against the rebuilt stack, plus the browser pane, whose hidden state renders at its own width until a frame is forced):
  - `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/admin lint`, `pnpm --filter @iot-os/portal test`, `pnpm --filter @iot-os/ui test`, all portal Playwright specs (existing desktop specs unchanged: SC-008), `./taskw lint`;
  - rebuild `portal admin` with the stack's env files and overlays ([local setup](../../docs/dev/local-setup.md#rebuild-one-service));
  - in the browser pane at the `mobile` preset, without discarding anyone's unsaved edits, walk US1 and US4, and time SC-001 (already signed in: from opening an alert link to acknowledged, under 30 s);
  - repeat on an Android phone over `adb reverse tcp:5173 tcp:5173` and `adb reverse tcp:8001 tcp:8001`;
  - reset the pane to `desktop` afterwards.

---

## Phase 6: User Story 3, install the portal as an app (Priority: P2), pull request 3

**Goal**: the portal installs to the home screen, opens standalone with its own name
and icon, shows an offline screen without data when offline, never queues actions, and
runs a new release no later than its next launch.

**Independent Test**: install on Android and from the iPhone steps; open offline and
see only the offline screen; deploy a new build and see **Reload**, then the new
version on relaunch.

- [x] T027 [US3] `apps/portal/package.json`: add `vite-plugin-pwa` ^2.0, `workbox-precaching`, `workbox-routing`, `workbox-strategies` and `workbox-window` ^7.4, and dev `@vite-pwa/assets-generator`. Run `pnpm install` and commit the lockfile
- [x] T028 [P] [US3] App icon:
  - `apps/portal/icons/app-icon.svg`: the chip glyph from lucide `Cpu` (ISC licence, noted in a comment), white on the brand navy, with a 20% safe zone for the maskable variant;
  - `apps/portal/pwa-assets.config.ts` and a `"icons"` script in `apps/portal/package.json`;
  - generate and commit `apps/portal/public/pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png` and `apple-touch-icon-180x180.png`.
- [x] T029 [US3] `apps/portal/vite.config.ts`: `VitePWA` with:
  - `strategies: "injectManifest"`, `srcDir: "src"`, `filename: "sw.ts"`, `registerType: "prompt"`, `injectRegister: false`, `devOptions.enabled: false`;
  - `manifest`: `name` and `short_name` "IoT OS", `id` "/", `start_url` "/", `scope` "/", `display` "standalone", `background_color` and `theme_color` from the kit's light tokens, and the icons from T028 (maskable marked `purpose: "maskable"`);
  - `injectManifest.globPatterns: ["**/*.{js,css,html,woff2,png,svg}"]` and `globIgnores: ["runtime-config.js"]`;
  - `define: { __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? <short git commit or build time>) }`.
- [x] T030 [US3] `apps/portal/src/sw.ts`, plus a worker tsconfig with `lib: ["webworker"]` (`apps/portal/tsconfig.sw.json`, referenced by the build):
  - `precacheAndRoute(self.__WB_MANIFEST)` and `cleanupOutdatedCaches()`;
  - a `NavigationRoute` to `createHandlerBoundToURL("/index.html")` with `denylist: [/^\/connect\/?$/]`, so `/connect` keeps nginx's `frame-ancestors` headers;
  - a `NetworkFirst` route for `/runtime-config.js` in cache `runtime-config`;
  - a `message` handler calling `self.skipWaiting()` on `{ type: "SKIP_WAITING" }`;
  - no other route, so nothing on the API host is ever cached (R3).
- [x] T031 [P] [US3] `apps/portal/index.html`:
  - two `theme-color` metas with `media="(prefers-color-scheme: light|dark)"` and the kit's background tokens;
  - `<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">`;
  - `viewport` gains `viewport-fit=cover`;
  - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`;
  - `<meta name="build-id">`, filled from `__BUILD_ID__` at start by `apps/portal/src/main.tsx`, so tests can tell versions apart.
- [x] T032 [P] [US3] `deploy/docker/portal/nginx.conf` (new, from `deploy/docker/admin/nginx.conf`):
  - add `location = /sw.js` and `location = /manifest.webmanifest`, each with `Cache-Control: no-cache` and `try_files $uri =404`, and `types { application/manifest+json webmanifest; }` for the manifest;
  - keep `/runtime-config.js` `no-store`, `/assets/` immutable, `/connect` headers and the `/` SPA fallback;
  - `deploy/docker/portal/Dockerfile` copies this file instead of the admin one.
- [x] T033 [P] [US3] `packages/api-client/src/connection.ts`, exported from `packages/api-client/src/index.ts`. Unit tests in `packages/api-client/src/connection.test.ts` with fake timers.
  - **The store**: state `online | offline`, `since`, `lastSuccessAt`; `subscribe()`; starts from `navigator.onLine` and listens to `online`/`offline`; `reportNetworkFailure()` and `reportSuccess()`.
  - **The probe**: `fetch(apiUrl + "/up", { mode: "no-cors", cache: "no-store" })` every 5 s while offline and the page is visible. While online, every 10 s only when the page is visible and no request succeeded in the last 10 s.
  - **`ApiClient.request`**: a network `TypeError` reports failure and throws `ApiError(0, { message: "network" })`; any response reports success.
- [x] T034 [P] [US3] Kit components, each with a story under `apps/storybook/src/components/`, exported from the kit:
  - `packages/ui/src/components/connection-notice.tsx`: a banner under the page header reading *You're offline. Values are from {time}.*, with `role="status"` and `RelativeTime`;
  - `packages/ui/src/components/offline-screen.tsx`: a full-page `Panel` reading *You're offline. Alerts and readings need a connection.*, with **Try again**.
- [x] T035 [US3] `apps/portal/src/main.tsx`: `onlineManager.setEventListener` from the connection store; the `QueryClient` default `mutations.networkMode: "always"`; render `<UpdatePrompt />` (T039) beside the Toaster in production builds only (depends on T033)
- [x] T036 [US3] App shell in `apps/portal/src/App.tsx`:
  - render `ConnectionNotice` under every page header while offline;
  - render `OfflineScreen` when the first `/me` fails with `ApiError(0)`, and retry when the store goes online;
  - add the `standalone` class to `<html>` when `matchMedia("(display-mode: standalone)")` matches or `navigator.standalone` is true.

  Depends on T033 and T034.
- [x] T037 [P] [US3] `apps/portal/src/components/forms.tsx` `errorMessage`: `ApiError` status 0 reads *You're offline. Nothing was saved.*
- [x] T038 [P] [US3] Installing:
  - `apps/portal/src/pwa/install.ts`: capture `beforeinstallprompt` at module load, plus `canPrompt()`, `prompt()`, `standalone()` and `iosSafari()`;
  - `apps/portal/src/pwa/InstallAppDialog.tsx`: the iPhone and iPad steps (Share → **Add to Home Screen**, then open it from the home screen, which signs in separately from Safari), and a fallback pointing to the browser's menu;
  - **Install app** in the user menu in `apps/portal/src/App.tsx`, hidden when `standalone()`.
- [x] T039 [P] [US3] `apps/portal/src/pwa/UpdatePrompt.tsx`: `useRegisterSW({ immediate: true })`; in `onRegisteredSW`, call `registration.update()` every 30 minutes while the page is visible and on every `visibilitychange` to visible. On `needRefresh`, show a persistent sonner toast *A new version is available* with **Reload**, which calls `updateServiceWorker(true)`
- [x] T040 [US3] `apps/portal/src/pwa/personal-state.ts`:
  - grep `localStorage` and `sessionStorage` across `apps/portal/src` and `packages/*/src`, and list every key as personal (for example `iot-os.selected-organization`, `iot-os:last-organization:{userId}`) or per-browser (the bell's sound switch, the theme);
  - `clearPersonalState()` clears the TanStack Query cache, `sessionStorage` and the personal keys;
  - call it on sign-out in `apps/portal/src/App.tsx` before navigating to `/`.
- [x] T041 [P] [US3] Vitest: `apps/portal/src/pwa/install.test.ts` (standalone, iOS Safari and Chromium detection from stubbed `navigator` and `matchMedia`) and `apps/portal/src/pwa/personal-state.test.ts` (personal keys removed, per-browser keys kept, throwing storage tolerated)
- [x] T042 [US3] PWA end-to-end tests:
  - set `serviceWorkers: "block"` in `apps/portal/playwright.config.ts`, so mocked specs stay unaffected;
  - add `apps/portal/playwright.pwa.config.ts`, whose `webServer` builds and runs `vite preview` on port 4174 with service workers allowed;
  - `apps/portal/e2e/installable.spec.ts` checks: the manifest's fields and icons load; the worker activates; Cache Storage holds no API-host URL; offline then reload shows `OfflineScreen` and no earlier data; going offline on an open page shows `ConnectionNotice` within 10 s; **Acknowledge** offline shows the offline message and sends no request after `setOffline(false)`;
  - SC-006, automated: with build `BUILD_ID=a` served and the worker active, rebuild into the served `dist` with `BUILD_ID=b`; trigger `registration.update()` and expect the **Reload** toast; close every page, open a new one and expect `meta[name=build-id]` to be `b`.
- [x] T043 [P] [US3] Docs:
  - `docs/features/portal-on-phones.md`: installing, offline behaviour, updates;
  - `docs/dev/gotchas.md`: the SPA fallback answers a missing `/sw.js` with HTML; TanStack Query pauses offline mutations unless `networkMode: "always"`; an installed iOS app has its own storage and sign-in; iOS zooms on inputs under 16 px.
- [x] T044 Verify pull request 3:
  - run the T026 checks, plus `pnpm --filter @iot-os/portal exec playwright test -c playwright.pwa.config.ts`;
  - rebuild `portal admin`;
  - in the running portal, walk quickstart US3 steps 1 to 5 in desktop Chrome, then install and go offline on the Android phone;
  - check `curl -I http://localhost:5173/sw.js` shows `no-cache` and that `/nope.js` returns 404 only for the worker paths.

**Checkpoint**: US3 complete; the worker carries no push handlers yet.

---

## Phase 7: Keep me signed in (FR-011a, serves US2), pull request 4

**Goal**: one browser or installed app stays signed in for 30 days when asked.
Sign-out, a password reset or removing the device ends it.

**Independent Test**: sign in with **Keep me signed in**, lose the session cookie, and
make a request: it resumes. Sign out on another device: this one stays. Reset the
password: all end.

- [x] T045 [US2] Migration `apps/api/database/migrations/2026_11_21_000000_create_kept_sign_ins.php`:
  - `id` bigint PK;
  - `uuid` uuid unique;
  - `user_id` bigint FK `users`, cascade on delete, indexed;
  - `secret_hash` char(64), "SHA-256 of the cookie's secret; the secret is never stored";
  - `label` varchar(120);
  - `created_at` timestamptz;
  - `expires_at` timestamptz, indexed, "`created_at` + 30 days; never extended";
  - `last_used_at` timestamptz null;
  - `ended_at` timestamptz null;
  - `end_reason` varchar(32) null, one of `signed_out`, `password_reset`, `device_removed`.
- [x] T046 [US2] `apps/api/app/Domain/Authentication/Models/KeptSignIn.php`:
  - `scopeLive` (`ended_at` null and `expires_at` > now);
  - `end(string $reason)` (no-op when already ended);
  - `matches(string $secret)` (`hash_equals` on SHA-256);
  - `issue(User $user, string $label): array{0: KeptSignIn, 1: string}`, which returns the record and the plain secret.
- [x] T047 [US2] Sign-in in `apps/api/app/Domain/Authentication/Http/Requests/LoginRequest.php` and `Http/Controllers/SessionController.php`:
  - `LoginRequest` accepts `remember` (`sometimes|boolean`);
  - `SessionController::store`, when `remember` is true and the attempt succeeded, issues a record after `regenerate()`, puts `kept_sign_in_id` in the session, and queues cookie `iot_kept` with value `{uuid}.{secret}`;
  - the cookie lasts 43200 minutes, is HttpOnly, and takes `secure`, `same_site` and `domain` from `config('session.*')`;
  - the label is built from the `User-Agent` and cut at 120 characters.
- [x] T048 [US2] Middleware `apps/api/app/Domain/Authentication/Http/Middleware/ResumeKeptSignIn.php`, appended to the `api` group in `apps/api/bootstrap/app.php` after `statefulApi()`:
  - **Scope**: acts only on stateful frontend requests (`EnsureFrontendRequestsAreStateful::fromFrontend`), never on Passport or application tokens.
  - **Resume**: with no session user and an `iot_kept` cookie whose record is live and matches, log in on `web`, `regenerate()` the session, and put `kept_sign_in_id`. Store the password hash the way `vendor/laravel/sanctum/src/Http/Middleware/AuthenticateSession.php` stores `password_hash_web`, and stamp `last_used_at` when it is null or older than 60 s.
  - **End**: with a session `kept_sign_in_id` whose record is not live, log out on `web`, invalidate the session and forget the cookie.
  - **Octane**: no static state.
- [x] T049 [US2] `SessionController::destroy` ends the session's record with `signed_out` and queues `Cookie::forget('iot_kept')` with the same domain
- [x] T050 [US2] `apps/api/app/Domain/Authentication/Http/Controllers/PasswordRecoveryController.php` `reset`: inside its transaction, end every live record of the user with `password_reset`
- [x] T051 [P] [US2] `apps/api/app/Domain/Authentication/Console/PruneKeptSignIns.php` (`auth:prune-kept-sign-ins`): deletes rows ended or expired more than 30 days ago, in chunks. Register it in `apps/api/bootstrap/app.php` and schedule it daily in `apps/api/routes/console.php`
- [x] T052 [US2] `apps/api/tests/Feature/Domain/Authentication/KeptSignInTest.php`:
  - login with `remember` sets the cookie and a live record, and without it sets neither;
  - a request with only the cookie resumes and refreshes `last_used_at`;
  - an expired record does not resume, and the 30 days are not extended by use;
  - a wrong secret or another user's uuid does not resume;
  - an ended record logs the session out on its next request;
  - signing out ends only that record, while another device's record stays live;
  - a password reset ends all of them;
  - a Passport token request ignores the cookie;
  - the prune deletes rows ended or expired 31 days ago and keeps 29.
- [x] T053 [P] [US2] Contract and client:
  - `remember` in `contracts/openapi/supplements/account.yaml` for `POST v1/auth/login`;
  - `php artisan contract:export` and `contract:check --base=origin/main` pass;
  - `packages/api-client/src/index.ts` `login({ email, password, remember? })`.
- [x] T054 [US2] Portal checkbox, wired to `api.login`:
  - in `apps/portal/src/App.tsx`, `Login` and `SessionRecovery` get a **Keep me signed in** checkbox, off by default;
  - the hint below it reads *Don't tick this on a shared device.*;
  - the admin app's sign-in gets no checkbox.
- [x] T055 [P] [US2] `apps/portal/e2e/kept-sign-in.spec.ts` with route mocks: the login body has `remember: true` only when ticked; the checkbox meets 44 px at 360 px
- [x] T056 [P] [US2] Docs:
  - `docs/features/access.md`: a **Keep me signed in** subsection under Signing in (30 days, what ends it, shared with the admin app, shared devices);
  - `docs/dev/gotchas.md`: Laravel's remember token is one per user and logout cycles it.
- [x] T057 Verify pull request 4:
  - `cd apps/api && php artisan test --compact` on PostgreSQL, plus the portal and admin lint and tests;
  - rebuild `api automation-worker default-worker alerts-worker webhooks-worker assistant-worker scheduler portal admin`, then run `php artisan migrate --force` in `api`;
  - run the quickstart's kept sign-in steps 1 to 3;
  - check the admin app still signs in and out normally.

**Checkpoint**: kept sign-ins work alone; pull request 5 may start once this and pull request 3 have merged (its verification subscribes through pull request 3's service worker).

---

## Phase 8: User Story 2 and User Story 5, push delivery in the API, pull request 5

**Goal**: pushes reach exactly the bell's recipients, filtered by their levels and
organization switches, with per-device results, bursts folded into summaries, and a
key every release keeps.

**Independent Test**: register a subscription made in desktop Chrome's DevTools
through `POST v1/notifications/push/devices`, trigger an alert, and see one push
delivery row, one attempt row per device, and a push reach Chrome.

### Setup for pull request 5

- [x] T058 [US2] Spike:
  - `composer require laravel-notification-channels/webpush:^13.0` in `apps/api`;
  - read `vendor/laravel-notification-channels/webpush/src/WebPushChannel.php` and its events, and decide whether each subscription's outcome (status code, expired or not) reaches us;
  - record the answer and the chosen path (the channel, or the package's configured `Minishlink\WebPush\WebPush` with `MessageSentReport`) in `specs/033-pwa-web-push/research.md` R12.
- [x] T059 [US2] Configuration:
  - publish and edit `apps/api/config/webpush.php` so `vapid.public_key`, `vapid.private_key` and `vapid.subject` read `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY` and `WEBPUSH_VAPID_SUBJECT`;
  - add the three keys, empty, to `apps/api/.env.example`, to the `&api-environment` anchor in `deploy/compose/compose.app.yml`, and to `x-api-env` in `deploy/release/compose.yml`;
  - add `apps/api/app/Domain/Notifications/Services/WebPush.php` with `enabled()`, true only when both halves are filled.
- [x] T060 [P] [US2] Release tooling in `tooling/release/manage.py`:
  - `webpush_keys()` makes an EC P-256 pair with `openssl` through `subprocess`, as `passport_keys()` does, and encodes both halves base64url without padding (public: uncompressed 65-byte point; private: 32-byte scalar);
  - `init` writes the pair plus `WEBPUSH_VAPID_SUBJECT=mailto:` and the ACME email;
  - a `webpush-keys` command adds the pair only when both halves are missing, and refuses if exactly one is present;
  - `validate()` fails on exactly one half and warns, naming `webpush-keys`, when both are missing;
  - `restore()` compares the pair when the backup had one;
  - `smoke()` fetches `https://app.<domain>/manifest.webmanifest` and parses JSON.

  Also add the three keys, empty, to `deploy/release/environment.example`, add tests in `tooling/release/test_release.py` for each behaviour, and document the private inputs and the new command in `docs/ops/release.md`.

### Data for pull request 5

- [x] T061 [P] [US2] Migration `apps/api/database/migrations/2026_11_21_000100_create_push_devices.php`:
  - `id` bigint PK;
  - `uuid` uuid unique;
  - `user_id` bigint FK `users`, cascade on delete, indexed;
  - `endpoint` text (encrypted in the model);
  - `endpoint_hash` char(64) unique;
  - `public_key` text (encrypted in the model; "Encrypted columns are `text`", since `varchar(255)` is too short for the ciphertext);
  - `auth_token` text (encrypted in the model);
  - `content_encoding` varchar(16), default `aes128gcm`;
  - `label` varchar(60);
  - `kept_sign_in_id` bigint FK `kept_sign_ins`, null on delete;
  - `session_id` text null;
  - `created_at` timestamptz;
  - `last_synced_at` timestamptz;
  - `last_reached_at` timestamptz null;
  - `last_failed_at` timestamptz null;
  - `last_failure` varchar(255) null.
- [x] T062 [P] [US5] Migration `apps/api/database/migrations/2026_11_21_000200_add_push_preferences.php` on `notification_preferences`: `push_enabled` boolean default false, `push_levels` jsonb null, `push_revision` integer default 0
- [x] T063 [P] [US5] Migration `apps/api/database/migrations/2026_11_21_000300_create_push_organization_mutes.php`: `user_id` FK `users` cascade, `organization_id` FK `organizations` cascade, `created_at` timestamptz, primary key (`user_id`, `organization_id`)
- [x] T064 [P] [US2] Migration `apps/api/database/migrations/2026_11_21_000400_add_push_delivery_columns.php`:
  - `automation_alert_deliveries` gains `devices_total` and `devices_reached` smallint null;
  - `automation_alert_delivery_attempts` gains `device_label` varchar(60) null and `response_status` smallint null.
- [x] T065 [P] [US2] Migration `apps/api/database/migrations/2026_11_21_000500_create_push_summaries.php`:
  - `id` bigint PK;
  - `uuid` uuid unique;
  - `user_id` FK `users` cascade;
  - `organization_id` FK `organizations` cascade;
  - `window_started_at` timestamptz ("When the first delivery joined it");
  - `window_ends_at` timestamptz (`window_started_at` + 60 s; open while in the future);
  - `alert_count` integer;
  - `status` varchar(16), one of `pending`, `sent`, `failed`, `cancelled`;
  - `attempts` smallint default 0;
  - `cycle_attempts` smallint default 0;
  - `devices_total` and `devices_reached` smallint null;
  - `sent_at` timestamptz null;
  - `diagnostic` varchar(255) null;
  - timestamps;
  - unique (`user_id`, `organization_id`, `window_started_at`);
  - in the same migration, after the table: `automation_alert_deliveries.push_summary_id` bigint null, FK `push_summaries`, null on delete, indexed.
- [x] T066 [US2] Models:
  - `apps/api/app/Domain/Notifications/Models/PushDevice.php`: encrypted casts on `endpoint`, `public_key`, `auth_token` and `session_id`; all four in `$hidden`; `forEndpoint(string)` by SHA-256.
  - `apps/api/app/Domain/Notifications/Models/PushSummary.php`.
  - In `apps/api/app/Domain/Automation/Models/AlertDelivery.php`: `PUSH = 'push'` and `SUMMARISED = 'summarised'`.

  Depends on T061 to T065.

### Services for pull request 5

- [x] T067 [US5] `apps/api/app/Domain/Notifications/Services/Preferences.php`:
  - `push(User)` returns `enabled`, `levels` and `revision`;
  - `enablePushDefaults(User)` creates the row if missing, sets `push_enabled` true and, when `push_levels` is null, `{"critical":true,"warning":true,"info":true,"recovery":false}`;
  - `pushAllows(User, Organization, string $level)` is `push_enabled && push_levels[level] && no mute row`.
- [x] T068 [US2] `apps/api/app/Domain/Notifications/Services/PushSender.php` (on the path chosen in T058):
  - `send(PushDevice, array $payload, array $headers): PushResult` with `outcome` one of `accepted`, `gone` (404, 410, or 403 for a key mismatch), `rejected` (other 4xx) or `transport_failed` (5xx, 429 or no response), plus `status`;
  - headers `TTL: 86400`, `Urgency` and `Topic` per [contracts/push-payload.md](contracts/push-payload.md);
  - stamps `last_reached_at` or `last_failed_at` and `last_failure`, and deletes the device on `gone`.
- [x] T069 [P] [US2] Payload:
  - `apps/api/app/Domain/Notifications/Services/AlertPushPayload.php` with `activated`, `cleared`, `summary` and `test` builders per [contracts/push-payload.md](contracts/push-payload.md);
  - names are cut at 120 characters, the body stays under 2 KB, and `url` is `/organizations/{org}/alerts/{alert}`, or the Alerts list with `condition=active&acknowledged=0` for a summary;
  - add `contracts/push/v1/alert-push.v1.schema.json`, `alert-push.v1.fixture.json` (an activation) and `alert-push.v1.cases.json` (activated, cleared, summary, test, no device, and invalid cases), following the repository's contract layout, and an entry in `contracts/README.md`.
- [x] T070 [US2] `apps/api/app/Domain/Automation/Services/AlertRecipientCheck.php`:
  - move the checks from `apps/api/app/Domain/Automation/Jobs/DeliverAlertEmail.php` lines 49 to 89 (generation fence, terminal status, workflow alert, access, preferences, subscription, execution, cleared, pending release, replaced execution) into it, returning a verdict (`send`, `cancel` with reason, or `release` with delay);
  - `DeliverAlertEmail` uses it with no behaviour change, and every existing email test passes unchanged;
  - add `forPush()`: email preferences are replaced by `Preferences::pushAllows` (level `warning` for activations, `recovery` for clears), and it cancels when the person has no device.
- [x] T071 [US2] `apps/api/app/Domain/Automation/Services/AlertProjector.php`: inside the `$delivery->wasRecentlyCreated` branch that writes the bell row, for a recipient with `push_enabled` and at least one device, `AlertDelivery::firstOrCreate([..., 'channel' => AlertDelivery::PUSH])`. When it is new, `DeliverAlertPush::dispatch($push->uuid)->onConnection('alerts')->onQueue('alerts')`, in the same transaction
- [x] T072 [US2] `apps/api/app/Domain/Automation/Jobs/DeliverAlertPush.php`:
  - **Settings**: `$tries = 0`, `$timeout = 30`, `retryUntil` 24 h, backoff `[10, 30, 120, 600]` as email.
  - **Checks**: lock the delivery, then run `AlertRecipientCheck::forPush()`.
  - **Bursts**: apply the rule from T073.
  - **Sending**: build the payload and send to each of the person's devices through `PushSender`.
  - **Records**: write one `automation_alert_delivery_attempts` row per device with `device_label` and `response_status`, and set `devices_total`, `devices_reached`, `attempts` and `cycle_attempts`.
  - **Outcome**: `sent` with `sent_at` when any device accepted. When none accepted and some failed transiently, retry until `cycle_attempts` reaches 5, then `failed`. When every device is gone, `failed` with *No devices left*.
  - **`failed()`**: mirrors email.
- [x] T073 [US2] Bursts (FR-024) in `DeliverAlertPush` and `apps/api/app/Domain/Notifications/Jobs/DeliverPushSummary.php`:
  - **Lock first**: for an activation, inside the job's transaction, lock the person's `notification_preferences` row (`lockForUpdate`), so one person's deliveries are decided one at a time.
  - **Join an open summary**: if a `push_summaries` row for this person and the alert's organization has status `pending` and `window_ends_at` > now, set this delivery to `summarised` with `push_summary_id` and stop.
  - **Or open one**: otherwise, count this person's push deliveries for that organization with status `sent` and `sent_at` in the last 60 s. At 3 or more, create a summary with `window_started_at` = now and `window_ends_at` = now + 60 s, set this delivery to `summarised` with its `push_summary_id`, and dispatch `DeliverPushSummary` delayed to `window_ends_at`.
  - **Or send**: otherwise send it on its own.
  - **The summary job**: locks the summary and rechecks membership, verification, `Device.view`, `push_enabled` and the organization switch. It sets `alert_count` to the number of deliveries linked by `push_summary_id`, and cancels when that is 0 or every linked alert has cleared. Otherwise it sends the `summary` payload, with outcome rules as T072 (`failed` once `cycle_attempts` reaches 5).
- [x] T074 [US5] `apps/api/app/Domain/Notifications/Http/Controllers/PushSettingsController.php` and routes in `apps/api/app/Domain/Notifications/routes.php`, per [contracts/push-api.md](contracts/push-api.md):
  - `GET v1/notifications/push`: `available`, `public_key`, `enabled`, `levels`, `revision`, the person's organizations with device view and their `enabled`, and devices without secrets;
  - `PUT v1/notifications/push`: 409 when `revision` is stale; 422 unless `levels` has exactly the four boolean keys; increments `push_revision`;
  - `PUT v1/notifications/push/organizations/{organization}` with `{enabled}`: 404 unless a member with device view; idempotent mute insert or delete.
- [x] T075 [US2] `apps/api/app/Domain/Notifications/Http/Controllers/PushDeviceController.php` and routes, per [contracts/push-api.md](contracts/push-api.md):
  - **`store`**:
    - validation: `endpoint` `https` and at most 2048 characters; `keys.p256dh` and `keys.auth` required; `content_encoding` in `aes128gcm|aesgcm`; `label` at most 60;
    - 409 `push_unavailable` unless `WebPush::enabled()`;
    - upsert by `endpoint_hash`, after deleting another user's device with that hash;
    - set `session_id` from `session()->getId()`, `kept_sign_in_id` from the session, and `last_synced_at`;
    - "At most 10 per person": an eleventh deletes the one with the oldest `coalesce(last_reached_at, created_at)` and returns its label as `replaced`;
    - call `enablePushDefaults` on the person's first device;
    - 201, or 200 when the endpoint was already theirs.
  - **`sync`**: `mine` refreshes the links and `last_synced_at`; `released` deletes the other person's device; otherwise `unknown`.
  - **`destroy`**: 404 unless the owner; ends the linked kept sign-in (`device_removed`), destroys the linked session through `app('session')->getHandler()->destroy()`, deletes the device, and returns 204.
  - **`test`**: `throttle:6,1` per user; sends the `test` payload synchronously; returns `accepted`, `gone` or `failed`.
- [x] T076 [US2] Sign-out and reset remove devices:
  - `SessionController::destroy` deletes the person's devices whose `session_id` is the current session or whose `kept_sign_in_id` is the session's record;
  - `PasswordRecoveryController::reset` deletes all of the person's devices (the reset signs them out everywhere).
- [x] T077 [US2] `apps/api/app/Domain/Automation/Http/Controllers/AlertController.php`:
  - `deliveries` adds `channel`, `devices_total` and `devices_reached` to each item, and `device_label` and `response_status` to each `history` item;
  - `retry` dispatches `DeliverAlertEmail` or `DeliverAlertPush` by `channel`, with the same generation fence;
  - a `summarised` delivery cannot be retried (409).
- [x] T078 [P] [US2] Restore and retention:
  - `apps/api/app/Console/Commands/QuarantineRestoredSideEffects.php` also marks pending `push_summaries` `failed` and deletes every `push_devices` row;
  - `apps/api/app/Domain/Automation/Console/PruneAlertNotifications.php` also deletes `push_summaries` older than 90 days.

### Tests for pull request 5

- [x] T079 [P] [US2] `apps/api/tests/Feature/Domain/Notifications/PushDeviceTest.php`:
  - store validation and the 409 when push is unavailable;
  - upsert by endpoint, and release from another person;
  - the 10-device limit with `replaced`;
  - the first device enables the default levels;
  - sync answers `mine`, `released` and `unknown`;
  - destroy: 404 for another person's device, and it ends the kept sign-in and destroys the session (the next request is 401);
  - **test** with `Http::fake()` for 201 and for 410 (device deleted);
  - no response ever contains `endpoint`, `p256dh`, `auth` or `session_id`;
  - sign-out and password reset remove the right devices.
- [x] T080 [P] [US5] `apps/api/tests/Feature/Domain/Notifications/PushSettingsTest.php`: GET shape with and without keys; PUT with a stale revision (409), invalid levels (422), and success; organization switch for a member, and 404 for a non-member and for a member without device view; mutes cascade when the organization is deleted
- [x] T081 [P] [US2] `apps/api/tests/Feature/Domain/Automation/AlertPushDeliveryTest.php`, using the internal transition endpoint as `AlertTest` does, with `Http::fake()`:
  - **Writing**: one push delivery per recipient with push on and a device, beside the bell row; none without a device or with push off; a replay adds none; a projection rollback removes it with the bell row.
  - **Checks before sending**: each `AlertRecipientCheck` case cancels with its reason, including a removed member, lost view, a level turned off, a muted organization and a cleared activation.
  - **Results**: per-device attempt rows; `sent` when one of two devices accepts; retries on 500 and then `failed` after five; a 410 deletes the device and is never retried.
  - **Endpoint and retry**: the deliveries endpoint shows `channel` and the device counts; retry works for a failed push.
  - **Isolation**: a member of another organization never gets a delivery or a push.
- [x] T082 [P] [US2] Burst cases in `apps/api/tests/Feature/Domain/Automation/AlertPushDeliveryTest.php`, which already holds the alert scenario:
  - five activations in one minute give three sends, two `summarised` deliveries linked to one summary, and `alert_count` 2, sent at the window's end;
  - 50 activations in one minute give at most 4 notifications (SC-007);
  - activations arriving after a window ends either send on their own or open a new summary; no delivery is ever linked to two summaries, and two summaries for one person and organization never overlap in time;
  - a second organization's alerts in the same minute make their own summary;
  - the summary is cancelled when every linked alert has cleared;
  - a duplicate dispatch of a delivery or a summary sends nothing twice.
- [x] T083 [P] [US2] `apps/api/tests/Feature/Domain/Notifications/AlertPushPayloadTest.php`: an activation equals `contracts/push/v1/alert-push.v1.fixture.json`, every builder's output validates against `alert-push.v1.schema.json` (`AssertsContracts`), headers per kind, and names over 120 characters are cut
- [x] T084 [P] [US2] Quarantine and prune cases in `apps/api/tests/Feature/Domain/Notifications/PushSettingsTest.php` (neither command had a test file of its own)

### Finishing pull request 5

- [x] T085 [US2] Contract and client:
  - the push routes in `contracts/openapi/supplements/account.yaml` and the delivery fields in `automation.yaml`;
  - `php artisan contract:export`, then `contract:export --check` and `contract:check --base=origin/main` pass;
  - `packages/api-client/src/notifications.ts` types (`PushSettings`, `PushDevice`, `PushDeviceRegistration`, `PushSyncResult`) and methods in `packages/api-client/src/index.ts` (`pushSettings`, `updatePushSettings`, `setPushOrganization`, `registerPushDevice`, `syncPushDevice`, `removePushDevice`, `testPushDevice`);
  - delivery fields in `packages/api-client/src/alerts.ts`.
- [x] T086 [P] [US2] Docs and release checks:
  - `docs/features/alerts.md`: a **Push notifications** section, API part (who gets them, levels, organization switches, devices, bursts, payload, TTL) and the API table rows;
  - `deploy/release/checks.json`: the new tables (`kept_sign_ins` if not already listed, `push_devices`, `push_organization_mutes`, `push_summaries`) and the new columns.
- [x] T087 Verify pull request 5:
  - `./taskw lint`, `cd apps/api && php artisan test --compact` on PostgreSQL, and `rtk proxy python -m unittest discover -s tooling/release`;
  - put push keys from `php artisan webpush:vapid --show` in the root `.env`, rebuild the API-image services, and run `php artisan migrate --force` in `api`;
  - in desktop Chrome on the rebuilt portal, use DevTools on the registered worker to call `pushManager.subscribe` with the public key from `GET v1/notifications/push`, then post the subscription to `POST v1/notifications/push/devices`;
  - trigger an alert and check the push delivery row, its attempt row and that Chrome receives a push (shown with Chrome's default text until pull request 6).

**Checkpoint**: push is delivered by the API; the portal has no push UI yet.

---

## Phase 9: User Story 2 and User Story 5, push in the portal, pull request 6

**Goal**: people turn push on per device, get notifications that open the alert,
choose levels and organizations, and manage their devices.

**Independent Test**: turn on push on Android, close the browser, trigger an alert
and tap the notification within 30 s; then switch an organization off and see the
bell still update while the phone stays quiet.

- [x] T088 [P] [US2] `apps/portal/src/pwa/notification.ts`: a pure `toNotification(payload, now, locale, timeZone)` returning `{ title, options: { body, tag, icon, badge, data: { url }, renotify: false } }` per [contracts/push-payload.md](contracts/push-payload.md), with the unknown-`v` fallback. `apps/portal/src/pwa/notification.test.ts` renders every file in `contracts/push/fixtures/`, plus a null device, today and an earlier day
- [x] T089 [US2] Push handlers in `apps/portal/src/sw.ts`:
  - `push`: parse JSON (show the fallback on failure) and call `event.waitUntil(self.registration.showNotification(...))` with `toNotification`;
  - `notificationclick`: close, then `clients.matchAll({ type: "window", includeUncontrolled: true })`; focus a same-origin client and `navigate(url)`, else `clients.openWindow(url)`. *Built*: the focused window gets a message and navigates through the router (`PushNavigation`), so unsaved edits get the usual question instead of a reload;
  - `pushsubscriptionchange`: subscribe again with `event.oldSubscription.options.applicationServerKey`.

  Depends on T088.
- [x] T090 [US2] `apps/portal/src/pwa/push.ts`:
  - **`support()`**: one of `supported`, `ios-needs-install`, `unsupported` or `denied`.
  - **`turnOn(publicKey)`**: `Notification.requestPermission()` from the click, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, `registerPushDevice` with a label from the user agent (for example *Safari on iPhone*, at most 60 characters), then `testPushDevice` for the new device, so a test push arrives (US2 scenario 1); stores the registered endpoint and device uuid under personal `localStorage` keys added to the `personal-state.ts` registry.
  - **`sync(publicKey)`**: no subscription does nothing. A subscription whose key differs from `publicKey` is unsubscribed, subscribed again and registered. A subscription whose endpoint differs from the stored one is registered. Otherwise `syncPushDevice`: `mine` stores the uuid; `released` unsubscribes; `unknown` unsubscribes and, when this browser had push on, shows a toast *Push stopped on this device* with **Turn on again**.
  - **`turnOff()`**: unsubscribe, then remove the device. *Built* as `unsubscribeHere()` (sign-out: the API already removes the device with the session) and `removeDevice()` (the device list; removing this browser's own device signs it out). `sync()` asks for the public key only when a subscription exists, so most starts make no request.
- [x] T091 [US2] `apps/portal/src/App.tsx`: call `sync()` once per signed-in start when push is `available`; call `turnOff()` on sign-out before `clearPersonalState()` (depends on T090). *Built*: `PushSync` in `src/pwa/PushSync.tsx`; sign-out calls `unsubscribeHere()` after the API's logout, which removes the device by session
- [x] T092 [US5] Rename the page:
  - `apps/portal/src/alerts/MyNotifications.tsx` (new) holds the existing `EmailPreferences` as an **Email** panel and the **Push** panel (T093, T094);
  - `apps/portal/src/settings/Settings.tsx` serves it at `settings/my-notifications`, with `settings/email` redirecting;
  - `apps/portal/src/notifications/NotificationCenter.tsx` mounts it;
  - the user menu item in `App.tsx` and the tab label read **My notifications**.
- [x] T093 [US2] The **Push** panel's states, from `support()` and `GET v1/notifications/push`:
  - hidden when not `available`;
  - `ios-needs-install` shows the `InstallAppDialog` steps;
  - `unsupported` says this browser can't receive push;
  - `denied` explains how to allow notifications in the browser or phone settings and asks nothing;
  - otherwise **Turn on push on this device**, which on success marks **This device** and shows *Test sent*.
- [x] T094 [US5] The **Push** panel's settings:
  - **Turn off push everywhere**; the level switches **Critical**, **Warning**, **Info** and **Cleared**; one switch per organization;
  - the device list with label, added and last reached (both as `RelativeTime`), **This device**, **Send test** and **Remove** (confirm dialog);
  - unsaved switches use the kit's form grammar with a sticky save bar, `ref={keepToastsAbove}`, and a 409 reload message;
  - toasts for `replaced` (*{label} was removed to make room*).
- [x] T095 [US2] `apps/portal/src/alerts/bell/AlertBell.tsx` footer, shown when push is available and this browser has no registered device (FR-017):
  - when `support()` is `supported`, a **Turn on push on this device** button that calls `turnOn()` directly and shows the result in a toast;
  - otherwise a link, *Get alerts on your phone*, to `settings/my-notifications`, which explains why.

  Depends on T090.
- [x] T096 [P] [US2] Delivery status and list:
  - `packages/ui/src/lib/status.ts`: delivery status `summarised` (muted tone, label *In summary*);
  - in `apps/portal/src/alerts/Alerts.tsx`, the deliveries `DataTable` gains **Channel** (Email or Push) and **Devices** (`{reached} of {total}`, push only), and **Retry** for failed rows of either channel.
- [x] T097 [US2] `apps/portal/e2e/push-settings.spec.ts`:
  - **Setup**: route mocks, plus `page.addInitScript` stubbing `Notification.requestPermission`, `navigator.serviceWorker.ready` and `PushManager.subscribe`/`getSubscription`.
  - **Panel states**: turning on posts the subscription and marks **This device**; the iOS Safari state shows the install steps; denied explains settings.
  - **Settings**: levels save with the revision; an organization switch posts `{enabled:false}`; **Remove** asks first then deletes; **Send test** posts.
  - **Sync**: `unknown` shows *Push stopped on this device*.
  - **Elsewhere**: the bell's **Turn on push on this device** posts the subscription and the test from the bell, and the footer shows only when this browser has no registered device; with push unsupported, the footer is a link to My notifications; the deliveries table shows channel and devices; `expectPhoneFit` passes at 360 px.
- [x] T098 [P] [US2] Help article:
  - `apps/api/resources/help/phone-app.md` (new), with front matter `slug`, `title`, `section`, `summary`, `contexts` `["settings.my-notifications"]`, `keywords`, `required_capabilities` `["devices.view"]`, `revision` 1 and `questions`;
  - its headings are Purpose, Before you start, Steps (install on Android, install on iPhone and iPad, turn on push, choose levels and organizations), Expected result, Troubleshooting (no prompt on iPhone, permission blocked, lock-screen previews, push stopped) and Related guides;
  - it never names the product;
  - add the `settings.my-notifications` context to `apps/api/resources/help/contexts.json` and to `apps/portal/src/help/context.ts`;
  - link it from `apps/api/resources/help/alert-notifications.md` and bump that article's `revision`;
  - `php artisan help:validate` passes.
- [x] T099 [P] [US2] Docs: the user part of the push section in `docs/features/alerts.md`; push and devices in `docs/features/portal-on-phones.md`; `docs/dev/gotchas.md` (a worker cannot send Sanctum's CSRF token, so rotated subscriptions are registered by the page)
- [ ] T100 Verify pull request 6:
  - portal and admin lint and tests, all portal Playwright specs including the PWA config, and `./taskw lint`;
  - rebuild `portal admin`;
  - run quickstart US2 and US5 steps 1 to 6 in desktop Chrome and on the Android phone;
  - measure SC-003 on Android over 20 alerts (at least 19 within 30 s), and time SC-001 from tapping a push to acknowledged (under 30 s while signed in);
  - try the iOS Simulator (Add to Home Screen, turn on push, trigger, tap);
  - record what each platform showed in the pull request description.

**Checkpoint**: every user story works in the rebuilt stack.

---

## Phase 10: Polish and cross-cutting concerns

- [ ] T101 Run `/speckit-converge` after pull request 6 merges; implement any gap it appends, in a new pull request based on `main`
- [ ] T102 Release:
  - before deploying the release that contains pull request 5 to the pilot, run `manage.py webpush-keys --env <private env file>` once and check that `manage.py validate` shows no push warning;
  - after the release, on a real iPhone, install the app from `https://app.<domain>`, turn on push and check activation, clear, summary and tap-to-open (SC-003, Complexity Tracking in the plan);
  - record the result in the release notes and move `DOCS_HOSTED_REF`.
- [ ] T103 Freeze `specs/033-pwa-web-push/`. Confirm lasting behaviour lives in `docs/features/alerts.md`, `docs/features/access.md` and `docs/features/portal-on-phones.md`, and change ADR-047's status to `Accepted 2026-xx-xx, built` in `docs/adr/ADR-047-progressive-web-app-before-native-apps.md` and `docs/adr/README.md`
- [ ] T104 30 days after the pilot release, measure SC-009: compare the people with at least one push device to the people who received an alert email in that period, and note the result in `docs/roadmap.md` under the **Portal on phones** entry, to inform the native-app decision

---

## Dependencies and Execution Order

### Pull request order

```text
PR1 Documents
 ├─ PR2 Phone layouts      (Phases 2–5: Foundational, US1, US4)
 ├─ PR3 Installable app    (Phase 6: US3)
 └─ PR4 Kept sign-in       (Phase 7: US2, FR-011a)
PR3 + PR4 ─ PR5 Push API   (Phase 8: US2, US5)
PR3 + PR5 ─ PR6 Push in the portal (Phase 9: US2, US5)
PR6 ─ Phase 10
```

- PR2, PR3 and PR4 do not depend on each other and may be built at the same time.
  All three edit `apps/portal/src/App.tsx`: PR2 the sign-in layout, PR3 the shell and
  user menu, PR4 the sign-in checkbox. Bring each onto the latest `main` before
  opening it, and check `git diff --diff-filter=U` after the merge.
- PR5 needs PR4's `kept_sign_ins` table (`push_devices.kept_sign_in_id`), and its
  verification (T087) subscribes through PR3's service worker.
- PR6 needs PR3's service worker and PR5's routes.

### Within a phase

- Kit rules (T004 to T008) come before the portal tasks that rely on them (T017
  depends on T006).
- In PR5: migrations, then models, then services, then jobs and controllers, then
  tests, then contract and docs. T070 (`AlertRecipientCheck`) comes before T071 and
  T072, and T068 (`PushSender`) before T072, T073 and T075.
- Verification tasks (T026, T044, T057, T087, T100) are last in their pull request.

### User story completion

- **US1** (P1): complete after Phase 3; no dependency on other stories.
- **US4** (P2): complete after Phase 4; shares the kit rules with US1.
- **US3** (P2): complete after Phase 6; independent of US1 and US4.
- **US2** (P1): complete after Phase 9; needs PR3 (worker), PR4 (kept sign-in) and
  PR5.
- **US5** (P3): complete after Phase 9, with US2.

## Parallel Examples

```text
# Phase 2, kit rules (different files):
T004 phone sizing   T005 PageHeader overflow   T006 CollectionPage filters
T007 bell popover   T008 safe areas            T010 design-system docs

# Phase 6, installable app:
T028 icons   T031 index.html   T032 nginx   T033 connection store   T034 kit components
T037 forms   T038 install      T039 update prompt

# Phase 8, migrations, then tests:
T061 T062 T063 T064 T065
T079 T080 T081 T082 T083 T084
```

## Implementation Strategy

### MVP

Pull request 2 alone (US1, plus US4 in the same change) is the first useful
increment: alert email links work on phones for every user, with nothing to install.

### Incremental delivery

1. PR2: phones can act on alerts (US1) and read devices and dashboards (US4).
2. PR3: the portal installs and handles being offline (US3). iPhone push needs this.
3. PR4: Keep me signed in, so a tapped push opens without a password.
4. PR5: alerts are pushed to registered devices (API).
5. PR6: people turn push on and manage it (US2, US5). The headline feature is complete.
6. After release: the real-iPhone check, then the 30-day adoption measure that informs
   the native-app decision.
