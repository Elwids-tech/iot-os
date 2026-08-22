# Data Ingestion and Adapters

**Status:** Accepted direction; detailed contracts remain Draft  
**Last updated:** 2026-08-22

## Principle

Transport, payload decoding, canonical mapping, and device-profile semantics are separate responsibilities.

```text
Transport → Decode/encode → Canonical mapping → Profile validation → Runtime processing
```

The platform accepts JSON directly when possible and uses adapters when the source requires polling, protocol clients, binary decoding, or proprietary transformations.

## Phase 1 Support Matrix

| Source | Phase 1 path |
| --- | --- |
| MQTT/MQTTS canonical JSON | Native through EMQX and Go |
| MQTT/MQTTS mapped JSON | Native through EMQX and Go |
| HTTP/HTTPS canonical or mapped JSON | Native Go ingress |
| Sparkplug B over MQTT/MQTTS | Native Go Sparkplug service |
| OPC UA | Node-RED adapter initially |
| CoAP | Node-RED adapter initially |
| External HTTP API polling | Node-RED Request-style adapter |
| Proprietary binary over supported transport | Node-RED decoder initially |
| Unsupported protocol | Managed custom adapter engagement |

## JSON Paths

### Canonical JSON

Devices and gateways that publish the platform envelope take the shortest path to profile validation.

### Mapped JSON

Simple vendor JSON can use configuration-driven paths, types, scaling, units, and default values. Complex code should move to an adapter rather than growing an unrestricted mapping language inside ingestion.

Connection identity determines organization, site, and device scope. Tenant identity from the payload is never trusted.

## Adapter Model

An adapter instance consists of:

- Transport configuration
- Push, pull, subscription, or bidirectional mode
- Secret references
- Uplink decoder
- Canonical mapper
- Optional downlink encoder
- Retry, timeout, rate, and schedule policy
- Test fixtures and expected outputs
- Immutable adapter version
- Runtime health and deployment status

### Uplink

```text
Device/API → Node-RED → Decode → Map → Canonical event → JetStream → Go ingestion
```

### Downlink

```text
Laravel-authorized command → JetStream → Go command service
→ Node-RED encoder/transport → Device → Canonical acknowledgement
```

Node-RED never writes directly to PostgreSQL or TimescaleDB.

## Node-RED Phase 1 Runtime

Node-RED is an implementation detail behind the platform-owned adapter contract. It provides a fast way to deliver OPC UA clients, CoAP integrations, API polling, vendor decoders, and bespoke workflows while the native Integration Studio is deferred.

Required isolation:

- Dedicated runtime per on-premise installation
- Per-tenant or per-trust-boundary isolation in hosted environments
- CPU and memory limits
- Restricted network egress
- No Docker socket
- No database credentials
- Approved and version-pinned node palette
- Runtime-injected secrets
- Versioned flow exports outside the Node-RED data volume
- Structured logs, metrics, and health checks
- Editor access limited to authorized integration developers

The customer-facing React experience manages adapters, samples, mappings, tests, versions, deployment status, logs, and health. Direct Node-RED access is an advanced internal or integrator capability.

## Sparkplug B

Sparkplug B is a first-class MQTT interoperability protocol. The Go Sparkplug service owns:

- Topic parsing
- Protobuf decoding
- NBIRTH/DBIRTH and NDEATH/DDEATH state
- Metric aliases
- Sequence and session validation
- Rebirth handling
- NDATA/DDATA conversion
- NCMD/DCMD encoding

Laravel owns gateway registration, namespace mapping, discovered-device approval, metric-to-signal bindings, profile activation, command permissions, and audit.

Sparkplug hierarchy does not become the operational domain model. A configurable mapping relates group, edge node, device, and metric identifiers to platform sites, gateways, devices, and signals.

Birth messages create discovery candidates unless an explicit onboarding policy allows automatic creation.

## Managed Device Onboarding

Proprietary onboarding is initially a platform service:

1. Collect protocol details, documentation, samples, and expected signals.
2. Configure or build the Node-RED adapter.
3. Use AI to draft decoders, mappings, and fixtures where helpful.
4. Test recorded payloads in isolation.
5. Create draft device profiles and signal bindings in Laravel.
6. Activate immutable adapter and profile versions.
7. Monitor acceptance, rejection, latency, and health.
8. Preserve artifacts and rollback capability.

## Future Native Integration Studio

The later React Integration Studio may provide a visual pipeline, Monaco editor, TypeScript SDK, disposable test sandboxes, and versioned plugin containers or WebAssembly execution.

This future work must implement the same adapter manifest, canonical event, fixtures, deployment status, and health contracts so that Node-RED can be replaced or retained without changing the rest of the platform.

## External References

- [Eclipse Sparkplug](https://sparkplug.eclipse.org/)
- [ThingsBoard IoT Gateway connectors](https://thingsboard.io/docs/iot-gateway/connectors/)
- [ThingsBoard custom connectors and converters](https://thingsboard.io/docs/iot-gateway/custom/)
- [ThingsBoard Sparkplug API](https://thingsboard.io/docs/reference/sparkplug-api/)

