# Tasks: Support Tickets

**Input**: [spec.md](spec.md), [plan.md](plan.md)

All tasks land in one pull request based on `main`. Tests are part of the feature
(SC-003, SC-004).

## Phase 1: Foundation

- [x] T001 Migration `apps/api/database/migrations/2026_10_19_000000_create_support_tickets.php`: the seven `support_*` tables and `notification_preferences.ticket_email` (default true), with the indexes and unique keys in the plan
- [x] T002 [P] Enums in `apps/api/app/Domain/Support/Enums/`: `TicketType`, `TicketStatus` (`isOpen`, labels), `TicketPriority`, `TicketEventKind`
- [x] T003 [P] Models in `apps/api/app/Domain/Support/Models/`: `Ticket`, `TicketParticipant`, `TicketMessage`, `TicketAttachment`, `TicketEvent`
- [x] T004 `TicketAccess` in `apps/api/app/Domain/Support/Services/TicketAccess.php`: `isTeam`, `visibleIn`, `canSee` (deleted organization case), `canReply`
- [x] T005 Routes file `apps/api/app/Domain/Support/routes/api.php` required from `apps/api/routes/api.php`; rate limiters `support-tickets` (10/h) and `support-messages` (60/h) in `AppServiceProvider`; `/me` `manage_tickets` in `AuthenticatedUserResource`; `config/app.php` `admin_url`

## Phase 2: File a ticket (US1, P1)

- [x] T006 [US1] `TicketAttachments` in `Services/TicketAttachments.php`: content check (PNG, JPEG, WebP, PDF), 10 MB, five per message, 50 per ticket, storage under `support/{ticket}/{attachment}`, download response, cleanup
- [x] T007 [US1] `Tickets::file` and `Tickets::markRead` in `Services/Tickets.php`: idempotent on `client_id`, creation event, activity columns
- [x] T008 [US1] `TicketController` (`index`, `store`, `summary`, `show`, `read`, `attachment`) and `TicketResource` / `TimelineResource` (member audience) in `Http/`
- [x] T009 [P] [US1] Tests `apps/api/tests/Feature/Domain/Support/FilingTest.php` and `AttachmentsTest.php`

## Phase 3: Team triage (US2, P1)

- [x] T010 [US2] `Tickets::update` (team fields under revision, 409) and team replies and internal notes with an optional status change in one action
- [x] T011 [US2] `AdminTicketController` (`index` with filters and `meta.awaiting`, `show`, `update`, `message`, `read`, `attachment`, `assignees`) and team audience in the resources
- [x] T012 [P] [US2] Tests `TeamTest.php`: 403 for platform administrators and members on every team route, field events, 409, notes hidden from members

## Phase 4: Reporter conversation (US3, P1)

- [x] T013 [US3] `Tickets::reply` for people: automatic moves (`needs_info`/`resolved` → `in_review`, `cause = reply`), Declined refuses, `awaiting_team`; reporter title edit and close through `PATCH`
- [x] T014 [US3] `TicketMessageController` (member replies)
- [x] T015 [P] [US3] Tests `StatusFlowTest.php` and `VisibilityTest.php` (another organization, untagged and removed members, deleted organization, list and summary counts)

## Phase 5: Participants (US4, P2)

- [x] T016 [US4] `Tickets::addParticipant` / `removeParticipant` (limit 10, members of the ticket's organization, participants cannot tag, leaving, reporter not removable) and the people search
- [x] T017 [US4] `TicketParticipantController` (member and team routes); `OrganizationDeletion` removes participants of the organization's tickets
- [x] T018 [P] [US4] Tests `ParticipantsTest.php`

## Phase 6: Email (US5, P2)

- [x] T019 [US5] `TicketNotifier` (recipients per action, delivery rows with unique `(action_key, user_id)`, job queued on `alerts`) wired into every `Tickets` action
- [x] T020 [US5] `DeliverTicketEmail` job and `TicketActivityMail` (Markdown view `resources/views/mail/support/activity.blade.php`); `Preferences::ticketEmail` and the email preferences endpoint accepting `ticket_email`
- [x] T021 [P] [US5] Tests `EmailTest.php`

## Phase 7: Delete (US6, P3)

- [x] T022 [US6] `Tickets::delete` and `DELETE admin/tickets/{ticket}` with the `support.ticket_deleted` audit event
- [x] T023 [P] [US6] Tests `DeletionTest.php` (ticket delete; organization deletion keeps tickets and is not blocked)

## Phase 8: Contract and clients

- [x] T024 `contracts/openapi/supplements/support.yaml`, then `php artisan contract:export`; `contract:export --check` and `contract:check --base=origin/main` pass
- [x] T025 [P] `packages/api-client/src/support.ts` and exports in `index.ts`; `manage_tickets` and `ticket_email` in the shared types
- [x] T026 [P] Kit `packages/ui/src/components/thread.tsx` and `composer.tsx` with stories in `apps/storybook`; `ticket` status domain in `packages/ui/src/lib/status.ts`
- [x] T027 [US1] [US3] [US4] Portal `apps/portal/src/support/`: `SupportPage`, `NewTicketPage`, `TicketPage`; routes and the **Support** sidebar item with unread badge in `App.tsx`; Help panel and command palette entries
- [x] T028 [US5] Portal Settings → Email **Support tickets** switch in `apps/portal/src/alerts/EmailPreferences.tsx`
- [x] T029 [US2] [US6] Admin `apps/admin/src/pages/TicketsPage.tsx` on `InboxPage` with the ticket detail; routes in `App.tsx`; sidebar item with awaiting count in `layout/AdminLayout.tsx`
- [x] T030 [P] Playwright `apps/portal/e2e/support.spec.ts` and `apps/admin/e2e/admin.spec.ts`

## Phase 9: Release, docs and verification

- [x] T031 `ADMIN_FRONTEND_URL` in `deploy/release/compose.yml`, `deploy/release/environment.example`, `deploy/compose/compose.app.yml`
- [x] T032 Docs: `docs/features/support.md` (new), `docs/README.md`, `docs/features/access.md`, `docs/features/alerts.md`, `apps/admin/README.md`
- [x] T033 `./taskw lint`, `php artisan test --compact` on PostgreSQL, portal and admin lint
- [x] T034 Rebuild `api`, `alerts-worker`, `portal`, `admin`; run each user story's independent test with Mailpit (SC-001, SC-002)

## Dependencies

Phase 1 blocks everything. US1 (Phase 2) comes before US2 and US3, which share
`Tickets` and the resources. US4 and US5 need US3's reply path; US6 is independent
after US2. Clients (Phase 8) need the API; T025 and T026 can run in parallel, then
portal and admin can run in parallel.

## MVP

US1 to US3: filing, triage and the conversation. US4 to US6 complete the spec and
ship in the same pull request.
