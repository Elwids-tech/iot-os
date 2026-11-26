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
`compose.adapters.yml` (`adapter-manager`, `adapter-worker` and `webhook-receiver`,
all started whenever `IOT_ADAPTERS_ENABLED` is true).

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
- Push alerts ([spec 033](../../specs/033-pwa-web-push/spec.md)): `init` generates
  the VAPID pair `WEBPUSH_VAPID_PUBLIC_KEY` and `WEBPUSH_VAPID_PRIVATE_KEY`; an
  existing environment adds it once with `manage.py webpush-keys`. An empty
  `WEBPUSH_VAPID_SUBJECT` becomes `mailto:` the `ACME_EMAIL` at deploy. Push is off while
  both are empty (`validate` warns), and one half alone is refused. Keep the pair:
  `restore` refuses a backup whose pair differs, and a replaced pair makes every
  browser register again the next time its person opens the portal. Push needs
  outbound HTTPS to the browser vendors' push services.
- Passkeys ([spec 034](../../specs/034-two-factor-passkeys/spec.md)): the API gets
  `PASSKEYS_RP_ID=${DOMAIN}` and `PASSKEYS_USER_HANDLE_SECRET`. `init` generates the
  secret (64 random bytes, base64); the first deploy of a release with passkeys adds
  it to an older environment file, and `manage.py passkeys-secret` does the same by
  hand. Back up the environment file afterwards. Keep the secret: `validate` refuses
  an environment without it, and `restore` refuses a backup whose secret differs.
  **Changing `DOMAIN` makes every passkey stop working**, because passkeys are bound
  to it; people then sign in with their password and code and add their passkeys
  again.

## Portal addresses

Billing accounts can serve the portal under their own brand on a name under `DOMAIN`
([branding](../features/branding.md#portal-addresses), ADR-050). This is off until you
turn it on:

1. Add one wildcard DNS record, `*.DOMAIN`, pointing at this host. The records for
   `app`, `admin`, `api`, `mqtt` and `ops` stay and take precedence.
2. Set `PORTAL_ADDRESSES_TOKEN` to 64 hex characters (`openssl rand -hex 32`; `init`
   generates one for a new environment file) and `PORTAL_ADDRESSES=on`.
3. Deploy. `render` writes the proxy's catch-all site and its certificate question
   into `addresses.Caddyfile` and `addresses-global.Caddyfile`; both are empty while
   the switch is off.

What to know:

- **Certificates are issued one per name, on first use.** Before asking for one, the
  proxy asks the API (`/api/internal/portal-addresses/ask`) whether the host is an
  address that serves. Any other name gets no certificate and no page. The first
  visit to a new name waits a few seconds for its certificate.
- **About 50 new names a week.** The public certificate authority limits new
  certificates per registered domain, so a deployment can add about 50 branded names
  under `DOMAIN` in a week. Renewals do not count.
- **No route to a public authority?** Leave the switch off. Brands and logos still
  work at the platform's own address.
- **Turning it off** stops every address at the next deploy. Names stay claimed.
- Addresses are allowed per billing account by the **Branding** allowance, which is
  off for every account until staff turn it on.
- `smoke` checks, from inside, that a name nobody claimed is refused a certificate and
  reaches the API as its own host. When a claimed name serves, it also checks that one:
  the proxy may get its certificate, serves one that has not expired (the first check
  makes the proxy issue it), and the portal starts there as that address. With no
  claimed name it says so and passes.
- **Custom domains use the same switch.** An account with the **Custom domain**
  allowance adds a CNAME from its own subdomain to a name under `DOMAIN`, which the
  wildcard record answers. Nothing is added to the proxy: the catch-all site serves
  the domain once the API says it serves, and the API host must be able to resolve
  public DNS (the scheduler looks the record up every few minutes). Custom domains do
  not count toward the 50 names a week. A customer whose DNS provider proxies the
  record must turn that off, or the CNAME is not visible.

### Suspending an address

Platform staff with `PlatformAdministration.manage-organizations` stop one address
without touching the rest of the account:

1. In the admin app open **Portal addresses** (every account's addresses, with a
   **State** filter and a search by address or billing account), or the **Addresses**
   panel on the billing account's page.
2. Choose **Suspend** in the address's menu and confirm.

Within a minute the address shows only *This address is not in use*: no brand and no
sign-in, and the proxy is refused a certificate for it. A session started on a
suspended custom domain is refused; people signed in on a name keep their session on
the platform's own address, because a name shares it. The account's owners see
**Suspended** and can neither change, remove nor restore the address, and it stops
being the account's main address.

**Restore** in the same menu lifts it. A name serves at once. A custom domain is
checked again there and then: with its DNS record still in place it is **Active**
at once, as a new activation, so people sign in again; without the record it goes back
to **Waiting for DNS** with a new 7 days. Both actions are in the activity log with
who did them (`portal_address.suspended`, `portal_address.restored`).

To stop every address on the deployment instead, set `PORTAL_ADDRESSES=off` and deploy.

### When an allowance is withdrawn

Turning **Branding** off for an account (an override of Off, or a plan without it)
stops all of its addresses within a minute, exactly as if each were suspended, and its
organizations show the platform's name and logo again. Turning **Custom domain** off
stops only its custom domain; the name keeps serving.

Nothing is deleted and no state changes at first: the brand, the name and the domain
are kept, the lists show the address in its own state with **Allowance off** and the
day it is given up beside it, and the scheduled DNS check keeps running. Turning the
allowance back on within 30 days brings everything back within a minute, with no
action by the owner.

An address still without its allowance 30 days after the scheduled check first found it
off is released, with `portal_address.released` and the reason `allowance_withdrawn`
in the activity log and a mail to the owners. Its host is then held for the account for
30 more days like any removed address, and the owner, or staff, claims it again once
the allowance is back. The brand itself is never deleted. An address is also given up
when its owner or staff remove it, or when the account is deleted or loses its last
organization.

### Changing an account's addresses for its owners

On a billing account's page in the admin app, the **Addresses** panel does what the
owners do in the portal, without the allowance check: **Claim name** and **Add
domain** in its header while the account has none, and for each address **Change
name**, **DNS record** (the CNAME to pass on to the customer), **Check now** and
**Remove**. Each is recorded in the activity log with the staff member who did it. A
suspended address can be removed but not checked.

### First custom domain checklist

Before telling a customer their domain is ready, for the first one on a deployment:

1. `PORTAL_ADDRESSES=on` is deployed, the wildcard record `*.DOMAIN` resolves to this
   host, and `smoke` passes.
2. The API host can resolve public DNS, and the proxy can reach the certificate
   authority.
3. The billing account has **Branding** and **Custom domain** on (its page, under
   **Allowances**), a brand with a product name, and a name under `DOMAIN` that opens
   the branded sign-in page.
4. An owner adds the domain in the portal (**Billing accounts → Addresses → Use your
   own domain**) and gets the CNAME record. It must be a subdomain; a bare domain
   cannot carry a CNAME.
5. The customer adds the record at their DNS provider, not proxied. Check it from
   outside: `dig +short CNAME <their host>` answers the `c-….DOMAIN` name shown in
   the portal.
6. Within a few minutes, or at once with **Check now**, **Portal addresses** shows the
   domain **Active** with a recent **Last checked**. A request still waiting after 7
   days lapses and the owner asks again.
7. Open `https://<their host>` in a private window. The first visit waits a few
   seconds for the certificate, then shows the branded sign-in page. Sign in as a
   member of one of the account's organizations; a person outside the account is
   turned away.
8. Tell the customer that passkeys made on the platform's address do not work on
   their domain (people add one there), and that a session on the domain is separate
   from one on the platform's address.
9. Suspend and restore the domain once from **Portal addresses** to see that it stops
   and comes back.

### Certificates of custom domains

The proxy issues a custom domain's certificate on first use and renews it about a
month before it expires. The API reads each serving domain's certificate from the
proxy (`PORTAL_ADDRESSES_CERTIFICATE_PROBE`, `caddy:443` in a release) on every check
of the domain, every 15 minutes.

`PortalAddressCertificateExpiry` fires when a domain's certificate has 14 days or less
left, or has not been readable for an hour. **Portal addresses** marks the domain
**Certificate expiring** and its owner sees a warning. To look into it:

1. `dig +short CNAME <their host>` from outside: the record must still answer the
   `c-….DOMAIN` name. A missing record is the customer's to put back; the domain also
   turns **Not reachable** after three checks.
2. The proxy's log for the host says why the certificate authority refused: a proxied
   or changed record, a CAA record that excludes the authority, or its rate limit.
3. The proxy must still reach the certificate authority, and the API must still
   answer the certificate question (`smoke` checks it).

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

`manage.py` needs Python 3.12+ and PyYAML on Linux and takes the operation lock for
every command after `validate`, waiting up to 1800 s for another holder (45 s for
`metrics`, which runs every minute) before failing. The application database role owns only the `public` schema; the
runtime role owns `device_runtime`; the API can read runtime telemetry for
operations metrics. The Postgres superuser is used only for initialization, backup
and recovery jobs.

Commands: `init`, `passport-keys` (adds Passport keys to an existing environment
file), `webpush-keys` (adds the push key pair to an existing environment file),
`passkeys-secret` (adds the passkeys secret to an existing environment file),
`validate`, `render`, `deploy`, `backup`, `restore`,
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

### Changes people notice

- **Required two-step sign-in** (spec 034, from the release with its required
  two-step pull request). Super administrators and platform administrators without
  two-step are sent to set it up on their next request, in the portal and the admin
  app. Tell them before the release, and ship it with or after the two-step screens
  (spec 034 pull request 3). A platform administrator who loses their phone and
  recovery codes needs a reset (spec 034's lock-out pull request).

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
   organization members, invitations, platform administrators, entities (places in
   the hierarchy), devices and any `unchanged` tables. It also reads the runtime state. `--preflight` ends here.
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

## Telemetry streams and the API pool

An application telemetry stream ([integrations](../features/integrations.md#the-telemetry-stream))
occupies one PHP-FPM worker for up to `IOT_STREAM_LIFETIME_SECONDS` (default 3600).
The release sizes the api container for that, in
[`php-fpm.release.conf`](../../deploy/docker/api/php-fpm.release.conf) and
[`compose.yml`](../../deploy/release/compose.yml):

| Setting | Value | Why |
| --- | --- | --- |
| `pm.max_children` | 24 | `IOT_STREAMS_MAX_OPEN` (10) streams plus 14 workers for requests |
| `pm.start_servers`, `pm.min_spare_servers`, `pm.max_spare_servers` | 4, 2, 8 | Idle workers are cheap; streams are started on demand |
| `request_terminate_timeout` | 0 | A stream ends on its lifetime, its re-check or a shutdown, not on a timer |
| api `mem_limit` | 768 MiB | 24 workers at about 25 MiB each, plus opcache and the master |
| `max_input_vars` | 2500 | A stream may name 1000 devices as `devices[]` |
| nginx `fastcgi_read_timeout` | 150 s | Above the 60 s keepalive, so a quiet stream is not cut |
| nginx `large_client_header_buffers` | 4 × 64 KiB | 1000 UUIDs in one query string |

To allow more open streams, raise `IOT_STREAMS_MAX_OPEN` and `pm.max_children`
together (keep at least 14 workers for requests) and add about 25 MiB of `mem_limit`
per worker; the per-application (`IOT_STREAMS_PER_APPLICATION`, 2) and
per-organization (`IOT_STREAMS_PER_ORGANIZATION`, 10) limits are environment variables
too. Record the api container's memory at the cap after the change, as spec 030's
quickstart run 6 does.

`iot_integration_streams_open{organization="<slug>"}` on `/internal/ops/metrics` is
the number of open streams per organization (a session row not closed and touched
within 90 s), `iot_integration_streams_open_total` their sum and
`iot_integration_streams_limit` the deployment cap: when the total approaches the
limit, new streams are refused with 429 and the pool is nearly full of streams. The
admin app lists each organization's open streams (application, opened, last seen,
devices, last position) under **Telemetry streams** in the organization's menu; the
runtime's `GET /internal/status` adds `streams.open` and `streams.dropped` (subscribers
closed for falling behind, which resume by catch-up).

**Runtime lock.** `GET /internal/status` reports `leadership`: `role`, the `epoch`
(how many times the lock has changed hands), the holding `instance` and `since`. The
same record is the `all` row of `device_runtime.runtime_leaders`. A runtime that
loses its lock session logs `runtime lock lost` and exits with status 1; Docker
starts it again and devices announce again. A runtime started with
`IOT_RUNTIME_STANDBY=true` waits for the lock instead of exiting, answers
`/health/live`, and answers 503 with `"role":"standby"` on `/health/ready` and
`/internal/*`. The release profile runs one runtime and no standby.

## Production

Use a separate host, database, domain, secrets and Restic repository with the same
release artifacts. Set `DEPLOY_ENVIRONMENT=production`, disable demo data and omit
the `demo` profile. Define customer recovery targets and test real hardware before
launch.
