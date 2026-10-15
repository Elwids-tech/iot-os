# Feature Specification: Platform Administrators in Admin

**Feature Branch**: `feat/platform-administrators`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Follow-up to spec 007: "Let super administrators grant and remove the
`platform-administrator` platform role from the admin app's Users page."

## Context

A *platform administrator* holds the `platform-administrator` platform role. It grants
the `PlatformAdministration.*` permissions: they use the admin app to manage
organizations, their roles and members, users, invitations and telemetry retention,
but they are not super administrators and cannot manage who administers the platform.

The API to grant and remove the role exists (`PUT /api/v1/admin/platform-team/{user}`
with `is_platform_administrator`, super administrators only), but nothing calls it:
there is no admin screen and no client method. The Users page shows "Platform
administrator" in its **Platform access** column for people who hold the role, yet the
only ways to give someone the role are the demo seeder and a hand-made API request.
Changes are not audited.

This feature adds the missing admin actions next to spec 007's super-administrator
actions and audits every change.

**Terms**: *platform administrator* and *super administrator* as in
[spec 007](../007-super-administrators/spec.md). *The role* is the
`platform-administrator` platform role.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Make a user a platform administrator (Priority: P1)

A super administrator opens **Users** in the admin app and chooses **Make platform
administrator** on someone's row. After confirming, that person can open the admin app
on their next request.

**Why this priority**: it is the request; the role can only be granted by hand today.

**Independent Test**: sign in to admin as the seeded super administrator, choose **Make
platform administrator** on a tenant user's row and confirm. The row's platform access
reads "Platform administrator", and that user can sign in to the admin app.

**Acceptance Scenarios**:

1. **Given** a super administrator on **Users**, **When** they open the actions of a
   user who is neither a super administrator nor a platform administrator, **Then**
   **Make platform administrator** is offered, whether or not the user belongs to an
   organization.
2. **Given** they choose it, **Then** a confirmation explains what platform
   administrators can do; **When** they confirm, **Then** the row shows "Platform
   administrator" and a confirmation message appears.
3. **Given** the change, **Then** the person keeps their organization memberships and
   roles, and one audit event records who granted the role to whom.
4. **Given** a platform administrator who is not a super administrator, **Then** the
   Users page offers neither action, and the API refuses the change with 403.

---

### User Story 2 - Remove platform administrator access (Priority: P1)

A super administrator removes the role from **Users**.

**Why this priority**: granting access without a way to take it back is unsafe; it
ships with US1.

**Independent Test**: after US1, choose **Remove platform administrator** on that
user's row and confirm. The row reads "Tenant user", and that user can no longer open
the admin app.

**Acceptance Scenarios**:

1. **Given** a super administrator on **Users**, **When** they open the actions of a
   platform administrator who is not a super administrator, **Then** **Remove platform
   administrator** is offered; **When** they confirm, **Then** the role is removed and
   one audit event records who removed it from whom.
2. **Given** the person is signed in elsewhere, **Then** their next request is
   authorized without the role.

### Edge Cases

- Granting the role to someone who holds it (or removing it from someone who does not)
  succeeds without a new audit event.
- A super administrator's row offers neither action, including one's own. A super
  administrator who also holds the role keeps it when their super administrator access
  is removed; their row then offers **Remove platform administrator**.
- A super administrator who loses that access while their request to change the role
  is in flight is refused with 403, and nothing changes.
- A user id that is not a number, or belongs to nobody, is 404.
- The role carries no organization: granting or removing it never touches memberships,
  organization roles or invitations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Only super administrators MAY grant or remove the role; everyone else
  gets 403. The check MUST be repeated while the change holds its lock, so an actor
  whose super administrator access was just removed is refused.
- **FR-002**: `PUT /api/v1/admin/platform-team/{user}` (integer id,
  [ADR-013](../../docs/adr/ADR-013-integer-user-ids.md)) with
  `is_platform_administrator` MUST grant or remove the role and return the user with
  their platform roles; repeating it is harmless. Its request and response shapes do
  not change.
- **FR-003**: Every grant and removal MUST record one audit event with no
  organization, the acting user and the affected user (`user_id` and email). A request
  that changes nothing records none.
- **FR-004**: The admin Users page MUST offer **Make platform administrator** and
  **Remove platform administrator** to super administrators only, on rows of users who
  are not super administrators, each behind a confirmation.
- **FR-005**: The OpenAPI contract MUST fully describe the update's response (removing
  it from the pending-schema list) and `packages/api-client` MUST gain the calls.

### Key Entities

No new tables. `platform_role_user` rows for the `platform-administrator` role are
added and removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the local stack, a super administrator makes a tenant user a platform
  administrator, that user signs in to the admin app, and the super administrator then
  removes the role, all from the admin app with no console access.
- **SC-002**: A platform administrator who is not a super administrator sees neither
  action, and the API refuses both with 403.
- **SC-003**: The API tests for every acceptance scenario and edge case above pass on
  PostgreSQL, and the admin Playwright tests for US1, US2 and SC-002 pass.

## Assumptions

- The actions are offered only on rows of users who are not super administrators. A
  super administrator already passes every check, so granting them the role would
  change nothing the page shows.
- Changes are audited like spec 007's (`user.platform_administrator_granted`,
  `user.platform_administrator_revoked`), since the role opens the admin app.
- `platform-administrator` stays the only platform role and keeps its permissions.
- `GET /api/v1/admin/platform-team` keeps working as it does; the Users page already
  lists everyone with their platform roles, so the admin app does not call it.
- Spec 003 (US6) moves super administrators onto a `super-administrator` platform role
  and leaves `is_super_admin` as the platform-team identity; the rule "only super
  administrators manage the platform team" carries over unchanged.
- Nobody is notified when the role is granted or removed.
- The role applies on the next request; existing sessions are not revoked when it is
  removed.
