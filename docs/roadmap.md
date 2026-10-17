# Roadmap

Two parts: **Next**, the known open work (each item is a candidate Spec Kit spec), and
**Evolution**, options we keep open for when evidence demands them. Nothing here is
built unless the feature docs say so.

## Next

Grouped by area. Links point at the decision or doc that explains the item.

### Platform and runtime

- **Broker defaults.** Make `mosquitto` the default `DEVICE_BROKER_PROVIDER` in
  `apps/api/config/devices.php`, `deploy/release/environment.example`,
  `tooling/release/manage.py` and `deploy/release/compose.yml`, to match the release
  adapter worker, which already defaults to it
  ([ADR-009](adr/ADR-009-mosquitto-default-broker.md)).
- **Mosquitto in development.** Replace EMQX in the local stack so development and
  release run the same broker ([ADR-009](adr/ADR-009-mosquitto-default-broker.md)).
- **Incremental runtime state.** Replace the 30-second full-fleet
  `GET /internal/devices/state` poll with per-organization or change-based
  reconciliation, and raise the control-claim throughput
  ([ADR-014](adr/ADR-014-control-plane-data-plane-http-integration.md)).
- **Unused activation records.** `device_profile_activation_outbox` is written on
  every publish and never read; remove it or give it a consumer. Profile
  `TransportBinding` records feed only the device mapping suggestions, not the
  runtime.
- **Retention for journals.** Coordinated retention for the integration event journal
  (with a retention floor and 410 contract), webhook deliveries, alert comments,
  deliveries and attempts, the runtime's `rule_transitions` and `dag_intents`, and
  the device audit tables (a product decision).
- **Heartbeat writes.** Each runtime heartbeat (every 10 s) updates every device and
  gateway row's `runtime_seen_at`; store one runtime status instead.
- **Runtime throughput (measure first).** The ingest path publishes synchronously
  inside the MQTT callback, holds one global lock and runs as a single instance
  (advisory lock). Measure the ceiling with the simulators, then pipeline it with
  per-device subjects and sharded state.
- **Typed runtime events.** Give the internal runtime events JSON Schemas in
  `contracts/` and validate them on both sides instead of untyped maps.
- **Unused infrastructure.** Redis, MinIO and the stock Node-RED service run in the
  development stack but nothing uses them; remove them or adopt them deliberately.

### Control plane

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

### Security

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
  the Alerts workflow filter, the dashboard alert picker and Settings → Notifications
  list DAG workflows ([ADR-011](adr/ADR-011-dag-automation-in-go.md)).
- **Notification policies** (requirement-led): reminders, cooldowns, escalation,
  SMS or push.

### Devices and adapters

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

- **Kiosk displays and public links** that show a published revision through
  server-resolved queries.
- **Server-side panel queries** instead of per-panel client polling.
- **Dashboard assistant** to draft panels and dashboards.

### Integrations

- **OpenAPI ([spec 001](../specs/001-openapi-contract/spec.md)).** The contract is
  generated from Laravel, CI checks it for drift, and the test suite checks responses
  against it. The integration API is fully described. Still to do: describe the
  operations left in `contracts/openapi/pending-schemas.json`, add a breaking-change
  gate, generate `packages/api-client` and the SDK types from the contract, and
  publish the reference.
- **Pilot quotas and load tests** for the event feed, webhooks and telemetry reads.

### Assistant

- A scope registry and generic conversation target instead of per-scope branches; a
  per-tool-call audit table; per-organization budgets.
- New read-only tool families: operations investigator (device status, recent
  measurements, alert episodes), dashboard drafts, geofences and sites.

### UI

- **Error boundaries.** A render error or a failed chunk load after a deploy blanks
  the whole app; add route error elements and reload on `vite:preloadError`.
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
