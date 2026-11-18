# API Contract: Two-Step Sign-In and Passkeys

All routes are under `/api/v1`. The portal and admin app call them with the Sanctum
session cookie and the `X-XSRF-TOKEN` header, as today. The OpenAPI description and
`packages/api-client` change in the same pull request as each route (constitution IV).

Abbreviations:

- **guest**: no session.
- **session**: a signed-in person.
- **confirmed**: the password (or a passkey) was confirmed in the last 15 minutes,
  otherwise `423` (research R8).

## Sign-in

### `POST auth/login` (guest, `throttle:login`)

The request is unchanged: `email`, `password`, `remember`.

| Outcome | Response |
| --- | --- |
| Right password, two-step off | `200`, the authenticated user, as today. |
| Right password, two-step on | `202 {"two_step_required": true, "expires_in": 300, "methods": ["code", "recovery_code"]}`. No session is created. Any earlier pending sign-in is replaced. |
| Right password, required, passkeys only | `202` as above with `"methods": ["passkey"]`. The person finishes with `POST auth/passkeys` (FR-022). |
| Wrong password | `422`, as today. |

`methods` also contains `"passkey"` when the person has a passkey and passkeys are
available. Passkey sign-in replaces the pending sign-in.

### `POST auth/two-step` (guest with a pending sign-in, `throttle:login`)

The request carries exactly one of `code` (six digits) or `recovery_code`.

| Outcome | Response |
| --- | --- |
| Valid | `200`, the authenticated user. When a recovery code was used, it also includes `"recovery_codes_remaining": n`. The kept sign-in cookie is issued if `remember` was set at the password step. |
| Wrong code | `422 {"errors": {"code": [...]}}` and `"attempts_left": n`. |
| No pending sign-in, expired, or five wrong codes | `422 {"errors": {"pending": ["Start again with your password."]}}` |

### `GET auth/passkeys/options` (guest, 6 a minute per address)

Returns `200 {"options": {...}}`: WebAuthn request options stored in the session.
Returns `404` when passkeys are not available on this deployment.

### `POST auth/passkeys` (guest, 6 a minute per address)

The request carries `credential` (the browser's assertion) and `remember`.

- Valid: `200`, the authenticated user. Passkey sign-in counts as both steps
  (FR-017).
- Not valid: `422`.

### `POST auth/confirm-password` (session)

The request carries `password`. The response is `204`, or `422` for a wrong password.

### `GET auth/confirm-passkey/options`, `POST auth/confirm-passkey` (session)

These work like the passkey sign-in routes but confirm instead of signing in, and
offer only the person's own passkeys. The response is `200 {"confirmed": true}`, a JSON
body because the browser client parses every answer.

## The person's security settings

### `GET me/security` (session)

```json
{
  "data": {
    "two_step": {
      "enabled": true,
      "confirmed_at": "2026-11-20T10:00:00Z",
      "recovery_codes_remaining": 7,
      "required": true,
      "required_by": ["platform", {"organization": "uuid", "name": "..."}],
      "satisfied": true
    },
    "passkeys": {
      "available": true,
      "unavailable_reason": null,
      "items": [
        {"id": 12, "name": "MacBook Touch ID", "created_at": "...", "last_used_at": "..."}
      ]
    }
  }
}
```

`unavailable_reason` is one of `not_https` or `null`. The browser's own support is
checked by the client. The `passkeys` block is added by the passkeys pull request;
until then the response has only `two_step`.

### `POST me/two-step` (session, confirmed)

Starts or restarts setup. Returns `200`:

```json
{"qr_svg": "<svg…>", "setup_key": "ABCD EFGH …", "otpauth_url": "otpauth://totp/…"}
```

Returns `409` when two-step is already on.

### `POST me/two-step/confirm` (session)

The request carries `code`.

- Valid: `200 {"recovery_codes": ["…" × 8]}`, shown once. It ends the person's other
  sessions and kept sign-ins (FR-013).
- Wrong code: `422`.

### `POST me/two-step/recovery-codes` (session, confirmed)

Returns `200 {"recovery_codes": [...]}`. Every earlier code stops working, and other
sign-ins end.

### `DELETE me/two-step` (session, confirmed)

- `204`, and other sign-ins end.
- `409 {"code": "two_step_required"}` while two-step is required for the person.

### `GET me/passkeys/options` (session, confirmed)

Returns WebAuthn creation options, or `404` when passkeys are not available.

### `POST me/passkeys` (session, confirmed)

The request carries `name` (1 to 60 characters) and `credential`.

- `201`, the passkey item.
- `422` when the passkey is invalid or already registered.

### `DELETE me/passkeys/{passkey}` (session, confirmed)

- `204`.
- `404` when the passkey belongs to someone else.

## Required two-step

Every session request from a person who is required but not satisfied gets:

```json
403 {"code": "two_step_setup_required", "message": "Set up two-step sign-in to continue."}
```

The only exceptions are `me`, `me/security`, `me/two-step*`, `me/passkeys*`,
`auth/confirm-password`, `auth/confirm-passkey` and `auth/logout`. Agent, partner
and application tokens never get this response.

### `PUT organizations/{organization}/security` (session, `Organization.update`)

The request carries `two_step_required` (boolean).

- `200 {"data": {"two_step_required": true}}`.
- `409 {"code": "two_step_setup_required"}` when the actor is not satisfied.
- `404` for an organization the actor cannot see.

`GET organizations/{organization}/context` includes `two_step_required`. Each member
in `organizations/{organization}/members` gains `two_step_enabled` (boolean, true when
satisfied).

## Administration

### `POST admin/users/{user}/two-step/reset` (session, `PlatformAdministration.reset-two-step`)

`{user}` is the integer user id (ADR-013). The request carries `reason` (required, up
to 500 characters).

| Outcome | Response |
| --- | --- |
| Reset done | `204` |
| The actor is resetting themselves | `403` |
| The target is a super administrator and the actor is not | `403` |
| Unknown user | `404` |

The platform users list gains `two_step_enabled` and `passkey_count`. The
authenticated user's `capabilities` gain `reset_two_step`.

## Console

```bash
php artisan auth:reset-two-step person@example.com --reason="Identity checked by phone"
```

It performs the same reset and records `source: console`.
