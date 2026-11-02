# Feature Specification: Profile Dashboard Templates

**Feature Branch**: `spec/025-profile-dashboard-templates`

**Created**: 2026-11-02

**Status**: Draft; decisions confirmed by the owner on 2026-11-02

**Input**: "I want to enhance the add to dashboard feature on the device. So currently it
allows me to just add the widgets to an existing dashboard but I would like to create a
dashboard then and there itself and continue to add the widgets to it. Also, there
should be a way to create dashboard templates for a device profile so that it can be
created in a finger snap, because if there are many parameters that are being submitted
from the device, I could easily use the dashboard template that was configured for the
device profile and just bind the IDs to it so that it works instantly."

## Context

A device page has **Add to dashboard**. It lists the device's parameters, suggests up
to three panel types for the ones ticked, and appends one panel to a dashboard chosen
from those the person may edit. If the dashboard they want does not exist yet, they have
to leave the device, create it in the library, come back and start again. Each panel is
one trip through the dialog, which then closes.

The dashboard library can already create a dashboard in one go in two ways
([dashboards](../../docs/features/dashboards.md#library)):

- **From a template**: a few templates built into the portal (three-phase energy meter,
  GPS tracking, RGB light controls, device health) that find parameters by well-known
  keys such as `voltage.l1`.
- **From a device profile**: panels generated from the profile's groups, one status
  panel per group, a chart per group and unit, consumption for counters, one controls
  panel.

Neither is something an organization designs. A meter that reports forty parameters
gets the generator's layout or nothing; the dashboard someone spent an hour arranging
for one meter cannot be reused for the next twenty meters of the same type.

This feature does two things:

1. **Add to dashboard** can create the dashboard on the spot and stays open, so several
   panels go to the same dashboard in one visit.
2. A device profile can hold **dashboard templates**: a dashboard designed once for the
   profile, with the device left open. Applying a template to a device of that profile
   creates a working dashboard in one step, every panel bound to that device.

**Terms**: a *template* is a saved dashboard design that belongs to one device profile.
Its *device slot* stands for "the device this is applied to"; every parameter source,
device health entry and GPS device that read the original device reads the slot
instead. *Applying* a template to a device fills the slot with that device and creates
a dashboard. The *source dashboard* is the dashboard a template was saved from.

## Decisions

The draft left three questions open, each with a recommended answer. The owner chose
the recommended answer to all three on 2026-11-02.

- **Q1. Do dashboards created from a template follow later changes to it?** **No.**
  Each is an independent copy that records which template it came from. Changing or
  deleting the template never changes them. An "Update from template" action can come
  later as its own feature.
- **Q2. How is a template edited?** **Through a dashboard.** **Open as dashboard**
  applies it to a device the person picks, they edit it in the normal dashboard editor
  with live data, and **Save as profile template** replaces it. There is no separate
  template editor.
- **Q3. Does one apply cover several devices?** **No.** One apply creates one dashboard
  for one device. Bulk apply and multi-device dashboards are out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a dashboard while adding a panel (Priority: P1)

An engineer is on the page of a new three-phase meter, "Meter A". They choose **Add to
dashboard**, type "Meter A" in the Dashboard selector, and pick **New dashboard “Meter
A”**. They tick Voltage L1 to L3 and add a time series; the dashboard is created with
that panel. The dialog stays open with "Meter A" selected, so they tick Imported energy,
add a consumption panel, and choose **Done**.

**Why this priority**: the first half of the request, and the place every other way of
creating a device dashboard starts from.

**Independent Test**: from a device page, create a dashboard through the selector and
add two panels without closing the dialog; the library then lists the dashboard with
both panels.

**Acceptance Scenarios**:

1. **Given** a person who may create dashboards, **When** they type a name in the
   Dashboard selector that is not the name of a dashboard they can edit (ignoring case),
   **Then** the selector offers **New dashboard “name”**.
2. **Given** they chose a new dashboard and a panel type, **When** they add the panel,
   **Then** the dashboard is created with that one panel in a single save, using the
   default viewing range, and nothing is created if they cancel first.
3. **Given** a panel was added, **Then** the dialog stays open on the same dashboard,
   clears the ticked parameters, says what was added with a link to the dashboard, marks
   parameters the dashboard already shows as **On dashboard**, and the secondary button
   reads **Done**.
4. **Given** a person who may edit some dashboards but not create them, **Then** the
   selector offers no create item.
5. **Given** someone else saved the chosen dashboard meanwhile, **When** a panel is
   added, **Then** nothing changes and the dialog says to add it again (today's
   behaviour).

---

### User Story 2 - Save a dashboard as a profile template (Priority: P1)

The engineer has finished "Meter A": twelve panels over Meter A's parameters, arranged
the way the operations team likes. In the dashboard's menu they choose **Save as
profile template**, keep the suggested profile "Three-phase Energy Meter" and the name
"Meter overview", and save. The profile now has a template whose panels read "the
device it is applied to" instead of Meter A.

**Why this priority**: there is nothing to apply until a template exists, and saving
from a real dashboard reuses the dashboard editor with live data instead of a second
editor.

**Independent Test**: save a dashboard built for one device as a template of that
device's profile; the profile lists the template with its panel count, and the source
dashboard is unchanged.

**Acceptance Scenarios**:

1. **Given** a dashboard with panels reading one or more devices, **When** a person who
   may edit device profiles chooses **Save as profile template**, **Then** they choose
   which device the slot replaces (offered only among the dashboard's devices that have a
   profile, defaulting to the one most panels read) and the template belongs to that
   device's profile.
2. **Given** the save dialog is open, **Then** it lists what the template keeps: panels
   that read the chosen device, panels that need no device (text), and fixed references
   to the organization's automations or geofences; and what it drops: sources and
   panels that read only other devices.
3. **When** the template is saved, **Then** it keeps the panels, titles, display
   settings, thresholds, colours, layout for every screen size and viewing defaults; the
   source dashboard, its revision and its sharing are unchanged.
4. **Given** a template with that name already exists on the profile, **Then** the
   dialog offers to replace it, keeping its identity, or to choose another name.
5. **Given** the chosen device's parameters are not in any published revision of the
   profile, **Then** the template cannot be saved and the dialog says which parameters.

---

### User Story 3 - Apply a template to a device in one step (Priority: P1)

A technician installs "Meter B" with the same profile. On its page **Add to dashboard**
shows "Start from a template: Meter overview, 12 panels" with **Create dashboard**. One
click creates "Meter B · Meter overview" with all twelve panels reading Meter B, and
opens it.

**Why this priority**: the "finger snap" the request is about.

**Independent Test**: apply a saved template to a second device of the profile; the new
dashboard shows that device's live values in every panel, with no editing.

**Acceptance Scenarios**:

1. **Given** a device whose profile has templates and a person who may create
   dashboards, **When** they open **Add to dashboard**, **Then** the templates are
   offered first, the profile's default template on top, each with its panel count.
2. **When** they choose **Create dashboard** on a template, **Then** a dashboard named
   "{device} · {template}" is created with every slot filled by this device and they land
   on it; the name can be changed before creating.
3. **Given** the device's applied configuration lacks some of the template's
   parameters (for example it runs an older profile revision), **Then** those sources
   are left out, panels left with nothing to show are dropped, and the dialog says how
   many before creating.
4. **Given** the device has no applied configuration, **Then** templates are not
   offered and the dialog explains why (today's message).
5. **Given** a dashboard was created from a template, **Then** it is an ordinary
   dashboard: its creator owns it, it is shared like any new dashboard, and it records
   which template it came from.
6. **Given** a template is later changed or deleted, **Then** dashboards created from
   it are unchanged (Q1).

---

### User Story 4 - Manage a profile's templates (Priority: P2)

On the profile, a new **Dashboards** section lists its templates: name, panel count,
who changed it and when, and how many dashboards were created from it. The engineer
renames one, marks "Meter overview" as the default, deletes an old one, and applies a
template to a device picked from the profile's devices.

**Why this priority**: needed once a profile has more than one template, but a single
saved template already delivers User Story 3.

**Independent Test**: on a profile with two templates, rename one, make it the default,
delete the other, and apply the remaining one to a device from the section.

**Acceptance Scenarios**:

1. **Given** a person who may view the profile, **Then** they see its templates; only
   people who may edit the profile can rename, set the default, update or delete them.
2. **When** a template is made the default, **Then** any previous default on that
   profile stops being one.
3. **When** a template is deleted, **Then** dashboards created from it stay and keep
   working.
4. **When** they choose **Apply** on a template, **Then** they pick a device of this
   profile from a searchable selector and continue as in User Story 3.
5. **Given** a template, **When** they choose **Open as dashboard**, **Then** it is
   applied to a device they pick so it can be edited with live data, and **Save as
   profile template** on that dashboard offers to replace it (Q2).

---

### User Story 5 - Use profile templates from the library (Priority: P3)

In **Dashboards**, the "…" menu's **New dashboard from a template** lists the
organization's profile templates beside the built-in ones. Choosing one asks for the
device and continues as in User Story 3.

**Why this priority**: another entry point to the same action; the device page already
covers the common case.

**Independent Test**: create a dashboard from a profile template in the library without
visiting the device.

**Acceptance Scenarios**:

1. **Given** profile templates exist, **Then** the library's template list shows them
   grouped by profile, after the built-in templates, which keep working as today.
2. **When** a profile template is chosen, **Then** the person picks one device of that
   profile and gets the same result as User Story 3; one apply is one device (Q3).

---

### Edge Cases

- A template saved from a dashboard whose panels also read other devices drops those
  sources; a panel left with none is dropped, and the save dialog says so first.
- A profile parameter the template uses is later deleted (only possible once nothing
  references it): applying skips it as in User Story 3, scenario 3.
- The device slot in a device health or GPS map panel is filled like a parameter
  source; other devices in those panels are dropped, as for sources.
- Alerts panels keep their automation, and GPS maps keep their geofence, as fixed
  references. If that automation or geofence no longer exists when the template is
  applied, the panel is dropped and the dialog says so.
- Applying the same template twice to one device creates a second dashboard; the
  dialog notes that one already exists and links to it.
- A template is limited like a dashboard: the same panel count and size limits, so
  every template can be applied.
- A person who may create dashboards but not view a device cannot apply a template to
  it; the device must be one they can see.
- Templates and dashboards created from them never cross organizations; a profile's
  templates are visible only inside its organization.

## Requirements *(mandatory)*

### Functional Requirements

**Add to dashboard**

- **FR-001**: The Dashboard selector in **Add to dashboard** MUST offer to create a
  dashboard named after the typed text when no dashboard the person can edit has that
  name (ignoring case), and only to people who may create dashboards.
- **FR-002**: A dashboard chosen this way MUST be created together with its first panel
  in one save; cancelling before that MUST create nothing.
- **FR-003**: After a panel is added, the dialog MUST stay open on the same dashboard,
  clear the ticked parameters, confirm what was added with a link to the dashboard, and
  mark parameters the dashboard already shows.

**Templates**

- **FR-004**: A device profile MUST be able to hold several dashboard templates, each
  with a name unique within the profile, an optional description, panels, layouts and
  viewing defaults; at most one is the profile's default.
- **FR-005**: A template MUST refer to devices only through its device slot. Every
  reference to the slot MUST name a parameter of its profile.
- **FR-006**: People who may edit the profile MUST be able to save a dashboard as a
  template of the profile of one of its devices, replace a template the same way,
  rename it, set or clear the default, and delete it.
- **FR-007**: Saving MUST replace the chosen device with the slot, drop references to
  other devices, keep references to the organization's automations and geofences, and
  show what is kept and dropped before saving.
- **FR-008**: Saving or replacing a template MUST NOT change the source dashboard, the
  profile, its drafts or its published revisions.
- **FR-009**: People who may create dashboards and can see a device MUST be able to
  apply a template of that device's profile from the device page, the profile and the
  library, creating a dashboard in one step.
- **FR-010**: Applying MUST fill the slot with the device, leave out parameters the
  device's applied configuration lacks, drop panels left with nothing to show, and say
  how many were left out before creating.
- **FR-011**: A dashboard created from a template MUST pass the same validation as any
  other dashboard, be owned and shared like any new dashboard, and record the template
  it came from.
- **FR-012**: Changing or deleting a template MUST NOT change dashboards already created
  from it (Q1).
- **FR-013**: Templates MUST be scoped to the profile's organization; no other
  organization can list, read, apply or change them.
- **FR-014**: The profile MUST list its templates with panel count, last change and the
  number of dashboards created from each.
- **FR-015**: The built-in templates and the **From device profile** generator in the
  library MUST keep working unchanged.
- **FR-016**: Saving, replacing, deleting and applying templates MUST appear in the
  activity log.

### Key Entities

- **Dashboard template**: belongs to one device profile in one organization. Name,
  description, default flag, panels with sources that read the device slot or fixed
  organization references, layouts per screen size, viewing defaults, who changed it and
  when, and a revision for safe concurrent edits.
- **Dashboard (existing)**: gains a reference to the template it was created from, kept
  if the template is deleted.
- **Device profile (existing)**: owns its templates; publishing and revisions are
  unaffected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a device page, a person creates a new dashboard with three panels in
  under one minute without leaving the page.
- **SC-002**: Applying a template of 20 or more panels to a second device of the same
  profile takes one click after opening **Add to dashboard**, and every panel shows that
  device's values with no further editing.
- **SC-003**: Saving a template from a dashboard takes under 30 seconds and leaves the
  source dashboard unchanged.
- **SC-004**: No template or template-created dashboard is visible to, or changeable
  by, another organization (proven by tests).
- **SC-005**: The built-in templates, the profile generator and existing dashboards
  behave as before (existing tests pass unchanged).

## Assumptions

- Profile parameters keep their identity across profile revisions, so a template saved
  against one revision applies to devices on another as long as the parameter exists.
- Templates are not part of profile revisions: they need no publishing and changing them
  never changes what a device runs.
- Managing templates follows profile editing rights, and applying follows dashboard
  creation rights, so no new permission is introduced.
- One slot per template: a template describes one device, and one apply fills it with
  one device (Q3). Dashboards that combine several devices or device types stay
  ordinary dashboards.
- No dashboard is created automatically when a device is created or activated.
- Templates do not move between organizations; import and export of templates is out of
  scope.
- The dashboard assistant is not part of this feature; templates work with the
  assistant disabled.
