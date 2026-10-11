# Organization dashboards

[Location and Alerts panels](workflow-dashboard-panels.md) show applied workflow location evidence and durable alert episodes. They use live state independently of the historical chart time range.

Reusable [device Controls panels](device-controls.md) are also available alongside Status and Time series. They follow reported state and send direct commands when outside dashboard editing.

The tenant portal supports multiple organization-shared dashboards at `/organizations/:organizationUuid/dashboards`, each with a direct detail URL. Existing `Device.view` and `Device.manage` capabilities govern access and editing.

## Editing

Create a named dashboard, enter **Edit dashboard**, and choose **Add panel**. A panel has a title, description, and ordered device-parameter sources. The editor groups Panel, Data, Display, and Thresholds settings beside a preview. Parameter choices come from applied (or last-applied) immutable configuration definitions, not the latest measurements.

### Adding panels

**Add panel** starts from data, not from a panel type. Search devices, expand one, and tick its parameters; each shows its kind, unit, and current value. Up to three suggestions then render live with that data. **Add panel** places a suggestion as it is; **Customize** opens it in the editor. The **Visualization** picker lists every other type, and panels that need no parameters (Device health, GPS map, Alerts, Text) open the editor directly.

Suggestions are deterministic (`apps/portal/src/dashboards/suggest.ts`) and follow the profile:

- A single parameter's `display.visualization` hint wins.
- Writable parameters lead with Controls.
- Boolean and enum parameters suggest Status, then State history. Colour parameters suggest Status, then Colour history.
- A numeric parameter with a range suggests a gauge using that range. The range comes from `display.min`/`display.max`, else the validation limits, else 0–100 for `%`. Counters are never suggested as gauges.
- Several numeric parameters with one unit suggest a single Time series. Mixed units fall back to Status or Table, because a chart never mixes units.

The picker disables types that cannot show the selected data and gives the reason, for example "Needs parameters with one unit."

In the editor, the **Visualization** control replaces the old row of panel types. Switching keeps the sources when the new type can show them. Otherwise it asks before removing them.

From a device page, **Add to dashboard** (header) or the dashboard icon on a reading row (Overview and Measurements) opens the same suggestions for that device's parameters, with the row's parameter preselected.

### Profile display hints

Panels read display hints from the applied profile when they render, so a profile change applies to existing panels:

- State labels and tones (`display.states`) name values in Status, Table, and State history panels. Status shows the label in place of the raw value.
- Each Status panel has one freshness line: **Live** with the newest receipt time, or **Stale** / "N of M stale" with the last valid value's receipt time, an offline device, and a shared diagnostic. Cells show only each value's age; hovering gives the details.
- A Time series with no data in the range shows how long ago the last reading arrived and offers **Show last reading**. That moves the range to end just after the reading and keeps the same span, with a minimum of one hour.

### Consumption

Consumption panels show counter usage as bars per 15 minutes, hour, day, week or month. They use the counter increase endpoint (`GET devices/{device}/measurements/increase`), so meter resets and rollovers are counted correctly and noted on the panel.

- **Period** is either the dashboard time range or a calendar period: Today (hourly), Last 7 days (daily), This month (daily), or Last 12 months (monthly). Calendar periods ignore the dashboard range.
- **Bars** applies to the dashboard range. Automatic gives about 4 to 60 bars. A fixed size that would draw more than 120 bars falls back to automatic, and the panel says so.
- Days, weeks (from Monday) and months start at midnight in the device's reporting time zone: its site's, else the organization's, else UTC. Device details return it as `reporting_timezone`. Every viewer sees the same totals, and the panel names the zone. Hours in the dashboard range read in the viewer's zone.
- A bucket still counting, or one that starts before the range, is drawn hatched and labelled partial. Buckets without readings stay empty rather than showing zero.
- One counter shows its total for the period above the bars. Several counters (up to 4, one unit) draw side by side, with a legend of totals; totals are never summed across counters, since sub-meters often overlap.
- Clicking a bar in the dashboard range zooms the range to that bucket.
- The panel suggests itself for counter parameters and for profiles whose `display.visualization` is `consumption`. Profile-generated dashboards and the energy template use it for counters.

Every chart in the portal is drawn with Apache ECharts 6 through `packages/charts`: one React wrapper (`EChart`), the SVG renderer, and a theme bridge that resolves design tokens (skins, light and dark) to concrete colours. Recharts is gone. Panels build their options with shared builders, so dashboards and device pages look and behave the same:

- `timeSeriesOption`: Time series panels, device history and the device trend chart. Threshold bands are shaded (when the sources share one set of thresholds) under dashed threshold lines; alert episodes are shaded across the plot and commands are dotted marks. Compare draws the previous period dashed and faded. The tooltip lists every line at the hovered time.
- `timelineOption`: State and Colour history, with each segment's span, duration and configuration on hover. Unknown values draw as a pale block with a dashed outline.
- `gaugeOption`: Gauge panels as a radial arc. Bands tint the track and the arc takes the colour of the band the value is in; the value, range and age stay HTML, and a `meter` element carries the value for assistive technology.
- Consumption keeps its own bar option.

Time charts on one dashboard share a crosshair: hovering one shows the same moment on the others, mapped by time rather than by pixel, so panels of any size line up. Dragging across a time chart selects a range: dashboards switch to that absolute range and device history to a custom range. Charts scrolled out of view defer updates until they are visible again. The module is lazy-loaded with the panels that use it. `apps/storybook` shows each builder under Components/Charts.

**Apply to dashboard** changes the local draft. Only **Save dashboard** persists widgets, layout, name, and viewing defaults. Resize/drag events never issue a save. Navigation offers save, discard, or stay; revision conflicts keep the draft. A panel can be duplicated, removed from the draft, or viewed fullscreen. Cancel restores the saved dashboard.

Status thresholds are per-source numeric lower bounds, with an explicit Base band below the first boundary. Lower bounds are inclusive; the next boundary is exclusive. Operators can add/remove bands and explicitly replace selected sources' rules using Copy thresholds. Simulation changes the preview only. Thresholds are display rules, not alarms or telemetry conversions.

## Latest versus history

- Status panels show the latest available value regardless of the chart range, with a panel-level freshness line. When an invalid sample retains a previous valid value, `last_valid_received_at` identifies that value's receipt separately from the diagnostic receipt. Inactive or stale readings do not receive healthy threshold colours.
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
| `consumption` | 1 to 4 numeric counter `sources` with one unit, optional `bucket` (`auto`, `15m`, `1h`, `1d`, `1w`, `1mo`) and `period` (`dashboard`, `today`, `7d`, `month`, `12mo`). Calendar periods require `bucket: auto`. Thresholds are cleared |

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
