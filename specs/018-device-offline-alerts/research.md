# Research: Device Offline Alerts

What the code on `main` does today, and the decisions it leads to. First read at
`1c1468b` (2026-10-25); re-checked at `dfd7b62` (2026-10-30) after polling adapter
sources (spec 020), device review (ADR-025), polled automation freshness and the alert
bell (spec 022) landed. Line numbers are from the first read unless a section says
otherwise. Paths are relative to the repository root; `rt/` is
`services/runtime/internal/`, `api/` is `apps/api/`.

## What exists

### Runtime

- **Presence lives only in memory.** Sparkplug sessions are in `Engine.nodes`, keyed by
  connection and edge (`rt/sparkplug/session.go:69-85`). An NDEATH with a matching
  bdSeq sets the node and all of its sources offline (:137-154). A DDEATH sets one
  source offline (:169-174). No table stores presence or last-seen; the nearest data
  is `device_runtime.latest.received_at`, per parameter (`rt/storage/schema.sql:57-61`).
- **Presence events.** `device.presence.v1` (`rt/app/application.go:474-488`) is
  online (accepted packet, throttled to once per 5 s), offline (death certificate,
  :378-380) or unknown (review required, failed hand-off, or connection-wide).
  `connectionPresence` forces unknown on every device of a connection when the broker
  connection drops. A rejected packet now marks only its own edge's (or device's)
  devices unknown, once (`rejectedPresence`, `rt/app/application.go:526-557` at
  `dfd7b62`). `gateway.presence.v1` is "offline" on NDEATH and "unknown" when a
  rejected packet ends an edge's session.
- **Restart.** `New()` reloads definitions and sets `activeSince` (:117-131); packets
  received earlier are dropped. The engine starts empty and requests a rebirth for
  every edge with active definitions, rate-limited per edge (:215-274).
- **Definitions** carry the organization, configuration, profile artifact and
  `Source{ConnectionUUID, CandidateUUID, GroupID, EdgeNodeID, DeviceID}`
  (`rt/devices/types.go:8-39`). They carry no site, profile UUID or gateway. An empty
  `DeviceID` means node-level metrics (a direct device). There is no gateway concept:
  children are definitions that share a connection and edge.
- **Connections.** Every connection, including user-created ones, is on the platform
  broker (`api/app/Domain/Devices/Http/Controllers/RuntimeController.php:52`); nothing
  marks a connection as customer-operated. Groups follow conventions:
  `onboarding-<org>` for direct devices (one edge per device), `adapters-<org>` with
  edge `adapter-<adapter uuid>` for adapters.
- **Adapters never send DDEATH.** The managed publisher sends NDEATH for its own node
  (will and on close) and rebirths on request; a redeploy is an NDEATH for all of its
  devices, and the runtime marks every one of them offline
  (`rt/app/application.go:355-378` at `dfd7b62`: definitions on the edge match any
  NDEATH). Activating a device through an adapter redeploys it. Since #117 the
  publisher keeps each source's last birth in `births-<adapter>.json` on the tenant
  runtime's `/data` volume and announces them all right after its NBIRTH, so presence
  returns within seconds; a source with no stored birth stays offline until its next
  reading (`services/adapters/nodes/adapter.js:425-500, 612-622` at `dfd7b62`;
  `docs/dev/gotchas.md`, "Every adapter redeploy used to take all its sources
  offline"). A repeated birth carries the last reading with its original timestamps.
  A reading older than the newest the publisher already sent for that source is
  marked historical (:546). The publisher reports whether its source is connected
  (`source_connected`, and for polling `source_state`: `polling`, `retrying`,
  `stopped`) to Laravel as overwritten `health` JSON
  (`api/app/Domain/DeviceAdapters/Http/AdapterController.php:246-265` at `dfd7b62`). A
  source is `platform`, `vendor`, `webhook` or `poll`
  (`api/app/Domain/DeviceAdapters/Enums/AdapterSourceType.php`).
- **Polling sources (spec 020).** A poll runs every 1 minute to 24 hours (default 5
  minutes, FR-032 there), backs off up to 1 hour on network errors, `408`, `429` and
  `5xx`, and stops on `400`, `401`, `403`, `404` or a bad body until someone resumes it
  or deploys a revision (`services/adapters/lib/poll.cjs:294-371`). Each run is
  recorded in `device_adapter_poll_runs`. Readings carry the vendor's observed time
  when the decoder returns `observedAt`, otherwise the receipt time. A reading arrives
  up to one poll interval, plus the vendor's upload delay, after it was observed, and
  a device's readings arrive together, once per run. `DeviceAdapter::pollIntervalSeconds()`
  reads the interval of the running revision, and `GET workflows/dag/resources`
  returns it per device (#125).
- **Readings history.** `device_runtime.observations` (a hypertable on `received_at`,
  compressed after 7 days) keeps `observed_at` and `received_at` for every reading, with
  an index on `(organization_uuid, device_uuid, parameter_uuid, observed_at DESC)`
  (`rt/storage/schema.sql:37-56`).
- **Loops.** A 5-second maintenance ticker (`application.go:653-692`) expires commands,
  retries rebirths, sends the heartbeat every 10 s and syncs `/state` every 30 s. It is
  the only periodic loop with access to definitions and the session engine. DAG timers
  run on the telemetry-stream clock (`rt/storage/dag.go:265-298`).
- **Events to Laravel.** `a.emit` inserts into `device_runtime.outbox` in its own
  transaction with a random UUID (`rt/storage/store.go:127-150`); a failed insert is
  logged and lost. The relay publishes to JetStream and a durable consumer posts to
  `/api/internal/devices/events`; Laravel deduplicates on the UUID in `device_inbox`
  and accepts only listed types (`RuntimeController.php:99-127`). Rule transitions
  avoid duplicates with ids derived from the episode (`rt/rules/evaluator.go:238-258`)
  and `ON CONFLICT DO NOTHING`.
- **Storage.** Runtime tables are idempotent DDL in `rt/storage/schema.sql`, run on
  start. `contracts/internal/catalogue.json` is empty: no runtime event has a schema
  yet.

### Control plane

- **Alerts belong to workflows.** `automation_alerts` requires
  `automation_workflow_id` and `automation_deployment_id`, unique on deployment and
  episode (`api/database/migrations/2026_09_25_020000_create_workflow_alerts.php:
  15-31`). About fifteen readers dereference the workflow or deployment without null
  checks: `AlertQuery` (filters at 33-41, device at 55, views at 60-70),
  `AlertController` (66-83, 185-198), `WorkflowController:239`, `DeliverAlertEmail`,
  `AlertEmail`, `EventRecorder:56-61`, `Integrations/Services/AlertSnapshot:13`,
  `Integrations/Http/ReadController:68`, `OverviewQuery:37-52`,
  `Agents/Mcp/Tools/ListAlerts`, `BackfillNotificationEvents:20`, and the geofence map
  controllers. `OrganizationDeletion` lists alert tables as deletion blockers, checked
  by `OrganizationDeletionInventoryTest`.
- **Projection.** `AlertProjector` (`api/app/Domain/Automation/Services/
  AlertProjector.php:21-47`) runs inside the caller's transaction: `firstOrCreate` on
  (deployment, episode), idempotent on transition ids, then the event-log entry, the
  integration event, the audit record and `AlertDelivery::firstOrCreate(alert,
  recipient, type)` with a `DeliverAlertEmail` job on the `alerts` queue.
- **Email.** Recipients are per workflow (`notification_settings` JSON, revisioned,
  409 on stale updates, at most 20 verified members with view). `DeliverAlertEmail`
  rechecks membership, verification, permission, preferences, subscription and
  deployment before each send, cancels an activation that cleared first, and retries
  with backoff for a day.
- **Preferences.** `Preferences::SOURCES` is workflow, service, watchdog; levels are
  critical, warning, info, recovery (`api/app/Domain/Notifications/Services/
  Preferences.php:12-49`). `allows()` reads `grid[source][level] ?? false`, so a source
  added later is **off** for everyone who has saved preferences. The update endpoint
  validates the grid strictly (`NotificationCenterController.php:24-30`).
- **Event log.** `EventRecorder` writes `notification_events` with a source, severity
  and link; workflow alerts are always `warning` (:54-66).
- **Integrations.** `EventJournal::alert` writes `alert.{activated|cleared|
  acknowledged}.v1` per organization stream, unique on (resource, type),
  `device_uuid` required. The feed and the webhook worker filter by granted device
  only (`EventController.php:33-34`, `WebhookDispatch.php:39-63`). The SDK throws on
  unknown event types (`packages/integration-sdk/src/index.ts:137-139`). Applications
  have at most 8 abilities, all used.
- **Profiles are immutable once published.** Every change, including `extensions`,
  goes through `DeviceProfileAuthoring::mutate` → `beginDraft`
  (`api/app/Domain/DeviceProfiles/Services/DeviceProfileAuthoring.php:24-41`). A device
  reaches its profile through its applied configuration. Devices have `site_id`,
  `tags` (JSON) and fields editable without activation (`DeviceController::update`).
  Workflow `notification_settings` are the precedent for operational settings
  revisioned apart from the definition.
- **Displayed presence.** `DeviceView` shows a stale "online" as unknown when the
  runtime heartbeat is older than 20 s (:24-27, :75); presence values are online,
  offline, unknown, unseen and quiet (`DeviceDirectory.php:18`).
- **Device review (ADR-025).** `review_required` now follows the source's current
  birth: a compatible birth clears it, and automations bound to a device in review stop
  with `device_review_required`. Review never meant the device was silent.
- **Automation freshness (#125).** A DAG binding's `fresh_seconds` counts from the
  reading's observed time. The editor defaults it to the longest of 120 s, the
  parameter's `reporting.stale_after_seconds` and twice the device's poll interval,
  and warns below two intervals (`apps/portal/src/automation/freshness.ts`). Runtime
  semantics are unchanged. Spec 014's *No data* node is specified but not built: no
  DAG node type exists for it.
- **Alert bell (spec 022).** When `AlertProjector` creates a delivery it also writes a
  Laravel database notification (`AlertTransitionNotification`, type `alert`, data
  `source: workflow`, workflow uuid and name, device uuid and name) in the same
  transaction, whatever the person's email preferences. The bell polls
  `GET alert-notifications/summary`; `AlertNotificationResource` returns a non-null
  `workflow`. Opening an alert marks its notifications read. Notifications are pruned
  after 90 days (`api/app/Domain/Automation/Services/AlertProjector.php`,
  `Http/Resources/AlertNotificationResource.php`).
- **Permissions.** Alerts and notification settings use `Device.view` and
  `Device.manage`, not `Workflow.*`.

### Related work

- Spec 014's No data node needs a "broker guard" (its research D1): No data must not
  fire for devices whose broker connection the runtime has lost. Decision D3 below
  builds the same guard for connectivity; whichever lands first provides it.
- Spec 011 (draft) adds Teams, Slack and SMS channels; D9 leaves a `channel` on
  deliveries so routes can name them later.

## Decisions

### D1. Detection runs in the runtime's maintenance loop

- **Decision:** a connectivity tracker in the runtime keeps, per monitored subject, the
  last time anything arrived and evaluates every subject on the existing 5-second
  maintenance tick. Births, data and deaths update it as they are received. Opening or
  clearing an episode writes a row and its outbox event in one transaction.
- **Rationale:** principle I keeps evaluation in Go, and the runtime keeps detecting
  while Laravel is down (FR-007). The maintenance loop already reads the session engine
  and definitions; 5 s is well inside SC-001 and SC-002's one minute. Writing only on
  transitions keeps writes proportional to episodes, not to packets.
- **Alternatives:** (a) Laravel compares `devices.last_seen_at` on a schedule: it would
  evaluate telemetry in the control plane, miss gateway grouping and interruptions,
  and stop when Laravel stops. (b) A DAG system workflow per device: up to 32 bindings
  per workflow, and the DAG clock is tied to the telemetry stream, so silence after a
  stream stall would not tick.

### D2. "Heard from" means any packet received for the source, except an adapter's own

- **Decision:** on every edge except an adapter's, the tracker updates a source's
  last-heard time on receipt of any packet for it (birth, data, death) before
  validation, and an edge's last-heard time for any packet on that edge. Rejected
  packets count: the device is alive. On an adapter edge (group
  `adapters-<organization uuid>`), only a DDATA with at least one reading not marked
  historical counts. Its NBIRTH, DBIRTH and NDEATH are the publisher's own, and a
  historical reading is a backfill or a re-read.
- **Rationale:** counting receipt rather than acceptance keeps rejected-packet presence
  from hiding or causing offline alerts. The publisher announces its stored births
  again after every restart, so counting them would make a vendor device that went
  quiet hours ago look heard at every redeploy and move its last-seen time (FR-002).
  A store-and-forward upload ends with its newest reading, which is not historical,
  so a device that comes back with a backlog is heard.
- **Alternatives:** accepted packets only, which would make a device needing a rebirth
  look silent; counting adapter births (the redeploy problem above); measuring
  silence by observed time, which would let a device's clock or a vendor's delay
  decide alerts.

### D3. Platform-side interruptions move an anchor; they never open or clear

- **Decision:** silence is measured from an anchor: the latest of the last packet, the
  time the runtime started (not a device's later activation, which FR-010 says must not
  reset silence), and the time the runtime's broker connection was last restored. An
  adapter edge's NDEATH pauses its devices instead: at its next NBIRTH each device's
  anchor moves forward by the time the edge was dead (counted from the later of the
  NDEATH and the anchor), so redeploys, restarts and pauses are left out of silence
  without restarting it. While a connection is down, or an adapter edge is dead, its
  subjects are not evaluated. Open episodes stay open. An adapter NDEATH no longer reports its devices offline: the
  runtime reports them `unknown` ("Adapter restarting; waiting for it to reconnect"),
  and a compatible DBIRTH after the NBIRTH reports them online again as today.
- **Rationale:** FR-006 and principle VI. Every runtime connection is on the platform
  broker, so losing one is always the platform's problem, and adapters are platform
  infrastructure, so an adapter NDEATH (crash or redeploy) is too. Anchors are
  in-memory: after a restart the start time is later than any of them. Reporting adapter
  devices offline on a redeploy is what made every activation through an adapter take
  its other devices offline (What exists); unknown is the honest state (principle VI).
  Pausing rather than restarting adapter devices' silence matters because activations
  redeploy the adapter: onboarding devices one by one would otherwise restart a dead
  daily device's three-day clock every time. An adapter catches up on what it missed
  (a polling cursor, a vendor's webhook retries), so leaving out only the down time is
  accurate; after a runtime or broker outage readings may be lost, so silence restarts
  there, which can only delay an alert, never invent one.
- **Alternatives:** persisted per-connection state (needed by spec 014's DAG tick, which
  reads the database, but not here), or treating an adapter NDEATH as a gateway alert,
  which would page customers for a platform redeploy.

### D4. Subjects: devices, gateways and adapter sources

- **Decision:** the tracker groups definitions by connection and edge.
  - An edge with two or more monitored definitions is a **gateway**. Its NDEATH, or
    every monitored child and the node itself being silent past their thresholds, opens
    one gateway episode listing the affected devices. Children open no episodes while
    it is open. When it clears, each child's anchor becomes the gateway's return.
  - An edge with one monitored definition (a direct device, or a gateway with one
    device) is a **device** subject.
  - A child already in an open episode when its gateway dies keeps that episode.
  - Adapter edges are never gateways (D3). Their devices are judged by silence only.
- **Rationale:** the owner chose one alert per gateway. Counting monitored definitions
  makes the rule independent of how many devices a gateway reports but nobody activated.
- **Alternatives:** gateway alerts for any edge with a child (a single-device gateway
  would read "Gateway offline" for what operators think of as a device); a gateway
  table in the runtime (Laravel already models gateways; the event carries connection
  and edge and Laravel resolves the row).

### D5. Connection style changes what a death means

- **Decision:** *Stays connected*: a death opens the condition at once (episode after
  grace). *Connects to report*: deaths are ignored, any packet clears an open episode
  at once, and only silence opens one. On a gateway, only children that stay connected
  count towards the two-device rule.
- **Adapter devices** always use *connects to report* (FR-003): Laravel resolves the
  style to `connects_to_report` for any device with an open `device_installations`
  row, whatever its profile says, and the settings response marks it locked with the
  reason `adapter`. The runtime never sees a device death from an adapter, so the
  setting would change nothing but the clear grace.
- **Rationale:** FR-003 and FR-005. Battery and cellular devices that disconnect by
  design would otherwise raise an alert after every report.

### D6. Offline settings are operational, revisioned beside the profile

- **Decision:** `device_profiles.connectivity_settings` and
  `devices.connectivity_overrides` (JSON, each with its own revision) hold enabled,
  style, offline after, grace and severity. Saving does not create a profile draft or
  need an activation. Laravel resolves the effective settings per device (device, then
  profile, then platform defaults: on, stays connected (connects to report for adapter
  devices, D5), automatic *Offline after* (null, D16), 120 s, warning) and sends the
  runtime everything except severity, plus the device's poll interval (null when it is
  not polled): in the `/state` snapshot, and as a `device.connectivity-settings.v1`
  control message through `device_outbox` whenever they change, fenced by a per-device
  settings generation. Deploying an adapter revision whose poll interval differs from
  the running one changes the effective settings of its devices, so it writes their
  messages too.
- **Rationale:** tuning an alert threshold should not republish a profile or reactivate
  every device. Principle II covers definitions that change how telemetry is processed;
  these settings change only alerting, as workflow `notification_settings` already do.
  Severity is presentation and routing, so it stays in Laravel.
- **Alternatives:** compile the settings into the profile artifact (a republish and
  reactivation per change), or store them in the device configuration draft (needs
  activation, and no profile-level default).

### D7. One alerts table, generalised

- **Decision:** `automation_alerts` gains `kind` (workflow, device_offline,
  gateway_offline, connection_lost; default workflow), `severity`, nullable workflow
  and deployment ids with a check that workflow alerts have both, connectivity subject
  columns, cause, last-seen and threshold fields, `suppressed_at` (muted), `held`
  (flapping) and `stopped_reason`. A pivot, `automation_alert_devices`, lists the
  devices an alert concerns (one for a device alert, all affected for a gateway). A
  unique `episode_key` identifies connectivity episodes. The first pull request makes
  every reader null-safe and kind-aware with no change in behaviour.
- **Rationale:** acknowledgement, assignment, comments, deliveries with retries, the
  inbox, the event log, integration snapshots and the MCP tool all exist once. The
  pivot gives the device filter, integration grant checks and recipient matching one
  query for every kind.
- **Alternatives:** a parallel `connectivity_alerts` family: duplicates five tables,
  the inbox merge, the delivery job and the MCP tool, and the inbox would need a union.
  Renaming the table to `alerts`: churn with no behaviour, left for later.

### D8. Mutes are applied by Laravel

- **Decision:** `connectivity_mutes` (device, gateway, site or profile; until; reason;
  author). When an episode opens for a muted subject, the alert is stored with
  `suppressed_at`: hidden from the default inbox and the event log's active list,
  shown on the device page, never notified. A scheduler job every minute reveals
  suppressed alerts that are still open once their mutes have ended, and they notify
  then. Deliveries recheck mutes before sending.
- **Rationale:** mutes are intent, not detection; keeping them out of the runtime avoids
  a second control message and keeps the runtime's view of offline honest. Revealing an
  open episode at mute end satisfies FR-028: the device has been offline longer than its
  grace period already.
- **Alternatives:** pushing mutes to the runtime (one more control message per target,
  and a gateway or site mute fans out to many devices).

### D9. Recipients: subscriptions and routes, deduplicated by delivery

- **Decision:** `connectivity_subscriptions` (a member's own scope and recovery choice)
  and `connectivity_routes` (an organization's scope, minimum severity, up to 20
  recipients, recovery choice, revision). A scope is all, or lists of site, tag,
  profile and device ids. When an alert opens, Laravel matches the alert's devices
  against both and creates `AlertDelivery` rows, unique per alert, recipient, type and
  channel, so a person matched twice gets one notice. Deliveries gain `channel`
  (`email` for now).
- **Preferences:** `connectivity` joins `Preferences::SOURCES`. A stored grid without it
  reads as all levels on, so routes reach existing users until they turn it off; a
  subscription is already the person's opt-in.
- **Rationale:** FR-018 to FR-023, and spec 011 can add destinations to routes without
  changing matching.

### D10. Batching and flapping are delivery policy

- **Decision:** a connectivity delivery whose recipient and channel received a notice
  in the last 5 minutes joins that window's batch instead of sending; a job at the
  window's end sends one summary of the batch's still-valid deliveries, grouped by site.
  When an alert opens, if its subject has more than 3 connectivity alerts in the last
  60 minutes, the alert is marked `held` and gets no deliveries; the next notice for
  that subject says how many were held.
- **Rationale:** FR-024 and FR-025 concern who is told and when, which is Laravel's,
  and the inbox still shows every episode.

### D11. Integrations opt in with a flag, not an ability

- **Decision:** `integration_applications.connectivity_events` (boolean, default false).
  Connectivity alerts journal `connectivity.offline.v1` and `connectivity.online.v1`
  once per affected device (resource id derived from the alert and the device), so
  device grants filter them exactly. The feed and the webhook worker skip
  `connectivity.*` unless the flag is on and the application has `alerts:read`.
- **Rationale:** FR-029. The eight ability slots are full and abilities are about
  access, not subscriptions. Existing SDK consumers that throw on unknown types never
  see the new types unless they opt in.
- **Alternatives:** a ninth ability (raises the limit, and an ability is the wrong
  concept); event-type subscriptions for every type (spec 003 FR-024, a larger change).

### D12. Vendor broker and vendor API loss travel over Sparkplug

- **Decision:** the adapter publisher adds node metrics `Adapter/Source connected`
  (boolean) and `Adapter/Source operator` (`platform` or `customer`) to its NBIRTH and
  sends NDATA when the connection changes. Vendor-broker and polling sources are
  `customer`; platform-broker and webhook sources are `platform`. A polling source is
  disconnected from the first run that ends `retrying` or `stopped` until the next run
  that ends `ok`, the same transitions it already reports as `source_state`. For a
  customer source, a disconnection held past the platform's default grace (120 s)
  opens one `connection_lost` episode for the adapter; for either kind, its devices
  are not evaluated while it lasts, and their anchors move to the reconnection.
- **Rationale:** the runtime must know about the loss to avoid alerting every vendor
  device for silence; Sparkplug is the channel it already reads, and the adapter
  already tracks the state.
- **Polling:** a vendor API that rejects the API key, rate-limits for an hour or
  returns errors stops every device's readings at once, exactly like a lost vendor
  broker. When the run succeeds, the cursor resumes and the backlog arrives; devices
  with new readings in it are heard (D2), and the rest are judged from the
  reconnection.
- **Alternatives:** Laravel turning `health` transitions into alerts (overwritten state
  with no transitions, a second detector, and the runtime would still alert the
  devices); reading `device_adapter_poll_runs` in the runtime (a control-plane table).

### D13. Rollout starts monitoring at the next packet

- **Decision:** the tracker creates its rows with `monitoring_since` and no
  `heard_since_monitoring`. A subject is evaluated only after its first packet since
  monitoring started. Laravel labels a device whose `last_seen_at` is older than its
  monitoring start "offline since before monitoring started" and one never seen
  "waiting for first report". Turning offline alerts on for a profile or device resets
  monitoring the same way. The release creates no routes and no subscriptions.
- **Rationale:** FR-008, FR-030 and FR-031 with no backfill and no special release step.

### D14. Display follows the open episode

- **Decision:** `DeviceView` shows a device as offline, with its cause, while a
  connectivity alert concerning it is open; otherwise as today. The runtime's internal
  HTTP server gains `GET /connectivity` (per device: monitoring state, last heard, last
  observed, anchor, reporting interval, readings counted and the *Offline after* in
  effect, D16) for the device page and the profile warning (FR-004a).
- **Rationale:** silent devices behind live gateways keep presence "online" today; the
  episode is the platform's honest judgement. A read on page load avoids a column
  updated on every packet.

### D15. Delivery order, no stacking

Six pull requests, each based on `main` after the previous one merges (see the plan's
Delivery). Alerts are generalised first so detection lands on a reviewed base.
Detection ships with the automatic *Offline after* (D16), so devices that report
hourly or daily do not fill the Alerts page before anyone can tune them; settings and
mutes come before notifications so that people who opt in can already override and
mute.

### D16. Automatic *Offline after* from the reporting interval

Clarified by the owner on 2026-10-30 (spec FR-004).

- **Decision:** the tracker keeps, per monitored device, the observed times of its
  recent readings that count as heard (D2): at most the last 64 gaps between distinct
  observed times, none older than 7 days, ignoring gaps of zero or less. The
  reporting interval is their median. On start it seeds them from
  `device_runtime.observations` (last 7 days, still uncompressed), in batches of
  devices. When neither the device nor its profile sets *Offline after*, each
  evaluation uses `clamp(ceil_to_minute(3 × interval + poll_interval), 900, 604800)`
  seconds. With fewer than three readings the device is `learning` and is not judged
  by silence; a death still counts for a *stays connected* device. A silence in
  progress is not a gap until a reading ends it. `GET /connectivity` and each
  episode's `offline_after_seconds` report the value used and whether it was automatic.
- **Rationale:** the owner's devices report from every minute to once a day; a fixed
  default would alert after every report of the slow ones. Observed times, because
  polled readings arrive in bursts whose receipt gaps are near zero; a constant clock
  offset cancels in a gap, and absolute times still come from receipt (spec, clock
  skew). The median ignores one long outage. The poll interval is added once because a
  healthy polled device can be silent for up to its interval plus one poll. The runtime
  computes it because detection lives there (principle I) and it sees every reading.
  64 gaps per device bound memory at about 5 MB for 10,000 devices.
- **Alternatives:** a moving average (one outage skews it); Laravel computing the
  interval on a schedule (telemetry evaluation in the control plane, and a lag); one
  automatic value per profile (one parked daily tracker would set every tracker's
  threshold); a fixed 15 minutes with a warning (rejected by the owner).

### D17. The bell is a channel of connectivity deliveries

- **Decision:** whenever a connectivity delivery row is created for a recipient (not
  held, not suppressed), the same transaction writes one database notification of type
  `alert` for them, as `AlertProjector` does, with `source: connectivity`, `kind`,
  `subject` (`type`, `uuid`, `name`), the device when there is one, and null workflow
  fields. Recovery deliveries write a cleared notification. Summaries batch only
  channels that send messages; the bell gets one notification per alert transition.
  `AlertNotificationResource` gains `kind` and `subject`, and its `workflow` becomes
  nullable; the portal's bell shows "Device offline · Freezer 2" for those. The read
  rules (selected, all up to, opening the alert) and the 90-day pruning apply
  unchanged.
- **Rationale:** spec 022 already names offline alerts as a bell channel for recipients
  (its "Related work"), and FR-018 and FR-024a here. Reusing the `alert` type keeps the
  bell's unread indexes and summary query.
- **Alternatives:** a second notification type (the bell's queries filter on
  `type = 'alert'` and would need both); writing bell notifications for every member
  who can view the device (would make the bell a broadcast, against FR-018).

### D18. Automations keep their own clocks

Clarified by the owner on 2026-10-30 (spec FR-036, FR-037).

- **Decision:** nothing in the automation editor or the DAG runtime changes in this
  feature. Freshness keeps counting from observed time with #125's default, and does
  not read *Offline after*. When spec 014 builds *No data*, its period defaults to the
  bound device's *Offline after* in effect when the binding is made (spec 014 adds
  `offline_after_seconds` beside `poll_interval_seconds` on `GET workflows/dag/
  resources`, read from the device's connectivity settings) and its silence counts
  from receipt, like D3. Spec 014's spec and plan are updated to say so before its No
  data work starts.
- **Rationale:** freshness answers "is this value still usable", silence answers "has
  the device gone quiet". Sharing one threshold for silence keeps a device's expected
  quiet time in one place; sharing it with freshness would let a three-hour-old
  temperature count as current.
- **Alternatives:** freshness defaulting to *Offline after* (stale values treated as
  current); No data independent of *Offline after* (two thresholds for the same
  silence, which drift apart).
