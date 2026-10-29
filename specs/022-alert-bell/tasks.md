# Tasks: Alert Bell

**Input**: [spec.md](spec.md), [plan.md](plan.md),
[contracts/alert-notifications-api.md](contracts/alert-notifications-api.md)

**Tests**: part of the feature (SC-002, SC-003, SC-005; constitution III and IX). Write
each test with its task and see it fail first.

**Delivery**: Phases 1 to 3 are the **In-app alert notifications (API)** pull request;
Phases 4 to 8 are the **Alert bell and chime** pull request. Each is based on `main` and
opened after the one before it merges, never stacked. The documents pull request (this
folder) comes first. Tasks follow the owner's decisions on Q1 to Q3 (2026-10-29).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US4)

---

## Phase 1: Foundation, storage and writing (blocks everything)

- [X] T001 Run `php artisan make:notifications-table` and rename the result to `apps/api/database/migrations/2026_10_30_000000_create_notifications_table.php`; change `data` to `jsonb`, add `index(['type', 'created_at'])`, and, when the driver is `pgsql`, the partial expression indexes `notifications_alert_inbox` and `notifications_alert_unread` from the plan (contract export migrates SQLite)
- [X] T002 `apps/api/app/Domain/Automation/Notifications/AlertTransitionNotification.php`: not queued; `via()` `['database']`; `databaseType()` `alert`; `toDatabase()` the `v: 1` payload from the contract; constructor sets `$this->id = (string) Str::uuid7()`
- [X] T003 In `apps/api/app/Domain/Automation/Services/AlertProjector.php`, resolve the device (deployment binding, as `AlertQuery::view`) and its name in the organization and load the recipients once before the loop; where `$delivery->wasRecentlyCreated`, call `$user->notify(new AlertTransitionNotification(…))` per recipient after dispatching `DeliverAlertEmail` (depends on T001, T002)
- [X] T004 [P] Tests `apps/api/tests/Feature/Domain/Automation/AlertNotificationTest.php` (writing), using the internal transition endpoint as `AlertTest` does: one row per recipient on activation, with the contract's `data` and `type = alert`; a replayed transition adds none; a cleared row only with `notify_on_clear`; none when settings are off, the execution is stopped, or a late activation follows a clear; a recipient with every email preference off still gets the row while the email is cancelled; a failing projection rolls back the notification with the delivery (as `test_queue_and_alert_commit_atomically_and_clear_first_does_not_reopen`); DAG alerts (`DagActions`) name the bound device

**Checkpoint**: triggering an alert writes one notification per recipient.

---

## Phase 2: User Story 1, the API for the bell (Priority: P1)

**Goal**: a person lists, counts and marks read their own alert notifications per organization.

**Independent Test**: as a recipient, `GET alert-notifications` lists the new notification and the summary counts it; `POST read` clears it.

- [X] T005 [US1] `apps/api/app/Domain/Automation/Services/AlertInbox.php`: `allowed` (membership and `DeviceAuthorization::capabilities()['view']`), `query` (`notifications()->reorder()`, `type = alert`, `data->organization_uuid`, `id` descending), `page` (20 per page, live condition from one alert lookup, `meta.unread`), `summary` (unread count, newest unread activation id), `markRead` (`ids`, `up_to`, `alert_uuid` through `unreadNotifications()->update`); everything empty, zero or a no-op when not `allowed`
- [X] T006 [US1] `apps/api/app/Domain/Automation/Http/Resources/AlertNotificationResource.php` and `AlertNotificationSummaryResource.php` with the contract's shapes
- [X] T007 [US1] `apps/api/app/Domain/Automation/Http/Controllers/AlertNotificationController.php` (`index`, `summary`, `read` with "exactly one of" validation: `ids` 1–100 distinct uuids, `up_to` uuid, `alert_uuid` uuid) and the `alert-notifications` route group in `apps/api/app/Domain/Automation/routes/api.php` behind `auth:sanctum` and `ResolveOrganizationContext` (depends on T005, T006)
- [X] T008 [P] [US1] Extend `AlertNotificationTest.php` (reading): newest first, 20 per page, `meta.unread`, live `condition` after a clear, `device` null when unknown; summary ignores read and cleared notifications for `newest_unread_activation_id`; `ids` ignores another person's and another organization's ids; `up_to` leaves a newer notification unread; `alert_uuid` marks only that alert; marking twice keeps the first `read_at`; 422 for none or several fields
- [X] T009 [P] [US1] Isolation tests in `AlertNotificationTest.php` (constitution III, SC-003): a person in two organizations sees each organization's own; another member of the same organization sees none of them; a removed member gets 403 from the middleware; a member without `Device.view` and a super administrator who is not a member get an empty list, zero and a no-op read

**Checkpoint**: the bell's API works on its own.

---

## Phase 3: Retention, deletion, contract and API docs (finishes the API pull request)

- [X] T010 [P] `apps/api/app/Domain/Automation/Console/PruneAlertNotifications.php` (`alerts:prune-notifications`, deletes `type = alert` rows older than 90 days in chunks); register it in `apps/api/bootstrap/app.php` `withCommands`; schedule it daily at 03:45 in `apps/api/routes/console.php`; a test that a 91-day-old row goes and an 89-day-old one and other notification types stay
- [X] T011 [P] `apps/api/app/Domain/Administration/Services/OrganizationDeletion.php` removes the organization's `type = alert` notifications by `data->organization_uuid` beside `REMOVED_FIRST`; a test in `apps/api/tests/Feature/Domain/Administration/OrganizationDeletionApiTest.php` that another organization's rows stay
- [X] T012 `php artisan contract:export`; describe the read body in `contracts/openapi/supplements/automation.yaml` if inference cannot; `contract:export --check` and `contract:check --base=origin/main` pass; `contracts/openapi/pending-schemas.json` unchanged
- [X] T013 [P] `packages/api-client/src/alerts.ts` types (`AlertNotification`, `AlertNotificationPage`, `AlertNotificationSummary`, `AlertNotificationReadInput`) and `alertNotifications`, `alertNotificationSummary`, `markAlertNotificationsRead` in `packages/api-client/src/index.ts`
- [X] T014 [P] The three operations in the API table of `docs/features/alerts.md`
- [X] T015 Verify the API pull request: `./taskw lint`; `cd apps/api && php artisan test --compact` on PostgreSQL; rebuild `api automation-worker alerts-worker webhooks-worker assistant-worker scheduler` with the stack's env files and overlays ([local setup](../../docs/dev/local-setup.md#rebuild-one-service)), run `php artisan migrate --force` in `api`, trigger an alert for an automation that lists you (a simulator from [simulators and fixtures](../../docs/dev/simulators-and-fixtures.md)), and check `GET alert-notifications/summary` in the signed-in portal session

**Checkpoint**: the API pull request is ready to open from `main`.

---

## Phase 4: Kit (opens the bell pull request)

- [X] T016 [P] `packages/ui/src/components/notification-bell.tsx` (`NotificationBell` per the plan: ghost icon button with `text-micro` count and "9+", accessible name with the count, end-aligned `Popover` at most `min(24rem, 100vw - 2rem)` wide, header actions, toolbar, items with `Status` and `RelativeTime`, loading, error, empty, **Show older**, footer)
- [X] T017 [P] `alert` domain in `packages/ui/src/lib/status.ts` (`activated` and `active` warning, `cleared` muted)
- [X] T018 `apps/storybook/src/components/NotificationBell.stories.tsx`: unread, read, empty, loading, error, long names, phone viewport; the accessibility addon passes (depends on T016, T017)

---

## Phase 5: User Story 1, the bell in every header (Priority: P1) 🎯 MVP

**Goal**: recipients see and open their alert notifications from any page.

**Independent Test**: trigger an alert as a recipient; within 20 seconds the bell on any page shows it and opens the alert.

- [X] T019 [US1] `apps/portal/src/alerts/bell/AlertBellProvider.tsx`: per-organization context; polls `alertNotificationSummary` at 15 s visible and 60 s hidden with `refetchIntervalInBackground: true`; disabled without `Device.view`; errors leave the count empty
- [X] T020 [US1] `apps/portal/src/alerts/bell/AlertBell.tsx` composing `NotificationBell`: `useInfiniteQuery` while open (refetch every 15 s while open), items mapped to workflow, device, `alert` status and time, the live condition, select marks read by id and navigates to `/organizations/{org}/alerts/{alert}`, **Mark all read** with `up_to`, footer link to Alerts; optimistic summary update after marking
- [X] T021 [US1] `apps/portal/src/App.tsx`: mount `AlertBellProvider` inside `RuntimeStatusProvider`; put `AlertBell` first in `helpIntegration.trigger` when `devicesCan("view")(org)`
- [X] T022 [P] [US1] `apps/portal/e2e/alert-bell.spec.ts` with route mocks: badge count, list content and order, selecting an item posts `ids` and lands on the alert, **Mark all read** posts `up_to` with the newest id, **Show older**, the Alerts link, a viewer without device view sees no bell, axe check, and at 375 px the popover fits without sideways scroll (SC-005)
- [X] T023 [P] [US1] Mock `alert-notifications/summary` in `apps/portal/e2e/alerts.spec.ts`, and in any other spec whose header now fails because of the new request; all portal specs pass

**Checkpoint**: the bell works without sound.

---

## Phase 6: User Story 2, the chime (Priority: P1)

**Goal**: one short chime per new activation while the portal is open.

**Independent Test**: click once in the page, trigger an alert, hear one chime; reload, hear nothing; with three tabs, one chime.

- [X] T024 [P] [US2] `apps/portal/src/alerts/bell/model.ts` `nextChime(state, summary)` and `apps/portal/src/alerts/bell/model.test.ts`: no chime on the first summary, chime for a greater id, none for an equal or smaller id or `null`, the baseline moves forward
- [X] T025 [P] [US2] `apps/portal/src/alerts/bell/chime.ts`: lazy `AudioContext` unlocked on the first `pointerdown` or `keydown`, synthesized two-note chime, `play()` returning false when locked or missing; `soundEnabled`/`setSoundEnabled` and `claim(userId, id)` on `localStorage`, each in try/catch; unit tests in `apps/portal/src/alerts/bell/chime.test.ts` with throwing storage and a missing `AudioContext`
- [X] T026 [US2] Wire the chime into `AlertBellProvider.tsx`: on a new activation, play when sound is on and `claim` succeeds; a polite live region names the automation whether or not sound is on; invalidate the list (depends on T019, T024, T025)
- [X] T027 [US2] Sound `Switch` in the bell's toolbar in `AlertBell.tsx` (on by default, shared by the browser's tabs)
- [X] T028 [P] [US2] Chime cases in `apps/portal/e2e/alert-bell.spec.ts` with `AudioContext` stubbed through `page.addInitScript` to count note starts: none on load with unread backlog; one after the mocked summary returns a newer activation id; none for a newer cleared notification; none when muted; two pages in one context play once (SC-002); a page without interaction plays nothing and shows no error

**Checkpoint**: US1 and US2 together are the request.

---

## Phase 7: User Story 3, the empty state (Priority: P2)

- [X] T029 [US3] Empty state in `AlertBell.tsx`: explains recipients; links to `settings/notifications` with `devicesCan("manage")`, otherwise says to ask someone who manages automations
- [X] T030 [P] [US3] Empty-state cases for a manager and a viewer in `apps/portal/e2e/alert-bell.spec.ts`

---

## Phase 8: User Story 4, opening an alert reads it (Priority: P3), docs and verification

- [X] T031 [US4] The alert detail in `apps/portal/src/alerts/Alerts.tsx` posts `{alert_uuid}` once when shown and invalidates the bell summary; a case in `apps/portal/e2e/alerts.spec.ts`
- [X] T032 [P] Docs: "In-app notifications" in `docs/features/alerts.md` (who gets them, the bell, sound and its limits, polling, 90-day retention); the bell and sound in `apps/api/resources/help/alert-notifications.md` (bump `revision`; `php artisan help:validate` passes); two entries in `docs/dev/gotchas.md` (stub `data` is text, preset ids with several notifiables); live delivery with Reverb under Automation and alerts in `docs/roadmap.md`
- [X] T033 `pnpm --filter @iot-os/portal lint` and `test`, `pnpm --filter @iot-os/admin lint`, the portal Playwright suites, `./taskw lint`
- [X] T034 Rebuild `portal admin` (and the API-image services if this pull request touched `apps/api`) with the stack's env files and overlays; in the running portal, without discarding anyone's unsaved edits: make yourself a recipient, click once, trigger an alert and hear one chime with three tabs open, open the bell, follow the item, mark all read, mute and trigger again, check a phone-width window, and check a background tab within about a minute (SC-001)

**Checkpoint**: the bell pull request is ready to open from `main`.

---

## Dependencies

Phase 1 blocks everything. Phase 2 needs Phase 1; Phase 3 needs Phase 2's routes for the
contract. The portal pull request needs the API pull request merged. Within it, Phase 4
comes first; Phases 5 and 6 can overlap once T019 exists; Phases 7 and 8 need Phase 5.

## MVP

US1 and US2 (Phases 1 to 6). US3 and US4 are small and ship in the same pull request.
