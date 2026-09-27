# Workflow alerts and email delivery

The portal now includes **Alerts**: an organization-scoped episode list with
active/cleared filters, detail, acknowledgement, comments and email delivery
status. This is separate from the deferred visual workflow builder.

## Episode semantics

Each execution-version/episode pair has one durable alert. The runtime inbox,
transition projection, alert, audit event, delivery records and database queue
jobs commit in the same Laravel database transaction. A replay with a different
envelope UUID cannot create another logical alert or email delivery.

Condition state and human acknowledgement are independent:

- An eligible outside transition activates an episode; eligible re-entry clears
  its condition. Missing/stale GPS still does not clear it.
- Acknowledgement records the first actor and timestamp and is idempotent. It
  does not clear the condition or suppress notification delivery.
- Comments are append-only and accept a client-generated UUID for safe retries.
- An alert has at most one assignee, who must be a member of the organization.
  Assigning replaces the previous assignee and `null` clears it. Assignment is
  recorded in the device audit log only; it does not add a comment, send email
  or change acknowledgement.
- Disable, replacement and suspension preserve the last condition; the detail
  page displays the execution's stop reason. No false recovery is generated.
- Clear-before-activation delivery fills a cleared historical episode; the later
  activation does not reopen it or send a stale activation email.

Existing transitions from before this release are not automatically backfilled.
This projection processes newly received runtime events. Historical transition
records remain accessible through the workflow transition API.

## Notification policy

Email is **off by default** and configured per workflow in **Alerts → Notification settings**, or using the notification API. Select up to 20 verified organization members with `Device.view` access.
The worker rechecks membership, verification, permission, subscription and the
applied execution before each send. Removing access, disabling notifications or
requesting workflow disable cancels pending delivery at processing time.

One activation email per episode/recipient is supported. Recovery email is
optional. There are no repeated reminders, escalation chains, configurable
cooldowns, SMS or push channels yet. Turning notifications on does not backfill
old episodes or add newly selected recipients to prior delivery records.

If a queued activation is already cleared before sending, it is cancelled.
Explicitly configured recovery email can still be delivered. Email text includes
the occurrence timestamp, alert identity and episode; it is not a fresh GPS fix.
Changing settings does not revoke email that has already been handed to SMTP.

## Delivery and recovery

The explicit `alerts` queue uses the same database connection as the transaction,
with `after_commit=false`. The global `sync` queue setting does not affect it.
Queue records and delivery intent are inserted atomically, avoiding a gap between
database commit and dispatch.

The separate `alerts-worker` service runs:

```
php artisan queue:work alerts --queue=alerts --sleep=1 --timeout=30 --max-time=3600
```

Jobs use a 120-second reservation lease and a 24-hour retry deadline. Caught SMTP
failures are recorded and retried with increasing delays, stopping after five
recorded attempts. A worker crash rolls back the in-flight transaction; the queue
lease lets another worker retry. Already-sent/cancelled/failed deliveries are
no-ops on repeated job execution. Workers can wait for activation acknowledgement
without blocking the runtime's transition inbox or telemetry evaluation.

Each logical delivery has a stable Message-ID. **SMTP cannot guarantee exactly
once:** a crash after the server accepted email but before the database commit
can cause a duplicate. `sent` means transport acceptance, not recipient receipt.
Attempt history records completed attempts; a process killed mid-send cannot
reliably record whether SMTP accepted the message. Timeout/crash ambiguity and
transport errors are not presented as guaranteed non-delivery.

Managers can retry a failed delivery from its alert detail. The confirmation explains that an uncertain previous attempt may already have reached the recipient. Retry keeps the logical delivery UUID and Message-ID, preserves cumulative attempt history, and starts a new cycle of up to five recorded transport attempts with a fresh 24-hour queue deadline. Each request carries the current `retry_generation`; duplicate or stale requests return 409 without adding jobs. Older jobs and failure callbacks are fenced by generation. The worker rechecks current access, preferences and execution state, cancelling ineligible deliveries. Sent, cancelled and pending deliveries cannot be manually retried. Retry admission and its queue job commit atomically, with an actor audit record. Alert, comment,
delivery and attempt retention is not yet configurable.

## APIs

Base `/api/v1/organizations/{organization_uuid}`:

| Method/path | Purpose |
| --- | --- |
| GET `/alerts` | Paginated list; `condition=active\|cleared`, `acknowledged=0\|1`, `device={device_uuid}`, `workflow={workflow_uuid}`, `per_page` 1–100 |
| GET `/alerts/{uuid}` | Episode, device, acknowledgement, assignee and execution stop reason |
| POST `/alerts/{uuid}/acknowledge` | Idempotent first acknowledgement |
| PUT `/alerts/{uuid}/assignee` | `{user_id}` of an organization member, or `null` to unassign |
| GET `/alerts/{uuid}/comments` | Comments, 50 per page |
| POST `/alerts/{uuid}/comments` | `{uuid, body}`; max 5000 characters |
| GET `/alerts/{uuid}/deliveries` | Delivery states, retry generation and attempt history |
| POST `/alerts/{uuid}/deliveries/{delivery_uuid}/retry` | Retry a failed delivery with `{retry_generation}` |
| GET `/workflows/{uuid}/notifications` | Current notification settings/revision |
| PUT `/workflows/{uuid}/notifications` | Optimistic settings update |
| GET `/workflows/{uuid}/notification-recipients` | Paginated verified member choices; optional name search |

Notification update example:

```json
{
  "revision": 0,
  "enabled": true,
  "notify_on_clear": true,
  "recipient_ids": [42]
}
```

List and detail items include `device_uuid`, `device_name` (null when the
device record is not found), `acknowledged_by_name`, `assignee` (`{id, name}` or
null) and `assigned_at`. The `device` and `workflow` filters only match alerts in
the requested organization.

Settings use the notification revision, independently of the workflow draft.
Stale updates return 409. Invalid or out-of-organization recipients return 422.
Alert/comment reads require `Device.view`; acknowledgement, assignment, comment
creation, delivery details and notification settings require `Device.manage`.
An assignee outside the organization returns 422. Organization
membership and resource ownership are enforced separately. The portal provides a paginated workflow directory, recipient search and pagination inside the picker, selected-recipient removal, opt-in and recovery switches, saved feedback and unsaved-navigation protection. A 409 preserves the local draft; reloading saved preferences requires an explicit discard confirmation.

## Verification

`tooling/verify-workflow-execution.php` now verifies the rebuilt control/runtime
path, alert projection, acknowledgement and the separate worker delivering
activation and recovery emails into Mailpit. It refuses any other SMTP host,
uses a temporary `.test` recipient, and removes its temporary database records.
Mailpit retains the clearly labelled fixture messages; other mail is untouched.

The PHP tests cover transactional queue rollback, duplicate and out-of-order
events, acknowledgement, comment retries, permission boundaries, bounded SMTP
retries and cancellation after access revocation or condition clearing. Browser
verification covers list filters, detail, acknowledgement, comment preservation
on navigation, comment save, delivery status, desktop and mobile dark appearance.

Next: scoped application access and the first SDK. Cooldown, escalation and other customer-specific notification policies remain requirement-led. The visual builder remains deferred.

The local verification fixture also accepts `WORKFLOW_VERIFY_UI=1 WORKFLOW_VERIFY_RETRY=1` for an isolated UI recovery test: it simulates terminal uncertainty after transport acceptance, then expects an explicitly retried activation and the normal recovery (three Mailpit messages). This demonstrates duplicate risk instead of treating SMTP acceptance as exactly-once delivery. Only fixture records are changed.
