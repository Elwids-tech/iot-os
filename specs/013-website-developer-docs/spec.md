# Feature Specification: Developer Documentation and SDK Publishing

**Feature Branch**: `spec/013-website-developer-docs` (rescoped on `spec/013-rescope-developer-docs`)

**Created**: 2026-10-17

**Revised**: 2026-10-18. The marketing website moved to its own repository
([ADR-021](../../docs/adr/ADR-021-developer-docs-only.md)). This spec now covers only
the public developer docs and publishing the integration SDK. No implementation had
started. The folder keeps its name because ADR-020 links to it.

**Status**: Draft

**Input**: "A proper marketing website targeting hardware engineers as well as product
engineers who want to build solutions on the IoT platform using the SDKs, and
documentation to get started with." Later decisions:
- The platform is sold as a hosted service, and self-hosting is not documented.
- "IoT OS" is a working name, and no repository license has been chosen yet.
- The marketing website replaces the company's current site from a separate, private
  repository. It links to these docs.
- The developer docs stay in this repository, because they are generated from it.
- The integration SDK is published to the public npm registry under a permissive
  license chosen for the SDK alone.

## Context

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

The marketing website will position the company around the industries it builds
solutions for. Its claims about the platform need somewhere to point that is true
today; these docs are that place.

The repository is public, so the AGENTS.md rules apply to the docs: no real hosts,
credentials, or customer, prospect or pilot names.

**Terms**:
- *Docs* means the public developer documentation.
- *Marketing site* means the company website, maintained in its own repository.
- *Hosted service* means the platform as the company operates it for customers.
- *Generated reference* means pages built from a source in this repository: the API
  contract, the agent tool catalogue or the in-product guides.
- *Hand-written guide* means docs prose written for outsiders.
- *Docs configuration* means the single place that holds the product name, company
  name, the docs, marketing-site, portal and API addresses, and the broker host.
- *Hosted release record* means the commit the hosted service runs and its feature
  switches (adapters, agent access). The commit is kept out of the public
  repository, so nobody can diff it against newer fixes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a first device as a hardware engineer (Priority: P1)

A firmware engineer at a device maker has a hosted-service account. They follow
"Connect your first device" in the docs: register a device, download its connection
kit and run the reference simulator. They watch the birth appear, onboard the
simulated devices, and see good readings in the portal. Then they move to their own
hardware with the Sparkplug reference and the reference firmware walkthrough.

**Why this priority**: hardware engineers are one of the two audiences, and nothing
outside this repository explains what the platform expects from a device.

**Independent Test**: someone who did not build the platform follows only the docs
against a hosted or local stack and reaches stored good-quality readings for a
simulated device. Then they send one command and see it confirmed.

**Acceptance Scenarios**:

1. **Given** the hardware quickstart, **Then** it states its prerequisites (an
   account with `Device.manage`, the starter profiles, the simulator download and its
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
   are off, no docs page mentions them.

---

### User Story 2 - Build a first integration as a product engineer (Priority: P1)

A developer building an application on the platform follows "Build your first
integration". In the portal they create an application, grant devices and abilities,
and issue a token. Then they install the SDK, list devices, read latest telemetry,
follow the event feed from a checkpoint and verify a webhook signature. They use the
API reference for everything else.

**Why this priority**: product engineers are the second audience. The API and SDK
exist, but their only documentation lives in internal docs and the SDK README.

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
6. **Given** the SDK, **Then** it installs from the public npm registry as the
   quickstart says, under a license stated in the package.

---

### User Story 3 - Docs stay true to the hosted service (Priority: P2)

A platform engineer changes an integration API operation, an event type or an
in-product guide. When that change is released to the hosted service, the published
docs change with it. They change no earlier and no later, and nobody edits a second
copy.

**Why this priority**: the constitution says the code is the source of truth and
the platform never invents state. Docs that describe unreleased or removed behaviour
break the same promise, and the marketing site relies on these docs to back its
claims.

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

### Edge Cases

- A feature is switched off in the hosted service (adapters, agent access). Its docs
  pages are not published, and no published page links to them (FR-006).
- An operation or event type is removed in a release. It disappears from the
  reference in the same publish, and the changelog records the removal.
- An in-product guide links to a portal screen. On the public docs the link opens the
  portal's sign-in, or appears as plain text naming the screen, never as a broken
  link.
- The hosted platform is down. The docs stay up, and a docs deploy can't affect the
  platform (FR-018).
- The marketing site is down. Docs pages still load; only the "Report a problem"
  link's destination is unavailable.
- JavaScript is off or blocked. All docs content is still readable; only search
  needs scripting.
- A signed-in customer reads the docs. Docs are not personalised. They explain where
  each value (organization slug, API address, token) is found in the portal.
- The SDK is not yet on npm. The docs can go live with the developer quickstart
  unpublished (FR-021).

## Requirements *(mandatory)*

### Functional Requirements

**Docs**

- **FR-001**: The docs MUST have these sections:
  - Get started, with one quickstart for hardware and one for developers
  - Concepts: organizations, devices and profiles, sources and gateways, commands,
    alerts, automation and dashboards
  - Hardware reference: Sparkplug B, connection kits and adapters
  - Developer reference: the integration API, events, webhooks, the SDK and AI agents
  - User guides
  - Changelog

  Search MUST cover all of them.
- **FR-002**: Every docs page MUST link to the marketing site's home page and to the
  portal's sign-in.
- **FR-003**: The hardware and developer quickstarts MUST satisfy User Stories 1 and
  2. A downloadable reference simulator MUST let a hardware engineer complete the
  quickstart without hardware.
- **FR-004**: The product name, company name, the docs, marketing-site, portal and
  API addresses, and the broker host MUST come from the docs configuration. Renaming
  the product MUST be one change, and a check MUST fail the build if a configured
  value is written literally elsewhere.
- **FR-005**: Real domains and addresses MUST be supplied at deploy time and MUST NOT
  be committed. Samples in the repository use `example.com` or `.test` hosts and
  documentation IP ranges.
- **FR-006**: The docs MUST describe only what the current hosted release offers.
  Pages for deployment-switched features (adapters, AI agent access) MUST be
  published only while the hosted service has them on.
- **FR-007**: The docs MUST NOT contain customer, prospect or pilot names, logos,
  quotes or figures derived from them. They MUST NOT describe self-hosting, call the
  product open source or name a repository license.
- **FR-008**: The docs MUST NOT set cookies or load third-party scripts or trackers.
- **FR-009**: Every docs page MUST meet WCAG 2.2 AA and work at phone width with no
  horizontal scrolling. It MUST follow the reader's light or dark preference and use
  the product design system's colours and type.
- **FR-010**: The API reference MUST be generated from the public API contract of the
  release being published. It covers the integration API only, and every operation
  shows its abilities, rate limits, errors and examples.
- **FR-011**: The events reference and the webhook delivery reference MUST be
  generated from the same contract. The agent tools list MUST be generated from the
  agent tool catalogue (`contracts/agents/tools.json`).
- **FR-012**: User guides MUST be published from the in-product guides with their
  revision, and MUST NOT be copied into a second source.
- **FR-013**: The Sparkplug reference MUST state each requirement the runtime
  enforces and each message it rejects. The hardware guides MUST explain connection
  kits, TLS verification with the kit's CA, credentials per gateway and command
  acknowledgement.
- **FR-014**: The developer reference MUST explain abilities, device grants, token
  lifetime and rotation, rate limits with `Retry-After`, error meanings, and event
  feed cursors and checkpoints. It MUST also explain at-least-once delivery with
  deduplication by event ID, and webhook signature verification with language-neutral
  steps.
- **FR-015**: Runnable samples in the quickstarts and the SDK pages MUST run in the
  local device test suite against the local stack. A pull request that changes them,
  the SDK or the integration API MUST run that suite and record the result, and CI
  MUST check every sample's syntax and types.
- **FR-016**: The changelog MUST record each release's changes to the integration
  API version, its operations, its event types and the SDK version.
- **FR-017**: Every docs page MUST offer a way to report a problem with that page,
  through the marketing site's contact page, with the page address.

**Publishing**

- **FR-018**: The docs MUST be published independently of the hosted platform. A
  docs deploy cannot change the platform, and either can be down while the other
  stays up.
- **FR-019**: Publishing the docs MUST use the sources of the hosted release, and a
  failed build MUST leave the previous version online.
- **FR-020**: The docs MUST be served on their own subdomain of the company's
  domain, over HTTPS.
- **FR-021**: Before the developer quickstart is published, the integration SDK MUST
  be on the public npm registry under a permissive license (MIT or Apache-2.0) that
  covers the SDK package alone. Each release's changelog entry and published version
  MUST match the SDK docs.

### Key Entities

- **Docs configuration**: product name, company name, docs URL, marketing-site URL
  and its contact page, portal URL, API base URL and broker host.
- **Hosted release record**: the hosted commit, held privately, and the hosted
  feature switches (adapters, agent access), committed.
- **Docs page**: section and source (hand-written, generated from the contract,
  generated from the tool catalogue, or published from an in-product guide), the
  release it was built from, and its last change.
- **Changelog baseline**: the integration operations and event types as of the
  latest changelog entry.

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
- **SC-004**: Every docs page passes an automated WCAG 2.2 AA scan with no serious or
  critical violations, and shows its main content within 2 seconds on a simulated
  mid-range phone on a 4G connection.
- **SC-005**: Changing the product name in the docs configuration produces a build in
  which the old name appears nowhere. The literal-value and private-name checks fail
  the build when a test violation is introduced.

## Assumptions

- The docs are public and need no sign-in. English only.
- Content changes go through pull requests to this repository. There is no CMS.
- The marketing site, its contact form and its privacy notice live in the website
  repository. The docs only link to them.
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
- Which hosted-service features are switched on is recorded in the hosted release
  record at each release. It is not inferred from the repository's defaults.
