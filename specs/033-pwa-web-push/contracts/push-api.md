# Contract: Push, Kept Sign-in and Deliveries API

Laravel routes on the API host, `auth:sanctum` unless noted. The OpenAPI supplements
(`contracts/openapi/supplements/account.yaml` for push and sign-in,
`automation.yaml` for deliveries) and `packages/api-client` change in the same pull
request as each route (principle IV). User references are integer `user_id`.

## Sign-in

### `POST v1/auth/login` (changed)

Request adds one optional field:

```json
{ "email": "ops@example.com", "password": "…", "remember": true }
```

- `remember` (boolean, default `false`). When `true`, the response also sets the
  `iot_kept` cookie (HttpOnly, Secure, SameSite=Lax, session domain, 30 days) and
  creates a kept sign-in.
- Response body unchanged. A missing or `false` `remember` behaves exactly as today.

### `POST v1/auth/logout` (changed behaviour)

Ends the request's kept sign-in (`signed_out`), forgets the cookie, and deletes the push
devices linked to this session or kept sign-in. Response unchanged.

### `POST v1/auth/reset-password` (changed behaviour)

Also ends every kept sign-in of the person (`password_reset`) and deletes all their
push devices; the reset already signs them out everywhere, so each device turns push on
again after signing in. Response unchanged.

## Push settings

All under `v1/notifications/push`. No organization in the path: settings are personal
and apply across organizations.

### `GET v1/notifications/push`

```json
{
  "data": {
    "available": true,
    "public_key": "BEl6…",
    "enabled": true,
    "levels": { "critical": true, "warning": true, "info": true, "recovery": false },
    "revision": 3,
    "organizations": [
      { "uuid": "…", "name": "Workshop", "enabled": true },
      { "uuid": "…", "name": "North plant", "enabled": false }
    ],
    "devices": [
      {
        "uuid": "…",
        "label": "Safari on iPhone",
        "created_at": "2026-11-20T08:00:00Z",
        "last_reached_at": "2026-11-21T02:14:09Z",
        "last_failed_at": null
      }
    ]
  }
}
```

- `available` is `false` and `public_key` is `null` when the deployment has no push key;
  the portal then hides every push control.
- `levels` is `null` until push was first turned on.
- `organizations` lists the person's current memberships with device view access.
- `devices` never includes endpoints or keys. The portal marks **This device** by
  matching the `uuid` it got when it registered or synced.

### `PUT v1/notifications/push`

```json
{ "revision": 3, "enabled": true, "levels": { "critical": true, "warning": false, "info": true, "recovery": false } }
```

- 409 when `revision` is stale. 422 when `levels` lacks a key or has a non-boolean.
- Returns the same body as `GET`, with `revision` incremented.

### `PUT v1/notifications/push/organizations/{organization}`

```json
{ "enabled": false }
```

- 404 unless the person is a member with device view access. Idempotent.
- Returns the `GET` body.

## Push devices

### `POST v1/notifications/push/devices`

Turns push on for this browser. Called after the browser granted permission and
subscribed.

```json
{
  "endpoint": "https://push.example.com/send/abc…",
  "keys": { "p256dh": "…", "auth": "…" },
  "content_encoding": "aes128gcm",
  "label": "Chrome on Android"
}
```

- 422 when the endpoint is not `https`, is longer than 2048 characters, or a key is
  missing. 409 `push_unavailable` when the deployment has no push key.
- Upserts by endpoint. An endpoint held by another person is released first.
- Links the device to the request's session and kept sign-in.
- The first registration sets `push_enabled` to `true` and the default levels.
- Response 201 (200 when the endpoint was already this person's):

```json
{ "data": { "uuid": "…", "label": "Chrome on Android", "replaced": { "label": "Firefox on Android" } } }
```

`replaced` is `null` unless the eleventh device pushed out the one unused longest.

### `POST v1/notifications/push/devices/sync`

Called on every portal start by a browser that holds a subscription.

```json
{ "endpoint": "https://push.example.com/send/abc…" }
```

```json
{ "data": { "status": "mine", "uuid": "…" } }
```

- `status` is one of:
  - `mine`: refreshes the session and kept sign-in links and `last_synced_at`.
  - `released`: the endpoint belonged to someone else, whose device was deleted.
  - `unknown`: the server has no device for this endpoint.
- For `released` and `unknown` the browser unsubscribes. `uuid` is null unless the
  status is `mine`.

### `DELETE v1/notifications/push/devices/{device}`

- 404 unless the device is the requester's. Deletes it, ends its linked kept sign-in
  (`device_removed`) and destroys its linked session. Response 204.

### `POST v1/notifications/push/devices/{device}/test`

- Sends a `test` push to that one device, synchronously. Throttled to 6 a minute per
  person. Response 200:

```json
{ "data": { "status": "accepted" } }
```

  The other statuses are `gone` (the device was deleted) and `failed`.

## Alert deliveries (changed)

### `GET v1/organizations/{organization}/alerts/{alert}/deliveries`

Each item gains three fields:

```json
{ "uuid": "…", "channel": "push", "devices_total": 2, "devices_reached": 1, "status": "sent", "…": "existing fields" }
```

- `channel` is `email` or `push`.
- `devices_total` and `devices_reached` are null for email.
- `status` may also be `summarised` for push.
- `history[]` items gain `device_label` and `response_status` (null for email).

### `POST v1/organizations/{organization}/alerts/{alert}/deliveries/{delivery}/retry`

Unchanged contract. A failed push delivery retries on the push channel.
