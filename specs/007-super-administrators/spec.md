# Feature Specification: Super Administrators in Admin

**Feature Branch**: `feat/super-administrators`

**Created**: 2026-10-14

**Status**: Accepted

**Input**: User description: "I want to create other super-admins as well. Right now I can
only create Tenant users only." Then: "Also I want to make an existing user a
super-admin."

## Context

A super administrator (`users.is_super_admin`) passes every authorization check: they
manage the platform in the admin app and can act in every organization. Today the only
ways to get one are the `deployment:administrator` command (first administrator of a
deployment), the demo seeder and the staging bootstrap. The admin app can only invite
people into an organization with that organization's roles, so every account it creates
is a tenant user. Nothing in the admin app or the API grants or removes super
administrator access, so a deployment has exactly one, and losing that person's access
means a database change.

This feature lets a super administrator add more: by inviting someone new, or by
promoting an existing account. It also lets them take the access away again.

**Terms**: *super administrator* is a user with `is_super_admin`. *Platform
administrator* is a user holding the `platform-administrator` platform role, who manages
organizations, users and invitations in the admin app but is not a super administrator.
*Super-administrator invitation* is an invitation that belongs to no organization and
grants super administrator access when accepted.

## Clarifications

### Session 2026-10-14

- Q: How are super administrators added? → A: Both: invite a new person by email, and
  make an existing user a super administrator from the Users page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Make an existing user a super administrator (Priority: P1)

A super administrator opens **Users** in the admin app and chooses **Make super
administrator** on someone's row. After confirming, that person has super administrator
access on their next request.

**Why this priority**: it is the quickest way to add a second super administrator, and
most people who need the access already have an account.

**Independent Test**: sign in to admin as the seeded super administrator, choose **Make
super administrator** on a tenant user's row and confirm. The row's platform access
reads "Super admin", and that user can open the admin app.

**Acceptance Scenarios**:

1. **Given** a super administrator on **Users**, **When** they open the actions of a
   user who is not a super administrator, **Then** **Make super administrator** is
   offered, whether or not the user belongs to an organization.
2. **Given** they choose it, **Then** a confirmation explains that the person will be
   able to manage the platform and every organization; **When** they confirm, **Then**
   the row shows "Super admin" and a confirmation message appears.
3. **Given** the change, **Then** the person keeps their organization memberships and
   roles, and one audit event records who granted access to whom.
4. **Given** a platform administrator who is not a super administrator, **Then** the
   Users page offers neither action, and the API refuses the change with 403.

---

### User Story 2 - Remove super administrator access (Priority: P1)

A super administrator removes another super administrator's access from **Users**.

**Why this priority**: granting access without a way to take it back is unsafe; it
ships with US1.

**Independent Test**: after US1, choose **Remove super administrator** on that user's
row and confirm. The row reads what it read before ("Tenant user" or "Platform
administrator"), and that user can no longer open the admin app unless they hold the
platform administrator role.

**Acceptance Scenarios**:

1. **Given** a super administrator on **Users**, **When** they open the actions of
   another super administrator, **Then** **Remove super administrator** is offered;
   **When** they confirm, **Then** the access is removed and one audit event records
   who removed it from whom.
2. **Given** their own row, **Then** **Remove super administrator** is not offered, and
   the API refuses a self-removal with 422, so at least one super administrator always
   remains.
3. **Given** the person is signed in elsewhere, **Then** their next request is
   authorized without super administrator access.

---

### User Story 3 - Invite a new super administrator (Priority: P2)

A super administrator invites someone by email as a super administrator. The person
receives an invitation, chooses their name and password, and lands in the admin app.

**Why this priority**: needed when the person has no account yet; US1 covers everyone
who has one.

**Independent Test**: choose **Invite user** on **Users**, pick **Super administrator**,
enter a new email and send. Open the link from the mail log, create the account, then
open the admin app as that person.

**Acceptance Scenarios**:

1. **Given** a super administrator opens **Invite user**, **Then** they can choose
   between inviting into an organization (today's flow, unchanged) and inviting a super
   administrator; for a super administrator only the email is asked.
2. **Given** a platform administrator who is not a super administrator, **Then** the
   dialog offers only the organization flow, and the API refuses a super-administrator
   invitation with 403.
3. **Given** the invitation is sent, **Then** the **Invitations** list shows it with
   "All organizations" as its organization and "Super administrator" as its role, and
   it can be resent and revoked like any invitation.
4. **Given** someone without an account opens the link, **Then** the page says they are
   invited as a super administrator and asks for their name and password; **When** they
   accept, **Then** their account is created as a super administrator, they are signed
   in, and the page links to the admin app.
5. **Given** the email belongs to an existing account, **When** that person signs in
   with the invited email and accepts, **Then** the account becomes a super
   administrator and keeps its memberships.
6. **Given** an invitation is accepted, **Then** one audit event records the grant, with
   the inviter as the actor.

### Edge Cases

- Inviting an email that already belongs to a super administrator is refused with a
  field error on the email.
- Inviting the same email again revokes the earlier pending super-administrator
  invitation, as organization invitations do; organization invitations for that email
  are unaffected.
- A super-administrator invitation expires after seven days and can be resent.
- Accepting a super-administrator invitation after the account was promoted another way
  succeeds and changes nothing else.
- When the inviter is no longer a super administrator, their pending
  super-administrator invitations stop working: the link says the invitation is not
  active.
- Two super administrators removing each other at the same moment: the second request
  is refused, because its actor is no longer a super administrator.
- Making a user who is already a super administrator a super administrator again (or
  removing access from one who is not) succeeds without a new audit event.
- Deleting an organization does not touch super-administrator invitations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Only super administrators MAY grant or remove super administrator access
  or send, resend or revoke super-administrator invitations; everyone else gets 403.
- **FR-002**: `PUT /api/v1/admin/super-administrators/{user}` MUST make the user (integer
  id, [ADR-013](../../docs/adr/ADR-013-integer-user-ids.md)) a super administrator and
  return the user as the Users directory shows them; repeating it is harmless.
- **FR-003**: `DELETE /api/v1/admin/super-administrators/{user}` MUST remove the access
  and answer 204. It MUST refuse the acting user's own id with 422, and it MUST re-check,
  while holding a lock on every super administrator, that the actor is still one.
- **FR-004**: `POST /api/v1/admin/super-administrators/invitations` with an email MUST
  create a super-administrator invitation that belongs to no organization and holds no
  roles, revoke any earlier pending super-administrator invitation for that email, mail
  the link and answer 201 with the invitation. It MUST refuse an email that belongs to a
  super administrator with 422.
- **FR-005**: The admin invitation list (`GET /api/v1/admin/invitations`) MUST include
  super-administrator invitations, marked as such, with no organization; revoking one
  through `DELETE /api/v1/admin/invitations/{invitation}` MUST follow FR-001.
- **FR-006**: The public invitation endpoints MUST describe a super-administrator
  invitation as such (no organization) and accepting it MUST create the account as, or
  promote the signed-in invited account to, a super administrator without adding any
  organization membership. Acceptance rules for organization invitations do not change.
- **FR-007**: Every change of super administrator access (grant, removal, accepted
  invitation) MUST record one audit event with no organization, the acting user and the
  affected user. A request that changes nothing records none.
- **FR-008**: The admin Users page MUST offer **Make super administrator** and **Remove
  super administrator** (not on one's own row) to super administrators only, each behind
  a confirmation.
- **FR-009**: The admin **Invite user** dialog MUST let super administrators choose a
  super-administrator invitation (email only); the Invitations list MUST show those
  invitations as "All organizations" / "Super administrator" and resend them through
  FR-004.
- **FR-010**: The shared accept-invitation page (portal and admin) MUST explain a
  super-administrator invitation and, once accepted, link to the admin app.
- **FR-011**: The OpenAPI contract and `packages/api-client` MUST describe the new
  operations and the changed invitation shapes.

### Key Entities

- **Invitation**: gains a super-administrator kind. Such an invitation has no
  organization and no roles; everything else (email, token, inviter, expiry, accepted
  and revoked times) is as today.
- **User**: unchanged. `is_super_admin` is the flag being granted and removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a super administrator can promote an existing user,
  demote them again, and invite a new super administrator who then signs in to the admin
  app, all from the admin app with no console access.
- **SC-002**: A platform administrator who is not a super administrator sees none of the
  three actions, and the API refuses each of them with 403.
- **SC-003**: The API tests for every acceptance scenario and edge case above pass on
  PostgreSQL, and organization invitation tests pass unchanged.

## Assumptions

- The `platform-administrator` role and the platform-team API
  (`/api/v1/admin/platform-team`) are unchanged; managing that role in the admin app is
  separate work.
- `deployment:administrator`, the seeder and the staging bootstrap keep creating the
  first super administrator.
- Spec 003 (US6) will move super administrators onto an explicit `super-administrator`
  platform role and keep `is_super_admin` as the platform-team identity. Its data
  migration attaches the role to every super administrator, so users granted access by
  this feature carry over; once US6 lands, granting and removing must also attach and
  detach that role.
- Nobody is notified when their access is granted or removed, other than through the
  invitation mail.
- Super-administrator access applies on the next request; existing sessions and agent
  tokens are not revoked when it is removed.
