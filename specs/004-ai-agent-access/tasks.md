---

description: "Task list for AI agent access (spec 004)"
---

# Tasks: AI Agent Access

**Input**: Design documents from `/specs/004-ai-agent-access/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md)
(section 6), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md)

**Tests**: Required. The success criteria are automated checks (SC-003 to SC-006,
SC-008, SC-009). Constitution principle III requires a cross-organization test for
every change that touches tenant data, and the sign-in profile needs a conformance
test per rule. Test tasks are part of each story.

**Organization**: Tasks are grouped by user story. Each group names the pull request
(PR 1 to PR 8, plan.md "Delivery") that carries it. Phases follow delivery order,
not story priority:

- The administrator switch (part of US3) lands in the foundation (PR 1), because
  every connection needs it.
- US3's oversight lands with US1's endpoint in PR 3, before US2's read tools.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1 to US5)
- Paths are repository-relative; PHP paths are under `apps/api/`

## Before starting

The owner decisions are settled (plan.md, "Owner decisions"; research section 7). The
decisions that shape tasks:

- CIMD is deferred.
- Activity is kept for 90 days (T013).
- The rate limits are 120 calls a minute and 2,000 an hour (T033).
- Dashboard proposals need `Device.view` on referenced devices (T077).

The package upgrade (`chore/upgrade-laravel-packages`) merges before T001. The pilot
release is PRs 1 to 4.

---

## Phase 1: Setup (PR 1)

**Purpose**: Dependency, configuration and the domain skeleton

- [x] T001 After the package upgrade (`chore/upgrade-laravel-packages`) has merged, run `composer require laravel/mcp:^1.0.2 laravel/passport:^13.9` in apps/api. Confirm apps/api/composer.lock lists both under `packages`, not `packages-dev`. Publish Passport's migrations with `php artisan vendor:publish --tag=passport-migrations`
- [x] T002 [P] Create apps/api/config/agents.php with the keys of data-model.md section 9:
  - `enabled` (`IOT_AGENTS_ENABLED`, default `false`)
  - `resource` (`rtrim(APP_URL, '/').'/mcp'`)
  - `connection_idle_days` 90
  - `activity_days` (`IOT_AGENTS_ACTIVITY_DAYS`, default 90)
  - `rate_per_minute` 120, `rate_per_hour` 2000, `max_result_characters` 60000

  Add the environment variables (all off), `IOT_AGENTS_REDIRECT_DOMAINS` and the
  Passport key variables to apps/api/.env.example, deploy/compose/compose.app.yml and
  deploy/release/compose.yml.
- [x] T003 [P] Create apps/api/app/Domain/Agents/ with `Models/`, `Enums/`, `Services/`, `Http/`, `Http/Middleware/`, `Mcp/`, `Mcp/Tools/`, `Proposals/`, `Console/` and `routes/`. Load `Domain/Agents/routes/api.php` from apps/api/routes/api.php like the other domains

---

## Phase 2: Foundational (PR 1)

**Purpose**: Tables, models, switches and the settings page shell that every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create apps/api/database/migrations/2026_10_13_000000_create_agent_access.php with the two `organizations` columns and the four `agent_*` tables of data-model.md sections 1 and 4 to 7. Include:
  - `agent_access_enabled` boolean default `false`;
  - `agent_connections.oauth_client_id` as a uuid foreign key to `oauth_clients`, restrict on delete;
  - the partial unique index on `agent_connections (user_id, oauth_client_id) where revoked_at is null`;
  - indexes on `agent_activity (organization_id, created_at)` and `(agent_connection_id, created_at)`;
  - enum columns as strings with check constraints;
  - integer `user_id` foreign keys (ADR-013), cascading as listed.
- [x] T005 [P] Create the enums in apps/api/app/Domain/Agents/Enums/:
  - `AccessLevel` (`read`, `draft`)
  - `RevocationReason` (`person`, `administrator`, `membership_removed`, `password_reset`, `refresh_reuse`, `replaced`)
  - `ActivityOutcome` (`answered`, `refused`, `failed`)
  - `ProposalKind` (`profile_section`, `decoder_revision`, `device_registration`, `dashboard`)
  - `ProposalStatus` (`open`, `applied`, `discarded`, `expired`, `superseded`)
- [x] T006 [P] Create the models in apps/api/app/Domain/Agents/Models/ with casts and relations:
  - `AgentConnection`: `scopeActive()`; `isExpired()` (no call for `connection_idle_days`); `revoke(RevocationReason, ?User)`, which also sets `revoked` on the person's Passport access and refresh tokens for its client.
  - `AgentActivity`
  - `AgentProposalGroup`
  - `AgentProposal`
- [x] T007 Move apps/api/app/Domain/Shared/Models/User.php to Passport's `HasApiTokens` and `OAuthenticatable`, replacing Sanctum's trait (research finding 5). Then:
  - make apps/api/database/seeders/PermissionSeeder.php skip the `mcp` guard;
  - switch the tests that sign in with `createToken()` (Integrations, Webhook, EventJournal, Geofence, PasswordRecovery) to `actingAs`;
  - add a test that asserts the trait and the seeder's guards.
- [x] T008 [P] Create factories for the agent models in apps/api/database/factories/Agents/, with a helper that creates a public Passport client the way registration does (done as the test trait tests/Support/Agents/AgentFixtures.php; the repository has factories only for users and organizations)
- [x] T009 Implement apps/api/app/Domain/Agents/Services/AgentAccess.php:
  - `deploymentEnabled()`
  - `organizationEnabled(Organization)`
  - `canManage(User, Organization)`: a member holding `Organization.update`, through `OrganizationAdministrationAuthorization`
  - `setEnabled(User, Organization, bool)`: writes `agent_access_enabled` and `agent_access_changed_at`, and records `DeviceAudit::record('agents.access_enabled'|'agents.access_disabled', …)` (FR-003)
- [x] T010 Add `features.agent_access` and `agents {enabled, manage}` to apps/api/app/Domain/Administration/Http/Resources/OrganizationResource.php, and the matching fields to the organization capability type in packages/api-client/src/index.ts
- [x] T011 Implement `GET` and `PUT organizations/{organization}/agent-access` in apps/api/app/Domain/Agents/Http/AgentAccessController.php, registered in apps/api/app/Domain/Agents/routes/api.php with `auth:sanctum` and `ResolveOrganizationContext`:
  - 404 while the deployment switch is off;
  - `GET` returns `{enabled, can_manage, connector_url}` to any member;
  - `PUT {enabled}` requires `canManage`.
- [x] T012 Describe the two operations and the capability fields in contracts/openapi/supplements/agents.yaml. Run `cd apps/api && php artisan contract:export`. Add `agentAccess()` and `setAgentAccess()` to packages/api-client/src/agents.ts, exported from the package index (Scramble inferred both response bodies fully, so no supplement was needed; the coverage tests now count only the pairs they set up)
- [x] T013 Implement `agents:prune` in apps/api/app/Domain/Agents/Console/PruneAgents.php and schedule it daily in apps/api/routes/console.php. It deletes:
  - Passport clients created by registration that have no connection 24 hours after creation;
  - activity older than `agents.activity_days`.
  
  It also marks open proposals past `expires_at` as `expired`. Schedule Passport's
  `passport:purge` daily as well.
- [x] T014 Add the **Connected AI apps** page (navigation label "AI apps") in apps/portal/src/agents/AiAppsSettings.tsx as settings sub-route `ai-apps` in apps/portal/src/settings/Settings.tsx, shown only when `features.agent_access`. It contains:
  - a `Panel` with the connector address, a copy button and per-client steps (Claude.ai and Claude Desktop: Settings → Connectors → Add custom connector; Claude Code: `claude mcp add --transport http iot-os <url>` then `/mcp`; other MCP clients);
  - a `Switch` for administrators (`agents.manage`) with a toast on change;
  - empty "Your connections" and "Connections to this organization" sections.
  
  Use the kit's `SettingsPage` sections.
- [x] T015 [P] Write apps/api/tests/Feature/Agents/AgentAccessSettingsTest.php:
  - deployment off gives 404;
  - a member can `GET`, but gets 403 on `PUT`;
  - an administrator's `PUT` toggles the switch and writes an audit row;
  - new organizations start off;
  - capabilities in `/me` and `/context`;
  - another organization's administrator cannot change it.
- [x] T016 [P] Write apps/portal/src/agents/model.test.ts for visibility rules (feature off hides the section; non-administrators see no switch)
- [x] T017 Create docs/features/agents.md (overview, switches, configuration) and link it from docs/README.md
- [ ] T018 Rebuild `api`, `scheduler` and `portal` with the AGENTS.md compose command. As an administrator with `IOT_AGENTS_ENABLED=true`, switch agent access on and off on the running stack

**Checkpoint**: Switches exist; nothing can connect yet

---

## Phase 3: User Story 1 - Connect an agent from the portal in a minute, and disconnect it (Priority: P1) 🎯 MVP (PR 2, PR 3)

**Goal**: An agent connects with only the connector address and the person's approval
in the portal, lists its tools, calls one, and stops working when disconnected.

**Requirements**: FR-004 to FR-018, FR-034 to FR-036; SC-001 to SC-003, SC-008.

**Independent Test**: Quickstart B1 with Claude Code and the MCP Inspector on the
local stack, and B2 (`php artisan test --compact --filter=AgentOAuth`).

### Sign-in (PR 2)

- [x] T019 [P] [US1] Configure Passport in apps/api/app/Domain/Agents/AgentsServiceProvider.php (registered in apps/api/bootstrap/providers.php):
  - `Passport::ignoreRoutes()`, with the device flow and JSON API off;
  - `tokensExpireIn(1 hour)` and `refreshTokensExpireIn(90 days)`;
  - `Passport::authorizationView()` returning a redirect to `{FRONTEND_URL}/connect`;
  - keys from `PASSPORT_PRIVATE_KEY` and `PASSPORT_PUBLIC_KEY`.
  
  In apps/api/config/auth.php, add the `mcp` guard (driver `passport`, provider `users`). Set `passport.guard` to `web`.
- [x] T020 [US1] Register the agent routes in apps/api/routes/ai.php, all behind `RequireAgentAccess` (404 JSON while `IOT_AGENTS_ENABLED=false`):
  - `Mcp::oauthRoutes(registration: false)`;
  - `POST oauth/register`: `laravel/mcp`'s `OAuthRegisterController`, named `mcp.oauth.register`, with `throttle:10,1`;
  - `GET oauth/authorize`: Passport's `AuthorizationController@authorize`, named `passport.authorizations.authorize`, with `web` and `RequireMcpResource`;
  - `POST oauth/token`: our `AccessTokenController`, named `passport.token`, with `throttle:60,1` and `RequireMcpResource`.
  
  Set `mcp.redirect_domains` in apps/api/config/mcp.php from `IOT_AGENTS_REDIRECT_DOMAINS` (default `*`).
- [x] T021 [P] [US1] Implement apps/api/app/Domain/Agents/Http/Middleware/RequireAgentAccess.php and RequireMcpResource.php. A `resource` parameter, when present, must equal `config('agents.resource')` ignoring a trailing slash. Otherwise authorize redirects back to the registered redirect URI with `error=invalid_target` and `state`, and token answers `400 {"error": "invalid_target"}`
- [x] T022 [US1] Add the guest redirect in apps/api/bootstrap/app.php with `redirectGuestsTo`: for the route `passport.authorizations.authorize` only, send the person to `{FRONTEND_URL}/connect?return=<full authorize URL>`. Every other route keeps today's behaviour (JSON 401 for `api/*`)
- [ ] T023 [US1] (Deferred in PR 2: Passport rejects reused refresh tokens; revoking the connection on reuse needs a grace-window design, research D3.) Implement apps/api/app/Domain/Agents/Http/AccessTokenController.php, a subclass of Passport's `AccessTokenController`:
  - after an authorization-code exchange, require an active connection for the person and client, or revoke the issued tokens and answer `invalid_grant`;
  - when Passport rejects a refresh token as revoked by rotation, revoke the connection for the request's `client_id` with reason `refresh_reuse`;
  - a token that cannot be decrypted revokes nothing.
- [x] T024 [US1] Implement apps/api/app/Domain/Agents/Http/ConsentController.php (routes in apps/api/app/Domain/Agents/routes/api.php, `auth:sanctum`):
  - `GET agent-authorizations/current`: reads Passport's `authRequest` and `authToken` from the session without removing them; returns the shape in contracts/portal-api.md, or 404 when none is pending.
  - `POST agent-authorizations/approve {auth_token, organization_uuid, access_level}`:
    - retrieves the request with Passport's `RetrievesAuthRequestFromSession` (409 on an `auth_token` mismatch);
    - checks membership and both switches (403);
    - creates the connection, or replaces the active one for the person and client (reason `replaced`, revoking its earlier tokens);
    - sets the user, approves, calls `AuthorizationServer::completeAuthorizationRequest`, and returns `{redirect_to}` from the `Location` header.
  - `POST agent-authorizations/deny {auth_token}`: completes with `access_denied` and returns `{redirect_to}`.
- [x] T025 [US1] Describe the three consent operations in contracts/openapi/supplements/agents.yaml, run `contract:export`, and add `currentAgentAuthorization()`, `approveAgentAuthorization()` and `denyAgentAuthorization()` to packages/api-client/src/agents.ts
- [x] T026 [US1] Build apps/portal/src/agents/ConnectPage.tsx as top-level route `connect` in apps/portal/src/App.tsx, inside `Session` and outside `PortalShell`. When signed out, the existing in-place login appears.
  - **With `?return=`**: after sign-in, navigate to it only when it starts with `{API_URL}/oauth/authorize`; otherwise show an error.
  - **Without it**: load `current` and show:
    - "Returns to <host>" first, and the agent's name with a "self-declared" badge;
    - an organization `SearchableSelect`, preselected when there is one, with unavailable organizations disabled with their reason and, for administrators, a link to switch them on;
    - two `ChoiceCard`s: **Read**, "Investigate devices, readings, alerts and dashboards", and **Read and drafts**, "Also prepare changes you review and apply here";
    - the line "The agent acts with your permissions";
    - **Approve** and **Deny**.
  
  On a response, the page calls `window.location.assign(redirect_to)`. A "no pending connection" state covers expired or replaced requests.
- [x] T027 [US1] Serve `Content-Security-Policy: frame-ancestors 'none'` for `/connect` in deploy/docker/admin/nginx.conf (the portal image's configuration), and verify it on the rebuilt `portal`
- [x] T028 [US1] Provision Passport keys:
  - `tooling/bootstrap` runs `php artisan passport:keys` into ignored storage for development;
  - deploy/release/compose.yml passes `PASSPORT_PRIVATE_KEY` and `PASSPORT_PUBLIC_KEY` from the `.local/` deployment secrets;
  - tooling/release generates them once per deployment and never overwrites them.
  
  Document rotation (every agent reconnects) in docs/features/agents.md.
- [ ] T029 [P] [US1] Write the conformance suite in apps/api/tests/Feature/Agents/OAuth/ (classes named `AgentOAuth*Test`), starting from the spike test (research section 6). Cover:
  - discovery bodies, and 404 when off; the 401 challenge;
  - registration: validation, redirect domains, loopback, rate limit;
  - the guest redirect and its `return`;
  - consent: `current`, approve, deny, `auth_token` mismatch 409, non-member and switch-off 403, replace on re-approve;
  - `resource` mismatch on authorize and token;
  - token: a wrong PKCE verifier, code reuse, refresh rotation, refresh reuse revoking the connection, a revoked token answering 401;
  - separation, in fresh test methods: a portal session on `/mcp` and an agent token on `/api/v1/me` and `/api/integration/v1` all answer 401;
  - portal sessions and integration tokens still authenticate through Sanctum.
- [ ] T030 [P] [US1] Write apps/portal/e2e/agents.spec.ts for `/connect` with a mocked API: signed in, signed out with `return`, a rejected `return`, a single organization preselected, an unavailable organization, deny, no pending connection, and an axe scan after animations settle
- [ ] T031 [US1] Run `/security-review` on the PR 2 diff and fix its findings. Set docs/adr/ADR-018-agent-access-oauth.md to Accepted, set the ADR-008 status line to "Accepted; amended by ADR-018", and update docs/adr/README.md
- [ ] T032 [US1] Rebuild `api` and `portal`. On the running stack, complete sign-in with the MCP Inspector's auth flow and with Claude Code (`claude mcp add --transport http iot-os http://127.0.0.1:8001/mcp`) up to token issuance

### Endpoint, first tools and disconnect (PR 3)

- [x] T033 [US1] Implement apps/api/app/Domain/Agents/Http/Middleware/AuthenticateAgent.php, which runs after `RequireAgentAccess` and `auth:mcp` (Passport validates the bearer token, its expiry and revocation, and answers 401 with the challenge). In order (research D7):
  1. The connection for the token's person and client (`$request->user('mcp')->token()->client_id`) is active and not idle for `connection_idle_days`. Otherwise revoke its tokens and answer `401` with `error="invalid_token"` and `error_description`.
  2. The organization's switch is on.
  3. The person is a member.
  
  Failures at steps 2 and 3 return JSON-RPC errors that name the cause and the organization's administrators. On success:
  - swap the request's user resolver to the domain `User`;
  - enter the organization context as `ResolveOrganizationContext` does (team id set, relations cleared, restored in `finally`), or with `OrganizationContext::run()` if spec 003 PR 2 has merged;
  - rate limit per connection (`rate_per_minute`, `rate_per_hour`);
  - update `last_used_at` at most once a minute;
  - bind a scoped `AgentContext` (connection, person, organization, level).
- [x] T034 [US1] Implement apps/api/app/Domain/Agents/Mcp/AgentTool.php and ToolResult.php. `AgentTool`:
  - declares level and permission, and registers only for allowed levels (`shouldRegister`);
  - checks the permission through the existing domain authorization services;
  - translates `HttpException`, `ModelNotFoundException`, `ValidationException` and authorization failures into the error codes of contracts/mcp-tools.md;
  - writes one `agent_activity` row per call (outcome, reason, at most 20 targets, duration);
  - bounds results at `max_result_characters`.
  
  `ToolResult` builds the envelope (`data`, `page`, `untrusted`, `next_steps`), and a `PortalUrls` service builds `portal_url` values from `FRONTEND_URL`. Read tools default to read-only, idempotent and closed-world annotations.
- [x] T035 [US1] Implement apps/api/app/Domain/Agents/Mcp/PlatformServer.php:
  - name `iot-os`, protocol versions 2026-07-28, 2025-11-25 and 2025-06-18;
  - the instructions of contracts/mcp-tools.md filled with the organization, the person and the level;
  - registered in apps/api/routes/ai.php as `Mcp::web('/mcp', PlatformServer::class)->middleware([RequireAgentAccess::class, 'auth:mcp', AuthenticateAgent::class])`.
  
  Check that `laravel/mcp`'s global `AddWwwAuthenticateHeader` leaves the middleware's header intact.
- [x] T036 [P] [US1] Extract apps/api/app/Domain/Devices/Services/DeviceDirectory.php from `DeviceController::index`, with an added presence filter (`online`, `offline`, `unknown`, `unseen`, `quiet`) used only by tools. Move the controller onto it with byte-identical responses, and extract `OverviewQuery` from `OverviewController` the same way
- [x] T037 [US1] Implement the `get_overview` and `find_devices` tools in apps/api/app/Domain/Agents/Mcp/Tools/ per contracts/mcp-tools.md: `limit` 1–50 (default 20), `search` at most 255 characters, cursor paging
- [x] T038 [US1] Implement `agents:tools --export|--check` in apps/api/app/Domain/Agents/Console/ExportToolCatalogue.php. It writes contracts/agents/tools.json, sorted by name, with a `catalogue_version`, and for each tool its name, description, input and output schemas, annotations, level, permission and one example result checked against its output schema (research D12). It fails on any tool with `destructiveHint: true`. Add `php artisan agents:tools --check` to the API job in .github/workflows/ci.yml next to `contract:export --check`
- [x] T039 [US1] Implement `GET me/agent-connections`, `DELETE me/agent-connections/{connection}` (owner only; reason `person`) and `GET organizations/{organization}/agent-connections/{connection}/activity` (owner; 50 per page, newest first) in apps/api/app/Domain/Agents/Http/ConnectionController.php:
  - derive `state` (`active`, `expired`, `revoked`, `unavailable`) as in contracts/portal-api.md;
  - describe them in agents.yaml, export, and add them to packages/api-client/src/agents.ts.
- [x] T040 [US1] Add a `ConnectionRevoker` in apps/api/app/Domain/Agents/Services/ and call it (landed in PR 1, so a password reset never leaves usable Passport refresh tokens once `User` holds Passport tokens):
  - from `OrganizationMembershipManager::remove` (the member's connections to that organization, reason `membership_removed`);
  - from apps/api/app/Domain/Authentication/Http/Controllers/PasswordRecoveryController.php next to `tokens()->delete()` (all of the person's connections, reason `password_reset`).
- [x] T041 [US1] Fill "Your connections" in apps/portal/src/agents/AiAppsSettings.tsx with a `DataTable`:
  - columns: agent name with its return host, organization, level, created and last used as `RelativeTime`, and state through `statusOf`/`Status`;
  - **Disconnect** with an `AlertDialog`;
  - activity in a `Sheet` with paging.
- [x] T042 [P] [US1] Write apps/api/tests/Feature/Agents/GateTest.php:
  - each gate step's outcome and its order;
  - an agent token refused on `/api/v1` and `/api/integration/v1`;
  - a session cookie and an integration token refused on `/mcp` (FR-014);
  - the rate limit; `last_used_at` throttling;
  - tools listed by level; error translation; one activity row per call.
- [x] T043 [P] [US1] Write apps/api/tests/Feature/Agents/ConnectionsTest.php: owner listing, disconnect stopping the next call, activity paging, membership removal and password reset revocation, expiry after 90 days without refresh, another person's connection being not found
- [x] T044 [US1] Build the isolation harness in apps/api/tests/Feature/Agents/Isolation/AgentIsolationTest.php. Its dataset is every registered tool × three cases:
  - organization B's identifiers;
  - a member without the tool's permission;
  - a read connection for draft tools.
  
  Each case expects `not_found`, `permission` or `access_level`, with no B data. Also write SecretScanTest.php: seed broker passwords, connection-kit contents, an integration token, a webhook secret and adapter source credentials, capture every `ToolResult` produced in the suite through a test hook, and assert none contains a seeded value (SC-004, SC-005).
- [x] T045 [US1] Extend docs/features/agents.md with connecting, the consent screen, connections and disconnecting
- [ ] T046 [US1] Rebuild `api`, `scheduler` and `portal`, then run quickstart B1 steps 1 to 6 with Claude Code and the MCP Inspector on the running stack

**Checkpoint**: A person connects, the agent reads the overview and devices, and
disconnecting stops it (MVP)

---

## Phase 4: User Story 3 - Organization administrators oversee agent access (Priority: P3) (PR 3)

**Goal**: Administrators see and disconnect every connection to their organization and
switch agent access off for all of them.

**Requirements**: FR-002, FR-003, FR-035; US3 acceptance 1 to 5.

**Independent Test**: Quickstart B5.

- [x] T047 [US3] Implement `GET organizations/{organization}/agent-connections` (with `user {id, name, email}`) and `DELETE organizations/{organization}/agent-connections/{connection}` (reason `administrator`, audited with `DeviceAudit`) in apps/api/app/Domain/Agents/Http/ConnectionController.php. Allow administrators to read any connection's activity. All require `Organization.update`. Describe them in agents.yaml, export, and add them to packages/api-client/src/agents.ts
- [x] T048 [US3] Fill "Connections to this organization" in apps/portal/src/agents/AiAppsSettings.tsx for administrators:
  - a `DataTable` with a member column, **Disconnect** and the activity `Sheet`;
  - turning the switch off asks for confirmation in an `AlertDialog` ("All n connections stop at their next call");
  - members see `unavailable` connections with the reason.
- [x] T049 [P] [US3] Write apps/api/tests/Feature/Agents/AdministratorOversightTest.php:
  - an administrator sees every connection, a member only their own;
  - administrator disconnect writes an audit row and the member sees the reason;
  - switching off refuses the next call with the JSON-RPC error and removes the organization from consent;
  - switching on resumes non-revoked connections.
- [ ] T050 [P] [US3] Extend apps/portal/e2e/agents.spec.ts for the administrator section (list, disconnect, switch confirmation) with an axe scan
- [ ] T051 [US3] Extend docs/features/agents.md with administration, then rebuild `api` and `portal` and run quickstart B5 on the running stack

**Checkpoint**: Agent access can be offered to a pilot organization

---

## Phase 5: User Story 2 - Troubleshoot devices from the agent (Priority: P2) (PR 4)

**Goal**: Read tools give the agent the facts to diagnose devices, matching the portal,
without side effects.

**Requirements**: FR-019 to FR-025, FR-033; SC-006, SC-007.

**Independent Test**: Quickstart B3 (five fault scenarios) and the isolation dataset.

- [ ] T052 [P] [US2] Implement apps/api/app/Domain/Devices/Services/DeviceHealth.php:
  - the projection of contracts/mcp-tools.md `get_device_health`;
  - latest readings through the existing `RuntimeClient` latest path;
  - `age_seconds` and `stale_after_seconds`;
  - `review_required`: `true` when the device diagnostic carries the runtime's review texts or the draft's `birth_revision` differs from the candidate's; `null` with a reason when there is no evidence; never `false` without evidence.
- [ ] T053 [P] [US2] Implement apps/api/app/Domain/Devices/Services/IngestionDiagnostics.php, returning `checks[]` (`ok`, `problem`, `unknown`):
  - source presence and last birth;
  - `birth_revision` drift;
  - unmapped announced metrics (candidate metrics minus applied mappings);
  - type and constraint mismatches;
  - stale, invalid or inactive readings with diagnostics;
  - applied versus desired configuration, `deployment_status` and `diagnostic`;
  - for adapters, status, health, applied revision and its last test result, never `code`;
  - adapter candidate previews;
  - when the person has `Device.manage` and a capture session is open, its samples' status and diagnostics, never `wire_base64`.
  
  It never starts, stops or changes a capture, and calls no validate or test endpoint.
- [ ] T054 [P] [US2] Extract apps/api/app/Domain/Automation/Services/AlertQuery.php from `AlertController::index`, with a site filter (through the site's device uuids) used only by tools, and move the controller onto it with identical responses
- [ ] T055 [P] [US2] Implement apps/api/app/Domain/Dashboards/Services/DashboardQuery.php (visible list, show without touching `last_viewed_at`) and move `DashboardController::index` onto it with identical responses
- [ ] T056 [US2] Implement `get_device_health`, `get_measurements` and `get_ingestion_diagnostics` in apps/api/app/Domain/Agents/Mcp/Tools/ per contracts/mcp-tools.md. `get_measurements` takes:
  - 1–4 `parameter_uuid` values;
  - `max_points` 10–500, default 120;
  - `kind` `history`, `increase` or `state`;
  - `bucket` for increases.
  
  It calls the existing runtime reads and their limits.
- [ ] T057 [US2] Implement the remaining read tools in apps/api/app/Domain/Agents/Mcp/Tools/: `list_alerts` (`limit` 1–50), `list_sites`, `list_device_profiles` (default `published`), `get_device_profile` (no transport credentials), `list_adapters` (adapters enabled; no `code` or source credentials), `list_dashboards` and `get_dashboard`
- [ ] T058 [US2] Implement `get_authoring_guide` in apps/api/app/Domain/Agents/Mcp/Tools/. Topics `profiles`, `mappings`, `decoders` and `dashboards`; content comes from apps/api/resources/agents/guides/*.md, plus the panel type rules generated from `DashboardDefinition`'s type constants
- [ ] T059 [US2] Write apps/api/tests/Feature/Agents/Tools/ tests per tool family:
  - the five fault scenarios in IngestionDiagnosticsTest.php (stopped reporting, unmapped metric, decoder failure, review required, open alert) with runtime and adapter-manager fakes;
  - checks that results match the portal endpoints' values for the same device.
  
  Add every new tool to the isolation dataset and run `agents:tools --export`.
- [ ] T060 [US2] Extend docs/features/agents.md with the read tools, then rebuild `api`, `scheduler` and `portal` and run quickstart B3 with the device simulators, recording read latency from the activity log (SC-007)

**Checkpoint**: First release candidate (US1 to US3)

---

## Phase 6: User Story 4 - Onboard devices with the agent preparing the work (Priority: P4) (PR 5, PR 6)

**Goal**: Draft tools prepare grouped proposals that the person reviews and applies on
one portal page. Activation stays in the portal, and credentials never pass through
the agent.

**Requirements**: FR-026 to FR-032; SC-010.

**Independent Test**: Quickstart B6.

### Proposals and profiles (PR 5)

- [ ] T061 [US4] Extract apps/api/app/Domain/DeviceProfiles/Services/ProfileSectionWriter.php (validation and writes for `identity`, `parameters`, `groups` and `calculations`) from `ProfileProposalService::validateChanges` and `writeChanges`. Make `ProfileProposalService` delegate to it with its tests unchanged
- [ ] T062 [US4] Implement apps/api/app/Domain/Agents/Proposals/ProposalService.php:
  - `prepare(kind, payload, ?group, title)`, with `content_hash` = SHA-256 of canonical JSON of kind, target, base revision and payload;
  - supersede an open proposal for the same target in the group;
  - expire after 7 days or when the base revision has moved;
  - `applyOne`: lock, hash (409), status, permission re-check, base revision (409), blocking (422), idempotent;
  - `applyGroup`: dependency order, stop at the first failure, report applied and failed;
  - `discard`.
  
  Appliers implement `Appliers/ProposalApplier.php`.
- [ ] T063 [US4] Implement `ProfileSectionApplier` and the `prepare_profile_section` tool:
  - a dry run through `ProfileSectionWriter` inside a rolled-back transaction;
  - `DeviceProfile.create` for new profiles, `DeviceProfile.update` for existing drafts;
  - archived profiles refused.
  
  Implement `get_review_status` too.
- [ ] T064 [US4] Implement the review endpoints of contracts/portal-api.md in apps/api/app/Domain/Agents/Http/ReviewController.php under `ResolveOrganizationContext`: group, apply one, apply group, discard one, discard group. Only the group's person may use them; others get not found. Describe them in agents.yaml, export, and add them to packages/api-client/src/agents.ts
- [ ] T065 [US4] Build apps/portal/src/agents/ReviewPage.tsx at `organizations/:organizationUuid/agent-reviews/:groupUuid` using `EntityPage`. For each proposal, a `Panel` with:
  - the summary as plain text;
  - the agent's name and time;
  - the assistant's comparison view for profile sections, or `JsonCode` for other kinds;
  - diagnostics, and `waiting_for` with its link;
  - **Apply** and **Discard**.
  
  A sticky "Apply all (n)" bar uses `ref={keepToastsAbove}`. Stale, expired and applied states are shown.
- [ ] T066 [P] [US4] Write apps/api/tests/Feature/Agents/Reviews/ProposalTest.php:
  - stale 409, hash mismatch 409, blocking 422, idempotent apply;
  - supersede, seven-day expiry, dependency order stopping at the first failure;
  - another person gets not found, and so does a group of another organization;
  - permission removed before apply gives 403;
  - a read connection gets `access_level`.
  
  Add `prepare_profile_section` to the isolation dataset.
- [ ] T067 [P] [US4] Extend apps/portal/e2e/agents.spec.ts for the review page (apply one, apply all, stale) with an axe scan
- [ ] T068 [US4] Extend docs/features/agents.md with reviews, then rebuild `api`, `assistant-worker` and `portal` and run quickstart B6 steps 1 to 3

### Devices and decoders (PR 6)

- [ ] T069 [US4] Extract apps/api/app/Domain/Devices/Actions/RegisterDevice.php (rules and creation) from `DeviceController::store` and `OnboardingController::store`, and move both controllers onto it with identical responses
- [ ] T070 [US4] Implement `DeviceRegistrationApplier` and `prepare_device_registration`:
  - validation through `RegisterDevice` rules plus `DeviceConfigurationService::compile` in a rolled-back transaction;
  - `waiting_for {live_action: "publish_profile", profile_uuid, revision}` when the revision is not published;
  - apply runs `RegisterDevice` then `DeviceConfigurationService::saveDraft`, and the device stays `registered`;
  - `{direct: true}` adds a `next_steps` link to the connection kit page;
  - no credential or kit content in any result.
- [ ] T071 [US4] Implement `test_decoder` through `AdapterManager::request('/test')` without persisting (as `AdapterAssistantTools` does): `code` at most 64 KiB, 1–5 samples of at most 64 KiB each, adapters enabled, `Device.manage`
- [ ] T072 [US4] Implement `DecoderRevisionApplier` and `prepare_decoder_revision`: validation through `AdapterService::fields`, at most 10 fixtures, apply through `AdapterService::save` with the base `draft_revision`
- [ ] T073 [P] [US4] Write tests for the three tools and appliers in apps/api/tests/Feature/Agents/Tools/ and Reviews/, add them to the isolation dataset, extend SecretScanTest.php with direct-device kits and adapter source credentials, and run `agents:tools --export`
- [ ] T074 [US4] Extend docs/features/agents.md with onboarding, then rebuild `api`, `adapter-worker` (adapter overlay) and `portal` and run quickstart B6 completely, recording the time against the portal-only baseline (SC-010)

**Checkpoint**: Onboarding works end to end with review in the portal

---

## Phase 7: User Story 5 - Draft dashboards from the agent (Priority: P5) (PR 7)

**Goal**: The agent prepares dashboards that the person previews with live data and
saves.

**Requirements**: FR-026; US5 acceptance 1 to 4.

**Independent Test**: Quickstart B7.

- [ ] T075 [US5] Add an array entry point `validateDocument(array, Organization, bool $updating)` to apps/api/app/Domain/Dashboards/Services/DashboardDefinition.php, and make `validate(Request, …)` call it with unchanged behaviour
- [ ] T076 [US5] Extract apps/api/app/Domain/Dashboards/Actions/SaveDashboard.php (create, and update with revision lock and snapshot) from `DashboardController::store` and `update`, and move the controller onto it with identical responses
- [ ] T077 [US5] Implement `DashboardApplier` and `prepare_dashboard`:
  - `Dashboard.create` for new dashboards, the edit ability for existing ones;
  - `Device.view` on every referenced device;
  - `base_revision` from the dashboard's `revision`.
- [ ] T078 [US5] Implement `GET …/agent-reviews/{group}/proposals/{proposal}/preview`, and render the document read-only with live data on apps/portal/src/agents/ReviewPage.tsx using the dashboard panels' existing components. Describe it in agents.yaml, export, and add it to the client
- [ ] T079 [P] [US5] Write tests:
  - validation parity with the portal for each panel type;
  - unviewable device refused;
  - stale revision 409;
  - a saved result equal to a hand-built dashboard.
  
  Add the tool to the isolation dataset and run `agents:tools --export`.
- [ ] T080 [US5] Extend docs/features/agents.md with dashboards, then rebuild `api` and `portal` and run quickstart B7

---

## Phase 8: Polish and cross-cutting concerns (PR 8)

- [ ] T081 [P] Link docs/features/agents.md from docs/features/access.md (sign-in methods), docs/features/assistant.md (the difference from the in-app assistant) and docs/features/integrations.md (agents act for a person, applications for themselves)
- [ ] T082 [P] Add the agent routes (`/mcp`, `/oauth/*`, `/.well-known/*`, `/api/v1/agent-*`) to docs/reference/api.md "Route groups"
- [ ] T083 [P] Add an operations section to docs/ops. Cover:
  - enabling (`IOT_AGENTS_*`);
  - hosted Claude needing `api.<domain>` reachable from the internet, with egress from `160.79.104.0/21`;
  - the redirect domain restriction;
  - pruning;
  - what to check when a connection fails.
- [ ] T084 [P] Update docs/roadmap.md (agent access shipped; organization-specific connector addresses and other delegated sign-in as candidates) and docs/dev/gotchas.md:
  - `laravel/mcp` turns `abort()` into "internal server error" without `AgentTool`;
  - Claude requires `resource` to equal the entered URL;
  - CIMD needs public hosts.
- [ ] T085 Run the release check on the pilot with Claude.ai, Claude Desktop, Claude Code and the MCP Inspector (quickstart B1 step 7), and record the results in the pull request (SC-002)
- [ ] T086 Run quickstart B8 with `IOT_AGENTS_ENABLED=false`, plus the full PHP, portal, admin and e2e suites and `contract:check`, then freeze specs/004-ai-agent-access/ (docs/dev/specs.md)

---

## Dependencies and execution order

### Phase dependencies

- **Setup and Foundational (PR 1)**: no dependencies; they block everything.
- **US1 sign-in (PR 2)**: depends on PR 1.
- **US1 endpoint and US3 (PR 3)**: depend on PR 2.
- **US2 (PR 4)**: depends on PR 3 (the gate, `AgentTool`, the isolation harness).
- **US4 profiles (PR 5)**: depends on PR 3. Devices and decoders (PR 6) depend on PR 5.
- **US5 (PR 7)**: depends on PR 5 (proposals and the review page).
- **Polish (PR 8)**: depends on PRs 4 to 7.

### Within each pull request

Services and actions come before tools, and tools before tests that call them. The
contract export runs before the client change. The rebuild and quickstart run last. Before each rebuild run `./taskw lint`, `pnpm --filter @iot-os/portal lint` (type check
and design-system guardrails) and `cd apps/api && php artisan test --compact`.

### Parallel opportunities

- PR 1: T002, T003; then T005, T006, T008; then T015, T016.
- PR 2: T019 and T021 together; T029 and T030 while T026 is reviewed.
- PR 3: T036 alongside T033 to T035; T042 and T043 together.
- PR 4: T052, T053, T054 and T055 together.
- After PR 5, PRs 6 and 7 can be built in parallel by different people.

## Parallel example: User Story 2

```bash
Task: "Implement DeviceHealth in apps/api/app/Domain/Devices/Services/DeviceHealth.php"
Task: "Implement IngestionDiagnostics in apps/api/app/Domain/Devices/Services/IngestionDiagnostics.php"
Task: "Extract AlertQuery in apps/api/app/Domain/Automation/Services/AlertQuery.php"
Task: "Implement DashboardQuery in apps/api/app/Domain/Dashboards/Services/DashboardQuery.php"
```

## Implementation strategy

### MVP first

1. PR 1 (switches), PR 2 (sign-in), PR 3 (endpoint, first tools, connections,
   oversight).
2. **Stop and validate**: quickstart B1, B2, B4 and B5. A pilot organization can
   connect a read-only agent.

### Incremental delivery

1. Add PR 4 (read tools). This is the first release candidate, offered to pilot
   customers.
2. Add PR 5 and PR 6 (onboarding drafts).
3. Add PR 7 (dashboards).
4. Finish with PR 8 (documentation and the four-client release check).
