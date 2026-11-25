# ADR-054: One Hierarchy of Typed Entities per Organization; Sites Are Its Site Entities

**Status:** Proposed
**Date:** 2026-11-25
**Relates to:** [ADR-032](ADR-032-applications-follow-a-plant.md) (grants by site, `entities:read`), [ADR-039](ADR-039-hosted-devices-and-moves.md) (moves), spec 038's ADR-052 (typed protocols), spec 009

## Context

A device's only context is an optional site: a flat list with a time zone, an address
and coordinates. Industrial, building and utility customers organize their data by a
hierarchy of places and equipment (site, area, line, asset; building, floor, zone;
region, substation, feeder, transformer), and a later Unified Namespace publishes data
under that hierarchy.

Since sites were added, they have gained readers: device filters and the device form,
alerts (and a gateway alert's shared site), the agent tools, moves between
organizations, and integration applications whose grants follow a site (ADR-032, which
reserved `entities:read` and "entity branches" for this decision). Spec 038 connects
building management servers over OPC UA and wants building data to land in the
organization's own structure without the structure knowing about OPC UA.

## Decision

1. **One tree of typed entities per organization.** An entity has one parent in the same
   organization, a type, a display name and a path name unique among its siblings; its
   path is derived. Types are per organization and carry the rules (allowed parents,
   member types, whether devices may be placed, time zone, location, a naming template).
   Built-in presets copy types into an organization. Depth is limited to 12. Groupings
   across the tree are dated memberships, which add no path.
2. **Sites are entities.** Every organization has a type with the key `site`. Each
   existing site becomes a top-level entity of that type with the same UUID, and each
   device with a site is placed there. The sites API, the device and alert `site`, the
   `site_uuid` filters and agent tools, and the integration API's `GET sites` remain as a
   deprecated compatibility view over Site entities. A device's site is the nearest Site
   entity at or above where it is placed; its reporting time zone is the nearest time
   zone at or above that place, else the organization's, else UTC.
3. **Devices carry a derived place.** `devices.entity_id` (the current placement, or the
   last one for an archived device) and `devices.site_id` (now pointing at the Site
   entity) are derived and written by one service only. An archived device keeps its
   place, as it keeps its site today.
4. **Grants follow branches.** A grant scope covers every device placed anywhere in the
   branch of each scoped entity; a site scope is the case of Site entities. Scopes may
   name entities of any type, and `entities:read` serves the entities an application can
   see and the paths of its devices' points.
5. **Moves re-make the place.** A move to another organization ends the predecessor's
   placement; the mover chooses where the successor goes in the target's tree. Nothing
   in a hierarchy travels between organizations.
6. **The hierarchy knows no protocol.** No entity, type, placement or history record
   holds a protocol, a node address or a key into another feature's records. Other
   features change the hierarchy only through its own operations (create, place, and a
   batch check and apply), with the acting person's permission, the same rules and the
   same activity records as the portal; they keep their own provenance.
7. **Edits apply immediately.** The runtime does not execute the hierarchy, so there is
   no draft and activation; the runtime keeps receiving only a time zone.

## Consequences

- Every reader of sites keeps its shape. Applications that follow a site keep the same
  devices after the migration, and keep devices placed deeper inside the site.
- Moving a branch can move devices into or out of a site or an application's scope at
  once; the portal states the impact before the move.
- `Entity.view`, `Entity.manage` and `EntityType.manage` are new permissions, given to
  everyone who holds `Device.view` or `Device.manage` today.
- The `sites` table is kept, unused, for one release so the change can be rolled back;
  after that, rolling back past it is not possible.
- A later Unified Namespace publication, access restricted to a branch for people, and
  rollups per entity build on these paths; each needs its own decision.
- Spec 038's hierarchy proposal and later imports use the batch operations; the
  hierarchy does not change for them.
