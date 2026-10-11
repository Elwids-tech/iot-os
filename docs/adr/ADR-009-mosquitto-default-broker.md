# ADR-009: Mosquitto Is the Default MQTT Broker

**Status:** Accepted
**Date:** 2026-10-11
**Amends:** [ADR-005](ADR-005-sparkplug-b-boundary.md) (which names EMQX as the MQTT transport)

## Context

ADR-005 made EMQX the device-facing broker. During pilot delivery the release
gained a second broker profile, and the pilot environment was migrated to it:

- EMQX 5.9.3 is distributed under the BSL, whose use-case restrictions on hosted
  or embedded offerings need a rights review before external use
  ([release licensing note](../ops/broker.md#licensing)). Mosquitto is EPL/EDL
  with no single-node commercial licence requirement.
- The release supports both brokers, selected by `DEVICE_BROKER_PROVIDER`
  (`emqx` or `mosquitto`) in [`tooling/release/manage.py`](../../tooling/release/manage.py).
  Selecting Mosquitto adds [`compose.mosquitto.yml`](../../deploy/release/compose.mosquitto.yml):
  Mosquitto 2.0.22 (digest-pinned) with the Dynamic Security plugin
  ([`mosquitto.conf`](../../deploy/release/mosquitto.conf)) and a private
  `broker-admin` service.
- `broker-admin` ([`services/runtime/cmd/broker-admin`](../../services/runtime/cmd/broker-admin),
  [`internal/brokeradmin`](../../services/runtime/internal/brokeradmin)) is built
  into the runtime image. Laravel's
  [`BrokerProvisioner`](../../apps/api/app/Domain/Devices/Services/BrokerProvisioner.php)
  sends it credentials and Sparkplug ACLs over bearer-authenticated HTTP; it
  applies them through `$CONTROL/dynamic-security/v1` with default-deny roles.
- [`tooling/release/migrate_mosquitto.py`](../../tooling/release/migrate_mosquitto.py)
  migrates an EMQX environment with an encrypted checkpoint and automatic
  rollback.
- Per-tenant adapter ingress brokers are Mosquitto ([ADR-010](ADR-010-per-tenant-adapter-runtimes.md)),
  and release adapters refuse to run without the Mosquitto profile
  (`manage.py`: "Release adapters require the Mosquitto broker overlay").

## Decision

Mosquitto 2.x with the Dynamic Security plugin, administered only through
`broker-admin`, is the default MQTT broker for new deployments.

- EMQX remains supported for existing environments until each is explicitly
  migrated with `migrate_mosquitto.py`.
- The local development stack still runs EMQX
  ([`compose.dev.yml`](../../deploy/compose/compose.dev.yml), `IOT_EMQX_IMAGE`
  in `.env.example`). Moving development to Mosquitto for parity is follow-up
  work ([roadmap](../roadmap.md#next)).
- ADR-005's Sparkplug B boundary is unchanged. Only the broker product changes:
  where ADR-005 says "EMQX owns MQTT transport and authentication", read "the
  configured broker (Mosquitto by default)".

## Consequences

- The code defaults have not caught up with this decision:
  `DEVICE_BROKER_PROVIDER` still defaults to `emqx` in
  [`config/devices.php`](../../apps/api/config/devices.php),
  [`environment.example`](../../deploy/release/environment.example),
  `manage.py` and [`deploy/release/compose.yml`](../../deploy/release/compose.yml),
  while the release adapter worker defaults to `mosquitto`
  ([`deploy/release/compose.adapters.yml`](../../deploy/release/compose.adapters.yml)).
  Flipping the defaults is follow-up work.
- Development exercises EMQX ACLs and provisioning while production runs
  Mosquitto. Until dev moves, Mosquitto behaviour is covered by
  `tooling/release/verify_mosquitto.py` in the release workflow, not by everyday
  development.
- A single Mosquitto broker is not highly available. There is no broker
  dashboard; diagnose through `broker-admin` readiness and Laravel provisioning
  status ([broker operations](../ops/broker.md)).
- Mosquitto limits (128 MiB memory, 1 MiB messages, 1000 queued messages per
  client, 30 s autosave) must be checked against real traffic. A broker crash can
  lose the latest retained/session state; Postgres and JetStream stay the durable
  record.
