# Implementation Plan: AI Agent Access

**Branch**: `spec/004-ai-agent-access` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-ai-agent-access/spec.md`

## Summary

People connect their own AI agent (Claude.ai, Claude Desktop, Claude Code or any
other MCP client) to one organization by pasting one address and approving in the
portal. The agent then investigates devices and prepares changes that the person
reviews and applies in the portal. There are six parts:

- **An MCP endpoint in Laravel.** `https://api.<domain>/mcp`, served by `laravel/mcp`
  (moved into production dependencies), in a new `Domain/Agents`.
- **Laravel Passport as the authorization server, with `laravel/mcp`'s OAuth
  routes.**
  - Passport issues codes and tokens: OAuth 2.1 authorization code with PKCE S256 and
    rotating refresh tokens.
  - `laravel/mcp` 1.0.2 serves discovery and dynamic client registration.
  - We add a `resource` check and the organization binding. `User` moves to
    Passport's token trait, because Passport and Sanctum cannot share it and people
    never hold Sanctum tokens.
  - A spike ran Claude's whole flow on this stack (research D3, D4 and section 6).
- **Consent in the portal.** Passport's authorization view hands off to the portal's
  `/connect` page. The page reuses the session and sign-in. The person picks an organization
  and **Read** or **Read and drafts**, and the page returns them to the agent (D5).
- **Connections with one gate.** Every call checks the token, the connection, the
  deployment and organization switches and membership. It then enters the
  organization context, applies a per-connection rate limit and records the call.
  **Settings → AI apps** lists and revokes connections; administrators see everyone's
  and switch access on or off (D6, D7).
- **Tools.**
  - Thirteen read tools (overview, devices, health, measurements, ingestion
    diagnostics, alerts, sites, profiles, adapters, dashboards, authoring guide) on
    side-effect-free query services.
  - Six draft tools that create **grouped proposals**, reviewed and applied on one
    portal page through domain actions extracted from controllers.
  - No tool performs a live action or returns a secret (D8 to D11).
- **Contracts.** The new portal endpoints go into OpenAPI and `packages/api-client`.
  A generated tool catalogue, `contracts/agents/tools.json`, is checked in CI (D12).
  ADR-018 amends ADR-008 (D13).

Agent access is off by default for the deployment and for every organization. The
work lands in 8 pull requests, about 23 to 28 engineer-days, after the package
upgrade that brings `laravel/mcp` to 1.0.2.

## Technical Context

**Language/Version**: PHP 8.4 with Laravel 13.35; TypeScript with React 19 and React
Router 7 (portal).

**Primary Dependencies**:

- `laravel/mcp` `^1.0.2`: moves from a transitive development dependency into
  `require`. Its discovery routes are used; registration runs on our rate-limited
  route.
- `laravel/passport` `^13.9`: new. Only the authorize and token routes are
  registered, behind the `mcp` guard.
- Already present: Sanctum 4.3 (portal sessions), `spatie/laravel-permission`, and the
  `@iot-os/ui` kit (`SettingsPage`, `CollectionPage`, `DataTable`, `Panel`,
  `ChoiceCard`, `SearchableSelect`, `Switch`, `Sheet`, `AlertDialog`, `JsonCode`,
  `RelativeTime`).
- The package upgrade that brings `laravel/mcp` to 1.0.2 lands first, on its own
  (`chore/upgrade-laravel-packages`; research finding 10).

**Storage**: PostgreSQL 17 with TimescaleDB. Passport's five tables, four new `agent_*`
tables and two new columns on `organizations` ([data-model.md](data-model.md)). Nothing new in the runtime.

**Testing**:

- Pest feature tests (`php artisan test --compact`) on PostgreSQL in CI, using
  `laravel/mcp` test helpers (`PlatformServer::actingAs()->tool()`).
- An OAuth conformance suite.
- An agent isolation dataset with a secret scan.
- Portal Vitest for models.
- Playwright e2e for `/connect`, **Settings → AI apps** and the review page.
- Spec 001 contract checks, and the new `agents:tools --check`.

**Target Platform**: The single-node Compose deployment (ADR-006). Hosted Claude needs
`api.<domain>` reachable from the internet (Claude's egress is `160.79.104.0/21`).
Claude Code and the MCP Inspector work against a local stack.

**Project Type**: Web service (Laravel API) plus web application (portal).

**Performance Goals**:

- Gate and activity overhead under 20 ms per call.
- Read tools: 95% under 2 s at pilot volume (SC-007).
- Token endpoint under 200 ms (Claude allows 10 s).

**Constraints**:

- Tool results at most 60,000 characters (Claude caps at about 150,000).
- No remote calls on the token path.
- History reads keep the runtime's existing limits (2,000 points, 25 s).

**Scale/Scope**: Pilot: tens of organizations, hundreds of devices per organization,
a handful of connections per organization, and up to thousands of activity rows a
day. 19 tools, 16 portal endpoints, 6 OAuth and discovery routes, 3 portal pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate question for this feature | Before research | After design |
| --- | --- | --- | --- | --- |
| I | Laravel owns intent; Go executes | Does anything let an agent reach the runtime, broker or database, or move authorization out of Laravel? | Pass: the endpoint is planned in Laravel. | Pass: the MCP server, sign-in (Passport), authorization and proposals are all in `apps/api`. Tools read through Laravel query services; the runtime is called only through the existing `RuntimeClient` paths. The runtime is unchanged. |
| II | Immutable versions, explicit activation | Can an agent publish, activate or deploy? | Pass | Pass: proposals apply only to drafts (profile draft, adapter draft revision, a registered inactive device and its configuration draft, a dashboard revision). Publishing, activating and deploying stay in the portal; no tool exists for them (FR-031). |
| III | Tenant isolation everywhere | Is the organization resolved and membership checked before permission on every call, from the credential, never the payload? Does every change carry a cross-organization test? | Action | Pass: the organization comes from the connection, never from tool input. Membership is checked on every call before the tool's permission (D7). The agent isolation dataset runs every tool against another organization's identifiers (SC-004). New `/api/v1` routes use the organization middleware and join spec 003's walker when it lands. |
| IV | Contracts first | Do public API changes update the contract, `packages/api-client` and docs together? | Action | Pass: `agents.yaml` supplement and `contract:export` for the 16 portal operations. `src/agents.ts` in the client. The capability change is described and exported. The tool catalogue is generated and checked in CI. OAuth and MCP follow their RFCs and [contracts/oauth.md](contracts/oauth.md). User references are integer `user_id`. |
| V | AI proposes, people approve | Do tools run with the person's permissions, re-checked at execution? Are writes proposals? Does the platform work with it off? | Pass (by design) | Pass: every call re-evaluates membership and permissions. Draft tools create proposals; apply re-checks the permission, base revision and hash. No live action or secret is reachable. Off by default for deployment and organizations; FR-041 and quickstart B8 verify the platform without it. |
| VI | Show uncertainty; never invent state | Do tools report unknown and stale values honestly? | Action | Pass: readings keep `quality`, age and diagnostics. `review_required` is `null` with a reason when evidence is missing. Presence `unknown` is never shown as online. |
| VII | Durable, idempotent messaging | Any new messaging or retries? | Pass | Pass: no new messages. Proposal apply is idempotent. Token exchange is single use with reuse detection. Pruning is a daily scheduled command. |
| VIII | One design system | Do new pages use kit templates and components and pass `check-ui`? | Action | Pass: `/connect` uses `Panel`, `ChoiceCard` and `SearchableSelect`. **AI apps** uses `SettingsPage` sections with `DataTable`, `Switch`, `Sheet` (activity) and `AlertDialog` (disconnect). The review page uses `EntityPage`, `Panel`, the assistant's comparison view and `JsonCode`. Its sticky bar uses `ref={keepToastsAbove}`. Times use `RelativeTime`; state uses `statusOf`/`Status`. |
| IX | Done means verified where it runs | Rebuilt containers and exercised in the running app? | Pass | Pass: each pull request lists its rebuilds (`api`, `scheduler`, `portal`) and the quickstart scenario it runs. PR 8 records the four-client release check on the pilot. |
| — | Decisions are ADRs | Is the delegated sign-in decision recorded? | Action | Pass: ADR-018 (this documents pull request, status Proposed; PR 2 marks it Accepted) amends ADR-008 and adopts the Passport option ADR-008 named. ADR-017 is reserved by spec 003. |
| — | Small, reviewable changes | Can each pull request be reviewed alone? | Pass | Pass: 8 pull requests. The controller-to-action extractions sit in the pull request that first needs them, and leave controller responses unchanged. |
| — | Secrets never enter git | Any keys or credentials? | Action | Pass: Passport keys come from `PASSPORT_PRIVATE_KEY` and `PASSPORT_PUBLIC_KEY`. Release keys live in the ignored `.local/` deployment secrets; development keys are generated by `tooling/bootstrap` into ignored storage. Test keys are generated at run time. |

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-agent-access/
├── spec.md
├── plan.md                 # this file
├── research.md             # findings (1–5) and decisions D1–D13 (6)
├── data-model.md           # tables, states, payloads, configuration
├── quickstart.md           # adding a tool; validation scenarios B1–B8
├── contracts/
│   ├── oauth.md            # sign-in profile, discovery, registration, tokens
│   ├── mcp-tools.md        # server instructions, envelope, 19 tools
│   └── portal-api.md       # consent, connections, reviews, capabilities
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks output
docs/adr/ADR-018-agent-access-oauth.md
```

### Source Code (repository root)

```text
apps/api/
├── app/Domain/Agents/                         # new
│   ├── Models/  AgentConnection, AgentActivity,
│   │            AgentProposalGroup, AgentProposal
│   ├── Http/    ConsentController, AccessTokenController (Passport subclass),
│   │            ConnectionController, AgentAccessController, ReviewController,
│   │            Middleware/AuthenticateAgent, RequireMcpResource,
│   │            RequireAgentAccess
│   ├── Mcp/     PlatformServer, AgentTool, AgentContext, ToolResult,
│   │            Tools/*.php (19)
│   ├── Proposals/ ProposalService, ProposalKind (enum), Appliers/*.php
│   ├── Console/ PruneAgents, ExportToolCatalogue
│   ├── AgentsServiceProvider.php  # Passport configuration, routes, authorization view
│   └── routes/  api.php (portal)
├── routes/ai.php                              # Mcp::oauthRoutes(registration: false),
│                                              # register, authorize, token, /mcp
├── app/Domain/Devices/Services/    DeviceDirectory, DeviceHealth,
│                                   IngestionDiagnostics, Actions/RegisterDevice   # extracted
├── app/Domain/Automation/Services/ AlertQuery                                     # extracted
├── app/Domain/Dashboards/Services/ DashboardQuery, Actions/SaveDashboard          # extracted
├── app/Domain/DeviceProfiles/Services/ ProfileSectionWriter                       # extracted
├── app/Domain/Administration/…     OrganizationResource (capabilities),
│                                   OrganizationMembershipManager (revoke hook)
├── app/Domain/Authentication/…     PasswordRecoveryController (revoke hook)
├── config/agents.php, config/auth.php (mcp guard), config/mcp.php (redirect domains)
├── database/migrations/            Passport's published migrations; 2026_10_xx_create_agent_access.php
└── tests/
    ├── Feature/Agents/OAuth/        conformance suite
    ├── Feature/Agents/Tools/        one file per tool family
    ├── Feature/Agents/Isolation/    AgentIsolationTest, SecretScanTest
    └── Feature/Agents/Reviews/      apply, stale, idempotent, dependency order
apps/portal/src/
├── agents/ConnectPage.tsx           # /connect (outside the organization shell)
├── agents/AiAppsSettings.tsx        # Settings → AI apps
├── agents/ReviewPage.tsx            # /organizations/:org/agent-reviews/:group
└── agents/model.ts (+ .test.ts)
apps/portal/e2e/agents.spec.ts
packages/api-client/src/agents.ts
contracts/agents/tools.json          # generated
contracts/openapi/supplements/agents.yaml, contracts/openapi/openapi.json
docs/features/agents.md (new), docs/features/access.md, assistant.md,
docs/reference/api.md, docs/ops/ (enabling, egress), docs/roadmap.md, docs/dev/gotchas.md
```

**Structure Decision**: One new domain, `Domain/Agents`, owns sign-in, connections,
the MCP server, tools and proposals. It depends on the existing domains only through
their services, and the extracted query services and actions stay in their owning
domains, so no domain reaches into another's tables. The portal gets one feature
folder, `src/agents`.

## Delivery: phases as pull requests

The spec, this plan, the tasks and ADR-018 merge first, as one documents-only pull
request. The package upgrade (`chore/upgrade-laravel-packages`: `laravel/mcp` 1.0.2,
`laravel/ai` 1.2.1, `laravel/pao`, `laravel/pint`, `laravel/agent-detector`; lock file
only) merges before PR 1.

| # | Pull request | Stories / requirements | Depends on | Size |
| --- | --- | --- | --- | --- |
| 1 | **Foundation and switches.** `config/agents.php`; `laravel/mcp` into `require` and `laravel/passport` installed (migrations published, keys in bootstrap and release secrets); the agent migration (connections, activity, proposals and organization columns); models; `User` on Passport's `HasApiTokens` with the tests that signed in through Sanctum personal tokens moved to `actingAs`, and `PermissionSeeder` skipping the `mcp` guard; capabilities (`features.agent_access`, `agents`); `GET/PUT agent-access` with audit; **Settings → AI apps** with the switch and connector address (lists empty); `agents:prune` scheduled; `agents.yaml`, export, `src/agents.ts`. | US3 (switch); FR-001 to FR-003, FR-041 | — | M: ~900 lines, 2–3 days |
| 2 | **Sign-in.** Passport configuration (`mcp` guard over the `users` provider, `ignoreRoutes` with authorize and token re-registered, lifetimes, authorization view to the portal, guest redirect); `Mcp::oauthRoutes(registration: false)` with the rate-limited registration route and redirect domains; `RequireMcpResource`; the token controller subclass (connection check, reuse revokes); consent API (current, approve, deny) completing Passport's request; the `/connect` page with `return` handling; the conformance suite (from the spike); `/security-review` findings fixed; ADR-018 Accepted. | US1 (connect); FR-004 to FR-010, FR-012, FR-014 | 1 | M: ~900 lines, 3 days |
| 3 | **MCP endpoint and connections.** `AuthenticateAgent` (switches, membership, organization context, rate limit, last use); `AgentTool` base (levels, permissions, error translation, activity, bound); `PlatformServer` with instructions; `get_overview` and `find_devices` on `DeviceDirectory`; the catalogue export and CI check; connection lists (personal and administrator) with disconnect and activity `Sheet`; revocation hooks for member removal and password reset; the isolation harness and secret scan. | US1 (disconnect), US3; FR-011, FR-013, FR-015 to FR-018, FR-034 to FR-036 | 2 | L: ~1,400 lines, 4 days |
| 4 | **Read tools.** `DeviceHealth`, `IngestionDiagnostics`, `AlertQuery` (site filter), `DashboardQuery`, with controllers moved onto them and responses unchanged; tools for health, measurements, diagnostics, alerts, sites, profiles, adapters and dashboards, plus `get_authoring_guide`; the five fault scenarios; isolation entries. | US2; FR-019 to FR-025, FR-033 | 3 | L: ~1,300 lines, 4 days |
| 5 | **Proposals and the review page.** Groups and proposals; `ProposalService` (prepare, supersede, expire, apply in order, idempotency); `ProfileSectionWriter` extracted and used by `ProfileProposalService` (its tests unchanged); `prepare_profile_section`, `get_review_status`; review endpoints and page with the comparison view and a sticky bar. | US4 (profiles); FR-026, FR-028 to FR-030 | 3 | L: ~1,400 lines, 4 days |
| 6 | **Devices and decoders.** `RegisterDevice` extracted (`DeviceController::store` and `OnboardingController::store` call it); `prepare_device_registration` with `waiting_for` and the kit link; `test_decoder` (no persistence); `prepare_decoder_revision`. | US4 (devices, decoders); FR-026, FR-027, FR-032 | 5 | M: ~1,100 lines, 3 days |
| 7 | **Dashboards.** `DashboardDefinition` array entry point; `SaveDashboard` extracted; `prepare_dashboard` with `Device.view` on references; read-only preview on the review page with live data. | US5; FR-026 | 5 | M: ~800 lines, 2–3 days |
| 8 | **Close-out.** `docs/features/agents.md`; access, assistant and integrations cross-links; `docs/reference/api.md` route groups; operations notes (enabling, public reachability, egress range, pilot); roadmap and gotchas; the four-client release check and the onboarding timing recorded in the pull request; spec frozen. | SC-001, SC-002, SC-010 | 4–7 | S: ~400 lines, 1–2 days |

Pull requests 4, 5 and 7 can proceed in parallel after their dependencies. Pull
requests 1 to 3 give a working read-only connection; 1 to 4 is the first release
candidate (US1 to US3).

**Rebuilds per pull request**: `api` and `scheduler` (all PRs); `portal` (PRs 1, 2, 3,
5, 6, 7); `assistant-worker` (PR 5, for the shared profile writer); `adapter-worker`
with the adapter overlay (PR 6).

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Clients drop dynamic registration (deprecated in MCP 2026-07-28) before Passport or `laravel/mcp` support CIMD | New connections fail for that client | The four-client release check on every release touching `Domain/Agents`; CIMD can be added as a Passport client repository (owner decision 1). |
| Our glue around Passport weakens it (consent completion, guest redirect `return`, resource check) | Codes issued to the wrong person or client, or an open redirect | Passport still creates every code and token; the approve endpoint uses Passport's session retrieval and `auth_token`; `return` accepts only `{api}/oauth/authorize`; the conformance suite pins each rule; `/security-review` on PR 2; off by default; pilot first. |
| Passport and Sanctum share one trait name | A future change re-adds Sanctum's `HasApiTokens` to `User`, or adds a guard that the permission seeder duplicates | A test asserts `User` uses Passport's trait and that `PermissionSeeder` skips `mcp`; `docs/dev/gotchas.md` records both. |
| Passport keys lost or rotated | Every agent must connect again | Keys in the deployment secrets and backups; rotation documented as an operator action. |
| Consent phishing with a lookalike agent | A person grants access to a hostile app | "Self-declared" names, the return host shown first, the operator domain allowlist, administrator oversight and disconnect. |
| Prompt injection through device or third-party text | The agent is steered | No live actions exist; results label untrusted text; drafts need a person's review; the activity log shows what was read. |
| Spec 003 lands mid-way | Two ways to enter an organization | PR 3 enters the context like `ResolveOrganizationContext`. Whichever of PR 3 and spec 003 PR 2 merges second switches agent calls to `OrganizationContext::run()`, and spec 003 PR 3 lists agent tool calls as an entry point. |
| Extracting actions changes controller behaviour | Portal regressions | Each extraction keeps responses byte-identical. The existing feature tests and spec 001's response checks run unchanged. |
| Hosted Claude cannot reach on-premise deployments | US1 is unavailable to them | Documented: desktop and command-line agents on the same network still work. |
| Activity rows grow | Table bloat | Daily pruning (90 days default) and indexes on organization, connection and time. |
| Claude changes client behaviour | Connections break | Standards-only implementation; the four-client release check runs on every release that touches `Domain/Agents`. |

## Owner decisions (settled 2026-10-13)

The owner chose Passport. The proposed defaults below are adopted (research section 7,
"Settled owner decisions"). The pilot release is PRs 1 to 4.



1. **CIMD** (research D4). Proposed: wait for server-side support in `laravel/mcp` or
   Passport, and rely on dynamic registration meanwhile. Alternative: build a Passport
   client repository that resolves metadata-document client ids now, which needs an
   SSRF-safe fetcher.
2. **Activity retention.** Proposed: 90 days, configurable.
3. **Rate limits.** Proposed: 120 calls a minute and 2,000 an hour per connection.
4. **Device access in dashboard proposals.** Proposed: agent dashboard proposals need
   `Device.view` on every referenced device. The portal's dashboard save checks
   organization only; fix that separately, since it changes an existing endpoint.
5. **Removed members' portal sessions.** Removal now revokes agent connections, but
   portal sessions stay as today. Proposed: leave sessions to a separate change.
6. **Organization-specific connector addresses** (for example `/mcp/o/<slug>`, which
   would let hosted Claude hold connections to two organizations at once). Proposed:
   not now; revisit after the pilot.

## Complexity Tracking

No constitution violations.
