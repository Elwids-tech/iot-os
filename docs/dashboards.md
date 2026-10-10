# Organization dashboards

[Location and Alerts panels](workflow-dashboard-panels.md) show applied workflow location evidence and durable alert episodes. They use live state independently of the historical chart time range.

Reusable [device Controls panels](device-controls.md) are also available alongside Status and Time series. They follow reported state and send direct commands when outside dashboard editing.

The tenant portal supports multiple organization-shared dashboards at `/organizations/:organizationUuid/dashboards`, each with a direct detail URL. Existing `Device.view` and `Device.manage` capabilities govern access and editing.

## Editing

Create a named dashboard, enter **Edit dashboard**, and add Status or Time series panels. A panel has a title, description, and ordered device-parameter sources. The editor groups Panel, Data, Display, and Thresholds settings beside a preview. Parameter choices come from applied (or last-applied) immutable configuration definitions, not the latest measurements.

**Apply to dashboard** changes the local draft. Only **Save dashboard** persists widgets, layout, name, and viewing defaults. Resize/drag events never issue a save. Navigation offers save, discard, or stay; revision conflicts keep the draft. A panel can be duplicated, removed from the draft, or viewed fullscreen. Cancel restores the saved dashboard.

Status thresholds are per-source numeric lower bounds, with an explicit Base band below the first boundary. Lower bounds are inclusive; the next boundary is exclusive. Operators can add/remove bands and explicitly replace selected sources' rules using Copy thresholds. Simulation changes the preview only. Thresholds are display rules, not alarms or telemetry conversions.

## Latest versus history

- Status panels show the latest available value regardless of the chart range, with platform receipt time and quality. When an invalid sample retains a previous valid value, `last_valid_received_at` identifies that value's receipt separately from the diagnostic receipt. Inactive or stale readings do not receive healthy threshold colours.
- Time series panels use the existing receipt-time history API. Values are bucket averages, not raw samples. Configuration versions are separate lines, gaps remain gaps, and incompatible unit/data-type segments are excluded with a warning. Sources in one chart must share a numeric unit.
- The time picker supports relative presets, fixed absolute bounds, browser time or UTC, previous/next intervals, zoom out, plot zoom, and manual refresh. Relative charts advance with refresh; absolute charts re-query only on explicit viewing changes or manual refresh. Status continues its independent latest-value polling.
- Viewing state uses `range` or `from`/`to`, `timezone`, and `refresh` URL parameters. Reload/back/forward restore it. Changing viewing state does not save shared defaults; **Use current time settings as defaults** changes those defaults in the edit draft only. New dashboards default to last 6 hours, browser timezone, and 5-second refresh. Absolute requests are limited to 400 days, matching the default retention; effective device retention may be shorter.

## Contracts and compatibility

Dashboard updates require the current `revision` plus the full editable document. A locked transactional update increments revision; stale updates receive HTTP 409. Widget configuration uses `schema_version: 2`; the registry declares latest/range behavior, renderer, and editor family. Sources and layout identifiers are validated within the organization.

Legacy Status documents normalize on read without database writes. Existing IDs, layout, shared thresholds, and the neutral below-range band are preserved; shared rules become per-source rules on the next explicit save. Missing responsive layouts are derived from the desktop layout without modifying saved breakpoints.

No legacy GridStack migration, other legacy widget types, alarm-engine changes, or telemetry editing are included.

## Library and history

All routes sit under `v1/organizations/{org}/dashboards`. Reads need `Device.view`; writes need `Device.manage`. A dashboard from another organization returns 404.

- List and show return `tags` (up to 10, 1 to 32 characters, trimmed, case-insensitive duplicates dropped), `folder` (up to 60 characters, empty becomes `null`), `created_by_name`, `updated_by_name`, and the current user's `starred` and `last_viewed_at`.
- `PUT {id}` accepts optional `tags` and `folder`; omitted values stay unchanged.
- `PUT {id}/star` `{starred}` stores the current user's star. `Device.view` is enough, and the revision does not change.
- `GET {id}` records `last_viewed_at` for the current user. It never changes the dashboard's revision or `updated_at`.
- Create, update, duplicate, and restore store a snapshot. The latest 50 per dashboard are kept. `GET {id}/revisions` lists `{revision, name, widget_count, updated_by_name, created_at}`, newest first. `GET {id}/revisions/{n}` returns the full snapshot.
- `POST {id}/revisions/{n}/restore` `{revision}` writes the snapshot as a new revision. It uses the current `revision` check (409 when stale) and the update validation, so sources that no longer belong to the organization are rejected.
- `POST {id}/duplicate` `{name}` copies widgets, layouts, defaults, tags, and folder into a new dashboard at revision 1.

## Panel types

| Type | Config |
|---|---|
| `gauge` | `min` below `max`, 1 to 4 numeric `sources` |
| `table` | 1 to 100 `sources` of any data type |
| `text` | `text` up to 4000 characters, `sources: []`. Stored as plain text, so render it as text, not HTML |
| `device_health` | `devices: [{device_uuid, device_name}]`, 1 to 50 devices in the organization, `sources: []`. The server sets `device_name` |

Each type accepts only its own config keys. Existing types keep `sources`, `columns`, and `workflow_uuid`.

## Portal view

- The library at `/dashboards` keeps its view, folder, search, tag, device and sort filters in the URL. "Created by me" matches `created_by` against the signed-in user's id.
- The panel editor opens at `?edit-panel=<panel id>` on the dashboard URL. Back returns to edit mode with the draft kept.
- Kiosk hides the shell and enlarges values; Esc exits. It is client-only and writes nothing.
- The context rail (active alerts, recent commands, device presence) is closed by default and remembered per browser. It polls every 30 s. Acknowledge in the rail is an explicit action that needs `Device.manage`; opening the rail writes nothing.
- A status panel's Cells or Table view is a per-browser preference, not part of the dashboard definition.
- Time-series charts draw alert episodes and device commands for the range, and Compare adds the previous period as ghost lines. Download CSV exports the loaded data; text cells that start with `=`, `+`, `-` or `@` are neutralized.

## Verification

Run the dashboard API feature tests with disposable SQLite (`php artisan test --filter=DashboardTest`), portal Vitest tests, and runtime Go tests. `apps/portal/e2e/dashboards.spec.ts` tests the real UI with isolated network fixtures; it does not alter production telemetry or dashboard records. Run it against the served portal with `STUDIO_BASE_URL=http://localhost:5173` after rebuilding affected containers, then separately verify the connected application using real device data.
