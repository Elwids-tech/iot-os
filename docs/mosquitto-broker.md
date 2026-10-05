# Mosquitto broker operations

The release supports Mosquitto 2.0.22 (pinned image digest) with its Dynamic
Security plugin. Existing environments remain on EMQX until explicitly migrated.
Mosquitto is licensed under EPL/EDL, with no single-node commercial license
requirement for this deployment. It is a single broker; this does not provide HA.

## Architecture and access

Only MQTT over TLS on port 8883 is published. Plain MQTT and broker management
ports are not published. Certificates use the existing `mqtt.<DOMAIN>` ACME
renewal job. Certificate files are owned by the selected broker UID (1883 for
Mosquitto, 1000 for EMQX); renewal restarts the selected broker.

Laravel sends existing credentials and generated Sparkplug permissions to a
private bearer-authenticated `broker-admin:8082` service. Its binary is packaged
inside the existing runtime image, so the six-image release manifest remains
compatible. The adapter validates the broker TLS certificate and administers
the plugin over `$CONTROL/dynamic-security/v1`. Device clients cannot subscribe
or publish to this control namespace.

Each managed host/gateway receives its own role. Defaults deny publishing,
receiving and subscribing; unsubscribing is allowed. Subscription ACLs match
the authorized filter literally, while delivery ACLs match concrete topics.
This rejects subscriptions such as `#` and `spBv1.0/#`. An update disables the
identity first, replaces its role and password, then enables it last. An update
that fails after disabling leaves the identity disabled. A retry is idempotent.
Reprovisioning disconnects affected clients; the runtime reconnects automatically.

## Verification

Rebuild the runtime and API before running the disposable checks:

```sh
rtk proxy docker build -f deploy/docker/runtime/Dockerfile -t elwids-mosquitto-runtime:check .
rtk proxy docker build -f deploy/docker/api/Dockerfile.release --target api -t iot-release-api:check .
rtk proxy python3 tooling/release/verify_mosquitto.py
rtk proxy python3 tooling/release/verify_local.py --broker mosquitto
```

The release rehearsal also requires the existing API-web, simulator, portal and
admin check images documented in `deploy/release/VERIFICATION.md`.
The MQTT fixture uses a dedicated internal network and disposable volume with no
host ports. It verifies TLS hostname checking, anonymous/wrong-password denial,
tenant and gateway isolation, rejected broad/control subscriptions, QoS1,
Sparkplug topic directions, retained STATE/LWT, rotation, revocation, abrupt
restart and restore into fresh broker storage. The full release rehearsal
checks actual simulator birth/data/commands, runtime acknowledgements, repeated
bootstrap, metrics and independent database restore/quarantine.

These are local acceptance checks. They do not establish client-device
acceptance, a long soak, or a complete replacement-host recovery drill.

## Migration

Deploy only an immutable manifest built from the tested commit. Keep the old
source archive, environment, manifest and EMQX state. The migration tool refuses
retained application messages; handle those with a reviewed export/import first.
EMQX `$SYS` retained status messages are broker-specific and are not replayed.

```sh
rtk proxy python3 tooling/release/migrate_mosquitto.py \
  --env /srv/elwids/private/application.env \
  --manifest /srv/elwids/private/release.json \
  --backup-env /srv/elwids/private/backup.env
```

The tool pre-pulls images, validates configuration, takes an encrypted off-host
checkpoint with the old provider, saves rollback inputs privately, and quiesces
writers. It initializes new Dynamic Security storage once, switches providers,
reapplies existing credentials without rotating device passwords, runs readiness
checks and takes the first Mosquitto checkpoint. It automatically restores the
old broker and application release if deployment fails. Inspect
`BROKER_MIGRATION_INCOMPLETE` and the private migration directory after an
interrupted process. Do not overwrite existing plugin storage to retry.

Manual rollback: stop ingress, writers, `mqtt` and `broker-admin`; restore the
migration directory's environment to `application.env` with mode 0600; clear a
deployment marker only after inspecting its failed phase; deploy its exact
`release.json` with the supported EMQX profile. Retain new Mosquitto state. A
broker rollback does not require restoring/overwriting the client database.
Do not perform an application rollback across incompatible schema changes.

## Backups, monitoring and limits

The selected broker and adapter stop before checkpointing. Mosquitto's durable
directory, certificates, application state, JetStream files and logical database
dump are included in the encrypted Restic checkpoint. Restore requires the exact
provider, release, application encryption key and broker administration secrets.
Ownership is restored for the selected broker; side effects remain quarantined.
Daily checkpoint RPO is approximately 24 hours; WAL/PITR is still not configured.

Broker memory is bounded at 128 MiB, with a 1 MiB maximum MQTT message and 1000
queued messages per client. Monitor these limits against actual traffic before
raising them. MQTT retained/session persistence is saved every 30 seconds and on
clean shutdown. A crash can lose the most recent broker state; PostgreSQL and
JetStream remain the durable application record. MQTT QoS1 permits duplicates.

The container inventory monitors `mqtt` and `broker-admin` in place of EMQX;
Prometheus additionally probes adapter readiness and MQTT TLS. Existing alerts,
Loki log collection, email delivery and the independent database-host watchdog
remain in use. The watchdog probes the public MQTT TLS endpoint, independently
of the application host. A provider-independent external monitor is still pending.

Use the private adapter readiness probe and Laravel provisioning status for
diagnosis. There is no EMQX-style broker dashboard. Operator credential revocation
uses the plugin's `disableClient` command; do not expose an unrestricted control
client, management token or plugin state file to tenants.
