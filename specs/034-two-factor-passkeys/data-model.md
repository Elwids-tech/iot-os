# Data Model: Two-Step Sign-In and Passkeys

## `users` (existing table, three new columns from Fortify's migration)

| Column | Type | Notes |
| --- | --- | --- |
| `two_factor_secret` | text, null | Encrypted with the application key. Set when setup starts and cleared when two-step is turned off or reset. Hidden from serialization. |
| `two_factor_recovery_codes` | text, null | Encrypted JSON array of the remaining codes, eight when issued. A used code is removed, not replaced (research R2). Hidden from serialization. |
| `two_factor_confirmed_at` | timestamp, null | Two-step counts only when this is set (FR-002). |

**States**

```text
off ──start setup──▶ pending (secret set, confirmed_at null)
pending ──start setup again──▶ pending (new secret)
pending ──valid code──▶ on (confirmed_at set, codes issued)
on ──regenerate codes──▶ on (new codes)
on ──turn off / administrator reset──▶ off (all three columns null)
```

Turning two-step off is refused while two-step is required for the person (FR-023).

## `passkeys` (new table, from the `laravel/passkeys` migration)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint | Addressed by this id under `me/passkeys/{passkey}`, and only by its owner (404 otherwise). |
| `user_id` | bigint, foreign key to `users`, cascade on delete | |
| `name` | string | Chosen by the person, 1 to 60 characters. |
| `credential_id` | string, unique | Never returned by the API and never logged. |
| `credential` | json | The public key credential. Never returned by the API. |
| `last_used_at` | timestamp, null | Set on each passkey sign-in or confirmation. |
| `created_at`, `updated_at` | timestamps | |

## `organizations` (existing table, one new column)

| Column | Type | Notes |
| --- | --- | --- |
| `two_step_required` | boolean, default false | Changed by people with `Organization.update` who are themselves satisfied (FR-021). Each change is recorded in the organization's activity log. |

## `kept_sign_ins` (existing, spec 033)

`end_reason` gains two values:

- `two_step_changed`: ended by turning two-step on or off, or by regenerating recovery
  codes, on another browser.
- `two_step_reset`: ended by an administrator or server reset.

## Pending sign-in (session only, not a table)

Session key `two_step.pending`:

| Field | Notes |
| --- | --- |
| `user_id` | The person whose password was accepted. |
| `remember` | The **Keep me signed in** choice from the password step. |
| `methods` | How the person may finish: `code` and `recovery_code` when two-step is confirmed, `passkey` when they have a passkey and passkeys are available. |
| `expires_at` | 5 minutes after the password was accepted. |
| `attempts` | Wrong codes so far. At five the entry is removed. |

No authenticated session exists while this entry is present. A new password attempt
replaces it.

## Derived values

- **Requirement**: required when any of these is true:
  - `is_super_admin`;
  - the person has `PlatformAdministration.access`;
  - the person belongs to an organization with `two_step_required = true`.

  The API reports which of these applies (`required_by`).
- **Satisfied**: `two_factor_confirmed_at` is set, or the person has at least one
  passkey while passkeys are available on the deployment.
- **Second step at sign-in**: the password step answers `202` when two-step is
  confirmed, or when the person is required and satisfied by passkeys alone. In the
  second case `methods` is `["passkey"]`, so owning a passkey never lets the password
  alone through (FR-022).

## Permission

`PlatformAdministration.reset-two-step` is a new `PlatformAdministrationPermission`
case, assignable to platform roles. Super administrators hold it implicitly. Resetting
a super administrator also needs the actor to be a super administrator, and nobody may
reset themselves.

## Activity events (ADR-028)

| Event | Organization | Causer | Properties |
| --- | --- | --- | --- |
| `person.two_step_enabled` | none | the person | none |
| `person.two_step_disabled` | none | the person | none |
| `person.recovery_codes_regenerated` | none | the person | none |
| `person.recovery_code_used` | none | the person | `remaining` |
| `person.passkey_added` | none | the person | `name` |
| `person.passkey_removed` | none | the person | `name` |
| `person.two_step_reset` | none | the administrator, or none | `reason`, `source` (`admin` or `console`), `passkeys_removed` |
| `organization.two_step_required_changed` | that organization | the administrator | `required` (`attribute_changes` holds the old and new value) |

The subject of `person.*` events is the person, by integer id (ADR-013). No event
holds a secret, a code, or credential material.
