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
| `GET alerts/{uuid}`, `GET alerts/{uuid}/comments` | Detail (device, acknowledgement, assignee, stop reason), comments | `Device.view` |
| `POST alerts/{uuid}/acknowledge`, `POST alerts/acknowledge` | Acknowledge one, or several | `Device.manage` |
| `PUT alerts/{uuid}/assignee`, `POST alerts/{uuid}/comments` | Assign, comment (max 5000 characters) | `Device.manage` |
| `GET alerts/{uuid}/deliveries`, `POST .../deliveries/{d}/retry` | Delivery history, retry with `{retry_generation}` | `Device.manage` |
| `GET workflows?kind=all` | Geofence workflows and DAG automations, each with `kind` (`geofence` or `automation`); without `kind=all`, geofence workflows only | `Device.view` |
| `GET/PUT workflows/{uuid}/notifications`, `GET workflows/{uuid}/notification-recipients` | Recipients and options (`{revision, enabled, notify_on_clear, recipient_ids}`; reads also return `workflow_kind`) | `Device.manage` |

`acknowledged_by`, `assigned_to` and `recipient_ids` are integer user ids
([ADR-013](../adr/ADR-013-integer-user-ids.md)). Personal preferences and the event
log are under `/api/v1/notifications/*` (signed-in user, no organization prefix).

Alert, comment, delivery and attempt retention is not configurable yet.
