# Workflow dashboard panels

Organization dashboards now include **Location** and **Alerts** panels. Select a workflow in the searchable picker, check the live preview, apply it to the dashboard draft, then save. The existing dashboard owns the saved layout and revision. Manual refresh and the dashboard refresh interval update these panels; historical time ranges do not change their live data.

Location follows the workflow's applied deployment and its pinned device/location binding. It displays a geofence outline, paired coordinates, observation/receipt times, age, reported accuracy and rule condition. The outline is a local projection, not a basemap. A draft without an applied deployment has an explicit empty state.

The runtime reads the newest stored committed device event within tenant retention. A newer incomplete or invalid event never falls back to an earlier good location. Missing, stale, invalid, stopped or unavailable evidence does not imply a safe location. Unknown accuracy stays unknown. Cached fixes expire even when automatic refresh is paused. Historical fixes are labelled historical and never establish current rule condition. Condition is only shown when the fresh execution state references the same current fix event. Runtime errors hide cached location and offer retry.

Alerts are read independently from durable alert episodes. Counts distinguish active conditions from active unacknowledged episodes; acknowledgement does not clear a condition. The latest ten episodes link to existing alert details. Location runtime failure does not erase alert counts.

## API and reusable boundary

Human-authenticated, organization-scoped device-view access protects:

- `GET /api/v1/organizations/{organization}/workflows/{workflow}/location-overview`
- `GET /api/v1/organizations/{organization}/workflows/{workflow}/alert-overview`

Dashboard writes validate same-organization workflow references. These panel types use schema version 2 with `config: { sources: [], workflow_uuid: "..." }`. Parameter panels continue to require parameter sources.

`@iot-os/ui/components/workflow-overview` exports data-injected LocationOverview and AlertOverview components. They have no portal, API-client, router or session imports. The host supplies typed data, time, timezone and optional episode navigation. Portal adapters own authorization, requests and polling. A third-party backend must use its authorized integration APIs and an adapter; these human overview endpoints are not new machine SDK endpoints. Shared styling still needs host configuration.

`node tooling/verify-workflow-components.mjs` bundles and renders an independent host to prove this presentation boundary. It does not publish a package or ship a complete third-party dashboard editor. External dashboard documents should have one explicit owner; this slice keeps portal documents core-owned.

## Verification

API feature tests cover tenant isolation, workflow panel validation and alert counts. Portal unit tests cover freshness, historical fixes, execution mismatch and stopped state. Dashboard browser tests exercise preview, apply/save/reload, manual refresh, unavailable-state retry, mobile keyboard controls and accessibility alongside existing dashboard regressions. Runtime database tests cover newest-event selection and tenant isolation.

For a real local check, copy `tooling/verify-integration-sdk.php` into the API container and run it with `IOT_VERIFY_TELEMETRY=1 IOT_VERIFY_DASHBOARD=1`. Copy its private `/tmp/iot-sdk-fixture.json` locally, then run `node tooling/verify-workflow-dashboard.mjs` while the fixture is waiting. Touch `/tmp/iot-sdk-release` in the container afterwards and remove the host JSON. The fixture inserts already-published telemetry and a disabled execution: it sends no hardware commands or live rule actions. It removes its temporary dashboard, workflow, alert, telemetry and credentials on exit.

Production load, outbox retention/cleanup, pilot quotas, public UI package distribution and real-tag acceptance remain pending. Visual workflow editing remains deferred.
