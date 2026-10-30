# ADR-026: Organizations Belong to Billing Accounts

**Status:** Accepted
**Date:** 2026-10-29
**Relates to:** [ADR-010](ADR-010-per-tenant-adapter-runtimes.md), [ADR-013](ADR-013-integer-user-ids.md),
[spec 023](../../specs/023-billing-accounts/spec.md)

## Context

The organization is the platform's only boundary. It owns its data, devices, adapter
runtime, roles, members and permission ceiling. Platform administrators create
organizations in the admin app, giving each one a name and a slug
(`POST /api/v1/admin/organizations`). Nothing records who pays for an organization or
which organizations belong together commercially.

Integrators who install devices for several end customers want one organization per
customer, so that customers stay isolated from each other, with all of them under the
integrator's single account. Billing each organization separately would send the
integrator one bill per customer. Billing by the person who created or onboarded
something fails as soon as staff work for customers, people leave, or one person
belongs to several organizations.

Organizations also cost resources. Each one that uses adapters runs its own runtime
pair and takes one port from the fixed range `adapters.port_base` to
`adapters.port_limit` (ADR-010). Letting customers create organizations themselves
needs a limit.

## Decision

**A billing account is the payer, and it groups organizations.** Every organization
belongs to exactly one billing account at all times. A billing account has a name, an
optional billing contact email, notes, owners and an organization limit.

**Organizations stay independent tenants.** A billing account grants no access to
data. Being its owner, or sharing an account, gives no one anything inside an
organization. Membership and roles stay the only way in.

**Creating an organization chooses its billing account.** A platform administrator
either creates a new billing account with the organization, named after it by
default, or attaches the organization to an existing account. When the API request
names no account, the platform creates a new one, so existing clients keep working.

**Assignments are recorded.** A platform administrator can move an organization to
another billing account. Each assignment records the organization, the account, when
it started and who made it. A later metering or pricing feature can then tell which
account had an organization on any day, without changing this model.

**Owners create organizations under their account.** Platform administrators make
users (referenced by integer `user_id`, ADR-013) owners of a billing account. Owners
see the account's organizations in the portal and create new ones under it, up to the
account's organization limit. Whoever creates an organization becomes its
Organization Admin as an ordinary member, and invites others as usual. The limit is
set by platform administrators and is 1 for a new account. Platform administrators
are not bound by it.

**Rollout.** Every existing organization gets a billing account of its own, named
after it, with no owners and a limit of 1.

## Consequences

- An integrator gets one account for all their customers and creates customer
  organizations without a platform administrator, within the limit set for them.
  Customers keep every isolation guarantee organizations already have.
- Usage metering, prices and invoices can attach to billing accounts later without
  restructuring organizations. None of them is decided here.
- Owners administer the organizations they create through ordinary membership, so
  customers see them in their member list. Removing someone as an owner does not
  remove their memberships. Partner staff access derived from a role, rather than
  from membership, would need its own decision.
- The organization limit protects runtime capacity. Raising it is a platform
  administrator's decision, made per account.
- A billing account can be deleted only when it has no organizations. Deleting an
  account's last organization (spec 006) leaves the account and its assignment
  history.
