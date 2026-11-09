# Contract: `usage.data_points.v1` (runtime → Laravel)

A runtime event (ADR-014, ADR-031), relayed through `device_runtime.outbox` and
`IOT_DEVICE_EVENTS`. It reaches `POST /api/internal/devices/events/batch` like any
other event. The implementation pull request adds:

- `contracts/internal/events/usage.data_points.v1.schema.json`, plus its
  `.fixture.json` and `.cases.json`;
- an entry in `contracts/internal/catalogue.json` naming the Go producer test and the
  PHP consumer test;
- `contractstest.AssertProduced` in the Go test and the PHP contract assertion in the
  consumer test.

`tooling/verify-devices-contracts.py` checks them in CI.

## Envelope

The standard `devices.Event`: `{ "uuid", "type": "usage.data_points.v1", "payload" }`.
`uuid` is a UUID v5 (runtime namespace) of
`usage.data_points#{final_through}#{sha256 of the canonical buckets JSON}`, so an
identical replay has the same id and stops at Laravel's `device_inbox`. A heartbeat's
`uuid` is a UUID v5 of `usage.data_points#heartbeat#{generated_at}`, so each heartbeat
is new and a replay of one changes nothing.

## Payload

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-07T20:41:00Z",
  "final_through": "2026-11-07T20:00:00Z",
  "buckets": [
    {
      "organization_uuid": "8f6a1c8e-6b8f-4c55-9d0e-2a1b3c4d5e6f",
      "hour": "2026-11-07T20:00:00Z",
      "count": 41230,
      "final": false
    },
    {
      "organization_uuid": "8f6a1c8e-6b8f-4c55-9d0e-2a1b3c4d5e6f",
      "hour": "2026-11-07T19:00:00Z",
      "count": 118004,
      "final": true
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `schema_version` | `1`. Laravel rejects other versions (permanent failure, dead-lettered). |
| `generated_at` | When the reporter built the event. |
| `final_through` | Every bucket with `hour + 1h ≤ final_through` is final, across all organizations. It never moves backwards. |
| `buckets` | 0–500 items. An event with no buckets still advances `final_through`, or is a heartbeat. Several events are written in one reporter pass when there are more buckets; only the last of them advances `final_through`, and the earlier ones carry the previous value. |
| `buckets[].hour` | UTC hour start, from the storage transaction's `now()`. |
| `buckets[].count` | The cumulative number of readings stored for the organization in that hour, not an increment. |
| `buckets[].final` | The hour ended more than one minute ago, so the count will not change. |

## Producer rules (Go)

- `Store.PersistResult` adds the `RowsAffected()` of each observation and diagnostic
  insert to `usage_data_points` in the same transaction. A duplicate message, or a
  reading skipped by the content match, adds 0.
- The reporter runs every 60 seconds on its own ticker. Its candidates are buckets
  with `count > reported_count`, or buckets with `NOT reported_final` whose hour has
  closed. It writes the outbox events and updates `reported_count` and
  `reported_final` in one transaction, the update last. That transaction commits with
  `synchronous_commit` off, so storing never waits on its row locks for a WAL flush; a
  crash can lose it whole, and the next pass reports the same cumulative counts again.
- Each event in a pass gets its own `created_at` (`clock_timestamp()`), so the relay,
  which reads the outbox by `created_at`, sends them in the order written and the one
  that advances `final_through` last.
- It writes an event when there are changed buckets, or when `final_through` advanced.
  With nothing to report, it writes a heartbeat with no buckets every two minutes, so
  the control plane's `reported_at` stays current on a quiet deployment.

## Consumer rules (Laravel)

- For each bucket: `insertOrIgnore` into `billing_data_point_buckets`, then lock the
  row.
- When the reported `count` is higher than the stored one, the increase goes to
  `Usage::add(account at hour, organization, 'data_points', hour, increase)`, and the
  stored count is raised. A lower or equal count is ignored, which covers replays and
  out-of-order delivery.
- The account is the one the organization's billing account assignment covered at
  that hour (spec 023's history), else its account now. An organization deleted since
  still counts for that account, in its share under its last name.
- An organization no account ever had is recorded with `billing_account_id` null and is
  not counted.
- `billing_usage_watermarks.final_through` is set to the greater of the stored and
  the reported value, and `reported_at` to the newest `generated_at` (never later than
  now).
- The handler runs inside the batch's savepoint, as other events do (ADR-031).
