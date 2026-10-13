# AI agents

People can connect their own AI agent (Claude.ai, Claude Desktop, Claude Code or any
other Model Context Protocol client) to one organization. The agent investigates
devices and prepares changes for the person to review. It acts with that person's
permissions and never performs a live action. Design and decisions:
[spec 004](../../specs/004-ai-agent-access/spec.md) and
[ADR-018](../adr/ADR-018-agent-access-oauth.md).

Code: Laravel [`Domain/Agents`](../../apps/api/app/Domain/Agents); portal
[`src/agents`](../../apps/portal/src/agents).

## Switches

Agent access is off twice by default:

- **Deployment**: `IOT_AGENTS_ENABLED=false`. While it is off, every agent route
  answers 404 and the portal shows nothing about agents.
- **Organization**: every organization, including new ones, starts switched off. An
  organization administrator (`Organization.update`) switches it on under
  **Settings → AI apps**. Switching it off stops every connection to the organization
  at its next request. Both changes are recorded in `device_audit_events`
  (`agents.access_enabled`, `agents.access_disabled`).

Organization capabilities (`/me`, `/organizations/{organization}/context`) carry
`features.agent_access` (the deployment switch) and `agents {enabled, manage}`.

## Connected AI apps

**Settings → AI apps** (shown when the deployment offers agent access):

- **Agent access**: the organization's switch for administrators, its state for
  everyone else.
- **Connect an agent**: the connector address with steps for Claude.ai and Claude
  Desktop, Claude Code and other MCP clients. Shown while the organization's switch
  is on.
- **Your connections**, and for administrators **Connections to this organization**.

## Sign-in and tokens

Laravel Passport issues agent tokens; Sanctum keeps portal sessions and integration
application tokens.

- **Separate guard.** `User` uses Passport's `HasApiTokens`, because the two packages
  cannot share the trait and people never hold Sanctum tokens. The `mcp` guard
  (driver `passport`) is the only guard that accepts agent tokens.
- **No default routes.** `Passport::ignoreRoutes()` keeps Passport's default routes
  off; the agent routes register only what agents need.
- **No roles on the agent guard.** `PermissionSeeder` skips the `mcp` guard. Agents
  use the person's web-guard roles.

A connection binds one person's agent (a Passport client) to one organization and an
access level (`read` or `draft`). It ends when any of these happens:

- the person or an administrator disconnects it;
- the person is removed from the organization;
- the person resets their password, which also revokes all of their Passport access
  and refresh tokens;
- it goes unused for 90 days.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `IOT_AGENTS_ENABLED` | `false` | Offer agent access on this deployment |
| `IOT_AGENTS_REDIRECT_DOMAINS` | `*` | Return-address domains agents may use |
| `IOT_AGENTS_ACTIVITY_DAYS` | `90` | How long tool-call records are kept |

`agents:prune` runs daily at 03:30. It deletes agent clients nobody connected within
24 hours and activity older than the retention, and expires stale proposals.
`passport:purge` runs at 03:35.
