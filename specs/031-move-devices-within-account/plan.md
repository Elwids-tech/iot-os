# Implementation Plan: Move Devices Within a Billing Account

**Branch**: `spec/031-move-devices-plan` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/031-move-devices-within-account/spec.md`,
clarified 2026-11-10. Decisions are in
[ADR-039](../../docs/adr/ADR-039-hosted-devices-and-moves.md), which amends
[ADR-026](../../docs/adr/ADR-026-billing-accounts.md). Constitution principle III is
amended in the same pull request (1.0.4 → 1.1.0).

## Summary

A device moves to another organization of the same billing account as a cutover: the
source keeps an archived predecessor, **Moved to *target***, and the target gets a
linked successor with a copied configuration and profile version. Pipes (adapters,
their publishers, gateways in an organization's connections) stay with their owner and
keep feeding the successor, which is then a *hosted device*. Directly connected
devices take their own gateway along.

Grounded in the code (research, "What the code already fixes"):

- **The runtime needs no change for adapter-fed moves.** It routes a Sparkplug message
  by connection, edge node and device ID, with no organization in the key, and stores
  readings under the device definition's organization. A successor in another
  organization is an ordinary new device there.
- **Laravel is where the work is.** The single organization scope at
  `DeviceConfigurationService::saveDraft` becomes one `Pipes` rule (R2). Adapter
  installations start to end, so a successor can take the source (R3). Profiles are
  rebuilt in the target with a parameter map (R5).
- **A move stops, then cuts over.** It stops each active predecessor with an ordinary,
  acknowledged deactivation that keeps its device-limit place. Then one transaction
  archives the predecessors, creates and activates the successors, copies profiles and
  carries dashboards and automations (R1, R4).
- **Two runtime changes come later, for gateways.**
  - Gateway episodes are attributed to the gateway's organization, with an episode per
    hosted organization (R14).
  - Moved direct gateways get a per-edge organization in the control state (R13).

Delivery is eleven pull requests against `main`, none stacked (§ Delivery). US1 ships
first, for adapter-fed devices: back end, then portal.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; Go 1.27; TypeScript / React 19.

**Primary Dependencies**: existing packages only.
- `spatie/laravel-permission` for `Device.move`.
- `spatie/laravel-activitylog` through `ActivityLog`.
- Laravel AI for the assistant tool.
- `dedoc/scramble` for the OpenAPI export.
- No new PHP, Go or JS package.

**Storage**: PostgreSQL 17 / TimescaleDB.
- New tables: `device_moves`, `device_move_devices`, `device_move_items`,
  `device_links`, `device_profile_copies`, `device_move_proposals`.
- Changed tables: `device_installations` (end reason, partial unique index),
  `device_onboardings` (`released_at`, partial unique index), `dashboards` and
  `automation_workflows` (archive columns), `sparkplug_gateways` (credentials warning).
- Runtime tables: none ([data model](data-model.md)).

**Testing**:
- PHPUnit feature tests per area under `tests/Feature/Domain/Devices/Moves/` and the
  touched domains. Every class has two organizations on one account and a third
  outside it.
- `DeviceMoveIsolationTest` covers every FR-060 case (R21).
- Go unit tests for the edge organization and episode attribution, plus the contract
  fixtures and cases.
- Portal Playwright: `e2e/device-moves.spec.ts`, and archive cases in the dashboards
  and automation specs.
- The [quickstart](quickstart.md) sections on the rebuilt stack.

**Target Platform**: the single-node Docker Compose platform (dev stack and releases).

**Project Type**: web application changes (Laravel API, Go runtime, React portal and
admin), contracts, docs.

**Performance Goals**:
- A 100-device review in under 2 s.
- A 20-device move from **Confirm** to readings in the target within one minute
  (SC-001, SC-002).
- One adapter restart per adapter per move.

**Constraints**:
- Clients talk only to Laravel (constitution I).
- The runtime never changes a device's organization.
- No copy of a pipe, decoder or vendor credential (FR-020).
- No stacked pull requests.
- Organizations that never move devices see no change, except `Device.move` on
  Organization Admin and archiving dashboards and automations (FR-062).

**Scale/Scope**:
- **API**: ~12 operations (targets, review, confirm, show, archive and restore ×2,
  rotate, history stop, proposal dismiss, plus onboarding parameters), 1 permission,
  6 tables, 5 changed tables, 2 services that replace inline organization checks
  (`Pipes`, `ProfileCopier`).
- **Runtime**: edge organization and episode attribution (PRs 031-5, 031-7).
- **Contracts**: 2 internal schema additions.
- **Portal**: the 4-step move dialog, the device list bulk action, device page link and
  pipe, pipe owner's "In use in", archive lists, the assistant card.
- **Admin**: the leaving-the-account refusal text.
- **Docs**: devices, adapters, access, billing, dashboards, automation, alerts,
  assistant, activity log, gotchas.

## Constitution Check

Version 1.1.0, as amended by this pull request.

| Principle | Check |
| --- | --- |
| I. Laravel owns intent | Laravel decides every move, crossing and history read. The runtime receives only ordinary activations and deactivations (contract unchanged), and history is two per-organization queries Laravel issues (R18). No client reaches the runtime. ✅ |
| II. Immutable versions | A copied profile version is published as a new immutable artifact in the target (R5). A successor gets a new immutable configuration snapshot and is applied only on the runtime's acknowledgement. Nothing is upgraded silently. ✅ |
| III. Tenant isolation | Amended: two crossings, hosted devices and history across a move, only inside one billing account and only as ADR-039 lists. `Pipes::allowsSource` is the single rule replacing the scope at `saveDraft:49`. Views build allow-listed fields (R8). `DeviceMoveIsolationTest` proves FR-060, including organizations outside the account. ✅ with the amendment (Complexity Tracking) |
| IV. Contracts first | Every public change exports OpenAPI and updates `packages/api-client` in its PR. `internal.control-state.v1` and `device.connectivity.v1` change with fixtures, cases and Go and PHP tests ([internal](contracts/internal.md)). Activation and deploy payloads don't change. ✅ |
| V. AI proposes | The assistant prepares a card; only the person's **Confirm** calls `POST device-moves` (R19). Moves, archives and onboarding work with the assistant disabled. ✅ |
| VI. Never invent state | A move waits for the runtime with no timeout. Possibly sent commands become uncertain and are never resent. A refused successor activation shows the runtime's reason. Readings from before the cutover are absent unless shared, and labelled when shared. ✅ |
| VII. Durable, idempotent | `operation_uuid` with a request hash. `outstanding_key` makes a device part of one move. `ContinueDeviceMove` locks and re-checks. Runtime answers arrive through the existing batched inbox (ADR-031). ✅ |
| VIII. One design system | The move dialog uses the kit's `Stepper`, `SearchableSelect` (targets, with **New organization…**), `Panel`, `DataTable` with `bulkActions`, `ActionCard` (assistant) and `statusOf` with new move and successor states added to the kit's map. No new kit component; `check-ui` passes. ✅ |
| IX. Verified where it runs | Each PR rebuilds what it changes and runs its quickstart sections. Tests run on PostgreSQL/TimescaleDB. SC-008 (first real use) is checked on the pilot after release, not claimed from the simulator. ✅ |

**Gate result**: pass, with the deviations in Complexity Tracking. Re-checked after
Phase 1 design: unchanged.

## Decisions the spec left open

Each is argued in [research.md](research.md).

1. **A move stops, then cuts over (R1).** Active predecessors are deactivated first;
   the cutover transaction runs when the runtime has acknowledged them all. If a
   deactivation is refused, the move fails and resumes what it stopped.
2. **US1 ships for adapter-fed devices first (R22).** Devices behind a gateway wait for
   PR 031-5, and direct devices for PR 031-7. Until PR 031-4, dashboards and
   automations stay in the source.
3. **Places carry over (R4).** The stop keeps each device-limit place and the cutover
   hands it to the successor without a claim, so the count and the monthly peak don't
   change.
4. **Profiles are rebuilt in the target with a parameter map (R5).** Parameter UUIDs are
   unique across all profiles. FR-011's platform-template case never arises, because
   devices only use organization profiles.
5. **A successor whose activation the runtime refuses after cutover stays inactive with
   the reason (R6).** It is listed on **Done**; the source isn't touched again.
6. **The target can't capture a hosted device's raw messages (R8).** Captures show the
   pipe's traffic, which stays with the pipe owner.
7. **Restricted permission ceilings don't gain `Device.move` automatically (R9).**
8. **History never follows a chain of moves across organizations (R18).** A device
   moved back reads its own organization's earlier readings (FR-053, ADR-040).
9. **A direct device's `onboarding-` connection stays with the source (R13).** It stays
   as the Sparkplug group's namespace. The source can't be deleted or leave the
   account while it carries another organization's gateway.
10. **Gateway credential rotation is new, for every gateway (R13).** It drops the
    broker session at once.
11. **Archiving needs specific permissions (R12).** A dashboard: its owner or
    `Dashboard.manage`. An automation: `Workflow.manage` and `Workflow.activate`.
12. **Role shares are dropped when a dashboard moves (R11).** Roles belong to one
    organization; user shares survive for members of the target.
13. **Laravel stops alerts on predecessors with `device_moved` (R7).**
14. **The constitution amendment is MINOR (1.1.0).** It bounds an existing principle
    rather than removing or redefining it.
15. **A moved automation is recreated in the target (R11, corrected in PR 031-4).** The
    runtime ties a workflow's UUID to one organization, so the source's is turned off
    and archived as moved, and the new one starts once its successors are active.

## Design

### API: `Devices` domain (`apps/api/app/Domain/Devices`)

**Models**: `DeviceMove`, `DeviceMoveDevice`, `DeviceMoveItem`, `DeviceLink`.

**Services**:
- `Pipes` (R2): `for(Device)`, `allowsSource(Device, string)`,
  `hostedIn(Organization)` and `servedBy(Organization)`.
- `Moves/MoveTargets` (R9).
- `Moves/MovePreview`: classification, preselection, blockers, endings, profile copies,
  summary sentences and the hash.
- `Moves/MoveRequests`: confirm, idempotency, the stop phase.
- `Moves/MoveCutover`: the transaction.
- `Moves/MoveFailure`: resume what was stopped.
- `Moves/CarriedItems` (R11, from PR 031-4).
- `Moves/MoveView`.

**Changes to existing code**:
- `DeviceConfigurationService`: line 49 calls `Pipes::allowsSource`, and
  `deactivate(..., keepPlace)`.
- `DeviceController::archive` ends the installation (R3).
- `RuntimeController::apply` dispatches `Jobs/ContinueDeviceMove` after commit for move
  operations.
- `DeviceView`: `link`, `pipe`, `in_use_in` (R8).
- `DeviceDirectory`: list rows carry `pipe`.
- From PR 031-5: `OnboardingController` and `BulkOnboarding` ignore released onboarding
  rows.
- From PR 031-7: `RuntimeController` records a birth under the gateway's organization,
  and `RuntimeController::state` adds `gateways[]`.

**HTTP**:
- `Http/Controllers/DeviceMoveController` (targets, preview, store, show).
- `DeviceLinkController` (history stop, PR 031-9).
- `GatewayCredentialController` (rotate, PR 031-7).
- Routes in `routes/api.php` with `whereUuid` constraints
  (`OrganizationRouteParametersTest`).

**Permission**: `Permissions/DevicePermission::Move`, a backfill migration modelled on
`DashboardPermissionBackfill`, and the label in `packages/ui/src/lib/permission-labels.ts`.

**Readings**: `DeviceReadings` merges the predecessor's history for linked successors
(R18, PR 031-9), with `Moves/EarlierReadings` and `Moves/JoinedReadings`. The device
controller's records read and the integration `TelemetryController` history and records
go through it too.

### API: other domains

- **`DeviceAdapters`** (R3, R15, R16):
  - `AdapterService::activate` takes a target organization and creates the installation
    under the adapter's organization; `bindings` sends open installations only;
    `inUse` names the organizations.
  - `AdapterController` adds `in_use_in` and `hosted_devices`, and the
    `confirm_hosted_devices` guard on deploy, pause, rollback, decoder saves and
    credential rotation.
  - A migration for installations.
- **`DeviceProfiles`**: `Services/ProfileCopier` and `Models/DeviceProfileCopy` (R5),
  using `ProfileDefinitionCompiler` and `PublishDeviceProfile`.
- **`Dashboards`** (R11, R12): archive and restore in `DashboardController`, the
  `archived` filter, `DashboardAccess` checks; `Services/DashboardRewrite`, a pure
  function that rewrites device and parameter UUIDs through two maps and returns the
  omitted panels.
- **`Automation`** (R7, R11, R12):
  - `DagController` archive and restore;
  - `Services/WorkflowRewrite`;
  - suspension with `device_moved` in `WorkflowDeploymentService`;
  - `AlertQuery` and `ConnectivityProjector` honour the Laravel-set `device_moved` stop
    and, from PR 031-5, `pipe_organization_uuid`: `Pipes::hostedGateway` resolves the
    gateway, `Alert::subjectSummary` names another organization's gateway only, and
    `SparkplugGateway::offlineAlert` takes only the gateway organization's alert.
- **`Geospatial`**: `GeofenceService` removes a moved predecessor's assignments.
- **`Billing`**: `BillingAccounts::move` refuses while hosted devices or moves exist
  (R17). `DeviceLimit` gets `transfer(Device $from, Device $to)` (R4).
- **`Administration`**: an `OrganizationDeletion` blocker, `hosted_devices`.
- **`Audit`**: `ActivityCatalogue` entries (R20).
- **`Assistant`**: `Tools/DeviceMoveTools`, `Models/DeviceMoveProposal`, and the dismiss
  route (R19, PR 031-10).
- **`Shared`**: `OrganizationResource` exposes `capabilities.devices.move`.

### Runtime (`services/runtime`), PRs 031-5 and 031-7

- `internal/devices/types.go`: `Connection.Gateways []EdgeOrganization`.
  `internal/app/application.go`: `edgeOrganization(connection, edge)`, used by capture
  watching and recording.
- `internal/app/telemetry.go`: the capture start check uses the edge organization.
- `internal/app/connectivity.go`: the gateway episode organization comes from the
  connection's organization (PR 031-5, `organize` from the control state), then from
  `edgeOrganization` (PR 031-7), plus hosted episodes per member organization keyed
  `gateway:<connection>/<edge>@<organization>` with `pipe_organization_uuid` on the
  event.
- Tests: `connectivity_test.go` cases for mixed-organization members and existing keys;
  `telemetry_test.go` for an override.

### Contracts (`contracts/internal`)

- `state/internal.control-state.v1.{schema,fixture,cases}.json`: `connections[].gateways`
  (PR 031-7).
- `events/device.connectivity.v1.{schema,fixture,cases}.json`:
  `subject.pipe_organization_uuid` (PR 031-5).
- `tooling/verify-devices-contracts.py` picks them up by convention.
- OpenAPI is exported in each PR that changes the public API.

### Portal (`apps/portal`)

- `src/devices/DeviceDirectory.tsx`:
  - a controlled selection, limit 100, with `bulkActions` **Move to organization**;
  - row menu entries;
  - hosted rows show **Adapter: *name* (*owner*)** without a link.
- `src/devices/moves/MoveDialog.tsx` (new): a `Dialog` with the kit `Stepper`.
  - `WhereTo.tsx`: a `SearchableSelect` of targets plus **New organization…**, which
    opens the Billing accounts create form in place.
  - `WhatComesAlong.tsx`: devices with editable name, code and site; how each reports;
    dashboards and automations with their choices and **Add *n* devices**; endings;
    profile copies; the inactive warning; the pipe owner notice; from US6 the history
    option.
  - `Confirm.tsx`: summary sentences and separate archive confirmations.
  - `Done.tsx`: polls `GET device-moves/{move}` and links results.
- `src/devices/DeviceWorkspace.tsx`: **Move to organization** in the menu (needs
  `capabilities.devices.move`), the **Moved to/from** banner, the **Reports through**
  field for hosted devices, and from PR 031-7 the rotate warning and action.
- `src/devices/DiscoveryPage.tsx` and `src/adapters/connections.tsx`: **In use in
  *organization*** and the hosted counts.
- `src/dashboards/LibraryPage.tsx` and `src/automation/*`: **Archive**, **Restore**, and
  "*n* archived hidden · Show".
- `src/assistant/AssistantPanel.tsx`: the move card.
- `packages/api-client`: `deviceMoves.ts` (targets, preview, create, show) plus additions
  to devices, adapters, dashboards, workflows and gateways.
- `packages/ui`:
  - `statusOf` gains `stopping`, `moved`, `moved_in` and `failed` move states;
  - the permission label;
  - the `devices.move` capability type.

### Admin (`apps/admin`)

`ChangeBillingAccountDialog.tsx` shows the hosted-device refusal with its list (R17).

### Documentation

Each implementation PR updates the docs its behaviour changes:

- `docs/features/devices.md`: a new **Moving devices** section, hosted devices,
  **Moved to/from**.
- `docs/features/adapters.md` and the devices gateway section: pipes serving other
  organizations.
- `docs/features/access.md`: `Device.move` and the billing account note.
- `docs/features/billing.md`: moves are neutral.
- `docs/features/dashboards.md` and `docs/features/automation.md`: archiving and moves.
- `docs/features/alerts.md`: `device_moved` and hosted gateway alerts.
- `docs/features/assistant.md`, `docs/features/activity-log.md`.
- `docs/dev/gotchas.md`: installations end on archive, and parameter UUIDs are global.
- `docs/roadmap.md`: the row is removed when the last PR merges.

## Project Structure

### Documentation (this feature)

```text
specs/031-move-devices-within-account/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
├── checklists/requirements.md
└── contracts/platform-api.md  internal.md
docs/adr/ADR-039-hosted-devices-and-moves.md
.specify/memory/constitution.md                 (principle III, 1.1.0)
```

### Source Code (repository root)

```text
apps/api/app/Domain/Devices/Models/{DeviceMove,DeviceMoveDevice,DeviceMoveItem,DeviceLink}.php           (new)
apps/api/app/Domain/Devices/Services/Pipes.php                                                           (new)
apps/api/app/Domain/Devices/Services/Moves/{MoveTargets,MovePreview,MoveRequests,MoveCutover,MoveFailure,CarriedItems,MoveView}.php  (new)
apps/api/app/Domain/Devices/Jobs/ContinueDeviceMove.php                                                  (new)
apps/api/app/Domain/Devices/Http/Controllers/{DeviceMoveController,DeviceLinkController,GatewayCredentialController}.php  (new)
apps/api/app/Domain/Devices/Services/{DeviceConfigurationService,DeviceView,DeviceDirectory,DeviceReadings,BrokerProvisioner}.php
apps/api/app/Domain/Devices/Http/Controllers/{DeviceController,RuntimeController,OnboardingController,DiscoveryController}.php
apps/api/app/Domain/Devices/Services/BulkOnboarding.php, Permissions/DevicePermission.php, routes/api.php
apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php, Http/AdapterController.php
apps/api/app/Domain/DeviceProfiles/Services/ProfileCopier.php, Models/DeviceProfileCopy.php                (new)
apps/api/app/Domain/Dashboards/{Http/Controllers/DashboardController,Services/DashboardAccess,Services/DashboardRewrite}.php
apps/api/app/Domain/Automation/{Http/Controllers/DagController,Services/WorkflowRewrite,Services/WorkflowDeploymentService,Services/AlertQuery,Services/ConnectivityProjector}.php
apps/api/app/Domain/Geospatial/Services/GeofenceService.php
apps/api/app/Domain/Billing/Services/{BillingAccounts,DeviceLimit}.php
apps/api/app/Domain/Administration/Services/OrganizationDeletion.php
apps/api/app/Domain/Audit/Services/ActivityCatalogue.php
apps/api/app/Domain/Assistant/{Tools/DeviceMoveTools,Models/DeviceMoveProposal}.php                      (new)
apps/api/database/migrations/2026_11_*_{create_device_moves,create_device_links,create_device_profile_copies,end_device_installations,release_device_onboardings,archive_dashboards_and_workflows,add_gateway_credential_warning,create_device_move_proposals,add_device_move_permission}.php
apps/api/tests/Feature/Domain/Devices/Moves/*Test.php                                                   (new)
services/runtime/internal/{devices/types.go,app/application.go,app/telemetry.go,app/connectivity.go}
contracts/internal/{state/internal.control-state.v1,events/device.connectivity.v1}.{schema,fixture,cases}.json
packages/api-client/src/{deviceMoves.ts,devices.ts,index.ts}
packages/ui/src/{lib/status.ts,lib/permission-labels.ts}
apps/portal/src/devices/moves/{MoveDialog,WhereTo,WhatComesAlong,Confirm,Done}.tsx                       (new)
apps/portal/src/devices/{DeviceDirectory,DeviceWorkspace,DiscoveryPage}.tsx, src/adapters/connections.tsx
apps/portal/src/dashboards/LibraryPage.tsx, src/automation/*, src/assistant/AssistantPanel.tsx
apps/portal/e2e/device-moves.spec.ts                                                                    (new)
apps/admin/src/components/ChangeBillingAccountDialog.tsx
docs/features/{devices,adapters,access,billing,dashboards,automation,alerts,assistant,activity-log}.md, docs/dev/gotchas.md
```

**Structure Decision**: the move lives in the `Devices` domain beside lifecycle,
onboarding and `DeviceAuthorization`, and spec 016 can reuse it from there. Profile
copies belong to `DeviceProfiles`. Rewrites of dashboards and automations are pure
services in their own domains, called by `CarriedItems`.

## Delivery

No stacked pull requests: each targets `main` and opens only after its dependencies
have merged. Each one rebuilds the services it changes, runs its quickstart sections,
ticks its tasks and updates its docs.

| PR | Contents | Depends on | Verified by |
| --- | --- | --- | --- |
| 031-0 | Documents: spec, plan, research, data model, contracts, quickstart, tasks; ADR-039 (Proposed); constitution 1.1.0; index and roadmap rows | — | review |
| 031-1 | **US1 back end, adapter-fed.** `Device.move`; `Pipes`; installations end; profile copies; the move (targets, review, confirm, stop, cutover, failure); device links; place transfer; endings; `link`, `pipe`, `in_use_in`; leaving-account and deletion guards; activity; api-client; OpenAPI; isolation tests | 031-0 | quickstart 1, 2 (via API), 3; api and workers rebuilt |
| 031-2 | **US1 portal.** Bulk action and device menu; the four steps with **New organization…**; device page link and pipe; Discovery and adapter **In use in**; docs (devices, adapters, access, billing) | 031-1 | quickstart 2, 3 in the portal; portal rebuilt |
| 031-3 | **Archive dashboards and automations** (FR-037, available outside moves) | 031-0 | quickstart 4.3; api and portal rebuilt |
| 031-4 | **US2.** Carried items (move, copy, keep, archive), rewrites, recipients and shares, suspension with `device_moved`, **Add *n* devices**; panels mark moved devices; docs | 031-2, 031-3 | quickstart 4; api, workers and portal rebuilt |
| 031-5 | **Gateway pipes.** Devices behind gateways become movable; gateway episodes by owner plus hosted episodes; the projector; onboarding rows released; contract `device.connectivity.v1`; docs (alerts) | 031-2 | quickstart 5.1–5.2; api, workers and runtime rebuilt |
| 031-6 | **US5 pipe operations.** Hosted counts, refusals naming organizations, `confirm_hosted_devices`, the review test; docs | 031-5 | quickstart 5.3–5.4; api and portal rebuilt |
| 031-7 | **US3 direct devices.** Gateway moves; `gateways[]` in the control state; edge organization for captures and episodes; credential rotation and warning; docs | 031-5 | quickstart 6; api, workers, runtime and portal rebuilt |
| 031-8 | **US4 onboarding into another organization**, for adapter and gateway sources | 031-5 | quickstart 7; api and portal rebuilt |
| 031-9 | **US6 history across the move.** The option; merged reads; stop; revoke on leaving the account; the runtime's optional `bucket_seconds` for history; docs | 031-2 | quickstart 8; api, runtime and portal rebuilt |
| 031-10 | **US7 the assistant card** | 031-4 | quickstart 9; api and portal rebuilt |

**Order**:
1. 031-1, then 031-2. 031-3 can open at any time after 031-0.
2. After 031-2: 031-4 (once 031-3 has merged), 031-5 and 031-9 in parallel.
3. After 031-5: 031-6, 031-7 and 031-8. Whichever of 031-6 and 031-7 lands second
   guards gateway credential rotation.
4. After 031-4: 031-10.

ADR-039 moves to Accepted when 031-2 merges, and the folder freezes when the last PR
merges.

## Risks

- **Successor activation refused after cutover.** The predecessor is archived and the
  successor inactive.
  - Mitigation: the same configuration against the same source and birth (stored birth
    for adapters, ADR-027). **Done** names the reason, and a target member activates
    with no re-mapping.
- **Cross-organization leaks through existing views.** The adapter Sources tab embeds
  the full installed device, and Discovery links to its device (research, R8).
  - Mitigation: PR 031-1 switches both to `in_use_in`, and `DeviceMoveIsolationTest`
    walks each pipe route as a target-only member.
- **Profile rebuild drift.** A copied version that compiles differently would change
  readings.
  - Mitigation: the copier test compares both canonical definitions under the
    parameter map, for every profile fixture.
- **Installation backfill.** Ending installations of archived devices changes adapter
  deploy bindings.
  - Mitigation: the backfill touches only devices already archived, which no longer
    store. The next deploy simply stops sending them.
- **A long stop phase.** With the runtime down, a move waits in `stopping` with its
  devices deactivated.
  - Mitigation: that is the state the runtime left them in. **Done** says what it
    waits for, and a failed deactivation resumes the others.
- **Pipe owners lose sight of what they serve.** Before 031-6, deleting an adapter that
  serves hosted devices is refused without naming them.
  - Mitigation: refusal already holds (`AdapterService::inUse`); 031-6 adds the names.

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| Principle III relaxed for hosted devices and history (constitution 1.1.0, ADR-039) | One vendor credential and poll must serve devices in several customer organizations of one payer (spec, Clarifications) | Copying the adapter hands the target a credential that reads every device on the vendor account, polls twice, and needs a runtime per organization |
| A two-phase move (stop, then cutover) instead of one runtime swap | Archive requires an acknowledged deactivation; keeping it guarantees no reading after cutover is stored for the source | A swap message needs a new contract and runtime path for a sub-minute gap the spec accepts; archiving before the runtime confirms risks both devices storing |
| Profiles rebuilt with a parameter map | Parameter UUIDs are unique across all profiles, and the target can't reference the source's profile | Sharing the source's artifact would be a third crossing |
| A per-edge organization list in the control state | A moved direct gateway keeps its topic, which is in the source's `onboarding-` group | A new connection would change the topic and need the hardware reconfigured |
| Laravel stops alerts with `device_moved` | FR-007 clears open alerts at cutover, and only runtime transitions clear them today | Leaving them open shows alerts on archived devices with no way to clear them |
