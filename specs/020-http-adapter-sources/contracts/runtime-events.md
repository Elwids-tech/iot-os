# Tenant Runtime Events (changed)

`POST /api/internal/adapters/events` with the tenant runtime token, schema
`contracts/adapters/v1/runtime-event.v1.schema.json`. Existing kinds (`sample`,
`health`, `diagnostic`) are unchanged; `health` gains `source_state`.

| Kind | Fields | Effect |
| --- | --- | --- |
| `poll_run` | `run_id`, `revision_uuid`, `started_at`, `finished_at`, `outcome`, `http_status?`, `pages`, `records`, `published`, `failed`, `duplicates`, `cursor_before?`, `cursor_after?`, `committed_at?`, `error?`, `state`, `reason?`, `next_attempt_at?` | upsert the run by `run_id`; update `poll_state` |
| `failure` | `report_id`, `source`, `received_at`, `error`, `reason` (`decode_failed` \| `validation_failed`), `input` (fixture shape, excerpt ≤ 16 KiB), `delivery_id?` | insert a `failed` delivery once per `report_id` |
| `outcomes` | `report_id`, `bucket` (hour), `counts` (`decoded`, `decode_failed`, `validation_failed`, `duplicate`, `historical`) | add to hourly counts once per `report_id` |

The reporter throttles `failure` to one every 2 seconds per adapter and sends
`outcomes` every 60 seconds.
