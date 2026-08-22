# Phase 1 Foundation

**Status:** Planned  
**Last updated:** 2026-08-22

## Objective

Deliver the smallest production-capable platform that proves the accepted responsibility boundaries and reaches a live datapoint on a single machine.

## Workstreams

### 1. React Experience Foundation

- Portal and administration app shells
- Shared design system and generated Laravel API client
- Authentication and tenant context
- Gateway, device, profile, and diagnostics surfaces
- Agent UI foundation with approvals

### 2. Laravel Control Plane

- Public versioned API
- Organizations, users, roles, and tenant policies
- Sites, assets, devices, signals, and relationships
- Device profiles and immutable versions
- Gateway and adapter registry
- Definition activation and transactional outbox
- Command authorization and audit
- Laravel AI tool registry and initial agents

### 3. Go Data Plane

- Canonical ingestion consumer
- Native MQTT JSON path through EMQX
- Native HTTP JSON ingress
- Sparkplug B session service
- Active profile and mapping cache
- Validation, mutation, derivation, and diagnostics
- Telemetry persistence and hot state
- Initial stateful rule execution
- Command dispatcher and acknowledgement lifecycle

### 4. Adapter Runtime

- Isolated Node-RED service
- OPC UA adapter template
- CoAP adapter template
- HTTP API polling template
- Proprietary decoder fixture workflow
- Canonical event publisher
- Adapter deployment status, logs, and health

### 5. Messaging and Storage

- Separate EMQX and NATS JetStream boundaries
- PostgreSQL/TimescaleDB ownership and migrations
- Redis
- Object storage or compatible local artifact storage
- Dead-letter and replay strategy
- Correlation and trace identifiers

### 6. Single-Node Operations

- Docker Compose production profile
- Reverse proxy and TLS
- Persistent volumes
- Secret bootstrap
- Database backup and restore procedure
- Health, logs, metrics, and support diagnostics
- Upgrade and rollback procedure

## Phase 1 Acceptance Boundary

Phase 1 is complete only when a fresh supported machine can:

1. Install the platform from documented artifacts.
2. Create an organization, site, gateway, device, and profile.
3. Ingest native JSON through MQTT and HTTP.
4. Ingest Sparkplug B birth and data messages.
5. Ingest at least one adapter-managed protocol through Node-RED.
6. Activate a profile version and prove Go executes that exact version.
7. Evaluate a deterministic rule and surface its result.
8. Authorize, dispatch, acknowledge, and audit a command.
9. Use an AI agent to create a reviewed draft without bypassing activation.
10. Back up and restore the operational data.

## Explicitly Not Phase 1

- Native TypeScript/Python Integration Studio runtime
- Kubernetes production deployment
- ClickHouse and Airflow
- Neo4j graph projection
- Multi-region control plane
- Dedicated Go realtime gateway
- Fully autonomous AI actions

