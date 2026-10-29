# Implementation Plan: Alert Bell

**Branch**: `spec/022-alert-bell` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/022-alert-bell/spec.md`

## Summary

`AlertProjector` already fans an alert transition out to one `AlertDelivery` per
recipient and queues the email in the runtime inbox transaction. Next to each new
delivery it now calls `$user->notify()` with an `AlertTransitionNotification` that uses
Laravel's first-party **database channel** only, so the row lands in the `notifications`
table in the same transaction. A small `AlertInbox` service in the Automation domain
reads it back per organization, re-checking membership and `Device.view` on every
request, and three organization routes list, summarise and mark read.

The portal mounts one `AlertBellProvider` per organization that polls the summary (15 s
visible, 60 s hidden) and decides when to chime. A new kit component, `NotificationBell`,
renders the header button, badge and popover; the portal's `AlertBell` fills it with
alert notifications and sits in every page header beside Assistant and Help. The chime
is synthesized with the Web Audio API, unlocked by the first interaction, muted per
browser, and claimed through `localStorage` so one tab plays it.

The plan follows the owner's decisions on Q1 to Q3 (2026-10-29), which kept the
spec's recommended answers.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13.35 (`apps/api/composer.lock`); TypeScript,
React 19

**Primary Dependencies**: Laravel notifications (`Notifiable` is already on
`App\Domain\Shared\Models\User`; `DatabaseChannel`, `DatabaseNotification`,
`databaseType()`, `Str::uuid7()`, `make:notifications-table`, all present in 13.35);
TanStack Query 5 (`refetchInterval` as a function, `refetchIntervalInBackground`,
`useInfiniteQuery`); `@iot-os/ui` (`Popover`, `Button`, `Switch`, `EmptyState`,
`Status`/`statusOf`, `RelativeTime`); Web Audio API, `localStorage`

**Storage**: PostgreSQL 17, one new table (`notifications`, Laravel's stub with `data` as
`jsonb`) and two partial expression indexes; no change to existing tables

**Testing**: PHPUnit on PostgreSQL (`cd apps/api && php artisan test --compact`), contract
checks; Vitest for the chime decision; Playwright with route mocks and a stubbed
`AudioContext`; a story for the kit component; a manual run in the rebuilt stack

**Target Platform**: `api` and the API-image workers, `portal`, `admin` (kit change)

**Project Type**: web application

**Performance Goals**: summary in two indexed lookups; list in one indexed page query
plus one alert lookup for at most 20 uuids

**Constraints**: no runtime change, no websocket infrastructure, no audio asset, email
behaviour unchanged

**Scale/Scope**: 1 migration, 1 notification class, 1 service, 1 controller, 2 resources,
1 console command, 3 routes; 1 kit component, 1 provider, 1 portal component

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel writes and serves notifications; the runtime is untouched and the portal talks only to the API. |
| II. Immutable versions | Pass. Nothing versioned changes. |
| III. Tenant isolation | Pass. Routes sit under `organizations/{organization}` behind `ResolveOrganizationContext`; the organization comes from the route. `AlertInbox` scopes every query to the signed-in notifiable and the route's organization uuid and requires current membership plus `Device.view` (super administrators who are not members see nothing). Tests cover another organization, another person, a removed member and lost view. |
| IV. Contracts first | Pass. Typed resources so the three operations export with real bodies (not pending); `contract:export` and `contract:check --base=origin/main`; `packages/api-client` in the same pull request. No user references cross the API (the notifiable is the requester). |
| V. AI proposes | Pass. No AI involvement; the assistant and agent tools do not read the bell. |
| VI. Show uncertainty | Pass. The list shows each alert's current condition next to the transition, an unknown device is omitted, and a chime that cannot play fails silently while the badge still updates. |
| VII. Durable, idempotent messaging | Pass. The notification is written in the projector's transaction and only when its delivery row is new, so replays create none. Notifications expire after 90 days (Q1) through a scheduled prune. Polling is not messaging. |
| VIII. One design system | Pass. `NotificationBell` is a kit component with a story; status through a new `alert` domain in `statusOf`; `RelativeTime`; named type scale; `check-ui` passes. |
| IX. Verified where it runs | Pass. PostgreSQL CI; rebuild the API-image services, `portal` and `admin`; trigger a real alert in the local stack and hear it. |

## Decisions

| Decision | Chosen | Rejected because |
| --- | --- | --- |
| Storage | Laravel database notifications (`notifications` table, `read_at`, `unreadNotifications()`) | A custom `alert_inbox` table duplicates what the framework maintains. |
| Organization filter | `data` as `jsonb`, queried with `where('data->organization_uuid', …)`, served by partial expression indexes | A separate `organization_id` column needs a subclassed `DatabaseChannel` to fill it; the stock channel and model stay untouched this way. Cost: no foreign key, so organization deletion removes the rows explicitly (tested). |
| Notification id | `Str::uuid7()` set in the constructor | Eloquent writes whole-second timestamps on PostgreSQL, so `created_at` ties; v7 ids sort by time and serve as the "newest seen" cursor and the **Mark all read** bound. |
| Idempotency | Write only when `AlertDelivery::firstOrCreate` created the row, as the email dispatch does | A unique expression index would abort the runtime inbox transaction on a duplicate instead of skipping it. |
| Domain | Automation (`AlertProjector`, `Alert`, the alert routes and access rules live there) | Notifications holds preferences and the organization-wide event log, which this does not change. |
| Delivery to the browser | Polling the summary, 15 s visible and 60 s hidden | Reverb (`broadcast` channel on the same notification) needs a websocket service and proxy in every deployment profile; it remains the upgrade path. |
| Sound | Web Audio synthesis, unlocked on the first `pointerdown` or `keydown` | An audio file adds an asset and still needs the unlock. |
| One tab chimes | `localStorage` compare-and-set of the newest chimed id, only by a tab whose audio is running | BroadcastChannel needs leader election; a Web Locks leader may be a tab whose audio is still locked. |

## Design

### Storage (`2026_10_30_000000_create_notifications_table.php`)

Generated with `php artisan make:notifications-table`, then edited:

- `data` is `jsonb` instead of `text` (JSON path queries need it on PostgreSQL).
- `index(['type', 'created_at'])` for the prune.
- PostgreSQL only (export migrates SQLite; guard with the driver name):
  - `notifications_alert_inbox` on `(notifiable_id, (data->>'organization_uuid'), id desc) where type = 'alert'`
  - `notifications_alert_unread` on the same columns `where type = 'alert' and read_at is null`

The stock `morphs('notifiable')` index stays. Users are never hard-deleted, so no user
cleanup is needed. The `data` shape is in [the contract](contracts/alert-notifications-api.md).

### Writing (`AlertProjector`)

- `App\Domain\Automation\Notifications\AlertTransitionNotification` (not queued):
  `via()` returns `['database']`, `databaseType()` returns `alert`, `toDatabase()` the
  `v: 1` payload; the constructor sets `$this->id = (string) Str::uuid7()`.
- In `AlertProjector::project`, before the recipient loop, resolve the device from the
  deployment binding (`definition.binding.device_uuid`, else `bindings[0].device_uuid`,
  as `AlertQuery::view` does; DAG transitions carry no `device_uuid`) and its name within
  the organization, and load the recipients once. Inside the loop, where
  `$delivery->wasRecentlyCreated`, call `$user->notify(new AlertTransitionNotification(…))`
  after dispatching the email job.
- One instance per recipient: `Notification::send($users, $one)` would reuse the preset id
  for every notifiable and collide on the primary key.
- No new eligibility rules: the existing early returns (settings off, recovery off,
  stopped execution, late activation, replay) already guard the loop. Recipients who lost
  access still get the row, as they still get a delivery row; reads hide it (FR-007).

### Reading (`AlertInbox` service, `AlertNotificationController`)

- `AlertInbox::allowed(User, Organization)`: membership (`organizations()->whereKey`) and
  `DeviceAuthorization::capabilities(...)['view']`, the same pair `DeliverAlertEmail`
  checks, without email verification.
- `query(User, Organization)`: `$user->notifications()->reorder()->where('type', 'alert')
  ->where('data->organization_uuid', $organization->uuid)`; ordered by `id` descending.
- `page()`: 20 per page; one `Alert::where('organization_id', …)->whereIn('uuid', …)`
  lookup adds the live condition; `meta.unread` from the unread index.
- `summary()`: unread count and the newest unread `activated` id
  (`where('data->transition', 'activated')`).
- `markRead()`: `ids`, `up_to` or `alert_uuid`, through
  `$user->unreadNotifications()->…->update(['read_at' => now()])`, scoped like `query()`.
- Resources `AlertNotificationResource` and `AlertNotificationSummaryResource` give the
  contract typed bodies.
- Routes, in `apps/api/app/Domain/Automation/routes/api.php`:

| Route | Notes |
| --- | --- |
| `GET organizations/{o}/alert-notifications` | `page` |
| `GET organizations/{o}/alert-notifications/summary` | polled |
| `POST organizations/{o}/alert-notifications/read` | exactly one of `ids`, `up_to`, `alert_uuid` |

The API path `alert-notifications` does not touch the portal's legacy
`/notifications` and `/organizations/{org}/alerts/notifications` redirects, and adds no
portal route.

### Retention and deletion

- `alerts:prune-notifications` (`app/Domain/Automation/Console`) deletes `type = 'alert'`
  rows older than 90 days in chunks; registered in `bootstrap/app.php` `withCommands`
  and scheduled daily at 03:45 in `routes/console.php` beside the other prunes.
- `OrganizationDeletion::delete` removes the organization's alert notifications with the
  `REMOVED_FIRST` tables. Alerts already block deletion, so this only clears leftovers,
  but the jsonb link has no foreign key for `OrganizationDeletionInventoryTest` to catch.

### Contract and client

- `php artisan contract:export` adds the three operations; a short note in
  `contracts/openapi/supplements/automation.yaml` describes the "exactly one of" body if
  inference cannot.
- `packages/api-client/src/alerts.ts`: `AlertNotification`, `AlertNotificationPage`,
  `AlertNotificationSummary`, `AlertNotificationReadInput`; `index.ts`:
  `alertNotifications(org, page, signal)`, `alertNotificationSummary(org, signal)`,
  `markAlertNotificationsRead(org, input)`.

### Kit (`packages/ui`)

- `components/notification-bell.tsx`, `NotificationBell`: a ghost icon button
  (`BellIcon`, count badge in `text-micro`, "9+" above nine, accessible name
  "Notifications, N unread") opening a `Popover` aligned to the end, at most
  `min(24rem, 100vw - 2rem)` wide with a scrolling list. Slots: header actions, a toolbar
  (the sound switch), items (`id`, `title`, `description`, `status` and `domain`,
  `time`, `to`, `unread`), loading, error, empty, **Show older**, footer. Generic: the
  app maps its records to items. Story with unread, read, empty, loading, error, long
  names and a phone viewport.
- `lib/status.ts` gains an `alert` domain: `activated` (warning, "Activated"), `active`
  (warning, "Active"), `cleared` (muted, "Cleared"), matching the Alerts page. The shared
  vocabulary's `activated` is "good", which is wrong for an alert.

### Portal (`apps/portal/src/alerts/bell/`)

- `chime.ts`: lazily creates one `AudioContext` on the first `pointerdown` or `keydown`
  (capture, passive) and resumes it; `play()` synthesizes two short sine notes (about
  880 Hz then 1175 Hz, 0.4 s, gain at most 0.15 with a fast attack and exponential decay)
  and returns false when audio is locked or missing. `soundEnabled()` and
  `setSoundEnabled()` use `iot-os.alert-bell.sound`; `claim(userId, id)` compares and
  sets `iot-os.alert-bell.chimed.{userId}`. Every storage call is wrapped in try/catch;
  without storage every tab may chime.
- `model.ts`: a pure `nextChime(state, summary)` that sets the baseline on the first
  summary and asks for a chime only when `newest_unread_activation_id` is greater than
  the baseline; unit-tested.
- `AlertBellProvider.tsx`: mounted once per organization in `App.tsx` (inside
  `RuntimeStatusProvider`), so polling and the baseline survive page changes (each page
  renders its own header). Polls `alertNotificationSummary` with `refetchInterval` 15 s
  when `document.visibilityState` is visible and 60 s otherwise, and
  `refetchIntervalInBackground: true`. On a new activation: plays (if sound is on and
  `claim` succeeds), updates a polite live region, and invalidates the list. Disabled
  without `Device.view`.
- `AlertBell.tsx`: composes `NotificationBell`; `useInfiniteQuery` for the list while
  open (refetched every 15 s while open); selecting an item marks it read by id and
  navigates; **Mark all read** sends `up_to` with the newest listed id; the sound
  `Switch`; the empty state links to `settings/notifications` when
  `devicesCan("manage")`; the footer links to `alerts`. Errors keep the bell quiet (no
  badge) rather than breaking the header.
- `App.tsx`: the bell goes first in `helpIntegration.trigger`, left of Assistant, so the
  right-aligned Assistant and Help keep their places; only with `devicesCan("view")`.
- `Alerts.tsx`: the alert detail marks that alert's notifications read when shown (Q3)
  and invalidates the bell summary.

### Background tabs

Hidden tabs keep polling at 60 s. Chrome's intensive throttling already aligns hidden
timers to about a minute after five minutes, so a chime there can lag up to a minute.
An unlocked `AudioContext` plays in a hidden tab; browsers that freeze background tabs
(mobile Safari, Chrome's memory saver) play nothing while frozen. When the tab returns,
its next check updates the count and chimes once if the activation is still unread and
no other tab has claimed it.

### Cost of polling

Per open tab: one request every 15 s visible or 60 s hidden. Each runs the session and
organization middleware, the capabilities check and two index lookups. 100 visible tabs
make about 7 requests per second, well below what the Alerts page's 5-second polls
already ask of the same host. The list is fetched only while the bell is open.

### Fit with specs 011 and 018

In-app is the always-on personal channel. Spec 011's per-channel deliveries must keep one
notification per alert, transition and person: the projector loop creates it once per
recipient, not per channel. Its severity joins the payload as an optional field. Spec
018's offline-alert delivery calls the same notification for each routed or subscribed
recipient, adds `source: "connectivity"` and a null workflow, and skips held-back
flapping episodes.

### Documentation

- `docs/features/alerts.md`: an "In-app notifications" section (who gets them, the
  bell, sound, polling, retention) and the three API rows.
- `apps/api/resources/help/alert-notifications.md`: the bell and the sound switch.
- `docs/dev/gotchas.md`: the notifications stub stores `data` as text (JSON paths need
  `jsonb` on PostgreSQL), and a notification with a preset id must not be sent to several
  notifiables.
- `docs/roadmap.md`: live alert delivery with Reverb under Automation and alerts.

## Project Structure

### Documentation (this feature)

```text
specs/022-alert-bell/
├── spec.md
├── plan.md
├── contracts/alert-notifications-api.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/database/migrations/2026_10_30_000000_create_notifications_table.php   # new
apps/api/app/Domain/Automation/
├── Notifications/AlertTransitionNotification.php                                 # new
├── Services/AlertInbox.php                                                       # new
├── Services/AlertProjector.php
├── Http/Controllers/AlertNotificationController.php                              # new
├── Http/Resources/AlertNotificationResource.php, AlertNotificationSummaryResource.php  # new folder
├── Console/PruneAlertNotifications.php                                           # new
└── routes/api.php
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/bootstrap/app.php, apps/api/routes/console.php
apps/api/tests/Feature/Domain/Automation/AlertNotificationTest.php                # new
apps/api/resources/help/alert-notifications.md
contracts/openapi/openapi.json, contracts/openapi/supplements/automation.yaml
packages/api-client/src/alerts.ts, packages/api-client/src/index.ts
packages/ui/src/components/notification-bell.tsx (new), packages/ui/src/lib/status.ts
apps/storybook/src/components/NotificationBell.stories.tsx                         # new
apps/portal/src/alerts/bell/chime.ts, model.ts, model.test.ts,
  AlertBellProvider.tsx, AlertBell.tsx                                             # new
apps/portal/src/App.tsx, apps/portal/src/alerts/Alerts.tsx
apps/portal/e2e/alert-bell.spec.ts (new), apps/portal/e2e/alerts.spec.ts
docs/features/alerts.md, docs/dev/gotchas.md, docs/roadmap.md
```

**Structure Decision**: everything server-side stays in the Automation domain next to
the projector and alert routes; the only shared UI is the generic kit component.

## Delivery

Each pull request is based on `main` and opened after the previous one merges; none is
stacked.

1. **Documents**: this folder.
2. **In-app alert notifications (API)**: migration, notification, projector change,
   `AlertInbox`, routes, resources, prune, organization deletion, contract export,
   api-client, the API rows in `docs/features/alerts.md`, tests. Rebuild the API-image
   services and check that a triggered alert writes one row per recipient. Useful alone:
   notifications start accumulating before the bell ships.
3. **Alert bell and chime (portal)**: kit component and story, status domain, provider,
   bell, chime, `App.tsx`, the alert detail's mark read, Vitest and Playwright, the
   in-app docs and help, gotchas and roadmap. Rebuild `portal` and `admin` and verify
   with a real alert.

## Complexity Tracking

No violations.
