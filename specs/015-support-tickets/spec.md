# Feature Specification: Support Tickets

**Feature Branch**: `spec/015-support-tickets`

**Created**: 2026-10-18

**Status**: Draft; visibility, attachments and notifications confirmed by the owner on
2026-10-18

**Input**: "Plan and build a ticketing system for users so that they can report bugs,
request features or improvements. Super admin should be able to look into those and
set a status and respond to tickets." Asked who else may see a ticket: "a user should be
able to tag other users who can see it and reply to it." Attachments (images and PDFs)
and email plus in-app notifications were accepted as proposed.

## Context

People using the portal have no way to tell the platform team about a bug or an idea
from inside the product. Reports arrive by chat and email, without the page, the
organization or a screenshot, and nobody can see later what was decided.

The platform already has the pieces this needs: organization membership and super
administrators ([access](../../docs/features/access.md)), the per-person email grid and
the `alerts` mail worker ([alerts](../../docs/features/alerts.md#email)), private file
storage with content checks (assistant sources), and the kit's Markdown, message and
attachment components.

This feature adds **support tickets**: a member files a bug report, a feature request
or an improvement from the portal, can tag colleagues from the same organization, and
talks to the platform team in a thread with screenshots. Super administrators work the
queue in the admin app: they set status, priority and assignee, reply, and keep
internal notes. Every change is kept on the ticket's timeline.

It changes no existing permission, role or API.

**Terms**: *ticket* is one report with its thread. *Reporter* is the member who filed
it. *Participant* is a member the reporter or the team tagged; the reporter and
participants are the ticket's *people*. *Team* means super administrators. A *reply* is
a message every person on the ticket sees; an *internal note* is a message only the team
sees. The *timeline* is the ticket's ordered history of messages and changes. A ticket
is *open* in the statuses New, In review, Needs information, Planned and In progress,
and *closed* when Resolved or Declined.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Report a bug with a screenshot (Priority: P1)

A member hits a problem on the Devices page. They open **Help → Report a problem**,
choose **Bug**, write a title and what happened, paste a screenshot and send it. They
see the ticket as **#42 · New** in **Support**, with the page they were on and their
browser recorded.

**Why this priority**: it is the request; without filing there is nothing to triage.

**Independent Test**: in the local stack, file a bug with a pasted PNG from the
Devices page; the ticket shows in the reporter's **Support** list with the screenshot
inline and the page path in its details.

**Acceptance Scenarios**:

1. **Given** a member of an organization, **When** they open the new ticket form from
   Help, the command palette or **Support → New ticket**, **Then** they choose a type
   (Bug, Feature request, Improvement), enter a title (3–150 characters) and a
   description (Markdown, up to 10,000 characters), and may attach up to five images
   or PDFs of up to 10 MB each, by picking, dropping or pasting.
2. **When** they send, **Then** the ticket gets the next ticket number, status New, the
   organization it was filed in, and the context the form showed them: the page path,
   the browser, the screen size and the time zone.
3. **Given** a network retry sends the same form twice, **Then** one ticket exists.
4. **Given** a file that is not a PNG, JPEG, WebP or PDF by content, or is over 10 MB,
   **Then** the form shows which file was refused and why, and keeps everything else.
5. **Given** the description field before sending, **Then** the type's template prompts
   for the right detail (Bug: steps, expected, actual; Feature request and Improvement:
   the problem and the outcome wanted).

---

### User Story 2 - Triage and answer in admin (Priority: P1)

A super administrator opens **Tickets** in the admin app. The list shows open tickets
with those waiting for the team first. They open #42, set it to **In review**, priority
**High**, assign it to themselves, add an internal note with their findings, and reply
to the reporter asking for the device's serial. They set **Needs information**.

**Why this priority**: it is the other half of the request.

**Independent Test**: as a super administrator, change #42's status, priority and
assignee, add an internal note and a reply; the reporter's view shows the reply and the
status changes but neither the note, the priority nor the assignee.

**Acceptance Scenarios**:

1. **Given** the Tickets list, **Then** it shows number, title, type, status, priority,
   organization, reporter, assignee and last activity, filters by status (open by
   default), type, priority, organization and assignee, searches titles and numbers,
   and marks tickets whose last message is not from the team as **Awaiting reply**.
2. **Given** a ticket, **Then** the page shows the timeline, the reporter and
   participants, the organization and the recorded context, and controls for status,
   priority (Low, Normal, High, Urgent; Normal by default), type and assignee (any
   super administrator or nobody).
3. **When** they change a field, **Then** the timeline records who changed what from
   what to what, and when.
4. **When** they write, **Then** they choose **Reply** or **Internal note**; notes are
   marked as internal and never reach the reporter or participants, by page, API or
   email.
5. **Given** two super administrators change the same ticket's fields at once,
   **Then** the second change is refused with 409 and the page reloads the ticket;
   messages never conflict.
6. **Given** a platform administrator who is not a super administrator, or any other
   user, **Then** admin shows no Tickets page and every team endpoint answers 403.

---

### User Story 3 - Follow the conversation as the reporter (Priority: P1)

The reporter gets an email that the team replied, opens **Support**, sees #42 marked
unread, reads the reply, attaches the serial and replies. The ticket goes back to **In
review** by itself.

**Why this priority**: a ticket nobody can answer is a dead end.

**Independent Test**: after a team reply, the reporter's Support item shows an unread
badge and the email arrives in Mailpit; replying on a Needs information ticket moves it
to In review on the timeline.

**Acceptance Scenarios**:

1. **Given** the Support page, **Then** it lists the tickets the person can see in the
   current organization (filed by them or tagged), open first, with type, status,
   last activity and an unread mark; the sidebar's **Support** item shows the unread
   count.
2. **Given** a ticket, **Then** the person sees the replies, attachments and public
   changes (status, type, title, people), with team members' names marked **Team**.
3. **When** the reporter or a participant replies to a Needs information ticket,
   **Then** its status becomes In review and the timeline says it changed because of
   their reply.
4. **When** the reporter or a participant replies to a Resolved ticket, **Then** it
   reopens as In review. A Declined ticket accepts no further replies from them; the
   page offers a new ticket that links to it.
5. **When** the reporter closes their own open ticket, **Then** it becomes Resolved
   with a timeline entry naming them.
6. **When** the reporter edits the title, **Then** the timeline records it.

---

### User Story 4 - Tag colleagues (Priority: P2)

The reporter wants their colleague, who saw the same problem, to follow the ticket.
They add the colleague under **People**. The colleague is emailed, sees the ticket in
their Support list and adds a second screenshot.

**Why this priority**: the owner's answer to who else may see a ticket.

**Independent Test**: tag a second member; they can open and reply to the ticket. A
member of another organization can be neither found nor tagged, and an untagged member
of the same organization gets 404.

**Acceptance Scenarios**:

1. **When** the reporter or the team searches **People**, **Then** only current members
   of the ticket's organization are offered (name and email, at most 20 matches).
2. **When** a person is tagged, **Then** they can read and reply to the ticket, receive
   its emails, and appear on the timeline as added by whoever tagged them.
3. **Given** a ticket, **Then** it has at most 10 participants; participants cannot tag
   others; a participant may leave; the reporter and the team may remove participants;
   the reporter cannot be removed.
4. **Given** a reporter or participant who is no longer a member of the ticket's
   organization, **Then** the ticket answers them 404 and sends them no email, while
   their earlier messages stay on the timeline.

---

### User Story 5 - Hear about changes by email (Priority: P2)

People on a ticket and the team learn about activity without watching the pages.

**Why this priority**: accepted by the owner; without it replies go unread for days.

**Independent Test**: with Mailpit, file a ticket, reply as the team, change the status
and reply as the reporter; each expected email arrives once, and turning off **Support
tickets** in Settings → Email stops the person's ticket emails.

**Acceptance Scenarios**:

1. **When** a ticket is filed, **Then** every super administrator who has ticket email
   on receives one email; when a ticket has an assignee, later reporter and participant
   replies go only to the assignee, otherwise to every such super administrator.
2. **When** the team replies or changes the status, **Then** the reporter and
   participants receive one email for that action; a reply sent together with a status
   change is one email.
3. **When** a reporter or participant replies, **Then** the other people on the ticket
   receive one email; nobody is emailed about their own action.
4. **Given** an email, **Then** its subject carries the ticket number and title, it
   includes the first 500 characters of the reply as plain text and a link to the
   ticket, and it never contains internal notes, attachments or priority.
5. **Given** a person who turns off **Support tickets** or **Turn off all emails** in
   Settings → Email, or loses access before the email is sent, **Then** the email is
   not sent.

---

### User Story 6 - Remove spam (Priority: P3)

A super administrator deletes a ticket that is spam or was filed by mistake, after
confirming.

**Why this priority**: rare, but abuse otherwise stays forever.

**Independent Test**: delete a ticket with attachments; it disappears for everyone, its
files are removed, and its number is not reused.

**Acceptance Scenarios**:

1. **When** they confirm **Delete ticket**, **Then** the ticket, its messages, timeline
   and files are removed permanently, and one platform audit event records the number,
   organization and reporter, without content.

### Edge Cases

- A member with no permissions beyond membership can file and follow tickets; filing
  needs no permission, and an organization's permission ceiling does not hide it.
- A super administrator who is also a member can file a ticket from the portal; they
  are its reporter and also team.
- Tickets of another organization answer 404 to non-team users, including in the people
  search, attachments and the unread count.
- An organization is deleted: its tickets stay for the team, show the organization as
  deleted, and lose their participants. Its former members lose access with the
  organization, as they do everywhere else. Tickets never block deletion.
- Attachments are served only to people who can see the ticket, with their stored type,
  `nosniff`, and inline display only for images; SVG and HTML are never accepted.
- Markdown renders without raw HTML; links open in a new tab with `noopener`.
- Limits: 10 new tickets per hour and 60 messages per hour per person, then 429 with
  a retry time; 50 attachments per ticket.
- A message with no text but an attachment is allowed; a message with neither is not.
- A team member removed as super administrator stops seeing admin Tickets on their next
  request; their earlier messages stay marked **Team**.
- The context is recorded as the reporter's form sent it and is shown to the team as
  reported, not verified.
- With the assistant switched off (the default) nothing changes; tickets do not use AI.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any member of an organization MUST be able to file a ticket in it, with a
  type, a title, a Markdown description, up to five attachments and the recorded
  context. Filing MUST be idempotent on a client-supplied id.
- **FR-002**: Tickets MUST have a platform-wide sequential number shown as `#N`, never
  reused; public identifiers in URLs and the API are UUIDs, and people are referenced by
  integer `user_id` (ADR-013).
- **FR-003**: A non-team user MUST see a ticket only while they are its reporter or a
  participant and a current member of its organization. Everyone else gets 404.
- **FR-004**: Super administrators MUST see every ticket and be the only users who can
  change status (except the reporter closing their own ticket and the automatic moves
  in FR-005), priority, assignee and type, write internal notes, and delete tickets.
- **FR-005**: Statuses MUST be New, In review, Needs information, Planned, In progress,
  Resolved and Declined, with the automatic moves in US3: a reporter or participant
  reply moves Needs information and Resolved to In review; the reporter may close
  their own ticket as Resolved; Declined accepts no non-team replies.
- **FR-006**: The timeline MUST record, with actor and time: creation, every reply and
  note, every change of status, priority, type, title and assignee with old and new
  values, every participant added, removed or leaving, and reopening. Priority,
  assignee and internal notes MUST be visible to the team only.
- **FR-007**: Field changes by the team MUST be guarded by the ticket's revision (409 on
  conflict).
- **FR-008**: Attachments MUST be PNG, JPEG, WebP or PDF by content, at most 10 MB
  each, five per message and 50 per ticket, stored privately and served only through
  an authorized download.
- **FR-009**: The reporter and the team MUST be able to tag current members of the
  ticket's organization, at most 10 per ticket, found through a search limited to that
  organization.
- **FR-010**: Each person MUST have a per-ticket read position; the portal and admin
  MUST show unread tickets and counts (portal: tickets with activity by someone else
  since the person last opened them; admin: open tickets awaiting the team).
- **FR-011**: Emails MUST follow US5, go through the existing mail worker, be checked
  again for access and preferences before sending, and never be sent twice for the same
  action and recipient. Settings → Email MUST gain a **Support tickets** switch (on by
  default) that **Turn off all emails** also covers.
- **FR-012**: The portal MUST offer a **Support** page in each organization with the
  person's tickets, a ticket page, a new ticket form, entry points from Help and the
  command palette, and an unread count on the sidebar item.
- **FR-013**: The admin app MUST offer **Tickets** (list and ticket page) to super
  administrators only, and `/me` MUST expose a `manage_tickets` capability.
- **FR-014**: Deleting a ticket MUST remove its messages, timeline and files and record
  one platform audit event without content; deleting an organization MUST keep its
  tickets and remove their participants.
- **FR-015**: The OpenAPI contract and `packages/api-client` MUST describe the new
  endpoints, and `docs/features` MUST describe the feature.

### Key Entities

- **Ticket**: number, UUID, organization (nullable after deletion), reporter, type,
  title, status, priority, assignee, recorded context, revision, last activity time,
  time of the last team and non-team message, closed time.
- **Ticket participant**: ticket, user, who added them, when.
- **Ticket message**: ticket, author, body, visibility (reply or internal note),
  client id, time.
- **Ticket attachment**: message, original name, type, size, private storage path.
- **Ticket event**: ticket, actor, kind (created, status, priority, type, title,
  assignee, participant added, removed or left, reopened, closed), old and new values,
  visibility, time. Messages and events together form the timeline.
- **Ticket read position**: ticket, user, last read time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a member files a bug with a pasted screenshot in under
  a minute, and a super administrator sees it in admin Tickets without refreshing for
  longer than the list's polling interval (30 seconds).
- **SC-002**: Every email in US5 arrives in Mailpit within a minute of the action, once,
  and none contains an internal note.
- **SC-003**: The API tests prove, on PostgreSQL, that a member of another organization,
  an untagged member and a removed member cannot read, find, reply to, download from or
  count any ticket they should not, and that a non-super administrator cannot use any
  team endpoint.
- **SC-004**: The portal and admin Playwright tests cover filing with an attachment,
  tagging, the team's status change and reply, and the unread badge.

## Assumptions

- "Super admin" means super administrators only. Platform administrators who are not
  super administrators get no access; giving support staff access later is a new
  permission and a new spec.
- Filing needs only membership. A tenant permission to switch tickets off per
  organization is not added until someone asks.
- The team works in the admin app only; there is no reply-by-email, no SLA timers, no
  canned replies, no voting and no public roadmap in this version.
- Messages cannot be edited or deleted once sent; only whole tickets can be deleted.
- Tickets and their files are kept until a super administrator deletes them; they are
  people's records, not a journal, so no retention job prunes them.
- Any member can find colleagues by name or email in the people search, as dashboard
  sharing already shows them to dashboard creators.
- The ticket timeline is the ticket's audit trail. A general history of changes for
  every entity (for example with `spatie/laravel-activitylog`, which is not installed)
  is a separate decision: the platform's audit store today is `device_audit_events`,
  so adopting another needs its own ADR and spec.
