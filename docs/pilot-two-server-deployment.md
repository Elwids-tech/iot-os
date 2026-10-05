# Elwids Hetzner pilot operations

## Deployment record — 2026-10-04

The pilot runs on two Hetzner CX33 servers in Nuremberg, Germany. The earlier
OVHcloud VPS order was not used. Each server has 4 vCPU, 8 GB RAM and 80 GB
storage, with Ubuntu 26.04, Docker 29.1.3 and Compose 2.40.3. This is a
recoverable pilot with real project data; it is not HA.

| Role | Public IPv4 | WireGuard IPv4 | Services |
| --- | --- | --- | --- |
| Application | 46.225.74.65 | 10.78.0.1 | API, admin, portal, workers, runtime, NATS, MQTT, monitoring |
| Database | 46.225.66.171 | 10.78.0.2 | PostgreSQL 17 / TimescaleDB 2.29.2, metrics, independent watchdog |

Public URLs:

- `https://app.staging.elwids.xyz`
- `https://admin.staging.elwids.xyz`
- `https://api.staging.elwids.xyz`
- MQTT TLS: `mqtt.staging.elwids.xyz:8883`

GoDaddy holds DNS; only IPv4 A records were published. Public requests to
`ops.staging.elwids.xyz` receive 403 outside the private tunnel CIDR.

The application manifest identifies commit
`cdabba092af0a66731151b605438b30b71bf2bdc`, verified release run `37256970498`,
and image-export run `37257439033` in `Elwids-tech/iot-os`. The tooling includes
split-database overlays, a format-selective Alloy parser, and Mosquitto operations. Keep the application
manifest and tooling provenance separate: documentation/tooling commits do not
change running application image digests.

Mosquitto 2.0.22 now serves MQTT TLS through the Dynamic Security plugin and a
private credential adapter. The EMQX environment, immutable application images
and durable broker files remain available for rollback. At migration inventory,
one real organization and zero registered connections, gateways or devices
existed; only broker-internal `$SYS` messages were retained. See
[broker operations and rollback](mosquitto-broker.md).

No demonstration organizations or devices were seeded. The first administrator's
generated credentials are private. Create real client organizations and named
users before provisioning their devices. Staging data is not disposable.

## Verified checks and remaining gates

Public HTTPS and dependency readiness passed. Administrator login, the staging
label, and the admin-to-portal URL were checked in the browser. Local admin/portal
containers were rebuilt and local navigation was checked separately. All 14
monitoring targets were healthy before broker migration; the final Mosquitto
acceptance has 15 healthy targets, six successful probes and 23 running expected
containers, with no metric or Loki alerts. Brevo SMTP preflight
reached the approved inbox with TLS and an elwids.xyz DKIM signature. Alertmanager
and the independent database watchdog sent firing/recovery test messages.
Docker → Alloy → Loki log-alert evidence is retained privately.

Encrypted off-site checkpoints and immutable release image archives are on a
BX11 Storage Box in Falkenstein. An actual checkpoint was restored into an
internal Docker network with no host ports; 83 public tables and migration
history were verified after side-effect quarantine. This establishes logical
DB recovery, not full replacement-host cutover or physical-device reconnect.
Both hosts were rebooted separately; Docker, WireGuard, forwarding firewall,
and API/database readiness recovered. MQTT certificate renewal dry-run passed.

Mosquitto's public-endpoint security/protocol tests passed and temporary test
credentials were removed. An actual encrypted checkpoint restored broker state,
TLS keys and administration credentials on an isolated network. The current
database checkpoint restored/quarantined all 83 public tables. Backup shutdown
now stops writers before NATS and waits for NATS health before resuming them;
the final staging checkpoint caused zero runtime restarts. Operator Grafana
tunneling was refreshed after container addresses changed.

Public probes found PostgreSQL, database metrics, Grafana, Prometheus,
Alertmanager, Loki and the image registry unreachable. Full public IPv6 probing
was unavailable from the operator workstation; IPv6 acceptance remains incomplete.

Before production or onboarding irreplaceable data, address:

- Monitoring outside Hetzner for provider-wide outages. The database watchdog
  covers application-host failure, but both hosts share a provider.
- An agreed recovery point objective. Daily checkpoints may lose roughly
  24 hours of changes; continuous WAL archiving/PITR is not configured.
- Client device enrollment, telemetry, command acknowledgement,
  invitation/password reset, and client role acceptance. Temporary staging
  credentials passed cross-tenant MQTT ACL checks; client hardware is still pending.
- A measured replacement-host cutover and sustained capacity/soak run.
  No 48-hour soak completed. The existing fixture-based soak expects demo
  devices; it does not establish acceptance of this unseeded real-data pilot.

OAuth/WorkOS, ClickHouse, replication and Kubernetes are not implemented.

## Private configuration and operator access

Source: `/srv/elwids/source`; state: `/srv/elwids/state`; private configuration:
`/srv/elwids/private`. Preserve `application.env`, `backup.env`,
`current-release.json`, `release-origin.json`, `previous-release.json` and
`restore-test-result.json`. The database holds separate private Compose/env
files and `watchdog.json`. Never regenerate APP_KEY/service secrets, commit
these files, or print expanded Compose configuration.

SSH uses the dedicated `elwids_ovh_pilot_ed25519` key; the filename predates the
provider change. Password authentication is disabled, rotated recovery passwords
are retained privately, and provider-console recovery remains available.
WireGuard uses `wg-elwids` and peer /32 allowed addresses. Docker requires
`wg-quick@wg-elwids.service` so private address binding survives reboot.

UFW and the `ELWIDS-INGRESS` Docker forwarding chain are both required. The
application permits public 80/443/8883; the database permits no public Docker
ingress. Established/private traffic remains available. WireGuard UDP ingress
is limited to the peer. Operator SSH remains publicly reachable by key;
this is not a VPN-only SSH deployment.

For Grafana, resolve current container addresses; they can change after a
redeploy or reboot. Then substitute them into the tunnel command:

```sh
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.74.65 \
  'docker inspect elwids-pilot-grafana-1 elwids-pilot-container-metrics-1 --format "{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"'
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 -N \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3300:GRAFANA_CONTAINER_IP:3000 \
  -L 127.0.0.1:9901:COLLECTOR_CONTAINER_IP:9101 root@46.225.74.65
```

Open `http://localhost:3300/d/iot-platform/platform-operations` and
`http://localhost:9901/runbook`. Grafana's generated password is private;
anonymous access is disabled. Dashboard links using the ops hostname require
VPN routing; the localhost tunnel does not rewrite them.

## Monitoring, email and timers

Prometheus evaluates service/resource/worker/container rules; Loki evaluates
error-log and missing-canary rules; Alertmanager sends Brevo mail; Grafana
shows the results. Avoid a duplicate notification path. Critical incidents
repeat every 30 minutes; warnings every four hours; both send recovery mail.

Brevo authenticated elwids.xyz and verified `alerts@elwids.xyz` and
`no-reply@elwids.xyz`. GoDaddy holds the ownership TXT and two DKIM CNAMEs;
existing DMARC quarantine was preserved. SMTP source-IP authorization allows
exactly the two servers. SMTP login/key and the approved inbox remain private.
Local Mailpit on port 8026 is a separate development capture service.

The database watchdog checks application HTTPS, API/database readiness and
MQTT TLS every minute. Three consecutive failures trigger mail; continued
outages repeat hourly; a healthy sample sends recovery mail. SMTP errors appear
in its systemd journal. It does not depend on application-host Alertmanager.

Alloy selects JSON/logfmt before parsing. Feeding every JSON line into logfmt
caused recursive collector errors and was corrected. Raw access lines remain
searchable without invented severity. Loki keeps three days on a bounded 4 GiB
ext4 filesystem; Prometheus keeps seven days/1 GiB; Docker rotates three 10 MB
files per container.

Timers:

- `elwids-metrics.timer`: every minute.
- `elwids-backup.timer`: 08:00 UTC plus up to five minutes jitter.
- `elwids-certificates.timer`: 09:00/21:00 UTC plus jitter.
- Database `elwids-watchdog.timer`: every minute after startup.
- `elwids-firewall.service`: reapplies Docker ingress rules at Docker startup.

Planned deployment/backup stops can trigger alerts. Use explicit short
maintenance silences rather than disabling rules. Repeated restarts can leave
ContainerFailure firing until its 15-minute evaluation window settles.

```sh
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.74.65 \
  'systemctl list-timers "elwids-*"; journalctl -u elwids-backup.service -n 30 --no-pager'
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.66.171 \
  'systemctl status elwids-watchdog.timer; journalctl -u elwids-watchdog.service -n 30 --no-pager'
```

Real MQTT renewal installs changed certificates and restarts EMQX; verify
client reconnects afterward. A successful dry-run never installs a test certificate.

## Deployment without personal-account GitHub access

New deployment access is scoped to `Elwids-tech/iot-os`. Broad GitHub CLI package
authorization was canceled. No personal GitHub token is installed on either
server. CI uses its repository GITHUB_TOKEN; image export has only contents:read,
actions:read and packages:read. It verifies a successful release run, matching
manifest commit and the repository prefix of every digest-pinned image.

1. Run the release workflow on the reviewed revision; require API, frontend,
   Go and release-tooling checks to pass.
2. Dispatch again with `export_existing_run` set to that successful run.
   Download `single-node-image-transfer` before its three-day expiry.
3. Verify the archive SHA256 locally and on the host. Use a new private archive
   directory so an incomplete transfer cannot destroy the current release.
   `tooling/release/pilot/import_release_images.py --artifact-dir PATH`
   imports with Skopeo while preserving digests.
4. The registry `elwids-registry.local` is on an isolated Docker network, with no
   published ports. Only this alias permits registry HTTP; archive checksums
   validate imported bytes. Back up each archive independently of checkpoints.
5. Export committed source with only reviewed tooling overlays. Retain source
   commit/hashes privately; preserve environments, state, certificates and keys.
   Do not deploy a dirty checkout.
6. Deploy using the pinned manifest and working off-site backup:

   ```sh
   rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.74.65 \
     'cd /srv/elwids/source && python3 tooling/release/manage.py deploy --env /srv/elwids/private/application.env --manifest /srv/elwids/private/release.json --backup-env /srv/elwids/private/backup.env'
   ```

The external overlay activates when DATABASE_HOST is a private IPv4 address.
Readiness/dumps must route through wg-elwids; timescaledb remains the default
single-node profile. Ordinary startup does not seed demo data. Deployment failure
leaves DEPLOYMENT_INCOMPLETE: reconcile actual images/schema before another
attempt; do not blindly delete the marker or run destructive migrations.

## Checkpoints and recovery

The Storage Box uses SFTP port 23 through alias `elwids-backup`, a dedicated
backup key and pinned host identity. Public Storage Box access, SMB and WebDAV
are disabled. Restic encrypts recovery data. Matching recovery password and
operator access must remain independent of the two servers; test that access.

Daily checkpoints quiesce ingress, writers, MQTT and NATS, allow command
deadlines to settle, and capture a TimescaleDB dump, cold durable broker state,
app files, environment and exact image manifest. The pause is at least 45 seconds
plus dump/upload/restart time; this profile is not uninterrupted service.
Retention is seven daily and four weekly checkpoints. Plaintext temporary
checkpoints are removed after upload or failure.

```sh
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.74.65 \
  'cd /srv/elwids/source && python3 tooling/release/manage.py backup --env /srv/elwids/private/application.env --manifest /srv/elwids/private/current-release.json --backup-env /srv/elwids/private/backup.env'
rtk proxy ssh -i ~/.ssh/elwids_ovh_pilot_ed25519 root@46.225.74.65 \
  'python3 /srv/elwids/source/tooling/release/pilot/verify_checkpoint_restore.py'
```

The drill restores the latest iot-checkpoint-v1 dump into an internal disposable
TimescaleDB network, with no public ports, outbound network or live DB target.
It explicitly sets DB_CONNECTION=pgsql because standalone API execution does
not inherit Compose. It runs deployment:quarantine-restore, verifies tables and
migrations, cleans disposable resources and updates
`iot_restore_verified_timestamp_seconds` only after success. The report lives at
`/srv/elwids/private/restore-test-result.json`.

For disaster recovery, fence the lost runtime first. Recover exact images,
environment and checkpoint onto an isolated replacement host, preserving APP_KEY
and credentials. Use DATABASE_HOST=timescaledb for quarantine; manage.py refuses
restore against a live external DB. Verify tenants, decryption, histories,
telemetry and broker state. Keep SMTP, webhooks, AI and real devices unreachable.
Review canceled commands/jobs rather than replaying them. Then migrate to a new
private DB and perform one controlled cutover. Re-enable integrations individually
after reviewing replay positions. Never run migrate:fresh, demo seeders or down -v
on either deployed host.

Pilot-to-production migration must preserve tenant/project/device identifiers,
encrypted credentials and durable event positions. Rehearse a fenced cutover
on an isolated clone, agreeing downtime/data loss with the client. Copying the DB
while the old runtime continues commanding/consuming devices is unsafe.

## Source and evidence

`tooling/release/pilot/` holds non-secret scripts used for the host firewall,
timers, watchdog, image import and restore drill. They target /srv/elwids and
are operator tools, not a general provisioning framework. Review before use on
another environment; keep credentials in private configuration.

Private acceptance evidence is under Git-excluded `.local/hetzner-pilot/`:
reboot reports, checksummed image archives, restore reports/logs, administrator
credentials and screenshots. This directory is not a substitute for keeping
recovery secrets in an independent password manager.
