# Implementation Plan: Support Tickets

**Branch**: `spec/015-support-tickets` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-support-tickets/spec.md`

## Summary

A new Laravel domain, `Support`, owns tickets, their participants, messages,
attachments, timeline events, read positions and email deliveries. One service,
`Tickets`, performs every change in a transaction that locks the ticket, writes the
timeline and queues email deliveries; `TicketAccess` is the only place that decides
who may see a ticket. Members use organization routes; super administrators use
`/api/v1/admin/tickets`.

The portal gains **Support** (list, new ticket, ticket page) and entry points in Help
and the command palette. The admin app gains **Tickets**, a queue on the kit's
`InboxPage`. Two generic kit components, `Thread` and `Composer`, and the shared
`TicketThread` built on them render the conversation and the reply box in both apps.

Spatie activity log is not installed and is not added: the ticket timeline is the
ticket's history, and a platform-wide entity history is a separate ADR (see Complexity
Tracking).

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript, React 19

**Primary Dependencies**: Laravel queues (the `alerts` connection and `alerts-worker`),
Laravel Mail with Markdown mailables, `finfo` content checks as the assistant uses,
`@iot-os/ui` (`InboxPage`, `EntityPage`, `CollectionPage`, `DataTable`, `Panel`,
`Markdown`, `Message`, `Bubble`, `Attachment`, `SearchableSelect`, `FilterBar`,
`ChoiceCard`, `AlertDialog`, `SidebarMenuBadge`), TanStack Query

**Storage**: PostgreSQL 17, seven new tables and one column; files on the `local`
disk under `support/` (the release mounts `${STATE_DIR}/app`, which backups include)

**Testing**: PHPUnit on PostgreSQL (CI and a throwaway TimescaleDB locally), with the
contract checks; Playwright with a mocked API for portal and admin; stories and
`check-ui` for the kit; a manual run in the rebuilt stack with Mailpit

**Target Platform**: API, `alerts-worker`, portal and admin (pilot release profile)

**Project Type**: web application

**Performance Goals**: lists answer in under 300 ms for 10,000 tickets (indexed
filters, paged); unread counts are one indexed query

**Constraints**: no AI, no runtime change; attachments never served from a public URL

**Scale/Scope**: 1 migration, 6 models, 4 services, 1 job, 1 mailable, 4 controllers,
2 kit components, 3 portal pages, 2 admin pages

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Laravel owns intent | Pass. Laravel only; the runtime is untouched. |
| II. Immutable versions | Pass. Nothing versioned is touched. |
| III. Tenant isolation | Pass. Member routes sit under `organizations/{organization}` behind `ResolveOrganizationContext`; the organization comes from the route, never the body. `TicketAccess` adds reporter-or-participant and current membership. Tests cover another organization, an untagged member, a removed member, the people search, downloads, unread counts and email recipients. |
| IV. Contracts first | Pass. Typed resources, a `support.yaml` supplement for multipart bodies, no pending schemas; `packages/api-client` gains `support.ts`; people are integer `user_id`s. |
| V. AI proposes | Pass. No AI involvement. |
| VI. Show uncertainty | Pass. Recorded context is labelled "as reported by the browser"; email delivery state is kept per recipient. |
| VII. Durable messaging | Pass. Deliveries are rows with a unique `(action_key, user_id)` and a job queued in the same transaction; the job is idempotent and gives up after its retries. Tickets are records, not a journal, so no pruning job. |
| VIII. One design system | Pass. Kit templates and components; two new kit components with stories; ticket statuses join `statusOf` as a `ticket` domain. |
| IX. Verified where it runs | Pass. PostgreSQL CI, rebuilt `api`, `alerts-worker`, `portal` and `admin`, the flow exercised end to end with Mailpit. |

## Design

### Storage (`2026_10_19_000000_create_support_tickets`)

- `support_tickets`: `id` (shown as the ticket number), `uuid`, `organization_id`
  (nullable, null on delete), `reporter_id`, `client_id` (unique with `reporter_id`),
  `type`, `title`, `status`, `priority` (default `normal`), `assignee_id` (nullable,
  null on delete), `context` (jsonb: `path`, `user_agent`, `screen`, `time_zone`),
  `revision`, `awaiting_team` (bool), `last_activity_at`, `last_public_activity_at`,
  `last_public_actor_id`, `sequence` and `public_sequence` (activity counters for
  unread marks; timestamps keep whole seconds and would tie), `closed_at`,
  timestamps. Indexes: `(organization_id,
  last_activity_at)`, `(status, awaiting_team, last_activity_at)`, `assignee_id`,
  `reporter_id`.
- `support_ticket_participants`: `ticket_id`, `user_id` (unique pair), `added_by`,
  `created_at`.
- `support_ticket_messages`: `id`, `uuid`, `ticket_id`, `author_id`, `body`,
  `internal`, `from_team` (written in admin; stays marked Team), `client_id` (unique
  with `author_id`), `created_at`.
- `support_ticket_attachments`: `id`, `uuid`, `ticket_id`, `message_id`, `name`,
  `mime`, `size`, `path`, `created_at`.
- `support_ticket_events`: `id`, `ticket_id`, `actor_id` (nullable), `kind`, `from`,
  `to` (jsonb), `internal`, `cause` (`reply` for automatic moves), `created_at`.
- `support_ticket_reads`: `ticket_id`, `user_id` (primary key pair), `sequence`,
  `public_sequence` (how far the person has read), `read_at`.
- `support_ticket_email_deliveries`: `id`, `ticket_id`, `user_id`, `action_key`
  (unique with `user_id`), `audience` (`people` or `team`), `status`, `sent_at`,
  timestamps.
- `notification_preferences.ticket_email` boolean, default true.

Child tables cascade with their ticket. Users are never hard-deleted today; foreign
keys to users restrict.

### Domain (`App\Domain\Support`)

- **Enums**: `TicketType` (`bug`, `feature_request`, `improvement`), `TicketStatus`
  (`new`, `in_review`, `needs_info`, `planned`, `in_progress`, `resolved`, `declined`;
  `isOpen()`), `TicketPriority` (`low`, `normal`, `high`, `urgent`), `TicketEventKind`.
- **`TicketAccess`**: `isTeam(User)` (`is_super_admin`); `visibleIn(User,
  Organization)` query (reporter or participant, organization from the route); `canSee`
  for one ticket (a ticket whose organization was deleted is the team's only);
  `canReply` (Declined is team-only). Membership itself is already enforced by the organization middleware.
- **`Tickets`**: `file`, `reply`, `update` (team fields under revision, or the
  reporter's title and close), `addParticipant`, `removeParticipant`, `markRead`,
  `delete`. Each locks the ticket row, appends events, maintains `awaiting_team` and
  the activity columns, applies the automatic status moves (reply on `needs_info` or
  `resolved` → `in_review`, `cause = reply`), and asks `TicketNotifier` for
  deliveries. Client ids make `file` and `reply` idempotent: the same id and content
  returns the existing record; the same id with other content is 409, as alert
  comments do.
- **`TicketAttachments`**: content check with `finfo` (PNG, JPEG, WebP, PDF), size and
  count limits, store at `support/{ticket uuid}/{attachment uuid}`, stream downloads
  with the stored type, `nosniff`, and `Content-Disposition: inline` only for images.
  Files written before a failed transaction are removed in a `finally`.
- **`TicketNotifier`**: works out recipients per action (spec US5), inserts delivery
  rows with `action_key = sha256(ticket, kind, message or event id)` and queues
  `DeliverTicketEmail` on the `alerts` connection in the same transaction. A team reply
  with a status change is one action.
- **`DeliverTicketEmail`** (job): locks the delivery, re-checks access (`canSee` or
  team), verified email and `Preferences::ticketEmail`, then sends
  `TicketActivityMail` (subject `[#42] Title`, a 500-character plain-text excerpt,
  the action, and a link: portal `/organizations/{org}/support/{uuid}` for people,
  admin `/tickets/{uuid}` for the team). Never includes internal notes. Same retries
  and failure handling as `DeliverNotificationEmail`.
- **Organization deletion**: `OrganizationDeletion` deletes participants of the
  organization's tickets; the foreign key nulls `organization_id`. Tickets never
  appear among the blockers; `support_tickets` is classified in a new `KEPT` list
  that `OrganizationDeletionInventoryTest` checks sets null.
- **Ticket deletion**: removes the directory and rows, and records
  `support.ticket_deleted` with `DeviceAudit::record` (number, organization, reporter).

### Member API (organization routes, `auth:sanctum`, membership middleware)

| Route | Notes |
| --- | --- |
| `GET organizations/{o}/tickets` | `status=open|closed|all`, `type`, `search`, `page`; each with `unread` |
| `POST organizations/{o}/tickets` | multipart: `client_id`, `type`, `title`, `body`, `context`, `files[]`; `throttle:support-tickets` (10/h per user) |
| `GET organizations/{o}/tickets/summary` | `{ unread }` for the sidebar badge |
| `GET organizations/{o}/tickets/{t}` | ticket, people and the public timeline |
| `PATCH organizations/{o}/tickets/{t}` | reporter only: `title`, or `status: resolved` to close |
| `POST organizations/{o}/tickets/{t}/messages` | multipart: `client_id`, `body`, `files[]`; `throttle:support-messages` (60/h) |
| `POST organizations/{o}/tickets/{t}/read` | moves the read position |
| `GET organizations/{o}/tickets/{t}/attachments/{a}` | authorized download |
| `GET organizations/{o}/tickets/{t}/people?search=` | members of the organization, 20 at most |
| `PUT/DELETE organizations/{o}/tickets/{t}/participants/{user_id}` | reporter adds or removes; a participant may delete themself |

### Team API (`v1/admin/tickets`, super administrators only, else 403)

| Route | Notes |
| --- | --- |
| `GET admin/tickets` | filters `status[]`, `type`, `priority`, `organization`, `assignee` (`me`, `none`, id), `search`; sort awaiting first, then last activity; `meta.awaiting` |
| `GET admin/tickets/{t}` | full timeline including notes, priority, assignee, context |
| `PATCH admin/tickets/{t}` | `status`, `priority`, `type`, `title`, `assignee_id`, `revision` (409 when stale) |
| `POST admin/tickets/{t}/messages` | multipart: `client_id`, `body`, `internal`, `files[]`, optional `status` and `revision` applied in the same action |
| `POST admin/tickets/{t}/read` | |
| `GET admin/tickets/{t}/attachments/{a}` | |
| `GET admin/tickets/{t}/people?search=`, `PUT/DELETE admin/tickets/{t}/participants/{user_id}` | members of the ticket's organization |
| `GET admin/tickets/summary` | `{ awaiting }` for the sidebar badge |
| `GET admin/tickets/assignees` | super administrators |
| `DELETE admin/tickets/{t}` | |

`TicketResource` and `TicketSummaryResource` serve people, `AdminTicketResource` and
`AdminTicketSummaryResource` the team; `TicketView` builds the timeline per audience,
so priority, assignee, internal notes and internal events reach only the team. Detail
responses carry `sequence`, which the read endpoints accept so activity after the page
loaded stays unread. `/me` gains `capabilities.manage_tickets`.
Rate limiters join `AppServiceProvider`. `config/app.php` gains `admin_url`
(`ADMIN_FRONTEND_URL`, default `http://localhost:5174`) for team email links.

### Kit (`packages/ui`)

- `Thread`: a timeline of message items (author, **Team** or **Internal** badge,
  `RelativeTime`, Markdown body, attachment chips and image thumbnails) and compact
  event rows ("Ana changed status from New to In review"). Generic: the app maps its
  records to items. Story with replies, a note and events.
- `Composer`: Markdown textarea with attach, drop and paste of files, per-file errors,
  a send button and an optional slot for extra controls (the admin's Reply / Internal
  note toggle and "set status"). Keeps the draft until sent. Story.
- `TicketThread`: the ticket composition both apps share, mapping API timeline entries
  to `Thread` items with sentences for each change. Story.
- `useWide` (hook): the 1280px split `InboxPage` uses, for the admin queue.
- `statusOf` gains a `ticket` domain: New (info), In review (info), Needs information
  (warning), Planned (muted), In progress (info), Resolved (good), Declined (muted);
  and a `priority` domain: Low and Normal (muted), High (warning), Urgent (critical).

### Portal (`apps/portal/src/support/`)

- Sidebar footer item **Support** (`LifeBuoyIcon`) with `SidebarMenuBadge` for the
  unread count (polled every 60 s).
- `SupportPage` at `support`: `CollectionPage` with `DataTable` (number, title, type,
  status, last activity, unread dot), open/closed/all filter, type filter, search,
  **New ticket**.
- `NewTicketPage` at `support/new?type=&from=`: type as `ChoiceCard`s, title,
  description pre-filled with the type's template, attachments, and a collapsible
  "Included with your report" showing the context. A sticky action bar with
  `ref={keepToastsAbove}`; the unsaved-changes guard as other forms.
- `TicketPage` at `support/:ticketUuid`: `EntityPage` with `#42` as the code, status
  and type marks, **Close ticket** for the reporter, the title editable inline by the
  reporter; the `Thread` and `Composer` in a `Panel`; a rail with People (tagging
  through `SearchableSelect`, remove and leave), organization, filed time and context.
  Polls every 30 s and marks the ticket read when shown. A Declined ticket replaces the
  composer with **New ticket about this**.
- Help panel: **Report a problem** and **Suggest an improvement** (opening the form with
  the current path) and **Your tickets**. Command palette: "Report a problem", "Support
  tickets".
- Settings → Email: a **Support tickets** switch.

### Admin (`apps/admin/src/pages/`)

- Sidebar item **Tickets** (`InboxIcon`) in the first group with the awaiting count,
  only with `manage_tickets`; routes `tickets` and `tickets/:ticketUuid`.
- `TicketsPage` on `InboxPage`: toolbar with search and `FilterBar` (status, type,
  priority, organization, assignee), the queue on the left (awaiting first, unread in
  bold), the selected ticket on the right; polls every 30 s.
- Ticket detail: header with number, title (inline edit), status mark; `Thread` with
  notes highlighted; `Composer` with Reply / Internal note and an optional "and set
  status to"; a properties panel with status, priority, type and assignee selects
  (each change saves with the revision; 409 reloads with a toast), People, organization,
  reporter and their email, context, and **Delete ticket** behind an `AlertDialog`.

### Contract, config and docs

- `contracts/openapi/supplements/support.yaml` for the multipart bodies, then
  `php artisan contract:export`.
- `deploy/release/compose.yml`, `deploy/release/environment.example` and
  `deploy/compose/compose.app.yml` pass `ADMIN_FRONTEND_URL`
  (`https://admin.${DOMAIN}` on releases).
- `docs/features/support.md` (new); links from `docs/README.md`, `docs/features/access.md`
  (admin) and `docs/features/alerts.md` (email preferences); `apps/admin/README.md`.

## Project Structure

### Documentation (this feature)

```text
specs/015-support-tickets/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
apps/api/database/migrations/2026_10_19_000000_create_support_tickets.php        # new
apps/api/app/Domain/Support/                                                       # new
├── Enums/TicketType.php, TicketStatus.php, TicketPriority.php, TicketEventKind.php
├── Models/Ticket.php, TicketParticipant.php, TicketMessage.php, TicketAttachment.php, TicketEvent.php
├── Services/TicketAccess.php, Tickets.php, TicketAttachments.php, TicketNotifier.php
├── Jobs/DeliverTicketEmail.php
├── Mail/TicketActivityMail.php (+ resources/views/support/ticket-email.blade.php)
├── Http/Controllers/TicketController.php, TicketMessageController.php,
│   TicketParticipantController.php, AdminTicketController.php
├── Services/TicketView.php
├── Http/Resources/TicketResource.php, TicketSummaryResource.php,
│   AdminTicketResource.php, AdminTicketSummaryResource.php
└── routes/api.php
apps/api/routes/api.php
apps/api/app/Providers/AppServiceProvider.php                                       # rate limiters
apps/api/app/Domain/Notifications/Services/Preferences.php (+ controller)           # ticket_email
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/app/Domain/Authentication/Http/Resources/AuthenticatedUserResource.php
apps/api/config/app.php
apps/api/tests/Feature/Domain/Support/*Test.php                                     # new
contracts/openapi/supplements/support.yaml (new), contracts/openapi/openapi.json
packages/api-client/src/support.ts (new), packages/api-client/src/index.ts
packages/ui/src/components/thread.tsx, composer.tsx, ticket-thread.tsx (new), src/hooks/use-wide.ts (new),
  src/lib/status.ts, stories
apps/portal/src/support/ (new), App.tsx, help/HelpPanel.tsx,
  components/PortalCommandPalette.tsx, alerts/EmailPreferences.tsx, e2e/support.spec.ts (new)
apps/admin/src/pages/TicketsPage.tsx, hooks/use-polled.ts (new), App.tsx, layout/AdminLayout.tsx,
  e2e/admin.spec.ts
deploy/release/compose.yml, deploy/release/environment.example, deploy/compose/compose.app.yml
docs/features/support.md (new), docs/README.md, docs/features/access.md,
  docs/features/alerts.md, apps/admin/README.md
```

**Structure Decision**: a new `Support` domain. It depends on `Shared` (users,
organizations), `Notifications` (preferences) and the `DeviceAudit` recorder, and
nothing depends on it except `OrganizationDeletion`.

## Tests

- `FilingTest`: types, limits, Markdown stored verbatim, context, idempotent client
  id, 409 on a reused id with other content, rate limit.
- `VisibilityTest` (Constitution III): another organization's member, an untagged
  member and a removed member get 404 on show, reply, download, people and read, see
  nothing in the list and count nothing in the summary.
- `TeamTest`: non-super administrators (including platform administrators) get 403 on
  every team route; field changes and their events; 409 on a stale revision; internal
  notes and internal events absent from member responses.
- `StatusFlowTest`: automatic moves on reply, reporter close, Declined refuses member
  replies, `awaiting_team` and `closed_at`.
- `ParticipantsTest`: only members of the ticket's organization, limit 10, participant
  cannot tag, leave, reporter cannot be removed, events.
- `AttachmentsTest`: content check (a renamed HTML file is refused), limits, storage
  path, download headers, cleanup on delete.
- `EmailTest`: recipients per action, one email for reply plus status, no email to the
  actor, preference and "turn off all", access re-check at send time, no internal
  note in any body, no duplicate per `(action_key, user_id)`.
- `DeletionTest`: ticket delete removes files and records the audit event; organization
  deletion keeps tickets, removes participants, and is not blocked.
- Playwright: portal filing with a pasted image, tagging, the unread badge; admin queue
  filters, status change with reply, internal note, the 409 reload, and the
  super-administrator gate.

## Delivery

One pull request based on `main` holding these documents and the implementation, as
spec 010 did, so nothing is stacked. Commits follow the layers (documents; storage and
domain; API and contract; kit; portal; admin; docs) so it can be reviewed in order.
Before opening it, rebuild `api`, `alerts-worker`, `portal` and `admin` and run each
user story's independent test from the spec, with Mailpit for the emails.

## Complexity Tracking

No violations.

Not done here, by decision: `spatie/laravel-activitylog`. The platform's audit store
is `device_audit_events`, which administration actions already use. Adopting a second
store for "what changed on any entity" is an architecture decision that needs its own
ADR (and a plan for the existing audit tables and their retention, already a roadmap
item). The ticket timeline is product data the reporter sees, so it stays in this
domain whichever way that ADR goes.
