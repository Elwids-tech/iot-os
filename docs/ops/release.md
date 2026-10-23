# Release: single-node deployment

The release profile runs the platform on one host (optionally with the database on
a second host) with Docker Compose, digest-pinned images and one operations tool,
[`tooling/release/manage.py`](../../tooling/release/manage.py)
([ADR-006](../adr/ADR-006-deployment-profiles.md)). It is separate from the local
development stack. The current deployment is described in [pilot](pilot.md).

Files: [`deploy/release`](../../deploy/release) (Compose files, Caddy, broker
configs, `environment.example`, monitoring, release checks),
[`deploy/ansible`](../../deploy/ansible) (host provisioning),
[`tooling/release`](../../tooling/release) (operations, upgrades, verification, soak,
Mosquitto migration).

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
TimescaleDB, NATS, the MQTT broker (Mosquitto, `mqtt`) and `broker-admin`, the
monitoring stack, one-off `migrate` and `runtime-migrate` jobs, and demo simulators
(`demo` profile). Overlays: `compose.external-db.yml` (database on another host),
`compose.adapters.yml`.

## Private inputs

Never commit these, paste expanded Compose configuration anywhere, or put them in
frontend configuration (the web apps receive only their public URLs and an
environment label).

- Host access and an operator VPN (the host playbook expects SSH over the VPN).
- DNS for `app`, `admin`, `api`, `mqtt` and `ops` under `DOMAIN`. Publish AAAA
  records only after checking IPv6 firewall rules. `ops` resolves to the VPN address
  privately; public requests get 403.
- MQTT certificates: `MQTT_ACME_CHALLENGE=webroot` (port 80 must reach Caddy) or
  `cloudflare` with a private credentials file. The certificate is publicly
  trusted, so the runtime and the API's device connection kits both use the image's
  system CA bundle (`DEVICE_MQTT_CA_FILE=/etc/ssl/certs/ca-certificates.crt`).
- SMTP credentials and verified senders (`MAIL_*`; optional separate
  `ALERT_FROM_ADDRESS`, `ALERT_SMTP_USERNAME`, `ALERT_SMTP_PASSWORD` for
  Alertmanager). Add the provider's SPF/DKIM/DMARC records.
- An AI provider key, if the assistant will be enabled.
- An off-host Restic repository (S3 or SFTP) and its password, kept in a password
  manager independent of the host. A MinIO volume on the same host is not a backup.
- Broker: `init` generates `DEVICE_BROKER_ADMIN_TOKEN` and `MOSQUITTO_ADMIN_PASSWORD`
  ([ADR-019](../adr/ADR-019-mosquitto-only-broker.md)). The release refuses an
  environment still on EMQX ([broker](broker.md#environments-still-on-emqx)).

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
`certificates`, `staging`, `metrics`, `monitoring_heartbeat`, `smoke`. Upgrades of a
running deployment go through [`ship.py`](#shipping-an-upgrade).

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

## Shipping an upgrade

[`tooling/release/ship.py`](../../tooling/release/ship.py) upgrades a running
deployment in one command: it installs the new source, runs `deploy` with that
release's own `manage.py`, and checks the result. Nothing is edited per release; what
changes between releases lives in the [checks file](#release-checks). The first
installation and rollbacks use `manage.py deploy`.

Stage each release in a new private directory (`<short>` is the first seven
characters of the commit):

| File | Contents |
| --- | --- |
| `release.json` | The image manifest, naming the commit its images were built from |
| `release-origin.json` | Optional: the manifest before its images were imported into a local registry |
| `iot-os-source-<short>.tar.gz` | `git archive --format=tar.gz -o iot-os-source-<short>.tar.gz <commit>` from any clone |
| `iot-os-source-<short>.tar.gz.sha256` | `sha256sum` (or `shasum -a 256`) output for the archive |
| `checks.json` | Optional: [checks](#release-checks) for this deployment only |

Then run `ship.py` from the release being shipped, first with `--preflight`, which
stops before anything changes, then without it:

```sh
cd <release dir>
sha256sum -c iot-os-source-<short>.tar.gz.sha256
mkdir staged && tar -xzf iot-os-source-<short>.tar.gz -C staged
python3 staged/tooling/release/ship.py --env <env> --backup-env <backup.env> \
  --source <installed source> --release-dir . --expect-current <running commit> --preflight
```

`<running commit>` is `commit` in `current-release.json` (at least seven characters).
To install a tooling or documentation commit over the images already running, stage
that commit's archive with the running `release.json` and add `--source-commit
<commit>`.

In order, `ship.py`:

1. Checks the archive against its checksum and that it is a `git archive` of the
   expected commit (Git records the commit in the archive), unpacks it beside the
   installed source and validates the configuration with the new tooling. The new
   source gets 0755 directories and 0644 files, so that Grafana, which does not run
   as root, can read the provisioning it mounts from it.
2. Takes the operation lock, waiting for timers that hold it, and refuses
   `DEPLOYMENT_INCOMPLETE`, `BROKER_MIGRATION_INCOMPLETE` or `RESTORE_QUARANTINE`, a
   running release other than `--expect-current`, `IOT_STAGING_DEMO_ENABLED=true` or
   running demo simulators, and a running release with no super administrator.
3. Counts rows in the running release: organizations, users, super administrators,
   organization members, invitations, platform administrators, sites, devices and any
   `unchanged` tables. It also reads the runtime state. `--preflight` ends here.
4. Copies the environment and the private manifests to `before-<time>/` in the release
   directory, moves the installed source to a new `source-before-<time>-<old commit>`
   beside it, puts the new source in its place and deploys.
5. Copies `release.json` and `release-origin.json` into the private directory, writes
   `tooling-provenance.json` (commits, archive checksum, previous source), checks the
   release, then backs up the archive, manifests and provenance with Restic, tagged
   `iot-release-source` (never the project tag, so checkpoint retention keeps them).

If the deploy stops before writing `DEPLOYMENT_INCOMPLETE` (backup access, image
pull, the pre-upgrade checkpoint), the previous release is still running: `ship.py`
puts the previous source back, keeps the new one as `source-failed-<time>-<commit>`,
and the same command can run again once the cause is fixed. If it stops later, the
marker blocks further operations; the previous source stays in `source-before-…` for
the recovery. Failed checks leave the release installed and recorded, and the command
exits with every failure listed. Remove old `source-before-…` directories once a
release has proven itself.

### Release checks

[`deploy/release/checks.json`](../../deploy/release/checks.json) ships with each
release and says what it must contain. `checks.json` in the release directory adds
checks for one deployment, such as settings that differ between environments. Both
use this format, and every section is optional:

```json
{
  "format": 1,
  "routes": ["PUT api/v1/admin/platform-team/{user}"],
  "named_routes": ["api.v1.admin.assistant-settings.show"],
  "tables": ["assistant_settings"],
  "columns": {"organization_invitations": ["grants_super_admin"]},
  "config": {"app.frontend_url": "https://app.{domain}", "agents.enabled": true},
  "unchanged": ["device_profiles", {"table": "organizations", "where": {"deleted_at": null}}],
  "may_change": ["devices"]
}
```

| Section | Passes when, after the deploy |
| --- | --- |
| `routes` | A route with this method and URI exists (the URI as `route:list` shows it) |
| `named_routes` | A route with this name exists |
| `tables`, `columns` | The table or column exists |
| `config` | `config(key)` is identical (`===`) to the JSON value; `{domain}` stands for `DOMAIN`. Only match or mismatch leaves the container, never a value |
| `unchanged` | The row count, optionally filtered by `where` equality, is the one counted before deploying. Adds to the built-in counts above; the table must exist in the running release |
| `may_change` | Never fails: rows of these tables are not compared, for a release whose migration changes them |

The runtime must also be operational within a minute of the deploy if it was before.
The checks run inside the API container and only read. Update the shipped file in the
pull request that adds what it checks, and keep it short: rows that people change
during a deploy (dashboards, alerts, telemetry) do not belong in `unchanged`.

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
