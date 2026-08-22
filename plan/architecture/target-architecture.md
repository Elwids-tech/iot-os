# Target Architecture

**Status:** Accepted  
**Last updated:** 2026-08-22

## Executive Summary

The platform is an API-first, AI-first IIoT product that can run on a single VM, an on-premise computer, or later on Kubernetes. It separates human and agent intent from deterministic telemetry execution.

The architecture uses:

- React for all product user interfaces.
- Laravel for public APIs, identity, tenancy, the operational domain model, configuration, audit, workflows, and AI orchestration.
- Go for high-throughput and long-running data-plane execution.
- EMQX for device-facing MQTT/MQTTS and Sparkplug traffic.
- NATS JetStream for internal durable events and commands.
- Node-RED as an isolated initial adapter runtime.
- PostgreSQL/TimescaleDB and Redis as the initial data platform.

## Logical Architecture

```text
React applications
Customer portal · Administration · Integration Studio · Future mobile
                              │
                              │ HTTPS / WebSocket
                              ▼
Laravel control plane
Public API · Auth · Tenancy · Assets · Devices · Profiles · Rules
Gateways · Configuration · Audit · Workflows · Notifications · AI agents
                              │
                              │ Versioned definitions and domain events
                              ▼
NATS JetStream
Durable events · Commands · Status · Replay · Internal integration
                              │
                              ▼
Go data plane
Ingestion · Sparkplug B · Runtime mappings · Stateful rules · Hot state
Command execution · Stream processing · Diagnostics
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
EMQX                                         Node-RED
MQTT/MQTTS · Sparkplug B            OPC UA · CoAP · API polling
                                      Proprietary protocols/codecs
```

## Architecture Planes

### Experience Plane

React applications provide the customer, administrator, integrator, and future mobile experiences. Frontends consume Laravel APIs and authorized realtime channels. They never query databases, NATS, Go services, or device brokers directly.

Recommended monorepo boundaries:

The full cross-language layout, root developer command surface, and shared shadcn ownership rules are defined in [Monorepo and Developer Experience](../roadmap/phase-1/monorepo-and-developer-experience.md).

```text
apps/
  portal/
  admin/

packages/
  ui/
  api-client/
  auth/
  agent-ui/
  integration-studio/
  charts/
```

### Control Plane

Laravel owns the business meaning of the platform:

- Organizations, users, tenancy, roles, and permissions
- Sites, areas, assets, devices, signals, and relationships
- Device profiles, schema versions, mappings, and activation
- Gateways, adapter definitions, and desired configuration
- Rule and automation authoring
- Human command authorization
- Public REST APIs and OpenAPI contracts
- Agent tools, approvals, audit, notifications, and workflows

Laravel publishes immutable activated definitions. It is not consulted for every telemetry message.

### Data Plane

Go owns deterministic execution:

- Device-facing HTTP ingestion where required
- Sparkplug B session processing
- Canonical event validation
- Active profile and mapping execution
- Mutations and derived signals
- Stateful rules and time windows
- Presence and hot state
- Command dispatch, acknowledgements, retries, and timeouts
- Telemetry persistence and diagnostic events

Go caches activated definitions and continues operating during temporary control-plane unavailability.

### Adapter Plane

The adapter plane converts external transports and payloads into the canonical ingestion contract and encodes outbound commands.

Phase 1 uses Node-RED for adapters that require polling, protocol-specific clients, proprietary decoding, or bespoke orchestration. Node-RED does not own platform profiles, authorization, rules, or persistence.

### Messaging Plane

- EMQX terminates device-facing MQTT/MQTTS and Sparkplug sessions.
- NATS JetStream carries internal events, commands, status, and replayable streams.
- The brokers are intentionally separate. Device credentials and topics do not become internal service credentials or subjects.

### Data Plane Storage

| Store | Initial responsibility |
| --- | --- |
| PostgreSQL | Laravel-owned control-plane records and authoritative operational model |
| TimescaleDB | Go-owned telemetry, ingestion diagnostics, and operational history |
| Redis | Cache, rate limiting, queue support, and selected runtime coordination |
| NATS JetStream | Durable internal streams, replay, commands, and local buffering |
| Object storage | Exports, adapter artifacts, large raw payloads, documents, and backups |

ClickHouse, Airflow, Neo4j, and vector stores are optional later capabilities. They are not required for the initial deployable platform.

## Public and Internal APIs

React, mobile, and customer integrations use versioned Laravel APIs. Go may expose internal health, query, and operational endpoints, but it does not create a competing public domain API.

Device ingestion is a data-plane interface rather than a product-management API:

- MQTT/MQTTS terminates at EMQX.
- Native HTTP/HTTPS telemetry may terminate at a dedicated Go ingress service.
- Node-RED terminates adapter-specific protocols and polling flows.

## Realtime

For the initial platform, Go publishes curated state changes to NATS and Laravel bridges authorized updates through Reverb. Raw telemetry is not broadcast through Laravel.

A dedicated Go realtime gateway may replace or supplement Reverb if connection volume or update frequency later requires it, without changing the client event contract.

## Non-Negotiable Boundaries

1. Laravel owns definitions; Go executes activated versions.
2. React and mobile clients use Laravel as the public API boundary.
3. Go does not synchronously ask Laravel how to process each message.
4. Adapters never write directly to platform databases.
5. AI agents call authorized Laravel domain tools rather than databases, brokers, or device transports.
6. Node-RED flow details do not leak into the canonical domain model.
7. Sparkplug B is an external interoperability contract, not the internal operational model.
