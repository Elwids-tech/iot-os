# Feature Specification: Structural Tenant Scoping

**Feature Branch**: `spec/003-tenant-scoping`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Tenant isolation is enforced by convention: every controller method re-checks `organization_id` or a parent relationship by hand, membership and permissions are re-queried several times per request, team switching is duplicated, and policies are mostly unused. A single forgotten check would leak another organization's data. Outcome wanted: make organization scoping structural — resolved once per request, applied automatically to tenant-owned records and route bindings (so a record from another organization is indistinguishable from a missing one), with permissions resolved once and cached for the request; one place for team switching; the same scoping for HTTP requests, queued jobs, scheduled work and assistant tools acting for a user; and an automated test that walks every tenant route and proves another organization's records cannot be read or changed (including integration API applications and their abilities). Must not change any endpoint's successful behaviour for legitimate users, and must keep platform-admin (super admin) capabilities working explicitly rather than by bypass. Postgres row-level security is a possible later defence in depth — keep it out of scope unless research shows it's cheap, and note it."

## Context

An organization is the platform's tenant boundary. Today each endpoint keeps
organizations apart with checks its author wrote by hand. The research found
**no missing check**: all 165 records bound on 140 organization routes are verified.
But they are verified by 8 different mechanisms, alongside more than 120
hand-written organization filters. Records are looked up before membership is
checked, so a non-member can tell whether a record identifier exists. Permissions are
looked up again by every check, and the logic that runs a step "as organization X"
is copied into 9 places. Background work and the assistant repeat the checks by
hand. Super administrators pass through a blanket bypass, and integration event
types do not follow application abilities. The evidence and counts are in
[research.md](research.md).

This feature makes the organization boundary a property of the platform rather
than of each endpoint. It also adds an automated proof that the boundary holds on
every tenant route. Nothing a legitimate person or application can do successfully
today changes as a result.

**Terms used in this spec**

- **Organization**: the tenant boundary. Every tenant-owned record belongs to
  exactly one organization, directly or through a parent record.
- **Principal**: who is acting: a person, an integration application, or the
  platform itself (for platform-wide work).
- **Member**: a person who belongs to an organization. Their roles in that
  organization determine their permissions.
- **Platform administrator**: a person with platform-level permissions
  (organizations, permission ceilings, users, role templates, retention).
  **Super administrator** is the highest platform role.
- **Organization context**: the acting organization, the acting principal and that
  principal's resolved membership and permissions, established once for one request,
  one background job, one scheduled step or one assistant tool call.
- **Tenant route**: any route that addresses an organization's data: the portal
  routes under an organization, the organization administration routes, and the
  integration routes.
- **Shared data**: data that deliberately belongs to no organization (for example the
  unit catalogue, help articles and platform health) and is the same for everyone
  allowed to see it.
- **Platform-wide work**: work that legitimately spans organizations (for example
  runtime synchronisation, pruning and scans that pick up work for every
  organization). It must be declared as such.
- **Isolation check**: the automated proof described in User Story 1.

## Clarifications

### Session 2026-10-12

- Q: Should each integration event type require its matching read ability in the feed and in webhooks? → A: Yes. Alert events need alert read access, geofence events need geofence read access, and automation-triggered events need only feed access; webhooks filter the same way.
- Q: What may a super administrator do inside an organization they don't belong to? → A: Everything they can do today, through an explicit platform grant that is evaluated like any other permission and recorded; no bypass. Read-only access with elevation is later hardening.
- Q: Should a non-member of an existing organization get the same not-found response as for an organization that doesn't exist? → A: Yes. This replaces today's documented refusal for non-members.
- Q: Should the route walker also substitute other-organization identifiers into body and query reference fields? → A: Yes, for the path identifiers plus the reference fields that the published API contract declares for each route.
- Q: Should structural scoping be enforced as soon as it lands, or run first in a report-only mode? → A: Enforce as soon as it lands, guarded by the isolation check, the existing suite, and the listed and tested background work of SC-007.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every tenant route is proven to keep organizations apart (Priority: P1)

A platform maintainer or security reviewer runs one automated check. It finds every
tenant route on its own, including portal, organization administration and
integration routes. Using two organizations that each hold a record of every
tenant-owned kind, it proves that neither organization can read, list, change or
detect the other's records through any route.

**Why this priority**: This is the safety net the rest of the feature depends on.
It turns constitution principle III ("a change that touches tenant data MUST include
a test proving another organization cannot read or change it") from a per-change
habit into a standing guarantee, and it catches the "single forgotten check" that
motivates this feature. It also has value on its own: it can run against today's
system before anything else changes, and it then guards every later step.

**Independent Test**: Run the check against the current system. It passes apart
from two known gaps, which stay listed until User Story 2 closes them: the
low-severity existence signal recorded in research, and the non-member refusal that
FR-003 replaces with not found. Then remove one hand-written ownership check. The
check fails and names the affected route.

**Acceptance Scenarios**:

1. **Given** two organizations, A and B, each holding at least one record of every
   tenant-owned kind, **When** the check calls each tenant route of A, naming B's
   record wherever the route names a record (in the path, and in the body and query
   reference fields that the published API contract declares), **Then** every
   response is the same as the response for an identifier that does not exist, and
   none of B's records has changed.
2. **Given** a person who is a member of A only, **When** the check calls each tenant
   route of B, **Then** every call receives the same not-found response as a call
   for an organization that does not exist, nothing of B is returned, and nothing of
   B changes.
3. **Given** list, search, count and summary routes of A, **When** B holds records that
   would match the same filters, **Then** none of B's records appear in A's results
   or affect A's totals.
4. **Given** an integration application of A, **When** it calls B's integration routes,
   names a device of A it was not granted, or uses a token that lacks the route's
   ability, **Then** it receives "not found", "not found" and "forbidden"
   respectively, and no data is returned.
5. **Given** a tenant route that the check does not cover, **When** the check runs,
   **Then** it fails and names the route.
6. **Given** a route that serves shared data or performs platform-wide work, **When**
   the check runs, **Then** the route is skipped only if it appears in a reviewed
   exemption list together with the reason for the exemption.
7. **Given** any pull request, **When** continuous integration runs, **Then** the
   isolation check runs against the storage engine that production uses, and a
   failure blocks the merge.

---

### User Story 2 - Organization scoping is structural for every tenant request (Priority: P2)

A maintainer who adds or changes a tenant endpoint gets organization scoping
without writing it. The organization and the person's membership are established
once, at the start of the request and before any record is looked up. Every
tenant-owned record the request touches is confined to that organization, whether
it is named in the path, referenced in the body or found by a search. A record from
another organization behaves exactly like one that does not exist.

**Why this priority**: This removes the root cause: correctness no longer depends on
every author remembering every check. It needs the isolation check (Story 1) to
prove nothing regressed while hand-written checks are retired.

**Independent Test**: Add a test-only tenant endpoint that reads, lists and changes a
tenant-owned record without any hand-written organization or parent condition. The
isolation check passes for it, and the existing automated suite still passes
unchanged.

**Acceptance Scenarios**:

1. **Given** a member of A, **When** they request a record of B through one of A's
   routes, **Then** they receive the not-found response that a nonexistent
   identifier produces, whatever their permissions.
2. **Given** a person who is not a member of A, **When** they name an existing record
   in a route of A, then a random identifier in the same route, then the same route
   of an organization that does not exist, **Then** all three responses are the same
   not-found response. Today the first is refused and the others are not found, which
   reveals both that A exists and that the record exists somewhere.
3. **Given** a child record, such as a parameter of profile P1, **When** it is requested
   through a different parent (profile P2) in the same organization or in another
   one, **Then** it is not found.
4. **Given** a request body that references a device, site, role, member, profile,
   workflow or other record of B, **When** a member of A submits it to A's route,
   **Then** the response is the same as for a nonexistent reference, and nothing is
   created, linked or changed.
5. **Given** a client-chosen request identifier that B has already used, **When** A
   submits a request with it, **Then** the response does not reveal that another
   organization used it.
6. **Given** a request that creates a record, **When** it succeeds, **Then** the record
   belongs to the acting organization, whatever the request contains.
7. **Given** the organization administration routes (members, roles, invitations,
   organization settings), **When** they are called, **Then** they receive the same
   organization context and guarantees as every other tenant route.

---

### User Story 3 - Background work and assistant tools act within one organization (Priority: P3)

Queued jobs, worker loops, scheduled tasks and assistant tools that act for a
person or an integration application run in an explicit organization context. They
get the same confinement as a request. Work that spans organizations is declared as
platform-wide and processes each item within that item's own organization.

**Why this priority**: Assistant tools and workers do not pass through request entry
points: the assistant acts for a person without making a request of its own, and
workers loop over every organization's work. A leak here is as serious as one in a
request. This builds on the context introduced in Story 2.

**Independent Test**: For each kind of background work, run an item for A that refers
to a record of B (or whose acting person has lost access). It is refused without
side effects. Run tenant-touching work without an organization context; it refuses
to run.

**Acceptance Scenarios**:

1. **Given** an assistant conversation in A, **When** a tool is asked to read or
   propose changes to a device, geofence, profile or workflow of B, **Then** the tool
   reports it as not found, exactly as for a nonexistent one.
2. **Given** a worker that has just processed a job for B, **When** it processes a job
   for A, **Then** the job sees and changes only A's records, and nothing about B's
   context remains.
3. **Given** an automation that acts for the person who activated it, **When** that
   person has lost membership or the needed permission by the time it executes,
   **Then** the action is refused with no side effect, as today.
4. **Given** tenant-touching work that has no organization context and is not
   declared platform-wide, **When** it starts, **Then** it refuses to run and records
   why.
5. **Given** declared platform-wide work, **When** it processes items from several
   organizations, **Then** each item is handled within its own organization, and the
   declared list of platform-wide work can be listed and reviewed.

---

### User Story 4 - Integration applications see only their organization, their devices and the data they were granted (Priority: P4)

An integration developer's application reaches only its own organization, only
the devices it was granted, and only the kinds of data its abilities cover. This
applies to every integration route, to the event feed and to webhooks.

**Why this priority**: Integration applications are external parties, and their
abilities are the contract the organization agreed to share. Organization and
device confinement already hold. What changes is that event types now follow
abilities (FR-024).

**Independent Test**: Create applications with different combinations of abilities
and device grants, generate events of every type on granted and ungranted devices,
and read every integration route, the feed and the webhook deliveries for each
application.

**Acceptance Scenarios**:

1. **Given** an application of A, **When** it calls B's integration routes, **Then** it
   receives "not found".
2. **Given** a device of A that the application was not granted, **When** the
   application names it, **Then** it receives "not found", and the feed and webhooks
   never include its events.
3. **Given** an application that holds an ability but whose token does not, **When**
   it calls a route that needs that ability, **Then** it is forbidden.
4. **Given** an application with feed access and geofence read access but without
   alert read access, **When** alert, geofence and automation events occur on its
   granted devices, **Then** its feed delivers the geofence and automation events
   and never the alert events.
5. **Given** a webhook application with feed and alert read access but without
   geofence read access, **When** geofence events occur on its granted devices,
   **Then** no webhook delivery is created for them, and a delivery that is already
   pending for such an event is cancelled before it is sent.
6. **Given** an application whose grants change, **When** it reads the feed with an
   earlier position, **Then** it is told to rebuild from a fresh position, as today.
7. **Given** an integration credential, **When** it is presented to a portal route,
   **Then** it does not authenticate, as today.

---

### User Story 5 - Permissions are decided once per request, from one place (Priority: P5)

During each request or job, the platform establishes a principal's membership and
permissions in an organization once, and every authorization decision in that
request or job reuses them. One mechanism performs any step "as organization X".
Decisions are the same as today's.

**Why this priority**: Repeated lookups cost time on every request and drift apart:
the seven copies on the request path already differ in detail. One decision point is
also what makes Stories 2 and 3 consistent. Only legitimate users notice this
story, and only through speed, so it ranks below the confinement stories.

**Independent Test**: Count authorization lookups per request across the existing
automated suite, and compare every response before and after.

**Acceptance Scenarios**:

1. **Given** a request that needs several permissions (activating an adapter
   candidate needs manage, activate and manage-connections), **When** it runs,
   **Then** the person's membership and permissions in that organization are looked
   up once.
2. **Given** a person whose role is changed or revoked, **When** they make their next
   request, **Then** the new permissions apply.
3. **Given** the existing automated suite, **When** it runs, **Then** every request
   receives the same allow or deny outcome as before, except for the outcomes this
   spec changes explicitly.
4. **Given** a person who belongs to many organizations, **When** they sign in and
   their organizations' capabilities are listed, **Then** each organization costs at
   most one resolution.
5. **Given** any step that runs "as organization X" (in a request, a job, an
   administration task or seeding), **When** it finishes or fails, **Then** one shared
   mechanism performed it, and the previous organization state is restored.
6. **Given** one tenant record kind reached through a request, a queued job and an
   assistant tool, **When** the same principal attempts the same action, **Then** the
   same single rule decides it in all three.

---

### User Story 6 - Platform administrators act through explicit grants (Priority: P6)

Platform administrators keep every capability they have today. Where that includes
acting inside an organization they do not belong to, the capability comes from an
explicit platform grant, evaluated by the same decision point as every other
permission, and recognisable as platform access, rather than from a blanket bypass.

**Why this priority**: The blanket bypass hides cross-organization access. It also
lets tests that act as a super administrator skip the very checks they should
exercise. It changes no visible behaviour, so it comes last.

**Independent Test**: Run every platform administrator journey (organizations,
permission ceilings, users, invitations, role templates, platform team, retention,
and opening an organization from the portal). They behave exactly as today.
Remove the explicit grant from a test account, and its access to organizations it
does not belong to is gone.

**Acceptance Scenarios**:

1. **Given** a super administrator, **When** they open an organization they do not
   belong to, **Then** they can do everything they can do today, and each decision
   that relies on their platform grant is recorded.
2. **Given** a platform administrator who may manage organizations but is not a super
   administrator, **When** they manage an organization's members, roles and
   invitations, **Then** it works as today.
3. **Given** a platform administrator acting inside an organization they do not
   belong to, **When** the action is authorized, **Then** it is recorded as platform
   access, so cross-organization access is never silent.
4. **Given** a person whose platform grant has been removed, **When** they try to act
   in an organization they do not belong to, **Then** they are refused.

---

### Edge Cases

- **Foreign record in the path.** Same response as a nonexistent identifier: same
  status, same error body, no side effect and no audit entry that names the foreign
  record. Non-members receive the not-found response of an organization that does
  not exist, so a request reveals neither whether the organization exists nor
  whether a record exists in any organization. A member who lacks a permission is
  still refused, as today.
- **Child under the wrong parent.** A child named through a parent it does not
  belong to is not found, even when both are in the acting organization.
- **Partly foreign reference lists.** A list of references with some foreign or
  unknown entries is rejected as a whole, as if those entries did not exist. Nothing
  is applied partially.
- **Client-chosen request identifiers.** Identifiers that make retries safe
  (idempotency keys) never reveal whether another organization used the same value.
- **Shared data and platform-level records.** Shared data stays readable as today.
  Platform-level records that belong to no organization (for example platform-level
  device profiles or platform notifications) stay invisible to tenant routes unless a
  route is declared to serve them.
- **Deleted organization.** Its routes are not found for everyone, members included,
  as today.
- **A person in several organizations.** The organization comes from the route, and a
  request never mixes organizations. Routes that summarise several organizations
  (signing in, the notification centre) evaluate each organization with its own
  context.
- **Access lost during a session or a long run.** A membership or role change applies
  from the next request. For a long assistant run it applies from the next tool call,
  and for queued work at execution time.
- **Acting person deleted or demoted.** Work that acts for them is refused at
  execution, as today.
- **Runtime-reported identities.** Events the runtime reports name organizations and
  records. They are matched against stored relationships, never trusted alone, as
  today. A mismatch is an unknown reference.
- **Malformed identifiers.** These are not found before any lookup, as today.
- **A super administrator who is also a member.** Inside organizations they belong
  to, their member roles apply as for anyone else, and only decisions their roles
  would deny rely on the platform grant and are recorded (FR-027, FR-028).
- **Integration application revoked or regranted while reading.** The next call is
  refused or told to rebuild from a fresh position, as today.
- **Events from before the ability filter.** Once the filter is in place, it applies
  to everything an application reads, including events recorded earlier. A reader
  that resumes from an earlier position skips the types it may not read.

## Requirements *(mandatory)*

### Functional Requirements

**Organization context**

- **FR-001**: Every tenant route MUST establish exactly one acting organization and
  one acting principal before it looks up any tenant record named in the request.
  The organization comes from the route together with the authenticated session or
  credential, never from the request body.
- **FR-002**: The organization context MUST be established in one place for each kind
  of entry point: portal request, organization administration request, integration
  request, queued job, worker step, scheduled step and assistant tool call. Every
  tenant route MUST be covered, including the organization administration routes that
  check membership themselves today.
- **FR-003**: Membership MUST be confirmed before any record named in the request is
  looked up and before any permission is evaluated. A person who is not a member of
  an existing organization MUST receive the same not-found response as for an
  organization that does not exist, whatever records the request names. This applies
  to the portal, organization administration and integration routes alike. It
  replaces the refusal that the access documentation describes today; platform
  access under FR-027 is the only exception.
- **FR-004**: Work that reads or changes tenant-owned records without an organization
  context MUST refuse to run, unless it is declared platform-wide (FR-021).

**Records and references**

- **FR-005**: Tenant-owned records MUST be confined to the acting organization
  automatically, for reading, listing, searching, counting, creating, changing and
  deleting, without each endpoint stating the condition.
- **FR-006**: A record that belongs to another organization and is named in a request
  path MUST produce the same response as an identifier that does not exist: the same
  status, the same error body, no side effect and no record of the foreign
  identifier in audit or activity data.
- **FR-007**: A record that belongs to a parent (for example a profile's parameter, a
  device's command, an adapter's credential or a conversation's run) MUST be resolved
  only within that parent. Named through any other parent, it is not found.
- **FR-008**: Records referenced in request bodies or query parameters, as single
  references or lists, that belong to another organization MUST be treated as
  nonexistent. They produce the same response that the field gives for a nonexistent
  reference, and the request applies nothing.
- **FR-009**: Client-chosen request identifiers MUST NOT reveal whether another
  organization has used the same identifier.
- **FR-010**: Lists, searches, counts, summaries and exports MUST never include, or be
  influenced by, another organization's records.
- **FR-011**: Every record kind MUST be either tenant-owned (the default) or explicitly
  declared shared. Platform-level records that belong to no organization MUST NOT be
  visible through tenant routes unless a route is declared to serve them.
- **FR-012**: A record created in an organization context MUST belong to the acting
  organization. No request may create a record in, or move a record to, another
  organization.

**Permissions**

- **FR-013**: The acting principal's membership, roles and permissions in the acting
  organization MUST be resolved at most once per request, job, scheduled step or
  assistant tool call, and reused by every authorization decision within it.
- **FR-014**: For every route and every principal, authorization outcomes MUST be the
  same as today, except for the changes this spec makes explicitly: the not-found
  responses of FR-003, FR-006, FR-008 and FR-009, platform access under FR-026 and
  FR-027, and event delivery under FR-024.
- **FR-015**: A change to a person's membership, roles or permissions MUST take effect
  no later than their next request, the next execution of queued work, or the next
  assistant tool call. A resolved permission set MUST NOT outlive the request, job,
  step or tool call it was resolved for.
- **FR-016**: One mechanism MUST be used whenever code performs a step "as
  organization X", including administration, maintenance and seeding code. It MUST
  always restore the previous state, including when the step fails.
- **FR-017**: The authorization rules for each tenant record kind MUST be defined once
  and used by requests, background work and assistant tools alike. Dormant rules that
  nothing invokes today MUST be either adopted as that single definition or removed.

**Background work, scheduled work and the assistant**

- **FR-018**: Every queued job, worker step, scheduled step and assistant tool call
  that reads or changes tenant data MUST run in an explicit organization context, on
  behalf of an explicit principal (a person, an integration application or the
  platform) that is recorded when the work is created.
- **FR-019**: Work that acts for a person or an application MUST re-establish that
  principal's access when it executes, not only when it is created. If the access has
  been lost, the work stops without side effects, as today.
- **FR-020**: Assistant tools MUST be confined exactly like the person they act for,
  and MUST NOT reach tenant data through any path that skips the organization
  context.
- **FR-021**: Platform-wide work MUST be declared explicitly. This covers runtime
  synchronisation and the events the runtime reports, scheduled pruning and recovery,
  worker scans that pick up work for every organization, and operations metrics. The
  declarations MUST be listable, and each declared item MUST be tested to show that
  it handles every organization's items within that organization.
- **FR-022**: A worker MUST NOT carry any part of one job's organization context
  into the next job it processes.

**Integration applications**

- **FR-023**: Integration requests MUST be confined to the application's own
  organization, its granted devices, and the abilities that both the application and
  its token hold. Another organization or an ungranted device is "not found"; a
  missing ability is "forbidden" (as today).
- **FR-024**: The event feed and webhooks MUST deliver an event to an application only
  when it concerns one of the application's granted devices and the application holds
  the read ability for the event's type. Alert events need alert read access,
  geofence events need geofence read access, and automation-triggered events need
  only feed access. An event type added later MUST declare its required ability
  before it can be delivered. The conditions for reaching the feed and configuring a
  webhook stay as today. Skipped events advance the reader's position like other
  skipped events. A webhook delivery that no longer qualifies is cancelled before it
  is sent. This changes documented integration behaviour, so the integration
  documentation and the event reference MUST change with it.
- **FR-025**: Integration credentials MUST NOT authenticate portal routes, and portal
  sessions MUST NOT authenticate integration routes (as today).

**Platform administration**

- **FR-026**: Platform administrators MUST keep every platform capability they have
  today: organizations and their permission ceilings, users, invitations, role
  templates, the platform team and telemetry retention. These capabilities come from
  explicit platform permissions evaluated by the same decision point as tenant
  permissions, not from a blanket bypass of membership and permission checks.
- **FR-027**: In an organization they do not belong to, a super administrator MUST be
  able to do everything they can do today, including changes and device commands.
  This access MUST come from an explicit platform grant, held by super administrators
  and evaluated by the same decision point as every other permission, not from a
  bypass. Removing the grant removes the access. A super administrator who is a
  member of an organization acts there with their member roles as well, and the
  grant applies only where those roles fall short.
- **FR-028**: Every authorization decision that relies on platform access inside an
  organization MUST be recorded, with the person, the organization, the action and
  when it happened, so that cross-organization access is never silent. Reads are
  recorded at most once per request.

**Isolation check**

- **FR-029**: An automated isolation check MUST enumerate every tenant route from the
  running system's own route list, not from a hand-maintained list. For each route
  and method, using two organizations, it MUST prove that:
  - another organization's records named in the path give the same response as
    nonexistent identifiers;
  - non-members get the same not-found response as for an organization that does
    not exist, whatever the request names;
  - no record of the other organization appears in the response or changes;
  - for integration routes, an application of the other organization, a token that
    lacks the route's ability, and an ungranted device are each handled as FR-023
    requires.
- **FR-030**: The isolation check MUST also substitute another organization's records
  into the request-body and query reference fields that the published API contract
  declares for each route, and prove FR-008 for them.
- **FR-031**: A tenant route that the check does not cover MUST make the check fail and
  name the route. Exemptions (shared data, platform-wide work) MUST be listed in one
  reviewed place, each with its reason.
- **FR-032**: The isolation check MUST run in continuous integration, against the same
  storage engine that production uses.
- **FR-033**: The isolation check MUST be shown to detect regressions. Removing the
  scoping of any one tenant record kind, or the organization context of any one
  entry point, MUST make it fail.

**Compatibility**

- **FR-034**: For every legitimate principal and every endpoint, successful responses
  (status, body and side effects) MUST be unchanged. Existing automated tests MUST
  pass unchanged, except those that assert behaviour this spec changes explicitly
  (FR-014).
- **FR-035**: Where an error response changes, the published API description, the
  client package and the access and integration documentation MUST change in the same
  pull request (constitution principle IV).

### Key Entities

- **Organization**: the tenant boundary. A deleted organization, even one that can
  still be restored, has no reachable routes.
- **Principal**: a person, an integration application or the platform. Every request
  and every piece of work has exactly one.
- **Membership**: links a person to an organization, carrying their roles there.
- **Organization context**: the acting organization, principal and resolved
  permission set. It lives for one request, job, scheduled step or assistant tool
  call.
- **Permission set**: the principal's permissions in one organization, within that
  organization's permission ceiling. It is resolved once per context.
- **Tenant-owned record**: any record that belongs to an organization, directly or
  through a parent record.
- **Shared data**: record kinds declared to belong to no organization.
- **Platform-wide work declaration**: a named piece of work that may span
  organizations, with its reason.
- **Platform grant**: an explicit platform permission, including any capability to
  act inside organizations a person does not belong to.
- **Integration application**: belongs to one organization; holds abilities and
  device grants and has at most one active token, whose abilities are a subset of
  the application's.
- **Integration event**: an entry in an organization's ordered event journal, with a
  type and a device. It is delivered through the feed and webhooks.
- **Isolation exemption**: a tenant-shaped route that the isolation check skips, with
  its reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The isolation check covers 100% of tenant routes (216 when this spec was
  written: 198 portal and organization administration routes and 18 integration
  routes). A change that adds an uncovered tenant route cannot merge.
- **SC-002**: On every covered route, naming another organization's record gives a
  response with the same status and error body as a nonexistent identifier: zero
  differences, for members and for non-members.
- **SC-003**: Deliberately removing the scoping of any one tenant record kind, or the
  organization context of any one entry point, is caught by the isolation check in
  every trial, with at least one trial for each record kind and each kind of entry
  point.
- **SC-004**: Each request, job, scheduled step or tool call resolves a principal's
  membership and permissions at most once per organization. Activating an adapter
  candidate goes from 3 resolutions to 1, and reading a single device needs at most
  half the authorization lookups it needs today.
- **SC-005**: No successful response changes. Every success-path assertion in the
  existing automated suite passes unchanged, and the published API description shows
  no change to any success response.
- **SC-006**: A new tenant endpoint written without any hand-written organization or
  parent condition passes the isolation check, as the sample endpoint of Story 2
  demonstrates.
- **SC-007**: Every kind of background work, worker loop, scheduled task and assistant
  tool that touches tenant data is listed with its organization context and
  principal, and 100% of them have a test proving that they cannot act on another
  organization's record.
- **SC-008**: Exactly one mechanism runs a step "as organization X", down from 9
  separate implementations in application code.
- **SC-009**: Every platform administrator journey listed in Story 6 succeeds as
  today, with zero regressions in the platform administration routes. 100% of
  decisions that rely on the platform grant inside an organization are recorded.
- **SC-010**: Across every combination of integration abilities, the feed and webhooks
  deliver zero events of a type whose read ability the application lacks, and every
  event the application may read for its granted devices.
- **SC-011**: For non-members, every tenant route returns a response
  indistinguishable from the response for an organization that does not exist.

## Assumptions

- **Baseline.** The behaviour and counts in this spec come from
  [research.md](research.md) at `main` `51b1604`. No missing check was found, so this
  feature prevents future leaks rather than fixing a known one.
- **Permission model unchanged.** Role names, permission names, the organization
  permission ceiling and the "no escalation" rules stay as they are. The two existing
  permission families for workflows (device permissions for earlier workflows,
  workflow permissions for automation graphs) are kept, not unified.
- **"Identical" means status and error body.** Differences in response timing are out
  of scope.
- **Body references.** The isolation check proves body and query references for the
  fields the published API contract declares (FR-030). Fields it does not declare are
  covered by the same structural confinement and by domain tests.
- **Rollout.** Structural scoping is enforced as soon as it lands, with no report-only
  phase. The isolation check, the existing suite, and the listed and tested background
  work of SC-007 guard it. A legitimate request never names another organization's
  records, so only cross-organization requests are newly refused.
- **Documented behaviour that changes.** Non-members now receive not found instead
  of a refusal (FR-003). `docs/features/access.md` and the published API description
  change with it. Event delivery now follows abilities (FR-024), so
  `docs/features/integrations.md` and the event reference change with it.
- **Hand-written checks.** Duplicated organization and parent checks may be removed
  where structural confinement covers them. Business rules (states, revisions, limits)
  stay.
- **Platform-wide work is limited to what exists.** That is the list in research
  section 10, plus platform administration routes, signing in and the notification
  centre. Adding to the list requires a declaration with a reason.
- **Out of scope.**
  - Database-level row security, a possible later defence in depth that could reuse
    the organization context. It is not cheap today (research section 9.6).
  - Enforcement inside the runtime's own read interfaces. The control plane addresses
    runtime reads only with identifiers it has already confined to the organization,
    and passes the organization itself on telemetry, location and capture reads.
  - Broker and adapter-runtime isolation, which separate specs and ADRs cover.
  - User interface changes and new audit screens.
  - Restructuring module boundaries, such as endpoint logic calling other endpoint
    logic or assistant tools composing requests. That is a separate roadmap item;
    FR-020 only requires that such paths stay confined.
  - New integration abilities, except event delivery under FR-024.
  - Read-only access for super administrators with explicit elevation for changes,
    which is later hardening on top of the explicit grant.
- **Dependencies.** The published API contract from spec 001 supplies request shapes
  and reference fields to the isolation check. Continuous integration already runs
  the suite on the production storage engine.
