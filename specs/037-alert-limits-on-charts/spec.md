# Feature Specification: Alert Limits on Charts

**Feature Branch**: `spec/037-alert-limits-on-charts`

**Created**: 2026-11-22

**Status**: Draft

**Input**: The owner asked "On the charts am I able to see thresholds set through
Workflows that has alert rules?" The answer was no, and the owner asked for it to be
planned: a time series panel should show the value at which a running automation raises
an alert on the reading it draws.

## Context

An **automation** (the owner's "workflow") reads device parameters, checks a condition
and raises an alert. The value in that condition is the **alert limit**: the reading at
which the alert is raised. A dashboard's **time series panel** draws a parameter's
readings over time.

What exists today, and what this feature has to respect:

- **Panel thresholds are a display setting.** The dashed lines and shaded bands on a
  time series panel come only from the **Thresholds** section of that panel's editor.
  They colour the panel and have no link to any automation
  ([dashboards](../../docs/features/dashboards.md)). Spec 019 already tells people that
  bands "only colour the panel".
- **Alert periods are shaded, the limit is not shown.** A panel shades the time while
  an alert on one of its devices was active. It does not show the value that raised it.
  A person who wants a line at the real limit types the number into the panel by hand,
  and the two drift apart when the automation is edited.
- **An automation's condition is not always on the raw reading.** It can compare the
  reading directly, an average over a time window, a reading converted to another unit,
  or the result of arithmetic on several readings. It can require the condition to hold
  for a duration, and it can combine several conditions
  ([automation](../../docs/features/automation.md)).
- **What runs is the applied deployment, not the draft.** A deployment is immutable and
  runs only after the runtime acknowledges it (constitution, principle II). An
  automation can also be suspended, in which case it raises nothing.
- **A workflow alert is matched to one device only.** Looking up alerts for a device
  finds an automation's alert only when that device is the first one the automation
  binds. An automation that reads two devices shades its alert periods on the first
  device's panels and not on the second's.

This feature draws the running alert limits on time series panels, and makes alert
periods appear for every device an automation reads.

## Clarifications

### Session 2026-11-22

Decided when the spec was drafted. The owner approved these defaults as a set before
the spec was started.

- **Which version of the rule**: the one running now, drawn across the whole time
  range. The line does not step where the rule changed in the past.
- **Who sees the lines**: anyone who can view the device, the same people who see the
  shaded alert periods today. The label shows the automation's name.
- **Kiosk mode**: kiosk mode is the signed-in person's own view with the page chrome
  hidden, so it shows the same lines. There are no public dashboard links today.
- **Panel setting**: **Show alert limits**, on by default, per panel.
- **Panel thresholds**: unchanged. They keep their colours, bands and labels.
- **A limit outside the drawn values**: it does not stretch the value axis. The legend
  names it instead.
- **Alerts on every device**: fixed as part of this feature, because the same matching
  of automations to devices is needed to find the limits.
- **Not in this version**: device page charts, and Gauge, Status and Table panels.

Asked of the owner after drafting, the same day:

- Q: When an automation is suspended, what should a time series panel show for its
  alert limit? → A: No line on the chart; the legend names the limit and says the
  automation is suspended and not checking.
- Q: Should an automation's alert also appear for a device it only sends commands to?
  → A: No. An alert belongs to the devices whose readings the automation reads
  (FR-025, FR-026).
- Q: Should a person be able to open the automation from its alert limit in a panel's
  legend? → A: Yes. The automation's name in the legend is a link for people who may
  open automations; others see the name as plain text.
- Q: How many alert limit lines should one panel draw before leaving the rest to the
  legend? → A: Up to 8. Identical limits across devices count as one line and the
  legend lists every limit.
- Q: How soon must an open dashboard show a changed alert limit without a reload? →
  A: Within one minute (FR-016).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the running alert limit on a chart (Priority: P1)

An operator opens a dashboard with a time series panel of a pump's temperature. An
automation named "Pump safety" raises an alert when that temperature goes above 25 °C.
The panel draws a line at 25 °C labelled "Pump safety > 25 °C", without anyone having
typed 25 into the panel. The operator sees how close the reading is to the limit and
why the shaded alert period started where it did.

**Why this priority**: this is the request. Without it people copy limits into panels
by hand and act on lines that may no longer match the rule.

**Independent Test**: activate an automation with a simple condition on a parameter,
open a panel that draws that parameter, and confirm a labelled line appears at the
condition's value with no change to the panel.

**Acceptance Scenarios**:

1. **Given** a running automation that raises an alert when a parameter is above 25 °C,
   **When** a person who can view the device opens a time series panel of that
   parameter, **Then** the panel draws a line at 25 °C labelled with the automation's
   name, the comparison and the value with its unit.
2. **Given** that panel also has its own thresholds, **When** it is drawn, **Then** the
   panel's thresholds and bands appear exactly as before and the alert limit can be
   told apart from them at a glance.
3. **Given** an automation whose condition turns on above one value and off below
   another, **When** the panel is drawn, **Then** both values are drawn and each label
   says which one raises the alert and which one clears it.
4. **Given** two running automations with limits on the same parameter, **When** the
   panel is drawn, **Then** each limit is drawn and labelled with its own automation.
5. **Given** a panel that draws several devices, **When** their limits differ,
   **Then** each line's label names its device and the legend names the device of
   every limit.
6. **Given** a panel that draws several devices, **When** they share the same limit
   from one automation, **Then** one line is drawn without a device in its label, and
   its legend row names the devices it covers.
7. **Given** a limit far above the drawn readings, **When** the panel is drawn,
   **Then** the value axis still follows the readings and the legend names the limit
   and its value.
8. **Given** a parameter with no running automation that alerts on it, **When** the
   panel is drawn, **Then** it looks exactly as it does today.
9. **Given** a limit in the legend, **When** a person who may open automations selects
   the automation's name, **Then** that automation opens. A person who may not sees
   the name as plain text.

---

### User Story 2 - A line is drawn only where it is true (Priority: P1)

An operator trusts a line on a chart to mean "the alert is raised when the reading
crosses here". When the automation checks something other than the raw reading, the
label says so. When the limit cannot be placed on the reading's axis at all, no line is
drawn, because a line in the wrong place is worse than none.

**Why this priority**: operators act on what the platform shows (constitution,
principle VI). A misleading line would make story 1 harmful.

**Independent Test**: activate automations covering each kind of condition, and
confirm each either draws a correctly labelled line or draws none, as listed below.

**Acceptance Scenarios**:

1. **Given** a condition on an average, minimum or maximum over a time window,
   **When** the panel is drawn, **Then** the line is drawn and its label names the
   treatment, for example "10 s average".
2. **Given** a condition that must hold for a duration before the alert is raised,
   **When** the panel is drawn, **Then** the label names the duration, for example
   "for 5 min".
3. **Given** a condition combined with other conditions, **When** the panel is drawn,
   **Then** the line is drawn and its legend entry says it is one of several conditions
   for that alert.
4. **Given** an automation that raises its alert when the comparison is *not* met,
   **When** the panel is drawn, **Then** the label shows the side of the limit on which
   the alert is actually raised.
5. **Given** a condition on a reading converted to another unit, **When** the panel is
   drawn, **Then** the limit is drawn at the equivalent value in the unit the panel
   shows, or not drawn when no exact conversion exists.
6. **Given** a condition on arithmetic over readings, on a comparison of two readings,
   or on a count or sum of readings in a window, **When** the panel is drawn, **Then**
   no line is drawn for it.
7. **Given** an automation that is a draft, inactive or archived, **When** the panel
   is drawn, **Then** no line is drawn for it and the legend does not name it.
8. **Given** an automation that is suspended, **When** the panel is drawn, **Then** no
   line is drawn for it, and the legend names its limit and says the automation is
   suspended and not checking.
9. **Given** an automation whose change is waiting for the runtime, **When** the panel
   is drawn, **Then** the limit shown is the one still running, until the runtime
   acknowledges the change.

---

### User Story 3 - Limits follow the automation (Priority: P2)

An integrator changes "Pump safety" from 25 °C to 30 °C and activates it. Dashboards
that were already open move the line to 30 °C without a reload. When the automation is
deactivated, the line goes away.

**Why this priority**: the reason to draw the limit from the automation, and not from
the panel, is that it cannot drift.

**Independent Test**: with a dashboard open, activate a changed automation and then
deactivate it, and watch the line move and then disappear without reloading.

**Acceptance Scenarios**:

1. **Given** an open dashboard showing a limit, **When** the automation is activated
   with a new value, **Then** the line moves to the new value within one minute without
   a reload.
2. **Given** an open dashboard showing a limit, **When** the automation is deactivated
   or archived, **Then** the line and its legend entry are removed within one minute.
3. **Given** an open dashboard showing a limit, **When** the automation is suspended,
   **Then** within one minute the line is removed and the legend says the automation
   is suspended and not checking.
4. **Given** the limits cannot be loaded, **When** the panel is drawn, **Then** the
   readings, the panel's own thresholds and the alert periods are still drawn, no
   limit line is shown, and the panel says alert limits are unavailable; it does not
   look like there are none.
5. **Given** an open dashboard showing a limit, **When** one refresh of the limits
   fails and the retry succeeds, **Then** the line stays as it was.
6. **Given** a person who can open the dashboard but cannot view devices, **When** the
   panel is drawn, **Then** it shows no alert limits and no message about them.

---

### User Story 4 - Alert periods appear for every device an automation reads (Priority: P2)

An automation raises an alert when a pump's temperature and a tank's pressure are both
high. Today the shaded alert period appears on the pump's panels only. After this
feature it appears on the tank's panels as well, and the alert is found when someone
filters alerts by the tank.

**Why this priority**: it is an existing fault that hides alerts from people looking
at the second device, and the limit lines of story 1 would otherwise appear on panels
that never show the alert they explain.

**Independent Test**: raise an alert from an automation that reads two devices, and
confirm that each device's panel shades the period and each device's alert list
contains it.

**Acceptance Scenarios**:

1. **Given** an alert from an automation that reads two devices, **When** a panel of
   the second device is drawn, **Then** the alert period is shaded on it.
2. **Given** that alert, **When** someone filters the alerts list by either device, or
   opens either device's page, **Then** the alert is listed.
3. **Given** an automation that reads one device and only sends commands to another,
   **When** alerts are filtered by the commanded device, **Then** the alert is not
   listed for it.
4. **Given** alerts that are not from automations, such as offline alerts, **When**
   they are filtered by device, **Then** the results are the same as today.

---

### User Story 5 - Turn alert limits off for a panel (Priority: P3)

A dashboard editor has a panel with ten devices and wants a clean chart. In the panel
editor they turn **Show alert limits** off. That panel stops drawing them; other panels
are not affected.

**Why this priority**: the default serves most panels. This is the way out for the
ones it clutters.

**Independent Test**: turn the setting off on one panel, save, and confirm that panel
draws no alert limits while another panel of the same parameter still does.

**Acceptance Scenarios**:

1. **Given** a time series panel, **When** an editor opens its settings, **Then**
   **Show alert limits** is present and on.
2. **Given** an editor turns it off and saves, **When** anyone views the dashboard,
   **Then** that panel draws no alert limits and names none in its legend.
3. **Given** a dashboard saved before this feature, **When** it is opened, **Then** its
   time series panels draw alert limits and its stored definition is unchanged.
4. **Given** a dashboard is exported, imported or copied from a template, **When** it
   is opened, **Then** each panel keeps its setting, and the limits drawn are those of
   the automations running in the organization it is opened in.

---

### Edge Cases

- **Many limits on one panel.** A panel with many devices can have many limits. The
  panel draws at most a fixed number of lines (8) and its legend lists every limit, so
  none is silently dropped. Limits with the same automation, comparison, value and
  treatment across several devices count as one line.
- **The same value as a panel threshold.** Both are shown; the alert limit's label is
  not hidden behind the panel threshold's.
- **Long time ranges.** The panel may draw averaged readings over a long range, so the
  drawn line can stay below a limit that raw readings crossed. The limit is still drawn
  at its real value and the shaded alert period shows when the alert was active.
- **The rule changed during the time range.** The line shows the limit running now for
  the whole range. An alert period from before the change may start away from the
  line. The legend entry says the limit is the current one.
- **Compare with the previous period.** Limits are drawn once, for the current rule.
- **A moved device** (spec 031). Limits come from the organization the dashboard is
  viewed in. Readings recorded before the move, in another organization, are drawn as
  today and carry no limits from that organization's automations.
- **A hosted device** (ADR-039). Only the automations of the organization that is
  viewing the dashboard contribute limits.
- **Automations turned off for the organization.** Nothing runs, so no limits are
  drawn.
- **Geofence rules.** They have no value on a reading's axis and draw no line.
- **A parameter that is not numeric.** No limits are drawn.
- **A person who can open dashboards but cannot view devices.** Roles can grant one
  without the other. Such a person sees the panel as it is today, with no alert limits
  and no "unavailable" message.
- **The parameter's unit changed since the automation was activated.** The limit's
  value is in the old unit, so no line is drawn; the legend lists it with its own unit
  and says it is not drawn.
- **One refresh fails.** It is retried once. If that also fails, the lines are removed
  and the panel says alert limits are unavailable until a refresh succeeds.
- **The device's configuration changed.** An automation whose binding no longer holds
  is suspended (existing behaviour), so its line is not drawn and the legend says it
  is suspended.

## Requirements *(mandatory)*

### Functional Requirements

**Finding the limits**

- **FR-001**: The system MUST provide, for a set of device parameters in one
  organization, the alert limits of that organization's running automations on each
  parameter.
- **FR-002**: An alert limit MUST come only from the deployment the runtime has
  acknowledged. Drafts, pending changes, and inactive or archived automations MUST
  contribute nothing.
- **FR-002a**: The limits of a suspended automation MUST be given as suspended, taken
  from the deployment that was running when it was suspended. They MUST NOT be drawn as
  lines.
- **FR-003**: An alert limit MUST come only from a condition that leads to an alert
  being raised. Conditions that lead only to commands or integration events are not
  alert limits.
- **FR-004**: Each alert limit MUST carry: the automation's name and identifier, the
  device and parameter, the side of the limit on which the alert is raised, the value,
  the unit, and whether the value raises the alert or clears it.
- **FR-005**: Each alert limit MUST say how the reading is treated before it is
  compared: a windowed average, minimum or maximum with its length; a duration the
  condition must hold; and whether it is one of several combined conditions.
- **FR-006**: When an automation raises its alert on the opposite outcome of a
  comparison, the limit MUST state the side on which the alert is actually raised.
- **FR-007**: The system MUST leave out a limit it cannot place on the parameter's own
  value axis: a condition on arithmetic over readings, on a comparison of two readings,
  on a count or sum over a window, or on a converted unit with no exact conversion back
  to the parameter's unit. It MUST NOT approximate one.
- **FR-008**: A limit on a converted reading MUST be given in the parameter's own unit.
- **FR-009**: Finding the limits MUST NOT change how automations are stored, validated
  or evaluated. The limits MUST match what the runtime evaluates, value for value.

**Drawing them**

- **FR-010**: A time series panel MUST draw the alert limits of the parameters it
  draws, each as a horizontal line at its value, labelled with the automation's name,
  the comparison, and the value with its unit. When the panel draws more than one
  device, the label of a line that belongs to one device MUST also name that device.
- **FR-011**: Alert limits MUST look different from the panel's own thresholds, and a
  limit that clears an alert MUST look different from one that raises it. The
  difference MUST NOT depend on colour alone.
- **FR-012**: The panel's own thresholds, bands, labels and colours MUST be drawn
  exactly as before.
- **FR-013**: Alert limits MUST NOT change the value axis. The axis follows the
  readings and the panel's own settings, as today.
- **FR-014**: The panel's legend MUST list every alert limit of the panel with its
  automation, the device or devices it covers where the panel draws more than one,
  comparison, value, unit and treatment, including limits that fall outside the drawn
  values and limits beyond the number of lines drawn.
- **FR-014c**: A limit whose unit is not the unit the panel shows for that parameter
  MUST NOT be drawn as a line. The legend MUST list it with its own unit and say it is
  not drawn.
- **FR-014a**: The legend MUST name each limit of a suspended automation and say that
  the automation is suspended and not checking, in words and not by colour alone.
- **FR-014b**: In the legend, the automation's name MUST open that automation for a
  person who may open automations in the organization, and MUST be plain text for
  anyone else.
- **FR-015**: A panel MUST draw at most 8 alert limit lines. Limits that are identical
  apart from the device MUST be drawn as one line. When there are more than 8, the
  lines drawn MUST be the ones nearest the values on the chart.
- **FR-016**: Open panels MUST pick up an activated, changed, deactivated or suspended
  automation within one minute, without a reload.
- **FR-017**: Readings MUST NOT wait for alert limits. When limits cannot be loaded the
  panel MUST draw everything else and MUST say that alert limits are unavailable.
- **FR-017a**: A failed refresh MUST be retried once. If the retry fails the panel
  MUST remove the limit lines until a refresh succeeds, because a limit that may have
  changed MUST NOT be shown as the current one.
- **FR-018**: Alert limits MUST be drawn in kiosk mode and at phone width the same way
  the panel's thresholds are.

**The panel setting**

- **FR-019**: A time series panel MUST have a setting, **Show alert limits**, on by
  default, that an editor of the dashboard can turn off for that panel.
- **FR-020**: A dashboard saved before this feature MUST open with the setting on and
  MUST NOT be rewritten.
- **FR-021**: A dashboard MUST never store the limits themselves. Export, import,
  templates and copies carry only the setting.

**Access**

- **FR-022**: A person MUST see a device's alert limits when, and only when, they can
  view that device in that organization, the same rule as for its alert periods.
- **FR-022a**: A person who can open a dashboard but cannot view devices MUST see no
  alert limits and MUST NOT be told they are unavailable. Being refused is not a
  failure to load.
- **FR-023**: A person outside the organization MUST get no limits, automation names or
  identifiers from it. This MUST be proven by a test.
- **FR-024**: Seeing a limit MUST NOT grant the ability to open, edit or activate the
  automation. Existing automation permissions decide that, including whether the
  legend offers the link of FR-014b.

**Alerts on every device**

- **FR-025**: Looking up alerts by device MUST find an automation's alert for every
  device whose readings that automation reads, whatever order the automation lists
  them in.
- **FR-026**: A device that an automation only sends commands to MUST NOT be matched
  to that automation's alerts.
- **FR-027**: Looking up alerts by site MUST follow the same rule as FR-025.
- **FR-028**: Alerts that do not come from automations MUST be matched to devices
  exactly as today.
- **FR-029**: FR-025 MUST apply to alerts raised before this feature as well as after
  it.

**Boundaries**

- **FR-030**: The automation contract, the runtime's evaluation, alert permissions and
  alert delivery MUST NOT change.
- **FR-031**: The dashboard, automation and help documentation MUST describe alert
  limits, what is left out and why, in the same pull requests as the behaviour.

### Key Entities

- **Alert limit**: a value on one device parameter at which a running automation
  raises or clears an alert. It names its automation, the side that raises the alert,
  the unit and how the reading is treated first, and says when its automation is
  suspended. It is worked out from the running
  deployment each time it is asked for and is not stored.
- **Automation deployment**: the immutable, acknowledged version of an automation that
  is running. The only source of alert limits.
- **Time series panel**: draws parameters of one or more devices over time. Gains one
  setting, **Show alert limits**.
- **Panel threshold**: the panel's own display lines and bands. Unchanged, and
  unrelated to alert limits.
- **Alert**: an episode raised by an automation. It belongs to every device its
  automation reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For an automation with a simple condition on a parameter, a person sees
  the limit on a panel of that parameter with no setup: zero values typed into the
  panel.
- **SC-002**: Across a set of example automations covering every kind of condition,
  every limit drawn equals the value the automation evaluates, and every condition
  listed as "left out" draws no line: no wrong line in the set.
- **SC-003**: After an automation is activated, changed or deactivated, every open
  dashboard shows the new state within one minute without a reload.
- **SC-004**: A dashboard with 20 time series panels draws its readings no later than
  it does today; alert limits appear within two seconds of the readings.
- **SC-005**: An alert from an automation that reads three devices is shaded on panels
  of all three and listed when filtering alerts by any of them.
- **SC-006**: Every dashboard saved before this feature opens with its stored
  definition unchanged and its own thresholds drawn as before.
- **SC-007**: A member of another organization obtains no alert limit, automation name
  or identifier from the organization, in every access path tested.
- **SC-008**: With alert limits unavailable, every panel still draws its readings and
  says limits are unavailable.

## Assumptions

- "Workflow" in the owner's request means an automation, the name the portal uses.
- The same people who see a device's alerts today may see the automation's name on a
  limit, because alerts already show that name to them.
- When a panel has more than 8 limits, the 8 drawn are those nearest the values on
  the chart; the legend always lists the rest.
- Limits are drawn per parameter. Alert periods stay per device, as today: a panel
  shades any alert on its devices, including alerts on another parameter and offline
  alerts.
- Most alerting automations use a direct comparison, a windowed average or a hold
  duration, so most limits can be drawn. This has not been measured.
- The dashboard assistant (spec 019) needs no change: panels it creates show alert
  limits by default.
- Only the current unit conversions the automation editor offers need converting back.

## Out of Scope

- Stepping the line where the rule changed over time.
- Charts on the device page and in device history.
- Gauge, Status and Table panels, whose colours stay panel-set.
- Editing an automation from the dashboard, and creating an automation from a panel
  threshold.
- Copying an alert limit into a panel's thresholds or bands.
- Showing anything for inactive, draft or archived automations.
- Resuming a suspended automation from the dashboard.
- Changing which device an alert names as its main device in the alerts list.
- Limits for geofence rules and for offline alerts.
