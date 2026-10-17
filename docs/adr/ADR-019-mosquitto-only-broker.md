# ADR-019: Mosquitto Is the Only MQTT Broker

**Status:** Accepted
**Date:** 2026-10-17
**Supersedes:** [ADR-009](ADR-009-mosquitto-default-broker.md)
**Amends:** [ADR-005](ADR-005-sparkplug-b-boundary.md) (which names EMQX as the MQTT transport)

## Context

ADR-009 made Mosquitto the default broker but kept EMQX for existing environments
and for local development. That left two brokers to maintain and test:

- Laravel's `BrokerProvisioner` had two code paths: broker-admin for Mosquitto,
  the EMQX v5 REST API for EMQX.
- The release carried an EMQX profile, a Mosquitto overlay and a provider switch,
  `DEVICE_BROKER_PROVIDER`.
- Development ran EMQX while every release ran Mosquitto, so the dev stack never
  exercised Dynamic Security, broker-admin or the ACLs devices meet in production.
- EMQX 5.9.3 is distributed under the BSL, which needs a rights review before any
  external offering ([licensing](../ops/broker.md#licensing)).

The only release environment, the pilot, was migrated to Mosquitto before this
decision. No environment needs the EMQX profile.

## Decision

Mosquitto 2.x with the Dynamic Security plugin is the only MQTT broker, in releases,
local development and the device test harness. broker-admin is its only
administrative client, and Laravel provisions credentials and ACLs only through it.

- The release has one broker, defined in `deploy/release/compose.yml`. There is no
  provider setting. The release refuses an environment that still sets
  `DEVICE_BROKER_PROVIDER=emqx`, or has EMQX state but no Mosquitto state, because
  deploying over it would start an empty broker and drop every device.
- An EMQX environment must first be migrated with `migrate_mosquitto.py` from a
  release before this ADR. This ADR removes that script.
- Development runs the same Mosquitto image and configuration as a release, with
  the local CA's certificate (`deploy/compose/compose.devices.yml`).
- ADR-005's Sparkplug B boundary is unchanged. Where it says "EMQX owns MQTT
  transport and authentication", read "Mosquitto owns MQTT transport and
  authentication; Laravel decides credentials and ACLs through broker-admin".

## Consequences

- One provisioning path, one release profile and one set of broker settings, and
  development now matches production.
- The EMQX dashboard is gone from development. Diagnose with broker-admin readiness,
  the Mosquitto logs and Laravel's provisioning status ([broker](../ops/broker.md)).
- Moving a development stack to Mosquitto starts with an empty broker.
  `./taskw devices:up` re-provisions every connection and gateway from Laravel with
  `devices:reprovision-broker`, so device passwords are not rotated.
- Backups taken while an environment ran EMQX can no longer be restored with this
  release; restore them with the release that took them.
- Clustering or high availability would need a new decision: Mosquitto runs as a
  single node.
