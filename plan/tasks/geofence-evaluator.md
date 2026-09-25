# P1 slice: geofence evaluator and simulation

**Status:** Evaluator slice implemented and verified locally on 2026-09-25
**Date:** 2026-09-25
**Parent:** [Core priorities](../roadmap/core-for-vertical-applications.md)

## Outcome

A deterministic typed pipeline converts eligible committed GPS observations into
inside/outside/unknown conditions, sustained evidence and stable activation/clear
transition previews. Serialized state can resume the same evaluation across a
process restart without carrying state across definition versions.

The [operating guide](../../docs/geofence-rules.md) records exact geometry, timing,
uncertainty, replay and interface semantics. Contracts and fixtures are under
`contracts/rules/v1`.

## Delivery boundary

This is the evaluator/simulation slice of P1. Live Laravel rule authoring,
validation/activation records, runtime activation acknowledgements, durable
state/checkpoints/outbox and timer scheduling remain necessary before P1 is complete.
Simulation has no active-rule, notification or device-control side effects.

## Next slice

Add organization-authorized Laravel definitions and activation lifecycle, then
connect the Go evaluator to the committed feed with atomic durable state/checkpoint/
transition persistence and restart-safe timers. Reuse the same evaluator in preview
and live execution. Profile templates remain drafts until explicitly activated.

## Verification — 2026-09-25

- `go test -race ./...`, `go vet ./...`, and the shared contract validator passed.
  Existing database/broker integration tests skip in this unit-only command; this
  slice changes no persistence or ingestion behavior.
- Rebuilt and recreated the runtime with the existing Compose overlays.
- All 13 simulation steps matched their expected condition, episode and transition
  behavior through the served endpoint. State and transition responses validated
  against their schemas.
- Split replay after activation and resumed from serialized state; the remaining
  outputs matched uninterrupted replay. Changed definitions and invalid polygons
  returned 422; unauthenticated simulation returned 401.
- The runtime remained healthy and exposed the four expected typed nodes.
