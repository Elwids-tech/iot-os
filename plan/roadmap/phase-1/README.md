# Phase 1 Delivery Plan

**Status:** Planned
**Last updated:** 2026-08-22

## Delivery Method

Phase 1 uses milestone-gated Kanban:

```text
Phase 1
  └── Milestone: demonstrable delivery gate
        └── Epic: cohesive capability
              └── User story: independently testable outcome
                    └── Engineering task: implementation checklist
```

This gives the team release-level structure without forcing uncertain cross-language work into fixed sprints. Stories flow continuously, work in progress stays limited, and every milestone closes with an integrated demonstration and evidence.

See [delivery management](delivery-management.md) for issue types, identifiers, statuses, and workflow rules.

## Milestone Sequence

| ID | Milestone | Primary gate | Depends on |
| --- | --- | --- | --- |
| P1-M0 | [Monorepo foundation](M0-monorepo-foundation.md) | Fresh clone to working development environment | None |
| P1-M1 | [Control plane foundation](M1-control-plane-foundation.md) | Tenant-scoped resource model and activated definition | M0 |
| P1-M2 | [First live datapoint](M2-first-live-datapoint.md) | MQTT/HTTP telemetry visible in the portal | M0 and M1 activation contract |
| P1-M3 | [Industrial connectivity](M3-industrial-connectivity.md) | Sparkplug and adapter-managed source onboarded | M2 canonical ingestion path |
| P1-M4 | [Automation, commands, and AI](M4-automation-commands-ai.md) | Deterministic automation, safe control, reviewed AI draft | M1 and M2; adapter command path from M3 where used |
| P1-M5 | [Production readiness](M5-production-readiness.md) | Reproducible, recoverable single-node release |https://file+.vscode-resource.vscode-cdn.net/Users/tharindarodrigo/Projects/iot-platform/plan/roadmap/phase-1/M0-monorepo-foundation.md All capability gates |

## Critical Path

```text
M0 monorepo
  → M1 identity, domain model, and activation
    → M2 canonical ingestion and live data
      ├── M3 Sparkplug and Node-RED adapters
      └── M4 rules, commands, and AI
            → M5 verified single-node release
```

M3 and much of M4 can proceed in parallel after M2 stabilizes the canonical event and runtime definition contracts. Backup, security, observability, and release automation from M5 should be implemented incrementally rather than deferred to the end.

## Cross-Cutting Requirements

Every milestone includes the applicable parts of:

- Tenant isolation and authorization
- Contract versioning and backward compatibility
- Audit and trace correlation
- Idempotency and recovery from redelivery
- Accessibility and responsive React behavior
- Automated tests at the owning boundary
- Logs, metrics, health checks, and safe diagnostics
- Documentation and reproducible developer commands

## Completion Rule

A milestone is complete only when:

1. Its stories meet the shared [Definition of Done](definition-of-ready-and-done.md).
2. The milestone demonstration succeeds from a clean environment.
3. Required architecture and operational documentation is current.
4. Known residual risks are recorded rather than hidden in completed tasks.

