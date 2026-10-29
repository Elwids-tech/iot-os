# Contract: alert notifications API

Three operations under `/api/v1/organizations/{organization}`, behind `auth:sanctum` and
`ResolveOrganizationContext`. They join the generated OpenAPI document
(`contracts/openapi/openapi.json`, ADR-016) under the Automation tag with typed bodies;
none is added to `pending-schemas.json`. `packages/api-client` gains the matching types
and methods in the same pull request.

The middleware answers 403 to someone who is neither a member nor a super
administrator. After it, every operation checks that the person is a current member
(super administrators included: the middleware lets them in, this check does not) and
has `Device.view` there. When that fails, the list is empty, the summary is zero and
marking read changes nothing, with status 200. Only the signed-in person's own
notifications are ever read or changed.

Notification ids are UUIDv7: they sort by creation time, so the newest id is also a
cursor.

## `GET alert-notifications`

Query: `page` (integer, at least 1). 20 per page, newest first (`id` descending).

```json
{
  "data": [
    {
      "id": "0193a5c2-7f10-7c4e-9a51-3c2f0e4b8d21",
      "transition": "activated",
      "occurred_at": "2026-10-29T10:15:02Z",
      "created_at": "2026-10-29T10:15:03Z",
      "read_at": null,
      "alert": { "uuid": "a0000000-0000-4000-8000-000000000001", "episode": 3, "condition": "active" },
      "workflow": { "uuid": "b0000000-0000-4000-8000-000000000001", "name": "Cold room door open" },
      "device": { "uuid": "c0000000-0000-4000-8000-000000000001", "name": "Freezer 2" }
    }
  ],
  "meta": { "current_page": 1, "last_page": 3, "total": 47, "unread": 5 }
}
```

- `transition`: `activated` or `cleared`.
- `alert.condition`: the alert's condition now (`active` or `cleared`), read live; the
  other names are as they were when the notification arrived.
- `device`: `null` when the alert has no bound device or it was not found.
- `workflow` is always present for these alerts. Spec 018 may add alerts without one and
  a `source` field; clients treat unknown fields as additive.

## `GET alert-notifications/summary`

Polled by the portal. Two indexed queries.

```json
{ "data": { "unread": 5, "newest_unread_activation_id": "0193a5c2-7f10-7c4e-9a51-3c2f0e4b8d21" } }
```

- `newest_unread_activation_id`: the id of the newest unread `activated` notification,
  or `null`. The portal chimes when it is greater than the newest it has seen.

## `POST alert-notifications/read`

Exactly one of:

| Body | Marks read |
| --- | --- |
| `{"ids": ["…"]}` (1–100 distinct UUIDs) | Those notifications. Ids that are not the person's in this organization are ignored. |
| `{"up_to": "…"}` (UUID) | Every unread notification in this organization with `id <= up_to` (**Mark all read**, so later arrivals stay unread). |
| `{"alert_uuid": "…"}` (UUID) | Every unread notification for that alert (Q3). |

Answers with the summary body above. Idempotent: marking a read notification again keeps
its first `read_at`. Validation errors are 422 (none, several, or malformed fields).

## Storage shape (`notifications.data`, jsonb)

Written by `AlertTransitionNotification::toDatabase()`; `type` is `alert`
(`databaseType()`), never the class name.

```json
{
  "v": 1,
  "source": "workflow",
  "organization_uuid": "18b842d4-dbe9-44b7-a82f-8409bf31401a",
  "alert_uuid": "a0000000-0000-4000-8000-000000000001",
  "episode": 3,
  "transition": "activated",
  "occurred_at": "2026-10-29T10:15:02Z",
  "workflow_uuid": "b0000000-0000-4000-8000-000000000001",
  "workflow_name": "Cold room door open",
  "device_uuid": "c0000000-0000-4000-8000-000000000001",
  "device_name": "Freezer 2"
}
```

No user references cross the API: the notifiable is always the signed-in person, so no
`user_id` field is needed (ADR-013 unaffected).
