# Feature Specification: Delete Empty Organizations

**Feature Branch**: `feat/delete-empty-organizations`

**Created**: 2026-10-14

**Status**: Accepted

**Input**: User description: "I want to be able to delete Organizations which doesn't have devices from the Admin panel"

## Context

Platform administrators can create organizations in the admin app but cannot remove
one. Organizations made by mistake or for a trial stay forever: on the pilot, two
organizations ("Alberta IoT" and "Alberta-IoT") have no members, no devices and nothing
but audit rows.

No code deletes an organization today. The model soft-deletes, but a soft-deleted
organization breaks the runtime's state sync, agent sign-in and invitation links,
and keeps its slug. A hard delete fails: audit rows, retention settings and other
tables refer to the organization with restrictive foreign keys. Some resources also
live outside Laravel's database (broker logins for connections and gateways, the
per-organization adapter runtime with its TLS port and state directory), and nothing
can tear them down yet.

This feature deletes an organization permanently when it holds nothing that needs
such a teardown or that a person would want to keep. Everything else blocks the
deletion, and the admin app says what is in the way.

**Terms**: a *blocker* is a resource whose presence prevents deletion; *removed data*
is what deletion erases with the organization.

## Clarifications

### Session 2026-10-14

- Q: What may a deletion remove? → A: Only empty organizations. Devices, broker
  connections and gateways, an adapter runtime, device profiles, automations,
  integrations and geofences block it; memberships, roles, invitations, dashboards,
  sites, settings, AI-agent connections and audit history are removed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete an empty organization (Priority: P1)

A platform administrator deletes an organization that holds no blockers. They see
what will be removed and confirm by typing the organization's slug.

**Why this priority**: it is the request.

**Independent Test**: create an organization in admin, invite someone, add a role,
then choose **Delete organization** on its row, type the slug and confirm. The row
disappears, the invitation link stops working and the invited person's account (if
any) remains.

**Acceptance Scenarios**:

1. **Given** an organization without blockers, **When** the administrator chooses
   **Delete organization**, **Then** a dialog lists what will be removed with counts
   (members who lose access, roles, invitations, dashboards, sites, AI-agent
   connections, assistant conversations, audit events) and states that this cannot
   be undone.
2. **Given** that dialog, **When** the typed text is not the slug, **Then** the
   delete button stays disabled; the API also refuses a wrong slug.
3. **Given** the slug is typed, **When** they confirm, **Then** the organization and
   its removed data are gone, a confirmation shows, and the list no longer shows it.
4. **Given** the organization is deleted, **Then** its members keep their accounts and
   other memberships, its AI-agent tokens no longer work, its open invitations no
   longer resolve, its slug can be reused, and one audit event records who deleted
   which organization.

---

### User Story 2 - See why an organization cannot be deleted (Priority: P2)

For an organization with blockers, the administrator learns what is in the way
instead of getting an error.

**Why this priority**: without it the action looks broken for most real
organizations.

**Independent Test**: choose **Delete organization** on an organization with devices;
the dialog lists "6 devices" (and any other blockers) and offers no delete button.

**Acceptance Scenarios**:

1. **Given** an organization with any blocker, **When** the administrator opens the
   delete dialog, **Then** it lists each blocker with its count and explains that
   they must be removed first; no confirmation field or delete button is shown.
2. **Given** a blocker appears after the dialog opened (for example a device is
   registered), **When** they confirm, **Then** nothing is deleted and the dialog
   shows the current blockers.
3. **Given** the Organizations list, **Then** a **Devices** column shows each
   organization's device count, so empty organizations are easy to find.

### Edge Cases

- Archived devices count as devices: their history is kept.
- Soft-deleted device profiles count as device profiles (on delete they would
  otherwise become platform templates).
- An assistant run still holding a cost reservation blocks deletion until it stops.
- Deleting the organization a member had selected in the portal returns them to the
  organization chooser.
- Two administrators deleting the same organization: the second gets "not found".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /api/v1/admin/organizations/{organization}/deletion` MUST return
  whether the organization can be deleted, its blockers and the removed data, each
  with a count, for platform administrators (`PlatformAdministration.manage-organizations`).
- **FR-002**: Blockers are: devices (any lifecycle), broker connections, gateways,
  adapter runtimes, device profiles (including soft-deleted), automations,
  integration applications, geofences and assistant runs holding a reservation,
  plus rows in any other table whose foreign key would stop the delete (these exist
  only alongside one of the blockers above). Only blockers with rows are shown.
- **FR-003**: `DELETE /api/v1/admin/organizations/{organization}` MUST require the
  organization's slug (`?slug=`; the contract describes DELETE parameters in the
  query), MUST re-check blockers under a lock, and MUST return 409 with the current
  blockers when any exist.
- **FR-004**: Deleting MUST remove, in one transaction: memberships, roles and their
  assignments, invitations, the permission ceiling, dashboards, sites, automation
  settings, notification events, retention settings, audit events, AI-agent
  connections and assistant conversations, then the organization row itself.
- **FR-005**: Before the rows go, deletion MUST revoke the Passport tokens of the
  organization's AI-agent connections; after commit it MUST delete the assistant
  conversations' stored files and SDK conversation rows, and clear the permission
  cache.
- **FR-006**: Deletion MUST record one `organization.deleted` audit event with no
  organization, the acting user, the organization's uuid and its name and slug.
- **FR-007**: The admin Organizations list MUST show a **Devices** column and offer
  **Delete organization** on every row; the dialog follows US1 and US2.
- **FR-008**: A test MUST fail when a table gains a foreign key to `organizations` that
  neither cascades nor is handled as a blocker or removed data.
- **FR-009**: The OpenAPI contract and `packages/api-client` MUST describe both
  operations, including the 409 and 422 responses.

### Key Entities

No new tables. `organizations` rows are deleted permanently (not soft-deleted).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the pilot, "Alberta-IoT" (or another empty organization the owner
  chooses) can be deleted from admin, and "Laine demo (simulated)" shows its blockers.
- **SC-002**: The API tests pass on PostgreSQL, including a deletion of an
  organization holding every kind of removed data, and the FR-008 guard.
- **SC-003**: The admin Playwright tests for US1 and US2 pass in CI.

## Assumptions

- Tearing down broker logins, adapter runtimes and runtime history is later work; until
  then those resources block deletion.
- Members are not notified.
- Deleted organizations cannot be restored; the pre-deployment and daily checkpoints
  are the recovery path.
