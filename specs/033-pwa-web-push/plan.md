# Implementation Plan: Installable Portal and Push Alerts

**Branch**: `spec/033-pwa-web-push` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/033-pwa-web-push/spec.md`

## Summary

The kit already does much of the phone work: `DataTable` has phone cards, the sidebar
becomes a sheet, toasts span the width, the alert detail stands alone below 1280 px
and the dashboard grid is one column below 768 px. Phone layouts (US1, US4) therefore
add a few kit rules under 768 px (header overflow, a filter sheet, 44 px controls,
16 px inputs, full-width bell) and reorder a few portal pages. Layouts at 1024 px and
up stay as they are.

The portal becomes installable (US3) with `vite-plugin-pwa` in `injectManifest` mode:

- a TypeScript service worker precaches the app shell only and caches no API data;
- updates wait for **Reload** or the next launch;
- a connection store drives an offline banner and screen;
- mutations fail rather than queue while offline;
- sign-out clears everything personal.

The portal image gets its own nginx config for the worker and manifest.

**Keep me signed in** (FR-011a) is a per-device `kept_sign_ins` record behind an
HttpOnly cookie, resumed by a middleware after Sanctum's stateful stack. Laravel's own
remember token is one per user, so it cannot end one device alone.

Push (US2, US5) follows the bell exactly:

- `AlertProjector` writes a `channel = 'push'` row in the existing delivery table next
  to the bell row, in the same transaction.
- `DeliverAlertPush` repeats the email checks (moved into a shared
  `AlertRecipientCheck`) plus the push ones, folds bursts into a summary, and sends
  through `laravel-notification-channels/webpush` with a versioned payload the worker
  formats.
- Devices are personal, at most ten, linked to the session and kept sign-in they
  registered from, so removing one signs it out.
- Release tooling creates the push key and keeps it across upgrades and restores.

The plan follows the owner's answers to the five clarification questions (2026-11-16).
ADR-047 records the decision to build a progressive web app before native apps.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13.40 (`apps/api/composer.lock`); TypeScript,
React 19, Vite 7.3; Python 3 (release tooling)

**Primary Dependencies**:
- New: `laravel-notification-channels/webpush` ^13.0 (pulls in `minishlink/web-push`
  ^11; sends through Laravel's HTTP client on 13.13+); `vite-plugin-pwa` ^2.0 with
  `workbox-precaching`, `workbox-routing`, `workbox-strategies` and `workbox-window`
  ^7.4;
  `@vite-pwa/assets-generator` (dev).
- Existing: Sanctum stateful SPA sessions and `AuthenticateSession`; TanStack Query 5
  (`onlineManager`, mutation `networkMode`); `@iot-os/ui` (`Sheet`, `DataTable`,
  `PageHeader`, `NotificationBell`, `Status`/`statusOf`); sonner.

**Storage**: PostgreSQL 17. Four new tables (`kept_sign_ins`, `push_devices`,
`push_organization_mutes`, `push_summaries`). New columns on
`notification_preferences`, `automation_alert_deliveries` and
`automation_alert_delivery_attempts` ([data-model.md](data-model.md)). Browser: Cache
Storage holds the app shell only.

**Testing**:
- PHPUnit on PostgreSQL, with `Http::fake()` standing in for push services.
- Contract checks: the OpenAPI export and drift check, and push payload fixtures.
- Vitest: the worker's formatter on the fixtures, the connection store, install state
  and the personal-storage registry.
- Playwright: phone viewports 320, 360 and 390 px with mocked APIs; an installable spec
  against `vite preview` with service workers allowed.
- Release tooling `unittest`.
- Real devices per [quickstart.md](quickstart.md).

**Target Platform**:
- Servers: `api` and every service built from the API image, `portal` (new nginx
  config), `admin` (kit rules below 768 px only), release tooling.
- Browsers: Chrome, Edge, Samsung Internet and Firefox on Android; Safari on iOS and
  iPadOS 16.4+ (push from the home screen only); desktop Chrome, Edge, Firefox and
  Safari.

**Project Type**: web application

**Performance Goals**:
- 95% of activations shown on an online phone within 30 s (SC-003). The job is queued
  in the projector's transaction; the `alerts` worker polls every 2 s in release; one
  HTTP request per device.
- The connection probe sends at most 6 requests a minute per visible tab, and only
  while requests are failing or idle.

**Constraints**:
- No runtime change.
- No API response cached on a device.
- Layouts at 1024 px and up unchanged.
- No new container image (the release workflow asserts eight).
- Push works only where the deployment can reach the browser vendors' push services.

**Scale/Scope**:
- API: 6 migrations; 2 jobs, 1 middleware, 1 shared check, 2 services; 5 routes
  changed and 7 added; 1 prune command; 1 release command.
- Kit: 2 new components; 8 components and templates changed (`PageHeader`,
  `CollectionPage`, `NotificationBell`, `Button`, `Input`, `Select`, `Switch`,
  `Textarea`), plus `statusOf`, the global styles and `check-ui`, with stories.
- Portal: worker, install, connection, push settings, and changes to 7 pages.

## Constitution Check

*Checked before research and again after the design. Both pass, with one justified
deviation from principle IX recorded under Complexity Tracking.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel stores devices and preferences, decides recipients and sends every push. The runtime is untouched. The worker talks only to the portal's origin and the API. |
| II. Immutable versions | Pass. Nothing versioned changes. |
| III. Tenant isolation | Pass. Push follows the bell's recipients, and before each send `AlertRecipientCheck` re-confirms membership, verification and `Device.view` in the alert's organization. Organization switches go through membership. Devices and kept sign-ins are reachable only by their owner (404 otherwise). Summaries count one organization. Tests cover a member of another organization, a removed member, lost view access, another person's device, and summaries that never mix organizations. |
| IV. Contracts first | Pass. `contracts/push/alert-push.v1.schema.json` with golden fixtures, checked by PHP and by the worker's Vitest suite. OpenAPI supplements and `packages/api-client` change in each pull request that changes a route. No new user reference. |
| V. AI proposes | Pass. No AI involvement. The assistant and agent tools do not read push settings. |
| VI. Show uncertainty | Pass. No data is cached for offline use. The offline banner says values are from the time shown, and `Freshness` labels keep counting. Every push states when its alert happened. **Sent** is explained as accepted by the push service. |
| VII. Durable, idempotent messaging | Pass. Push deliveries are written in the projector's transaction only when the bell row is new; the unique key (alert, recipient, type, channel) blocks duplicates. Summaries are unique per person, organization and window. Retries use the email backoff, and gone devices (404, 410, 403) are never retried. TTL is 24 h. Kept sign-ins and summaries are pruned, and restores quarantine pending pushes and devices. |
| VIII. One design system | Pass. New kit components `ConnectionNotice` and `OfflineScreen` get stories. `PageHeader`, `CollectionPage`, `NotificationBell` and the phone sizing rules change in the kit with updated stories. Delivery status `summarised` joins `statusOf`. `check-ui` passes. |
| IX. Verified where it runs | Deviation (see Complexity Tracking). PostgreSQL CI, rebuilt `api` family, `portal` and `admin`, and a real Android phone against the dev stack. The iPhone is checked in the iOS Simulator before merge and on a real iPhone on the pilot after the release. |

## Decisions

Full reasoning, with rejected alternatives, is in [research.md](research.md).

| Decision | Chosen | Research |
| --- | --- | --- |
| App type | Progressive web app; native deferred to the spec's triggers (ADR-047) | R1 |
| Worker tooling | `vite-plugin-pwa` 2, `injectManifest`, `src/sw.ts` | R2 |
| Caching | App shell only; navigations from the precached shell; `runtime-config.js` network-first; no API routes | R3 |
| Updates | Prompt with **Reload**; otherwise the next launch; own nginx config for the portal | R4 |
| Icons | New source SVG, PNGs generated by script and committed | R5 |
| Install | `beforeinstallprompt` in the user menu; steps dialog on iOS; no banners | R6 |
| Phone layouts | Kit rules under 768 px plus page tweaks; no separate mobile routes | R7 |
| Offline | Connection store from browser events, failed requests and a `no-cors` probe of `/up`; mutations `networkMode: "always"` | R8, R9 |
| Kept sign-in | `kept_sign_ins` + `iot_kept` cookie + `ResumeKeptSignIn` middleware, not Laravel's single remember token | R11 |
| Push library | `laravel-notification-channels/webpush` ^13 (spike first on per-device reports) | R12 |
| Push data | Existing delivery table with `channel = 'push'`; own `push_devices`; mutes table; summaries table | R13 |
| Recipients | Written next to the bell row in `AlertProjector`; shared `AlertRecipientCheck` | R14 |
| Bursts | Under a per-person lock, an activation joins an open summary or, after 3 pushes in 60 s, opens one; linked by `push_summary_id`, so windows never overlap | R15 |
| Payload | Versioned JSON with fixtures; the worker formats text and time; `tag` and `Topic` per alert | R16 |
| Push key | `WEBPUSH_VAPID_*` env; `manage.py init`, `webpush-keys`, `validate` and `restore` | R19 |

## Design

### Kit (`packages/ui`)

All rules apply below 768 px (`max-md:`), so nothing changes at 1024 px and up.

- **`PageHeader`**: at phone width one action stays (the primary `Button`, else the
  first) and the others move into a popover behind **More actions**; an action that
  opens its own dialog or menu opens it above the popover. The trigger slot (bell, Assistant, Help) stays visible.
  Story: phone and desktop.
- **`CollectionPage`**: a `filters` slot renders inline on wider screens and inside a
  bottom `Sheet` behind **Filters (n)** at phone width. The sheet is a kit
  `FilterSheet`, which `DataTable` uses for its own filters too. Stories.
- **Phone sizing** (`styles` and the `Button`, `Input`, `SelectTrigger`, `Switch` and
  `Textarea` variants): minimum 44 px targets and 16 px input text under `max-md`.
  `check-ui.mjs` gains a rule that the interactive kit components (`button`, `input`,
  `select`, `switch`, `textarea`) keep their 44 px phone targets.
- **`NotificationBell`**: the popover is full width with a max height at phone width.
- **Shell safe areas**: a `standalone` class on `<html>` (set by the portal) adds
  `env(safe-area-inset-*)` padding to the sidebar sheet, header and sticky bars.
- **New `ConnectionNotice`**: a banner reading *You're offline. Values are from
  {time}.* that sits under the page header; `role="status"`. Story.
- **New `OfflineScreen`**: a full-page panel reading *You're offline. Alerts and
  readings need a connection.*, with **Try again**. Story.
- **`statusOf`**: delivery status `summarised` (muted tone, *In summary*).
- **`docs/dev/design-system.md`**: a **Phones** section (breakpoint, sizing, filter
  sheet, header overflow).

### Portal phone pages (`apps/portal`)

| Page | Change |
| --- | --- |
| Sign-in (`App.tsx` `Login`) | Full-width card under 768 px. **Keep me signed in** checkbox with the hint *Don't tick this on a shared device* (FR-011a). |
| Password reset, invitation (`packages/auth`) | Checked at 320 px; sizing comes from the kit. |
| Home (`home/HomePage.tsx`) | Checked at 320 px; panels stack. |
| Alerts (`alerts/Alerts.tsx`) | Filters through `CollectionPage`'s sheet or the same `Sheet` in `InboxPage`'s list header. Bulk acknowledge stays in a sticky bar with `keepToastsAbove`. |
| Alert detail | Facts in one column. Assignee select full width. The deliveries list becomes a `DataTable` with columns channel, recipient, devices (`1 of 2`), status and sent, showing phone cards, with **Retry** for failed rows of either channel. Not-found reads *This alert isn't available*. |
| Devices (`DeviceDirectory.tsx`) | Already phone cards; filters through the sheet. |
| Device detail (`DeviceOverview.tsx`) | At phone width the order is status and last seen, `LatestReadout` with ages, active alerts, then the rest. |
| Dashboards (`DashboardWorkspace.tsx`, `DashboardGrid.tsx`) | **Edit** hidden under 768 px, with *Editing needs a larger screen* under **More actions**. A minimum height per widget kind in the one-column layout (stat 3 rows, chart and map 6 rows, table 8 rows with its own sideways scroll). `TimeControls` collapses to one button that opens the range popover. |
| Help and Assistant (`help/HelpPanel.tsx`) | The panel's `Sheet` is full width under 768 px (FR-005). |
| Settings | The personal page **Email** becomes **My notifications** (`settings/my-notifications`, with `settings/email` redirecting). The user menu item is renamed the same. |

### Installable app (`apps/portal`)

- **`vite.config.ts`**: `VitePWA({ strategies: "injectManifest", srcDir: "src",
  filename: "sw.ts", registerType: "prompt", manifest, injectManifest: { globPatterns:
  ["**/*.{js,css,html,woff2,png,svg}"] } })`. `runtime-config.js` is excluded from the
  precache.
- **`src/sw.ts`**:
  - `precacheAndRoute(self.__WB_MANIFEST)`;
  - a `NavigationRoute` to the precached `index.html` with a denylist for `/connect`;
  - a network-first route for `/runtime-config.js`;
  - a `message` handler for `SKIP_WAITING`;
  - push handlers, added in pull request 6.
- **`src/pwa/`**:
  - `install.ts`: captures `beforeinstallprompt`; `standalone()` and `ios()` checks.
  - `InstallAppDialog.tsx`: the iOS steps, and the browser-menu fallback.
  - `UpdatePrompt.tsx`: `useRegisterSW`; `registration.update()` every 30 minutes
    while visible and on becoming visible; a persistent sonner toast with **Reload**.
  - A `<meta name="build-id">` from a `__BUILD_ID__` define, so tests can tell
    versions apart.
  - `personal-state.ts`: the registry of personal `localStorage` keys, plus
    `clearPersonalState()`.
- **`@iot-os/api-client`**: a `connection` store; `ApiClient.request` turns a network
  `TypeError` into `ApiError(0, "network")` and reports it to the store.
- **`main.tsx`**: wires `onlineManager` to the store, sets
  `mutations.networkMode: "always"`, and registers the worker only in production
  builds and when `serviceWorker` is supported.
- **App shell**:
  - `ConnectionNotice` under every `PageHeader`;
  - `OfflineScreen` when the first `/me` fails on the network;
  - **Install app** in the user menu;
  - the `standalone` class on `<html>`.
- **`forms.tsx` `errorMessage`**: network errors while offline read *You're offline.
  Nothing was saved.*
- **`index.html`**: light and dark `theme-color` metas, `apple-touch-icon`,
  `viewport-fit=cover`, `apple-mobile-web-app-status-bar-style`.
- **Icons**: `apps/portal/icons/app-icon.svg`, `pwa-assets.config.ts`, and the script
  `pnpm --filter @iot-os/portal icons`. The generated PNGs are committed under `public/`.
- **`deploy/docker/portal/nginx.conf`** (new; the portal `Dockerfile` copies it instead
  of the admin one):
  - `location = /sw.js` and `location = /manifest.webmanifest` are `no-cache`,
    `try_files $uri =404`, with an explicit type for `.webmanifest`;
  - `location = /runtime-config.js` is `no-store`, as today;
  - `/assets/` is immutable, as today;
  - `/` is the SPA fallback, as today.

### Kept sign-in (Authentication domain)

- **Migration and model**: `kept_sign_ins` and `KeptSignIn` with `live()`, `end($reason)`
  and `matches($secret)` (`hash_equals` on SHA-256).
- **`SessionController::store`**: when `remember` is true and the attempt succeeded,
  it creates the record, queues the `iot_kept` cookie (`{uuid}.{secret}`, 30 days,
  HttpOnly, Secure per `SESSION_SECURE_COOKIE`, SameSite per `SESSION_SAME_SITE`,
  domain per `SESSION_DOMAIN`) and puts `kept_sign_in_id` in the session after
  `regenerate()`.
- **`SessionController::destroy`**: ends the session's record (`signed_out`), forgets
  the cookie, and deletes the push devices linked to this session or record.
- **`ResumeKeptSignIn`**: appended to the `api` middleware group in
  `bootstrap/app.php`, after Sanctum's stateful middleware. Two cases:
  1. If the session has no user, a valid cookie resumes it: the user is logged in on
     `web`, the session regenerated, `kept_sign_in_id` and `password_hash_web` stored,
     and `last_used_at` stamped at most once a minute.
  2. If the session's record has ended or expired, it logs out and forgets the cookie.

  Stateless under Octane: no static state.
- **`PasswordRecoveryController::reset`**: inside its transaction, ends all of the
  person's records (`password_reset`) and deletes their push devices.
- **`PruneKeptSignIns`** (daily): deletes rows ended or expired more than 30 days ago.
- **`LoginRequest`**: `remember` is `sometimes|boolean`.
- **Admin**: the admin app shares the session, so it is kept too. ADR-047 notes this.
  The admin sign-in shows no checkbox.

### Push API (Notifications and Automation domains)

- **Configuration**:
  - `config/webpush.php` maps `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY`
    and `WEBPUSH_VAPID_SUBJECT`;
  - `WebPush::enabled()` is true when both halves are set;
  - `.env.example` lists the keys empty;
  - both compose files pass them to every API-image service.
- **Spike** (first task): confirm the package's channel exposes each subscription's
  outcome. Result recorded in research R12. `PushSender` wraps whichever path the spike
  picks and returns one result per device: `accepted`, `gone`, `rejected` or
  `transport_failed`, with the status.
- **Settings and devices**: `PushSettingsController` and `PushDeviceController` on the
  routes in [contracts/push-api.md](contracts/push-api.md). Device rules in
  [data-model.md](data-model.md): at most 10, release by endpoint, links to session and
  kept sign-in. **Test** sends synchronously and is throttled.
- **`AlertRecipientCheck`** (Automation): the checks from `DeliverAlertEmail` lines
  49 to 89, moved without behaviour change and used by the email job. Push adds:
  `push_enabled`, the level allowed, the organization not muted, and at least one
  device.
- **`AlertProjector`**: in the branch that writes the bell row, for each recipient
  with `push_enabled` and a device, it calls `AlertDelivery::firstOrCreate([...,
  'channel' => 'push'])`. When the row is new, it queues
  `DeliverAlertPush::dispatch($delivery->uuid)->onConnection('alerts')->onQueue('alerts')`.
- **`DeliverAlertPush`**:
  - It locks the delivery and runs the generation fence and terminal-status skip, as
    email does.
  - It runs `AlertRecipientCheck`, then the burst rule (R15).
  - It builds the v1 payload and sends to each device through `PushSender`.
  - It writes one attempt row per device and sets `devices_total`/`devices_reached`.
  - It deletes gone devices and stamps `last_reached_at` and `last_failed_at`.
  - It is `sent` when any device accepted. It retries with the email backoff while any
    device failed transiently and none accepted, and is `failed` after five attempts in
    the cycle.
- **`DeliverPushSummary`**: runs at the window's end. It rechecks access and
  preferences, counts the deliveries linked to it by `push_summary_id`, cancels when
  every linked alert has cleared, and sends the `summary` payload. It stops after five
  attempts in a cycle (`cycle_attempts`).
- **Deliveries endpoint** (`AlertController::deliveries`): adds `channel`,
  `devices_total`, `devices_reached`, and history `device_label`/`response_status`.
  **Retry** dispatches by channel.
- **Payload**: `AlertPushPayload::fromDelivery()` and `summary()` against
  `contracts/push/alert-push.v1.schema.json`, with fixtures.
- **Retention and restore**:
  - Summaries are pruned with `PruneAlertNotifications` (90 days).
  - `QuarantineRestoredSideEffects` also fails pending summaries and deletes every
    `push_devices` row.
  - `OrganizationDeletion` needs nothing new: mutes and summaries cascade.

### Push in the portal

- **`src/sw.ts` push handlers**:
  - `push` parses the payload, formats it with `src/pwa/notification.ts` (pure, shared
    with Vitest) and calls `showNotification`;
  - `notificationclick` focuses and navigates a window, or opens one;
  - `pushsubscriptionchange` subscribes again with the same key. The page registers the
    new endpoint at its next start, because a worker cannot send Sanctum's CSRF token
    (R18).
- **`src/pwa/push.ts`**: `turnOn()` (permission, subscribe, register, then a test push
  to this device, as US2 expects), `sync()` (on
  every start), `turnOff()` (on sign-out), and the key-change re-subscribe. When
  `sync()` answers `unknown` for a browser that had push on, typically because the push
  service reported it gone, it unsubscribes and shows *Push stopped on this device*
  with **Turn on again** (the spec's expired-registration edge case).
- **My notifications** (`alerts/MyNotifications.tsx`, replacing the mount of
  `EmailPreferences`):
  - an **Email** panel, unchanged;
  - a **Push** panel. When push is off on this device it shows **Turn on push on this
    device**, or why it isn't available here: iOS not installed, unsupported browser,
    or permission blocked. It also has **Turn off push everywhere**, the level
    switches, the per-organization switches, and the device list with **This device**,
    **Send test** and **Remove**. Unsaved switches use the kit's form grammar with a
    sticky save bar.
- **Bell**: a footer button in the bell, **Turn on push on this device**, which calls
  `turnOn()` directly (FR-017), shown when push is available and off on this device.
  Where `support()` is not `supported`, it reads *Get alerts on your phone* and links
  to My notifications, which explains why.
- **Sign-out**: `turnOff()` runs before `clearPersonalState()`.

### Release tooling

- **`tooling/release/manage.py`**:
  - `webpush_keys()` generates an EC P-256 pair with `cryptography` (base64url), as
    the package expects;
  - `init` writes the pair and the subject (`mailto:` plus the ACME email);
  - a new `webpush-keys` command adds the pair only when both halves are missing;
  - `validate()` requires both or neither, and warns without failing when both are
    missing, naming `webpush-keys`. An upgraded deployment therefore turns push on
    with one command and never handles key material (FR-016). Until then push stays
    hidden;
  - `restore()` compares the pair when the backup had one;
  - `smoke()` also fetches `https://app.<domain>/manifest.webmanifest` and expects
    JSON.
- **Other files**:
  - `deploy/release/compose.yml` and `environment.example`: the three keys;
  - `tooling/release/test_release.py`: tests for each of the `manage.py` changes;
  - `docs/ops/release.md`: private inputs and the new command;
  - `deploy/release/checks.json`: the new tables, so `ship.py --preflight` knows them.

### Fit with specs 011, 018 and 022

- **Spec 022**: push follows its recipients and read state. No change to the bell's
  contract.
- **Spec 011**: push is a personal channel in the same delivery table. When 011 lands:
  - its severity replaces the fixed `warning` in `AlertRecipientCheck`;
  - its **Turn off all** sets `push_enabled` to false as well;
  - its channel list on the subscription leaves push out, because push is the
    person's choice.
- **Spec 018**: when offline alerts gain recipients, they write the bell row, and the
  push delivery comes with it through the same branch.

### Documentation

- `docs/adr/ADR-047-progressive-web-app-before-native-apps.md` and the ADR index.
- `docs/features/alerts.md`: a **Push notifications** section (who gets them, levels,
  organization switches, devices, bursts, payload, expiry) and the API rows.
- `docs/features/access.md`: **Keep me signed in** under Signing in.
- `docs/features/portal-on-phones.md` (new): phone pages, installing, offline
  behaviour and updates.
- `apps/api/resources/help/phone-app.md` (new; it names no product): installing on
  Android and iPhone, turning on push, lock-screen previews. Its context is
  `settings.my-notifications`, and `alert-notifications.md` links to it.
- `docs/ops/release.md`: the push keys and `webpush-keys`.
- `docs/dev/gotchas.md`:
  - iOS zooms on inputs under 16 px;
  - TanStack Query pauses offline mutations unless `networkMode: "always"`;
  - the nginx SPA fallback answers a missing `/sw.js` with HTML;
  - an installed app on iOS has its own storage and sign-in;
  - Laravel's remember token is one per user.
- `docs/dev/design-system.md`: the Phones section.
- `docs/roadmap.md`: a **Portal on phones** entry under UI, with the four triggers for
  native apps (added in the documents pull request).

## Project Structure

### Documentation (this feature)

```text
specs/033-pwa-web-push/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/push-api.md
├── contracts/push-payload.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Authentication/
│   ├── Models/KeptSignIn.php                                   # new
│   ├── Http/Middleware/ResumeKeptSignIn.php                    # new
│   ├── Http/Controllers/SessionController.php, PasswordRecoveryController.php
│   ├── Http/Requests/LoginRequest.php
│   └── Console/PruneKeptSignIns.php                            # new
├── app/Domain/Notifications/
│   ├── Models/PushDevice.php, PushSummary.php                  # new
│   ├── Services/WebPush.php, PushSender.php, AlertPushPayload.php  # new
│   ├── Services/Preferences.php
│   ├── Http/Controllers/PushSettingsController.php, PushDeviceController.php  # new
│   ├── Jobs/DeliverPushSummary.php                             # new
│   └── routes.php
├── app/Domain/Automation/
│   ├── Services/AlertRecipientCheck.php                        # new
│   ├── Services/AlertProjector.php
│   ├── Jobs/DeliverAlertPush.php                               # new
│   ├── Jobs/DeliverAlertEmail.php
│   └── Http/Controllers/AlertController.php
├── app/Console/Commands/QuarantineRestoredSideEffects.php
├── bootstrap/app.php, config/webpush.php (new), .env.example
├── database/migrations/2026_11_*_create_kept_sign_ins.php, …_create_push_devices.php,
│   …_add_push_preferences.php, …_create_push_organization_mutes.php,
│   …_add_push_delivery_columns.php, …_create_push_summaries.php  # new
├── resources/help/phone-app.md (new), alert-notifications.md, contexts.json
└── tests/Feature/Domain/Authentication/KeptSignInTest.php,
    tests/Feature/Domain/Notifications/PushDeviceTest.php, PushSettingsTest.php,
    tests/Feature/Domain/Automation/AlertPushDeliveryTest.php, PushSummaryTest.php  # new
contracts/push/alert-push.v1.schema.json, contracts/push/fixtures/*.json        # new
contracts/openapi/supplements/account.yaml, automation.yaml, contracts/openapi/openapi.json
packages/api-client/src/index.ts, notifications.ts, alerts.ts, connection.ts (new)
packages/ui/src/components/page-header.tsx, notification-bell.tsx, button.tsx, input.tsx,
  select.tsx, switch.tsx, textarea.tsx, connection-notice.tsx (new), offline-screen.tsx (new)
packages/ui/src/templates/collection-page.tsx, packages/ui/src/lib/status.ts
packages/ui/scripts/check-ui.mjs
apps/storybook/src/components/ConnectionNotice.stories.tsx, OfflineScreen.stories.tsx  # new
apps/portal/
├── vite.config.ts, index.html, package.json, pwa-assets.config.ts (new)
├── icons/app-icon.svg (new), public/pwa-*.png, apple-touch-icon-180x180.png  # new
├── src/sw.ts (new), src/main.tsx, src/App.tsx
├── src/pwa/install.ts, InstallAppDialog.tsx, UpdatePrompt.tsx, personal-state.ts,
│   push.ts, notification.ts, notification.test.ts                              # new
├── src/alerts/Alerts.tsx, MyNotifications.tsx (new), bell/AlertBell.tsx
├── src/devices/DeviceOverview.tsx, src/dashboards/DashboardWorkspace.tsx, DashboardGrid.tsx, TimeControls.tsx
├── src/settings/Settings.tsx, src/components/forms.tsx
└── e2e/phone.spec.ts, installable.spec.ts, push-settings.spec.ts             # new
deploy/docker/portal/nginx.conf (new), deploy/docker/portal/Dockerfile
deploy/compose/compose.app.yml, deploy/release/compose.yml, deploy/release/environment.example,
deploy/release/checks.json
tooling/release/manage.py, tooling/release/test_release.py
docs/adr/ADR-047-progressive-web-app-before-native-apps.md (new), docs/adr/README.md
docs/features/alerts.md, access.md, portal-on-phones.md (new)
docs/ops/release.md, docs/dev/gotchas.md, docs/dev/design-system.md, docs/roadmap.md
```

**Structure Decision**:
- Sign-in state lives in Authentication, next to the session controller.
- Personal push settings, devices and summaries live in Notifications, which already
  owns personal preferences.
- Alert fan-out and the per-alert push job live in Automation, next to the projector,
  the email job and the deliveries routes.
- Phone rules live in the kit, so admin and future pages share them.

## Delivery

Each pull request is based on `main` and opened after the one it depends on merges.
None is stacked. Pull requests 2, 3 and 4 do not depend on each other.

1. **Documents**: this folder, ADR-047 and its index row, and the roadmap entry.
2. **Phone layouts** (US1, US4):
   - Contents: the kit rules and stories, the portal page changes, `phone.spec.ts`, the
     design-system Phones section and `portal-on-phones.md` (phone pages part). The
     **My notifications** rename waits for pull request 6.
   - Verify: rebuild `portal` and `admin`, then go through US1 and US4 in the browser
     pane at 375 px and on an Android phone.
3. **Installable app** (US3):
   - Contents: the plugin, the shell-only worker, manifest and icons, the portal nginx
     config, **Install app**, the connection store, banner and offline screen,
     `networkMode`, the update prompt, `clearPersonalState`, `installable.spec.ts`, the
     gotchas, and the install part of `portal-on-phones.md`.
   - Verify: rebuild `portal` and `admin`, then go through the US3 steps of the
     quickstart in desktop Chrome and on Android.
4. **Keep me signed in** (FR-011a):
   - Contents: the migration, model, middleware, login, logout and reset changes, the
     prune, the portal checkbox, OpenAPI and `api-client`, tests, and `access.md`.
   - Verify: rebuild the API family and `portal`, then run the quickstart's kept
     sign-in steps.
5. **Push delivery (API)**, after 3 and 4 (its verification subscribes through pull
   request 3's service worker):
   - Contents: the package and the spike, config, release tooling and compose keys,
     the migrations for devices, preferences, mutes, delivery columns and summaries,
     the settings and device routes, `AlertRecipientCheck`, the projector branch,
     `DeliverAlertPush`, `DeliverPushSummary`, the deliveries fields and retry by
     channel, quarantine, the payload schema and fixtures, OpenAPI and `api-client`,
     tests, release docs, and the push section of `alerts.md` (API part).
   - Verify: rebuild the API family. Register a subscription made in desktop Chrome's
     DevTools against the dev stack, trigger an alert, and check the delivery row, the
     attempt rows and that Chrome receives a push. Chrome shows its default
     notification until pull request 6 adds the handler.
6. **Push in the portal** (US2, US5), after 3 and 5:
   - Contents: the worker's push handlers, `push.ts`, My notifications and the rename,
     the bell link, the deliveries list with channels, sign-out turn-off,
     `push-settings.spec.ts`, Vitest on the fixtures, the help article and the rest of
     the docs.
   - Verify: rebuild `portal` and `admin`, then run the quickstart's push steps on
     desktop Chrome, a real Android phone and the iOS Simulator. After the release, run
     the real-iPhone check on the pilot and record it.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Principle IX: the real-iPhone push check happens on the pilot after release, not before merge (the iOS Simulator and a real Android phone are used before merge) | iOS delivers web push only to an installed app on an HTTPS origin the phone trusts; the dev stack is plain HTTP on `localhost`, which a physical iPhone cannot reach as `localhost` | Installing a local certificate authority profile on the owner's iPhone, or exposing the dev stack through a public tunnel, are security choices for the owner, not for a plan; both remain available if the owner prefers them |
