# Monitoring

Prometheus, Loki (with Alloy), Alertmanager and Grafana watch the platform. The
same dashboards and rules run locally (email to Mailpit) and in a release (email
through the SMTP provider). This page is also served as the local runbook at
`http://localhost:9101/runbook`.

Configuration: local [`deploy/monitoring/local`](../../deploy/monitoring/local),
release [`deploy/release/monitoring`](../../deploy/release/monitoring), rendered by
[`tooling/release/monitoring.py`](../../tooling/release/monitoring.py). Incident
steps are in the [incident runbook](incident-runbook.md).

## Signals

- **Scrapes**: protected API operations metrics (`/internal/ops/metrics`,
  `IOT_METRICS_TOKEN`), the container inventory collector, node exporter and the
  monitoring services. Metrics use fixed labels; never add tenant or device IDs as
  labels.
- **Probes** (Blackbox): API and runtime readiness, frontends, monitoring readiness,
  broker and database connectivity, and in a release MQTT TLS and `broker-admin`
  readiness. TCP probes prove a connection, not ACLs or transactions.
- **Workers**: each worker named in `IOT_OPS_WORKERS` emits a heartbeat; a worker
  that never started reports zero and alerts.
- **Data pipeline**: queue and outbox delays, failed jobs, DAG action outcomes,
  unresolved automated-command targets, suspended DAGs, timer delay, consumer health,
  JetStream stream capacity and live versus unmanaged consumer backlog, and
  persisted simulator freshness (`IOT_OPS_EXPECTED_SIMULATORS`, default 0, so absent
  simulators are not an alert).
- **Runtime status**: `GET /internal/status` on the runtime (bearer token) reports
  consumer health, a lost workflow checkpoint and `dead_letters` (messages moved to
  `IOT_DEAD_LETTERS`, see [events](../reference/events.md#nats-jetstream)). The API
  exports the retained count as `iot_nats_dead_letters`, and `MessagesDeadLettered`
  warns while it is above zero.
- **Logs**: Alloy collects only this Compose project's containers, normalizes JSON
  and logfmt severity, and keeps tenant, device and request IDs out of index labels.
  Loki's ruler evaluates error-log and missing-canary rules and sends them to the same
  Alertmanager; Grafana displays rules and logs but sends no notifications itself.
- **Host**: memory, disk (deduplicated by device, writable filesystems only), OOM
  kills and restarts.

Alloy and the inventory collector mount the Docker socket read-only. That still
grants powerful daemon access; keep these containers trusted and private.

Retention: Loki three days, Prometheus seven days or 1 GB, container logs 3 × 10 MB.
In a release, Loki gets a bounded 4 GB filesystem; treat a full log filesystem as an
incident.

## Notifications

Alertmanager groups incidents and sends firing and resolved emails with dashboard and
runbook links. Critical incidents repeat every 30 minutes, warnings every four
hours. Historical failed or expired action totals are displayed, but only new
increases alert; uncertain command targets need explicit reconciliation.

When `NOTIFICATION_INGEST_TOKEN` is set, Alertmanager posts to the API instead of
sending SMTP directly, so incidents also appear in the portal event log
([alerts](../features/alerts.md#monitoring-ingest)). Do not run both routes.

## Local monitoring

The overlay watches the running Devices stack and only ever emails Mailpit.

```sh
python3 tooling/monitoring/local.py up       # also: init, status, config, stop
python3 tooling/monitoring/local.py status
```

The helper keeps `.env` and the Devices credentials, creates private monitoring
credentials once in `.local/monitoring/monitoring.env`, and rebuilds the API and
workers with operations enabled. Include the monitoring overlay whenever you recreate
those services afterwards. All ports bind to 127.0.0.1:

| Service | Address |
| --- | --- |
| Grafana | http://localhost:3000/d/iot-local/local-operations (anonymous Viewer) |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |
| Loki API | http://localhost:3100 |
| Runbook | http://localhost:9101/runbook |
| Mailpit | `IOT_MAILPIT_UI_PORT` from `.env` |

Local rules use short, test-friendly durations (a worker is stale after 45 s, probes
fail after 15 s); they are not the release policy. Alertmanager sends to
`operator@example.test` through `mailpit:1025` without TLS or authentication. Host
metrics describe Docker's Linux VM, not macOS. Loki's local volume has no quota:
watch Docker disk usage (`docker system df`), and reclaim build cache rather than
volumes.

Verify with `python3 tooling/monitoring/verify.py`. `--drills` briefly stops the
automation worker and then the API, emits one synthetic error, restarts what it
stopped, and requires firing and resolved mail for each; it never touches the
database, broker or devices. Evidence goes to `.local/monitoring/`. Stop only the
monitoring services with `local.py stop`; never `down -v`.

## Release monitoring

Grafana is at `https://ops.<DOMAIN>` over the VPN with a generated password
(anonymous access off). The dashboard shows host resources, workers, queues, stream
capacity, simulator persistence, workflow executions and logs. `/up` is liveness;
`/health/ready` checks database and runtime readiness; `/internal/ops/metrics` is
blocked at public ingress.

Same-host monitoring cannot report a dead host. Configure:

- An **external HTTPS monitor** on `https://api.<DOMAIN>/health/ready` and the
  portal, alerting the operator.
- `MONITORING_HEARTBEAT_URL`: the monitoring timer pings it every minute only when
  probes, scrapes, inventory, rule evaluation, recent SMTP and the log canary are
  healthy. Set the provider deadline to five minutes.
- `BACKUP_HEARTBEAT_URL`: pinged only after an off-host backup, retention and
  service restart succeed. Set the deadline to 26 hours.

Test missed-heartbeat notifications. The pilot also has an independent database-host
watchdog ([pilot](pilot.md#monitoring-and-watchdog)).

### JetStream capacity

Streams keep seven days with discard-new. Defaults reserve 12 GiB for telemetry and
4 GiB each for runtime events and committed telemetry, plus 64 MiB for control,
inside a 24 GiB store budget (`IOT_NATS_*_MAX_BYTES`, `IOT_NATS_STORE_MAX_BYTES`).
These are upper bounds, not preallocated disk. Rendering rejects budgets without 10%
headroom, and startup can grow but never shrink a stream. Metrics report the actual
limits. Retired test consumers show as unmanaged backlog; do not delete them to hide
a capacity incident. A full stream leaves new work in the database outboxes, and an
empty publisher outbox does not mean downstream replay has finished.
