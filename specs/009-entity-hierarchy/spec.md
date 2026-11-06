# Feature Specification: Entity Hierarchy

**Feature Branch**: `spec/009-entity-hierarchy`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "I was thinking of creating a new model called entity and it
should be a self-related or self-referring model and you could create … endless leaves so
basically it's a recursively related Entity hierarchy. Which we could use to enforce the
standard [ISA-95] … the site area line asset would be types of entities … there could be
buildings floors zones so on and so forth which can be unrelated to this specific
standard, but still we don't know where a metric could end up in." Then: proceed with the
draft, taking into account a power distribution utility's requirements for a connected
enterprise platform.

## Context

A device's only context today is an optional **site** (a flat list with a time zone,
address and coordinates; `Devices/Models/Site.php`) plus up to 20 tags and 30
attributes. Nothing records that a pump is on Line 2 in the Packaging area, or that one
channel of an energy meter measures Floor 3. Industrial and utility customers organize
their data by a hierarchy of places and equipment, and a Unified Namespace (UNS)
publishes data under exactly that hierarchy. A distribution utility's requirements for a
connected enterprise platform (received October 2026) ask for an enterprise semantic
hierarchy shaped like `Utility/Region/Substation/Feeder/Asset/DataPoint`, governed naming
standards, topic lifecycle management and multi-region scale.

This feature adds the hierarchy: an organization's tree of typed entities, rules that
hold it to a chosen standard, and the placement of devices and single parameters in it.
It publishes nothing over MQTT. A later spec builds UNS publication on the paths defined
here. Ingestion, activation, commands and automations do not change.

**Terms**

- *Entity*: a node in the organization's hierarchy: a place, a grouping or a piece of
  equipment (a region, a building, a feeder, a pump).
- *Entity type*: what kind of entity it is (Site, Area, Line, Asset, Building, Floor,
  Zone, Substation, Feeder…). Types are defined per organization and carry rules about
  where an entity may sit and what it may hold.
- *Path name*: an entity's short name for paths, unique among its siblings. *Path*: the
  path names from the top of the tree down to the entity, joined by `/`, for example
  `Western/KelaniyaSS/Feeder12/Transformer05`.
- *Placement*: a device's position at an entity for a period of time. All of the device's
  parameters appear there unless a point says otherwise.
- *Point*: one device parameter placed at an entity under a leaf name, overriding the
  device's placement for that parameter.
- *Leaf name*: the last path segment of a parameter at its entity. It defaults to the
  parameter key.
- *Data point*: a parameter as it appears at an entity, through a placement or a point.
- *Preset*: a built-in set of entity types and rules (manufacturing, buildings, power
  distribution).
- *Branch*: an entity and everything below it.
- *Membership*: a dated link that makes an entity a member of another entity outside its
  tree position (a transformer is a member of a division). It adds no path.
- *Coverage*: an entity's branch plus the branches of its current members.

## Clarifications

### Session 2026-10-14

- Q: What shape is the hierarchy? → A: One self-referencing entity model with no fixed
  depth. Site, Area, Line and Asset are entity types, and so are Building, Floor, Zone or
  any type an organization needs, including types outside any standard. A metric may end
  up at any level.

### Session 2026-10-15

- Q: Should v1 support groupings that cut across the tree, such as a utility's divisions
  across its electrical network? → A: Yes, as one main tree plus memberships. An entity
  can also be a member of entities of other types (a transformer on Feeder 12 is a member
  of Kelaniya Division). Paths, time zones and the future UNS come only from the main
  tree; memberships widen filters and the explorer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build the organization's hierarchy (Priority: P1)

An organization manager opens **Entities**, starts from a preset (or from nothing), and
builds the tree: creates entities of a type under a parent, renames them, moves branches
and archives entities. The tree refuses anything that breaks the type rules.

**Why this priority**: everything else (placements, time zones, the explorer and the
future UNS) hangs off the tree.

**Independent Test**: in the local stack, apply the manufacturing preset and create
`Colombo plant` (Site) → `Packaging` (Area) → `Line 2` (Line) → `Filler pump P-201`
(Asset). Try to create a Line at the top level: refused, naming the allowed parent types.
Move `Line 2` under another area: its path changes and the move is recorded.

**Acceptance Scenarios**:

1. **Given** an organization opens **Entities** for the first time, **Then** its existing
   sites are already there as Site entities (US3), and the manager can apply a preset or
   define types themselves (US5).
2. **Given** types with rules, **When** a manager adds an entity under a parent, **Then**
   only the types allowed there are offered, and the API refuses any other type with a
   field error that names the allowed types.
3. **Given** a manager enters a name, **Then** a path name is suggested from it (`Kelaniya
   SS` → `KelaniyaSS`). The path name must follow the character rules (FR-002) and the
   type's naming rule, if any, and must be unique among siblings ignoring case.
4. **Given** a manager moves an entity, **Then** the move is refused when the new parent
   is the entity itself or one of its descendants, when a type rule forbids it, or when
   the branch would go deeper than the maximum depth. Otherwise the whole branch moves,
   and the confirmation first states how many entities and data points get a new path.
5. **Given** a large tree, **Then** each level loads when it is expanded, wide levels are
   paginated, and the tree can be searched by name or path.
6. **Given** an entity with no children and no current placements or points, **When** it
   is archived, **Then** it leaves the tree and every picker but keeps its history. An
   entity that still has children or current placements cannot be archived until they
   are moved or ended.
7. **Given** a Division type that may hold Feeder members, **When** a manager makes
   `Feeder12` a member of `Kelaniya Division`, **Then** the division's coverage includes
   Feeder12's branch, and Feeder12's path, parent and time zone do not change.

---

### User Story 2 - Place devices and single parameters (Priority: P1)

A manager places a device at an entity, from the device page or the entity page. Its
parameters appear there under their keys. They can send one parameter somewhere else (a
channel of a multi-channel meter) and rename leaves.

**Why this priority**: the tree is only useful once data lives in it; this is the "we
don't know where a metric could end up" requirement.

**Independent Test**: place a device at `Filler pump P-201`; the entity shows its
parameters as `ColomboPlant/Packaging/Line2/FillerPumpP201/<key>`. Place a three-channel
meter at `Zone B` and move channel 3's energy to `Floor 3`: Floor 3 shows it and Zone B
no longer does. Place a second device with a `temperature` parameter at the same entity
as the first: refused, naming the clash; accepted after renaming its leaf.

**Acceptance Scenarios**:

1. **Given** a device, **When** it is placed at an entity whose type accepts devices,
   **Then** every parameter of the device's current profile revision appears at that
   entity under its key, except parameters that have their own point.
2. **Given** a device's parameter, **When** a manager places it at another entity with an
   optional leaf name, **Then** it appears only there.
3. **Given** a placement or point would give two data points, or a data point and a
   child entity, the same name at one entity, **Then** it is refused with the clashing
   names listed, and the manager can rename leaves in the same step.
4. **Given** a placed device, **When** it is moved to another entity, **Then** its
   previous placement ends at that moment and the new one starts. Its points stay where
   they are unless they are moved too.
5. **Given** the device page, **Then** it shows the device's path as a breadcrumb and,
   for each parameter placed elsewhere, that parameter's path.
6. **Given** a device is archived, **Then** its placement and points end at the archive
   time.
7. **Given** the device directory or the alerts list, **When** it is filtered by an
   entity, **Then** it includes devices placed anywhere in that entity's coverage: its
   branch and the branches of its members.

---

### User Story 3 - Sites become entities without changing any totals (Priority: P1)

Existing sites become top-level entities of the Site type, and every device that had a
site is placed at it. Daily, monthly and shift totals stay exactly as they were, and
everything that reads sites today keeps working.

**Why this priority**: two parallel location concepts would confuse people, and
consumption totals must not move under anyone's feet.

**Independent Test**: in the seeded demo organization, record each device's reporting
time zone and one consumption total for a fixed period, run the migration, then compare.
Both are identical. Filter devices by a site, and call the agent tools `find_devices`
and `list_alerts` with a `site_uuid`: the results match those from before.

**Acceptance Scenarios**:

1. **Given** an organization with sites, **After** the migration, **Then** each site is a
   top-level entity of type Site with the same UUID, name, time zone, address and
   coordinates, and each device with a site is placed at it. That placement has no start
   time, meaning "since before placement history was kept".
2. **Given** any device, **Then** its reporting time zone is the time zone of the nearest
   entity at or above its placement that sets one, else the organization's, else UTC.
   For every migrated device this equals its time zone before the migration.
3. **Given** clients of sites today (the sites API, the site filters on devices and
   alerts, the device view's `site`, and the agent tools `list_sites`, `find_devices`,
   `list_alerts` and `get_device_health`), **Then** they keep working. A device's site is
   the nearest Site-type entity at or above its placement.
4. **Given** the portal, **Then** the Sites page is replaced by **Entities**, and creating
   a site through the sites API creates a top-level Site entity.

---

### User Story 4 - Explore data by entity (Priority: P2)

An operator browses the tree and sees, for any entity, the data points at it and below
it, with their latest values. This is the in-product view of the future namespace.

**Why this priority**: it makes the hierarchy useful to people who don't manage it, and
it shows customers the namespace before any UNS publication exists.

**Independent Test**: open `Colombo plant` → `Packaging` → `Line 2` and include the
branch. The pump's data points are listed with value, unit and age, and a stale value is
labelled. Copy a data point's full path and open its history.

**Acceptance Scenarios**:

1. **Given** an entity, **Then** its own data points list leaf name, full path, device,
   latest value, unit, quality and freshness. Stale values are labelled with their age,
   and missing values are shown as unknown, never as zero.
2. **Given** **Include branch** is on, **Then** data points of every descendant appear
   with their path relative to the entity, paginated.
3. **Given** a data point, **Then** the user can copy its full path and open the
   parameter's history on the device.

---

### User Story 5 - Define the standard: types, rules and presets (Priority: P2)

A person responsible for naming standards defines entity types: where each may sit,
whether devices may be placed on it, whether it carries a time zone and a location, and
an optional naming rule. Presets give a starting point, and presets can be combined (a
plant site can hold both production areas and an office building).

**Why this priority**: this is how the hierarchy is held to ISA-95, a building standard
or a utility's asset naming standard, instead of drifting. The utility requirements list
the same kind of path in several different shapes, and a rule set would have caught that.

**Independent Test**: apply the manufacturing preset, then the buildings preset; one Site
type now allows both Area and Building beneath it. Add a naming rule `Feeder<number>` to
Feeder. Creating `feeder-12` is refused with the rule's description and example, and
`Feeder12` is accepted.

**Acceptance Scenarios**:

1. **Given** a preset, **When** it is applied, **Then** its types and rules are added.
   Types already present by key are merged: their allowed parent types are combined, and
   nothing else about them changes.
2. **Given** a type, **Then** it has a name, a key, allowed parent types (which may
   include "top level"), the types it may hold as members, whether devices may be placed
   on it, whether it carries a time zone and a location, and an optional naming rule with
   a pattern, an example and a description.
3. **Given** a rule changes, **Then** no entity is moved, renamed or removed. Entities
   that now break a rule are listed as **Outside current rules** and keep working; new
   entities, moves and renames must follow the current rules.
4. **Given** a type is in use, **Then** it can be renamed but not deleted.

---

### User Story 6 - Where was it, and when (Priority: P3)

A manager sees the history of any device or entity: where it was placed, when it moved,
and what it used to be called. The system can say which devices and data points were in
a branch at any past moment, which later rollups and UNS publication need.

**Why this priority**: none of v1's views need history yet, but recording it from day
one is what lets later per-area totals stay correct when equipment moves.

**Independent Test**: move a device from Line 1 to Line 2, rename Line 2, and move Line 2
under another area. The device page lists both placements with their times. The entity
page lists the move and the rename. Asking for Line 1's branch at a time before the move
includes the device; asking after the move does not.

**Acceptance Scenarios**:

1. **Given** a device, **Then** its page lists its placements and points with start and
   end times and who made each change.
2. **Given** an entity, **Then** its page lists its moves (old parent, new parent) and
   renames (old path name, new path name), with time and actor.
3. **Given** an entity and a past time, **When** the branch is requested as of that time,
   **Then** the result holds the devices and data points placed in that branch at that
   time, using the tree as it was then.

### Edge Cases

- A profile upgrade adds a parameter whose key clashes with an existing name at the
  placement entity: the new parameter is shown as **Not placed: name clash** on the
  device and entity pages until a leaf is renamed. Activation, ingestion and commands are
  never blocked by the hierarchy.
- A point refers to a parameter the device's current profile revision no longer has: the
  point is shown as **Not in the current configuration**, kept for history, and can be
  ended.
- A placement made while a device is only registered (no configuration yet) is allowed;
  its data points appear once the device has a profile revision.
- Two managers move entities at the same moment in a way that would form a cycle (A under
  B and B under A): the second move is refused.
- A move or a new entity would exceed the maximum depth: refused, stating the limit.
- An archived entity does not hold its path name. Restoring it when that name has been
  taken requires a new path name.
- An entity that never had children, placements or points can be deleted outright; any
  other entity is archived instead.
- Deleting a site through the sites API: refused while the site has child entities.
  Otherwise the placements at it end (those devices fall back to the organization's time
  zone, as today) and the site entity is archived.
- A type that no longer accepts devices still has devices placed on it: they stay and
  are listed as **Outside current rules**.
- An organization deleted under spec 006 loses its entities, types and history, just as
  sites are removed today. Entities do not stop an organization from counting as empty.
- An entity may be a member of several entities, but of only one entity of each type at a
  time (one division). Making it a member of a second division ends the first
  membership.
- An entity cannot be a member of itself, of one of its ancestors or of one of its
  descendants; the tree already relates them.
- Coverage follows memberships one step only: a member's own memberships are not
  followed, so groupings cannot loop.
- Moving a member in the main tree keeps its memberships. Archiving either side ends the
  membership at that time.
- A display name in any script (for example Sinhala or Tamil) is allowed; only path names
  are restricted (FR-002), and the suggested path name is left empty when it cannot be
  derived.

## Requirements *(mandatory)*

### Functional Requirements

**Tree**

- **FR-001**: An organization's entities MUST form trees. Each entity has at most one
  parent, in the same organization; top-level entities have none. Cycles MUST be
  impossible, and a branch MUST NOT be deeper than 12 levels.
- **FR-002**: An entity MUST have a UUID that never changes, a type, a display name (1–120
  characters, any script) and a path name. Path names are 1–64 characters from ASCII
  letters, digits, `-`, `_` and `.`, unique among siblings ignoring case, and match the
  type's naming rule when there is one. An entity MAY have a description, a time zone and
  a location (address and coordinates) when its type allows them, and up to 30 attributes
  (key and value) for static metadata such as rated capacity or floor area.
- **FR-003**: An entity's path MUST be derived from its own and its ancestors' path names.
  Renaming or moving an ancestor changes the path but never the entity's identity,
  history, placements or references.
- **FR-004**: Creating, renaming, moving, archiving and deleting entities MUST enforce
  FR-001 to FR-003 and the type rules at the moment of the change, refusing with a field
  error that names the broken rule.
- **FR-005**: The tree MUST load level by level, paginate wide levels and support search
  by display name, path name and path.

**Types and presets**

- **FR-006**: Entity types MUST be defined per organization, each with a name, a key,
  allowed parent types (with "top level" as an option), the types it may hold as members,
  whether devices may be placed on it, whether it carries a time zone and a location, and
  an optional naming rule (pattern, example, description).
- **FR-007**: The product MUST offer at least three presets. **Manufacturing (ISA-95)**:
  Site → Area → Line → Cell → Asset, where Asset may also sit under Line or Area.
  **Buildings**: Site → Building → Floor → Zone → Room, where Room may also sit under
  Floor. **Power distribution**: Region → Substation → Feeder → Distribution transformer,
  Recloser, Ring main unit, Switchgear or Capacitor bank, with Meter under a distribution
  transformer or a feeder, and Division under Region holding Substation, Feeder and
  Distribution transformer members. Applying a preset MUST merge by type key as US5 describes, and
  MUST NOT change any entity.
- **FR-008**: Rule changes MUST apply to later changes only. Entities that break a
  current rule MUST be listed as **Outside current rules** and keep working. A type in use
  MUST NOT be deletable.

**Placements and points**

- **FR-009**: A device MUST have at most one current placement, at an entity of its own
  organization whose type accepts devices. Every placement records its start, and its end
  when the device is moved, unplaced or archived.
- **FR-010**: A device parameter MUST have at most one current point. A point places the
  parameter at an entity whose type accepts devices, under a leaf name, and overrides the
  device's placement for that parameter. Points reference the parameter's stable UUID.
- **FR-011**: Leaf names MUST default to the parameter key, follow the path-name
  character rules and be unique at their entity across all leaf names and child path
  names. A placement or point that would clash MUST be refused with the clashes listed. A
  clash that arises later (from a profile upgrade) MUST be reported as **Not placed: name
  clash** and MUST NOT block activation, ingestion or commands.

**History**

- **FR-012**: The system MUST keep every placement, point, membership, parent change and
  path-name change with its time and actor. It MUST be able to answer which devices and data points
  were in a branch at a past time, using the tree as it was at that time.

**Sites, time zones and filters**

- **FR-013**: A device's reporting time zone MUST be the time zone of the nearest entity
  at or above its current placement that sets one, else the organization's, else UTC.
  Points do not change a device's time zone.
- **FR-014**: A migration MUST turn every site into a top-level entity of a Site type,
  keeping its UUID, name, time zone, address and coordinates, and place each device with
  a site at it with no start time. For every device, the reporting time zone after the
  migration MUST equal the one before.
- **FR-015**: Existing site clients MUST keep working through a compatibility view: the
  sites API, the device view's `site`, the `site_uuid` filters on devices and alerts, and
  the agent tools `list_sites`, `find_devices`, `list_alerts` and `get_device_health`. A
  device's site is the nearest Site-type entity at or above its placement. The
  compatibility view MUST be documented as deprecated, with its replacement.
- **FR-016**: The device directory and the alerts list MUST accept an entity filter that
  covers the entity's coverage: its whole branch and the branches of its current
  members.

**Explorer**

- **FR-017**: An entity's page MUST list its data points (and, on request, the data
  points of its coverage, each with its main-tree path) with leaf name, full path, device, latest value, unit, quality and
  freshness, following the existing rules for stale and missing values.

**Access, audit and isolation**

- **FR-018**: Three permissions MUST govern the feature: `Entity.view` (see the tree and
  the explorer), `Entity.manage` (entities, placements and points) and `EntityType.manage`
  (types, rules and presets). The migration MUST grant `Entity.view` to every role and
  permission ceiling that holds `Device.view`, and `Entity.manage` and `EntityType.manage`
  to every one that holds `Device.manage`, which manages sites today. Organization Admin
  continues to equal the ceiling.
- **FR-019**: Every change to entities, types, placements and points MUST record one
  audit event with the organization and the acting user. A request that changes nothing
  records none.
- **FR-020**: Entities, types, placements, points and history MUST be scoped to their
  organization. Tests MUST prove that another organization can neither read nor change
  them, and that a device can be placed only within its own organization.

**Boundaries**

- **FR-021**: The runtime MUST be unaffected: no change to ingestion, activation,
  commands, automations or any Laravel–Go contract.
- **FR-022**: The OpenAPI contract and `packages/api-client` MUST describe the new and
  changed operations, including the deprecated site compatibility view.
- **FR-023**: An entity MAY be a member of other entities outside its tree position, when
  the other entity's type may hold members of its type. A membership is dated (start and
  end), adds no path, time zone, placement or UNS presence, and is limited to one current
  membership per member and target type. Coverage (FR-016, FR-017) follows memberships one
  step only.

### Key Entities

- **Entity**: UUID, organization, type, parent (none for top level), display name, path
  name, optional description, time zone and location, up to 30 attributes, archived time.
- **Entity type**: organization, key, name, allowed parent types (including top level),
  member types it may hold, accepts devices, carries time zone, carries location, optional naming rule.
- **Placement**: device, entity, start (empty for "since before history was kept"), end.
- **Point**: device, parameter (stable UUID), entity, leaf name, start, end.
- **Membership**: member entity, group entity, start, end.
- **Entity change**: entity, kind (moved or renamed), old and new parent or path name,
  time, actor. Together with placements and points, this answers "as of" questions.
- **Preset**: a built-in, versioned definition of types and rules. It is not stored per
  organization; applying it copies its types.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a manager with no instructions builds a four-level
  manufacturing branch and a four-level building branch under one site, places a device,
  and moves one of its parameters to another entity in under 10 minutes.
- **SC-002**: After the migration, every device in the demo organization has the same
  reporting time zone as before, and a fixed-period consumption total for every counter
  parameter is unchanged.
- **SC-003**: In an organization with 100,000 entities and 20,000 placed devices, opening
  any branch shows its children in under 1 second, and a search by name or path returns
  in under 2 seconds.
- **SC-004**: The existing tests for the sites API, the site filters and the agent tools'
  `site_uuid` pass unchanged.
- **SC-005**: Built from the power distribution preset, a transformer monitor placed at
  `Western/KelaniyaSS/Feeder12/Transformer05`, with its oil temperature leaf named
  `OilTemperature`, shows that parameter at the path
  `Western/KelaniyaSS/Feeder12/Transformer05/OilTemperature`. After `Feeder12` is made a
  member of `KelaniyaDivision`, filtering devices by the division includes that monitor,
  and its path is unchanged.
- **SC-006**: API tests for every acceptance scenario and edge case pass on PostgreSQL,
  including cross-organization isolation, and the runtime's tests pass unchanged.

## Assumptions

- The hierarchy is not an access boundary. Anyone with `Entity.view` sees the whole tree.
  Restricting people to a branch ("this contractor sees only Building B") is a separate
  spec, because it touches every tenant query.
- Nothing is published over MQTT. UNS publication is a later spec. It needs an ADR,
  because constitution principle I keeps clients off the broker, and it will publish an
  immutable, versioned snapshot of these paths. That spec also covers approval of
  namespace changes, aliases for renamed paths, transport (JSON and/or Sparkplug B) and
  high availability.
- Data from business systems (ERP, CRM, work orders), calculated rollups (per-area
  totals, SAIDI and SAIFI) and points written by integrations are later specs. Points are
  defined so that a later spec can add sources other than a device parameter.
- Paths do not include the organization; a publisher adds its own prefix.
- Hierarchy edits take effect immediately, with no draft and publish, because the runtime
  does not execute the hierarchy (principle II applies to what the runtime runs).
- Dashboards change only through device time zones; entity-scoped panels are later work.
- The integration API and new agent tools are out of scope; the `site_uuid`
  compatibility in FR-015 is in scope.
- "Entities" is the working label in the product; planning may choose a different label
  for the UI. In some products (for example Home Assistant) an "entity" is a single
  sensor.
- The 12-level depth limit and the 100,000-entity scale target come from the utility
  requirements: their deepest path has seven levels, and a utility can have tens of
  thousands of transformers and meters.
