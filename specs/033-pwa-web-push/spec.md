# Feature Specification: Installable Portal and Push Alerts

**Feature Branch**: `spec/033-pwa-web-push`

**Created**: 2026-11-16

**Status**: Draft

**Input**: "Do you think doing a PWA is worth it now? Or should we build mobile apps for
iOS and Android?" Agreed direction: make the portal usable from a phone and installable
(a progressive web app), and add Web Push as an alert channel next to email. Native iOS
and Android apps wait until a feature needs them.

## Context

Alerts reach people by email and by the bell in the portal header
([spec 022](../022-alert-bell/spec.md)). Alert emails link straight to the alert so the
recipient can acknowledge it in one click, and most people read that email on a phone.
The pages it opens were built for a computer: the portal has no phone layouts for its
alert, device or dashboard pages, it cannot be installed to a home screen, and nothing
reaches a phone unless the person checks their email. The bell only works while a
portal tab is open.

What people do with the platform on a phone is narrow: get told about an alert, open
it, look at the device or a dashboard, and acknowledge, assign or comment. Setting up
adapters, profiles, automations and dashboards stays on a computer.

A progressive web app covers that narrow job with the code the portal already has. It
installs to the home screen, opens in its own window, and receives push notifications:
on Android in the browser or the installed app, and on iPhone and iPad (iOS and iPadOS
16.4 or later) once it has been added to the home screen. Native apps were considered
and deferred. They add two app stores, review on every release and a second sign-in
flow, and they only become necessary for one of these:

- Setting up devices over Bluetooth from a phone. iOS browsers cannot use Bluetooth.
- Alerts that break through Do Not Disturb. iOS Critical Alerts are native only.
- A customer who requires an app store or managed-device install.
- Push on iOS without asking people to add the app to their home screen first.

When one of these becomes a real requirement, a later spec can wrap this same portal in
a native shell, reusing its phone layouts and push delivery.

**Terms**:

- *Phone width*: a screen or window narrower than 768 CSS pixels. Tablets and computers
  keep the current layouts.
- *Phone pages*: the pages this spec makes work at phone width (FR-001).
- *Installed app*: the portal added to a home screen or app list, opening in its own
  window without the browser's address bar.
- *Push device*: one browser on one phone, tablet or computer where a person turned on
  push. A person can have several.
- *Push*: a notification the operating system shows even when the portal is closed.
- *Recipient*: someone who gets an alert in their bell, as spec 022 defines it: the
  people a workflow's notification settings name, for each activation and, when
  recovery notices are on, each clear.

## Clarifications

### Session 2026-11-16

- Q: Sessions end after 2 hours idle and there is no "keep me signed in", so tapping a
  push at night usually means typing a password. How should sign-in work on phones? →
  A: A **Keep me signed in** checkbox at sign-in keeps that one browser or installed app
  signed in for 30 days. Sign-out, a password change or removing the device from push
  settings ends it early. Everyone else keeps the 2-hour idle timeout.
- Q: Who decides whether an automation's alerts are pushed: each person, or a manager
  per automation as spec 011 does for SMS? → A: Each person. Push goes to everyone who
  gets the alert in their bell, filtered by their own push levels; managers get no
  setting (FR-018).
- Q: Should people be able to acknowledge from the notification itself? → A: No. A push
  carries no action buttons on any platform; tapping it opens the alert, where
  **Acknowledge** is one more tap (FR-021, FR-022).
- Q: What should a push show on a locked phone? → A: Full details (organization,
  severity, automation, device, state). People who want them hidden use the phone's own
  lock-screen preview setting; the portal adds no setting for it (FR-021).
- Q: Can someone in several organizations stop pushes from just one of them? → A: Yes.
  One set of levels for all organizations, plus a push on/off switch per organization
  (FR-019).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Act on an alert from a phone (Priority: P1)

An operator gets an alert email on their phone, taps the link, signs in if needed, reads
the alert and acknowledges it, all without zooming or scrolling sideways. They can also
assign it and add a comment, and browse the Alerts list to see what else is active.

**Why this priority**: alert emails already send people to these pages from their
phones today. It is the first thing that goes wrong on a phone, it helps every user
before anything is installed, and push (US2) lands people on the same pages.

**Independent Test**: on a phone 360 pixels wide, open an alert email link while signed
out, sign in, acknowledge the alert, assign it and add a comment. Then open Alerts,
filter to active and unacknowledged, and open another alert. Nothing needs zooming and
the page never scrolls sideways.

**Acceptance Scenarios**:

1. **Given** a signed-out person on a phone, **When** they open an alert link from an
   email, **Then** the sign-in page fits the screen and, after signing in, they land on
   that alert.
2. **Given** a manager on an alert at phone width, **When** they tap **Acknowledge**,
   **Then** it is acknowledged with one tap and the page shows who acknowledged it and
   when.
3. **Given** a member who can only view devices, **When** they open an alert at phone
   width, **Then** they see no acknowledge, assign or comment controls, as on a
   computer.
4. **Given** the Alerts list at phone width, **When** the person opens the filters,
   **Then** every filter the computer layout offers is available, and each alert shows
   as one stacked row with its title, device, state and time.
5. **Given** a person in several organizations, **When** they switch organization on a
   phone, **Then** the organization switcher, navigation menu, bell and user menu are
   all reachable.

---

### User Story 2 - Get pushed alerts on a phone (Priority: P1)

A recipient turns on push on their phone. When one of their alerts activates, the phone
shows a notification within seconds, even with the portal closed. Tapping it opens that
alert, ready to acknowledge.

**Why this priority**: this is the reason for the feature. Email is slow to be noticed
and the bell only works while a tab is open.

**Independent Test**: on an Android phone with a supported browser, turn on push for a
person who receives a test automation's alerts, close the browser, trigger the alert
and check that a notification arrives within 30 seconds and that tapping it opens the
alert. Repeat on an iPhone with the portal installed (US3).

**Acceptance Scenarios**:

1. **Given** a recipient on a supported phone, **When** they choose **Turn on push on
   this device** in their notification settings or in the bell, **Then** the phone asks
   for permission, and once they allow it, the device is listed with **This device**
   marked and a test push arrives.
2. **Given** push is on, **When** an alert they receive activates, **Then** the phone
   shows the organization, severity, automation, device and **Activated** with the time
   it happened.
3. **Given** a push for an alert, **When** the person taps it, **Then** the alert opens
   in the right organization (in the installed app if they have one) and its bell
   notification is marked read.
4. **Given** recovery notices are on for the workflow and the person receives cleared
   alerts by push, **When** the alert clears, **Then** the phone's notification for that
   alert is replaced by a **Cleared** one rather than adding a second.
5. **Given** an iPhone using Safari without the portal on its home screen, **When** the
   person looks for push, **Then** the control explains that push needs the app on the
   home screen and shows the steps, and asks for no permission.
6. **Given** a person removed from the organization after the alert activated but
   before the push was sent, **When** the push would be sent, **Then** it is cancelled
   with that reason.

---

### User Story 3 - Install the portal as an app (Priority: P2)

A person adds the portal to their phone's home screen. It opens full-screen with the
portal's name and icon, like any other app. Without a connection it says so plainly
instead of showing an error page or old data. After a release, it runs the new version
the next time it opens.

**Why this priority**: it makes the portal quicker to reach, and it is required for push
on iPhone and iPad. Android push works without it, so it ranks below US1 and US2.

**Independent Test**: on Android, install from the user menu's **Install app**; on an
iPhone, follow the steps the portal shows. Open the app, sign in, open an alert. Turn on
airplane mode and reopen it: an offline screen shows and no earlier data is visible.
Deploy a new portal build and reopen it: the new version runs.

**Acceptance Scenarios**:

1. **Given** a supported Android or desktop browser, **When** the person chooses
   **Install app** in the user menu, **Then** the browser's own install prompt appears,
   and the installed app opens in its own window with the portal's name and icon.
2. **Given** Safari on an iPhone, **When** the person chooses **Install app**, **Then**
   the portal shows the Share → **Add to Home Screen** steps, because Safari has no
   install prompt.
3. **Given** the installed app is already running, **When** the person opens the user
   menu, **Then** **Install app** is not shown.
4. **Given** no network connection, **When** the person opens the installed app,
   **Then** it shows that it is offline and that alerts and readings need a connection,
   shows no data from an earlier session, and loads normally once the connection
   returns.
5. **Given** a page is open and the connection drops, **When** ten seconds pass,
   **Then** an offline indicator shows, readings on screen keep their age labels and are
   never shown as current, and an acknowledge attempt fails with a message that nothing
   was saved.
6. **Given** a new release has been deployed, **When** an installed app that was open
   checks in, **Then** it offers **Reload** for the new version, and the next launch
   runs the new version without asking.

---

### User Story 4 - Check a device and its dashboards from a phone (Priority: P2)

From an alert, the person opens the device to see its status, when it last reported, its
latest readings and its other active alerts, then opens one of its dashboards to look at
the trend.

**Why this priority**: it is the usual next step after reading an alert, but people can
act on the alert itself (US1) without it.

**Independent Test**: at phone width, go from an alert to its device, read its status
and latest readings with their age, open a dashboard from the Dashboards list and read
every widget by scrolling down only.

**Acceptance Scenarios**:

1. **Given** a device detail page at phone width, **When** it loads, **Then** status,
   last seen, the latest readings with their age, and active alerts appear first, in one
   column.
2. **Given** a dashboard at phone width, **When** it opens, **Then** its widgets are
   stacked in one column in the order they read on a computer (left to right, then top
   to bottom), each tall enough to read, with the time range control reachable.
3. **Given** a dashboard at phone width, **When** a person who could edit it on a
   computer looks for editing, **Then** the page says editing needs a larger screen, and
   the computer layout of the dashboard is unchanged.
4. **Given** a widget whose content is wider than the phone (a table, for example),
   **When** it is shown, **Then** it scrolls sideways inside its own area and the page
   does not.

---

### User Story 5 - Choose which alerts reach which devices (Priority: P3)

A person decides which alert levels they want pushed, sees the devices where push is on,
removes an old phone, and turns push off everywhere for a holiday without losing their
choices.

**Why this priority**: the defaults (US2) are enough to start, but people need control
to avoid alert fatigue and to clean up old devices.

**Independent Test**: in personal notification settings, turn off **Warning** for push,
trigger a warning alert and check no push arrives while the bell still shows it. Remove
a device and check it receives nothing. Turn push off everywhere and on again, and check
the level choices are kept.

**Acceptance Scenarios**:

1. **Given** the push section of personal notification settings, **When** the person
   changes the levels, **Then** pushes follow the new levels from the next alert, and
   email choices are unchanged.
2. **Given** a person with three push devices, **When** they remove one, **Then** that
   device receives no further pushes and the list no longer shows it.
3. **Given** push is turned off everywhere, **When** it is turned on again, **Then** the
   earlier levels and devices still apply.
4. **Given** a person in two organizations, **When** they switch push off for one of
   them, **Then** that organization's alerts still reach their bell but not their
   phone, and the other organization's pushes continue.

---

### Edge Cases

- **Browser without push** (an old iOS version, an in-app browser inside a mail app):
  the push control says this browser cannot receive push and, where it helps, which
  browser can.
- **Permission denied earlier**: the control explains how to allow notifications in the
  browser's or phone's settings. The portal never asks again on its own.
- **iPhone app and Safari keep separate sign-ins**: on iOS the installed app does not
  share Safari's session, so the person signs in once inside the app. The install steps
  say so.
- **Shared phone or tablet**: signing out removes that device's push registration. The
  next person to sign in on it does not inherit it. **Keep me signed in** is off unless
  ticked, and its label says not to tick it on a shared device.
- **Lost phone**: removing it from the push device list signs it out as well, so it
  stops getting pushes and cannot open the portal without a password. A password reset
  does the same for every device.
- **Person in several organizations**: pushes come from each organization where they
  are a recipient and name the organization. Tapping one switches to it.
- **Access lost after the push was shown**: tapping it shows that the alert is not
  available, with nothing about the alert.
- **Registration expired or revoked by the browser vendor**: it is removed on the first
  permanent failure. The next time the person opens the portal on that device, it says
  push stopped there and offers to turn it on again.
- **Alert clears before its push is sent**: the push is cancelled, as email is.
- **Burst of alerts**: after three activation pushes to one person within a minute, the
  rest of that minute's activations from the same organization arrive as one summary
  push that opens the Alerts list. Each alert is still in the bell.
- **Duplicate send** (delivery is at least once): a repeated push for the same alert
  and transition replaces the earlier notification on the device instead of adding one.
- **Phone offline for hours**: a push the phone has not received within 24 hours is
  dropped rather than shown late. Every push states when the alert happened, and the
  alert page shows its current state.
- **Portal open on a computer with push also on there**: the notification still shows,
  and the bell's chime keeps its own rules.
- **More than ten push devices**: turning on push on an eleventh removes the device that
  went unused longest, and the list says so.
- **Deployment without push** (no push key configured, or no outbound internet): push
  controls are hidden, and installation and phone layouts still work.
- **Large text or zoom**: phone pages stay usable with the phone's text size at 200%.
- **Landscape phones and tablets**: anything 768 pixels wide or more uses the current
  layout.

## Requirements *(mandatory)*

### Functional Requirements

#### Phone layouts

- **FR-001**: At phone width (320 to 767 CSS pixels), these pages MUST be fully usable:
  sign-in, password reset, invitation acceptance, the organization's home page, Alerts,
  alert detail (acknowledge, assign, comment and the deliveries list), Devices, device
  detail, Dashboards, a dashboard in view mode, and personal notification settings. The
  navigation menu, organization switcher, bell and user menu MUST be reachable from
  every page.
- **FR-002**: Phone pages MUST NOT scroll sideways. Content that cannot narrow (a wide
  table or chart) scrolls inside its own area.
- **FR-003**: At phone width, lists MUST show each row as a stacked item with its name,
  status and time first, and filters in a compact control that offers every filter of
  the computer layout. This MUST come from the shared list components of the design
  system, so every list that uses them gets it.
- **FR-004**: Controls on phone pages MUST be at least 44 by 44 pixels, MUST NOT depend
  on hovering, and fields MUST bring up the right keyboard (email, number).
- **FR-005**: Panels that dock to a side on a computer (the bell's list, Assistant, Help)
  MUST open full width at phone width. Notices MUST NOT cover a page's main action.
- **FR-006**: A dashboard at phone width MUST stack its widgets in one column in reading
  order, each at a readable height, with its time range control reachable. Editing MUST
  NOT be offered at phone width; the page says it needs a larger screen.
- **FR-007**: Device detail at phone width MUST show status, last seen, the latest
  readings with their age, and active alerts before any other section.
- **FR-008**: Pages not listed in FR-001 MUST stay reachable at phone width but need not
  be redesigned. Layouts at 1024 pixels and wider MUST NOT change.

#### Installable app

- **FR-009**: The portal MUST be installable on Android (Chrome, Edge, Samsung
  Internet), on iPhone and iPad (Safari, iOS and iPadOS 16.4 or later, through **Add to
  Home Screen**) and in desktop Chrome and Edge. The installed app MUST open in its own
  window with the portal's name and an icon that fits each platform's icon shapes.
- **FR-010**: The user menu MUST offer **Install app** where the portal is not already
  installed. It opens the browser's install prompt where one exists, and the
  **Add to Home Screen** steps on iPhone and iPad. The portal MUST NOT show install
  banners or prompts on its own.
- **FR-011**: The installed app MUST open where the portal normally lands (the person's
  organization and start page) and follow the same session rules as the browser.
- **FR-011a**: Portal sign-in MUST offer **Keep me signed in**, off by default. When it
  is ticked, that browser or installed app stays signed in for 30 days from sign-in,
  however long it sits idle. Signing out there, resetting the password, or removing that
  device from the push device list (FR-020) MUST end it. Without it, the 2-hour idle
  timeout applies as today.
- **FR-012**: Without a connection, the installed app MUST open to an offline screen that
  says alerts and readings need a connection, and reload on its own when the connection
  returns. The app MUST NOT keep alerts, readings or any other organization data on the
  device for offline use.
- **FR-013**: When the connection drops while a page is open, an offline indicator MUST
  appear within 10 seconds. Values on screen keep their age labels and MUST NOT be shown
  as current. Actions MUST fail with a message that nothing was saved, and nothing is
  queued to send later.
- **FR-014**: After a release, an installed app or open tab MUST run the new version no
  later than its next launch or reload. An app that is open when a release lands MUST
  offer **Reload** and MUST NOT mix screens from two versions. Deployment settings that
  the portal reads at start MUST always be fetched fresh.
- **FR-015**: Signing out MUST delete everything the portal stored on the device for
  that person, apart from the app itself, and remove the device's push registration
  (FR-028).

#### Push notifications

- **FR-016**: Push MUST be available only when the deployment has a push key. A new
  single-node install MUST create the key. An upgraded deployment MUST be able to add
  it with one release command, without anyone handling key material. Without a key,
  push controls are hidden.
- **FR-017**: A person MUST turn push on one device at a time, from personal
  notification settings or from the bell, and the browser's permission request MUST
  appear only after they choose to. When the browser cannot receive push, needs the app
  on the home screen first, or was denied permission before, the control MUST say which
  and what to do instead of asking.
- **FR-018**: Push MUST go to exactly the people who get the alert in their bell: each
  activation, and each clear when the workflow's recovery notices are on, to each
  recipient, filtered by that person's push levels (FR-019). Managers get no separate
  push setting per workflow. Push does not depend on the person's email settings. When
  offline alerts ([spec 018](../018-device-offline-alerts/spec.md)) gain recipients, they
  are pushed by the same rule.
- **FR-019**: Each person MUST have push levels that apply across organizations:
  **Critical**, **Warning** and **Info** activations, and **Cleared**. Turning push on
  for the first time switches on every activation level and leaves **Cleared** off. A
  **Turn off push everywhere** switch stops all pushes and keeps the levels and devices.
  The push settings MUST also list each organization the person belongs to with its own
  on/off switch, on by default and for organizations they join later, so they can stop
  one organization's pushes without changing the levels or the others.
- **FR-020**: Personal notification settings MUST list the person's push devices with a
  name from browser and system (for example *Safari on iPhone*), when each was added and
  last reached, and mark **This device**. The person can remove any of them. A person
  has at most 10; turning push on for an eleventh removes the one unused longest and
  says so.
- **FR-021**: A push MUST show the organization, severity, automation, device when
  known, **Activated** or **Cleared**, and the clock time it happened: the same facts as
  the bell, with a clock time where the bell shows a relative one. It contains no
  readings and no action buttons. The same text shows on a locked screen
  unless the phone's own preview setting hides it, and the help article (FR-032) says
  where that setting is.
- **FR-022**: Tapping a push MUST open its alert in its organization, in the installed
  app where there is one and otherwise in the browser, and mark the bell notification
  read. A signed-out person signs in and continues to the alert. A person without
  access sees that the alert is not available and nothing about it.
- **FR-023**: A repeated push for the same alert and transition MUST replace the earlier
  notification on the device. A **Cleared** push MUST replace that alert's activation
  notification.
- **FR-024**: When a person would get more than three activation pushes from one
  organization within 60 seconds, the further activations in that window MUST be sent as
  one summary push that gives the count and opens the Alerts list filtered to active,
  unacknowledged alerts.
- **FR-025**: Before every send, push MUST repeat the checks email makes: the recipient
  is still a verified member with device view access, the workflow still names them,
  their push levels and that organization's switch allow it, the workflow's execution
  has not stopped or been replaced, and the activation has not already cleared. The
  device MUST still be registered to that person. A failed check cancels the delivery
  with a reason.
- **FR-026**: Push deliveries MUST be queued in the same transaction as the alert,
  recorded once per alert, transition and recipient with the result for each of their
  devices, and retried on transient failure with the same backoff as email. A device the
  browser vendor reports as gone is removed and never retried. A push not received
  within 24 hours MUST expire.
- **FR-027**: The alert detail's deliveries list MUST show push deliveries with their
  recipient, how many of their devices were reached, and their status. **Sent** means
  the browser vendor's push service accepted it. Managers can retry a failed push as
  they retry email.
- **FR-028**: Push registrations are personal. Only their owner can list or remove them,
  and the API MUST NOT return the keys of a registration to anyone. Signing out on a
  device removes its registration, and deleting the account removes all of them.
  Leaving an organization stops its pushes without removing the device.
- **FR-029**: Pushes travel through the browser vendor's push service (Apple, Google,
  Mozilla or Microsoft) and MUST be encrypted so that service cannot read them.
- **FR-030**: Push MUST fit the channel model of
  [spec 011](../011-notification-channels/spec.md) as a personal channel whose contact
  points are the person's push devices, with no cost per message and no incident
  resolution. Whichever of the two specs is built first builds the shared delivery
  record. The other extends it without changing existing delivery history. Spec 011's
  **Turn off all**, once built, also stops push.

#### Contracts and documentation

- **FR-031**: The OpenAPI description and `packages/api-client` MUST cover push devices,
  push levels and push deliveries on the alert detail.
- **FR-032**: `docs/features/alerts.md` MUST describe push, a help article MUST explain
  installing the app on Android and iPhone and turning on push (without naming the
  product, like every help guide), and the release docs MUST describe the push key.

### Key Entities

- **Push device**: belongs to one person. Name (browser and system), the browser's
  delivery address and encryption keys (kept secret), when it was added, last reached
  and last failed.
- **Push levels**: per person, across organizations. The four levels, the
  **Turn off push everywhere** switch, and an on/off switch for each organization the
  person belongs to.
- **Push delivery**: one per alert transition and recipient, with its status, attempts,
  the result for each device, and a reason when cancelled. A summary push records the
  alerts it covers.
- **Kept sign-in**: per person and browser or installed app. When it started, when it
  ends (30 days later), and what ended it early (sign-out, password reset, device
  removed).
- **Push key**: per deployment. The key pair that signs every push, created by the
  release.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a phone 360 pixels wide, a manager can go from tapping an alert email
  link or push to having acknowledged the alert in under 30 seconds when already signed
  in, without zooming or scrolling sideways.
- **SC-002**: Every page in FR-001 shows no sideways page scrolling at widths of 320,
  360 and 390 pixels, and all its controls are at least 44 pixels square, checked by
  automated tests.
- **SC-003**: In the rebuilt stack, 95% of alert activations reach an online Android
  phone and an online iPhone with the app installed within 30 seconds, checked on real
  phones, not emulators alone.
- **SC-004**: No push reaches anyone who is not a recipient: tests cover each check in
  FR-025, including a person of another organization, and every one cancels the push.
- **SC-005**: After signing out, no alert, reading or other organization data can be
  read from the portal's storage on that device, and opening the app offline shows
  only the offline screen.
- **SC-006**: After a new release, the next launch of an installed app runs the new
  version in every test run.
- **SC-007**: A burst of 50 activations to one person in one organization within a
  minute puts at most 4 notifications on their phone.
- **SC-008**: Layouts at 1024 pixels and wider are unchanged: existing end-to-end tests
  at those sizes pass without changes made for this feature.
- **SC-009**: Measured after release: within 30 days on the pilot, at least half of the
  people who received an alert email have turned on push on at least one device. This
  informs the native app decision and does not gate the release.

## Assumptions

- Phone width is below 768 pixels. Tablets and landscape phones at 768 or more keep the
  current layout.
- Supported browsers are the current and previous major versions of Chrome, Edge,
  Samsung Internet and Firefox on Android (push works in the browser), Safari on iOS
  and iPadOS 16.4 or later (push needs the app on the home screen), and current desktop
  Chrome, Edge, Firefox and Safari.
- Push follows the bell's recipients rather than a manager setting per workflow, because
  a push costs nothing to send. SMS in spec 011 is different: it costs per message, so
  managers choose it.
- Every workflow alert is recorded as `warning` until spec 011 adds a severity per
  workflow, so until then the levels only tell workflow alerts apart from cleared ones.
- The defaults (three activations a minute before a summary, a 24-hour expiry, ten
  devices per person, every activation level on) are starting values to tune on the
  pilot.
- The deployment can reach the browser vendors' push services over the internet. An
  on-premise deployment without that keeps push off (FR-016).
- Sign-in is unchanged apart from **Keep me signed in** (FR-011a): no new sign-in
  method, no fingerprint or face unlock.
- A password reset is the only way a password changes today; the portal has no
  change-password screen. A later change-password screen MUST end kept sign-ins and
  push devices as a reset does.
- Personal notification settings means today's **Settings → Email** page, which gains a
  push section. Whether it is renamed is left to the plan.
- The organization's home page is a phone page (FR-001) because the installed app opens
  there.
- The installed app's name and icon are the portal's own. Giving each deployment its
  own name and icon is not part of this spec.
- Depends on spec 022 (the bell's recipients and read state). Works alongside spec 011
  (FR-030) and spec 018 (FR-018) in either order.

### Out of scope

- Native iOS and Android apps, and wrapping the portal in a native shell (deferred
  until one of the triggers in Context applies).
- Setting up devices over Bluetooth from a phone, and iOS Critical Alerts.
- Viewing or editing data while offline.
- Acknowledging from the notification itself without opening the alert.
- SMS, Microsoft Teams and Slack (spec 011), and reminders or escalation.
- Phone layouts for the admin app, and making it installable.
- Editing dashboards, automations, profiles or adapters on a phone.
- Dashboard kiosks.
