# Contract: Assistant and Dashboard API Changes

No new operations. Existing operations under
`/api/v1/organizations/{organization}` gain the `dashboard` scope and fields. All of
them stay in `contracts/openapi/pending-schemas.json` (the list only shrinks);
`supplements/assistant.yaml` and `supplements/dashboards.yaml` document the new error
responses. `packages/api-client` gains matching calls and types in `assistant.ts`.

Every request: `auth:sanctum`, organization membership, then the scope checks below.
Errors use the existing `{message, errors?}` shape.

## Scope checks (`dashboard`)

| Target | Requires |
| --- | --- |
| New dashboard | `Dashboard.create`, `Device.view` |
| Existing dashboard | view **and** edit ability on the dashboard (`DashboardAccess`), `Device.view` |

Creating a conversation and sending a message also need the assistant enabled. Reading a
conversation and deciding a proposal do not, so a prepared proposal can still be applied
after the assistant is switched off (applying never calls the model), as profile
decisions work today. Controls panels also need `Device.command`, and panels that name a
workflow need `Workflow.view`, both when the proposal is prepared and when it is applied.

Conversations are visible only to their creator in the same organization (404
otherwise, as for other scopes).

## `GET assistant/settings?scope=dashboard[&dashboard={uuid}]`

`200 {data: {enabled, provider: {id, label}, can_create, can_edit, can_alert}}`.
`can_alert` is true when the person may use the automation assistant (for **Set up an
alert**).

## `GET assistant/conversations?scope=dashboard&dashboard={uuid|new}`

The person's dashboard conversations for that target, newest first, at most 100.
`dashboard=new` lists new-dashboard conversations that have not created a dashboard yet.

## `POST assistant/conversations`

```json
{ "scope": "dashboard", "dashboard": "uuid or omitted for a new dashboard" }
```

`201` with the conversation. `403` without the scope's permissions; `404` for a
dashboard in another organization or one the person cannot open.

## `POST assistant/conversations/{c}/messages`

```json
{
  "request_id": "uuid",
  "text": "string, 1–4000",
  "answers": [{ "id": "string", "answer": "string" }],
  "target": {
    "revision": 7,
    "panels": [
      { "id": "w1", "type": "timeseries", "title": "Boiler pressure",
        "sources": [{ "device_uuid": "…", "parameter_uuid": "…" }] }
    ]
  }
}
```

- `target` is required for an existing-dashboard conversation and refused for a new
  one. At most 100 panels and `assistant.max_draft_characters` characters, else `422`.
- `410` when the conversation's dashboard was deleted.
- Otherwise as today: budget reservation (`429` when the daily allowance is reached),
  one active run per conversation (`409`), the run is queued.

## `GET assistant/conversations/{c}`

As today, plus for `dashboard` scope:

```json
{
  "scope": "dashboard",
  "target_kind": "new",
  "dashboard": { "uuid": "…", "name": "…" },
  "onboarding_state": {
    "questions": [],
    "options": {
      "sources": [{ "device_uuid": "…", "parameter_uuid": "…" }],
      "options": [{ "rank": 1, "type": "consumption", "title": "…", "reason": "…", "widget": {} }]
    },
    "unmet": { "category": "cross_device_total", "title": "…", "body": "…", "alternative": "…" },
    "alert": { "text": "Email me when the boiler pressure goes above 3 bar" }
  },
  "proposals": [
    {
      "id": 12, "section": "dashboard", "status": "pending", "summary": "…",
      "draft_revision": null, "content_hash": "64 hex",
      "changes": {
        "name": "North site pumps",
        "defaults": { "range": { "mode": "relative", "preset": "7d" }, "timezone": "browser", "refresh": 30 },
        "widgets": [ { "id": "…", "type": "consumption", "title": "…", "config": {}, "reason": "…" } ],
        "layouts": { "lg": [ { "i": "…", "x": 0, "y": 0, "w": 6, "h": 6 } ] }
      },
      "diagnostics": [ { "widget_id": "…", "code": "time_zones_differ", "message": "…" } ],
      "result": null
    }
  ]
}
```

`dashboard` is null for a new-dashboard conversation until it creates one.

## `POST assistant/conversations/{c}/proposals/{p}/decision`

Now accepted for `dashboard` scope (still `422` for automation).

```json
{ "decision": "approve | reject", "content_hash": "64 hex", "request_id": "uuid" }
```

| Proposal | `approve` result | Side effects |
| --- | --- | --- |
| `dashboard` | `{dashboard: {uuid, name}}` | Creates the dashboard (owner: the person; access: organization; first revision `origin = assistant`); sets the conversation's dashboard; proposal `applied` |
| `dashboard_panels` | `{widgets: [...]}` with fresh ids | Re-validates only; nothing saved; proposal `applied` |

`reject` → proposal `dismissed`, `200 {data: null}`.

Errors: `409` hash mismatch, not `pending`, or an active run; `410` dashboard deleted;
`403` permission lost; `422` a panel no longer validates, with `errors["widgets.N…"]`
naming the panel and reason. Replaying the same `request_id` and decision returns the
stored result.

## `GET dashboards/{d}/revisions`

Each revision gains `origin`: `"assistant"` or `null`.
