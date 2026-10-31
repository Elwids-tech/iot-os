# Alerts and notifications

Alerts are episodes raised by automations: a geofence rule that has seen a device
outside long enough, or a DAG's alert action. The **Alerts** inbox lists them with
acknowledgement, assignment, comments and email delivery status. The **Event log**
also records service monitoring alerts and watchdog failures.

Code: [`AlertController`](../../apps/api/app/Domain/Automation/Http/Controllers/AlertController.php),
[`AlertProjector`](../../apps/api/app/Domain/Automation/Services/AlertProjector.php),
[`DeliverAlertEmail`](../../apps/api/app/Domain/Automation/Jobs),
[`Domain/Notifications`](../../apps/api/app/Domain/Notifications); portal
[`src/alerts`](../../apps/portal/src/alerts). Help:
[`alerts.md`](../../apps/api/resources/help/alerts.md),
[`alert-notifications.md`](../../apps/api/resources/help/alert-notifications.md).

## Episodes

Each deployment and episode number has exactly one alert. Its condition is
**active** until the runtime reports it cleared (`cleared_at`).

- Projection of the runtime transition, the alert, its audit record, the event-log
  entry, the integration event and queued email jobs commit in one transaction.
  Replayed runtime events cannot create a second alert or a second email.
- **Acknowledgement** records the first actor and time and is idempotent. It does
  not clear the condition or stop notifications. Several alerts can be
  acknowledged at once.
- **Assignment**: at most one assignee, who must be an organization member
  (`PUT alerts/{alert}/assignee` with `{user_id}` or `null`). Recorded in the
  audit log only.
- **Comments** are append-only; clients supply a UUID so retries are safe.
- Disabling, replacing or suspending a workflow keeps the last condition and shows
  the stop reason; no false "cleared" is invented. Unknown or stale data never
  clears an episode.
- A clear that arrives before its activation fills a historical cleared episode;
  the late activation does not reopen it or send a stale email.

The inbox groups repeats of one workflow on one device, shows active alerts first,
and filters by condition, acknowledgement, device and workflow. The workflow filter
lists geofence workflows and DAG automations.

### Kinds

Every alert has a `kind` and a `severity`. Automation alerts are `workflow`, always
`warning`. The same table holds device connectivity alerts
([spec 018](../../specs/018-device-offline-alerts/spec.md)): `device_offline`,
`gateway_offline` and `connection_lost`, which have no workflow and name a device,
gateway or adapter instead. `automation_alert_devices` lists the devices each alert
concerns: a workflow alert's bound device (when it names a device of the
organization), or every device a connectivity alert covers. The `device` filter
matches a workflow alert's bound device or any device an alert lists. Integration
reads, the `alert.*.v1` events and the per-workflow emails cover workflow alerts
only.

## Email

### Per-workflow recipients

**Settings → Notifications** lists every workflow, geofence workflows and DAG
automations together, with its kind and email state. Email is **off by default**.
Per workflow you choose up to 20 verified members who can view devices, and whether
to send a recovery email when the alert clears (`notify_on_clear`). Settings are
revisioned separately from the workflow draft; stale updates return 409. A geofence
workflow's page can also activate and disable it; a DAG automation's page shows its
state and links to the automation editor, where it is activated with its command
grants.

- One activation email per episode and recipient; recovery is optional. No
  reminders, escalation, cooldowns, SMS or push.
- The plain-text email ([`AlertEmail`](../../apps/api/app/Domain/Automation/Mail/AlertEmail.php))
  names the organization and the bound device and links to the alert, the automation
  and **Settings → Notifications** under `FRONTEND_URL`, so the recipient can
  acknowledge from the portal in one click.
- If the alert clears before its activation email is sent, that email is cancelled.
- The worker rechecks membership, verification, permission, subscription, personal
  preferences and the applied execution before every send; losing access or
  disabling notifications cancels pending mail.

### Personal preferences

**Settings → Email** is a per-person grid that applies across organizations:
sources (workflow, service, watchdog) by level (critical, warning, info, and
**Cleared** for recovery mail), plus **Turn off all emails**, which also stops
[support ticket](support.md) emails; those have their own switch below the grid. Workflow email needs
both the personal choice and the workflow subscription. Account email (password
resets, invitations) ignores these preferences.

### Delivery

Jobs run on the `alerts` queue (database connection, `after_commit=false`) in the
separate `alerts-worker`, inserted in the same transaction as the alert. Failures
retry with backoff (10 s, 30 s, 2 min, 10 min) within 24 hours, up to five recorded
attempts. Each delivery has a stable `Message-ID`.

**SMTP cannot be exactly-once.** A crash after the server accepted a message but
before the database commit can send a duplicate. `sent` means the SMTP server
accepted it, not that anyone read it. Managers can retry a failed delivery from the
alert detail; the retry keeps the delivery UUID and Message-ID, adds a new cycle
of up to five attempts and is fenced by `retry_generation` (stale requests return
409). Sent, pending and cancelled deliveries cannot be retried.

## In-app notifications

Every page header of an organization has a **bell** beside **Assistant** and **Help**
for people who can view devices ([spec 022](../../specs/022-alert-bell/spec.md)). It
counts the person's unread alert notifications there and opens a list of them, newest
first, 20 at a time with **Show older**: automation, device, **Activated** or
**Cleared**, when, and whether the alert is still active.

- **Who gets them**: the same recipients as email. Each activation, and each clear when
  recovery is on, adds one notification per recipient, written with the delivery and
  whatever the person's email preferences. Being added later does not show older
  alerts; leaving the organization or losing device view hides the bell.
- **Read**: selecting a notification, opening the alert from anywhere (an email link,
  the Alerts page) or **Mark all read** marks it read. Mark all read stops at the
  newest one listed, so an alert that arrives meanwhile stays unread. The sidebar's
  **Alerts** badge is different: it counts the organization's unacknowledged alerts.
- **Sound**: a short two-note chime, synthesized in the browser, for a new activation
  (never for a clear, and never for what was already there when the page loaded).
  Several arrivals between checks chime once, and one tab of the browser plays it.
  Browsers allow sound only after you click or type in the page once; **Sound for new
  alerts in this browser** in the bell turns it off for every tab of that browser.
  Screen readers hear "New alert: …" either way.
- **Polling**: each tab checks every 15 s while visible and every 60 s in the
  background, so a background chime can be up to a minute late; a browser that
  freezes background tabs plays nothing until the tab is shown again.
- **Retention**: notifications are removed after 90 days, read or not. The alerts
  themselves stay on the Alerts page.

Code: [`AlertInbox`](../../apps/api/app/Domain/Automation/Services/AlertInbox.php),
[`AlertTransitionNotification`](../../apps/api/app/Domain/Automation/Notifications/AlertTransitionNotification.php);
portal [`src/alerts/bell`](../../apps/portal/src/alerts/bell); kit
[`NotificationBell`](../../packages/ui/src/components/notification-bell.tsx).

## Event log

**Alerts → Event log** records, per organization, workflow alert transitions,
service monitoring alerts and independent watchdog failures. Every entry reads
**Active** while it needs attention and **Cleared** afterwards, with severity
(critical, warning, info) shown as text as well as colour. It refreshes every 15
seconds. Members see events for organizations where they can view devices; service
and watchdog events and their email columns are for super administrators.

### Monitoring ingest

- Alertmanager posts to `POST /api/internal/notifications/alertmanager` with
  `NOTIFICATION_INGEST_TOKEN` (at least 32 characters). Repeats of one incident
  update a seen count without new mail; a late "firing" cannot reopen a resolved
  incident.
- Service email goes only to `NOTIFICATION_OPERATOR_EMAIL`, which must belong to a
  super administrator.
- The independent database-host watchdog reads the operator's preferences from
  `/api/internal/notifications/watchdog-preferences`, caches them, and replays its
  locally stored events to `/api/internal/notifications/watchdog` after an outage
  ([pilot](../ops/pilot.md#monitoring-and-watchdog)).
- `php artisan notifications:backfill` imports existing workflow history without
  sending mail.

Do not run both the webhook receiver and direct SMTP from Alertmanager; release
tooling switches to the webhook route when the token is configured.

## API

Under `/api/v1/organizations/{organization}`:

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET alerts` | List; `condition=active\|cleared`, `acknowledged=0\|1`, `device`, `workflow`, `assignee`, `per_page` 1–100 | `Device.view` |
| `GET alerts/{uuid}`, `GET alerts/{uuid}/comments` | Detail (`kind`, `severity`, device, the devices it concerns as `devices` (at most 100, by name) with `devices_total`, acknowledgement, assignee, stop reason), comments; the workflow fields are null for other kinds | `Device.view` |
| `POST alerts/{uuid}/acknowledge`, `POST alerts/acknowledge` | Acknowledge one, or several | `Device.manage` |
| `PUT alerts/{uuid}/assignee`, `POST alerts/{uuid}/comments` | Assign, comment (max 5000 characters) | `Device.manage` |
| `GET alerts/{uuid}/deliveries`, `POST .../deliveries/{d}/retry` | Delivery history, retry with `{retry_generation}` | `Device.manage` |
| `GET workflows?kind=all` | Geofence workflows and DAG automations, each with `kind` (`geofence` or `automation`); without `kind=all`, geofence workflows only | `Device.view` |
| `GET/PUT workflows/{uuid}/notifications`, `GET workflows/{uuid}/notification-recipients` | Recipients and options (`{revision, enabled, notify_on_clear, recipient_ids}`; reads also return `workflow_kind`) | `Device.manage` |
| `GET alert-notifications` | Your own alert notifications here, newest first, 20 per `page`, with `meta.unread` and each alert's condition now; each has the alert's `kind`, a `subject` (`{type, uuid, name}`, null for workflow alerts) and a `workflow` (null for other kinds) | Member with `Device.view` |
| `GET alert-notifications/summary` | `{unread, newest_unread_activation_id}`, polled by the bell | Member with `Device.view` |
| `POST alert-notifications/read` | Mark read with exactly one of `{ids}` (1–100), `{up_to}` (every id up to it) or `{alert_uuid}`; answers with the summary | Member with `Device.view` |

`acknowledged_by`, `assigned_to` and `recipient_ids` are integer user ids
([ADR-013](../adr/ADR-013-integer-user-ids.md)). Personal preferences and the event
log are under `/api/v1/notifications/*` (signed-in user, no organization prefix).

Each delivery the platform records for a recipient also writes one alert notification
for that person (Laravel database notifications, `type` `alert`), in the same
transaction and whatever their email preferences. The `alert-notifications` operations
only ever read or change the signed-in person's own; someone who is not a current
member with `Device.view` (a visiting super administrator, a member without device view)
gets an empty list, a zero summary and a no-op `read`. Notification ids are UUIDv7, so
they sort by time. `alerts:prune-notifications` removes them after 90 days, read or not
(daily at 03:45), and deleting an organization removes its own.

Alert, comment, delivery and attempt retention is not configurable yet.
