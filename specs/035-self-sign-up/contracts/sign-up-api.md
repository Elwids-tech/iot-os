# API Contract: Self Sign-Up

All routes are under `/api/v1`. The portal and admin app call them with the Sanctum
session cookie and the `X-XSRF-TOKEN` header. The OpenAPI description and
`packages/api-client` change in the same pull request as each route (constitution IV).
Users are referred to by integer `user_id` (ADR-013); sign-ups by `uuid`.

**guest**: no session needed (a signed-in person may call them too).

## Public

### `GET sign-up` (guest)

What the sign-up page needs before showing the form.

```json
{
  "open": true,
  "free_beta": true,
  "form_token": "eyJpdiI6...",
  "password_min": 12
}
```

`form_token` is present only while `open` is true ([research R7](../research.md)).
The portal's Home panel and the billing account page read `free_beta` from here too.

### `POST sign-up` (guest, `throttle:sign-up`)

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "…",
  "password_confirmation": "…",
  "organization_name": "Acme Water",
  "form_token": "eyJpdiI6...",
  "website": ""
}
```

| Outcome | Response |
| --- | --- |
| Accepted (new address, an address with a waiting sign-up, or an address that already has an account) | `202 {"state": "waiting", "email": "jane@example.com", "resend_after": 60}`. The session holds the pending sign-up, except for an existing account. |
| Field errors | `422 {"errors": {"name"|"email"|"password"|"organization_name": [...]}}` |
| Bot checks (hidden field, form token missing, under 3 s or over 2 h old) | `422 {"errors": {"form": ["Something went wrong. Reload the page and try again."]}}` |
| Sign-up closed | `403 {"code": "sign_up_closed"}` |
| Daily ceiling reached | `503 {"code": "sign_up_paused", "retry_after": seconds}` |
| Too many attempts | `429 {"message": "...", "retry_after": seconds}` |

### `GET sign-up/status` (guest, session-bound, 40 a minute per session)

The waiting page polls it every 3 seconds.

| Session state | Response |
| --- | --- |
| No pending sign-up | `404` |
| Waiting | `200 {"state": "waiting", "email": "...", "resend_after": n}` |
| Completed, this session not yet signed in, within 60 minutes, no second step | Signs the session in through `CompleteSignIn`; `200 {"state": "completed", "signed_in": true, "organization_uuid": "...", "user": {…authenticated user…}}` |
| Completed otherwise | `200 {"state": "completed", "signed_in": false, "email": "..."}` |
| Refused at confirmation (account exists) | `200 {"state": "refused", "reason": "account_exists", "email": "..."}` |

### `POST sign-up/resend` (guest, session-bound, `throttle:sign-up-resend`)

Sends a new link for the session's waiting sign-up and invalidates the old one.
`202 {"state": "waiting", "resend_after": 60}`; `404` without one; `429` with
`retry_after`.

### `POST sign-up/confirm` (guest, 10 a minute per address)

`{"token": "..."}` from the link (`/sign-up/confirm?token=…` in the portal).

| Outcome | Response |
| --- | --- |
| Valid | Completes the sign-up ([research R5](../research.md)). `200 {"state": "completed", "signed_in": true|false, "organization_uuid": "...", "email": "..."}`; `signed_in` follows research R3. |
| Already used | `410 {"code": "used", "email": "..."}` |
| Expired or replaced | `410 {"code": "expired"}` or `410 {"code": "replaced"}` |
| Unknown token | `404` |
| An account exists for the address | `409 {"code": "account_exists", "email": "..."}` |

Confirmation works while sign-up is closed (FR-025).

### `POST auth/login` (existing)

One addition: a wrong password for an address with no account, but with a waiting
sign-up whose password matches, answers `403 {"code": "sign_up_unconfirmed"}`. The
session takes over that pending sign-up, so the page can offer **Send it again**.

## Admin

### `GET admin/sign-up-settings` (super administrator)

```json
{
  "data": {
    "open": false,
    "free_beta": true,
    "notify_push": true,
    "notify_email": false,
    "daily_limit": 50,
    "revision": 3,
    "updated_at": "2026-11-20T10:02:11Z",
    "updated_by": {"user_id": 1, "name": "…"},
    "push_available": true,
    "mail_available": true,
    "my_push_devices": 2,
    "today": {"started": 4, "limit": 50}
  }
}
```

`push_available` is false without `WEBPUSH_VAPID_*`; `mail_available` is false when
the mailer is `log` or `array`. `my_push_devices` counts the caller's push devices
(FR-029).

### `PUT admin/sign-up-settings` (super administrator)

Takes `open`, `free_beta`, `notify_push`, `notify_email`, `daily_limit` (1 to 10,000)
and `revision`. `200` with the settings; `409 {"code": "stale_revision"}` when
`revision` is not current; `403` for anyone else, platform administrators included.

### `GET admin/sign-ups` (`PlatformAdministration.manage-organizations`)

Newest first, 25 a page, `state` filter (`waiting`, `expired`, `completed`,
`refused`), `search` on name, email and organization name.

```json
{
  "data": [
    {
      "uuid": "…",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "organization_name": "Acme Water",
      "state": "completed",
      "refusal_reason": null,
      "sends": 1,
      "created_at": "…",
      "completed_at": "…",
      "organization": {"uuid": "…", "name": "Acme Water"},
      "user_id": 42,
      "ip_address": "203.0.113.7"
    }
  ],
  "meta": {"current_page": 1, "last_page": 1, "total": 1}
}
```

### `GET me` (existing)

`capabilities.manage_sign_up` is true for super administrators. The admin app shows
**Settings → Sign-up** with it, and **Sign-ups** with `manage_organizations`.
