# Design system

The portal and admin are built from one kit, `@iot-os/ui`
([`packages/ui`](../../packages/ui)): shadcn/ui on Radix and Tailwind v4, product
components, and page templates. Charts come from `@iot-os/charts`
([`packages/charts`](../../packages/charts), ECharts). The decision and its reasons
are in [ADR-012](../adr/ADR-012-design-system-and-charts.md).

Gallery: [`apps/storybook`](../../apps/storybook)
(`pnpm --filter @iot-os/storybook storybook`, http://localhost:6006), with toolbars
for theme, palette and skin and the accessibility addon. It is not shipped in the
portal or admin images.

## Rules for new UI

- **Compose a template.** Lists use `CollectionPage` with `DataTable`; never a bare
  `Table` on the canvas. Records use `EntityPage`, queues `InboxPage`, editors
  `WorkspacePage`, settings `SettingsPage`. Routes set no page widths, padding or
  gaps of their own.
- **Content sits in a `Panel`.** Only page headers, toolbars and section titles sit
  on the canvas.
- **Status comes from the kit.** Use `statusOf(value, domain?)` from
  `@iot-os/ui/lib/status` and the `Status` component from
  `@iot-os/ui/components/status-mark`. Add new values to `lib/status.ts`, never to a
  local map. "pending" is always info.
- **Times** use `RelativeTime` or `Freshness` (`@iot-os/ui/components/freshness`);
  never a local `Age`.
- **Type** uses the named scale: `text-display`, `text-title`, `text-heading`,
  `text-body`, `text-meta`, `text-code`, and `text-micro` for initials and count
  badges. No raw sizes.
- **Colour** uses semantic tokens (`bg-card`, `text-muted-foreground`,
  `text-warning`, …). No Tailwind palette colours, black or white.
- **Pick the right shadcn control.** Search inside a selector belongs in a
  searchable selector, not a separate search field next to a dropdown. Standalone
  search fields are for directory and table filters. Check the installed and
  official registries before writing a new primitive
  ([shadcn skill](../../.agents/skills/shadcn/SKILL.md)).
- **Server-paged lists sort on the server or not at all.**
- **Assistant chats** compose `MessageScroller`, `Message` and `Bubble`. Replies
  render through `Markdown` (never raw text with `whitespace-pre-wrap`), and a run
  that is sending, queued or working shows `Thinking` with a label that says which.
  Show the user's message as soon as they send it.
- **Longer messages** (ticket replies, notes, descriptions) use `Composer`: it formats as
  you write (Tiptap), stores and sends GitHub-flavoured Markdown that `Markdown` renders,
  takes attachments, and can switch to editing the Markdown itself. In the text, ⌘K adds a
  link rather than opening the command palette.
- **Toasts** sit bottom-right. A sticky bottom action bar needs
  `ref={keepToastsAbove}` and a panel docked to the right edge needs
  `keepToastsLeftOf`, both from `@iot-os/ui/components/sonner`.
- **Drafts until Save.** Editors keep changes in a local draft, protect unsaved
  work on navigation, and keep the draft on revision conflicts.
- **Keep data meanings.** Missing data is unknown, never zero or healthy; device
  colours and chart series keep their own semantics.
- **Add a story** for every new kit component and template.
- Portal and admin never keep their own shadcn copies or local versions of kit
  components.

## Guardrails

`pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint` run
`tsc` and then [`packages/ui/scripts/check-ui.mjs`](../../packages/ui/scripts/check-ui.mjs).
The release workflow runs the same lint.

| Rule | Level | Catches |
| --- | --- | --- |
| `palette-colour` | error | Tailwind palette colours and black/white utilities |
| `arbitrary-text-size` | error | `text-[12px]`-style sizes |
| `local-age` | error | A local `function Age(` |
| `local-status-map` | warning | A local value → `StatusTone` map |

A reviewed exception carries `ui-check: allow <rule>` on the same or the previous
line. Test and spec files are skipped.

## Layers

| Layer | Contents | Where |
| --- | --- | --- |
| Tokens | Surfaces (`background` canvas, `card` panel, `popover` raised, `sunken` inside a panel), elevation (`shadow-panel`, `shadow-raised`, `shadow-overlay`), type scale, layout widths (`max-w-reading`, `max-w-form`), motion durations, skins and palettes | [`src/styles/globals.css`](../../packages/ui/src/styles/globals.css) |
| Primitives | shadcn/ui on Radix, style `radix-nova` | [`components.json`](../../packages/ui/components.json), `src/components` |
| Product components | `Panel` (+ header, title, actions, content, footer), `DataTable`, `PropertyList`, `Freshness`, `RelativeTime`, `RowLink`, `RefLink`, `Status`, `DraftBar`, `InlineName`, `EmptyState`, `ErrorState`, `ErrorBoundary`, `RouteError`, `Pager`, `ViewsRail`, `PageTabs`, `PageHeader`, `CommandPalette`, `FilterBar`, form fields, `Stepper`, `ChoiceCard`, `PermissionMatrix`, `Markdown`, `Thinking`, `Thread`, `TicketThread`, `Composer` (with `useMarkdownEditor` and `MarkdownToolbar`), workflow overview components | `src/components` |
| Templates | `CollectionPage`, `EntityPage`, `InboxPage`, `WorkspacePage`, `SettingsPage`; `useUrlState` keeps search, filters, view and page in the URL | `src/templates`, `src/hooks` |

`DataTable` (TanStack Table) gives pages, from column descriptions: saved views with
counts, search, a Filters popover with chips, grouping, a remembered Columns menu,
sortable headers, selection with "Select all N", bulk actions (Export CSV), row
actions, subtotal and total rows, rows per page, server or client paging, "Load
more" paging for cursor APIs without a total, a bounded height with a sticky
header, run separators for logs, skeleton rows, empty and filtered-empty states, a
phone card layout and a polling note. Phone cards keep the row's selection box and
⋯ menu, with "Select all" above them, and the toolbar adds a Sort menu in place of
the sortable headers.

**Errors.** Each app's root route has `RouteError` as its `errorElement`, and each
layout wraps its `<Outlet />` in `ErrorBoundary` keyed on the pathname, so a page
that fails to render shows `ErrorState` while the navigation keeps working, and
leaving the page clears it. `reloadOnStaleChunks()` (`lib/stale-chunks`), called in
each app's entry, reloads once when a chunk from an older build fails to load after
a deploy; a second failure within 10 seconds shows "A new version is available"
instead of looping.

## Look and feel

- **Skins**: Console (Geist), Instrument (IBM Plex) and Flight Deck (B612), with
  locally bundled fonts. Skin tokens set typography, spacing, row height and radius.
- **Theme**: dark by default, respecting the saved light/dark/system choice. Dark has
  two palettes on a `data-palette` attribute: **Dusk** (default, soft blue-grey
  surfaces) and **Ink** (pure black). Skin and palette are pre-painted from
  `localStorage` in each app's `index.html`. Flight Deck keeps its own dark colours.
- **Control grammar**: text entry (Input, Textarea, InputGroup) is an inset field
  with a 3:1 border; pickers (Select, SearchableSelect) share that field plus a
  divided chevron; buttons are never inset (outline is a transparent frame);
  read-only inputs are dashed with muted text; `disabled` means "not allowed now",
  never "reference value". Labels mark optional fields, not required ones.
- **Navigation**: grouped sidebar (Monitor, Fleet, Build, Connect), a search button
  that opens the ⌘K command palette, and Tools and Settings in the footer. Page
  titles, actions and filter rows go in `PageHeader`.
- **Motion**: 100–200 ms, respects `prefers-reduced-motion`, never animates geometry
  that charts measure. Dashboard grid geometry stays instant.

## Charts

All charts render through `EChart` in `@iot-os/charts` with the SVG renderer and a
theme bridge that resolves design tokens for each skin and theme. Build options
with the shared builders (`timeSeriesOption`, `timelineOption`, `gaugeOption`)
so dashboards and device pages behave the same. Charts animate only their first
render. Storybook shows each builder under Components/Charts. Recharts is not a
dependency anywhere.

## After a kit change

A change to `packages/ui` or `packages/charts` affects both apps: rebuild `portal`
and `admin` and check both in the browser
([local setup](local-setup.md#rebuild-one-service)).
