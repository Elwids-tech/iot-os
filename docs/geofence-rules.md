# Geofence evaluator and simulation

This is the deterministic P1 evaluator slice. It provides versioned definitions,
polygon validation, sustained evidence, serialized state and transition previews.
It does **not** activate rules, subscribe to the live feed, persist rule state,
schedule background timers, deliver alerts or send commands. Those are the next
Laravel/control-plane and Go/durable-execution integration tasks.

## Contracts and typed pipeline

`contracts/rules/v1` contains schemas and executable examples for:

- `geofence-rule.v1`: rule/version UUIDs, evaluator version, location binding,
  polygon, evidence policy and the fixed typed pipeline.
- `geofence-state.v1`: condition, active episode, pending evidence, source watermark,
  expiry and definition hash.
- `rule-transition.v1`: stable activated/cleared transition identity, rule/binding/
  tenant/device references, source event and evaluation time.
- Simulation requests and a 13-step trace with independently specified expected
  conditions, reasons and transition types.

The pipeline is `location.source.v1` → `geofence.membership.v1` →
`condition.sustained.v1` → `alert.condition.v1`. The registry declares node input
and output types. v1 deliberately rejects other node orderings, scripts and
arbitrary graphs. Numeric comparison nodes and a visual editor remain separate.

Compilation validates and snapshots the definition, then hashes its canonical Go
JSON representation. State is bound to that exact hash, including rule version,
geometry, binding revision/configuration and policy. Changing a definition requires
an explicit new state/activation boundary; the evaluator refuses to reuse old state.

## Polygon semantics

Geometry uses GeoJSON `[longitude, latitude]` order and one closed simple ring with
3–256 unique vertices. Winding direction is immaterial. Reject holes, repeated
vertices, self-intersections, overlapping adjacent edges, edges shorter than one
centimetre and polygons smaller than one square metre.

v1 is limited to local polygons spanning at most one degree on each axis and
latitudes within ±75°. Dateline-crossing polygons and polar regions are unsupported
and rejected. A point across the dateline from an otherwise supported local polygon
uses the shortest longitude offset.

Distances and membership use a local equirectangular projection centred on the
polygon, with Earth radius 6,371,008.8 m. Accuracy/buffer distances use this same
projection; this is not a geodesic or cadastral boundary model.

The effective uncertainty band is the larger of the configured buffer and reported
GPS accuracy. A point within or exactly on that band is unknown. With zero buffer
and zero/allowed-unknown accuracy, an exact boundary counts as inside. Unknown
accuracy is accepted only when explicitly allowed by the location binding.

## Sustained-condition policy

- `outside_for_seconds`: 0–86400; a positive duration requires at least two samples.
- `minimum_samples`: 1–1000 distinct, source-time-increasing eligible observations.
- `max_gap_seconds`: positive and no greater than the binding freshness limit.
- `uncertainty_metres`: 0–100000; combined with reported accuracy as above.

Pending duration starts when the first outside observation is evaluated. A source
observation gap beyond the configured gap, expired evidence, invalid location or
boundary uncertainty resets pending evidence. Duration never fills a missing-data
gap. Evidence expires at the earliest of source age, receipt age and receipt plus
the maximum reporting gap. Exact expiry remains inclusive.

An outside condition activates only when duration, sample count and freshness all
hold. A nil-event timer step can complete it while retained evidence is still fresh.
One observation cannot satisfy a positive duration on its own. Sustained evidence
at a reporting cadence does not prove continuous physical location between fixes.

Unknown/stale evidence does not clear an active episode. Only an eligible inside
observation clears it. Acknowledgement, suppression and notification delivery are
not evaluator concerns.

Historical, duplicate, non-increasing source-time and mismatched-scope events do not
count as evidence or clear the current condition. Evaluation still ages existing
evidence, but ignored events do not trigger a pending activation; timer processing
is explicit. Evaluation time cannot move backwards.

## Replay and recovery boundary

The pure `rules.Compile` and `Compiled.Step` functions return the next state and at
most one transition. They have no database, broker or action dependencies. A
transition ID is derived from definition hash, episode number and transition type.
Replaying the same input/state/time gives the same result; replay after storing
the result does not emit that transition again.

The future live executor must atomically persist state, input checkpoint and the
transition outbox before acknowledgement. Serialized-state tests here verify
evaluator restart behavior; they do not establish that live durable integration
has already been built. Likewise, timers currently advance only through explicit
simulation steps.

## Internal simulation

Both endpoints require the existing runtime bearer token:

- `GET /internal/rules/node-types` returns the typed node registry.
- `POST /internal/rules/simulate` accepts a definition, optional prior state and
  1–1000 ordered steps containing `at` and an event or `null` for a timer.

The response contains the definition hash and per-step state, reason and optional
transition. Invalid definitions/state/time return 422; missing authentication
returns 401. The existing 4 MiB request limit applies. No public rule-authoring API
or automatic activation is implied by these internal preview endpoints.

## Verification

Run `rtk proxy go test -race ./...` and `rtk proxy go vet ./...` in
`services/runtime`, plus the existing Python contract validator. Tests cover
geometry validation, boundary uncertainty, winding, dateline distance, evidence
gaps, stale active episodes, late/duplicate/history rejection, immutable definition
boundaries, serialized restart, deterministic transitions and endpoint authentication.

After rebuilding the runtime, replay the shared simulation request through the
protected endpoint, compare its expected trace and validate all state/transition
outputs. Split that request after activation and resume using the returned state;
its subsequent results must match uninterrupted simulation.
