# Push Contract: `sign-up-push.v1`

The encrypted body of a push to a super administrator about sign-ups, from the API's
push sender to the portal's service worker ([research R10](../research.md)). It
sits beside `alert-push.v1` in `contracts/push/v1/`, with a schema, a fixture and a
cases file rendered by the worker's Vitest suite (constitution IV).

```json
{
  "v": 1,
  "kind": "sign_up",
  "organization": {"uuid": "0f9c2a1e-5b7d-4c3a-9e21-6a8f0b4d1c77", "name": "Acme Water"},
  "person": {"name": "Jane Doe"},
  "occurred_at": "2026-11-21T02:14:03Z",
  "count": null,
  "url": "https://admin.example.com/organizations/0f9c2a1e-5b7d-4c3a-9e21-6a8f0b4d1c77"
}
```

| Field | Notes |
| --- | --- |
| `v` | `1` |
| `kind` | `sign_up` (a completed sign-up) or `sign_up_paused` (the daily ceiling was reached) |
| `organization` | the new organization; `null` for `sign_up_paused` |
| `person` | the person's name only, never the email (FR-021); `null` for `sign_up_paused` |
| `occurred_at` | when the sign-up completed, or the ceiling was reached |
| `count` | `null` for `sign_up`; the day's ceiling for `sign_up_paused` |
| `url` | an absolute URL on the admin app's origin: the organization's page, or `/sign-ups` |

**Shown as**

- `sign_up`: title *New sign-up · Acme Water*, body *Jane Doe · 2:14 AM*, tag
  `sign-up-{organization uuid}`.
- `sign_up_paused`: title *Sign-ups paused for today*, body *50 sign-ups reached the
  daily limit*, tag `sign-up-paused`.

**Opening it**: the worker opens `url` in a new window only when its origin is the
admin app's configured origin; otherwise it opens the portal's home. An older worker
that does not know these kinds shows its generic notification.

**Options**: `TTL` 24 hours, `urgency: normal`, `Topic` `sign-up` (so an undelivered
push is replaced by the next).
