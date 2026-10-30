# Tasks: Device Offline Alerts

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: part of the feature (SC-003, SC-004, SC-009, SC-010, SC-011; constitution III,
IV and IX). Write each test with its task and see it fail first. API tests run on
PostgreSQL, not SQLite.

**Delivery**: the documents pull request (this folder) comes first. Then six pull
requests, in the plan's order: Phase 1 is pull request 1, Phases 2 to 4 are pull
request 2, Phase 5 is 3, Phase 6 is 4, Phase 7 is 5 and Phase 8 is 6. Each is based on
`main` and opened after the one before it merges, never stacked. Phases follow that
order rather than story priority, because settings and mutes must exist before anyone
is notified (research D15). Tasks follow the owner's decisions of 2026-10-25 and
2026-10-30 (automatic *Offline after*; No data shares it).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US6); a pull request's documents
  and verification tasks carry the story of its main phase

Paths: `rt/` is `services/runtime/internal/`, `api/` is `apps/api/`, `portal/` is
`apps/portal/src/`. No setup phase: the monorepo, stack and tooling exist.

---

## Phase 1: Foundational, alerts generalised (pull request 1; blocks everything)

**Purpose**: one alerts table for workflow and connectivity kinds, with no behaviour
change (FR-035, D7).

- [ ] T001 New migration `api/database/migrations/…_generalise_automation_alerts.php`: on `automation_alerts` add `kind` string(32) default `workflow`, `severity` string(16) default `warning`, make `automation_workflow_id` and `automation_deployment_id` nullable and, on `pgsql` only, add the check "`kind = 'workflow'` ⇔ both present"; add `episode_key` string(160) null unique, `subject_device_id` (FK `devices`), `subject_gateway_id` (FK `sparkplug_gateways`), `subject_adapter_id` (FK `device_adapters`), all null and `restrictOnDelete`, `cause` string(32) null, `offline_since`, `last_seen_at`, `last_observed_at`, `suppressed_at` timestamptz null, `threshold_seconds`, `grace_seconds`, `reporting_interval_seconds`, `poll_interval_seconds` integer null, `threshold_automatic` boolean null, `stopped_reason` string(64) null, `held` boolean default false, `held_count` integer default 0; create `automation_alert_devices` (`automation_alert_id`, `device_id`, primary key on both) and backfill it from each workflow alert's bound device (deployment `definition.binding.device_uuid`, else `definition.bindings[0].device_uuid`, as `AlertProjector::bell` does); on `automation_alert_deliveries` add `channel` string(32) default `email` and make the unique key (alert, recipient, type, channel)
- [ ] T002 `api/app/Domain/Automation/Models/Alert.php`: casts for the new columns, kind constants (`workflow`, `device_offline`, `gateway_offline`, `connection_lost`), `devices()` through `automation_alert_devices`, `subjectDevice()`, `subjectGateway()`, `subjectAdapter()`, `isWorkflow()`; `AlertDelivery` gains `channel`
- [ ] T003 Make every alert reader null-safe and kind-aware, workflow output unchanged: `api/app/Domain/Automation/Services/AlertQuery.php` (device filter through `automation_alert_devices`), `Http/Controllers/AlertController.php`, `Http/Controllers/WorkflowController.php`, `Jobs/DeliverAlertEmail.php`, `Mail/AlertEmail.php`, `Services/AlertInbox.php`, `api/app/Domain/Notifications/Services/EventRecorder.php`, `api/app/Domain/Integrations/Services/AlertSnapshot.php`, `api/app/Domain/Overview/OverviewQuery.php`, `api/app/Domain/Agents/Mcp/Tools/ListAlerts.php`, `api/app/Domain/Agents/Mcp/Tools/GetOverview.php`, `api/app/Console/Commands/BackfillNotificationEvents.php` and the geofence map controllers (depends on T002)
- [ ] T004 `api/app/Domain/Integrations/Http/ReadController.php` lists and shows only `kind = workflow` alerts (404 for others), so the integration `IntegrationAlert` schema holds once pull request 2 writes connectivity alerts and until pull request 5 adds the opt-in (FR-029, SC-009)
- [ ] T005 Alert resource gains `kind`, `severity` and `devices` (≤ 100, with `devices_total`); `api/app/Domain/Automation/Http/Resources/AlertNotificationResource.php` gains `kind` and `subject` (null for workflow) and makes `workflow` nullable; `php artisan contract:export`, `contract:export --check` and `contract:check --base=origin/main` pass with `contracts/openapi/pending-schemas.json` unchanged; types in `packages/api-client/src/alerts.ts` and `packages/api-client/src/index.ts`
- [ ] T006 [P] `api/app/Domain/Administration/Services/OrganizationDeletion.php` lists `automation_alert_devices` with the alert tables; `OrganizationDeletionInventoryTest` passes
- [ ] T007 [P] Tests in `api/tests/Feature/Domain/Automation/AlertTest.php`: the backfill fills the pivot for existing workflow alerts; the check constraint rejects a workflow alert without a deployment and a connectivity alert with one (PostgreSQL); a connectivity alert inserted directly does not appear in `GET integration/v1/organizations/{organization}/alerts` and `alerts/{uuid}` returns 404; alert lists and the `device` filter never return another organization's alerts, including through the pivot (constitution III); the existing alert, email, bell (`AlertNotificationTest`) and integration suites pass unchanged
- [ ] T008 Verify pull request 1: `./taskw lint`; `cd apps/api && php artisan test --compact` on PostgreSQL; `pnpm --filter @iot-os/portal lint`; rebuild `api alerts-worker webhooks-worker scheduler portal` with the stack's env files and overlays ([local setup](../../docs/dev/local-setup.md#rebuild-one-service)), run `php artisan migrate --force` in `api`, and follow [quickstart](quickstart.md#pull-request-1-alerts-generalised): the workflow alert, its email, bell notification, event log entry and integration event look as before

**Checkpoint**: alerts hold any kind; nothing behaves differently.

---

## Phase 2: User Story 1, see offline devices without building anything (Priority: P1; pull request 2) 🎯 MVP

**Goal**: every active device is monitored; offline alerts open and clear by
themselves on the Alerts page, the Event log, the device page and the directory, with
an automatic *Offline after* for devices nobody tuned. Nothing is sent.

**Independent Test**: stop an always-connected simulator: one **Device offline** alert
(cause death certificate) opens after the grace period and clears when it returns; the
polled trackers stay quiet for 30 minutes; no delivery and no bell notification exists
([quickstart](quickstart.md#pull-request-2-detection-and-display-no-notices)).

### Contracts and tests

- [ ] T009 [P] [US1] Contracts in `contracts/internal/`: `device.connectivity.v1.schema.json`, `.fixture.json`, `.cases.json` per [runtime-messages.md](contracts/runtime-messages.md) (closed schema; `subject.kind` `device` needs `device_uuid`, `gateway` needs `connection_uuid` and `edge_node_id`, `source` needs `adapter_uuid`; `transition` `opened`, `cleared`, `stopped`; `cause` `death_certificate`, `missed_check_in`, `gateway_offline`, `source_disconnected`, required on `opened`; `stop_reason` `device_deactivated`, `monitoring_disabled`, `definition_removed`, required on `stopped`, else null; `affected_device_uuids` 1–10,000; `offline_after_seconds` 60–604,800, `offline_after_automatic`, `reporting_interval_seconds` and `poll_interval_seconds` null or positive; RFC 3339 UTC times); `device.connectivity-settings.v1` (`generation`, `enabled`, `style` `stays_connected` or `connects_to_report`, `offline_after_seconds` null or 60–604,800, `poll_interval_seconds` null or 60–86,400, `grace_seconds` 0–3,600); `internal.control-state.v1` describing the `/state` snapshot as it is plus each device's `connectivity`; entries in `contracts/internal/catalogue.json` naming producer, consumer and the tests that load them; `rtk python3 tooling/verify-devices-contracts.py` passes
- [ ] T010 [P] [US1] Go tests `rt/app/connectivity_test.go` on a fake clock: a *stays connected* DDEATH → pending → episode after grace (`death_certificate`); back for the grace → cleared; a drop shorter than the grace → nothing; silence past *Offline after* → `missed_check_in`; *connects to report* ignores deaths and a report clears at once; `waiting` until the first packet; with automatic *Offline after*, `learning` until the third reading while a death still opens; the automatic value is `clamp(ceil_to_minute(3 × median gap + poll interval), 900, 604800)`; gaps ≤ 0 are ignored, at most 64 are kept and none older than 7 days; a silence in progress never becomes a gap; a device whose interval slows raises its value only as new gaps complete; deactivation and definition removal stop an open episode with their reasons; activating a new configuration or generation of a device neither opens nor clears an episode nor moves its anchor (FR-010); a device already silent past its threshold when monitoring starts opens nothing and waits for its next packet (FR-030); events load against the T009 fixtures
- [ ] T011 [P] [US1] Storage integration tests `rt/storage/connectivity_integration_test.go` (`DEVICE_TEST_DATABASE_URL`): `TransitionConnectivity` commits the row and its outbox event together, with a UUID v5 of `<subject_key>#<episode>#<transition>`; a replay inserts nothing; `LoadConnectivity` restores rows; `ReportingSeed` returns distinct, non-historical observed times of the last 7 days per device, in batches of 500

### Runtime

- [ ] T012 [US1] `rt/storage/schema.sql`: idempotent DDL for `device_runtime.connectivity` with `subject_key` text primary key, `organization_uuid`, `kind` (`device`, `gateway`, `source`), `monitoring_since`, `heard_since_monitoring`, `settings_generation` bigint, `episode` integer default 0, `open` boolean, `offline_since`, `opened_at`, `cause` and `updated_at` as in [data-model.md](data-model.md)
- [ ] T013 [US1] `rt/storage/connectivity.go`: `TransitionConnectivity(row, event)`, `LoadConnectivity`, `ReportingSeed(devices)` from `device_runtime.observations` (`observed_at` within 7 days, readings not marked historical), and removal of rows for subjects with no definition and no open episode in the existing daily cleanup (depends on T012)
- [ ] T014 [US1] Tracker `rt/app/connectivity.go`: per-subject state from [data-model.md](data-model.md) "In memory"; `heard`, `died`, the observed-time gap ring, `evaluate(now)` applying D5 and D16 (threshold set or automatic, `learning`), the grace period, `monitoring_since` and `heard_since_monitoring` (D13), and transitions through `TransitionConnectivity` with `affected_device_uuids`, `last_heard_at`, `last_observed_at` and the threshold fields (depends on T013)
- [ ] T015 [US1] Wire the tracker into `rt/app/application.go`: `heard` on receipt before validation for edges outside `adapters-…` groups; on adapter edges, only for a DDATA whose readings include one not marked historical, after `ReadingsTraced`, passing their observed times; `died` on DDEATH and NDEATH after the engine's session check; `evaluate` on the 5-second maintenance tick; load and seed on start without delaying ingestion (devices stay `learning` until their batch is read); stop episodes on deactivation and definition removal (depends on T014)
- [ ] T016 [US1] `rt/app/control.go`: read each device's `connectivity` from the `/state` snapshot (defaults when absent: enabled, `stays_connected`, automatic, 120 s) and apply it unless its generation is lower than the one held (equal generations apply, because the generation stays 0 until pull request 3 adds it)
- [ ] T017 [US1] `rt/app/http.go`: `GET /connectivity?organization=<uuid>&devices=<uuid,…>` (≤ 500 devices, organization required) returning the fields and states in [runtime-messages.md](contracts/runtime-messages.md)

### Control plane

- [ ] T018 [US1] `api/app/Domain/Connectivity/Services/ConnectivitySettings.php` (new domain folder with `routes/api.php` registered like the other domains): effective settings per device from platform defaults (enabled, `stays_connected`, automatic *Offline after* as null, grace 120 s, severity `warning`); style `connects_to_report` for a device with an open `device_installations` row (D5); `poll_interval_seconds` from `DeviceAdapter::pollIntervalSeconds()` of that installation's adapter; `api/app/Domain/Devices/Http/Controllers/RuntimeController.php` `state()` adds `connectivity` to each device entry
- [ ] T019 [US1] `api/app/Domain/Automation/Services/ConnectivityProjector.php`, called from `RuntimeController` for `device.connectivity.v1` (add it to the accepted types; deduplicated in `device_inbox`): lock the organization's alert stream, resolve the device subject, create or update the alert by `episode_key`, store cause, times, threshold and its source, write `automation_alert_devices`, the event-log entry (source `connectivity`, severity from the settings) and the audit record; an `opened` for an existing episode is ignored, and a `cleared` or `stopped` without its `opened` creates the alert as historical; no deliveries and no bell notifications in this pull request (depends on T001–T003)
- [ ] T020 [P] [US1] Tests `api/tests/Feature/Domain/Connectivity/ConnectivityProjectionTest.php`: opened, cleared and stopped; replays and out-of-order arrival; an event naming another organization's device changes nothing (constitution III); the event log entry; zero `automation_alert_deliveries` and zero `notifications` rows (FR-018, SC-004 in this pull request); the `/state` snapshot carries defaults, the adapter style and the poll interval, validated against `internal.control-state.v1`; acknowledging, assigning and commenting on a connectivity alert follow the same permissions and rules as a workflow alert (FR-016)
- [ ] T021 [US1] `GET alerts` gains repeatable `kind` and `muted` (default 0) in `AlertQuery` and `AlertController`; the resource gains `subject`, `cause`, `offline_since`, `last_seen_at`, `last_observed_at`, `threshold_seconds`, `threshold_automatic`, `reporting_interval_seconds`, `poll_interval_seconds`, `grace_seconds`, `stopped_reason`, `muted`, `held`, `held_count`; `GET devices` rows gain `offline_alert`; `GET devices/{device}/connectivity` (read-only in this pull request: `effective`, `inherited_from`, `style_locked`, `state` from the runtime through `RuntimeClient`, or `unknown`); contract export and `packages/api-client/src/connectivity.ts`
- [ ] T022 [US1] `api/app/Domain/Devices/Services/DeviceView.php` and `DeviceDirectory.php`: offline with its cause while a connectivity alert concerning the device is open (D14); "waiting for first report", "learning how often it reports" and "offline since before monitoring started" from the runtime state
- [ ] T023 [P] [US1] `api/app/Domain/Agents/Mcp/Tools/ListAlerts.php` and `GetDeviceHealth.php` return kind, cause and the threshold in effect; regenerate with `php artisan agents:tools --check`

### Portal

- [ ] T024 [P] [US1] `packages/ui/src/lib/status.ts`: statuses for the connectivity causes, `learning` and the adapter states, used through `statusOf` (no local maps)
- [ ] T025 [US1] `portal/alerts/Alerts.tsx`, `Inbox.tsx` and `model.ts`: kind filter, kind and cause in rows, detail panels for device alerts (last heard, last observed where known, threshold and its source) in `Panel`s with `RelativeTime`
- [ ] T026 [US1] `portal/devices/shared.tsx` (`HealthStatus`, `healthDetails`), `model.ts`, `DeviceOverview.tsx` (a **Connectivity** panel: state, last heard, last observed, reporting interval, poll interval, *Offline after* in effect and where it came from, locked style for adapter devices) and `DeviceDirectory.tsx` ("Offline alert" status filter); Vitest in `portal/devices/model.test.ts` and `portal/alerts/model.test.ts`
- [ ] T027 [P] [US1] Mocked Playwright in `apps/portal/e2e/alerts.spec.ts` and `devices.spec.ts`: an offline alert in the inbox and its kind filter, the device's Connectivity panel, both at 375 px with the axe check

**Checkpoint**: offline devices are visible without any automation; nothing is sent.

---

## Phase 3: User Story 3, no false alarms from the platform (Priority: P1; pull request 2)

**Goal**: runtime and broker restarts, deploys, adapter redeploys, restarts and pauses
never open or clear an episode, and adapter devices never show offline because of
them.

**Independent Test**: restart the runtime and the broker, redeploy the polling adapter
and activate one more tracker through it: no alert opens or clears, no device shows
offline, last-seen times do not move
([quickstart](quickstart.md#pull-request-2-detection-and-display-no-notices)).

- [ ] T028 [P] [US3] Go tests in `rt/app/connectivity_test.go` and `rt/app/presence_test.go`: a runtime restart anchors silence at the runtime's start, never at a device's later activation; a lost broker connection freezes evaluation and anchors at its restoration; an open episode stays open through any interruption; an adapter NDEATH reports its devices `unknown` ("Adapter restarting; waiting for it to reconnect.") and never `offline`, opens nothing, and its next NBIRTH moves each device's anchor forward by the time the edge was dead; ten redeploys during a daily device's silence do not postpone its alert beyond its threshold plus the dead time; an adapter that never sends NBIRTH again (paused) keeps its devices unevaluated; a DBIRTH announced again after the NBIRTH neither counts as heard nor moves `last_heard_at`; a historical DDATA does not count, a non-historical one does; a device whose packets resume after a long outage opens only after its full threshold from the anchor
- [ ] T029 [US3] `rt/app/application.go` and `rt/app/connectivity.go`: treat edges of `adapters-<organization uuid>` groups as adapter edges; their NDEATH goes to the interruption path and reports devices `unknown` with that diagnostic instead of the offline branch at `application.go` "Source sent a death certificate"; their NBIRTH ends it and moves the devices' anchors forward by the dead time; runtime start and connection restored set anchors; a device's own activation never does (D3)
- [ ] T030 [US3] `api/app/Domain/Devices/Services/DeviceView.php`: an adapter device the runtime reported unknown after its adapter's death reads "adapter restarting", or "adapter paused" when the adapter's status is `paused`; tests in `api/tests/Feature/Domain/Devices/` that a rejected-review device (ADR-025) and an adapter restart are never shown offline

**Checkpoint**: platform-side events are invisible to customers.

---

## Phase 4: User Story 4 (part 1), one gateway alert, not hundreds (Priority: P2; pull request 2)

**Goal**: a gateway with several monitored devices raises one alert listing them.

**Independent Test**: stop `sparkplug_simulator.py`: one **Gateway offline** alert lists
the energy meter and the RGB light; neither opens its own.

- [ ] T031 [P] [US4] Go tests in `rt/app/connectivity_test.go`: an edge with two or more monitored definitions is a gateway; its NDEATH opens one `gateway_offline` episode listing them; the node and every monitored child silent past their thresholds does the same; children open nothing while it is open; on its return each child is judged from the return by its own threshold; a child already open keeps its episode; adapter edges are never gateways; *connects to report* children do not count towards the two-device rule (D4)
- [ ] T032 [US4] Gateway subjects in `rt/app/connectivity.go` (depends on T014)
- [ ] T033 [US4] `ConnectivityProjector` resolves a gateway by connection and edge node, writes every affected device to `automation_alert_devices`; `DeviceView` shows "offline because gateway *name* is offline"; `portal/alerts/Alerts.tsx` gateway detail with an affected-devices `DataTable`; `portal/devices/GatewayPage.tsx` shows the open gateway alert; tests in `ConnectivityProjectionTest.php`

### Pull request 2 documents and verification

- [ ] T034 [P] [US1] Docs: `docs/features/alerts.md` (kinds, detection, interruptions including adapter redeploys, the automatic threshold, polled devices), `docs/features/devices.md` (connectivity state), `docs/features/adapters.md` (adapter deaths are interruptions; repeated births and history are not heard), `docs/features/automation.md` (freshness versus *Offline after*, FR-036), `docs/reference/events.md` (`device.connectivity.v1`), `docs/dev/gotchas.md` ("heard" versus accepted, adapter deaths, observed-time intervals versus receipt-time silence)
- [ ] T035 [P] [US1] Help guides `api/resources/help/alerts.md`, `devices.md` (adapter and polled devices), `gateways.md` and `automation-conditions.md` (freshness versus *Offline after*), and when to use spec 014's No data instead (FR-034)
- [ ] T036 [P] [US1] Record FR-037 in `specs/014-automation-nodes/spec.md` and `plan.md`: No data's period defaults to the bound device's *Offline after* and its silence counts from receipt
- [ ] T037 [US1] Verify pull request 2: lint and all suites; rebuild `runtime api alerts-worker webhooks-worker scheduler portal`; run every row of the quickstart's pull request 2 table, including the polled trackers, the adapter redeploy and the backlog; Mailpit and the bell receive nothing. Soak for 24 hours with a 5-minute and a 60-minute polling adapter whose trackers report every minute to every hour: zero episodes (SC-011). After it ships, record in the private operations inventory: zero episodes and zero notices from the release itself (SC-007), SC-003 and SC-010 over the next three pilot deploys, and SC-011 for the pilot's polled trackers

**Checkpoint**: pull request 2 can ship to the pilot: alerts in the portal, nothing sent.

---

## Phase 5: User Story 5, tune detection and mute for maintenance (Priority: P2; pull request 3)

**Goal**: profiles and devices set *Offline after*, style, grace, severity and on/off;
the platform warns about thresholds shorter than a healthy silence; anyone who manages
devices can mute.

**Independent Test**: the tracker profile warns at 3 minutes and suggests 15; a device
override applies to that device only; a muted box opens nothing until the mute ends
([quickstart](quickstart.md#pull-request-3-settings-and-mutes)).

- [ ] T038 [US5] New migration: `device_profiles.connectivity_settings` jsonb null and `connectivity_revision` integer default 0; `devices.connectivity_overrides` jsonb null, `connectivity_revision` integer default 0 and `connectivity_generation` bigint default 0; `connectivity_mutes` (`id`, `uuid`, `organization_id`, `target_type` `device`/`gateway`/`site`/`profile`, `target_id`, `until`, `reason` ≤ 500, `created_by`, `ended_at` null, timestamps)
- [ ] T039 [US5] `ConnectivitySettings`: resolve device, then profile, then defaults with `inherited_from` per field (`device`, `profile`, `automatic`, `default`); validate `offline_after_seconds` 60–604,800 or null, `grace_seconds` 0–3,600, `severity` `critical`/`warning`/`info`, `style` enum, and 422 for a `style` override on an adapter device; 409 on a stale `revision`; on every change of a device's effective settings, increment `connectivity_generation` and write `device.connectivity-settings.v1` to `device_outbox` in the same transaction (one per affected device for a profile change); saving never calls `beginDraft`
- [ ] T040 [US5] `api/app/Domain/DeviceAdapters/Services/AdapterService.php`: in `deploy()`'s transaction, when the applied revision's poll interval differs from the previous one, write settings messages for the adapter's devices with open installations; `activate()` writes the new device's settings with the locked style
- [ ] T041 [US5] `rt/app/control.go`: handle `device.connectivity-settings.v1` beside `device.activate.v1`, ignoring lower generations; `enabled` false stops an open episode (`monitoring_disabled`); `enabled` true restarts monitoring (`waiting`); Go tests in `rt/app/control_test.go`
- [ ] T042 [US5] Controllers and routes in `api/app/Domain/Connectivity/`: `GET/PUT device-profiles/{profile}/connectivity` with the reporting check (devices whose set *Offline after* is shorter than their reporting interval plus poll interval; at most 20, slowest first, with `total`; suggestion = their automatic value), `PUT devices/{device}/connectivity`; `Device.view` to read, `Device.manage` to write; audit every change with the acting user (FR-032); `GET devices/{device}/connectivity` gains `warning` (the device's reporting check entry or null, FR-004a)
- [ ] T043 [US5] Mutes: model, `GET connectivity/mutes` (`target_type`, `target_uuid`, `include_ended`), `POST connectivity/mutes` (client `uuid` for safe retries; `until` in the future and at most 30 days ahead; the target must belong to the organization or 404), `POST connectivity/mutes/{mute}/end`; `ConnectivityProjector` stores `suppressed_at` for an episode opened while its device, gateway, site or profile is muted; `connectivity:reveal-muted` every minute in `api/routes/console.php` clears `suppressed_at` on still-open alerts whose mutes ended; mutes and early ends are audited with the acting user (FR-032)
- [ ] T044 [US5] `php artisan contract:export`, `contract:export --check` and `contract:check --base=origin/main` for the settings and mute operations, with `contracts/openapi/pending-schemas.json` unchanged; methods and types in `packages/api-client/src/connectivity.ts` and `index.ts` (constitution IV; depends on T042, T043)
- [ ] T045 [P] [US5] Tests `api/tests/Feature/Domain/Connectivity/ConnectivitySettingsTest.php` and `ConnectivityMuteTest.php`: ranges, 409, 422 for adapter style, another organization's profile, device or mute target returns 404, generations and outbox messages (a profile change writes one per device), a poll interval change on deploy, the reporting check, mute suppress, reveal and early end, an open episode staying open while muted, audit records
- [ ] T046 [US5] Portal: an **Offline alerts** section in `portal/profiles/ProfileWorkspace.tsx` (`Panel`; *Offline after* defaults to **Automatic**; the warning names devices and offers the suggestion; saving does not touch the draft); overrides, the locked style, the reporting check warning with its suggestion, and an active mute (who, why, until when) in the device **Connectivity** panel; active mutes also listed on the Alerts page (FR-028); **Mute offline alerts** on the device page, `portal/devices/GatewayPage.tsx`, `portal/devices/SitesPage.tsx` and the profile; the Alerts **Muted** filter; Vitest and mocked Playwright (`apps/portal/e2e/devices.spec.ts`, `alerts.spec.ts`) at 375 px with axe
- [ ] T047 [P] [US5] Docs and help for settings and mutes: `docs/features/devices.md`, `docs/features/alerts.md`, `api/resources/help/profiles.md`, `devices.md`, `gateways.md`
- [ ] T048 [US5] Verify pull request 3: suites; rebuild `runtime api alerts-worker scheduler portal`; quickstart pull request 3 steps

**Checkpoint**: people can tune and mute before anyone is notified.

---

## Phase 6: User Story 2, opt in to be told (Priority: P1; pull request 4), with User Story 4 summaries

**Goal**: subscribers and route recipients get email and a bell notification; nobody
else gets anything; bursts become summaries; flapping is held back.

**Independent Test**: a site subscription gets one email and one bell notification for
a device there and nothing for another site; recovery as chosen; email off still leaves
the bell ([quickstart](quickstart.md#pull-request-4-notifications)).

- [ ] T049 [US2] New migration: `connectivity_subscriptions` (`uuid`, `organization_id`, `user_id`, `scope` jsonb, `notify_on_clear`, `revision`, timestamps; unique per organization, user and scope hash), `connectivity_routes` (`uuid`, `organization_id`, `name` ≤ 120, `enabled`, `scope` jsonb, `min_severity`, `recipient_ids` jsonb of integer user ids ≤ 20, `notify_on_clear`, `revision`, `created_by`, timestamps), `notification_batches` (`uuid`, `recipient_id`, `channel`, `opens_at`, `closes_at`, `sent_at` null, `status` `open`/`sent`/`cancelled`; one open batch per recipient and channel), and `automation_alert_deliveries.batch_id` (FK, null)
- [ ] T050 [US2] `api/app/Domain/Connectivity/Services/RecipientMatcher.php`: scopes `{all: true}` or any of `site_uuids`, `tags` (≤ 32 characters, case-insensitive), `profile_uuids`, `device_uuids` (each ≤ 50); a device matches any listed item; subscriptions match only devices their owner can view; routes apply `min_severity`; one recipient per channel however many match
- [ ] T051 [US2] Subscription and route controllers per [api.md](contracts/api.md): own subscriptions only (another member's returns 404); routes need `Device.manage`, verified members with `Device.view` as recipients, at least one while enabled (422), 409 on a stale revision; `GET connectivity/routes/recipients`; deleting a route rechecks its pending deliveries; audit (FR-032)
- [ ] T052 [US2] `ConnectivityProjector` deliveries: on an opened alert that is neither suppressed nor held, create an `AlertDelivery` (channel `email`) per matched recipient and, for each newly created one, write `ConnectivityTransitionNotification` (`api/app/Domain/Connectivity/Notifications/`, type `alert`, data as in [data-model.md](data-model.md) `notifications`) in the same transaction (D17); on cleared, recovery deliveries and cleared bell notifications only for recipients who got the activation and chose recovery; on stopped, cancel pending deliveries; revealing a muted alert creates them then
- [ ] T053 [US2] `api/app/Domain/Connectivity/Jobs/DeliverConnectivityNotice.php` following `DeliverAlertEmail`'s retry and attempts model, rechecking membership, verification, device view, the subscription or route, `Preferences` (`connectivity` source) and mutes before each send, and cancelling an activation whose alert cleared first; `ConnectivityAlertEmail` (plain text: organization, device, gateway or connection, site, last-seen time in the site's time zone, last observed where known, cause, links to the alert, the device and the notification settings)
- [ ] T054 [US4] Summaries: a delivery whose recipient and channel got a notice in the last 5 minutes joins that window's `notification_batches` row; a delayed job on the `alerts` queue sends `ConnectivitySummaryEmail` of the still-valid deliveries grouped by site at the window's end; the bell is never batched (FR-024, FR-024a)
- [ ] T055 [US2] Flapping: an alert whose subject has more than 3 connectivity alerts in the last 60 minutes is stored `held` with no deliveries and no bell notification; the next notice for that subject states `held_count` (FR-025)
- [ ] T056 [US2] `api/app/Domain/Notifications/Services/Preferences.php`: `connectivity` joins `SOURCES`; a stored grid without it reads as all four levels on; `NotificationCenterController` validation accepts it; the event log's `source` filter accepts `connectivity`
- [ ] T057 [US2] Contract export and drift checks as in T044 for subscriptions, routes, recipients, the `connectivity` preferences source and the bell's `kind`/`subject`; methods and types in `packages/api-client/src/connectivity.ts`, `notifications.ts`, `alerts.ts` and `index.ts` (constitution IV; depends on T051, T056)
- [ ] T058 [P] [US2] Tests `api/tests/Feature/Domain/Connectivity/ConnectivityNotificationTest.php`: no subscription and no route → zero deliveries and zero bell notifications (SC-004); one notice per recipient and channel when several match; recovery only after an activation; each recheck cancels; email preference off cancels the email and keeps the bell; a gateway of 50 devices → one notice per recipient (SC-005); 200 devices in five minutes → two notices (SC-006); flapping; an `opened` and `cleared` that arrive together after the control plane was down send no activation (FR-007); another organization's subscription or route never matches (constitution III); `GET alert-notifications` returns `kind` and `subject` with `workflow` null
- [ ] T059 [US2] Portal: **Settings → Notifications → Device offline** in `portal/alerts/NotificationSettings.tsx` (routes in `CollectionPage` + `DataTable`, route editor and subscriptions in `Panel`s, scope pickers with `SearchableSelect`); **Notify me** on the Alerts page; the **Device offline** row in `portal/alerts/EmailPreferences.tsx`; connectivity notifications in `portal/alerts/bell/model.ts` and `AlertBell.tsx` ("Device offline · *name*"); Vitest; mocked Playwright `apps/portal/e2e/alert-bell.spec.ts` and `alerts.spec.ts` at 375 px with axe
- [ ] T060 [P] [US2] Docs and help: `docs/features/alerts.md` (recipients, the bell, batching, flapping), `api/resources/help/alert-notifications.md`
- [ ] T061 [US2] Verify pull request 4: suites; rebuild `api alerts-worker scheduler portal`; quickstart pull request 4 steps in Mailpit and the bell; time a first-time subscription to one site's offline emails (under one minute, SC-008)

**Checkpoint**: the pilot's need is met: the right people hear when a device goes dark.

---

## Phase 7: User Story 6, integrations choose to receive connectivity events (Priority: P3; pull request 5)

**Goal**: only applications that opt in receive connectivity events and alerts.

**Independent Test**: of two applications granted the box, only the one with **Device
connectivity events** on receives `connectivity.offline.v1`
([quickstart](quickstart.md#pull-request-5-integrations)).

- [ ] T062 [US6] New migration: `integration_applications.connectivity_events` boolean default false
- [ ] T063 [US6] `api/app/Domain/Integrations/Services/EventJournal.php` `connectivity()`: `connectivity.offline.v1` when a connectivity alert opens unsuppressed and `connectivity.online.v1` when it clears, once per affected device, resource id a UUID v5 of the alert and device; nothing for suppressed or stopped alerts or acknowledgement; called from `ConnectivityProjector`
- [ ] T064 [US6] `Http/EventController.php` and `Services/WebhookDispatch.php` skip `connectivity.*` unless the application has `connectivity_events` and `alerts:read` (the feed's cursor still advances); `Http/ReadController.php` returns connectivity alerts only to those applications (replacing T004's filter); `Http/ApplicationController.php` reads and updates `connectivity_events` without rotating tokens, cancelling deliveries or changing the grant revision
- [ ] T065 [P] [US6] Contracts: `contracts/openapi/supplements/integration-events.yaml` (the two types), `integration.yaml` (`IntegrationConnectivityAlert`, list items `oneOf` discriminated by `kind`), the SDK union in `packages/integration-sdk/src/index.ts`, `docs/reference/events.md`, `docs/features/integrations.md`, `api/resources/help/integration-webhooks.md`
- [ ] T066 [US6] Contract export and drift checks as in T044 for `connectivity_events` on applications; the integration types in `packages/api-client` (constitution IV; depends on T064)
- [ ] T067 [P] [US6] Tests in `api/tests/Feature/Domain/Integrations/`: existing applications receive nothing (SC-009); only the opted-in one gets feed items and webhook deliveries; ungranted devices and another organization's events never appear; alert reads follow the flag
- [ ] T068 [US6] The **Device connectivity events** switch in `portal/integrations/Integrations.tsx`; mocked Playwright `apps/portal/e2e/integrations.spec.ts`
- [ ] T069 [US6] Verify pull request 5: suites; rebuild `api webhooks-worker portal`; quickstart pull request 5 with the webhook sink

**Checkpoint**: integrations opt in; nothing else changes for them.

---

## Phase 8: User Story 4 (part 2), vendor broker and vendor API connections (Priority: P2; pull request 6)

**Goal**: losing a vendor broker, or a vendor API that keeps failing, is one
**Connection lost** alert, not one per device.

**Independent Test**: stop the vendor broker, then inject a `401` and a `500` fault into
`vendor_tracker_api.py`: each opens one connection alert, devices show unknown, none
opens a device alert ([quickstart](quickstart.md#pull-request-6-vendor-broker-and-api-connections)).

- [ ] T070 [US4] `services/adapters/nodes/adapter.js`: the publisher adds `Adapter/Source connected` (Boolean) and `Adapter/Source operator` (`customer` for vendor-broker and polling sources, `platform` for platform-broker and webhook sources) to its NBIRTH and sends NDATA when they change; the poll node passes `retrying` and `stopped` outcomes as disconnected and the next `ok` as connected; tests in `services/adapters/test/`
- [ ] T071 [US4] `rt/sparkplug/session.go` exposes those node metrics; `rt/app/connectivity.go` opens `source` subjects for customer sources: disconnected past 120 s opens `connection_lost` (`source_disconnected`); its devices are not evaluated while it lasts and are anchored at the reconnection; a platform source's disconnection is only an interruption (D12)
- [ ] T072 [P] [US4] Go tests in `rt/app/connectivity_test.go`: customer and platform sources, the grace, reconnection anchors, a backlog after reconnection counting as heard
- [ ] T073 [US4] `ConnectivityProjector` resolves the adapter subject; **Connection lost** detail on the Alerts page; the adapter's pages in `portal/adapters/` show the open alert; devices show unknown with the reason; tests in `ConnectivityProjectionTest.php`, including that a `source` episode belongs to the adapter's organization and an event naming another organization's adapter changes nothing (constitution III)
- [ ] T074 [P] [US4] Docs: `docs/features/adapters.md` (source metrics; redeploy to get them), `docs/features/alerts.md`
- [ ] T075 [US4] Verify pull request 6: suites; rebuild `runtime api adapter-manager portal` and redeploy the test adapters; quickstart pull request 6 steps

**Checkpoint**: every user story works.

---

## Phase 9: Polish and cross-cutting concerns

- [ ] T076 After the last pull request merges, run `/speckit-converge`; move lasting behaviour into `docs/features` and `docs/reference` if any is still only here, and freeze this folder
- [ ] T077 [P] Assistant usage help: confirm the assistant's usage help reads the updated guides (FR-034) and that `ListAlerts` answers "which devices are offline" with kinds and causes

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** (pull request 1) blocks everything.
- **Phases 2–4** (pull request 2) depend on Phase 1. Inside it, T014 blocks T015, T029
  and T032; T009 blocks the tests that load fixtures.
- **Phase 5** (pull request 3) depends on pull request 2 (the tracker applies settings).
- **Phase 6** (pull request 4) depends on pull request 3 (mutes are rechecked before
  sending).
- **Phase 7** (pull request 5) depends on pull request 4 only for ordering; its code
  needs Phase 2's projector.
- **Phase 8** (pull request 6) depends on pull request 2; it is last to keep one pull
  request open at a time.
- **Phase 9** follows pull request 6.

### User story dependencies

- **US1** is the base for every other story.
- **US3** and **US4 part 1** extend the tracker built for US1.
- **US5** needs US1's settings path; **US2** needs US5's mutes; **US6** needs US1's
  projector; **US4 part 2** needs US1's tracker and US3's anchors.

### Parallel opportunities

- Phase 1: T006 and T007 alongside T003–T005.
- Phase 2: T009, T010 and T011 together, before the runtime work; T020, T023, T024 and
  T027 alongside the portal tasks.
- Pull request 2 documents: T034, T035 and T036 together.
- Phase 5: T045 while the portal (T046) is built; T041 in Go beside the Laravel tasks.
- Phase 6: T058 with T059; T060 any time after T052.
- Phase 7: T065 and T067 together.

## Parallel example: User Story 1

```text
T009 contracts in contracts/internal/
T010 rt/app/connectivity_test.go
T011 rt/storage/connectivity_integration_test.go
then T012 → T013 → T014 → T015, with T016 and T017 after T014
and, once T019 exists: T020, T023, T024 together
```

## Implementation strategy

- **MVP**: pull requests 1 and 2 (US1, US3, US4 part 1). Offline alerts appear in the
  portal for every device, the automatic threshold keeps slow and polled devices quiet,
  and nothing is sent. It can ship to the pilot on its own.
- **Then** pull request 3 (tune and mute), pull request 4 (the pilot's email and bell),
  pull request 5 (integrations), pull request 6 (vendor connections).
- Each pull request is verified in the rebuilt stack before it is opened
  (constitution IX) and ticks its tasks here.
