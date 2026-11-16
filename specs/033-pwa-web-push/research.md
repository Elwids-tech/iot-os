# Research: Installable Portal and Push Alerts

Decisions behind [plan.md](plan.md). Each one names what was chosen, why, and what was
rejected. Code references were read on `main` at `50afd7de` (2026-11-16) and are
unchanged at `c206f0d7`.

## R1. A progressive web app, not native apps

- **Decision**: make the portal installable and push-capable, and record the choice and
  its triggers for native apps in ADR-047.
- **Rationale**: the phone job is narrow (be told, open, look, acknowledge). One portal
  serves it with no app stores, no store review per release and no second sign-in flow.
  Push reaches Android in the browser and iPhone and iPad from iOS and iPadOS 16.4 once
  the app is on the home screen.
- **Alternatives**: React Native or Capacitor apps now. Rejected until one of the
  spec's triggers holds: Bluetooth provisioning, Critical Alerts, a store or managed
  install requirement, or iOS push without installing. Capacitor around this same
  portal stays the upgrade path, so the phone layouts and push backend carry over.

## R2. Service worker tooling

- **Decision**: `vite-plugin-pwa` 2.x (peer `vite` up to 8, the portal is on 7.3) with
  the `injectManifest` strategy and a TypeScript worker, `apps/portal/src/sw.ts`, using
  `workbox-precaching`, `workbox-routing` and `workbox-strategies`. The plugin also writes the web app
  manifest and gives `virtual:pwa-register/react` for the update prompt.
- **Rationale**: the worker needs our own `push`, `notificationclick` and
  `pushsubscriptionchange` handlers, which is the case `injectManifest` exists for.
  Workbox revisions the precache, so stale chunks and cache-busting need no hand code.
- **Alternatives**: `generateSW` (push handlers would live in an `importScripts` side
  file outside the build); a hand-written worker without a precache manifest (cache
  versioning by hand, and the old chunks a still-open app needs would be deleted at
  deploy).

## R3. What the worker caches

- **Decision**: precache the built app shell only: `index.html`, the hashed
  `assets/*` JS and CSS, fonts and icons. Navigations are answered with the precached
  `index.html`, so the app starts without a network and shows its offline screen
  (FR-012). `runtime-config.js` is network-first: fresh whenever the server answers,
  with the last copy used only so the offline screen can start (FR-014). Nothing on the
  API host is cached; the worker registers no route for it, and the API is on another
  origin anyway (`api.<domain>`, portal on `app.<domain>`).
- **Rationale**: principle VI and FR-012. A cached reading or alert list would be
  shown as if current. The app shell holds no organization data, so it can stay after
  sign-out.
- **Alternatives**: stale-while-revalidate or network-first for API GETs (shows stale
  data offline, against the spec); network-first navigations (slower start online,
  still needs the fallback).

## R4. Updates

- **Decision**: `registerType: "prompt"`. Browsers check for a new worker mainly when
  the page navigates, which a single-page app left open rarely does. So the portal
  calls `registration.update()` every 30 minutes while visible and whenever it becomes
  visible again. When a new worker is waiting, the portal shows a persistent toast, *A new version is available*, with **Reload**, which tells
  the waiting worker to `skipWaiting` and reloads once it controls the page. Without a
  click, the new worker takes over when every window has closed, which is the next
  launch of an installed app. The portal gets its own nginx config: `/sw.js` and
  `/manifest.webmanifest` are served `no-cache` with explicit types, and a missing
  `/sw.js` returns 404 rather than the SPA's `index.html`.
- **Rationale**: FR-014. The precache keeps the chunks of the running version until
  the switch, so an open app never loads a chunk from the next release. The existing
  `stale-chunks.ts` reload on `vite:preloadError` stays as a backstop for browsers
  without a worker.
- **Alternatives**: `autoUpdate` with `skipWaiting` (can swap code under an open page,
  mixing versions); keep sharing `deploy/docker/admin/nginx.conf` (the admin app would
  inherit worker rules it does not need, and the SPA fallback would answer a missing
  `/sw.js` with HTML).

## R5. Manifest and icons

- **Decision**: the plugin writes `manifest.webmanifest`: `name` and `short_name`
  "IoT OS" (the portal's `<title>`), `id` and `start_url` `/`, `scope` `/`, `display`
  `standalone`, `background_color` and `theme_color` from the kit's light tokens.
  `index.html` gets light and dark `theme-color` metas, `apple-touch-icon`,
  `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style`. The repository has
  no logo or icon, so a source mark `apps/portal/icons/app-icon.svg` is drawn (a chip
  glyph, matching the sign-in page's `CpuIcon`, on the brand navy) and
  `@vite-pwa/assets-generator` produces 64, 192 and 512 PNGs, a maskable 512 and a 180
  Apple touch icon, which are committed with the script that makes them.
- **Rationale**: FR-009. Committed PNGs keep the image build free of image tooling;
  the owner can replace the mark later by swapping one SVG and running the script.
- **Alternatives**: per-deployment names and icons (out of scope by the spec's
  assumptions); generating icons in the Docker build (adds sharp to the image).

## R6. Installing

- **Decision**: a small `install` module in the portal captures `beforeinstallprompt`
  once at start (Chromium on Android and desktop). The user menu's **Install app**
  calls its `prompt()`. On iPhone and iPad Safari (`navigator.standalone === false`)
  it opens a dialog with the Share → **Add to Home Screen** steps and the note that the
  installed app signs in separately. Where neither applies, the dialog points to the
  browser's own menu. The item is hidden when
  `matchMedia("(display-mode: standalone)")` matches. No banner, no automatic prompt.
- **Rationale**: FR-010 and the iOS edge case in the spec.

## R7. Phone layouts

The kit already does much of this. `DataTable` renders cards on phones (column
`mobile: "title" | "badge" | "meta" | "hidden"`, `data-table.tsx:354`), the sidebar is
a `Sheet` below 768 px with the trigger in `PageHeader`, the Help and Assistant panel
is a `Sheet` below 1280 px, toasts span the width below 600 px, `InboxPage` shows the
alert detail alone below 1280 px, and the dashboard grid is one column below 768 px
(`xs` and `xxs` in `GRID_COLUMNS`).

- **Decision, kit** (`packages/ui`, each with a story):
  - `PageHeader`: actions that do not fit go into an overflow menu at phone width.
  - `CollectionPage`: filters move into a bottom `Sheet` behind a **Filters** button at
    phone width, with a count of the active ones.
  - Phone sizing: controls get a 44 px minimum and inputs 16 px text below 768 px.
    Below 16 px, iOS zooms the page on focus.
  - `NotificationBell`: the popover opens full width at phone width.
  - Safe-area padding (`env(safe-area-inset-*)`) on the shell when standalone.
  - New `ConnectionNotice` (offline banner) and `OfflineScreen` (R9).
- **Decision, portal**: alert detail facts in one column, deliveries list as a
  `DataTable` with phone cards, assignee select full width; device overview with status,
  last seen, the latest readings and active alerts first at phone width; dashboards
  hide **Edit** at phone width with a one-line note, and panels get a minimum readable
  height per widget kind in the one-column layout; home page checked at phone width.
- **Rationale**: FR-001 to FR-008 with as little new structure as possible, and
  principle VIII. All rules sit under the 768 px breakpoint, so layouts at 1024 px and
  up do not change (FR-008).
- **Alternatives**: a separate mobile route tree (duplicates pages); `pointer: coarse`
  sizing (touch laptops would change at desktop widths).

## R8. Offline detection

- **Decision**: one `connection` store in `@iot-os/api-client`. It starts from
  `navigator.onLine` and the `online`/`offline` events, and it also marks the
  connection lost when a request fails at the network level (`fetch` rejects with a
  `TypeError`, which `ApiClient.request` does not catch today). While the page is
  visible and the connection is believed lost, it probes the API's health route,
  `GET /up`, every 5 s, with `mode: "no-cors"` and `cache: "no-store"`: `/up` is outside
  the CORS paths, and an opaque answer still proves the API is reachable. While believed online it probes every 10 s only if no
  request has succeeded in the last 10 s. TanStack Query's `onlineManager` is set from
  the store, so queries pause while offline and resume on reconnect.
- **Rationale**: FR-013's 10 seconds. Airplane mode fires `offline` at once. A
  network without internet fires nothing, so the probe catches it. The probe costs at
  most 6 cheap requests a minute per visible tab, and nothing while the bell's poll is
  already succeeding.
- **Alternatives**: browser events only (misses a network without internet); reusing
  the bell's 15 s poll (too slow for 10 s).

## R9. Nothing is queued offline

- **Decision**: the portal's `QueryClient` sets `mutations.networkMode: "always"`, so a
  mutation made offline fails at once instead of TanStack Query's default of pausing
  it and sending it on reconnect. A failed mutation while the store says offline shows
  *You're offline. Nothing was saved.* The offline banner says values are from the
  time shown, and existing `Freshness` and `RelativeTime` labels keep counting.
- **Rationale**: FR-013 and principle VI. The default would quietly acknowledge an
  alert minutes later.

## R10. Sign-out leaves nothing personal

- **Decision**: one `clearPersonalState()` in the portal runs on sign-out: it clears
  the TanStack Query cache, `sessionStorage`, the person-keyed `localStorage` entries
  listed in one registry (selected and last organization, assistant and dashboard
  state), unsubscribes this browser's push subscription and removes its device on the
  server. Per-browser settings that are not personal (the bell's sound switch, the
  theme) stay. The app shell in Cache Storage stays.
- **Rationale**: FR-015 and SC-005.

## R11. Kept sign-in

- **Decision**: a per-device record, `kept_sign_ins`, and an HttpOnly, Secure,
  SameSite=Lax cookie (`iot_kept`, domain = the session domain, encrypted by
  `EncryptCookies`) holding the record's id and a random secret whose SHA-256 is
  stored. `POST v1/auth/login` takes `remember: boolean`. A new middleware,
  `ResumeKeptSignIn`, is appended to the API group after Sanctum's stateful
  middleware:
  - when the session has no user and the cookie matches a live record, it logs the
    user in on the `web` guard, regenerates the session, stores `kept_sign_in_id` and
    stamps `last_used_at` (at most once a minute);
  - when the session carries a `kept_sign_in_id` whose record has ended, it logs out
    and forgets the cookie, so removing a device or resetting the password takes
    effect on that device's next request.
  A record lasts 30 days from sign-in and is not extended by use. Sign-out ends it
  (`signed_out`); password reset ends all of the person's records (`password_reset`) in
  `PasswordRecoveryController`'s transaction; removing a push device ends its linked
  record (`device_removed`). Ended and expired records are pruned after 30 days.
- **Rationale**: FR-011a. Laravel's built-in remember-me keeps **one** `remember_token`
  per user, and `SessionGuard::logout()` cycles it, so signing out on a laptop would
  end the phone's kept sign-in too, and no single device could be removed.
- **Alternatives**: Laravel remember tokens (above); a longer `SESSION_LIFETIME` for
  everyone (rejected in clarification); Sanctum personal access tokens in the portal
  (moves the portal off cookie sessions and puts a bearer token in script-readable
  storage).
- **Note**: the admin app shares the session (`SESSION_DOMAIN=.<domain>`, both hosts in
  `SANCTUM_STATEFUL_DOMAINS`), so a kept sign-in also keeps the admin app signed in in
  that browser, as the shared session already does today within its 2 hours. ADR-047
  records this. Sanctum's `AuthenticateSession` keeps logging other sessions out when the
  password hash changes; the middleware stores `password_hash_web` when it resumes.

## R12. Sending pushes

- **Decision**: `laravel-notification-channels/webpush` ^13.0 (13.0.1, 2026-09-08:
  `illuminate/*` ^12.0|^13.13, `minishlink/web-push` ^11.0; on Laravel 13.13+ it sends
  through Laravel's HTTP client, so tests use `Http::fake()`). The API is on Laravel
  13.40. It supplies VAPID configuration, payload encryption and the push request. The
  first task is a spike: confirm that the channel reports each subscription's outcome
  (its sent and failed events carry the subscription and the push service response).
  If it does, `DeliverAlertPush` sends through it with the person's devices as the
  route. If it does not, `PushSender` calls the package's configured
  `Minishlink\WebPush\WebPush` and reads each `MessageSentReport`. Either way our own
  `push_devices` model holds the subscriptions (R13), not the package's morph table.
- **Rationale**: the protocol (VAPID JWT, aes128gcm encryption) stays in maintained
  libraries, following the project's preference for packages over in-house protocol
  code.
- **Alternatives**: our own Web Push implementation (protocol code we would have to
  maintain); `minishlink/web-push` alone without the package (loses the Laravel HTTP
  client and the config conventions).

## R13. Where push lives in the data

- **Decision**:
  - Devices: a new `push_devices` table, owned by the Notifications domain, keyed by
    `user_id` with a foreign key (cascade on user delete), unique on the endpoint's
    SHA-256.
  - Levels and switches: new columns on `notification_preferences` (`push_enabled`,
    `push_levels`, `push_revision`) and a `push_organization_mutes` table.
  - Deliveries: rows in the existing `automation_alert_deliveries` with
    `channel = 'push'`. The column and the unique key on (alert, recipient, type,
    channel) exist since `2026_10_31_010000_generalise_automation_alerts.php`.
    Per-device outcomes go in `automation_alert_delivery_attempts`, one row per device
    per send.
  - Bursts: a `push_summaries` table.

  Details in [data-model.md](data-model.md).
- **Rationale**: FR-030. Spec 011 wants one delivery record per alert, transition,
  channel and recipient; this is that record, already shaped for it. A separate push
  revision keeps the email and push forms from refusing each other's saves.
- **Alternatives**: the package's `push_subscriptions` morph table (no foreign key to
  users, none of our columns); a JSON column of mutes (no cascade when an organization
  is deleted).

## R14. Who gets a push, and when it is written

- **Decision**: in `AlertProjector`, inside the branch that writes the bell row
  (`AlertProjector.php:60-66`, which runs only when the email delivery row is new), a
  push delivery is created for each recipient who has push on and at least one device,
  and `DeliverAlertPush` is queued on the `alerts` connection and queue in the same
  transaction. The checks `DeliverAlertEmail` makes before sending (`:49-89`) move into
  a shared `AlertRecipientCheck` used by both jobs, unchanged for email, plus the push
  checks: push on, level allowed, organization not muted, device still registered.
- **Rationale**: FR-018 (push follows the bell exactly) and FR-025/FR-026. The bell
  and the push are written together, so a replayed transition creates neither twice.
- **Levels today**: email checks `warning` for every workflow activation and `recovery`
  for clears (`DeliverAlertEmail.php:66-67`); push uses the same mapping until spec 011
  stores a severity.

## R15. Bursts

- **Decision**: at send time, `DeliverAlertPush` locks the person's
  `notification_preferences` row, so one person's deliveries are decided one at a
  time.
  - If the person has an **open** summary for that organization (its `window_ends_at`
    is in the future), the activation joins it: status `summarised`, `push_summary_id`
    set.
  - Otherwise, if 3 or more of their push deliveries for that organization were sent
    in the last 60 s, it opens a new summary from now (`window_ends_at` = now + 60 s),
    joins it, and queues `DeliverPushSummary` delayed to the window's end.
  - Otherwise it is sent on its own.

  The summary counts only the deliveries linked to it and opens the Alerts list
  filtered to active, unacknowledged alerts.
- **Why linked, not by time**: a window keyed to "the oldest of the last three sent"
  can start in the past, end before it is created, or overlap the previous window, and
  matching deliveries to windows by time would then count an alert twice. With the
  lock and the link, windows never overlap and each alert is in at most one summary.
- **Rationale**: FR-024 and SC-007 (at most 3 + 1 notifications from a burst).
- **Alternatives**: coalescing in the projector (it runs inside the runtime's
  transaction and should stay small); a per-person rate limiter that drops pushes
  (loses the count).

## R16. The push message

- **Decision**: a versioned JSON payload, `contracts/push/alert-push.v1.schema.json`
  with golden fixtures (activated, cleared, summary, test), described in
  [contracts/push-payload.md](contracts/push-payload.md). It carries structured
  fields, not finished text: the worker formats the title and body, with the time in
  the phone's own time zone and locale, through a pure function shared with Vitest.
  Requests set `TTL: 86400`, `Urgency: high` for activations and `normal` otherwise,
  and `Topic` = the alert uuid without dashes (32 characters), so a push service
  holding an undelivered activation replaces it with the clear. The notification
  `tag` is `alert-<uuid>` (and `summary-<organization uuid>`), so a duplicate or a clear
  replaces the earlier notification on the device (FR-023). No `actions`.
- **Rationale**: principle IV (the payload crosses from PHP to the worker); FR-021 to
  FR-023 and FR-026's 24-hour expiry. A payload of a version the worker does not know
  still shows a generic "Open the app to see new alerts" notification, because browsers
  penalize push messages that show nothing.

## R17. Tapping a notification

- **Decision**: `notificationclick` closes the notification, then focuses an open
  window of the portal and navigates it to the payload's `url`, or opens one. The URL
  is the alert's own route, `/organizations/{org}/alerts/{alert}`, or the Alerts list
  for a summary. Opening the alert already marks its bell notification read (spec 022).
  A signed-out person gets the sign-in form at that same path, and after sign-in the
  alert renders (`App.tsx:246-247` keeps the URL). An alert the person cannot see shows
  the existing not-found state, worded as *This alert isn't available*.
- **Rationale**: FR-022.

## R18. Registering a device

- **Decision**: **Turn on push on this device** calls `Notification.requestPermission()`
  from the click, then `pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey })` with the public key from `GET v1/notifications/push`, then
  `POST v1/notifications/push/devices`. The label (*Safari on iPhone*) is built in the
  browser from the user agent. On every start of the portal, a browser that holds a
  subscription calls `POST v1/notifications/push/devices/sync` with its endpoint. The
  server answers `mine` (and refreshes the device's session and kept sign-in links),
  `released` (it belonged to someone else, whose registration is deleted) or `unknown`.
  For the last two, the browser unsubscribes. When the subscription's
  `applicationServerKey` differs from the server's current key, the browser subscribes
  again silently (permission is already granted) and registers the new endpoint. The
  worker's `pushsubscriptionchange` handler only subscribes again with the same key.
  A worker cannot read the CSRF cookie that Sanctum requires for a POST. The page keeps
  the endpoint it last registered (a personal `localStorage` entry), and on its next
  start it registers a subscription whose endpoint differs from that one instead of
  syncing it.
- **Rationale**: FR-017, FR-020, FR-028 and the shared-phone edge case. Holding an
  endpoint proves control of that browser, so releasing another person's registration
  for it leaks nothing. A replaced push key heals itself the next time each person
  opens the portal.

## R19. The push key in releases

- **Decision**: three keys, `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY` and
  `WEBPUSH_VAPID_SUBJECT` (`mailto:` the operator address), mapped into the package's
  `webpush.vapid` config. `tooling/release/manage.py`:
  - `init` generates the pair;
  - a new `webpush-keys` command adds it to an existing env file only when both halves
    are missing, modelled on `passport-keys` (`manage.py:65-74`);
  - `validate()` requires both or neither;
  - `restore()` compares them when the backup had them.

  The keys join the `x-api-env` anchor in `deploy/release/compose.yml` and
  `compose.app.yml`. Push is available when both halves are set (`WebPush::enabled()`,
  the `Payments::enabled()` pattern) and the API reports it in `GET
  v1/notifications/push`. Dev `.env.example` leaves them empty; `php artisan
  webpush:vapid` fills them locally. `QuarantineRestoredSideEffects` fails pending push
  deliveries (already covered: it updates every pending `automation_alert_deliveries`
  row) and pending `push_summaries`, and deletes `push_devices`, so a restored copy
  cannot push to real phones.
- **Rationale**: FR-016 and the plan-level requirement that the key survives upgrades
  and restores. `ship.py` never rewrites the env file, and backups carry it.

## R20. Verifying on real phones

- **Decision**:
  - Android: Chrome over USB with `adb reverse` for the portal and API ports, so the
    phone reaches `localhost` (a secure context) on the dev stack.
  - iPhone and iPad: try the iOS Simulator first, where `localhost` is the Mac. Push
    to an installed web app needs a recent Simulator on macOS 13 or later; if it does
    not work there, the iPhone check happens on the pilot after release.
  - Desktop Chrome and Safari for the worker, offline and update checks on the dev
    stack.
- **Rationale**: principle IX and SC-003 (real phones, not emulators alone). A real
  iPhone needs HTTPS and a trusted certificate, which the dev stack does not have; a
  public tunnel would be the owner's call.
