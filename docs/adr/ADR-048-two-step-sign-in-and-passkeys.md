# ADR-048: Two-Step Sign-In and Passkeys Are Built In, With Laravel's Packages

**Status:** Proposed 2026-11-16
**Date:** 2026-11-16
**Amends:** [ADR-008](ADR-008-laravel-sanctum-authentication.md)
**Relates to:** [spec 034](../../specs/034-two-factor-passkeys/spec.md),
[ADR-006](ADR-006-deployment-profiles.md), [ADR-018](ADR-018-agent-access-oauth.md),
[ADR-028](ADR-028-activity-log.md), [ADR-033](ADR-033-partner-applications-act-for-a-person.md),
[ADR-047](ADR-047-progressive-web-app-before-native-apps.md)

## Context

People sign in to the portal and admin app with a password alone. ADR-008 said
"Laravel owns login, logout, session lifecycle, credential recovery, and future
multi-factor authentication workflows" but did not choose how. Customers now ask for
multi-factor sign-in in security reviews, and platform staff can change every
organization.

Two routes were considered:

- **A hosted identity service (WorkOS AuthKit)**: hosted sign-in with codes and
  passkeys, corporate SSO and directory sync, and an MCP authorization server. It runs
  only as a US-hosted service. Single-VM and on-premise deployments (ADR-006) would
  have no sign-in without internet, and identity data would leave the deployment.
  `laravel/workos` keeps a second copy of users and organizations and checks every
  session with WorkOS. Agent and partner connections (ADR-018, ADR-033) carry an
  organization, an access level and revocation rules that WorkOS Connect does not
  model.
- **Laravel's first-party packages**: Fortify's two-factor actions (time-based codes
  and recovery codes) and `laravel/passkeys` (WebAuthn) run inside the API with no
  outside service.

## Decision

1. **Two-step sign-in and passkeys are built into the API** with `laravel/fortify`
   and `laravel/passkeys`. No hosted identity service is used for people's sign-in.
2. **Our routes, their actions.** Both packages' routes are switched off. Our
   `Authentication` domain controllers call their actions.
   - Sign-in keeps one shared completion path, which issues the per-device kept
     sign-in (ADR-047) and never Laravel's remember token.
3. **Second step before any session.**
   - A right password for a person with two-step on creates only a pending sign-in in
     the session (5 minutes, five attempts).
   - The session starts after a valid code or unused recovery code.
   - A passkey sign-in counts as both steps.
   - A passkey counts only when it is used. A person who must use two-step and has
     only a passkey finishes a password sign-in with the passkey.
4. **Secrets stay in the deployment.**
   - The setup secret and the recovery codes are encrypted with the application key.
     There are eight codes; a used one is removed, and codes are shown only when
     issued.
   - Passkeys are bound to the deployment's parent domain (`PASSKEYS_RP_ID`).
   - The user-handle secret is generated once per deployment and kept across upgrades.
5. **Required for platform staff and, by choice, for organizations.**
   - Super administrators and people with platform administration access must use
     two-step or a passkey.
   - An organization administrator can require it for every member.
   - A requirement from any organization applies to the person everywhere.
   - People who are required but not set up can reach only their security settings
     until they set it up.
6. **Session sign-in only.** Agent connections, partner connections and integration
   application tokens are unchanged. Their consent already happens in a portal
   session, which now carries the second step.
7. **Recovery by people, recorded.** A platform administrator with
   `PlatformAdministration.reset-two-step`, or the server operator from the command
   line, can reset a locked-out person's two-step sign-in with a reason.
   - Nobody may reset themselves.
   - Every change to a person's two-step or passkeys emails them and is written to the
     activity log with no organization.
8. **Corporate SSO is not decided here.** SAML, OIDC and SCIM, possibly through a
   hosted provider as an optional connector on hosted deployments, need their own
   ADR when a customer requires them.

## Consequences

- Sign-in works the same with or without internet, and no identity data leaves the
  deployment.
- `users` gains Fortify's three two-factor columns. A `passkeys` table and an
  `organizations.two_step_required` column are added. `KeptSignIn` gains two end
  reasons.
- Login can answer `202` with `two_step_required` and the allowed `methods`, which the portal, admin app and
  `api-client` handle. Session requests from required people who are not set up
  answer `403 two_step_setup_required`.
- Passkeys need HTTPS and a stable domain. Changing a deployment's domain invalidates
  existing passkeys, and people fall back to password and code.
- `laravel/passkeys` is before 1.0, and Fortify constrains its version. The packages
  sit behind our own routes and contract, so upgrades do not change clients.
- Platform staff must set up two-step at their first sign-in after the release that
  turns the requirement on. The release notes say so.
- Sign-ins and failed sign-ins are still not recorded in the activity log (ADR-028);
  only security setting changes are.
