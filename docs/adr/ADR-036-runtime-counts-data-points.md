# ADR-036: The Runtime Counts Stored Data Points and Reports Cumulative Hourly Counts

**Status:** Proposed
**Date:** 2026-11-07
**Relates to:** [ADR-003](ADR-003-go-data-plane.md),
[ADR-014](ADR-014-control-plane-data-plane-http-integration.md),
[ADR-031](ADR-031-batched-runtime-events.md), [ADR-035](ADR-035-plans-and-allowances.md),
[spec 029](../../specs/029-billing-tier-limits/spec.md)

## Context

Spec 029 meters data points per billing account and month. A data point is every
reading the platform stores: valid readings, invalid readings kept as diagnostics, and
readings a profile calculates. A reading delivered twice counts once. Past the
allowance, readings keep being stored, and the excess is overage on the invoice.

Telemetry never passes through Laravel (constitution I). Only the runtime knows what
it stored. In `Store.PersistResult`, one transaction writes the dedup ledger row and
every observation and diagnostic. A redelivered message stops at the ledger, and a
re-sent sample is skipped by a content match. Runtime events reach Laravel at least
once, through the outbox, `IOT_DEVICE_EVENTS` and the batched inbox (ADR-014,
ADR-031). The relay gives no exactly-once delivery.

## Decision

**Count in the storage transaction.**

- `PersistResult` adds up the rows its observation and diagnostic inserts actually
  wrote.
- It adds the sum to `device_runtime.usage_data_points (organization_uuid, hour)` in
  the same transaction, keyed by the transaction's UTC hour.
- What was not stored adds nothing.

**Report cumulative counts, not increments.**

- Every 60 seconds a reporter writes a `usage.data_points.v1` outbox event with the
  current cumulative count of each changed bucket. Hours that have closed are marked
  final.
- Each event carries `final_through`, a watermark up to which every organization's
  buckets are final.
- The event id is derived from its contents. Buckets are pruned after 40 days.

**Laravel applies only increases.** It keeps the highest count seen per bucket and
adds the difference to the account the organization belonged to at the bucket's
hour. Replayed, duplicated or out-of-order reports change nothing. A month's data
points are final, and its invoice can be drafted, once the watermark passes the
month's end.

## Consequences

- Usage is exact without exactly-once delivery. A control plane outage only delays
  counts; ingestion and storage do not wait for Laravel.
- The storage transaction gains one upsert per message. Spec 029 SC-004 measures the
  effect (within 5%).
- Usage is about a minute behind storage. Pages show the last report time and
  "Provisional" until the month is final.
- A move between billing accounts in the middle of an hour attributes that hour to
  the account at the hour's start.
- The watermark relies on one runtime instance, which the advisory lock already
  enforces. A distributed runtime would need a watermark per instance.
- Counting stored rows ties billing to storage decisions: compressing or storing
  telemetry once changes cost, not counts.
