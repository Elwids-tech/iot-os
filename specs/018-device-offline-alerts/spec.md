# Feature Specification: Device Offline Alerts

**Feature Branch**: `spec/018-device-offline-alerts`

**Created**: 2026-10-25

**Status**: Draft; clarifications answered by the owner on 2026-10-25; re-checked on
2026-10-30 against polling adapter sources (spec 020), device review (ADR-025), polled
automation freshness and the alert bell (spec 022)

**Input**: "I think Offline alerts should be something that is common for any device.
You'll have to check for edge-cases. But in general there should be Offline Alerts. But
unless configured other channels should not receive the notifications. Should only
receive only when opted in or configured for a specific channel."

Follow-up on 2026-10-30: the owner wants custom offline times per device profile, with
device-level overrides, because their devices report anywhere from every minute to
once a day, and asked how offline alerts relate to automation alerts.

## Context

Today the platform knows a device's **presence** (online, offline or unknown), but
nothing turns a device going offline into an alert:

- **Presence comes from Sparkplug births and deaths.** A death certificate from a
  device, or from the gateway (edge node) it sits behind, marks it offline within
  seconds. When the runtime loses its own broker connection, every device on that
  connection becomes *unknown*, not offline.
- **Silence does not change presence.** A sensor behind a live gateway that stops
  sending stays "online" for as long as the gateway lives. Devices that arrive through
  a device adapter (from a vendor broker, an HTTP webhook or a polled vendor API, spec
  020) never get a death certificate of their own: the adapter's managed publisher
  only sends a death for its own node, so a silent vendor device, or one whose vendor
  broker or API has gone away, looks online indefinitely.
- **An adapter's own deaths are the platform's.** The publisher sends its node death
  whenever the adapter is redeployed (activating a device through it redeploys it),
  its runtime restarts, or a platform deploy replaces that runtime. The death marks
  every device of the adapter offline. The publisher keeps its sources' births on disk
  and announces them again seconds later, but a source it holds no birth for stays
  offline until its next reading: up to an hour for an hourly tracker, a day for a
  daily one. A birth announced again is the publisher repeating itself, not the vendor
  device reporting.
- **Polled readings arrive late and in bursts.** A polling adapter fetches the vendor's
  records every 1 minute to 24 hours (5 minutes by default) and publishes each reading
  with the time the vendor observed it. The platform receives a reading up to one poll
  interval, plus the vendor's own upload delay, after it was observed, and receives a
  device's readings together, once per poll run. Gaps between receipts therefore say
  little about how often the device reports. Automation freshness already counts from
  the observed time and is sized from the poll interval.
- **Alerts come only from automations.** An alert episode exists only when an
  authored workflow raises one. Spec 014's *No data* node (specified, not built) would
  alert on one silent parameter, but someone has to build a workflow per device (at
  most 32 bindings each), so it cannot be the fleet-wide answer.
- **Notifications are opt-in per workflow.** Email is off by default; an administrator
  chooses recipients per workflow, and each person's **Settings → Email** grid can turn
  sources off. Since spec 022, each recipient also finds the alert in the bell in every
  page header, which chimes on a new activation.
- **Integration webhooks are not filtered by event type.** An application's event feed
  and webhook receive every event for the devices it is granted, so a new alert event
  type would reach every existing receiver unless this feature gates it.

The first partner pilot made the gap concrete: if a thermal fire-watch box loses power
or network, nobody is told. Its devices also showed that one threshold cannot fit
everyone: they report anywhere from every minute to once a day, through gateways,
vendor brokers, webhooks and polled vendor APIs.

This feature makes offline alerts a built-in behaviour of every active device: they
always appear in the platform, and they reach the bell, email, chat, SMS or
integrations only where a person opted in or an administrator configured that channel.

**Terms**: *Packet* is any Sparkplug message the platform receives from a device or on
its behalf (birth or data). For a device fed by a device adapter, only a new reading
counts as hearing from it: not a birth the adapter announces again, and not a history
record older than readings already received. *Last seen* is when the platform last
heard from the device, by its receipt time. *Silence* is the time since then. *Observed time* is when a
reading was taken, as the device or vendor reports it. A device's *reporting interval*
is its usual time between readings, measured from observed times where the source
provides them, otherwise from receipt. A *poll interval* is how often a polling adapter
fetches the vendor's records. *Offline after* is the silence after which a device counts
as offline. *Grace period* is how long a device must stay offline before an episode
opens, and stay back before it clears. A *platform-side interruption* is anything on the
platform's side that stops it hearing from devices: a runtime restart, a deploy, the
platform's own broker restarting, the runtime losing its broker connection, an
organization's adapter runtime failing, restarting or being redeployed (the adapter's
node death), or ingestion being stopped. A *route* is an administrator's rule that sends
offline alerts for a set of devices to recipients or a channel destination. A *personal
subscription* is a member's own opt-in.

## Clarifications

### Session 2026-10-25

- Q: When a profile does not say how often its devices report, how long may a device
  stay silent before it counts as offline? → A: 15 minutes, settable per profile and
  device. Profiles whose devices report less often show a warning (FR-004). Revised on
  2026-10-30 (below).
- Q: When a gateway with many devices goes down, is that one alert or one per device?
  → A: One gateway alert listing the affected devices; devices open their own episodes
  only if they stay silent after the gateway returns (FR-011, FR-012).

### Session 2026-10-30

- Q: When neither a device nor its profile sets *Offline after*, how should the
  platform pick it? → A: Automatically per device: three times its reporting interval
  plus its poll interval, at least 15 minutes and at most 7 days, shown as
  "Automatic". A device is judged by silence once it has sent three readings; deaths
  count at once (FR-004).
- Q: When spec 014's *No data* node is built, should its period start from the device's
  *Offline after* and count silence from receipt, like offline alerts? → A: Yes. Its
  period defaults to the bound device's *Offline after* and stays editable per node;
  binding freshness stays separate (FR-036, FR-037).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See offline devices without building anything (Priority: P1)

An operator opens **Alerts** and sees "Device offline: Hot work box 2 (Site A), last
seen 14:02" next to their automation alerts. Nobody authored a workflow for it. The
device page and the device directory show the same state. When the box comes back, the
alert clears by itself. No email was sent, because nobody asked for one.

**Why this priority**: losing contact with a device is the most common failure in any
IoT deployment, and today it is invisible unless someone happens to look.

**Independent Test**: in the local stack, stop the simulator for one always-connected
device: an offline alert opens after the grace period, with the device's last-seen time
and the cause "death certificate". Restart the simulator: the alert clears. No delivery
of any kind, and no bell notification, is recorded for it.

**Acceptance Scenarios**:

1. **Given** an active, always-connected device with default settings, **When** it
   sends a death certificate and stays offline for the grace period, **Then** one
   offline alert opens, shows the cause, the last-seen time and the threshold in effect,
   and appears in the Alerts inbox, the Event log and on the device page.
2. **Given** an open offline alert, **When** the device reports again and stays online
   for the grace period, **Then** the alert clears with the time it came back.
3. **Given** a device that drops and returns within the grace period, **When** the
   grace period ends, **Then** no alert exists, and the device page still shows the
   brief disconnection in its presence history.
4. **Given** a device behind a live gateway that stops sending without a death
   certificate, **When** its silence passes its *Offline after*, **Then** an offline
   alert opens with the cause "missed check-in".
5. **Given** a device fed by a device adapter, **When** the vendor device stops
   sending, **Then** it is detected by silence alone, like a gateway child; the
   adapter's own births and deaths neither keep it online nor take it offline.
6. **Given** a device fed by a polling adapter, **When** it keeps reporting normally,
   **Then** the wait between poll runs never opens an episode, and an alert that does
   open shows both when the platform last heard from it and when its last reading was
   observed.
7. **Given** no personal subscriptions and no routes, **When** any offline alert opens
   or clears, **Then** no bell notification, email, chat message, SMS or webhook
   delivery is created.

---

### User Story 2 - Opt in to be told (Priority: P1)

A site supervisor wants an email when any device at their site goes offline, and
another when it is back. They open **Settings → Notifications → Device offline**, add a
personal subscription for Site A with recovery notices on, and get exactly that: the
email, and the same alert in their bell, which chimes while the portal is open. An
administrator separately adds a route that emails the maintenance lead about every
critical fire-watch device in the organization.

**Why this priority**: an alert nobody hears about at night is little better than none,
but sending it to people who did not ask is the behaviour the owner ruled out.

**Independent Test**: add a personal subscription for one site; take a device at that
site offline and one at another site offline; exactly one email arrives, and one bell
notification, for the first. Bring it back; a recovery email and a silent **Cleared**
bell notification arrive because recovery was chosen. Turn **Device offline** off in
the person's **Settings → Email** grid; repeat; no email arrives, but the bell still
shows both.

**Acceptance Scenarios**:

1. **Given** a member who can view devices, **When** they subscribe themselves to
   offline alerts for chosen sites, tags, device profiles or devices, or for every
   device they can view, **Then** they receive one activation email and one bell
   notification per episode for matching devices and nothing for others.
2. **Given** a member with permission to manage notifications, **When** they configure
   a route with a device scope, a minimum severity and recipients, **Then** those
   recipients receive matching offline alerts unless they have turned the source off
   in their own preferences.
3. **Given** a subscriber who chose recovery notices, **When** an episode clears,
   **Then** they receive one recovery notice, and only if they received its activation.
4. **Given** an episode that clears before its activation notice is sent, **When** the
   sender picks it up, **Then** the activation notice is cancelled.
5. **Given** a recipient who has lost access to the device, been removed from the
   organization or turned off all emails, **When** a notice is about to be sent,
   **Then** it is cancelled.
6. **Given** a member who cannot view a device, **When** they create a subscription,
   **Then** that device is never part of it.
7. **Given** a member who is not subscribed and is on no route, **When** an offline
   alert opens, **Then** it appears on the Alerts page and in the sidebar's Alerts
   count for them, but not in their bell, and no chime plays.

---

### User Story 3 - No false alarms from the platform (Priority: P1)

The platform deploys a release at 02:00; the runtime restarts, the broker briefly
drops every connection, and each organization's adapter runtime is replaced. No
customer gets an offline alert, and no device's silence clock runs while the platform
could not hear it. The same holds at 10:15 when an administrator activates one more
tracker through an adapter, which redeploys it: the adapter's other hourly trackers do
not go offline.

**Why this priority**: a single deploy that pages every customer would teach them to
ignore offline alerts. The platform's own failures are the operators' problem, already
covered by service monitoring.

**Independent Test**: with devices online and a subscription in place, restart the
runtime, restart the broker, redeploy a polling adapter whose simulated vendor reports
every 10 minutes, and run the release's checkpoint window. No offline alert opens, no
device shows offline, and no notice is sent. Then stop one device's simulator just
before restarting the runtime: its alert opens only after its full threshold, counted
from when the runtime was back.

**Acceptance Scenarios**:

1. **Given** a platform-side interruption, **When** devices become unknown, **Then** no
   offline episode opens or clears, and the device pages say presence is unknown and
   why.
2. **Given** a device that went silent during an interruption, **When** the platform
   recovers, **Then** its silence counts from the end of the interruption, and it is
   alerted only if it stays silent for its full threshold after that.
3. **Given** an open offline episode, **When** a platform-side interruption occurs,
   **Then** the episode stays open; unknown never clears it.
4. **Given** the control plane is down while devices go offline and come back,
   **When** it returns, **Then** the episodes are recorded with their true times, and
   activation notices for episodes that already cleared are not sent.
5. **Given** an adapter is redeployed, restarted or replaced by a platform deploy,
   **When** its node death arrives, **Then** none of its devices opens an episode or
   shows offline; they show unknown ("adapter restarting") until the adapter is back,
   and the time it was down is left out of each device's silence. Activating devices
   through it one after another never postpones an alert for a device that stays
   silent.
6. **Given** an adapter that announces its devices' births again after a restart,
   **When** a device has not sent a new reading since, **Then** the repeated birth does
   not count as hearing from it, and its last-seen time does not move.

---

### User Story 4 - One message for a gateway or site outage, not hundreds (Priority: P2)

A gateway with 40 sensors loses power. The operator gets one "Gateway offline" alert
listing the 40 devices, not 40 alerts. Separately, a site-wide power cut takes 120 direct
devices down; each subscriber gets one summary email per channel.

**Why this priority**: mass outages are when people most need clear information, and
when a per-device design would bury them.

**Independent Test**: kill a simulated gateway with 10 child devices: exactly one
gateway alert opens, listing all 10, and each subscriber gets one notice. Stop 50 direct
simulators at one site within a minute: each subscriber gets one summary notice.

**Acceptance Scenarios**:

1. **Given** a gateway with child devices, **When** the gateway dies or goes silent,
   **Then** one gateway offline alert opens listing its devices, each device shows
   "offline because gateway *name* is offline" and opens no episode of its own, and each
   subscriber receives one notice per channel.
2. **Given** an open gateway alert, **When** the gateway returns but some of its devices
   do not, **Then** those devices open their own episodes once their own *Offline
   after* has passed, counted from the gateway's return.
3. **Given** many devices going offline within a few minutes, **When** notices are
   due for one recipient on one channel, **Then** the first is sent at once and the
   rest within the next five minutes are combined into one summary listing the devices
   by site. The bell lists each alert and chimes once, as spec 022 does for any burst.
4. **Given** the platform loses its connection to a broker the organization operates
   (an external Sparkplug connection or an adapter's vendor broker), or a polling
   adapter's requests to the vendor's API keep failing, **When** this lasts past the
   grace period, **Then** one "Connection lost" alert opens for the connection or
   adapter, and its devices show unknown rather than each opening an episode.

---

### User Story 5 - Tune detection, and mute for maintenance (Priority: P2)

A water utility's meters report once an hour and disconnect between reports. Their
administrator sets the meter profile to **Connects to report** with **Offline after:
3 hours**, so a meter is alerted only when it misses its check-ins. Their asset
trackers arrive through a polling adapter that fetches the vendor's API every 15
minutes; most report every 5 minutes, but one, parked in a yard, reports once a day.
The tracker profile leaves *Offline after* on **Automatic** (here 30 minutes: three
5-minute reports plus the 15-minute poll), and the parked tracker gets its own
**Offline after: 3 days**. Before replacing a pump, a technician mutes offline
alerts for the pump-house site until 17:00.

**Why this priority**: without tuning, periodic and polled devices would raise an alert
after every report or every poll; without muting, planned work pages people for
nothing.

**Independent Test**: set a profile to *Connects to report* with *Offline after* 5
minutes; a device that reports every 2 minutes and sends a death after each report
raises no alert; stop it and an alert opens about 5 minutes after its last report. Run
the simulated polled vendor with a 2-minute reporting interval behind a 5-minute poll
and default settings for 30 minutes: no alert. Set its *Offline after* to 3 minutes:
the profile warns and suggests a longer value. Mute a device for 10 minutes and stop
it: no episode opens until the mute ends and the grace period passes.

**Acceptance Scenarios**:

1. **Given** a profile set to *Connects to report*, **When** its devices send a death
   certificate after each report, **Then** no episode opens; only silence beyond
   *Offline after* counts, and a report clears an open episode at once.
2. **Given** a profile with *Offline after*, grace period, severity and offline alerts
   on or off, **When** a device overrides any of them, **Then** the device's value
   applies to that device only.
3. **Given** a device fed by a polling adapter, **When** the device page or its
   profile shows its offline settings, **Then** it shows the device's reporting interval,
   the poll interval, and the *Offline after* in effect with where it came from (the
   device, the profile or the default).
4. **Given** a profile or device whose *Offline after* is shorter than its devices'
   reporting interval plus their poll interval, **When** it is shown or saved, **Then**
   a warning names the affected devices and suggests a value.
5. **Given** a device, gateway, site or profile muted until a time, **When** a device
   in it goes offline, **Then** no episode opens; the device page shows it muted, by
   whom, why and until when.
6. **Given** an episode already open when a mute starts, **When** the device comes
   back during the mute, **Then** the episode clears in the platform but no recovery
   notice is sent.
7. **Given** a mute that ends while a device is still offline, **When** the grace
   period passes, **Then** an episode opens and notifies as usual.
8. **Given** a device that opens more than 3 episodes within 60 minutes, **When** it
   drops again, **Then** the episode is recorded but notifies nobody until 60 minutes
   pass without a new episode, and the next notice says how many were held back.

---

### User Story 6 - Integrations choose to receive connectivity events (Priority: P3)

An integration that runs the customer's on-call tool turns on **Device connectivity
events** for its application and starts receiving offline and back-online events
through its webhook. Every other application keeps receiving exactly what it received
before.

**Why this priority**: valuable for customers who route alerts through their own
tools, but email and the inbox cover the pilot's need first.

**Independent Test**: with two applications granted the same device, enable
connectivity events on one; take the device offline; only that application's feed and
webhook carry the event.

**Acceptance Scenarios**:

1. **Given** an existing application, **When** this feature is released, **Then** its
   event feed and webhook carry no connectivity events.
2. **Given** an application that enabled connectivity events, **When** a granted device
   goes offline or comes back, **Then** its feed and webhook carry the event; events
   for ungranted devices never appear.

---

### Edge Cases

- **Never connected.** A device that has never been activated, or is active but has
  sent nothing since activation, raises no alert and shows "waiting for first report".
  Monitoring starts with its first packet. With an automatic *Offline after*, silence
  is judged from its third reading ("learning how often it reports" until then).
- **Reporting interval changes.** A device that starts reporting less often raises its
  automatic *Offline after* as the new gaps complete; a device that stops entirely
  does not, because a silence in progress is never part of the interval.
- **Deactivated, archived or transferred.** Deactivating marks a device offline today;
  that must never open an episode. An open episode ends with a stop reason ("device
  deactivated"), not "cleared", and sends no recovery notice.
- **Offline alerts turned off** for a device or its profile while an episode is open:
  the episode ends with a stop reason.
- **New configuration or profile version.** Activating one neither opens nor clears an
  episode and does not reset the silence clock.
- **Presence unknown for device reasons** (a telemetry hand-off failed, or a birth
  changed approved metrics and needs review): the device is still sending, so it is not
  offline. Review now follows the source's current birth (ADR-025), so a device that
  was briefly in review is neither offline nor kept unknown once a compatible birth
  arrives.
- **Late or stale deaths.** A death certificate from an earlier session that arrives
  after a new birth does not mark the device offline.
- **Clock skew.** Silence and episode times use the time the platform received packets,
  never the device's own timestamps.
- **Direct devices** (each its own edge node, no children) are devices, not gateways:
  one device alert.
- **Adapter runtime failure, restart or redeploy.** The organization's adapter runtime
  is platform infrastructure. Its failure, a restart, a redeploy (including the one
  that activating a device through the adapter causes) and its replacement by a
  platform deploy are platform-side interruptions, reported to operators where they
  are failures, never a customer-facing offline alert for every adapter device.
- **Paused adapter.** A person who pauses an adapter stops its readings on purpose. Its
  devices show unknown ("adapter paused") and are not judged by silence until it
  resumes; the paused time is left out of their silence.
- **Births announced again.** After a restart the adapter announces the births it kept
  on disk. They are not evidence that any vendor device reported, so they neither
  count as hearing from a device nor move its last-seen time; they only end the
  interruption.
- **Vendor broker or API gone.** When an adapter's vendor broker is unreachable, or its
  polls of the vendor's API keep failing (retrying with back-off, or stopped on an
  error such as a rejected API key), the platform raises one connection alert instead
  of each vendor device going silent separately. When polling recovers, the vendor's
  backlog arrives; devices with new readings in it are heard, and the others are judged
  from the recovery.
- **Polled devices.** Readings reach the platform one poll run at a time, up to one
  poll interval plus the vendor's upload delay after they were observed. A device that
  reports every minute behind a 15-minute poll is silent for up to 15 minutes between
  runs while perfectly healthy; one that reports daily behind an hourly poll, for up to
  25 hours. Its reporting interval is measured from observed times, because receipt
  gaps inside one run are near zero. Silence and alert times still use receipt, so a
  device's wrong clock cannot open or hide an episode.
- **Poll interval changes.** A new adapter revision with a different poll interval
  changes the automatic *Offline after* and the warning for its devices from the next
  evaluation; a value someone set on the profile or device is never changed for them.
- **History and backfills.** A cursor reset or backfill delivers readings older than the
  device's newest; they are history, not a sign of life. A store-and-forward device
  that uploads its backlog after a gap is heard when its newest reading arrives.
- **Webhook sources.** A webhook adapter has no connection to lose. If the vendor stops
  calling it, each device goes silent on its own schedule; summaries keep that to one
  notice per recipient and channel.
- **Site outage.** Many direct devices dropping at once produce one alert each in the
  inbox, grouped by site, but one summary notice per recipient and channel.
- **Device moves site or tags while offline.** Subscriptions and routes are matched
  when the episode opens; its recovery notice goes to whoever received the activation.
- **Recipient loses access** between activation and recovery: the recovery notice is
  cancelled.
- **Flapping.** The grace period absorbs short drops; repeated episodes beyond the
  flapping limit are recorded but held back from notification.
- **Mute expiry** with the device still offline opens an episode after the grace
  period.
- **Rollout on existing fleets.** Devices already offline or silent beyond their
  threshold when monitoring starts (at release, or when a profile turns it on) open no
  episode and show "offline since before monitoring started"; they are monitored from
  their next packet. Release creates no routes or subscriptions, so it sends nothing.
- **Shared devices** (spec 016, not built): only the owning organization gets offline
  alerts until that spec decides otherwise.
- **Acknowledgement** records who saw the alert; it does not clear it, mute the device
  or stop the recovery notice. Opening the alert marks its bell notifications read, as
  for any alert (spec 022).
- **Automation alerts on the same device.** A device that goes offline makes its
  automation bindings stale, which only makes them unknown: unknown never opens or
  clears an automation alert. A *No data* node, once spec 014 builds it, would open its
  own alert. Both alerts then appear; they answer different questions (is the device
  there, and has this value gone quiet), and neither suppresses the other.

## Requirements *(mandatory)*

### Functional Requirements

#### Detection

- **FR-001**: Every active device MUST be monitored for going offline by default,
  without anyone authoring an automation. A device profile MAY turn offline alerts off
  for its devices, and a device MAY override its profile either way.
- **FR-002**: A device MUST count as offline when (a) its connection style is *Stays
  connected* and it, or the gateway it sits behind, sent a death certificate, or (b)
  its silence exceeds its *Offline after*. Unknown presence MUST never count as offline.
  Silence MUST be measured by the platform's receipt time. For a device fed by a device
  adapter, only a new reading MUST count as hearing from it; a birth the adapter
  announces again, or a reading older than the newest already received from that
  device, MUST NOT.
- **FR-003**: A profile MUST offer two connection styles: **Stays connected** (the
  default; a death certificate or silence counts) and **Connects to report** (death
  certificates are expected and ignored; only silence counts). Devices fed by a device
  adapter MUST use **Connects to report** whatever their profile says, and their
  settings MUST say why: the adapter sends no death of its own for them, and its node
  deaths are platform-side (FR-006).
- **FR-004**: *Offline after* MUST be settable per profile and per device, between 1
  minute and 7 days. When neither sets it, a device MUST use an **automatic** value:
  three times its reporting interval plus its poll interval (zero when not polled),
  rounded up to a minute, at least 15 minutes and at most 7 days, shown as "Automatic"
  with the intervals it came from. The reporting interval MUST be the median gap
  between the device's recent readings, up to 7 days back; the automatic value follows
  it as it changes, and a silence still in progress never counts towards it. Until a
  device has sent three readings in that window, it MUST NOT be judged by silence; a
  death certificate still counts for a *Stays connected* device.
- **FR-004a**: The platform MUST show each monitored device's reporting interval and,
  for a device fed by a polling adapter, its poll interval. Where an *Offline after*
  set on a device or its profile is shorter than the device's reporting interval plus
  its poll interval (the longest a healthy device is silent), the device page and the
  profile MUST warn, name the affected devices, and suggest the automatic value.
- **FR-005**: An episode MUST open only after the device has been offline continuously
  for its grace period (default 2 minutes, settable per profile and device from 0 to 60
  minutes). It MUST clear only after the device has been back for its grace period,
  except that a report from a *Connects to report* device clears it at once.
- **FR-006**: A platform-side interruption MUST neither open nor clear an episode. A
  device adapter's node death is one, whether the adapter was redeployed (activating a
  device through it does this), restarted, paused or replaced by a platform deploy: it
  MUST NOT count as a death of any of its devices, and MUST NOT show any of them
  offline. A device's silence MUST be counted from the later of when the platform last
  heard from it and the end of the interruption. For an adapter's own interruption,
  which ends at its next node birth, the time the adapter was down MUST instead be
  left out of each of its devices' silence, so that frequent redeploys neither count
  as silence nor keep restarting it. Device pages MUST show presence as unknown, with
  the reason, for its duration.
- **FR-007**: Detection MUST continue while the control plane is unavailable. Episodes
  that happened meanwhile MUST be recorded with their true times when it returns, and
  activation notices for episodes that have already cleared MUST NOT be sent.
- **FR-008**: Devices that are not active, or have sent no packet since activation,
  MUST NOT raise offline alerts; monitoring MUST start with their first packet (and
  silence with their third reading where *Offline after* is automatic, FR-004).
- **FR-009**: Deactivating, archiving or transferring a device, or turning its offline
  alerts off, MUST end an open episode with a stop reason and no recovery notice.
- **FR-010**: Activating a new configuration or profile version MUST NOT open or clear
  an episode or reset the silence clock.

#### Gateways and connections

- **FR-011**: When a gateway with child devices dies or goes silent, the platform MUST
  raise one gateway offline alert listing the affected devices. Its devices MUST show
  "offline because gateway *name* is offline" and MUST NOT open episodes of their own
  while the gateway's episode is open.
- **FR-012**: When the gateway returns, each child device that has still not reported
  MUST be judged by its own *Offline after*, counted from the gateway's return.
- **FR-013**: Losing the connection to a broker the organization operates (an external
  Sparkplug connection, or an adapter's vendor broker), or a polling adapter's requests
  to the vendor's API failing (retrying with back-off, or stopped on an error), MUST
  raise one connection alert once it lasts past the default grace period (2 minutes); its devices MUST show
  unknown and MUST NOT open device episodes. The alert MUST clear at the next
  connection or successful poll, and the devices' silence MUST be counted from then.
  Losing a broker or adapter runtime the platform operates is a platform-side
  interruption (FR-006).

#### Visibility

- **FR-014**: Offline alerts MUST appear for every member who can view the device on
  the Alerts page (and in its sidebar count of unacknowledged alerts), the Event log,
  the device page and the device directory, with the kinds **Device offline**,
  **Gateway offline** and **Connection lost**, filterable by kind alongside automation
  alerts. They reach a person's bell only as a notification channel (FR-018).
- **FR-015**: An offline alert MUST show the device, gateway or connection, its site,
  the last-seen time, the cause (death certificate, missed check-in, gateway offline,
  connection lost), the threshold in effect and where it came from, and for a gateway
  its affected devices. For a device whose readings carry an observed time, it MUST
  also show when its last reading was observed.
- **FR-016**: Viewing, acknowledging, assigning and commenting MUST follow the same
  permissions and rules as automation alerts.
- **FR-017**: Severity MUST default to warning and be settable per profile and device
  (critical, warning or info).

#### Notifications and channels

- **FR-018**: No notification channel (the bell, email, any channel added by spec 011,
  or an integration's event feed and webhook) MUST receive an offline alert unless a
  member opted in through a personal subscription or a member with permission
  configured a route for that channel. With neither, nothing is sent. Every recipient
  of a subscription or route MUST get the bell, as every automation recipient does.
- **FR-019**: A member who can view devices MUST be able to subscribe themselves to
  offline alerts for every device they can view, or for chosen sites, tags, profiles or
  devices, with recovery notices on or off. A subscription MUST only ever match devices
  the member can view.
- **FR-020**: A member with permission to manage notifications MUST be able to create
  routes, each with a device scope (all, sites, tags, profiles or devices), a minimum
  severity, recipients (verified members who can view the devices, at most 20) and, once
  spec 011 lands, channel destinations, with recovery notices on or off. Route changes
  MUST be revisioned, and a stale update MUST be rejected.
- **FR-021**: **Settings → Email** MUST gain a **Device offline** source. Turning it
  off, or turning off all emails, MUST stop offline email to that person even when a
  route lists them. It MUST NOT affect the bell (spec 022, FR-002).
- **FR-022**: Before every send, the platform MUST recheck membership, verification,
  view permission on the device, the subscription or route, personal preferences and
  mutes, and cancel the notice if any no longer allows it.
- **FR-023**: Each recipient MUST receive at most one activation notice per episode
  and channel, even when several subscriptions and routes match. A recovery notice
  MUST go only to recipients who received the activation and chose recovery.
- **FR-024**: For one recipient on one channel, the first offline or recovery notice
  MUST be sent at once, and further notices due within the following 5 minutes MUST be
  combined into one summary listing the devices by site.
- **FR-024a**: The bell MUST get one notification per alert transition and recipient,
  never combined into a summary, as for automation alerts (spec 022): an activation
  chimes, a clear arrives silently and only with recovery chosen, and a muted or held
  (flapping) alert creates none until it would notify. A bell notification MUST name
  the kind and the device, gateway or adapter instead of an automation.
- **FR-025**: A device with more than 3 episodes within 60 minutes MUST be marked
  flapping; its further episodes MUST be recorded but not notified until 60 minutes pass
  without a new episode, and the next notice MUST say how many were held back.
- **FR-026**: Notices MUST name the organization, the device (or gateway or
  connection), its site, the last-seen time in the site's time zone and the cause, and
  link to the alert, the device and the notification settings.

#### Muting

- **FR-027**: A member who can manage devices MUST be able to mute offline alerts for a
  device, gateway, site or profile until a chosen time (at most 30 days), with a
  reason. While muted, no episode opens; an episode already open stays open and visible
  but sends no further notices.
- **FR-028**: When a mute ends and a device is still offline, an episode MUST open after
  its grace period and notify as usual. Active mutes MUST be visible on the device page
  and in the Alerts inbox.

#### Integrations

- **FR-029**: An integration application's event feed and webhook MUST carry
  connectivity events (offline, back online, gateway and connection) only after the
  application enables **Device connectivity events**. Existing applications MUST start
  with it off, and events MUST be limited to granted devices as today.

#### Rollout, audit and boundaries

- **FR-030**: When monitoring starts for a device (at release, or when its profile or
  the device turns offline alerts on), a device already offline or silent beyond its
  threshold MUST NOT open an episode; it MUST show "offline since before monitoring
  started" and be monitored from its next packet.
- **FR-031**: The release MUST create no routes and no personal subscriptions.
- **FR-032**: Changes to offline settings, routes, subscriptions and mutes MUST be
  audited with the acting user.
- **FR-033**: Routes, subscriptions, mutes and offline alerts MUST be scoped to one
  organization; a member of another organization MUST NOT see, change or receive them.
- **FR-034**: Help guides and the assistant's usage help MUST explain offline alerts,
  how to opt in, how to tune and mute, how the reporting and poll intervals shape
  *Offline after*, how offline time differs from automation freshness (FR-036), and when
  to use spec 014's *No data* node instead (one parameter going quiet while the device
  keeps reporting, or an automation action on silence).
- **FR-035**: This feature MUST NOT change automation alerts, their per-workflow email
  settings or existing personal preferences.

#### Automations

- **FR-036**: *Offline after* and automation freshness MUST stay separate settings with
  separate clocks. Freshness is how old a reading may be when an automation evaluates
  it, counted from its observed time; *Offline after* is how long a device may be
  silent, counted from receipt. The automation editor's binding freshness default MUST
  NOT read *Offline after*: it stays the longest of 2 minutes, the parameter's
  stale-after time and two poll intervals.
- **FR-037**: When spec 014 builds its *No data* node, the node's period MUST default
  to the bound device's *Offline after* in effect when the binding is made (editable
  per node), and its silence MUST count from receipt, as offline detection does here.
  Spec 014 adopts this before its No data work starts; this feature builds nothing in
  the automation editor or runtime for it.

### Out of scope

- Reminders, escalation, on-call schedules and quiet hours (the roadmap's notification
  policies).
- New channels: Teams, Slack and SMS arrive with spec 011 and adopt routes here.
- Offline alerts for organizations a device is shared with (spec 016).
- Event-type filtering for the rest of the event feed (spec 003, FR-024); this feature
  gates only its own events.
- A device presence input for automations; spec 014 lists it as later work.

### Key Entities

- **Offline episode**: an alert of kind device offline, gateway offline or connection
  lost; subject, cause, last-seen time, threshold, severity, opened, cleared or stopped
  (with reason), acknowledgement, assignee, comments, deliveries.
- **Offline settings**: on or off, connection style, *Offline after*, grace period and
  severity; set on a device profile, overridable per device. Adapter devices always use
  *Connects to report*.
- **Reporting interval**: per monitored device, the median gap between its recent
  readings, up to 7 days back, measured by the platform; with the poll interval of its
  adapter, the basis for the automatic *Offline after* and the warning.
- **Personal subscription**: a member, a device scope, recovery on or off, channel.
- **Route**: an organization's scope, minimum severity, recipients or channel
  destinations, recovery on or off, revision.
- **Mute**: a device, gateway, site or profile, an end time, a reason and who set it.
- **Connectivity opt-in**: a flag on an integration application.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An always-connected device that loses power appears as an open offline
  alert within one minute after its grace period ends, counted from when its death
  certificate reaches the platform.
- **SC-002**: A silent gateway child or adapter device appears as an open offline alert
  within one minute after its *Offline after* plus grace period.
- **SC-003**: Across the next three pilot deploys, platform-side interruptions open zero
  offline alerts and send zero notices.
- **SC-004**: With no subscriptions and no routes, an organization's offline alerts
  produce zero deliveries of any kind, verified by an automated test per channel.
- **SC-005**: A gateway with 50 child devices going down produces at most one notice per
  subscribed recipient and channel.
- **SC-006**: A site outage of 200 devices within five minutes produces at most two
  notices per recipient and channel: the first, and one summary.
- **SC-007**: Releasing the feature on the pilot opens zero episodes for devices already
  offline and sends zero notices.
- **SC-008**: A member can subscribe themselves to offline emails for one site in under
  one minute, without help.
- **SC-009**: After release, existing integration applications receive zero
  connectivity events until they enable them.
- **SC-010**: Redeploying an adapter, restarting its runtime, or a platform deploy that
  replaces it opens zero offline alerts and shows none of its devices offline, verified
  with a polling adapter whose devices report every 10 minutes.
- **SC-011**: Over 24 hours of normal reporting with default settings, devices behind a
  5-minute and a 60-minute poll, reporting every minute to every hour, open zero
  episodes in the local stack.
- **SC-012**: A polled device that stops reporting appears as an open offline alert
  within one minute after its *Offline after* plus grace period, counted from the poll
  run that last delivered a reading for it.

## Assumptions

- Defaults, each settable as described: *Offline after* as in FR-004, grace period 2
  minutes, severity warning, summary window 5 minutes, flapping limit 3 episodes in 60
  minutes, mutes up to 30 days, at most 20 recipients per route (as for workflow
  email).
- An always-connected device's death certificate reaches the platform about one and a
  half keepalive intervals after it loses power or network; offline detection cannot be
  faster than that plus the grace period.
- In line with the constitution (principle I), detection runs where telemetry is
  processed, so it keeps working while the control plane is down; the control plane
  records episodes, shows them and sends notices. Principle VI holds: unknown is never
  offline.
- The platform can tell brokers the organization operates from those it operates
  itself.
- Who may manage routes follows the permission that manages workflow notifications
  today; members who can view devices may subscribe themselves.
- The bell (spec 022) and email are the channels at first. Spec 011's channels attach
  to routes when they land.
- The platform knows each polling adapter's interval from its running revision, as the
  automation editor already does. A polled device's offline alert comes at the
  earliest one *Offline after* plus grace period after the last poll run that delivered
  a reading for it, which is up to one poll interval plus the vendor's upload delay
  after the device's last observation; the alert shows both times.
- Assistants and connected AI applications with read access can read offline alerts
  like other alerts; reading is not a notification channel.
- Notices show times in the device's site time zone; the portal shows the viewer's.
