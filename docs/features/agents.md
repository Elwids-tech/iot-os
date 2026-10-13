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

## Connecting an agent

The connector address is `{APP_URL}/mcp`. The flow, as Claude runs it:

1. The agent calls `/mcp` without a token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=…`.
2. It reads `/.well-known/oauth-protected-resource/mcp` and
   `/.well-known/oauth-authorization-server`, which `laravel/mcp` serves.
3. It registers itself at `POST /oauth/register`, limited to 10 a minute per
   address. Every connection gets its own Passport client.
4. It opens `GET /oauth/authorize` with PKCE (S256) in the person's browser.
   - **Signed out:** the API redirects to `{FRONTEND_URL}/connect?return=…`. The
     portal shows its normal sign-in and then returns to the authorize URL; it only
     follows `return` to the API's own `/oauth/authorize`.
   - **Signed in:** Passport stores the request in the session and redirects to
     `{FRONTEND_URL}/connect`.
5. The `/connect` page shows the agent's self-declared name, where it returns to
   (for example `claude.ai`), the organizations whose agent access is on, and
   **Read** or **Read and drafts**.
   - Approving creates the connection and Passport issues the code.
   - Approving again for the same agent replaces the earlier connection.
   - Consent is asked every time, even while the agent holds a valid token.
6. The agent exchanges the code at `POST /oauth/token` for a 1-hour access token and
   a 90-day refresh token, rotated on every use.

A `resource` parameter, when sent, must be the MCP endpoint; anything else answers
`invalid_target`. `/connect` is served with `frame-ancestors 'none'`. Contract:
[spec 004 contracts/oauth.md](../../specs/004-ai-agent-access/contracts/oauth.md).

Hosted agents such as Claude.ai and Claude Desktop reach the deployment from the
internet (Claude's egress is `160.79.104.0/21`). Claude Code and other local clients
need only to reach the API from the person's machine.

### Signing keys

Passport signs access tokens with an RSA key pair.

- **Release:** the pair is created by `tooling/release/manage.py init`. For an
  environment created before agent access existed, run `manage.py passport-keys`,
  which adds a pair and never replaces one. Validation refuses
  `IOT_AGENTS_ENABLED=true` without keys, and restore needs the backed-up keys.
- **Development:** `tooling/devices-setup.mjs` keeps a pair in
  `.local/devices/devices.env`.
- **Rotating** the keys disconnects every agent; people connect again.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `IOT_AGENTS_ENABLED` | `false` | Offer agent access on this deployment |
| `IOT_AGENTS_REDIRECT_DOMAINS` | `*` | Return addresses agents may register, as comma-separated URL prefixes (`https://claude.ai,http://localhost`), or `*` for any |
| `PASSPORT_PRIVATE_KEY`, `PASSPORT_PUBLIC_KEY` | none | Token signing keys (see above) |
| `IOT_AGENTS_ACTIVITY_DAYS` | `90` | How long tool-call records are kept |

`agents:prune` runs daily at 03:30. It deletes agent clients nobody connected within
24 hours and activity older than the retention, and expires stale proposals.
`passport:purge` runs at 03:35.
