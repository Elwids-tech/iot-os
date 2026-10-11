# Dashboards

Organizations build dashboards of panels over device data, location and alerts,
with their own permissions and per-dashboard sharing.

Code: Laravel [`Domain/Dashboards`](../../apps/api/app/Domain/Dashboards)
(validation: [`DashboardDefinition`](../../apps/api/app/Domain/Dashboards/Services/DashboardDefinition.php),
access: [`DashboardAccess`](../../apps/api/app/Domain/Dashboards/Services/DashboardAccess.php));
portal [`src/dashboards`](../../apps/portal/src/dashboards) (panel registry:
[`registry.tsx`](../../apps/portal/src/dashboards/registry.tsx), suggestions:
[`suggest.ts`](../../apps/portal/src/dashboards/suggest.ts)); charts
[`packages/charts`](../../packages/charts). Help:
[`resources/help/dashboards.md`](../../apps/api/resources/help/dashboards.md).

## Library

**Monitor → Dashboards** lists dashboards with views (All, Starred, Recently
viewed, Created by me), folder, tag and device filters, sorting and an Access
column; filters live in the URL. **New dashboard** is the primary action; the "…"
menu creates one from a template, from a device profile, or by importing JSON.
Bulk actions export JSON and delete. Stars and "last viewed" are per user and
never change a dashboard's revision.

## Editing

Enter **Edit dashboard** and choose **Add panel**. Adding starts from data: search
devices, tick parameters (each shows kind, unit and current value), and up to
three live suggestions appear. **Add panel** places one as is; **Customize** opens
the editor (`?edit-panel=<id>`), which groups Panel, Data, Display and Thresholds
beside a live preview. The **Visualization** picker lists every other type and
disables those that cannot show the selected data, with the reason. Panels that
need no parameters (device health, GPS map, alerts, text) open the editor directly.
From a device page, **Add to dashboard** opens the same suggestions for that device.

Suggestions are deterministic and follow the profile: a parameter's
`display.visualization` hint wins; writable parameters lead with Controls; boolean
and enum parameters suggest Status then State history; colours suggest Colour
history; a numeric parameter with a range suggests a gauge (display range, else
validation limits, else 0–100 for `%`; never for counters); several same-unit
numbers suggest one Time series. A chart never mixes units.

Edits stay in a local draft. **Apply to dashboard** changes the draft; only **Save
dashboard** persists panels, layout, name and viewing defaults. Panels stick to
the top or to the panel above them, as in Grafana; layouts are compacted on load
and save. Leaving with unsaved changes offers save, discard or stay; a revision
conflict keeps the draft. Panels can be duplicated, removed or shown fullscreen.

Status thresholds are per-source numeric lower bounds with an explicit base band;
lower bounds are inclusive. They are display rules, not alarms.

## Panel types

The server accepts 12 types (`schema_version: 2`); each accepts only its own config
keys.

| Type | Shows | Config |
| --- | --- | --- |
| `status` | Latest values with threshold bands and one freshness line | parameter `sources`, thresholds |
| `gauge` | Up to four values on a radial scale with bands | `min` < `max`, 1–4 numeric sources |
| `table` | Latest values of any type in rows | 1–100 sources |
| `controls` | Writable parameters that follow reported state ([devices](devices.md#commands-and-controls)) | sources, `columns` |
| `device_health` | Presence and last seen | `devices` (1–50), no sources |
| `timeseries` | Numeric history, several same-unit series | sources |
| `consumption` | Counter usage as bars | 1–4 counter sources of one unit, `bucket`, `period` |
| `state_history` | Time in boolean or enum states | sources |
| `color_history` | Reported colours as a timeline | sources |
| `location` | GPS map: devices with location bindings, trails, optional geofence | `location_device_uuids`, `geofence_uuid`, `show_trails`, `show_labels`, `trail_window` (legacy: `workflow_uuid`) |
| `alerts` | Active conditions and the latest ten episodes of a workflow | `workflow_uuid` |
| `text` | Plain text (rendered as text, not HTML) | `text` up to 4000 characters |

Panels read the applied profile's display hints when they render, so profile label,
tone and range changes apply to existing panels. Parameter choices come from
applied (or last applied) configurations, not from the latest measurements.

### Latest values versus history

- **Status-like panels** show the latest value regardless of the time range. Each
  Status panel has one freshness line (Live, or Stale / "N of M stale"); stale or
  inactive readings never get healthy threshold colours.
- **Charts** use the device history API, which the portal always calls in observed
  time with configuration revisions of the same type and unit merged. Values are
  bucket averages; gaps stay gaps. A time series with no data in range offers
  **Show last reading**.
- **Consumption** uses the counter increase endpoint, so resets and rollovers are
  handled. Period is the dashboard range or a calendar period (Today, Last 7 days,
  This month, Last 12 months); days, weeks (from Monday) and months start in the
  device's reporting time zone. Partial buckets are hatched; buckets without
  readings stay empty; totals are never summed across counters.
- **Location and alerts** read live state independently of the time range. A
  missing, stale, invalid or historical fix never implies a safe location; unknown
  accuracy stays unknown. Acknowledging an alert does not clear its condition.

### Charts

Every chart uses Apache ECharts through `packages/charts`: one `EChart` wrapper
(SVG renderer), a theme bridge from design tokens, and shared option builders
(`timeSeriesOption`, `timelineOption`, `gaugeOption`; consumption has its own).
Time series shade threshold bands, alert episodes and command marks; Compare draws
the previous period. Time charts on one dashboard share a crosshair by time, and
dragging selects a range. Off-screen charts defer updates.

### Viewing

The time picker supports relative presets, absolute bounds, browser time or UTC,
previous/next, zoom and manual refresh; viewing state lives in the URL (`range` or
`from`/`to`, `timezone`, `refresh`). New dashboards default to the last six hours,
browser time zone and a five-second refresh; absolute ranges are limited to 400
days. **Kiosk** (`?kiosk=1`) hides the shell and enlarges values; it is client-only.
The context rail (active alerts, recent commands, device presence) polls every 30
seconds; acknowledging from it needs `Device.manage`. **Download CSV** exports
loaded data with formula-like cells neutralized.

## Access and sharing

Dashboards have their own permissions:

| Permission | Allows | Built-in roles |
| --- | --- | --- |
| `Dashboard.view` | Open dashboards open to the organization or shared with you | Admin, Moderator, Member |
| `Dashboard.create` | Create dashboards; you own them and can edit, share and delete them | Admin, Moderator |
| `Dashboard.manage` | Open, edit, share and delete every dashboard | Admin |

Each dashboard is open to the **organization** (everyone with `Dashboard.view`) or
**restricted** (its owner, dashboard managers, and the members and roles it is
shared with). New dashboards are open to the organization. A share grants **Can
view** or **Can edit**; only the owner and managers change access or delete.
Duplicating needs `Dashboard.create` and keeps the original's access and shares.
The API filters the library, returns each dashboard's `access` and the viewer's
`abilities` (`edit`, `share`, `delete`), and answers 403 for a dashboard you cannot
open. The organization context includes `capabilities.dashboards`.

The migration that introduced these permissions copied existing grants:
`Device.view` → `Dashboard.view`, `Device.manage` → `Dashboard.create` and
`Dashboard.manage`, including custom roles, direct grants and restricted
ceilings ([`DashboardPermissionBackfill`](../../apps/api/app/Domain/Dashboards/Services/DashboardPermissionBackfill.php)).

## API

Under `/api/v1/organizations/{organization}`:

| Method and path | Needs |
| --- | --- |
| `GET dashboards` | `Dashboard.view` (filtered to what you can open) |
| `POST dashboards` | `Dashboard.create` |
| `GET dashboards/{d}` | view ability (records `last_viewed_at`) |
| `PUT dashboards/{d}` | edit ability; current `revision` or 409 |
| `DELETE dashboards/{d}` | delete ability |
| `PUT dashboards/{d}/star` | view ability |
| `POST dashboards/{d}/duplicate` | view ability and `Dashboard.create` |
| `GET dashboards/{d}/revisions`, `revisions/{n}` | view ability (latest 50 snapshots kept) |
| `POST dashboards/{d}/revisions/{n}/restore` | edit ability; restores as a new revision |
| `GET/PUT dashboards/{d}/access` | share ability; `PUT` replaces access and all shares (max 100, integer user ids) |
| `GET dashboard-share-targets?search=` | `Dashboard.create` or `Dashboard.manage` |

Updates send the full editable document with the current `revision`. Tags (up to
10) and folder are optional. Sources and workflow references must belong to the
organization.

Public links and server-resolved kiosk displays are not built
([roadmap](../roadmap.md#next)).
