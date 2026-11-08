# ADR-035: Plans Carry Allowances for Billing Accounts

**Status:** Accepted (built in specs 028 and 029, 2026-11-08)
**Date:** 2026-11-07
**Amends:** [ADR-026](ADR-026-billing-accounts.md)
**Relates to:** [spec 028](../../specs/028-pricing-plans/spec.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md),
[plan](../../specs/029-billing-tier-limits/plan.md)

## Context

[ADR-026](ADR-026-billing-accounts.md) made the billing account the payer of record
and gave each account an organization limit that platform administrators type in
(`billing_accounts.organization_limit`, default 1). Pricing tiers now limit several
things:

- alerts and SMS per month (spec 028);
- active devices, data points per month, telemetry retention and organizations (spec
  029).

Typing each number into each account does not scale, and the owner asked that tiers
set them, the organization limit included.

Every limit has the same shape: a value per tier, sometimes changed for one customer,
and a default when no tier applies. Some are monthly amounts (alerts, SMS, data
points), others are levels (devices, organizations) or settings (retention). More
will be added.

## Decision

**A plan is a named set of allowances that billing accounts are assigned to.**

- An account has at most one plan at a time. Each assignment records the plan, its
  kind (`paid`, `trial` or `trial_unpaid`), when it started and ended, and who made
  the change.
- A gap means no plan. This history answers which plan, and whether a trial, applied
  at any moment.

**Allowances are rows keyed by kind.**

- Plans have `billing_plan_allowances (plan_id, kind, value)`, and accounts have
  `billing_allowance_overrides (billing_account_id, kind, value, note)`.
- `value` is a non-negative integer, or null for unlimited. A missing row means "not
  set here".
- An account's allowance is its override, else its plan's, else the deployment's
  default.
- Adding a limit adds a kind, with no new columns and no changes to existing rows.

**Usage is counted per account, with each organization's share.**

- Monthly kinds are counted in one row per account, kind and month, locked while
  counting.
- Overage, the part beyond the allowance, is fixed when it is counted, and recorded
  against the assignment in force. That is what is priced later.
- Counting never stops alerts or data points. SMS is reserved against what is left
  and refused when it runs out. Devices are a level: activation is refused at the
  limit.

**The organization limit becomes the `organizations` allowance.**

- Its default is 1. Accounts whose limit was raised keep it as an override, so
  nothing changes at rollout.
- `billing_accounts.organization_limit` is dropped.
- As before, platform administrators are not bound by the limit, and lowering it
  removes nothing.

## Consequences

- Administrators define tiers once and assign them. Special terms are overrides with
  a note, audited and kept across plan changes.
- ADR-026's "the limit is set by platform administrators and is 1 for a new account"
  now reads: the limit comes from the account's plan or override, with a default of 1.
  Everything else in ADR-026 stands.
- Editing a plan changes every account on it at once. Keeping customers on old terms
  means creating a new plan and archiving the old one.
- Allowances and usage are readable by kind. Prices, invoices and trials (ADR-037)
  build on assignments and overage without changing this model.
- One row lock per account, kind and month serializes counting for that account. That
  is enough at the platform's scale; a hot account would need sharded counters.
