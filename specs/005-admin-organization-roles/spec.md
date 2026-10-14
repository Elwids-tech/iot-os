# Feature Specification: Organization Roles in Admin

**Feature Branch**: `feat/admin-organization-roles`

**Created**: 2026-10-13

**Status**: Accepted

**Input**: User description: "As the platform admin, in the admin portal, I am unable to create roles for organisations. I should be able to create an organization and then create roles for the organization and then invite users for the organization."

## Context

The admin app lets a platform administrator create an organization, set its
permission ceiling, edit the permissions of an existing role and invite people with
the organization's roles. It cannot create, rename or delete a role. A new
organization therefore only ever has its three built-in roles (Organization Admin,
Moderator, Member), unless one of its own administrators signs in to the portal and
adds a custom role there.

The API already allows this. The organization role routes
(`/api/v1/organizations/{organization}/roles`) authorize platform administrators
without membership, and they grant the whole ceiling. The admin app already calls
the organization member routes the same way. The gap is the admin interface, plus an
API test proving that a non-member platform administrator can use the role routes.

**Terms**: *platform administrator* is a person with
`PlatformAdministration.manage-organizations` (super administrators pass every check).
*Ceiling* is the set of tenant permissions an organization's roles may hold.
*Custom role* is a role that is not one of the three built-in roles.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a role for an organization (Priority: P1)

A platform administrator creates a custom role for an organization from the admin
app. They choose the organization, name the role and pick its permissions from that
organization's ceiling.

**Why this priority**: this is the missing capability the request names.

**Independent Test**: create an organization in admin, open **Roles → New role**,
choose the organization, name the role, tick permissions and save. The role appears
in the Roles list for that organization with the chosen permission count.

**Acceptance Scenarios**:

1. **Given** an organization exists, **When** the administrator opens **New role**
   from the Roles page or from the organization's row actions, **Then** the
   organization is preselected when they came from a filtered list or a row.
2. **Given** an organization is chosen, **When** the permission list loads, **Then**
   it shows exactly that organization's ceiling, grouped like the existing role
   editor. Changing the organization reloads it and keeps only the selected
   permissions the new organization allows.
3. **Given** a name and any number of permissions (zero is allowed), **When** they
   create the role, **Then** they land on the new role's page with a confirmation.
4. **Given** a name that another role in the same organization already has, **When**
   they create the role, **Then** the name field shows the API's error and nothing
   they entered is lost.
5. **Given** unsaved input, **When** they leave the page, **Then** they are asked
   before it is discarded.

---

### User Story 2 - Invite people with the organization's roles (Priority: P2)

Straight after creating an organization and its roles, the administrator invites
people to it and chooses any of its roles, built-in or custom.

**Why this priority**: inviting already works; this story makes it part of the same
flow and proves custom roles reach acceptance.

**Independent Test**: from the organization's row actions choose **Invite user**,
enter an email, tick the new custom role and send. Accepting the invitation makes the
person a member holding that role.

**Acceptance Scenarios**:

1. **Given** the Organizations list, **When** the administrator chooses **Invite
   user** on a row, **Then** the invite dialog opens with that organization selected
   and its roles listed, including custom roles.
2. **Given** the Users list filtered to one organization, **When** they choose
   **Invite user**, **Then** that organization is preselected.
3. **Given** an invitation with a custom role, **When** the invited person accepts,
   **Then** they become a member holding exactly that role's permissions.

---

### User Story 3 - Rename and delete roles (Priority: P3)

The administrator corrects a role's name, and deletes a custom role nobody uses.

**Why this priority**: roles created by mistake must not linger, but this is
housekeeping after US1.

**Independent Test**: on a custom role's page choose **Rename**, save a new name;
then choose **Delete role** and confirm. The role disappears from the list.

**Acceptance Scenarios**:

1. **Given** any role except Organization Admin, **When** they rename it, **Then**
   the title updates and unsaved permission ticks on the page are kept.
2. **Given** a custom role that no member holds and no pending invitation uses,
   **When** they delete it and confirm, **Then** they return to Roles with a
   confirmation.
3. **Given** a role that a member holds or a pending invitation uses, **When** they
   try to delete it, **Then** the API's reason is shown and the role stays.
4. **Given** a built-in role, **Then** no delete action is offered; Organization
   Admin offers neither rename nor delete.

### Edge Cases

- The organization has a restricted ceiling: only ceiling permissions are offered,
  and the API rejects anything else.
- The organization has no permissions in its ceiling: the role can still be created
  with none, and the page says the ceiling is empty.
- A role is deleted in another tab: opening its page shows the existing "could not
  load" state.
- A non-administrator, or an administrator of another organization, calls the role
  routes for an organization they don't administer: 403, nothing changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The admin app MUST let a platform administrator create a custom role
  for any organization, with a name and permissions chosen from that organization's
  ceiling.
- **FR-002**: The Roles page MUST offer **New role**, preselecting the organization
  filter when one is set.
- **FR-003**: The Organizations list MUST offer, per organization, **Roles** (the
  filtered Roles list), **New role** and **Invite user** with that organization
  preselected.
- **FR-004**: The Users page's **Invite user** MUST preselect the organization
  filter when one is set.
- **FR-005**: A role's page MUST offer **Rename** for every role except
  Organization Admin, and **Delete role** for custom roles only.
- **FR-006**: Errors from the API (duplicate name, permission outside the ceiling,
  role in use) MUST be shown next to the relevant field or in the dialog, without
  discarding input.
- **FR-007**: The admin app MUST use the existing organization role routes
  (`role-permissions`, `POST roles`, `PATCH roles/{role}`, `DELETE roles/{role}`);
  no new endpoint is added.
- **FR-008**: The API test suite MUST prove that a platform administrator who is not
  a member can create, rename and delete roles for an organization, that the ceiling
  and organization boundary hold, and that a custom role created this way can be used
  in an invitation that is then accepted.
- **FR-009**: The OpenAPI contract MUST describe every status these routes return.

### Key Entities

No new data. Roles (`roles`, with `organization_id`, `display_name`, `is_default`),
their permissions and invitations (`organization_invitations.role_ids`) are unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the rebuilt stack, a platform administrator goes from "New
  organization" to a sent invitation holding a custom role without leaving the admin
  app.
- **SC-002**: The API tests in FR-008 and the admin Playwright tests for US1 to US3
  pass in CI.
- **SC-003**: `contract:export --check` and the contract response checks pass with
  the role routes exercised.

## Assumptions

- Platform administrators keep their current authority inside organizations. When
  spec 003 replaces it with an explicit platform grant, that grant must cover these
  routes as it covers the member routes the admin app already uses.
- A single-organization detail page in admin is out of scope; the Organizations row
  actions provide the flow.
- Invitation emails keep linking to the portal (`FRONTEND_URL`).
