# Implementation Plan: Pricing Plans

**Branch**: `spec/029-billing-plan` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

On 2026-11-07 the owner chose to plan this spec together with
[spec 029](../029-billing-tier-limits/spec.md), the billing module. Both specs share
one data model of plans, allowances, overrides, assignments and usage, so a single
plan covers both:

- [Plan](../029-billing-tier-limits/plan.md), with the Constitution Check and the
  Delivery order. Pull requests 2, 3, 4 and 7 deliver this spec's user stories; they
  come first.
- [Research](../029-billing-tier-limits/research.md),
  [data model](../029-billing-tier-limits/data-model.md),
  [HTTP contract](../029-billing-tier-limits/contracts/billing-api.md) and
  [quickstart](../029-billing-tier-limits/quickstart.md) (sections 1, 3 and 4).
- [ADR-035](../../docs/adr/ADR-035-plans-and-allowances.md): plans carry allowances
  for billing accounts. It is the ADR this spec's Related work said the plan would
  record.
- Tasks for this spec are in [the shared tasks.md](../029-billing-tier-limits/tasks.md),
  labelled with this spec's user stories.

Spec 011's SMS sender uses `Usage::reserve` and `Usage::release` from pull request 4
for this spec's FR-025.
