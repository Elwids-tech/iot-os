# Support tickets

Members report bugs, request features and suggest improvements from the portal; super
administrators answer them in the admin app ([spec 015](../../specs/015-support-tickets/spec.md)).

Code: Laravel [`Domain/Support`](../../apps/api/app/Domain/Support) (changes:
[`Tickets`](../../apps/api/app/Domain/Support/Services/Tickets.php), access:
[`TicketAccess`](../../apps/api/app/Domain/Support/Services/TicketAccess.php), emails:
[`TicketNotifier`](../../apps/api/app/Domain/Support/Services/TicketNotifier.php) and
[`DeliverTicketEmail`](../../apps/api/app/Domain/Support/Jobs/DeliverTicketEmail.php));
portal [`src/support`](../../apps/portal/src/support); admin
[`TicketsPage`](../../apps/admin/src/pages/TicketsPage.tsx); kit
[`ticket-thread`](../../packages/ui/src/components/ticket-thread.tsx),
[`thread`](../../packages/ui/src/components/thread.tsx) and
[`composer`](../../packages/ui/src/components/composer.tsx).

## Filing

**Support** in the sidebar footer lists the tickets you filed or were tagged on in the
current organization, open first, with an unread mark and an unread count on the
sidebar item. **New ticket** (also **Report a problem** and **Suggest an improvement**
under Help and in ⌘K) asks for a type (Bug, Feature request, Improvement), a title
(3–150 characters) and a Markdown description that starts from the type's template.
Images and PDFs can be attached, dropped or pasted: PNG, JPEG, WebP or PDF by content,
10 MB each, five per message and 50 per ticket.

The form records the page you came from, the browser, the screen size and the time
zone; **What else is included with your report?** shows them. The team sees them as
reported, not verified.

Any member can file; no permission is needed and the organization's ceiling does not
hide it. Filing is limited to 10 tickets an hour per person and replies to 60 an hour.
Each form submission carries a client id, so a retried request files one ticket.

## Who sees a ticket

- The reporter, and the colleagues they tag, while they are members of the ticket's
  organization. Everyone else gets 404, organization administrators included.
- Super administrators see every ticket, in the admin app only.
- Platform administrators who are not super administrators see none.

The reporter tags up to 10 members of the ticket's organization under **People**;
tagged people read, reply and get the emails, cannot tag others, and can leave. When
an organization is deleted its tickets stay with the team and lose their participants.

## Statuses

New, In review, Needs information, Planned, In progress, Resolved and Declined (the
last two are closed). The team sets any status; besides that:

- A reply from the reporter or a participant moves Needs information and Resolved
  back to In review (the timeline says the reply did it).
- The reporter can **Close as resolved** an open ticket and rename it.
- A Declined ticket takes no more replies from people; the page offers a new ticket.

## Working the queue

Admin **Tickets** (super administrators, `manage_tickets` in `/me`) is a queue: open
tickets by default, those awaiting a reply first, filtered by state, type, priority,
organization, assignee and "Awaiting reply", searched by title or `#number`; the
sidebar shows how many await a reply. A ticket shows the conversation and its
history, the reporter's context, and selects for status, priority (Low, Normal, High,
Urgent), type and assignee. Each field change carries the ticket's revision; a stale
one is refused with 409 and the page reloads the ticket.

The composer sends a **Reply** (everyone on the ticket sees it) or an **Internal
note** (team only, never in a person's page, API response or email), optionally with
"then set the status" in the same action. **Delete ticket** removes it with its files
permanently and records `support.ticket_deleted` (number and reporter, no content);
numbers are never reused.

## History

The timeline is the ticket's audit trail: every message, and every change of status,
priority, type, title, assignee and people, with who made it and the old and new
values. Priority and assignee changes are internal. Unread marks use per-ticket
activity counters rather than timestamps, so two actions in the same second still
count, and opening a ticket marks it read only up to what the page showed.

## Email

Delivered by the `alerts-worker` like alert emails, one per action and recipient
(`support_ticket_email_deliveries`), with access, a verified address and preferences
checked again when sent:

| Action | Recipients |
| --- | --- |
| New ticket | Every super administrator |
| Reply from the reporter or a participant | The assignee, or every super administrator when nobody is assigned; the other people on the ticket |
| Team reply, status change, or both in one action | The reporter and participants |
| Someone tagged | The tagged person |

Nobody is emailed about their own action. Emails are plain text with the ticket number
and title in the subject, up to 500 characters of the reply and a link: the portal
for people, `ADMIN_FRONTEND_URL` for the team. **Settings → Email → Support ticket
emails** switches them off; **Turn off all emails** does too.

## API

Members, under `/api/v1/organizations/{organization}`: `GET/POST tickets`,
`GET tickets/summary` (`unread`), `GET/PATCH tickets/{ticket}` (reporter: `title`, or
`status: resolved`), `POST tickets/{ticket}/messages` (multipart `client_id`, `body`,
`files[]`), `POST tickets/{ticket}/read` (`sequence`), `GET
tickets/{ticket}/attachments/{attachment}`, `GET tickets/{ticket}/people?search=`,
`PUT/DELETE tickets/{ticket}/participants/{user_id}`.

Team, under `/api/v1/admin/tickets`: list (`state`, `status[]`, `type`, `priority`,
`organization`, `assignee` = `me`/`none`/id, `awaiting`, `search`; `meta.awaiting`),
`summary`, `assignees`, `GET/PATCH/DELETE {ticket}` (PATCH needs `revision`),
`POST {ticket}/messages` (`internal`, optional `status` with `revision`),
`POST {ticket}/read`, attachments, people and participants as above.

## Not included

Reply by email, SLA timers, canned replies, voting, a public roadmap, editing or
deleting single messages, and a platform-wide history of changes for every entity
(that needs its own ADR; the audit store today is `device_audit_events`).
