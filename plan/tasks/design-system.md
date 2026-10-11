# Design system

Status: phases 1 to 7 implemented on `feat/design-system` (2026-10-10 to
2026-10-11), not yet committed. The proposal,
with mockups, is the artifact "IoT OS Design System"
(https://claude.ai/artifact/UGDvXzriUtU6TcwnXyQP9u). This file records the
agreed decisions and tracks the rollout.

## Why

The portal and admin read as several apps. The kit's primitives and tokens are
sound (five hard-coded palette colours across both apps), but nothing above
them says what a list page, a detail page or an editor looks like, so each page
was assembled by hand. The audit found six list layouts, four pagers, four
empty-state styles, six page max-widths, three status maps for the same device
command, and no elevation tokens to express a panel.

## Agreed decisions (2026-10-10)

1. Keep shadcn/ui on Radix, Tailwind v4 and the existing tokens. Open-source
   dependencies only; no paid UI kits.
2. All content sits in panels, in every skin. Instrument tiles square panels
   with 1px seams; Flight Deck keeps translucent panels on the dot grid.
3. Navigation: Locations (Sites and Geofences), a Settings area (General,
   Members, Roles, Notifications, Appearance), Device adapters under Build, a
   Connections page for broker connections, and Tools for the telemetry viewer.
4. The device page goes from seven tabs to five: Overview, Data (Measurements
   and History), Control (Controls and Command log), Configuration,
   Connectivity.
5. Storybook is the gallery (`apps/storybook`).
6. Tables get FilamentPHP's table features (searchable and sortable columns,
   filters with chips, tabs with counts, column manager, bulk actions with
   "select all", row actions, grouping, summaries, rows per page, polling,
   remembered state) through TanStack Table and our own `DataTable` UI, with no
   UI plugin.
7. Start with Foundations, then Devices as the first Collection page.

## Layers

| Layer | Contents | State |
| --- | --- | --- |
| L4 Domain screens | Routes compose a template; no page-level widths, padding or gaps | Done for every list, detail and editor page except those under "Deferred" |
| L3 Page templates | Collection, Entity, Inbox, Workspace, Settings (Board and Wizard not needed yet) | Done |
| L2 Product components | Panel, DataTable, PropertyList, Freshness, RelativeTime, RowLink, RefLink, Status, DraftBar, InlineName, EmptyState, Pager, ViewsRail, PageTabs, CommandPalette, AppearanceSettings | Done |
| L1 Primitives | shadcn/ui on Radix (`radix-nova`) | Kept; card, popover, menus, dialogs and sheets use the elevation tokens |
| L0 Tokens | Colour, radius, density, skins, palettes, surfaces, elevation, type scale, motion | Done |

## Progress

| Phase | State | Notes |
| --- | --- | --- |
| 1. Foundations | Done | Tokens, Panel, status vocabulary, Freshness, Storybook |
| 2. DataTable and Collection | Done | Every portal and admin list |
| 3. Entity | Done | Device (five tabs), Gateway (new page), Profile, Integration app, Role |
| 4. Inbox | Done | Alerts; Discovery stays a Collection (see Deferred) |
| 5. Workspace | Done | Automation editor, geofence editor, adapter workbench, telemetry viewer |
| 6. Settings, navigation, ⌘K | Done | Settings area, new navigation groups, command palette |
| 7. Clean-up | Done | One Pager, one EmptyState, guardrail lint, stories for every kit piece |

### Phase 1: Foundations

- Tokens in `packages/ui/src/styles/globals.css`:
  - Surfaces: background is the canvas, card the panel, popover the raised
    layer, and the new `--sunken` (`bg-sunken`) sits inside a panel. Light
    canvas darkened slightly (`oklch(0.972 0.005 255)`) so white panels read.
  - Elevation: `shadow-panel`, `shadow-raised`, `shadow-overlay`, set per
    theme and palette. Card, popover, dropdown, select, dialog, alert dialog
    and sheet use them instead of ad hoc rings and shadows.
  - Type scale: `text-display`, `text-title`, `text-heading`, `text-body`,
    `text-meta`, `text-code`, each with line height and weight.
  - Layout: `max-w-reading` (75rem), `max-w-form` (45rem), `--rail-width`
    (20rem), `--split-list-width` (25rem).
  - Motion: `--duration-fast|base|slow`, `ease-standard`.
- `Panel` (`components/panel.tsx`): Panel, PanelHeader, PanelTitle,
  PanelDescription, PanelActions, PanelContent (`flush` for tables),
  PanelFooter.
- Status vocabulary (`lib/status.ts`): `statusOf(value, domain?)` and the
  `Status` component in `status-mark.tsx`. One raw value reads the same on
  every page; `automation` and `delivery` domains override where a value means
  something else. "pending" is always info. The portal's device, command,
  deployment and delivery maps now use it. Command labels are unified:
  observed reads "Confirmed", already at target "Already set", uncertain is a
  warning.
- `RelativeTime` and `Freshness` (`components/freshness.tsx`), with
  `freshnessState` in `lib/format.ts`. The four portal `Age` components are
  gone.
- Storybook 10 in `apps/storybook` with theme, palette and skin toolbars and
  the a11y addon. Stories: Introduction, Surfaces, Typography, Status
  vocabulary, Panel, Freshness, Button. Run
  `pnpm --filter @iot-os/storybook storybook` (port 6006). It is not in the
  portal or admin images.

### Phase 2: DataTable and Collection

- `DataTable` (`components/data-table.tsx`) on TanStack Table 9 (`@tanstack/react-table`
  9.2.4, explicit features: sorting, pagination, row selection, column
  visibility). Pages describe columns as `DataColumn` objects (cell, value,
  sortable, searchable, hidden, align, summary, phone layout) and get:
  saved views with counts (a labelled radio group), search, a Filters popover
  with removable chips and Reset, Group (client tables sort by the group so
  groups never split across pages), a Columns menu remembered per viewer,
  sortable headers, selection with "Select all N" on client tables, a bulk bar
  with Export CSV, row actions, subtotal and total rows, rows per page,
  server or client paging, skeleton rows, empty and filtered-empty states, a
  phone card list, and the "updates every N s" note. `RowLink` is the row's
  own link (stretched on phones); `RefLink` is a quiet link to another record.
- `CollectionPage` (`templates/collection-page.tsx`, export
  `@iot-os/ui/templates/*`) and `useUrlState` (`hooks/use-url-state.ts`) for
  search, filters, view and page in the address bar.
- Devices uses both. Lifecycle views keep their counts; Status shows one
  concept (presence without "no recent data"); Last seen uses `Freshness`,
  late after an hour for active online devices; the Discovery banner became a
  toolbar link; Profile and Site filters; grouping by status, profile,
  gateway or site; Export CSV; row actions for Configuration, Command log and
  Copy device code. The devices API sorts by name only, so the Devices table
  has no sortable headers yet; server sorting is a follow-up for list
  endpoints.
- Storybook: DataTable (all features, empty, loading) and Templates/Collection.
- Portal lists on Collection + DataTable: Devices, Gateways, Connections (new
  page), Discovery, Locations (Sites, with Geofences as a page tab),
  Automations, Device profiles, Device adapters, Integrations, Members and
  invitations, Roles, the Dashboards library, the event log, and the
  notification workflows.
- The Dashboards library follows the same layout as Devices (2026-10-11):
  views with counts in the toolbar (All, Starred, Recently viewed, Created by
  me), Folder, Tags and Device filters with chips, a star column, sorting kept
  in the address, bulk Export JSON and Delete. "New dashboard" is the primary
  action and the "…" menu holds From template, From device profile and Import
  JSON. Templates open in a picker dialog; old `?view=templates` links open
  it. `CollectionPage` no longer takes a side rail; `ViewsRail` is only for
  section navigation such as Settings.
- Admin: `useDirectoryTable` replaces `ResourceDirectory`; Organizations,
  Users, Roles and Pending invitations use DataTable. `DirectoryFilters` and
  `PaginationControls` are gone; the permission editors sit in Panels.
- Server sorting: the devices API takes `sort` (`name`, `code`, `last_seen`,
  `created`, `-` for descending; never-seen devices last; `id` breaks ties)
  and echoes it as `meta.sort`. The Devices table enables sortable headers
  only when the API echoes the sort, so an older API never shows headers that
  sort one page locally. The sort lives in the address (`?sort=-last_seen`).

### Phase 3: Entity

- `EntityPage` (`templates/entity-page.tsx`): title, icon, code, back link,
  status, actions, link tabs, notices and a "Properties" rail; `PropertyList`
  lays label and value rows on a subgrid.
- Device page: Overview, Data (Measurements and History), Control (Controls
  and Command log), Configuration, Connectivity. Old tab URLs redirect
  (`measurements`/`history` → `data`, `controls`/`commands` → `control`) and
  scroll to `#device-history` or `#device-commands`. Help context maps the new
  tabs onto the existing topics.
- Gateway page (`/gateways/:id`, new): credentials, technical details and its
  devices; the old `?gateway=` query redirects there.
- Device profile, Integration application and Role editors use EntityPage
  with Panels.

### Phase 4: Inbox

- `InboxPage` (`templates/inbox-page.tsx`): toolbar on the canvas, queue panel
  on the left, detail panel on the right from 1280px. The detail Panel is one
  element in both layouts (`contents` when narrow) so drafts survive the
  breakpoint. `InboxList` moves with arrow keys and j/k; `InboxItem` carries a
  tone stripe.
- Alerts: segmented condition and repeats, a Filters popover for device and
  workflow, summary tiles, and items on InboxItem.

### Phase 5: Workspace

- `WorkspacePage` (`templates/workspace-page.tsx`): back link, the name edited
  in place (`InlineName`), tools, the `DraftBar` (live state, revision,
  unsaved changes) and a full-width body.
- Automation editor, geofence editor, adapter workbench and telemetry viewer
  use it. The automation emergency stop moved into the directory's header
  menu.

### Phase 6: Settings, navigation and ⌘K

- `SettingsPage` (`templates/settings-page.tsx`) with a "Settings sections"
  rail. Settings holds General (organization time zone and Appearance),
  Members, Roles, Notifications and Email preferences. Members, roles,
  notification and email-preference URLs from before redirect there
  (`MovedTo` in `App.tsx`, `MovedToSettings` in `alerts/Alerts.tsx`, and the
  legacy notification center).
- Notifications list every workflow with its email state; each workflow's
  recipients and email switches open on their own page with a back link,
  like roles. Email preferences are personal and apply in every
  organization.
- Navigation: grouped sidebar (Locations, Device adapters under Build,
  Connections), a search button and a "Tools and settings" footer.
- `CommandPalette` (`components/command-palette.tsx`, cmdk) on ⌘K or the
  sidebar search: pages, devices, dashboards and actions. It matches labels
  and keywords only (not the group heading), and selects the top result again
  when fetched records arrive, so Enter opens what is listed first.

### Phase 7: Clean-up

- One `Pager` (`components/pager.tsx`): DataTable's footer, the portal's
  `DevicePages` and forms `Pager` are adapters over it. `DeviceEmpty` is an
  adapter over `EmptyState`.
- `text-micro` (0.6875rem) joins the type scale for initials and count
  badges; the raw `text-[10px]`, `text-[11px]` and `text-[0.6875rem]` are gone,
  as are `border-black/10` and `bg-slate-400`.
- Guardrails: `packages/ui/scripts/check-ui.mjs` fails on Tailwind palette
  colours, black or white utility colours, arbitrary text sizes and local
  `Age` components, and warns on local status maps. A reviewed exception
  carries `ui-check: allow <rule>` on the same or the previous line. Portal
  and admin `lint` run it after `tsc`, and the release workflow runs `lint`.
- Stories for every kit piece: Navigation (Pager, ViewsRail, PageTabs),
  CommandPalette, Templates/Inbox and Templates/Settings join the earlier
  ones. All 27 stories render without console errors or WCAG A/AA
  violations in dark and light, Console and Flight Deck.

## Deferred

- Recharts to ECharts. `TimeSeriesPanel`, `HistorySection` and
  `DeviceOverview` have drag-zoom, reference areas and e2e coverage, and the
  ECharts setup (`core.ts`) registers bar charts only. Port them together
  with line, zoom and mark-area support as their own change.
- Server sorting for other list endpoints (profiles, automations, gateways).
  Devices shows the pattern: an allowlist, `meta.sort`, and headers that
  enable on the echo.
- Discovery stays a Collection rather than an Inbox: its e2e and the claim
  flow depend on rows.
- Device profiles have no DraftBar yet; their save flow differs from the
  automation editor's.
- The event log keeps its summary tiles and segmented filters; moving them
  into DataTable views and filters is a small follow-up.
- ⌘K does not search automations, profiles or gateways yet; each would be
  another fetched group like devices.
- A Storybook test runner in CI. The axe sweep ran from a scratch script;
  `@storybook/addon-vitest` would make it permanent.

## Rules for new UI

- Content sits in a `Panel`. Only page headers, toolbars and section titles
  sit on the canvas.
- Status comes from `statusOf` / `Status`. Add values to `lib/status.ts`,
  never to a local map.
- Times use `RelativeTime` or `Freshness`; never add a local `Age`.
- Use the named type scale instead of raw sizes.
- Lists use `CollectionPage` and `DataTable`; never a bare `Table` on the canvas.
- Server-paged lists sort on the server or not at all.
- Add a story for every new kit component and template.
- `pnpm --filter @iot-os/portal lint` (and admin) must pass: it runs `tsc` and
  the design system guardrails.
