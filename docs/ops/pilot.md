# Pilot environment

The pilot ("Elwids") is the [release profile](release.md) on two Hetzner servers. It
holds real customer data: it is recoverable but **not highly available**, and it is
not disposable.

Host addresses, SSH key names, credentials and acceptance evidence are kept in the
private operations inventory and on the hosts under `/srv/elwids/private`, never in
this repository. Commands below use `<app-host>` and `<db-host>` placeholders.

## Layout

| Role | Runs |
| --- | --- |
| Application host | Caddy, API, admin, portal, workers, runtime, NATS, MQTT broker, monitoring |
| Database host | PostgreSQL 17 / TimescaleDB 2.29, database metrics, the independent watchdog |

Both are Hetzner CX33 (4 vCPU, 8 GB RAM, 80 GB) on Ubuntu with Docker. They talk
over WireGuard (`wg-elwids`, /32 peer addresses); Docker depends on
`wg-quick@wg-elwids.service` so private binding survives reboots. The external
database overlay is selected because `DATABASE_HOST` is a private address.

Firewalling uses UFW plus the `ELWIDS-INGRESS` Docker forwarding chain
([`tooling/release/pilot/install_docker_firewall.py`](../../tooling/release/pilot/install_docker_firewall.py)).
The application host accepts public 80, 443 and 8883 (plus the adapter broker port
range); the database host accepts no public Docker ingress. WireGuard UDP is limited
to the peer. SSH is key-only but publicly reachable; it is not VPN-only.

Paths on the application host: source `/srv/elwids/source`, state
`/srv/elwids/state`, private configuration `/srv/elwids/private` (`application.env`,
`backup.env`, `current-release.json`, `release-origin.json`,
`previous-release.json`, `restore-test-result.json`). The database host keeps its
own Compose and env files and `watchdog.json`. Never regenerate `APP_KEY` or
service secrets, commit these files, or print expanded Compose configuration.

## Domains

`elwids.xyz` is dedicated to this environment. DNS is at GoDaddy with IPv4 A
records only.

- `https://app.elwids.xyz`, `https://admin.elwids.xyz`, `https://api.elwids.xyz`
- MQTT over TLS: `mqtt.elwids.xyz:8883`
- Vendor adapter brokers: `mqtt.elwids.xyz`, one TLS port per organization
- `ops.elwids.xyz` returns 403 outside the VPN

The earlier `*.staging.elwids.xyz` names remain as `LEGACY_DOMAIN`: app, admin, api
and ops redirect (308) to the new hosts, and the broker certificate covers both
`mqtt.elwids.xyz` and `mqtt.staging.elwids.xyz`, so devices configured with the old
name still connect. To retire it: move those devices to `mqtt.elwids.xyz`, remove
`LEGACY_DOMAIN`, redeploy, rerun `manage.py certificates` and delete the `*.staging`
DNS records. Note that the Waveshare USB bridge's `--allow-staging` option only
accepts the legacy hostname ([hardware](../hardware/waveshare-audio-board.md#pilot-broker)).

## Broker

The pilot runs Mosquitto 2.0.22 with Dynamic Security and `broker-admin`
([broker](broker.md)). The previous EMQX environment, images and durable broker
files are retained for rollback.

## Monitoring and watchdog

Prometheus evaluates service, resource, worker and container rules; Loki evaluates
error-log and missing-canary rules; Alertmanager sends email through Brevo; Grafana
displays results. Critical incidents repeat every 30 minutes, warnings every four
hours, both with recovery mail ([monitoring](monitoring.md)).

Brevo has the domain authenticated with `alerts@elwids.xyz` and
`no-reply@elwids.xyz` verified, and SMTP source-IP authorization for exactly the two
servers.

The **database-host watchdog**
([`tooling/release/pilot/watchdog.py`](../../tooling/release/pilot/watchdog.py))
checks application HTTPS, API and database readiness and MQTT TLS every minute,
independently of the application host. Three consecutive failures send mail,
continued outages repeat hourly, and a healthy sample sends recovery. It reads the
operator's email preferences from the API every minute, caches them (no email when
there is no cache), persists events locally and replays them to the API after
recovery. `WATCHDOG_PRIVATE_IP` and `notifications_private_host` route those calls
over WireGuard; TLS still verifies the API hostname.
`reconcile_notifications.py` runs every minute on the application host to close
service events orphaned by a monitoring restart.

Grafana is reached through an SSH tunnel to container addresses, which change after
redeploys and reboots:

```sh
ssh <app-host> 'docker inspect elwids-pilot-grafana-1 elwids-pilot-container-metrics-1 --format "{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"'
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3300:<grafana-ip>:3000 -L 127.0.0.1:9901:<collector-ip>:9101 <app-host>
```

Then open `http://localhost:3300/d/iot-platform/platform-operations` and
`http://localhost:9901/runbook`. Anonymous Grafana access is disabled. Links that use
the `ops` hostname need VPN routing.

Timers ([`install_operation_timers.py`](../../tooling/release/pilot/install_operation_timers.py),
[`install_watchdog_timer.py`](../../tooling/release/pilot/install_watchdog_timer.py)):

| Timer | Schedule |
| --- | --- |
| `elwids-metrics.timer` | Every minute |
| `elwids-backup.timer` | 08:00 UTC plus up to five minutes jitter |
| `elwids-certificates.timer` | 09:00 and 21:00 UTC plus jitter |
| `elwids-watchdog.timer` (database host) | Every minute |
| `elwids-firewall.service` | Reapplies Docker ingress rules when Docker starts |

Planned deploys and backups can fire alerts; use short, explicit silences rather
than disabling rules.

## Deploying a release

Deployment uses only repository-scoped credentials; no personal GitHub token is
installed on either server.

1. Run the release workflow on the reviewed revision; all checks must pass.
2. Dispatch it again with `export_existing_run` set to that run and download
   `single-node-image-transfer` before it expires (three days).
3. Verify the archive's SHA-256 locally and on the host, using a new private
   directory, then import it with
   [`import_release_images.py`](../../tooling/release/pilot/import_release_images.py)
   into the local registry `elwids-registry.local` (isolated network, no published
   ports). Keep each archive as an independent backup.
4. Export committed source with only reviewed tooling changes; never deploy a dirty
   checkout. Keep environments, state, certificates and keys.
5. Deploy with the pinned manifest and a working off-site backup:

   ```sh
   ssh <app-host> 'cd /srv/elwids/source && python3 tooling/release/manage.py deploy \
     --env /srv/elwids/private/application.env \
     --manifest /srv/elwids/private/release.json \
     --backup-env /srv/elwids/private/backup.env'
   ```

Keep the running application manifest and the tooling commit separate:
documentation or tooling commits do not change running image digests.

## Backups and recovery

Checkpoints go to a Hetzner Storage Box over SFTP (port 23, alias `elwids-backup`,
dedicated key, pinned host key; public access, SMB and WebDAV off), encrypted with
Restic. The Restic password and operator access must stay independent of both
servers.

```sh
ssh <app-host> 'cd /srv/elwids/source && python3 tooling/release/manage.py backup \
  --env /srv/elwids/private/application.env \
  --manifest /srv/elwids/private/current-release.json \
  --backup-env /srv/elwids/private/backup.env'
ssh <app-host> 'python3 /srv/elwids/source/tooling/release/pilot/verify_checkpoint_restore.py'
```

Before installing a release, run the drill from the staged source instead
(`<staged source>/tooling/release/pilot/verify_checkpoint_restore.py`); it uses the
release tooling next to it.

The restore drill restores the latest checkpoint into a disposable internal
TimescaleDB network (no ports, no outbound network), runs
`deployment:quarantine-restore`, verifies tables and migrations, and updates
`iot_restore_verified_timestamp_seconds` only on success. Disaster recovery follows
[release](release.md#backups-and-restore); `manage.py` refuses to restore against a
live external database, so restore with `DATABASE_HOST=timescaledb` first, then
migrate to a new private database and cut over once. Moving the pilot to production
must preserve tenant, device and event identifiers and requires a fenced cutover;
copying the database while the old runtime still commands devices is unsafe.

## Open gaps

- Monitoring outside Hetzner (both hosts share a provider) and the external
  heartbeat and backup-heartbeat monitors are not configured.
- No agreed recovery point objective; daily checkpoints can lose about 24 hours.
- Real client hardware: enrollment, telemetry, command acknowledgement and
  invitations under client roles.
- A measured replacement-host cutover and a 48-hour soak on this environment.
- Full public IPv6 verification.

OAuth/SSO, replication and Kubernetes are not implemented.
