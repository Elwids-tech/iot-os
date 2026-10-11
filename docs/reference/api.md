# API surface

The Laravel API is the only public API ([ADR-002](../adr/ADR-002-laravel-control-plane.md)).
There is **no OpenAPI description**; routes live with their domain in
`apps/api/app/Domain/*/routes*`, loaded from
[`apps/api/routes/api.php`](../../apps/api/routes/api.php) (all under `/api`), and
the TypeScript client [`packages/api-client`](../../packages/api-client) is written
by hand. Feature pages document endpoints in detail; this page maps the groups.

## Route groups

| Prefix | Who calls it | Authentication | Details |
| --- | --- | --- | --- |
| `/api/v1/auth/*`, `/api/v1/me` | Portal, admin | Session (`auth:sanctum`, stateful) | [access](../features/access.md#signing-in) |
| `/api/v1/invitations/{token}` | Invitees | None (token in path) | [access](../features/access.md#in-the-portal) |
| `/api/v1/organizations/{organization}/…` | Portal | Session + organization membership (`ResolveOrganizationContext`: 404 unknown, 403 non-member) + permission | Per domain, below |
| `/api/v1/admin/…` | Admin | Session + `PlatformAdministration.*` | [access](../features/access.md#platform-administration) |
| `/api/v1/units`, `/api/v1/notifications/…` | Portal | Session | Unit catalogue; personal email preferences and event log |
| `/api/integration/v1/organizations/{organization}/…` | External applications | Application bearer token with the route's ability (`AuthenticateApplication`) | [integrations](../features/integrations.md#integration-api) |
| `/api/internal/devices/…` | Go runtime | `DEVICE_RUNTIME_TOKEN` bearer (`AuthenticateDeviceRuntime`) | [events](events.md) |
| `/api/internal/notifications/…` | Alertmanager, watchdog | `NOTIFICATION_INGEST_TOKEN` bearer | [alerts](../features/alerts.md#monitoring-ingest) |
| `/api/internal/adapters/events` | Tenant adapter runtimes | `X-Adapter-Tenant` + per-tenant runtime token | [adapters](../features/adapters.md) |
| `/up` | Load balancers | None | Liveness |
| `/health/ready` | Monitoring | None (404 unless operations are enabled) | Database and runtime readiness |
| `/internal/ops/metrics` | Prometheus | `IOT_METRICS_TOKEN` bearer | Operations metrics; blocked at public ingress |

### Organization routes by domain

| Path segment | Domain | Feature |
| --- | --- | --- |
| `devices`, `device-onboardings`, `sites`, `settings/timezone`, `sparkplug-connections`, `gateways`, `discovery-candidates`, `telemetry-captures`, `runtime-status` | `Devices` | [devices](../features/devices.md#api) |
| `device-profiles` | `DeviceProfiles` | [device profiles](../features/device-profiles.md#api) |
| `device-adapters`, `device-adapter-profiles` | `DeviceAdapters` | [adapters](../features/adapters.md#api-and-permissions) |
| `workflows`, `workflows/dag/…` | `Automation` | [automation](../features/automation.md#api) |
| `alerts` | `Automation` | [alerts](../features/alerts.md#api) |
| `location-bindings`, `location-map/query`, `geofences` | `Geospatial` | [automation](../features/automation.md#geofences-and-location) |
| `dashboards`, `dashboard-share-targets` | `Dashboards` | [dashboards](../features/dashboards.md#api) |
| `applications` | `Integrations` | [integrations](../features/integrations.md#managing-applications) |
| `assistant`, `help` | `Assistant`, `Help` | [assistant](../features/assistant.md#api) |
| `members`, `roles`, `role-permissions`, `invitations`, `administration` | `Administration` | [access](../features/access.md#api) |
| `context` | `Authentication` | Organization capabilities for the UI |
| `overview` | `Overview` | Home page counts |

## Conventions

- **Identifiers.** Resources are addressed by UUID in paths and payloads; route
  constraints reject malformed UUIDs with 404. Users are the exception: integer
  ids ([ADR-013](../adr/ADR-013-integer-user-ids.md)).
- **Tenancy.** Every organization route resolves the organization from the path
  and checks membership before any permission. A resource from another
  organization returns 404.
- **Optimistic concurrency.** Editable documents carry `revision` or
  `draft_revision`; a stale write returns 409 and changes nothing.
- **Asynchronous operations.** Anything the runtime must apply (device lifecycle,
  workflow deployment, adapter deployment, geofence activation) returns 202 with an
  operation the client polls; a client-supplied operation or request UUID makes
  retries idempotent, and reusing it for a different request returns 409.
- **Errors.** 401 unauthenticated, 403 forbidden, 404 not found or not visible, 409
  conflict, 422 validation (field errors), 429 rate limited with `Retry-After`, 503
  runtime unavailable.
- **Pagination.** `page` and `per_page` (usually up to 100), returning
  `{data, meta: {current_page, last_page, total}}`; some feeds use opaque cursors.
- **Capabilities.** `GET /api/v1/me` and the organization context return
  capability flags the UI uses to show or hide features. They are hints; the API
  enforces permissions itself.
- **Rate limits.** Login has no throttle. Password recovery, invitations,
  onboarding, telemetry captures, assistant messages, adapter tests and deploys,
  application management (30/min) and the integration API (60/min per application,
  240/min per IP) are throttled per route.

## Internal runtime API

The Go runtime serves its own internal HTTP API on `IOT_RUNTIME_HTTP_ADDRESS`
(default `:8081`) ([`internal/app/http.go`](../../services/runtime/internal/app/http.go)).
`/health/live` and `/health/ready` are open; everything under `/internal/` needs
the `DEVICE_RUNTIME_TOKEN` bearer: measurements (latest, history, records, state
history, increase), telemetry captures, configuration validation and command checks,
location resolve/read/map, rule and workflow compile, simulate and execution, DAG
registry, compile, simulate, execution, timeline and health, committed-telemetry
status, `/internal/status` and checkpoint rebaseline. Only Laravel
([`RuntimeClient`](../../apps/api/app/Domain/Devices/Services/RuntimeClient.php))
calls it. Never expose it publicly.
