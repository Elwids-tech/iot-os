# MQTT broker

Mosquitto 2.x with the Dynamic Security plugin is the only broker, in releases,
local development and the device test harness
([ADR-019](../adr/ADR-019-mosquitto-only-broker.md)). A single broker is not highly
available.

## Mosquitto in a release

[`compose.yml`](../../deploy/release/compose.yml) runs:

- **`mqtt`**: Mosquitto 2.0.22 (digest-pinned), TLS 1.2 on 8883 only
  ([`mosquitto.conf`](../../deploy/release/mosquitto.conf)), anonymous access off,
  certificates from the `mqtt.<DOMAIN>` ACME job (files owned by UID 1883; renewal
  restarts the broker). Plain MQTT and management ports are not published.
- **`broker-admin`**: a private service built into the runtime image
  ([`cmd/broker-admin`](../../services/runtime/cmd/broker-admin),
  [`internal/brokeradmin`](../../services/runtime/internal/brokeradmin)), listening on
  `broker-admin:8082` with `GET /health/ready` and `PUT /clients`
  (`broker-admin health` is its container healthcheck). Laravel's
  [`BrokerProvisioner`](../../apps/api/app/Domain/Devices/Services/BrokerProvisioner.php)
  sends it credentials and Sparkplug ACLs with `DEVICE_BROKER_ADMIN_TOKEN`; it
  validates the broker's TLS certificate and applies them over
  `$CONTROL/dynamic-security/v1`, which device clients cannot reach.

`manage.py` creates the Dynamic Security file once (`mosquitto_ctrl dynsec init`
with `MOSQUITTO_ADMIN_PASSWORD`) and never resets it. `broker-admin` sets the
deny-by-default ACLs each time it connects.

Each host and gateway gets its own role. Defaults deny publish, receive and
subscribe. Subscription ACLs match the authorized filter literally and delivery ACLs
match concrete topics, so subscriptions such as `#` or `spBv1.0/#` are rejected. An
update disables the identity, replaces its role and password, and re-enables it
last; a failure in between leaves it disabled, and a retry is idempotent.
Reprovisioning disconnects affected clients; the runtime reconnects.
`php artisan devices:reprovision-broker` reapplies every credential (deploy runs it
after `broker-admin` is ready). broker-admin accepts only usernames that start with
`host-`, `edge-`, `sim-host-`, `sim-edge-`, `sim-gps-edge-` or `sim-rgb-edge-`, which
is what Laravel generates. The command carries on past an identity the broker
rejects, lists it and exits non-zero; such an identity, for example an old
development gateway named `gateway-…`, needs new credentials.

Limits: 128 MiB memory, 1 MiB messages, 1000 queued messages per client, 20 in-flight.
Retained and session state autosaves every 30 seconds and on clean shutdown, so a
crash can lose the latest broker state; Postgres and JetStream remain the durable
record. QoS 1 permits duplicates.

There is no broker dashboard. Diagnose with `broker-admin` readiness, the `mqtt`
logs and Laravel's provisioning status. Revoke a client with the plugin's
`disableClient`; never give tenants a control client, management token or the
plugin's state file.

## Development

The Devices overlay ([`compose.devices.yml`](../../deploy/compose/compose.devices.yml))
runs the same image and settings
([`mosquitto.devices.conf`](../../deploy/compose/mosquitto.devices.conf)) with the
local CA's certificate for `mqtt` and `localhost`. A one-off `mqtt-init` container
creates the Dynamic Security file in the `mosquitto-data` volume, `mqtt` publishes
8883, and `broker-admin` is built from the runtime Dockerfile. `./taskw devices:setup`
generates `DEVICE_BROKER_ADMIN_TOKEN` and `MOSQUITTO_ADMIN_PASSWORD` in
`.local/devices/devices.env`, and `./taskw devices:up` re-provisions every connection
and gateway, so a new or reset volume recovers without rotating device passwords.

The isolated harness (`./taskw devices:test`,
[`compose.devices-test.yml`](../../deploy/compose/compose.devices-test.yml)) runs
Mosquitto in Docker and `broker-admin` natively, next to the native runtime.

## Environments still on EMQX

The release refuses an environment that sets `DEVICE_BROKER_PROVIDER=emqx`, or has
an `emqx` state directory but no Mosquitto Dynamic Security file. Deploying over it
would start an empty broker and every device would lose its credentials. Migrate it
first with [`migrate_mosquitto.py`](https://github.com/Elwids-tech/iot-os/blob/4a59f5de03b3273f84eebf7200bac3b7f0dfae07/tooling/release/migrate_mosquitto.py) from a release before ADR-019,
then deploy this one. `DEVICE_BROKER_PROVIDER=mosquitto` left in an environment is
harmless. A backup taken while an environment ran EMQX can only be restored with
the release that took it.

## Backups and monitoring

Backups stop the broker and `broker-admin` before checkpointing and include
Mosquitto's data directory, certificates and administration secrets
([release](release.md#backups-and-restore)). A restore needs the same release,
application key and broker secrets.

The container inventory expects `mqtt` and `broker-admin`; Prometheus probes
`broker-admin` readiness and MQTT TLS, and the pilot watchdog probes the public MQTT
endpoint independently ([monitoring](monitoring.md)).

## Licensing

Mosquitto is EPL/EDL with no single-node commercial licence requirement
([Mosquitto](https://mosquitto.org/),
[Dynamic Security](https://mosquitto.org/documentation/dynamic-security/)). EMQX
5.9.3, which the platform used before, is distributed under the BSL; that licence
review is one reason it was removed.

## Verification

```sh
docker build -f deploy/docker/runtime/Dockerfile -t elwids-mosquitto-runtime:check .
python3 tooling/release/verify_mosquitto.py
python3 tooling/release/verify_local.py
```

`verify_mosquitto.py` (also run by the release workflow) uses a dedicated internal
network and disposable volume with no host ports, and checks TLS hostname
verification, anonymous and wrong-password denial, tenant and gateway isolation,
rejected broad and control subscriptions, QoS 1, Sparkplug topic directions,
retained STATE and wills, rotation, revocation, abrupt restart and restore into
fresh storage. `verify_local.py` rehearses the full release with simulators.
