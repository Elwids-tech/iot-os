# Feature Specification: Activity Log

**Feature Branch**: `feat/024-activity-log`

**Created**: 2026-10-31

**Status**: Draft; the drafting decisions below follow the owner's request of
2026-10-31 and can be revisited with `/speckit-clarify`

**Input**: Owner request, 2026-10-31: "I would like to have an audit-log. You could
probably use Spatie's activity log plugin and I would like a nice timeline for the
actions that have been performed and it should be filtrable by the user or the
organization. So I could see what changes were done from the portal. This is all to do
with User activity."

## Context

The API already keeps an audit trail in `device_audit_events`. About 75 places record
an action code, the organization, the acting user, a resource UUID and some details:
device registration and configuration, adapters, workflows and alerts, applications
and webhooks, sites, geofences, support tickets, assistant settings, administrators
and billing accounts. Only billing account history (spec 023) shows any of it.

The trail has gaps. Organization members, roles and invitations, organization changes
made by platform administrators, dashboards and device profiles record nothing. Edits
mostly record that something changed, not what.

This feature makes that trail the platform's **activity log**, stored with
`spatie/laravel-activitylog` as decided in
[ADR-028](../../docs/adr/ADR-028-activity-log.md), fills the gaps, records what an
edit changed, and shows people's activity to platform administrators as a timeline in
the admin app.

**Terms**:

- An *event* is one recorded action: what was done, by whom, in which organization, to
  what, and when.
- The *actor* is the person who did it. Events with no actor are *system events*.
- The *subject* is the thing acted on, such as a device or a role.
- *Changes* are the before and after values of the fields an edit changed.

## Decisions

These follow the owner's request. `/speckit-clarify` may revisit them.

- **D1. One trail.** The activity log replaces `device_audit_events`; existing events
  are copied into it, in order, with their action codes, so nothing recorded so far is
  lost and existing readers keep their meaning.
- **D2. People only on the timeline.** The admin timeline shows events with an actor.
  System events stay recorded and keep feeding billing history and the retention page.
- **D3. Who can see it.** Platform administrators who can manage organizations, the
  same permission that lists every organization and user. The portal gets no activity
  view in this feature.
- **D4. What changed, safely.** Edits record before and after values of the fields
  people changed. Secrets, tokens, keys, passwords and credentials are never recorded.
  Large definitions (dashboard layouts, workflow graphs, profile drafts) are recorded
  as changed, not diffed.
- **D5. Organization of an event.** An event belongs to the organization whose data it
  changes, including changes platform administrators make to that organization.
  Platform-level changes (billing accounts, platform roles, super administrators)
  belong to none and do not appear under an organization filter.
- **D6. Kept as long as today.** Nothing is pruned. Deleting an organization still
  deletes its events (spec 006).
- **D7. Sign-ins are out of scope.** Sign-ins, failed sign-ins and reads are not
  recorded.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what people changed, newest first (Priority: P1)

A platform administrator opens **Activity** in the admin app. A timeline lists what
people did across the platform, newest first, grouped by day. Each entry names the
person, what they did and to what ("Ana Silva updated device Pump 3"), the
organization, and when ("4 minutes ago", with the exact time on hover). An edit
shows what changed ("Name: Pump 3 → Pump 3 north"). Older entries load with
**Load older activity**.

**Why this priority**: it is the request: see what was changed from the portal and the
admin app.

**Independent Test**: as an organization member, rename a device and invite someone in
the portal; as a platform administrator, open Activity and see both entries at the top
with the person, organization, subject and the name change.

**Acceptance Scenarios**:

1. **Given** a platform administrator who can manage organizations, **When** they open
   Activity, **Then** they see the latest 50 events with an actor, newest first, each
   with the actor's name, a sentence for the action, the subject's name when it has
   one, the organization when it has one, and a relative time.
2. **Given** more than 50 such events, **When** they choose **Load older activity**,
   **Then** the next 50 older events are appended, and the button disappears when
   there are no more.
3. **Given** an event recording an edit, **When** they look at it, **Then** they see
   each changed field with its old and new value.
4. **Given** system events (runtime acknowledgements, alert transitions), **When**
   they open Activity, **Then** none appears.
5. **Given** a platform administrator without the permission to manage organizations,
   **When** they request the activity, **Then** the API refuses it and the admin app
   does not offer the page.

---

### User Story 2 - Filter by person or by organization (Priority: P1)

The administrator wants to know what one customer's staff changed last week. They
pick the organization in a searchable **Organization** selector, then a person in a
searchable **Person** selector. The timeline shows only matching events. The filters
are in the page address, so the link can be shared or reloaded, and **Clear filters**
returns to everything.

**Why this priority**: the owner asked for both filters explicitly.

**Independent Test**: with events from two people in two organizations, filter by one
organization, then by one person, then both, and check the entries each time.

**Acceptance Scenarios**:

1. **Given** events in organizations A and B, **When** the administrator picks A,
   **Then** only A's events are shown.
2. **Given** events by Ana and Ben, **When** the administrator picks Ana, **Then** only
   Ana's events are shown, in every organization and at platform level.
3. **Given** both filters, **When** applied, **Then** only Ana's events in A are shown.
4. **Given** no event matches, **When** the filters are applied, **Then** the page says
   so and offers to clear the filters.
5. **Given** a page address with filters, **When** it is opened, **Then** the selectors
   show the chosen person and organization by name and the timeline is filtered.

---

### User Story 3 - Record what is missing today (Priority: P1)

Changes people make that the platform does not record today are recorded, with what
changed: organization members and their roles, organization roles and their
permissions, invitations (sent, resent, revoked, accepted), organization details,
permission ceilings and billing account moves made by platform administrators,
platform team roles, dashboards (created, edited, duplicated, restored, sharing
changed, deleted), and device profiles (created, edited, draft changes, published,
archived). Existing events for devices, sites and organization settings also record
what changed.

**Why this priority**: without it, the timeline misses the changes administrators ask
about most: who gave whom access, and who changed a dashboard or profile.

**Independent Test**: perform each listed change through the API and check that one
event with the right action, actor, organization, subject and changes is recorded,
and that a member of another organization's activity is not mixed in.

**Acceptance Scenarios**:

1. **Given** an organization admin, **When** they change a member's roles, **Then** an
   event records the member, the roles before and after, the organization and the
   admin.
2. **Given** a dashboard, **When** someone renames it and changes its layout, **Then**
   the event records the name change and that the layout changed.
3. **Given** a device profile draft, **When** someone adds a parameter, **Then** an
   event records the profile and which parameter was added.
4. **Given** a platform administrator, **When** they rename an organization, **Then**
   the event belongs to that organization and records the old and new name.
5. **Given** any recorded edit, **When** a secret, token, key or password is part of
   the request, **Then** its value is not in the event.

### Edge Cases

- The actor was deleted later: the entry shows "Deleted user" and keeps its place.
- The subject was deleted or renamed later: the entry shows its current name when it
  still exists, otherwise the name recorded with the event, otherwise its kind only.
- The organization was deleted: its events are gone with it (D6); platform-level
  events about it (such as its deletion) remain.
- An action code without a sentence (a future or rare one) is shown in readable form
  ("Device adapter cursor reset") rather than hidden.
- Many events in the same second keep a stable order (newest recorded first).
- A filter names a person or organization that does not exist: the API rejects it with
  a validation error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST keep one activity log for audit events, replacing
  `device_audit_events`, and MUST copy every existing event into it with its action,
  organization, actor, subject UUID, details and time.
- **FR-002**: Every event MUST record its action code, its actor (integer `user_id`)
  or none, its organization or none, its subject's UUID and name when it has one, its
  details, and its time.
- **FR-003**: Edits MUST record the old and new value of each changed field, except
  values that are secrets, tokens, keys, passwords or credentials, and except large
  definitions, which are recorded as changed.
- **FR-004**: The platform MUST record the changes listed in User Story 3, in the
  portal and the admin app and through the public API alike.
- **FR-005**: Existing readers (billing account history, retention inspection,
  organization deletion) MUST behave as before.
- **FR-006**: The admin API MUST list events with an actor, newest first, 50 per page
  with an opaque cursor for the next page, filtered by an optional `user_id` and an
  optional organization UUID.
- **FR-007**: Each listed event MUST include its action, a readable sentence, the
  actor's id, name and email, the organization's UUID and name, the subject's kind,
  UUID and name, the changes and the details.
- **FR-008**: Only platform administrators who can manage organizations MAY list
  events.
- **FR-009**: The admin app MUST show the events as a timeline grouped by day with
  relative times, searchable Person and Organization selectors kept in the page
  address, a Load older control, and empty, filtered-empty, loading and error states.
- **FR-010**: Recording an event MUST happen in the same transaction as the change it
  records where the change is transactional, so an event is never kept for a change
  that rolled back.

### Key Entities

- **Activity**: one event. Action code, readable description, actor (user), subject
  (kind, UUID, name, and model when known), organization, changes, details, time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every change listed in User Story 3 produces exactly one event, proven
  by API tests.
- **SC-002**: A platform administrator finds who changed a given device, dashboard or
  role in an organization within a minute, using only the two filters.
- **SC-003**: The first page of the timeline loads in under one second on the local
  stack with 100,000 events.
- **SC-004**: Billing account history, retention inspection and organization deletion
  tests pass unchanged in meaning after the switch.

## Assumptions

- Platform administrators who manage organizations may already see every
  organization and user, so seeing their activity grants nothing new.
- People act through the portal, the admin app, the public API and AI agents with
  their own permissions (constitution V); all of them are "people" here, and the
  actor is the user the request authenticates.
- Organization admins' own activity view in the portal, sign-in auditing, exporting
  the log and an audit retention period are follow-ups.
