# Tasks: Entity Hierarchy

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: part of the feature. The constitution requires isolation tests (III) and
verification in the running stack (IX); SC-002, SC-004, SC-006 and SC-007 are proven by
tests on PostgreSQL. Write each phase's tests with it and see them fail first.

**Delivery**: one phase per pull request, each from `main` after the previous one
merges, never stacked (plan, Delivery). Phases follow the pull request order, not story
priority, because sites must become entities (PR 2) before placements can be built on.
Each pull request rebuilds the API family (and the portal from PR 6), runs its
quickstart scenario, ticks its tasks here and updates the docs its behaviour changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US7)
- Paths are from the repository root; `api/` means `apps/api/app/Domain/`

---

## Phase 1: Documents (PR 0)

- [x] T001 Write docs/adr/ADR-054-organization-hierarchy.md (Proposed) per [research R21](research.md#r21-one-adr) and add it to docs/adr/README.md; check that 052 and 053 are still spec 038's and 054 is free when the pull request opens
- [x] T002 [P] Add the entity hierarchy under **Next** in docs/roadmap.md, naming the pull requests of the plan and spec 038's PR 8 as the first caller of PR 3
- [ ] T003 Open the documents pull request with spec, plan, research, data model, contracts, quickstart, checklist, tasks and ADR-054

**Checkpoint**: the documents pull request merged; the plan is accepted.

---

## Phase 2: Types, presets and the tree (PR 1) — US1, US5 (API)

**Goal**: an organization can define types, apply presets and build its tree through
the API, held to the rules. Sites are untouched.

**Independent Test**: [quickstart A](quickstart.md#a-types-presets-and-the-tree-pr-1).

- [x] T004 Create apps/api/config/entities.php with the limits of [research R20](research.md#r20-limits) (`IOT_ENTITIES_MAX_PER_ORGANIZATION`) and add the variable to deploy/release/environment.example
- [x] T005 Create the migration for `entity_types`, `entities`, `entity_closure` and `entity_changes` per [data-model.md](data-model.md), with `CREATE EXTENSION IF NOT EXISTS pg_trgm`, the partial unique index on sibling path names and the trigram indexes (R16)
- [x] T006 [P] Create api/Entities/Models/EntityType.php, Entity.php and EntityChange.php on `DeviceModel`'s UUID conventions, with organization, parent, children, type and closure relations
- [x] T007 [P] Create api/Entities/Permissions/EntityPermission.php (`Entity.view`, `Entity.manage`) and EntityTypePermission.php (`EntityType.manage`); add them to apps/api/database/seeders/PermissionSeeder.php for every guard but `mcp`
- [x] T008 Create api/Entities/Services/EntityPermissionBackfill.php (the `DashboardPermissionBackfill` pattern, R14) and a migration that runs it; test that roles with `Device.view` gain `Entity.view`, roles with `Device.manage` gain both manage permissions, restricted ceilings follow the same rule and no other role changes
- [x] T009 [P] [US5] Create api/Entities/Services/PathNames.php: character rules, case-insensitive comparison, `suggest()` (R11); unit tests for `Filler pump P-201` → `FillerPumpP201`, `Eastgate SS` → `EastgateSS`, an Arabic name → empty, the 64-character cut
- [x] T010 [P] [US5] Create api/Entities/Services/NamingTemplates.php: compile `<number>`, `<letter>`, `<letters>`, `<text>` and literals to an anchored pattern, refuse anything else, check the example (R10); unit tests including `Feeder<number>` against `Feeder12` and `feeder-12`
- [x] T011 [US5] Create api/Entities/Services/EntityTypes.php: create, update (immutable key, Site type's fixed fields), delete (`in_use` while used or referenced), `ensureSite(Organization)`, and the "outside current rules" evaluation for an entity
- [x] T012 [US5] Create api/Entities/Services/EntityPresets.php with `manufacturing`, `buildings` and `power_distribution` (FR-007) and the merge of [research R15](research.md#r15-presets-live-in-code); tests: applying twice changes nothing and logs once, manufacturing then buildings gives one `site` allowing `area` and `building`
- [x] T013 [US1] Create api/Entities/Services/EntityTree.php: create, update (name, path name, description, time zone and location only when the type carries them, attributes ≤ 30, retype), move with impact, archive, restore with a new path name, delete of an entity that never held anything; closure, depth and path maintenance for the branch; the per-organization advisory lock (R3); depth 12; the ceiling; one `entity_changes` row per structural change
- [x] T014 [US1] Add the activity actions of [data-model.md](data-model.md#activity-log-actions-spec-024) for types, presets and entities to api/Audit/Services/ActivityCatalogue.php, record them from T011–T013, and resolve entity names in api/Audit/Services/ActivityFeed.php; a request that changes nothing records nothing
- [x] T015 [US1] Create api/Entities/Http/EntityTypeController.php, EntityPresetController.php and EntityController.php (children pages, search, show with ancestors, create, update, move with the `409` impact, archive, restore, delete, path-name suggestion) and api/Entities/routes/api.php required from apps/api/routes/api.php, per [contracts/api.md](contracts/api.md); organization resolved first, permissions as listed, `422` errors carrying `rule`
- [x] T016 [P] [US1] Feature tests in apps/api/tests/Feature/Domain/Entities/TreeTest.php: US1 AS2–AS6, cycle and depth refusals, sibling clash ignoring case, concurrent opposite moves (the second refused), restore with a taken name, the ceiling
- [x] T017 [P] [US5] Feature tests in apps/api/tests/Feature/Domain/Entities/TypesTest.php: US5 AS1–AS4, naming refusals with description and example, rule changes moving nothing and listing **Outside current rules**
- [x] T018 [P] [US1] Isolation tests in apps/api/tests/Feature/Domain/Entities/IsolationTest.php: another organization's types and entities answer `404` on every route and cannot be a parent (FR-020)
- [x] T019 [P] Describe the routes in contracts/openapi/supplements/entities.yaml, regenerate contracts/openapi/openapi.json with `contract:export`, pass the drift check, and add packages/api-client/src/entities.ts with its exports
- [x] T020 Rebuild the API family and run [quickstart A](quickstart.md#a-types-presets-and-the-tree-pr-1); record the result in the pull request

**Checkpoint**: the tree works through the API; nothing that reads sites has changed.

---

## Phase 3: Sites become entities, devices are placed (PR 2) — US3, US2 (placement)

**Goal**: every site is a top-level Site entity, every device with a site is placed at
it, and no reader of sites, time zones or grants notices.

**Independent Test**: [quickstart B](quickstart.md#b-sites-become-entities-pr-2).

- [x] T021 [US3] Before any code change, add apps/api/tests/Feature/Domain/Entities/SiteMigrationTest.php: seed sites, devices (archived included), a move with a target site and applications with site scopes on the PR 1 schema; record each device's reporting zone, site, directory and alert results by `site_uuid`, the agent tools' outputs and each application's resolved devices; run the migration; assert all are equal (FR-014, SC-002)
- [x] T022 [US3] Create the migration for `entity_placements` and `devices.entity_id`, and the data migration of [research R4](research.md#r4-sites-become-entities-of-a-reserved-site-type): Site types, one entity per site with the same UUID, `created` changes dated from `sites.created_at`, path names with `Site<n>` fallbacks, `devices.site_id` and `device_move_devices.target_site_id` (renamed `target_entity_id`) re-pointed to `entities`, open placements with no start, `sites` renamed `legacy_sites`; `down()` restores `sites` and both foreign keys
- [x] T023 [P] [US2] Create api/Entities/Models/EntityPlacement.php and add `entity()` and `placements()` to api/Devices/Models/Device.php; `site()` now belongs to `Entity`
- [x] T024 [US2] Create api/Entities/Services/DeviceAnchors.php, the only writer of `devices.entity_id` and `site_id` (R5), with `refresh()` for entity ids and device ids and `timezones()` for a page of devices (R6); call it from EntityTree moves, retypes and archives
- [x] T025 [US3] Rewrite `Device::reportingTimezone()` in api/Devices/Models/Device.php through the anchor and the closure (R6); test nearest zone, organization fallback, UTC, and an archived device keeping its last zone
- [x] T026 [US2] Create api/Entities/Services/Placements.php: place (type accepts devices, same organization, ends the current placement, `leaf_names`), end (`unplaced`), and end for archives and moves; activity `device.placed` and `device.unplaced`; clash checks are added in PR 4
- [x] T027 [US2] Create api/Entities/Http/PlacementController.php with `PUT`/`DELETE devices/{device}/placement`, `GET devices/{device}/placements` and `GET entities/{entity}/devices` per [contracts/api.md](contracts/api.md#placements--pr-2)
- [x] T028 [US3] Keep api/Devices/Models/Site.php as a model over Site-type entities (a type scope on `entities`) and rewrite api/Devices/Http/Controllers/SiteController.php through EntityTree: same shapes, `POST` creates a top-level Site entity, name unique among active Site entities, `DELETE` refuses with children and otherwise ends placements and archives; activity `site.*` as today
- [x] T029 [US3] api/Devices/Http/Controllers/DeviceController.php and api/Devices/Services/DeviceView.php: `entity_uuid` beside `site_uuid` (one of them), both placing through Placements; the device view adds `entity` and `path`; `archive` ends placements and parameter placements (R7)
- [x] T030 [US3] api/Integrations/Services/ApplicationGrant.php: site scopes resolve by branch through the anchor and the closure (R8); api/Integrations/Services/ApplicationGrants.php: `entityArchived` generalizing `siteDeleted`; api/Integrations/Http/SiteReadController.php and ReadController.php read Site entities
- [x] T031 [US2] api/Devices/Services/Moves/MovePreview.php, MoveRequests.php and MoveCutover.php: `devices.*.entity_uuid` beside `site_uuid`, `target_entity_id`, the predecessor's placement ended `moved_out`, the successor placed if the entity still belongs to the target and accepts devices (R7); add the field to contracts/openapi/supplements/devices.yaml
- [x] T032 [P] [US3] api/Administration/Services/OrganizationDeletion.php counts entities; the admin deletion preview label reads "Entities"
- [x] T033 [P] [US3] Deprecation notes for `list_sites` and the `site_uuid` parameters in contracts/agents/tools.json and for the sites operations in contracts/openapi/supplements/devices.yaml and integration.yaml, naming their replacements; packages/api-client gains `entity_uuid`, `entity`, `path` and placement methods
- [x] T034 [P] [US3] Run the existing site, grant-scope, sites-read, move-preview and agent read-tool tests unchanged (SC-004); add tests: a device placed at a zone inside a site stays in the site filter and the site's application scope (US3 AS4); an archived device stays granted at its last anchor; moving a branch out of a site revokes at once; another organization's entity cannot be a placement or move target
- [x] T035 Mark ADR-054 Accepted
- [x] T036 Rebuild the API family, run [quickstart B](quickstart.md#b-sites-become-entities-pr-2) against the demo organization before and after, test the rollback of PR 2's migrations, and record the rollback note in the dev stack and deployment records

**Checkpoint**: sites are entities; every site reader gives the same answers as before.

---

## Phase 4: Hierarchy operations for other features (PR 3) — US7

**Goal**: another domain can check and apply a batch of entity creations and
placements through the hierarchy's own rules. Unblocks spec 038's PR 8.

**Independent Test**: [quickstart C](quickstart.md#c-hierarchy-operations-pr-3).

- [ ] T037 [US7] Create api/Entities/Services/Batch/HierarchyBatch.php, NewEntityItem.php, PlacementItem.php, Parent.php, Target.php, BatchResult.php and ItemOutcome.php per [contracts/hierarchy-operations.md](contracts/hierarchy-operations.md); 1–2,000 items, unique refs, references only to earlier items
- [ ] T038 [US7] Create api/Entities/Services/HierarchyOperations.php: `createEntity`, `placeDevice`, `endPlacement` with the acting user's permission, and `check`/`apply` running EntityTree and Placements per item under savepoints, always rolled back for `check`, committed only when all are accepted for `apply`; `HierarchyRuleBroken` carrying `rule`, `field`, `message`; activity entries with `context.batch`
- [ ] T039 [P] [US7] Create api/Entities/Services/HierarchyQueries.php: `types`, `findByPath`, `children`, `placementOf`
- [ ] T040 [US7] Tests in apps/api/tests/Feature/Domain/Entities/HierarchyOperationsTest.php: the contract's list (nothing saved by check, identical refusals in check and apply, refs and `parent_refused`, all-or-nothing, `already_placed`, `not_found` across organizations), the 41-item batch under 2 s (SC-007), and the schema test that no hierarchy table has a column for a protocol, endpoint, node or address (FR-025)
- [ ] T041 [P] [US7] Create tooling/verify-entity-batch.php for quickstart C and run it against the rebuilt stack
- [ ] T042 [US7] Tell spec 038's owner session that PR 3 is merged (its T097 checks for it)

**Checkpoint**: spec 038's hierarchy proposal can be built.

---

## Phase 5: Parameter placements and points (PR 4) — US2, US4 (API)

**Goal**: single parameters can be placed elsewhere under leaf names, clashes are
refused or reported, and an entity's points show their latest values.

**Independent Test**: [quickstart D](quickstart.md#d-parameter-placements-and-points-pr-4).

- [ ] T043 [US2] Create the migration for `parameter_placements` and api/Entities/Models/ParameterPlacement.php
- [ ] T044 [US2] Create api/Entities/Services/ParameterPlacements.php (place, move, end; the parameter must be in the device's current profile revision when placed; activity `parameter.placed` and `parameter.unplaced`) and add the leaf-name clash check to Placements and ParameterPlacements under the entity lock (FR-011)
- [ ] T045 [US4] Create api/Entities/Services/EntityPoints.php: points at an entity or its branch per [research R9](research.md#r9-points-are-computed-not-stored), states `placed`, `name_clash`, `not_in_configuration`, pages of 50, latest values through the runtime's `latest-batch` and `DeviceReadings::forOwner` (R17)
- [ ] T046 [US4] Create api/Entities/Http/PointController.php and the parameter placement routes per [contracts/api.md](contracts/api.md#parameter-placements-and-points--pr-4); describe them in entities.yaml and the API client
- [ ] T047 [P] [US2] Tests: US2 AS1–AS4, the clash refusal listing names and its rename in the same step, a profile upgrade's clash reported and never blocking activation, a dropped parameter shown **Not in the current configuration**, a registered device's placement showing points once configured
- [ ] T048 [P] [US4] Tests: US4 AS1–AS2 with a faked runtime: unknown is `latest: null`, stale values carry their age, branch paths are relative
- [ ] T049 Rebuild the API family and run [quickstart D](quickstart.md#d-parameter-placements-and-points-pr-4)

---

## Phase 6: Memberships, coverage and filters (PR 5) — US1 AS7, US2 AS7

**Goal**: groupings across the tree, and devices and alerts filtered by an entity's
coverage.

**Independent Test**: [quickstart E](quickstart.md#e-memberships-and-filters-pr-5) and
the scale run.

- [ ] T050 [US1] Create the migration for `entity_memberships`, api/Entities/Models/EntityMembership.php and api/Entities/Services/Memberships.php (member types, one per group type, no self or tree relatives, end on archive of either side; activity)
- [ ] T051 [US1] Create api/Entities/Services/Coverage.php (branch plus one step of members) and use it in EntityPoints for branch requests
- [ ] T052 [US2] Add `entity_uuid` to api/Devices/Services/DeviceDirectory.php and api/Automation/Services/AlertQuery.php (portal list and agent filter) through Coverage; describe it in the supplements and the API client
- [ ] T053 [US1] Create api/Entities/Http/MembershipController.php per [contracts/api.md](contracts/api.md#memberships-and-filters--pr-5)
- [ ] T054 [P] [US1] Tests: US1 AS7, the membership edge cases, SC-005 with the power distribution preset
- [ ] T055 [P] Create the local-only command `entities:seed-scale` and measure SC-003 (children, search, a 50-entity scope); record the numbers in the pull request
- [ ] T056 Rebuild the API family and run [quickstart E](quickstart.md#e-memberships-and-filters-pr-5)

---

## Phase 7: Portal (PR 6) — US1, US2, US4, US5 (UI)

**Goal**: the **Hierarchy** page replaces **Locations**; people build, place and
explore without the API.

**Independent Test**: [quickstart F](quickstart.md#f-portal-pr-6).

- [ ] T057 [P] Create packages/ui/src/components/tree-table.tsx with a story in apps/storybook (lazy children, pagination per level, keyboard navigation, selection), unless spec 038 has merged it; then reuse it
- [ ] T058 [US1] Create apps/portal/src/hierarchy/HierarchyPage.tsx (tree, search, preset prompt for an empty organization, organization time zone from the old SitesPage) and register it under Devices in apps/portal/src/App.tsx with the nav label **Hierarchy**; remove apps/portal/src/devices/SitesPage.tsx and redirect its route
- [ ] T059 [US1] Create apps/portal/src/hierarchy/EntityForm.tsx (types allowed at the parent only, path-name suggestion, naming rule hints, time zone and location when carried) and MoveDialog.tsx (impact first, including applications that gain or lose devices)
- [ ] T060 [US4] Create apps/portal/src/hierarchy/EntityPage.tsx: a `Panel` with **Points** (`DataTable`, `Freshness`, copy path, open history), **Devices**, **History** (placeholder until PR 7) and **Details** (outside-rules notices, memberships)
- [ ] T061 [US5] Create apps/portal/src/hierarchy/TypesTab.tsx: types, rules, naming templates and presets with what they add and merge
- [ ] T062 [US2] Create apps/portal/src/hierarchy/EntityPicker.tsx (searchable combobox showing paths) and use it in apps/portal/src/devices/DeviceActions.tsx, DeviceDirectory.tsx (filter and column), apps/portal/src/alerts/Alerts.tsx (filter) and apps/portal/src/devices/moves/WhatComesAlong.tsx; DeviceOverview.tsx shows the breadcrumb path and parameters placed elsewhere; MeasurementsSection.tsx offers **Place this parameter**
- [ ] T063 [P] Vitest for path suggestions and tree state; Playwright with a mocked API for build, move, place, clash rename and the empty-organization preset prompt; axe in light and dark
- [ ] T064 [P] Update apps/portal/src/assistant/suggestions.ts and the help guides that mention Locations
- [ ] T065 Run `pnpm --filter @iot-os/portal lint`, rebuild the portal, run [quickstart F](quickstart.md#f-portal-pr-6) and SC-001, and ask for the owner's screenshot design pass

---

## Phase 8: History (PR 7) — US6

**Goal**: where things were, and when.

**Independent Test**: [quickstart G](quickstart.md#g-history-pr-7).

- [ ] T066 [US6] Create api/Entities/Services/EntityHistory.php: history pages and `branchAt` per [research R12](research.md#r12-history-and-as-of-queries)
- [ ] T067 [US6] Create api/Entities/Http/EntityHistoryController.php per [contracts/api.md](contracts/api.md#history--pr-7) and describe it
- [ ] T068 [US6] Fill the **History** tab of EntityPage.tsx and add placement history to the device page
- [ ] T069 [P] [US6] Tests: US6 AS1–AS3, migrated placements with no start counting as open earlier
- [ ] T070 Rebuild the API family and the portal; run [quickstart G](quickstart.md#g-history-pr-7)

---

## Phase 9: Applications follow entities; clean-up (PR 8) — FR-026

**Goal**: integration applications follow any entity branch and read paths; the old
sites table goes; lasting docs move out of the spec.

**Independent Test**: [quickstart H](quickstart.md#h-applications-follow-entities-pr-8).

- [ ] T071 Create the migration renaming `integration_applications.site_uuids` to `entity_uuids` and update api/Integrations/Models/IntegrationApplication.php, ApplicationController.php (`entity_uuids`, `site_uuids` alias) and ApplicationGrant.php per [contracts/integration.md](contracts/integration.md)
- [ ] T072 Create `GET entities` under `entities:read` and add `entity` and `points` to the device read in api/Integrations; describe them in contracts/openapi/supplements/integration.yaml; add `entities()` and `Device.points` to packages/integration-sdk
- [ ] T073 apps/portal/src/integrations/Integrations.tsx: entity scopes with EntityPicker; the `entities:read` label reads "Hierarchy"
- [ ] T074 [P] Tests in contracts/integration.md's list
- [ ] T075 Create the migration dropping `legacy_sites`, at least one release after PR 2 reached the pilot
- [ ] T076 [P] Write docs/features/hierarchy.md; update docs/features/devices.md, docs/features/integrations.md (grants by entity) and docs/features/adapters.md's pointer for spec 038
- [ ] T077 Rebuild the API family and the portal, run [quickstart H](quickstart.md#h-applications-follow-entities-pr-8) and `tooling/verify-integration-sdk.mjs`; freeze this folder

---

## Requirement coverage

| Requirement | Tasks |
| --- | --- |
| FR-001–FR-004 (tree, names, paths, rules at change time) | T005, T009, T010, T013, T016 |
| FR-005 (levels, pages, search) | T005, T015, T016, T055 |
| FR-006–FR-008 (types, presets, rule changes) | T011, T012, T017 |
| FR-009 (placements) | T022, T026, T027 |
| FR-010, FR-011 (parameter placements, leaf names) | T043, T044, T047 |
| FR-012 (history) | T013, T022, T066–T069 |
| FR-013, FR-014 (time zones, migration) | T021, T022, T024, T025 |
| FR-015 (site compatibility) | T028–T034 |
| FR-016 (entity filters) | T051, T052 |
| FR-017 (explorer) | T045, T046, T048, T060 |
| FR-018 (permissions) | T007, T008 |
| FR-019 (activity) | T014, T026, T038, T044, T050 |
| FR-020 (isolation) | T018, T034, T040, T074 |
| FR-021 (runtime unaffected) | no runtime task; T045 uses the existing `latest-batch` |
| FR-022 (OpenAPI, clients) | T019, T033, T046, T052, T072 |
| FR-023 (memberships) | T050, T051, T054 |
| FR-024, FR-025 (operations for other features) | T037–T041 |
| FR-026 (applications follow entities) | T030, T071–T074 |
| FR-027 (moves choose a target entity) | T031, T062 |

## Dependencies

- Phase 1 → Phase 2 → Phase 3, strictly.
- Phases 4, 5 and 6 each need Phase 3 only; they still merge one at a time, in this
  order by default (Phase 4 first, because spec 038 waits on it).
- Phase 7 needs Phases 5 and 6 (points, filters). Phase 8 needs Phase 7 for its tab.
- Phase 9 needs Phase 3 on the pilot for at least one release (T075) and Phase 7 for the
  picker.

## Parallel opportunities

- Within a phase, tasks marked [P] touch different files.
- T057 (`TreeTable`) can be built any time after Phase 1, or taken from spec 038.
- Spec 038's PR 1 to PR 7 run beside all of this.

## Implementation strategy

- **MVP**: Phases 2 and 3: the tree, and sites as entities with nothing broken.
- **Then**: Phase 4 for spec 038, Phases 5–6 for data in the tree, Phase 7 for people,
  Phases 8–9 for history and applications.
- Stop after any phase and the product still works: each pull request is complete and
  verified in the rebuilt stack.
