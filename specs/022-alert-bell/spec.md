# Feature Specification: Alert Bell

**Feature Branch**: `spec/022-alert-bell`

**Created**: 2026-10-29

**Status**: Draft; decisions confirmed by the owner on 2026-10-29

**Input**: "When an alert is received it would be nice to have a sound and also a bell
icon that actually shows you all the notifications, or alert notifications basically,
that you have received, if you have configured any."

## Context

Today an alert reaches a person only by email. On **Settings → Notifications** a
manager picks, per automation, up to 20 members as recipients and whether they also hear
when the alert clears. When an alert activates (or clears), the platform records one
delivery per recipient and emails it, unless that person turned the email off in
**Settings → Email** ([alerts](../../docs/features/alerts.md#email)).

Inside the portal nothing tells a recipient that something happened. The **Alerts** page
and the sidebar badge show every alert in the organization, but not which ones were
meant for you, and the page has to be open to notice anything.

This feature adds an **in-app inbox** for those same alert notifications: a bell in
every page header with an unread count, a short list of what you received, and a chime
when a new alert arrives while the portal is open. It reuses the recipients people
already configure; it adds no new way to subscribe and changes no email behaviour.

**Terms**: a *notification* is one alert transition (activated or cleared) that a
person received as a recipient. *Unread* means the person has not opened or dismissed
it. The *backlog* is what was already there when the page loaded.

## Decisions

The draft left three questions open, each with a recommended answer. The owner
confirmed all three recommendations on 2026-10-29 ("Use the defaults").

- **Q1. How long are notifications kept?** **90 days**, read or unread, then removed by
  a daily job. Alerts themselves stay on the Alerts page.
- **Q2. Should a cleared alert also chime?** **No**. Only a new activation chimes; a
  cleared notification appears in the bell silently, because recovery needs no action.
- **Q3. Does opening an alert from anywhere (email link, Alerts page) mark its
  notifications read?** **Yes**, so someone who followed the email link does not find
  the same alert unread in the bell.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the alerts I was notified about (Priority: P1)

An operator is a recipient of the "Cold room door open" automation. While they work on
the Devices page the door alert activates. The bell in the page header shows **1**. They
open it and see "Cold room door open · Freezer 2 · Activated · 1 min ago", click it, and
land on that alert's page. The badge disappears.

**Why this priority**: it is the request; the bell is useful without the sound.

**Independent Test**: make yourself a recipient of an automation, trigger its alert in
the local stack, and within 20 seconds the bell on any page shows one unread
notification that opens the alert.

**Acceptance Scenarios**:

1. **Given** a person who is a recipient of an automation in the current organization,
   **When** its alert activates, **Then** the bell shows an unread count within 20
   seconds while the tab is visible, without reloading the page.
2. **Given** the bell is opened, **Then** it lists the person's notifications in this
   organization, newest first: automation name, device name (when known), **Activated**
   or **Cleared**, the time as a relative time, unread ones marked, and whether the
   alert is still active now.
3. **When** they select a notification, **Then** it is marked read and they go to
   `/organizations/{org}/alerts/{alert}`.
4. **When** they choose **Mark all read**, **Then** every notification up to the newest
   one in the list is marked read, including older pages; one that arrived after the
   list was shown stays unread.
5. **Given** more than 20 notifications, **Then** **Show older** loads the next 20 in
   place; the bell also links to the **Alerts** page.
6. **Given** recovery is on for the automation, **When** the alert clears, **Then** a
   **Cleared** notification arrives; with recovery off, none does.
7. **Given** the person turned off all emails in **Settings → Email**, **When** the alert
   activates, **Then** no email is sent but the bell still shows the notification.

---

### User Story 2 - Hear a new alert (Priority: P1)

The operator has the portal open in a tab behind their spreadsheet. A new alert
activates; within about a minute the tab plays a short chime. Reloading the page later
does not replay it.

**Why this priority**: the second half of the request; a bell nobody looks at is easy
to miss.

**Independent Test**: with the portal open and clicked once, trigger an alert; one
chime plays. Reload: nothing plays for the alerts already there. Open three tabs and
trigger another alert: one chime, not three.

**Acceptance Scenarios**:

1. **Given** the page has loaded and the person has clicked or typed in it once,
   **When** a new unread activation arrives, **Then** a short chime plays once.
2. **Given** the page has just loaded, **Then** no chime plays for the backlog, however
   many unread notifications there are.
3. **Given** several notifications arrive between two checks, **Then** one chime plays,
   not one per notification.
4. **Given** several tabs of the portal are open in one browser, **Then** one chime
   plays per new notification across all of them.
5. **Given** the person turned **Sound** off in the bell, **Then** nothing plays in any
   tab of that browser until they turn it on again. Sound is on by default.
6. **Given** the browser blocks audio (no interaction yet, or audio unsupported),
   **Then** nothing plays, no error is shown, and the bell still updates.
7. **Given** the tab is in the background, **Then** the bell keeps checking about once
   a minute, so the chime may come up to a minute late; a browser that suspends
   background tabs plays nothing until the tab is shown again.
8. **Given** a new activation arrives, **Then** screen readers hear a polite
   announcement naming the automation, whether or not sound is on.

---

### User Story 3 - Know how to get notified (Priority: P2)

A new member opens the bell and finds it empty. It tells them alerts appear here when
they are a recipient of an automation, and, if they can manage devices, links to
**Settings → Notifications**.

**Why this priority**: "if you have configured any" means many people start empty.

**Independent Test**: as a member who is not a recipient anywhere, open the bell; the
empty state explains how to be added. As a manager it links to Settings →
Notifications.

**Acceptance Scenarios**:

1. **Given** no notifications in this organization, **Then** the bell shows no count
   and its list explains that alerts appear here for automations that list you as a
   recipient.
2. **Given** the person can manage devices, **Then** the empty state links to
   **Settings → Notifications**; otherwise it says to ask someone who manages
   automations.

---

### User Story 4 - Opening an alert clears it from the bell (Priority: P3)

The operator follows the alert email's link. The alert page opens, and the bell no
longer counts that alert (Q3).

**Why this priority**: avoids reading the same alert twice; the bell works without it.

**Independent Test**: with an unread notification, open the alert from the Alerts page;
the bell's count drops by that alert's notifications.

**Acceptance Scenarios**:

1. **When** a person opens an alert's page, **Then** their unread notifications for
   that alert in this organization are marked read.

### Edge Cases

- **Only recipients**: the bell lists only alerts the person was a recipient of when the
  alert changed. Adding someone later does not show them older alerts; removing them
  keeps what they already received.
- **Lost access**: a person who leaves the organization can no longer open it; one who
  may no longer view devices there sees no bell and hears no chime, even for
  notifications received before. Their notifications return if access does, until they
  expire (Q1).
- **Super administrators** browsing an organization they are not a member of see an
  empty bell there, as they get no alert email there.
- **Several organizations**: the bell shows the current organization only. Switching
  organization switches the bell; there is no cross-organization count.
- **Replays and late events**: a replayed runtime event never creates a second
  notification. A late activation of an alert that already cleared creates none, as it
  sends no email today.
- **Stopped automations**: no notification is created when the automation's settings
  are off or its execution was stopped, the same rules as email.
- **Renamed or deleted things**: a notification keeps the automation and device names
  from when it arrived; the alert page shows the current ones. An unknown device is left
  out, never invented.
- **Alert storms**: 50 alerts at once raise the count by 50 and chime once.
- **Two badges**: the sidebar's **Alerts** badge counts the organization's unacknowledged
  alerts; the bell counts the person's unread notifications. They answer different
  questions and are labelled differently ("Alerts", "Notifications").
- **Phone**: the bell is an icon with its count; its list fits a 375 px screen without
  sideways scrolling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Whenever the platform records an alert delivery for a recipient (an
  activation, or a clear when recovery is on), it MUST also record one in-app
  notification for that recipient, in the same transaction, at most once per alert,
  transition and person.
- **FR-002**: In-app notifications MUST NOT depend on the person's email preferences or
  on whether the email was sent.
- **FR-003**: A notification MUST record its organization, alert, episode, transition,
  time of the transition, automation (name and id) and device (name and id when known).
- **FR-004**: The API MUST let a signed-in person list their own notifications in one
  organization, newest first, 20 per page, with the number unread and each alert's
  current condition (active or cleared).
- **FR-005**: The API MUST give a lightweight summary for polling: the unread count and
  the newest unread activation, so the portal can tell a new activation from the backlog.
- **FR-006**: The API MUST let a person mark read: chosen notifications, all up to the
  newest one they were shown, or all for one alert (Q3).
- **FR-007**: Every request MUST check that the person is currently a member of the
  organization and may view devices there. Someone who left cannot reach the
  organization at all; a member without device view, or a super administrator who is not
  a member, sees no notifications and a zero count, and marking read changes nothing.
  Nobody can see or change another person's notifications.
- **FR-008**: The portal MUST show a bell in every page header of an organization, beside
  Assistant and Help, for people who may view devices, with the unread count, a list
  (US1), **Mark all read**, a link to Alerts, a sound switch and the empty state (US3).
- **FR-009**: The portal MUST check the summary every 15 seconds while the tab is
  visible and every 60 seconds while it is hidden, from one place per tab, whichever page
  is open.
- **FR-010**: The portal MUST play a short synthesized chime for a new unread activation
  (Q2) after the first check of the page, never for the backlog, at most once per check,
  once across the browser's open tabs, and only when sound is on in that browser.
- **FR-011**: The sound switch MUST be remembered per browser, default on, and the bell
  MUST work when the browser's storage is unavailable.
- **FR-012**: Notifications MUST be removed after 90 days (Q1) and when their
  organization is deleted.
- **FR-013**: The OpenAPI contract and `packages/api-client` MUST describe the new
  endpoints; `docs/features/alerts.md` and the in-app help MUST describe the bell and the
  sound.

### Key Entities

- **Notification**: one per recipient and alert transition. Holds the person, the
  organization, alert, episode, transition and its time, automation and device names and
  ids, when it arrived and when it was read. Kept 90 days (Q1).
- **Sound setting**: per browser, on or off. Not stored on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a recipient with the portal open sees a new alert in
  the bell within 20 seconds (visible tab) and about 75 seconds (background tab) of the
  alert being recorded, without reloading.
- **SC-002**: With three tabs open, one new activation plays exactly one chime, and a
  page load plays none (portal Playwright test with a stubbed audio API).
- **SC-003**: API tests on PostgreSQL prove that a person never sees, counts or marks
  another person's or another organization's notifications, and that a removed member or
  one without device view sees none.
- **SC-004**: Each open tab costs at most one summary request every 15 seconds while
  visible and every 60 seconds while hidden.
- **SC-005**: The bell passes the axe check and works at 375 px wide.

## Assumptions

- Recipients stay as they are configured today; being a recipient is the only way to
  get notifications. There is no separate in-app opt-in or opt-out besides the sound.
- Polling is fast enough for the pilot and a single host; live push is a later choice.
- Notifications start when the feature ships; past alerts are not imported.
- Acknowledging, assigning and commenting stay on the alert page.

## Out of Scope

- Browser or operating-system notifications, Web Push, service workers and mobile apps.
- Live delivery over websockets (Laravel Reverb); polling is used instead.
- Other kinds of in-app notification (support ticket replies, deployments, invitations).
- A count across organizations, a full-page notification history, and acknowledging
  from the bell.
- Per-person in-app preferences: levels, quiet hours, custom sounds or volume.
- Changes to email, **Settings → Email**, recipients or the admin app.

## Related work

- **Spec 011 (notification channels, draft)**: in-app is a personal channel that is
  always on for every recipient, needs no contact point, costs nothing and has no
  delivery row of its own. When 011 makes deliveries per channel, there is still one
  in-app notification per alert, transition and person, and 011's severity can be added
  to the notification without breaking this API.
- **Spec 018 (device offline alerts, draft)**: offline alerts reach a person's bell only
  where a route or their own subscription lists them, as for any channel (018 FR-018).
  018's delivery path records the in-app notification the same way; held-back flapping
  episodes create none, so the bell matches what other channels send.
- **Event log**: **Alerts → Event log** stays the organization-wide history; the bell is
  each person's own.
