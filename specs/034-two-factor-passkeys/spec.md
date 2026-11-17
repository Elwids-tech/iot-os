# Feature Specification: Two-Step Sign-In and Passkeys

**Feature Branch**: `spec/034-two-factor-passkeys`

**Created**: 2026-11-16

**Status**: Draft

**Input**: "I was thinking of implementing WorkOS … Also 2FA etc." After evaluating
WorkOS (AuthKit, Connect, SSO and directory sync, MCP authorization), the agreed
direction on 2026-11-16 was: "stick with what we can implement with Laravel and leave
WorkOS." This spec covers two-step sign-in and passkeys for people, built into the
platform with no external identity service.

## Context

People sign in to the portal and the admin app with an email address and a password.
Both apps share one session. Since spec 033 a person can tick **Keep me signed in**
to keep one browser or installed app signed in for 30 days. A password is the only
thing that stands between an attacker and an account, and an account can do a lot:
send device commands, change automations, invite members, and (for platform staff)
manage every organization. Customers in utilities and industry ask about multi-factor
sign-in in security reviews, and [pilot.md](../../docs/ops/pilot.md) lists it as
missing.

ADR-008 left "future multi-factor authentication workflows" to Laravel. A hosted
identity service (WorkOS was evaluated) was set aside for three reasons:

- single-VM and on-premise deployments (ADR-006) must sign people in with no internet
  connection;
- identity data would leave the deployment's region;
- agent and partner connections (ADR-018, ADR-033) and application grants (ADR-032)
  carry an organization, an access level and revocation rules that a hosted service
  does not model.

This feature adds two things that run entirely inside the deployment:

- **Two-step sign-in.** After the password, a person enters a six-digit code from an
  authenticator app on their phone (Google Authenticator, Microsoft Authenticator,
  1Password and similar), or a one-time recovery code if they have lost the phone.
- **Passkeys.** A person can register a passkey (Face ID, Touch ID, Windows Hello, a
  security key, or a password manager) and sign in with it alone, with no password and
  no code.

Single sign-on with a company directory (SAML, OIDC, SCIM) is not part of this
feature. It stays a later, optional connector if a customer requires it.

## Clarifications

### Session 2026-11-16

- Q: Must super administrators and platform administrators use two-step sign-in?
  → A: Yes, required; they set it up at their next sign-in and cannot turn it off
  (FR-020).
- Q: Can an organization administrator require two-step sign-in for every member?
  → A: Yes, per organization; a person in any organization that requires it must use
  it everywhere (FR-021).
- Planning changed two details to match Laravel's two-factor support: eight recovery
  codes per set instead of ten, and recovery codes stored encrypted like the setup
  secret instead of hashed (FR-003, FR-006; [research R2](research.md)).
- The analysis found that "a passkey satisfies the requirement" let a required person
  with only a passkey sign in with the password alone. FR-022 now says a passkey
  counts only when it is used ([research R7](research.md)).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Protect my account with an authenticator app (Priority: P1)

A person opens their security settings and turns on two-step sign-in. They scan a QR
code with their authenticator app (or type the setup key), and enter the code it shows
to confirm. The platform then shows eight recovery codes once, to copy or download. From
then on, every sign-in asks for a code after the password. If the phone is lost, a
recovery code works once in place of a code.

**Why this priority**: This is the protection customers ask for, and on its own it
closes the "stolen password is enough" gap for anyone who turns it on.

**Independent Test**: Turn two-step on for a test person, sign out, and sign in on the
portal and the admin app. Both need the password and then a valid code. A wrong code,
a reused code and a reused recovery code are refused.

**Acceptance Scenarios**:

1. **Given** a signed-in person with two-step off, **When** they start setup, scan the
   QR code and enter the current code, **Then** two-step is on, eight recovery codes are
   shown once, and they receive an email saying two-step sign-in was turned on.
2. **Given** a person who started setup but did not confirm a code, **When** they sign
   out and back in, **Then** they are not asked for a code: two-step only takes effect
   after it is confirmed.
3. **Given** a person with two-step on, **When** they sign in with the right password,
   **Then** they are asked for a code before reaching any page, and no session exists
   until they enter a valid code.
4. **Given** a person at the code step, **When** they enter an unused recovery code,
   **Then** they are signed in, that recovery code no longer works, and they are told
   how many recovery codes they have left.
5. **Given** a person at the code step, **When** they enter five wrong codes,
   **Then** that sign-in attempt ends and they must start again with their password,
   and further attempts are slowed down as wrong passwords are.
6. **Given** a person with two-step on, **When** they regenerate recovery codes,
   **Then** the old codes stop working and the new ones are shown once.
7. **Given** a person with two-step on, **When** they turn it off, **Then** they must
   confirm their password first, and they receive an email saying it was turned off.
8. **Given** a person who ticks **Keep me signed in** and completes both steps,
   **When** they come back within 30 days on that browser, **Then** they are not asked
   for the password or a code again.

---

### User Story 2 - Sign in with a passkey (Priority: P2)

A person adds a passkey from their security settings, using Face ID, Touch ID, Windows
Hello, a security key or their password manager, and gives it a name. On the sign-in
page they choose **Sign in with a passkey** and are signed in with no password and no
code. They can see every passkey they have added, when each was last used, and remove
any of them.

**Why this priority**: Passkeys are faster than a password plus a code and cannot be
phished, but the authenticator app (story 1) already delivers the security outcome, and
passkeys need HTTPS and a stable address that some on-premise deployments lack.

**Independent Test**: On a deployment served over HTTPS, add a passkey for a test
person, sign out, and sign in with only the passkey on the portal and the admin app.
Remove the passkey and confirm it no longer signs in.

**Acceptance Scenarios**:

1. **Given** a signed-in person on a deployment served over HTTPS, **When** they add a
   passkey and name it, **Then** it appears in their list with its name and creation
   time, and they receive an email saying a passkey was added.
2. **Given** a person with a passkey, **When** they choose **Sign in with a passkey**
   and approve it on their device, **Then** they are signed in without a password or a
   code, even if two-step sign-in is on.
3. **Given** a person with several passkeys, **When** they remove one, **Then** it no
   longer signs in, the others still do, and they receive an email naming the removed
   passkey.
4. **Given** a deployment that is not served over HTTPS, **When** a person opens their
   security settings or the sign-in page, **Then** passkeys are not offered, the page
   says why, and authenticator codes still work.
5. **Given** a person signing in with a passkey, **When** they tick **Keep me signed
   in**, **Then** that browser is kept signed in exactly as with a password.

---

### User Story 3 - Required two-step sign-in (Priority: P2)

Some accounts must not rely on a password alone. When two-step sign-in is required
for a person, they cannot reach the portal or the admin app until they have set it up:
after their password, they go straight to setup instead of the app.

**Why this priority**: Optional two-step sign-in protects only the people who choose
it. The accounts that can do the most damage need it enforced, but enforcement is only
useful once story 1 exists.

**Independent Test**: Make two-step required for a test person who has not set it up,
sign in, and confirm that every page and API call is refused until setup is finished,
after which the app opens normally.

**Acceptance Scenarios**:

1. **Given** a person for whom two-step is required and not set up, **When** they sign
   in with their password, **Then** they see the setup steps and nothing else, and
   every other page and API request is refused until setup is confirmed.
2. **Given** that person finishes setup, **When** the recovery codes have been shown,
   **Then** they continue to where they were going.
3. **Given** a person for whom two-step is required, **When** they try to turn it off,
   **Then** they cannot, and the page says why.
4. **Given** a person accepting an invitation for whom two-step is required, **When**
   they set their password, **Then** they set up two-step before they reach the app.
5. **Given** a person who signs in with a passkey, **When** two-step is required for
   them, **Then** the passkey satisfies the requirement and they are not sent to setup.
6. **Given** an organization administrator with two-step set up, **When** they require
   two-step for their organization, **Then** members without it are sent to setup on
   their next request, the member list shows who has it, and the change appears in
   that organization's activity log.
7. **Given** an organization administrator without two-step or a passkey, **When**
   they try to require it, **Then** they are asked to set up their own first.
8. **Given** a person who becomes a platform administrator without two-step, **When**
   they next open the portal or admin app, **Then** they are sent to setup.

Who two-step is required for is defined by FR-020 and FR-021.

---

### User Story 4 - Help a person who is locked out (Priority: P3)

A person who has lost their phone and their recovery codes asks for help. A platform
administrator checks who they are, then resets their two-step sign-in in the admin
app. The person signs in with their password and sets two-step up again (immediately,
if it is required for them). On a deployment where no administrator can sign in, the
operator of the server can do the same reset from the server's command line.

**Why this priority**: It is rare, but without it a locked-out person has no way back
and the support load lands on whoever runs the database.

**Independent Test**: As a platform administrator, reset two-step for a test person;
confirm their passkeys and recovery codes stop working, an email reaches them, the
activity log records who did it, and they can sign in with only their password (or are
sent to setup if it is required).

**Acceptance Scenarios**:

1. **Given** a platform administrator viewing a person in the admin app, **When** they
   reset that person's two-step sign-in and give a reason, **Then** the person's
   authenticator, recovery codes and passkeys are removed, their sessions and kept
   sign-ins end, the activity log records the administrator and the reason, and the
   person receives an email.
2. **Given** a platform administrator, **When** they try to reset their own two-step
   sign-in, **Then** they cannot; another administrator or the server operator must.
3. **Given** shell access to the server, **When** the operator runs the reset command
   for a person, **Then** the same reset happens and the activity log records that it
   was done from the server.

---

### Edge Cases

- **Clock drift.** A phone whose clock is slightly off still works: codes from the
  previous and next 30-second window are accepted. A code that has already been used
  to sign in is refused for the rest of its window, so it cannot be replayed.
- **Pending second step expires.** If a person enters the right password but no code
  within 5 minutes, they must start again with their password.
- **Password reset.** Resetting a password never skips the second step. Afterwards the
  person signs in with the new password and a code (or a passkey). A reset still ends
  every session, kept sign-in and agent connection, as it does today.
- **Turning two-step on or changing it.** Turning two-step on, turning it off,
  regenerating recovery codes, or an administrator reset ends the person's other
  sessions and kept sign-ins. The browser the person is using stays signed in.
- **Adding or removing a passkey** does not end other sessions; removing one only stops
  that passkey from signing in.
- **Last recovery code.** When a person signs in with their last recovery code, they
  are told they have none left and are prompted to regenerate them.
- **Deployment address changes.** Passkeys belong to the address the deployment is
  served from. If that address changes, existing passkeys stop working; people sign in
  with the password and a code and add passkeys again. The operator documentation says
  so.
- **No internet.** Nothing in this feature contacts a service outside the deployment.
  Authenticator codes are computed on the phone without a network connection.
- **Agent and partner consent.** The portal's connect page (ADR-018, ADR-033) uses the
  normal portal sign-in, so a person with two-step on completes both steps before they
  can approve an agent. Existing agent and partner connections are not ended by
  turning two-step on; the person can revoke them where they are listed today.
- **Admin app sign-in.** The admin app shares the portal's session, so both steps
  completed in one app apply to the other. The admin app's own sign-in page asks for
  the code (and offers passkeys) exactly as the portal's does.
- **Required, with only a passkey.** A person who must use two-step and has a passkey
  but no authenticator app finishes every password sign-in with the passkey. If
  passkeys stop working on the deployment (it loses HTTPS or changes address), they
  are sent to set up an authenticator app instead.
- **Several organizations.** A person who belongs to several organizations has one
  two-step setting. It applies to all of them.

## Requirements *(mandatory)*

### Functional Requirements

**Authenticator app and recovery codes**

- **FR-001**: A signed-in person MUST be able to start two-step setup from their
  personal security settings, which shows a QR code and a setup key that standard
  authenticator apps accept (six-digit codes that change every 30 seconds).
- **FR-002**: Two-step sign-in MUST NOT take effect until the person confirms setup
  with a valid code. An unconfirmed setup MUST be discarded when the person starts
  again.
- **FR-003**: On confirmation, the platform MUST show eight single-use recovery codes
  once, with options to copy and download them, and MUST NOT show them again.
- **FR-004**: A person MUST be able to regenerate recovery codes after confirming
  their password. Regeneration MUST invalidate every earlier code.
- **FR-005**: A person MUST be able to turn two-step off after confirming their
  password, unless it is required for them (FR-020, FR-021).
- **FR-006**: The setup secret and recovery codes MUST be stored encrypted with the
  deployment's key, so that someone who reads only the database cannot use them. The
  platform MUST NOT show recovery codes again after setup or regeneration.

**Sign-in**

- **FR-007**: When a person with two-step on enters the right password, the platform
  MUST ask for a code before creating a session. Every page and API request for that
  person in that browser MUST be refused until a valid code or unused recovery code is
  entered.
- **FR-008**: The platform MUST accept codes from the current, previous and next
  30-second window, and MUST refuse a code that has already been used to sign in.
- **FR-009**: A recovery code MUST work exactly once. After a recovery code is used,
  the person MUST be told how many remain.
- **FR-010**: After five wrong codes in one sign-in attempt, the attempt MUST end. Code
  attempts MUST count toward the same per-account and per-address slowdown as wrong
  passwords.
- **FR-011**: The pending second step MUST expire 5 minutes after the password was
  accepted.
- **FR-012**: **Keep me signed in** (spec 033, FR-011a) MUST be offered on the
  sign-in page, MUST be carried through the second step, and MUST keep the browser signed in for 30 days without
  asking for the password or a code again, until it ends for one of the reasons spec
  033 lists or the reasons in FR-013.
- **FR-013**: Turning two-step on or off, regenerating recovery codes, and an
  administrator reset MUST end every session and kept sign-in of that person except
  the browser where the person made the change.
- **FR-014**: A password reset MUST NOT turn two-step off or bypass it.
- **FR-015**: Every way of signing in MUST apply the second step: portal sign-in, admin
  app sign-in, the sign-in after accepting an invitation, and the sign-in that precedes
  agent or partner consent.

**Passkeys**

- **FR-016**: On a deployment served over HTTPS, a signed-in person MUST be able to add
  passkeys, give each a name, see each passkey's name, creation time and last use, and
  remove any of them.
- **FR-017**: The sign-in pages of the portal and the admin app MUST offer **Sign in
  with a passkey**. A passkey sign-in MUST count as both steps and MUST satisfy a
  two-step requirement.
- **FR-018**: Where passkeys cannot work (the deployment is not served over HTTPS, or
  the browser does not support them), the platform MUST NOT offer them and MUST say
  why on the security settings page.
- **FR-019**: A person MUST be able to use passkeys whether or not they have turned on
  authenticator codes. Removing their last passkey MUST leave password sign-in (with
  codes if on) working.

**Required two-step**

- **FR-020**: Two-step sign-in MUST be required for every super administrator and
  platform administrator. A person who becomes one without two-step set up MUST be
  sent to setup on their next request.
- **FR-021**: An organization administrator MUST be able to require two-step sign-in
  for every member of their organization from the organization's settings. While it is
  required:
  - a person who belongs to any organization that requires it is required to use it
    everywhere, in every organization and in the admin app;
  - members without two-step set up, including those already signed in, MUST be sent
    to setup on their next request;
  - the administrator MUST have two-step set up (or a passkey) before they can turn
    the requirement on;
  - the organization's member list MUST show which members have two-step set up,
    without showing any secret;
  - turning the requirement on or off MUST be recorded in that organization's activity
    log.

  When the requirement is turned off, or a person leaves the last organization that
  requires it, they MAY turn two-step off again; it is not turned off for them.
- **FR-022**: A person for whom two-step is required and not set up MUST be sent to
  setup after their password (or after accepting an invitation) and MUST NOT reach
  any other page or API until setup is confirmed. A passkey sign-in satisfies the
  requirement. A passkey counts only when it is used: a required person whose only
  second step is a passkey MUST finish sign-in with that passkey, and the password
  alone MUST NOT start their session.
- **FR-023**: A person for whom two-step is required MUST NOT be able to turn it off.

**Lock-out help**

- **FR-024**: A platform administrator MUST be able to reset another person's two-step
  sign-in from the admin app, giving a reason. The reset MUST remove the person's
  authenticator, recovery codes and passkeys and end their sessions and kept sign-ins.
- **FR-025**: A platform administrator MUST NOT be able to reset their own two-step
  sign-in.
- **FR-026**: The server operator MUST be able to perform the same reset with a
  command on the server, for deployments where no administrator can sign in.

**Notices and audit**

- **FR-027**: The person MUST receive an email when two-step sign-in is turned on or
  off, recovery codes are regenerated, a recovery code is used to sign in, a passkey is
  added or removed, or an administrator resets their two-step sign-in.
- **FR-028**: Each of the events in FR-027 MUST be recorded in the activity log
  (ADR-028) with the person as subject and the person, the administrator, or "server"
  as actor. These events belong to no organization. The log MUST NOT contain secrets,
  codes or passkey material.
- **FR-029**: A person's security settings MUST show whether two-step is on, how many
  recovery codes remain, and their passkeys.
- **FR-030**: The admin app's users list MUST show, for each person, whether two-step
  is on and how many passkeys they have, without showing any secret.

**Boundaries**

- **FR-031**: The feature MUST NOT contact any service outside the deployment.
- **FR-032**: Agent connections, partner connections, integration application tokens
  and device credentials MUST behave exactly as they do today.

### Key Entities

- **Two-step setting**: belongs to one person. Whether it is set up and confirmed, when
  it was confirmed, the protected setup secret, and the last code used (to refuse
  replays).
- **Recovery code**: belongs to one person's two-step setting. Eight at a time,
  single-use, stored encrypted and never shown again after they are issued.
- **Passkey**: belongs to one person. A name the person chose, when it was added, when
  it was last used, and the public part of the credential. A person can have several.
- **Pending sign-in**: a sign-in where the password was accepted and the second step is
  outstanding. Expires after 5 minutes or five wrong codes; creates no session.
- **Two-step requirement**: whether two-step is required for a person, derived from
  their platform role (FR-020) and their organizations' settings (FR-021).
- **Organization two-step setting**: one per organization, on or off, changed by an
  organization administrator and recorded in that organization's activity log.
- **Security event**: an activity log entry (ADR-028) recording a change to a person's
  two-step setting or passkeys, with the actor and no organization.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can turn on two-step sign-in, from opening their security
  settings to saving their recovery codes, in under 2 minutes.
- **SC-002**: For a person with two-step on, none of the sign-in paths in FR-015 lets
  them reach any page or API without a valid code, recovery code or passkey. Every
  path has an automated test.
- **SC-003**: A person with a passkey signs in with one approval on their device, in
  under 10 seconds, with no password and no code.
- **SC-004**: A deployment with no internet connection signs people in with two-step
  codes exactly as a connected one does, checked on the local development stack with
  outbound traffic blocked.
- **SC-005**: Every event in FR-027 produces both an email and an activity log entry,
  with no secret in either.
- **SC-006**: A locked-out person is back in their account within one administrator
  action, and the reset is visible in the activity log with the administrator's name
  and reason.
- **SC-007**: A used code or recovery code never signs anyone in a second time.

## Assumptions

- Two-step sign-in is optional by default. It is required for platform staff
  (FR-020) and for members of organizations that require it (FR-021).
- Turning the organization requirement on is limited to people who can already
  change that organization's settings; the plan names the exact permission. Tests
  prove that one organization's requirement cannot be read or changed from another
  (constitution III).
- Authenticator codes use the standard time-based one-time password scheme that every
  common authenticator app supports. SMS and email codes are out of scope: SMS is
  weak and costs money per message, and email codes add little when the password
  reset already goes to the same inbox.
- Passkeys require the deployment to be served over HTTPS at a stable address, which
  hosted deployments and the pilot already are. Plain-HTTP or IP-address on-premise
  installs use authenticator codes only.
- The existing password rules, password reset, invitations, sign-in slowdown and
  **Keep me signed in** stay as they are, except where this spec adds the second step.
- Sign-ins and failed sign-ins are still not recorded in the activity log (ADR-028).
  Only changes to a person's security settings are.
- Recovery codes are eight per set, the Laravel default.
- Single sign-on (SAML, OIDC), directory sync (SCIM) and any hosted identity provider,
  including WorkOS, are out of scope. They may become an optional connector in a later
  spec if a customer requires them.
- The decision is recorded in a new ADR that amends ADR-008, merged with this spec's
  plan.
