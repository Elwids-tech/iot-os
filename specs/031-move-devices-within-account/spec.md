# Feature Specification: Move Devices Within a Billing Account

**Feature Branch**: `spec/031-move-devices-within-account`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "Move devices between organizations on the same billing
account. An integrator who owns a billing account runs several organizations under it
(one per customer, the 'child accounts'). They need to move devices, including
adapter-backed devices (webhook and HTTP polling adapters) and devices behind gateways,
from one organization to another in the same billing account. Devices move; the pipe
(adapter, its gateway, credentials, decoder, discovery) stays with the organization that
set it up; a directly connected device takes its own gateway along. A move archives the
device in the source organization as 'Moved to X' and creates a linked device in the
target with a copy of its profile version and configuration. Dashboards in the source
keep the archived device and its history; the move review lists affected dashboards,
automations, alerts, grants and offers copying dashboards to the target with device
references rewritten. Parent can onboard discovered devices straight into another
organization in the account. History across the link comes as a later phase.
Billing-neutral within the account. Needs an ADR and constitution principle III
amendment. Separate from spec 016 (sharing and cross-account transfer), which can later
reuse the device link and cutover."

## Context

An integrator often pays for several organizations through one billing account, one
organization per customer
([billing accounts](../../docs/features/access.md#billing-accounts),
[spec 023](../023-billing-accounts/spec.md)). Customers call these organizations child
accounts. The integrator usually connects the hardware first, in its own organization:

- through an adapter
  ([adapters](../../docs/features/adapters.md#how-it-fits-together)), where one webhook
  or polling source often brings in every device on a vendor account under one vendor
  credential;
- through a gateway in one of its connections, with several devices behind it;
- or as directly connected devices, each of which is its own gateway
  ([devices](../../docs/features/devices.md#onboarding-a-sparkplug-device)).

Later, each customer should see only its own devices. Today the only way is to archive
each device and onboard it again in the customer's organization. For an adapter that
also means a second copy of the source in the customer's organization. That copy holds
the integrator's vendor credential, polls the same vendor account a second time, and
has to reject every other device in Discovery.

What shapes the design:

- **Devices move; pipes stay.** A device's *pipe* is what brings its messages in: an
  adapter and the gateway it publishes as, or a gateway in one of the organization's
  connections, together with its credentials, decoder and Discovery.
  - The pipe stays with the organization that set it up. One vendor credential and one
    poll keep serving devices in several organizations of the account.
  - The target organization gets the device, never the pipe. It doesn't see the vendor
    credential, the decoder, the gateway's credentials or the pipe's other devices.
  - A move never copies a pipe into the target. A copied adapter would hand the target
    a vendor credential that reads every device on the vendor account, poll the vendor
    a second time, list every other device in both organizations' Discovery, and need
    another adapter runtime per organization.
  - A directly connected device is its own gateway, so its gateway moves with it and
    keeps its credentials and message topic.
- **A move is a cutover, not an edit.** Readings belong to the organization they were
  stored for, so a device can't change organization in place.
  - The source keeps an archived device, **Moved to *target***, with all its readings.
  - The target gets a new device linked to it, with a copy of its configuration and of
    the profile version it used.
  - Spec 016 (device sharing and transfer, in draft) planned the same cutover for
    transfers between unrelated organizations and can reuse this link and cutover.
- **Only within one billing account.** Both organizations have the same payer, and the
  person moving the devices holds move permission in both. There is no invitation,
  claim code or acceptance step. Moves between unrelated organizations stay in spec 016.
- **The organization stays the tenant boundary everywhere else.** Two things cross it,
  both only inside one account: a device that reports through another organization's
  pipe, and, in User Story 6, a moved device that reads its predecessor's history. The
  plan records both in an ADR and an amendment to constitution principle III.
- **Dashboards and automations come along, without breaking.** A dashboard or
  automation only uses devices of its own organization.
  - One that uses only moving devices moves with them.
  - A dashboard that also uses other devices is copied to the target with only the
    moving devices' panels, and the original stays.
  - An automation that also uses other devices stays, or is archived. It never blocks
    the move.
  - Whatever stays in the source keeps the archived device and its history up to the
    move.
- **Easy to do.** A move is one bulk action whose preselected choices are enough to
  complete it, and the assistant can prepare the same move from a request in the chat.
- **Billing doesn't change.** The device limit and usage are pooled per billing account
  ([billing](../../docs/features/billing.md)), so a move neither frees nor takes a place.
- **Nothing else changes.** An organization that never moves devices sees no change,
  except a new permission its Organization Admin holds and the new **Archive** for
  dashboards and automations.

**Terms**

- *Account*: a billing account.
- *Source*: the organization a device leaves.
- *Target*: the organization a device moves to, in the same account as the source.
- *Mover*: the person who moves devices: a member of both organizations with move
  permission in each.
- *Pipe*: an adapter and the gateway it publishes as, or a gateway in one of an
  organization's connections, with its credentials, decoder and Discovery. A directly
  connected device's own gateway is part of the device, not a pipe.
- *Pipe owner*: the organization that set up a pipe. Moving devices never changes it.
- *Hosted device*: a device that reports through a pipe owned by another organization in
  the same account.
- *Move*: 1 to 100 devices going from one source to one target.
- *Review*: the **What comes along** and **Confirm** steps of a move, before anything
  changes.
- *Cutover*: the moment a move happens. Predecessors are archived and successors are
  created.
- *Predecessor* and *successor*: the archived device left in the source, and the new
  device in the target, linked by the move.

## Clarifications

### Session 2026-11-10

- Q: When moving devices that come in through an adapter shared with other devices (one
  vendor credential returns every device), should they keep using the pipe owner's
  adapter or get a copy of it in the target? → A: Reuse only. Moved devices keep
  reporting through the pipe owner's adapter; a move never copies an adapter, its
  decoder or its credential into the target.
- Q: What should a move do with the dashboards and automations that use the moving
  devices? → A: The move offers them in the same bulk action, with easy preselected
  choices and an explicit confirmation of anything archived. A dashboard or automation
  that uses only moving devices moves with them. A dashboard that also uses other
  devices is copied to the target with only the moving devices' panels, and the
  original stays. An automation that also uses other devices can't move: it stays in
  the source or is archived there, it never blocks the device move, and the review
  offers to add its other devices to the move. Whatever can't be transferred can be
  archived in the source. The assistant can prepare the same move.
- Q: Should a moved device's readings from before the move be visible to the new
  organization by default? → A: No. **Include readings from before the move** is
  unticked; the target sees earlier readings only when the mover ticks it.
- Q: When every device behind a gateway in the source's own connection moves to the
  same organization, should the move offer to take that gateway along? → A: No.
  Gateways stay with the pipe owner, and **What comes along** shows each one as staying;
  only a directly connected device's own connection moves with it.
- Q: Should the **Where to** step let a billing account owner create the customer's
  organization on the spot? → A: Yes. Owners with room under the account's
  organization limit get **New organization…** in the target picker, become its
  Organization Admin, and continue the move.

### Session 2026-11-12

- Q: A device moves from A to B without its readings, then back to A. Does the device
  in A see the readings it recorded in A before it left? → A: Yes, always. A successor's
  history includes the readings of every earlier predecessor in its chain that is in the
  successor's own organization, up to that predecessor's cutover, whatever the history
  option says on the moves in between. They are the organization's own readings, so
  they are labelled as the device's own, and stopping or leaving the account doesn't
  end them (FR-053, ADR-040).
- Q: A device moves A→B without its readings, back to A with them, then to B again with
  the box ticked. B saw only the readings recorded since the device came back to A.
  Should the box bring all the history? → A: Yes. Ticking the box shares the whole
  history the device had at the move, earlier moves included, each part read where it
  was recorded. Stopping a link, or leaving the account, ends what crossed it for every
  device after it (FR-051, FR-052, ADR-041).
- Q: What happens to an automation that moves to an organization where automations are
  turned off? → A: It still moves, off, and the review says first that nobody there can
  change or turn it on until automations are turned on. A mover who may turn them on in
  the target (the permission the settings toggle needs) is offered to as part of the
  move, unticked. Its editor shows its nodes while automations are off, and says where
  they are turned on and who can (FR-039).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move adapter-backed devices to a customer's organization (Priority: P1)

An integrator runs a polling adapter in its own organization. It brings in 40 trackers
from one vendor account. Two of them now sit in a customer's shop and home, and the
customer's organization is on the integrator's billing account.

1. In the device list, the integrator selects the two trackers and chooses **Move to
   organization**.
2. **Where to**: they pick the customer's organization.
3. **What comes along**: one list shows everything the move touches, with a choice
   already made for each. The dashboard and the alert built for the shop move with the
   trackers (User Story 2). The adapter stays with the integrator. The tracker profile
   version is copied.
4. **Confirm**: a short summary says what moves, what is copied, and what is archived.
   They confirm.
5. **Done**: the result lists what landed where, and anything still to do in the
   customer's organization. A minute later the trackers report there.

The integrator's adapter, vendor credential and other 38 trackers are untouched. Its
dashboards still show the two trackers' history up to the move, marked as moved. The
customer's members see two trackers that report through the integrator's adapter, and
nothing else of that adapter.

**Why this priority**: this is the request that started the feature, and it can't be done
today without copying the vendor credential into the customer's organization.

**Independent Test**: a simulated polling or webhook adapter in organization A feeds
three devices. Move one of them to organization B in the same account. Then:

- B's device stores new readings within one minute, with no change to the adapter or the
  simulator.
- A's device is archived as moved, keeps its readings, and stores none after cutover.
- A's other two devices keep reporting.
- A member of B who isn't a member of A can't reach the adapter, its credentials,
  decoder, deliveries or other sources.

**Acceptance Scenarios**:

1. **Given** a member with move permission in two organizations of the same account,
   **When** they select 1 to 100 devices and choose **Move to organization**, **Then**
   the target list shows only organizations of the same account where they hold move
   permission.
   - An owner of the account with room under its organization limit also sees **New
     organization…**. Creating one there makes them its Organization Admin, as on the
     **Billing accounts** page, and the move continues with it as the target.
2. **When** they pick a target, **Then** the **What comes along** step shows, in one
   list:
   - each device that moves, with its name and code in the target (prefilled and
     editable; codes must be unique in the target) and an optional target site;
   - how each device reports, and what happens to that connection: an adapter or
     gateway stays with the pipe owner and is shown to the target by name only, and a
     direct device's own connection moves with it (User Story 3);
   - the dashboards and automations that use the devices, each with a preselected
     choice (User Story 2);
   - what ends in the source: open alerts, geofence assignments and integration
     application grants on those devices;
   - the profile versions that will be copied to the target;
   - that the pipe owner's members can still see the raw messages its pipe carries.

   Accepting every preselected choice MUST be enough to complete the move.
3. **Given** any selected device that is archived, has a configuration or lifecycle
   operation still waiting for the runtime, or is already part of a move in progress,
   **Then** the move can't be confirmed and the review shows the reason.
4. **When** the mover confirms, **Then** at cutover, as one step:
   - each predecessor is deactivated and archived as **Moved to *target***;
   - each successor is created in the target, linked to its predecessor, reporting from
     the same source, with a copy of the configuration, the profile version, the name,
     tags and custom attributes;
   - open alerts on each predecessor are cleared as **Device moved**;
   - each predecessor's unsent commands end as they do on a deactivation;
   - each listed dashboard and automation is moved, copied, kept or archived as chosen.
5. **Given** an active predecessor, **Then** its successor arrives active when the mover
   holds activation permission in the target. Otherwise the review warns that the
   successor will arrive inactive and store nothing until a target member activates it.
6. **Given** an active successor, **Then** its readings are stored only for the target,
   under the target's retention. The predecessor keeps its readings under the source's
   retention.
7. **Given** the source after cutover, **Then**:
   - its device list shows each predecessor as **Moved to *target*** with the cutover
     time;
   - the dashboards it kept and its integration applications can still read the
     predecessor's history;
   - the automations it kept receive nothing more from the device (User Story 2).
8. **Given** a member of the target, **Then** the successor's page shows **Moved from
   *source***, the cutover time, and that it reports through the pipe owner's adapter
   or gateway, with that pipe's name and whether it is online. It shows nothing else of
   the pipe.
9. **Given** a hosted device, **Then** the target can do everything it can do with its
   own devices: rename, edit, reconfigure within the metrics the pipe announces for that
   source, send commands, deactivate, archive and move it again.
10. **Then** both organizations' activity logs record the move: who, which devices,
    from where to where, and when.
11. **Given** the **Confirm** step, **Then** it summarizes the move in plain sentences
    (for example "2 devices, 1 dashboard and 1 automation move; 1 dashboard is copied
    with 3 of its 7 panels; 1 automation is archived in *source*"). Anything to be
    archived is listed on its own, and the move can't be confirmed until the mover
    confirms those archives.
12. **Given** a completed move, **Then** the **Done** step links to what moved, was
    copied or was archived, and lists what still needs someone in the target, such as an
    automation to turn on.
13. **Given** one device's page, **Then** **Move to organization** in its menu opens the
    same steps for that device.

---

### User Story 2 - Bring dashboards and automations along (Priority: P1)

The two trackers have a **Shop monitor** dashboard and a low-temperature alert of their
own. A **Fleet** dashboard and an **Any tracker offline** automation cover all 40
trackers. When the integrator reaches **What comes along**, the choices are already
made:

- **Shop monitor** moves, because it uses only the moving trackers.
- **Low-temperature alert** moves, for the same reason. Its recipient is a member of the
  customer's organization, so it keeps running there.
- **Fleet** is copied to the customer with only the two trackers' panels. The original
  stays with the integrator.
- **Any tracker offline** stays with the integrator, because it also uses trackers that
  aren't moving. The integrator could archive it instead, or add its other trackers to
  the move.

The integrator confirms without changing anything. On day one the customer has a
dashboard and an alert that work.

**Why this priority**: a device that arrives without its dashboard and alert isn't usable
by the customer, and an alert left behind stops the customer's alarms without anyone
noticing.

**Independent Test**: in A, dashboard D1 and automation W1 use only device X; dashboard D2
and automation W2 use X and device Y. Move X to B, accepting the preselected choices.
Then:

- D1 and W1 are in B, using B's new device, and no longer in A.
- B has a copy of D2 with only X's panels, and A's D2 is unchanged and still saves.
- W2 is still in A and stops using X, as described below.
- No dashboard or automation in either organization uses devices of the other.

**Acceptance Scenarios**:

1. **Given** the **What comes along** step, **Then** it lists every dashboard and
   automation of the source that uses a moving device, says whether it uses only moving
   devices or others too, and preselects a choice:

   | What | Uses | Preselected | Other choices |
   | --- | --- | --- | --- |
   | Dashboard | only moving devices | Move | Keep in source, Archive in source |
   | Dashboard | other devices too | Copy the moving devices' panels (original stays) | Don't copy |
   | Automation | only moving devices | Move | Keep in source, Archive in source |
   | Automation | other devices too | Keep in source | Archive in source |

   A choice that needs a permission the mover lacks in the target isn't offered, and
   the item falls back to staying in the source.
2. **Given** an automation that also uses devices that aren't moving, **Then** its row
   offers **Add *n* devices to this move**. Adding them recomputes every row. The
   devices can still move without them; the automation then stays in the source.
3. **When** a dashboard moves, **Then** it leaves the source and appears in the target
   with the same name, layout and panel settings, every source pointing at the
   successors. It keeps its owner and its shares with people who are members of the
   target. Otherwise the mover becomes the owner, and the shares that can't come along
   are listed in the review.
4. **When** a dashboard is copied, **Then** the target gets a dashboard with the same
   name and layout holding only the panels and panel sources of moving devices,
   pointing at the successors. Panels left with no source are left out, and the review
   lists them. The copy belongs to the mover and isn't shared. The original stays in the
   source, unchanged.
5. **Given** a dashboard that stays in the source, **Then** the move doesn't change it.
   Its panels keep the predecessors, show their history up to cutover with the device
   marked as moved, and the dashboard can be edited and saved as before.
6. **When** an automation moves, **Then** it leaves the source and appears in the target
   with every device it uses pointing at the successors.
   - Its alert recipients who are members of the target and can view devices stay.
     Others are removed, and the review lists them.
   - It keeps running only when it was running, automations are turned on in the
     target, the mover may activate automations there, and it sends no device commands.
     Otherwise it arrives off, and the **Done** step lists it as needing activation.
   - Its run history up to cutover stays with the source.
7. **Given** an automation that stays in the source, **Then** it no longer uses the
   moved devices. If it still refers to one, it is suspended, naming the moved device,
   until a source member removes the device from it and activates it again. The review
   says this before the move.
8. **When** a dashboard or automation is archived in the source, **Then** it is turned
   off, if an automation, and hidden behind **Show archived** in its list, as archived
   devices are. A source member with the matching permission can restore it; a
   restored automation comes back off.
9. **Then** no dashboard or automation, moved, copied or kept, uses devices of two
   organizations.
10. **Given** an automation that moves to an organization where automations are turned
    off, **Then** its row and the summary say nobody can change or turn it on there
    until automations are turned on.
    - A mover who may turn them on there is offered **Turn on automations in
      *target***, unticked. Ticking it turns them on at cutover, before the automation
      arrives, so a running one can keep running.
    - Otherwise it arrives off, and **Done** lists it until automations are turned on.
    - Its editor shows its nodes, says automations are off, and offers to turn them on
      to those who may; others are told who can, on the **Automations** page.

---

### User Story 3 - Move a directly connected device with its gateway (Priority: P2)

A controller in the integrator's organization was onboarded as a directly connected
device. It moves to a customer. Its gateway moves with it, so the customer can download
its settings and rotate its credentials, and the integrator no longer can. The controller
keeps publishing with the settings it has.

**Why this priority**: directly connected devices are common, and leaving their
credentials with the source would leave the customer unable to manage its own device.

**Independent Test**: move a simulated direct device from A to B while it keeps
publishing. Its readings appear in B within one minute with unchanged settings. After B
rotates the credentials, the simulator's old settings are refused and the new settings
work.

**Acceptance Scenarios**:

1. **Given** a directly connected device in a move, **Then** at cutover its gateway
   belongs to the target, with its credentials, firmware settings and message topic
   unchanged, so the device needs no change.
2. **Given** the cutover, **Then** the source's members can no longer see the gateway's
   credentials or download its settings or kits. The target's members with connection
   permission can.
3. **Given** a moved direct device, **Then** until its credentials are rotated, its page
   in the target warns that the source's members knew them. **When** a target member
   with connection permission rotates them, **Then** the old credentials stop working at
   once, new settings are issued, and the device reports again once it is reconfigured.

---

### User Story 4 - Onboard straight into a customer's organization (Priority: P2)

New trackers appear in the integrator's Discovery as the vendor account grows. Instead
of onboarding each one in its own organization and moving it, the integrator picks the
customer's organization while onboarding.

**Why this priority**: it removes most moves before they are needed, and uses the same
hosted-device rules as User Story 1.

**Independent Test**: with an adapter in A that has a new discovered source, onboard it
into B. B stores its readings. A's Discovery shows the source as in use in B, and A's
adapter is unchanged.

**Acceptance Scenarios**:

1. **Given** a discovered source of a pipe, **When** a member with move permission in the
   pipe owner onboards it, **Then** they can choose any organization of the account
   where they also hold move permission and permission to onboard devices. The pipe
   owner is the default.
2. **When** they choose another organization, **Then** the device is created there as a
   hosted device. Its profile version is copied to that organization as in a move.
3. **Given** a source onboarded into another organization, **Then** the pipe owner's
   Discovery shows it as **In use in *organization***.
4. **Then** the activity logs of both organizations record it.

---

### User Story 5 - Run a pipe that serves other organizations (Priority: P2)

The integrator's adapter now serves devices in three organizations. The integrator needs
to know that before changing the adapter, and must not cut a customer off by accident.

**Why this priority**: once hosted devices exist, an ordinary change to a pipe can stop
another organization's devices.

**Independent Test**: with a hosted device in B on A's adapter, try to delete the adapter
and to reject the source in A. Both are refused, naming B. Pause the adapter: A is warned
that one device in B will stop reporting, and after confirming, the pause goes ahead.

**Acceptance Scenarios**:

1. **Given** a pipe that serves hosted devices, **Then** its page in the pipe owner shows
   how many hosted devices it serves in each organization, and each of its sources shows
   which organization it is in use in.
2. **Given** a source in use by a hosted device, **Then** the pipe owner can't onboard or
   reject it.
3. **When** the pipe owner tries to archive or delete a pipe that serves hosted devices,
   **Then** it is refused, and the reason names the organizations and device counts.
4. **When** the pipe owner pauses, redeploys or rolls back an adapter, changes its
   decoder, or rotates a pipe's credentials, **Then** a confirmation first names the
   organizations and the number of hosted devices affected.
5. **Given** a change that alters the metrics a hosted device's source announces,
   **Then** the hosted device needs review in the target, as the target's own devices do
   when their source changes.
6. **Given** an offline pipe, **Then** the pipe's offline alerts go to the pipe owner,
   and each hosted device's offline alerts go to the organization that has the device.

---

### User Story 6 - Keep history across the move (Priority: P3)

The customer wants the freezer chart to go back further than the day of the move. When
moving, the integrator chooses **Include readings from before the move**.

**Why this priority**: moves work without it, and it is the second crossing of the tenant
boundary, so it comes after the rest.

**Independent Test**: move a device with history from A to B with the option on. B's
chart for the device shows a continuous line across the cutover. Move another device
with the option off. B sees nothing before its cutover. Move that device back to A: A's
chart for it goes back past both moves to the readings it recorded in A. Move it to B
again with the option on: B's chart goes back as far as A's did.

**Acceptance Scenarios**:

1. **Given** the review, **Then** it offers **Include readings from before the move** for
   the whole move, off by default, explaining that the target's members will see the
   predecessors' readings.
2. **Given** a move with the option on, **Then** the successor's history in the target's
   charts, tables, exports, dashboard panels and API includes the whole history the
   predecessor had before cutover, earlier moves included, followed by its own. Nothing
   is copied: each reading stays where it was recorded, under that organization's
   retention.
3. **Given** readings from before cutover, **Then** the target can tell them apart: they
   are labelled as recorded in the source.
4. **When** a member of the source with move permission stops it on the predecessor's
   page, or either organization leaves the account, **Then** the target, and every
   device moved on from it, no longer sees any reading that crossed that move.
5. **Given** a move with the option off, **Then** the target sees no reading from before
   cutover, except those of scenario 6.
6. **Given** a device that was in the target before, moved away and now moved back
   (directly, or through other organizations), **Then** the review says it reconnects to
   the readings it recorded there, and its history includes them up to the cutover it
   left at, whatever the option was on each move. They are labelled as its own readings,
   stay under the target's retention, and stopping or leaving the account doesn't end
   them.

---

### User Story 7 - Ask the assistant to move devices (Priority: P3)

An integrator who belongs to several organizations of the account asks the assistant:
"Move the shop tracker and its dashboard to the shop's organization." The assistant
finds the device and the organization, and answers with the same **What comes along**
list as an action card in the chat, with the same preselected choices. The integrator
changes one choice in the card and confirms there.

**Why this priority**: it makes moves easy for people who think in terms of their
customers rather than menus, but it adds nothing the bulk action can't do.

**Independent Test**: ask the assistant in A to move device X to B. The card shows the
same list and choices as the bulk action, nothing changes until the person confirms in
the card, and after confirming, the result matches a move made from the device list.

**Acceptance Scenarios**:

1. **Given** a person with move permission in several organizations of one account,
   **When** they ask the assistant to move devices, **Then** it offers only targets in
   that account where the person holds move permission, and asks which one when the
   request is unclear.
2. **Then** the assistant prepares the move as an action card with the **What comes
   along** list and the same preselected choices. The person can change any choice in
   the card.
3. **Then** nothing moves, is copied or is archived until the person confirms in the
   card. The assistant never confirms a move by itself.
4. **Given** a confirmed card, **Then** the move follows every rule of the bulk action,
   and the chat links to the **Done** result.

---

### Edge Cases

**Moving again**

- A successor can be moved again: onward to a third organization of the account, or back
  to its source. Each move creates a new successor and a new link, and the history
  option applies per link. A link that shares brings everything its predecessor's
  history showed, earlier moves included; a link that doesn't share ends the chain there
  for the devices after it, except for their own organizations' readings (FR-051,
  ADR-041). A→B→C with both moves sharing: C reads B's and A's readings.
- A device moved back to an organization it was in reconnects to the readings it
  recorded there, up to the cutover it left at (US6 scenario 6, FR-053). A→B→A: the
  device in A reads A's readings, then B's if the move back shared them, then its own.
  A→B→C→A: the device in A reads A's readings, then C's if the last move shared them,
  and B's if both later moves shared them. A→B (not shared) →A (shared) →B (shared): the
  device in B reads all of it.
- Moving a hosted device into its pipe owner makes it an ordinary device again.
- A device can be part of only one move at a time. Two movers selecting the same device
  at once: the first to confirm wins, and the other is refused without changes.

**Pipes**

- Activating devices through an adapter restarts the adapter once, as it does today.
  Moving its devices does the same. Its other devices show the usual **Adapter
  restarting** state, not offline, during the restart.
- A target that archives a hosted device frees the source. The source appears again in
  the pipe owner's Discovery, never in the target's.
- An adapter's gateway is the identity the adapter publishes under, not a gateway anyone
  manages. A move shows and talks about the adapter, never its gateway.
- A gateway's own metrics, onboarded as a device, can be moved like any other device
  behind a gateway. The gateway stays.
- A gateway stays with the pipe owner even when every device behind it moves to the
  same organization. It then serves only hosted devices, and FR-023 keeps it from being
  archived while they exist.
- A move can mix devices with different pipes, including directly connected devices.

**Organizations and the account**

- An organization can't leave its account (a platform administrator moving it to
  another account) while it has hosted devices, or while its pipes serve hosted devices
  in other organizations. The refusal lists them.
- An organization whose pipes serve hosted devices isn't empty, so it can't be deleted.
- Members of the target who aren't members of the source see the source's name on the
  successor and nothing else of the source. The same holds the other way round.
- An organization with nobody holding move permission in another organization of the
  account offers no move at all.

**What travels and what doesn't**

- A profile version used by several moving devices is copied once. A later move or
  onboarding into the same target reuses the copy made for that version. Platform
  templates aren't copied. A copy keeps the profile's code unless the target already
  uses it. The review shows the code the copy will get.
- A device code already used in the target must be changed in the review before
  confirming.
- The source's site, geofence assignments and integration application grants don't
  travel. Grants stay on the predecessor and keep reading its history.
- A dashboard or automation that uses only moving devices but is kept in the source
  shows or uses only the predecessors' history from then on.
- An automation that moves but sends device commands arrives off: its command
  authorizations were given in the source and must be given again in the target.
- A target without automations turned on still receives moved automations. They arrive
  off, and nobody can change or turn them on there until automations are turned on,
  which the mover may do as part of the move (FR-039).
- Two dashboards or automations in the target may end up with the same name; names
  aren't unique, so nothing is renamed.
- A telemetry capture running on a predecessor ends at cutover.
- Commands that may have been sent before cutover become uncertain under the source
  and are never resent.
- Readings that arrive between the predecessor stopping and the successor starting are
  stored for neither organization. For a polling adapter, records fetched in that gap
  aren't fetched again.

**Billing**

- An account at its device limit can still move its active devices: each successor
  takes the place its predecessor gives back, and the month's peak doesn't count the
  device twice.

## Requirements *(mandatory)*

### Functional Requirements

**Moving devices**

- **FR-001**: The system MUST add a `Device.move` permission for moving devices and for
  onboarding a discovered source into another organization. Organization Admin holds it
  through the permission ceiling
  ([access](../../docs/features/access.md#permission-ceiling)). A move MUST need
  `Device.move` in both the source and the target. Existing permissions still apply:
  - the successor arrives active only when the mover holds `Device.activate` in the
    target;
  - moving or copying a dashboard needs `Dashboard.create` in the target, and moving an
    automation needs permission to manage automations in the target (FR-030);
  - a moved direct device's credentials and settings need `Device.manage-connections`.
- **FR-002**: The source and the target MUST be in the same billing account when the
  move is confirmed. Organizations of other accounts MUST NOT appear as targets, and
  requests naming them MUST get not found.
- **FR-003**: A move MUST cover 1 to 100 devices of one source, going to one target. In
  **Where to**, an owner of the account with room under its organization limit MUST be
  able to create the target organization, under the same rules as the **Billing
  accounts** page ([spec 023](../023-billing-accounts/spec.md)), and continue the move
  with it. Leaving the move afterwards keeps the new organization.
- **FR-004**: A move MUST be refused, with the reason, when any of its devices:
  - is archived;
  - has a configuration or lifecycle operation still waiting for the runtime;
  - is already part of a move in progress.
- **FR-005**: A move MUST be one bulk action in four steps: **Where to**, **What comes
  along**, **Confirm** and **Done**, started from the device list's selection or a
  device's menu. **What comes along** MUST show, in one list:
  - each device, its successor's name and code (prefilled, codes unique in the target)
    and an optional target site;
  - how each device reports, and whether that connection stays with the pipe owner or
    moves with the device;
  - every source dashboard and automation that uses a moving device, with a preselected
    choice (FR-030);
  - the open alerts, geofence assignments and integration application grants that end;
  - the profile versions to be copied, with the codes the copies will get;
  - which successors will arrive inactive (FR-008);
  - that the pipe owner's members can see the raw messages its pipe carries.

  Accepting every preselected choice MUST be enough to complete a move.
- **FR-006**: The mover's confirmation MUST be the only approval a move needs. The
  target MUST NOT have to accept it. **Confirm** MUST summarize the move in plain
  sentences and list anything to be archived on its own, needing its own confirmation.
  **Done** MUST link to everything moved, copied and archived, and list what still
  needs someone in the target, such as an automation to turn on.

**Cutover**

- **FR-007**: Cutover MUST happen as one step. If any part fails, nothing changes. At
  cutover:
  - each predecessor is deactivated and archived as **Moved to *target***;
  - each successor is created in the target, linked to its predecessor, reporting from
    the same source;
  - each successor gets a copy of the predecessor's configuration, name, tags and custom
    attributes, and of the profile version it used (FR-011);
  - open alerts on each predecessor are cleared as **Device moved**;
  - each predecessor's unsent commands end, and possibly sent ones become uncertain, as
    on a deactivation;
  - geofence assignments of the predecessors end, and running captures on them stop;
  - each listed dashboard and automation is moved, copied, kept or archived as chosen
    (FR-030 to FR-037).
- **FR-008**: A successor MUST take its predecessor's state: an active predecessor gives
  an active successor when the mover holds `Device.activate` in the target, and an
  inactive successor otherwise. Activating a carried-over configuration MUST NOT need
  re-mapping.
- **FR-009**: Readings MUST NOT be copied or moved.
  - The predecessor keeps its readings under the source's retention.
  - The successor's readings are stored only for the target, under the target's
    retention.
  - After cutover, no reading from the device is stored for the source.
- **FR-010**: Linked devices MUST show the other organization's name, the direction
  (**Moved to** or **Moved from**) and the cutover time. Neither MUST reveal anything
  else of the other organization.
- **FR-011**: Each profile version a successor uses MUST exist in the target:
  - platform templates are used as they are;
  - otherwise the version is copied once per target, and later moves and onboardings
    into that target reuse the copy;
  - a copy keeps the profile's code unless the target already uses it, in which case it
    gets a distinct code that the review shows.
- **FR-012**: A move MUST NOT change the account's count of devices against its device
  limit, MUST NOT be refused because of that limit, and MUST NOT count a moved device
  twice in the month's peak.
- **FR-013**: Both organizations' activity logs MUST record each move: the mover, the
  devices, the source, the target and the cutover time.

**Pipes and hosted devices**

- **FR-020**: A pipe MUST stay with its pipe owner when devices move. A hosted device
  MUST report through it with no change to the pipe, its credentials, its decoder or
  the physical device. A move MUST NOT copy a pipe, its decoder or its credentials into
  the target.
- **FR-021**: The target's members MUST see of a hosted device's pipe only:
  - its kind (adapter or gateway) and name;
  - the pipe owner's name;
  - whether it is online;
  - the metrics it announces for that device's source.

  Its credentials, decoder, settings, deliveries, other sources and Discovery MUST stay
  not found to them.
- **FR-022**: The pipe owner's members MUST see, for each source of a pipe, the
  organization it is in use in, and per pipe, the number of hosted devices in each
  organization. They MUST NOT see the hosted device's record, configuration or stored
  readings unless they are members of that organization. What a pipe already shows of
  the raw messages it carries (deliveries, samples, previews) stays visible to the pipe
  owner.
- **FR-023**: The pipe owner MUST NOT be able to archive or delete a pipe that serves
  hosted devices, or onboard or reject a source in use by one. The refusal MUST name the
  organizations and device counts.
- **FR-024**: Pausing, redeploying or rolling back an adapter, changing its decoder, and
  rotating a pipe's credentials MUST first show a confirmation naming the organizations
  and the number of hosted devices affected.
- **FR-025**: When the metrics a hosted device's source announces change, the hosted
  device MUST need review in its organization, as other devices do.
- **FR-026**: Offline alerts for a pipe MUST go to the pipe owner. Offline alerts for a
  hosted device MUST go to the organization that has the device
  ([offline alerts](../../docs/features/alerts.md#offline-alerts)).
- **FR-027**: A directly connected device's gateway MUST move with the device and keep
  its credentials, firmware settings and message topic. From cutover, the source MUST NOT
  see its credentials or download its settings or kits.
- **FR-028**: Until a moved direct device's credentials are rotated, the target MUST see
  a warning that the source's members knew them. A target member with
  `Device.manage-connections` MUST be able to rotate them at any time. Rotation stops
  the old credentials at once and issues new settings.

**Dashboards and automations**

- **FR-030**: Every dashboard and automation of the source that uses a moving device
  MUST be listed as using only moving devices or other devices too, with these choices
  (preselected first):
  - dashboard, only moving devices: **Move**, **Keep in source**, **Archive in source**;
  - dashboard, other devices too: **Copy the moving devices' panels** (the original
    stays), **Don't copy**;
  - automation, only moving devices: **Move**, **Keep in source**, **Archive in
    source**;
  - automation, other devices too: **Keep in source**, **Archive in source**. It MUST
    NOT be movable, and it MUST NOT block the device move.

  Archiving MUST never be preselected. A choice that needs a permission the mover lacks
  (`Dashboard.create` in the target to move or copy a dashboard, permission to manage
  automations in the target to move one, the matching permission in the source to
  archive) MUST NOT be offered.
- **FR-031**: For an automation that also uses devices that aren't moving, the list MUST
  offer to add those devices to the move when the mover may move them, and then
  recompute every choice.
- **FR-032**: A moved dashboard MUST leave the source and appear in the target with its
  name, layout and panel settings, using the successors wherever it used the
  predecessors. It keeps its owner and its shares with people who are members of the
  target; otherwise the mover owns it. Shares that can't come along MUST be listed
  before confirming.
- **FR-033**: A copied dashboard MUST hold only the panels and panel sources of moving
  devices, using the successors, and leave out panels left with no source. It belongs to
  the mover and isn't shared. What each copy leaves out MUST be listed before
  confirming. The original stays in the source, unchanged.
- **FR-034**: A move MUST NOT change any dashboard that stays in the source. Panels that
  use a predecessor MUST keep showing its history up to cutover and mark the device as
  moved, and the dashboard MUST stay editable and savable without changes
  ([dashboards](../../docs/features/dashboards.md#access-and-sharing)).
- **FR-035**: A moved automation MUST leave the source and appear in the target using
  the successors wherever it used the predecessors.
  - Alert recipients who are members of the target and can view devices stay; the
    others are removed and listed before confirming.
  - It keeps running only when it was running, automations are turned on in the target
    (or the move turns them on, FR-039), the mover may activate automations there, and
    it sends no device commands. Otherwise it arrives off.
  - Its run history up to cutover stays with the source.
- **FR-036**: An automation that stays in the source MUST NOT keep using a moved device.
  If it still refers to one, it MUST be suspended, naming the moved device, until a
  source member removes the device and activates it again. The list MUST say so before
  confirming.
- **FR-037**: The system MUST add archiving for dashboards and automations, as devices
  have it: an archived item is turned off (automations), hidden behind **Show
  archived**, and can be restored by a member with the matching permission. A restored
  automation comes back off. Archiving is available outside moves too.
- **FR-038**: No dashboard or automation MAY use devices of two organizations.
- **FR-039**: When an automation moves to an organization where automations are turned
  off, the review MUST say before confirming that nobody can change or turn it on there
  until they are turned on.
  - A mover who holds what turning them on needs there (`Workflow.activate`, as for the
    settings toggle) MUST be offered to turn them on as part of the move. It MUST NOT be
    preselected. The cutover turns them on before the automations move and records it
    in the target's activity, and fails the move if the mover lost that permission.
  - Otherwise **Done** MUST list each such automation until automations are turned on.
  - Reading a moved automation and the node catalog MUST NOT need automations turned
    on. Its editor MUST say automations are off, where they are turned on and who can,
    rather than report the node catalog as unavailable.

**Onboarding into another organization**

- **FR-040**: When onboarding a discovered source of a pipe, a member with `Device.move`
  in both organizations, and permission to onboard devices in the chosen one, MUST be
  able to create the device in any organization of the account. The pipe owner MUST be
  the default.
- **FR-041**: A device onboarded into another organization MUST be a hosted device under
  FR-020 to FR-026, with its profile version made available under FR-011.

**Moving with the assistant**

- **FR-045**: The assistant MUST be able to prepare a move from a request in the chat,
  offering only targets in the same account where the person holds `Device.move`, and
  asking when the target or devices are unclear.
- **FR-046**: The assistant MUST present the prepared move as an action card holding the
  **What comes along** list with the same preselected choices as the bulk action, which
  the person can change. Nothing MUST change until the person confirms in the card; the
  assistant MUST NOT confirm a move by itself. A confirmed card MUST follow every rule
  of FR-001 to FR-038.

**History across the move**

- **FR-050**: The review MUST offer **Include readings from before the move** for the
  whole move, off by default.
- **FR-051**: With the option on, every history view of the successor in the target
  (charts, tables, exports, dashboard panels and the API) MUST include the whole history
  the predecessor had before cutover, earlier moves included, as long as the
  organizations that recorded it still hold it. Readings recorded in another
  organization are labelled as recorded in the source (ADR-041).
- **FR-052**: The target, and every device moved on from it, MUST stop seeing the
  readings that crossed a move when a source member with `Device.move` stops it on the
  predecessor, or when either organization leaves the account.
- **FR-053**: Every history view of a successor MUST include the readings of each earlier
  predecessor in its chain of moves that is in the successor's own organization, up to
  that predecessor's cutover, under the successor's organization and retention, labelled
  as the device's own. This MUST NOT depend on the history option of any move in the
  chain, and FR-052 doesn't end it. The review MUST say when a device it moves
  reconnects this way.

**Isolation and compatibility**

- **FR-060**: Automated tests MUST prove that:
  - members of the target only can't reach the pipe beyond FR-021;
  - members of the source only can't reach the successor or its readings;
  - after cutover, the source stores no reading for the device and can't read a moved
    direct device's credentials or settings;
  - readings from before cutover reach the target only through moves with the option
    on, or from the target's own organization (FR-053), and only within the account;
    stopping a move ends what crossed it for every device after it;
  - organizations outside the account get not found for every part of a move.

  When spec 003's isolation check exists, these MUST be part of it.
- **FR-061**: An organization MUST NOT leave its account while it has hosted devices or
  its pipes serve hosted devices in other organizations. The refusal MUST list them.
- **FR-062**: Behaviour for organizations that never move devices MUST NOT change.
  Existing roles MUST NOT change, except that Organization Admin gains `Device.move`
  through its ceiling. Archiving dashboards and automations (FR-037) is the only new
  behaviour they see.

### Key Entities

- **Device move**: the source, target and mover; the devices; the carried items; whether
  readings from before the move are included; how it was started (bulk action or
  assistant); its status (in progress, completed or failed) and the cutover time.
- **Carried item**: a dashboard or automation listed in a move, whether it uses only
  moving devices, the chosen action (move, copy, keep or archive), what it left out
  (panels, shares, recipients), and the item it became in the target.
- **Device link**: connects a predecessor to its successor, with both organizations, the
  cutover time, and whether the successor may read the predecessor's history and until
  when.
- **Hosted device**: a device whose source belongs to a pipe of another organization in
  the same account.
- **Profile copy**: a profile version in a source and its copy in a target, so later
  moves and onboardings reuse the copy.
- **Archived dashboard or automation**: hidden behind **Show archived**, turned off for
  an automation, with who archived it, when, and whether a move did.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An integrator moves 20 adapter-backed devices to a customer's organization
  in under three minutes from the device list, without changing the adapter, its vendor
  credential or the vendor account.
- **SC-002**: When the successors arrive active, their readings appear in the target
  within one minute of cutover, and no reading after cutover is stored for the source.
- **SC-003**: Every dashboard kept in the source that used a moved device still shows
  its history up to cutover and saves without edits.
- **SC-004**: Moved and copied dashboards show the successors' new readings with no
  editing, and a moved alert automation that met the conditions to keep running raises
  its next alert in the target with no editing.
- **SC-005**: Automated tests cover every rule in FR-060. None lets a target-only member
  reach a pipe's credentials, decoder or other sources, or lets any organization outside
  the account see any part of a move.
- **SC-006**: The account's device count and the month's peak are the same before and
  after a move.
- **SC-007**: Organizations that never move devices see no change. The existing
  automated suite passes without changes.
- **SC-008**: In a first real use, an integrator moves tracker devices from one adapter
  into a customer's organization, the customer's members see only those devices, and
  nobody copies a vendor credential.
- **SC-009**: An integrator moves two devices that have their own dashboard and alert,
  accepting every preselected choice, in under one minute and four steps, and a
  first-time user does it without help.
- **SC-010**: No move leaves a dashboard or automation using devices of two
  organizations, or an automation in the source silently running on a moved device.

## Assumptions

- Both organizations are in one billing account. A billing account grants no access by
  itself ([spec 023](../023-billing-accounts/spec.md)), so the mover is a member of both.
- The pipe owner operates the pipe, so its members can see the raw messages that pass
  through it, including those of hosted devices. The review states this.
- A pipe owner keeps its pipes even when none of its own devices use them.
- Readings that arrive between the predecessor stopping and the successor starting are
  stored for neither organization; the gap is under one minute.
- Moves send no email. They appear in both organizations' activity logs.
- **Out of scope for this spec:**
  - moves between organizations of different accounts (spec 016);
  - moving or copying a pipe itself, such as an adapter or a gateway with all its
    devices, to another organization;
  - switching a hosted device to a pipe the target sets up with its own vendor
    credential;
  - moving automations that also use devices which aren't moving, and moving
    geofences or geofence rules;
  - dashboards that show devices from several organizations, such as an account-level
    overview;
  - bulk onboarding into another organization;
  - moving sites or entities (spec 009, in draft).

  Each is a candidate follow-up.
- Super administrators and platform administrators keep their current access. This spec
  gives them nothing new.
- The plan will propose the ADR for hosted devices and history across a move, and the
  matching amendment to constitution principle III, in the same pull request as the
  plan.
