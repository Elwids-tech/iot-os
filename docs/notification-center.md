# Notification center

The notification center is part of **Alerts**, the single alert inbox. Its
tabs are **Alerts** (workflow alert episodes; active first, repeats of one
workflow on one device grouped, bulk acknowledgement), **Event log** and
**Email preferences** (`/organizations/{org}/alerts/events` and
`/organizations/{org}/alerts/preferences`). The old `/notifications` links
redirect there; without any organization they show only the email preferences.

The **Event log** records workflow transitions of the current organization,
service monitoring alerts, and independent host watchdog failures. Every event
reads **Active** while it needs attention and **Cleared** afterwards. Critical
alerts are red, warnings amber and information blue; labels carry the same
meaning without relying on color. Summary cards count active events by
severity and by type, and filter the log when selected. Filters, search,
pagination, and event details are available. The log refreshes every 15
seconds.

## Email preferences

The grid is personal and applies across organizations. Its **Cleared** column
controls emails sent when an alert clears (stored as `recovery`). The **Turn
off all emails** button disables all alert emails in one save. The master switch
overrides individual grid choices and pending email jobs recheck it before
sending. Event recording continues. Individual choices are retained while
muted. Password resets and account invitations are separate transactional mail.

Workflow emails require both the personal grid choice and the existing workflow
recipient subscription. Service and watchdog events and preferences require
super administrator access. Other members only see events in organizations
where they currently have device viewing permission. Service email is opt-in
and is delivered to the configured platform operator, not every administrator.

## Monitoring integration

Install the migration before enabling `NOTIFICATION_INGEST_TOKEN` (a private
random value of at least 32 characters). Pass it to the API and workers. Set
`NOTIFICATION_OPERATOR_EMAIL` to the verified operator account. Release tooling
uses a webhook receiver instead of the direct SMTP receiver when this token is
configured. Do not run both delivery routes. Alertmanager sends transitions to
`/api/internal/notifications/alertmanager`; repeated fingerprints for the same
incident/status update the seen count without new mail or dashboard rows.
Resolved incidents cannot be reopened by a delayed firing envelope.

The pilot runs `tooling/release/pilot/reconcile_notifications.py` once a minute
on the application host. It checks Alertmanager's current incidents, including
silenced and inhibited alerts, and closes orphaned service events older than two
minutes after monitoring restarts. Reconstructed recovery timestamps are labeled
in the event details. If monitoring is unavailable or returns an invalid response,
it retains the existing state instead of claiming recovery.

Run `php artisan notifications:backfill` to import existing workflow history
without sending mail. Earlier service emails cannot be reconstructed from
Alertmanager alone; service history starts when the webhook is enabled.
The pilot also imports retained Prometheus samples as approximate historical
incidents, clearly labeled in the dashboard. These are not exact email records.

The independent watchdog keeps checking the application host when its API is
unavailable. Its private configuration adds `notifications_token` and
`notifications_url`. It refreshes the operator's email preferences every minute,
caches them, and defaults to no email when no cache exists. During an outage it
uses the last cached choice. Events are persisted locally and replayed after
recovery. Its SMTP path remains independent of the failed application host;
replayed events do not send duplicate API emails. The preference grid therefore
takes up to one watchdog interval to affect its independent sender.

For the two-server pilot, set `WATCHDOG_PRIVATE_IP` to the database host's
WireGuard address and `notifications_private_host` in its private watchdog
configuration to the application host's WireGuard address. Only the two
watchdog endpoints are allowed through that private client address. TLS still
verifies the API hostname and certificate. Internal endpoints remain blocked
on public connections; Alertmanager uses the existing private Docker network.

## Verification

API tests cover master opt-out, queued-delivery cancellation, unchanged event
history, personal revision conflicts, tenant isolation, secret authentication,
repeat deduplication and recovery ordering. Watchdog tests cover muted outages,
durable replay and retained opt-out when the preferences API is unavailable.
UI checks exercise the served grid, event filters, severity badges and persistence.
