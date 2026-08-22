# ADR-002: Laravel Control Plane

**Status:** Accepted  
**Date:** 2026-08-22

## Context

The platform requires mature authentication, tenancy, authorization, APIs, validation, queues, notifications, workflows, audit, and AI tooling. These workloads benefit more from development speed and ecosystem maturity than from a lower-level runtime.

## Decision

Laravel owns the public product API, operational domain model, definition lifecycle, workflows, authorization, audit, notifications, and Laravel AI orchestration.

Laravel does not own the telemetry hot path. It publishes immutable activated definitions and consumes curated runtime events.

## Consequences

- The platform retains Laravel ecosystem and AI leverage.
- React and mobile clients have one public API authority.
- Control-plane and data-plane contracts must be explicit and versioned.
- Laravel availability is not required for every telemetry message once definitions are loaded.

