# Incident runbook

Operator response for a deployed environment. This file is served by the
monitoring collector at `https://ops.<DOMAIN>/runbook` (mounted by
`deploy/release/compose.yml`), so keep it self-contained. Deployment, backup and
restore commands are in the release guide (`docs/ops/release.md`).

## Operator record

Keep these in the private operations record, and attach a non-secret copy of the
confirmed URLs and coverage to each environment's acceptance record:

| Item | Value |
| --- | --- |
| Primary and backup operator | Names, coverage hours, contact channel |
| Public portal and API | Confirmed URLs and external monitor links |
| Grafana and host access | VPN-only ops URL, VPN/SSH instructions, vault references |
| Alert delivery | Alertmanager receiver, independent urgent channel, heartbeat monitors |
| Release | Commit, exact image manifest, last compatible rollback, schema notes |
| Recovery | Last successful off-host checkpoint, last restore drill, measured recovery time |

## First response

1. Acknowledge through the configured channel. Record the UTC start time, alert,
   environment, affected services and customer impact. Check for planned
   maintenance.
2. Check the external monitor first. If the host is unreachable, use the provider
   console or VPN and the independent notification path; same-host Grafana may be
   down too.
3. If reachable, open the Grafana overview and the affected service's logs for the
   incident window. Check recent releases, disk, memory and OOM kills, readiness,
   worker heartbeats, queues, broker and JetStream, and persisted telemetry
   timestamps.
4. Preserve evidence and find the failing dependency before restarting anything.
   Restart only the affected service, with the exact deployed environment and
   manifest. Never change credentials or reset volumes.
5. Escalate critical issues after 10 minutes without acknowledgement during agreed
   coverage, through the named backup.
6. Confirm recovery with fresh end-to-end evidence and the resolved notification. A
   green container, `/up` or an old retained reading is not enough.

## By symptom

| Symptom | Inspect | Recover and close |
| --- | --- | --- |
| Site or API down | External probe, DNS/TLS, Caddy, API readiness, database and runtime health | Restore the failed layer; verify login, API readiness and the resolved external alert |
| Database unavailable or disk low | Free space, the bounded Loki filesystem, database logs and connections, backup state, growth of the outbox and inbox ledgers | Preserve the database and cold broker state; add capacity, fix retention or prune processed ledger rows with `php artisan devices:prune-ledgers`. Never delete live database files. Verify reads, writes and fresh telemetry |
| Worker or queue stalled | Worker heartbeat and logs, queue age, failed jobs, deploy/migration mismatch | Fix the cause or start the worker; watch the backlog drain. Review failed side effects before retrying them |
| Telemetry stale | Applied generation and session, publisher connection, broker ACL and TLS, NATS consumers, runtime persistence | Confirm a fresh observation is stored and visible. Keep stale and unknown distinct from zero |
| Stream full (`maximum bytes exceeded`) | Stream usage and limits, outbox backlog, consumer lag | Raise the budget within disk headroom or fix the stalled consumer; never purge streams or delete consumers to make room. Watch the outbox and the downstream replay drain |
| Dead letters (`dead_letters` > 0 in runtime `/internal/status`) | `IOT_DEAD_LETTERS` subjects (`iot.deadletter.<consumer>`), runtime logs for the consumer | Fix the cause, then decide per message whether it still needs processing; never replay commands blindly |
| DAG action uncertain | Action, deployment and grant; observed device state; runtime and worker health | Stop further automation on that target; reconcile only after an authorized fresh observation at the target. Never resend to test recovery |
| Automations paused (`WorkflowEvaluationPaused`, portal banner) | Runtime `/internal/status`, runtime log `workflow evaluation paused`, `IOT_COMMITTED_TELEMETRY` stream info | See workflow checkpoint recovery below. Devices, history and commands keep working |
| API error burst | Correlated logs, recent release, database/runtime/SMTP responses | Verify the affected request path; routine validation errors are not incidents |
| Missing logs in Grafana | Alloy sources and permissions, parsing, Loki availability and disk, the log canary | Restore ingestion and prove a new event arrives. Empty logs are not healthy |
| Alerts not delivered | Rule evaluation, Alertmanager routes and silences, SMTP errors, external heartbeat | Use the independent channel; repair delivery and prove firing and resolved receipt |
| Backup failed or overdue | Backup timer, remote storage and credentials, disk, `DEPLOYMENT_INCOMPLETE` marker | Confirm services resumed; fix the backup; verify a new remote checkpoint and an isolated restore |
| Host lost | Provider console, external monitor, last checkpoint, fencing | Restore onto an isolated replacement host. Never run two command-capable runtimes for the same devices |

Rule `for` durations add to scrape, evaluation and delivery delays; record actual
detection and receipt times in drills.

## Workflow checkpoint recovery

The runtime evaluates automations from the durable `IOT_COMMITTED_TELEMETRY` stream
and stores how far it got. If that stream is replaced (for example a lost or
recreated NATS volume) or retention removed readings that were never evaluated, the
stored position no longer matches. The runtime then pauses **only** workflow
evaluation and logs `workflow telemetry checkpoint lost continuity; recovery
required`. Live values, history, commands and the portal keep working, and the
portal shows "Automations are paused".

It never skips the gap by itself, because skipped readings can no longer raise
alerts or trigger actions. After confirming the cause, and that no evaluable
readings can be restored from a backup, accept the gap:

```sh
docker compose exec api php artisan devices:recover-workflow-checkpoint --reason="NATS volume replaced during maintenance"
```

The command refuses to act unless the runtime reports a lost checkpoint, asks for
confirmation (`--force` skips it) and logs the previous and new stream positions.
Evaluation resumes from the newest retained reading within seconds, without a
restart. Record the reason, the skipped range and any alerts or actions that may
have been missed.

## Safe recovery boundaries

- Use `tooling/release/manage.py` with the actual private environment, manifest and
  backup files from the vault. Never paste expanded Compose configuration or secrets
  into incident records.
- Never run `migrate:fresh`, `docker compose down -v`, demo seeders or an unreviewed
  schema rollback on an environment holding customer data.
- Backups pause writers by design. Honour `DEPLOYMENT_INCOMPLETE` and
  `RESTORE_QUARANTINE`; reconcile the running release and schema before removing a
  marker.
- Restore into an isolated, empty target with outbound mail, webhooks and device
  access blocked. Keep encryption keys and exact image and schema compatibility.
  Validate tenant data, history, broker and JetStream state, and cancelled side
  effects. Fence the old host before a replacement takes over devices.
- Roll back images only when schema compatibility is established; otherwise restore
  a checkpoint to a replacement host. Record the actual recovery point and time.

## Maintenance

Every silence needs an owner, scope, reason and expiry. The nightly backup (08:00
UTC) pauses services: coordinate it with internal and external monitors and confirm
probes, heartbeats and notifications resume afterwards. Never silence unrelated
incidents.

## Incident record

Record UTC detection, acknowledgement and recovery times; release and environment;
symptom and customer impact; alert and redacted log links; cause; actions taken; any
command uncertainty or data loss; fresh verification and the resolved notification;
follow-up owner and due date. Restrict raw logs and customer identifiers. Update the
matching alert or this runbook when a drill exposes a gap.
