# Feature Specification: AI Agent Access

**Feature Branch**: `spec/004-ai-agent-access`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Let people connect AI agents (Claude.ai, Claude Desktop, Claude Code and other Model Context Protocol clients) to the platform through a remote MCP server, so they can onboard devices, troubleshoot and draft dashboards from the agent instead of clicking through the portal. Authentication must be smooth and happen in the portal: the user pastes one connector URL into their agent; the agent opens the portal's sign-in (reusing an existing portal session) and a consent screen where the user picks one organization and an access level (read only, or read plus drafts), approves, and returns to the agent — no copying tokens or client IDs (OAuth 2.1 authorization code with PKCE and dynamic client registration, as MCP clients expect). The portal gets a "Connected AI apps" page listing each connection (agent name, organization, access level, created, last used) with revoke; organization administrators can see and revoke members' connections and switch agent access off for the organization. Agent access is off by default per deployment. Tools act as the user: the user's current permissions intersected with the granted access level, re-checked on every call; removing a user from the organization or revoking the connection stops access immediately. Read tools: find devices, device health and freshness, recent measurements, ingestion diagnostics (decoder errors, dead letters), alerts. Draft tools create proposals a person reviews and applies in the portal: device-profile drafts, decoder tests against a sample payload, device registration drafts, dashboard drafts. Following constitution principle V, agents never publish, activate, deploy, send device commands or delete; those requests return a portal link instead. Tools never return secrets (MQTT credentials, integration tokens, webhook secrets); onboarding returns a portal link to reveal credentials. Every tool call is audited (user, organization, connection, tool, outcome). Must not change: Sanctum session login for the portal and admin, integration/v1 application tokens and abilities, the in-app assistant's behaviour, or any existing api/v1 endpoint. Delegated OAuth was deferred by ADR-008, so this needs a new ADR."

## Context

The portal already has an in-app assistant. It runs the platform's own model
configuration, is off by default, and works through tools that act with the
person's permissions and turn every write into a proposal the person reviews
([assistant](../../docs/features/assistant.md)). People increasingly work in their
own general-purpose AI agents, such as Claude, which can call the tools of any
service that speaks the Model Context Protocol. Connecting such an agent to the
platform lets a person set up and investigate devices in conversation: "why has the
boiler room sensor stopped reporting?", "prepare a profile from this datasheet",
"draft a dashboard for the north site".

Today an agent has no way in. The portal accepts only browser sessions, and the
integration API serves third-party applications with tokens an administrator
creates and copies by hand. That API is a different principal: an application with
its own grants, not a person ([integrations](../../docs/features/integrations.md)).
ADR-008 deferred delegated sign-in for third parties "until it becomes a real
requirement". This feature is that requirement.

Connecting must be as easy as signing in. A person adds one address to their
agent, approves in the portal, and is done. The platform remains the place where
anything that affects live devices or what other people see is reviewed and
committed (constitution principle V).

**Terms used in this spec**

- **Agent**: a third-party AI application that a person uses (for example Claude.ai,
  Claude Desktop or Claude Code) and that calls the platform's tools on that person's
  behalf.
- **Connector address**: the single address a person gives their agent to reach the
  platform.
- **Connection**: the person's approval for one agent to act for them in one
  organization at one access level. The portal shows connections under **Connected
  AI apps**.
- **Access level**: what a connection may do. **Read** investigates; **Read and
  drafts** also prepares changes.
- **Tool**: one operation an agent can call, such as finding devices or preparing a
  profile draft.
- **Proposal**: a prepared change that records the revision it was based on. A
  person reviews it in the portal and applies it, or it expires. The same kind of
  proposal the in-app assistant creates.
- **Live action**: anything that changes what devices do or what other people see:
  publishing, activating, deploying, sending device commands, deleting, and changing
  broker access, credentials, members or roles.
- **Organization administrator**: a member allowed to manage the organization's
  settings.
- **Operator**: whoever runs the deployment and sets its configuration.
- **Activity log**: the record of every tool call made through a connection.

## Clarifications

### Session 2026-10-12

- Q: How do changes an agent prepares reach the platform? → A: As proposals. The
  proposals an agent prepares for one task are grouped, and the member reviews and
  applies the group from one portal link. Constitution principle V stands unchanged.
- Q: Which agents may connect? → A: Any agent that speaks the protocol and registers
  itself. The consent screen marks its name as self-declared and shows its return
  address. An operator may restrict connections to listed return-address domains.
- Q: When the operator turns agent access on, what is each organization's starting
  state? → A: Off. An organization administrator switches it on.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect an agent from the portal in a minute, and disconnect it (Priority: P1)

A member opens **Connected AI apps** in the portal, copies the connector address and
adds it to their agent. The agent opens the portal in the browser. Because the member
is already signed in, the portal goes straight to a consent screen. The screen names
the agent and the address it will return to, and asks the member to pick an
organization and an access level. The member approves and is returned to the agent,
which can now call the platform's tools. The member never copies a token, a client
identifier or a secret. The new connection appears on **Connected AI apps**, where
the member can disconnect it at any time.

**Why this priority**: Every other story depends on a connection, and the connection
is the security boundary. It has to be easy, or people will not use it, and it has
to be revocable, or it must not ship. Even with a single read tool behind it, this
slice proves the whole loop with real agents.

**Independent Test**: With agent access enabled, connect Claude.ai, Claude Desktop,
Claude Code and a reference protocol client in turn. Each completes the flow without
any value typed or pasted except the connector address, lists its tools and calls
one. Disconnect one in the portal; its next call is refused, and the others keep
working.

**Acceptance Scenarios**:

1. **Given** a member signed in to the portal, **When** their agent starts a
   connection, **Then** the portal shows the consent screen without asking for the
   password again.
2. **Given** a person not signed in, **When** their agent starts a connection, **Then**
   the portal's normal sign-in page appears (with password recovery), and after
   sign-in the consent screen follows.
3. **Given** the consent screen, **When** it appears, **Then** it shows the agent's
   name with the domain that publishes it when the platform could verify that
   domain, or marked as self-declared otherwise, the address the agent will return to, the organizations the member may connect (preselected when there is
   only one), the two access levels with a plain description of each, and the fact
   that the agent acts with the member's own permissions.
4. **Given** the consent screen, **When** the member approves, **Then** they are returned
   to the agent, the agent can list its tools and call them, and the connection
   appears on **Connected AI apps** with the agent name, organization, access level,
   creation time and last use.
5. **Given** the consent screen, **When** the member declines or closes it, **Then**
   the agent is told that access was refused, and no connection exists.
6. **Given** a member of no organization with agent access, **When** their agent starts
   a connection, **Then** the portal explains why they cannot connect and who can
   turn agent access on, and no connection is created.
7. **Given** an existing connection, **When** the member disconnects it in the portal,
   **Then** the agent's next call is refused and tells the agent the connection was
   revoked. Reconnecting requires the full consent again.
8. **Given** an agent already connected to an organization, **When** the member
   connects the same agent to the same organization again, **Then** the existing
   connection is replaced with the newly chosen access level, not duplicated.
9. **Given** the connector address, **When** an agent calls a tool without a
   connection, **Then** it is told how to connect, and the call returns no data.

---

### User Story 2 - Troubleshoot devices from the agent (Priority: P2)

A member asks their agent why a device has stopped reporting, why a value looks
wrong or what is alarming at a site. The agent finds the devices, reads their
health, recent measurements, configuration state, ingestion diagnostics and alerts,
explains what it found and links to the right portal page for anything the member
should look at or do.

**Why this priority**: Troubleshooting is the most frequent reason to open the
portal, it needs only read access, and it carries no risk to devices. Together with
User Story 1 it is a useful first release.

**Independent Test**: With a read connection to a seeded organization, reproduce the
seeded fault scenarios (a device that stopped reporting, an announced metric that is
not mapped, a decoder that fails on a sample, a device latched in review required,
an open alert). For each one, the tools return the facts that identify the cause,
and each fact matches what the portal shows for the same device.

**Acceptance Scenarios**:

1. **Given** a read connection, **When** the agent searches devices by name, code,
   site, tag, profile or status, **Then** it receives only devices the member may
   view in the connected organization, page by page, each with a portal link.
2. **Given** a device the member may view, **When** the agent asks for its health,
   **Then** it receives the lifecycle state, presence, time of the last reading,
   freshness of each reported parameter, configuration state (draft, applied,
   failed, review required), its source and gateway or adapter, and the portal link.
3. **Given** a device parameter, **When** the agent asks for recent measurements,
   **Then** it receives the latest value and a history for a requested window within
   the same window and point limits the portal applies, with units and the reporting
   time zone.
4. **Given** a device or adapter that is not delivering data as expected, **When** the
   agent asks for ingestion diagnostics, **Then** it receives the facts the portal
   uses for the same diagnosis: last birth or discovery, announced metrics that are
   not mapped, type or constraint mismatches, rejected or preview-only samples,
   decoder failures of the deployed revision, and applied and connectivity state of
   the adapter.
5. **Given** a read connection, **When** the agent asks for alerts, **Then** it
   receives open alert episodes and recent alert history for a device, site or the
   organization, limited to what the member may view.
6. **Given** a device, site or alert the member may not view, or one of another
   organization, **When** the agent names it, **Then** the response is the same as for
   one that does not exist.
7. **Given** a request whose result would exceed the size limits, **When** the agent
   makes it, **Then** it receives a bounded result with a way to page or narrow it,
   never a truncated result presented as complete.

---

### User Story 3 - Organization administrators oversee agent access (Priority: P3)

An organization administrator sees every member's agent connections to their
organization, with recent activity, and can disconnect any of them. They can switch
agent access off for the whole organization, which stops every connection to it at
once. The operator decides whether the deployment offers agent access at all.

**Why this priority**: Customers will not allow agents into their organization
without control and visibility. This story is required before agent access is
offered to customers, but the first release can be piloted by the platform team
without it.

**Independent Test**: As an administrator of an organization with three members'
connections, list them, read one connection's activity, disconnect it, then switch
agent access off. All three connections stop at their next call, and the members'
**Connected AI apps** pages show why. Switch it back on: connections that were not
disconnected work again.

**Acceptance Scenarios**:

1. **Given** an organization administrator, **When** they open the organization's
   agent access settings, **Then** they see each connection to the organization with
   the member, agent, access level, creation time and last use, and can open its
   activity.
2. **Given** an organization administrator, **When** they disconnect a member's
   connection, **Then** it stops at its next call, the member sees that an
   administrator disconnected it, and the action is recorded.
3. **Given** an organization administrator, **When** they switch agent access off,
   **Then** every connection to the organization is refused from its next call with an
   explanation, the consent screen no longer offers the organization, and the change
   is recorded.
4. **Given** a member who is not an administrator, **When** they look at agent access,
   **Then** they see and manage only their own connections.
5. **Given** a deployment where the operator has not enabled agent access, **When**
   anyone looks for it, **Then** the portal shows no agent features, and the connector
   address answers only that agent access is not available.

---

### User Story 4 - Onboard devices with the agent preparing the work (Priority: P4)

A member gives the agent a datasheet, a sample payload or a description of a device.
With a **Read and drafts** connection, the agent prepares a device profile draft,
tests a decoder against the sample, and prepares the device's registration and
parameter mapping. The agent hands the member one review link for the task. The
member reviews the prepared changes together, applies them, and activates the device
in the portal. Connection credentials never pass
through the agent; the agent gives the member a portal link to collect them.

**Why this priority**: Onboarding is where an agent saves the most time, but it
writes, so it depends on the proposal flow and on the oversight in User Story 3.

**Independent Test**: From only a datasheet and a sample payload, an agent with a
**Read and drafts** connection produces a profile proposal, a decoder test result and
a device registration proposal. The member applies them in the portal, activates the
device, and it stores readings. At no point does any tool result contain a
credential.

**Acceptance Scenarios**:

1. **Given** a **Read and drafts** connection and permission to edit profiles, **When**
   the agent prepares a profile section, **Then** the platform validates it exactly as
   it validates a profile edit in the portal and returns the validation result and a
   review link.
2. **Given** an adapter revision and a sample payload, **When** the agent tests the
   decoder against it, **Then** it receives the decoded values or the decoder's
   errors, and nothing is stored or deployed.
3. **Given** a published profile and permission to manage devices, **When** the agent
   prepares a device registration with its source and mapping, **Then** the platform
   validates it as the portal would and returns a review link.
4. **Given** the changes an agent prepared for one task, **When** the member opens the
   review link, **Then** the portal shows every prepared change in the group with
   what will change, its validation result, and which agent prepared it and when, and
   lets the member apply the whole group, apply single changes, or discard them.
5. **Given** a group in which one change depends on a live action, such as a device
   registration that needs its profile published first, **When** the member reviews
   it, **Then** the dependent change says what it is waiting for and becomes
   applicable once the member has done it.
6. **Given** a prepared change whose base has changed since it was prepared, **When**
   the member tries to apply it, **Then** it cannot be applied, and the member is
   told to ask the agent for a new one.
7. **Given** any connection, **When** the agent is asked to publish a profile,
   activate a device, deploy an adapter or reveal credentials, **Then** no tool does
   it, and the agent receives the portal link where the member can do it.
8. **Given** a **Read** connection, **When** the agent tries to prepare a change,
   **Then** it is refused, with a note that the member can reconnect with **Read and
   drafts**.

---

### User Story 5 - Draft dashboards from the agent (Priority: P5)

A member asks the agent for a dashboard: "a page for the north site showing
temperatures, today's energy and open alerts". The agent looks at what the devices
report and prepares a dashboard, or a change to an existing one, from the platform's
own panel types. The member previews it in the portal and saves it.

**Why this priority**: Valuable and visible, but it is less frequent than
troubleshooting and onboarding, and it builds on the proposal review from User
Story 4.

**Independent Test**: For a seeded site, the agent prepares a dashboard proposal. The
portal preview renders every panel with live data, and saving produces a dashboard
identical to one built by hand with the same panels.

**Acceptance Scenarios**:

1. **Given** a **Read and drafts** connection and permission to create dashboards,
   **When** the agent prepares a new dashboard, **Then** every panel is checked
   against the platform's panel types and the devices' parameters, and the agent
   receives the validation result and a preview link.
2. **Given** an existing dashboard the member may edit, **When** the agent prepares a
   change to it, **Then** the proposal records the dashboard's revision, and it cannot
   be applied after the dashboard has changed.
3. **Given** the preview link, **When** the member opens it, **Then** the portal shows
   the dashboard with live data, and the member can save it, edit it further before
   saving, or discard it.
4. **Given** a saved dashboard prepared by an agent, **When** anyone views it, **Then**
   it behaves like any other dashboard, including its access and sharing settings,
   which the agent cannot set.

---

### Edge Cases

- **Membership or permission lost.** A member removed from the organization loses
  every connection to it. A member whose permissions shrink keeps the connection,
  but each tool call is decided by their permissions at that moment, so the reduced
  permissions apply from the next call.
- **Password reset or account removal.** Resetting a password disconnects all of the
  person's agents, as it already ends their sessions. Removing an account removes its
  connections.
- **Agent access switched off while an agent is working.** The next call is refused
  with an explanation that names who can switch it back on. Calls already answered
  are not undone.
- **Unused connections.** A connection unused for 90 days expires; the agent has to
  connect again.
- **Self-declared agent names.** Any application can call itself "Claude". The
  consent screen shows the publishing domain only when the platform verified it,
  marks other names as self-declared, and shows the return address, so a member can
  recognise a lookalike. The return address must be secure, or local to
  the member's own machine for desktop and command-line agents.
- **Intercepted approval.** An approval intercepted on its way back to the agent
  cannot be used by any other application.
- **Text that devices or third parties control.** Device names, payload strings,
  decoder output, alert messages and attributes reach the agent as data. The
  platform labels them as data, and no tool can perform a live action, so such text
  cannot trigger one.
- **Several organizations.** One connection covers one organization. A member who
  wants the same agent in two organizations makes two connections, and they appear
  separately.
- **Platform administrators.** Agents reach only organizations the person is a
  member of. Platform-level access to other organizations and the administration app
  are never available through an agent.
- **Busy agents.** Calls beyond a connection's rate limit are refused with the time to
  wait. Portal use by the same person is unaffected.
- **Stale or unused proposals.** Proposals expire when their base changes, when they
  are superseded, or after seven days. Expired proposals cannot be applied.
- **Same proposal applied twice.** Applying is idempotent: the second attempt reports
  that it was already applied.
- **Operator switches agent access off for the deployment.** Every connection is
  refused from the next call, and connections resume when it is switched on again,
  unless they expired or were revoked in the meantime.

## Requirements *(mandatory)*

### Functional Requirements

**Availability**

- **FR-001**: Agent access MUST be off for a deployment until the operator turns it
  on. While it is off, the portal MUST show no agent features, and the connector
  address MUST answer only that agent access is not available.
- **FR-002**: An organization administrator MUST be able to switch agent access on and
  off for their organization. Switching it off MUST refuse every connection to the
  organization from its next call and remove the organization from the consent
  screen. Agent access MUST start switched off for every organization, including
  organizations created after the operator turns it on.
- **FR-003**: Every change to agent access settings MUST be recorded with who made it
  and when.

**Connecting**

- **FR-004**: The portal MUST show the connector address with short instructions for
  Claude.ai, Claude Desktop, Claude Code and other protocol clients.
- **FR-005**: An agent MUST be able to complete a connection with nothing from the
  person except the connector address and their approval in the portal. The person
  MUST NOT copy or enter any token, client identifier or secret.
- **FR-006**: The platform MUST accept connections from any agent that speaks the
  protocol and registers itself, without the operator or the person registering it
  first. The operator MAY restrict connections to listed return-address domains;
  the platform MUST then refuse any other agent and say why.
- **FR-007**: The connection flow MUST reuse the person's portal session when there is
  one, and use the portal's normal sign-in otherwise.
- **FR-008**: The consent screen MUST show the agent's name with its publishing domain
  when the platform verified that domain, or marked as self-declared otherwise, the
  return address, the organizations the person may connect, the access
  levels with a plain description, and a statement that the agent acts with the
  person's own permissions. It MUST offer only organizations the person is a member
  of and that have agent access switched on.
- **FR-009**: Return addresses MUST be secure addresses, or addresses local to the
  person's machine. An approval MUST be usable only by the agent that requested it.
- **FR-010**: Approving MUST create one connection for the person, the agent and the
  chosen organization at the chosen access level. Approving again for the same agent
  and organization MUST replace that connection.

**Connections**

- **FR-011**: **Connected AI apps** MUST list the person's connections with the agent
  name, organization, access level, creation time, last use and recent activity, and
  let the person disconnect each one.
- **FR-012**: The credentials an agent holds MUST be short-lived and renewable by the
  agent without the person. A connection unused for 90 days MUST expire.
- **FR-013**: Disconnecting MUST take effect from the agent's next call. Removal from
  the organization, a password reset and account removal MUST disconnect the
  connections they affect.
- **FR-014**: Agent credentials MUST NOT authenticate any portal, administration or
  integration route, and portal sessions and integration tokens MUST NOT authenticate
  as an agent connection.

**Authorization**

- **FR-015**: Every tool call MUST be decided at the moment of the call from the
  person's current membership and permissions in the connected organization, limited
  further by the connection's access level, the organization's switch and the
  deployment's switch.
- **FR-016**: Every tool call MUST run within the connected organization only, with
  the same organization context as a portal request. A record of another
  organization, or one the person may not view, MUST produce the same response as one
  that does not exist.
- **FR-017**: A connection MUST NOT give access to organizations the person is not a
  member of, to platform-level permissions, or to the administration app.
- **FR-018**: When an agent lists tools, it MUST see only the tools its access level
  allows. A listed tool MUST still be refused when the person lacks the permission it
  needs.

**Read tools** (both access levels)

- **FR-019**: Agents MUST be able to find devices by name, code, site, tag, profile and
  status, page by page.
- **FR-020**: Agents MUST be able to read a device's health: lifecycle state,
  presence, last reading time, freshness per parameter, configuration state, and its
  source, gateway or adapter.
- **FR-021**: Agents MUST be able to read the latest value and the history of a device
  parameter, within window and point limits no wider than the portal's, with units
  and the device's reporting time zone.
- **FR-022**: Agents MUST be able to read ingestion diagnostics for a device or adapter:
  last birth or discovery, unmapped announced metrics, type and constraint mismatches,
  preview-only or rejected samples, decoder failures of the deployed revision, and
  adapter applied and connectivity state.
- **FR-023**: Agents MUST be able to read open alert episodes and alert history for a
  device, a site or the organization.
- **FR-024**: Agents MUST be able to read the organization's sites, published
  profiles, adapters and dashboards, as far as the person may view them.
- **FR-025**: Every record a tool returns MUST carry the portal link that opens it.

**Draft tools** (**Read and drafts** only)

- **FR-026**: Agents MUST be able to prepare device profile changes (identity,
  parameters, groups, calculations), device registrations with source and mapping,
  decoder revisions, and new or changed dashboards. The platform MUST validate each
  one as it validates the same change made in the portal and return the result.
- **FR-027**: Agents MUST be able to test a decoder revision against a sample payload
  without storing or deploying anything.
- **FR-028**: Prepared changes MUST become proposals and MUST NOT change any record
  until a person applies them in the portal. The proposals an agent prepares for one
  task MUST be grouped, and the agent MUST receive one review link for the group.
- **FR-029**: A proposal MUST record the revision it is based on, the connection and
  agent that prepared it, and its validation result. It MUST NOT be applicable once
  its base has changed, once superseded, or after seven days. Applying it MUST need the
  same permission as making the change by hand, and MUST be idempotent.
- **FR-030**: The review page MUST show, for every proposal in the group, what will
  change, its validation result, and which agent prepared it and when. It MUST let
  the person apply the whole group, apply single proposals or discard them. A
  proposal that depends on a live action MUST say so and become applicable once the
  action is done. Applying a group MUST apply proposals in dependency order and stop
  at the first that fails, reporting which were applied.

**Never through an agent**

- **FR-031**: Agents MUST NOT be able to publish, activate, deactivate, deploy, roll
  back, send device commands, delete or archive anything, or change broker access,
  credentials, members, roles, sharing or agent access settings. Where an agent needs
  one of these, the platform MUST give it the portal link where the person does it.
- **FR-032**: Tool results MUST NOT contain secrets: broker or device passwords,
  connection kits, private keys, integration tokens, webhook secrets or adapter source
  credentials. Onboarding results MUST link to the portal page where the person
  collects credentials.
- **FR-033**: Text that devices, adapters or third parties control MUST be returned as
  labelled data, and the platform MUST tell agents, in the guidance it gives them,
  that such text is data and never instructions.

**Activity and limits**

- **FR-034**: Every tool call MUST be recorded in the activity log with the time,
  person, organization, connection, agent, tool, the records it addressed, the outcome
  (answered, refused, failed) and the duration. Results MUST NOT be stored in it. The
  log MUST be kept for at least 90 days.
- **FR-035**: A person MUST be able to read the activity of their own connections, and
  an organization administrator the activity of every connection to the
  organization.
- **FR-036**: Each connection MUST be rate limited, independently of the person's
  portal use. Results MUST be bounded in size and offer paging or narrowing.

**Boundaries that must not change**

- **FR-037**: Portal and administration sign-in, sessions and their security MUST
  behave as today.
- **FR-038**: Integration applications, their tokens, abilities, event feed and
  webhooks MUST behave as today.
- **FR-039**: The in-app assistant MUST behave as today, including its own switch,
  budgets and proposals.
- **FR-040**: Every existing portal and administration endpoint MUST keep its current
  behaviour; this feature only adds endpoints and pages.
- **FR-041**: The platform MUST work fully with agent access off, which is the
  default.

### Key Entities

- **Agent registration**: an agent application known to the platform: its
  self-declared name, its return addresses and when it registered. Shared by all
  people who use that application.
- **Connection**: one person, one agent registration, one organization and one access
  level; created at approval; holds creation time, last use, expiry and, when
  revoked, who revoked it and why. Its credentials are stored only in a form that
  cannot be read back.
- **Organization agent access setting**: whether the organization allows agent
  connections, and who changed it when.
- **Tool**: a named operation with its access level, the permission it needs, its
  input limits, and whether it reads or prepares.
- **Activity record**: one tool call through one connection (see FR-034).
- **Proposal**: a prepared change and its base revision, validation result, preparing
  connection, state (open, applied, discarded, expired) and expiry. The same kind of
  proposal the in-app assistant creates, with the connection as its origin.
- **Proposal group**: the proposals an agent prepared for one task, opened from one
  review link.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member signed in to the portal connects a supported agent in under one
  minute, with at most three choices in the portal (organization, access level,
  approve) and nothing copied except the connector address.
- **SC-002**: Claude.ai, Claude Desktop, Claude Code and a reference protocol client
  each connect, list tools and call a tool in the release check, with no
  client-specific setup in the platform.
- **SC-003**: In automated tests, disconnecting, removing a member, resetting a
  password, switching the organization off and switching the deployment off each stop
  the next call, in every case.
- **SC-004**: For every tool, an automated check with two organizations and members of
  different permissions finds no result that includes another organization's data or
  data the member may not view.
- **SC-005**: An automated scan of every tool result in the test suite finds no seeded
  secret and no credential.
- **SC-006**: For each of five seeded fault scenarios (stopped reporting, unmapped
  metric, decoder failure, review required, open alert), the read tools return the
  facts that identify the cause.
- **SC-007**: 95% of read tool calls answer within two seconds at pilot data volumes.
- **SC-008**: Every tool call made in the test suite appears in the activity log with
  its outcome.
- **SC-009**: The existing portal, administration, integration and assistant test
  suites pass unchanged.
- **SC-010**: From a datasheet and a sample payload alone, a member onboards a new
  device type with an agent and activates a device in less time than through the
  portal alone, measured on the pilot's reference device.

## Assumptions

- Hosted agents such as Claude.ai reach the platform from the internet, so they work
  only with deployments reachable from it. Desktop and command-line agents on the
  same network as a private deployment can connect without that.
- The agent's model, and its cost, belong to the person's agent subscription. The
  platform runs no model for agent connections, so the in-app assistant's budgets do
  not apply. Rate limits protect the platform instead.
- Any member may connect an agent; the connection can never exceed their own
  permissions, and administrators can disconnect it or switch agent access off.
- Agents read documents themselves and pass the platform extracted text or sample
  payloads. The platform does not store files sent through agents.
- Dead letters are a platform-wide queue an operator handles with the runbook; they
  are not organization data, so tenant ingestion diagnostics cover the
  organization's own devices, samples, decoders and adapters instead.
- The organization context of [spec 003](../003-tenant-scoping/spec.md) applies to
  agent tool calls as one more entry point, alongside portal requests and in-app
  assistant tool calls.
- Dashboard proposals are checked by the same server-side panel validation the
  portal's dashboard editor uses. Agent proposals also require that the person may
  view every device a panel references.
- Adapter decoder tests are available only where tenant adapters are enabled.
- Delegated sign-in for agents is recorded in a new ADR that amends ADR-008. Machine
  tokens for integration applications stay as they are.
