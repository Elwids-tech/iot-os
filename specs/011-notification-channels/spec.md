# Feature Specification: Notification Channels (Teams, Slack and SMS)

**Feature Branch**: `spec/011-notification-channels`

**Created**: 2026-10-15

**Status**: Draft

**Input**: "We need to add notification channels - Microsoft Teams, Slack, whatsapp, SMS
... So that users can integrate their preferred channels for alerts rather than using
just emails." Scope agreed for this spec: "Wave 1: Microsoft Teams, Slack and SMS, plus
listing DAG workflows in Settings → Notifications. Design the channel model so WhatsApp
and PagerDuty can be added later." SMS goes through Twilio only.

## Context

Workflow alerts reach people only by email. On **Settings → Notifications**, a member
who can manage devices picks, per workflow, up to 20 verified members and whether to
send a recovery email when the alert clears. Each person's **Email preferences** grid
(source by level, plus **Turn off all emails**) can veto it. Delivery is built around
email: `DeliverAlertEmail` sends workflow alerts (one delivery per alert, recipient and
transition, with attempt history and a manager retry), and `DeliverNotificationEmail`
sends service and watchdog alerts to the operator only. Users have no phone number.

Two gaps make email-only worse than it looks:

- **Settings → Notifications lists only geofence (v1) workflows.** It calls the workflow
  list, which returns `automation-workflow.v1` workflows only. DAG workflows raise alerts
  through the same projection (`DagActions` → `AlertProjector`) and their alerts would be
  delivered, but nobody can choose their recipients.
- **Every workflow alert is recorded as `warning`.** The **Critical** and **Info** columns
  of the preferences grid do nothing for workflows, so nobody can say "text me only for
  critical alerts".

Operations teams already work in Microsoft Teams and Slack channels, and SMS reaches
people who are away from a screen or without mobile data. This feature adds those three
channels next to email, lets DAG workflows choose recipients, and gives each workflow a
severity. The channel model is shaped so WhatsApp and PagerDuty can follow without
reworking it.

**Terms**:

- *Channel*: a way of delivering an alert: email, SMS, Microsoft Teams or Slack (later
  WhatsApp and PagerDuty).
- *Personal channel*: delivers to one person at a contact point they own and have
  verified: email (their account email) and SMS (their mobile number).
- *Destination*: an organization-owned place that a team reads, such as a Teams channel
  or a Slack channel, identified by a webhook URL. Anyone holding the URL can post to the
  channel, so the URL is a secret.
- *Subscription*: a workflow's notification settings: enabled, severity, notify on clear,
  recipients and their personal channels, and destinations.
- *Delivery*: one message for one alert transition (activated or cleared) to one
  recipient on one personal channel, or to one destination.
- *Manager*: a member with device management permission (`Device.manage`). Managers
  already configure workflow notifications and integration applications.
- *SMS allowance*: the number of SMS an organization's plan includes per calendar month
  (UTC). Each part of a message counts as one SMS: 160 characters, or 70 when the text
  has characters outside the basic SMS alphabet.

## Clarifications

### Session 2026-11-06

- Q: How is an organization's SMS use limited? → A: By its plan. Pricing tiers include a
  number of alerts and of SMS, so each organization gets a monthly SMS allowance and
  every SMS counts against it. This replaces a cost-based budget considered earlier the
  same day: with SMS limited to US and Canadian numbers, every SMS costs about the same.
- Q: Which sender sends SMS? → A: One Twilio toll-free number for the deployment. SMS is
  limited to US and Canadian mobile numbers for now. Toll-free numbers can send to other
  countries one way, but delivery there is not dependable without a local sender, and
  some countries cost 25 times as much.
- Q: Who sends verification codes? → A: The platform, through the same toll-free number
  and Twilio's Messages API, not Twilio Verify, which charges per verification on top.
- Q: Existing members have no mobile number. How are they asked for one? → A: A banner
  above the page after sign-in, not a pop-up that blocks it, shown only when SMS could
  reach them. **Not now** hides it for 14 days and **Don't ask me again** until they are
  added to another SMS workflow or a manager asks. Managers can ask a workflow's SMS
  recipients with no number to add one. Only the owner can enter and verify a number.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose recipients for DAG workflows (Priority: P1)

A manager opens **Settings → Notifications** and sees every workflow, geofence and DAG,
with its kind and notification state. They open a DAG workflow and choose email
recipients exactly as they do for a geofence workflow.

**Why this priority**: most new automations are DAGs, and no new channel helps them until
they can be subscribed. It is also the smallest slice.

**Independent Test**: in the local stack, create a DAG workflow with an alert action,
subscribe a member by email and trigger it. The email arrives and the alert's deliveries
list shows it.

**Acceptance Scenarios**:

1. **Given** an organization with geofence and DAG workflows, **When** a manager opens
   **Settings → Notifications**, **Then** both kinds are listed together, each labelled
   with its kind and notification state, and search and paging cover both.
2. **Given** a DAG workflow with recipients, **When** its alert activates, **Then** each
   recipient gets one activation email, and one recovery email when it clears if notify
   on clear is on.
3. **Given** a member who can view devices but not manage them, **Then** the page stays
   hidden and the API refuses the settings with 403, as today.

---

### User Story 2 - Post alerts to a Teams or Slack channel (Priority: P1)

A manager adds a destination under **Settings → Notifications → Destinations**: a name,
the kind (Microsoft Teams or Slack) and the channel's webhook URL. They send a test
message, then pick the destination in a workflow's notification settings. Alerts appear
in the channel with the severity, workflow, device, state, time and a link to the alert.

**Why this priority**: it is the request, it costs nothing per message, and it reaches the
whole team at once.

**Independent Test**: in the local stack, add a Slack destination and a Teams destination,
send a test to each, subscribe a workflow to both and trigger it. Each channel receives
one message per transition.

**Acceptance Scenarios**:

1. **Given** a manager adds a Teams destination with a Workflows webhook URL, **When**
   they choose **Send test**, **Then** a test message is posted and the page shows whether
   Teams accepted it or the error it returned.
2. **Given** a URL that is not a Teams Workflows or Slack incoming-webhook URL, **When**
   the manager saves it, **Then** it is rejected with a message describing the expected
   URL. A retired Office 365 connector URL gets a message that explains how to create a
   Workflows webhook instead.
3. **Given** a saved destination, **Then** its URL is never shown again: the page shows
   the kind, the host and the last four characters. Changing it means entering a new URL.
4. **Given** a workflow subscribed to the destination, **When** its alert activates,
   **Then** exactly one message is posted per transition (activation, and the clear when
   notify on clear is on), however many recipients the workflow has.
5. **Given** a manager disables or deletes a destination that workflows use, **Then** the
   confirmation lists those workflows; afterwards pending deliveries to it are cancelled
   with a reason, and a deleted destination is removed from every subscription.

---

### User Story 3 - Receive critical alerts by SMS (Priority: P2)

A member adds their mobile number in their personal notification preferences, confirms
it with a code and chooses which levels they want by SMS. A manager turns on SMS for a
workflow. When its alert activates, recipients with a verified number who allow that
level get a short text with a link to the alert.

**Why this priority**: it reaches people away from a screen, but it costs money per
message and needs a Twilio account configured on the deployment, so it follows the
free channels.

**Independent Test**: with Twilio test credentials in the local stack, verify a number,
subscribe a critical workflow with SMS on and trigger it. The delivery is recorded as
accepted by Twilio. On the pilot, a real phone receives the text.

**Acceptance Scenarios**:

1. **Given** a member enters a US or Canadian mobile number, **When** they ask for a code,
   **Then** a six-digit code is texted to it from the deployment's toll-free number;
   entering it within 10 minutes verifies the number. A number from any other country is
   refused with "Text alerts can go to US and Canadian numbers only".
2. **Given** a verified number, **Then** SMS is on for **Critical** workflow alerts only,
   and the member can choose **Warning**, **Info** and **Cleared** as well, or turn SMS
   off.
3. **Given** a workflow with SMS on whose severity is critical, **When** its alert
   activates, **Then** each recipient with a verified number who allows critical SMS gets
   one text; other recipients get none, and the workflow's settings page shows which
   recipients have no verified number.
4. **Given** what is left of the organization's SMS allowance this month is less than the
   parts an SMS needs, **When** that SMS is due, **Then** it is cancelled with "SMS
   allowance used up for this month"; email and destinations are unaffected, and managers
   see the allowance, how much is used and what is left on the workflow settings page.
5. **Given** the deployment has no Twilio account configured, **Then** phone numbers and
   SMS options are not shown, and the API refuses SMS settings with 422.
6. **Given** an alert SMS that needs two parts, **When** Twilio accepts it, **Then** it
   counts as two SMS against the allowance.

---

### User Story 4 - Set a workflow's severity (Priority: P2)

A manager sets a workflow's severity (critical, warning or info) in its notification
settings. Alerts, the event log, messages on every channel and each person's level
choices use it.

**Why this priority**: without it, "SMS for critical only" cannot be expressed, and the
preferences grid's critical and info columns stay dead for workflows.

**Independent Test**: set a DAG workflow to critical and trigger it. The event log shows
**Critical**, and a person who allows SMS only for critical receives one. Set it to
warning and trigger it again: that person receives no SMS.

**Acceptance Scenarios**:

1. **Given** an existing workflow, **Then** its severity reads warning, and its alerts
   behave exactly as before until a manager changes it.
2. **Given** a manager changes the severity, **Then** episodes that activate afterwards
   use the new severity; an open episode keeps the severity it activated with, so its
   clear matches.

---

### User Story 5 - Ask members for their mobile number (Priority: P2)

Members who joined before SMS existed have no number, so SMS reaches nobody until they
add one. After signing in, a member who could receive SMS sees a banner above the page
asking for their mobile number. It opens the same add-and-verify steps as their
preferences. A manager can also ask a workflow's SMS recipients who have no number to
add one.

**Why this priority**: SMS (User Story 3) reaches no one until people add numbers, and
nobody has one today. It ships with User Story 3.

**Independent Test**: with Twilio test credentials and an SMS allowance above 0, subscribe
a member to a workflow with SMS on and sign in as them. The banner says they receive one
workflow's alerts by text; adding and verifying a number from it hides the banner. Sign
in as another member and choose **Not now**: the banner is gone, and with the clock
moved 14 days on it is back.

**Acceptance Scenarios**:

1. **Given** the deployment has Twilio configured, the organization's SMS allowance is
   above 0, and a member who can view devices has no verified number, **When** they open
   the portal in that organization, **Then** a banner above the page asks them to add a
   mobile number. If they are an SMS recipient of any of its workflows, it says how many.
   A member whose number is opted out is asked to verify it again instead.
2. **Given** the banner, **When** the member chooses **Add mobile number**, **Then** the
   steps of their preferences open (number, code, SMS levels with **Critical** ticked),
   and once the number is verified the banner disappears in every organization.
3. **Given** the banner, **When** the member chooses **Not now**, **Then** it stays hidden
   for 14 days. **When** they choose **Don't ask me again**, **Then** it stays hidden
   until a manager adds them as an SMS recipient of another workflow or asks them for a
   number.
4. **Given** the deployment has no Twilio account, the organization's SMS allowance is 0,
   the member has a verified number that has not opted out, or they cannot view devices,
   **Then** no banner is shown.
5. **Given** a workflow's settings list SMS recipients with no verified number, **When** a
   manager chooses **Ask them to add a number**, **Then** each of them gets an email with
   a link to the add-number steps and sees the banner again at their next visit, whatever
   they chose before. A person is asked at most once in 7 days, however many managers or
   workflows ask, and the settings page shows when each was last asked.

### Edge Cases

- **Alert bursts**: when 100 devices activate one workflow within a minute, each alert
  gets its own deliveries. Messages to one destination are paced under the provider's
  rate limit so none is rejected or dropped. SMS stops when what is left of the
  allowance cannot cover the next message.
- **Cleared before sent**: an activation message that has not been sent when the alert
  clears is cancelled on every channel, as email is today.
- **Lost access or changed choices**: a recipient who leaves the organization, loses
  device view access, removes or changes their number, or turns a channel or level off
  has their pending deliveries cancelled with a reason.
- **Revoked webhook**: when Teams or Slack reports that the webhook no longer exists, the
  delivery fails without retrying and the destination is marked **Failing** on the
  Destinations page and in subscribing workflows' settings, until a test or delivery
  succeeds.
- **Provider outage**: a timeout or server error is retried with backoff, as email is. A
  timeout after the provider accepted a message can produce a duplicate; none of these
  channels can be exactly-once.
- **Opted out**: when a recipient has replied STOP and Twilio refuses the message, the
  delivery fails with "Recipient opted out of SMS", the number is marked opted out, and
  the person sees this in their preferences. No SMS goes to it until they verify it
  again.
- **Verification abuse**: wrong codes are limited to 5 per code, and code requests to 5
  per person per hour and a deployment-wide hourly cap. Numbers outside the US and
  Canada are refused, which limits SMS pumping fraud. Verification codes belong to a
  person, not an organization, so they count against no allowance; these limits bound
  what they cost.
- **Allowance changes mid-month**: a new allowance applies at once to what is left. SMS
  already sent stay counted, so lowering it below what is used stops SMS until the next
  month.
- **Long names**: workflow and device names that would push an SMS past two parts are
  shortened. Names in non-Latin scripts make each part shorter (70 characters).
- **Same number on two accounts**: allowed (for example, a shared duty phone). Each
  account verifies it, and each subscription sends its own SMS.
- **Several organizations**: a number and the banner choices belong to the person, not an
  organization. Verifying in one organization stops the banner in all of them, and a
  person sees it only in organizations where it applies.
- **Asked with emails turned off**: a manager's request is not emailed to someone who
  turned off all emails; the banner still returns for them.
- **Unverified number pending**: a person who asked for a code but did not enter it has
  no verified number, so the banner still shows; it resumes at the code step while the
  code is valid.
- **Destinations only**: a subscription may be enabled with destinations and no
  recipients. Enabling it with neither is refused with 422.
- **Service and watchdog alerts**: unchanged; they still go to the operator by email.

## Requirements *(mandatory)*

### Functional Requirements

#### Workflows

- **FR-001**: **Settings → Notifications** MUST list geofence and DAG workflows together,
  labelled with their kind and notification state (enabled channels and destination
  count), with search and paging across both.
- **FR-002**: Workflow notification settings MUST behave identically for geofence and DAG
  workflows.
- **FR-003**: A subscription MUST carry a severity (critical, warning or info; warning by
  default). An episode's severity is fixed when it activates and is used by its alert,
  event-log entries, messages and preference checks.

#### Channel model

- **FR-004**: Each delivery MUST record its alert, transition (activated or cleared),
  channel, and either its recipient (personal channel) or its destination, plus status
  (pending, sent, failed, cancelled), attempts, diagnostic and sent time. There is at most
  one delivery per alert, transition, channel and recipient or destination. Existing
  email deliveries keep their history and identifiers.
- **FR-005**: Channels MUST be one of two kinds. A personal channel sends to a contact
  point a person owns and has verified; a destination channel sends to an organization
  destination that holds a secret. Each channel declares the contact point or secret it
  needs, whether it costs per message, its message length limit, and whether it can
  resolve what it opened. Adding a channel MUST NOT change existing subscriptions,
  destinations or delivery history.
- **FR-006**: WhatsApp MUST fit as a personal channel on the same verified mobile number
  as SMS. PagerDuty MUST fit as a destination whose secret is a routing key. These are
  not built in this spec.
- **FR-007**: Each episode MUST have a stable incident key, the same for its activation
  and clear deliveries on every channel, so a channel that opens incidents (PagerDuty)
  can resolve them on clear.
- **FR-008**: Before every send attempt, every channel MUST repeat the checks email makes
  today: the recipient is still a verified member with device view access, the
  subscription still includes the recipient or destination and the channel, the
  recipient's preferences allow the channel and level, the workflow's execution has not
  stopped or been replaced, and an activation has not already cleared. A failed check
  cancels the delivery with a reason.
- **FR-009**: Deliveries MUST be queued in the same transaction as the alert, as email
  is. Transient failures are retried with backoff (10 s, 30 s, 2 min, 10 min) within 24
  hours, up to five attempts per cycle. Permanent failures (revoked webhook, invalid or
  opted-out number) are never retried automatically.
- **FR-010**: The alert detail's deliveries list MUST show each delivery's channel and its
  recipient or destination name. Managers can retry a failed delivery on any channel, as
  they can retry email today.

#### Destinations (Microsoft Teams and Slack)

- **FR-011**: Managers MUST be able to list, add, rename, replace the URL of, disable,
  enable and delete their organization's destinations, at most 50 per organization.
  Other members cannot see or manage them.
- **FR-012**: A Teams destination MUST accept only HTTPS webhook URLs created by the Teams
  Workflows app (Power Automate hosts). A Slack destination MUST accept only Slack
  incoming-webhook URLs. Any other URL is rejected.
- **FR-013**: Webhook URLs are secrets. They MUST be encrypted at rest and never returned
  after saving; responses show only the kind, host and last four characters. They never
  appear in logs, audit entries, the integration event feed or error messages.
- **FR-014**: **Send test** MUST post a test message and show whether the provider
  accepted it or the error it returned. The destination keeps its last test result and
  time.
- **FR-015**: A message MUST contain the severity, workflow name, device name when known,
  whether the alert activated or cleared, the time in the organization's time zone, and
  a link to the alert in the portal. It contains no telemetry values and nothing about
  other recipients. Teams receives a card and Slack a formatted message, both readable
  in a phone's notification preview.
- **FR-016**: Deliveries to one destination MUST be paced under the provider's rate
  limit, so a burst is delayed rather than rejected or dropped.
- **FR-017**: A permanent failure MUST mark the destination **Failing** until a test or
  delivery succeeds.
- **FR-018**: A subscription MAY use up to 10 destinations of its own organization and
  never a destination of another organization.
- **FR-019**: Adding, renaming, replacing the URL of, disabling, enabling and deleting a
  destination MUST each record an audit event with the actor, without the URL.

#### SMS

- **FR-020**: SMS MUST be available only when the deployment has a Twilio account and a
  toll-free number configured. Without them, SMS options are hidden and the API refuses
  SMS settings with 422.
- **FR-021**: A person MUST be able to add one US or Canadian mobile number, stored in
  E.164 format, and verify it with a six-digit code valid for 10 minutes. The platform
  creates the code and texts it from the toll-free number through Twilio's Messages API.
  Each code allows 5 wrong entries; code requests are limited to 5 per person per hour
  and by a deployment-wide hourly cap. Numbers from other countries, including other
  +1 countries, are refused. Changing the number requires verifying again, and removing
  it cancels pending SMS.
- **FR-022**: Personal preferences MUST let a person choose the workflow levels they
  receive by SMS (**Critical**, **Warning**, **Info**, **Cleared**), with **Critical**
  only as the default once a number is verified. **Turn off all** covers every personal
  channel. Email choices are unchanged.
- **FR-023**: A subscription MUST let the manager choose which personal channels its
  recipients receive (email, SMS or both). The settings page shows which recipients have
  no verified number or have opted out.
- **FR-024**: An SMS MUST fit in two parts and contain the severity, workflow name,
  state and a link to the alert. It is sent from the deployment's toll-free number.
- **FR-025**: Each organization MUST have a monthly SMS allowance: the number of SMS its
  plan includes. The platform has no plans yet, so the deployment sets the default (0
  unless the operator sets one) and platform administrators set it per organization in
  the admin app, where they also see what each organization has used this month. Each
  part of a message counts as one SMS. An SMS is sent only if its parts fit in what is
  left; otherwise it is cancelled with a reason. Concurrent sends MUST NOT exceed the
  allowance. An SMS accepted by Twilio counts, recorded on its delivery; one cancelled or
  refused before Twilio accepts it counts nothing. Managers see the allowance, how much is
  used and what is left.
- **FR-026**: When Twilio refuses a message because the recipient opted out, the number
  MUST be marked opted out and shown to its owner, and no SMS is sent to it until it is
  verified again.
- **FR-026a**: The portal MUST show a signed-in member a banner above the page, never a
  dialog that blocks it, asking for their mobile number when all of these hold: the
  deployment has Twilio configured, the current organization's SMS allowance is above 0,
  the member can view devices there, they have no verified number or it is opted out,
  and they have not postponed or declined the banner. It says how many of the
  organization's workflows send them SMS, when any do. **Add mobile number** opens the
  steps of FR-021 and FR-022; **Not now** hides it for 14 days; **Don't ask me again**
  hides it until they are added as an SMS recipient of a workflow or a manager asks them
  (FR-026b). These choices belong to the person, across organizations.
- **FR-026b**: On a workflow's notification settings, a manager MUST be able to ask its
  SMS recipients who have no verified number, or an opted-out one, to add a number. Each
  gets an email linking to the add-number steps, unless they turned off all emails, and
  the banner returns for them whatever they chose before. A person is asked at most once
  in 7 days, whoever asks; the page shows when each was last asked. Managers cannot
  enter or change another person's number.

#### Contracts and documentation

- **FR-027**: The OpenAPI description and `packages/api-client` MUST cover destinations,
  the extended subscription, phone verification, SMS preferences, the number banner and
  requests, the SMS allowance, and the extended deliveries list. Existing fields
  keep their meaning; user references use integer `user_id`
  ([ADR-013](../../docs/adr/ADR-013-integer-user-ids.md)).
- **FR-028**: `docs/features/alerts.md`, the `alert-notifications` help article and the
  deployment docs MUST describe the new channels, including the Twilio settings, the
  toll-free verification Twilio requires before the number can send, and the outbound
  hosts an on-premise deployment must allow (Slack, Power Automate, Twilio).

### Key Entities

- **Destination**: belongs to one organization. Kind (Teams or Slack; later PagerDuty),
  name, encrypted secret (webhook URL; later a routing key), display hint (host and last
  four characters), state (active, disabled, failing), last test result and time.
- **Contact point**: a person's verified address for a personal channel. Email uses the
  account email. Mobile number (E.164), verified time and opted-out time are new. WhatsApp
  will reuse the mobile number.
- **Subscription**: a workflow's notification settings, revisioned as today: enabled,
  severity, notify on clear, recipient `user_id`s, personal channels (email, SMS) and
  destination ids.
- **Delivery**: one message for one alert transition on one channel to one recipient or
  destination, with its attempt history. It extends today's alert email delivery. An SMS
  delivery also records how many SMS it counted.
- **Incident key**: stable per episode and shared by all of its deliveries.
- **Channel preferences**: per person, the levels they receive on each personal channel.
- **Number prompt**: per person, when the banner is postponed until, when they declined
  it, and when a manager last asked them for a number and who.
- **SMS allowance**: per organization, the number of SMS a month and how many are used
  this month.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a manager subscribes a DAG workflow to email, a Slack
  destination and a Teams destination from the portal. One activation produces exactly
  one message on each, and the clear produces one recovery message on each when notify
  on clear is on.
- **SC-002**: When the provider is healthy, 95% of Teams, Slack and SMS messages are
  accepted within 30 seconds of the alert activating.
- **SC-003**: A burst of 100 activations of one workflow within a minute delivers every
  message to a Slack destination within 5 minutes, with none duplicated or dropped.
- **SC-004**: After saving, a webhook URL cannot be read back from any API response, log
  line, audit entry or page. Tests search all of them for the saved URL.
- **SC-005**: A person verifies a mobile number in under 2 minutes, and on the pilot a
  real phone receives the SMS for a critical workflow alert.
- **SC-006**: Tests prove that no SMS is sent beyond an organization's monthly allowance,
  including when SMS are sent concurrently, that a two-part SMS counts as two, and that
  none is sent for a level the recipient did not choose.
- **SC-007**: Tests prove that another organization cannot list, use, test, change or
  delete a destination.
- **SC-008**: The plan's data model shows WhatsApp and PagerDuty as additions that change
  no existing subscription, destination or delivery record.
- **SC-009**: API tests for every acceptance scenario and edge case pass on PostgreSQL,
  and portal Playwright tests cover US1 to US5.
- **SC-010**: A member with no number who is an SMS recipient adds and verifies one from
  the banner in under 2 minutes, and the banner does not return. Tests prove it never
  shows without Twilio, with an allowance of 0, to someone who cannot view devices, or
  within 14 days of **Not now**, and that a manager's request reaches a person at most
  once in 7 days.

## Assumptions

- Twilio is the only SMS provider: one account and one toll-free number per deployment,
  set by the operator in the environment, with Twilio's toll-free verification done
  before SMS is turned on. The platform pays for SMS; organizations do not bring their
  own accounts in this spec. WhatsApp can later use the same Twilio account's WhatsApp
  sender.
- Pricing tiers will include a number of alerts and of SMS per month. Plans, and limits
  on alerts, are not part of this spec; until the platform has plans, administrators
  copy each organization's SMS allowance from its plan. The allowance limits sending; it
  does not bill organizations.
- Other countries are later work. They need their own sender (often a registered
  alphanumeric sender ID), and an SMS to a country that costs much more than the US or
  Canada would have to count as more than one.
- Teams uses webhooks from the Workflows app; Microsoft retired the Office 365 connector
  webhooks in 2026. Slack uses incoming webhooks. Installing a Slack app (OAuth, a
  channel picker, buttons) is later work.
- Messages link to the portal. Acknowledging or commenting from Teams, Slack or SMS, and
  processing SMS replies, are out of scope.
- "Sent" means the provider accepted the message, as for email. Carrier delivery receipts
  are not tracked.
- Service and watchdog alerts stay email-only to the operator. A platform-owned
  destination for them is later work.
- Reminders, escalation, cooldowns and quiet hours stay on the roadmap ("Notification
  policies"). PagerDuty would provide escalation when it is added.
- Severity lives in the subscription, so it works for both workflow kinds. A severity
  per DAG alert action is later work.
- The Alerts inbox workflow filter and the dashboard alert picker still list only
  geofence workflows; that stays with the roadmap item "Retire workflow v1".
- Messages are in English. Recipient limits stay at 20 per workflow.
- Asking for a mobile number when someone accepts an invitation is later work; the
  banner covers new members until then.
- Delivery history is kept as long as the alert it belongs to.
