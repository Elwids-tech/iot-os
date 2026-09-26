# Portal integration management

Open **Integrations** in an organization workspace. This page requires both
device viewing and device management permissions; the API independently enforces
these permissions and organization ownership. Application credentials cannot use
the human management routes.

## Applications and grants

Create an application with a name, read permissions and selected devices. Device
selection includes search and pagination within the selector. The directory
includes active and permanently revoked applications; existing limits remain
50 applications per organization and 100 devices per application.

All four read abilities can now be granted together. The previous validation
maximum of three was corrected in both grant and token issuance requests.
The alert event feed requires alert access to be useful; the UI requires both.

Saving grants invalidates the current token and cancels/disables webhook delivery.
The confirmation explains these effects. Issue another token and reconfigure the
webhook afterward. Revocation is permanent and requires separate confirmation.

## Tokens and one-time secrets

Choose token permissions within the application's saved grants and a lifetime of
1–90 days. Issuing a token invalidates its predecessor immediately. The page shows
the last issued credential's expiry; expiry does not imply the token was recently
used. Management responses include safe expiry/ability metadata and granted-device
labels, never token hashes or secret values.

Issued tokens and webhook signing secrets appear in a masked one-time panel with
explicit reveal, copy and dismissal controls. They remain only in local component
state, not query caches, URLs or browser storage. Dismissal, page unmount and session
expiry clear the displayed value. Navigation warns while a secret remains visible.
Copying explicitly writes to the user's clipboard; store it in the external
application's backend secret store.

If a response is lost, reload to review the server state before repeating an
operation. Secrets cannot be recovered after losing their issuance response;
rotate again. Writes are not automatically retried.

## Webhooks and delivery history

Configure an operator-approved HTTPS receiver for an application with Alerts and
Alert event feed access. The portal cannot modify the server's destination allowlist.
Every configuration save rotates the signing secret, cancels pending deliveries,
and starts at the current event-journal head. The confirmation explains that prior
events are not replayed.

Managers can disable delivery, inspect paginated delivery statuses and attempt
history, refresh the list, and retry eligible failed deliveries with confirmation.
Enabled webhook history refreshes every ten seconds. The server still rejects
stale retries and deliveries from an old endpoint revision. Receivers must deduplicate
events because uncertain network outcomes can cause repeat delivery.

## Drafts and conflicts

Application and receiver drafts participate in the portal's unsaved-change guard.
Conflicts preserve local edits; **Reload latest state** explicitly discards them
after confirmation. Token and grant mutations retain optimistic revision checks.
The application directory is invalidated after management actions so revisiting
it does not show an outdated active/revoked state.

## Verification

- API coverage includes all four permissions, safe credential/device metadata,
  invalidation, tenant isolation and the existing token/webhook lifecycle tests.
- `apps/portal/e2e/integrations.spec.ts` exercises creation, secret handling,
  conflict preservation, reload, webhook history/retry/disable, revocation,
  mobile layout, unsaved edits, denied access and clearing secrets on expiry.
- Browser checks include accessibility scans and desktop/mobile visual inspection.
- `tooling/verify-integration-ui.mjs` exercises the rebuilt portal against real
  local API services, using the temporary SDK fixture and fixed local receiver.
  It verifies token access/invalidation and real 503 → retry → 204 webhook history.
  The receiver requires the existing verification-only Compose overlay. Remove
  the fixture and receiver and restore normal API/worker configuration afterward.

Production destination allowlisting, network egress policy, retention operations
and pilot load validation remain operational work. This page does not provide a
visual workflow builder or permit automatic device commands.
