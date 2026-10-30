# Feature Specification: Billing Accounts

**Feature Branch**: `spec/023-billing-accounts`

**Created**: 2026-10-29

**Status**: Draft; the drafting decisions below follow the owner's request of
2026-10-29 and can be revisited with `/speckit-clarify`

**Input**: Owner request, 2026-10-29, paraphrased without the partner's name: "Create
tenants under a single billing account. An integrator should be able to create more
tenants that fall under their billing account. As a super admin, when I create an
organization I should be able to create a billing account along with it, or attach
the new organization to an existing billing account."

## Context

The organization is the platform's only boundary. It owns its data, devices, adapter
runtime, roles, members and permission ceiling. Platform administrators create
organizations in the admin app with a name and a slug. Nothing records who pays for
an organization or which organizations belong to the same customer of the platform.

An integrator installs devices for several end customers, such as a shop and a home.
Each customer needs its own organization so they cannot see each other, but the
integrator is one customer of the platform and should have one account covering all
of them. Today the integrator has to ask a platform administrator for every new
organization, and nothing ties those organizations together.

This feature adds **billing accounts**, as decided in
[ADR-026](../../docs/adr/ADR-026-billing-accounts.md). A billing account groups the
organizations one customer of the platform pays for. Platform administrators choose
or create the billing account when they create an organization. A billing account's
owners create further organizations under it themselves, up to a limit. Usage
metering, prices and invoices will build on billing accounts later and are not part
of this feature.

**Terms**:

- A *billing account* is the payer of record for one or more organizations.
- Its *organizations* are the organizations currently assigned to it.
- An *owner* is a user a platform administrator has allowed to see the account and
  create organizations under it.
- The *organization limit* is the most organizations the account may have when an
  owner creates one.
- An *assignment* records that an organization belongs to an account from a point in
  time.

## Decisions

These follow the owner's request. `/speckit-clarify` may revisit them.

- **D1. A billing account grants no access.** Being an owner gives no access to an
  organization's data. Owners work in the organizations they create through ordinary
  membership as Organization Admin. Other organizations on the account are listed for
  them but cannot be opened without membership.
- **D2. Owner self-service is limited.** A new billing account has an organization
  limit of 1, so owners cannot create more organizations until a platform
  administrator raises it. Platform administrators are not bound by the limit.
- **D3. Existing API clients keep working.** When an organization is created through
  the API without naming a billing account, a new account named after the
  organization is created with it. The admin app defaults to the same choice.
- **D4. Only platform administrators assign owners and move organizations** between
  billing accounts.
- **D5. Only owners and platform administrators see billing accounts.** Members of an
  organization see nothing about its billing account.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an organization under a new or existing billing account (Priority: P1)

A super administrator opens **Organizations** in the admin app and chooses **New
organization**. Under **Billing account**, **New billing account** is selected, with
its name filled in from the organization's name. For the integrator's second customer
they choose **Existing billing account** instead, search for the integrator's account
by name, and select it. Both organizations are created, and the Organizations list
shows each one's billing account.

**Why this priority**: it is the request. Every other part of the feature depends on
organizations belonging to billing accounts.

**Independent Test**: in the admin app, create one organization with a new billing
account and a second attached to that same account. The account lists both
organizations, and both work as ordinary organizations: invitations, devices and
dashboards are unaffected.

**Acceptance Scenarios**:

1. **Given** a platform administrator who can manage organizations, **When** they open
   **New organization**, **Then** the form has a **Billing account** choice: **New
   billing account** (selected by default, with a name field prefilled from the
   organization name and an optional contact email) or **Existing billing account**
   (a searchable selector of accounts by name).
2. **Given** they create the organization with a new billing account, **Then** both
   are created together. If either cannot be created, neither is.
3. **Given** they choose an existing billing account, **Then** the organization is
   created and assigned to it, and the account lists it.
4. **Given** a request to create an organization through the API that names no
   billing account, **Then** a new account named after the organization is created
   with it.
5. **Given** the **Organizations** list, **Then** it shows each organization's billing
   account, linked to the account's page.
6. **Given** the rollout, **Then** every existing organization has a billing account of
   its own named after it, with no owners and a limit of 1.

---

### User Story 2 - Manage billing accounts (Priority: P1)

The super administrator opens **Billing accounts** in the admin app and finds the
integrator's account. Its page lists its two organizations, its owners and its
history. They make the integrator an owner, raise the organization limit to 10, and
move a third organization, which the integrator set up earlier as a separate account,
into this one. The empty account left behind is deleted.

**Why this priority**: owners and limits have to be set before an integrator can
create organizations, and organizations created before billing accounts existed need
regrouping.

**Independent Test**: create a billing account, make a user its owner, set its limit,
and move an organization into it. The page shows the change in its history with who
made it and when. The organization's members, devices and data are unchanged.

**Acceptance Scenarios**:

1. **Given** a platform administrator, **When** they open **Billing accounts**,
   **Then** they see every account with its name, number of organizations, owners
   and organization limit, and can search by name.
2. **Given** an account's page, **Then** it shows the account's details, its
   organizations, its owners and a history of changes. The administrator can rename
   the account and change its contact email, notes and organization limit.
3. **Given** a platform administrator, **When** they add or remove an owner, choosing
   from existing users with a searchable selector, **Then** the owner sees or stops
   seeing the account from their next request. Their memberships in organizations do
   not change.
4. **Given** a platform administrator, **When** they move an organization to another
   billing account, **Then** the organization belongs to the new account from that
   moment. It is recorded in both accounts' history. Nothing in the organization
   changes.
5. **Given** an account with no organizations, **When** a platform administrator
   deletes it, **Then** it is removed. An account with organizations cannot be
   deleted, and the page says to move them first.
6. **Given** a platform administrator sets a limit lower than the account's current
   number of organizations, **Then** nothing is removed. Owners can create no more
   until the account is below the limit.

---

### User Story 3 - An owner creates organizations under their billing account (Priority: P2)

The integrator, an owner of their billing account, opens **Billing accounts** from the
user menu in the portal. It shows "2 of 10 organizations" and lists Corner Shop and
Home. They choose **New organization**, enter "Lakeside Café" and create it. The
portal switches to Lakeside Café, where they are Organization Admin, and they invite
the café's manager.

**Why this priority**: it removes the platform administrator from every new customer.
User Stories 1 and 2 are useful on their own, with platform administrators creating
organizations, so this comes second.

**Independent Test**: as an owner of an account below its limit, create an
organization from the portal. You land in it as Organization Admin, and it appears on
the account in both the portal and the admin app. At the limit, **New organization**
is refused with a message naming the limit.

**Acceptance Scenarios**:

1. **Given** an owner, **When** they open **Billing accounts**, **Then** they see the
   account's name, its organizations with each one's name and creation date, and how
   many organizations the limit allows.
2. **Given** an owner of an account below its limit, **When** they create an
   organization with a name, **Then**:
   - it is created under the account with the built-in roles;
   - the owner is its Organization Admin;
   - the portal switches to it.
   An address name (slug) is suggested from the name, and the owner can change it. If
   the owner leaves it alone and it is taken, a free one is used.
3. **Given** an account at its limit, **When** an owner tries to create an
   organization, **Then** it is refused, with a message naming the limit and saying to
   contact the platform operator.
4. **Given** an organization on the account that the owner is not a member of,
   **Then** it is listed but cannot be opened. It is marked "Not a member".
5. **Given** an owner of several billing accounts, **When** they create an
   organization, **Then** they choose which account it belongs to.
6. **Given** a user who owns no billing account, **Then** the portal shows no
   **Billing accounts** entry.
7. **Given** an owner who belongs to no organization yet, **When** they open the
   portal, **Then** it points them to **Billing accounts** to create one, instead of
   telling them to ask for an invitation.

---

### Edge Cases

- **Two owners create organizations at the limit at the same time.** Only one
  succeeds, and the account never exceeds its limit through owner creation.
- **An owner is removed while the creation form is open.** Creating is refused on
  submit.
- **Slug already taken.** The suggested slug avoids existing ones. A slug the owner
  enters that is taken is refused with a message, as in the admin app.
- **An account with no owners.** Only platform administrators can create
  organizations under it.
- **A platform administrator who is also an owner.** The admin app is not bound by the
  limit. The portal is.
- **Deleting an organization** (spec 006). The account keeps the organization's
  assignment history and its name.
- **Moving the only organization out of an account.** The account remains, empty,
  until someone deletes it.
- **Renaming an account.** The new name shows everywhere at once. The history records
  the old name.

## Requirements *(mandatory)*

### Functional Requirements

**Billing accounts**

- **FR-001**: The platform MUST support billing accounts. Each has a name (required),
  a billing contact email and notes (both optional), owners, and an organization
  limit.
- **FR-002**: Every organization MUST belong to exactly one billing account at all
  times.
- **FR-003**: The rollout MUST create one billing account per existing organization,
  named after it, with no owners and a limit of 1.
- **FR-004**: A billing account MUST grant no access to its organizations. Owners and
  account membership MUST NOT change what anyone can read or do inside an
  organization.

**Creating organizations**

- **FR-005**: When a platform administrator creates an organization, they MUST choose
  either a new billing account (name prefilled from the organization's name, with an
  optional contact email) or an existing one, chosen with a searchable selector. New
  is the default.
- **FR-006**: An organization and a new billing account created with it MUST be
  created together or not at all.
- **FR-007**: A request to create an organization that names no billing account MUST
  create a new account named after the organization.
- **FR-008**: Platform administrators MUST NOT be bound by the organization limit.

**Managing billing accounts**

- **FR-009**: Platform administrators MUST be able to list and search billing
  accounts, and open one to see its details, organizations, owners and history.
- **FR-010**: Platform administrators MUST be able to rename an account and change
  its contact email, notes and organization limit.
- **FR-011**: Platform administrators MUST be able to add and remove owners, chosen
  from existing users. Owner changes MUST take effect by the owner's next request and
  MUST NOT change any membership.
- **FR-012**: Platform administrators MUST be able to move an organization to another
  billing account. A move MUST NOT change the organization's members, roles, devices,
  data or configuration.
- **FR-013**: Platform administrators MUST be able to delete a billing account that has
  no organizations, and MUST NOT be able to delete one that has.
- **FR-014**: The **Organizations** list in the admin app MUST show each
  organization's billing account.

**Owners**

- **FR-015**: Owners MUST be able to see, in the portal, each billing account they
  own: its name, its organizations (name and creation date) and its limit.
- **FR-016**: Owners MUST be able to create an organization under an account they own
  while the account is below its limit. The new organization has the built-in roles
  and the owner as Organization Admin.
- **FR-017**: Owner creation MUST be refused at or above the limit, with a message
  naming the limit. Concurrent attempts MUST NOT take an account above its limit.
- **FR-018**: Owners MUST NOT be able to open an organization on their account unless
  they are a member of it.
- **FR-019**: People who own no billing account MUST NOT see billing accounts.
  Organization members MUST NOT see their organization's billing account.

**History and audit**

- **FR-020**: Every assignment of an organization to a billing account MUST be
  recorded with the account, when it started and who made it. It MUST be possible to
  tell which account an organization belonged to at any moment since rollout.
- **FR-021**: Creating, renaming, changing, deleting billing accounts, owner changes
  and limit changes MUST be audited with who made them and when. The account's
  history MUST show these changes while the account exists; a deleted account is no
  longer shown anywhere, but its deletion stays in the audit record.

### Key Entities

- **Billing account**: name, billing contact email, notes, organization limit, and
  creation time. It has owners and organizations.
- **Billing account owner**: a user allowed to see the account and create
  organizations under it. Owners are referenced by integer user id.
- **Billing assignment**: an organization, a billing account, when the assignment
  started, and who made it. An organization's assignments follow one another with no
  gaps or overlaps.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform administrator creates an organization with a new billing
  account, or attaches one to an existing account, from the same dialog in under one
  minute.
- **SC-002**: After rollout, an automated check finds no organization without exactly
  one billing account, now or at any moment since rollout.
- **SC-003**: An owner creates an organization from the portal and is working inside
  it as Organization Admin in under one minute, without a platform administrator.
- **SC-004**: Under concurrent attempts, owner creation never takes an account above
  its organization limit.
- **SC-005**: Moving an organization between billing accounts leaves its members,
  devices, dashboards, automations and data unchanged, and interrupts no ingestion.
- **SC-006**: Tenant isolation tests show that owners reach no data in an organization
  on their account unless they are members of it.

## Assumptions

- "Account" in the owner's request means organization (tenant). This spec uses
  *organization* for the tenant and *billing account* for the payer.
- Platform administrators with the manage-organizations permission, including super
  administrators, manage billing accounts. A separate billing permission is not
  needed yet.
- **Billing accounts** is a portal page outside any organization, as notifications
  already are, reached from the user menu.
- Organization creation in the admin app keeps its existing name and slug fields and
  validation.
- The admin app and the API client change in the same pull request as the endpoint
  (constitution IV).

## Out of Scope

- Usage metering, prices, statements, invoices and payments. They will attach to
  billing accounts in later specs.
- Billing an integrator's own customers, or tools for integrators to bill them.
- Access to customer organizations derived from an integrator's role instead of
  membership, a dashboards-only role, and any customer-facing view of who has
  access.
- Owners adding or removing other owners, moving organizations, or deleting
  organizations.
- Showing an organization's billing account to its members.
- Moving devices or adapter sources between organizations (spec 016 covers devices).

## Related work

- [ADR-026](../../docs/adr/ADR-026-billing-accounts.md): the decision this spec
  implements.
- [ADR-010](../../docs/adr/ADR-010-per-tenant-adapter-runtimes.md): one adapter runtime
  per organization, the reason for the organization limit.
- [Spec 003](../003-tenant-scoping/spec.md): tenant scoping and isolation tests.
- [Spec 006](../006-delete-empty-organizations/spec.md): deleting empty organizations.
- Spec 016 (device sharing and transfer, drafted): moving devices between
  organizations.
