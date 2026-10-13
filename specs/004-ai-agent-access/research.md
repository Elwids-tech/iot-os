# Research: AI Agent Access

**Date**: 2026-10-12, revised 2026-10-13 after the Passport spike (section 6).
**Spec**: [spec.md](spec.md).

Sections 1 to 5 record what exists today and what the protocol and Claude require.
Section 6 records the spike that proved Passport and `laravel/mcp` work together.
Section 7 records the plan decisions. Paths are relative to `apps/api/` unless stated
otherwise. External sources were read on 2026-10-12.

## 1. Key findings

1. **Nothing can authenticate an agent today.** The portal uses Sanctum session
   cookies only (`bootstrap/app.php:25`, `config/sanctum.php`). Integration
   applications use Sanctum tokens on a model that deliberately has no
   `HasApiTokens` (`Domain/Integrations/Models/IntegrationApplication.php:11`).
   ADR-008 deferred delegated sign-in and named Laravel Passport as the candidate.
2. **`laravel/mcp` and Passport cover the OAuth core together.**
   - `laravel/mcp` v1.0.2 (released 2026-10-12) serves the discovery documents and
     the `WWW-Authenticate` challenge on `/mcp`. It advertises
     `token_endpoint_auth_methods_supported: ["none", …]`, which Claude needs.
   - `Mcp::oauthRoutes(registration: false)` lets the application bring its own
     rate-limited registration route.
   - Passport 13.9 issues codes and tokens with PKCE S256, rotates refresh tokens and
     checks revocation on every request.
   - The spike (section 6) ran Claude's whole flow against them.
3. **What neither package provides**:
   - server-side Client ID Metadata Documents (CIMD), which the 2026-07-28 MCP spec
     recommends over the now-deprecated Dynamic Client Registration (DCR);
   - checks on the RFC 8707 `resource` parameter;
   - the choice of an organization and access level at consent;
   - refresh-token reuse detection beyond rejecting the reused token.
4. **Claude supports both registration methods.** Claude uses CIMD when the server
   advertises it, otherwise DCR. With DCR it registers a new client for every
   connection, which makes the client a unique key for a connection. Hosted apps
   return to `https://claude.ai/api/mcp/auth_callback`; Claude Code returns to a
   loopback address on a random port
   ([Claude connector authentication](https://claude.com/docs/connectors/building/authentication)).
5. **Passport and Sanctum cannot share a model's token trait.** Both name it
   `HasApiTokens`, and their `createToken()` signatures are incompatible, even in a
   subclass. Laravel's guidance is one per model.
   - **Why `User` can switch:** people never hold Sanctum tokens in production. The
     portal uses sessions, and integration applications hold Sanctum tokens on
     their own model. So `User` moves to Passport's trait, and Sanctum keeps
     authenticating portal sessions and integration tokens.
   - **Consequences** (section 6):
     - tests that signed in with a Sanctum personal token switch to `actingAs`;
     - `PermissionSeeder` must skip the `mcp` guard, because it seeds every
       configured guard;
     - the password reset's `$user->tokens()->delete()` then deletes agent
       tokens.
6. **The proposal flow exists but is tied to conversations.**
   `assistant_proposals.conversation_id` is required, nothing groups proposals, and
   nothing expires them. Adapter proposals live in their own table. Only profile
   proposals are applied on the server (`Domain/Assistant/Services/ProfileProposalService.php:97-131`).
7. **Several reads the agent needs have side effects or no endpoint.** Device
   validation and decoder tests write state and need `Device.manage`. Opening a
   dashboard records `last_viewed_at`. Unmapped metrics, a presence filter, a site
   filter on alerts and a "review required" flag have no endpoint.
8. **Domain logic is partly inside controllers.** Device registration
   (`DeviceController::store`, `OnboardingController::store`), dashboard saving
   (`DashboardController::store/update`) and profile parameter and group writes
   (duplicated in `ProfileProposalService::writeChanges`) have no domain action.
9. **Dashboards are validated strictly on the server.**
   `Domain/Dashboards/Services/DashboardDefinition.php:50-333` checks every panel
   type, its sources and its layout. It checks that referenced devices belong to the
   organization, but not that the person may view them.
10. **Dependencies were current after one upgrade.** Laravel 13.35.0 is the newest
    framework release. Updating `laravel/mcp` (1.0.1 to 1.0.2), `laravel/ai`,
    `laravel/pao`, `laravel/pint` and `laravel/agent-detector` changes only
    `composer.lock`. The suite passes (525 of 525), Pint passes and the OpenAPI export
    is unchanged.

## 2. Authentication and hosts today

- **Hosts.** Release deployments serve the portal at `app.<domain>`, the admin at
  `admin.<domain>` and Laravel at `api.<domain>` (`deploy/release/Caddyfile`). The
  session cookie domain is `.<domain>`, `SameSite=Lax`
  (`deploy/release/compose.yml:15-34`). A top-level navigation to `api.<domain>`
  therefore carries the portal session, and the portal can read the API session
  through its normal credentialed requests. Local development uses `127.0.0.1:8001`
  for the API and `127.0.0.1:5173` for the portal; cookies are shared because they
  ignore ports.
- **Routes outside `/api`.** `https://api.<domain>/mcp`, `/oauth/*` and
  `/.well-known/*` reach Laravel today and are unused. `routes/ai.php` is loaded by
  `laravel/mcp`'s service provider without a middleware group.
- **Sign-in in the portal.** `App.tsx` renders `<Login/>` in place when `/me` returns
  401 and keeps the requested URL. There is no return parameter for sending the
  browser elsewhere after sign-in.
- **Ending access.** A password reset deletes the user's Sanctum tokens and database
  sessions (`Domain/Authentication/Http/Controllers/PasswordRecoveryController.php:33-54`).
  Removing a member (`Domain/Administration/Services/OrganizationMembershipManager.php:52-74`)
  ends neither. Nothing deletes users.
- **Organization administrators.** The `organization-admin` role holds every
  `Organization.*` permission. `Organization.update` is surfaced as
  `capabilities.manage_administration`.
- **Audit.** `Domain/Devices/Services/DeviceAudit::record()` writes
  `device_audit_events` and already records integration application changes.

## 3. The in-app assistant

- **Tools** call services, except `WorkflowAssistantTools`, which calls
  `DagController::registry`, `DagController::resources` and
  `GeofenceController::index` with synthetic requests.
- **Proposals**: states `pending`, `superseded`, `dismissed`, `approved`, `applied`; a
  content hash; an audit row per applied profile proposal. The portal review is
  `apps/portal/src/assistant/ProposalReview.tsx`.
- **Budget and model**: the assistant runs the platform's model with a daily budget.
  Agents bring their own model, so neither applies.

## 4. Data the tools need

| Need | Source today | Notes for the tools |
| --- | --- | --- |
| Device search | `DeviceController::index`, `DeviceView::device()` | Filters: search, lifecycle, profile, site, tag; 1–100 per page. No presence filter. |
| Presence | `DeviceView::presence()` | `online` older than 20 s becomes `unknown`; the portal adds "quiet" (`apps/portal/src/devices/model.ts:43-88`). |
| Device detail | `DeviceView` with detail | Large (full definitions); project it. |
| Latest values | `GET devices/{d}/measurements/latest`, runtime `http.go:136-219` | Synchronous runtime call. Quality `good`, `stale`, `invalid`, `inactive`. |
| History | `measurements/history`, `increase`, `state-history` | 10–1000 points, 2000-point cap, 25 s runtime timeout. |
| Review required | Runtime latch; reaches Laravel as `devices.diagnostic` text | The portal compares `draft.birth_revision` with the candidate's. |
| Discovery | `DiscoveryController` | Candidate metrics and `birth_revision`. |
| Unmapped metrics | None | Candidate metrics minus applied mappings. |
| Samples | Adapter candidates keep previews; telemetry captures (in runtime memory, `Device.manage`) keep rejected and accepted samples | Captures expose `wire_base64`; strip it. |
| Adapter health | `AdapterService::view` | Status, diagnostic, health, revision test results. Omit `code`. |
| Decoder test | `AdapterService::test` (writes `test_result`) | `AdapterAssistantTools` calls `AdapterManager::request('/test')` without saving; reuse that. |
| Alerts | `AlertController::index` | `condition`, `device`, `workflow`; no site filter. |
| Overview | `OverviewController` | Online, offline, unknown and silent counts; `Device.view`. |
| Sites, profiles, dashboards | `SiteController`, `DeviceProfileController`, `DashboardController::index` | `DashboardController::show` writes `last_viewed_at`. |
| Secrets to keep out | Gateway and device credentials, connection kits, adapter source credentials, integration tokens, webhook secrets, `wire_base64` | Results are built from explicit field lists. |

## 5. Requirements from the protocol and from Claude

| Requirement | Source | Met by |
| --- | --- | --- |
| Protected Resource Metadata (RFC 9728), and `WWW-Authenticate: Bearer resource_metadata=…` on 401 | MCP 2026-07-28; Claude starts sign-in only on a 401 | `laravel/mcp` (spike step 1) |
| Authorization Server Metadata (RFC 8414) with `code_challenge_methods_supported: ["S256"]` and `none` among token auth methods | MCP, Claude | `laravel/mcp` 1.0.2 |
| CIMD | MCP 2026-07-28 (recommended) | Not available server-side; Claude falls back to DCR. Deferred (D4). |
| DCR (RFC 7591) | Deprecated in 2026-07-28; Claude's fallback | `laravel/mcp`'s registration controller on our rate-limited route |
| `resource` (RFC 8707), audience checked | MCP; Claude sends exactly the URL the user entered | Our middleware on authorize and token (D3); the `mcp` guard serves only `/mcp` |
| PKCE S256, rotating refresh tokens, short access tokens | OAuth 2.1, MCP | Passport (spike steps 6 and 9) |
| Redirect URIs | Claude: `https://claude.ai/api/mcp/auth_callback`; loopback for Claude Code | `mcp.redirect_domains` and the controller's localhost rule |
| Don't list `offline_access` | Claude adds it if listed | `laravel/mcp` lists only `mcp:use` |
| Token endpoint: form-encoded, 10 s budget, `invalid_grant` for dead refresh tokens | Claude | Passport (spike step 9) |
| Egress addresses | `160.79.104.0/21` for Claude's cloud traffic | Documented for firewalled deployments |
| Tool results | Claude caps at about 150,000 characters, 240 s | Results bounded to 60,000 characters |
| Tool annotations are untrusted hints | MCP tools | Everything is enforced on the server |

## 6. Spike: Passport with `laravel/mcp` (2026-10-13)

The spike ran in a throwaway worktree with the upgraded packages and Passport 13.9.0.
The wiring was:

- `Mcp::oauthRoutes()`, and `Mcp::web('/mcp', …)->middleware('auth:mcp')`;
- an `mcp` guard (driver `passport`) over the `users` provider;
- `Passport::authorizationView()` returning the consent parameters;
- `redirectGuestsTo` pointing at the portal.

A feature test then ran Claude's flow. The patch is kept in the session scratchpad; the
results are recorded here.

| Step | Result |
| --- | --- |
| `POST /mcp` without a token | 401, `Bearer realm="mcp", resource_metadata=".../.well-known/oauth-protected-resource/mcp"` |
| Discovery | Resource `…/mcp`; issuer, authorize, token and register endpoints; `S256`; `mcp:use`; `none` among auth methods; no CIMD |
| `POST /oauth/register` (Claude's name and callback) | 201, public client with a UUID id |
| `GET /oauth/authorize` signed out | 302 to `{FRONTEND_URL}/connect?return=<authorize URL>` |
| `GET /oauth/authorize` signed in | The authorization view receives `authToken`, the client and the scopes |
| Approve | 302 to the callback with `code` and the original `state` |
| Token exchange (form-encoded, PKCE) | 200: access and refresh tokens, `expires_in` 3600 |
| `tools/call` with the bearer token | 200; the tool sees the person and the token's client |
| Portal session alone on `/mcp` (fresh test) | 401 |
| Agent token alone on `/api/v1/me` (fresh test) | 401 |
| Refresh, then reuse of the old refresh token | Rotation works; reuse gives `invalid_grant`, and the newest tokens keep working (no family revocation) |
| Access token revoked in the database | Next call 401 |
| `resource` set to another server | Accepted. Nothing checks it, so D3 adds a check |
| `AgentUser extends User` with Passport's trait | Fatal: incompatible `createToken()` signatures |
| `User` itself on Passport's trait (Sanctum's removed) | Flow passes and tools receive the domain `User`. Full suite: 27 tests fail only because they sign in with Sanctum personal tokens, and 2 seeder tests because `PermissionSeeder` seeds every guard (fixed by skipping `mcp`) |

Upgrading and the spike also showed that the main checkout's `vendor/` lagged behind
`composer.lock`: `dedoc/scramble` and `opis/json-schema` were missing. Run
`composer install` there before relying on local test results.

## 7. Plan decisions

### Summary of decisions

| # | Concern | Decision |
| --- | --- | --- |
| D1 | Where it lives | A new Laravel domain, `Domain/Agents`; the MCP endpoint at `https://api.<domain>/mcp` |
| D2 | MCP protocol | `laravel/mcp` `^1.0.2` in `require`, with its OAuth discovery routes |
| D3 | Sign-in | Laravel Passport `^13.9` as the authorization server for agents only, behind an `mcp` guard, with a `resource` check |
| D4 | Client registration | DCR through `laravel/mcp`'s controller on a rate-limited route; CIMD deferred until it can be added without owning protocol code |
| D5 | Consent | Passport's authorization view hands off to the portal's `/connect` page, and our approve endpoint completes Passport's request |
| D6 | Connections | One row per person and Passport client, carrying the organization and access level |
| D7 | Every call | The Passport guard, then one middleware: connection, switches, membership, organization context, rate limit |
| D8 | Tools | One class per tool on an `AgentTool` base: access level, permission, limits, error translation, activity record |
| D9 | Reads | Side-effect-free query services shared with the controllers they come from |
| D10 | Drafts | A new proposal model with groups, applied by domain actions extracted from controllers |
| D11 | Output safety | Allowlisted fields, labelled untrusted text, size bounds, a secret scan in tests |
| D12 | Contracts | New portal endpoints in OpenAPI and `packages/api-client`; a generated tool catalogue checked in CI |
| D13 | Decision record | ADR-018, amending ADR-008 |

### D1. A new domain and one endpoint

**Decision**: Add `app/Domain/Agents` with `Models/`, `Http/`, `Mcp/` (server and tools),
`Proposals/`, `Console/` and `routes/`.

- **Endpoints**:
  - MCP: `https://api.<domain>/mcp`, the canonical resource.
  - OAuth: `/oauth/authorize`, `/oauth/token` and `/oauth/register`; discovery under
    `/.well-known/`.
  - Portal: under `/api/v1`.
- **Deployment switch**: `IOT_AGENTS_ENABLED`, default `false` (`config/agents.php`).
  While it is off, every agent route answers 404.

**Rationale**: Constitution principle I: Laravel owns AI orchestration and every
public API.

### D2. `laravel/mcp` for the protocol

**Decision**: Require `laravel/mcp` `^1.0.2`. Register:

- `Mcp::oauthRoutes(registration: false)`;
- our own registration route named `mcp.oauth.register`, rate limited (D4);
- `Mcp::web('/mcp', PlatformServer::class)` behind `auth:mcp` and `AuthenticateAgent`
  (D7).

**Rationale**: Laravel's maintained implementation. Its discovery documents, 401
challenge and protocol versions matched Claude's flow in the spike, and its test
helpers fit the suite.

### D3. Passport as the authorization server for agents

**Decision**: Install `laravel/passport` `^13.9` and use it only for agents.

- **Routes**: `Passport::ignoreRoutes()`. Register only `GET /oauth/authorize` (`web`)
  and `POST /oauth/token` (rate limited), keeping Passport's route names so
  `laravel/mcp`'s metadata resolves. Passport's approve and deny routes, JSON API,
  device flow, personal tokens and password grant are not registered; consent
  completes through our endpoint (D5).
- **Guard**: `mcp` (driver `passport`) over the `users` provider. `User` implements
  Passport's `OAuthenticatable` and uses Passport's `HasApiTokens` instead of
  Sanctum's (finding 5). Roles and permissions stay on the `web` and `sanctum`
  guards; `PermissionSeeder` skips `mcp`.
- **Lifetimes**: `Passport::tokensExpireIn(1 hour)`,
  `refreshTokensExpireIn(90 days)`, refresh tokens rotated
  (`revokeRefreshTokenAfterUse`, the default).
- **Resource**: `RequireMcpResource` middleware on authorize and token. A `resource`
  that is present must equal the canonical `/mcp` URL (trailing slash ignored);
  otherwise the request fails with `invalid_target`. Together with the `mcp` guard
  existing only on `/mcp`, every token is for this one resource.
- **Keys**: `PASSPORT_PRIVATE_KEY` and `PASSPORT_PUBLIC_KEY`.
  - Release: kept in the ignored `.local/` deployment secrets.
  - Development: generated by `tooling/bootstrap`.
  - Rotating them invalidates every agent token; agents then connect again.
- **Reuse detection**: the token route uses a thin subclass of Passport's
  `AccessTokenController`. When Passport rejects a refresh token because it was
  revoked by rotation, the subclass revokes the connection of the request's
  `client_id` (D6) and records `refresh_reuse`. A token that cannot be decrypted
  revokes nothing.

**Rationale**: ADR-008 named Passport for delegated sign-in. With `laravel/mcp` 1.0.2,
it is Laravel's supported way to protect an MCP server, and the spike ran Claude's
whole flow on it. We keep no token, code, PKCE or rotation logic of our own; we add
only the organization binding, the resource check and the portal consent.

**Costs**:

- signing keys to provision and back up;
- five Passport tables;
- `User` switching token traits, and the tests that signed in with Sanctum personal
  tokens;
- no CIMD for now.

**Alternatives**:

- **A small in-house authorization server** (the first draft of this plan): it would
  have supported CIMD and needed no keys. Rejected, because owning token, PKCE and
  rotation code is a larger security surface than the gaps Passport leaves.
- **An external identity provider**: rejected; another service on single-node and
  on-premise deployments, still without the organization choice.
- **Sanctum tokens pasted into the agent**: rejected; it breaks FR-005, and Claude.ai
  cannot send one.

### D4. Client registration: DCR now, CIMD later

**Decision**:

- `POST /oauth/register` routes to `laravel/mcp`'s `OAuthRegisterController`,
  rate limited to 10 per minute per address. It creates public Passport clients.
- `mcp.redirect_domains` comes from `IOT_AGENTS_REDIRECT_DOMAINS` (default `*`). The
  controller always accepts loopback redirects (`localhost`, `127.0.0.1`) for
  command-line agents.
- Clients with no connection after 24 hours are deleted daily (Claude registers one
  per connection).
- **The consent screen**:
  - shows the self-declared client name as such;
  - shows the return host prominently ("Returns to claude.ai"), because the code can
    reach only that host;
  - shows a client's `client_uri` and `logo_uri` only as unverified.
- **CIMD is deferred.** Add it when `laravel/mcp` or Passport supports it server-side,
  or as a custom Passport client repository if DCR stops working with a client we
  need.

**Rationale**: Claude falls back to DCR when CIMD is not advertised. DCR is deprecated
by the 2026-07-28 spec but supported by every client in the release check. CIMD done
in-house would need an SSRF-safe fetcher and a client repository override, which is
the kind of protocol code D3 avoids.

**Risk**: A client may later drop DCR. The four-client release check (SC-002) runs on
every release that touches `Domain/Agents` and would catch it.

### D5. Consent in the portal

**Decision**:

1. A signed-out person is redirected by `redirectGuestsTo` (only for the
   `passport.authorizations.authorize` route) to
   `{FRONTEND_URL}/connect?return=<authorize URL>`. The portal shows its in-place
   sign-in and then navigates back to `return`. It accepts only URLs that start with
   `{API_URL}/oauth/authorize`.
2. A signed-in person: Passport validates the request (client, redirect, PKCE) and
   stores it in the API session with an `authToken`. Our authorization view redirects
   to `{FRONTEND_URL}/connect` with no parameters.
3. The page reads `GET /api/v1/agent-authorizations/current` (session), which returns:
   - the client name, return host and `auth_token`;
   - the eligible organizations and access levels.
4. **Approve** posts `{auth_token, organization_uuid, access_level}` to
   `POST /api/v1/agent-authorizations/approve`. The controller:
   - pulls Passport's request from the session (Passport's
     `RetrievesAuthRequestFromSession`, so the `auth_token` must match);
   - checks membership, both switches and the redirect domain;
   - creates or replaces the connection (D6);
   - sets the user, approves, and calls `completeAuthorizationRequest`;
   - returns `{redirect_to}` from the response's `Location`.
5. **Deny** returns the `access_denied` redirect the same way.
6. The page navigates to `redirect_to`, and sends `frame-ancestors 'none'`.

**Rationale**: Reuses the portal session, sign-in, design system and CSRF flow.
Passport stays the only code that creates authorization codes. A JSON response
avoids cross-origin redirects from the portal's API calls.

**Alternatives**: A Blade consent page on the API host would duplicate the design
system. Posting Passport's own approve form from the portal would need the raw CSRF
token and would leave no point at which to bind the organization.

### D6. Connections, not scopes

**Decision**: `agent_connections` holds the person, the organization, the Passport
client (`oauth_client_id`), the access level (`read` or `draft`), timestamps, expiry
and revocation.

- One active connection per person and client. Approving again for the same client
  replaces the organization and level, and revokes the client's earlier tokens
  (FR-010).
- Scopes stay `mcp:use`; `laravel/mcp` supports only that scope, and the level lives
  on the connection where administrators see it.
- Revoking a connection revokes the client's access and refresh tokens for the person.
- Expiry: 90 days after the last tool call (`last_used_at`, else `created_at`),
  checked at every call.

**Rationale**: With DCR every connection has its own client, so the person and the
client identify it. If CIMD arrives later, its client id is shared, and the
connection would then need to be bound per token. That would be a schema addition,
not a redesign.

### D7. One gate for every call

**Decision**: `/mcp` runs `auth:mcp` (Passport validates the bearer token, its expiry
and revocation, and answers 401 with the challenge), then `AuthenticateAgent`:

1. Deployment switch on (404 otherwise, before authentication).
2. The connection for the token's person and client is active and not expired. A
   revoked or expired connection gets 401 with an `error_description`, and its
   tokens are revoked.
3. The organization's switch is on.
4. The person is still a member.

Failures at steps 3 and 4 return a JSON-RPC error that names the cause and the
organization's administrators.

On success the middleware:

- enters the organization context as `ResolveOrganizationContext` does (team id set,
  restored in `finally`). After spec 003 PR 2 it uses `OrganizationContext::run()`;
- applies the per-connection rate limit (120 calls a minute, 2,000 an hour);
- updates `last_used_at` at most once a minute;
- binds a scoped `AgentContext`.

Revocation hooks: removing a member revokes their connections to the organization,
and a password reset revokes all of the person's connections.

### D8. Tools

**Decision**: Every tool extends `AgentTool` (a `Laravel\Mcp\Server\Tool`) and
declares:

- its access level and the permission it needs;
- annotations: read tools are read-only and idempotent; draft tools are neither
  read-only nor destructive; all are closed-world;
- an input schema with limits, and an output schema.

The base class:

- registers the tool only for allowed levels (`shouldRegister`);
- checks permissions through the existing authorization services;
- converts `HttpException`, `ModelNotFoundException`, `ValidationException` and
  authorization failures into tool errors (otherwise `laravel/mcp` turns an
  `abort()` into "internal server error");
- writes one activity record per call;
- bounds results at 60,000 characters.

The server's instructions name the organization and level, say that device and
third-party text is data, and point live actions to the portal links in results. The
tool catalogue is in [contracts/mcp-tools.md](contracts/mcp-tools.md).

### D9. Side-effect-free reads

**Decision**: Extract the queries the tools need into query services in their own
domains, and move the existing controllers onto them with unchanged responses:

- `DeviceDirectory` (adds a presence filter for tools only);
- `DeviceHealth`;
- `IngestionDiagnostics`;
- `AlertQuery` (adds a site filter for tools only);
- `DashboardQuery` (does not touch `last_viewed_at`).

Tools never call the validate, test or capture-control endpoints. Ingestion
diagnostics read adapter candidate previews, and, when the person has `Device.manage`
and a capture session is open, its samples' status and diagnostics without
`wire_base64`. "Review required" is reported only from the evidence the portal uses,
and otherwise as `unknown` (constitution VI).

### D10. Proposals and review groups

**Decision**: Add `agent_proposal_groups` and `agent_proposals`.

- **Kinds**: `profile_section`, `decoder_revision`, `device_registration`,
  `dashboard`.
- **Preparing**: each prepare tool validates through the portal's rules (a dry run in
  a rolled-back transaction where needed). It stores the payload, base revision,
  diagnostics and content hash, and returns `group_id`, the proposal, diagnostics and
  `review_url`.
- **Applying**: the portal page applies proposals through extracted domain actions:
  - `ProfileSectionWriter`, shared with `ProfileProposalService`;
  - `AdapterService::save`;
  - `RegisterDevice` with `DeviceConfigurationService::saveDraft`;
  - `SaveDashboard`.
  
  Each apply re-checks permission, base revision and hash, and is idempotent. A group
  applies in dependency order and stops at the first failure.
- **Dependencies on live actions**: a registration waiting for a profile to be
  published says so and becomes applicable once it is.
- **Expiry**: seven days, on base change, or when superseded within the group.
- **In-app assistant**: unchanged (FR-039).

### D11. Output safety

**Decision**:

- Every result is built from explicit field lists.
- Device-controlled and third-party strings sit inside `data`, and every result
  carries an `untrusted` notice.
- A test seeds known secrets and scans every tool result in the suite (SC-005).
- Agent dashboard proposals require `Device.view` on every referenced device. The
  portal's existing gap is reported separately.

### D12. Contracts

**Decision**:

- **Portal endpoints** are described in `contracts/openapi/supplements/agents.yaml`,
  exported with `contract:export`, and added to `packages/api-client` (`src/agents.ts`).
  Organization capabilities gain `features.agent_access` and `agents {enabled, manage}`.
- **The tool catalogue** is generated to `contracts/agents/tools.json` by
  `php artisan agents:tools --export`, with a catalogue version and one example result
  per tool checked against its output schema. CI runs `--check`.
- **OAuth and MCP endpoints** follow their RFCs and are described in
  [contracts/oauth.md](contracts/oauth.md).

### D13. Decision record

ADR-018 records D3 to D7 and amends ADR-008: delegated sign-in exists for agents only,
through Passport. ADR-017 is reserved by spec 003.

### Settled owner decisions (2026-10-13)

The owner chose Passport and asked for the fastest safe path to a customer pilot. The
proposed defaults are adopted:

1. **CIMD**: deferred. Dynamic registration is used meanwhile. After the pilot, offer
   a small, hand-reviewed server-side CIMD pull request to `laravel/mcp`. Its
   maintainers merge community pull requests quickly, but close ones that look
   AI-generated without careful review.
2. **Activity retention**: 90 days, configurable.
3. **Rate limits**: 120 calls a minute and 2,000 an hour per connection.
4. **Dashboard proposals**: need `Device.view` on every referenced device. The
   portal's own gap is reported separately.
5. **Removed members' portal sessions**: unchanged here.
6. **Organization-specific connector addresses**: after the pilot.

**Pilot release**: PRs 1 to 4 (connect, oversight, read tools). Drafts (PRs 5 to 7)
follow.

### Alternatives considered for sign-in

- **WorkOS AuthKit with Standalone Connect** supports CIMD, audience-bound tokens and
  consent options that could carry the organization and level. It was rejected for
  now because:
  - every customer deployment would need its own WorkOS environment;
  - users would be copied into a US-only service;
  - the consent screen can only be branded, not hosted by us;
  - immediate revocation is undocumented;
  - air-gapped deployments cannot use it.

  It conflicts with ADR-006 and ADR-008's no-external-identity-service starting
  point, and on-premise deployments would still need Passport.
- **Self-hosted identity servers**:
  - **Ory Hydra** (Apache-2.0, a small Go binary) is built around the application's
    own login and consent pages. It has no CIMD (hydra#4061) and no native
    `resource` handling, and it adds a container to every deployment.
  - **Keycloak 26.8** has CIMD and resource indicators only as experimental
    features with open bugs, needs a JVM, and needs Java extensions to use our
    login.
  - **Zitadel**, **authentik**, **Logto** and **Authelia** each own the user store
    or lack the features.

  Every one of them would still need our organization binding. Passport covers as
  much as they do without a new service.
- **SaaS providers that support "bring your own login"**: Stytch Connected Apps and
  Scalekit. Scalekit also has a self-hosted edition, licensed per deployment. Both
  share WorkOS's objections, apart from data residency.
- **Upstreaming**:
  - RFC 8707 audience binding and refresh-token reuse detection have open, stalled
    pull requests in league/oauth2-server (#1503, #1512 and #1506), so they are built
    locally on Passport's extension points.
  - Server-side CIMD is the realistic contribution, to `laravel/mcp`.
