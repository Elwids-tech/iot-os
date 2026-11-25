# Implementation Plan: Entity Hierarchy

**Branch**: `plan/009-entity-hierarchy` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-entity-hierarchy/spec.md`

## Summary

Each organization gets a tree of typed entities held to rules it chooses, devices and
single parameters are placed in it, and sites become its top-level Site entities
without any reader noticing.

- **A new `Entities` domain** in Laravel: types with rules and three presets, entities
  stored as a parent pointer plus a closure table and a stored path, placements and
  parameter placements, memberships, change history, the activity log, and three
  permissions backfilled from `Device.view` and `Device.manage`.
- **Sites become entities.** A migration turns every site into a top-level entity of a
  reserved `site` type with the same UUID and places its devices there. Devices gain a
  derived *anchor* (`entity_id`) and keep `site_id`, now derived and pointing at the
  Site entity, so the directory, alerts, agent tools, moves and the integration API keep
  their queries. Grants by site resolve by branch. Time zones come from the tree.
- **Operations for other features.** `HierarchyOperations` creates entities, places
  devices and checks or applies a batch of up to 2,000 items against the rules, running
  the real code in a rolled-back transaction for the check. This is what spec 038's
  hierarchy proposal calls; nothing in the hierarchy names a protocol or node address.
- **Portal**: a **Hierarchy** page under Devices replaces **Locations**: the tree
  (`TreeTable`), entity pages with points and latest values, types and presets, entity
  pickers on the device form, the directory, alerts and moves.
- **Integration applications** may follow any entity branch and read entities and point
  paths under `entities:read`, as ADR-032 reserved.

The runtime, its contracts, ingestion, activation, commands and automations do not
change.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13, TypeScript / React 19

**Primary Dependencies**: existing only: Eloquent, `althinect/enum-permission`
(permission enums), spatie permissions, TanStack Query and Table, `@iot-os/ui`. The
PostgreSQL extension `pg_trgm` (trusted, shipped with PostgreSQL) for search.

**Storage**: PostgreSQL 17 with TimescaleDB: seven new tables (`entity_types`,
`entities`, `entity_closure`, `entity_changes`, `entity_placements`,
`parameter_placements`, `entity_memberships`); `devices.entity_id` new and
`devices.site_id` re-pointed; `device_move_devices.target_site_id` →
`target_entity_id`; `sites` renamed `legacy_sites`, dropped in PR 8;
`integration_applications.site_uuids` → `entity_uuids` (PR 8). See
[data-model.md](data-model.md).

**Testing**: PHPUnit on PostgreSQL (never SQLite; feature tests per acceptance
scenario, isolation tests, migration equivalence tests built from today's site tests,
the schema test of FR-025); Vitest for pure portal logic (path suggestions, tree state);
Playwright with a mocked API for the hierarchy page; the OpenAPI drift check;
`contracts/agents/tools.json` unchanged except deprecation notes; the runtime's tests
untouched.

**Target Platform**: the Compose stack and the single-node release

**Project Type**: web application (Laravel API and workers, React portal)

**Performance Goals**: SC-003 (children under 1 s and search under 2 s at 100,000
entities and 20,000 placed devices; a 50-entity scope under 50 ms); SC-007 (a 41-item
batch checked under 2 s)

**Constraints**: depth 12; 100,000 entities per organization; batches of 2,000; pages of
100 children, 25 search results, 50 points; attributes 30 ([research
R20](research.md#r20-limits))

**Scale/Scope**: ~8 migrations, 1 new domain (~12 services, 7 models, 5 controllers), 1
ADR, ~15 new API endpoints, ~10 changed readers of sites, 1 new kit component (shared
with spec 038), ~8 portal components

## Constitution Check

*Checked before research and again after the design below.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. The hierarchy lives in Laravel only. The runtime keeps receiving a time zone for counter increases and nothing else; the explorer uses the existing `latest-batch` endpoint (R17). Clients talk only to Laravel. |
| II. Immutable versions | Pass. The runtime executes nothing from the hierarchy, so edits apply immediately (spec assumption). Profiles, configurations and revisions are untouched; parameter placements reference stable parameter UUIDs and report, never block, when a revision drops one. |
| III. Tenant isolation | Pass with tests. Every route resolves the organization first; every table carries `organization_id`; parents, placements, memberships and batch items are checked to be in the same organization; another organization's UUIDs answer `404` or `not_found`. Grants by entity are tested against other organizations and sibling branches (FR-020, contracts/integration.md). No crossing between organizations is added: a move re-makes the placement in the target. |
| IV. Contracts first | Pass. No cross-language contract changes. Public API changes update the OpenAPI supplements (`entities.yaml`, `devices.yaml`, `integration.yaml`), the generated description, `packages/api-client` and `packages/integration-sdk` in the same pull request. The in-process contract for other domains is written down ([contracts/hierarchy-operations.md](contracts/hierarchy-operations.md)). User references are `user_id`. |
| V. AI proposes, people approve | Pass. No assistant tool writes the hierarchy. Existing agent tools keep reading sites through the compatibility view. Spec 038's proposal applies only through a person's `apply` with `Entity.manage`. |
| VI. Show uncertainty | Pass. Points show unknown for missing values and label stale ones; **Not placed: name clash**, **Not in the current configuration** and **Outside current rules** are shown, never hidden. |
| VII. Durable, idempotent messaging | Pass. No new messages. Preset application and the permission backfill are idempotent; the batch apply is one transaction. |
| VIII. One design system | Pass. `CollectionPage`/`DataTable` for points, devices and history; `Panel`; `Freshness` and `RelativeTime`; searchable entity pickers (combobox), not a search field beside a dropdown. `TreeTable` is a kit component with a story, shared with spec 038. |
| IX. Verified where it runs | Pass. Each pull request rebuilds the API family (and the portal from PR 6) and runs its [quickstart](quickstart.md) scenario; PR 2 runs the before/after comparison on the demo organization and records it. |

One ADR is part of the documents pull request: **ADR-054, Organization hierarchy**
(Proposed; [research R21](research.md#r21-one-adr)). It relates to ADR-032 and ADR-039
and amends neither.

*Post-design re-check (2026-11-25)*: unchanged. The design adds no runtime contract,
no crossing between organizations and no AI write; the two derived device columns
(R5) are written by one service only.

## Design

The details are in [research.md](research.md) (decisions R1–R21),
[data-model.md](data-model.md) and [contracts/](contracts/).

### Laravel (`apps/api`)

- `Domain/Entities/Models`: `EntityType`, `Entity`, `EntityChange`, `EntityPlacement`,
  `ParameterPlacement`, `EntityMembership` (on `DeviceModel`'s UUID conventions).
- `Domain/Entities/Permissions`: `EntityPermission`, `EntityTypePermission`;
  `Services/EntityPermissionBackfill` run from the PR 1 migration (R14).
- `Domain/Entities/Services`:
  - `EntityTypes` (create, update, delete, `ensureSite`, rule checks, naming templates
    R10) and `EntityPresets` (R15);
  - `EntityTree` (create, rename, retype, move with impact, archive, restore, delete;
    closure, depth and path maintenance; the per-organization lock R3; the ceiling);
  - `PathNames` (character rules, suggestions R11);
  - `Placements` (place, end, leaf names, clash checks under the entity lock) and
    `ParameterPlacements`;
  - `DeviceAnchors` (the only writer of `devices.entity_id` and `site_id`; time zones
    for one device or a page R5, R6);
  - `EntityPoints` (points at an entity or its coverage, states, latest values R9, R17);
  - `Memberships` and `Coverage`;
  - `EntityHistory` (history pages, `branchAt` R12);
  - `HierarchyOperations`, `HierarchyQueries`, `HierarchyBatch` and its item and result
    classes (R13);
  - `SiteView` (site shapes from Site entities for every compatibility reader).
- `Domain/Entities/Http`: `EntityTypeController`, `EntityPresetController`,
  `EntityController` (tree, search, move impact), `PlacementController`,
  `PointController`, `MembershipController`, `EntityHistoryController`;
  `Domain/Entities/routes/api.php` required from `routes/api.php`.
- Changed readers ([contracts/site-compatibility.md](contracts/site-compatibility.md)):
  `Device::site()` and `reportingTimezone()`; `SiteController` through
  `HierarchyOperations` and `SiteView`; `DeviceController` (`entity_uuid`, `site_uuid`
  places, archive ends placements); `DeviceDirectory` and `AlertQuery` (`entity_uuid`
  coverage filter); `MovePreview`, `MoveRequests`, `MoveCutover` (R7);
  `ApplicationGrant`, `ApplicationGrants::entityArchived` (R8);
  `SiteReadController`, `ReadController`; `OrganizationDeletion` (count);
  `ActivityCatalogue` and `ActivityFeed`.
- Agent tools (`ListSites`, `FindDevices`, `ListAlerts`, `GetDeviceHealth`,
  `GetMeasurements`) keep their code paths through the re-pointed relation; their
  catalogue entries gain deprecation notes.
- `config/entities.php` (R20); `entities:seed-scale` (local only).

### Portal (`apps/portal`)

- `hierarchy/HierarchyPage.tsx` (tree on `TreeTable`, search, header actions including
  the organization time zone moved from `SitesPage`), `hierarchy/EntityPage.tsx`
  (Points, Devices, History, Details tabs), `hierarchy/EntityForm.tsx`,
  `hierarchy/MoveDialog.tsx` (impact first), `hierarchy/TypesTab.tsx` (types, rules,
  presets), `hierarchy/EntityPicker.tsx` (searchable, shows paths).
- `devices/DeviceActions.tsx`: entity picker replaces the site picker;
  `devices/DeviceOverview.tsx`: breadcrumb path and parameters placed elsewhere;
  parameter placement from `MeasurementsSection`; `DeviceDirectory.tsx` and
  `alerts/Alerts.tsx`: entity filter; `devices/moves/WhatComesAlong.tsx`: entity picker;
  `integrations/Integrations.tsx`: entity scopes (PR 8). `devices/SitesPage.tsx` and
  its route are removed (the old URL redirects).
- `packages/ui/src/components/tree-table.tsx` with a story, unless spec 038 has landed
  it first. `packages/api-client/src/entities.ts`.

### Delivery

Small pull requests from `main`, one at a time, never stacked: each starts from `main`
after the previous one merges. Each rebuilds the affected containers and runs its
quickstart scenario.

| PR | Content | Stories | Verification |
| --- | --- | --- | --- |
| 0 | Documents: spec update, plan, research, data model, contracts, quickstart, tasks, ADR-054 (Proposed), roadmap entry | — | review |
| 1 | Types, presets, tree, path names, history rows, permissions and backfill, activity, tree API | US1, US5 (API) | quickstart A |
| 2 | Sites become entities: migration, placements, `DeviceAnchors`, time zones, site compatibility view, grants by branch, archives and moves (R7), ADR-054 accepted | US2 (device placement, API), US3 | quickstart B; pilot rollback note |
| 3 | `HierarchyOperations`, `HierarchyQueries`, batches; unblocks spec 038's PR 8 | US7 | quickstart C, SC-007 |
| 4 | Parameter placements, leaf names, points, explorer API with latest values | US2 (rest), US4 (API) | quickstart D |
| 5 | Memberships, coverage, `entity_uuid` filters on devices and alerts, scale seeding | US1 AS7, US2 AS7 | quickstart E, SC-003 |
| 6 | Portal: Hierarchy page, entity page, types and presets, pickers and filters, `TreeTable` | US1, US2, US4, US5 (UI) | quickstart F, SC-001, design pass |
| 7 | History API and views, `branch-at` | US6 | quickstart G |
| 8 | Integration applications follow entities, SDK; drop `legacy_sites`; docs moved to `docs/features` | FR-026 | quickstart H |

Spec 038's PR 1 to PR 7 do not wait for any of these; its PR 8 needs PR 3 merged.

**Pilot rollback note (PR 2)**: the migration is reversible while `legacy_sites` exists
(`down()` restores `sites` and the two foreign keys, discarding entities created
since). Before running an older image, roll back PR 2's migrations; after PR 8 drops
`legacy_sites`, rolling back past PR 2 is no longer possible, so PR 8 ships at least one
release after PR 2.

## Project Structure

### Documentation (this feature)

```text
specs/009-entity-hierarchy/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── api.md
│   ├── hierarchy-operations.md
│   ├── site-compatibility.md
│   └── integration.md
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks, next
```

### Source Code (repository root)

```text
apps/api/app/Domain/Entities/               # new domain: models, services, http, permissions, routes
apps/api/app/Domain/Devices/                # Device::site, SiteController, DeviceController, DeviceDirectory, Moves/*
apps/api/app/Domain/Integrations/           # ApplicationGrant(s), SiteReadController, ReadController, ApplicationController
apps/api/app/Domain/Automation/Services/AlertQuery.php
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/app/Domain/Audit/Services/{ActivityCatalogue,ActivityFeed}.php
apps/api/config/entities.php
apps/api/database/migrations/               # ~8 migrations
apps/api/database/seeders/PermissionSeeder.php
apps/api/tests/Feature/Domain/Entities/     # plus changed site, grant, move and agent tests
apps/portal/src/hierarchy/                  # new
apps/portal/src/{devices,alerts,integrations}/
packages/ui/src/components/tree-table.tsx   # shared with spec 038
packages/api-client/src/entities.ts, packages/integration-sdk/
contracts/openapi/supplements/{entities,devices,integration}.yaml, contracts/agents/tools.json (notes)
docs/adr/ADR-054-organization-hierarchy.md
docs/features/hierarchy.md (PR 8), docs/features/{devices,integrations}.md
```

**Structure Decision**: one new Laravel domain with a narrow service boundary; site
readers stay where they are and read through it.

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Two derived columns on `devices` (`entity_id`, `site_id`) | Grants, filters, alerts and agent tools stay one indexed join, and archived devices keep their place (R5) | Resolving through placements on every read touches every site reader at once and loses archived devices' sites |
| `check` runs the real writes in a rolled-back transaction | The check can never disagree with the apply (FR-024) | A parallel validator drifts from the rules |
| `legacy_sites` kept for a release | The pilot can roll back PR 2 without losing sites | Dropping at once makes PR 2 irreversible |

## Owner decisions (2026-11-25)

Recorded in the spec's Clarifications; the plan is built on them.

1. **Q1**: integration applications may follow any entity branch and read entities and
   point paths under `entities:read` (PR 8).
2. **Q2**: a move lets the mover choose any entity of the target that accepts devices.
3. **Q3**: the portal label is **Hierarchy**, under Devices, replacing **Locations**.
4. **Q4**: no billing plan allowance; an operator ceiling of 100,000 entities per
   organization.

ADR-052 and ADR-053 are used by spec 038's documents; this plan takes ADR-054 (checked
again when the documents pull request opens).
