# Staging monitoring and client onboarding readiness

Status: proposed delivery plan; source reviewed on 2026-10-02. This document does
not record a deployed staging environment or working notification delivery.

Target: staging ready Sunday, **October 4, 2026**, for client onboarding Monday,
**October 5, 2026**. Scheduling uses America/Edmonton (MDT); incident timestamps
and stored telemetry use UTC. Proposed Sunday handoff: 18:00 MDT, subject to the
existing 48-hour soak gate and the inputs below.

## Outcome and scope

An operator can see service health and searchable logs in Grafana, receive an
actionable alert without watching a dashboard, and follow a tested recovery
runbook. A failure of the VM itself must still generate an external notification.
The client receives a named, restricted staging account and a rehearsed demo.

Reuse the single-node Compose release. Keep staging isolated from production and
use simulators for automated commands. Keep the current CAD $40/month planning
envelope pending a confirmed hosting, backup and alerting quote. Distributed
tracing, HA, Kubernetes, automatic remediation and long-term log analytics follow
after onboarding; they are not weekend prerequisites.

## What exists, and what is missing

| Area | Source evidence | Work needed before claiming readiness |
| --- | --- | --- |
| Release | `deploy/release/compose.yml`, digest manifest workflow, `tooling/release/manage.py` | Publish the chosen revision, deploy on the selected host, verify migrations and runtime roles |
| Metrics and probes | Prometheus, node-exporter, blackbox exporter, protected API metrics; 18 alert rules | Validate on the real host; prove expected services and missing data are visible |
| Grafana | Provisioned Prometheus/Loki data sources and platform dashboard | Verify every panel; provision alert visibility and navigation to runbooks/logs |
| Logs | Alloy tails Docker JSON files; Loki retains three days | Stable service/environment labels, application JSON normalization, redaction tests, ingestion-failure detection |
| Notifications | Generated Alertmanager configuration sends firing/resolved email through Brevo | Confirm receiver, real delivery, escalation and an independent external outage monitor |
| DAG automation | Development `automation-worker`; worker calls `Operations::heartbeat()` | Release service, worker identity, exported heartbeat, lifecycle/backup coverage and action health are missing |
| Recovery | Backup/restore tooling, deployment lock and restore quarantine | Real encrypted off-host archive roundtrip, cold broker/JetStream restore, measured recovery |
| Acceptance | `deploy/release/VERIFICATION.md` records historical local rehearsal | Fresh target-host evidence, public TLS/firewall, SMTP, failure drills and 48-hour soak |

Specific integration gaps found during this review:

- `automation-worker` is absent from release Compose and `manage.py`'s `WRITERS`.
  Add it to shutdown, backup, restart, restore and deployment verification paths;
  copying the development service alone is insufficient.
- The worker needs `IOT_WORKER_NAME=automation`. `apps/api/app/Support/Operations.php`
  currently exports five named workers and omits automation; add its expected
  heartbeat, including a zero/unhealthy value before the first heartbeat.
- DAG pending/failed/uncertain actions, oldest action age, suspended executions,
  timer backlog and consumer health lack operational alert coverage. Aggregate
  metrics by bounded service/status labels; keep workflow/device IDs in details.
- Alloy currently obtains `service` from the log body. Non-JSON infrastructure
  logs and records without that field need container/service metadata. Preserve
  the message and normalize Laravel `level_name`/Go/infrastructure severity.
- Prometheus scrapes API, host and itself. Add monitoring-component health and
  notification/ingestion failure metrics, including Alertmanager, Loki and Alloy.
- Existing rules have summaries but no runbook/dashboard links. Alertmanager has
  one email route, grouped only by alert name with four-hour repeats; severity
  escalation and maintenance policy must be configured and tested.
- `ApiErrors` deliberately requires 20 requests in its window. Low-traffic client
  failures need synthetic checks and bounded error-log alerts in addition.

## Tool choices and ownership

| Responsibility | Choice | Operational rule |
| --- | --- | --- |
| Metrics collection/evaluation | Existing Prometheus and exporters | Version rules in Git; one owner per alert |
| Logs | Existing Alloy → Loki | Structured logs, bounded retention, no sensitive payload capture by default |
| Operator interface | Grafana behind VPN | Provision dashboards, log queries and alert view; operator-only access |
| Metric notification routing | Existing Prometheus → Alertmanager → Brevo | Firing and resolved notifications, grouping and expiring silences |
| Log-based alert evaluation | Provision Grafana Alerting rules over Loki | Route to the same Alertmanager after validating integration; no duplicate email routes |
| Whole-host outage detection | Externally hosted HTTPS monitor, e.g. UptimeRobot or Better Stack | Must run outside this VM and deliver through an independent provider/channel |
| Monitoring dead-man check | External heartbeat service | Expect a periodic monitoring heartbeat; alert externally when it stops |

Grafana shows both logs and alert status. Existing metric rules stay in
Prometheus; explicitly configure its Alertmanager as a Grafana data source and
validate permissions/integration. Provision Loki alert rules/contact routing in
Git rather than leaving them as undocumented UI changes. If that integration is
not compatible with the pinned versions, document the chosen single route before
launch. Treat alert evaluator errors and missing expected data as monitoring
failures; an empty error stream alone is not proof of a healthy collector.

Proposed primary operator: Tharinda. Confirm the alert mailbox, independent urgent
channel and backup contact. Until a backup contact accepts coverage, record this
as single-operator staging; do not promise 24/7 response. Infrastructure purchase,
account configuration and the final go/no-go belong to the operator.

## Logs and Grafana views

Collect API/PHP-FPM, ingress, runtime, all queue/custom workers, scheduler,
PostgreSQL, NATS, EMQX, simulators and monitoring components. Include UTC time,
environment, service, severity, release SHA and event name. Preserve request,
correlation and action IDs as searchable fields, never high-cardinality index
labels. Correlate API request → durable job/action → runtime result where the
application already supplies IDs; document uninstrumented boundaries honestly.

Index only bounded environment/service/severity labels. Strip credentials,
cookies, authorization headers, SMTP secrets and personal/customer payloads at
the producer; test collector redaction as defence in depth. Retain seven days/
1 GB of metrics and three days of logs on the existing bounded 4 GB log filesystem;
keep Docker rotation at 3 × 10 MB. Verify actual volume mounts, rotation and disk
runway. Extend retention only after measuring storage and cost.

Provision these views, linking each service panel to the matching time range in
Loki and the incident runbook:

1. **Staging overview:** public availability, active alerts, release, host memory/
   disk, service/container state, backup age and notification health.
2. **Application and workers:** request rate/errors/latency, all worker heartbeats,
   failed jobs, queue/outbox age and backlog, SMTP/webhook outcomes.
3. **Device pipeline and automation:** broker/JetStream readiness, persisted
   simulator freshness, consumer lag, DAG state/timers/actions and uncertain
   commands. Transport arrival alone does not establish persisted telemetry.
4. **Logs and recovery:** service/severity filters, correlated failures, collector
   ingestion health, backup/restore evidence and certificate expiry.

Example proposed Loki error query after label normalization (validate against
real samples): `{environment="staging", service="api", level=~"error|critical|alert|emergency"}`.
The current collector does not yet establish this complete label contract.

## Alert policy and acceptance tests

Initial thresholds below are staging defaults; tune only against measured data.
For an expected emitter, missing metrics/heartbeat must fail visibly. Suppress
dependent symptoms during a confirmed host outage without suppressing the root
alert. Do not alert on every log line.

| Condition | Severity and trigger | Proof required |
| --- | --- | --- |
| Public API readiness/portal unavailable | Critical: 60-second external checks, two consecutive failures; target receipt within five minutes | Stop ingress on staging in a planned drill; receive firing and resolved externally |
| Runtime/DB/MQTT/JetStream unavailable | Critical: existing readiness probes for 2–3 minutes | Interrupt each dependency in a controlled drill; check fresh data after recovery |
| Worker stale/never started | Critical: heartbeat age >180s for 2m, including automation | Stop one worker and separately test missing initial heartbeat |
| Persisted simulator data stale | Critical: oldest observation >120s for 2m when active; missing expected simulators also fails | Pause a designated simulator and prove the others cannot mask it |
| Queues/actions stalled | Warning: oldest pending >120s for 5m; critical if >300s for 5m (new) | Pause consumer; observe backlog, alert, drain and recovery |
| Uncertain command or suspended DAG | Critical for command uncertainty; warning for suspension, within one evaluation cycle (new) | Use simulator/reconciliation fixture; never replay an uncertain command |
| API errors/latency | Existing >5% 5xx or mean >2s for 5m with ≥20 requests | Controlled request failures; label mean correctly, do not call it p95 |
| Repeated actionable error logs | New: ≥5 matching errors/service/5m warning; known fatal/panic immediate critical | Emit a benign test event; exclude known validation/user errors and verify no duplicate paging |
| Memory/disk/OOM | Existing <25% free memory/10m; <20% disk/5m; container failure/2m | Evaluate fixture metrics safely; never fill the live database disk to test |
| TLS renewal/expiry | Existing expiry <14 days; add verified renewal-failure alert | Check real chain/renewal and exercise a fixture expiry |
| Backup/restore overdue | Existing backup age >26h or absent; restore age >32 days or absent | Off-host backup, isolated restore and a missing-heartbeat alert test |
| Monitoring/notification failure | Scrape failure; new ingestion/evaluator/send errors and external dead-man | Stop Alloy/Alertmanager separately; external monitor survives full VM outage |

Each notification includes environment, service, severity, start time, symptom,
current value, dashboard/log links and runbook link. Proposed critical handling:
acknowledge within 10 minutes during agreed coverage; escalate to the confirmed
backup after 10 minutes, repeat urgent alerts every 30 minutes until acknowledged.
Warnings get email and same-day review. These are response targets, not an SLA.
Use a channel with acknowledgement/escalation support or document manual handling;
Alertmanager email alone cannot implement acknowledgement-based escalation.

Maintenance silences have an owner, reason, scope and expiry. The nightly backup
pauses services at 08:00 UTC (02:00 MDT); coordinate its window with external
monitors and the soak. Verify alerts resume, and never leave an unlimited silence.

## Delivery sequence

| When | Deliverable | Exit evidence |
| --- | --- | --- |
| Friday Oct 2 | Freeze demo scope; confirm host/domain/access, alert contacts, off-host backup and broker licensing; commit/push current work | Named operator, available private inputs, revision selected |
| Saturday Oct 3 morning | Close release/worker gaps; run tests, publish immutable images, deploy staging; VPN/firewall/TLS | Manifest/commit, healthy containers, migrations, public and private access checks |
| Saturday afternoon | Normalize logs; provision views/rules/routing; configure external monitor/dead-man | Every expected service searchable; real firing/resolved delivery and absence tests |
| Saturday evening | Backup/restore and controlled failure/reboot/rollback drills; client journey rehearsal | Restore timing/data evidence; no duplicate commands; named account works |
| Sunday Oct 4 | Review soak and outstanding blockers; rehearse onboarding; freeze accepted release | Completed gate sheet, owner go/no-go, private handoff and fallback ready |
| Monday Oct 5 | Operator preflight 60 minutes before onboarding; check fresh readings, login, alerts and backup | Operator present, stable demo scope, support contact and known limitations |

**Schedule risk:** the existing launch gate requires a full 48-hour soak on the
target environment. To complete at Sunday 18:00 MDT it must begin by Friday
18:00 MDT. A Saturday deployment cannot meet that gate. Start as soon as a stable
candidate exists and record actual duration; material changes require reassessment.
If the full gate cannot be met, the operator must choose to postpone onboarding
or explicitly accept a restricted, supervised simulator demonstration with the
shortened soak recorded. That exception is not granted by this plan and cannot
be reported as full staging acceptance. Security, alert delivery and recovery
failures are blockers, not time-based exceptions.

If DAG release coverage cannot be finished, keep v2 preview disabled for client
organizations and rehearse an agreed v1/device/dashboard demo. Confirm this scope
before the Sunday handoff; a stopped worker is not an acceptable fallback for an
enabled feature. Keep a clearly labelled recorded demonstration available if the
live environment is unavailable; never present it as a functioning live system.

## Required inputs and decisions

- [ ] Confirm provider/region, VM sizing, monthly total, SSH/VPN access. The current
  runbook still names US Hetzner; prior Canadian-hosting research is not a current
  provider selection. Update the canonical runbook after selection.
- [ ] Confirm domain/DNS and certificate access; `elwids.xyz` remains a repository
  example until confirmed for this staging environment.
- [ ] Confirm alert mailbox, independent urgent channel, backup contact and coverage.
- [ ] Supply Brevo configuration and off-host Restic credentials through private
  secret storage; verify delivery and restore. Do not put secrets in this plan.
- [ ] Resolve EMQX hosted/external-use licensing with the operator before clients
  connect; retain the existing release licensing gate.
- [ ] Confirm Monday's onboarding time and exact demo features; choose DAG preview
  versus existing flows, simulator-only commands and whether AI is needed.
- [ ] Record the 48-hour soak start/end, maintenance windows and explicit go/no-go.

## Documentation and handoff gate

Use the [release runbook](../../deploy/release/README.md) for install, backup,
restore and schema-compatible rollback; use the [incident runbook](../../docs/staging-incident-runbook.md)
for alert response. Keep dashboards/rules/collector configuration beside the
existing monitoring files, and link this plan from the repository/plan indexes.

Create a dated staging acceptance record with the release SHA and image digests,
host/environment, test operator, UTC timestamps, measured alert-delivery and
recovery times, screenshots/query evidence and private evidence locations. Do not
overwrite historical local verification or substitute it for staging proof.

- [ ] Public portal/API/admin access controls, VPN-only ops, valid TLS and MQTT ACLs verified.
- [ ] Login, invite/reset email, tenant isolation and demo journey rehearsed on staging.
- [ ] All enabled workers/services visible; log correlation and redaction checked.
- [ ] Internal service failure and whole-host failure both notify; resolution verified.
- [ ] Monitoring failure/absent data detected; no unintended active silences.
- [ ] Encrypted off-host backup and isolated full restore verified; rollback rehearsed.
- [ ] 48-hour soak passes, or a separately recorded restricted-demo decision exists.
- [ ] Operator handoff contains URLs, access method, coverage, known limits and runbooks;
  credentials remain in the private vault and client account has minimum privileges.

The environment is ready only when its evidence supports the agreed scope.
