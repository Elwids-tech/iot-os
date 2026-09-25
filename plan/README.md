# IIoT Platform Plan

**Status:** Active architecture plan  
**Last updated:** 2026-09-25

This directory records the agreed target architecture for the next IIoT platform. It separates accepted decisions from draft contracts and future scaling options so that planned work is not mistaken for implemented work.

The current [`docs/c4-architecture.md`](../docs/c4-architecture.md) is an earlier baseline. It still assigns platform APIs and parts of the control plane to Go. The documents here supersede that ownership model. The C4 document should be revised after this plan is reviewed and accepted as a whole.

## Core Architecture Rule

> Laravel owns intent, definitions, authorization, AI orchestration, and public APIs. Go executes activated definitions in the high-throughput data plane.

## Accepted Direction

- The product is developed as one cross-language monorepo; React applications share a platform-owned shadcn component package.

- React powers the customer application, administration application, and future Integration Studio.
- Laravel is a headless control plane and owns the public product API.
- Laravel AI is the agent orchestration layer. Agents use authorized domain tools and never bypass platform policies.
- Go owns telemetry ingestion, Sparkplug B processing, runtime mappings, stateful rule evaluation, hot state, and command execution.
- EMQX is the device-facing MQTT/MQTTS and Sparkplug broker.
- NATS JetStream is the internal durable event backbone.
- Native Phase 1 ingestion supports MQTT/MQTTS JSON, HTTP/HTTPS JSON, and Sparkplug B.
- Node-RED is the isolated Phase 1 adapter runtime for OPC UA, CoAP, API polling, and proprietary payloads.
- PostgreSQL and TimescaleDB are the initial operational stores; Redis supports cache and runtime coordination.
- The first production deployment is a single VM or on-premise computer using Docker Compose.
- Managed and self-hosted Kubernetes are future deployment profiles, not Phase 1 requirements.

## Document Map

### Architecture

- [Target architecture](architecture/target-architecture.md)
- [Responsibility boundaries](architecture/responsibility-boundaries.md)
- [Data ingestion and adapters](architecture/data-ingestion-and-adapters.md)
- [AI agent experience](architecture/ai-agent-experience.md)
- [Deployment and installation](architecture/deployment-and-installation.md)

### Contracts

- [Canonical ingestion contract](contracts/canonical-ingestion.md)
- [Definition activation contract](contracts/definition-activation.md)

### Architecture Decisions

- [ADR index](decisions/README.md)
- [ADR-001: React experience layer](decisions/ADR-001-react-experience-layer.md)
- [ADR-002: Laravel control plane](decisions/ADR-002-laravel-control-plane.md)
- [ADR-003: Go data plane](decisions/ADR-003-go-data-plane.md)
- [ADR-004: Node-RED adapter runtime](decisions/ADR-004-node-red-adapter-runtime.md)
- [ADR-005: Sparkplug B boundary](decisions/ADR-005-sparkplug-b-boundary.md)
- [ADR-006: Deployment profiles](decisions/ADR-006-deployment-profiles.md)
- [ADR-007: Monorepo and shared shadcn UI](decisions/ADR-007-monorepo-and-shadcn-ui.md)
- [ADR-008: Laravel Sanctum authentication](decisions/ADR-008-laravel-sanctum-authentication.md)

### Current Work

- [Core platform priorities for vertical applications](roadmap/core-for-vertical-applications.md) — current planning priority: durable telemetry events, rules with geofencing, alerts, then external application access. Detailed contracts remain draft; this is not an implementation completion claim.
- [First delivery slice: committed telemetry events](tasks/committed-telemetry-events.md) — implemented and verified locally.
- [Location contracts and fixtures](tasks/location-contracts-and-fixtures.md) — implemented and verified locally; next: P1 rules and geofencing.
- [Administration foundation](tasks/admin-foundation.md)

### Supporting Plans

- [Monorepo and developer experience](roadmap/phase-1/monorepo-and-developer-experience.md)
- [Definition of Ready and Done](roadmap/phase-1/definition-of-ready-and-done.md)
- [Scaling and evolution](roadmap/scaling-and-evolution.md)

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| Accepted | The architecture decision has been made and should guide implementation. |
| Draft | The shape is proposed but fields or behavior may still change. |
| Planned | Intentionally deferred and not part of the initial implementation. |
| Implemented | Verified in the new platform code and runtime. |

Nothing in this directory is marked Implemented until corresponding code, tests, deployment artifacts, and runtime behavior exist.

## Working Principles

1. Start with the smallest production-capable deployment.
2. Preserve stable contracts where future scaling will create new processes.
3. Keep protocol and vendor details outside the platform domain model.
4. Make AI a first-class experience without making deterministic operation depend on an LLM.
5. Prefer immutable, versioned definitions and explicit activation.
6. Keep device-facing transport, internal messaging, and public application APIs separate.
7. Build one product with multiple deployment profiles rather than separate cloud and on-premise products.
