# Organization dashboards

The tenant portal supports multiple organization-shared dashboards at `/organizations/:organizationUuid/dashboards`, each with a direct detail URL. Existing `Device.view` and `Device.manage` capabilities govern access and editing.

## Editing

Create a named dashboard, enter **Edit dashboard**, and add Status or Time series panels. A panel has a title, description, and ordered device-parameter sources. The editor groups Panel, Data, Display, and Thresholds settings beside a preview. Parameter choices come from applied (or last-applied) immutable configuration definitions, not the latest measurements.

**Apply to dashboard** changes the local draft. Only **Save dashboard** persists widgets, layout, name, and viewing defaults. Resize/drag events never issue a save. Navigation offers save, discard, or stay; revision conflicts keep the draft. A panel can be duplicated, removed from the draft, or viewed fullscreen. Cancel restores the saved dashboard.

Status thresholds are per-source numeric lower bounds, with an explicit Base band below the first boundary. Lower bounds are inclusive; the next boundary is exclusive. Operators can add/remove bands and explicitly replace selected sources' rules using Copy thresholds. Simulation changes the preview only. Thresholds are display rules, not alarms or telemetry conversions.

## Latest versus history

- Status panels show the latest available value regardless of the chart range, with platform receipt time and quality. When an invalid sample retains a previous valid value, `last_valid_received_at` identifies that value's receipt separately from the diagnostic receipt. Inactive or stale readings do not receive healthy threshold colours.
- Time series panels use the existing receipt-time history API. Values are bucket averages, not raw samples. Configuration versions are separate lines, gaps remain gaps, and incompatible unit/data-type segments are excluded with a warning. Sources in one chart must share a numeric unit.
- The time picker supports relative presets, fixed absolute bounds, browser time or UTC, previous/next intervals, zoom out, plot zoom, and manual refresh. Relative charts advance with refresh; absolute charts re-query only on explicit viewing changes or manual refresh. Status continues its independent latest-value polling.
- Viewing state uses `range` or `from`/`to`, `timezone`, and `refresh` URL parameters. Reload/back/forward restore it. Changing viewing state does not save shared defaults; **Use current time settings as defaults** changes those defaults in the edit draft only. New dashboards default to last 6 hours, browser timezone, and 5-second refresh. Absolute requests are limited to 90 days and effective device retention may be shorter.

## Contracts and compatibility

Dashboard updates require the current `revision` plus the full editable document. A locked transactional update increments revision; stale updates receive HTTP 409. Widget configuration uses `schema_version: 2`; the registry declares latest/range behavior, renderer, and editor family. Sources and layout identifiers are validated within the organization.

Legacy Status documents normalize on read without database writes. Existing IDs, layout, shared thresholds, and the neutral below-range band are preserved; shared rules become per-source rules on the next explicit save. Missing responsive layouts are derived from the desktop layout without modifying saved breakpoints.

No legacy GridStack migration, other legacy widget types, alarm-engine changes, or telemetry editing are included.

## Verification

Run the dashboard API feature tests with disposable SQLite (`php artisan test --filter=DashboardTest`), portal Vitest tests, and runtime Go tests. `apps/portal/e2e/dashboards.spec.ts` tests the real UI with isolated network fixtures; it does not alter production telemetry or dashboard records. Run it against the served portal with `STUDIO_BASE_URL=http://localhost:5173` after rebuilding affected containers, then separately verify the connected application using real device data.
