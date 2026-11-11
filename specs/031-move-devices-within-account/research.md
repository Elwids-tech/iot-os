# Research: Move Devices Within a Billing Account

Decisions for [spec 031](spec.md), grounded in the code on 2026-11-11 (commit
`f6319825`) and recorded in
[ADR-039](../../docs/adr/ADR-039-hosted-devices-and-moves.md). Each entry gives a
decision, the reason, and what was rejected. `Devices/` means
`apps/api/app/Domain/Devices/`; `runtime/` means `services/runtime/internal/`.

## What the code already fixes

- **The runtime never changes a device's organization.** `Store.Apply` updates a
  device's generation and definition on conflict but never `organization_uuid`, and
  `PersistResult` refuses a result whose definition organization differs from the
  stored device row (`runtime/storage/store.go:203-204, 259`). Every stored row
  (`observations`, `latest`, `telemetry_outbox`, `diagnostics`,
  `usage_data_points`) carries the definition's organization (`store.go:276-322`).
- **The runtime routes by source key, not organization.** A packet's group must match
  its connection (`runtime/app/application.go:333`). Definitions are then matched on
  `Source.ConnectionUUID`, `EdgeNodeID` and `DeviceID` (`application.go:428-435`;
  `runtime/devices/types.go:16`). Nothing compares the definition's organization with
  the connection's, so a definition in organization B on a source of organization A
  already stores for B.
- **Laravel is the gate.** `DeviceConfigurationService::saveDraft` loads the source
  with `DiscoveryCandidate::where('organization_id', $device->organization_id)`
  (`Devices/Services/DeviceConfigurationService.php:49`). A source's organization is
  its connection's, set when the birth is recorded
  (`Devices/Http/Controllers/RuntimeController.php:287`), and an adapter's sources hang
  off its publisher gateway in `adapters-<organization uuid>`
  (`DeviceAdapters/Services/AdapterService.php:156-176`). So a device in B naming A's
  source gets 404. `artifact()` (`:37`) and `AdapterService::activate` (`:259`, device
  created in the adapter's organization) are the other organization gates on this path.
- **Adapter-fed provenance.** The runtime rejects a metric whose `installation_uuid`
  differs from the definition's (`runtime/devices/profile.go:170-172`), and the adapter
  publisher stamps it from its deploy bindings (`AdapterService.php:197-201`;
  `services/adapters/nodes/adapter.js:517-519`).
- **Installations never end.** No code writes `device_installations.ended_at`, and
  `device_adapter_candidate_id` is unique across all rows
  (`database/migrations/2026_10_07_010000_create_device_adapters.php:76`). Archiving
  clears `reserved_source_uuid` but leaves the installation, which stays in the
  adapter's deploy bindings (`Devices/Http/Controllers/DeviceController.php:153-167`).
- **Onboarding rows outlive their device.** `device_onboardings` is unique on
  `(sparkplug_gateway_id, source_device_id)`, archived devices included
  (`2026_10_07_000000_create_device_onboardings.php:24`; `OnboardingController.php:74`;
  `BulkOnboarding.php:268`).
- **Direct devices share one connection per organization.** Each gets gateway
  `device-<request uuid>` on connection `onboarding-<organization uuid>`
  (`OnboardingController.php:57-68`); broker rules are per edge node
  (`BrokerProvisioner.php:62-71`).

## The move

### R1. A move stops the devices, then cuts over in one transaction

**Decision**: confirming a move runs in two phases.

1. **Stop.** The move is recorded (`device_moves`, status `stopping`). Each active
   predecessor gets an ordinary deactivation request through
   `DeviceConfigurationService::deactivate`, flagged as part of the move so it keeps
   its device-limit place (R4). Inactive predecessors need nothing.
2. **Cutover.** When the runtime has acknowledged every deactivation
   (`device.deactivated.v1` in `RuntimeController::apply`), a `ContinueDeviceMove` job
   runs the cutover as one database transaction (`MoveCutover`):
   - lock both organizations and re-check the account and the mover's permissions;
   - copy profile versions (R5);
   - archive each predecessor, ending its installation and onboarding record;
   - create each successor with its carried-over configuration and request its
     activation (R6);
   - write the device links;
   - stop what ends (R7);
   - carry dashboards and automations (R11);
   - record the activity in both organizations.

   A move with no active device cuts over straight from confirmation. If the runtime
   refuses a deactivation, or the cutover's checks fail, the move fails and the devices
   it stopped are resumed with the existing reactivation, which reuses each device's
   last applied configuration. The source ends as it started, apart from the readings
   the stop missed.

**Rationale**:
- Archive already requires an acknowledged deactivation
  (`DeviceController.php:158`). Keeping that rule means a predecessor can never still
  be running in the runtime after it is archived, so no reading after cutover is
  stored for the source (FR-009).
- Every runtime-side step reuses an existing, acknowledged operation, and the cutover
  is the "one step" FR-007 asks for.
- The spec accepts readings lost between the stop and the start (Assumptions).

**Alternatives**:
- *Change `devices.organization_id` in place*: readings, latest values and runtime
  rows are stamped with the old organization, and the runtime refuses the change.
- *Archive and create in one transaction, with an ordered deactivate-then-activate in
  the outbox*: shorter gap, but a predecessor would be archived before the runtime
  confirms it stopped, and a refused deactivation would leave both devices storing.
- *A new runtime "swap" control message*: a contract and runtime change to shave
  seconds off a gap the spec accepts.

### R2. Hosted sources: one rule replaces the organization scope

**Decision**: a `Pipes` service in `Devices/Services` answers, for a device or a
source, what its pipe is (adapter, gateway, or the device's own gateway), which
organization owns it, and whether the device is hosted. `saveDraft`'s line-49 scope
becomes `Pipes::allowsSource($device, $candidateUuid)`, which accepts:

- a source of the device's own organization, as today; or
- the source the device already holds (`devices.device_discovery_candidate_id`), when
  the source's organization is in the device's billing account.

A device only comes to hold another organization's source through a move (R6) or an
onboarding into another organization (R15). A target member can reconfigure a hosted
device within its source's announced metrics, but can't point a device at another
organization's source, because Discovery, gateway and adapter routes stay scoped to
the pipe owner.

`ensureNotAdapterSource` (`:73-82`) and `compile` (`:132-134`) already look the
installation up without an organization filter and need no change. `artifact()` stays
scoped, because successors use copied profiles (R5).

**Rationale**: one place decides the crossing (constitution III, amended), and it can
only confirm a binding someone with `Device.move` in both organizations created.

**Alternatives**: allowing any source in the account (any target member could read
any other organization's Discovery by trial); an explicit grant table per source
(duplicates what the device's own source column already says).

### R3. Adapter installations end, and a successor gets its own

**Decision**:
- `device_installations` gets `ended_reason`, and the unique index on
  `device_adapter_candidate_id` becomes a partial index `WHERE ended_at IS NULL`.
- Archiving a device ends its open installation (`archived`). A move ends it with
  `moved`.
- At cutover each adapter-fed successor gets a new installation on the same adapter
  source, stamped with the adapter's organization, the pipe owner.
- After commit, each adapter in the move is redeployed once (`DeployAdapter`) so the
  publisher stamps the new installation, as an adapter activation does today
  (`AdapterService.php:269-270`).
- `AdapterService::bindings` sends only open installations.
- The successor's activation compiles against the source's stored birth when the
  publisher hasn't re-announced it yet (ADR-027).

**Rationale**:
- The runtime's provenance check needs the successor's own installation, and observations
  keep `installation_uuid`, so each device's history keeps its own.
- Ending the installation on archive fixes the stuck source found while planning: today
  an archived adapter-fed device's source can never serve another device. The spec
  relies on this ("A target that archives a hosted device frees the source").

**Alternatives**: re-pointing the predecessor's installation at the successor (one
installation would then span two devices' histories); no redeploy (the publisher would
keep stamping the old installation and the runtime would drop every reading).

### R4. Device limit: places carry over

**Decision**:
- A move's deactivations keep `limit_place_at`: `DeviceConfigurationService::deactivate`
  gains a `keepPlace` flag, used only by moves.
- At cutover, archiving the predecessor and creating the successor move the place in
  the same transaction: the successor gets the predecessor's `limit_place_at` and the
  predecessor's is cleared, with no `DeviceLimit::claim`.
- A successor that arrives inactive releases the place (`DeviceLimit::release`).
- A failed move resumes its devices without a claim (`retake`, which never refuses).
- `DeviceLimit::recheck` is not called.

**Rationale**:
- The count is per billing account (`Billing/Services/DeviceLimit.php:99-120`), so
  moving a place within one transaction keeps it at N.
- The monthly peak is written only on claim and release (`:38-73`), so neither fires
  and the peak can't count a device twice (FR-012, SC-006).
- A move at the limit is never refused.

**Alternatives**: release then claim (a concurrent activation elsewhere in the account
could take the place and refuse the successor); claim before release (the count would
reach N+1 and the peak would keep it).

### R5. Profile versions are rebuilt in the target

**Decision**: a `ProfileCopier` in `DeviceProfiles/Services` copies a published
version (`device_profile_artifacts` row) into a target organization:

- It finds or creates the target profile for the source profile: one per pair, keyed
  in `device_profile_copies`.
- It rebuilds the target profile's draft from the source artifact's canonical
  definition: parameters, groups, calculations and alarm templates.
- It reuses the target profile's parameter row for each parameter key, so parameter
  UUIDs stay stable across copied versions.
- It publishes through `PublishDeviceProfile`, and records the source artifact, the
  target artifact and the `parameter_map` (source parameter UUID → target parameter
  UUID).

A later move or onboarding of the same source version into the same target reuses the
row (FR-011). The copy keeps the profile's code unless the target already uses it,
otherwise `<code>-2`, `-3` and so on; the review shows the code.

A test compiles both artifacts and asserts that their definitions are equal once the
parameter map is applied.

**Finding**: devices reference only organization profiles (`artifact()` at
`DeviceConfigurationService.php:37`; templates are copied into an organization before
use), so every version a successor needs is copied. FR-011's "platform templates are
used as they are" never applies in the current model.

**Rationale**:
- `profile_parameters.uuid` is unique across all profiles
  (`2026_08_31_010200_create_profile_parameters_table.php:15`), so a copy needs new
  parameter UUIDs.
- The `parameter_map` is what lets mappings, dashboard panels and automation bindings
  be rewritten without asking anyone.

**Alternatives**:
- Referencing the source's artifact from the target: a third cross-organization
  read, which the spec rules out.
- Copying the artifact row alone, without a profile: no draft to edit later, and the
  profile list would hide it.

### R6. The successor

**Decision**: in the cutover transaction, each successor is created in the target with
the predecessor's name and code (edited in the review), tags, custom attributes, the
chosen target site or none, and `device_discovery_candidate_id` and
`reserved_source_uuid` taken over from the predecessor.

- Its draft is the predecessor's last applied configuration: source, mappings and
  conversion settings, with the artifact and every parameter UUID rewritten through
  the parameter map (R5).
- A predecessor that was active, moved by someone holding `Device.activate` in the
  target, gives a successor activated through `DeviceConfigurationService::activate`,
  with the place transferred (R4).
- Otherwise the successor keeps the draft, inactive, and the review warned about it
  (FR-008). A target member activates it later with no re-mapping.
- If the runtime refuses a successor's activation after cutover, the successor stays
  inactive with the runtime's reason. The move's **Done** step lists it, as it lists an
  automation to turn on. The source isn't touched again.

**Rationale**: the same configuration against the same source and birth is the case
the runtime already accepts.

### R7. What ends at cutover

**Decision**:

| Item | At cutover |
| --- | --- |
| Unsent and possibly sent commands | Already settled by the stop phase's deactivation: `prepared`/`pending` cancelled, outstanding `uncertain` (`RuntimeController.php:357-362`) |
| Open alerts on a predecessor | Laravel sets `cleared_at` and `stopped_reason = device_moved` on alerts still open on a predecessor (subject or `automation_alert_devices`); connectivity alerts the stop closed as `device_deactivated` during the move are relabelled `device_moved`. The projector ignores later transitions for an alert already stopped. A gateway alert ends only when every device it lists moves; while it lists a device that stays behind the gateway it stays open, because the gateway stays (R14, corrected in PR 031-5) |
| Geofence assignments | Removed through `GeofenceService`, which retires each assignment's v1 workflow (each assignment is its own workflow) |
| Running telemetry captures | Laravel stops the source organization's captures on the moved sources through the runtime's capture API, after commit. A missed stop still expires within ten minutes (`runtime/telemetry/capture.go:81-100`), and until then it only shows the pipe owner the raw messages of its own pipe, which FR-022 lets it see |
| Integration application grants | Unchanged: they stay on the predecessor and keep reading its history; `ApplicationGrant` filters by organization, so they never reach the successor |
| Device onboarding record (gateway sources) | Released, so the pipe owner can onboard the source again once a hosted device is archived |

**Rationale**: FR-007's list. Laravel stopping an alert is new, but it is the same stop
state the runtime writes for a deactivation, with its own reason.

### R8. What each side sees

**Decision**:

- **Device reads** (`DeviceView::device`) gain:
  - `link`: `direction` (`moved_to` or `moved_from`), the other organization's name,
    `cutover_at`, and, from US6, `history`;
  - `pipe`: `kind` (`adapter` or `gateway`), `name`, `owner_organization_name`,
    `online`, `hosted`.
- **For a hosted device** the source's `candidate.gateway` and adapter links are
  replaced by the pipe summary. The candidate's metrics stay, because they are the
  metrics the pipe announces for that source (FR-021).
- **Device list** rows show **Adapter: *name*** or **Gateway: *name*** with **(*owner*)**
  for hosted devices, and never link to them.
- **Pipe owner's views** (`DeviceView::candidate`, the adapter's Sources tab at
  `AdapterController.php:150-155`, Discovery at `DiscoveryPage.tsx:122-125`) show
  `in_use_in: {organization_name}` in place of `assigned_device_uuid` and the embedded
  device when the source's device is in another organization. Deliveries, samples and
  previews are unchanged (FR-022).
- **Every pipe route stays 404 to target-only members.** Gateways, connections,
  discovery candidates, adapters, credentials, deliveries and captures all keep
  `DeviceAuthorization::authorize`'s organization check.
- **Hosted devices can't be captured from the target.** Captures show the pipe's raw
  messages, which stay with the pipe owner. The runtime already scopes captures to the
  connection's organization (`runtime/app/telemetry.go:39`).

**Rationale**: FR-010, FR-021 and FR-022 are allow-lists, so the views build the
allowed fields rather than strip the others.

### R9. Permissions and targets

**Decision**:
- `DevicePermission::Move = 'Device.move'`, labelled **Move devices to another
  organization**, exposed as capability `move`.
- Organization Admin gets it through the ceiling: unrestricted ceilings include it from
  the catalogue, and a backfill migration reconciles every Admin role, following
  `DashboardPermissionBackfill`. Restricted ceilings gain it only when a platform
  administrator adds it, as with any permission they left out.
- Cross-organization checks use `DeviceAuthorization::capabilities($user, $target)`,
  which switches team and checks membership.
- `GET organizations/{org}/device-move-targets` lists organizations of the source's
  account where the person holds `Device.move`, and nothing else of the account. For
  an owner of the account with room under its organization limit it adds
  `new_organization: {billing_account_uuid}`. **New organization…** then calls the
  existing `POST billing-accounts/{uuid}/organizations` (`OwnerOrganizations::create`),
  which makes the owner Organization Admin (FR-003).

**Rationale**: no new role and no account-level access (ADR-026); members still never
learn the account from `OrganizationResource`.

### R10. Concurrency, idempotency and the runtime's answers

**Decision**:
- `POST device-moves` takes `operation_uuid` and a hash of the request, as bulk
  onboarding does (`BulkOnboarding.php:50-98`). The same request returns the same move;
  a different one with the same `operation_uuid` gets 409.
- Each move device row holds `outstanding_key` (the predecessor id, unique, cleared
  when the move ends), so a device is in at most one move. The second of two movers
  gets 409 with nothing changed.
- `preview_hash` (the review's content hash) must match on confirm. A changed situation
  (a dashboard edited, a device activated) gets 409 and a fresh review.
- `RuntimeController::apply` dispatches `ContinueDeviceMove` after commit when an
  acknowledged or failed operation belongs to a move.
- The job is idempotent: it locks the move and returns if the move isn't `stopping` or
  still waits for a device.
- A move waits as long as the runtime has not answered. It never times out into a
  guess (constitution VI). **Done** shows "Waiting for the runtime to stop *n*
  devices".
- FR-004 blockers use the existing signals: lifecycle `archived`,
  `deployment_status = pending`, a pending `device_operations` row, or an outstanding
  move.

### R11. Dashboards and automations (US2)

**Decision**: `CarriedItems` in `Devices/Services/Moves` classifies, plans and applies
carried items.

**Classifying.** Device references are found in each source dashboard's `widgets` JSON
(`DashboardDefinition.php`):
- `config.sources[].device_uuid`;
- `config.devices[].device_uuid`;
- `config.location_device_uuids[]`.

They are found in each automation's `workflow.bindings[].device_uuid`
(`DagAuthoring.php:25-28`). An item using only moving devices is "only moving";
anything else is "others too" (FR-030). v1 geofence workflows are not automations
here: they end with their geofence assignment (R7), and geofences don't move (spec,
out of scope).

**Moving a dashboard.**
- Its `organization_id` changes in the transaction.
- Every `device_uuid` and `parameter_uuid` is rewritten through the successor and
  parameter maps, and `device_name` snapshots are kept.
- Shares and `access` survive only for users who are members of the target. Role shares
  are dropped, because roles are per organization. The owner (`created_by`) stays if
  they are a target member, otherwise the mover.
- Panels that name a geofence or a workflow that doesn't come along lose that
  reference and are listed.
- Its revisions move with it. The next save validates against the target, as any save
  does.

**Copying a dashboard.**
- A new target dashboard gets only the panels and panel sources of moving devices,
  rewritten as above.
- Panels left with no source are omitted and listed.
- The copy is owned by the mover, with `access = restricted` and no shares.
- The original is untouched.

**Moving an automation.** (Corrected in PR 031-4: the plan had the workflow change
`organization_id` in place. The runtime keys `rule_heads` by workflow UUID and refuses a
deployment for the same UUID under another organization, "tenant mismatch"
(`runtime/storage/dag.go`), so an automation, like a device, can't change organization
in place.)
- The automation is recreated in the target with a new UUID: its name, layout and
  graph, the bindings rewritten through the maps onto the successor's pending
  configuration and generation. A successor that arrives inactive has no configuration
  yet, so its binding names the nil UUID until the editor re-binds it.
- Recipients who aren't verified target members with `Device.view` are removed and
  listed; notifications turn off when none is left.
- The source's automation is turned off (a disable deployment, superseding the running
  one with `stopped_reason = moved`) and archived with `archived_by_move_id`, as
  **Moved to *target***. Its run history (`automation_actions` and the runtime's DAG
  tables) stays with it in the source.
- The new automation starts in the target only when all of these hold:
  - it was running;
  - `automation_settings.enabled` is true in the target (and not stopped);
  - the mover holds `Workflow.activate` there;
  - it has no command node;
  - its successors arrive active.
  An automation activates against applied configurations, so it starts once the
  runtime has applied its successors there (`ContinueDeviceMove` after their
  `device.applied.v1`), as the mover.
- Otherwise it arrives off and **Done** lists it, with the reason.

**Keeping an automation.** On its own, the runtime suspends a workflow bound to a
deactivated device only at its next evaluation (`binding_changed`, from
`checkDAGBindings` in `runtime/storage/dag.go:47-60`), and a workflow that used only
moved devices is never evaluated again. So at cutover each kept workflow that still
binds a predecessor is turned off in the runtime (an inactive deployment) and set
`suspended` with `stopped_reason = device_moved`; the editor and directory name the
moved device from the predecessor's link. Activation is refused until a source member
removes the binding (FR-036), for a kept workflow that was off as well.

**Archiving** uses R12. **Add *n* devices to this move** (FR-031) re-runs the preview
with the extra devices when the mover holds `Device.move` for them.

**Rationale**:
- Panels and bindings are JSON, not rows, so rewriting is a pure function of two maps
  and is unit-testable.
- Saving a kept source dashboard still passes, because the archived predecessor is in
  the source and keeps its last applied configuration (`DashboardDefinition.php:157,
  262`) (FR-034).

### R12. Archiving dashboards and automations

**Decision**:
- `dashboards` and `automation_workflows` gain `archived_at` and `archived_by` (integer
  user id), and with US2 `archived_by_move_id`.
- Lists take `archived=only|include` and hide archived items by default, with the
  devices list's "*n* archived hidden · Show" pattern (`DeviceDirectory.tsx:337-352`).
- Dashboards: archiving needs the owner or `Dashboard.manage`; an archived dashboard is
  read-only, falls out of the remembered dashboard, and is restored by the same people.
- Automations: archiving needs `Workflow.activate`, because it turns the workflow off
  first (a deactivation deployment), and `Workflow.manage`. Restoring needs
  `Workflow.manage` and brings it back off.
- Activity: `dashboard.archived`, `dashboard.unarchived`, `workflow.archived`,
  `workflow.unarchived`. `dashboard.restored` already names restoring an earlier
  version, so restoring from the archive is `unarchived` for both.

**Rationale**: FR-037 and FR-062. Nothing can be deleted for automations today
(restrict foreign keys), and archiving needs no foreign key change.

### R13. Direct devices take their gateway (US3)

**Decision**: at cutover a direct device's gateway (`device-<uuid>`) changes
`organization_id` to the target, with its discovery candidates and its
`device_onboardings` row, which `ConnectionSettings::device` needs for settings and
kits (`Firmware/Services/ConnectionSettings.php:28-60`). Its connection
(`onboarding-<source uuid>`) stays with the source as the Sparkplug group's namespace,
so the topic, credentials and broker rule don't change (FR-027).

- **Runtime.** `internal.control-state.v1` connections gain an optional `gateways`
  list (`edge_node_id`, `organization_uuid`) for gateways whose organization differs
  from the connection's. The runtime resolves "organization of this edge" from it for:
  - capture checks and recording (`telemetry.go:39`, `application.go:344, 365`);
  - gateway episodes (R14).
- **Births.** `RuntimeController` records a new source under its gateway's
  organization instead of the connection's (`:287`).
- **Rotation.** `POST gateways/{gateway}/credentials/rotate`, with
  `Device.manage-connections`:
  - sets a new password through `BrokerProvisioner`;
  - disables and re-enables the broker client, which drops its session, so the old
    password stops at once;
  - records `gateway.credentials.rotated`.

  Today no gateway credential can be rotated (`DiscoveryController.php:104-112`
  re-applies the same password); rotation is new for every gateway.
- **Warning.** The gateway records `credentials_known_to_organization_id` at cutover,
  and the target sees the warning until a rotation clears it (FR-028).
- **Blockers.** The source organization can't be deleted or leave the account while
  its `onboarding-` connection carries another organization's gateway.

**Alternatives**:
- A new connection for the moved gateway: a new group means a new topic and
  reconfigured hardware, which FR-027 forbids.
- Moving the whole `onboarding-` connection: it carries every other direct device of
  the source.

### R14. Gateway pipes and offline alerts (US1 for gateways, US5)

**Decision**: devices behind a gateway become movable once offline alerts follow
ownership (FR-026).

- **Runtime.** Gateway episodes are attributed to the gateway's organization, from the
  connection or R13's override, instead of `members[0].organization`
  (`runtime/app/connectivity.go:729`).
- **Hosted devices behind an offline gateway.** They get a gateway episode of their own
  organization, keyed `gateway:<connection>/<edge>@<organization uuid>`, holding only
  that organization's devices.
- **Contract.** `device.connectivity.v1` gains an optional `subject.pipe_organization_uuid`
  on a hosted episode.
- **Projector.** `ConnectivityProjector` resolves such a subject through `Pipes` when
  the gateway is in another organization of the account. It stores the alert in the
  hosted organization, naming the pipe by name only.
- **Onboarding rows.** Rows of archived devices stop blocking a source
  (`OnboardingController.php:74`, `BulkOnboarding.php:268`).
- **Gateway sources at cutover.** A successor on a gateway source activates against the
  live birth, which the runtime still holds for the source after the predecessor's
  deactivation.

**Rationale**: without this, a gateway whose first member is a hosted device would be
dropped by the projector, because the gateway isn't in that organization
(`ConnectivityProjector.php:107-117`), and the pipe owner would lose its gateway alert.
That is why US1 ships for adapter-fed devices first.

### R15. Onboarding into another organization (US4)

**Decision**:
- `POST device-adapters/{adapter}/candidates/{candidate}/activate` and the gateway
  onboarding paths (`POST device-onboardings` in gateway mode, Discovery's **Onboard**)
  take an optional `organization_uuid`, defaulting to the pipe owner.
- Another organization needs `Device.move` in both organizations and `Device.manage`
  plus `Device.activate` in the chosen one.
- The profile version is copied (R5). The device and its installation are created as in
  R6, so the device is hosted from birth.
- Bulk onboarding stays single-organization (out of scope).

### R16. Pipe operations (US5)

**Decision**:
- **Counts.** Adapter and gateway reads gain `hosted_devices: [{organization_name,
  count}]`.
- **Refusals.** Deleting an adapter, archiving or deleting a gateway, and rejecting or
  onboarding a source in use answer 409 naming the organizations and counts (FR-023).
  Adapter deletion is already refused while installations exist
  (`AdapterService::inUse`, `:281-294`); this adds the names.
- **Confirmations.** Pause, deploy, rollback, decoder changes and credential rotation on
  a pipe that serves hosted devices answer 409 `hosted_devices_affected` until the
  request carries `confirm_hosted_devices: true`, the `confirm_retention` pattern of
  `BillingAccounts::move` (FR-024).
- **Review.** It already follows each device's source birth in the runtime
  (`application.go:464-489`), so hosted devices need review in their own organization
  with no change (FR-025). A test proves it.

### R17. Leaving the account (FR-061)

**Decision**:
- `BillingAccounts::move` and `OrganizationDeletion` refuse an organization that has
  non-archived hosted devices, or whose pipes or `onboarding-` connection serve another
  organization's devices. They also refuse one in a move that is still stopping.
- `BillingAccounts::move` lists the devices per organization.
- This ships with the first PR that can create hosted devices, so no crossing ever
  spans two accounts.

### R18. History across the move (US6)

**Decision**: the runtime doesn't change. `DeviceReadings` (every history read in
Laravel: charts, tables, exports, dashboard panels and the device API) asks the runtime
twice for a successor whose link includes history:

- the predecessor's readings, under the source organization, the source's retention
  and `until = cutover_at`, with parameter UUIDs mapped through the profile copy;
- then the successor's own readings.

It merges them, splitting aggregate buckets at the cutover and recombining them from
counts. Whether the runtime's aggregate responses already carry a count per bucket is
unchecked; if not, PR 031-9 adds the field as an additive runtime change. Each predecessor reading carries `recorded_in: "source"`.

- **Stopping.** `POST devices/{device}/link/history` (`{enabled: false}`), on the
  predecessor by a source member with `Device.move`, sets `history_stopped_at`.
- **Leaving the account.** Either organization leaving the account sets it too
  (`left_account`).
- **No chains.** History never follows a chain of links: each link shares only its own
  predecessor's readings, because the person who chose it held `Device.move` in those
  two organizations only.

**Rationale**: Laravel decides the crossing and the runtime only answers per-organization
queries it already serves (constitution I and III), so there is no runtime change and
no copy.

### R19. The assistant (US7)

**Decision**:
- A `DeviceMoveTools` tool for the device-side assistant (`OnboardingAssistant`, scope
  `onboarding`; no new scope) has two actions:
  - `find_targets` (R9's list);
  - `prepare_move`, which runs the same `MovePreview` and stores a
    `device_move_proposals` row (content hash, preview, conversation, user).
- The portal renders it with the kit's `ActionCard`, holding the **What comes along**
  list. The person changes choices there and confirms.
- Confirming calls `POST device-moves` with `origin: assistant` and the proposal's
  uuid, which marks the proposal applied. The assistant never calls it.
- With the assistant disabled nothing changes (constitution V).

**Rationale**: spec 021's action cards aren't built. The adapter proposal pattern
(`OnboardingProposals`) is the working precedent for a hash-checked, person-approved
card.

### R20. Activity log

**Decision**:
- `device_move.started`, `device_move.completed` and `device_move.failed` are recorded
  in both organizations, with the devices, the other organization's name and the
  cutover time.
- Per device: `device.moved_out` (source, subject the predecessor) and `device.moved_in`
  (target, subject the successor).
- From US3 and US4: `gateway.credentials.rotated`, `device.onboarded_into` and
  `device_link.history_stopped`.
- Each is added to `ActivityCatalogue` (`:80-151`). FR-013 is satisfied by the
  start and completion records.

### R21. Tests and verification

**Decision**:
- **PHP.** PHPUnit feature tests under `tests/Feature/Domain/Devices/Moves/`, with
  two organizations on one account (`OrganizationFactory::forBillingAccount`) and a
  third on another account in every test class.
- **Isolation.** `DeviceMoveIsolationTest` holds every FR-060 case, because no spec 003
  harness exists yet. When it lands, these cases join it.
- **Go.** Tests for R13 and R14: state parsing, edge organization, episode
  attribution and keys.
- **Contracts.** Fixtures and cases for `internal.control-state.v1` and
  `device.connectivity.v1` (constitution IV).
- **Portal.** Playwright for the four steps, the device page's link and pipe, and the
  archive lists.
- **Stack.** Each PR rebuilds what it changes and runs its quickstart sections on the
  stack (constitution IX). The suite runs on PostgreSQL/TimescaleDB only.

## Delivery

### R22. US1 ships for adapter-fed devices first

**Decision**:
- The first two implementation PRs move devices that report through an adapter, or
  that have no source yet.
- Devices behind a gateway and direct devices are refused in the review ("Devices
  behind a gateway can't be moved yet", "Directly connected devices can't be moved
  yet") until R14 and R13 land.
- Dashboards and automations stay in the source until US2 lands. The review lists them
  as staying, which is one of each row's valid choices. Until then a kept automation
  that also uses other devices is suspended at its next evaluation
  (`binding_changed`), and one that used only moved devices receives nothing more.
  US2 adds the explicit suspension naming the moved device (FR-036).

**Rationale**: adapter-fed moves need no runtime change (R1 to R8), and they are the
request that started the feature. Gateway pipes need R14's runtime and projector
change first, or the pipe owner's gateway alerts could be lost.

**Alternatives**: one PR for all of US1 (runtime, projector and portal together, too
large to review); moving gateway devices without R14 (a regression for the pipe
owner).
