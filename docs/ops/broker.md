# MQTT broker

Mosquitto 2.x with the Dynamic Security plugin is the default broker
([ADR-009](../adr/ADR-009-mosquitto-default-broker.md)). EMQX is still supported
for existing environments and is what the local development stack runs. A single
broker is not highly available.

The release selects the broker with `DEVICE_BROKER_PROVIDER` (`mosquitto` or
`emqx`). The shipped defaults (`environment.example`, `manage.py`,
`apps/api/config/devices.php`) still say `emqx`; set `mosquitto` explicitly for new
environments.

## Mosquitto in a release

[`compose.mosquitto.yml`](../../deploy/release/compose.mosquitto.yml) adds:

- **`mqtt`**: Mosquitto 2.0.22 (digest-pinned), TLS 1.2 on 8883 only
  ([`mosquitto.conf`](../../deploy/release/mosquitto.conf)), anonymous access off,
  certificates from the `mqtt.<DOMAIN>` ACME job (files owned by UID 1883; renewal
  restarts the broker). Plain MQTT and management ports are not published.
- **`broker-admin`**: a private service built into the runtime image
  ([`cmd/broker-admin`](../../services/runtime/cmd/broker-admin),
  [`internal/brokeradmin`](../../services/runtime/internal/brokeradmin)), listening on
  `broker-admin:8082` with `GET /health/ready` and `PUT /clients`. Laravel's
  [`BrokerProvisioner`](../../apps/api/app/Domain/Devices/Services/BrokerProvisioner.php)
  sends it credentials and Sparkplug ACLs with `DEVICE_BROKER_ADMIN_TOKEN`; it
  validates the broker's TLS certificate and applies them over
  `$CONTROL/dynamic-security/v1`, which device clients cannot reach.

Each host and gateway gets its own role. Defaults deny publish, receive and
subscribe. Subscription ACLs match the authorized filter literally and delivery ACLs
match concrete topics, so subscriptions such as `#` or `spBv1.0/#` are rejected. An
update disables the identity, replaces its role and password, and re-enables it
last; a failure in between leaves it disabled, and a retry is idempotent.
Reprovisioning disconnects affected clients; the runtime reconnects.
`php artisan devices:reprovision-broker` reapplies every credential (deploy runs it
after `broker-admin` is ready).

Limits: 128 MiB memory, 1 MiB messages, 1000 queued messages per client, 20 in-flight.
Retained and session state autosaves every 30 seconds and on clean shutdown, so a
crash can lose the latest broker state; Postgres and JetStream remain the durable
record. QoS 1 permits duplicates.

There is no broker dashboard. Diagnose with `broker-admin` readiness and Laravel's
provisioning status. Revoke a client with the plugin's `disableClient`; never give
tenants a control client, management token or the plugin's state file.

## Migrating an EMQX environment

Deploy only an immutable manifest built from a tested commit, and keep the old
source, environment, manifest and EMQX state.

```sh
python3 tooling/release/migrate_mosquitto.py \
  --env /srv/<env>/private/application.env \
  --manifest /srv/<env>/private/release.json \
  --backup-env /srv/<env>/private/backup.env
```

[`migrate_mosquitto.py`](../../tooling/release/migrate_mosquitto.py) pre-pulls
images, validates configuration, takes an encrypted off-host checkpoint with EMQX,
saves rollback inputs privately, quiesces writers, initializes Dynamic Security
storage once, switches providers, reapplies existing credentials without rotating
device passwords, runs readiness checks and takes the first Mosquitto checkpoint. It
restores EMQX automatically if deployment fails. It refuses retained application
messages (export and import them first); EMQX `$SYS` messages are not carried over.
After an interruption, inspect `BROKER_MIGRATION_INCOMPLETE` and the private
migration directory; never overwrite existing plugin storage to retry.

Manual rollback: stop ingress, writers, `mqtt` and `broker-admin`; restore the
migration directory's environment as `application.env` (mode 0600); clear a
deployment marker only after inspecting its failed phase; deploy its exact
`release.json` with the EMQX profile. Keep the new Mosquitto state. A broker
rollback does not need a database restore. Never roll back across incompatible
schema changes.

## Backups and monitoring

Backups stop the broker and `broker-admin` before checkpointing and include
Mosquitto's data directory, certificates and administration secrets
([release](release.md#backups-and-restore)). A restore needs the same provider,
release, application key and broker secrets.

The container inventory expects `mqtt` and `broker-admin` instead of `emqx`;
Prometheus probes `broker-admin` readiness and MQTT TLS, and the pilot watchdog
probes the public MQTT endpoint independently ([monitoring](monitoring.md)).

## EMQX

Development runs EMQX 5.9.3 ([`compose.dev.yml`](../../deploy/compose/compose.dev.yml));
the Devices overlay enables TLS on 8883 with password authentication, disables
plaintext and WebSocket listeners, and keeps its dashboard on 127.0.0.1:18083.
Laravel provisions it through its v5 REST API (`DEVICE_EMQX_API_URL`,
`DEVICE_EMQX_API_KEY`, `DEVICE_EMQX_API_SECRET`) with built-in database
authentication and per-user ACLs ending in deny-all. The release keeps an EMQX
profile ([`emqx.conf`](../../deploy/release/emqx.conf)) for environments not yet
migrated.

## Licensing

Mosquitto is EPL/EDL with no single-node commercial licence requirement
([Mosquitto](https://mosquitto.org/),
[Dynamic Security](https://mosquitto.org/documentation/dynamic-security/)). EMQX
5.9.3 is distributed under the BSL, whose terms restrict some hosted and embedded
uses; review the deployment rights before using the EMQX profile for an external
offering.

## Verification

```sh
docker build -f deploy/docker/runtime/Dockerfile -t elwids-mosquitto-runtime:check .
python3 tooling/release/verify_mosquitto.py
python3 tooling/release/verify_local.py --broker mosquitto
```

`verify_mosquitto.py` (also run by the release workflow) uses a dedicated internal
network and disposable volume with no host ports, and checks TLS hostname
verification, anonymous and wrong-password denial, tenant and gateway isolation,
rejected broad and control subscriptions, QoS 1, Sparkplug topic directions,
retained STATE and wills, rotation, revocation, abrupt restart and restore into
fresh storage. `verify_local.py` rehearses the full release with simulators.
