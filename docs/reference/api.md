# API surface

The Laravel API is the only public API ([ADR-002](../adr/ADR-002-laravel-control-plane.md)).
Routes live with their domain in `apps/api/app/Domain/*/routes*`, loaded from
[`apps/api/routes/api.php`](../../apps/api/routes/api.php) (all under `/api`). The
[contract](#contract) describes `/api/v1` and `/api/integration/v1` operation by
operation; the TypeScript client [`packages/api-client`](../../packages/api-client) is
still written by hand. Feature pages document endpoints in detail; this page maps the
groups.

## Contract

[`contracts/openapi/openapi.json`](../../contracts/openapi) is the OpenAPI 3.1
description of every operation under `/api/v1` and `/api/integration/v1`
([ADR-016](../adr/ADR-016-public-api-contract.md)). `/api/internal` and the routes
outside `/api` are not in it. Each operation states its parameters and path
constraints, request body, status codes, security scheme (`session` or
`applicationToken`), `x-audience`, integration abilities, organization scoping,
platform permission and rate limits
([extensions](../../specs/001-openapi-contract/contracts/openapi-extensions.md)).

- **Generated, never edited by hand.** `cd apps/api && php artisan contract:export`
  rebuilds it from the routes, validation rules and resources (Scramble) plus the
  hand-written supplements in `contracts/openapi/supplements/`. Run it after changing a
  route, middleware, validation rule or resource, and commit the result with the code.
- **Pending bodies.** Operations listed in `contracts/openapi/pending-schemas.json` have
  open success bodies (`x-schema-status: pending`); everything else about them is
  described. The list only shrinks: a new operation needs a described response, either
  inferred or in a supplement. The 18 integration operations are fully described, each
  success response with an example, and can never be listed.
- **Checked in CI** (API job): `php artisan contract:export --check` fails when the
  committed file is not a fresh export, `php artisan contract:check --base=origin/main`
  fails on an undescribed body or a longer pending list, and
  `tests/Feature/Contract/RouteInventoryTest.php` fails when routes and operations
  disagree.
- **Real responses are checked.** Every response the PHP suite receives from these
  routes must have a documented status; for an operation that is not pending, its
  required headers and its JSON body must match the contract too. A mismatch fails
  the test that made the request. `php artisan contract:coverage`, run after the
  suite, fails when a required status was never checked (a success response for
  every fully described operation; a success, 401, 403, 404 and, with input, 422 for
  every integration operation). Details and the opt-out are in
  [testing](../dev/testing.md#api-contract-checks). A difference
  is resolved in the contract, never by changing the platform, and recorded in the
  [drift log](../../specs/001-openapi-contract/drift-log.md).

The workflow for changing an endpoint is in the
[spec 001 quickstart](../../specs/001-openapi-contract/quickstart.md#part-a-adding-or-changing-an-endpoint);
the steps for generated types and breaking-change checks arrive with later spec 001
pull requests.

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
- **Rate limits.** Sign-in (5/min per account and address, 30/min per address),
  password recovery, invitations, onboarding, telemetry captures, assistant
  messages, adapter tests and deploys, application management (30/min) and the
  integration API (60/min per application, 240/min per IP) are throttled per route.
  The contract lists each operation's limits in `x-rate-limits`.

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
