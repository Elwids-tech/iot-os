# Implementation Plan: Device Offline Alerts

**Branch**: `spec/018-device-offline-alerts` | **Date**: 2026-10-25, revised 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-device-offline-alerts/spec.md`

## Summary

A connectivity tracker in the Go runtime watches every monitored device, gateway and
adapter source on the existing 5-second maintenance tick. It counts any packet received
as a sign of life, except on an adapter's edge, where only a new reading counts; it
treats deaths according to the device's connection style, and an adapter's own node
death as a platform-side interruption. It measures silence by receipt from an anchor
that interruptions move forward, learns each device's reporting interval from its
readings' observed times, and uses three times that interval plus the poll interval as
an automatic *Offline after* when nobody set one. It applies the grace period and
writes each episode transition with its outbox event in one transaction. Laravel
projects those events into the existing alerts table, generalised to hold connectivity
kinds next to workflow alerts, so the inbox, event log, acknowledgement, comments,
email delivery and the bell are reused. Offline settings sit beside device profiles and
devices, outside the immutable profile revision, and reach the runtime, with each
device's poll interval, as a fenced control message. Mutes, personal subscriptions,
administrator routes, summary batching and flapping holds are Laravel delivery policy.
Integrations receive connectivity events only when an application turns them on.
Automations are unchanged. Delivery is six pull requests. Decisions and their
alternatives are in [research.md](research.md).

## Technical Context

**Language/Version**: Go 1.27 (runtime); PHP 8.4 / Laravel 13 (API, workers,
scheduler); TypeScript, React 19 (portal, `packages/api-client`,
`packages/integration-sdk`); Node.js (adapter publisher, `services/adapters`)

**Primary Dependencies**: runtime `internal/app` (maintenance loop, emit, internal
HTTP), `internal/sparkplug` (session engine), `internal/storage` (schema, outbox,
observations); Laravel domains Automation (alerts, projector, delivery, bell
notifications), Notifications (preferences, event log), Integrations (journal, feed,
webhooks), Devices, DeviceProfiles, DeviceAdapters (deploy, poll interval);
`@iot-os/ui` (`CollectionPage`, `DataTable`, `InboxPage`, `Panel`, `SettingsPage`,
`SearchableSelect`, `Status`, `RelativeTime`, `NotificationBell`)

**Storage**: PostgreSQL 17 / TimescaleDB. Runtime: one new table,
`device_runtime.connectivity`; the reporting interval is seeded on start from
`device_runtime.observations` (last 7 days). Laravel: `automation_alerts` and its
deliveries gain columns; new `automation_alert_devices`, `notification_batches`,
`connectivity_mutes`, `connectivity_routes`, `connectivity_subscriptions`; JSON
settings columns on `device_profiles` and `devices`; a flag on
`integration_applications`; bell notifications reuse spec 022's `notifications` table
([data-model.md](data-model.md)).

**Testing**: Go table tests for the tracker on a fake clock (deaths, silence, grace,
gateway grouping, connection styles, interruptions, adapter deaths and repeated births,
historical readings, the reporting interval and automatic threshold, learning, restart,
adapter sources) and storage integration tests that a transition and its outbox row
commit together and that the observations seed reads observed times
(`DEVICE_TEST_DATABASE_URL`); `tooling/verify-devices-contracts.py` with the new
internal schemas; PHPUnit on PostgreSQL (projection idempotency, workflow alerts and
their bell notifications unchanged, cross-organization isolation, adapter style lock,
poll interval changes, matching, rechecks, batching, flapping, mutes, bell
notifications, integration filters); Vitest and mocked Playwright for the portal; live
runs in the rebuilt stack with `fire_watch_box.py`, `sparkplug_simulator.py`,
`vendor_water_meter.py` and `vendor_tracker_api.py` behind a polling adapter
([quickstart.md](quickstart.md))

**Target Platform**: runtime, api, alerts-worker, webhooks-worker, scheduler, portal
and adapter-manager in the single-node release profile

**Project Type**: web application with a data-plane service

**Performance Goals**: an episode opens within one tick (5 s) of its grace period
ending (SC-001, SC-002 and SC-012 allow one minute); a tick over 10,000 monitored
subjects takes under 50 ms; the packet path gains one map update and, for readings, one
ring insert; runtime writes happen only on transitions; the start-up seed reads at most
7 days of observed times per device in batches of 500 devices and does not delay
ingestion (devices stay `learning` until their batch is read)

**Constraints**: platform-side interruptions, including adapter redeploys, never open
or clear an episode (SC-003, SC-010); no delivery of any kind, and no bell
notification, without a subscription, route or integration opt-in (SC-004); internal
readers stay tolerant (ADR-015); existing workflow alerts, their emails, their bell
notifications and existing integration consumers behave exactly as before; automation
freshness and DAG semantics are unchanged (FR-036)

**Scale/Scope**: pilot tens of devices reporting every minute to once a day; design
target 10,000 monitored devices per runtime; 2 internal contracts, about 14 public
operations, 5 new tables, 5 portal surfaces (alerts and bell, devices, profiles,
settings, integrations), 6 pull requests

## Constitution Check

*Gate before research and again after design: both pass. Re-checked on 2026-10-30
after the polling, adapter-death, bell and automatic-threshold changes: still pass.*

| Principle | Status |
| --- | --- |
| I. Laravel owns intent; Go executes | Pass. Detection, grace, gateway grouping, the reporting interval and the automatic threshold run in the runtime, which asks Laravel nothing per message and keeps detecting while Laravel is down (D1, D16). Laravel owns settings, the poll interval it already knows, mutes, routes, subscriptions and notices. Its one timed job, revealing alerts whose mutes ended, reads no telemetry (D8). |
| II. Immutable versions, explicit activation | Pass. Profile artifacts, device configurations and adapter revisions are untouched. Offline settings change alerting only. Like workflow `notification_settings`, they are revisioned beside the definition (D6), and they reach the runtime fenced by a per-device generation that the runtime never applies backwards. A deployed adapter revision's poll interval reaches the runtime through the same fenced message. |
| III. Tenant isolation | Pass. Every new route resolves the organization first. Each pull request adds a cross-organization test: (1) alert lists and the device filter; (2) one organization's events never create or clear another's alerts, and the runtime endpoint answers only for the given organization; (3) settings, mutes and scope references to another organization's sites, profiles or devices return 404; (4) routes, subscriptions and bell notifications never match or notify across organizations; (5) the feed and webhooks never carry another organization's connectivity events; (6) an adapter source episode belongs to the adapter's organization. |
| IV. Contracts first | Pass. `device.connectivity.v1` and `device.connectivity-settings.v1`, plus the snapshot change, are schemas with fixtures and cases under `contracts/internal`, the catalogue's first entries, loaded by Go and PHP tests ([contracts/runtime-messages.md](contracts/runtime-messages.md)). Public operations, including the bell's `kind`, `subject` and nullable `workflow`, are described in the generated OpenAPI contract, with none added to `pending-schemas.json`. `packages/api-client` changes in the same pull requests. The integration event types are added to the supplement and the SDK. User references are integer ids. |
| V. AI proposes, people approve | Pass. The assistant and connected AI applications read connectivity alerts through the existing read tools with the user's permissions. Nothing depends on the assistant. |
| VI. Show uncertainty | Pass. Unknown presence never counts as offline. Interruptions, adapter restarts and pauses show as unknown with their reason, not offline. Devices already silent at rollout are labelled, not alerted; devices whose interval is not yet known are `learning`, not judged. Muted and held alerts stay visible. Silence and alert times are receipt times, and polled alerts also show the observed time (D2, D3, D13, D16). |
| VII. Durable, idempotent messaging | Pass. A transition and its outbox row commit together, with an event id derived from subject, episode and transition. Laravel deduplicates in `device_inbox` and on `episode_key`. Deliveries are unique per alert, recipient, type and channel, and a bell notification is written only with a newly created delivery. A settings message carries a generation. |
| VIII. One design system | Pass. The inbox keeps `InboxPage`; the bell keeps the kit's `NotificationBell`; routes use `CollectionPage` and `DataTable`; settings use `Panel` in `SettingsPage`. Status uses `statusOf`, with connectivity causes and `learning` added to the kit's status map, not a local map. Times use `RelativeTime`. No new kit component is planned; if a scope picker is needed beyond `SearchableSelect`, it gets a story. |
| IX. Verified where it runs | Pass. Each pull request rebuilds the containers it changes and runs its user story against simulators in the stack, including a polling adapter ([quickstart.md](quickstart.md)). SC-003 and SC-010 are measured on the next three pilot deploys after pull request 2 ships. Simulators do not stand in for the pilot's real trackers; SC-011 is checked there too. |

No accepted ADR is contradicted. ADR-025 (review follows the current birth) is
consistent: review never meant silence. Alerts so far came only from automations
(`docs/features/alerts.md`). That documentation changes with pull request 2, and no ADR
recorded it as a decision.

## Design

### Runtime (`services/runtime/internal`)

- **Tracker** (`app/connectivity.go`, new):
  - **State.** Holds in-memory subject state (data-model "In memory") built from
    definitions, grouped by connection and edge (D4).
  - **Packet path.** `packet()` calls `heard(connection, edge, deviceID, at)` before
    validation (D2), except on adapter edges (group `adapters-…`), where the
    per-device path calls it only for a DDATA with a non-historical reading, after
    `ReadingsTraced`, passing the readings' observed times for the interval ring
    (D16). NDEATH and DDEATH call `died(...)` with the session check the engine
    already does. An adapter edge's NDEATH goes to the interruption path instead and
    reports its devices `unknown` ("Adapter restarting; waiting for it to
    reconnect."), not offline; its next NBIRTH ends the interruption (D3).
  - **Evaluation.** The maintenance tick calls `evaluate(now)`, which applies D3 to D5
    and D16 for each subject: the threshold in effect (set, or automatic from the
    interval and poll interval), `learning` until three readings. It skips subjects on
    a disconnected connection or a dead adapter edge and opens, clears or stops
    episodes.
  - **Interruptions.** `connectionPresence` (lost or restored), adapter NDEATH and
    NBIRTH, and `activeSince` set the anchors.
- **Storage** (`storage/schema.sql`, `storage/connectivity.go`):
  - The `connectivity` table.
  - `TransitionConnectivity(row, event)` writes the row and the outbox event in one
    transaction, with a deterministic event UUID (unlike `Emit`).
  - `LoadConnectivity` runs on start; `ReportingSeed(devices)` reads the last 7 days
    of distinct non-historical observed times from `observations` for a batch of
    devices.
  - The daily cleanup removes rows for subjects that no longer exist.
- **Settings**:
  - `device.connectivity-settings.v1` is handled in `handleControl` beside
    `device.activate.v1`, including `poll_interval_seconds` and a null (automatic)
    `offline_after_seconds`.
  - The `/state` snapshot carries settings.
  - Devices without settings use the defaults (D6): automatic *Offline after*.
  - Deactivation and definition removal stop open episodes.
- **HTTP**: `GET /connectivity` on the existing internal server (D14), with the
  reporting interval, last observed time and threshold in effect.
- **Adapter sources** (pull request 6): the session engine exposes the node metrics
  `Adapter/Source connected` and `Adapter/Source operator`. The tracker opens `source`
  subjects for customer sources (vendor broker and polling) and anchors the source's
  devices on reconnection (D12).

### Adapter publisher (`services/adapters`, pull request 6)

- `nodes/adapter.js`: the publisher adds `Adapter/Source connected` and `Adapter/Source
  operator` to its NBIRTH and sends NDATA when they change. For polling, the poll node
  already reports `source_connected` and `source_state` on each run's outcome; it also
  hands the change to the publisher (D12).

### Contracts (`contracts/internal`, OpenAPI, SDK)

As in [contracts/](contracts/): the two internal messages and the snapshot field, with
fixtures and cases; the public operations, including the bell's changed resource; the
integration event types and `IntegrationConnectivityAlert`; the SDK type union.

### Laravel (`apps/api/app/Domain`)

- **Automation**:
  - The alert migration and model (D7).
  - `AlertQuery`, `AlertController` and the other readers become null-safe and
    kind-aware, including `AlertInbox` and `AlertNotificationResource` (the bell).
  - The device filter goes through `automation_alert_devices`.
  - `AlertProjector` stays for workflows.
  - A new `ConnectivityProjector`, called from `RuntimeController` for
    `device.connectivity.v1`:
    - It locks the organization's alert stream, resolves the subject (device by uuid,
      gateway by connection and edge, adapter by uuid) and creates or updates the alert
      by `episode_key`, with the threshold, its source and the last observed time.
    - It writes the pivot rows, the event-log entry (source `connectivity`), the audit
      record and, from pull request 5, the integration events. It applies mutes and
      flapping, and from pull request 4, deliveries and their bell notifications (D17).
- **Connectivity** (new domain folder `Domain/Connectivity`):
  - Settings resolution and the control message (`ConnectivitySettings`): device, then
    profile, then defaults; the adapter style lock (D5); the poll interval from
    `DeviceAdapter::pollIntervalSeconds()`.
  - Mutes and the reveal job; routes, subscriptions and scope matching
    (`RecipientMatcher`).
  - `DeliverConnectivityNotice`, which follows `DeliverAlertEmail`'s retry and attempts
    model with its own rechecks; the batch job; `ConnectivityAlertEmail` and
    `ConnectivitySummaryEmail` (plain text, as `AlertEmail` is);
    `ConnectivityTransitionNotification` for the bell.
  - Controllers for [contracts/api.md](contracts/api.md).
- **DeviceAdapters**: `AdapterService::deploy`, in the transaction that records the
  applied revision, writes settings messages for the adapter's devices when the poll
  interval changed (D6). Activation through an adapter writes the device's settings
  with the locked style.
- **Devices**:
  - `DeviceView` shows the offline cause while an alert is open, and "adapter
    restarting" or "adapter paused" for an adapter device the runtime reported unknown
    after its adapter's death (D14).
  - `DeviceDirectory` rows get `offline_alert`.
  - `device.deactivated.v1` handling is unchanged; the runtime sends the stop.
- **Notifications**:
  - `Preferences::SOURCES` gains `connectivity`, and a stored grid without it reads as
    all on (D9). Event-log sources are listed separately, so pull request 2 can show
    `connectivity` events before pull request 4 adds the email source.
- **Integrations**: the flag, `EventJournal::connectivity`, the feed and webhook
  filters, and the alert read filter (D11).
- **Agents**: `ListAlerts` and `GetDeviceHealth` return kind, cause and the threshold
  in effect, and `agents:tools --check` is regenerated.
- **Scheduler**:
  - `connectivity:reveal-muted` runs every minute.
  - Batch summaries are delayed jobs on the `alerts` queue, not scheduler entries.

### Portal (`apps/portal/src`)

- **Alerts** (`alerts/Alerts.tsx`):
  - Kind filter and a "Muted" filter; kind and cause in the row.
  - Alert detail panels for device, gateway (affected devices `DataTable`) and
    connection alerts, with last heard and, where known, last observed.
  - A "Notify me" action that opens the member's subscriptions for this organization.
- **Bell** (`alerts/bell`): `model.ts` and `AlertBell.tsx` render connectivity
  notifications by kind and subject ("Device offline · Freezer 2") when `workflow` is
  null; the chime and read rules are unchanged.
- **Devices**:
  - `HealthStatus` and `healthDetails` show the offline cause, "learning" and the
    adapter states.
  - The device page's **Connectivity** panel shows state, last heard, last observed,
    reporting interval, poll interval, the threshold in effect and where it came from
    (device, profile or automatic), overrides, the locked style for adapter devices,
    and the mute.
  - The directory status filter gains "Offline alert".
- **Device profiles**: an **Offline alerts** section in `ProfileWorkspace`, with the
  settings (*Offline after* defaulting to **Automatic**) and the reporting check
  warning (FR-004a). Saving does not touch the draft.
- **Settings → Notifications**: a **Device offline** entry above the workflow list. It
  holds routes in `CollectionPage` + `DataTable` and a route editor in a `Panel`.
- **Settings → Email**: the **Device offline** row in the grid.
- **Sites and gateways**: a **Mute offline alerts** action.
- **Integrations**: a **Device connectivity events** switch on the application.
- **Automation editor**: no change (FR-036).

### Docs and Help

- **Docs:**
  - `docs/features/alerts.md`: kinds, detection, interruptions (including adapter
    redeploys), the automatic threshold, polled devices, mutes, recipients, the bell,
    batching and flapping.
  - `docs/features/devices.md`: connectivity state and settings.
  - `docs/features/adapters.md`: adapter deaths are interruptions; repeated births and
    history do not count as heard; source metrics (pull request 6).
  - `docs/features/automation.md`: freshness versus *Offline after* (FR-036).
  - `docs/features/integrations.md`.
  - `docs/reference/events.md`: the runtime and integration events.
  - `docs/dev/gotchas.md`: "heard" vs accepted, adapter deaths, observed-time
    intervals versus receipt-time silence.
- **Help guides:** `alerts.md`, `alert-notifications.md`, `devices.md` (including
  adapter and polled devices), `profiles.md`, `gateways.md`,
  `automation-conditions.md` (freshness versus *Offline after*) and
  `integration-webhooks.md`. They explain when to use spec 014's No data instead
  (FR-034).
- **Spec 014:** its spec and plan record FR-037 (No data defaults to *Offline after*
  and counts silence from receipt) before its No data work starts.

## Delivery

Each pull request is based on `main` after the previous one merges; none is stacked.

1. **Alerts generalised** (FR-035; D7). Changes in this PR:
   - The migration with the workflow backfill of `automation_alert_devices`.
   - Null-safe, kind-aware readers, including the bell's; integration alert reads
     return workflow alerts only until pull request 5 adds the opt-in.
   - `OrganizationDeletion` inventory.
   - `kind`, `severity` and `devices` on the alert resource, `kind` and nullable
     `workflow` on the bell's resource, and the api-client types.

   No behaviour change: the existing suites pass unchanged, plus tests for the backfill
   and the check constraint. Live check: workflow alerts, emails, the bell and the
   integration feed behave as before.
2. **Detection and display** (US1, US3, US4 scenarios 1–2; FR-001, FR-002, FR-004
   automatic, FR-005 to FR-012, FR-014 to FR-016, FR-030, FR-033; D1–D5, D13, D14,
   D16). Changes in this PR:
   - Runtime: the tracker, adapter-edge rules (heard, deaths, presence), the
     reporting interval and automatic threshold with the observations seed, the table,
     contract, HTTP endpoint and default settings.
   - Laravel: the projector, display, inbox filter and detail, and event-log source;
     effective settings in the snapshot (defaults, the adapter style lock and the poll
     interval) so polled devices are judged correctly from the first release.
   - The agents' tools, Help and docs.

   No notices yet: FR-018 holds trivially. Live check: fire-watch box power cut
   (device), gateway with two simulated devices (gateway), polled trackers for 30
   minutes (no alert), a stopped tracker (device), an adapter redeploy, runtime and
   broker restarts (no alerts).
3. **Settings and mutes** (US5; FR-003, FR-004 overrides, FR-004a, FR-005 settable,
   FR-009 disable path, FR-017, FR-027, FR-028, FR-032; D5, D6, D8). Changes in this
   PR:
   - Settings endpoints, the control message on every change (including adapter
     deploys that change the poll interval), and the runtime apply.
   - The reporting check; mutes, the reveal job and the portal sections.

   Live check: *connects to report* with a short threshold; the tracker warning; a
   device override; mute a device and a site.
4. **Notifications** (US2, US4 scenario 3; FR-018 to FR-026, FR-024a, FR-031; D9, D10,
   D17). Changes in this PR:
   - Subscriptions, routes, matching, the delivery job, batches, flapping, emails,
     bell notifications and the preferences source.
   - The Settings, Alerts and bell surfaces.

   Live check in Mailpit and the bell: one site subscription, a route, recovery, the
   summary after stopping several simulators, and a flapping device.
5. **Integrations** (US6; FR-029; D11). Changes in this PR:
   - The flag, journal writes, feed, webhook and read filters.
   - Supplement, SDK and docs, and the portal switch.

   Live check: two applications on the local webhook sink; only the opted-in one
   receives events.
6. **Vendor broker and API connections** (US4 scenario 4; FR-013; D12). Changes in this
   PR:
   - Adapter publisher metrics (vendor broker and polling) and the runtime source
     subjects.
   - The connection-lost projection and display, and the adapter page.

   Live check: `vendor_water_meter.py` behind a vendor-source adapter, stopping the
   vendor broker; `vendor_tracker_api.py` behind a polling adapter with a `401` and a
   `500` fault. Each opens one connection alert and no device alerts. Existing
   adapters get the metrics when they are next deployed.

The pilot's need (an email when the fire-watch box goes dark) is met after pull request
4. Pull requests 2 and 3 can ship to the pilot on their own: they show alerts in the
portal and send nothing, and the automatic threshold keeps hourly and daily devices
quiet while they report.

## Project Structure

### Documentation (this feature)

```text
specs/018-device-offline-alerts/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── runtime-messages.md
│   ├── api.md
│   └── integration-events.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
services/runtime/internal/app/          connectivity.go (new), application.go, control.go, http.go (+ tests)
services/runtime/internal/storage/      schema.sql, connectivity.go (new) (+ integration tests)
services/runtime/internal/sparkplug/    session.go (adapter node metrics, PR 6)
services/adapters/nodes/                adapter.js (source metrics, PR 6) (+ tests)
contracts/internal/                     catalogue.json, device.connectivity.v1.*, device.connectivity-settings.v1.*, internal.control-state.v1.* (schema, fixture, cases)
contracts/openapi/supplements/          integration-events.yaml, integration.yaml
apps/api/database/migrations/           alerts generalisation, connectivity tables, settings columns, application flag
apps/api/app/Domain/Automation/         Models/Alert.php, Services/AlertQuery.php, Services/AlertInbox.php, Services/ConnectivityProjector.php (new), Http/Controllers/AlertController.php, Http/Resources/AlertNotificationResource.php, Jobs/, Mail/
apps/api/app/Domain/Connectivity/       settings, mutes, routes, subscriptions, matching, delivery, bell notification, controllers, routes.php (new)
apps/api/app/Domain/DeviceAdapters/     Services/AdapterService.php (poll interval changes)
apps/api/app/Domain/Devices/            Http/Controllers/RuntimeController.php, Services/DeviceView.php, Services/DeviceDirectory.php
apps/api/app/Domain/Notifications/      Services/Preferences.php, Services/EventRecorder.php, Http/Controllers/NotificationCenterController.php
apps/api/app/Domain/Integrations/       Services/EventJournal.php, Services/WebhookDispatch.php, Http/EventController.php, Http/ReadController.php, Http/ApplicationController.php
apps/api/app/Domain/Agents/Mcp/Tools/   ListAlerts.php, GetDeviceHealth.php
apps/api/resources/help/                alerts.md, alert-notifications.md, devices.md, profiles.md, gateways.md, automation-conditions.md, integration-webhooks.md
packages/api-client/src/                alerts.ts, connectivity.ts (new), notifications.ts, integrations, index.ts
packages/integration-sdk/src/           index.ts
packages/ui/src/lib/status.ts           connectivity causes and learning in the status map
apps/portal/src/                        alerts/ (and alerts/bell), devices/, profiles/ProfileWorkspace.tsx, settings/, gateways and sites pages, integrations
docs/features/, docs/reference/events.md, docs/dev/gotchas.md, specs/014-automation-nodes/
```

**Structure Decision**: one new Laravel domain folder, `Domain/Connectivity`, for the
policy that has no home today (settings, mutes, recipients, delivery). Alerts stay in
`Domain/Automation`, generalised rather than duplicated, and the bell keeps one
notification type. The runtime gains one file per layer.

## Risks

- **Generalising alerts touches about fifteen readers, now including the bell.** Pull
  request 1 does nothing else, so existing tests and a live check catch regressions
  before detection depends on it.
- **After a long platform outage,** devices that died during it open together, one
  threshold after the runtime returns. Batching keeps that to one summary per person;
  the inbox lists them all.
- **The automatic threshold needs history.** Existing devices are seeded from 7 days
  of observations at start; a new device is `learning` until its third reading, so a
  daily reporter that fails in its first two days is reported only by a death or not
  at all. Its profile or device can set *Offline after* to avoid that.
- **Device clocks.** The interval comes from observed times. A device whose clock jumps
  produces odd gaps; the median, the 15-minute floor and the 7-day cap bound the
  damage, and silence itself never uses device time.
- **A device that slows down gradually** raises its own automatic threshold as the new
  gaps complete. A device that stops does not (a silence in progress is never a gap),
  so the case offline alerts exist for is unaffected.
- **Adapters deployed before pull request 6** lack the source metrics. Until they are
  redeployed, losing a vendor broker, or a vendor API that keeps failing, alerts each
  vendor device by silence (in the portal, and to subscribers), as the spec's edge
  cases foresaw.
- **Adapter runtime image skew.** A tenant runtime started before #117 has no stored
  births; its devices show unknown after a redeploy until they report, which this
  feature reports honestly but cannot shorten.
- **Spec 014 overlap.** Its No data guard (research D1 there) needs recorded connection
  state. D3 here keeps that state in memory, which does not serve spec 014's database
  tick. Whichever spec lands second reuses or persists it. FR-037 also changes spec
  014's No data default and clock; its documents are updated with this feature's docs
  (pull request 2). Spec 014's first user story example (a whole silent meter) is now
  covered here; the Help guides explain the split (FR-034).

## Complexity Tracking

No constitution principle is broken. The one structural choice that needs care is
making the workflow columns of `automation_alerts` nullable. It is guarded by a check
constraint and by isolating the change in pull request 1, and is explained in research
D7 together with the rejected alternative of a parallel table.
