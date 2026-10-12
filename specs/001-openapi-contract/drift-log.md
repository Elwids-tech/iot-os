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
