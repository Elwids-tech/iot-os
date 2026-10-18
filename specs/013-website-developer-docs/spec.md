# Feature Specification: Marketing Website and Developer Documentation

**Feature Branch**: `spec/013-website-developer-docs`

**Created**: 2026-10-17

**Status**: Draft

**Input**: "A proper marketing website targeting hardware engineers as well as product
engineers who want to build solutions on the IoT platform using the SDKs, and
documentation to get started with." Decisions: the platform is sold as a hosted
service, so the main call to action is to request a demo or talk to the team.
Self-hosting is not marketed. "IoT OS" is a working name, and no license has been
chosen yet. The new site replaces the company's current marketing site on its
existing domain, and keeps that site's business-buyer content (industry solutions and
the 30-day assessment offer) beside the two engineering audiences. The integration SDK
is published to the public npm registry under a permissive license chosen for the SDK
alone.

## Context

The company's current marketing site is written for operations, engineering and
finance leaders. It has industry solution pages, a 30-day assessment offer, a contact
form and an email address. It lists Modbus, OPC-UA and BACnet among supported
protocols, although the platform natively speaks only Sparkplug B and reaches vendor
MQTT devices through adapters ([ADR-005](../../docs/adr/ADR-005-sparkplug-b-boundary.md)).
It has no privacy notice.

There is no documentation for an outside engineer starting from zero:

- `docs/` is written for people who work on this repository (architecture, ADRs,
  operations) and links into the code.
- The in-product guides in `apps/api/resources/help` (27 guides with structured
  front matter) are written for portal users.
- The [public API contract](../../contracts/openapi/openapi.json) already fully
  describes the integration API (`/api/integration/v1`, 16 paths), the event envelope,
  every integration event type and the signed webhook delivery. None of its pending
  operations belong to the integration API.
- The [integration SDK](../../packages/integration-sdk/README.md) (0.5.0) is available
  only from the workspace or a local tarball. It has no license field and is not
  published to any package registry.
- Device onboarding already produces a connection kit (`device-config.json`, `ca.crt`,
  `quickstart.md`) ([devices](../../docs/features/devices.md#onboarding-a-sparkplug-device)).
  The repository also has Sparkplug and vendor-MQTT simulators and reference ESP-IDF
  firmware.
- Device adapters and AI agent access are switched off unless a deployment turns them
  on, so the hosted service might not offer them.

The repository is public. The site's source lives here, so the AGENTS.md rules apply
to it: no real hosts, credentials, or customer, prospect or pilot names.

**Terms**:
- *Site* means the public marketing pages.
- *Docs* means the public developer documentation.
- *Hosted service* means the platform as the company operates it for customers.
- *Generated reference* means pages built from a source in this repository: the API
  contract, the agent tool catalogue or the in-product guides.
- *Hand-written guide* means docs prose written for outsiders.
- *Site configuration* means the single place that holds the product name, company
  name, domains, portal and API addresses, broker host and contact address.
- *Hosted release record* means the commit the hosted service runs and its feature
  switches (adapters, agent access). The commit is kept out of the public
  repository, so nobody can diff it against newer fixes.
- *Inquiry* means a demo request, assessment request or question sent from the
  site.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluate the platform and request a demo (Priority: P1)

An engineering lead or an operations leader hears about the platform and opens the
site. In a few minutes
they understand what it does, how devices connect and how their own software would
build on it. They see that it is a hosted service, then request a demo from the page
they are on.

**Why this priority**: the site replaces the current one. It must not lose the
inquiries the current contact form brings in, and it is the minimum that can go live
on its own.

**Independent Test**: with only the marketing pages built, a tester reaches the demo
request from every page in one step and submits it. The team mailbox receives the
inquiry with the source page, and the tester sees a confirmation.

**Acceptance Scenarios**:

1. **Given** a visitor on the home page, **Then** it says what the platform does,
   who it is for (operations and business leaders, hardware engineers and product
   engineers) and that it is a hosted service. It links to a page for each audience,
   the industry solutions and the docs.
2. **Given** any page, **Then** a "Request a demo" action is visible without
   scrolling on desktop and reachable from the menu on a phone. Existing customers
   find a "Sign in" link to the portal.
3. **When** a visitor submits the demo form with name, work email, company, role and
   message, **Then** the team receives it with the page it came from. The visitor
   sees a confirmation saying who will reply and roughly when.
4. **Given** a business leader on a solution page or the assessment page, **Then**
   "Book an assessment" sits next to "Request a demo". It sends the same form with
   the assessment selected.
5. **Given** a capability named on a marketing page, **Then** it links to the docs
   page that describes it, or appears on the reviewed list of claims (FR-005).
6. **Given** the protocols section, **Then** it states that Sparkplug B is native,
   that vendor MQTT devices connect through adapters, and that other industrial
   protocols connect through a Sparkplug-capable edge gateway. It never presents them
   as native.

---

### User Story 2 - Connect a first device as a hardware engineer (Priority: P1)

A firmware engineer at a device maker has a hosted-service account. They follow
"Connect your first device" in the docs: register a direct device with a published
profile, download its connection kit and run the reference simulator. They watch the
birth appear, map and activate the device, and see good readings in the portal. Then
they move to their own hardware with the Sparkplug reference and the reference
firmware walkthrough.

**Why this priority**: hardware engineers are one of the two named audiences, and
nothing outside this repository explains what the platform expects from a device.

**Independent Test**: someone who did not build the platform follows only the docs
against a hosted or local stack and reaches stored good-quality readings for a
simulated device. Then they send one command and see it confirmed.

**Acceptance Scenarios**:

1. **Given** the hardware quickstart, **Then** it states its prerequisites (an
   account with `Device.manage`, a published profile, the simulator download and its
   runtime), lists the portal steps in order, and shows what success looks like at
   each step.
2. **Given** the Sparkplug reference, **Then** it states what the platform requires
   and rejects: the topic namespace, NBIRTH `seq = 0` and `bdSeq`, DBIRTH metrics and
   aliases, datatypes, rebirth requests, STATE, TLS and credentials, commands and
   their acknowledgement. It also explains why a command can end "uncertain". Each
   rule matches the runtime's behaviour, and the page links to the Eclipse
   specification.
3. **Given** a gateway with several downstream devices, **Then** a guide explains
   gateways, discovered sources and mapping one source to one device.
4. **Given** the reference firmware walkthrough, **Then** it explains how the
   example board connects, births its metrics and handles a command. It says this is
   an example, not a supported product.
5. **Given** adapters are on in the hosted service, **Then** a guide connects a
   simulated vendor MQTT device through an adapter with a sample decoder. If adapters
   are off, no docs page or marketing page mentions them.

---

### User Story 3 - Build a first integration as a product engineer (Priority: P1)

A developer building a fleet application on the platform follows "Build your first
integration". In the portal they create an application, grant devices and abilities,
and issue a token. Then they install the SDK, list devices, read latest telemetry,
follow the event feed from a checkpoint and verify a webhook signature. They use the
API reference for everything else.

**Why this priority**: product engineers are the second named audience. The API and
SDK exist, but their only documentation lives in internal docs and the SDK README.

**Independent Test**: someone who did not build the platform follows only the docs
and ends with a script that prints granted devices and their latest values, plus an
endpoint that accepts one verified webhook delivery.

**Acceptance Scenarios**:

1. **Given** the developer quickstart, **Then** it creates an application through
   **Connect → Integrations**, explains abilities, device grants and token expiry,
   and keeps the token on the server.
2. **Given** the API reference, **Then** it lists every integration API operation
   in the contract with its ability, parameters, response, errors, rate limits and an
   example. It does not publish the session-authenticated first-party API.
3. **Given** the events reference, **Then** it lists every integration event type,
   the envelope and each type's `data`. It explains cursors, checkpoints, at-least-once
   delivery and what a grant change does.
4. **Given** the webhook guide, **Then** it shows signature verification on the raw
   body. It shows this with the SDK and as language-neutral steps that a developer
   could implement in any language.
5. **Given** AI agent access is on in the hosted service, **Then** a guide connects
   Claude or another MCP client. It explains the Read and Read-and-drafts permissions
   and lists the agent tools from the tool catalogue.

---

### User Story 4 - Docs stay true to the hosted service (Priority: P2)

A platform engineer changes an integration API operation, an event type or an
in-product guide. When that change is released to the hosted service, the published
docs change with it. They change no earlier and no later, and nobody edits a second
copy.

**Why this priority**: the constitution says the code is the source of truth and
the platform never invents state. Docs that describe unreleased or removed behaviour
break the same promise.

**Independent Test**: change a field description in the contract and a sentence in a
help guide, release, and see both on the published docs. A build from a commit that
is not released does not publish them.

**Acceptance Scenarios**:

1. **Given** a hosted-service release, **Then** the published docs are built from
   that release's sources. Work merged but not yet released is not published.
2. **Given** a generated reference source that cannot be rendered, **Then** the build
   fails and the previously published docs stay up. A partial or stale reference is
   never published silently.
3. **Given** the runnable samples in the two quickstarts, **Then** the local device
   test suite runs them against the local stack. A pull request that touches them,
   the SDK or the integration API records that run, and CI checks every sample's
   syntax and types.
4. **Given** an in-product guide, **Then** the published page shows the same content
   and revision as the portal does.

---

### User Story 5 - Replace the current site safely (Priority: P2)

The team switches the existing domain to the new site. People following old links,
bookmarks and search results land on the closest new page. The contact address keeps
working, and the team can switch back if something goes wrong.

**Why this priority**: losing inbound links or inquiries during the switch would cost
leads, but it is a one-off operation once the site exists.

**Independent Test**: request every URL of the current site against the new site.
Each one answers with the page itself or a permanent redirect to its closest
equivalent.

**Acceptance Scenarios**:

1. **Given** a URL of the current site, **Then** it answers with its page, or
   redirects permanently to the closest new page. It never answers with an error.
2. **Given** an unknown URL, **Then** the site shows a helpful not-found page with
   navigation and search.
3. **Given** the switch, **Then** the previous site can be restored within one hour
   for 30 days.

### Edge Cases

- An inquiry can't be stored. The visitor sees an error that includes the contact
  email address.
- An inquiry is stored but its email delivery fails. The visitor has already seen
  the confirmation. The inquiry is retried and kept, never silently dropped.
- Bots flood the form. Submissions are rate-limited and filtered without asking
  people to solve puzzles. Rejected bot submissions never reach the team.
- A feature is switched off in the hosted service (adapters, agent access). Its docs
  pages and marketing claims are not published (FR-012).
- An operation or event type is removed in a release. It disappears from the
  reference in the same publish, and the changelog records the removal.
- An in-product guide links to a portal screen. On the public site the link opens the
  portal's sign-in, or appears as plain text naming the screen, never as a broken
  link.
- The hosted platform is down. The site and docs stay up, and the site stays
  independent of the platform in both directions (FR-021).
- JavaScript is off or blocked. All marketing and docs content is still readable.
  Only search and the form may need scripting, and the form then shows the email
  address.
- A signed-in customer reads the docs. Docs are not personalised. They explain
  where each value (organization slug, API address, token) is found in the portal.
- The SDK is not yet on npm when the site launches. The site can go live with the
  developer quickstart unpublished (FR-024), and the developer page then offers a
  demo instead of a quickstart link.

## Requirements *(mandatory)*

### Functional Requirements

**Site**

- **FR-001**: The site MUST have these pages:
  - a home page
  - a page for each audience: operations and business leaders, hardware engineers,
    and product engineers
  - the current site's industry solution pages and its 30-day assessment page,
    rewritten to meet FR-005
  - a "how it works" platform page
  - a security and tenancy page
  - a contact and demo page
  - a privacy notice
- **FR-002**: Every page MUST offer "Request a demo" and a "Sign in" link to the
  portal. Solution and assessment pages also offer "Book an assessment". The site
  MUST NOT offer self-service sign-up, market self-hosting, call the product open
  source or name a repository license.
- **FR-003**: The product name, company name, domains, portal and API addresses,
  broker host and contact address MUST come from the site configuration. Renaming the
  product MUST be one change, and a check MUST fail the build if a configured value
  is written literally elsewhere.
- **FR-004**: Real domains and addresses MUST be supplied at deploy time and MUST NOT
  be committed. Samples in the repository use `example.com` or `.test` hosts and
  documentation IP ranges.
- **FR-005**: Every capability claim on a marketing page MUST link to the docs page
  that describes it, or appear on a reviewed list of claims kept with the site. A
  check MUST fail the build for a claim that is neither. Outcome figures (savings,
  percentages) MUST NOT appear unless the list records their source.
- **FR-006**: The site and docs MUST NOT contain customer, prospect or pilot names,
  logos, quotes or figures derived from them.
- **FR-007**: The demo form MUST collect the request type (demo, assessment or
  question), name, work email, company, role (hardware, product or business) and
  message, with a notice that links to the privacy notice.
  It MUST deliver each inquiry to the team's configured address with the source page
  and time, confirm receipt to the visitor, rate-limit submissions and filter bots
  without puzzles.
- **FR-008**: The site and docs MUST NOT set tracking cookies or load third-party
  trackers. Any analytics MUST be aggregate and cookie-free, so no consent banner is
  needed.
- **FR-009**: Every page MUST meet WCAG 2.2 AA and work at phone width with no
  horizontal scrolling. It MUST follow the visitor's light or dark preference and use
  the product design system's colours and type, so the site and the portal look like
  one product.

**Docs**

- **FR-010**: The docs MUST have these sections:
  - Get started, with one quickstart for hardware and one for developers
  - Concepts: organizations, devices and profiles, sources and gateways, commands,
    alerts, automation and dashboards
  - Hardware reference: Sparkplug B, connection kits and adapters
  - Developer reference: the integration API, events, webhooks, the SDK and AI agents
  - User guides
  - Changelog

  Search MUST cover all of them.
- **FR-011**: The hardware and developer quickstarts MUST satisfy User Stories 2 and
  3. A downloadable reference simulator MUST let a hardware engineer complete the
  quickstart without hardware.
- **FR-012**: The docs and the site MUST describe only what the current hosted
  release offers. Pages for deployment-switched features (adapters, AI agent access)
  MUST be published only while the hosted service has them on.
- **FR-013**: The API reference MUST be generated from the public API contract of the
  release being published. It covers the integration API only, and every operation
  shows its abilities, rate limits, errors and examples.
- **FR-014**: The events reference and the webhook delivery reference MUST be
  generated from the same contract. The agent tools list MUST be generated from the
  agent tool catalogue (`contracts/agents/tools.json`).
- **FR-015**: User guides MUST be published from the in-product guides with their
  revision, and MUST NOT be copied into a second source.
- **FR-016**: The Sparkplug reference MUST state each requirement the runtime
  enforces and each message it rejects. The hardware guides MUST explain connection
  kits, TLS verification with the kit's CA, credentials per gateway and command
  acknowledgement.
- **FR-017**: The developer reference MUST explain abilities, device grants, token
  lifetime and rotation, rate limits with `Retry-After`, error meanings, and event
  feed cursors and checkpoints. It MUST also explain at-least-once delivery with
  deduplication by event ID, and webhook signature verification with language-neutral
  steps.
- **FR-018**: Runnable samples in the quickstarts and the SDK pages MUST run in the
  local device test suite against the local stack. A pull request that changes them,
  the SDK or the integration API MUST run that suite and record the result, and CI
  MUST check every sample's syntax and types.
- **FR-019**: The changelog MUST record each release's changes to the integration
  API version, event types and SDK versions.
- **FR-020**: Every docs page MUST offer a way to report a problem with that page.
  The report reaches the team with the page address.

**Publishing**

- **FR-021**: The site and docs MUST be published independently of the hosted
  platform. A site deploy cannot change the platform, and either can be down while
  the other stays up.
- **FR-022**: Publishing the docs MUST use the sources of the hosted release, and a
  failed build MUST leave the previous version online.
- **FR-023**: At the switch, every current-site URL MUST answer with its page or
  redirect permanently to its closest new page. The contact address MUST keep working, and the previous site MUST
  stay restorable within one hour for 30 days.
- **FR-024**: Before the developer quickstart is published, the integration SDK MUST
  be on the public npm registry under a permissive license (MIT or Apache-2.0) that
  covers the SDK package alone. Each release's changelog entry and published version
  MUST match the SDK docs.

### Key Entities

- **Site configuration**: product name, company name, marketing and docs domains,
  portal URL, API base URL, broker host, contact address and inquiry destination.
- **Hosted release record**: the hosted commit, held privately, and the hosted
  feature switches (adapters, agent access), committed.
- **Marketing page**: audience (business leaders, hardware engineers or product
  engineers), claims (each linked to a docs page or to the claims
  list) and calls to action.
- **Docs page**: section and source (hand-written, generated from the contract,
  generated from the tool catalogue, or published from an in-product guide), the
  release it was built from, and its last change.
- **Claims list**: reviewed capability statements and outcome figures with their
  source and reviewer.
- **Inquiry**: request type, name, work email, company, role, message, source page,
  received time and delivery status.
- **Redirect**: a current-site path and its new destination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two people who did not build the platform each complete the hardware
  quickstart within 30 minutes, using only the docs and the simulator, ending with
  stored good-quality readings and one confirmed command.
- **SC-002**: Two people who did not build the platform each complete the developer
  quickstart within 30 minutes, using only the docs, ending with listed devices,
  latest values and one verified webhook delivery.
- **SC-003**: For every published release, the API and events reference lists
  exactly the operations and event types in that release's contract. No published
  page describes an operation, event type or switched-off feature that the hosted
  service does not offer.
- **SC-004**: Every page passes an automated WCAG 2.2 AA scan with no serious or
  critical violations. Marketing pages show their main content within 2 seconds on a
  simulated mid-range phone on a 4G connection.
- **SC-005**: Every test demo, assessment and question inquiry reaches the team's
  address within 5 minutes, and the visitor sees confirmation. The demo request is one
  step away from every page.
- **SC-006**: At the switch, every URL of the current site answers with a page or a
  permanent redirect: zero not-found responses.
- **SC-007**: Changing the product name in the site configuration produces a build in
  which the old name appears nowhere. The literal-value, claims and name checks fail
  the build when a test violation is introduced.

## Assumptions

- The docs are public and need no sign-in. English only.
- Content changes go through pull requests to this repository. There is no blog, CMS
  or public pricing page; pricing is by conversation.
- Inquiries go by email to one configured team address. No CRM integration and no
  ticketing: the support ticket portal is a separate spec.
- The internal docs in `docs/` stay where they are and are not published. The public
  docs are new hand-written guides plus generated reference, and link to the portal,
  not to the repository.
- Sample code shown in the docs is offered for customers to copy, under terms stated
  on the docs site. This is independent of the repository's license, which is still
  undecided.
- The reference simulator becomes a downloadable, self-contained script with pinned
  dependencies. The reference firmware is presented as an example.
- The SDK's own license is chosen when it is first published and applies only to the
  SDK package. Publishing fixes a public package name, so the scope is chosen with the
  final brand in mind; renaming it later means deprecating the old package.
- The session-authenticated first-party API (`/api/v1`) is not published. Its pending
  response schemas therefore do not block this feature.
- The company supplies the privacy notice text. Engineering supplies only the
  description of what the form collects and where it goes.
- Which hosted-service features are switched on is recorded in the hosted release
  record at each release. It is not inferred from the repository's defaults.
