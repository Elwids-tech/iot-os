# ADR-010: Per-Tenant Adapter Runtime Isolation

**Status:** Accepted (recorded retroactively); amended by [ADR-022](ADR-022-webhook-receiver.md)
**Date:** 2026-10-11; decided during pilot delivery, October 2026
**Supersedes:** [ADR-004](ADR-004-node-red-adapter-runtime.md)

## Context

ADR-004 planned one isolated Node-RED instance as the adapter runtime, executing
protocol, decoder and mapper flows and publishing canonical events. Onboarding
real manufacturer MQTT devices showed that a single shared runtime does not hold:

- Vendor devices publish fixed topics, so two tenants with the same device model
  collide on one broker.
- A normal MQTT subscription does not reveal the publisher's authenticated
  username, so a shared broker cannot reliably tell tenants apart.
- Tenant- or AI-written JavaScript must not run in Node-RED Function nodes, which
  can load modules and reach the host.
- The canonical ingestion contract that adapters were meant to publish was never
  built; Go ingests only Sparkplug B ([overview](../architecture/overview.md#what-was-not-built)).

## Decision

Every tenant gets its own adapter runtime pair, created and managed by
**adapter-manager** ([`services/adapters/manager.cjs`](../../services/adapters/manager.cjs)):

- **Ingress broker**: a Mosquitto 2.0.22 container with TLS on one published
  port per tenant (allocated from `IOT_ADAPTER_PORT_BASE` to
  `IOT_ADAPTER_PORT_LIMIT`), Dynamic Security with default-deny ACLs, a
  per-tenant CA, and 128 MiB / 0.5 CPU limits.
- **Node-RED runtime**: an image built from `nodered/node-red:4.1.13-22`
  ([`services/adapters/Dockerfile`](../../services/adapters/Dockerfile), target
  `tenant-runtime`) with no host port, `--cap-drop ALL`, 512 MiB / 1 CPU, the
  editor disabled and external Function modules off
  ([`runtime-settings.cjs`](../../services/adapters/runtime-settings.cjs)). Its
  admin API sits behind a per-tenant bearer token known only to the manager.
- **Decoders** are a synchronous `decode(input, helpers)` function run in QuickJS
  (`quickjs-emscripten`) inside a disposable worker: fresh context per message,
  100 ms execution budget, 16 MiB memory, 500 ms worker deadline, 1 MiB input, no
  host APIs, network, modules or persistent state
  ([`lib/decoder.cjs`](../../services/adapters/lib/decoder.cjs),
  [`lib/decoder-worker.cjs`](../../services/adapters/lib/decoder-worker.cjs)).
- **Output** goes through a platform-owned Managed Sparkplug B publisher node
  ([`nodes/adapter.js`](../../services/adapters/nodes/adapter.js)) to the
  platform broker, as group `adapters-<organization uuid>` and edge node
  `adapter-<adapter uuid>`. From there it follows the normal Sparkplug path
  ([ADR-005](ADR-005-sparkplug-b-boundary.md)).
- **Laravel owns** adapters, immutable revisions, fixtures, credentials,
  deployments and discovery review
  ([`Domain/DeviceAdapters`](../../apps/api/app/Domain/DeviceAdapters)). It calls
  the manager's private HTTP API with `IOT_ADAPTER_MANAGER_TOKEN` from the
  `device-adapters` queue. The portal is the only authoring surface; AI can
  propose revisions but cannot deploy.
- Adapters are opt-in (`IOT_ADAPTERS_ENABLED=false` by default) and, in a release,
  require the Mosquitto broker profile.

## Consequences

- Tenants can keep manufacturer topics and payloads unchanged, and one tenant's
  adapter failure does not affect another tenant or native Sparkplug ingestion.
- Each tenant costs two containers and one public port. Tenant certificates last
  one year; renewal is an operator task.
- **Known risk: Docker socket.** adapter-manager mounts `/var/run/docker.sock`
  read-write ([`deploy/compose/compose.adapters.yml`](../../deploy/compose/compose.adapters.yml),
  [`deploy/release/compose.adapters.yml`](../../deploy/release/compose.adapters.yml)),
  which is root-equivalent on the host. Mitigations today: no host port, a
  64-hex bearer token in release, and container labels that stop it touching
  another Compose project's containers. Follow-up: a restricted socket proxy or a
  rootless runtime.
- **Known risk: shared network.** Tenant containers join the network named by
  `IOT_ADAPTER_DOCKER_NETWORK`, which in development defaults to the platform's
  own `iot-os-dev_internal` network. A tenant Node-RED container can therefore
  reach internal services at the network level. Follow-up: a dedicated adapter
  network that can reach only the platform broker.
- Downlink (vendor command encoding) is not implemented; adapters are uplink only.
- The stock Node-RED service in the development stack
  ([`compose.dev.yml`](../../deploy/compose/compose.dev.yml)) is unrelated to
  adapter execution and is not an isolation boundary.
