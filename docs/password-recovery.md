# Password recovery

Both sign-in screens offer **Forgot password?**. Recovery is hosted in the tenant
portal at `/forgot-password`; platform administrators use the same account flow.

The API accepts POST `/api/v1/auth/forgot-password` with an email and always returns
the same success message for existing, unknown, or recently contacted accounts.
Requests are limited to 10 per minute per IP and 5 per hour per normalized email.
The broker permits one email per account per minute. Reset attempts are limited
to 10 per minute per IP. Both endpoints retain the application's CSRF protection.

Email links use the trusted `FRONTEND_URL` configuration. Tokens are hashed in the
existing `password_reset_tokens` table, expire after 60 minutes, and are consumed
once under a database row lock. Passwords require 12–256 characters and matching
confirmation. A successful reset rotates the remember token, deletes personal
access tokens and database sessions, and requires a fresh sign-in.

Transactional reset messages use the existing `alerts` database connection and
queue, consumed by `alerts-worker`. Notification email preferences do not suppress
account recovery mail. Queued notification payloads are encrypted with `APP_KEY`;
retain the same key across API and worker instances. Monitor worker health and
failed jobs. Never log, screenshot, or publish bearer tokens or full reset links.

Local verification uses Mailpit at port 8026 and a disposable account. Staging
requires the portal's HTTPS `FRONTEND_URL`, working Brevo sender configuration,
and a running mail worker. Local email capture does not prove external delivery.
No schema migration is required.
