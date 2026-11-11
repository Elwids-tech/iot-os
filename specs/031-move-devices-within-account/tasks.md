# Tasks: Move Devices Within a Billing Account

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/platform-api.md](contracts/platform-api.md),
[contracts/internal.md](contracts/internal.md), [quickstart.md](quickstart.md)

The work ships as eleven pull requests against `main` (plan § Delivery). None is
stacked: each opens only after the PRs it depends on have merged.

Before each PR is opened, run a leak scan. It must find:
- no customer, prospect, pilot or person names;
- no hosts other than `example.com`, `.test` or `localhost`;
- no local home paths.

Tests are part of this feature (spec FR-060, SC-005, SC-007), so every story has test
tasks. Every test class sets up organizations A and B on one billing account and C on
another (`OrganizationFactory::forBillingAccount`). Tests run on PostgreSQL/TimescaleDB.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**:
  - US1: move adapter-backed devices (and, from PR 031-5, devices behind gateways)
  - US2: dashboards and automations come along
  - US3: direct devices take their gateway
  - US4: onboard into another organization
  - US5: run a pipe that serves other organizations
  - US6: history across the move
  - US7: the assistant
- Paths are from the repository root, with these short forms:
  - `Devices/` = `apps/api/app/Domain/Devices/`, and the same for other domains;
  - `migrations/` = `apps/api/database/migrations/`;
  - `tests/` = `apps/api/tests/Feature/Domain/`;
  - `runtime/` = `services/runtime/internal/`;
  - `portal/` = `apps/portal/src/`.

---

## PR 031-0: Documents

### Phase 1: Documents

- [x] T001 ADR-039 (Proposed) in `docs/adr/ADR-039-hosted-devices-and-moves.md`, its row in `docs/adr/README.md`, and ADR-026's status line; constitution principle III amended to 1.1.0 in `.specify/memory/constitution.md`; the roadmap row under Devices and adapters in `docs/roadmap.md`
- [x] T002 `specs/031-move-devices-within-account/`: spec with clarifications, checklist, plan, research, data model, two contracts, quickstart, tasks
- [x] T003 Leak scan the documents, run `python3 tooling/docs/check_links.py`, and keep the documents PR current until it merges

**Checkpoint**: PR 031-0 merged. PR 031-1 and PR 031-3 can start.

---

## PR 031-1: US1 back end, adapter-fed devices

### Phase 2: Foundation (blocks every story)

- [x] T004 `Devices/Permissions/DevicePermission.php`: case `MOVE = 'Device.move'` (upper case, as the enum's other cases). Migration `migrations/2026_11_XX_000001_add_device_move_permission.php`:
  - create the permission for every guard but `mcp`, as `PermissionSeeder` does;
  - reconcile every organization's Admin role through `OrganizationPermissionCeiling::reconcile()`, following `Dashboards/Services/DashboardPermissionBackfill.php`;
  - leave restricted ceilings without it (research R9);
  - give no other role the permission.

  The backfill lives in `Devices/Services/DeviceMovePermissionBackfill.php`, so the test can run it. Label **Move devices to another organization** in `packages/ui/src/lib/permission-labels.ts`; `move` in `DeviceCapabilities` in `packages/api-client/src/devices.ts`; `Shared/Http/Resources/OrganizationResource.php` exposes it with no change, because `DeviceAuthorization::capabilities` lists every case. `tests/Devices/DeviceMovePermissionTest.php` (FR-062): after the backfill, Organization Admin of an unrestricted organization holds it; Moderator and Member don't; a restricted ceiling and its Admin are unchanged; no other permission of any role changes
- [x] T005 Migration `migrations/2026_11_XX_000002_create_device_moves.php` with `device_moves`, `device_move_devices` and `device_links`, exactly as in data-model.md:
  - `operation_uuid` "uuid unique";
  - `status` enum "`stopping`, `completed`, `failed`";
  - `origin` enum "`devices`, `device`, `assistant`";
  - `include_history` "bool, default false";
  - per-device `state` enum "`waiting`, `stopping`, `stopped`, `moved`, `failed`";
  - `outstanding_key` "bigint nullable, unique";
  - `device_links.predecessor_device_id` and `successor_device_id` each unique;
  - `history_stopped_reason` enum "`stopped`, `left_account` nullable".

  Models `Devices/Models/{DeviceMove,DeviceMoveDevice,DeviceLink}.php` with casts and relations. Organization keys cascade, as `OrganizationDeletionInventoryTest` requires of tables without `organization_id`; deletion is blocked anyway while either side holds a device. `device_move_proposal_id` waits for PR 031-10
- [x] T006 Migration `migrations/2026_11_XX_000003_end_device_installations.php`:
  - `device_installations.ended_reason` enum "`archived`, `moved` nullable";
  - drop the unique index on `device_adapter_candidate_id` and create a partial unique index "`WHERE ended_at IS NULL`";
  - backfill `ended_at = now()`, `ended_reason = 'archived'` for installations whose device is archived.
- [x] T007 Migration `migrations/2026_11_XX_000004_create_device_profile_copies.php`:
  - unique "`(source_artifact_id, target_organization_id)`";
  - index "`(source_profile_id, target_organization_id)`";
  - `parameter_map` jsonb.

  Model `DeviceProfiles/Models/DeviceProfileCopy.php`
- [x] T008 `Devices/Services/Pipes.php` (research R2):
  - `for(Device): ?Pipe`: kind `adapter|gateway`, name, owner organization, online, hosted. The adapter comes from the device's open installation; the gateway from the candidate's gateway when it isn't the device's own (direct) gateway.
  - `allowsSource(Device, string $candidateUuid): DiscoveryCandidate`. It accepts the device's organization, or the device's current `device_discovery_candidate_id` when the candidate's organization is in the device's billing account. Otherwise 404.
  - `hostedIn(Organization)` (non-archived devices hosted on another organization's pipe) and `servedBy(Organization)` (non-archived devices of other organizations on this organization's pipes, grouped by organization). A source's organization is the pipe owner, so both compare the device's organization with its source's.
  - `crossings(Organization)` and `ensureCanLeave(Organization)` combine them with stopping moves for T026.
  - A direct device is one whose source's gateway is on an `onboarding-` connection.
- [x] T009 `Devices/Services/DeviceConfigurationService.php`: line 49's organization-scoped candidate lookup becomes `Pipes::allowsSource`, still `lockForUpdate`. `deactivate()` gains `bool $keepPlace = false`, which skips `DeviceLimit::release`
- [x] T010 [P] `tests/Devices/PipesTest.php`. Accepted: own source; the held foreign source in the same account. Refused (404): a foreign source not held; a held source after its organization moves to another account. `for()` covers adapter-fed, gateway and direct devices
- [x] T011 Installations end (research R3):
  - `Devices/Http/Controllers/DeviceController.php` `archive` ends the device's open installation with `archived` in the same transaction.
  - `DeviceAdapters/Services/AdapterService.php`: deploy bindings already sent only installations with `ended_at IS NULL`. Creating an installation moves into `install(candidate, adapter, device, actor)`, which the cutover calls for the successor; the installation keeps `organization_id` = the adapter's organization. `activate()` choosing another organization waits for PR 031-8, which also copies the profile. `AdapterCandidate::installation()` is the open installation, and activating a source in use in another organization is refused naming it.
  - Add `AdapterService::redeployOnce(array $adapterIds)` for moves.
- [x] T012 [P] `tests/DeviceAdapters/InstallationLifecycleTest.php`:
  - archiving ends the installation and frees the source;
  - a new device can be activated on it, with the old installation kept;
  - deploy bindings exclude ended installations;
  - the backfill ends installations of archived devices only.
- [x] T013 `DeviceProfiles/Services/ProfileCopier.php` (research R5): `copy(DeviceProfileArtifact $source, Organization $target): DeviceProfileCopy`.
  - Reuse the existing row for "`(source_artifact_id, target_organization_id)`".
  - Find or create the target profile through other rows with the same `source_profile_id`; its code is the source code, or `<code>-2`, `-3`… when the code is taken.
  - Rebuild parameters (reusing the target row per `key`), calculations and alarm templates (by `code`) from the artifact's canonical definition, then publish through `DeviceProfiles/Actions/PublishDeviceProfile.php`. Groups and parameter descriptions are not in the canonical definition, so they come from the source profile as it is now.
  - Store `parameter_map`.
  - `codeFor(source, target)` previews the code without writing.
- [x] T014 [P] `tests/DeviceProfiles/ProfileCopierTest.php`:
  - for every profile fixture, the copied artifact's canonical definition equals the source's with the parameter map applied;
  - a second copy of the same version reuses the row;
  - a later version reuses the target profile and its parameter UUIDs per key;
  - a code clash gets `-2`;
  - a profile of organization C is never visible to A or B.
- [x] T015 `Billing/Services/DeviceLimit.php` `transfer(Device $from, Device $to)`: inside the caller's transaction, set `$to->limit_place_at = $from->limit_place_at` and clear `$from`'s, with no claim, no peak write and no limit check. `tests/Billing/DeviceLimitTransferTest.php`: at the limit a transfer succeeds, and the count and `billing_device_peaks` are unchanged
- [x] T016 `Audit/Services/ActivityCatalogue.php`: `device_move.started`, `device_move.completed`, `device_move.failed`, `device.moved_out`, `device.moved_in`, with labels and the `device_move` kind prefix

**Checkpoint**: hosted sources, ending installations, profile copies and place transfers exist; nothing calls them yet; the existing suite passes unchanged (SC-007).

### Phase 3: User Story 1, move adapter-backed devices (P1) 🎯 MVP

**Goal**: an integrator moves devices that report through its adapter to a customer's organization; the adapter stays and keeps feeding them.

**Independent Test**: quickstart sections 2 (through the API) and 3.

- [x] T017 [US1] `Devices/Services/Moves/MoveTargets.php` and `GET device-move-targets` (contract § Targets):
  - lists other organizations of the source's billing account where the person is a member with `Device.move`, checked with `DeviceAuthorization::capabilities`;
  - adds `new_organization.billing_account_uuid` only for an owner with room under the `Organizations` allowance (`OwnerOrganizations` rules).
- [x] T018 [US1] `Devices/Services/Moves/MovePreview.php` (contract § Review): for 1–100 devices of the source, build the review:
  - Blockers:
    - archived;
    - `deployment_status = pending` or a pending `device_operations` row: "Waiting for the runtime";
    - an `outstanding_key`: "Already being moved";
    - before PR 031-5, a source on a non-adapter gateway: "Devices behind a gateway can't be moved yet";
    - before 031-7, a direct device: "Directly connected devices can't be moved yet".
  - Successor names and codes: prefilled; codes unique in the target and in the move; the site must be the target's. Codes are unique per organization among all devices, archived ones included, so a prefilled code the target already uses becomes `<code>-2`, `-3`… (a device moved back meets its archived predecessor's code); a code the person chose that the target uses is a blocker.
  - `reports_through` from `Pipes::for`.
  - `arrives_active` (FR-008).
  - Endings: open alerts, geofence assignments, application grants.
  - `profile_copies` with `ProfileCopier::codeFor`.
  - `pipe_owner_sees_raw_messages`.
  - Dashboards and automations using the devices stay: `items` is empty until PR 031-4, as the contract says, and a `summary` sentence counts those that stay (research R22).
  - `summary` sentences.
  - `preview_hash` (sha256 of the canonical review).

  It changes nothing.
- [x] T019 [US1] `Devices/Services/Moves/MoveRequests.php` `confirm` (research R1, R10). The fresh review is checked before the blockers, so the second of two racing movers always gets 409. A device in a stopping move takes no other change (409 from `DeviceConfigurationService::locked` and `DeviceLifecycleService::request`):
  - `operation_uuid` plus a request hash: the same request returns the same move, a different body gets 409.
  - Lock both organizations and re-check: same billing account (else 404), `Device.move` in both, `preview_hash` (409 with a fresh review when stale), blockers (422).
  - Create the move, its devices and `outstanding_key`s.
  - For each active device call `DeviceConfigurationService::deactivate(keepPlace: true)` and store `stop_operation_uuid`.
  - Record `device_move.started` in both organizations.
  - With no active device, call `MoveCutover` in the same request.
- [x] T020 [US1] `Devices/Http/Controllers/RuntimeController.php` `apply`: when an acknowledged or failed operation is a move's `stop_operation_uuid`, update the move device's `state` and dispatch `Devices/Jobs/ContinueDeviceMove.php` after commit. The job locks the move and returns unless it is `stopping` with every device stopped; it then calls `MoveCutover`, and on any refused stop it calls `MoveFailure`
- [x] T021 [US1] `Devices/Services/Moves/MoveCutover.php`, one transaction (FR-007, research R1, R4, R6, R7):
  1. Lock both organizations; re-check the account and permissions (on failure call `MoveFailure`).
  2. `ProfileCopier::copy` per distinct artifact.
  3. Per device:
     - archive the predecessor: lifecycle `archived`, `reserved_source_uuid` null, installation ended `moved`;
     - create the successor with name, code, tags, custom attributes, target site, `device_discovery_candidate_id` and `reserved_source_uuid`, and a draft from the predecessor's last applied configuration rewritten through the parameter map;
     - for adapter-fed devices, create a new installation;
     - `DeviceLimit::transfer`;
     - activate through `DeviceConfigurationService::activate` when `arrives_active`, otherwise `DeviceLimit::release` the place;
     - write the `device_links` row.
  4. Stop open alerts on predecessors with `stopped_reason = device_moved`, and relabel connectivity alerts stopped as `device_deactivated` since `confirmed_at`.
  5. Remove geofence assignments through `Geospatial/Services/GeofenceService.php`.
  6. Set `cutover_at`, `completed`; clear `outstanding_key`s.
  7. Record `device_move.completed`, `device.moved_out` and `device.moved_in`.

  After commit:
  - `AdapterService::redeployOnce` for the adapters involved;
  - stop the source organization's running captures on the moved sources through `RuntimeClient`, best effort.
- [x] T022 [US1] `Devices/Services/Moves/MoveFailure.php`:
  - resume each device the move stopped, through `DeviceLifecycleService::request(active)` as the system (`actor_id` null), with `DeviceLimit::retake`; a device whose stop the runtime has not answered stays in the move and is resumed when its acknowledgement arrives (`ContinueDeviceMove` on a failed move);
  - set `failed` with a plain `failure_reason` and clear the `outstanding_key`s;
  - record `device_move.failed` in both organizations.
- [x] T023 [US1] `Automation/Services/AlertQuery.php` and `Automation/Services/ConnectivityProjector.php`: `device_moved` is a stop reason with label **Device moved** (add a migration if `automation_alerts.stopped_reason` is constrained to a list); a later runtime transition for an alert already stopped is ignored. `stopped_reason` is a free string, so no migration; the label is in the kit's `offline_stop` map (`packages/ui/src/lib/status.ts`), and `AlertProjector` ignores late workflow transitions the same way
- [x] T024 [US1] `Devices/Http/Controllers/DeviceMoveController.php` (`targets`, `preview`, `store`, `show`) and routes in `Devices/routes/api.php` with `whereUuid` constraints. `Devices/Services/Moves/MoveView.php` shows each side only its own uuids and the other organization's name (contract § Move)
- [x] T025 [US1] `Devices/Services/DeviceView.php` and `Devices/Services/DeviceDirectory.php` (research R8). A hosted device's configuration snapshots also drop the pipe's connection, edge node and adapter UUIDs, and its installations' `adapter_revision_uuid` is null. `packages/api-client` types the device's candidate as `DeviceCandidate` (nullable `gateway`), and the portal's device views tolerate it without new UI:
  - `link` (direction, other organization's name, `cutover_at`);
  - `pipe` (kind, name, owner name, online, hosted);
  - for hosted devices, `candidate.gateway` and the adapter reference are null, while metrics and `birth_revision` stay;
  - `candidate.in_use_in` replaces `assigned_device_uuid` when the device is in another organization.

  `DeviceAdapters/Http/AdapterController.php` (Sources, `:150-155`) embeds `in_use_in` instead of the full device for hosted devices
- [x] T026 [US1] Leaving and deletion guards (FR-061, research R17):
  - `Billing/Services/BillingAccounts.php` `move` refuses 409 while `Pipes::hostedIn` or `Pipes::servedBy` is non-empty, or a move involving the organization is `stopping`, listing devices per organization.
  - `Administration/Services/OrganizationDeletion.php` gains a `hosted_devices` blocker.
- [x] T027 [P] [US1] `tests/Devices/Moves/MovePreviewTest.php`:
  - every blocker;
  - code clash in the target and inside the move;
  - foreign site;
  - 101 devices refused;
  - targets list only same-account organizations with `Device.move`;
  - an owner with room gets `new_organization`, a non-owner doesn't;
  - C as target is 404;
  - the review changes nothing.
- [x] T028 [P] [US1] `tests/Devices/Moves/MoveCutoverTest.php` with a faked runtime (`Http::fake`) and a simulated adapter:
  - an active adapter-fed device: stop, acknowledge, cutover;
  - predecessor archived with its link and its readings untouched; successor with copied profile, rewritten mappings, new installation and activation queued;
  - one redeploy per adapter;
  - an inactive device moves in one request;
  - no `Device.activate` in the target gives an inactive successor and releases the place;
  - the activity log has entries in both organizations;
  - moving the successor back to A gives an ordinary device (`pipe.hosted` false);
  - moving it onward from B to a third organization D of the account keeps it on A's adapter, hosted in D;
  - a B member saves and activates a new configuration of the hosted device on its held source (US1 AS9);
  - a hosted device archived in B frees the source in A's Discovery.
- [x] T029 [P] [US1] `tests/Devices/Moves/MoveFailureTest.php`:
  - a refused stop fails the move and resumes the others;
  - the mover losing `Device.move` before cutover fails it;
  - the organization moving to another account before cutover fails it;
  - nothing in the target remains;
  - the device limit and peak are unchanged.
- [x] T030 [P] [US1] `tests/Devices/Moves/MoveConcurrencyTest.php` (with `ForksProcesses`):
  - two movers confirm the same device: one move, the other 409 with no change;
  - a repeated `operation_uuid` returns the same move, and a changed body gets 409;
  - a stale `preview_hash` gets 409.
- [x] T031 [P] [US1] `tests/Devices/Moves/MoveBillingTest.php`:
  - at the account's device limit an active device moves and arrives active;
  - the count and `billing_device_peaks` are unchanged (SC-006);
  - an organization with hosted devices can't leave the account or be deleted, and the refusal lists them.
- [x] T032 [P] [US1] `tests/Devices/Moves/MoveEndingsTest.php`:
  - open alerts on the predecessor end as `device_moved`;
  - unsent commands cancelled and possibly sent ones uncertain;
  - geofence assignments removed;
  - application grants stay on the predecessor and still read its history;
  - a source dashboard using the predecessor still saves unchanged and reads its history up to cutover (SC-003);
  - offline alerts of a hosted adapter-fed device are stored in B (FR-026).
- [x] T033 [US1] `tests/Devices/Moves/DeviceMoveIsolationTest.php` (FR-060, SC-005). As a B-only member, every one of these is 404:
  - A's adapter, credentials, decoder (revisions), deliveries, poll runs, sources, Discovery, gateways, captures and the adapter's gateway route.

  As an A-only member:
  - the successor and its readings are 404;
  - A's adapter Sources and Discovery show `in_use_in` only.

  As C, every move route and review naming A or B is 404 through C's own routes; A's and B's own routes answer 403 to non-members, as every organization route does (`ResolveOrganizationContext`). The same holds for the B-only and A-only cases above: through one's own organization the other's records are 404. After cutover no reading for the device is stored for A (faked runtime ledger assertion). A held foreign source can't be swapped for another of A's sources through the draft (404)
- [x] T034 [US1] `packages/api-client/src/deviceMoves.ts` (`deviceMoveTargets`, `previewDeviceMove`, `createDeviceMove`, `deviceMove`) and the `link`, `pipe` and `in_use_in` types in `packages/api-client/src/devices.ts`. Run `php artisan contract:export` with examples for the four operations and the device additions; `contract:export --check` passes

### Phase 4: PR 031-1 documentation and verification

- [x] T035 `docs/dev/gotchas.md`: archiving ends adapter installations; parameter UUIDs are global, so copies need a map. `docs/reference/api.md` route table
- [x] T036 Rebuild api and workers; run quickstart sections 1, 2 (steps through the API) and 3, including the successor's readings arriving within one minute (SC-002) and a timed 100-device review under 2 s (plan, Performance Goals); record the results in the PR; leak scan; open PR 031-1 against `main`

**Checkpoint**: PR 031-1 merged. PR 031-2 can start.

---

## PR 031-2: US1 in the portal

### Phase 5: User Story 1, the four steps (P1) 🎯 MVP

**Goal**: the move is one bulk action from the device list or a device's menu.

**Independent Test**: quickstart sections 2 and 3 in the portal.

- [x] T037 [US1] `packages/ui/src/lib/status.ts`: `statusOf` gains the move states `stopping`, `completed` and `failed`, and the successor states `pending`, `active`, `inactive` and `failed`, with tests in `status.test.ts`
- [x] T038 [US1] `portal/devices/moves/MoveDialog.tsx`: a `Dialog` with the kit `Stepper` (**Where to**, **What comes along**, **Confirm**, **Done**), holding the selection, overrides and `operation_uuid`. Leaving before **Confirm** changes nothing
- [x] T039 [US1] `portal/devices/moves/WhereTo.tsx`:
  - a `SearchableSelect` fed by `deviceMoveTargets`;
  - **New organization…** when `new_organization` is present, which creates the organization through the existing billing accounts call and continues with it (FR-003). It is the selector's own create option: typing a name offers **New organization “*name*”**.

  The review rows carry `reports_through.owner_organization_name`, so each row names the pipe's owner (added to the API and contract in this PR).
- [x] T040 [US1] `portal/devices/moves/WhatComesAlong.tsx`, one list in `Panel`s:
  - devices with editable name, code and site;
  - per-row blockers;
  - how each reports, with "stays with *owner*" naming the adapter, never its gateway;
  - dashboards and automations as "Stays in *source*";
  - endings;
  - profile copies with their codes;
  - the inactive warning;
  - the pipe owner's raw messages notice.

  Re-previews on change. **Next** is disabled while `can_confirm` is false
- [x] T041 [US1] `portal/devices/moves/Confirm.tsx` (summary sentences, a separate checkbox per archive, **Move**) and `portal/devices/moves/Done.tsx` (polls `deviceMove` with `statusOf`, "Waiting for the runtime to stop *n* devices", links to what moved and to anything needing attention)
- [x] T042 [US1] `portal/devices/DeviceDirectory.tsx`:
  - controlled selection with `bulkActions` **Move to organization**, disabled above 100 with a tooltip saying so (the selection itself stays uncapped, because Export CSV shares it);
  - hidden without `capabilities.devices.move` or when the targets list is empty and `new_organization` is absent;
  - hosted rows show **Adapter: *name* (*owner*)** without a link.

  `portal/devices/DeviceWorkspace.tsx`:
  - the menu entry opens the same dialog for one device;
  - **Moved to *target*** or **Moved from *source*** with the cutover time;
  - **Reports through** with the pipe's kind, name, owner and online state.
- [x] T043 [US1] `portal/devices/DiscoveryPage.tsx` and `portal/adapters/connections.tsx`: **In use in *organization*** without a link when `in_use_in` is set
- [x] T044 [P] [US1] `apps/portal/e2e/device-moves.spec.ts` with `page.route` mocks:
  - select two devices, pick a target, accept the defaults, confirm, see **Done** complete;
  - a blocked device disables **Next**;
  - **New organization…** for an owner;
  - the device page's link and pipe.

### Phase 6: PR 031-2 documentation and verification

- [x] T045 Docs:
  - `docs/features/devices.md`: **Moving devices** (the four steps, what moves, what stays, hosted devices, **Moved to/from**, the gap);
  - `docs/features/adapters.md`: an adapter serving other organizations;
  - `docs/features/access.md`: `Device.move` and the billing account note;
  - `docs/features/billing.md`: moves are neutral;
  - `docs/features/activity-log.md`.
- [x] T046 Rebuild the portal; run quickstart sections 2 and 3 in the portal, timing a 20-device move under three minutes (SC-001); `pnpm --filter @iot-os/portal lint`; record in the PR; leak scan; open PR 031-2 against `main`

**Checkpoint**: PR 031-2 merged: US1 is usable for adapter-fed devices. ADR-039 can move to Accepted (T104).

---

## PR 031-3: Archive dashboards and automations

### Phase 7: Archiving (US2 foundation, FR-037)

**Goal**: dashboards and automations can be archived and restored, inside and outside moves.

**Independent Test**: quickstart section 4.3.

- [x] T047 [US2] Migration `migrations/2026_11_20_000005_archive_dashboards_and_workflows.php`: on `dashboards` and `automation_workflows`, `archived_at` timestamptz nullable and `archived_by` FK users nullable. `archived_by_move_id` waits for PR 031-4 (T053), because this PR can merge before `device_moves` exists
- [x] T048 [US2] `Dashboards/Http/Controllers/DashboardController.php`:
  - `archive` and `restore`, allowed for the owner or `Dashboard.manage` (`Dashboards/Services/DashboardAccess.php`);
  - `index` hides archived dashboards unless `archived=only|include`, and returns `archived_count`;
  - an archived dashboard is read-only (409 on save);
  - records `dashboard.archived` and `dashboard.unarchived` (`dashboard.restored` is restoring a version).
- [x] T049 [US2] `Automation/Http/Controllers/DagController.php` `archive`:
  - needs `Workflow.manage` and `Workflow.activate`;
  - requests an inactive deployment first, then sets `archived_at`.

  `restore` needs `Workflow.manage` and comes back off. Lists filter as dashboards do. Record `workflow.archived` and `workflow.unarchived`; add all four to `ActivityCatalogue`
- [x] T050 [P] [US2] `tests/Dashboards/DashboardArchiveTest.php` and `tests/Automation/WorkflowArchiveTest.php`:
  - permissions;
  - default lists hide archived items;
  - restore;
  - an archived automation is off and a restored one stays off;
  - organization C can't archive A's items;
  - organizations that never archive see unchanged lists (FR-062).
- [x] T051 [US2] `packages/api-client` archive and restore methods and `archived_at`. `portal/dashboards/LibraryPage.tsx` and `portal/automation/AutomationDirectory.tsx`:
  - **Archive** and **Restore** actions;
  - "*n* archived hidden · Show", following `DeviceDirectory.tsx:337-352`.

  `portal/dashboards/lastPlace.ts` falls back from an archived dashboard. OpenAPI export
- [x] T052 `docs/features/dashboards.md` and `docs/features/automation.md`: archiving. Rebuild api and portal; run quickstart 4.3; leak scan; open PR 031-3

---

## PR 031-4: US2, dashboards and automations come along

### Phase 8: User Story 2 (P1)

**Goal**: on day one the customer has the dashboards and alerts that belonged to the moved devices.

**Independent Test**: quickstart section 4.

- [ ] T053 [US2] Migration `migrations/2026_11_XX_000006_create_device_move_items.php` (data-model § Carried item: `kind` enum "`dashboard`, `automation`", `action` enum "`move`, `copy`, `keep`, `archive`", `omitted` jsonb, `target_item_id` nullable, `arrives_running` "bool nullable"); `archived_by_move_id` FK `device_moves` nullable on `dashboards` and `automation_workflows`; `automation_deployments.stopped_reason` gains `moved` and `device_moved`; model `Devices/Models/DeviceMoveItem.php`
- [ ] T054 [P] [US2] `Dashboards/Services/DashboardRewrite.php`: a pure function `(widgets, layouts, deviceMap, parameterMap, keepOnly: bool)`. It returns rewritten widgets and layouts plus omitted panels and references. It covers:
  - `config.sources[].device_uuid` and `parameter_uuid`;
  - `config.devices[].device_uuid`;
  - `config.location_device_uuids[]`;
  - `geofence_uuid` and `workflow_uuid`, kept only when mapped.

  `tests/Dashboards/DashboardRewriteTest.php` covers every panel type
- [ ] T055 [P] [US2] `Automation/Services/WorkflowRewrite.php`: a pure function rewriting `workflow.bindings[].device_uuid`, `configuration_uuid` (to the successor's) and `parameter_uuid`, and reporting command nodes. `tests/Automation/WorkflowRewriteTest.php`
- [ ] T056 [US2] `Devices/Services/Moves/CarriedItems.php` (research R11):
  - **Classify**: find the source dashboards and automations using moving devices, mark each "only moving" or "others too", list the actions allowed per data-model § Carried item, and preselect the first. Drop actions the mover lacks permission for (`Dashboard.create` in the target to move or copy; `Workflow.manage` in the target to move; the archive permissions of R12 in the source). Never preselect archive.
  - **Omissions**: compute shares (user shares of target members survive, role shares are dropped), recipients (target members with `Device.view` stay), and panels.
  - **`other_devices`**: count the item's other devices and whether the mover may move them (FR-031).
- [ ] T057 [US2] `MovePreview` and `MoveRequests` take `items[]` overrides and `confirmed_archives[]`, which must "list exactly the items whose action is `archive`". `MoveCutover` applies the items:
  - **Move dashboard**: set the target organization, rewrite through `DashboardRewrite`, filter shares, set the owner, move its revisions.
  - **Copy dashboard**: create a target dashboard owned by the mover with `access = restricted` and no shares.
  - **Move automation**: set the target organization, rewrite through `WorkflowRewrite`, filter recipients, and supersede the source deployment with `moved`. Activate in the target only when it was running, target `automation_settings.enabled` is true, the mover holds `Workflow.activate` there, and it has no command node. Otherwise it arrives off and goes into `needs_attention`.
  - **Keep automation** still binding a predecessor: request an inactive deployment and set it `suspended` with `stopped_reason = device_moved` naming the device (FR-036).
  - **Archive**: as in PR 031-3, with `archived_by_move_id`.
- [ ] T058 [US2] `DagController` activation refuses a workflow suspended with `device_moved` while a binding still names an archived, moved device. The editor's `StaleBindingsAlert` (`portal/automation/Automation.tsx`) names the moved device
- [ ] T059 [P] [US2] `tests/Devices/Moves/CarriedItemsTest.php`, the spec's Independent Test:
  - D1 and W1 use only X; D2 and W2 use X and Y;
  - after the move D1 and W1 are in B on B's X;
  - B has D2's copy with X's panels only;
  - A's D2 is unchanged and saves;
  - W2 is suspended naming X;
  - preselection per row, and permission fallbacks;
  - W1 with a command node arrives off;
  - W1 into a target with automations off arrives off;
  - a recipient outside B is removed and listed;
  - **Add *n* devices** recomputes the rows;
  - no dashboard or automation in A or B uses devices of the other (FR-038, SC-010).
- [ ] T060 [P] [US2] `tests/Devices/Moves/CarriedAlertTest.php`: a moved alert automation that met the conditions raises its next alert in B with no editing, with the runtime faked (SC-004)
- [ ] T061 [US2] Portal:
  - `portal/devices/moves/WhatComesAlong.tsx` rows with choices (a `Select` per row) and **Add *n* devices to this move**;
  - `Confirm.tsx` lists archives separately;
  - `Done.tsx` lists automations to turn on.

  Dashboard panels mark a moved device: **Moved to *target*** on panels whose device is a predecessor (`portal/dashboards`). `packages/api-client` item types; OpenAPI export
- [ ] T062 [P] [US2] `apps/portal/e2e/device-moves.spec.ts`: accept the preselected choices for a dashboard that moves, one copied and an automation kept, then confirm an archive separately
- [ ] T063 Docs: `docs/features/devices.md` **Moving devices** gains dashboards and automations; `docs/features/dashboards.md`; `docs/features/automation.md` (`device_moved`). Rebuild api, workers and portal; run quickstart 4; have a first-time user run the two-device move without help, under one minute (SC-009); record; leak scan; open PR 031-4

---

## PR 031-5: Gateway pipes

### Phase 9: Devices behind gateways and their offline alerts (US1, US5)

**Goal**: devices behind a gateway move like adapter-fed ones, and offline alerts follow ownership.

**Independent Test**: quickstart sections 5.1 and 5.2.

- [ ] T064 [P] [US5] `contracts/internal/events/device.connectivity.v1.{schema,fixture,cases}.json`: optional `subject.pipe_organization_uuid` (uuid or null), allowed only for `kind = gateway`. Cases: present, absent, on a device subject (refused). `python3 tooling/verify-devices-contracts.py`
- [ ] T065 [US5] `runtime/app/connectivity.go`:
  - the gateway episode organization is the edge's connection organization, not `members[0].organization`;
  - for members of other organizations, keep an extra episode keyed `gateway:<connection>/<edge>@<organization uuid>` with only that organization's devices and `pipe_organization_uuid` set on its events;
  - existing keys keep their meaning.
- [ ] T066 [P] [US5] `runtime/app/connectivity_test.go`:
  - mixed-organization members give two episodes;
  - the owner's episode is attributed to the gateway's organization even when the first member is hosted;
  - a stored row with the old key restores;
  - one organization behaves as before;
  - the produced events validate against the contract.
- [ ] T067 [US5] `Automation/Services/ConnectivityProjector.php`: when `pipe_organization_uuid` is set, resolve the gateway in that organization through `Pipes`. Accept it only when both organizations share an account and every affected device is hosted on that gateway. Store the alert in the event's organization with the pipe's name only; if this changes the alert API's subject shape, export OpenAPI and update `packages/api-client`. `tests/Automation/HostedGatewayAlertTest.php` covers A's alert, B's alert, a forged `pipe_organization_uuid` from another account (ignored), and C
- [ ] T068 [US1] Migration `migrations/2026_11_XX_000007_release_device_onboardings.php`:
  - `device_onboardings.released_at`;
  - the unique index on `(sparkplug_gateway_id, source_device_id)` becomes partial "`WHERE released_at IS NULL`";
  - backfill released rows of archived devices.

  `DeviceController::archive` and `MoveCutover` release the row. `OnboardingController.php:74` and `BulkOnboarding.php:268` ignore released rows
- [ ] T069 [US1] `MovePreview` lifts the gateway blocker. `Pipes::for` covers gateway sources, including a gateway's own metrics (`source_device_id = ''`). The successor activates against the live birth
- [ ] T070 [P] [US1] `tests/Devices/Moves/GatewayMoveTest.php`:
  - two devices behind a gateway, one moves;
  - the gateway stays in A, even when every device behind it moves;
  - the gateway's own metrics device moves;
  - A's Discovery shows **In use in B**;
  - a mixed move of adapter-fed and gateway devices;
  - B sends a command to its hosted gateway device, and the runtime is asked under B's organization (US1 AS9).

  Extend `DeviceMoveIsolationTest` with gateway, connection and gateway-firmware routes as B-only (404)
- [ ] T071 Docs: `docs/features/alerts.md` (hosted gateway alerts, `device_moved`) and `docs/features/devices.md` (gateway pipes). Rebuild api, workers and runtime; run quickstart 1 (`./taskw runtime:test` too), 5.1 and 5.2; record; leak scan; open PR 031-5

---

## PR 031-6: US5, pipe operations

### Phase 10: User Story 5 (P2)

**Goal**: the pipe owner sees whom its pipe serves and can't cut a customer off by accident.

**Independent Test**: quickstart sections 5.3 and 5.4.

- [ ] T072 [US5] `hosted_devices: [{organization_name, count}]` on adapter reads (`DeviceAdapters/Http/AdapterController.php`) and gateway reads (`DeviceView::gateway`, `Devices/Http/Controllers/DiscoveryController.php` `gateways`, which today counts same-organization devices only at `:71`)
- [ ] T073 [US5] Refusals with 409 `pipe_serves_hosted_devices` and `organizations: [{name, count}]` (FR-023):
  - `AdapterService::delete` and `inUse`;
  - gateway archive or delete;
  - `DiscoveryController::review` (reject) of a source in use elsewhere;
  - onboarding a source in use elsewhere.
- [ ] T074 [US5] Confirmations with 409 `hosted_devices_affected` until `confirm_hosted_devices: true` (FR-024), on `AdapterController::deploy` (`deploy`, `pause`, `rollback`), decoder saves and adapter hardware credential rotation. PR 031-6 and PR 031-7 may land in either order: whichever lands second also guards `POST gateways/{gateway}/credentials/rotate`
- [ ] T075 [P] [US5] `tests/DeviceAdapters/HostedPipeGuardsTest.php`:
  - every refusal and confirmation names B and its count;
  - an adapter with no hosted devices behaves as before;
  - a metric change on a hosted device's source sets review required in B, as for A's own devices (FR-025; runtime faked through the event).
- [ ] T076 [US5] Portal:
  - **Serves** counts on the adapter page and the gateway page;
  - a confirmation `AlertDialog` naming the organizations before pause, deploy, rollback, decoder save and rotation;
  - the refusal messages.

  `packages/api-client` types; OpenAPI export
- [ ] T077 Docs: `docs/features/adapters.md` and `docs/features/devices.md` gateway section. Rebuild api and portal; run quickstart 5.3–5.4; record; leak scan; open PR 031-6

---

## PR 031-7: US3, direct devices take their gateway

### Phase 11: User Story 3 (P2)

**Goal**: a directly connected device moves with its gateway, credentials and topic unchanged, and the target can rotate them.

**Independent Test**: quickstart section 6.

- [ ] T078 [P] [US3] `contracts/internal/state/internal.control-state.v1.{schema,fixture,cases}.json`: optional `connections[].gateways[]` of `{edge_node_id, organization_uuid}`. Cases: absent, empty, an override, a duplicate edge (refused)
- [ ] T079 [US3] `runtime/devices/types.go` `Connection.Gateways`. `runtime/app/application.go` `edgeOrganization(connection, edge)` is used for `captures.Watching` and `captures.Record` (`:344, :365`). `runtime/app/telemetry.go` capture start checks `edgeOrganization` instead of the connection's organization (`:39`). `runtime/app/connectivity.go` uses it for gateway episodes (T065)
- [ ] T080 [P] [US3] `runtime/app/telemetry_test.go` and `runtime/app/connectivity_test.go`: a capture by the override's organization records; the connection's organization can't capture that edge; episodes use the override; parsing the state fixture
- [ ] T081 [US3] Migration `migrations/2026_11_XX_000008_add_gateway_credential_warning.php`: `sparkplug_gateways.credentials_known_to_organization_id` FK nullable and `credentials_rotated_at` timestamptz nullable. `Devices/Http/Controllers/RuntimeController.php` `state` emits `gateways[]` for gateways whose organization differs from their connection's. Birth handling (`:287`) records a new source under its gateway's organization. The PHP test of `state` validates its response against `internal.control-state.v1` with an override present
- [ ] T082 [US3] `MoveCutover` for a direct device:
  - the gateway's `organization_id`, its discovery candidates and its `device_onboardings` row change to the target;
  - set `credentials_known_to_organization_id` = source;
  - the connection stays.

  `MovePreview` lifts the direct-device blocker and reports `outcome: moves`. `Pipes::servedBy` counts gateways on the source's `onboarding-` connection, for the leaving and deletion guards (research R13)
- [ ] T083 [US3] `Devices/Http/Controllers/GatewayCredentialController.php` `rotate` (`Device.manage-connections`):
  - a new password through `Devices/Services/BrokerProvisioner.php`, then disable and enable the broker client so its session drops;
  - clear the warning and set `credentials_rotated_at`;
  - record `gateway.credentials.rotated` (catalogue entry);
  - when PR 031-6 has already merged, guarded here as T074 describes; otherwise T074 adds the guard.

  Route with `whereUuid`
- [ ] T084 [P] [US3] `tests/Devices/Moves/DirectDeviceMoveTest.php` and `tests/Devices/GatewayCredentialRotationTest.php`:
  - after cutover A gets 404 for the gateway, settings, kits and firmware downloads, and B can download them;
  - the warning shows until rotation;
  - rotation changes the password and calls the broker to drop the session (faked broker-admin);
  - A can't be deleted or leave while its `onboarding-` connection carries B's gateway.

  Extend `DeviceMoveIsolationTest`
- [ ] T085 [US3] Portal:
  - `portal/devices/DeviceWorkspace.tsx` warning "Members of *source* knew these credentials" with **Rotate credentials** (an `AlertDialog`);
  - the same on `portal/devices/GatewayPage.tsx`;
  - the move review shows "Its connection moves with it".

  `packages/api-client`; OpenAPI export
- [ ] T086 Docs: `docs/features/devices.md` (direct devices move with their gateway; rotation) and `docs/features/embedded-sdk.md` if it describes settings. Rebuild api, workers, runtime and portal; run quickstart 6 with the device simulator; record; leak scan; open PR 031-7

---

## PR 031-8: US4, onboard into another organization

### Phase 12: User Story 4 (P2)

**Goal**: a discovered source is onboarded straight into a customer's organization as a hosted device.

**Independent Test**: quickstart section 7.

- [ ] T087 [US4] `DeviceAdapters/Http/AdapterController.php` activate and `AdapterService::activate` take an optional `organization_uuid`:
  - another organization needs `Device.move` in both, plus `Device.manage` and `Device.activate` in the chosen one;
  - the profile goes through `ProfileCopier`;
  - the device is created there with an installation under the adapter's organization;
  - record `device.onboarded_into` in both organizations (catalogue entry).
- [ ] T088 [US4] `Devices/Http/Controllers/OnboardingController.php` (gateway mode) and Discovery's single **Onboard** take `organization_uuid` with the same rules (gateway pipes exist from PR 031-5, which this PR follows). Bulk onboarding stays single-organization
- [ ] T089 [P] [US4] `tests/Devices/OnboardIntoOrganizationTest.php`:
  - the default is the pipe owner;
  - B is chosen and the source shows **In use in B** in A;
  - missing permissions give 403, a non-member 404, organization C 404;
  - the profile copy is reused on a second onboarding.
- [ ] T090 [US4] Portal: an organization `SearchableSelect` in `portal/devices/OnboardSource.tsx` and the adapter's activate dialog, shown only when the person has `Device.move` in another organization. `packages/api-client`; OpenAPI export
- [ ] T091 Docs: `docs/features/adapters.md` and `docs/features/devices.md`. Rebuild api and portal; run quickstart 7; record; leak scan; open PR 031-8

---

## PR 031-9: US6, history across the move

### Phase 13: User Story 6 (P3)

**Goal**: the target sees a continuous history across the cutover only when the mover chose it.

**Independent Test**: quickstart section 8.

- [ ] T092 [US6] `MovePreview` offers `history`, and `MoveRequests` stores `include_history` on the move and `history_included` on each link
- [ ] T093 [US6] `Devices/Services/DeviceReadings.php`. First check that the runtime's aggregate history responses carry a count per bucket; if they don't, add it in this PR as an additive runtime response field with its tests. Then:
  - for a successor whose link has `history_included` and no `history_stopped_at`, query the runtime for the predecessor under the source organization with the source's retention and `until = cutover_at`, mapping parameter UUIDs through the profile copy's map;
  - merge with the successor's own readings, splitting aggregate buckets at the cutover and recombining them from counts;
  - mark readings `recorded_in: "source"` or `"self"`;
  - never follow a second link.

  Applies to charts, tables, exports, dashboard panel queries and the device API
- [ ] T094 [US6] `Devices/Http/Controllers/DeviceLinkController.php` `POST devices/{device}/link/history` with `{enabled: false}` on a predecessor (`Device.move`), recording `device_link.history_stopped`. `BillingAccounts::move` sets `history_stopped_reason = left_account` on every link touching the organization
- [ ] T095 [P] [US6] `tests/Devices/Moves/HistoryAcrossMoveTest.php`:
  - with the option, B's history includes A's readings before the cutover, labelled;
  - without it, none;
  - stopping hides them;
  - leaving the account hides them;
  - a chain A→B→C gives C only B's readings;
  - C (another account) is 404;
  - A's retention applies.

  Extend `DeviceMoveIsolationTest` (FR-060: "only with the option on, only for the predecessor, and only within the account")
- [ ] T096 [US6] Portal:
  - **Include readings from before the move** (off by default) in `WhatComesAlong.tsx`, with the explanation;
  - history charts mark points recorded in the source;
  - **Stop sharing history** on the predecessor's page.

  `packages/api-client`; OpenAPI export
- [ ] T097 Docs: `docs/features/devices.md` (Measurements and history across a move). Rebuild api and portal; run quickstart 8; record; leak scan; open PR 031-9

---

## PR 031-10: US7, the assistant

### Phase 14: User Story 7 (P3)

**Goal**: the assistant prepares a move as a card the person confirms.

**Independent Test**: quickstart section 9.

- [ ] T098 [US7] Migration `migrations/2026_11_XX_000009_create_device_move_proposals.php` (data-model: `status` "`proposed`, `applied`, `dismissed`", `content_hash`, `preview` jsonb) and `Assistant/Models/DeviceMoveProposal.php`
- [ ] T099 [US7] `Assistant/Tools/DeviceMoveTools.php` (a `Laravel\Ai\Contracts\Tool` with `action` and `arguments_json`, like `OnboardingTools`):
  - `find_targets`, through `MoveTargets`;
  - `prepare_move`, through `MovePreview` with the person's permissions re-checked, which stores a proposal and emits a `device_move_proposal` event.

  The tool never calls `MoveRequests`. Register it in `OnboardingAssistant::tools()` (scope `onboarding`, the device-side assistant), adding no new value to `Assistant/Enums/AssistantScope.php`. Confirm in `portal/assistant/AssistantPanel.tsx` which scope the header Assistant opens on the device list and device pages. Add the dismiss route
- [ ] T100 [US7] `MoveRequests` accepts `origin: assistant` with `proposal_uuid`. It checks the proposal belongs to the person and its hash, and marks it `applied`
- [ ] T101 [P] [US7] `tests/Assistant/DeviceMoveToolsTest.php`:
  - only same-account targets with `Device.move` are offered;
  - an unclear target asks;
  - the card's rows equal the bulk review;
  - nothing changes until confirm;
  - a confirmed card follows every move rule;
  - with the assistant disabled the tool is absent and moves still work.
- [ ] T102 [US7] `portal/assistant/AssistantPanel.tsx`: the card with the kit `ActionCard` holding the **What comes along** rows (reusing `WhatComesAlong.tsx`), editable choices, **Confirm** and a link to **Done**. `packages/api-client` (`dismissDeviceMoveProposal`, the card type). Run `php artisan contract:export` for the dismiss operation and the `device_move_proposal` card schema, with examples; `contract:export --check` passes
- [ ] T103 Docs: `docs/features/assistant.md`. Rebuild api and portal; run quickstart 9 with the assistant enabled and disabled; record; leak scan; open PR 031-10

---

## Final Phase: Polish and cross-cutting

- [ ] T104 After PR 031-2 merges, ADR-039's status becomes Accepted (with the date and "built in spec 031") in `docs/adr/ADR-039-hosted-devices-and-moves.md` and `docs/adr/README.md`; ADR-026's line updates to match
- [ ] T105 After the last PR merges:
  - run `/speckit-converge` until it reports no gaps;
  - remove the roadmap row in `docs/roadmap.md`;
  - freeze the spec folder.
- [ ] T106 After release, the first real use (SC-008): an integrator moves trackers from one adapter into a customer's organization on the pilot; the customer's members see only those devices and no vendor credential is copied. Record the result in the private operations inventory, not in the repository

---

## Dependencies and execution order

| Phase | Depends on | Blocks |
| --- | --- | --- |
| 1 (031-0) | — | everything |
| 2 Foundation (031-1) | 1 | 3 |
| 3 US1 back end (031-1) | 2 | 5 and every later story |
| 5 US1 portal (031-2) | 031-1 merged | 8, 9, 13 |
| 7 Archiving (031-3) | 031-0 merged | 8 |
| 8 US2 (031-4) | 031-2 and 031-3 merged | 14 |
| 9 Gateway pipes (031-5) | 031-2 merged | 10, 11, 12 |
| 10 US5 (031-6) | 031-5 merged | — |
| 11 US3 (031-7) | 031-5 merged | — |
| 12 US4 (031-8) | 031-5 merged | — |
| 13 US6 (031-9) | 031-2 merged | — |
| 14 US7 (031-10) | 031-4 merged | — |

Within a phase:
- migrations come before the models and services that use them;
- pure rewrite services and their tests ([P]) come before `CarriedItems`;
- contract fixtures ([P]) come before the runtime code that produces them;
- the isolation test is extended in every PR that adds a crossing.

## Parallel opportunities

- **PR 031-1:** T010, T012 and T014 run beside each other once T005–T008 exist. T027–T032 are independent test files.
- **PR 031-3** can be built while PR 031-1 and PR 031-2 are in review.
- **After PR 031-2 merges:** PR 031-5 and PR 031-9 proceed in parallel, and so does PR 031-4 once PR 031-3 is in.
- **After PR 031-5 merges:** PR 031-6, PR 031-7 and PR 031-8 proceed in parallel.
- **Inside PR 031-4:** T054 and T055 are pure functions in different domains.
- **Inside PR 031-5 and PR 031-7:** the contract tasks (T064, T078) go first and in parallel with the Laravel work.

Example for PR 031-1 after the foundation:

```text
T027 MovePreviewTest     T028 MoveCutoverTest     T029 MoveFailureTest
T030 MoveConcurrencyTest T031 MoveBillingTest     T032 MoveEndingsTest
```

## Implementation strategy

1. **MVP = PRs 031-1 and 031-2.** Adapter-fed devices move to a customer's organization
   with the adapter untouched, which is the request that started the feature. Stop and
   validate with quickstart sections 2 and 3 before going on.
2. **Day-one usability = PRs 031-3 and 031-4.** Dashboards and alerts come along.
3. **Complete pipes = PRs 031-5, 031-6 and 031-7.** Gateway devices, pipe safety and
   direct devices.
4. **Fewer moves = PR 031-8.** Onboard into the customer directly.
5. **P3 = PRs 031-9 and 031-10.** History and the assistant, each optional for the
   rest.

Each PR ticks its tasks here, updates the docs its behaviour changes, rebuilds what it
changes and records its quickstart run in the pull request.
