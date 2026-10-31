# Contract: `GET /api/v1/admin/activity`

Platform administrators with `PlatformAdministration.manage-organizations`. Lists events
that have an actor, newest first.

## Query

| Name | Type | Notes |
| --- | --- | --- |
| `user_id` | integer, optional | The actor; must exist |
| `organization` | uuid, optional | The organization; must exist |
| `cursor` | string, optional | `meta.next_cursor` of the previous page |

## Response 200

```json
{
  "data": [
    {
      "id": 4211,
      "action": "device.updated",
      "summary": "updated device",
      "at": "2026-10-31T10:04:12+00:00",
      "actor": { "id": 7, "name": "Ana Silva", "email": "ana@example.test" },
      "organization": { "uuid": "…", "name": "Example Farms" },
      "subject": { "type": "device", "uuid": "…", "name": "Pump 3 north" },
      "changes": [{ "field": "name", "from": "Pump 3", "to": "Pump 3 north", "opaque": false }],
      "details": [{ "key": "revision", "value": "4" }]
    }
  ],
  "meta": { "per_page": 50, "next_cursor": "eyJpZCI6NDE2MSwiX3BvaW50c1RvTmV4dEl0ZW1zIjp0cnVlfQ" }
}
```

- `actor` is always present (only events with an actor are listed). Its `name` and
  `email` are `null` when the user was deleted later; the integer `id` stays.
- `organization`, `subject` and `subject.name` may be `null`.
- `changes[].from`/`to` are text, a list of text (roles, permissions, tags) or `null`;
  long values are cut to 200 characters. `opaque` changes say only that the field changed.
- `details` are the action's recorded details as text pairs, without UUIDs and hashes.
- `next_cursor` is `null` on the last page.

## Errors

- 401 unauthenticated, 403 without the permission.
- 422 when `user_id` or `organization` does not exist, or `cursor` is malformed.
