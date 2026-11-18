# Feature Specification: Self Sign-Up

**Feature Branch**: `spec/035-self-sign-up`

**Created**: 2026-11-18

**Status**: Draft

**Input**: The owner asked for self sign-up: "a person creates their own account and a
new tenant (organization) in one flow, starting from the marketing site." A **Start
free** call to action on the landing site leads to a sign-up page in the portal. The
person gives their name, email and password, then the organization's name. That
creates the person, a new organization with them as its Organization Admin, and the
billing account the organization needs, and they land in the new organization ready
to onboard a device. Every sign-up notifies platform staff by web push and by email,
each switchable, with only push on for now because email goes through a free mail
tier. The sign-up page and the new organization explain the plans and say plainly
that nothing is charged during the beta.

## Context

Today only platform staff create organizations (in the admin app), and owners of a
billing account create more organizations under it within its limit
([spec 023](../023-billing-accounts/spec.md),
[ADR-026](../../docs/adr/ADR-026-billing-accounts.md)). People join an organization
only by invitation. Every prospect therefore waits for a platform administrator to
set them up before they can connect a single device.

The pieces this feature needs already exist:

- **Billing accounts with owners** (spec 023). An owner creates an organization under
  their account and becomes its Organization Admin as an ordinary member. A new
  account's organization limit is 1. A billing account grants no access to data.
- **Plans and allowances** (specs 028 and 029). An account with no plan gets the
  deployment's defaults. Billing is switched off on the pilot: no card payments and no
  plans.
- **Device onboarding.** A new organization opens on its Home page; devices are added
  from **Devices → Add device**. The guided first-device journey of spec 021 is not
  built yet, so this feature points the way from Home itself.
- **Web push** (spec 033). People register push devices, one per browser, and alerts
  reach them as notifications. Push goes only to the people the alert bell lists.
- **Two-step sign-in** (spec 034). Platform staff must use it, and an organization can
  require it of its members.
- **The landing site** (ADR-021) is static. It cannot hold a session or a form that
  creates anything, so it only links to the portal.

Self sign-up joins these: the person who signs up becomes the owner of a new billing
account and the Organization Admin of its first organization, exactly as if a platform
administrator had created the account, made them its owner, and they had created the
organization themselves.

## Clarifications

### Session 2026-11-18

Decided when the spec was drafted, from the owner's request and the existing design:

- **Where the form lives**: in the portal, at `/sign-up`. The landing site links to it.
  A form on the static site would have to post across sites without a session and
  could not continue into the portal signed in (FR-001).
- **When the organization is created**: after the person confirms their email, not
  before. An address nobody confirmed never gets an organization, a billing account or
  a staff notification (FR-008, FR-010).
- **Who is notified**: every super administrator. Push is on and email is off by
  default, and platform staff switch each channel in the admin app (FR-020 to FR-024).
- **Plans**: a new account gets no plan. While platform staff mark the deployment as a
  free beta (on by default), the pages say nothing is charged during the beta
  (FR-030 to FR-033). The platform has no single "billing off" switch, so the message
  follows its own setting.
- **Sign-up can be closed**: platform staff open and close sign-up in the admin app.
  It is closed on a new deployment until they open it (FR-025).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up and land in my own organization (Priority: P1)

A prospect reads about the platform on the landing site and chooses **Start free**. The
portal's sign-up page asks for their name, work email and a password, then for their
organization's name. They submit and are asked to confirm their email. They open the
email and choose the link. Their organization is created and they are signed in to it, on
Home, where a panel leads them to their first device.

**Why this priority**: This is the feature. Without it every prospect waits for
platform staff.

**Independent Test**: With sign-up open on a local stack, start at the landing site,
sign up with a new address, confirm it from the email in the local mail catcher, and
check that the person is signed in to a new organization as its Organization Admin,
that the organization sits under a new billing account they own, and that the
organization opens on Home with a **Connect your first device** panel.

**Acceptance Scenarios**:

1. **Given** sign-up is open, **When** a person opens **Start free** on the landing
   site, **Then** the portal's sign-up page opens.
2. **Given** the sign-up page, **When** the person enters their name, email, a password
   that meets the platform's password rules, and an organization name, and submits,
   **Then** they see *Check your email*, naming the address, and an email with a
   confirmation link is sent to it.
3. **Given** a person waiting on *Check your email* in that browser, **When** they choose
   the link, in that browser or on another device, **Then** their email is confirmed,
   the organization is created under a new billing account they own, they are its
   Organization Admin, and the waiting browser signs them in to it within a few
   seconds without asking for the password again.
4. **Given** a person who chooses the link in a browser that did not start the sign-up,
   **When** the link is valid, **Then** the email is confirmed, the organization is
   created, and that browser asks them to sign in with their email and password before
   opening the organization.
5. **Given** a person signed in after sign-up, **When** their organization opens,
   **Then** Home shows a **Connect your first device** panel leading to **Add
   device**, and says the platform is free during the beta.
6. **Given** a person who has not received the email, **When** they choose **Send it
   again**, **Then** a new link is sent and the earlier one stops working; they can ask
   again after a minute, at most five times an hour.
7. **Given** a link older than 24 hours, or one already used, **When** the person opens
   it, **Then** they are told it has expired or was used, and offered a fresh one or the
   sign-in page.
8. **Given** a sign-up confirmed, **When** the person signs in later, **Then** sign-in
   works exactly as for any other person, including two-step sign-in if they turn it on
   or an organization they join requires it.

---

### User Story 2 - Platform staff hear about every sign-up (Priority: P1)

Each time someone completes a sign-up, every super administrator gets a push
notification on the devices where they turned push on: *New sign-up · Acme Water ·
Jane Doe*. Choosing it opens the new organization in the admin app. Platform staff can
also get an email for each sign-up, but that channel ships switched off.

**Why this priority**: The owner wants to follow up with every new organization by hand
during the beta, and to spot abuse early.

**Independent Test**: With push set up for a super administrator on a local stack,
complete a sign-up and check that the push arrives once on each of their devices, that
it opens the organization in the admin app, and that no email was sent. Turn email on
in the admin app, sign up again, and check that each super administrator receives one
email and one push.

**Acceptance Scenarios**:

1. **Given** sign-up push is on (the default), **When** a sign-up completes, **Then**
   each super administrator with push turned on receives one push per device naming the
   organization and the person, sent within a minute.
2. **Given** a super administrator who chooses the push, **When** it opens, **Then** it
   opens the new organization's page in the admin app (asking them to sign in first if
   needed).
3. **Given** sign-up email is off (the default), **When** a sign-up completes, **Then**
   no email about it is sent to platform staff.
4. **Given** platform staff turn sign-up email on, **When** a sign-up completes,
   **Then** each super administrator receives one email with the person's name and
   email, the organization's name, when it happened, and a link to the organization in
   the admin app.
5. **Given** both channels off, **When** a sign-up completes, **Then** nothing is
   sent, and the sign-up still appears in the admin app's sign-up list (story 4).
6. **Given** a sign-up started but never confirmed, **When** it expires, **Then**
   platform staff are not notified.
7. **Given** a super administrator who has turned push off everywhere, **When** a
   sign-up completes, **Then** they receive no push.

---

### User Story 3 - Understand what it costs (Priority: P2)

A prospect wants to know what they are signing up for. The sign-up page says, next to
the form, that the platform is free during the beta, that nothing is charged and no
card is asked for, and that plans will set limits on devices, stored readings, history,
alerts and SMS, with notice before any charge. Inside the new organization, the owner
sees the same message on Home and on their billing account page.

**Why this priority**: People hesitate to sign up when cost is unclear. It is a message,
not a mechanism, so it ranks below the flow itself.

**Independent Test**: With the free beta on, open the sign-up page and the new
organization's Home and billing account pages, and check each shows the beta
message and asks for no payment.

**Acceptance Scenarios**:

1. **Given** the free beta is on, **When** a person opens the sign-up page, **Then** it says
   the platform is free during the beta, nothing is charged, no card is needed, and
   what plans will limit later.
2. **Given** a completed sign-up, **When** the owner opens their billing account page in
   the portal, **Then** it shows *No plan* and the same beta message, and never a
   payment form.
3. **Given** platform staff turned the free beta off, **When** a person signs up, **Then** their
   account still starts with no plan, and the pages say instead that the platform
   operator will set up a plan with them before anything is charged.

---

### User Story 4 - Platform staff control sign-up (Priority: P2)

A super administrator opens **Settings → Sign-up** in the admin app. They can open or
close sign-up, mark the deployment as a free beta, set the daily ceiling, and turn the
push and email notifications on or off. A **Sign-ups** list
shows recent sign-ups, confirmed or not, with the person, the organization and when,
so staff can follow up or spot abuse.

**Why this priority**: The owner needs to choose the channels, close sign-up if it is
abused, and see who signed up. Push and email switches are part of story 2's value, but
they have safe defaults, so the page can follow the flow.

**Independent Test**: As a super administrator, close sign-up and check the portal's
sign-up page says it is closed and refuses a submission; open it again; switch push off
and email on and check the next sign-up follows the switches; check the list shows
each sign-up with its state.

**Acceptance Scenarios**:

1. **Given** a super administrator on **Settings → Sign-up**, **When** they close
   sign-up and save, **Then** the portal's sign-up page says sign-up is closed and how
   to get in touch, and any submission is refused.
2. **Given** sign-up closed, **When** a person opens a confirmation link from before it
   closed, **Then** the link still completes that sign-up: closing stops new sign-ups,
   not ones already started.
3. **Given** the page, **When** a super administrator changes a notification switch and
   saves, **Then** the next sign-up follows it, and the change is recorded in the
   activity log with who made it.
4. **Given** a platform administrator who is not a super administrator, **When** they
   open the admin app, **Then** they can see the sign-up list only if they may manage
   organizations, and cannot change the sign-up settings.
5. **Given** the **Sign-ups** list, **When** a super administrator opens it, **Then**
   it shows each sign-up's person, email, organization, state (*Waiting for email*,
   *Completed*, *Expired*, *Refused*) and time, newest first, filterable by state, and
   a completed one links to its organization.
6. **Given** the settings page, **When** the super administrator has no push device,
   **Then** it says so and links to where they can turn push on.

---

### Edge Cases

- **The email already has an account.** The sign-up page shows the same *Check your
  email* as for a new address, so it never reveals who has an account. The email
  sent says an account already exists and links to sign-in and password reset. No
  second account, organization or billing account is created.
- **The email has a sign-up waiting for confirmation.** A new sign-up with that address
  replaces the waiting one: the new name, password and organization name apply, and
  only the newest link works.
- **The email has a pending invitation.** Sign-up goes ahead; the invitation stays and
  can still be accepted once signed in, adding a second organization.
- **The organization name is taken.** Names need not be unique. The organization's
  address (slug) is picked automatically and gets a number when taken, as for owners
  today.
- **The person closes the tab before confirming.** The link still works in any browser
  (scenario 1.4).
- **The link is opened twice, or on two devices at once.** One organization is
  created; the second opening says the sign-up is already complete and offers sign-in.
- **The confirmation never comes.** After 24 hours the link expires. After 7 days an
  unconfirmed sign-up and its account are deleted, and the address is free again.
- **Two-step required.** A new person is never platform staff and a new organization
  does not require two-step, so the first sign-in after confirming needs no second
  step. If the person has since been made staff or joined an organization that
  requires it, the normal two-step setup prompt applies.
- **Sign-in before confirming.** Signing in with the email and password of an
  unconfirmed sign-up says to confirm the email first, offers to send the link again,
  and creates no session.
- **Bots and floods.** A form filled in by a bot (a hidden field filled, or submitted
  faster than a person could type) is refused with a generic message. Limits per
  address and per network, and a daily ceiling for the whole deployment, stop floods
  (FR-040 to FR-044).
- **The daily ceiling is reached.** New sign-ups wait until the next day with a polite
  message, and platform staff are told once that the ceiling was reached.
- **Mail is down.** The sign-up is stored and the page offers **Send it again**; nothing
  is created until the email is confirmed.
- **Push is not set up on the deployment.** The push switch is shown as unavailable and
  email stays the only channel.
- **A super administrator is removed.** They stop receiving sign-up notifications from
  the next sign-up.
- **The person deletes the organization later** (spec 006, empty organizations). The
  billing account stays, as for any deleted organization, and the person can create a
  new organization under it as its owner.

## Requirements *(mandatory)*

### Functional Requirements

**Entry and form**

- **FR-001**: The sign-up form MUST live in the portal at `/sign-up`, reachable without
  signing in. The landing site's **Start free** links to it.
- **FR-002**: The landing site MUST show **Start free** in its header and on the
  landing page beside **Sign in**, only when the hosted site's sign-up switch is on.
- **FR-003**: The portal's sign-in page MUST link to sign-up (*New here? Start free*)
  while sign-up is open, and sign-up MUST link back to sign-in.
- **FR-004**: The form MUST ask, in two steps on one page, for (1) the person's name,
  email and password, then (2) the organization's name. Going back to step 1 keeps what
  was typed.
- **FR-005**: The password MUST meet the platform's password rules for every other
  account, and the email MUST be a valid address. The organization name MUST be 2 to
  80 characters.
- **FR-006**: Each field MUST show its error beside it, and an error in step 1 found on
  submit MUST return the person to step 1.

**Confirming the email**

- **FR-007**: Submitting MUST send a confirmation email with a single-use link valid for
  24 hours, and show *Check your email* naming the address, with **Send it again** and
  **Use a different email**.
- **FR-008**: Until the email is confirmed, nothing but the waiting sign-up exists: no
  organization, billing account, membership or staff notification. The waiting
  account MUST NOT be able to sign in.
- **FR-009**: **Send it again** MUST send a new link and invalidate the previous one,
  limited to once a minute and five times an hour per sign-up.
- **FR-010**: Opening a valid link MUST, in one step: confirm the email, create a
  billing account named after the organization with the person as its owner and their
  email as its contact, create the organization under it, and make the person its
  Organization Admin as an ordinary member. Either all of this happens or none of it.
- **FR-011**: The browser that submitted the sign-up MUST continue by itself once the
  link is opened anywhere: it signs the person in through the platform's normal
  sign-in path and opens the new organization. No other browser is signed in by the
  link alone; it asks for the password (scenario 1.4).
- **FR-012**: An expired, replaced or already-used link MUST say which, and offer a new
  link (expired or replaced) or sign-in (used).
- **FR-013**: A sign-up not confirmed within 7 days MUST be deleted with its account.

**Accounts that already exist**

- **FR-014**: A sign-up with an email that already has an account MUST look the same to
  the visitor as a new one, send that address an email saying an account exists with
  links to sign in and reset the password, and create nothing.
- **FR-015**: A new sign-up with an email whose sign-up is waiting MUST replace the
  waiting one.

**The new organization**

- **FR-016**: The new organization MUST open on Home. While an organization has no
  devices, Home MUST show a **Connect your first device** panel to people who may add
  devices, leading to **Add device**. It disappears once the first device exists. When
  spec 021's guided journey is built, the panel leads there instead.
- **FR-017**: The new organization and billing account MUST be exactly what a platform
  administrator and an owner would create today: default roles, the account's default
  organization limit of 1, no plan, and the same activity log entries, with the
  person as the actor and a mark that they came from sign-up.
- **FR-018**: Sign-up MUST NOT bypass two-step sign-in or any other sign-in rule. The
  person is signed in through the same path as every sign-in.
- **FR-019**: The person MUST receive a welcome email with links to their organization,
  the quickstart and help, sent once the organization exists.

**Notifying platform staff**

- **FR-020**: Each completed sign-up MUST notify every super administrator through
  each switched-on channel, once, within a minute. A sign-up that is never confirmed
  notifies no one.
- **FR-021**: The push MUST name the organization and the person, never the email,
  and open the organization's page in the admin app.
- **FR-022**: The email MUST give the person's name and email, the organization's name,
  when it happened, and a link to the organization in the admin app.
- **FR-023**: Push MUST reach only push devices the super administrator registered, and
  only while they have not turned push off everywhere. A super administrator's alert
  levels and per-organization switches do not apply to sign-up pushes.
- **FR-024**: Platform staff MUST be able to switch push and email for sign-ups on and
  off, separately, in the admin app. Push is on and email is off by default. A switch
  that cannot work on the deployment (no push key, no mail) MUST say so.

**Controlling sign-up**

- **FR-025**: Platform staff MUST be able to open and close sign-up in the admin app.
  It is closed by default on a new deployment. While closed, the sign-up page MUST say
  so and refuse submissions, and the sign-in page MUST NOT link to it. Confirmation
  links issued before closing still work.
- **FR-026**: Only super administrators MUST be able to change sign-up settings.
  Platform administrators who may manage organizations MAY read the sign-up list.
- **FR-027**: Every change to the sign-up settings MUST be recorded in the activity log
  with who changed what.
- **FR-028**: The admin app MUST list sign-ups, newest first, with name, email,
  organization name, state and time, filtered by state, linking each completed one to
  its organization. A refused sign-up (bot check, ceiling) is listed without the
  password and without anything the bot typed beyond name, email and organization.
- **FR-029**: The sign-up settings page MUST tell a super administrator who has no push
  device that they will get no pushes, and link to where they turn push on.

**Billing message**

- **FR-030**: Sign-up MUST assign no plan, trial or price, and ask for no payment
  details, whether billing is on or off.
- **FR-031**: While the deployment is marked as a free beta, the sign-up page MUST say the platform is free
  during the beta: nothing is charged, no card is needed, and plans will later limit
  devices, stored readings, history, alerts and SMS, with notice before any charge.
- **FR-032**: The **Connect your first device** panel and the owner's billing account
  page MUST show the same message while the free beta is on, and the billing account page
  MUST show *No plan*.
- **FR-033**: While the free beta is off, these places MUST say instead that the platform
  operator will agree a plan with the person before anything is charged.

**Abuse protection**

- **FR-040**: Sign-up submissions MUST be limited per network address (5 an hour) and
  per email address (3 an hour), answering with a message that says when to try again.
- **FR-041**: The form MUST carry a hidden field people never fill and record when it
  was shown; a submission with the field filled, or sent within 3 seconds of showing,
  MUST be refused with a generic message and recorded as refused.
- **FR-042**: The deployment MUST stop accepting sign-ups for the rest of the day (UTC)
  after a daily ceiling, 50 by default and set by platform staff, and notify platform
  staff once that day through the switched-on channels.
- **FR-043**: Organization and person names MUST NOT contain links or markup; such
  input is refused.
- **FR-044**: A completed sign-up's billing account MUST keep the default organization
  limit of 1, so one confirmed email yields one organization until staff raise it.

**Docs and help**

- **FR-045**: The portal's help MUST have a guide on signing up and what the beta
  means, and the developer docs' quickstart MUST start from **Start free** where
  sign-up is open.

### Key Entities

- **Sign-up**: one attempt to create an account and organization. Holds the person's
  name and email, the organization name, its state (waiting, completed, expired,
  refused and why), when it was started, confirmed and completed, the network address
  and browser it came from (for abuse review), and, once completed, the person,
  organization and billing account it created. The password is held only as the
  account's password hash.
- **Sign-up settings**: one per deployment. Open or closed, the free beta, the push
  switch, the email switch and the daily ceiling, with who changed them last.
- **Billing account** (existing, spec 023): the payer; the person becomes its owner.
- **Organization** (existing): the tenant; the person becomes its Organization Admin.
- **Push device** (existing, spec 033): a super administrator's registered browser.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can go from **Start free** to signed in in their own
  organization in under 3 minutes, email confirmation included.
- **SC-002**: Every confirmed sign-up produces exactly one person, one billing account
  and one organization, and an unconfirmed one produces none.
- **SC-003**: Each super administrator with push on receives one push per confirmed
  sign-up within one minute, and no email while email is switched off.
- **SC-004**: The sign-up page never reveals whether an email already has an account:
  the visitor sees the same screen and timing for both.
- **SC-005**: An automated flood is held to at most the daily ceiling of organizations a
  day, and a single network address to 5 attempts an hour.
- **SC-006**: Every visitor sees before signing up that nothing is charged during the
  beta, and no step asks for payment details.
- **SC-007**: Closing sign-up in the admin app takes effect on the next request to the
  sign-up page, with no deploy.

## Assumptions

- **Super administrators are the staff to notify.** Platform administrators without
  super administrator rights are not notified; adding them later is a setting, not a
  redesign.
- **Deployment-wide switches.** The channels are switched for all super administrators
  at once. A per-person opt-out can follow if staff grow.
- **No captcha in this version.** A captcha needs an outside service; the hidden field,
  timing check, limits, ceiling and email confirmation are judged enough for the beta.
  A captcha can be added later behind its own setting.
- **No terms acceptance step.** The platform has no published terms of service yet. A
  checkbox linking to them can be added when they exist.
- **No social sign-in** (Google, Microsoft). Sign-up uses email and password; people
  can add a passkey afterwards (spec 034).
- **One organization per sign-up.** Owners who need more ask platform staff to raise
  their limit, as today.
- **Push devices are registered in the portal.** Super administrators turn push on where
  every person does; the admin app links there.
- **The landing site's switch is a build-time setting** of the hosted site, separate
  from the portal's open or closed state, because the static site cannot ask the
  platform. When they disagree, the portal's sign-up page says sign-up is closed.
- **The pilot's mail tier** limits how many emails a day can be sent; confirmation and
  welcome emails count toward it, which the daily ceiling keeps in bounds.
