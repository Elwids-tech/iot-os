# ADR-033: Partner Applications Act for a Person

**Status:** Proposed
**Date:** 2026-11-07
**Amends:** [ADR-018](ADR-018-agent-access-oauth.md), [ADR-008](ADR-008-laravel-sanctum-authentication.md)
**Relates to:** [ADR-028](ADR-028-activity-log.md), [ADR-032](ADR-032-applications-follow-a-plant.md), spec 030

## Context

Two kinds of credential reach the API from outside a browser session. An
**application token** (ADR-008, [integrations](../features/integrations.md)) is a
machine identity: it belongs to an organization, carries abilities and device grants,
and can only read, except for geofences. A **connection** (ADR-018,
[agents](../features/agents.md)) binds a person's OAuth client to one organization at
an access level, `read` or `draft`; tools run with that person's own permissions and
every write is a proposal a person reviews. Neither path can send a device command:
there is no command route or ability in the integration API, and the MCP server's
instructions forbid it.

A device command is a person's act. `POST devices/{d}/commands` and `.../send` need
`Device.command`, the parameter must accept commands and report state, one command may
be outstanding per parameter, the deadline is 30 s, completion needs a matching live
reading, and `command.prepared`, `command.confirmed` and `command.cancelled` name the
person in the activity log ([devices](../features/devices.md#commands-and-controls),
[`DeviceCommandService`](../../apps/api/app/Domain/Devices/Services/DeviceCommandService.php)).
Acknowledging an alert is the same kind of act.

A digital twin puts an operator in front of a 3D asset and wants them to send a
setpoint or acknowledge the alert on it, with the platform's log naming that person.
Three shapes were considered:

- An application token with a `commands:send` ability and an `acting_user` field in
  the body. Rejected: tenant and user identity would come from a payload (constitution
  III), and the activity log would name the application.
- The person's portal session. Impossible across origins, and the twin's browser holds
  no credential by design.
- A connection the person authorizes, with an access level that permits exactly these
  acts. Chosen: it reuses the consent, token and revocation machinery agents have, and
  the permission checks the portal already runs.

## Decision

- **A partner application is an OAuth client a person authorizes.** It registers
  through Passport as agents do (dynamic registration, or registered by a platform
  administrator), and a person connects it from the portal's connect page with the
  authorization code flow and PKCE. The result is a connection bound to that person,
  one organization and one access level, listed and revocable where agent connections
  are.
- **A third access level, `operate`.** It permits, on the integration API, exactly:
  `POST devices/{device}/commands/send`, `GET commands/{command}`, and
  `POST alerts/{alert}/acknowledge`. Each runs under the person's own permissions,
  `Device.command` or the alert acknowledge permission, re-checked on every request,
  through the same services the portal uses. It permits no read and no other write;
  reads stay with the application token.
- **The device must be in both scopes.** A partner application is also an integration
  application with grants (ADR-032). A command is accepted only when the device is in
  that application's grant and the person may command it. The twin may touch only what
  it was granted; the person may do only what their role allows.
- **The log names the person.** Activity-log entries for these acts have the person as
  causer and carry the application's UUID and name in their properties, so a reviewer
  sees "sent by A. Person through Twin Studio".
- **Outcomes reach the application without polling.** `command.status.v1` joins the
  integration event feed and webhooks for granted devices, carrying the command UUID
  and its status: sent, observed, failed, timed out or uncertain.
- **Off by default, twice.** Partner connections are enabled per deployment
  (`IOT_PARTNER_CONNECTIONS_ENABLED`) and per organization, as agents are. Tokens keep
  ADR-018's lifetimes: one-hour access tokens, 90-day rotating refresh tokens, which
  the partner stores server-side and never ships to a browser.

## Consequences

- A new guard beside `auth:mcp`, `auth:partner`, accepts a Passport bearer whose
  connection has level `operate` and whose organization matches the path, and sets the
  web-guard permissions of that person for the request.
- Nothing changes in `DeviceCommandService` or the runtime: the same preparation,
  confirmation, deadline, audit and `command.status.v1` path serves these requests.
- The MCP server stays read-only for AI (constitution V); `operate` is never granted
  to an agent connection, and the enum change must make that impossible, not merely
  undocumented.
- `@iot-os/integration-sdk` 0.6 gains a bearer mode for a person's token and
  `sendCommand()`, `command()` and `acknowledgeAlert()`. The OpenAPI description gets
  the new routes, the `partnerToken` security scheme and the `command.status.v1` event
  (constitution IV).
- The portal's connect page and the administration app list partner connections next
  to agent connections; `docs/features/integrations.md` documents partner applications
  and `docs/features/agents.md` records that `operate` is not an agent level.
- Rate limits for these routes follow the agent limits (120 a minute, 2,000 an hour per
  connection), on top of the command service's own one-outstanding rule.
