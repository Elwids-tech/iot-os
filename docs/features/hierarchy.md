# Hierarchy

The organization's places as one tree: sites, areas, lines, buildings, floors, feeders,
zones or any other type the organization defines. Devices and single parameters are
placed in it, dashboards, filters and integration applications follow its branches, and
it keeps the history of where everything was. Decided in
[ADR-054](../adr/ADR-054-organization-hierarchy.md); built by
[spec 009](../../specs/009-entity-hierarchy/spec.md).

Code: Laravel [`Domain/Entities`](../../apps/api/app/Domain/Entities); portal
[`src/hierarchy`](../../apps/portal/src/hierarchy). In-product help:
[`resources/help/hierarchy.md`](../../apps/api/resources/help/hierarchy.md).

## Types, rules and presets

Every entity has a type. A type names which types may be its parent (or that it sits at
the top level), which types may be its members in a group, whether devices can be placed
at it, and an optional naming template for path names. The reserved **Site** type is
top-level, holds a time zone, address and coordinates, and is what the sites API and
older readers see ([below](#sites)). **Presets** (manufacturing, buildings, power distribution)
add a standard set of types in one step and merge with types already there;
applying one twice changes nothing. Types are managed under **Devices → Hierarchy →
Types** and need `EntityType.manage`; a type in use cannot be deleted.

Rules apply when something changes, never retroactively: an entity that a later rule
change leaves outside the rules keeps working and is flagged (`outside_rules`).

## The tree

Each entity has a name, a **path name** (letters and digits, unique among its siblings
ignoring case, suggested from the name) and a **path**: the path names from the top
joined by `/`, for example `RiversidePlant/Packaging/Line1`. Paths are stored and
rewritten for the whole branch when an entity is renamed or moved. Entities nest up to
12 levels (`entities.max_depth`).

- **Browse and search.** The Hierarchy page shows one level at a time, 100 children a
  page, with search by name, path name or path (25 a page). An entity's page has
  **Points**, **Devices**, **History** and **Details** (attributes, time zone, location,
  group memberships).
- **Move.** A branch moves under another parent, or to the top level. The move dialog
  first shows its impact (`GET entities/{entity}/move-impact?parent=`): entities and
  devices in the branch, devices that get another site or time zone, and the integration
  applications that gain or lose devices.
- **Archive and restore.** An entity with no active children and nothing placed at it
  can be archived; it leaves the tree, frees its path name and keeps its history. Restore
  puts it back under its parent, with a new path name if the old one was taken. Only an
  entity that never held anything can be deleted.
- **Time zones.** A device's reporting time zone is the nearest time zone at or above
  where it is placed, else the organization's, else UTC. Daily, monthly and shift
  totals use it.

Access: viewing needs `Entity.view`, changes need `Entity.manage`. The hierarchy is not
an access boundary: whoever can see devices sees all of them.

## Placements and points

A device is placed at one entity at a time (`PUT devices/{device}/placement`, or the
place picker on the device form). Its **anchor** is where it is placed now, or where it
was last placed once archived; every reader that filters by branch uses the anchor.

A device's parameters appear at its place as **points**, each under a leaf name (the
parameter key unless renamed for that placement), so a point's path is its entity's path
plus the leaf name. A single parameter can be placed somewhere else on its own
(**Place this parameter** on the Data tab, `PUT devices/{device}/parameters/{parameter}/placement`),
for example one channel of a multi-channel meter at a feeder. Names at one entity are
unique ignoring case: a child's path name keeps its name, and among points the first
there keeps it while a later one (from a profile upgrade) is reported as a clash. A
point whose parameter the device's current profile no longer has is reported as
`not_in_configuration`. Points are computed on read; profile upgrades need nothing from
the hierarchy.

## Groups and coverage

An entity can be a member of a group: another entity whose type lists the member's type
(a feeder in a maintenance zone, a line in a cost centre). An entity is a member of at
most one group of each type. An entity's **coverage** is its branch plus the branches
of its members; the device list, alerts and dashboards filter by a place's coverage.

## History

Every change is kept: entity changes (created, moved, renamed, retyped, archived,
restored), device placements, parameter placements and memberships, each with who and
when.

- An entity's **History** tab lists all of them, newest first
  (`GET entities/{entity}/history`).
- **What was here** lists the devices and points in an entity's branch at a past time,
  using the tree as it was then (`GET entities/{entity}/branch-at?time=`). Times are
  stored to the second, so a change counts from its own second.
- **History** beside a device's place lists where the device and its separately placed
  parameters have been (`GET devices/{device}/place-history`).

Placements carried over from sites have no start time: they count as open at any
earlier time and are listed last, as "before history was kept".

## Sites

Sites are the top-level entities of the Site type, with the same UUIDs as before the
hierarchy. Everything that read sites still does, through a compatibility view: the
sites API (deprecated), a device's `site` (the nearest Site entity at or above its
anchor), the `site_uuid` filters, moves between organizations and agent tools. Old
`/sites` links in the portal redirect to the Hierarchy page. Deleting a site is refused
while entities sit under it; otherwise its devices are unplaced and the site is
archived.

## Integration applications

An integration application's grant can be a scope of up to 50 entities of any type. It
covers every device anchored in their branches, resolved again on every request, so a
device placed there later is covered and one moved out leaves the next read; archiving
a scoped entity removes it from every scope. With `entities:read`, the integration API
lists the hierarchy the application may see and the device read carries the device's
place and points with their paths. See [grants by place](integrations.md#grants-by-place).

## Other features

Other domains build the hierarchy through PHP services, never its tables: reads with
`HierarchyQueries`, single changes with `HierarchyOperations`, and checked or applied
batches of up to 2,000 items, each with the same rules, locks, permissions and activity
entries as the portal. The contract is
[hierarchy operations](../reference/hierarchy-operations.md);
the OPC UA connector ([spec 038](../../specs/038-opc-ua-connector/spec.md)) uses it to
propose a building's places.

## API

The portal API is under `/api/v1/organizations/{organization}` and described in the
[OpenAPI contract](../../contracts/openapi/openapi.json):

| Paths | Purpose |
| --- | --- |
| `entity-types`, `entity-presets` | Types, rules and presets |
| `entities`, `entities/search`, `entities/{entity}` | The tree, search, one entity; create, change, move, archive, restore |
| `devices/{device}/placement`, `devices/{device}/placements` | Place, unplace, placement history |
| `devices/{device}/parameters/{parameter}/placement` | Place one parameter |
| `entities/{entity}/devices`, `entities/{entity}/points` | What is placed at an entity or in its branch |
| `entities/{entity}/memberships` | Groups |
| `entities/{entity}/history`, `entities/{entity}/branch-at`, `devices/{device}/place-history` | History |
