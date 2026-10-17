# Drift log: Public API Contract

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Format**: [data-model.md](data-model.md), section 7

Every place where real behaviour disagreed with a document, a client type or the
inferred contract, and how it was resolved. The platform is never changed to fit the
contract (FR-033): the contract, type or document is corrected, and a platform bug is
recorded for a separate change. Sources: `docs`, `api-client type`, `sdk type`,
`inference`.

## PR 2: statuses the suite produces

With response checks on, the PostgreSQL suite produced 56 statuses on 51
operations that the exported contract did not list. All are behaviour the code already
has; Scramble cannot see them because they come from code it does not evaluate:

- **409** from `abort(409)` or a conflict exception inside the action: a stale
  `revision`, `draft_revision` or `expected_revision`, an idempotency key reused for a
  different request, or a state that forbids the change. Device-profile drafts return
  `DraftConflictError` (`code: profile.draft_conflict`) through the exception renderer
  in `bootstrap/app.php`.
- **422** from validation in helper methods or `ValidationException`s thrown by the
  action (`ValidationError` with `errors`), or from `abort(422)` state rules, which
  carry a message only. The new shared `Unprocessable` response describes both shapes.
- **503** from `RuntimeClient` when the device runtime is unavailable, and from other
  dependencies (AI provider, broker, MQTT endpoint), described by the new shared
  `ServiceUnavailable` response; **504** when the runtime cuts off a long range read.
- Two success statuses decided by a ternary (`201` and `202`).

Only statuses the suite actually produced were added. The same `abort()` calls and
runtime errors exist on operations the suite does not exercise (for example 503 and 504
on the other runtime-backed range reads); they are added when their domain is described
and its tests reach them. All 51 operations are still pending, so only their statuses
are checked; their bodies are checked when their domain leaves the pending list.

| Operation | Source | Discrepancy | Resolution | Pull request |
| --- | --- | --- | --- | --- |
| `GET /integration/v1/organizations/{organization}/devices` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/integration.yaml` | spec 001 PR 2 |
| `GET /integration/v1/organizations/{organization}/devices/{uuid}/telemetry/latest` | inference | 503 when the device runtime is unavailable or fails | `503: RuntimeUnavailable` in `supplements/integration.yaml` | spec 001 PR 2 |
| `PUT /v1/admin/settings/telemetry-retention` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/platform-admin.yaml` | spec 001 PR 2 |
| `PUT /v1/notifications/preferences` | inference | 403 from a permission check in the action; 409 from a conflict check in the action | `403: Forbidden`; `409: Conflict` in `supplements/account.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/alerts/{alert}/comments` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/alerts/{alert}/deliveries/{delivery}/retry` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/applications` | inference | 422 with a message only (`abort(422)` for a state rule or limit) | `422: Unprocessable` in `supplements/applications.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/applications/{application}/token` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/applications.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/applications/{application}/webhook` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/applications.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/applications/{application}/webhook/deliveries/{delivery}/retry` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/applications.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/assistant/conversations/{conversation}/messages` | inference | 409 from a conflict check in the action; 503 when the assistant is disabled or its AI provider is unavailable | `409: Conflict`; `503: ServiceUnavailable` in `supplements/assistant.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/dashboards` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/dashboards.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/dashboards/{dashboard}` | inference | 409 from a conflict check in the action; 422 from validation inference cannot see | `409: Conflict`; `422: ValidationFailed` in `supplements/dashboards.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/dashboards/{dashboard}/revisions/{number}/restore` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/dashboards.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-adapters` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/device-adapters.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/device-adapters/{adapter}` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/device-adapters.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-adapters/{adapter}/proposals/{proposal}/decision` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/device-adapters.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-onboardings` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `DELETE /v1/organizations/{organization}/device-profiles/{profile}` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `PATCH /v1/organizations/{organization}/device-profiles/{profile}` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-profiles/{profile}/calculations` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-profiles/{profile}/compile` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/device-profiles/{profile}/group-order` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/device-profiles/{profile}/validate` | inference | 409 when the draft changed since it was read (`profile.draft_conflict`) | `409: DraftConflict` in `supplements/device-profiles.yaml` | spec 001 PR 2 |
| `PATCH /v1/organizations/{organization}/devices/{device}` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/archive` | inference | 422 with a message only (`abort(422)` for a state rule or limit) | `422: Unprocessable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/commands` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/commands/send` | inference | 409 from a conflict check in the action; 503 when the device runtime is unavailable or fails | `409: Conflict`; `503: RuntimeUnavailable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/commands/{command}/confirm` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/devices/{device}/configuration` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/connection-kit` | inference | 422 with a message only (`abort(422)` for a state rule or limit); 503 when the public MQTT TLS endpoint or its CA certificate is not configured | `422: Unprocessable`; `503: ServiceUnavailable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/lifecycle` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `GET /v1/organizations/{organization}/devices/{device}/measurements/history` | inference | 503 when the device runtime is unavailable or fails | `503: RuntimeUnavailable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `GET /v1/organizations/{organization}/devices/{device}/measurements/state-history` | inference | 504 when the runtime cuts off a range read that takes too long | `504: RangeTimeout` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/onboarding/provision` | inference | 202 while provisioning is unfinished, 200 once done; only 200 was inferred | `202` added in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/devices/{device}/validate` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/devices.yaml` | spec 001 PR 2 |
| `GET /v1/organizations/{organization}/discovery-candidates` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/gateways/{gateway}/provision` | inference | 503 when broker provisioning is not configured or fails | `503: ServiceUnavailable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/geofences/{geofence}` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/geospatial.yaml` | spec 001 PR 2 |
| `DELETE /v1/organizations/{organization}/invitations/{invitation}` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/administration.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/invitations/{invitation}/resend` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/administration.yaml` | spec 001 PR 2 |
| `DELETE /v1/organizations/{organization}/members/{member}` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/administration.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/sites` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/telemetry-captures/{capture}/diagnose` | inference | 503 when AI troubleshooting is disabled or unavailable | `503: ServiceUnavailable` in `supplements/devices.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/workflows` | inference | 422 from validation inference cannot see | `422: ValidationFailed` in `supplements/automation.yaml` | spec 001 PR 2 |
| `GET /v1/organizations/{organization}/workflows/dag/node-types` | inference | 503 when the device runtime is unavailable or fails | `503: RuntimeUnavailable` in `supplements/automation.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/workflows/{workflow}/deployments` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/workflows/{workflow}/layout` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/workflows/{workflow}/notifications` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |
| `POST /v1/organizations/{organization}/workflows/{workflow}/scenarios` | inference | Always 201 (the status comes from a ternary); only 200 was inferred, and that inferred 200 is never returned | `201` added; the stale 200 goes when Automation is described in `supplements/automation.yaml` | spec 001 PR 2 |
| `PUT /v1/organizations/{organization}/workflows/{workflow}/scenarios/{scenario}` | inference | 409 from a conflict check in the action | `409: Conflict` in `supplements/automation.yaml` | spec 001 PR 2 |

## PR 3: the integration API

All 18 integration operations are fully described in `supplements/integration.yaml` and
`supplements/integration-events.yaml` and left the pending list (247 → 229). Every
success response now has a golden example that `IntegrationContractTest` validates
against its schema, and every response the suite produces is checked against the
contract, headers included. Findings by kind:

- **Request rules inference missed (6 operations).** Rules read in helper methods:
  `pagination()` (`page` 1 to 100000, `per_page` 1 to 100), `window()`
  (`parameter_uuid`, `from`, `to`) and `input()` (the whole geofence body). Query
  parameters are described with Scramble `#[QueryParameter]` attributes on the actions
  (metadata only). The geofence body needs number bounds and a closed `geometry`
  object, which attributes cannot state, so it is a supplement `requestBody`; the
  export now refuses a supplement body where Scramble inferred one, so a supplement can
  never hide rules read from code.
- **Bodies inference got wrong or left open (18 operations).** Compact-page `meta`
  fields as strings, the location fix `data` as a string, telemetry items, geofence
  geometry and location-map devices open: all replaced by supplement schemas.
- **Statuses inference missed.** The device runtime's 503 and 504, conflicts from the
  geofence service, `abort(422)` with a message only, and the event feed's 409 for a
  grant change (inferred as an anonymous inline error, now the shared `GrantChanged`).
- **Runtime-shaped bodies.** The location fix `data` (`location-fix.v1`, referenced from
  `contracts/location/v1/fix.schema.json`) and the location-map device entries are
  described as returned and marked `x-runtime-shaped` on their responses.
- **Test fakes that did not match the runtime.** `ApplicationTest`'s latest-telemetry,
  records and location-fix fakes returned fragments the runtime never sends (readings
  without `key`, `label`, `observed_at`; records `meta` with 2 of its 9 fields; a fix
  that was `[]`), and its location-binding fixture had 3 of the 14 binding fields. They
  now return the runtime's fields and the `contracts/location/v1` golden fixtures; no
  expected response changed.

| Operation | Source | Discrepancy | Resolution | Pull request |
| --- | --- | --- | --- | --- |
| `GET /integration/v1/organizations/{organization}/devices` | inference | `page` missing and `per_page` unbounded (rules in `pagination()`) | `#[QueryParameter]` attributes on `ReadController::devices` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/alerts` | inference | `page` missing and `per_page` unbounded (rules in `pagination()`) | `#[QueryParameter]` attributes on `ReadController::alerts` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/devices/{uuid}/telemetry/history` | inference | Required `parameter_uuid`, `from`, `to` missing (rules in `window()`); 503 and 504 from the runtime missing | Attributes on `TelemetryController::history`; `503: RuntimeUnavailable`, `504: RangeTimeout` in `supplements/integration.yaml` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/devices/{uuid}/telemetry/records` | inference | Required `parameter_uuid`, `from`, `to` missing (rules in `window()`); 503 missing | Attributes on `TelemetryController::records`; `503: RuntimeUnavailable` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/devices/{uuid}/locations/{event}` | inference | `data` inferred as a string; 503 missing | `data` references `location/v1/fix.schema.json`, `x-runtime-shaped`; `503: RuntimeUnavailable` | spec 001 PR 3 |
| `POST /integration/v1/organizations/{organization}/location-map/query` | inference | Device entries open; 503 missing | `LocationMapDevice` (runtime fields plus the four the control plane adds), `x-runtime-shaped`; `503: RuntimeUnavailable` | spec 001 PR 3 |
| `POST /integration/v1/organizations/{organization}/geofences` | inference | No request body (rules in `input()`); 409, 422 (message or field errors) and 503 missing | `GeofenceInput` request body in the supplement; `409: Conflict`, `422: Unprocessable`, `503: RuntimeUnavailable` | spec 001 PR 3 |
| `PUT /integration/v1/organizations/{organization}/geofences/{uuid}` | inference | No request body (rules in `input()`); 409, 422 and 503 missing | As for `POST geofences` | spec 001 PR 3 |
| `POST /integration/v1/organizations/{organization}/geofences/{uuid}/activations/{batch}/items/{item}/retry` | inference | 409 (item not failed) and 422 (runtime rejection) missing | `409: Conflict`, `422: ValidationFailed` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/events` | inference | 409 inferred as an anonymous inline error; 422 described as field errors only, but `abort(422)` for an unreadable or foreign cursor returns a message only | `409: GrantChanged`; `422: Unprocessable` | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/events` | sdk type | `IntegrationEvent.type` lacks `automation.triggered.v1`, which the platform emits | Contract lists all eight types; the SDK accepts `automation.triggered.v1` with a hand-written type until PR 5 takes the types from the contract | spec 001 PR 3 (SDK: PR 5) |
| `POST /integration/v1/organizations/{organization}/location-map/query` | sdk type | `LocationMapSnapshot.geofence` typed as a full `Geofence`; the platform returns `{uuid, name, geometry, revision}`. Device entries lack `geometry`, `wandering`, `active_alert`, `assignment_status` and `deployment_status` | Contract follows the platform; SDK types generated from it in PR 5 | spec 001 PR 3 (SDK: PR 5) |
| `GET /integration/v1/organizations/{organization}/geofences/{uuid}/activations/{batch}` | sdk type | `GeofenceActivationBatch` lacks `created_at` and `updated_at`; item `target` typed `string` (the platform sends `active` or `inactive`) | Contract follows the platform; SDK types generated from it in PR 5 | spec 001 PR 3 (SDK: PR 5) |
| `POST /integration/v1/organizations/{organization}/geofences` | sdk type | `GeofenceInput.expected_revision` required; the platform defaults it (0 on create, the current revision on update) | Contract marks it optional with its defaults; SDK types generated in PR 5 | spec 001 PR 3 (SDK: PR 5) |
| `GET /integration/v1/organizations/{organization}/devices/{uuid}/telemetry/history` | docs | Spec acceptance scenario 1 and `docs/features/integrations.md` list 503 but not 504; the runtime returns 504 for a range cut off at its limit and Laravel passes it on | Contract lists both; integrations doc corrected | spec 001 PR 3 |
| `GET /integration/v1/organizations/{organization}/geofences` | docs | `docs/features/integrations.md` says lists return `{data, meta}`; the geofence list is not paginated and is ordered by name | Contract describes `{data}`; integrations doc corrected | spec 001 PR 3 |

### Platform issues found, not fixed (FR-033)

Recorded for separate changes; the contract describes today's behaviour.

1. **A runtime rejection during geofence activation escapes after the save.**
   `GeofenceService::dispatch()` catches `HttpExceptionInterface` only. When the runtime
   rejects the activation snapshot with 422, `RuntimeClient` throws a
   `ValidationException`, which escapes after the geofence and batch were committed: the
   client gets 422 for a saved geofence, the remaining items are never dispatched and
   stay `pending`, and a pending item cannot be retried (retry needs `failed`). A
   `ModelNotFoundException` (for example a bound device that no longer exists) escapes
   the same way as 404. Affects
   `POST geofences`, `PUT geofences/{uuid}` and the item retry, in the integration and
   tenant APIs.
2. **Numeric strings pass the geofence rules.** `numeric` and `integer` accept `"51.0"`
   and `"1"`, which are stored and returned as strings, so a geofence saved that way
   returns string coordinates, unlike the contract's numbers. A string
   `expected_revision` also fails the strict revision comparison and returns 409 for a
   current revision. First-party clients and the SDK send numbers.

## Later changes

Statuses found after spec 001 by tests that exercise an operation for the first time.

| Operation | Source | Discrepancy | Resolution | Pull request |
| --- | --- | --- | --- | --- |
| `DELETE /v1/organizations/{organization}/roles/{role}` | inference | 422 missing: `OrganizationRoleManager::delete` refuses a built-in role, a role a member holds and a role on a pending invitation | `422: ValidationFailed` in `supplements/administration.yaml` | spec 005 |
