# Alerts and notifications

Alerts are episodes raised by automations (a geofence rule that has seen a device
outside long enough, or a DAG's alert action) or by the platform itself when a device
or gateway goes offline ([offline alerts](#offline-alerts)). The **Alerts** inbox lists
them with acknowledgement, assignment, comments and email delivery status. The
**Event log** also records service monitoring alerts and watchdog failures.

Code: [`AlertController`](../../apps/api/app/Domain/Automation/Http/Controllers/AlertController.php),
[`AlertProjector`](../../apps/api/app/Domain/Automation/Services/AlertProjector.php),
[`ConnectivityProjector`](../../apps/api/app/Domain/Automation/Services/ConnectivityProjector.php),
[`DeliverAlertEmail`](../../apps/api/app/Domain/Automation/Jobs),
[`Domain/Notifications`](../../apps/api/app/Domain/Notifications); runtime
[`internal/app/connectivity.go`](../../services/runtime/internal/app/connectivity.go);
portal [`src/alerts`](../../apps/portal/src/alerts). Help:
[`alerts.md`](../../apps/api/resources/help/alerts.md),
[`alert-notifications.md`](../../apps/api/resources/help/alert-notifications.md).

## Episodes

Each deployment and episode number has exactly one alert; each offline episode has
one too, keyed by `episode_key`. Its condition is **active** until the runtime reports
it cleared (`cleared_at`).

- Projection of the runtime transition, the alert, its audit record, the event-log
  entry, the integration event and queued email jobs commit in one transaction. For a
  geofence or offline transition that is the runtime inbox's transaction. A DAG alert
  action is first stored as an intent in the inbox transaction; the automation worker
  projects it shortly after, in its own transaction
  ([`DagActions`](../../apps/api/app/Domain/Automation/Services/DagActions.php)).
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

The inbox groups repeats of one workflow on one device (or of one offline subject),
shows active alerts first, and filters by kind, condition, acknowledgement, device and
workflow. The workflow filter lists geofence workflows and DAG automations.

### Kinds

Every alert has a `kind` and a `severity`:

| Kind | Shown as | Raised by |
| --- | --- | --- |
| `workflow` | Automation | A geofence rule or a DAG alert action; always `warning` |
| `device_offline` | Device offline | The runtime, for one device ([offline alerts](#offline-alerts)) |
| `gateway_offline` | Gateway offline | The runtime, for a gateway and the devices behind it |
| `connection_lost` | Connection lost | Reserved for a lost vendor broker or failing vendor API; nothing raises it yet |

Offline alerts ([spec 018](../../specs/018-device-offline-alerts/spec.md)) have no
workflow and name a device, gateway or adapter instead. `automation_alert_devices`
lists the devices each alert concerns: a workflow alert's bound device (when it names a
device of the organization), or every device an offline alert covers. The `device`
filter matches a workflow alert's bound device or any device an alert lists, so it
also finds a gateway alert that lists the device. Integration reads, the `alert.*.v1`
events and the per-workflow emails cover workflow alerts only.

### Alert allowance

Automation alerts count against the alert allowance of the organization's billing
account ([billing](billing.md#usage), [spec 028](../../specs/028-pricing-plans/spec.md)
US3). The allowance **never stops an alert**.

- An alert counts once, when `AlertProjector` first records its activation, in the
  same transaction. Replayed runtime transitions and DAG alert actions stop at the
  projector's guard, so they never count again.
- Clears, acknowledgements, assignments, comments and offline alerts count nothing.
- It counts in the UTC month the platform records it, not when it occurred, so a
  late report after an outage never changes a past month.
- Past the allowance, an alert is recorded, shown in the inbox and the event log, and
  emailed exactly as before. It counts as one alert of overage for the month,
  recorded against the plan the account was on and priced on that month's invoice (at
  0 during a trial, [billing](billing.md#prices-and-invoices)).
- Without a plan or an override the allowance is unlimited, so alerts are counted but
  never overage.

## Offline alerts

Every active device is watched for going offline without anyone building an
automation. An offline alert opens and clears by itself and appears on the Alerts
page, in the Event log, on the device page and in the device list. **Nothing is sent
for it yet**: no email, no bell notification and no integration event, because nobody
has opted in. Personal subscriptions, routes, per-profile settings and mutes are not
built yet; until they are, every device uses the defaults below.

### Detection

The runtime judges each monitored device, gateway and adapter source on its 5-second
maintenance tick ([`connectivity.go`](../../services/runtime/internal/app/connectivity.go)).
It asks the control plane nothing per packet and keeps detecting while the control
plane is down; episodes recorded meanwhile arrive later with their true times.

- **Heard.** Any packet the runtime receives for a source counts as hearing from it:
  birth, data or death, before validation, so a rejected packet still proves the
  device is alive. Node packets (NBIRTH, NDATA, NDEATH) count for the edge node and
  its own device, never for the devices behind it. On an adapter's edge
  (group `adapters-<organization uuid>`) only a DDATA with at least one reading not
  marked historical counts: the adapter's births and deaths are its own, a birth it
  announces again after a restart repeats an old reading, and a historical reading is
  a backfill or a re-read ([adapters](adapters.md#how-it-fits-together)).
- **Silence** is measured by receipt time, never the device's clock, from an anchor:
  the later of the last packet heard, the runtime's start and the moment its broker
  connection was last restored. Activating a new configuration does not move it.
- **Connection style.** A *stays connected* device (the default) is offline when it,
  or the edge node it sits behind, sends a death certificate, or when its silence
  passes its *Offline after*. A *connects to report* device disconnects by design, so
  deaths are ignored, only silence counts, and its next report clears an open episode
  at once. Devices fed by a [device adapter](adapters.md) always use connects to
  report: the adapter never sends a death of its own for them.
- **Grace period.** An episode opens only after the device has been offline for 2
  minutes without a break, and clears only after it has been back for 2 minutes.
  A shorter drop leaves no alert, only the presence history.
- **Causes.** **Death certificate** (the device, or the direct device's edge node,
  sent one), **Missed check-in** (silence past *Offline after*) and **Gateway
  offline** (the gateway a device sits behind sent its death certificate). **Connection
  lost** is reserved for vendor connections.
- **Severity** is `warning`.

### Offline after

*Offline after* is the silence after which a device counts as offline. Nobody sets it
yet, so every device uses the **automatic** value:

```text
offline after = clamp(ceil_to_minute(3 × reporting interval + poll interval), 15 minutes, 7 days)
```

- The **reporting interval** is the median gap between the device's recent
  **check-ins**, by observed time. The runtime keeps the last 65 distinct observed
  times, none older than 7 days, ignoring gaps of zero or less. Readings less than 10
  seconds apart form a run; a run spanning less than 10 seconds is one check-in (a
  device that sends a few messages at once), and the gaps inside it are left out. A
  longer run is a device reporting more often than every 10 seconds, and each of its
  readings is a check-in; so is each reading of the oldest run when all 65 times are
  kept, because it may have begun before them. A sensor sending two messages a second
  apart every two hours therefore reports every two hours, not every second. Observed
  time is used because a polled device's readings arrive in bursts whose receipt gaps
  are near zero; a constant clock offset cancels out in a gap.
- The **poll interval** is the running adapter revision's interval for a device fed by
  a [polling adapter](adapters.md#http-polling), zero otherwise. A healthy polled
  device can be silent for up to its interval plus one poll.
- A device is **learning** until it has three check-ins in that window. While it
  learns it is not judged by silence; a death certificate still counts for a stays
  connected device. A silence in progress is never a gap, so a device that stops does
  not raise its own threshold; one that slows down raises it as the new gaps complete.
- On start the runtime seeds the gaps from the last 7 days of stored observations, in
  batches of devices, without delaying ingestion; a device is learning until its batch
  is read.

A device reporting every 2 minutes behind a 5-minute poll gets 15 minutes (3 × 2 + 5 is
11, raised to the minimum); a device reporting hourly gets 3 hours; a daily one 3 days.
Each alert keeps the threshold it used, whether it was automatic, and the intervals it
came from.

### Interruptions

Anything on the platform's side that stops it hearing from devices neither opens nor
clears an episode, and an episode already open stays open through it.

- **Runtime restart or deploy.** Silence restarts at the runtime's start: a device that
  died during the restart is alerted only after its full *Offline after* (plus grace)
  from then.
- **Broker connection lost.** Devices on the connection show unknown and are not
  judged; silence restarts when the connection is restored.
- **Adapter restart, redeploy or pause.** An adapter's node death (a redeploy, which
  activating a device through it causes, a restart, a platform deploy replacing its
  runtime, or a pause) is platform-side. Its devices show **unknown** ("Adapter
  restarting; waiting for it to reconnect", or "adapter paused") rather than offline,
  are not judged while it lasts, and the time the adapter was down is left out of each
  device's silence when its next node birth arrives. Activating trackers one after
  another therefore never postpones an alert for one that stays silent.
- **Device reasons are not interruptions.** A device in review
  ([ADR-025](../adr/ADR-025-review-follows-current-birth.md)) or with a failed
  telemetry hand-off is still sending, so it is neither offline nor paused.

### Gateways

An edge node with two or more monitored definitions that stay connected (its devices,
and the gateway's own device if it has one) is a **gateway**. Its death certificate,
or the node and every monitored device behind it going silent past their thresholds,
opens one **Gateway offline** alert that lists the affected devices; they show
"offline because gateway *name* is offline" and open no episodes of their own while it
is open. A device already in its own open episode keeps it. When the gateway returns,
each device that has still not reported is judged by its own *Offline after*, counted
from the gateway's return. An edge with one monitored definition (a direct device) is
a device alert. Adapter edges are never gateways.

**Hosted devices.** A gateway on one organization's connection can also serve devices
of other organizations of its billing account, which moved there
([moving devices](devices.md#moving-devices), [spec 031](../../specs/031-move-devices-within-account/spec.md)).
Each organization gets its own episode and alert, listing only its own devices:

- The gateway's own organization, the pipe owner, gets the **Gateway offline** alert
  for its devices behind the gateway, as above (key
  `gateway:<connection>/<edge>#<episode>`). It gets none when every device behind the
  gateway is hosted elsewhere.
- Each hosted organization gets a **Gateway offline** alert for its devices (key
  `gateway:<connection>/<edge>@<its organization uuid>#<episode>`). It names the gateway
  only: `subject` is `{type: "gateway", uuid: null, name}`, with no link, and the gateway
  never appears in that organization's gateway lists. Its devices show "offline because
  gateway *name* is offline".

The runtime marks a hosted episode with `subject.pipe_organization_uuid`
([events](../reference/events.md#offline-episodes)). The control plane resolves the
gateway in that organization and records the alert only when both organizations share a
billing account and every device the episode lists is a hosted device on that gateway;
otherwise the event changes nothing.

### Rollout, stopping and history

- **Monitoring starts with the next packet.** A device that has sent nothing since
  monitoring started shows "waiting for first report" and is never alerted. One already
  silent when monitoring started (at release, or later when it is activated) shows
  "offline since before monitoring started" instead of opening an episode, and is
  watched from its next packet.
- **Stop reasons.** Deactivating a device, or removing what was monitored, ends an open
  episode with a stop reason (`device_deactivated`, `definition_removed`, and
  `monitoring_disabled` once offline alerts can be turned off) instead of clearing it.
  The alert is no longer active and shows the reason.
- **Device moved.** When a device moves to another organization, the platform ends its
  open alerts in the source as `device_moved` (**Device moved**) at the cutover, and
  relabels those its stop ended as `device_deactivated` during the move. The runtime's
  later transitions for such an episode change nothing. A gateway alert ends this way
  only when every device it lists moved; while it lists a device that stays behind the
  gateway, it stays open for that device.
- **Transitions.** The runtime writes each opened, cleared or stopped transition with
  its outbox event in one transaction (`device.connectivity.v1`,
  [events](../reference/events.md#runtime-events-go--laravel)). The control plane
  deduplicates the event and keys the alert by `episode_key` (`<subject>#<episode>`):
  an `opened` it already has is ignored, and a `cleared` or `stopped` whose `opened`
  never arrived records a historical alert.
- Acknowledging, assigning and commenting work as for automation alerts, with the
  same permissions. Acknowledging never clears or silences the episode.

## Email

Email covers automation alerts only; offline alerts send no email yet.

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
  reminders, escalation, cooldowns, SMS or push. Alerts past the
  [alert allowance](#alert-allowance) are emailed too.
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
  alerts; leaving the organization or losing device view hides the bell. Offline alerts
  have no recipients yet, so they never reach the bell; they still count in the
  sidebar's **Alerts** badge.
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
offline alert transitions (source `connectivity`, with the alert's severity and a link
to it), service monitoring alerts and independent watchdog failures. Every entry reads
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
| `GET alerts` | List; `condition=active\|cleared`, `acknowledged=0\|1`, `device`, `workflow`, `assignee`, repeatable `kind[]` (`workflow`, `device_offline`, `gateway_offline`, `connection_lost`), `muted=0\|1` (default 0 hides muted alerts; nothing is muted yet), `per_page` 1–100 | `Device.view` |
| `GET alerts/{uuid}`, `GET alerts/{uuid}/comments` | Detail (`kind`, `severity`, device, the devices it concerns as `devices` (at most 100, by name) with `devices_total`, acknowledgement, assignee, stop reason), comments; the workflow fields are null for other kinds. Offline alerts add `subject` (`{type, uuid, name}` of the device, gateway or adapter; `uuid` is null for another organization's gateway that serves hosted devices), `site`, `cause`, `offline_since`, `last_seen_at`, `last_observed_at`, `threshold_seconds`, `threshold_automatic`, `reporting_interval_seconds`, `poll_interval_seconds`, `grace_seconds`, `stopped_reason`, `muted`, `held` and `held_count`; these are null (or false and 0) for automation alerts | `Device.view` |
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
A device's offline state is on `GET devices` (`offline_alert`) and `GET
devices/{device}/connectivity` ([devices](devices.md#offline-detection)).

Each delivery the platform records for a recipient also writes one alert notification
for that person (Laravel database notifications, `type` `alert`), in the same
transaction and whatever their email preferences. The `alert-notifications` operations
only ever read or change the signed-in person's own; someone who is not a current
member with `Device.view` (a visiting super administrator, a member without device view)
gets an empty list, a zero summary and a no-op `read`. Notification ids are UUIDv7, so
they sort by time. `alerts:prune-notifications` removes them after 90 days, read or not
(daily at 03:45), and deleting an organization removes its own.

Alert, comment, delivery and attempt retention is not configurable yet.
