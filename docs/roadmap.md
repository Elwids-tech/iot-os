# Roadmap

Two parts: **Next**, the known open work (each item is a candidate Spec Kit spec), and
**Evolution**, options we keep open for when evidence demands them. Nothing here is
built unless the feature docs say so.

## Next

Grouped by area. Links point at the decision or doc that explains the item.

### Platform and runtime

- **Incremental runtime state.** Replace the 30-second full-fleet
  `GET /internal/devices/state` poll with per-organization or change-based
  reconciliation, and raise the control-claim throughput
  ([ADR-014](adr/ADR-014-control-plane-data-plane-http-integration.md)).
- **Profile transport bindings.** Profile `TransportBinding` records feed only the
  device mapping suggestions, not the runtime.
- **Retention for journals.** Coordinated retention for the integration event journal
  (with a retention floor and 410 contract), webhook deliveries, alert comments,
  deliveries and attempts, the runtime's `rule_transitions` and `dag_intents`, and
  the device audit tables (a product decision).
- **Heartbeat writes.** Each runtime heartbeat (every 10 s) updates every device and
  gateway row's `runtime_seen_at`; store one runtime status instead.
- **Runtime throughput.** Measured per stage in November 2026
  ([runtime](dev/runtime.md#measuring-what-one-instance-carries)): on one host a
  runtime stores about 700 messages a second and evaluates about 550; with the
  database a 1.3 ms round trip away it stores 83 and evaluates 31 to 36, below the
  tested 50. The first gains are in the process: the automation consumer looks up the
  stream, checks its checkpoint twice and runs the timer pass around every message
  (about 21 round trips), and the storage consumer queries outstanding commands
  after every message. Then store messages in parallel across devices, and take the
  one application lock off the ingest path. The ingest path itself (the publish
  inside the MQTT callback) is still unmeasured. Shards by connection come after
  these (ADR-046).
- **Runtime outbox relay.** Once a second the relay publishes runtime events to
  JetStream one at a time, updating each outbox row on its own. With 500 devices reporting together every 10 s it drains each burst of about 750
  events in roughly 6 s (p95 3.0 s from write to JetStream, 2026-11-06), so it is the
  next limit on the runtime → API path now that delivery is batched
  ([ADR-031](adr/ADR-031-batched-runtime-events.md)). Mark a published batch in one
  statement. (The control claim has had its own loop since
  [ADR-043](adr/ADR-043-runtime-applies-control-messages-from-the-claim.md).)
- **Parallel control apply.** The runtime applies claimed control rows one at a time
  for every organization
  ([ADR-043](adr/ADR-043-runtime-applies-control-messages-from-the-claim.md)). Apply
  them in parallel across devices while keeping each device's rows in order
  (generation fences already reject stale ones). A change that reaches
  thousands of devices at once, such as a profile-wide setting, is the first case that
  needs it.
- **Dropped runtime events.** Events emitted outside a state change (presence,
  discovery, connection presence, the heartbeat) are written to
  `device_runtime.outbox` in a transaction of their own. If that insert fails, the
  runtime only logs it and the event is lost, so Laravel can show a stale presence
  until the next change. Retry these in memory with backoff, count failures in
  `/internal/status` and alert on them. Events written with a state change already
  commit together with it.
- **Typed runtime events.** Give the internal runtime events JSON Schemas in
  `contracts/` and validate them on both sides instead of untyped maps.

### Control plane

- **Self sign-up** ([spec 035](../specs/035-self-sign-up/spec.md),
  [ADR-049](adr/ADR-049-self-sign-up.md)): a person signs up from the landing site,
  confirms their email and lands in their own organization under a billing account they
  own; super administrators get a push for each sign-up; staff open or close sign-up
  and switch the channels in the admin app.
- **White labeling and custom domains** ([spec 036](../specs/036-white-label-custom-domains/spec.md),
  [ADR-050](adr/ADR-050-brands-and-portal-addresses.md)): a billing account sets a
  brand and serves the portal on its own address, first under the platform's domain and
  then on a custom domain; each organization shows its own logo; emails, the installed
  app and push follow the brand. Customer colours come after.
- **Central tenant scoping.** Organization checks are repeated in every controller
  method; move them into scoped route bindings or a request-scoped global scope, and
  resolve membership and permissions once per request.
- **Module boundaries.** `Devices` has become an implicit shared kernel (audit,
  authorization, runtime client); extract a platform core, stop controllers calling
  controllers (including assistant tools building fake requests), and enforce
  boundaries with architecture tests.
- **Typed runtime gateway.** Replace the generic `RuntimeClient::request` with one
  method per internal endpoint, and stop passing runtime responses straight through
  public endpoints.
- **Runtime tables stay the runtime's.** `Operations.php` builds its operations
  metrics by querying `device_runtime` tables directly (latest readings, the outbox
  backlog, DAG executions and timers), which ties both schemas to one database.
  Serve these from the runtime's own metrics or `/internal/status`. The restore step
  `QuarantineRestoredSideEffects` also writes `device_runtime.commands`; move it into
  the runtime's restore path or document it as the one deliberate exception.

### Security

- **Two-step sign-in and passkeys** ([spec 034](../specs/034-two-factor-passkeys/spec.md),
  [ADR-048](adr/ADR-048-two-step-sign-in-and-passkeys.md)): authenticator codes,
  recovery codes and passkeys for people, required for platform staff and optionally
  per organization, built with Laravel's packages and no hosted identity service.
- **Adapter manager privileges.** Replace the read-write Docker socket mount with a
  restricted proxy or rootless runtime, and put tenant runtimes on a dedicated network
  that reaches only the broker ([ADR-010](adr/ADR-010-per-tenant-adapter-runtimes.md)).
- **Event feed scoping.** The integration event feed and webhooks filter by granted
  device but not by event type, so an application with `events:read` and
  `geofences:read` also receives alert events, and a webhook delivers geofence events
  without `geofences:read`. Spec 003 decided that types follow abilities
  ([FR-024](../specs/003-tenant-scoping/spec.md)); it is not built yet
  ([integrations](features/integrations.md#event-feed)).

### Automation and alerts

- **Retire workflow v1.** Move geofences onto DAG automation (the `geofence.v1` node
  exists), move the remaining v1 endpoints from `Device.*` to `Workflow.*`, and let
  the dashboard alert picker list DAG workflows (the Alerts workflow filter and
  Settings → Notifications already do) ([ADR-011](adr/ADR-011-dag-automation-in-go.md)).
- **Device offline alerts** ([spec 018](../specs/018-device-offline-alerts/spec.md)):
  built-in offline, gateway and connection alerts for every device, with an automatic
  or per-profile and per-device offline time that accounts for polled sources, notified
  (bell, email) only through personal subscriptions and administrator routes.
- **Notification policies** (requirement-led): reminders, cooldowns, escalation,
  SMS or push.
- **Live alert delivery.** The bell polls every 15 s (60 s in a background tab)
  ([spec 022](../specs/022-alert-bell/spec.md)). Broadcasting the same notification
  over Laravel Reverb would make it instant, at the cost of a websocket service and
  proxy in every deployment profile.
- **New automation nodes** ([spec 014](../specs/014-automation-nodes/spec.md)): no data,
  schedule, state match, not, range and rate of change.

### Devices and adapters

- **OPC UA connector and building simulator** ([spec 038](../specs/038-opc-ua-connector/spec.md),
  [ADR-052](adr/ADR-052-server-connections-and-point-maps.md)): a simulated building
  management server first, then a read-only OPC UA client that browses a server,
  maps its points to devices with a point map instead of a decoder, and collects
  through the existing adapter path; first from the tenant runtime, then from an
  on-site agent. Its last step proposes entities and placements from the server's
  structure through the [hierarchy's operations](reference/hierarchy-operations.md).
- **Building networks and stories** ([spec 039](../specs/039-building-stories/spec.md)):
  the simulated building's pipes, ducts and cables with meters on them, and scripted
  stories (a riser leak, a basement flood, a fire, a power outage) that say what the
  platform and a digital twin should detect and show. Builds on spec 038's simulator.
- **Move devices within a billing account** ([spec 031](../specs/031-move-devices-within-account/spec.md),
  [ADR-039](adr/ADR-039-hosted-devices-and-moves.md)): move devices to another
  organization of the same account as an archived predecessor and a linked successor,
  with their dashboards and automations, while adapters and gateways stay with the
  organization that set them up and serve the moved devices as hosted devices.
- **Firmware starter kits** ([spec 027](../specs/027-firmware-starter-kits/spec.md),
  [ADR-030](adr/ADR-030-firmware-starters.md)): a credential-free SDK project per profile
  and microcontroller (ESP32, NXP i.MX RT, Linux, and other families with AI-assisted
  ports), downloaded from the profile, device, gateway, onboarding or assistant, with
  instructions that have an AI coding agent interview the firmware developer before
  writing code.
- **Hardware replacement.** A guided "Replace physical device" flow that keeps the
  device UUID, records an audited counter baseline and preserves consumption
  continuity ([design](features/diagrams/device-integration-04-replacement.png),
  [source](features/diagrams/device-integration-04-replacement.mmd)).
- **Adapter downlink.** Vendor command encoding through adapters.
- **Local-only brokers.** Reaching vendor brokers behind customer firewalls (edge or
  tunnel).
- **Waveshare bridge host.** `waveshare_bridge.py --allow-staging` accepts only the
  legacy `mqtt.staging.elwids.xyz`; update it before the legacy domain is retired
  ([pilot](ops/pilot.md#domains)).

### Dashboards

- **Profile dashboard templates** ([spec 025](../specs/025-profile-dashboard-templates/spec.md)):
  a device profile holds dashboards designed once, saved from a real dashboard, and
  applied to any device of that profile in one step.
- **Alert limits beyond time series panels.** Time series panels draw the value a
  running automation alerts at ([dashboards](features/dashboards.md#alert-limits),
  built by [spec 037](../specs/037-alert-limits-on-charts/spec.md)). Left out there:
  the charts on a device's page, Gauge, Status and Table panels, and stepping the line
  where the rule changed during the time range. The line styles still need a
  designer's look, in the light theme too, and a long label is clipped at phone width.
- **One reader of an automation's graph.** The alert detail's `AlertTrigger` and the
  alert limits' `DeploymentGraph` each walk the stored graph. They agree on the simple
  case; `AlertTrigger` should use `DeploymentGraph`, whose cases are tested against
  the runtime ([automation](features/automation.md#alert-limits)).
- **Kiosk displays and public links** that show a published revision through
  server-resolved queries.
- **Server-side panel queries** instead of per-panel client polling.
- **Dashboard assistant** to draft panels and dashboards.

### Integrations

- **OpenAPI ([spec 001](../specs/001-openapi-contract/spec.md)).** The contract is
  generated from Laravel, CI checks it for drift, and the test suite checks responses
  against it. The integration API is fully described. Still to do: describe the
  operations left in `contracts/openapi/pending-schemas.json`, add a breaking-change
  gate, and generate `packages/api-client` and the SDK types from the contract. The
  integration API reference is published from the hosted release by the docs site
  ([spec 013](../specs/013-website-developer-docs/spec.md),
  [docs site](dev/docs-site.md)).
- **Pilot quotas and load tests** for the event feed, webhooks and telemetry reads.
- **Applications that follow a plant** ([ADR-032](adr/ADR-032-applications-follow-a-plant.md),
  spec 030). A server-sent telemetry stream, bulk latest, device parameters and sites
  for applications, and grants by site or entity branch; the first consumer is the
  Twin Studio connector. Then partner applications acting for a person
  ([ADR-033](adr/ADR-033-partner-applications-act-for-a-person.md)) and organization
  variables as automation inputs ([ADR-034](adr/ADR-034-organization-variables.md)).
  Grants by site, the batch latest read and the stream shipped in November 2026
  ([the telemetry stream](features/integrations.md#the-telemetry-stream)). Two
  follow-ups once streams multiply: a dedicated streaming process (the relay holds one
  PHP-FPM worker per stream for up to an hour; move it out of the pool behind the same
  authentication), and multi-instance fan-out (the runtime's broadcaster is
  in-process; a second runtime instance needs the fan-out behind a JetStream consumer
  with a stored committed-sequence mapping so resume keeps working).

### Assistant

- A scope registry and generic conversation target instead of per-scope branches; a
  per-tool-call audit table; per-organization budgets.
- New read-only tool families: operations investigator (device status, recent
  measurements, alert episodes), dashboard drafts, geofences and sites.

### UI

- **Portal on phones** ([spec 033](../specs/033-pwa-web-push/spec.md),
  [ADR-047](adr/ADR-047-progressive-web-app-before-native-apps.md)): phone layouts
  for alerts, devices and dashboards, an installable app, push alerts that follow the
  bell, and **Keep me signed in**. Native apps wait for one of four triggers: Bluetooth
  provisioning from a phone, Critical Alerts, a store or managed install requirement,
  or iOS push without installing.
- **Smaller components.** Split the `App` shell (session, login, sidebar, recovery)
  and the largest components (`DashboardWorkspace`, `ConfigurationSection`,
  `Integrations`) into hooks and reducers.
- **Shared app foundation.** Portal and admin each have their own API factory,
  login, unsaved-changes guard and error helpers (already diverging); share them and
  move admin onto TanStack Query. Add query-key factories per feature.
- **Enforce the design system.** Ratchet `check-ui.mjs` on raw `text-*` sizes,
  local tone maps, raw `Table`/`Pagination` and `toLocale*` dates, and check that
  every kit component has a story.
- Finish migrating remaining form fields to the form kit.
- Motion left over: a sliding tab indicator and live-list row transitions.
- Server sorting for profiles, automations and gateways (the devices list shows the
  pattern: an allowlist, `meta.sort`, headers that enable on the echo).
- A `DraftBar` for device profiles; event-log tiles and segmented filters as
  `DataTable` views; ⌘K search for automations, profiles and gateways.
- Run the Storybook accessibility sweep in CI (`@storybook/addon-vitest`).
- `check-ui.mjs` suggests importing `Status` from `lib/status`, which only exports the
  type; point it at `components/status-mark`.

### Release hardening

- Pin the remaining third-party images by digest (actions are already pinned by
  commit SHA), add healthchecks for api, runtime, the broker and Caddy, and produce
  an SBOM with signed images.
- Make the release artifact include everything the release compose file mounts, so it
  deploys without a full checkout.

### Pilot operations

- Monitoring outside the hosting provider, plus the external monitoring and backup
  heartbeats ([monitoring](ops/monitoring.md#release-monitoring)).
- An agreed recovery point objective and, if daily checkpoints are not enough, WAL
  archiving and point-in-time recovery.
- A measured replacement-host cutover, a 48-hour soak, IPv6 verification, client
  hardware acceptance, and retiring `LEGACY_DOMAIN` ([pilot](ops/pilot.md#open-gaps)).

## Evolution

Scale by moving stable responsibilities into more processes and stores, without
changing public APIs, definition ownership or contracts merely because deployment
size changes.

| Evidence or requirement | Response |
| --- | --- |
| More API or assistant traffic | Scale stateless Laravel API and workers |
| Higher telemetry throughput | Partition runtime consumers by tenant, site or device group; this needs runtime fencing beyond the advisory lock, capture routing and per-partition state |
| Realtime connection pressure | A push channel (the portal polls today) behind a stable client event contract |
| Long-range or fleet analytics | ClickHouse with an idempotent sink from committed telemetry; TimescaleDB stays the operational store |
| Scheduled backfills and exports | A batch scheduler outside the live path; never for live ingestion or control |
| Complex relationship queries | A graph projection rebuilt from PostgreSQL, behind a domain interface |
| Many proprietary integrations | A native integration studio (visual pipeline, typed SDK, fixtures, sandboxed plugins) implementing the same adapter contract |
| Multiple edge sites or offline operation | An edge runtime with local broker, adapters, JetStream and execution, synchronizing selected configuration, events and rollups; raw telemetry stays local by default |
| Availability requirements | Managed services or highly available NATS and database topologies |
| Customer-managed clusters | Helm and Ansible-supported Kubernetes profiles ([ADR-006](adr/ADR-006-deployment-profiles.md)) |

AI capabilities may grow (sub-agents, retrieval, local inference, durable multi-step
workflows), but tool authorization, risk classification, approval and audit stay in
Laravel regardless of provider.

The original August 2026 plan is archived at
[archive/2026-10/plan](archive/2026-10/README.md).
