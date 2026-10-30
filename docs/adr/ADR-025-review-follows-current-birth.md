# ADR-025: Device Review Follows the Source's Current Birth

**Status:** Proposed
**Date:** 2026-10-29
**Relates to:** [ADR-005](ADR-005-sparkplug-b-boundary.md), [ADR-010](ADR-010-per-tenant-adapter-runtimes.md),
[ADR-011](ADR-011-dag-automation-in-go.md)

## Context

The runtime compares every birth from an activated device's source with the applied
configuration. Each mapped metric must be announced with its approved datatype, and
each command target must exist. This is `devices.Preview`, the same check activation
runs. A birth that fails it sets `review_required` on the device. Until now the flag
was a latch. Only a new activation of the device cleared it
(`storage.Store.Apply`), even when the next birth from the same source matched the
configuration again. [Devices](../features/devices.md) documented this.

While the flag is set, the runtime refuses commands. DAG automations bound to the
device fail activation, and running ones are suspended. Readings from compatible
births are still stored.

On the pilot on 2026-10-28, a device activation restarted a polling adapter's
publisher. The publisher announced one source with 8 of its 9 mapped metrics, and
16 ms later with all 9. The first birth set the latch. Every later birth was
compatible, but the device stayed in review. An automation bound to it then failed
activation with `binding_changed`, which hid the cause.

Sparkplug B makes the latest birth authoritative: a DBIRTH replaces the device's
metric set and aliases for its session, and the runtime already reads data only
through it.

## Decision

- `review_required` describes the source's current birth. Sometimes a birth from an
  activated device's source passes the activation check against the applied
  configuration. When it does, the runtime clears the flag in storage and in memory,
  allows commands again, and reports the device online without the review
  diagnostic. The flag clears before that birth's readings are handed to storage, so
  automations that evaluate them see a reviewed device. If storage cannot be updated,
  the flag stays set and the next packet tries again.
- An incompatible birth still sets the flag at once, with the same effects as before.
  A new activation still clears it.
- Automations bound to a device in review fail activation, or are suspended, with
  `device_review_required: <role>`. This is distinct from `binding_changed: <role>`,
  which still means the bound configuration or generation is no longer the applied
  one. Laravel records the suspension's `stopped_reason` as `device_review_required`.
  The automation list and editor say which device needs review and how to clear it.
  A suspended automation does not resume when review clears; someone activates it
  again.
- Clearing uses the activation check, which compares names and datatypes, not
  meaning. When a source announces the approved metrics again, the runtime accepts it
  without a person, as activation would.

## Consequences

- A momentary incompatible birth no longer blocks commands and automations until
  someone reactivates the device. Examples are a partial birth while a publisher
  restarts, or a gateway that announces a device in pieces.
- A source that alternates between compatible and incompatible births alternates
  between blocked and allowed. Each incompatible birth is still reported in the
  device's presence diagnostic and in telemetry captures.
- No person has to acknowledge a source that went incompatible and came back. Review
  never caught a device that kept its metric names and datatypes but changed meaning,
  such as a swapped sensor, and it still does not.
- An automation evaluated while its device was in review is still suspended until it
  is activated again. The same change makes the adapter publisher never announce a
  birth with fewer metrics than it already announced, which removes the cause seen on
  the pilot.
- Geofence rules (workflow v1) still report review and configuration changes
  together as `binding_changed`.
