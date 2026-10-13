# ADR-018: AI Agents Sign In Through Passport and Act Through Connections

**Status:** Proposed
**Date:** 2026-10-12, revised 2026-10-13
**Amends:** [ADR-008](ADR-008-laravel-sanctum-authentication.md)
**Relates to:** [ADR-002](ADR-002-laravel-control-plane.md), [ADR-006](ADR-006-deployment-profiles.md), [ADR-013](ADR-013-integer-user-ids.md)

## Context

[Spec 004](../../specs/004-ai-agent-access/spec.md) lets people connect their own AI
agents (Claude.ai, Claude Desktop, Claude Code and other Model Context Protocol
clients) to one organization. They paste one address into the agent and approve in
the portal, and the agent then acts with their permissions.

ADR-008 chose Sanctum session cookies for the portal and admin and Sanctum tokens for
approved machine clients. It deferred delegated sign-in for third parties "if
third-party delegation becomes a real requirement" and named Laravel Passport as a
candidate. Agent access is that requirement:

- Browser sessions cannot be handed to an agent.
- Integration application tokens belong to an application, not a person, and are
  copied by hand.

The MCP authorization specification (2026-07-28) requires:

- OAuth 2.1 with PKCE S256;
- protected resource and authorization server metadata;
- tokens bound to the MCP server (RFC 8707 `resource`);
- rotating refresh tokens for public clients.

It recommends Client ID Metadata Documents (CIMD) and deprecates Dynamic Client
Registration (DCR). Claude supports both and falls back to DCR.

`laravel/mcp` 1.0.2 serves the discovery documents and DCR on top of Passport 13.9.
A spike on 2026-10-13 ran Claude's whole flow on that stack: discovery, the 401
challenge, registration, sign-in, consent, PKCE token exchange, a tool call, refresh
rotation and revocation
([research section 6](../../specs/004-ai-agent-access/research.md#6-spike-passport-with-laravelmcp-2026-10-13)).

The spike also found what the packages leave to us:

- no server-side CIMD;
- no check of `resource`;
- no organization or access level at consent;
- Passport and Sanctum cannot share a model's `HasApiTokens` trait. Laravel's guidance
  is one per model.

## Decision

1. **Passport is the authorization server, for agents only.**
   - `laravel/mcp` serves discovery and DCR (rate limited, with operator-restricted
     redirect domains).
   - Passport issues codes and tokens: PKCE S256, access tokens for 1 hour, refresh
     tokens for 90 days rotated on use.
   - Only the authorize and token routes are registered. Device, password,
     client-credentials and personal-token grants and Passport's JSON API are not.
   - A `resource`, when sent, must be the MCP endpoint.
2. **A separate guard.**
   - The `mcp` guard (driver `passport`) authenticates people through the `users`
     provider.
   - `User` uses Passport's `HasApiTokens` in place of Sanctum's, because people never
     hold Sanctum tokens. Sanctum keeps authenticating portal sessions and integration
     applications (their own token model).
   - Agent tokens authenticate only `/mcp`. Portal sessions and integration tokens
     never authenticate `/mcp`.
3. **Consent in the portal.** Passport's authorization view hands off to the portal's
   `/connect` page, which uses the normal session, sign-in and CSRF. Our endpoint
   completes Passport's stored request after the person picks one organization and
   an access level (`read` or `draft`).
4. **Connections carry authority.** A connection is one person, one Passport client,
   one organization and one access level.
   - Every call checks the connection, the deployment and organization switches and
     the person's current membership and permissions, then enters that organization.
   - Revoking a connection revokes its Passport tokens. It is revoked by the person,
     an administrator, removal from the organization, a password reset, refresh-token
     reuse, or 90 days without use.
5. **Keys are deployment secrets.** Passport's signing keys come from
   `PASSPORT_PRIVATE_KEY` and `PASSPORT_PUBLIC_KEY`. They are generated per deployment
   and kept in the ignored `.local/` secrets.
6. **CIMD is deferred** until `laravel/mcp` or Passport supports it server-side, or a
   client we need stops supporting DCR.
7. **Off by default.** `IOT_AGENTS_ENABLED=false` for the deployment, and every
   organization starts switched off.

Portal and admin sessions (ADR-008) and integration application tokens are unchanged.

## Consequences

- People connect agents without copying credentials. Claude, Claude Code and other
  standard clients work with no per-client setup.
- Token issuance, PKCE and rotation are Laravel's maintained code. Our additions are
  the consent completion, the guest redirect, the resource check, the connection gate
  and reuse handling, each with a conformance test.
- Deployments gain signing keys to provision and back up. Rotating them disconnects
  every agent.
- `User` changes token trait. Tests that signed in with Sanctum personal tokens use
  `actingAs`, and the permission seeder skips the `mcp` guard.
- The consent screen can show only the agent's self-declared name and its return
  host until CIMD lands.
- DCR is deprecated by the protocol. A release check with four clients guards against
  clients dropping it.
- Hosted agents reach the deployment from the internet (Claude from
  `160.79.104.0/21`). On-premise deployments that are not reachable can still use
  desktop and command-line agents on their network.
- Delegated sign-in for other third parties (for example customer applications acting
  for a person) is not covered. It would reuse Passport in a new ADR.
