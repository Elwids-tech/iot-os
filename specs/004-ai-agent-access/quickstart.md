# Quickstart: AI Agent Access

Part A is the developer workflow for adding a tool. Part B lists the validation
scenarios each pull request runs on the rebuilt stack (constitution IX).

## Prerequisites

- The dev stack: `./taskw devices:setup`, `./taskw devices:up`.
- Agent access on: set `IOT_AGENTS_ENABLED=true` in `.local/devices/devices.env`. Make
  sure Passport keys exist (`./tooling/bootstrap` generates them), then rebuild `api`
  and the services built from its image
  ([which services](../../docs/dev/local-setup.md#rebuild-one-service)).
- An organization administrator switches agent access on under **Settings → AI apps**.
- A protocol client: the MCP Inspector
  (`rtk proxy npx @modelcontextprotocol/inspector`), and Claude Code
  (`claude mcp add --transport http iot-os http://127.0.0.1:8001/mcp`).
- Hosted Claude (Claude.ai, Claude Desktop) needs a deployment reachable from the
  internet. Use the pilot for it; it cannot reach a local stack.

## Part A: adding a tool

1. Add a class under `apps/api/app/Domain/Agents/Mcp/Tools/` that extends `AgentTool`.
   Declare its access level, permission, input limits and output schema, and build
   its result from an explicit field list.
2. Read through a query service in the owning domain. Never call a controller, and
   never call an endpoint with side effects (validate, test, capture, dashboard show).
3. Register it in `PlatformServer`, then run `php artisan agents:tools --export` and
   commit `contracts/agents/tools.json`.
4. Add tests:
   - the tool's own feature test;
   - an entry in the isolation dataset (two organizations, a member without the
     permission);
   - for a draft tool, the apply path in the review endpoint.
   
   The secret scan runs over every tool result automatically.
5. Update `docs/features/agents.md` (tool list) in the same pull request.

## Part B: validation scenarios

### B1. Connect and disconnect (US1, SC-001, SC-002, SC-003)

1. Sign in to the portal, open **Settings → AI apps** and copy the connector address.
2. In Claude Code, add the address and run `/mcp` to sign in. The browser opens the
   portal's consent screen without asking for a password. Check what it shows:
   - "Returns to localhost" first;
   - the agent's self-declared name;
   - the organization (preselected when there is one) and two access levels.
3. Approve. Claude Code lists the read tools and `get_overview` answers.
4. **Settings → AI apps** shows the connection with its last use. Disconnect it. The
   next tool call fails, and Claude Code asks to sign in again.
5. Repeat with the MCP Inspector.
6. Repeat signed out. The portal's sign-in appears first, then the consent screen.
7. On the pilot, repeat with Claude.ai and Claude Desktop. Record the four clients in
   the pull request.

### B2. Sign-in rules (contracts/oauth.md)

Run `php artisan test --compact --filter=AgentOAuth`. It covers:

- discovery and the 401 challenge;
- registration rules, redirect domains and loopback;
- the guest redirect and its `return`;
- consent `auth_token` mismatch, a non-member, switches off, re-approval;
- `resource` mismatch;
- a wrong PKCE verifier, code reuse;
- refresh rotation, and reuse revoking the connection;
- an agent token on `/api/v1` and a session or integration token on `/mcp`;
- the domain `User` keeping Sanctum's trait.

### B3. Troubleshooting (US2, SC-006, SC-007)

With the device simulators (`./taskw devices:test` fixtures), create each fault in turn:

1. Stop a simulator.
2. Announce an extra metric.
3. Deploy a decoder that throws.
4. Rebirth with a changed metric type.
5. Trigger an alert.

Each time, ask the agent "what is wrong with <device>?". Check that
`get_ingestion_diagnostics` names the problem and that its facts match the device
page. Measure read-tool latency from the activity log: 95% under 2 s.

### B4. Isolation and secrets (SC-004, SC-005)

`php artisan test --compact --filter=AgentIsolation` calls every tool:

- for organization A with B's identifiers;
- as a member without the permission;
- with each access level.

Every response must be `not_found`, `permission` or `access_level`, and none may
include B's data. The secret scan must report nothing.

### B5. Administrator oversight (US3)

As an organization administrator with three members' connections:

1. Read one connection's activity.
2. Disconnect one connection.
3. Switch agent access off. All connections fail at their next call with the
   explanation, and the members' pages show "Unavailable".
4. Switch agent access back on. The connections that were not disconnected work again.
5. Remove a member from the organization. Their connection shows "Revoked: removed
   from organization".
6. Reset a password. That person's connections are revoked.

### B6. Onboarding with drafts (US4, SC-010)

With a **Read and drafts** connection:

1. Give the agent the reference device's datasheet text and a sample payload.
2. Check that it prepares a profile, tests a decoder and prepares a registration in
   one group, and returns one review link.
3. In the portal, apply the profile section and publish the profile. The
   registration's "Waiting for: publish profile" clears.
4. Apply the registration and activate the device. Readings arrive.
5. Check that no tool result contained a credential. Record the time taken against
   the portal-only baseline.

### B7. Dashboard draft (US5)

Ask the agent for a dashboard for one site. The preview link renders every panel with
live data. Save it, and it matches a hand-built equivalent. Change the dashboard in
the portal, then try to apply a second proposal against the old revision: it is
refused as stale.

### B8. Nothing else changed (SC-009, FR-037 to FR-041)

With `IOT_AGENTS_ENABLED=false`:

- `/mcp`, `/oauth/*` and `/.well-known/oauth-*` answer 404;
- the portal shows no AI apps settings;
- the PHP, portal and admin suites, the e2e suite and `contract:check` all pass.
