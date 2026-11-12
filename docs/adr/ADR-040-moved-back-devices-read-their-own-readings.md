# ADR-040: A Device Moved Back Reads Its Organization's Earlier Readings

**Status:** Accepted 2026-11-12, built in [spec 031](../../specs/031-move-devices-within-account/spec.md) (FR-053); amended by [ADR-041](ADR-041-shared-history-follows-every-move.md) (shared history follows every earlier move)
**Date:** 2026-11-12
**Amends:** [ADR-039](ADR-039-hosted-devices-and-moves.md)
**Relates to:** [spec 031 research R18](../../specs/031-move-devices-within-account/research.md#r18-history-across-the-move-us6)

## Context

[ADR-039](ADR-039-hosted-devices-and-moves.md) lets history follow a moved device,
read-only, when the mover chooses it. That access is per link and "does not follow a
chain of moves": each link crosses between two organizations, and the person who chose
it held `Device.move` in those two only.

A device can move back. Device P in organization A moves to B without its readings,
which makes successor S1 in B; S1 moves back to A with its readings, which makes S2 in
A. S2 then read S1's readings, which were empty, and never P's, although P's readings
are stored for A, S2's own organization. A's members could still open the archived P
and see them, but the device they now use lost its past. On the pilot one device's
readings had to be copied onto its successor by hand.

Reading P's readings for S2 crosses nothing: the readings belong to A, and only A's
members read them. The "no chains" rule exists for the crossing, and does not apply.

## Decision

**A successor reads its own organization's earlier readings.** Its history includes the
readings of every earlier predecessor in its chain of moves that is in the successor's
own organization, up to the cutover that predecessor left at:

- read under the successor's organization and retention, as the device's own readings
  (`recorded_in: self`);
- whatever the history option says on any move in the chain, with no stopping and no
  end when an organization leaves the account, since they never left the organization;
- traced through every profile copy's parameter map in turn; a parameter that doesn't
  map back ends the chain there.

**Readings from other organizations stay per link.** A successor reads only its own
predecessor's readings from another organization, when that link shares them, as
ADR-039 decided. A→B→C→A reads A's readings, then C's if the last move shared them, and
never B's.

The parts are read oldest first: the organization's own earlier readings, then the
shared predecessor's, then the device's own. The move review says when a device returns
to an organization it was in.

## Consequences

- A device keeps one history in each organization it comes back to, with no option to
  forget and nothing to stop. Nothing is copied, so a readings copy made by hand would
  now show twice and must be removed when this ships.
- History reads walk the device's links back on every request, a few queries per
  move. Chains are short; the walk stops after 50 links.
- A records cursor names which earlier part it reads (`earlier.<consumed>.<hops>.<runtime
  cursor>`), so a cursor issued before this change is refused once and the table loads
  again.
- Readings from an earlier predecessor keep that predecessor's `configuration_uuid`,
  which isn't among the device's own configurations.
