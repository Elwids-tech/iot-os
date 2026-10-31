# Research: Data-First Device Onboarding

These are the decisions behind [plan.md](plan.md). Each records what was chosen, why,
and what else was considered. The facts come from `main` at bf13f27 and were
rechecked on 2026-10-31 against f239b30, which adds ADR-027 and ADR-028.

## What the code does today

Facts the decisions rest on:

- **An MQTT adapter has nothing running until a revision is deployed.**
  - A deployment is a Node-RED tab with four nodes: source, decoder, publisher and
    reporter (`services/adapters/lib/flow.cjs`).
  - The source reads only while the publisher is online (`nodes/adapter.js`).
  - The `adapter-<uuid>` subscriber identity on the tenant broker is created at
    deploy.
  - Only webhooks capture input before deploy: the receiver's `sampling` route
    state, stored as `device_adapter_deliveries` rows of kind `sample`. That table
    already allows `source = mqtt`, keeps the newest 100 rows per kind, is pruned
    after 7 days, and the portal shows 20.
- **Adapter-manager makes no long-lived connections.**
  - Its vendor `/connection-test` disconnects as soon as the subscription is
    acknowledged.
  - It connects to the tenant broker only as `adapter-admin`, to send Dynamic
    Security commands.
- **Deployment is acknowledged synchronously.** `DeployAdapter` calls the manager's
  `/deploy` and needs `applied` in the reply. There is no asynchronous acknowledgement
  or generation for adapters.
- **Activation needs a running adapter and a stored birth** for the serial.
  `AdapterService::activate` requires the serial's Discovery candidate.
  - Since ADR-027, the runtime applies an adapter-fed activation against that
    stored birth (`birth_metrics` in `device.activate.v1`) when no live birth is
    present. Bindings follow the device's applied generation.
  - A serial gets its first stored birth only when a deployed revision decodes one
    of its messages.
  - Each activation queues a redeploy, so a second activation straight after
    returns 409.
- **Audit events go to the activity log** (ADR-028). `DeviceAudit::record` now
  writes through `ActivityLog::record`, and new code calls `ActivityLog::record`
  directly.
- **A published profile is required.** `AdapterService::fields` requires
  `artifact_uuid`, and `device_adapters.device_profile_artifact_id` is `NOT NULL`.
- **Adapters reuse the device permissions** `Device.view`, `Device.manage`,
  `Device.manage-connections` and `Device.activate`. Profiles use
  `DeviceProfile.create`, `update`, `validate` and `publish`. Device adapters are
  switched on for the whole deployment (`IOT_ADAPTERS_ENABLED`), exposed per
  organization as `features.device_adapters`.
- **The two waiting counts differ by one filter.** The sidebar's Discovery count
  (`OverviewQuery`) and Add device's count (`discovery-candidates?available=1`) share
  `availableToOnboard()`. Only the second excludes adapter node-level sources.
- **No broker-level diagnostics exist on tenant brokers.** No connection log is read
  and no authentication failures are recorded.
- **The portal has no field-path tooling and no "suggested value" marker.** It
  already has a `Stepper`, `ChoiceCard`, `JsonEditor` (CodeMirror 6) and
  `ActivateAdapterDevice`. The profile `ParameterEditor` is bound to the studio
  provider. The closest form-filling precedent is the automation assistant's **Use
  this draft**.

## R1. Where the journey lives and how a setup is saved

- **Decision**:
  - **Portal**: a new module `apps/portal/src/sources/` holds the journey and the
    Manage page.
    - Add device moves to `/devices/add`, which shows the start screen.
    - A setup's steps live at `/devices/add/:setupUuid/:step`, with step one of
      `connect`, `data`, `readings` or `collect`.
    - Manage lives at `/data-sources/:adapterUuid`.
    - `devices/onboard[...]` and `device-adapters/*` redirect, keeping `?mode=`.
  - **API**: a new `app/Domain/Onboarding` holds the `DeviceSetup` model.
    - A setup row records only what the checklist cannot derive: the connector, the
      step reached, pasted samples, the activation selection, the rollout and the
      timings.
    - Step states come from spec 020's `AdapterDiagnostics::checklist` (the source
      of truth), mapped onto the journey: `connect` → Connect; `samples` → See data;
      `type` and `decoder` → Choose readings; `deploy` and `activate` → Start
      collecting.
    - Native setups reference their `device_onboardings` row and device instead.
- **Rationale**:
  - Resume (FR-004) needs a server record that exists before an adapter does (a
    connector chosen on the start screen) and for native paths, which have no
    checklist.
  - Deriving step states keeps one model of progress, as the spec requires.
  - The wizard's `sessionStorage` form state is lost across devices and invisible to
    the Devices page.
- **Alternatives**:
  - Columns on `device_adapters`: covers neither native paths nor the moment before
    a source is saved.
  - Keeping the checklist component beside a stepper: two progress displays for one
    job, which is the problem being fixed.

## R2. Capturing MQTT input before any revision is deployed

- **Decision**: a **capture flow** in the tenant runtime, separate from revisions.
  - **Starting it**: Laravel calls adapter-manager `POST /capture` with the source,
    its secrets and a lease end. The manager deploys a tab `capture-<uuid>`: a source
    node in `capture` mode and a reporter. There is no decoder or publisher.
  - **Reading**: in capture mode the node reads without waiting for a publisher,
    acknowledges each message at once, and reports it as a `capture` runtime event:
    topic, QoS, retained flag, size, `received_at`, and the payload as base64 up to
    64 KiB with a truncation flag. It reports at most one message a second and 20
    every 10 seconds per adapter.
  - **Storage**: Laravel stores captures as `device_adapter_deliveries` rows with
    `kind = sample` and `source = mqtt`. These are the same rows, limits and pruning
    as webhook samples, so "captured input" is one model for every connector
    (FR-020).
  - **Polling**: Fetch now also stores up to 20 returned records as captured input,
    with `source = poll`. Polled records then survive Resume (FR-004) and count as
    received input, not pasted input (FR-023).
  - **Identities**:
    - On the tenant broker the flow uses its own subscribe-only identity,
      `capture-<uuid>`, with a clean session.
    - For a vendor broker it connects with the source's credentials and the client
      id `capture-<uuid>`, also with a clean session.
    - Neither touches the persistent `adapter-<uuid>` session, so no queued message
      of a paused adapter is lost.
  - **Lease**: capture starts when a source is saved in Setup. It is renewed every
    60 seconds while See data or Choose readings is open, and ends 30 minutes after
    the last renewal, or on deploy, discard, delete or pause.
  - **Changes in Manage**: the deployed flow's source node copies raw input to its
    reporter while the adapter's `capture_until` is in the future. Manage does not
    open a second connection.
- **Rationale**:
  - The tenant runtime already holds vendor credentials, which are encrypted in the
    flow, and the broker path (ADR-010).
  - Keeping long-lived connections out of the manager keeps them away from the
    process that holds the Docker socket.
  - A lease stops an abandoned draft from holding a vendor connection open.
  - Capture events are bounded diagnostic samples, like spec 020's deliveries.
    Nothing becomes telemetry and nothing creates candidates (principle I and the
    boundary that only activation stores data).
- **Alternatives**:
  - The manager subscribes itself: long-lived vendor connections and credentials
    would sit in the most privileged adapter process.
  - Deploying a pass-through decoder revision: it needs a profile, publishes births
    and candidates, and blurs what a revision means.
  - Always copying input in deployed flows: avoidable volume and personal data
    (edge case: GPS positions).
- **Recorded in** [ADR-024](../../docs/adr/ADR-024-capture-before-deploy.md). It
  amends ADR-010, because a runtime tab now runs without an activated revision.

## R3. Why nothing arrives: reasons each connector can observe

- **Decision**: each connector observes what its transport allows. Reasons are codes
  whose words come from the connector definition (R5).
  - **Tenant broker, during Setup**:
    - Hardware credentials created for a source in Setup may publish to any topic
      except `iot-os/` and `$` topics, and except the topic filters of the tenant's
      other deployed adapters. These are deny entries at a higher priority than the
      broad allow, so a setup device can never feed another data source.
    - Laravel keeps both lists current: the deny entries on setup credentials and
      the capture flow's ignored topics. It refreshes them whenever an adapter in
      the organization deploys, pauses, is deleted or changes its filters
      (`CaptureLease::refreshTenant`).
    - Sparkplug B topics (`spBv1.0/`) are allowed so See data can recognise a
      Sparkplug device and offer the native path (FR-024). Such messages are
      labelled and never decoded.
    - The capture identity subscribes to `#`. Messages that match another deployed
      adapter's filters are dropped in the node.
    - When the source has filters, other messages are kept and labelled **outside
      your filters**, with an offer to add a filter. When it has none, topics seen
      suggest one (for example `sensors/ENV-0042/telemetry` gives
      `sensors/+/telemetry`).
    - At the first deploy the manager narrows those credentials to the source's
      filters, as every deployed adapter does today.
    - Topic filters are therefore optional in Connect for this connector and are
      confirmed in Choose readings (FR-033).
  - **Tenant broker connections and rejected credentials**:
    - The manager sets `connection_messages true` on tenant brokers and follows each
      tenant broker container's log through the Docker API it already uses.
    - It keeps, per username, the last connection, disconnection and refusal, served
      by `GET /broker-activity`.
    - Laravel maps usernames to the setup's hardware credentials.
    - Spike first: if Mosquitto 2.x does not name the username on a refused
      connection, See data reports "a connection with wrong credentials was refused
      at <time>" without naming the credential.
  - **Vendor broker**: the capture connection's own outcomes (connect refused, wrong
    credentials, subscription refused), reported as `health` events as today.
  - **Webhook**: the receiver's rejections (spec 020).
  - **Polling**: Fetch now results and poll runs (spec 020).
- **Rationale**:
  - The person's first question is "is my device reaching you?". On the tenant
    broker only the broker knows, and its log is the cheapest place to ask.
  - Broad publish rights during Setup let the platform show what the firmware really
    sends, without a topic question the person cannot answer yet.
  - The broker is per tenant, so the wider rights stay inside the organization
    (principle III).
- **Alternatives**:
  - A Mosquitto authentication plugin: compiled code in every tenant broker image.
  - `$SYS` topics: no per-client failures.
  - Asking for the topic filter up front, as today: the question newcomers cannot
    answer.

## R4. Field mapping: format, interpreter and compilation

- **Decision**:
  - **Format**: a mapping is `field-mapping.v1` JSON
    ([contract](contracts/field-mapping.md)).
    - Identity comes from a field (JSON Pointer), a topic segment, or a fixed value.
    - Readings are listed as `{pointer, key, label, data_type, unit, scale,
      offset}`.
    - Optional parts: a time field and its format (`iso`, `epoch_s`, `epoch_ms`), a
      records pointer for lists, and match rules on the topic or a field.
  - **Generated decoder**: a fixed, versioned interpreter
    (`contracts/adapters/v1/field-mapping.v1.runtime.js`: ES2020, no imports, at most
    12 KiB), then `const MAPPING = <json>;`, then a `decode(input, helpers)` that
    calls it.
  - **Who builds it**:
    - The portal imports the same runtime file to decode samples while the person
      maps. It runs in the browser because it is platform code, not tenant code. The
      portal builds the decoder text when the person saves.
    - Laravel's `FieldMappingCompiler` builds the identical text from the file under
      `devices.contracts_path`. It re-checks every save whose `code_origin` is
      `mapping` and refuses a mismatch with 422, so "made with the mapping" is always
      true. It also builds code for the assistant's `test_decoder` and for copies.
  - **Storage**: the revision definition stores `mapping` and `code_origin` (`mapping`
    or `code`) beside `code`.
  - **Parity**: the same cases run in Vitest (browser runtime), in the manager's
    quickjs sandbox (`node --test`), and in PHPUnit (byte-identical compiled text).
  - **Skipping messages**: `decoder-output.v1` gains an additive ignored result,
    `{ignore: true, reason}`. A mapping's match rules can then skip heartbeats and
    other message types on purpose, and they are counted as `ignored` rather than
    as failures (FR-033). Today a decoder can only fail or return readings.
- **Rationale**:
  - **Immutability**: embedding the interpreter in each revision keeps the revision
    reproducible after a `v2` interpreter exists (principle II).
  - **Same rules as hand-written code**: the sandbox, test gate and deployment are
    unchanged (FR-034).
  - **Speed**: previews need no round trip, which meets the 1-second requirement
    (FR-032).
  - **Size**: the 64,000-character code limit leaves room for about 200 readings.
- **Alternatives**:
  - Generating bespoke code per mapping: three generators to keep identical, and
    noisy diffs.
  - Interpreting mappings natively in the runtime: a second execution path beside
    decoders, outside the sandbox and test story.
  - Previewing through the manager's `/test`: a round trip per change and at most 10
    fixtures.

## R5. Connector definitions

- **Decision**:
  - **Server side**: PHP classes in `app/Domain/Onboarding/Connectors` implement
    `Connector`, registered in `config/onboarding.php`. Each one gives:
    - its key and place on the start screen, with what the person will need;
    - `availability(organization, user)`, returning available or the reason it is
      not;
    - its settings and secret fields;
    - its capture method: `broker_capture`, `webhook_samples`, `fetch_now` or
      `sparkplug_birth`;
    - its readings mode: `field_mapping`, `point_map` or `profile_metrics`;
    - its reason catalogue (`{code, title, explanation, fix}`);
    - the assistant actions it allows.
  - **API**: `GET connectors` serves the definitions available to the organization.
  - **Portal**: `sources/connectors.tsx` maps each key to its settings form. These
    are the existing topic form, the vendor broker form, `WebhookSource`,
    `PollSource` and the native connection kit.
  - **The six connectors**: `tenant_mqtt`, `vendor_mqtt`, `webhook`, `poll`,
    `sparkplug_direct` and `sparkplug_gateway`.
  - **Test-only connector**: `lab_mqtt`, registered only when
    `IOT_ONBOARDING_TEST_CONNECTORS=true` (local stack and CI). It reuses broker
    capture with a fixed-topic form and proves FR-082 and SC-008.
- **Rationale**:
  - Availability depends on configuration, features and permissions, which Laravel
    owns (principle I).
  - The UI, the Manage status sentence and the assistant read the same reason words
    (FR-081).
  - Forms stay React components because they are UI.
- **Alternatives**:
  - JSON files in `contracts/`: availability needs code.
  - A database table: makes definitions tenant data, with no demand for that
    (ADR-023).
  - A portal-only registry: the assistant and status sentences need the reasons on
    the server.

## R6. The device type: generated or reused

- **Decision**:
  - **Creating one**: saving Choose readings without reuse creates or updates a draft
    profile through the existing profile services.
    - The name comes from the person and the code from its slug.
    - Each chosen reading becomes a parameter. Numbers become measurements;
      booleans, strings and enums become states. Each gets `reports_state: true`,
      its data type and its unit from the unit catalogue.
    - The adapter references it through a new nullable `device_profile_id` until it
      is published.
  - **Reuse**: `ProfileMatcher` ranks the organization's published profiles. It
    matches keys exactly first, then normalised names whose units are compatible
    according to `contracts/units/v1`. It offers profiles where at least half the
    chosen readings match, and returns matched, missing and extra readings and unit
    differences.
  - **When reused**: the mapping's keys become the profile's keys, and known unit
    conversions become suggested scale and offset (FR-042).
  - **Schema**: `device_profile_artifact_id` becomes nullable.
- **Rationale**:
  - Reuses the profile domain's validation, immutability and publish rules.
  - The draft opens in the existing profile editor for groups, calculations and
    alarms (FR-041).
- **Alternatives**:
  - A lightweight "device type" separate from profiles: a second readings model for
    the runtime and dashboards to learn.
  - Reusing the studio-bound `ParameterEditor` inside the journey: it needs the
    profile studio provider. The journey uses its loose `UnitField` and display
    fields instead.

## R7. Start collecting: an ordered, resumable rollout

- **Decision**: an `AdapterRollout` (`device_adapter_rollouts`) with kind `start`
  (Start collecting) or `apply` (Apply changes in Manage) runs these steps in order:
  1. **Check**: test the draft revision against the draft device type's compiled
     definition. Nothing is published if it fails.
  2. **Publish device type**: skipped when a profile is reused or unchanged.
  3. **Bind and test**: save a revision identical except for `artifact_uuid` and
     test it. This is the exact revision that deploys.
  4. **Deploy**: the existing operation and `DeployAdapter` job.
  5. **Activate**: `start` only. Each checked serial is activated as soon as its
     stored birth exists, in batches (R8). A stored birth exists once the deployed
     revision has decoded one of the serial's messages; under ADR-027 activation
     applies against it without waiting for a live birth.

  People see four steps: Test, Publish device type, Deploy and Activate devices.
  The Deploy step says it tests the final revision first.
  - **Execution**:
    - `AdvanceRollout`, a queued job, runs one step per job, keyed by rollout and
      step, with `request_uuid` on confirmation.
    - A failure records `{step, reason, fix}`. Confirming again resumes at the
      failed step.
    - Waiting for activation is event-driven: a new adapter `DiscoveryCandidate`
      birth (`RuntimeController`) dispatches the job for a waiting rollout. A
      one-minute `rollouts:advance` sweep covers lost dispatches, as
      `assistant:recover` does.
  - **Permissions**: each step checks the confirming person's permission when it
    runs.
    - Test: `Device.manage`.
    - Publish: `DeviceProfile.publish`.
    - Deploy: `Device.manage` and `Device.manage-connections`.
    - Activate: `Device.activate` as well.
    - When a permission is missing, the rollout waits with that permission named.
      Anyone who holds it can confirm to continue, and each step records who ran it
      (FR-052).
  - **The 2-minute diagnostic (FR-054)**: worked out when it is read, from
    `IngestionDiagnostics` hop times (received, decoded, published, stored).
- **Rationale**:
  - The test gate stays exact: only a tested revision deploys, and that revision
    names its published profile, as every revision does today.
  - The check step fails fast before anything immutable is created.
  - Running on the server lets the rollout continue after the person leaves
    (FR-051).
- **Alternatives**:
  - Publishing first: a failed test would leave an unused immutable profile.
  - Pinning the revision to the draft by definition hash and binding at deploy:
    deploy would need new semantics, and the hash may include publication fields.
  - Laravel `Bus::chain`: chains do not wait on events, and nothing in the codebase
    uses them.

## R8. Activating several serials in one step

- **Decision**:
  - `AdapterService::activateMany(adapter, candidates, user)` creates every
    installation and configuration in one transaction, then queues one redeploy.
  - `POST device-adapters/{adapter}/candidates/activate` takes up to 50 candidates
    with names.
  - The single-candidate route calls `activateMany` with one candidate.
  - Each device still activates through `DeviceConfigurationService::activate`. It
    therefore carries the stored birth's `birth_metrics` and leaves the applied
    generation to the runtime (ADR-027).
  - Serials that first report after Start collecting are listed on the source and
    among the waiting sources (FR-055).
- **Rationale**:
  - One activation per serial queues one redeploy each, and the next one returns
    409.
  - Under ADR-027 only a pending request blocks a device, so a batch does not need
    to wait for earlier devices.
- **Alternatives**: activating serials one after another while waiting for each
  redeploy takes minutes for tens of devices.

## R9. Setup or Manage, one status sentence, one waiting count

- **Decision**:
  - **Mode**: the adapter view gains `mode`, which is `manage` once there is an
    applied revision and at least one active installation, and `setup` otherwise.
  - **Status sentence**: `AdapterDiagnostics::status` returns one
    `{tone, sentence, hop, since}` for both the index and the view. The worst
    problem wins, in this order:
    1. deploy failed;
    2. source stopped (for example credentials rejected);
    3. rejecting deliveries;
    4. decode failures;
    5. paused;
    6. deploy pending;
    7. "Receiving from N devices · last message T";
    8. "No input yet".

    The adapter list shows this one status instead of separate deployment and source
    columns.
  - **Waiting count**: the node-level filter moves into
    `DiscoveryCandidate::availableToOnboard()`. The sidebar, Add device, the Devices
    page and Discovery then count the same rows, labelled "waiting to be added".
- **Rationale**:
  - One precedence list makes "Running" beside "Stopped: credentials rejected"
    impossible (FR-062).
  - One scope makes the counts agree (FR-065).
- **Alternatives**:
  - Fixing the list's wording only: other views would still disagree.
  - Explaining the different counts: people still see two numbers.

## R10. Action cards in the conversation

- **Decision**: every step proposal is an action card.
  - **One proposal, two views**: an immutable proposal of kind `step`
    (`device_adapter_proposals`), with a `card` kind. The kinds are:
    - `connector`, `settings`, `credentials`, `secret` and `kit`;
    - `mapping`, `code`, `fixtures` and `device_type`;
    - `start` and `activate`;
    - `native_device` and `native_matches`.

    The portal renders an open proposal in the conversation as an `ActionCard`, a new
    kit component with a story: a title, what it changes, a values preview, the
    primary control, **Show code** where it applies, and **Dismiss**. The step's form
    shows the same proposal as `SuggestedValue`s.
  - **Applying**: the card's control and the form's save call the same endpoint, with
    `suggestion: {uuid, content_hash}`. The first one wins and the other view shows it
    as applied. A saved draft newer than the proposal makes it out of date; the
    assistant is told and proposes again from the saved state.
  - **Card states**: `open`, `applied` (with its result), `out_of_date` and
    `dismissed`.
  - **Start collecting and activation**: `start` embeds the Start collecting summary
    and calls `POST device-setups/{setup}/start`, and its progress comes from the
    rollout view. `activate` lists the serials with checkboxes and calls the batch
    activation (R8).
  - **Who presses**: the model only creates proposals. The press is a browser request
    as the person, on a session route that no assistant tool or agent token reaches.
    So the person still approves everything (principle V).
- **Rationale**:
  - The walkthrough showed people leaving the assistant to find each approval and
    losing the thread.
  - The person approves where the assistant explains, and sees the result there
    (FR-072, FR-074).
  - Keeping one proposal record keeps spec 020's audit trail, hash, staleness and
    permission checks.
- **Alternatives**:
  - **Suggestions only in the form** (this plan's first version): it is the bounce the
    owner rejected.
  - **The assistant applying changes itself after a chat "yes"**: that would break
    principle V and make a typed "ok" an approval.
  - **Separate chat-only proposals**: two records of one change would disagree.

## R11. Native Sparkplug B paths in the four steps

- **Decision**: the journey renders native steps from today's `DeviceOnboarding`
  pieces, with their current endpoints:
  - **Connect**: start, provision and `ConnectionKit`.
  - **See data**: the `devices/{device}/onboarding` connection check.
  - **Choose readings**: `MappingTable`/`MetricPicker` and configuration
    validation.
  - **Start collecting**: activation.

  The setup row references the onboarding and the device. The `sessionStorage` form
  state is removed. The native API does not change.
- **Rationale**: the owner chose the same four steps with unchanged behaviour (FR-003).
- **Alternatives**: keeping the old wizard behind the start screen, which the owner
  declined.

## R12. Measuring the journey

- **Decision**:
  - **What a setup row records**:
    - `step_times`: when each step was first reached and completed;
    - the connector;
    - `assistant_used` and `code_edited`;
    - `cards_applied` and `form_saves`: how many steps were approved in the
      conversation and how many in forms;
    - `first_reading_at`.

    It holds no payloads or secrets.
  - **Report**: `GET admin/onboarding/summary?from&to` (platform administrators)
    returns, per connector:
    - setups started, setups reaching each step, and setups completed;
    - the median minutes to the first reading;
    - the share of setups that used the assistant or edited code.

    A small **Onboarding** page in `apps/admin` shows it.
  - **Pruning**: completed setups go after 365 days, discarded ones after 30.
- **Rationale**: FR-110 and the success criteria, with no product analytics service.
- **Alternatives**:
  - Audit events only: the audit log has no step timings, and querying it for
    medians is awkward.
  - An external analytics tool: sends usage outside the deployment.

## R13. Names and routes

- **Decision**:
  - The navigation entry **Device adapters** becomes **Data sources** at
    `/data-sources`, and old paths redirect.
  - The journey uses "device type", "readings" and "device ID field".
  - API routes, permission names, docs under `docs/reference` and developer docs keep
    "device adapter".
- **Rationale**: the owner's decision (FR-100), with no API break.

## R14. Another device of a type, and copying a setup

- **Decision**:
  - **Add another**: creates a setup of kind `another` on an existing source.
    - Tenant broker: a new hardware credential and kit, then See data waits for a
      new serial, then Start collecting activates it, with no Choose readings.
    - Cloud sources: shows the waiting serials and says no new connection is needed.
  - **Start from an existing setup**: creates a draft adapter through
    `AdapterService::store`.
    - It copies the settings without secrets, the mapping or code, the fixtures and
      the device type.
    - A webhook copy gets a new ingest identifier and no secret.
    - The copy is a draft that must pass its own test.
- **Rationale**: FR-090 to FR-092 with existing services. Secrets never travel.

## R15. Testing

- **Decision**:
  - **Vitest**: the mapping runtime, suggestions, field tree, subject matching and
    the connector registry.
  - **PHPUnit on PostgreSQL**:
    - setups, rollouts, step permissions and the permission handoff;
    - the compiler and its parity;
    - connector availability, `activateMany` and the status sentence;
    - organization isolation for setups, captures, suggestions and copies.
  - **`node --test`**: capture mode, the broker log parser, the lease and the
    interpreter in quickjs.
  - **Adapter integration test** (real Mosquitto and Node-RED): capture before deploy
    for both MQTT sources, off-filter labelling, and narrowing at deploy.
  - **Playwright with a mocked API**: the start screen, the four steps for every
    connector, resume, action cards in the conversation and the same proposals in
    the forms, a conversation that survives every applied card and navigation, the
    assistant on and off, and axe checks.
  - **Rebuilt local stack**: the quickstart scenarios.
- **Rationale**: principles III, IV and IX, and the test layout the repository already
  uses.

## R16. Delivery

- **Decision**: three pull requests from `main`. None is stacked; each is cut after
  the previous one merges.
  1. **Plan**: spec, plan, research, data model, contracts, quickstart, tasks and
     ADR-024. Documents only.
  2. **Journey**: the P1 and P2 stories, one commit per part:
     - capture and broker activity;
     - mapping contract and runtime;
     - the API (setups, connectors, device type, rollouts, `activateMany`, status,
       count);
     - the journey UI and native paths;
     - Manage and the navigation rename;
     - the assistant in the steps;
     - simulators, contracts and docs.
  3. **Reuse and measurement**: the P3 stories (another device, copies, test
     connector) and the admin report.
- **Rationale**:
  - The owner merges lists of pull requests at once, and stacked pull requests have
    missed `main` before.
  - Each pull request leaves `main` working.
- **Alternatives**:
  - One pull request per story: several would depend on unmerged work.
  - A single build pull request: reuse and measurement do not need to block the
    journey.

## R17. One conversation per setup, and continuing after each card

- **Decision**:
  - **Binding**: `assistant_conversations.device_setup_id` is unique for onboarding
    conversations. The panel's onboarding body finds the conversation from the
    current page's context: the setup step, the source's Setup or Manage page, the
    draft device type's page, or a device created by the setup.
  - **No more fresh starts**: journey entry points stop using
    `startTask("onboarding", { fresh: true })`. Navigating within one setup keeps the
    conversation; another setup opens its own.
  - **Continuing**: applying a card posts an event message to the conversation
    ("Applied: Use this mapping"). The server then queues a run whose instructions
    continue to the next step. Today the portal sends a similar message after a
    proposal decision, but nothing ties the next step to it.
  - **Progress**: the run context includes the setup's derived steps, so every reply
    can say the step reached and what is left (FR-130).
  - **Panel behaviour**:
    - A message sent while a run is in progress is queued in the panel and sent
      when the run ends.
    - Escape closes only the innermost picker.
    - Replies are de-duplicated by message id (FR-137).
- **Rationale**: the walkthrough lost the conversation at every approval, because
  applying navigated and the panel started a new conversation for the page.
- **Alternatives**:
  - Binding the conversation to the page: that is today's behaviour.
  - Never navigating on apply: the person needs to see the source and the device.
    Navigation is fine once the conversation follows.

## R18. Secrets in cards

- **Decision**:
  - **The model never supplies values**: `credentials` and `secret` cards carry only
    which fields are needed.
  - **Entering credentials**: the card renders password fields that post to the
    adapter save (`secrets`), as the form does.
  - **Creating a webhook secret**: the card's **Create secret** calls the existing
    webhook secret endpoint. The value is shown once in the card's browser state and
    is gone after the card closes.
  - **What the conversation keeps**: only "API key saved" or "Secret created
    10:42", never a value.
  - **The kit**: `kit` creates the hardware credential and offers the download from
    the card.
- **Rationale**: this keeps FR-075 and spec 020's FR-107. The secret never travels
  through the model or the transcript, yet the person never leaves the conversation.
- **Alternatives**:
  - Sending people to the Connection tab: today's bounce.
  - Letting the person paste secrets into the chat: the model would see them, which
    breaks FR-107.

## R19. What the assistant can do without help

- **Decision**:
  - **Testing**: `test_decoder` accepts inline `fixtures` (1–10, built from pasted or
    captured samples) and a `mapping`, so a new source can be tested before anything
    is saved. Today's version takes only `inputs: fixtures|samples` and cannot test a
    pasted sample.
  - **Drafting a device type**: `device_type` cards can draft a device type from the
    person's description and samples. The evidence origin is `stated`, citing the
    message. The draft profile is created when the person applies the card. Today
    the profile tools refuse chat text as evidence.
  - **Reuse**: `propose_adapter` with mode `reuse` is refused on the server unless the
    adapter's device type matches and its source settings match the described
    endpoint, account or topics (FR-133). `find` returns those match facts.
  - **Asking**: the run context lists the facts already known. These are the answers
    given, attachments, a captured input summary and the latest Fetch now. The
    instructions forbid re-asking, and optional questions never disable
    **Continue**. SC-012 is checked across the evaluation set.
  - **Native paths**: new card kinds `native_device` (create the onboarding with name
    and device type) and `native_matches` (metric matches). The rest uses the
    existing onboarding endpoints (R11).
- **Rationale**: these are the walkthrough's dead ends, defects 1, 2, 4 and 5 and the
  Sparkplug B handoff. A separate session is fixing the defects in today's assistant;
  this spec builds the journey on those fixes.
