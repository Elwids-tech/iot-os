# Location contracts and fixture delivery

**Status:** Implemented and verified locally on 2026-09-25; hardware/production acceptance remains separate
**Date:** 2026-09-25
**Parent:** [Core priorities](../roadmap/core-for-vertical-applications.md), P0

## Delivered scope

Versioned location-binding, normalized-fix and scenario contracts; deterministic
Go coordinate resolver; additive reading timestamp provenance; protected internal
preview; reproducible fixture generator with configurable reporting interval and
accuracy. See the [operating guide](../../docs/location-contracts.md).

Pairs are confined to one source-asserted fix in one committed event with matching
timestamps, configuration and quality. There is no joining of latest values.
Unknown/stale/invalid locations cannot become live-eligible; historical fixes
remain identifiable and cannot become new live evidence.

## Acceptance

- All 30 shared scenarios produce their expected eligibility/diagnostic result.
- Input/output schemas validate; generator reproduces the checked-in scenarios.
- Duplicate and restart inputs normalize deterministically without mutable state.
- Wrong tenant/configuration/generation, malformed bindings and unrelated
  coordinates are rejected or reported unknown as appropriate.
- Timestamp source survives profile mapping and committed-event projection;
  legacy readings remain compatible and explicitly unknown to GPS resolution.
- Rebuilt runtime preview requires authentication and has no command/alert effects.

## Boundary and next task

This completes P0's location foundation. It does not
implement geofence membership, stateful timers, deduplication of rule side effects,
rule authoring/activation, animal assignments or hardware integration.

Next: define and implement P1 rule definition/activation contracts and the minimal
typed evaluator pipeline, using these fixtures for geofence membership, unknown
state, sustained evidence and episode transitions. Preserve the existing
Laravel-definition/Go-execution boundary.

## Verification — 2026-09-25

- Go unit/contract/authentication tests and `go vet ./...` passed.
- Five existing device, one event and three location schemas/fixtures validated;
  the Python generator's reproducibility, configurable inputs and invalid-input
  tests passed.
- The full disposable Devices suite passed with race-enabled Go database/broker
  tests, browser and lifecycle checks, command behavior, tenant isolation, TLS/ACL,
  and runtime/broker/database interruption recovery.
- Rebuilt/recreated the local runtime with its existing Compose overlays. All 30
  scenarios passed through its protected resolver endpoint, and every output
  validated against `location-fix.v1`. Unauthorized access returned 401; readiness
  returned healthy. No browser drafts, live rule state or device commands changed.
