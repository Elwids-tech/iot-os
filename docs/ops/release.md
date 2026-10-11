# Release: single-node deployment

The release profile runs the platform on one host (optionally with the database on
a second host) with Docker Compose, digest-pinned images and one operations tool,
[`tooling/release/manage.py`](../../tooling/release/manage.py)
([ADR-006](../adr/ADR-006-deployment-profiles.md)). It is separate from the local
development stack. The current deployment is described in [pilot](pilot.md).

Files: [`deploy/release`](../../deploy/release) (Compose files, Caddy, broker
configs, `environment.example`, monitoring), [`deploy/ansible`](../../deploy/ansible)
(host provisioning), [`tooling/release`](../../tooling/release) (operations,
verification, soak, Mosquitto migration).

This is a recoverable single-runtime deployment, **not high availability**.

## What a release contains

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on a `v*`
tag or manual dispatch. It runs the PHP, TypeScript lint, release-tooling, Go,
adapter and Mosquitto checks, then builds and pushes eight images to GHCR: `api`,
`api-web`, `portal`, `admin`, `runtime` (also contains `broker-admin` and
`committed-consumer`), `simulator`, `adapter-manager` and `adapter-runtime`. The
`single-node-release` artifact holds `release.json` (image digests) with
`deploy/release`, `deploy/ansible` and `tooling/release`. `manage.py` accepts six
images, or eight when adapters are enabled.

A second dispatch with `export_existing_run` set to a successful run produces
`single-node-image-transfer`, an offline image archive for hosts without registry
access ([pilot](pilot.md#deploying-a-release)).

Services ([`deploy/release/compose.yml`](../../deploy/release/compose.yml)): Caddy
(TLS on 80/443), `api` and `api-web`, `portal`, `admin`, workers (`default`,
`alerts`, `assistant`, `webhooks`, `automation`), `scheduler`, `runtime`,
TimescaleDB, NATS, the MQTT broker, the monitoring stack, one-off `migrate` and
`runtime-migrate` jobs, and demo simulators (`demo` profile). Overlays:
`compose.mosquitto.yml` (Mosquitto + `broker-admin`), `compose.external-db.yml`
(database on another host), `compose.adapters.yml`.

## Private inputs

Never commit these, paste expanded Compose configuration anywhere, or put them in
frontend configuration (the web apps receive only their public URLs and an
environment label).

- Host access and an operator VPN (the host playbook expects SSH over the VPN).
- DNS for `app`, `admin`, `api`, `mqtt` and `ops` under `DOMAIN`. Publish AAAA
  records only after checking IPv6 firewall rules. `ops` resolves to the VPN address
  privately; public requests get 403.
- MQTT certificates: `MQTT_ACME_CHALLENGE=webroot` (port 80 must reach Caddy) or
  `cloudflare` with a private credentials file.
- SMTP credentials and verified senders (`MAIL_*`; optional separate
  `ALERT_FROM_ADDRESS`, `ALERT_SMTP_USERNAME`, `ALERT_SMTP_PASSWORD` for
  Alertmanager). Add the provider's SPF/DKIM/DMARC records.
- An AI provider key, if the assistant will be enabled.
- An off-host Restic repository (S3 or SFTP) and its password, kept in a password
  manager independent of the host. A MinIO volume on the same host is not a backup.
- Broker: `DEVICE_BROKER_PROVIDER` (`mosquitto` is the decided default,
  [ADR-009](../adr/ADR-009-mosquitto-default-broker.md); the shipped example still
  says `emqx`), with `DEVICE_BROKER_ADMIN_TOKEN` and `MOSQUITTO_ADMIN_PASSWORD`.

## First installation

1. Provision the host: copy `deploy/ansible/inventory.example.yml` privately and run
   `ansible-playbook -i <private inventory> deploy/ansible/host.yml` (Docker,
   packages, firewall, key-only SSH, timers, a bounded 4 GB filesystem for Loki).
   Copy the release checkout to the host.
2. Get images: the `single-node-release` artifact, or the offline transfer.
3. `python3 tooling/release/manage.py init --env <private>/environment` generates
   secrets once from [`environment.example`](../../deploy/release/environment.example).
   Fill in the inputs above. Keep every generated key.
4. Save Restic settings in a mode-0600 `backup.env` and initialize the repository.
5. Validate, issue MQTT certificates and deploy:

   ```sh
   python3 tooling/release/manage.py validate --env <env> --manifest <release.json>
   python3 tooling/release/manage.py certificates --env <env> --manifest <release.json>
   python3 tooling/release/manage.py deploy --env <env> --manifest <release.json> --backup-env <backup.env>
   ```

   `certificates --dry-run` tests renewal without installing anything.
6. Create the first administrator:
   `php artisan deployment:administrator EMAIL --output=<new private file>` in the
   API container. It refuses existing accounts.
   For a demo staging environment only, `manage.py staging` creates two tenants,
   fixture accounts on `example.test`, simulators and the GPS dashboard.
7. Take a backup immediately and test a restore on a disposable host before
   inviting anyone.

`manage.py` needs Python 3.12+ and PyYAML on Linux and takes a non-blocking lock for
write operations. The application database role owns only the `public` schema; the
runtime role owns `device_runtime`; the API can read runtime telemetry for
operations metrics. The Postgres superuser is used only for initialization, backup
and recovery jobs.

Commands: `init`, `validate`, `render`, `deploy`, `backup`, `restore`,
`certificates`, `staging`, `metrics`, `monitoring_heartbeat`, `smoke`.

## Upgrades and rollback

`deploy` uses immutable digests, takes a pre-upgrade checkpoint, runs migrations as
a separate job, stops the old runtime, and gates on readiness and public smoke
checks. Until every gate passes, a `DEPLOYMENT_INCOMPLETE` marker blocks further
deploys and backups; reconcile the actual images and schema before removing it.
There is no automatic schema rollback. `previous-release.json` records the prior
images: roll back by deploying it only when the schema is compatible; otherwise
restore a checkpoint onto a replacement host.

Never run `migrate:fresh`, demo seeders or `docker compose down -v` on a deployed
environment.

## Backups and restore

`manage.py backup` checks remote access, stops ingress, simulators and the broker,
lets command deadlines settle, stops writers and then NATS, and captures a
Timescale-aware database dump plus cold NATS, broker, application, simulator,
certificate and Caddy state, the environment and the exact manifest, encrypted with
Restic. Previously running services restart even after an error, and writers wait
for NATS to be healthy. Retention is seven daily and four weekly checkpoints. The
pause is at least 45 seconds plus dump and upload time, so the nightly backup is a
planned outage. Recovery target: up to 24 hours of data loss, restored within one
working day. WAL archiving and point-in-time recovery are not configured.

Restore, never into the live state directory:

1. Prepare a disposable host with outbound SMTP, webhooks and MQTT blocked and no
   public DNS. Recover the environment and manifest from the checkpoint, keeping
   `APP_KEY` and every service credential.
2. `manage.py restore --env … --manifest … --backup-env … --snapshot <id>
   --restore-dir <new dir>`. It refuses a non-empty state directory, cancels queued
   external side effects, disables webhooks, starts only the database and sets
   `RESTORE_QUARANTINE`, which blocks deploys.
3. Check tenants, decryption, profiles, history, dashboards, stream checkpoints and
   broker identities. Review cancelled jobs and commands; never resend them
   automatically.
4. For disaster recovery, fence the lost host before the new one takes over
   devices; never run two command-capable runtimes for the same devices. Remove the
   quarantine only after review, then verify fresh births. Re-enable webhooks one at
   a time after checking their replay position.

## Monitoring and launch checks

The release renders the same dashboards and rules as local monitoring with
production labels and longer windows ([monitoring](monitoring.md)). Before
onboarding real data, record evidence for:

- A public port scan showing only 80, 443 and 8883; SSH over the VPN; `ops` denied
  publicly.
- Certificate renewal, the full trust chain, wrong MQTT credentials and cross-tenant
  ACL rejection; no plaintext or WebSocket listener.
- Both web apps, login, invitations, password reset and secure cookies.
- Tenant isolation, profile activation, history, a confirmed command, geofence
  alerts, email and assistant budget rejection. Commands must not replay.
- Runtime, broker, NATS and Postgres interruption and recovery, host reboot, worker
  resumption, and stale data shown as stale.
- A restore and a compatible-image rollback on an isolated clone.
- A 48-hour soak: `tooling/release/soak.py --env … --manifest … --output …`. It
  passes only with at least 48 hours, 25% memory headroom, the expected simulators,
  fresh telemetry, healthy probes, no OOM or unexpected restarts and seven days of
  projected disk runway. Shorter runs are diagnostics.

Local packaging checks: `tooling/release/verify_local.py` (disposable Compose
rehearsal including restore) and `tooling/release/verify_mosquitto.py`
([broker](broker.md)).

## Production

Use a separate host, database, domain, secrets and Restic repository with the same
release artifacts. Set `DEPLOY_ENVIRONMENT=production`, disable demo data and omit
the `demo` profile. Define customer recovery targets and test real hardware before
launch.
