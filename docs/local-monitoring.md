# Local service monitoring

This opt-in stack monitors the current Devices development project. It sends
operational notifications exclusively to Mailpit, never Brevo. It does not
provision staging, external monitoring or public DNS.

## Start and access

From the repository root:

```sh
rtk proxy python3 tooling/monitoring/local.py up
rtk proxy python3 tooling/monitoring/local.py status
```

The existing database, broker, runtime and Mailpit must already be running.
The helper preserves `.env` and Devices credentials, creates private monitoring
credentials once in `.local/monitoring/monitoring.env`, and rebuilds API/worker
images with operations enabled. Always include the monitoring overlay when
subsequently recreating those services; the helper does that for you.

- Grafana: http://localhost:3000/d/iot-local/local-operations
- Mailpit: http://localhost:8026 on this workstation (root `.env` controls its port).
- Prometheus: http://localhost:9090
- Alertmanager: http://localhost:9093
- Loki API: http://localhost:3100
- This runbook: http://localhost:9101/runbook

All monitoring host ports bind to 127.0.0.1. Grafana permits local anonymous
Viewer access; admin credentials are stored privately. Do not reuse this access
policy outside local development. Dashboards, rules and data sources live in
`deploy/monitoring/local/`. Data persists in dedicated named volumes.

## Signals and notification routing

Prometheus scrapes protected API metrics, Docker container inventory, the Linux
VM node exporter and the monitoring services. Blackbox probes API/runtime
readiness, frontend availability, monitoring readiness and broker/DB connectivity.
TCP checks are connection tests, not MQTT ACL or PostgreSQL transaction proofs.

The expected local worker list is alerts, assistant, webhooks and automation.
Each emits its own heartbeat. Never-started workers emit zero and fail visibly.
Default queue worker and scheduler are excluded because this dev profile does
not run them. The release profile expects all six workers.

Metrics cover queue/outbox delays, failed jobs, action outcomes, unresolved
automated-command targets, current suspended DAGs, timer delay, consumer health,
persisted simulator freshness, memory/disk, OOM/restarts and monitoring failures.
Configure IOT_OPS_EXPECTED_SIMULATORS in the private monitoring env if a specific
simulator count must remain active; its local default is zero. No simulator is
started or enabled by this setup. Absent simulator activity is not a claim that
device ingestion has been tested.

Alloy discovers only this Compose project's containers. Service and environment
labels come from Docker metadata; JSON severity is normalized. Tenant/device/
request IDs stay out of index labels. On initial discovery, logs older than one hour are intentionally
skipped to bound historical backfill; already collected logs retain three days.
Alloy resumes from persisted positions after restart. Producer-side secret hygiene remains
mandatory; collector masking is supplementary, not comprehensive DLP. Alloy and
the inventory collector mount the Docker socket read-only: this still confers
powerful daemon access because a Unix socket is an API. Keep these containers
trusted and local; their application code uses discovery/log/inspection reads.

Loki retains logs for three days. Prometheus retains seven days / 1 GB. Docker
logs for monitoring containers rotate at 3 x 10 MB. The local Loki named volume
has no hard filesystem quota; monitor Docker disk usage. The release's bounded
log filesystem remains a separate staging requirement. Host memory/CPU metrics
describe Docker's Linux VM, not the macOS host.

Metric rules run in Prometheus. Error-log rules run in Loki's ruler and forward
to the same Alertmanager, whose data source is visible in Grafana. This deliberate
choice avoids a second Grafana notification route. Grafana displays Loki rules
and logs; it does not own/evaluate these log rules.

Alertmanager groups incidents and sends firing/resolved emails to
operator@example.test through mailpit:1025, with no authentication or TLS because
this transport stays on the local Compose network. Critical repeats are 30 minutes;
warnings repeat every four hours. Email includes dashboard/runbook links. Local
rules have short test-friendly durations (worker stale >45s for 15s, probe failure
15s); these are not the staging policy. A two-minute error-log window resolves
automatically when errors stop. Historical failed/expired action totals are
displayed; only new increases alert. Uncertain targets require explicit reconciliation.

## Responding to alerts

1. Open the email, then Grafana and the affected service's logs. Check dependencies
   and recent changes before restarting anything. Correlate request IDs in Explore.
2. For API readiness failures, inspect PostgreSQL, runtime, MQTT/NATS and API logs.
   `/up` alone is liveness; readiness and fresh persisted data provide stronger proof.
3. For stale workers/queues, inspect the named worker and failed jobs. Fix the cause
   and verify heartbeat/backlog recovery. Never replay side effects blindly.
4. For uncertain commands, inspect a fresh target observation and reconcile through
   the authorized application flow. A service restart is not reconciliation.
5. For log/scrape failures, inspect Alloy/Loki/Prometheus and the collector. Missing
   telemetry is unknown, not healthy. Container inspection failure emits a failure
   gauge rather than publishing a partial healthy inventory.
6. Verify recovery email, fresh probes/heartbeats and relevant application behavior.

Whole-host failure cannot email from this same-host stack. Independent external
uptime/heartbeat monitoring, TLS expiry/renewal and off-host backup/restore gates
remain mandatory staging work. Local absence of those signals is not faked as green.

## Verification and maintenance

`tooling/monitoring/verify.py` checks live targets, logs, protected metrics and
Mailpit. Its explicit `--drills` option briefly stops the automation worker and
API in sequence and emits one labelled synthetic error. It restarts interrupted
services in `finally` blocks and requires firing plus resolved mail for each
scenario. Run only while local interruptions are acceptable; it never stops the
database/broker, changes device configuration or commands hardware.

```sh
rtk proxy python3 tooling/monitoring/verify.py --drills
```

Evidence is saved under `.local/monitoring/verification.json`. Do not mistake local
Mailpit delivery for external inbox delivery. Keep silences bounded and inspect
all remaining active alerts after a drill. Stop only monitoring services with:

```sh
rtk proxy python3 tooling/monitoring/local.py stop
```

Never use `down -v` or reset volumes for monitoring recovery. Changes are local
until separately committed/deployed; the staging runbook retains its own gates.

## Verified locally on October 2, 2026 (America/Edmonton)

- All 19 scrape targets and 11 HTTP/TCP probes passed.
- Controlled automation-worker and API outages each produced firing and resolved
  emails in Mailpit; both services were restored.
- A synthetic Laravel error traversed Docker, Alloy and Loki and produced firing
  and resolved email. A separate canary verified token masking.
- Unauthenticated operations metrics returned HTTP 403. Grafana rendered the
  dashboard, service filter and all 26 metric/log rules.
- API suite: 197 tests, 2,188 assertions. Release tooling: eight tests.
  Prometheus rules: three tests, including disk deduplication and read-only
  filesystem exclusion. Prometheus, Alertmanager, Alloy and Loki configs validated.

Drill evidence is stored privately in `.local/monitoring/verification-drills.json`;
the latest smoke check is in `.local/monitoring/verification.json`.

### Incidents observed before recovery

Monitoring passing does not mean the data pipeline is healthy. At verification,
the telemetry and device-event JetStream streams were effectively at their
768 MiB and 256 MiB limits. With `discard: new`, the runtime reported
`nats: maximum bytes exceeded` and telemetry handoff failures. The runtime outbox
had about 279,000 pending entries, and retained simulator readings were stale.
Two old verification consumers also had backlogs; removing consumers alone would
not recover stream capacity under limits retention. No messages were purged,
consumers deleted or retention settings changed.

Docker's Linux data filesystem also had about 9% free space. Disk alerts now
deduplicate bind mounts by device and check writable ext4/xfs/btrfs/zfs filesystems,
excluding read-only images and macOS shared mounts. This is a Docker VM signal,
not a complete macOS storage assessment.

Before staging, inspect storage usage, preserve required data, establish explicit
JetStream capacity/retention budgets, and verify outbox drainage plus fresh
persisted telemetry. Keep these incidents visible until recovery is proven.
External Brevo delivery, GoDaddy DNS/TLS, off-host monitoring and backup restoration
remain staging acceptance gates.

### Recovery implementation

On October 2, unused Docker build cache was reclaimed without deleting images,
containers or data volumes. The local Docker data filesystem recovered from
roughly 9% to more than 25% free space before the final rebuilds. Build cache can
grow again; inspect `rtk docker system df` before any targeted cleanup. Do not use
volume pruning for disk recovery.

Devices Compose now gives JetStream an explicit 24 GiB store budget. Runtime
streams have configurable byte limits: 12 GiB telemetry, 4 GiB events, 4 GiB
committed telemetry and 64 MiB control. Existing retained data and seven-day
discard-new policy are preserved. Startup only increases bounded capacities;
it cannot silently shrink them. A real isolated-broker test proved messages
survive expansion and a lower subsequent request. Actual configured limits are
exported, including any larger pre-existing allocation.

The stopped RGB simulator was restarted using its existing configuration and
persisted state. All four configured demo devices resumed fresh persisted
readings. Live consumer backlog and unmanaged verification-consumer backlog are
now separate metrics; no historical consumer was deleted. Full runtime outbox
batches resume promptly instead of waiting a mandatory second. Development PHP
now enables OPcache with timestamp validation to avoid reparsing Laravel for
every replayed event. Publication and event application remain ordered and use
their existing durable acknowledgements and idempotency ledger.

Capacity/freshness/disk alerts cleared. Event backlog alerts remain valid until
the stored outage backlog finishes replaying; a cleared capacity alert alone is
not evidence of completed replay. Current recovery evidence is kept privately
under `.local/monitoring/`; Grafana shows both the runtime outbox and live NATS
consumer backlog. External staging services remain unconfigured.

Final recovery checks at 23:21 MDT: all 19 scrapes and 11 probes were healthy,
both runtime outboxes were empty, and the oldest demo reading was 12 seconds old.
About 244,000 retained runtime events still awaited control-plane application;
`MessagingUnhealthy` correctly remained active while this consumer caught up.
An empty publisher outbox does not mean the downstream replay is finished.

The recovery revision passed 198 API tests (2,192 assertions), the Go suite plus
the isolated NATS expansion test, 15 release/heartbeat tests, and three alert-rule
tests. The isolated release rehearsal included the automation worker, five fresh
simulator activations and an independent Timescale restore with side effects
quarantined. It does not establish public TLS, real SMTP or off-host cold broker
restoration. The prepared release has 30 metric and two log rules; local remains
24 metric and two log rules.
