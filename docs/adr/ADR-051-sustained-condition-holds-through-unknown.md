# ADR-051: A Sustained Condition Holds Its Clock Through Unknown Evidence

**Status:** Proposed
**Date:** 2026-11-24
**Amends:** [ADR-011](ADR-011-dag-automation-in-go.md) (what `sustained.v1` does with unknown input)
**Relates to:** [ADR-044](ADR-044-geofence-rules-join-dag-automation-in-stages.md) (stage 1, items 2 and 3)

## Context

`sustained.v1` turns "true" into "true for N seconds". Until now it restarted its
clock on anything that was not a known true, including an unknown input
([`evaluator.go`](../../services/runtime/internal/dag/evaluator.go)).

A binding's freshness counts from when a reading was observed. A device whose
readings reach the runtime late, in batches, has little freshness left on arrival,
so the input is unknown (`stale`) for a while between reports. On a pilot device
reporting every few minutes with a 10 minute freshness, an "off for 30 minutes"
automation restarted its clock five times in 40 minutes of continuous "off" and
never raised its alert. Nothing told the author: the simulation repeats the reading
to keep it fresh, and the timeline said only "Waiting for evidence".

The same restart had two more effects on the common shape *input → branch →
sustained → alert*:

- After the alert was raised, a stale gap followed by the next reading cleared it
  and started a second 30 minutes, so one continuous condition produced activated,
  cleared, activated. ADR-044 recorded this for geofence graphs.
- A branch with no usable input reported both sides as "branch skipped", the same
  as the side it did not take. So `sustained.v1` could not tell "the input turned
  on" from "the input is stale", and when the input did turn on its output was
  unknown, which never clears an alert. The alert stayed open until the input went
  off again.

ADR-044 left "fixed in place or by a new node version" open for the alert that
holds through unknown, and proposed a new node version for a stricter evidence
policy (sample count, largest gap).

## Decision

`sustained.v1` changes in place:

1. **Only a known "not holding" restarts the clock**: a false input, or the branch
   that feeds the node taking its other side.
2. **Unknown input (stale, invalid, missing) leaves the clock where it is** and
   makes the output unknown. The duration is never completed by a gap: the node
   answers true only on an evaluation that has a usable true input.
3. **When usable evidence returns and still holds, the time in the gap counts.**
   The state is taken to have continued, as the dashboards draw it.
4. **`branch.v1` with no usable input passes the reason on** (for example `stale`)
   on both ports. "Branch skipped" now means only the side not taken, and
   `sustained.v1` reads it as false.

It is fixed in place, not in a new node version, because the old behaviour is a
fault for every running automation that uses the node: it loses alerts and leaves
others open. No author can have relied on it.

## Consequences

- Automations with a duration longer than their input's freshness now work, and an
  alert behind `sustained.v1` no longer clears and re-raises across a gap, or stays
  open after its condition ends.
- A device that is silent for a long time and returns in the same state raises the
  alert on its first reading, with the silence counted. That leans towards raising
  an alert over missing one. The device's own offline alert covers the silence.
- This differs from geofence rules (workflow v1), where missing or stale fixes drop
  pending evidence and a largest gap is configurable. That stricter policy remains
  the subject of ADR-044's new sustained node version; `sustained.v1` has no gap
  limit.
- Running executions pick the behaviour up when the runtime is released. Stored
  state is unchanged (`since` only), so nothing is migrated.
- Follow-up, not in this change: show the elapsed time in the execution timeline in
  place of "Waiting for evidence", simulate a device's real reporting rhythm, and
  default freshness from it.
