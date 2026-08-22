# Phase 1 Foundation

**Status:** Planned
**Last updated:** 2026-08-22

## Objective

Deliver the smallest production-capable platform that proves the accepted responsibility boundaries and reaches a live datapoint on a single machine.

Phase 1 is managed as **Milestones → Epics → User stories → Engineering tasks**. The milestones are capability gates, not technology phases: each one ends with a demonstrable outcome spanning the necessary React, Laravel, Go, messaging, storage, and operational work.

The detailed backlog is indexed in the [Phase 1 delivery plan](phase-1/README.md).

## Delivery Milestones

| Milestone | Demonstrable outcome | Detail |
| --- | --- | --- |
| M0 | A developer can clone the monorepo and run both React shells plus the backend dependencies | [Monorepo foundation](phase-1/M0-monorepo-foundation.md) |
| M1 | An administrator can create a tenant, model a device, and activate an immutable profile | [Control plane foundation](phase-1/M1-control-plane-foundation.md) |
| M2 | A device can publish JSON over MQTT or HTTP and an operator can see the validated live value | [First live datapoint](phase-1/M2-first-live-datapoint.md) |
| M3 | Sparkplug B and one Node-RED-managed industrial source can be onboarded through governed mappings | [Industrial connectivity](phase-1/M3-industrial-connectivity.md) |
| M4 | The platform can evaluate a stateful rule, execute an authorized command, and create an AI-assisted draft | [Automation, commands, and AI](phase-1/M4-automation-commands-ai.md) |
| M5 | A fresh single machine can be installed, secured, observed, backed up, restored, and upgraded | [Production readiness](phase-1/M5-production-readiness.md) |

M0 is the first gate. After it, work may overlap where contracts are stable; the sequence is not intended to force a waterfall process. M5 operational work starts early and becomes the final release gate.

## Supporting Plans

- [Delivery management model](phase-1/delivery-management.md)
- [Monorepo and developer experience](phase-1/monorepo-and-developer-experience.md)
- [Definition of Ready and Done](phase-1/definition-of-ready-and-done.md)

## Phase 1 Acceptance Boundary

Phase 1 is complete only when a fresh supported machine can:

1. Install the platform from documented, versioned artifacts.
2. Create an organization, site, gateway, device, and profile.
3. Ingest native JSON through MQTT and HTTP.
4. Ingest Sparkplug B birth and data messages.
5. Ingest at least one adapter-managed protocol through Node-RED.
6. Activate a profile version and prove Go executes that exact version.
7. Evaluate a deterministic rule and surface its result.
8. Authorize, dispatch, acknowledge, and audit a command.
9. Use an AI agent to create a reviewed draft without bypassing activation.
10. Back up and restore operational data.

## Explicitly Not Phase 1

- Native TypeScript/Python Integration Studio runtime
- Kubernetes production deployment
- ClickHouse and Airflow
- Neo4j graph projection
- Multi-region control plane
- Dedicated Go realtime gateway
- Fully autonomous AI actions

