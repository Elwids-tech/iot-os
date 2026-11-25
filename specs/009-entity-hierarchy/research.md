# Research: Entity Hierarchy

Decisions behind [plan.md](plan.md). Each records what was chosen, why, and what else
was considered. Code references are to `main` at `ed6edee9` (2026-11-25).

## R1. One new domain, `Entities`; sites stay a view in `Devices`

- **Decision**: `apps/api/app/Domain/Entities` holds the models, services, permissions,
  controllers and routes of the hierarchy. `Devices` keeps `SiteController` and the
  site fields of devices, now reading and writing through `Entities` services. Other
  domains (Integrations, Automation, Agents, DeviceAdapters) call `Entities` services,
  never its tables.
- **Rationale**: the hierarchy has its own permissions, history and rules, and spec 038
  needs a boundary it can call (R13). Leaving site endpoints where clients find them
  keeps every route, test and contract of the compatibility view unchanged.
- **Alternatives**: growing `Devices` (it already holds moves, onboarding and readings;
  the hierarchy would blur its boundary); moving `SiteController` into `Entities` (route
  and test churn for no behaviour).

## R2. Tree storage: parent pointer, closure table, stored path

- **Decision**: `entities.parent_id` is the source of truth. `entity_closure`
  (`ancestor_id`, `descendant_id`, `depth`, a row per pair including the entity itself)
  answers branch and ancestor questions with one indexed join. `entities.depth` and
  `entities.path` (path names joined by `/`) are stored and rewritten for the branch on
  a rename or move, in the same transaction.
- **Rationale**: SC-003 needs branch filters over 20,000 placed devices and search by
  path over 100,000 entities. With 12 levels the closure holds at most ~1.3 million
  rows for the scale target. A move rewrites `branch size × depth` closure rows, which
  stays in the low tens of thousands for any branch a person moves in practice.
- **Alternatives**: `ltree` (labels cannot contain `.`, which path names allow, and it is
  a new extension for one feature); recursive CTEs alone (every directory filter and
  grant resolution would walk the tree); a materialized path alone (branch filters by
  prefix need escaping and case rules, and ancestor lookups parse strings).

## R3. Structural changes are serialized per organization

- **Decision**: every operation that changes the tree's shape (create, move, archive,
  restore, delete, retype, batch apply) takes `pg_advisory_xact_lock` on a key derived
  from the organization id before reading what it checks. Sibling path names are
  protected by a partial unique index on `(organization_id, coalesce(parent_id, 0),
  lower(path_name)) where archived_at is null`. Leaf names at one entity are checked
  under a per-entity advisory lock.
- **Rationale**: the cycle edge case (A under B while B moves under A) and the depth
  limit are only safe if the second change sees the first. Hierarchy edits are rare and
  quick, so one lock per organization costs nothing users notice; ingestion never takes
  it.
- **Alternatives**: `SERIALIZABLE` transactions (retries in every caller); row locks on
  both ancestors' chains (complex, still racy across branches).

## R4. Sites become entities of a reserved Site type

- **Decision**: every organization gets an entity type with key `site` (top level
  allowed, accepts devices, carries time zone and location), created by the migration
  for existing organizations and otherwise by `EntityTypes::ensureSite` the first time
  anything reads or writes the organization's hierarchy or sites (so no organization
  creation path changes). Presets that define a
  `site` type merge into it. The migration in pull request 2:
  1. creates one top-level `site` entity per row of `sites`, same UUID, name as display
     name, a path name from R11 (`Site1`, `Site2`… when it gives nothing or clashes),
     time zone, address, coordinates, `created_by`, and a `created` change dated with the
     site's `created_at`;
  2. points `devices.site_id` and `device_move_devices.target_site_id` (renamed
     `target_entity_id`) at the new entity ids, swapping the foreign keys to `entities`;
  3. opens a placement with no start for every device with a site, archived devices
     included, and fills `devices.entity_id` (R5);
  4. renames `sites` to `legacy_sites`, kept read-only until pull request 8 drops it.
     `down()` restores `sites` and the foreign keys from it.
- **Rationale**: same UUIDs keep every stored reference valid (application
  `site_uuids`, URLs, agent conversations). Re-pointing `site_id` instead of removing it
  keeps the device directory, alert queries, agent tools and the integration device
  read working with a changed relation only (`Device::site()` now belongs to `Entity`).
  Keeping the old table one release lets the pilot roll back without data loss.
- **Alternatives**: keeping `sites` and linking entities to them (two sources of time
  zone and name, forever); dropping `site_id` and resolving the site through the tree
  on every read (many readers rewritten at once, slower lists).

## R5. Two derived device columns: `entity_id` and `site_id`

- **Decision**: `devices.entity_id` is the device's *anchor*: the entity of its current
  placement, or of its last placement when it is archived, else null.
  `devices.site_id` is the nearest Site-type entity at or above the anchor. Both are
  written only by `Entities\Services\DeviceAnchors::refresh(entity ids | device ids)`,
  called in the same transaction by placements, archives, moves of a branch, retypes
  and site archiving. Nothing else writes them.
- **Rationale**: every reader that filters or groups by site or branch (directory,
  alerts, grants, streams re-resolving every 30 s) stays one indexed join. Keeping
  archived devices at their last anchor preserves today's behaviour, where an archived
  predecessor keeps its site and an application following that site still reads its
  history (ADR-039, spec 030).
- **Alternatives**: resolving from `entity_placements` on each read (a join plus a
  "last placement" subquery everywhere); ending placements on archive without an anchor
  (applications would silently lose access to archived devices' history).

## R6. Reporting time zone

- **Decision**: `Device::reportingTimezone()` keeps its signature. It reads the nearest
  ancestor-or-self of the anchor with a time zone (one closure query, or one query per
  page through `DeviceAnchors::timezones(devices)` for lists), else the organization's,
  else UTC. The runtime keeps receiving only the `timezone` parameter of the counter
  increase.
- **Rationale**: the four callers (`DeviceReadings::increase`, `DeviceView`,
  `GetMeasurements`, `GetDeviceHealth`) and the portal's consumption panels keep working
  unchanged; migrated devices sit directly at their old site, whose zone is required, so
  the result is identical (SC-002).
- **Alternatives**: storing a resolved zone on devices (a third derived column for a
  value that is cheap to read).

## R7. Archives and moves between organizations

- **Decision**: archiving a device (`DeviceController::archive`) and cutover of a move
  (`MoveCutover`) end the device's placement and parameter placements with
  `end_reason` `device_archived` or `moved_out`; the anchor stays (R5). The move preview
  accepts `devices.*.entity_uuid` beside `site_uuid` (one of them), checks the entity
  belongs to the target and accepts devices, and stores `target_entity_id`. Cutover
  places the successor there if both still hold, else leaves it unplaced. Parameter
  placements never travel: the successor's parameters have new UUIDs (spec 031).
- **Rationale**: matches today's move semantics (the source's site never travels, the
  target is chosen) and spec 031's rule that organization-scoped choices are re-made in
  the target. The owner chose this on 2026-11-25 (Q2).
- **Alternatives**: mapping the source path into the target (organizations have
  different trees; silent misplacement); carrying parameter placements through
  `DeviceProfileCopy.parameter_map` (the target entity is unknown).

## R8. Grants by site resolve by branch

- **Decision**: `ApplicationGrant` resolves a site scope as the devices whose anchor is
  in the branch of any scoped entity:
  `devices.entity_id in (select descendant_id from entity_closure where ancestor_id in
  (…))`. `covers()` uses the same rule through the device's anchor and the closure.
  Archiving an entity calls `ApplicationGrants::entityArchived`, the generalization of
  `siteDeleted` (same revision bumps, token revocation, webhook cancellation and audit
  reason `site_deleted` for Site-type entities, `entity_archived` otherwise).
- **Rationale**: a site scope must keep a device granted when a manager places it at a
  zone inside the site (US3 AS4). Right after the migration every device sits directly
  at its site, so every application resolves the same devices (FR-014).
- **Alternatives**: keeping `whereIn('site_id')` (correct for devices below a site only
  while sites are never nested; branch semantics are what ADR-032 promised).

## R9. Points are computed, not stored

- **Decision**: the points at an entity are computed on read by `EntityPoints`:
  for each current placement there, the parameters of the device's current profile
  revision (the list `DeviceView` builds for the device) minus those with a current
  parameter placement elsewhere, named by the placement's `leaf_names` override or the
  key; plus each current parameter placement there under its leaf name. When two names
  collide, the earlier-started one keeps the name and the later one is reported **Not
  placed: name clash**; a child entity's path name always wins. Writes check the same
  set under the entity's lock and refuse clashes (FR-011).
- **Rationale**: profile upgrades change parameter lists without the hierarchy taking
  part (activation is never blocked), so a stored copy would drift. Pages are at most 50
  points, so computing is cheap.
- **Alternatives**: a stored `entity_points` table maintained on activation (couples the
  hierarchy to activation, against FR-011's "never blocks").

## R10. Naming rules are templates, not user regular expressions

- **Decision**: a type's naming rule is a template of literal path-name characters and
  the placeholders `<number>` (one or more digits), `<letter>` (one ASCII letter),
  `<letters>` (one or more) and `<text>` (one or more path-name characters), compiled by
  the platform into an anchored, case-sensitive pattern. The rule's example must match
  it when it is saved.
- **Rationale**: utility naming standards are of this shape (`Feeder<number>`,
  `TX<number>`), and accepting regular expressions from tenants would expose the API to
  catastrophic backtracking and to unreadable rules.
- **Alternatives**: PCRE with a backtrack limit (still unreadable to the people who own
  the standard); no naming rules (US5 needs them).

## R11. Path names suggested from display names

- **Decision**: `PathNames::suggest(name)`: ASCII-fold (`Str::ascii`), split on anything
  that is not a letter or digit, capitalize each word's first letter, join, and cut at
  64. `Filler pump P-201` → `FillerPumpP201`, `Eastgate SS` → `EastgateSS`. An empty
  result is left empty in the portal; the migration and batch items without a path name
  use `<TypeName><n>`.
- **Rationale**: matches the examples in the spec and produces names that are safe in
  MQTT topics and URLs later.
- **Alternatives**: slugs (`filler-pump-p-201`; readable, but utility standards use
  CamelCase); keeping spaces (unsafe for later topic paths).

## R12. History and "as of" queries

- **Decision**: `entity_changes` records `created`, `moved`, `renamed`, `retyped`,
  `archived`, `restored` and `deleted` with old and new values, time and `user_id`.
  Placements, parameter placements and memberships are their own history (start, end,
  who). `EntityHistory::branchAt(entity, time)` rebuilds each entity's parent at that
  time from the last `created` or `moved` change at or before it, walks the branch with
  a recursive query over that reconstructed parent set, and returns the placements and
  parameter placements open at that time. Migrated placements with no start count as
  open at any earlier time.
- **Rationale**: no v1 view needs "as of" at scale, so a correct, slower query is
  enough; later rollups can add a temporal closure table if they need speed.
- **Alternatives**: a temporal closure table now (doubles write cost for an unused
  speed); event sourcing the tree (out of proportion).

## R13. Hierarchy operations for other features (spec 038, research R16)

- **Decision**: `Entities\Services\HierarchyOperations`, resolved from the container,
  is the only way another domain changes the hierarchy:
  - `createEntity`, `placeDevice` and `endPlacement`, each with an acting `User`, the
    permission check, rules, activity record and derived columns of the portal route;
  - `check(Organization, HierarchyBatch): BatchResult` and
    `apply(Organization, HierarchyBatch, User): BatchResult`.

  A batch holds up to 2,000 items: entity creations (with a batch-local `ref`, a type
  key, a display name, an optional path name, and a parent that is an existing entity
  UUID or an earlier item's `ref`) and placements (a device UUID and an entity UUID or
  `ref`, optional leaf names). `check` runs the same code as `apply` inside a
  transaction that is always rolled back, with a savepoint per item so one refusal does
  not hide the next; items depending on a refused item are refused with
  `parent_refused`. `apply` re-runs the batch in one transaction and commits only if
  every item is accepted; otherwise it rolls back and returns the outcomes. Read
  helpers (`HierarchyQueries`: types with rules, an entity by path, children) let a
  caller propose types and reuse existing entities. Contract:
  [contracts/hierarchy-operations.md](contracts/hierarchy-operations.md).
- **Rationale**: running the real operations is the only way the check can never
  disagree with the apply (FR-024); savepoints are cheap in PostgreSQL, and activity
  entries written inside the rolled-back transaction vanish with it. All-or-nothing
  apply matches spec 038's review flow: the person drops what was refused and applies
  again. Nothing in the batch or the hierarchy carries provenance (FR-025); spec 038
  keeps it in `adapter_hierarchy_proposals`.
- **Alternatives**: a separate validator mirroring the rules (two codes paths that will
  drift); partial apply (a half-built building that the next proposal must reason
  about); a public HTTP batch endpoint now (no client needs it yet; it can wrap the same
  service later).
- **No feature switch**: the hierarchy is part of the product once pull request 3
  merges; spec 038's pull request 8 depends on that merge, not on a runtime flag.

## R14. Permissions and their backfill

- **Decision**: `EntityPermission` (`Entity.view`, `Entity.manage`) and
  `EntityTypePermission` (`EntityType.manage`) enums in the domain, seeded by
  `PermissionSeeder` for every guard but `mcp`, as `Device.move` is. A one-time
  `EntityPermissionBackfill` (the `DeviceMovePermissionBackfill` pattern) gives
  `Entity.view` to every role holding `Device.view` and the two manage permissions to
  every role holding `Device.manage`, then reconciles unrestricted ceilings; restricted
  ceilings gain them where they hold the matching device permission. Site
  compatibility routes keep `Device.view` and `Device.manage`.
- **Rationale**: no one loses or gains the ability to change sites through the old
  routes, and everyone who could manage sites can manage the hierarchy (FR-018).
- **Alternatives**: reusing `Device.manage` (spec 038 and the owner want the hierarchy's
  own permission).

## R15. Presets live in code

- **Decision**: `EntityPresets` defines `manufacturing`, `buildings` and
  `power_distribution` (FR-007) as versioned PHP arrays. Applying one inserts missing
  types by key and, for existing keys, unions allowed parents and member types only;
  it records `entity_type.preset_applied` once with the preset key and version.
- **Rationale**: presets are product content that changes with releases; organizations
  own their copies.
- **Alternatives**: preset rows in the database (an admin editor nobody asked for).

## R16. Search

- **Decision**: enable `pg_trgm` (a trusted extension, creatable by the database owner)
  and index `lower(name)` and `lower(path)` with GIN trigram indexes; search returns 25
  matches per page ordered by depth then path, excluding archived entities unless asked.
- **Rationale**: SC-003's two-second search over 100,000 entities with substring
  matching.
- **Alternatives**: prefix-only B-tree search (people search for `Feeder12` without
  knowing the region).

## R17. Explorer values come from the existing batch latest

- **Decision**: the explorer pages points 50 at a time and asks the runtime's existing
  `GET /internal/measurements/latest-batch` (spec 030) for the devices on the page,
  passing each device's configuration. Quality, staleness and unknown follow
  `DeviceReadings::forOwner` and the portal's `Freshness`.
- **Rationale**: no runtime change (FR-021); 50 points never need more than one call of
  100 devices.
- **Alternatives**: a runtime query by parameter list (a Laravel–Go contract change).

## R18. Portal

- **Decision**: a **Hierarchy** item under Devices replaces the **Locations** tab
  (`devices/SitesPage.tsx` is removed; its time zone setting moves to the hierarchy
  page's header actions, as today). The tree uses `TreeTable` from `@iot-os/ui`, planned
  by spec 038 for its address space; whichever spec lands first builds it with a story.
  The entity page is a `Panel` with tabs **Points** (`DataTable`, `Freshness`),
  **Devices**, **History** and **Details**. The device form's site picker becomes a
  searchable entity picker (a combobox showing paths), as AGENTS.md requires; the
  directory and alerts gain the same picker as a filter. Types and presets live on a
  **Types** tab of the hierarchy page.
- **Rationale**: design system rules (principle VIII); the label is the owner's choice (Q3).

## R19. Integration applications follow entities

- **Decision**: `integration_applications.entity_uuids` replaces `site_uuids` (renamed by
  migration, the API accepting and returning `site_uuids` as an alias for Site-type
  entities). A scope names 1–50 entities of any type. Under `entities:read`,
  `GET entities` lists the entities an application can see (the scoped branches and
  their ancestors, or the anchors and ancestors of listed devices) with path, type and
  parent, paginated; the device read gains `points` (leaf name, path, parameter UUID).
  `GET sites` stays as the compatibility view.
- **Rationale**: ADR-032 reserved exactly this. Showing ancestors lets an application
  draw the path of what it follows without seeing sibling branches.
- **Alternatives**: a separate `entity_uuids` column beside `site_uuids` (two scopes to
  reconcile); full-tree visibility under `entities:read` (leaks the shape of branches the
  application does not follow).

## R20. Limits

- **Decision**: `config/entities.php`: `max_per_organization` 100,000
  (`IOT_ENTITIES_MAX_PER_ORGANIZATION`), `max_depth` 12, `batch_items` 2,000, children
  page 100, search page 25, points page 50, attributes 30 (key ≤ 64, value ≤ 500). No
  billing allowance (owner, Q4).
- **Rationale**: the spec's scale target, with the ceiling as an operator safety valve.

## R21. One ADR

- **Decision**: **ADR-054, Organization hierarchy** (Proposed with the documents pull
  request; accepted when pull request 2 merges): one tree of typed entities per
  organization; sites are top-level Site entities with a deprecated compatibility view;
  devices carry a derived anchor and site; the hierarchy holds nothing about protocols
  and is changed by other features only through its operations. It relates to ADR-032,
  ADR-039 and spec 038's ADR-052. ADR-052 and ADR-053 are taken by spec 038's
  documents; the number is checked again when this pull request is opened.
- **Rationale**: the role of sites changes for every reader and the boundary with
  connectors is a lasting decision (constitution: decisions are ADRs).
