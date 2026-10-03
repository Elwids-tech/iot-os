# Single-node staging and recoverable production pilot

This is the deployable release profile, separate from local development. The first
target is a US Hetzner x86 Ubuntu LTS VM (2 vCPU, 4 GB, 80 GB SSD), with
`elwids.xyz` and Brevo SMTP. No cloud resources are created by checking out this
repository. Budget CAD $40/month including off-host backups and a small AI
allowance, excluding domain registration; confirm the actual provider quote first.

## Required private inputs

- Hetzner VM address, SSH key and operator VPN. Install/join Tailscale on the host
  first; use its `100.x` address for Ansible. Verify VPN SSH before firewall changes.
- DNS access for `elwids.xyz`. Create DNS-only A records for `app`, `admin`, `api`,
  `mqtt` and `ops` to the VM. Only publish AAAA records after verifying IPv6 rules.
  Override `ops` to the VPN address in private DNS or the operator hosts file;
  public requests to that hostname receive 403.
- Cloudflare API token limited to DNS edits on this zone, in a root-only file
  containing `dns_cloudflare_api_token = ...` for Certbot. If the zone is hosted
  elsewhere, use its Certbot DNS plugin before issuing the broker certificate.
- Brevo SMTP login/key, verified `no-reply@elwids.xyz`, and operator alert mailbox.
  Add the SPF/DKIM/DMARC records supplied by Brevo; test delivery to a real inbox.
- A separate OpenAI project key. The assistant is disabled until explicitly
  enabled; application limits are US$0.10/day and US$0.04/run, not hard billing caps.
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
   Authenticate the host to GHCR using `docker login --password-stdin`.
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
   rtk proxy python3 tooling/release/manage.py certificates --env /srv/iot/private/environment --manifest /srv/iot/private/release.json --cloudflare-file /srv/iot/private/cloudflare.ini
   rtk proxy python3 tooling/release/manage.py deploy --env /srv/iot/private/environment --manifest /srv/iot/private/release.json --backup-env /srv/iot/private/backup.env
   ```

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
and [incident runbook](../../docs/staging-incident-runbook.md). The plan identifies
release integration gaps for the new DAG automation worker and requires current
target-host evidence before enabling that feature for clients.

Grafana is at `https://ops.elwids.xyz`, VPN-only, using the generated password.
Prometheus keeps seven days/1 GB of metrics; Loki keeps three days of logs.
Container logs rotate at 3 x 10 MB per container. Reserve a **4 GB filesystem** for
`state/loki` to bound retained logs; alert on its free space. The host playbook
creates this bounded filesystem. Treat a full log filesystem as an incident,
never allow it to consume the database disk. Alertmanager uses Brevo.

The dashboard shows host resources, workers, durable queues, PostgreSQL size,
simulator persistence, workflow executions, AI spend and logs. `/up` is basic
liveness; `/health/ready` checks database/runtime readiness. `/internal/ops/metrics`
requires a dedicated bearer token and is blocked at public ingress. The host
collector exports container OOM/restart/stopped status. Metrics use fixed labels;
do not add tenant or device IDs as labels.

Create an external HTTPS monitor for `https://api.elwids.xyz/health/ready` and
`https://app.elwids.xyz` (e.g. a free uptime service) with notifications to the
operator. Verify by stopping ingress in a planned maintenance window. Same-host
Grafana cannot notify when the VM or its network is dead. Also configure an
external backup heartbeat if available. Credentials and account creation for
these services remain operator inputs.

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

The selected EMQX 5.9.3 image prints a Community License notice permitting a
single node for internal use and requiring a commercial license for hosted/SaaS
use. Review the terms for external testing and production before launch. This
implementation does not acquire a license or replace the broker; changing the
broker requires separate provisioning/ACL and Sparkplug compatibility tests.
