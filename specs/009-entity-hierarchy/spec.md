# Feature Specification: Entity Hierarchy

**Feature Branch**: `spec/009-entity-hierarchy`

**Created**: 2026-10-14

**Updated**: 2026-11-25 (re-read against `main` at `ed6edee9` before planning)

**Status**: Draft, planned ([plan.md](plan.md)), clarifications answered

**Input**: User description: "I was thinking of creating a new model called entity and it
should be a self-related or self-referring model and you could create … endless leaves so
basically it's a recursively related Entity hierarchy. Which we could use to enforce the
standard [ISA-95] … the site area line asset would be types of entities … there could be
buildings floors zones so on and so forth which can be unrelated to this specific
standard, but still we don't know where a metric could end up in." Then: proceed with the
draft, taking into account a power distribution utility's requirements for a connected
enterprise platform. On 2026-11-25: connect buildings over OPC UA (spec 038) and have
their data land in this hierarchy, which stays independent of any protocol.

## Context

A device's only context today is an optional **site** (a flat, organization-wide list
with a required time zone, an address and coordinates; `Devices/Models/Site.php`) plus
up to 20 tags and 30 attributes. Nothing records that a pump is on Line 2 in the
Packaging area, or that one channel of an energy meter measures Floor 3. Industrial,
building and utility customers organize their data by a hierarchy of places and
equipment, and a Unified Namespace (UNS) publishes data under exactly that hierarchy.
Requirements from power distribution utilities ask for an enterprise semantic hierarchy
shaped like `Utility/Region/Substation/Feeder/Asset/Point`, governed naming standards,
topic lifecycle management and multi-region scale.

Since this draft was first written (2026-10-14), sites have gained readers that this
feature must keep working:

- **Integration applications follow a plant** (spec 030, ADR-032). An application's
  grant is a device list or a scope of 1–50 sites, resolved afresh on every request,
  feed page, webhook delivery and stream. `GET sites` in the integration API is served
  under the ability `entities:read`, which ADR-032 reserves for this feature's entities
  and paths, and ADR-032 names "entity branches after spec 009" as the next kind of
  scope.
- **Devices move between organizations of one billing account** (spec 031, ADR-039,
  ADR-041). A move archives the device in the source and creates a linked successor
  in the target with new parameter UUIDs. The mover may choose a site of the target
  organization; the source's site never travels, and the archived predecessor keeps
  its site.
- **Alerts** carry the subject device's site, and a gateway alert carries the one site
  all of its devices share.
- **Agent tools** `list_sites`, `find_devices` (`site_uuid`), `list_alerts`
  (`site_uuid`), `get_device_health` and `get_measurements` (the reporting time zone).
- **The portal** shows sites as **Locations**, a tab beside Geofences, with a site
  picker on the device form, a site filter and column in the device directory, the
  site on alerts, the target-site picker in a move, and site scopes on integration
  applications.
- **Building data over OPC UA** (spec 038) ships without this feature. Its last pull
  request proposes entities and placements from a server's folder structure and applies
  them only through this feature's own operations and rules. The hierarchy records
  nothing about the protocol a device uses.

This feature adds the hierarchy: an organization's tree of typed entities, rules that
hold it to a chosen standard, and the placement of devices and single parameters in it.
Sites become top-level entities. It publishes nothing over MQTT. A later spec builds
UNS publication on the paths defined here. Ingestion, activation, commands and
automations do not change.

**Terms**

- *Entity*: a node in the organization's hierarchy: a place, a grouping or a piece of
  equipment (a region, a building, a feeder, a pump).
- *Entity type*: what kind of entity it is (Site, Area, Line, Asset, Building, Floor,
  Zone, Substation, Feeder…). Types are defined per organization and carry rules about
  where an entity may sit and what it may hold.
- *Site type*: the one type per organization, with the key `site`, whose entities are
  the sites every existing site reader sees.
- *Path name*: an entity's short name for paths, unique among its siblings. *Path*: the
  path names from the top of the tree down to the entity, joined by `/`, for example
  `North/EastgateSS/Feeder12/Transformer05`.
- *Placement*: a device's position at an entity for a period of time. All of the device's
  parameters appear there unless a parameter placement says otherwise.
- *Parameter placement*: one device parameter placed at an entity under a leaf name,
  overriding the device's placement for that parameter.
- *Leaf name*: the last path segment of a parameter at its entity. It defaults to the
  parameter key.
- *Point*: a parameter as it appears at an entity, through a placement or a parameter
  placement, with its full path. (Billing's "data points" are stored readings counted
  per month; this feature never uses that phrase.)
- *Preset*: a built-in set of entity types and rules (manufacturing, buildings, power
  distribution).
- *Branch*: an entity and everything below it.
- *Membership*: a dated link that makes an entity a member of another entity outside its
  tree position (a transformer is a member of a division). It adds no path.
- *Coverage*: an entity's branch plus the branches of its current members.
- *Hierarchy operations*: the create, place and check operations other features call
  (spec 038's hierarchy proposal), with the same rules, permissions and activity
  records as a person's edits.

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
  of the East division). Paths, time zones and the future UNS come only from the main
  tree; memberships widen filters and the explorer.

### Session 2026-11-25 (owner decisions)

- Q: Is the hierarchy part of the OPC UA connector? → A: No. It stays this spec and is
  independent of any protocol. Spec 038 ships without it; only 038's last pull request
  (a reviewed proposal of entities and placements from the server's folder structure)
  needs this feature, through its own operations (FR-024, FR-025).

### Session 2026-11-25 (planning)

Raised by `/speckit-clarify` on 2026-11-25. All four were answered by the owner the same day.

- Q1: Should integration applications be able to follow an entity branch, not only a
  site? (A site is itself an entity of the Site type, so a site scope already covers its
  whole branch.) → A (owner, 2026-11-25): yes. A grant scope may name entities of any
  type (one floor, a line, a feeder, a region spanning several sites), and
  `GET entities` and each point's path are served under `entities:read`, as ADR-032
  reserved. It is the last pull request (FR-026).
- Q2: When a device moves to another organization, where does the successor go in the
  hierarchy? → A (owner, 2026-11-25): the mover may choose any entity of the target that
  accepts devices (the site picker becomes an entity picker; `site_uuid` keeps working).
  The predecessor's placement ends at cutover; parameter placements never travel
  (FR-027).
- Q3: What is the hierarchy called in the portal? → A (owner, 2026-11-25):
  **Hierarchy**, its own item under Devices, replacing the **Locations** tab; API and
  permissions say "entity".
- Q4: Should a billing plan limit how many entities an organization may have? → A
  (owner, 2026-11-25): no plan allowance; one installation-wide ceiling of 100,000
  entities per organization (the scale target), set by the operator.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build the organization's hierarchy (Priority: P1)

An organization manager opens **Hierarchy**, starts from a preset (or from nothing), and
builds the tree: creates entities of a type under a parent, renames them, moves branches
and archives entities. The tree refuses anything that breaks the type rules.

**Why this priority**: everything else (placements, time zones, the explorer, grants
and the future UNS) hangs off the tree.

**Independent Test**: in the local stack, apply the manufacturing preset and create
`Riverside plant` (Site) → `Packaging` (Area) → `Line 2` (Line) → `Filler pump P-201`
(Asset). Try to create a Line at the top level: refused, naming the allowed parent types.
Move `Line 2` under another area: its path changes and the move is recorded.

**Acceptance Scenarios**:

1. **Given** an organization opens **Hierarchy** for the first time, **Then** its existing
   sites are already there as Site entities (US3), and the manager can apply a preset or
   define types themselves (US5).
2. **Given** types with rules, **When** a manager adds an entity under a parent, **Then**
   only the types allowed there are offered, and the API refuses any other type with a
   field error that names the allowed types.
3. **Given** a manager enters a name, **Then** a path name is suggested from it
   (`Eastgate SS` → `EastgateSS`). The path name must follow the character rules
   (FR-002) and the type's naming rule, if any, and must be unique among siblings
   ignoring case.
4. **Given** a manager moves an entity, **Then** the move is refused when the new parent
   is the entity itself or one of its descendants, when a type rule forbids it, or when
   the branch would go deeper than the maximum depth. Otherwise the whole branch moves,
   and the confirmation first states how many entities and points get a new path, how
   many devices change site or time zone, and which integration applications gain or
   lose devices because of it.
5. **Given** a large tree, **Then** each level loads when it is expanded, wide levels are
   paginated, and the tree can be searched by name or path.
6. **Given** an entity with no children and no current placements or parameter
   placements, **When** it is archived, **Then** it leaves the tree and every picker but
   keeps its history, and it leaves every application scope that names it (as a deleted
   site does today). An entity that still has children or current placements cannot be
   archived until they are moved or ended.
7. **Given** a Division type that may hold Feeder members, **When** a manager makes
   `Feeder12` a member of `East Division`, **Then** the division's coverage includes
   Feeder12's branch, and Feeder12's path, parent and time zone do not change.

---

### User Story 2 - Place devices and single parameters (Priority: P1)

A manager places a device at an entity, from the device page or the entity page. Its
parameters appear there under their keys. They can send one parameter somewhere else (a
channel of a multi-channel meter) and rename leaves.

**Why this priority**: the tree is only useful once data lives in it; this is the "we
don't know where a metric could end up" requirement.

**Independent Test**: place a device at `Filler pump P-201`; the entity shows its
parameters as `RiversidePlant/Packaging/Line2/FillerPumpP201/<key>`. Place a
three-channel meter at `Zone B` and move channel 3's energy to `Floor 3`: Floor 3 shows
it and Zone B no longer does. Place a second device with a `temperature` parameter at
the same entity as the first: refused, naming the clash; accepted after renaming its
leaf.

**Acceptance Scenarios**:

1. **Given** a device, **When** it is placed at an entity whose type accepts devices,
   **Then** every parameter of the device's current profile revision appears at that
   entity under its key, except parameters that have their own parameter placement.
2. **Given** a device's parameter, **When** a manager places it at another entity with an
   optional leaf name, **Then** it appears only there.
3. **Given** a placement or parameter placement would give two points, or a point and a
   child entity, the same name at one entity, **Then** it is refused with the clashing
   names listed, and the manager can rename leaves in the same step.
4. **Given** a placed device, **When** it is moved to another entity, **Then** its
   previous placement ends at that moment and the new one starts. Its parameter
   placements stay where they are unless they are moved too.
5. **Given** the device page, **Then** it shows the device's path as a breadcrumb and,
   for each parameter placed elsewhere, that parameter's path. The device form's site
   picker becomes an entity picker.
6. **Given** a device is archived (by a person or by a move to another organization),
   **Then** its placement and parameter placements end at the archive time. For the
   site compatibility view and application scopes, an archived device still counts
   where its last placement was, as an archived device keeps its site today.
7. **Given** the device directory or the alerts list, **When** it is filtered by an
   entity, **Then** it includes devices placed anywhere in that entity's coverage: its
   branch and the branches of its members.

---

### User Story 3 - Sites become entities without changing any totals (Priority: P1)

Existing sites become top-level entities of the Site type, and every device that had a
site is placed at it. Consumption totals over days and months stay exactly as they were,
and everything that reads sites today keeps working, including integration
applications that follow a site.

**Why this priority**: two parallel location concepts would confuse people, consumption
totals must not move under anyone's feet, and an application that follows a plant must
not gain or lose a device because of a migration.

**Independent Test**: in the seeded demo organization, record each device's reporting
time zone, one counter increase for a fixed period, and the device set each integration
application resolves; run the migration; compare. All are identical. Filter devices by a
site, and call the agent tools `find_devices` and `list_alerts` with a `site_uuid`: the
results match those from before.

**Acceptance Scenarios**:

1. **Given** an organization with sites, **After** the migration, **Then** each site is a
   top-level entity of the Site type with the same UUID, name, time zone, address and
   coordinates, and each device with a site is placed at it (archived devices included).
   That placement has no start time, meaning "since before placement history was kept".
2. **Given** any device, **Then** its reporting time zone is the time zone of the nearest
   entity at or above its placement that sets one, else the organization's, else UTC.
   For every migrated device this equals its time zone before the migration.
3. **Given** clients of sites today (the portal sites API, the device view's `site`, the
   `site_uuid` filters on devices and alerts, the alert's `site`, the device form's and
   the move's `site_uuid`, integration grants by site and the integration API's
   `GET sites` and device `site`, and the agent tools `list_sites`, `find_devices`,
   `list_alerts` and `get_device_health`), **Then** they keep working. A device's site is
   the nearest Site-type entity at or above its placement.
4. **Given** an integration application whose scope names a site, **Then** it covers
   every device placed anywhere in that site's branch, so a device placed at a zone
   inside the site stays granted. For every application, the resolved device set right
   after the migration equals the one before.
5. **Given** the portal, **Then** the **Locations** tab is replaced by **Hierarchy**, and
   creating a site through the sites API creates a top-level Site entity.

---

### User Story 4 - Explore data by entity (Priority: P2)

An operator browses the tree and sees, for any entity, the points at it and below it,
with their latest values. This is the in-product view of the future namespace.

**Why this priority**: it makes the hierarchy useful to people who don't manage it, and
it shows customers the namespace before any UNS publication exists.

**Independent Test**: open `Riverside plant` → `Packaging` → `Line 2` and include the
branch. The pump's points are listed with value, unit and age, and a stale value is
labelled. Copy a point's full path and open its history.

**Acceptance Scenarios**:

1. **Given** an entity, **Then** its own points list leaf name, full path, device,
   latest value, unit, quality and freshness. Stale values are labelled with their age,
   and missing values are shown as unknown, never as zero.
2. **Given** **Include branch** is on, **Then** points of every descendant appear with
   their path relative to the entity, paginated.
3. **Given** a point, **Then** the user can copy its full path and open the parameter's
   history on the device.

---

### User Story 5 - Define the standard: types, rules and presets (Priority: P2)

A person responsible for naming standards defines entity types: where each may sit,
whether devices may be placed on it, whether it carries a time zone and a location, and
an optional naming rule. Presets give a starting point, and presets can be combined (a
plant site can hold both production areas and an office building).

**Why this priority**: this is how the hierarchy is held to ISA-95, a building standard
or a utility's asset naming standard, instead of drifting. Utility requirements tend to
list the same kind of path in several different shapes, and a rule set catches that.

**Independent Test**: apply the manufacturing preset, then the buildings preset; one Site
type now allows both Area and Building beneath it. Add a naming rule `Feeder<number>` to
Feeder. Creating `feeder-12` is refused with the rule's description and example, and
`Feeder12` is accepted.

**Acceptance Scenarios**:

1. **Given** a preset, **When** it is applied, **Then** its types and rules are added.
   Types already present by key are merged: their allowed parent types and member types
   are combined, and nothing else about them changes.
2. **Given** a type, **Then** it has a name, a key, allowed parent types (which may
   include "top level"), the types it may hold as members, whether devices may be placed
   on it, whether it carries a time zone and a location, and an optional naming rule with
   a pattern, an example and a description.
3. **Given** a rule changes, **Then** no entity is moved, renamed or removed. Entities
   that now break a rule are listed as **Outside current rules** and keep working; new
   entities, moves and renames must follow the current rules.
4. **Given** a type is in use, **Then** it can be renamed but not deleted. The Site type
   can be renamed and its rules changed, but its key and its time zone and location
   stay, because the site compatibility view needs them.

---

### User Story 6 - Where was it, and when (Priority: P3)

A manager sees the history of any device or entity: where it was placed, when it moved,
and what it used to be called. The system can say which devices and points were in a
branch at any past moment, which later rollups and UNS publication need.

**Why this priority**: none of v1's views need history yet, but recording it from day
one is what lets later per-area totals stay correct when equipment moves.

**Independent Test**: move a device from Line 1 to Line 2, rename Line 2, and move Line 2
under another area. The device page lists both placements with their times. The entity
page lists the move and the rename. Asking for Line 1's branch at a time before the move
includes the device; asking after the move does not.

**Acceptance Scenarios**:

1. **Given** a device, **Then** its page lists its placements and parameter placements
   with start and end times and who made each change.
2. **Given** an entity, **Then** its page lists its moves (old parent, new parent),
   renames (old path name, new path name) and type changes, with time and actor.
3. **Given** an entity and a past time, **When** the branch is requested as of that time,
   **Then** the result holds the devices and points placed in that branch at that time,
   using the tree as it was then.

---

### User Story 7 - Other features build the hierarchy through its own rules (Priority: P2)

Another feature (first, spec 038's hierarchy proposal from an OPC UA server's folders)
prepares many entities and placements at once. It checks the whole batch against the
organization's types and rules without saving anything, shows a person what would be
refused and why, and applies what the person accepts through the same operations a
manager uses in the portal.

**Why this priority**: spec 038's last pull request depends on it, and it is how any
later import (a spreadsheet, a building model) stays inside the organization's standard.

**Independent Test**: with the buildings preset applied, check a batch that creates one
building, four floors and sixteen zones (each new entity naming a new parent by a
reference inside the batch) and places twenty devices. The check saves nothing and
reports every item as accepted. Change one zone's parent type to a type that may not
hold zones and check again: that zone and the placements under it are reported refused
with the rule, the rest accepted. Apply the accepted batch: the entities and placements
exist, the activity log shows one entry per change with the acting person, and no entity
or placement holds anything about OPC UA.

**Acceptance Scenarios**:

1. **Given** a batch of entity creations (each with a type, a display name, a path name
   and a parent that is an existing entity or an earlier item of the batch) and
   placements (a device and an entity or an item), **When** it is checked, **Then**
   nothing is saved, and each item is reported accepted or refused with the rule it
   breaks; an item whose parent is refused is refused for that reason.
2. **Given** a checked batch, **When** it is applied by a person with `Entity.manage`,
   **Then** it is applied whole or not at all, re-checked at that moment, and every
   change is recorded as if the person had made it in the portal.
3. **Given** an entity or placement made through these operations, **Then** it is an
   ordinary one: editable, movable and unaffected if the feature that proposed it is
   later removed.
4. **Given** the hierarchy, **Then** no entity, type, placement or history record holds
   a protocol, a node address or a reference to another feature's records; a caller
   that needs to remember where an item came from keeps that in its own records.

### Edge Cases

- A profile upgrade adds a parameter whose key clashes with an existing name at the
  placement entity: the new parameter is shown as **Not placed: name clash** on the
  device and entity pages until a leaf is renamed. Activation, ingestion and commands are
  never blocked by the hierarchy.
- A parameter placement refers to a parameter the device's current profile revision no
  longer has: it is shown as **Not in the current configuration**, kept for history, and
  can be ended.
- A placement made while a device is only registered (no configuration yet) is allowed;
  its points appear once the device has a profile revision.
- Two managers move entities at the same moment in a way that would form a cycle (A under
  B and B under A): the second move is refused.
- A move or a new entity would exceed the maximum depth: refused, stating the limit.
- An archived entity does not hold its path name. Restoring it when that name has been
  taken requires a new path name.
- An entity that never had children, placements or parameter placements can be deleted
  outright; any other entity is archived instead.
- Deleting a site through the sites API: refused while the site has child entities.
  Otherwise the placements at it end (those devices fall back to the organization's time
  zone, as today), the site entity is archived, and it leaves every application scope
  (reason `site_deleted`, as today).
- Moving a branch takes devices into or out of a site, or into or out of an entity an
  application follows: those applications gain or lose the devices at once, as when a
  device's site changes today, and the move's confirmation names them first.
- A device moved to another organization: the predecessor's placement ends at cutover
  and the successor starts at the entity the mover chose, or unplaced. Parameter
  placements stay with the predecessor's history; the successor's parameters have new
  UUIDs (spec 031).
- A type that no longer accepts devices still has devices placed on it: they stay and
  are listed as **Outside current rules**.
- An organization deleted under spec 006 loses its entities, types and history, just as
  sites are removed today. The deletion preview counts entities where it counted sites.
  Entities do not stop an organization from counting as empty.
- An entity may be a member of several entities, but of only one entity of each type at a
  time (one division). Making it a member of a second division ends the first
  membership.
- An entity cannot be a member of itself, of one of its ancestors or of one of its
  descendants; the tree already relates them.
- Coverage follows memberships one step only: a member's own memberships are not
  followed, so groupings cannot loop.
- Moving a member in the main tree keeps its memberships. Archiving either side ends the
  membership at that time.
- A display name in any script (for example Japanese or Arabic) is allowed; only path
  names are restricted (FR-002), and the suggested path name is left empty when it
  cannot be derived. A migrated site whose name gives no path name, or a clashing one,
  gets a generated one (`Site1`, `Site2`…) that a manager can change.
- An organization reaches the entity ceiling (Q4, 100,000 by default): creating or applying a batch that
  would pass it is refused, naming the ceiling.

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
- **FR-004**: Creating, renaming, retyping, moving, archiving and deleting entities MUST
  enforce FR-001 to FR-003 and the type rules at the moment of the change, refusing with
  a field error that names the broken rule.
- **FR-005**: The tree MUST load level by level, paginate wide levels and support search
  by display name, path name and path.

**Types and presets**

- **FR-006**: Entity types MUST be defined per organization, each with a name, a key,
  allowed parent types (with "top level" as an option), the types it may hold as members,
  whether devices may be placed on it, whether it carries a time zone and a location, and
  an optional naming rule (pattern, example, description). Every organization MUST have
  a Site type (key `site`, top level allowed, accepts devices, carries a time zone and a
  location); its key and those two carried fields cannot change.
- **FR-007**: The product MUST offer at least three presets. **Manufacturing (ISA-95)**:
  Site → Area → Line → Cell → Asset, where Asset may also sit under Line or Area.
  **Buildings**: Site → Building → Floor → Zone → Room, where Room may also sit under
  Floor. **Power distribution**: Region → Substation → Feeder → Distribution transformer,
  Recloser, Ring main unit, Switchgear or Capacitor bank, with Meter under a distribution
  transformer or a feeder, and Division under Region holding Substation, Feeder and
  Distribution transformer members. Applying a preset MUST merge by type key as US5
  describes, and MUST NOT change any entity.
- **FR-008**: Rule changes MUST apply to later changes only. Entities that break a
  current rule MUST be listed as **Outside current rules** and keep working. A type in use
  MUST NOT be deletable.

**Placements and parameter placements**

- **FR-009**: A device MUST have at most one current placement, at an entity of its own
  organization whose type accepts devices. Every placement records its start, and its end
  when the device is moved, unplaced or archived.
- **FR-010**: A device parameter MUST have at most one current parameter placement. It
  places the parameter at an entity whose type accepts devices, under a leaf name, and
  overrides the device's placement for that parameter. Parameter placements reference
  the parameter's stable UUID.
- **FR-011**: Leaf names MUST default to the parameter key, follow the path-name
  character rules and be unique at their entity across all leaf names and child path
  names. A placement or parameter placement that would clash MUST be refused with the
  clashes listed. A clash that arises later (from a profile upgrade) MUST be reported as
  **Not placed: name clash** and MUST NOT block activation, ingestion or commands.

**History**

- **FR-012**: The system MUST keep every placement, parameter placement, membership,
  parent change, type change and path-name change with its time and actor. It MUST be
  able to answer which devices and points were in a branch at a past time, using the
  tree as it was at that time.

**Sites, time zones and filters**

- **FR-013**: A device's reporting time zone MUST be the time zone of the nearest entity
  at or above its current placement that sets one, else the organization's, else UTC.
  Parameter placements do not change a device's time zone. An archived device keeps the
  time zone of its last placement.
- **FR-014**: A migration MUST turn every site into a top-level entity of the Site type,
  keeping its UUID, name, time zone, address and coordinates, and place each device with
  a site (archived devices included) at it with no start time. For every device, the
  reporting time zone after the migration MUST equal the one before, and for every
  integration application the resolved device set MUST equal the one before.
- **FR-015**: Existing site clients MUST keep working through a compatibility view: the
  portal sites API, the device view's `site` and `site_uuid` on the device form, the
  `site_uuid` filters on devices and alerts, the alert's `site`, the move's
  `site_uuid`, the integration API's `GET sites` and device `site`, and the agent tools
  `list_sites`, `find_devices`, `list_alerts` and `get_device_health`. A device's site is
  the nearest Site-type entity at or above its placement (its last placement when
  archived). The compatibility view MUST be documented as deprecated, with its
  replacement.
- **FR-016**: The device directory and the alerts list MUST accept an entity filter that
  covers the entity's coverage: its whole branch and the branches of its current
  members.

**Explorer**

- **FR-017**: An entity's page MUST list its points (and, on request, the points of its
  coverage, each with its main-tree path) with leaf name, full path, device, latest
  value, unit, quality and freshness, following the existing rules for stale and missing
  values.

**Access, audit and isolation**

- **FR-018**: Three permissions MUST govern the feature: `Entity.view` (see the tree and
  the explorer), `Entity.manage` (entities, placements and parameter placements) and
  `EntityType.manage` (types, rules and presets). The migration MUST grant `Entity.view`
  to every role and permission ceiling that holds `Device.view`, and `Entity.manage` and
  `EntityType.manage` to every one that holds `Device.manage`, which manages sites today.
  Organization Admin continues to equal the ceiling. The site compatibility view keeps
  its current permissions (`Device.view` to read, `Device.manage` to change).
- **FR-019**: Every change to entities, types, placements, parameter placements and
  memberships MUST record one activity log entry (spec 024) with the organization and
  the acting user, through whichever route it came. A request that changes nothing
  records none.
- **FR-020**: Entities, types, placements, parameter placements, memberships and history
  MUST be scoped to their organization. Tests MUST prove that another organization can
  neither read nor change them, that a device can be placed only within its own
  organization, and that no batch item can name another organization's entity or
  device.

**Boundaries**

- **FR-021**: The runtime MUST be unaffected: no change to ingestion, activation,
  commands, automations or any Laravel–Go contract. The runtime keeps receiving only a
  time zone for counter increases.
- **FR-022**: The OpenAPI contract and `packages/api-client` MUST describe the new and
  changed operations, including the deprecated site compatibility view.
- **FR-023**: An entity MAY be a member of other entities outside its tree position, when
  the other entity's type may hold members of its type. A membership is dated (start and
  end), adds no path, time zone, placement or UNS presence, and is limited to one current
  membership per member and target type. Coverage (FR-016, FR-017) follows memberships one
  step only.

**Hierarchy operations for other features**

- **FR-024**: The hierarchy MUST offer operations that other features call in-process:
  create an entity, place a device, and check a batch of entity creations and placements
  (up to 2,000 items, items able to refer to earlier items) against the current rules
  without saving, reporting each item accepted or refused with the rule. Applying a
  batch MUST be all or nothing, re-check at that moment, require the acting person's
  `Entity.manage`, and record activity exactly as the portal does (FR-019).
- **FR-025**: No hierarchy record (entity, type, placement, parameter placement,
  membership, history) MAY hold a protocol, a node address or a key into another
  feature's records. Callers keep provenance in their own records.

**Integration applications and moves**

- **FR-026** (Q1): An integration application's scope MAY name entities of
  any type; it covers every device placed (or, if archived, last placed) in their
  branches, resolved afresh as ADR-032 requires. A site scope is an entity scope over
  Site-type entities. Under `entities:read`, the integration API MUST serve the
  application's visible entities with their paths and each granted device's points with
  their paths. Archiving an entity removes it from every scope as `siteDeleted` does
  today.
- **FR-027** (Q2): A move to another organization (spec 031) MUST let the
  mover choose any entity of the target that accepts devices for each successor,
  accepting `site_uuid` as before. Cutover MUST end the predecessor's placement and
  parameter placements, and place the successor at the chosen entity if it still
  belongs to the target and accepts devices, else leave it unplaced.

### Key Entities

- **Entity**: UUID, organization, type, parent (none for top level), display name, path
  name, optional description, time zone and location, up to 30 attributes, archived time.
- **Entity type**: organization, key, name, allowed parent types (including top level),
  member types it may hold, accepts devices, carries time zone, carries location,
  optional naming rule.
- **Placement**: device, entity, start (empty for "since before history was kept"), end.
- **Parameter placement**: device, parameter (stable UUID), entity, leaf name, start,
  end.
- **Membership**: member entity, group entity, start, end.
- **Entity change**: entity, kind (moved, renamed or retyped), old and new parent, path
  name or type, time, actor. Together with placements and parameter placements, this
  answers "as of" questions.
- **Preset**: a built-in, versioned definition of types and rules. It is not stored per
  organization; applying it copies its types.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a manager with no instructions builds a four-level
  manufacturing branch and a four-level building branch under one site, places a device,
  and moves one of its parameters to another entity in under 10 minutes.
- **SC-002**: After the migration, every device in the demo organization has the same
  reporting time zone as before, a fixed-period counter increase for every counter
  parameter is unchanged, and every integration application resolves the same devices.
- **SC-003**: In an organization with 100,000 entities and 20,000 placed devices, opening
  any branch shows its children in under 1 second, a search by name or path returns in
  under 2 seconds, and resolving a 50-entity application scope adds under 50 ms to a
  request.
- **SC-004**: The existing tests for the sites API, the site filters, grants by site,
  moves with a target site and the agent tools' `site_uuid` pass unchanged.
- **SC-005**: Built from the power distribution preset, a transformer monitor placed at
  `North/EastgateSS/Feeder12/Transformer05`, with its oil temperature leaf named
  `OilTemperature`, shows that parameter at the path
  `North/EastgateSS/Feeder12/Transformer05/OilTemperature`. After `Feeder12` is made a
  member of `EastDivision`, filtering devices by the division includes that monitor,
  and its path is unchanged.
- **SC-006**: API tests for every acceptance scenario and edge case pass on PostgreSQL,
  including cross-organization isolation, and the runtime's tests pass unchanged.
- **SC-007**: A batch of 21 entity creations and 20 placements is checked in under 2
  seconds with nothing saved, and applied whole; a test proves no hierarchy table has a
  column for a protocol or a node address.

## Assumptions

- The hierarchy is not an access boundary for people. Anyone with `Entity.view` sees the
  whole tree. Restricting people to a branch ("this contractor sees only Building B") is
  a separate spec, because it touches every tenant query. Integration application scopes
  (FR-026) are the only branch-shaped access, and they already exist for sites.
- Nothing is published over MQTT. UNS publication is a later spec. It needs an ADR,
  because constitution principle I keeps clients off the broker, and it will publish an
  immutable, versioned snapshot of these paths. That spec also covers approval of
  namespace changes, aliases for renamed paths, transport (JSON and/or Sparkplug B) and
  high availability.
- Data from business systems (ERP, CRM, work orders), calculated rollups (per-area
  totals, SAIDI and SAIFI) and points written by integrations are later specs.
  Parameter placements are defined so that a later spec can add sources other than a
  device parameter.
- Paths do not include the organization; a publisher adds its own prefix.
- Hierarchy edits take effect immediately, with no draft and publish, because the runtime
  does not execute the hierarchy (principle II applies to what the runtime runs).
- Dashboards change only through device time zones; entity-scoped panels are later work.
- New agent tools are out of scope; the `site_uuid` compatibility in FR-015 is in scope.
- Gateways, adapters and data sources are not placed; their devices are. A gateway
  alert's site keeps coming from its devices.
- Moving entities or whole branches to another organization is out of scope, as spec
  031 left it.
- "Entity" is the API and permission term. In some products (for example Home Assistant)
  an "entity" is a single sensor, so the portal label is chosen separately (Q3).
- The 12-level depth limit and the 100,000-entity scale target come from utility
  requirements: their deepest path has seven levels, and a utility can have tens of
  thousands of transformers and meters.
