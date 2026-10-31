# Tasks: Data-First Device Onboarding

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: tests are part of the feature.

- The constitution requires tenant isolation tests (III), contracts with fixtures
  (IV) and verification in the running stack (IX).
- SC-003, SC-004, SC-008, SC-009 and SC-010 are proven by tests.
- Write each story's tests with the story and see them fail first.
- API tests run on PostgreSQL, never SQLite.

**Delivery**: three pull requests from `main`, never stacked; each is cut after the
previous one merges.

1. **Plan**: this folder and ADR-024.
2. **Journey** (`feat/021-data-first-onboarding`): phases 1–9, one commit per
   part:
   - setups, connectors and the shell (T003–T013);
   - capture and broker activity (T014–T025);
   - the field mapping and Choose readings (T026–T034);
   - Start collecting (T035–T041);
   - the assistant in the conversation (T042–T052);
   - the start screen and native paths (T053–T057);
   - Manage, status, the count and the rename (T058–T064);
   - simulators, docs and verification (T065–T070).
3. **Reuse and measurement** (`feat/021-reuse-and-measurement`): phases 10–12.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1 to US8)
- Paths are from the repository root

---

## Phase 1: Setup

- [ ] T001 Run the SC-005 baseline: a moderated test on today's flow on `main`, before the journey pull request merges, with five people who have never used the platform and only a device's documentation. Record the time to stored readings and where each person stalled, without names, in specs/021-data-first-onboarding/baseline.md. This is an owner activity; the journey pull request links the result
- [ ] T002 [P] Spike the Mosquitto 2.x connection log (research R3): with `connection_messages true` on a scratch tenant broker, record the exact lines for a connect, a clean disconnect, a wrong password and an unknown username, and whether a refusal names the username. Write them as fixtures in services/adapters/test/fixtures/broker-log.txt and the finding in docs/dev/gotchas.md
- [ ] T003 [P] Add `IOT_ONBOARDING_TEST_CONNECTORS` (default `false`) and capture limits (`lease_minutes: 30`, `renew_seconds: 60`, `excerpt_bytes: 65536`) to apps/api/config/onboarding.php, deploy/compose/compose.adapters.yml (API family), and deploy/release/environment.example with the value `false`
- [ ] T004 [P] Let the portal import the field-mapping interpreter: add `contracts/adapters` to `server.fs.allow` in apps/portal/vite.config.ts, and check that `pnpm --filter @iot-os/portal build` resolves an import of `../../contracts/adapters/v1/field-mapping.v1.runtime.js`

---

## Phase 2: Foundational (blocks every story)

- [ ] T005 Migrations in apps/api/database/migrations/ per [data-model.md](data-model.md):
  - **`device_setups`**:
    - `kind` string 16, one of `new`, `another` or `copy`.
    - `connector` string 40, nullable.
    - `start_answer` string 40, nullable.
    - `device_adapter_id`, `device_onboarding_id`, `copied_from_adapter_id` and `started_by_user_id`: nullable foreign keys, null on delete.
    - `step` string 16 and `status` string 24.
    - `waiting_permission` string 64, nullable.
    - `pasted_samples`, `activation_selection` and `step_times` JSON.
    - `assistant_used` and `code_edited` boolean, default false.
    - `first_reading_at`, `completed_at` and `discarded_at`.
    - Indexes on `(organization_id, status, updated_at)` and `(device_adapter_id)`.
  - **`device_adapter_rollouts`**:
    - `kind` string 8.
    - `request_uuid`, unique per adapter.
    - `draft_revision`, plus `steps` and `serials` JSON.
    - `status` string 16.
    - `revision_uuid` and `artifact_uuid`, nullable.
    - `confirmed_by_user_id`.
  - **`device_adapters`**:
    - `device_profile_artifact_id` becomes nullable.
    - Add a nullable `device_profile_id` foreign key and nullable `mapping` JSON.
    - Add `code_origin` string 8, default `code`.
    - Add nullable `capture_until`.
  - **`device_adapter_deliveries`**: add `retained` boolean nullable, `qos` tiny integer nullable, `off_filter` boolean default false, and `truncated` boolean default false.
  - **`device_adapter_proposals`**: add a nullable `device_setup_id`, `step` string 16, `fields` JSON, and a nullable `applied_revision` integer; `device_adapter_id` becomes nullable.
  - **`assistant_conversations`**: add a nullable `device_setup_id`.
- [ ] T006 Models in apps/api/app/Domain/Onboarding/Models/DeviceSetup.php and apps/api/app/Domain/DeviceAdapters/Models/AdapterRollout.php:
  - casts, organization scope and relations;
  - the setup states `open`, `waiting`, `done` and `discarded`;
  - the rollout statuses `queued`, `running`, `waiting`, `failed`, `done` and `cancelled`;
  - the step states `todo`, `running`, `done`, `skipped`, `waiting` and `failed`;
  - "one rollout per adapter can be `queued`, `running` or `waiting` at a time".
- [ ] T007 Change apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php `fields`:
  - `artifact_uuid` becomes `nullable|uuid`, and a new `draft_profile_uuid` is `nullable|uuid`; the two are mutually exclusive.
  - `code_origin` is `in:mapping,code`, and `mapping` is nullable.
  - A `platform` source may have empty `topics` while it has no applied revision.
  - Test and deploy refuse an adapter with no profile.

  Also make `AdapterDiagnostics::checklist` tolerate a missing profile, so its `type` step is `todo`. The existing tests in apps/api/tests/Feature/Domain/DeviceAdapters must stay green.
- [ ] T008 Add the connector registry in apps/api/app/Domain/Onboarding/Connectors/ (FR-080, FR-081):
  - `Connector.php` (interface), `TenantMqtt.php`, `VendorMqtt.php`, `Webhook.php`, `Poll.php`, `SparkplugDirect.php` and `SparkplugGateway.php`. Each gives its answer, needs, availability, settings reference, capture method, readings mode, reasons with title, explanation and fix, and assistant actions, per [connectors.md](contracts/connectors.md).
  - Register them in apps/api/config/onboarding.php.
  - Add `Http/ConnectorController.php` for `GET connectors` (`Device.view`), routed in apps/api/app/Domain/Onboarding/routes.php and loaded from routes/api.php.
  - Tests in apps/api/tests/Feature/Domain/Onboarding/ConnectorTest.php: with adapters disabled only the native pair is returned; webhook is unavailable without `adapters.webhook_public_url` and gives its reason; the permissions are respected; and every reason has its three texts.
- [ ] T009 Add apps/api/app/Domain/Onboarding/Services/SetupService.php and Http/SetupController.php for `GET device-setups?status=unfinished`, `POST`, `GET {setup}`, `PATCH {setup}` and `DELETE {setup}`, per [api.md](contracts/api.md) (FR-004):
  - Creation is idempotent on `request_uuid`.
  - Steps are derived from the checklist or from the native onboarding, per the data-model mapping table.
  - `pasted_samples` holds "up to 10 entries … each payload at most 64 KiB".
  - `activation_selection` holds "up to 50 entries".
  - `step_times` is recorded on step changes.
  - `connector` cannot change after a source is saved.
  - Discard deletes the draft adapter only if it was never applied and has no installation.
  - Setup events are recorded with `ActivityLog::record` (ADR-028): setup started, step completed and discarded. They never record payloads, pasted samples or secrets.
- [ ] T010 Add tests in apps/api/tests/Feature/Domain/Onboarding/SetupTest.php:
  - create, resume step, derived steps for an adapter and for a native onboarding;
  - the paste limits, connector lock and discard rules;
  - isolation: another organization's setups are 404 for read, patch and delete, and the list never includes them.
- [ ] T011 [P] Add connector, setup, step and capture-reason types and methods to packages/api-client/src/onboarding.ts, and export them from the package index
- [ ] T012 [P] Add the status domains `setupStep` (`todo`, `waiting`, `attention`, `done`) and `rollout` (`queued`, `running`, `waiting`, `failed`, `done`) to packages/ui/src/lib/status.ts, with the stories updated
- [ ] T013 Build the journey shell in apps/portal/src/sources/ (FR-101):
  - `Routes.tsx` handles `/devices/add` and `/devices/add/:setupUuid/:step`.
  - `Journey.tsx` has a `Stepper` with Connect, See data, Choose readings and Start collecting; the step body in a `Panel`; step and connector side help; and a sticky action bar using `ref={keepToastsAbove}` and `useUnsaved`.
  - `connectors.tsx` maps connector keys to settings forms: the existing topic form, the vendor form, `adapters/sources/WebhookSource.tsx`, `adapters/sources/PollSource.tsx` and the native kit.
  - Mount it in apps/portal/src/App.tsx.

**Checkpoint**: setups can be created, read and resumed through the API, and the shell
renders steps for a setup.

---

## Phase 3: User Story 1 - See the data before defining anything (P1) 🎯 MVP

**Goal**: every adapter connector shows raw input before any profile, decoder or
deployment exists, and says why when nothing arrives.

**Independent test**: quickstart A steps 1–3, plus B and C up to See data. Messages
appear within 10 s with no profile and no deployed revision (SC-004).

- [ ] T014 [P] [US1] Extend contracts/adapters/v1/runtime-event.v1:
  - Add the `capture` kind per [runtime-events.md](contracts/runtime-events.md): `report_id` ≤ 80, `topic` ≤ 512, `qos` 0–2, `payload_base64` ≤ 64 KiB, `truncated` and `off_filter`.
  - Add the `outcomes` counts `ignored`, `off_filter` and `capture_dropped`.
  - Add the `health` `source_state` value `capturing`.
  - Update the fixture and cases. `tooling/verify-devices-contracts.py` must pass.
- [ ] T015 [US1] Add capture mode to services/adapters/nodes/adapter.js:
  - The source reads without a publisher and acks at once.
  - It drops topics matching `exclude_topics` and sets `off_filter` against `source.topics`.
  - It throttles to one a second and 20 every 10 s per adapter.
  - It stops at `until`.
  - The reporter sends `capture` events and counts `capture_dropped`.

  services/adapters/lib/flow.cjs builds the `capture-<uuid>` tab (source and reporter). Tests go in services/adapters/test/capture.test.cjs.
- [ ] T016 [US1] Change services/adapters/manager.cjs (FR-013):
  - **`POST /capture`**:
    - For a tenant broker, provision `capture-<uuid>` with subscribe-only rights on `source.topics`, or `#` when there are none, never `iot-os/` or `$`, with a clean session.
    - For a vendor broker, connect with the source credentials as client `capture-<uuid>`.
    - Webhook and poll sources return 422 `not_applicable`.
  - **`POST /capture/stop`** is idempotent.
  - **Expired capture tabs** are removed on every flows write.
  - **`/credential`** takes `scope: setup|filters` and `deny_topics`. `setup` grants publish on `#` at a lower priority than deny entries for `iot-os/#`, `$` topics and every `deny_topics` filter.
  - **`POST /setup-acl`** replaces those deny entries on every setup credential of an adapter, and is idempotent.
  - Tests cover a setup credential being refused on another adapter's filter.
  - **`/deploy`** removes the capture tab in the same flows write, and narrows setup credentials to the filters on the first deploy.

  Tests go in a new services/adapters/test/manager.test.cjs.
- [ ] T017 [P] [US1] Add services/adapters/lib/broker-log.cjs:
  - Follow each tenant broker container's log through the Docker API.
  - Parse the lines recorded in T002.
  - Keep the last 20 events per username in memory, with `since`.
  - Serve `GET /broker-activity?tenant&usernames` from manager.cjs.
  - Add `connection_messages true` and stdout logging to the tenant `mosquitto.conf`.
  - Tests in services/adapters/test/broker-log.test.cjs use the T002 fixtures.
- [ ] T018 [US1] Add apps/api/app/Domain/Onboarding/Services/CaptureLease.php (FR-022, FR-024):
  - Start and renew `capture_until` for 30 minutes, and stop on deploy, discard, delete or pause.
  - Pass `exclude_topics`, the tenant's other deployed adapters' filters, to `/capture`. Pass the same list as `deny_topics` to `/credential` and `/setup-acl`.
  - `refreshTenant(organization)` runs whenever an adapter in the organization deploys, pauses, is deleted or changes its filters, in the same request that queues the change. It calls `/setup-acl` for each never-applied adapter and `/capture` for each active lease.
  - Turn health, receiver rejections, Fetch now errors and broker activity into the connector's reason codes.
  - Label `spBv1.0/` topics `sparkplug_detected`.

  Routes:
  - `POST device-setups/{setup}/capture` (`Device.manage`).
  - The adapter credential flow sends `scope: setup` while the adapter has no applied revision (FR-013).
- [ ] T019 [US1] Change apps/api/app/Domain/DeviceAdapters/Http/AdapterController.php (FR-020):
  - **`event`** accepts `capture` only while `capture_until` is in the future. It drops a capture whose `revision_uuid` is neither applied nor desired. It stores a `device_adapter_deliveries` row with kind `sample`, source `mqtt`, `path` set to the topic, `input` in fixture shape, and `retained`, `qos`, `off_filter` and `truncated`. It inserts once per `report_id` and never creates candidates.
  - **`GET device-adapters/{adapter}/captures?limit=20`** (`Device.view`) returns every source type, newest first, with the last hour's `counts`.
  - **Fetch now**: apps/api/app/Domain/DeviceAdapters/Services/PollingService.php `fetch` stores up to 20 returned records as captured input. Each row has `kind = sample`, `source = poll`, `path` set to the request URL's path without its query, and `input` in fixture shape with `poll`.
- [ ] T020 [US1] Add tests in apps/api/tests/Feature/Domain/Onboarding/CaptureTest.php:
  - a capture is stored only under a lease;
  - a source saves with no profile and no decoder (FR-011);
  - pruning keeps "newest 100 per kind … 7 days";
  - unauthenticated bodies are never stored;
  - reasons map from each transport;
  - captures create no candidate or telemetry;
  - Fetch now records are stored as captured input, survive a resumed setup, and are never labelled pasted;
  - isolation: another organization's captures and lease route are 404.
- [ ] T021 [US1] Extend services/adapters/integration/verify.cjs (real Mosquitto and Node-RED):
  - capture before deploy for a tenant-broker and a vendor-broker source;
  - off-filter labelling;
  - another adapter's topic is excluded;
  - a setup credential publishing off-filter is narrowed at the first deploy;
  - a paused adapter's persistent session keeps its queue while capture runs.
- [ ] T022 [P] [US1] Add capture methods and types to packages/api-client/src/adapters.ts: `captures`, `renewCapture`, and the delivery fields `retained`, `qos`, `off_filter` and `truncated`
- [ ] T023 [US1] Build apps/portal/src/sources/steps/Connect.tsx (FR-010 to FR-013):
  - Render the registry form for the setup's connector. Examples are placeholders only (FR-010).
  - For the tenant broker, show the kit download in the step, and make topic filters optional with the hint "We'll listen to every topic your device uses".
  - Secrets are entered only in the forms and keep spec 020's storage, redaction and permissions (FR-012).
  - Save creates the draft adapter with no profile and moves the setup to `data`.
- [ ] T024 [US1] Build apps/portal/src/sources/steps/SeeData.tsx (FR-021 to FR-024):
  - Poll captures every 2 s while the step is open.
  - Each row shows time received, topic or path, size, retained flag, and the payload in a read-only `JsonEditor`, or as hex and text.
  - Show reasons with explanation and fix above the list.
  - Group off-filter messages, with **Add a filter**.
  - Offer **Paste a sample**, labelled as pasted.
  - Show **Fetch now** for polling; its records join the captured input.
  - When Sparkplug B is detected, offer the native path.
  - Renew the lease every 60 s.
- [ ] T025 [US1] Add a Playwright spec, apps/portal/e2e/journey-see-data.spec.ts, with a mocked API: tenant broker captures, credentials refused, off-filter, a pasted sample, webhook deliveries and Fetch now, with axe checks

**Checkpoint**: a person can connect any adapter connector and see its input before
defining anything.

---

## Phase 4: User Story 2 - Choose readings without code (P1)

**Goal**: map JSON input to readings with suggestions, live decoding and a generated
or reused device type. The mapping compiles to an ordinary decoder.

**Independent test**: quickstart A step 4. Three readings and a scale are set, every
sample decodes, no code is typed, and the device type lists exactly those readings
(SC-003).

- [ ] T026 [P] [US2] Add the field-mapping contract in contracts/adapters/v1/, per [field-mapping.md](contracts/field-mapping.md) (FR-030, FR-033, FR-034):
  - `field-mapping.v1.schema.json`, its fixture and its cases;
  - `field-mapping.v1.parity.json`, covering records, match rules, the three identity kinds, `/$message` pointers, time formats, scale and offset, numeric strings, missing values, `not_json`, `records_missing`, `identity_missing`, `time_invalid`, `type_mismatch` and `no_readings`;
  - `field-mapping.v1.runtime.js`: ES2020, no imports, "at most 12 KiB".

  Rules to enforce: "1–200 entries" of readings; keys matching `^[a-z][a-z0-9_]{0,62}$` and unique; `scale` non-zero; at most 8 match rules; at most 500 records. Add the files to the contracts/README.md table.
- [ ] T027 [P] [US2] Extend contracts/adapters/v1/decoder-output.v1 with the ignored result `{"ignore": true, "reason": "<code, at most 40 characters>"}` and add cases. In services/adapters/lib/decoder.cjs, `validateResults` accepts the result and counts it as `ignored` in outcomes. Tests go in services/adapters/test/decoder.test.cjs
- [ ] T028 [P] [US2] Run the parity cases through the compiled decoder in the quickjs sandbox, in services/adapters/test/field-mapping.test.cjs
- [ ] T029 [US2] Add apps/api/app/Domain/DeviceAdapters/Services/FieldMappingCompiler.php (FR-034, FR-035):
  - It reads the runtime from `devices.contracts_path` and emits canonical JSON (sorted keys, no whitespace).
  - In `AdapterService::fields`, validate `mapping` against the schema and refuse a save where `code_origin = mapping` and the code differs from the compiled mapping (422). Refuse compiled text over 64,000 characters with 422 `mapping_too_large`.
  - The revision definition gains `mapping` and `code_origin`, both inside `content_hash`.
  - Tests in apps/api/tests/Feature/Domain/DeviceAdapters/FieldMappingTest.php: byte-identical parity text, a mismatch refused, an edited code save allowed with `code_origin = code`.
- [ ] T030 [US2] Add apps/api/app/Domain/Onboarding/Services/ProfileMatcher.php and DeviceTypeService.php (FR-040 to FR-042):
  - **Matching** ranks the organization's published profiles: exact keys first, then normalised names whose units are compatible according to contracts/units/v1. It offers a profile when at least half the readings match and returns up to 5, with matched, missing and extra readings and unit differences carrying scale and offset.
  - **Drafting** creates or updates a draft profile from the readings: numbers become `measurement` and booleans and strings become `state`, each with `reports_state: true`. A stale `draft_revision` gets a 409.
  - **Routes**: `POST device-setups/{setup}/device-type/matches` (`Device.view`), and `PUT device-setups/{setup}/device-type` (`DeviceProfile.create`, or `DeviceProfile.update`), which sets the adapter's `artifact_uuid` or `draft_profile_uuid` in a new draft revision.
  - Tests in apps/api/tests/Feature/Domain/Onboarding/DeviceTypeTest.php cover the profile permissions and unit differences, plus isolation: another organization's profiles are never offered, and both routes return 404 for another organization's setup.
- [ ] T031 [P] [US2] Add the mapping library in apps/portal/src/sources/mapping/ (FR-031, FR-032):
  - `runtime.ts`, which imports the contract runtime;
  - `fieldTree.ts`: paths across samples, example values, type differences;
  - `suggest.ts`: identity, time, readings, units from the catalogue suffixes, records, all marked suggested and needing no assistant;
  - `compile.ts`: the same text as the PHP compiler;
  - `samples.ts`: hex and text.

  Vitest beside each file runs the parity cases and checks that compiled text matches the fixture.
- [ ] T032 [P] [US2] Add packages/ui/src/components/field-tree.tsx (checkable leaves, example values, type-difference and suggested badges, keyboard navigation) with a story in apps/storybook
- [ ] T033 [US2] Build apps/portal/src/sources/steps/ChooseReadings.tsx (FR-030 to FR-037):
  - The field tree, plus a readings table with key, label, type, unit (`UnitField`), scale and offset.
  - Identity from a field, a topic segment or a fixed value; the time field and its format; the records pointer; match rules.
  - Every captured and pasted sample decoded again within 1 s of a change, with each sample's result or reason, and missing values shown as missing.
  - Checked samples become fixtures with their decoded results as expected values, and **Expected to fail** is available (FR-036). At most 10 samples can be checked, the adapter test's limit.
  - The device type choice: reuse a match, or name a new type.
  - **Edit as code** opens the compiled decoder; after a code save the mapping is read-only, and **Reset to mapping** asks for confirmation.
  - Non-JSON input opens code with a starter decoder (FR-037).
- [ ] T034 [US2] Add a Playwright spec, apps/portal/e2e/journey-readings.spec.ts: suggestions with the assistant disabled, scale and offset, records list, fixed identity, reuse offer, Edit as code and Reset, and a binary payload sent to code, with axe checks

**Checkpoint**: a flat-JSON source can be mapped with no code, and its device type is
drafted or reused.

---

## Phase 5: User Story 3 - Start collecting in one step (P1)

**Goal**: one confirmed action tests, publishes, deploys and activates, in order. It
resumes after failures and hands off missing permissions.

**Independent test**: quickstart A step 5 and F step 2. The serials become active
devices with stored readings, without visiting another page.

- [ ] T035 [US3] Add `AdapterService::activateMany(adapter, candidates, user)` in apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php:
  - All installations and configurations are created in one transaction, followed by one redeploy.
  - Each device activates through `DeviceConfigurationService::activate`, so it carries the stored birth's `birth_metrics` and leaves the applied generation to the runtime (ADR-027). Only a pending request blocks a device.
  - A candidate with no stored birth is refused.
  - Add the route `POST device-adapters/{adapter}/candidates/activate` with 1–50 `{uuid, name, device_uuid?}`, needing `Device.activate`, `Device.manage` and `Device.manage-connections`. It returns 202.
  - The single-candidate route calls `activateMany` with one candidate.
  - A serial already in use elsewhere is refused.
  - Tests cover both routes and that no 409 occurs for back-to-back activations, plus isolation: both routes return 404 for another organization's adapter or candidate.
- [ ] T036 [US3] Add apps/api/app/Domain/DeviceAdapters/Jobs/AdvanceRollout.php and Services/RolloutService.php (FR-051, FR-052):
  - **Steps**, in order:
    1. `check`: test the draft against the draft profile's compiled definition.
    2. `publish`: skipped when the profile is reused or unchanged.
    3. `bind`: save a revision identical except for `artifact_uuid`, and test it.
    4. `deploy`: through the existing operation and `DeployAdapter`.
    5. `activate`: as soon as each checked serial's stored birth (Discovery candidate) exists, through `activateMany` in batches.
  - **One step per job**: each is idempotent per rollout and step, and records `actor_user_id`.
  - **Permissions** are checked when each step runs: `check`/`bind` need `Device.manage`; `publish` needs `DeviceProfile.publish`; `deploy` needs `Device.manage` and `Device.manage-connections`; `activate` also needs `Device.activate`. A missing permission sets `waiting` with the permission and sets the setup to `waiting`.
  - **Reasons**: `test_failed`, `profile_invalid`, `profile_changed`, `draft_changed`, `deploy_failed`, `permission_missing`, `serial_in_use`, and `serial_silent` after 10 minutes (it never fails the rollout).
- [ ] T037 [US3] Wire the rollout:
  - `POST device-setups/{setup}/start` takes `request_uuid`, `draft_revision` and up to 50 `serials`. It returns 202. A repeated `request_uuid` returns the same rollout, and a new one resumes a failed or waiting rollout.
  - The setup view includes the rollout, with `first_readings`.
  - `diagnosis` comes from `IngestionDiagnostics` hop times once 2 minutes have passed with no reading. Unknown hops are null (FR-054).
  - apps/api/app/Domain/Devices/Http/Controllers/RuntimeController.php dispatches `AdvanceRollout` when a stored birth (Discovery candidate) appears for a waiting serial.
  - `rollouts:advance` is scheduled every minute in apps/api/routes/console.php.
  - The setup becomes `done` and `first_reading_at` is set at the first stored reading.
  - The route is kept out of the agent-access tool catalogue (`php artisan agents:tools --check`).
- [ ] T038 [US3] Add tests in apps/api/tests/Feature/Domain/DeviceAdapters/RolloutTest.php:
  - step order;
  - nothing is published when the check fails;
  - only the bound, tested revision deploys;
  - resume at the failed step;
  - `draft_changed`;
  - the permission handoff with two users, recording each actor;
  - idempotent confirmation;
  - unchecked serials stay waiting;
  - serials that report later are listed and never activated automatically (FR-055);
  - no assistant tool can call it;
  - isolation: another organization's rollout and start route are 404.
- [ ] T039 [P] [US3] Add rollout, start, `activateMany` and first-reading types to packages/api-client/src/onboarding.ts and packages/api-client/src/adapters.ts
- [ ] T040 [US3] Build apps/portal/src/sources/steps/StartCollecting.tsx (FR-050, FR-053, FR-054):
  - A summary of the device type to publish or reuse with its readings, the decoder with each sample's result, the settings without secrets, and the serials with checkboxes.
  - **Start collecting** in a `ConfirmDialog`.
  - Progress through the four labelled steps with `Status`.
  - A waiting state naming the permission.
  - A success state with first readings (`RelativeTime`) and **Open device**, **Add a dashboard**, **Create an alert** and **Add another of this type**.
  - The diagnosis view.
- [ ] T041 [US3] Add a Playwright spec, apps/portal/e2e/journey-collect.spec.ts: the summary, confirm, progress, a failure and its resume, the permission wait, success, and diagnosis, with axe checks

**Checkpoint**: US1–US3 complete. Quickstart A runs end to end in the rebuilt stack (the
MVP).

---

## Phase 6: User Story 5 - The assistant carries the setup in the conversation (P1)

**Goal**: from a description, the assistant takes the person through every step in
one conversation. Each step ends in an action card whose button the person presses
there, and the conversation survives every approval and page change. It never presses
a card or runs Start collecting.

**Independent test**: quickstart G (SC-011, SC-012).

- [ ] T042 [US5] Change apps/api/app/Domain/Assistant/Tools/OnboardingTools.php, per [onboarding-tools.md](contracts/onboarding-tools.md) (FR-072, FR-073, FR-132 to FR-134):
  - **`suggest`** takes `{card, step, fields, summary, evidence}` for every card kind. It validates `fields` with the step's save rules and refuses any secret value; `credentials` and `secret` cards name fields only.
  - **New `explain`**: returns the reasons with catalogue text and redacted evidence.
  - **`recommend_path`** creates a `connector` card for available connectors.
  - **`status` and `samples`** work for a setup with no source.
  - **`test_decoder`** accepts `mapping` (through `FieldMappingCompiler`) and inline `fixtures` (1–10) built from pasted or captured samples.
  - **`find`** returns match facts.
  - **`propose_adapter` reuse** is refused unless the device type matches and `settings_match` is `same`.
  - **`ask_questions`** never makes optional questions block, and refuses a question whose id was answered in the conversation.
  - **`next_step`** is removed.
- [ ] T043 [US5] Apply cards from the step routes (FR-072, FR-074, FR-110, FR-130):
  - **Proposal model**: the OnboardingProposals service handles `step` proposals with `card`, `state` (`open`, `applied`, `out_of_date`, `dismissed`) and `result`. `content_hash` covers `card`, `step` and `fields`.
  - **Routes that accept `suggestion: {uuid, content_hash}`**:
    - setup `PATCH`, adapter `POST`/`PUT` and `PUT device-setups/{setup}/device-type`;
    - the webhook secret route and the hardware credential (kit) route;
    - the native onboarding routes;
    - `POST device-setups/{setup}/start` and `POST device-adapters/{adapter}/candidates/activate`.
  - **What each route does with it**: refuses a stale hash with 409; records `applied`, `applied_revision` and a `result` that never holds a secret; adds the event message; and queues the continuing run.
  - **Dismissing**: add `POST device-setups/{setup}/cards/{proposal}/dismiss` and `GET device-setups/{setup}/cards`.
  - **Staleness**: a saved draft newer than a card marks it `out_of_date`.
  - **Measurement**: count `cards_applied` and `form_saves`, and set `assistant_used`.
  - **Who can call them**: the start, activate, secret and credential routes stay session-only, out of the tools and the agent-access catalogue.
  - **Client**: packages/api-client/src/onboarding.ts gains the card, conversation and dismiss types and methods, and the `suggestion` argument on step saves (principle IV).
- [ ] T044 [US5] Keep one conversation per setup (FR-071):
  - Make `assistant_conversations.device_setup_id` unique for onboarding conversations.
  - Add `GET device-setups/{setup}/conversation`, which creates the conversation if needed.
  - apps/api/app/Domain/Assistant/Http/Controllers/AssistantController.php binds conversations to setups, and the source binding follows.
  - Resolving a conversation from a source, a draft device type or a device created by the setup returns the setup's conversation.
- [ ] T045 [US5] Let the assistant draft a device type from what the person said (FR-134). Profile drafting (`ProfileAssistantTools`, `ApplyProfileSection`) accepts the evidence origin `stated` (citing the person's message) for onboarding conversations. A `device_type` card with `draft` creates the draft profile through `DeviceTypeService` only when the person applies it
- [ ] T046 [US5] Add the native Sparkplug B cards (FR-135):
  - `native_device`: name, connector and device type. Applying it starts and provisions the onboarding through the existing routes, then offers the kit.
  - `native_matches`: applying it saves and validates the configuration.
  - **Activate** uses the `activate` card. The routes are apps/api/app/Domain/Devices/Http/Controllers/OnboardingController.php and the device configuration routes, with `suggestion`.
- [ ] T047 [US5] Update the instructions and context in apps/api/app/Domain/Assistant/Agents/OnboardingAssistant.php (FR-130, FR-132):
  - **Instructions**:
    - the four steps and the connectors from their definitions;
    - one card per step;
    - continue after each applied card and say the step reached and what is left;
    - never re-ask a known fact;
    - reuse only on a match;
    - secrets are typed or created only in cards;
    - never press a card or run Start collecting, Apply changes or any of their steps.
  - **Context**: the setup's steps, its open and applied cards, and the known facts (answers, attachments, the captured input summary and the latest Fetch now).
- [ ] T048 [US5] Add tests in apps/api/tests/Feature/Domain/Assistant/OnboardingCardsTest.php, with the agent faked (FR-071 to FR-075, FR-130 to FR-136):
  - every action's permission and setup binding;
  - one conversation per setup, surviving an applied card;
  - every card kind applies once through its route, and a stale hash gets a 409;
  - the event message queues the continuing run;
  - `credentials` and `secret` cards never carry or store a value, and the conversation and `result` never contain one;
  - reuse is refused without a match;
  - a re-asked question is refused, and an optional one never blocks;
  - `test_decoder` works with inline fixtures;
  - `stated` profile drafting;
  - the native cards;
  - no tool path to the start, activate, secret or credential routes;
  - isolation of setups, conversations and cards;
  - SC-010 and SC-012 across spec 020's evaluation fixtures plus one setup per connector, including a Sparkplug B direct device.
- [ ] T049 [P] [US5] Add the kit components, each with a story in apps/storybook:
  - packages/ui/src/components/action-card.tsx: a title, what it changes, a values preview, optional embedded fields (password inputs, serial checkboxes), the primary control, **Show code**, **Dismiss**, and the states `open`, `applied` (with result), `out_of_date` and `dismissed`;
  - packages/ui/src/components/suggested-value.tsx;
  - packages/ui/src/components/suggestion-bar.tsx.
- [ ] T050 [US5] Turn apps/portal/src/adapters/OnboardingAssistant.tsx into the setup conversation (FR-071, FR-072, FR-075, FR-130, FR-131, FR-136, FR-137):
  - **Finding the conversation**: it comes from the page's setup, source, draft device type or new device (`GET device-setups/{setup}/conversation`), not from a handoff. It stays open across navigation and applied cards. Journey entry points stop using `startTask(..., { fresh: true })`.
  - **Cards**: every card kind renders as an `ActionCard`:
    - `credentials` with password fields posting to the adapter save;
    - `secret` showing the value once in browser state only;
    - `kit` with the download;
    - `mapping` and `code` with each sample's decoded values (code behind **Show code**);
    - `device_type` with matched, missing and extra readings;
    - `start` embedding the Start collecting summary and the rollout progress;
    - `activate` with checkboxes and one batch press.
  - **Progress**: the step reached and what is left, shown above the messages.
  - **Panel behaviour**: messages typed during a run are queued, Escape closes only the innermost picker, and replies are de-duplicated by id.
- [ ] T051 [US5] Show the same proposals in the step forms (FR-070, FR-072):
  - apps/portal/src/sources/steps/Connect.tsx, ChooseReadings.tsx and StartCollecting.tsx render open cards as `SuggestedValue`s with `SuggestionBar`, send `suggestion` on save, and show `out_of_date` cards as refreshed.
  - The start box posts to the setup conversation when the assistant is enabled; attachments are offered only then.
- [ ] T052 [US5] Add a Playwright spec, apps/portal/e2e/journey-assistant.spec.ts, with a mocked API (SC-009, SC-011):
  - **For each of** the tenant broker, webhook, polling and Sparkplug B direct connectors, a scripted conversation drives the cards to first readings without the person leaving the panel, and the conversation survives every applied card and navigation.
  - **Secrets**: the secret card shows the value once, and it is never in the transcript.
  - **Panel behaviour**: an out-of-date card refreshes, a queued message is sent after the run, and Escape closes only the picker.
  - **Presses**: the assistant never presses a card.
  - **Assistant disabled**: no cards are offered and every step works.
  - axe checks.

---

## Phase 7: User Story 4 - One start, in the person's words (P2)

**Goal**: one start screen with no protocol names, the same four steps for every
path including native Sparkplug B, and resumable unfinished setups.

**Independent test**: quickstart E and F step 1.

- [ ] T053 [US4] Build apps/portal/src/sources/StartScreen.tsx (FR-001, FR-002, FR-006):
  - The answers come from `GET connectors` as `ChoiceCard`s, following the table in [connectors.md](contracts/connectors.md), and none names a protocol.
  - Each answer shows what the person needs and what happens next before they continue.
  - Unavailable connectors are shown with their reason.
  - "It's on a local plant network" explains the edge-gateway path.
  - "It's already sending" lists the waiting sources.
  - "I'm not sure" offers a start box that takes a pasted message, which becomes a pasted sample.
  - With adapters disabled, only the native paths are shown (FR-006).
- [ ] T054 [US4] Move the native steps from apps/portal/src/devices/DeviceOnboarding.tsx to apps/portal/src/sources/native/ (FR-003):
  - Connect is start, provision and `ConnectionKit`.
  - See data is the `devices/{device}/onboarding` check.
  - Choose readings is `MappingTable`/`MetricPicker` with validation.
  - Start collecting is activation.
  - The API calls stay the same, the `sessionStorage` form state goes away, and the setup references the onboarding.
  - Delete DeviceOnboarding.tsx once nothing imports it.
- [ ] T055 [US4] Add redirects and entry points:
  - `devices/onboard` and `devices/onboard/:deviceUuid` redirect to `/devices/add`, mapping `?mode=` to a connector and keeping `?profile=`.
  - The Data sources create action and the waiting sources (Discovery, `OnboardSource`) open the journey (FR-005).
- [ ] T056 [US4] List unfinished setups (FR-004):
  - apps/portal/src/sources/UnfinishedSetups.tsx goes on the Devices page, with **Resume** opening the step reached and **Discard** for drafts nothing uses.
  - apps/api/app/Domain/Overview/OverviewQuery.php adds `setups.unfinished`, and packages/api-client/src/overview.ts adds the field.
  - Home's attention list in apps/portal/src/home/HomePage.tsx gains the row.
- [ ] T057 [US4] Add a Playwright spec, apps/portal/e2e/journey-start.spec.ts:
  - no answer contains a protocol name;
  - needs are shown;
  - an unavailable webhook gives its reason;
  - adapters disabled leaves only the native paths;
  - native Sparkplug B goes through the four steps;
  - resume from the Devices page;
  - old URLs redirect;
  - from start to first stored reading the journey never navigates to Device
    profiles, Discovery or Connections (SC-006);
  - axe checks.

---

## Phase 8: User Story 6 - Setup, then manage (P2)

**Goal**: collecting sources open in Manage, with one status sentence and drafts that
apply in order. Statuses and counts never contradict each other.

**Independent test**: quickstart F step 3.

- [ ] T058 [US6] Add the mode and status sentence in apps/api/app/Domain/DeviceAdapters/Services/AdapterDiagnostics.php (FR-060, FR-062):
  - `status` returns `{tone, sentence, hop, since}`, with the worst problem first:
    1. deploy failed;
    2. source stopped;
    3. rejecting deliveries;
    4. decode failures;
    5. paused;
    6. deploy pending;
    7. "Receiving from N devices · last message T";
    8. "No input yet".
  - `mode` is `manage` with an applied revision and at least one active installation, and `setup` otherwise.
  - Both go into the adapter view and index; `source_state` is kept.
  - Tests in apps/api/tests/Feature/Domain/DeviceAdapters/StatusTest.php cover each precedence and the contradiction case "Running" with "credentials rejected".
- [ ] T059 [US6] Count waiting sources one way: move the adapter node-level filter into `DiscoveryCandidate::availableToOnboard()` in apps/api/app/Domain/Devices/Models/DiscoveryCandidate.php, and remove the separate filter from DiscoveryController. Add a test that the overview, `discovery-candidates?available=1` and the Devices page count the same rows (FR-065)
- [ ] T060 [US6] Make Manage drafts capture:
  - In services/adapters/manager.cjs, `/deploy` takes `capture_until`.
  - In services/adapters/nodes/adapter.js, the deployed source copies raw input to the reporter while `capture_until` holds.
  - Add the route `POST device-adapters/{adapter}/capture` (`Device.manage`).
  - Add a node test and an API test; the API test includes isolation (404 for another organization's adapter).
- [ ] T061 [US6] Add Apply changes: `POST device-adapters/{adapter}/apply` runs a rollout of kind `apply` (no activation step), and the applied revision keeps running until the new one is applied. Add tests in RolloutTest.php, including isolation (404 for another organization's adapter) (FR-064)
- [ ] T062 [US6] Build the Manage pages (FR-061, FR-063, FR-064):
  - apps/portal/src/sources/Manage.tsx shows the status sentence first, then the sections devices (with waiting serials and batch activation), readings and device type, activity (reusing `adapters/Activity.tsx`), settings and credentials, revisions with rollback and pause, and delete.
  - Setup shows no revision hash, rollback, pause, publisher state or revision numbers (FR-061).
  - Changing readings or settings opens a draft that reuses SeeData and ChooseReadings and ends in **Apply changes**.
  - apps/portal/src/sources/DataSources.tsx is the list (`CollectionPage` with `DataTable`) with one status column.
- [ ] T063 [US6] Rename and remove the old workbench:
  - In apps/portal/src/App.tsx, **Device adapters** becomes **Data sources** at `/data-sources`, with the waiting badge from the one scope, and `/device-adapters/*` redirects.
  - Remove apps/portal/src/adapters/SetupChecklist.tsx and the workbench tabs in apps/portal/src/adapters/Routes.tsx that became steps or sections.
  - Journey copy uses "device type", "readings" and "device ID field" (FR-100).
- [ ] T064 [US6] Add a Playwright spec, apps/portal/e2e/manage.spec.ts: Manage opens for a collecting source; Setup opens at its step; one status; a draft goes through Apply changes; the list shows one status; the badge and Add device counts are equal; the rename and redirects work. Include axe checks

**Checkpoint**: the journey pull request is complete once phases 1–9 are done.

---

## Phase 9: Polish and verification (journey pull request)

- [ ] T065 [P] Add a vendor-broker mode to tooling/simulators/vendor_env_sensor.py: `--broker`, `--username` and `--password`, with pytest cases in tooling/simulators/test_vendor_env_sensor.py. Add tooling/simulators/sparkplug_direct_meter.py, a direct Sparkplug B device that is its own edge node (NBIRTH with readings, NDATA, rebirth on NCMD), from the walkthrough's local simulator, with pytest cases. Update docs/dev/simulators-and-fixtures.md with each adapter connector's flat-JSON simulator and the direct meter (FR-122)
- [ ] T066 [P] Add tooling/verify-onboarding.mjs, which drives quickstart A–C through the API and fails on any missed time limit (SC-001, SC-002, SC-004)
- [ ] T067 Update the docs (FR-121):
  - docs/features/adapters.md, devices.md and assistant.md;
  - the onboarding journey diagram;
  - the developer docs pages on adapters in apps/docs;
  - docs/dev/gotchas.md (the capture client id on vendor brokers, plus anything surprising).

  Then run `python tooling/docs/check_links.py`.
- [ ] T068 Update the OpenAPI description: run `php artisan contract:export`, update the supplements in contracts/openapi/supplements/ for the new errors (`mapping_too_large`, `not_applicable`, rollout reasons), run `php artisan contract:check`, and run `php artisan agents:tools --check` (FR-120)
- [ ] T069 Run `./taskw lint`, `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/admin lint`, `cd apps/api && php artisan test --compact`, `cd services/adapters && npm test` and the adapter integration test, and `tooling/verify-devices-contracts.py`
- [ ] T070 Rebuild and verify:
  - Rebuild the adapter overlay (adapter-manager, webhook-receiver, adapter-runtime-image, the API family and the portal) following .agents/skills/local-container-verification/SKILL.md.
  - Run quickstart A–G against the simulators, with the assistant enabled and then disabled.
  - Record results and screenshots in the pull request.

---

## Phase 10: User Story 7 - Add another device of a known type (P3)

**Goal**: a second device of a known type takes under 2 minutes, and copying a
setup is safe.

**Independent test**: quickstart H steps 1–2 (SC-007).

- [ ] T071 [US7] Add the `another` and `copy` kinds to apps/api/app/Domain/Onboarding/Services/SetupService.php (FR-090 to FR-092):
  - `another` with a tenant broker creates a new hardware credential and kit (`Device.manage-connections`), and its steps are Connect, See data (waiting for a new serial) and Start collecting, with no Choose readings. With a cloud source, it shows the waiting serials and says no new connection is needed.
  - `copy` (`POST device-adapters/{adapter}/copy` or `copy_from_adapter_uuid`) creates a draft through `AdapterService::store`. It copies the settings without secrets, the mapping or code, the fixtures and the device type; a webhook copy gets a new ingest identifier and no secret; and the copy must pass its own test.
  - Tests in apps/api/tests/Feature/Domain/Onboarding/ReuseTest.php: no secret in any copy, a new ingest identifier, isolation (copying another organization's adapter is 404).
  - Add `copyDeviceAdapter` and the `another`/`copy` setup options to packages/api-client/src/adapters.ts and onboarding.ts, then run `php artisan contract:export` and `php artisan contract:check` (principle IV).
- [ ] T072 [US7] Show **Add another of this type** on the start screen (for device types the organization collects), on the device type, in Manage and in the success state, and **Start from an existing setup** on the start screen. Files: apps/portal/src/sources/StartScreen.tsx, Manage.tsx and steps/StartCollecting.tsx, and the profile page. Add a Playwright case in apps/portal/e2e/journey-start.spec.ts (FR-090)

## Phase 11: User Story 8 - New connectors use the same journey (P3)

**Goal**: a connector is added through its definition alone.

**Independent test**: quickstart H step 3 (SC-008).

- [ ] T073 [US8] Add the test-only connector (FR-082):
  - apps/api/app/Domain/Onboarding/Connectors/LabMqtt.php is registered only when `IOT_ONBOARDING_TEST_CONNECTORS=true`. It uses broker capture and the field mapping with a fixed-topic form, registered in apps/portal/src/sources/connectors.tsx.
  - A test in ConnectorTest.php shows that adding it touched only the definition, the form entry and the config.
  - A Playwright case in journey-start.spec.ts takes it through all four steps.
- [ ] T074 [US8] Document adding a connector, following the four-item list in [connectors.md](contracts/connectors.md), in docs/dev/ and the developer docs in apps/docs. Reserve `point_map` for the first typed connector (ADR-023)

---

## Phase 12: Measurement and verification (reuse pull request)

- [ ] T075 PR 3. Add measurement (FR-110):
  - `step_times`, `assistant_used`, `code_edited` and `first_reading_at` must be recorded at every step (check the T009, T029, T037 and T043 paths), with `cards_applied` and `form_saves`.
  - Add apps/api/app/Domain/Onboarding/Admin/OnboardingSummaryController.php for `GET /api/admin/onboarding/summary?from&to` (platform administrators, range at most 366 days). It returns per connector the setups started, reached each step and completed; the median minutes to first reading; and the assistant, in-conversation (`cards_applied`) and code shares. It holds no payloads, names or organization identifiers.
  - Add `setups:prune` daily: "`done` setups go 365 days after `completed_at` and `discarded` setups after 30 days".
  - Tests in apps/api/tests/Feature/Domain/Onboarding/SummaryTest.php cover access and the absence of identifiers.
  - Run `php artisan contract:export` for the summary route; T076 adds its client method in the same pull request (principle IV).
- [ ] T076 [P] PR 3. Add apps/admin/src/onboarding/OnboardingPage.tsx, a `DataTable` of the summary per connector with a date range, with the client method in packages/api-client and a nav entry for platform administrators
- [ ] T077 PR 3. Run `php artisan contract:check`, `php artisan agents:tools --check`, `cd apps/api && php artisan test --compact`, and `pnpm --filter @iot-os/portal lint` and `pnpm --filter @iot-os/admin lint`. Then rebuild the API family, portal and admin, and run quickstart H and I

---

## Dependencies

- **Phase 1 → Phase 2 → stories.** T002 (the log spike) blocks T017. T004 blocks T031.
- **US1 (phase 3)** blocks US2, because Choose readings reads captured and pasted
  samples.
- **US2** blocks US3, because Start collecting needs a mapping and a device type.
- **US5** applies its cards through the step routes and forms of US1–US3.
  - Its API tasks (T042–T048) can start after phase 2.
  - Its portal tasks (T050–T052) follow US3.
  - Its native cards (T046) use today's native onboarding routes and do not wait for
    US4.
- **US4** needs US1–US3 for the adapter paths. Its native steps (T054) can start
  after phase 2.
- **US6** needs US3's rollout for Apply changes (T061). T058 and T059 can start
  after phase 2.
- **US7** needs US3 and US4. **US8** needs phase 2 and US1's capture.
- **Ordering**: T065–T070 come after the stories they verify. T075–T077 belong to
  PR 3, after US7 and US8.

## Parallel opportunities

- **Phase 2**: T011 and T012 alongside T008–T010.
- **US1**: T014 and T017 alongside T015; T022 alongside the API tasks.
- **US2**: T026, T027 and T028 (contracts and adapter services), T031 (portal
  library) and T032 (kit) together; then T029 and T030 (API) beside T033 once T031
  is done.
- **US3**: T039 alongside T035–T038.
- **US5**: T049 (kit) alongside T042–T048 (API).
- **Across stories**: T042–T048 (assistant API), T054 (native steps) and T058–T059
  (status and count) can run beside US2 and US3 because they touch different files.

## Implementation strategy

1. **MVP**: phases 1–5 (US1–US3). Check quickstart A in the rebuilt stack: a
   tenant-broker device reaches stored readings with no code.
2. **The assistant next** (US5, phase 6), the owner's priority. Check quickstart G in
   the rebuilt stack: each simulator reaches stored readings with presses only in the
   conversation (SC-011). Show it to the owner before continuing.
3. **Complete the journey** with US4 (start screen and native paths) and US6 (Manage
   and statuses), then phase 9 (T065–T070). That completes PR 2.
4. **PR 3**: US7 and US8, then measurement (T075–T077), cut from `main` after PR 2
   merges.
