# ADR-003: Go Data Plane

**Status:** Accepted  
**Date:** 2026-08-22

## Context

Telemetry ingestion, Sparkplug sessions, stateful rules, commands, hot state, and stream processing are concurrent, long-running, and throughput-sensitive workloads.

## Decision

Go owns deterministic runtime execution, including native ingestion, Sparkplug B processing, active mapping execution, stateful rule evaluation, command delivery, runtime diagnostics, and telemetry persistence.

Go consumes activated definitions and does not become a second public domain API.

## Consequences

- Runtime workloads can scale independently from Laravel APIs.
- Consumers must be idempotent and tolerate JetStream redelivery.
- Definition caches and activation acknowledgements become required platform capabilities.
- Shared database access must respect explicit logical ownership.

