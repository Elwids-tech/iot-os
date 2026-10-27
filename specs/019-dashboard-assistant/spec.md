# Feature Specification: Dashboard Assistant

**Feature Branch**: `spec/019-dashboard-assistant`

**Created**: 2026-10-26

**Status**: Draft

**Input**: "Let people create dashboards by talking to the AI assistant. The assistant
brainstorms with the user which visualizations fit, based on the parameter types of the
devices they pick (a counter could be hourly or daily consumption bars, or a comparison
of several counters; a ranged numeric could be a gauge; a boolean or enum a state
timeline), offers 2–3 options with a reason for each grounded in the existing data-first
panel suggestions, and then proposes a draft dashboard (or panels added to an existing
dashboard) that the user reviews and applies, following the same preview → proposal →
review → apply pattern as the workflow and profile assistants. Scope is the current
panel model only. Out of scope: server-resolved queries, cross-device aggregation,
derived expressions, rollups, custom widget packs, kiosks. The assistant must never save
or publish a dashboard by itself, must respect dashboard permissions and organization
scoping, and must not produce misleading charts."

## Context

Building a dashboard today means knowing the panel types. **Add panel** already starts
from data: the person searches devices, ticks parameters and gets up to three
suggestions that follow the device profile (counters suggest Consumption, ranged numbers
a Gauge, booleans and enums Status and State history, writable parameters Controls,
several same-unit numbers one Time series). The **Visualization** picker disables types
that cannot show the chosen data and says why. The server refuses what would mislead: a
chart never mixes units, Consumption accepts only counters (at most four, one unit), and
calendar buckets are cut in each device's reporting time zone.

What is missing is the conversation before that: "I want to keep an eye on the three
pumps at the north site" does not name devices, parameters or panel types. The roadmap
lists a **dashboard assistant** under Dashboards. The profile and automation assistants
already show the pattern this feature follows: the assistant reads what the person may
read, asks short structured questions, prepares an immutable proposal that the server
has validated, and a person reviews and applies it.

This feature adds that assistant for dashboards, limited to what panels can show today.
Comparing devices works only the way panels already allow it: side by side in one
same-unit chart, or up to four counters in one Consumption panel. Totals, averages or
rankings across devices, formulas and new visualizations need server-side panel queries,
which are a later spec. Until then the assistant says what it cannot build and offers
the nearest panel that tells the truth.

**Terms**: *Dashboard assistant* is the assistant scope this feature adds. *Target* is
what a conversation works on: a new dashboard, or one existing dashboard. *Option* is
one panel type with its main settings (for example Consumption with daily bars) for a
chosen set of parameters, with its reason; *suggestion rules* are the rules **Add panel**
uses to rank panel types today. *Proposal* is an immutable,
server-validated set of panels the assistant prepares for review: a whole new dashboard,
or panels to add to the target dashboard. *Unmet request* is something the person asked
for that the panel model cannot show.

## Clarifications

### Session 2026-10-26

- Q: When someone asks for a panel the assistant can't build yet, how should that request reach the platform team? → A: The assistant offers "Ask the team for this panel", which prefills a Feature request support ticket that the person edits and files; category counts are kept as well.
- Q: Who should see a dashboard the assistant creates, right after the person presses Create dashboard? → A: The same as **New dashboard**: open to the organization, shown in the review, and restrictable afterwards through **Share**.
- Q: When someone says "show it red above 80 °C", what should the assistant do, given that panel thresholds only colour the display? → A: Set the panel's threshold bands from their words, say that bands only colour the panel, and offer **Set up an alert**, which opens the automation assistant with the request waiting to be sent.
- Q: Where should people see the proposed dashboard while they talk to the assistant? → A: The conversation stays in the assistant rail; the page beside it shows the latest proposal at full size (the new dashboard, or the proposed panels marked in the editor) and updates with each proposal. Below 1280 px, **Review dashboard** opens the same view.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a new dashboard by describing it (Priority: P1)

A person who can create dashboards chooses **Create with assistant** in Dashboards and
writes "I want to watch energy use and running state of the pumps at the north site".
The assistant finds the matching devices and lists the parameters it will use. Where the
request leaves a real choice open, it asks up to three short questions with suggested
answers, framed by what the person wants to know (the value now, the trend, usage per
period, a comparison) rather than by chart names. It then prepares a proposal: a name, a
default time range, and panels, each with its data and the reason it was chosen. The
page beside the conversation shows the proposed dashboard at full size with the
devices' real data, and updates with each new proposal. The person presses **Create
dashboard**; the dashboard is created exactly as shown and opens.

**Why this priority**: it is the request, and it is useful on its own even without
brainstorming alternatives.

**Independent Test**: in the local stack, with simulated devices that have a counter, a
ranged temperature and a boolean, ask for a dashboard of those devices. The review shows
Consumption, Gauge and Status or State history panels with live previews; creating it
produces a dashboard whose saved panels match the review, owned by the person.

**Acceptance Scenarios**:

1. **Given** a person with `Dashboard.create` and the assistant enabled, **When** they
   open Dashboards, **Then** **Create with assistant** is offered beside **New
   dashboard** and in the page's assistant suggestions; without `Dashboard.create`, or
   with the assistant switched off, neither appears.
2. **Given** a request that names devices by site, tag, profile or name, **Then** the
   assistant finds only devices the person can see in the dashboard editor, and names
   the devices and parameters it chose before proposing.
3. **Given** a request that matches no device, or devices without applied parameters,
   **Then** the assistant says so and asks how to narrow or correct it; it prepares no
   proposal.
4. **Given** a proposal, **Then** the page beside the conversation shows it as the
   dashboard will look, drawn from real data, with the dashboard name, default time
   range, access (open to the organization, as for **New dashboard**) and, for every
   panel, its type, title, devices, parameters, units, settings and reason. Below
   1280 px, where the assistant opens as a sheet, **Review dashboard** opens the same
   view.
5. **When** the assistant prepares a new proposal, **Then** the page shows it in place
   of the previous one.
6. **When** the person presses **Create dashboard**, **Then** the server validates the
   reviewed proposal again with the person's current permissions, creates the dashboard
   once (pressing again or retrying does not create a second), and opens it; its first
   revision records that it came from an assistant proposal. It is open to the
   organization, as a **New dashboard** is, and the owner can restrict it through
   **Share**.
7. **Given** the person writes "yes, create it" in the conversation, **Then** nothing is
   created; only the review's button applies a proposal.

---

### User Story 2 - Brainstorm how to show the data (Priority: P1)

Before or after a proposal, the person asks "how else could I show the pump energy?".
The assistant offers two or three options for those parameters, best first, each with a
one-line reason and a preview: for an energy counter, usage per hour or per day as
bars, usage this month by day, or the running total now. For three pumps' counters it
offers one Consumption panel comparing them per day. The person picks one, or adjusts it
in words ("daily bars for the last 30 days"), and the proposal updates.

**Why this priority**: choosing the right visualization is what people find hard, and
it is where a wrong choice produces misleading charts.

**Independent Test**: for a fixed set of devices covering each parameter kind (counter,
ranged numeric, unranged numeric, boolean, enum, colour, writable), ask for options.
Every offered panel type is one **Add panel** suggests for the same parameters, the
first option uses its top-ranked type, and no option is one the **Visualization** picker
would disable.

**Acceptance Scenarios**:

1. **Given** chosen parameters, **Then** the assistant offers at most three options,
   each with a reason, using panel types in the order the suggestion rules rank them; a
   profile's own visualization hint leads, as in **Add panel**. Two options may share a
   type with different settings (hourly or daily bars) when the request leaves that
   open.
2. **Given** a counter, **Then** the options include Consumption with a bar size
   (15 minutes, hour, day, week or month) or a calendar period (today, last 7 days, this
   month, last 12 months); a time series of a counter is described as the meter reading
   over time, never as usage.
3. **Given** several same-unit numbers, **Then** one comparison chart is offered; given
   mixed units, or more than four counters to compare, **Then** the assistant proposes
   separate panels and says why.
4. **Given** a numeric parameter without a range in its profile, **Then** no gauge is
   offered for it; given a writable parameter the person may command, **Then** Controls
   is offered first.
5. **When** the person changes an option in words (bar size, period, title, time range,
   which devices), **Then** the assistant prepares a new proposal and the earlier one can
   no longer be applied.
6. **Given** an option's preview has no data in its range, **Then** the preview shows
   that there is no data, never zeros or a flat line.
7. **Given** the person asks for colours at limits ("red above 80 °C"), **Then** the
   proposal sets the panel's threshold bands, the review states each band as its range
   ("80 °C and above"), and the assistant says the bands only colour the panel and
   offers **Set up an alert**. That opens the automation assistant with the alert
   request waiting for the person to edit and send; it is offered only to people who can
   use the automation assistant.

---

### User Story 3 - Add panels to a dashboard being edited (Priority: P2)

While editing a dashboard, the person opens the assistant from the editor and asks "add
the boiler's pressure and a daily gas usage chart". The assistant prepares panels to add,
and the editor shows them below the existing panels, marked as proposed. **Add to
dashboard** makes them part of the editor's local, undoable draft, keeping any unsaved
edits. Nothing is saved until the person presses **Save dashboard**.

**Why this priority**: extending an existing dashboard is common, but a new dashboard
already proves the value.

**Independent Test**: open a dashboard in edit mode, move a panel without saving, then
ask the assistant to add two panels and apply them. The moved panel stays moved, the two
panels appear below, undo removes them, and the server's dashboard is unchanged until
**Save dashboard**.

**Acceptance Scenarios**:

1. **Given** a dashboard the person can edit, in edit mode, **Then** the editor offers
   the assistant; for a dashboard they can only view, it does not.
2. **Given** the conversation, **Then** the assistant knows which panels the dashboard
   already has, unsaved ones included, and does not propose a duplicate of a panel that
   shows the same data in the same way unless asked.
3. **When** the person applies a proposal, **Then** its panels are added to the local
   draft with the default sizes **Add panel** uses, the layout is compacted, and the
   dashboard stays within its limit of 100 panels.
4. **Given** a device in the proposal was deleted, or the person lost access to it,
   after the proposal was prepared, **Then** applying is refused with the device named,
   and the draft is unchanged.
5. **Given** someone else saved the dashboard meanwhile, **Then** the panels can still be
   added to the local draft, and saving follows the editor's existing revision conflict
   handling.
6. **Given** a proposal, **Then** the editor shows its panels below the existing ones,
   marked as proposed and excluded from the draft; dismissing the proposal or a newer
   proposal removes them, and **Save dashboard** never saves them before **Add to
   dashboard**.

---

### User Story 4 - Say what cannot be built yet (Priority: P2)

The person asks for "total energy of all 20 meters at the site, per day" or "the five
pumps with the highest running hours". The assistant explains that panels cannot yet
combine or rank devices, and offers the nearest truthful alternative: for example a
Table of each meter's current reading, or up to four meters per Consumption panel. It
never builds something that looks like the requested total.

**Why this priority**: a confident wrong chart is worse than no chart; operators act on
what dashboards show.

**Independent Test**: a fixed set of at least 20 requests, at least five of which ask
for cross-device totals, averages, rankings, formulas or custom visualizations. Each of
those gets an explanation and, where one exists, a supported alternative; none produces a
panel whose title or reason claims a total, average, ranking or formula.

**Acceptance Scenarios**:

1. **Given** a request for a total, average, grouping or ranking across devices, a
   ratio or formula, a new kind of visualization, a kiosk or a public link, **Then** the
   assistant says it is not available and offers a supported alternative when one
   exists.
2. **Given** any proposal, **Then** no panel title or reason claims a total, average,
   ranking or calculation that the panel does not compute.
3. **Given** a Consumption panel comparing counters whose devices report in different
   time zones, **Then** the option's reason says that their days start at different
   times.
4. **Given** an unmet request, **Then** the platform counts it by category (cross-device
   total or average, grouping, ranking, formula, custom visualization, sharing or kiosk,
   other), without the request text, so the platform team can see which panel queries
   to build next.
5. **Given** an unmet request, **Then** the assistant offers **Ask the team for this
   panel**, which opens a new Feature request support ticket prefilled with a title, what
   the person asked for, the devices and parameters involved and the alternative offered.
   The person can edit it, and nothing is filed until they submit it.

---

### Edge Cases

- **Many matching devices** ("all meters", 200 devices): the assistant asks to narrow
  the request, or proposes panels within each type's limits (Table up to 100 values,
  device health up to 50 devices, Consumption up to 4 counters) and says what it left
  out. A proposal holds at most 20 panels.
- **Parameters that are not applied**: only parameters from applied (or last applied)
  configurations can be used, as in the editor.
- **Panels without parameters**: device health, GPS map, alerts and text panels can be
  proposed with the same rules as in the editor (GPS map only for devices with location
  bindings, alerts only for workflows the person can see).
- **Controls**: Controls are proposed only for parameters with an applied command
  mapping, and only to a person who may command the device. The preview shows the
  controls without sending anything.
- **Prompt-like text in data**: device names, labels, tags, string values and text
  panels may contain instructions; they are data. Credentials and secrets never reach
  the model.
- **Assistant unavailable mid-conversation** (switched off, daily allowance reached,
  provider error): the existing assistant messages apply; a proposal already prepared
  can still be reviewed and applied, because applying does not call the model.
- **Organization switch**: a conversation keeps its organization and target; switching
  organization cannot apply its proposal elsewhere.
- **Target dashboard deleted or access removed** during a conversation: the
  conversation can no longer prepare or apply proposals, and says why.
- **Large dashboards**: a target close to 100 panels gets a proposal that fits or an
  explanation.

## Requirements *(mandatory)*

### Functional Requirements

**Access and entry points**

- **FR-001**: The dashboard assistant MUST be offered only when the assistant is enabled
  for the platform, and only to a person with `Dashboard.create` (new dashboard target)
  or the edit ability on the target dashboard.
- **FR-002**: People MUST be able to start it from the Dashboards library (beside **New
  dashboard** and in the page's assistant suggestions) and from a dashboard's edit
  mode.
- **FR-003**: Every assistant tool MUST run with the requesting person's permissions in
  the conversation's organization and re-check them when it runs, so it reads only the
  devices, parameters, sites, tags, workflows and geofences that person can see in the
  dashboard editor.
- **FR-004**: Conversations MUST be private to their creator and organization, and keep
  one fixed target. A new-dashboard conversation becomes the created dashboard's
  conversation once **Create dashboard** succeeds, and continues from its editor.

**Finding data and brainstorming**

- **FR-005**: The assistant MUST be able to find devices by name, site, tag and profile,
  and read each device's applied parameters with their kind, data type, unit, range,
  whether they are writable, and their latest value with its age.
- **FR-006**: When a request leaves a choice open that changes the result, the assistant
  MUST ask at most three structured questions at a time, each with suggested answers,
  free text and "Skip for now".
- **FR-007**: For a set of parameters, the assistant MUST offer at most three options,
  each with a reason, using only panel types the suggestion rules give **Add panel** for
  the same parameters, in their rank order, with the top-ranked type first unless the
  person asked for another. It MUST NOT offer a type the **Visualization** picker would
  disable for that data.
- **FR-008**: For counters, usage MUST be shown with Consumption, using a bar size or a
  calendar period; Status shows the running total; a time series of a counter MUST be
  described as the meter reading over time, never as usage.
- **FR-009**: When parameters cannot share a panel (mixed units, more than four counters,
  or a type's other limits), the assistant MUST propose separate panels and say why.
- **FR-010**: Each option and each proposed panel MUST be previewable with the devices'
  real data for the proposal's time range, drawn the same way as the panel on a
  dashboard. Missing data MUST show as missing.
- **FR-011**: The person MUST be able to choose an option, ask for alternatives, or
  change settings in words (bar size, period, title, time range, devices, threshold
  bands); each change produces a new proposal and supersedes the previous one.
- **FR-012**: Threshold bands MUST follow the editor's rules (an explicit base band,
  inclusive lower bounds) and the review MUST state each band as a range. When the
  person asks for limits, the assistant MUST say that bands only colour the panel, and
  offer **Set up an alert**, which hands the request to the automation assistant
  without creating anything, when the person can use that assistant.

**Proposals, review and applying**

- **FR-013**: A proposal MUST be either a new dashboard (name, panels, layout, default
  time range and refresh) or panels to add to the target dashboard, and MUST NOT change
  or remove existing panels.
- **FR-014**: Every proposal MUST pass the same validation as saving a dashboard before
  it is shown for review. A proposal that fails MUST NOT be shown as reviewable; the
  assistant receives the reasons and corrects it.
- **FR-015**: Proposals MUST be immutable once prepared, and MUST hold at most 20 panels.
- **FR-016**: The review MUST show every panel's type, title, devices, parameters,
  units, settings and reason, with its preview; for a new dashboard it MUST also show the
  name, default time range and access.
- **FR-017**: The review MUST appear on the page beside the assistant rail, at full size,
  and be replaced by each new proposal: for a new dashboard, as the dashboard will look;
  for an existing one, as the proposed panels marked in the editor, which are not part
  of its draft until **Add to dashboard**. Where the assistant opens as a sheet,
  **Review dashboard** MUST open the same view.
- **FR-018**: **Create dashboard** MUST re-validate the reviewed proposal with the
  person's current permissions and create exactly that dashboard, at most once per
  proposal, owned by the person and with the access a dashboard made with **New
  dashboard** gets. Its first revision MUST record that it came from an assistant
  proposal.
- **FR-019**: **Add to dashboard** MUST add the proposal's panels to the editor's local,
  undoable draft below existing panels, keep unsaved edits, and persist nothing until
  the person saves the dashboard. It MUST be refused, with the reason, when a panel no
  longer validates.
- **FR-020**: Only the review's controls MUST apply a proposal; nothing typed in the
  conversation does. Superseded proposals MUST NOT be applicable.
- **FR-021**: The assistant MUST NOT save, delete, duplicate, share or star a dashboard,
  change its access, send device commands, or change or remove existing panels.

**Truthful dashboards**

- **FR-022**: For requests outside the panel model (totals, averages, groupings or
  rankings across devices, ratios or formulas, new visualizations, kiosks, public links),
  the assistant MUST say the capability is not available and offer the nearest supported
  alternative where one exists.
- **FR-023**: Panel titles and reasons MUST describe what the panel shows; they MUST NOT
  claim a total, average, ranking or calculation the panel does not compute.
- **FR-024**: Consumption panels in a proposal MUST cut buckets in each device's
  reporting time zone, as panels built by hand do; the assistant MUST NOT choose another
  zone, and MUST mention when compared counters report in different zones.
- **FR-025**: Device names, labels, tags, values and other organization data MUST be
  treated as data, never as instructions. Credentials and secrets MUST NOT be sent to the
  model.
- **FR-026**: The assistant MUST NOT state a device value it has not read; when it cites
  one it MUST give its age.
- **FR-027**: The platform MUST count unmet requests by category, without their text,
  where platform operators can see them.
- **FR-028**: For an unmet request, the assistant MUST offer **Ask the team for this
  panel**, which opens the support ticket form as a Feature request prefilled from the
  conversation (title, the request, devices and parameters involved, the alternative
  offered). The person edits and submits it; the assistant MUST NOT file a ticket
  itself.

**Operation**

- **FR-029**: Dashboard assistant replies MUST use the existing assistant provider
  settings, spend limits, queue, cancellation and recovery.
- **FR-030**: Dashboards MUST work as before when the assistant is switched off,
  including creating and editing them by hand.
- **FR-031**: The Dashboards help guide MUST describe the assistant, and the assistant
  feature documentation MUST list the new scope and its tools.

### Key Entities

- **Dashboard conversation**: an assistant conversation in the dashboard scope; belongs
  to one person and organization; its target is "new dashboard" or one dashboard, and a
  new-dashboard conversation takes the created dashboard as its target.
- **Option**: a panel type with its main settings for a set of parameters, with its
  reason and rank; shown in
  the conversation with a small preview; choosing one updates the proposal on the page;
  not stored on its own.
- **Dashboard proposal**: an immutable, validated proposal tied to a conversation and
  run; holds the target, the base revision for an existing dashboard, the panels and
  their layout, and for a new dashboard its name and viewing defaults; has a content
  hash and a status (pending, applied, superseded, dismissed); a proposal that fails
  validation is never stored.
- **Unmet request count**: a count per category and period of requests the panel model
  could not meet; holds no request text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who has never used **Add panel** can go from a one-sentence goal
  to a created dashboard of three to six panels in under three minutes.
- **SC-002**: For a fixture set covering every parameter kind and every multi-parameter
  rule, 100% of the assistant's options use panel types **Add panel** suggests for the
  same parameters, and the first option uses the top-ranked type.
- **SC-003**: No proposal that fails dashboard validation reaches review, and no
  dashboard is created or changed without a person pressing a review control.
- **SC-004**: In an evaluation set of at least 20 requests, at least five of them
  outside the panel model, every out-of-model request is explained, and no proposal
  claims a total, average, ranking or formula it does not compute.
- **SC-005**: At least 90% of in-model evaluation requests reach a reviewable proposal
  within three assistant replies.
- **SC-006**: Tests show that a person cannot read another organization's dashboard
  conversations or proposals, or reference another organization's devices, workflows or
  geofences in a proposal.
- **SC-007**: With the assistant switched off, the existing dashboard tests pass and no
  dashboard assistant entry point is shown.

## Assumptions

- The dashboard assistant reuses the assistant workspace panel, provider settings, spend
  limits, worker queue and safety rules of the existing scopes; it has no file uploads.
- The suggestion rules used by **Add panel** are the single source of the options; the
  plan decides how the server and portal share them so they cannot drift.
- Previews are drawn in the portal from the data panels already read, so they cost no
  model usage.
- A proposal can set the new dashboard's default time range and refresh (for example the
  last 7 days for daily bars); otherwise the **New dashboard** defaults apply.
- 20 panels per proposal keeps reviews readable; larger dashboards are built over
  several proposals.
- The assistant converses in English, like the other scopes.
- Unmet request counts are an operations signal for prioritizing panel queries, not a
  per-organization report. Requests the team should act on for one customer arrive as
  support tickets the person chose to file.

## Out of Scope

- Server-side panel queries: totals, averages, grouping or ranking across devices,
  device sets that follow a site or tag, formulas, and hourly or daily rollups.
- New panel types, custom widget packs and visualizations built for one customer.
- Kiosk displays, public links and published revisions.
- Changing, rearranging or removing existing panels, dashboard variables, access and
  sharing, folders and tags through the assistant.
- Replacing the library's template, device-profile and import options; they stay as
  they are.

## Dependencies

- Dashboard access and permissions (`Dashboard.create`, edit ability) and dashboard
  validation as documented in [dashboards](../../docs/features/dashboards.md).
- Support tickets ([spec 015](../015-support-tickets/spec.md)) for **Ask the team for
  this panel**.
- The assistant infrastructure and safety rules in
  [assistant](../../docs/features/assistant.md), including provider settings from
  [spec 010](../010-assistant-provider-settings/spec.md).
- The roadmap's assistant item for a scope registry may land first; this feature works
  with either the current per-scope handling or the registry.
