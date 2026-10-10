# Staging incident response

Status: operator procedure prepared 2026-10-02; deployment URLs, contacts and drills
must be filled and tested during [staging acceptance](../plan/tasks/staging-monitoring-readiness.md).
Monitoring changes in that plan are not yet implemented by this document.

The [domain and email setup plan](staging-monitoring-email-setup.md) defines the
proposed `*.staging.elwids.xyz` endpoints, Brevo senders, external notification
provider and delivery tests. Populate the handoff below after they are verified.

## Operator handoff

Maintain the following in the private operations record, with a non-secret copy
of confirmed URLs and coverage attached to the acceptance record:

| Item | Required value |
| --- | --- |
| Primary / backup operator | Names, accepted coverage and contact channel |
| Public portal / API | Confirmed staging URLs and external monitor links |
| Grafana / host access | VPN-only ops URL, VPN/SSH instructions and vault references |
| Alert delivery | Alertmanager receiver, independent urgent channel, heartbeat monitor |
| Release | Commit, exact image manifest, last compatible rollback and schema notes |
| Recovery | Last successful off-host snapshot, last drill, measured recovery time |
| Client session | Monday Oct 5 time, agreed demo scope, support contact and fallback |

## First response

1. Acknowledge through the configured channel and record UTC start time, alert,
   environment, affected services and client impact. Check planned maintenance.
2. Check the external monitor first. If the VM is unavailable, use the provider
   console/VPN and independent notifications; same-host Grafana may also be down.
3. If reachable, open Grafana overview and the affected service's logs for the
   incident window. Check release changes, disk, memory/OOM, readiness, worker
   heartbeat, queues, broker/JetStream and persisted telemetry timestamps.
4. Preserve evidence and identify the failing dependency before restarting a
   service. Restart only the affected service using the exact deployed Compose
   environment and manifest. Do not change credentials or reset volumes.
5. Escalate critical issues after 10 minutes without acknowledgement during agreed
   coverage. Use the named backup/manual route until automated escalation is proven.
6. Confirm recovery with fresh end-to-end evidence and the resolved notification.
   A green container, `/up`, or old retained reading alone is insufficient.

## Response by symptom

| Symptom | Inspect | Recovery and closure evidence |
| --- | --- | --- |
| Site/API down | External probe, DNS/TLS, ingress, API readiness, DB/runtime health | Restore the failed layer; verify public login, API readiness and resolved external alert |
| DB unavailable or disk low | Host space, bounded Loki filesystem, DB logs/connections, backup state | Preserve DB/WAL and cold broker state; expand capacity or fix supported retention. Never delete live database files. Verify reads/writes and fresh telemetry |
| Worker/queue stalled | Worker heartbeat/logs, queue age, failed jobs, deploy/migration mismatch | Repair root cause/start affected worker; watch backlog drain. Review failed side effects before retrying |
| Telemetry stale | Applied generation/session, simulator/device connection, EMQX ACL/TLS, NATS consumer, runtime persistence | Confirm a fresh observation is committed and then visible. Keep stale/unknown distinct from zero |
| DAG action uncertain | Action/deployment/grant, observed device state, runtime/worker health | Stop further affected automation; reconcile only after an authorized fresh target-state observation. Never resend to test recovery |
| API error burst | Correlated logs, recent release, DB/runtime/SMTP response | Verify affected request path and synthetic journey; avoid paging on routine validation errors |
| Missing Grafana logs | Alloy source/mount/read permissions, parse labels, Loki availability/disk, canary event | Restore ingestion and prove a new event appears. Empty logs must not be called healthy |
| Alerts not delivered | Evaluator/scrape state, Alertmanager route/silence, SMTP/send failures, external heartbeat | Use independent channel; repair delivery and prove firing plus resolved receipt |
| Backup failed/overdue | Timer, remote storage/credentials, disk, failed-deployment marker | Verify previously running services resumed; repair backup, then verify a new remote snapshot and isolated restore |
| Host lost | Provider console, external monitor, last backup and host fencing | Follow isolated restore procedure below; never run two command-capable runtimes for the same devices |
| Automations paused (`WorkflowEvaluationPaused`, portal banner) | `GET /internal/status` on the runtime, runtime log `workflow evaluation paused`, NATS `IOT_COMMITTED_TELEMETRY` stream info | See [Workflow checkpoint recovery](#workflow-checkpoint-recovery). Devices, history and commands keep working meanwhile; verify a new automation evaluation after recovery |

The source rules' `for` durations add to scrape/evaluation and delivery delays.
Record actual detection/receipt times in drills instead of assuming instant alerts.

## Workflow checkpoint recovery

The runtime evaluates automations from the durable `IOT_COMMITTED_TELEMETRY`
stream and stores how far it got. If that stream is replaced (for example a lost
or recreated NATS volume) or retention removes readings that were never evaluated,
the stored position no longer matches the stream. The runtime then pauses only
workflow evaluation and logs `workflow telemetry checkpoint lost continuity;
recovery required`; live values, history, commands and the portal keep working
and the portal shows "Automations are paused".

It never skips the gap on its own, because skipped readings can no longer raise
alerts or trigger actions. After confirming the cause (and that no evaluable
readings can be restored from a backup), an operator accepts the gap:

```bash
docker compose exec api php artisan devices:recover-workflow-checkpoint --reason="NATS volume replaced during maintenance"
```

The command refuses to act unless the runtime reports a lost checkpoint, asks for
confirmation and logs the previous and new stream positions in the runtime log.
Evaluation resumes from the newest retained reading within seconds, without a
restart. Record the reason, the skipped range and any alerts or actions that may
have been missed in the incident record.

## Safe recovery boundaries

Use [the release runbook](../deploy/release/README.md#backup-recovery-and-upgrades)
and `tooling/release/manage.py`. Commands require the actual private environment,
manifest and backup files from the operator vault; do not paste expanded Compose
configuration or secrets into incident records.

- Never use `migrate:fresh`, `down -v`, demo reseeding or unreviewed schema rollback
  on staging holding client work.
- Backups intentionally pause writers. Honor `DEPLOYMENT_INCOMPLETE` and recovery
  quarantine; reconcile the running release/schema before removing any marker.
- Restore into an isolated, empty target with outbound mail/webhooks/hardware
  access blocked. Preserve encryption keys and exact image/schema compatibility.
- Validate tenant data, telemetry history, broker/JetStream state and cancelled
  queued side effects. Fence the old host before a replacement takes device ownership.
- For DAG-enabled staging, first complete the plan's automation-worker lifecycle
  integration; existing backup writer lists do not yet include this worker.
- Roll back images only when schema compatibility has been established. Otherwise
  restore the checkpoint to a replacement host. Record actual RPO/RTO; the current
  target of 24-hour RPO/one-working-day restore may be too slow for a live meeting,
  so retain a separate demonstration fallback.

## Maintenance and Monday preflight

Every silence needs an owner, scope, reason and expiry. Coordinate the scheduled
08:00 UTC / 02:00 MDT backup with internal and external monitors. Verify probes,
heartbeats and notifications resume afterward. Never silence unrelated incidents.

Sixty minutes before client onboarding, check public login, named client access,
fresh simulator data, the agreed workflow/command journey, dashboards/logs, backup
age and both notification paths. Confirm the Sunday release is still running,
avoid new migrations/features, and keep the operator available during the session.
If the environment fails the agreed gate, use the explicitly agreed fallback or
reschedule; do not hide the incident behind stale data.

## Incident record

Record: UTC detection/acknowledgement/recovery times; release and environment;
symptom and user impact; external/internal alert and redacted log links; cause;
actions; any command uncertainty or data loss; fresh verification and resolution
receipt; follow-up owner and due date. Restrict raw logs and customer identifiers.
Update the matching alert/runbook after a drill exposes a gap.
