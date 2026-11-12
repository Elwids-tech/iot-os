# ADR-041: Shared History Follows Every Earlier Move

**Status:** Accepted 2026-11-12, built in [spec 031](../../specs/031-move-devices-within-account/spec.md) (FR-051, FR-052)
**Date:** 2026-11-12
**Amends:** [ADR-039](ADR-039-hosted-devices-and-moves.md), [ADR-040](ADR-040-moved-back-devices-read-their-own-readings.md)
**Relates to:** [spec 031 research R18](../../specs/031-move-devices-within-account/research.md#r18-history-across-the-move-us6)

## Context

[ADR-039](ADR-039-hosted-devices-and-moves.md) shares history per link: with
**Include readings from before the move**, the new device reads its predecessor's
readings, and nothing further back, because the mover held `Device.move` in those two
organizations only. [ADR-040](ADR-040-moved-back-devices-read-their-own-readings.md)
added the readings a device moved back recorded in its own organization.

On the pilot, a device moved from A to B without its readings, back to A with them,
and on to B again with them. A's device showed the whole history: the readings the
first device recorded in A, as its own. The device in B showed only the few readings
the device had recorded in A since coming back. The box was ticked on both moves that
carried history, and people expect it to bring the device's history: everything it
showed before the move.

## Decision

**Sharing a move's history shares the whole history the device had.** When a link
includes history, the new device reads everything its predecessor's history showed at
the cutover: the predecessor's own readings and every earlier part it read, from
earlier moves and from its own organization. Recursively, a successor reads an earlier
device in its chain when:

- every link between them shares history, or
- a device of that earlier device's organization is read later in the chain (ADR-040,
  extended to what that device read).

Every part is read where it was recorded, under that organization and its retention,
up to the cutover its device left at. Readings recorded in the successor's own
organization are labelled as its own (`self`), any other `source`. Nothing is copied.

**Stopping cuts everything downstream.** When a source stops sharing on a link, or
either organization of a link leaves the account, everything that crossed that link
disappears for every device after it. Readings that reached a device another way, such
as its own organization's, stay.

**Unchanged from ADR-039:** the option is per move, off by default; history never
leaves the billing account; Laravel decides each crossing and asks the runtime for each
organization separately.

## Consequences

- One tick of the box carries the device's history through any number of moves, and a
  device that moved and came back loses nothing when it moves on.
- An organization's readings can reach an organization two or more moves away, through
  each mover's choice. The first source can still end that at any time by stopping its
  link.
- The chart, table and export name the organization the device came from directly
  (`source`), even for readings recorded further back. Naming each one is follow-up
  work.
- History reads walk the whole chain and ask the runtime once per part read; chains are
  short and the walk stops after 50 links.
