# UI/UX audit and polish plan

Status: in progress on `feat/ui-polish`, 2026-10-10. This document records an
audit of the served portal and the shared UI package and schedules the fixes.
Line numbers in the findings refer to the `feat/charts-consumption` checkout on
the audit date, before the fixes below landed.

## Progress

| Phase | State | Notes |
| --- | --- | --- |
| 0. Quick wins | Done, verified in the served portal | Overlay variants, reduced motion, utilities, 3:1 field borders and the inset field look, picker chevron addon, transparent outline buttons, read-only inputs, sidebar collapse control with persisted state, Geofences header, Notification settings overflow, adapter conversation filter, toast copy |
| 1. Dusk palette | Done, verified | `data-palette` axis, Dusk default, Ink kept, pre-paint, theme-color sync, appearance menu |
| 2. Form kit | Kit done; migrations in progress | Kit in `packages/ui` (form-fields, filter-bar, stepper, choice-card, FieldLabel `optional`, searchable selector `labelHidden`/`error`). Migrated: every directory filter row, the workflow editor's node forms, device onboarding (Stepper, ChoiceCard, validation on Continue), admin filters. Remaining field migrations are listed in the commit that lands them. |
| 3. Motion, loading, feedback | Done except the sliding tab indicator and live-list row motion | Panel slide, route fade, collapsible height, readout flash, chart first-render-only animation, page-shaped route fallback, SaveBar spinner and Saved state, LoadError, EmptyState, bottom-right toasts |
| 4. Assistant | Frontend unification done; backend registry, generic target, audit table, per-org budgets and new tool families remain | One workspace panel (Ask / This page / All guides) with a context line, the page's assistant portalled through a panel slot, the profile assistant as a body, Explain-this-execution inside the same panel, a Usage help toggle, an estimated-cost line |

## How the audit was done

- Served portal at `http://localhost:5173` (built from this checkout), signed in
  as the demo operator in Acme Manufacturing. Console and Flight Deck skins,
  dark and light themes, 1440×900 and 375×812 viewports.
- Pages reviewed: Home, Devices, device detail, Add device wizard, Device
  profiles, profile Overview and Parameters, parameter edit sheet, Dashboards,
  dashboard view and edit mode, Add panel dialog, Automations, automation
  editor and its AI assistant sheet, Alerts, Notification settings, Sites,
  Geofences, Discovery, Telemetry viewer, Help panel.
- Code inspection of `packages/ui`, `apps/portal`, `apps/admin`,
  `packages/workflow-editor`, `packages/api-client` and the Laravel assistant
  domain. The AI assistant is disabled on this machine, so the profile
  assistant conversation UI was reviewed from code only.
- Contrast ratios below are WCAG 2 relative-luminance ratios computed from the
  token values in `packages/ui/src/styles/globals.css`.

## Findings, ranked

| # | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | Every Radix overlay opens with no animation. The shared dialog, sheet, popover, dropdown, select and accordion use `data-open:` / `data-closed:` variants, but Radix sets `data-state`, and no custom variant maps one to the other. | `packages/ui/src/components/dialog.tsx:40,62`, `sheet.tsx:38,63`, `popover.tsx:30`, `dropdown-menu.tsx:46`, `select.tsx:70`, `accordion.tsx:45`. Verified live: the open Add panel dialog reports `data-state="open"`, no `data-open` attribute, `animationName: none`. | The product feels abrupt everywhere. This is the single biggest "no transitions" cause and it is a one-line CSS fix. |
| 2 | The dark theme is pure black on pure white, while surfaces are indistinguishable. | `globals.css:134-149`. Ratios: text/background 21:1, card/background 1.03:1, border/background 1.23:1, input fill 1.08:1, input border 1.46:1. | Text glares, structure disappears, and input borders fail WCAG 1.4.11 (3:1 for control boundaries). This is the "too much contrast" feeling. |
| 3 | All form controls share one silhouette. Input, Textarea, SelectTrigger, the SearchableSelect trigger (an outline Button), outline Button, InputGroup, outline Toggle and the Command search box all use `h-8 rounded-lg border-input` with `dark:bg-input/30`. In light mode `--border` and `--input` are the same value. | `input.tsx:11`, `textarea.tsx:10`, `select.tsx:45`, `searchable-select.tsx:87-105`, `button.tsx:14`, `input-group.tsx:15`, `command.tsx:75`, `globals.css:110-111`. | Users cannot tell a text field from a picker from a button. The two pickers even use different chevrons (`ChevronDown` muted vs `ChevronsUpDown` unmuted) and different placeholder colours. |
| 4 | There is no read-only style, no required marking, and six different error presentations. | Input has no `read-only:` classes. 39 `required` attributes, zero visual markers. Errors via `FieldError` (4 files), bottom `RequestError`, inline `<p role="alert">`, muted `FieldDescription`, invalid ring with no message (`PanelEditor.tsx:315,375`), or toast only. | Read-only values (profile unit, parameter ID, shown-once secrets) look editable. Validation feedback is unpredictable. |
| 5 | Five assistant surfaces with three containers, three proposal mechanisms and duplicated UI. The sidebar "Assistant" silently opens Help on most pages, and Help has no live-data tools. | `apps/portal/src/App.tsx:765-778` routing; `assistant/AssistantPanel.tsx` (docked aside, sheet below 768px), `help/HelpPanel.tsx` (docked aside, sheet below 1280px), `automation/WorkflowAssistant.tsx` (always a sheet), `adapters/AdapterAssistant.tsx` and `telemetry/TelemetryViewer.tsx:866-1040` (inline tabs). | Users learn three different assistants. Most pages have none. See Part 5. |
| 6 | Loading states pop. Lazy routes show a header-less `h-80` skeleton, then the real header appears; Geofences, Members, Roles and Telemetry show bare skeletons; device counts render empty then fill. No route transition. | `App.tsx:305-311` (`PageFallback`), `Geofences.tsx:31`, `Members.tsx:72`, `TelemetryViewer.tsx:221-226`, `DeviceDirectory.tsx:157-168`. | Every navigation is a flash of a grey block followed by a layout jump. |
| 7 | Feedback is inconsistent. No inline "Saved" confirmation, undo only for panel removal, four save paths with no toast (device configuration, notification settings, integrations, automation), mixed toast punctuation, buttons swap labels to "Saving…" instead of showing a spinner. | `components/forms.tsx:205-238` (`SaveBar`), `DashboardWorkspace.tsx:421-432`. | Users are unsure whether an action took effect. |
| 8 | Shell inconsistencies. Geofences renders `PageHeader` inside a `max-w-6xl p-6` container so its title is indented and lower than every other page. Page gaps vary from `gap-3` to `gap-10`. Notification settings' left pane overflows at 1440px and shows a horizontal scrollbar. The mobile page header stacks into three rows. | `geospatial/Geofences.tsx:32`, `alerts/NotificationSettings.tsx`, `page-header.tsx:67-80`. | Pages feel assembled by different hands. |
| 9 | Empty and error states are fragmented. Three empty components plus 18 ad-hoc "No …" paragraphs; `RequestError` titles load failures "Action needs attention"; retry buttons are one-offs. | `devices/shared.tsx:159-177`, `admin/components/DirectoryStates.tsx:35-66`, `forms.tsx:92-118`. | Dead ends with no next step. |
| 10 | Reduced motion is honoured only by charts. Skills reference `shimmer` and `scroll-fade` utilities that do not exist. `--panel-gap` and the sidebar collapse cookie are written but never read. Admin's ThemeProvider lacks `disableTransitionOnChange`. | `packages/charts/src/theme.ts:39,128`, `attachment.tsx:103`, `message-scroller.tsx:43`, `sidebar.tsx:85`, `apps/admin/src/main.tsx:13`. | Small, but they block the motion work below. |

Things that are already good and should be kept: the sidebar grouping and
collapse, `PageHeader` with back links and help context, `StatusMark` never
using colour alone, the choice-card onboarding, the data-first Add panel
dialog, dashboard grid geometry settling instantly (locked by
`apps/portal/e2e/dashboards.spec.ts:1040`), the unsaved-changes guard, and the
light theme, which is calm and readable.

## Part 1: Motion and transitions

Principles. Motion explains where something came from or went, lasts 100 to
200 ms, never blocks input, respects `prefers-reduced-motion`, and never
animates geometry that charts measure. The dashboard grid stays instant.

### Tier 0: restore what already exists (about one day)

1. Add the missing variants to `globals.css` next to the `dark` variant:

   ```css
   @custom-variant data-open (&[data-state="open"], &[data-open]);
   @custom-variant data-closed (&[data-state="closed"], &[data-closed]);
   ```

   Verify in the browser that an open dialog reports a non-`none`
   `animationName`. If Tailwind resolves the built-in `data-*` functional
   variant before the custom one, fall back to replacing `data-open:` with
   `data-[state=open]:` in the eight component files.
2. Add the `shimmer`, `scroll-fade-x` and `scroll-fade-b` utilities the shadcn
   skill rules already assume (`.agents/skills/shadcn/rules/styling.md:16,167-180`).
3. Add one global reduced-motion rule that collapses animation and transition
   durations to near zero, and mark the Skeleton pulse `motion-safe:`.
4. Tooltip: keep the delayed-open entry, add the exit fade.
5. Keep the existing accessibility specs that wait for animations before Axe
   runs (`telemetry.spec.ts:234`, `devices.spec.ts:329`, `onboarding.spec.ts:118`,
   `studio.spec.ts:117`). Add one spec that asserts a dialog animates under
   normal motion and does not under reduced motion.

### Tier 1: shell and navigation (two to three days)

- Help and Assistant panels: slide in with `translate-x` instead of toggling
  `hidden`, and transition the shell's right padding so content reflows
  instead of jumping (`App.tsx:806`). Below `xl` the restored Sheet slide
  covers it.
- Route changes: key the `<Outlet>` wrapper on the pathname and fade content
  in over 150 ms. Pair this with skeletons that include the page title (see
  Part 4) so the header never pops.
- Tabs: give the `line` variant a sliding indicator (absolutely positioned,
  `transition-[left,width]`), used by profile sections, device tabs and the
  Help panel.
- Collapsible and Accordion: animate height with the Radix content-height
  variable (Accordion already declares it; it only needs the Tier 0 variant).
  Rotate chevrons consistently; two of three callers already do.
- Sidebar: read the collapse cookie back so the state survives reloads, and
  fade group labels during collapse (already declared, works today).

### Tier 2: data and feedback (three to four days)

- Live readouts: when a value changes, run a 600 ms background highlight on
  the value cell (`ReadoutPanels.tsx:170-181`). Reduced motion disables it.
- Live lists (alerts, discovery, command log): fade new rows in and collapse
  removed rows with a `grid-rows-[0fr]` transition. Static directories do not
  animate.
- Save feedback: `SaveBar` shows a transient "Saved" with a check for two
  seconds before returning to "No unsaved changes". Buttons show a spinner
  from the shared Spinner primitive instead of swapping their label.
- Dashboard: panel geometry stays `transition: none`. Panel content may fade
  in on first data, and `UpdatedAt` may pulse once per refresh.
- Charts: ECharts animates the first render only (`animationDurationUpdate:
  0`) so updates never pass through intermediate sizes. Recharts stays off
  until those panels move to ECharts.
- Toasts: keep sonner's motion; switch to `position="bottom-right"` on
  desktop so toasts stop covering page headers.

### Tier 3: optional

Onboarding step slide, kiosk entry fade, a single subtle pulse for "receiving
now" status (colour meaning unchanged), empty-state icon reveal.

No animation library is needed. tw-animate-css plus CSS transitions cover all
of the above. Reconsider `motion` only if list reordering is ever required,
and lazy-load it.

## Part 2: A softer dark palette, "Dusk"

### Diagnosis

| Pair | Current dark (Console) | Proposed Dusk | Target |
| --- | --- | --- | --- |
| Text on background | 21.0 | 15.0 | ≥ 7 |
| Muted text on background | 7.5 | 7.4 | ≥ 4.5 |
| Primary on background | 9.6 | 9.0 | ≥ 4.5 |
| Card on background | 1.03 | 1.08 (plus ring) | visible step |
| Popover on background | 1.06 | 1.19 | visible step |
| Border on background | 1.23 | 1.45 | hairline |
| Input border on card | 1.42 | 3.12 | ≥ 3 (WCAG 1.4.11) |
| Input fill on card | 1.05 | 1.12 (inset, darker) | visible step |
| Success / warning / danger on background | 6.3 / 11.5 / 6.9 | 9.9 / 10.8 / 6.6 | ≥ 4.5 |

The current theme maximises text contrast and minimises surface contrast. Dusk
does the opposite: it lowers text to a comfortable 15:1 and raises surface,
border and input-border contrast so structure is visible.

### Tokens

All values in oklch so the hue stays consistent with the light theme's cool
tint (hue 255). Hex approximations are for reference.

```css
.dark[data-palette="dusk"] {
  --background: oklch(0.19 0.012 255);        /* #101419 */
  --sidebar: oklch(0.165 0.012 255);          /* #0b0f14 */
  --card: oklch(0.225 0.012 255);             /* #181c21 */
  --popover: oklch(0.26 0.012 255);           /* #20242a */
  --foreground: oklch(0.93 0.008 255);        /* #e4e8ed */
  --muted-foreground: oklch(0.72 0.02 255);   /* #9ca5b1 */
  --border: oklch(0.32 0.014 255);            /* #2e333a */
  --input: oklch(0.52 0.02 255);              /* #616a75, 3.1:1 on card */
  --input-fill: oklch(0.165 0.012 255);       /* new: inset field fill */
  --muted: oklch(0.26 0.012 255);
  --secondary: oklch(0.29 0.014 255);
  --accent: oklch(0.31 0.03 255);
  --primary: oklch(0.78 0.14 255);            /* #77baff */
  --primary-foreground: oklch(0.17 0.03 255);
  --ring: var(--primary);
  --success: oklch(0.78 0.17 150);
  --warning: oklch(0.83 0.16 80);
  --destructive: oklch(0.72 0.19 25);
  --info: oklch(0.8 0.12 240);
  --sidebar-*: derive from the above as the Console block does today.
}
```

Elevation ladder in dark: background < card < popover. Cards keep the
existing `ring-1 ring-foreground/10`, which becomes visible on Dusk.

### Mechanism

- Add a third axis, `data-palette="ink" | "dusk"`, beside `class="dark"` and
  `data-skin`. Store it in `localStorage("iot-palette")`, pre-paint it in both
  `index.html` files the way `data-skin` is, and expose it through a
  `PaletteProvider` modelled on `skin.tsx`.
- `AppearanceMenuItems` gains a "Dark palette" radio group: Dusk (default),
  Ink (current pure black, for OLED and high-contrast preference).
- Flight Deck keeps its own dark block; the palette applies to Console and
  Instrument. Order the CSS so the skin block still wins for Flight Deck.
- Set `<meta name="theme-color">` dynamically from `--background` so mobile
  browsers match.
- Audit `dark:` utility overrides that hard-code the pure-black assumption
  (`dark:bg-input/30`, `dark:bg-input/80`, `ring-foreground/10`) and switch
  them to the new tokens where the palette changes their meaning.

Verification: Axe across both palettes and all three skins on the pages in the
"How the audit was done" list, plus the existing e2e contrast checks. Screenshot
both palettes in `.local/` for review.

## Part 3: Form component differentiation

### Control grammar

Each control family gets one unmistakable look. These rules apply in both
themes; the dark values use the Dusk tokens.

| Family | Components | Resting look |
| --- | --- | --- |
| Text entry | Input, Textarea, InputGroup, Command search | Inset: fill `--input-fill` (darker than the surface), 1 px `--input` border at ≥ 3:1, text cursor, placeholder muted. |
| Picker | Select, SearchableSelect, future date and unit pickers | Same inset field plus a trailing 28 px addon zone separated by a hairline, holding one shared `ChevronDown`. Normal weight text, muted placeholder. SearchableSelect stops being an outline Button. |
| Button | default, outline, secondary, ghost, destructive | Never inset. Outline uses `border-border` and a transparent fill in both themes (drop `dark:bg-input/30`). Medium weight. |
| Segmented choice | ToggleGroup, filter chips, lifecycle tabs | A `bg-muted` track with a raised selected segment, no per-item border. Used for 2 to 7 options as the shadcn rules already say. |
| Switch and checkbox | Switch, Checkbox, Radio | Unchanged, but the label sits in one place: control first, label and description after. |
| Read-only value | new `ValueField` | Label plus plain text (mono for identifiers), optional copy button, no border, no fill. `Input readOnly` also gets a dashed-border, no-fill style and `aria-readonly`. |
| Disabled | any | Dimmed, meaning "not allowed right now". Never used to show reference values. |

### Field layout rules

- One label style: `text-sm font-medium`. Filter bars use `sr-only` labels or
  a compact inline label; never a restyled `FieldLabel`.
- Help text always below the control through `FieldDescription`. Group help
  goes under `FieldLegend`.
- Errors always through `FieldError` under the field, plus one `RequestError`
  summary at the top of long forms. No muted-grey errors, no invalid ring
  without a message.
- Mark optional, not required, because most fields in this product are
  required. `FieldLabel optional` renders "(optional)". Remove
  `placeholder="Optional"`.
- Required-but-empty stops being silent: wizard Continue buttons stay enabled
  and validate on click, showing which fields are missing.
- One search height (`h-8`). One `FilterBar` component for directory filter
  rows (search, pickers, segmented groups, count) so Devices, Profiles,
  Alerts, Dashboards and Discovery align.
- One `FormSection` heading style (`skin-label`), one `ChoiceCard`, one
  `Stepper` for the four-step onboarding (today the only cue is "Step N of 4").

### Consolidation

Move the portal's private helpers into `packages/ui` as a form kit:
`TextField`, `SelectField`, `ComboboxField`, `SwitchField`, `CheckboxField`,
`ValueField`, `FilterBar`, `FormSection`, `ChoiceCard`, `Stepper`. Retire
`TextField` and `Choice` in `apps/portal/src/components/forms.tsx:120,150`,
`InlineSelect` in `alerts/shared.tsx:19`, `ScalarInput` and `LocalSelect` in
`automation/Scenarios.tsx:758,803`, the workflow editor `Picker`
(`packages/workflow-editor/src/index.tsx:219`) and admin's
`OrganizationChoice`. The workflow editor should stop using a searchable
picker for two-option booleans (`index.tsx:650`).

Migration order, densest first: `profiles/ParameterEditor.tsx` (about 40
controls over four tabs), `dashboards/PanelEditor.tsx`,
`devices/DeviceOnboarding.tsx`, `alerts/Alerts.tsx` filters,
`devices/ConfigurationSection.tsx`, then the rest. Document the grammar in
`docs/ui-style.md` and extend `.agents/skills/shadcn/rules/forms.md`.

## Part 4: Shell, loading, feedback and consistency

- Loading: skeletons mirror the page (title, filter row, five rows) the way
  admin's `DirectoryLoading` does. `PageFallback` takes the route's title.
  Lists use `placeholderData` on filter changes. Count badges reserve width.
- Empty states: one `EmptyState` with icon, title, description and a primary
  action. Copy: "No X yet" plus the create action; "No matching X" plus
  Clear filters. Retire the 18 ad-hoc paragraphs and `DeviceEmpty`.
- Errors: a `LoadError` with a Retry button for query failures; keep
  `RequestError` for mutations. Stop titling load failures "Action needs
  attention".
- Feedback: every save either toasts or shows the inline "Saved" state. Toast
  copy is sentence case with no trailing period. Undo for destructive list
  removals where the server already supports restore.
- Page shell: `PageHeader` sticky by default for scrolling pages, section gap
  `gap-6`, directories full width, forms `max-w-4xl`. Fix Geofences to render
  the header outside its container. Fix Notification settings so the list pane
  fits at 1280 and 1440 (hide the Recipients column below `2xl`, or stack the
  panes). On mobile, hide the subtitle and move Help into the sidebar only.
- Persist the sidebar collapse state; show the Cmd/Ctrl+B hint in the trigger
  tooltip.
- Admin: add `disableTransitionOnChange`, adopt the form kit and empty state.

## Part 5: One assistant across domains

### Current state

Six AI entry points exist: the profile assistant panel, the Help panel's Ask
Help tab, the automation editor sheet, "Explain this execution" (a second sheet
instance), an "AI assistant" tab in the device-adapter workspace and an "AI
troubleshoot" tab in the telemetry viewer. They differ in container, breakpoint,
conversation selection, streaming (cursor events, 1 s refetch, 2 s refetch, or a
synchronous call) and proposal handling (server-side approval, client-side
graph replacement, a separate adapter proposal model). The composer, message
list, conversation selector and "unavailable" alert are re-implemented per
surface. The API client types are profile-specific (`AssistantConversation`
has `profile_uuid` but no `scope`), `AssistantController` branches on scope in
every method, no conversation is addressable by URL, cost is never shown, and
the per-tool-call audit required by `plan/architecture/ai-agent-experience.md`
does not exist. The adapter conversation list ignores its `adapter_uuid`
filter, so with two adapters the tab can open the wrong conversation
(`AssistantController.php:67-71`, `AdapterAssistant.tsx:68-69`).

### Target: one assistant, many contexts

Experience:

- One panel, one component, in a new `packages/agent-ui` (already planned in
  ADR-001 but absent). Docked 440 px rail from `xl`, Sheet below. Two tabs:
  **Assistant** and **Guides**. Ask Help merges into Assistant as the `help`
  scope used when the page has no domain tools.
- A context chip at the top: "Working on: Schneider energy meter ·
  Parameters", derived from the route (profile, device, workflow and
  evaluation, adapter, dashboard, alert). Changing page updates the chip; the
  user can pin a conversation to keep its target.
- Entry points: the sidebar footer button, one `PageHeader` action button on
  every page, and "Explain…" buttons that pre-fill a prompt (timeline,
  telemetry sample, alert episode). The per-page toolbar buttons and inline
  tabs go away.
- One proposal card and one `ProposalReview` dialog with diff, evidence,
  validation and read-only JSON. The apply strategy varies by kind (server
  apply for profiles, undoable client draft for workflows, adapter revision),
  the UI does not.
- Conversation history across scopes with a scope filter. `?assistant=<id>`
  in the URL so reloads and links reopen the conversation. The last open
  conversation per organisation is remembered locally.
- Shared pieces: composer with attachments where the scope allows, streamed
  message list, question cards, citations, Stop, unavailable and budget
  alerts, and an estimated-cost footer (the data already exists).
- One streaming path: the cursor-based events endpoint for every scope. Help
  and the adapter surface move onto it; telemetry diagnosis becomes a scoped
  conversation instead of a one-shot call.

Backend:

- A scope registry replaces the `if` branches: scope → agent, tool set,
  capability gate, target resolver, proposal applier. Routes stay as they are.
- Generic `target_type` / `target_id` on conversations, keeping the existing
  foreign keys during migration.
- An `AssistantTool` base class extracts the copied action-enum pattern and
  carries the accepted tool contract: risk level, approval requirement, draft
  or action, audit policy. Add the per-call audit table the plan requires.
- Per-organisation budgets instead of one global daily allowance.
- New read-only tool families, in order: operations investigator (device
  status, recent measurements, alert episodes; extract an `AlertQuery`
  service from `AlertController`), dashboard draft (decouple
  `DashboardDefinition::validate` from the HTTP request), geofences and
  sites. Configure tools produce proposals; control tools go through
  `DeviceCommandService::prepare/confirm` with explicit approval.
- Fix the adapter conversation filter now, independently of the rest.
- No MCP endpoint yet, as `docs/ai-assistant-v1.md` states. The registry is
  the boundary a later adapter would use.

## Phasing

| Phase | Scope | Size | Verification |
| --- | --- | --- | --- |
| 0. Quick wins | Overlay variant fix, reduced motion, missing utilities, dark input-border contrast, SearchableSelect styling, read-only input style, Geofences header, Notification settings overflow, adapter conversation filter, toast copy | about one week | Rebuild portal and admin, Axe on the audited pages, existing e2e |
| 1. Dusk palette | Palette axis, provider, menu, pre-paint, theme-color, token audit | about one week | Axe across palettes and skins, screenshots |
| 2. Form kit | `packages/ui` form kit, control grammar, migrate the five densest forms, docs and skill rules | about two weeks | Studio and onboarding e2e, visual review of each migrated form |
| 3. Motion, loading, feedback | Tiers 1 and 2, skeleton and empty-state consolidation, LoadError, SaveBar | about one and a half weeks | Dashboard transition test stays green, new motion spec |
| 4. Assistant unification | `agent-ui` package, panel, registry, generic target, audit table, then tool families one at a time | three to four weeks | Existing assistant, help, automation and adapter test suites, browser checks per surface |

Phases 1 and 2 can run in parallel because the palette work touches tokens
and the form kit touches components. Phase 4 should start after Phase 2 so the
panel is built from the form kit.

## Decisions needed

1. Make Dusk the default dark palette and keep Ink as an option, or ship Dusk
   as opt-in first. Recommendation: default to Dusk; existing users keep their
   light/dark/system choice and only the dark values change.
2. Mark optional fields rather than required ones. Recommendation: mark
   optional.
3. Merge Help into the assistant panel as a Guides tab, or keep two panels.
   Recommendation: merge; one button, one rail.
4. Order of phases. Recommendation: 0, then 1 and 2 together, then 3, then 4.
