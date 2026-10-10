# Single-node staging and recoverable production pilot

The current Hetzner two-host pilot, private access, repository-scoped image
transfer, verified recovery evidence and remaining launch gates are documented in
[the pilot operations runbook](../../docs/pilot-two-server-deployment.md).
That record takes precedence over the generic single-node examples below.

[Mosquitto operations](../../docs/mosquitto-broker.md) documents the opt-in
broker profile, isolated acceptance checks, guarded migration and rollback.

This release profile is separate from local development. GoDaddy manages
elwids.xyz and Brevo sends application/operational email. The pilot uses
DOMAIN=elwids.xyz (previously staging.elwids.xyz, kept as LEGACY_DOMAIN redirects) and public app, admin, api and mqtt subdomains.
MQTT HTTP-01 certificate issuance and renewal dry-run passed on the actual host.
Real client projects are retained; the deployed pilot has no demo seed data.

## Required private inputs

- VM address, SSH key and operator VPN. Install/join Tailscale on the host
  first; use its `100.x` address for Ansible. Verify VPN SSH before firewall changes.
- DNS access for `elwids.xyz`. Create DNS-only A records for `app`, `admin`, `api`,
  `mqtt` and `ops` to the VM. Only publish AAAA records after verifying IPv6 rules.
  Override `ops` to the VPN address in private DNS or the operator hosts file;
  public requests to that hostname receive 403.
- MQTT DNS must point at the server and public port 80 must reach Caddy for
  `MQTT_ACME_CHALLENGE=webroot`. No GoDaddy API credential is required. Existing
  Cloudflare installations can retain `--cloudflare-file` or configure
  `MQTT_ACME_CHALLENGE=cloudflare` and `CLOUDFLARE_CREDENTIALS_FILE` privately.
- Brevo SMTP login/key, verified `no-reply@elwids.xyz`, and operator alert mailbox.
  Add the SPF/DKIM/DMARC records supplied by Brevo; test delivery to a real inbox.
- A separate OpenAI project key. The assistant is disabled until explicitly
  enabled; application limits are US$2.00/day and US$0.04/run, not hard billing caps.
- Off-host Restic repository, password and S3 or SFTP credentials. A local MinIO
  volume on this VM is **not** an off-host backup. Keep recovery credentials in a
  separate password manager. Initialize the repository once with `restic init`.
- Read access to the private GHCR packages and a release artifact from Actions.

Never commit these values, paste expanded Compose configuration into tickets, or
place them in frontend configuration. Runtime web configuration contains only the
four public URLs and the environment label.

## First installation

Run commands from the release's repository checkout. Examples use the project's
`rtk` wrapper; on a fresh host install RTK or execute the underlying commands.

1. Copy `deploy/ansible/inventory.example.yml` privately and set the VPN address,
   SSH user, public network interface and VPN interface. Apply:
   `rtk proxy ansible-playbook -i /private/inventory.yml deploy/ansible/host.yml`.
   The playbook configures Docker, host packages, firewall, key-only SSH and timers.
   Copy this exact release checkout to `/srv/iot/repository`.
2. Trigger `.github/workflows/release.yml` on the intended revision. Download
   `single-node-release`; it contains the six image digests in `release.json`.
   Prefer the repository-scoped CI image export and private-registry import in
   the pilot runbook; no personal GitHub token is required on the host.
3. Generate the environment once:
   `rtk proxy python3 tooling/release/manage.py init --env /srv/iot/private/environment`.
   Fill the private inputs above; retain all generated encryption/service keys.
   Keep `IOT_STAGING_DEMO_ENABLED=true` only in staging. Set
   `IOT_ASSISTANT_ENABLED=true` only after configuring the separate provider key.
4. Save Restic variables in `/srv/iot/private/backup.env` (0600):
   `RESTIC_REPOSITORY=s3:https://...`, `RESTIC_PASSWORD=...`,
   `AWS_ACCESS_KEY_ID=...`, `AWS_SECRET_ACCESS_KEY=...`; or use SFTP with an SSH key
   and pinned host key. Initialize/test Restic using those private variables.
5. Validate configuration and issue MQTT TLS certificates:

   ```sh
   rtk proxy python3 tooling/release/manage.py validate --env /srv/iot/private/environment --manifest /srv/iot/private/release.json
   rtk proxy python3 tooling/release/manage.py certificates --env /srv/iot/private/environment --manifest /srv/iot/private/release.json
   rtk proxy python3 tooling/release/manage.py deploy --env /srv/iot/private/environment --manifest /srv/iot/private/release.json --backup-env /srv/iot/private/backup.env
   ```

   Initial issuance starts a temporary HTTP-only challenge server if Caddy is
   not running and removes it even on failure. Subsequent renewal uses running
   Caddy. Run the same `certificates` command with `--dry-run` to test renewal;
   it never installs a staging-CA certificate or restarts the broker. A real
   renewed certificate is copied with restricted permissions and EMQX restarts
   only when certificate contents changed. Verify device reconnects afterward.

6. Explicitly initialize staging (never part of ordinary deploy/startup):

   ```sh
   rtk proxy python3 tooling/release/manage.py staging --env /srv/iot/private/environment --manifest /srv/iot/private/current-release.json
   ```

   This creates two tenants, seven generated-password fixture accounts, the meter,
   RGB light, three trackers and the existing GPS/geofence dashboard. It waits for
   device and initial geofence acknowledgements. Run after successful fresh births;
   failed or modified fixtures require review, never automatic overwrites. Accounts
   use `example.test` so fixture mail cannot reach real people. Use the invitation
   UI to create named real tester accounts through Brevo. Credentials are written
   only to the printed private file and are never logged. Securely distribute only
   each tester's credentials; do not share the super-admin account.
7. Take an initial backup immediately, then test restore on a disposable isolated
   host. Do not invite testers until both succeed.

`manage.py` requires Python 3.12+ and PyYAML on Linux. All write operations share a
nonblocking lock. The application DB role owns only the public schema; the runtime
owns `device_runtime`; the API receives read access to runtime telemetry for ops.
The postgres superuser is limited to initialization, backup and recovery jobs.

## Monitoring and launch acceptance

For the October 4 staging target and October 5 onboarding, follow the
[monitoring readiness plan](../../plan/tasks/staging-monitoring-readiness.md)
and [incident runbook](../../docs/staging-incident-runbook.md). The DAG automation
worker is included in this release profile and coordinated writer lifecycle.
Release rendering reuses the exercised [local monitoring](../../docs/local-monitoring.md)
dashboards, inventory collector and Loki rules, with staging labels, URLs and
longer evaluation windows. Thirty metric rules and two log rules are provisioned.
Current verified target-host evidence and remaining acceptance gates are recorded
in the pilot runbook; this guide does not imply completion of every launch check.

Grafana is at `https://ops.elwids.xyz`, VPN-only, using the generated password.
Prometheus keeps seven days/1 GB of metrics; Loki keeps three days of logs.
Container logs rotate at 3 x 10 MB per container. Reserve a **4 GB filesystem** for
`state/loki` to bound retained logs; alert on its free space. The host playbook
creates this bounded filesystem. Treat a full log filesystem as an incident,
never allow it to consume the database disk. Alertmanager uses Brevo.

The dashboard shows host resources, workers, durable queues, stream capacity,
simulator persistence, workflow executions and logs. `/up` is basic
liveness; `/health/ready` checks database/runtime readiness. `/internal/ops/metrics`
requires a dedicated bearer token and is blocked at public ingress. The host
collector exports container OOM/restart/stopped status, including containers that
never started. Alloy discovers only this Compose project using a read-only Docker
socket mount; that mount still grants powerful daemon API access. Keep both
collectors trusted/private. Metrics use fixed labels;
do not add tenant or device IDs as labels.

Create an external HTTPS monitor for `https://api.elwids.xyz/health/ready` and
`https://app.elwids.xyz` (e.g. a free uptime service) with notifications to the
operator. Verify by stopping ingress in a planned maintenance window. Same-host
Grafana cannot notify when the VM or its network is dead. Also configure an
external backup heartbeat. Store the two provider URLs privately as
`MONITORING_HEARTBEAT_URL` and `BACKUP_HEARTBEAT_URL`. The monitoring timer runs
every minute and withholds its heartbeat if probes, scrapes, inventory, rule
evaluation, recent SMTP failures or the log canary are unhealthy/unknown. It does
not prove inbox delivery. The backup heartbeat is sent only after off-host upload,
retention and service restart succeed. Set provider deadlines to five minutes and
26 hours respectively, and test missed-heartbeat notifications. Provider-wide external monitoring and backup heartbeat accounts/URLs remain
unconfigured in the current pilot. Database-host watchdog delivery is verified.

Application SMTP uses `MAIL_*`. Alertmanager uses optional `ALERT_FROM_ADDRESS`,
`ALERT_SMTP_USERNAME` and `ALERT_SMTP_PASSWORD`, falling back to application values.
Set both alert credentials together and authenticate both senders in Brevo.
Critical incidents repeat every 30 minutes; warnings repeat every four hours.
Both send recovery notifications. Prometheus and Loki own rule evaluation;
Grafana displays rules and logs without a duplicate notification path.

JetStream retains seven days with discard-new semantics. Defaults reserve 12 GiB
for ingress telemetry, 4 GiB each for runtime events and committed telemetry, and
64 MiB for control, within a 24 GiB broker budget. These are upper bounds, not
preallocated disk. Size `IOT_NATS_*_MAX_BYTES` against measured traffic and
headroom; rendering rejects budgets without 10% spare capacity. Startup may grow
finite stream limits but never shrink them, alter retention, or purge messages.
The live metrics report actual retained limits, including larger existing limits.
Review those actual limits before reducing the broker's store budget. Retired
test consumers remain visible as unmanaged pending work, separate from live
platform consumers; do not remove them to disguise a capacity incident.

Before launch, record evidence for:

- Public IPv4/IPv6 port scan: only 80/443/8883; SSH over VPN; ops denied publicly.
- Certificate renewal/reload, complete trust chain, incorrect MQTT credentials and
  cross-tenant MQTT ACL rejection; no plaintext/WebSocket listener.
- Both web apps, login/logout, invitations, password resets and secure cookies.
- Tenant roles/isolation; profile activation, meter history, confirmed RGB command,
  GPS/geofence alerts, SMTP and budget rejection. Commands must not replay.
- Runtime, broker, NATS and PostgreSQL interruption/recovery, alert delivery and
  host reboot. Verify every worker resumes and retained readings remain stale until
  fresh telemetry, rather than being presented as current.
- Backup restoration and compatible-image rollback on an isolated clone.
- A 48-hour soak using `tooling/release/soak.py --env ... --manifest ... --output /private/soak.json`.
  Its passing result requires at least 48 hours, 25% memory headroom, five active
  simulators, fresh telemetry, successful probes, no OOM/unexpected restarts (scheduled worker recycling excluded), and seven days
  projected disk runway. Missing metrics fail the gate. Short runs are diagnostic
  only, never accepted as the launch soak.

The nightly backup intentionally pauses services; disable/silence planned outage
alerts during that window. Run the acceptance soak between maintenance windows or
explicitly move the backup timer for the test and restore it immediately afterward;
take backups before and after. Do not claim uninterrupted service on this profile.

## Backup, recovery and upgrades

`manage.py backup --env ... --manifest ... --backup-env ...` checks remote access,
stops ingress/simulators/broker, allows command deadlines to settle, then stops
writers and NATS. It captures a Timescale-aware full database dump plus cold NATS,
EMQX, application, simulator, certificate and Caddy state. The environment and
exact release manifest travel inside the encrypted Restic checkpoint. Services
that were previously running restart even after a backup error. Retention is seven
daily and four weekly checkpoints; plaintext temporary checkpoints are removed.
The timer runs at 08:00 UTC. Recovery target: at most 24 hours lost, within one
working day; only a measured drill establishes that target is achievable.

Restore procedure (never run against the live state directory):

1. Prepare a disposable host with outbound SMTP/webhooks/MQTT blocked and no public
   DNS pointing to it. Obtain the recovery environment/manifest from the encrypted
   backup using Restic, preserving `APP_KEY` and all service credentials. Change
   only the dedicated target paths/project name and isolated host routing. Use the
   same Timescale/PostgreSQL image as the backup release checkout.
2. Run `manage.py restore --env ... --manifest ... --backup-env ... --snapshot EXACT_ID --restore-dir /private/new-restore`.
   It refuses a nonempty state directory, restores with Timescale pre/post restore
   hooks, cancels queued external side effects, and disables webhooks. Only the
   database is started. `RESTORE_QUARANTINE` blocks deployment/bootstrap.
3. Check tenant counts, credentials/decryption, profiles, histories, dashboards,
   stream/checkpoint correspondence and broker identities. Review cancelled jobs
   and commands; never automatically resend them. Apply fake SMTP/disabled AI and
   network egress controls before starting a clone's application or simulators.
4. On a drill, keep real notifications and hardware inaccessible throughout. For
   disaster recovery, fence the lost host before taking ownership of devices.
   Remove quarantine only after review, then start services with the backed-up
   release, verify fresh births and perform the launch checks. Re-enable webhooks
   individually after reviewing their replay position. Record elapsed restore time
   and evidence; update `iot_restore_verified_timestamp_seconds` in the production
   host's textfile metrics only after actual successful verification.

Upgrade uses immutable digests, a serialized pre-upgrade checkpoint, a separate
migration job, stopping the old runtime, and readiness/public smoke gates.
A `DEPLOYMENT_INCOMPLETE` marker records the attempted manifest until all gates pass.
A failed deployment blocks subsequent deployment and checkpoint creation until an
operator reconciles the actual running images/schema, resumes or recovers the
release, and removes the marker. Do not label a mixed release as the previous one.
Failures leave explicit operator recovery work; there is no automatic destructive
schema rollback. `previous-release.json` records the prior images. For a proven
schema-compatible rollback, deploy that manifest using the corresponding previous
checkout. Otherwise recover the checkpoint into a replacement host. Never run
`migrate:fresh`, demo seeders, or `down -v` on a deployed environment.

## Production

Provision a separate host/database/domain/secrets/repository with the same release
artifacts. Set `DEPLOY_ENVIRONMENT=production`, disable demo data and omit the demo
profile. Use `deployment:administrator EMAIL --output=/private/new-file.json` for
the first real administrator. It refuses existing accounts instead of promoting
them or resetting their passwords. Define real customer recovery targets and test
hardware before launch; introduce WAL archiving when daily recovery is insufficient.
This is a single-runtime, recoverable pilot, not an HA deployment. Kubernetes and
database replication remain separate future work requiring runtime fencing.

## Broker licensing gate

The active Hetzner pilot uses Mosquitto under EPL/EDL, with no single-node
commercial-license requirement. Its provisioning, tenant ACLs, Sparkplug and
recovery checks are documented in [broker operations](../../docs/mosquitto-broker.md).
EMQX 5.9.3 remains supported for legacy environments and rollback. Its BSL terms
include use-case restrictions on hosted/embedded offerings; review the actual
deployment rights before choosing that legacy profile for external use.
