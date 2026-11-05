# Tasks: Firmware Starter Kits

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/starter-layout.md](contracts/starter-layout.md),
[contracts/platform-api.md](contracts/platform-api.md),
[contracts/device-brief.md](contracts/device-brief.md), [quickstart.md](quickstart.md)

The work ships as four pull requests of this spec against `main` (plan § Delivery). None
is stacked: each is opened only after the PRs it depends on have merged. Spec 026's
PR 026-4 (the NXP target) and PR 026-2 (the gateway itself) are listed in the
dependencies but tasked in [spec 026](../026-embedded-gateway-sdk/tasks.md).

Before each PR is opened, run a leak scan: no partner, product or person names; no hosts
other than `example.com`/`.test`; no local home paths.

Tests are part of this feature (spec SC-005, SC-008; plan § Testing), so test tasks
appear in each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**:
  - US1: download a starter
  - US2: AI coding agent interview
  - US3: connection settings and full kits
  - US4: firmware where work starts (gateway, onboarding)
  - US5: the assistant offers firmware
  - US6: keep a project current
- Paths are from the repository root. `Firmware/` means `apps/api/app/Domain/Firmware/`.

---

## PR 027-0: Documents

### Phase 1: Documents

- [x] T001 ADR-030 (Proposed) in `docs/adr/ADR-030-firmware-starters.md`, its row in `docs/adr/README.md`, and "Proposed; amended by ADR-030" in ADR-029's status line and row
- [x] T002 `specs/027-firmware-starter-kits/`: spec, checklist, plan, research, data model, three contracts, quickstart, tasks
- [x] T003 Spec 026 amendments: notes in `specs/026-embedded-gateway-sdk/contracts/kit-layout.md`, `plan.md` § Delivery and `tasks.md` (PR 2, Phase 10, PR 4, dependency table), and PR 4's T082, T084, T085, T089, T090 and T091 rewritten for the NXP starter target
- [x] T004 Add spec 027 to `docs/roadmap.md` under "Devices and adapters", after spec 026
- [x] T005 Leak scan the documents, run `python3 tooling/docs/check_links.py`, then open the documents PR against `main`

**Checkpoint**: PR 027-0 merged. PR 027-1 can start.

---

## PR 027-1: Generator, Linux target, AI brief, settings and kits

### Phase 2: Foundation (blocks every story)

- [x] T006 Create `firmware/starters/targets.json` with entries for `linux` (built, `example: "linux-app"`, `developer_paths: ["app/"]`, `toolchain: "CMake 3.31, GCC 13 (ubuntu-24.04 runner)"`), `stm32`, `rpi-pico`, `nordic-nrf` and `other` (AI-assisted, `developer_paths: ["app/"]`, `family_notes` for the first three, `null` for `other`). The data model's rules apply: `id` matches `[a-z0-9-]{2,40}` and is unique; `kind` is `built` or `ai_assisted`; `roles` is a non-empty subset of `direct`, `gateway`; `example` and `toolchain` only on built targets; `family_notes` only on AI-assisted ones; `order` is an integer within its group.
- [x] T007 [P] `contracts/firmware/v1/starter-manifest.schema.json` (draft 2020-12), exactly the fields in data model § Starter manifest:
  - `format` const 1;
  - `generated_at` RFC 3339;
  - `node` is either a profile reference or `{default_health: true}`;
  - `metrics` and `retired` keyed by profile code;
  - `warnings[]` of `{code, message, subject}`;
  - `additionalProperties: false` at the top level;
  - no property may hold a credential, broker address or device identity.
- [x] T008 [P] `contracts/firmware/v1/device-brief.schema.json` (draft 2020-12) from data model § Device brief:
  - `format` const 1;
  - the `Metric.source` kinds `modbus|analog|digital|i2c|spi|can|pulse|computed|unknown`, each with its required fields (`modbus` requires `function`, `register`, `type`; `byte_order` and `word_order` default to `big`);
  - `unknown` allowed for any leaf fact;
  - `unconfirmed[]`;
  - the cross-checks the schema cannot express, listed in the schema's `description`.

  Add `device-brief.fixture.json` and `device-brief.cases.json` beside it, the examples named in the [device brief contract](contracts/device-brief.md).
- [x] T009 [P] `contracts/firmware/fixtures/profiles/`: published-artifact fixtures in the API's artifact `definition` shape, each listing every published revision:
  - `direct-sensor.json` (two number metrics with units);
  - `relay.json` (revision 1, and revision 2 adding a metric and changing a unit; one boolean metric with `accepts_command: true`);
  - `water-meter.json` and `energy-meter.json` (gateway device types);
  - `wide-64.json` (exactly 64 reported metrics);
  - `wide-65.json` (65, for the limit test).
- [x] T010 `tooling/verify-devices-contracts.py`:
  - both firmware schemas, their fixtures and cases are checked like every versioned contract (no script change);
  - check every `fixtures/profiles/*.json` has `revisions[]`.

  Add tests in `tooling/contracts/test_verify.py` for a passing set, an invalid brief that wrongly passes, and a missing schema.
- [x] T011 Put the firmware sources in the API image (research R15):
  - `.dockerignore`: `!firmware/sdk` and `!firmware/starters` after the `firmware` exclusion;
  - `COPY firmware/sdk /var/firmware/sdk` and `COPY firmware/starters /var/firmware/starters` in `deploy/docker/api/Dockerfile` and `deploy/docker/api/Dockerfile.release`;
  - `apps/api/config/firmware.php` with `path`: `base_path('../../firmware')` when it is a directory, otherwise `/var/firmware`, mirroring `devices.contracts_path`.
- [x] T012 Create the `Firmware` domain:
  - `Firmware/routes/api.php`, required from `apps/api/routes/api.php` like the other domains, inside the organization route group used by `Domain/Devices/routes/api.php`;
  - `Firmware/Services/FirmwareArchive.php`: the `PharData` ZIP in a `0700` temporary directory removed in `finally`, moved from `Domain/Devices/Services/DeviceConnectionKit.php`, which now calls it and returns byte-identical file contents.
- [x] T013 [P] `Firmware/Services/TargetRegistry.php`: read `targets.json` under `config('firmware.path')` and validate entries against T006's rules (throw on an invalid registry). `available()` drops built targets whose `firmware/sdk/examples/<example>` is missing and named AI-assisted targets whose notes file is missing, and keeps `other`. Sort built targets first, then by `order`.
- [x] T014 [P] `Firmware/Services/MetricTables.php`:
  - from an artifact `definition`, keep parameters with `reports_state` true and `kind` not `derived`;
  - map types per spec 026 research R20 (boolean→Boolean, integer→Int64, number→Double, enum|string→String, timestamp→DateTime, bytes→Bytes);
  - `writable` = `accepts_command`;
  - render `generated/iotos_type_<id>.h` exactly as spec 026's kit layout § `iotos_type_<code>.h`, with identifiers `[a-z0-9_]` and a numeric suffix on a clash;
  - render `generated/iotos_types.h` and `generated/iotos_types.c`, defining `iotos_kit_types[]`, `IOTOS_KIT_TYPE_COUNT` and `iotos_kit_node_type`;
  - render `generated/profiles/<code>.json` with key, label, description, datatype, unit, writable, enum values, min and max;
  - for the gateway default health table, use the names in `firmware/sdk/include/iotos/iotos_health.h`.
- [x] T015 [P] `Firmware/Services/MetricHistory.php`, from a profile's published artifacts in revision order:
  - per current key: `introduced_in` (first revision containing the key) and `changed_in` (last revision whose datatype or unit differs from the one before);
  - per removed key: `retired_in`.
- [x] T016 [P] Add `firmware/sdk/starter/settings_missing.c` (an `iotos_settings` with empty strings and `const int iotos_kit_settings_present = 0;`) and a `CHANGELOG.md` "Unreleased" entry. Split the desktop simulator's `examples/desktop-simulator/sample-config/` so the node type comes from `iotos_types.c` (`iotos_kit_node_type`) and `iotos_kit_settings` (still `const`) leaves `node_type` NULL; the simulator's `main.c` copies the settings into a mutable `iotos_settings` and sets `node_type = &iotos_kit_node_type`. Kit mode reads `generated/` and `config/` beside `sdk/` when built from a starter, keeping the `IOTOS_CONFIG_DIR` override. `ctest` stays green.
- [x] T017 Unit tests `apps/api/tests/Unit/Domain/Firmware/{TargetRegistryTest,MetricTablesTest,MetricHistoryTest}.php` against T009's fixtures:
  - registry validation and availability;
  - type mapping and identifier clashes;
  - `relay.json` history (the added metric's `introduced_in: 2`, the unit change's `changed_in: 2`).

**Checkpoint**: the generator's building blocks are tested; stories can start.

### Phase 3: User Story 1, download a starter (P1) 🎯 MVP

**Goal**: a signed-in member downloads a credential-free starter for a published profile and a target, and it builds as shipped.

**Independent test**: `php artisan test --compact --filter 'Starter|Targets|SecretScan'`, then quickstart 2.

- [x] T018 [US1] Add `firmware/sdk/examples/linux-app/`:
  - `CMakeLists.txt` that finds the SDK at `sdk/` (starter) or `../..` (repository), the tables at `generated/`, and compiles `config/iotos_settings.c` when present or `sdk/starter/settings_missing.c` otherwise (research R4);
  - the POSIX ports;
  - `#if IOTOS_KIT_SETTINGS_FORMAT != 1` then `#error "These connection settings need a newer starter"` when settings are present (constitution IV);
  - the executable is named `app`;
  - `app/main.c`: copies the `const` `iotos_kit_settings` into a mutable `iotos_settings` and sets `node_type = &iotos_kit_node_type`; if `!iotos_kit_settings_present`, print "No connection settings: download them from the device's page in IoT OS and put the files in config/" and return 2. Otherwise connect, register `iotos_kit_types`, add the node or the devices listed in `field_devices` in `app/field.c`, and poll, putting only metrics whose `field_read` succeeds (research R9).

  In the repository it builds against `examples/desktop-simulator/sample-config` for CI.
- [x] T019 [US1] Add the starter templates in `firmware/starters/templates/`:
  - `README.md.tmpl`: quickstart, build command, where settings go, the update steps naming the replaceable paths, and a "Start with AI" placeholder filled by T032;
  - `gitignore.tmpl`: `config/*`, `!config/README.md`, `build/`, plus a per-target `{{gitignore_extra}}`;
  - `config-README.md`, shared by starters and connection settings;
  - `CLAUDE.md.tmpl` (`@AGENTS.md`; named so Claude Code does not load it inside this repository).

  Use `{{name}}` placeholders only. The renderer gets starter facts and nothing else.
- [x] T020 [US1] `Firmware/Services/FieldStubs.php`: render `<developer path>/field.h` and `field.c` from the profiles. Per metric, `field_read_<type>_<metric>(const char *device_id, iotos_value *out)` returns `FIELD_UNAVAILABLE`. Per writable metric, `field_command_<type>_<metric>(...)` returns `FIELD_REJECTED`. Add dispatchers `field_read(type, index, device_id, out)` and `field_command(...)`, and render `device-brief.example.yaml`, annotated for these profiles. No stub returns a value.
- [x] T021 [US1] `Firmware/Services/StarterBuilder.php` (pure; no database or auth):
  - input: a target, a role, node and device-type artifact definitions with their histories, and the SDK path;
  - output: a file map plus the manifest, exactly as the [starter layout](contracts/starter-layout.md) describes;
  - root folder `<code>-<target>-starter/`;
  - copy `sdk/` (include, src, ports, third_party, starter, `examples/desktop-simulator/` without `sample-config/`, LICENSE, THIRD_PARTY.md, CHANGELOG.md, VERSION), `generated/` (T014), `.iotos/` (the brief schema from `contracts/firmware/`, `porting.md`, and `family.md` for named AI-assisted families), the target example's project files at the root, and the developer path (`main.c` from the example, `field.*` and `device-brief.example.yaml` from T020);
  - AI-assisted targets get no build files and `app/ports/` copies of `firmware/sdk/ports/templates/*`;
  - manifest `replaceable: ["sdk/", "generated/", ".iotos/", "AGENTS.md", "CLAUDE.md"]`;
  - warning `birth_over_tx_buffer` when a type's DBIRTH at the default ID length would exceed 4096 bytes;
  - refuse more than 8 device types (`IOTOS_MAX_DEVICE_TYPES`) and more than 64 metrics in a type (`IOTOS_MAX_METRICS_PER_TYPE`), naming the macro.
- [x] T022 [US1] `Firmware/Http/Controllers/FirmwareTargetController.php@index`, behind `DeviceProfile.view-any`: returns `TargetRegistry::available()` as in [platform-api](contracts/platform-api.md) § `GET firmware/targets`.
- [x] T023 [US1] `Firmware/Http/Requests/FirmwareStarterRequest.php` and `Firmware/Http/Controllers/FirmwareStarterController.php@store` (`POST firmware/starters`, `throttle:10,1`):
  - **Request rules**:
    - `target` in the available ids that support `role`;
    - `role` in `direct|gateway`;
    - `device_type_artifact_uuids` prohibited for `direct`, and 1–8 distinct uuids for `gateway`;
    - `node_artifact_uuid` required for `direct`, nullable for `gateway`.
  - **Lookup and permissions**: resolve every artifact as a published revision of a profile in the route's organization (404 otherwise) and check `DeviceProfile.view` on each.
  - **Response**: build with `StarterBuilder`, zip with `FirmwareArchive`, and return `{filename, manifest, archive_base64}` with `Cache-Control: no-store, private` and `Pragma: no-cache`.
  - **Not recorded** in the activity log.
  - `gateway_uuid` is accepted here but handled in T042.
- [x] T024 [US1] `Firmware/Console/StarterFixtures.php`: `php artisan firmware:starter-fixtures --output=<dir>` builds, with `StarterBuilder` and no database, a starter for every available target and supported role from `contracts/firmware/fixtures/profiles/*.json`. The direct role uses `direct-sensor` and `relay`; the gateway role uses `water-meter` plus `energy-meter`. Unpack each into `<dir>/<target>/<role>/`.
- [x] T025 [US1] Golden outputs (research R19): add `--golden` to `firmware:starter-fixtures`, writing `contracts/firmware/fixtures/expected/direct-relay-r2-linux/` and `gateway-water-energy-linux/` (`generated/`, `iotos-starter.json` without `generated_at`, and the developer path's `field.c`, `field.h`, `device-brief.example.yaml`) and listing them in `contracts/firmware/fixtures/expected/cases.json`. Add `apps/api/tests/Feature/Domain/Firmware/GoldenOutputTest.php`, which regenerates every case and compares byte for byte. Extend `tooling/verify-devices-contracts.py` and its tests to check that every case in `cases.json` exists and is complete.
- [x] T026 [P] [US1] Feature tests in `apps/api/tests/Feature/Domain/Firmware/`:
  - `TargetsTest`;
  - `StarterTest`:
    - the layout per target and role;
    - a draft artifact gives a 404;
    - limits give a 422 naming the macro;
    - a gateway with default health;
    - determinism: two builds equal in every file except `generated_at`;
    - `relay` revision 2 history;
  - `StarterTenantIsolationTest` (another organization's artifact gives a 404; a member can download; an unauthenticated request gets 401);
  - a performance case: a gateway starter of 8 distinct 64-metric types (copies of `wide-64.json` with different codes, made in the test) is generated in under 3 s with an archive under 2 MB;
  - `SecretScanTest`: create a provisioned gateway and a direct device. Unpack starters for every target and role, and fail if any file outside `sdk/third_party/` contains the gateway's or device's username or password, the broker host, `BEGIN CERTIFICATE`, a group ID or an edge node ID (SC-005). Also assert `sdk/examples/desktop-simulator/sample-config/` is absent.
- [x] T027 [US1] API contract and client:
  - add `contracts/openapi/supplements/firmware.yaml` describing the archive response and targets, then run `cd apps/api && php artisan contract:export` (never edit `openapi.json` by hand);
  - `packages/api-client/src/firmware.ts`: `firmwareTargets(org)`, `createFirmwareStarter(org, body)` and types `FirmwareTarget`, `StarterManifest`, `FirmwareArchive`, exported from `index.ts`.
- [x] T028 [P] [US1] `apps/portal/src/lib/download.ts`: `saveArchive({filename, archive_base64})`, decoding into a `Blob` and clicking a temporary link, as `devices/ConnectionKit.tsx` does now. `ConnectionKit.tsx` uses it, with no behaviour change.
- [x] T029 [US1] `apps/portal/src/profiles/FirmwareSection.tsx`, added as a **Firmware** section in `ProfileWorkspace.tsx`'s section list when the profile has a published revision. Inside one `Panel`:
  - a target `Select` grouped "Built" and "AI-assisted", each AI-assisted item reading "no tested example";
  - a role choice, "Connects directly" or "Behind a gateway" (research R14). For "Behind a gateway", the node is the organization's published profile with code `gateway-health` when it exists (spec 026 PR 2), otherwise `node_artifact_uuid: null` (the SDK default health table);
  - **Download starter**, which calls `createFirmwareStarter` and `saveArchive`, then shows manifest warnings in the panel;
  - text saying connection settings come from the device or gateway page.

  It is hidden for drafts-only profiles, with a "Publish to download firmware" note instead. Use the named type scale, and no local status maps.
- [x] T030 [US1] `apps/portal/e2e/firmware-profile.spec.ts` (mocked API):
  - the section appears only with a published revision;
  - targets are grouped;
  - the request body for each role;
  - warnings render;
  - the download triggers within three actions from the profile page (open Firmware, choose target, download; SC-006).
- [x] T031 [US1] `.github/workflows/ci.yml`: a `firmware-starters` job with matrix `leg: [linux, ai-assisted]`:
  - set up PHP with the composer cache, then `php artisan firmware:starter-fixtures --output=.local/starters`;
  - `linux`: build every starter under `.local/starters/linux/*` with CMake, and assert each binary exits 2 with the missing-settings message;
  - `ai-assisted`: assert the file list, and `cc -std=c99 -fsyntax-only` each `app/ports/*.c` with `-I sdk/include -I generated`.

  Leave a comment that 027-3 adds `esp32` and 026-4 adds `nxp`.

**Checkpoint**: quickstart 2 passes on the rebuilt stack.

### Phase 4: User Story 2, AI coding agent interview (P1)

**Goal**: every starter carries one set of agent instructions that interviews the developer, records a confirmed device brief, and only then writes field code.

**Independent test**: `php artisan test --compact --filter AgentsBriefDrift`, then a desk run of one agent on a Linux starter (T036).

- [x] T032 [US2] `firmware/starters/templates/AGENTS.md.tmpl` with the nine sections, in the order the [device brief contract](contracts/device-brief.md) § AI brief requires:
  - "Already known, do not ask" lists what `iotos-starter.json` and `generated/profiles/*.json` answer;
  - the interview asks metric sources as one table per device type and accepts "I don't know" as `unknown`;
  - the Port section renders only for AI-assisted targets;
  - the rules forbid opening, printing, copying or committing `config/` except `config/README.md`, and editing `sdk/`, `generated/` or `.iotos/`;
  - the Device brief section stops if an existing brief's `format` differs from the schema's, and asks for a newer starter.

  Add `CLAUDE.md` containing exactly `@AGENTS.md`, and fill the README's "Start with AI" section with the one-line prompt "Read AGENTS.md and follow it. Start with the interview."
- [x] T033 [P] [US2] `firmware/starters/templates/porting.md`: the six ports, the two network levels, the threading rules (`on_birth` holds the lock, `on_command` does not), the template files to fill, and how to check a port against the platform (connect, then birth, then a command). Add `firmware/starters/families/{stm32,rpi-pico,nordic-nrf}.md`: each family's usual TLS, network, storage and RTOS pieces, and its traps (for example, duplicate coreMQTT from vendor middleware).
- [x] T034 [US2] `StarterBuilder` renders `AGENTS.md`, `CLAUDE.md` and the README section for every target, from the starter's facts: target name and kind, developer path, build command, profile names and metric counts.
- [x] T035 [US2] `apps/api/tests/Feature/Domain/Firmware/AgentsBriefDriftTest.php`, for every available target and role:
  - the nine headings appear in order;
  - every path named in `AGENTS.md` and `README.md` exists in that starter;
  - every `iotos_*` identifier named there is declared under `sdk/include/iotos/`;
  - `CLAUDE.md` is exactly `@AGENTS.md`;
  - no secret pattern from T026 appears.
- [x] T036 [US2] Desk run, recorded in the PR description, without transcripts: open a Linux direct starter for `relay` in Claude Code with the README prompt. Check that:
  - questions come first;
  - nothing in the manifest or profiles JSON is asked;
  - the brief validates against `.iotos/device-brief.schema.json` before any code;
  - `config/` is never opened;
  - the project builds.

  Fix the template for anything that fails.

**Checkpoint**: starters carry a tested AI brief.

### Phase 5: User Story 3, connection settings and full kits (P1)

**Goal**: people with `Device.manage-connections` download settings or a full kit for one device or gateway, and the starter connects with them.

**Independent test**: `php artisan test --compact --filter 'SettingsAndKit|FirmwareTenant'`, then quickstart 3 and the gateway half of quickstart 5 through the API.

- [x] T037 [US3] `Firmware/Services/ConnectionSettings.php`, the only class that reads credentials for downloads:
  - **direct device**: reuse `DeviceConnectionKit`'s checks (provisioned, not archived, `ssl` public endpoint, readable valid CA without a private key) and add its three existing files byte for byte;
  - **gateway**: the encrypted `SparkplugGateway.password`, `devices.broker_public_url`, the connection's group and host ID. First apply broker access through the same code as `POST gateways/{gateway}/provision`. Refuse a gateway without platform-issued credentials or a connection that is not ready;
  - render `config/iotos_settings.h` (spec 026 kit layout's macros plus `IOTOS_KIT_SETTINGS_FORMAT 1`), `config/iotos_settings.c` (`iotos_kit_settings` without `node_type`, and `iotos_kit_settings_present = 1`) and `config/README.md` (what the files are; that they work only inside a starter's or full kit's `config/`; keep them out of version control; how to replace leaked credentials by re-registering).
- [x] T038 [US3] Golden settings (research R19): `firmware:starter-fixtures --golden` also renders `ConnectionSettings` output for a fixture direct device and a fixture gateway (hosts `mqtt.example.test`, `fixture-` usernames and passwords, a throwaway test CA generated once and committed with the fixtures) into `contracts/firmware/fixtures/expected/settings-direct/` and `settings-gateway/`, listed in `cases.json`; `GoldenOutputTest` compares them.
- [x] T039 [US3] `Firmware/Http/Controllers/ConnectionSettingsController.php`, with `@device` (`POST devices/{device}/connection-settings`) and `@gateway` (`POST gateways/{gateway}/connection-settings`):
  - `Device.manage-connections`, `throttle:10,1`, 404 across organizations;
  - responds with `{filename, manifest: null, archive_base64}`, using the file names in the starter layout;
  - records `device.connection-settings.downloaded` or `gateway.connection-settings.downloaded` without secrets.
- [x] T040 [US3] Migration `apps/api/database/migrations/2026_11_*_add_firmware_selection_to_sparkplug_gateways.php`: a nullable `jsonb` column `firmware_selection`. Cast it to array on `SparkplugGateway`. The gateways list resource returns it with profile UUIDs the person may not view removed (data model § Gateway firmware selection; `saved_by_user_id` is the integer user id).
- [x] T041 [US3] `Firmware/Http/Controllers/FirmwareKitController.php@device` (`POST devices/{device}/firmware-kit`, body `{target}`): node type from the device's applied configuration artifact, otherwise its onboarding artifact; `StarterBuilder` plus `ConnectionSettings` placed in `<root>/config/` and, for a direct device, the three existing files at `<root>/`. File name `<device-code>-<target>-firmware-kit.zip`. `throttle:10,1`, `Cache-Control: no-store, private` and `Pragma: no-cache`. Record `device.firmware-kit.downloaded` with target, SDK version and profile revisions.
- [x] T042 [US3] `FirmwareKitController@gateway` (`POST gateways/{gateway}/firmware-kit`):
  - takes the starter body without `role` or `gateway_uuid`, and missing fields default to `firmware_selection`;
  - on success, writes `firmware_selection` `{format: 1, target, node_profile_uuid, device_profile_uuids, saved_by_user_id, saved_at}`;
  - `throttle:10,1`, `Cache-Control: no-store, private` and `Pragma: no-cache`;
  - records `gateway.firmware-kit.downloaded`.

  `FirmwareStarterController` handles `gateway_uuid` the same way: it requires `Device.manage-connections` on that gateway and writes the selection.
- [x] T043 [P] [US3] `ActivityCatalogue` entries for the four new codes, worded like `device.connection-kit.downloaded`.
- [x] T044 [US3] Feature tests `SettingsAndKitTest` and `FirmwareTenantIsolationTest`:
  - a member gets 403 on settings and kits;
  - another organization's device or gateway gives 404;
  - an archived device and an unready gateway give 422;
  - the direct kit's three files equal today's `connection-kit` output;
  - activity entries hold no secrets;
  - the full kit equals the starter plus settings;
  - `firmware_selection` is saved and filtered;
  - `POST devices/{device}/connection-kit` is unchanged;
  - `php artisan devices:export-gateway` still writes its file for a provisioned gateway (FR-034).
- [x] T045 [US3] API contract and client: extend `supplements/firmware.yaml`, run `php artisan contract:export`, and add `deviceConnectionSettings`, `gatewayConnectionSettings`, `deviceFirmwareKit` and `gatewayFirmwareKit` to `packages/api-client/src/firmware.ts`, plus `firmware_selection` on the gateway type in `packages/api-client/src/devices.ts`.
- [x] T046 [US3] `apps/portal/src/devices/DeviceActions.tsx`: for direct devices, and only with `Device.manage-connections`, a **Firmware** menu with **Download settings** and **Download firmware kit**. The kit opens a small dialog with the target `Select`. It provisions first, as `ConnectionKit.tsx` does, keeps archive data only in component state, and keeps toasts clear of the dialog actions. Extend `apps/portal/e2e/firmware-profile.spec.ts` with the device menu, its permission gating and both requests.

**Checkpoint**: quickstart 3 passes; a gateway full kit downloads through the API (026-4 can start once this PR merges).

### Phase 6: User Story 6, keep a project current (P3)

**Goal**: a newer starter replaces only the replaceable paths, and the manifest says what changed.

**Independent test**: the CI update check in T048, then quickstart 4.

- [x] T047 [US6] README template update section: list the manifest's `replaceable[]`, give a short shell recipe that first checks the new `iotos-starter.json` has `"format": 1` (and stops otherwise) and then replaces exactly those paths from a newer starter, and explain reading `introduced_in`, `changed_in` and `retired` against one's old revision.
- [x] T048 [US6] In the `firmware-starters` job's `linux` leg, an update check:
  1. generate the `relay` direct starter at revision 1;
  2. append a line to `app/field.c` and add `app/device-brief.yaml` from the `esp32-direct-sensor` fixture shape;
  3. replace the replaceable paths with the revision 2 starter;
  4. assert the developer files are byte-identical and the project builds (SC-008).

  Add a `--revision` option to `firmware:starter-fixtures` for this.

### Phase 7: PR 027-1 documentation and verification

- [x] T049 [P] Documentation:
  - `docs/features/embedded-sdk.md`: targets, starters, settings and full kits, the AI brief and the device brief format;
  - `docs/features/devices.md`: the device page's Firmware menu;
  - `docs/features/device-profiles.md`: the Firmware section;
  - the public developer page `apps/docs/src/content/docs/docs/developers/embedded-sdk.mdx` in the Developers sidebar group, created here if spec 026 PR 4 has not yet: the SDK, the targets, the AI workflow, the device brief format, and that starters come from the Firmware section after signing in (FR-044). No repository paths and no licence names (`docs/dev/docs-site.md` writing rules);
  - `apps/api/resources/help/devices.md` and the profiles help: where firmware comes from;
  - `docs/dev/gotchas.md`: anything surprising found while building.
- [x] T050 Checks:
  - `cd apps/api && php artisan test --compact`;
  - `php artisan contract:export --check`;
  - `pnpm --filter @iot-os/portal lint`;
  - `./taskw lint`;
  - `python3 tooling/verify-devices-contracts.py` and its tests;
  - `python3 tooling/docs/check_links.py`;
  - `ctest` in `firmware/sdk`;
  - the `firmware-starters` job.
- [x] T051 Rebuild `api`, its workers and `portal` with the stack's env files and overlays (AGENTS.md command; [which services](../../docs/dev/local-setup.md#rebuild-one-service)). Run quickstart 1–4 on the stack, preserving any unsaved browser edits.
- [X] T052 Set ADR-030 to Accepted in its status line and its `docs/adr/README.md` row. Leak scan, then open PR 027-1 against `main`.

**Checkpoint**: PR 027-1 merged. 026-4 (NXP target), 027-2, 027-3 and 026-2 can start in parallel.

---

## PR 027-2: Gateway dialog, onboarding and assistant

### Phase 8: User Story 4, firmware where work starts (P2)

**Goal**: the gateway page and the onboarding wizard offer the same starters, settings and kits.

**Independent test**: `pnpm --filter @iot-os/portal exec playwright test gateway-firmware onboarding-firmware`, then quickstart 5–6 (steps 1 and 3).

- [x] T053 [US4] `apps/portal/src/devices/GatewayFirmwareDialog.tsx`, opened by a **Firmware** button that replaces **Get credentials** in `GatewayPage.tsx` and the gateway menu in `GatewaysPage.tsx`:
  - **Node**: a `SearchableSelect` preselected from `firmware_selection`, otherwise the organization's published `gateway-health` profile, otherwise "SDK default health metrics".
  - **Device types**: up to 8 `SearchableSelect`s of published profiles, preselected from `firmware_selection`. With nothing saved, suggest the profiles of devices already under the gateway, from the page's device list (data model; FR-042).
  - **Target**: a `Select`.
  - **Actions**: **Download starter** (with `gateway_uuid` when the person may manage connections), and **Download settings** and **Download full kit** shown only with `Device.manage-connections`.

  The server-export instructions move under a disclosure in the dialog. Archive data lives only in component state, and toasts stay clear of the dialog's actions.
- [x] T054 [US4] `apps/portal/src/devices/ConnectionKit.tsx`: an "I'm writing the firmware" choice that reveals a target `Select`, **Download starter** (`createFirmwareStarter` with the device's profile artifact, for anyone at this step) and **Download firmware kit** (`deviceFirmwareKit`, only with `Device.manage-connections`) beside the unchanged **Download setup bundle**. The wizard's later steps are unchanged.
- [x] T055 [P] [US4] `apps/portal/e2e/gateway-firmware.spec.ts` (mocked API):
  - Get credentials is gone;
  - the preselection order;
  - 8 types maximum;
  - a member sees only Download starter;
  - the request bodies, and that `firmware_selection` reloads;
  - the starter downloads within three actions from the gateway page (SC-006).
- [x] T056 [P] [US4] `apps/portal/e2e/onboarding-firmware.spec.ts` (mocked API):
  - the choice reveals the target picker;
  - the kit request;
  - the setup bundle still downloads as before;
  - the starter downloads within three actions from the connection step (SC-006).

### Phase 9: User Story 5, the assistant offers firmware (P2)

**Goal**: the assistant offers a starter card the person presses, and never handles credentials.

**Independent test**: `php artisan test --compact --filter OfferFirmware`, then quickstart 6 step 2.

- [x] T057 [US5] `apps/api/app/Domain/Assistant/Tools/OnboardingTools.php`: a new action `offer_firmware {profile_uuid, target, role}`, added to the schema enum and description:
  - checks the conversation's organization, `DeviceProfile.view` for the run's user, a published revision, and that the target is available for the role;
  - writes `onboarding_state.firmware_offer` `{profile_uuid, target, role, at}` and emits `firmware_offer` through `AssistantEvents`, as `nextStep` does;
  - returns `{shown: true, profile: {name, revision}, target: {name, kind}}`, with no settings, credentials or archive.

  Add the same action to `ProfileAssistantTools.php`.
- [x] T058 [US5] Agent instructions in `Assistant/Agents/OnboardingAssistant.php` and `ProfileAssistant.php`: one paragraph. When someone wants to write firmware, confirm the profile and target, then call `offer_firmware`. Never ask for, repeat or paste credentials. For settings, send them to the device or gateway page.
- [x] T059 [US5] Render `firmware_offer` as an `ActionCard` titled "<target> starter for <profile>" in `apps/portal/src/adapters/OnboardingAssistant.tsx` and `apps/portal/src/assistant/AssistantPanel.tsx`. Its button calls `createFirmwareStarter` and `saveArchive` with the person's session.
- [x] T060 [US5] `apps/api/tests/Feature/Domain/Assistant/OfferFirmwareToolTest.php`:
  - refused without `DeviceProfile.view`, for a drafts-only profile, an unavailable target, or another organization;
  - state and event written;
  - with a provisioned device and gateway in the organization, the tool result and the stored conversation contain none of their usernames, passwords, broker host or CA (SC-005).
- [x] T061 [US5] `apps/portal/e2e/assistant-firmware.spec.ts` (mocked API): the card renders from `firmware_offer`, pressing it posts the starter request (one action once the card shows; SC-006), and nothing renders when the assistant is disabled.

### Phase 10: PR 027-2 documentation and verification

- [x] T062 [P] Documentation:
  - `docs/features/devices.md`: the gateway Firmware dialog replaces "Get credentials";
  - `docs/features/assistant.md`: `offer_firmware` in the onboarding and profile scope rows;
  - `apps/api/resources/help/devices.md`: the gateway and onboarding steps.
- [x] T063 Checks as in T050, plus `pnpm --filter @iot-os/portal exec playwright test` for `apps/portal/e2e/{gateway-firmware,onboarding-firmware,assistant-firmware}.spec.ts`.
- [x] T064 Rebuild `api`, its workers and `portal` (AGENTS.md command; [which services](../../docs/dev/local-setup.md#rebuild-one-service)). Run quickstart 5–6 on the stack (the assistant with a configured provider, then with it disabled), preserving unsaved browser edits.
- [x] T065 Leak scan the diff (`git diff main --name-only`), then open PR 027-2 against `main`.

---

## PR 027-3: ESP32 target and bench

### Phase 11: User Stories 1 and 2 on ESP32 (P1)

**Goal**: ESP32 is a built target whose starter builds in CI and reaches stored readings on real hardware with an AI coding agent.

**Independent test**: the `esp32` CI leg, then quickstart 7.

- [X] T066 [US1] `firmware/sdk/ports/freertos/lock.c` and its header (a FreeRTOS mutex `iotos_lock_port`). Skip it if 026-4 has already landed it, then reuse it.
- [X] T067 [US1] `firmware/sdk/ports/esp-idf/`:
  - `stream.c`: `esp_tls` with `cacert_buf` from the settings' CA, `common_name` as the broker host, and timeouts from `IOTOS_CONNECT_TIMEOUT_MS`;
  - `clock.c`: SNTP UTC with a valid flag, and `esp_timer_get_time()/1000` as `monotonic_ms`;
  - `storage.c`: NVS namespace `iotos` for `bdSeq`;
  - `log.c`: `ESP_LOG`;
  - `iotos_esp_idf.h` with `iotos_esp_idf_ports_init()`.

  Ports only; the public SDK API is unchanged (FR-012).
- [X] T068 [US1] `firmware/sdk/examples/esp32-wifi/`, an ESP-IDF v5.4.1 project:
  - `components/iotos/CMakeLists.txt` builds the SDK core and vendored coreMQTT from `sdk/` (starter) or `../..` (repository), and adds `config/iotos_settings.c` or `sdk/starter/settings_missing.c`;
  - `main/main.c` (Wi-Fi from `CONFIG_IOTOS_WIFI_SSID` and `CONFIG_IOTOS_WIFI_PASSWORD`, then the same settings copy, `IOTOS_KIT_SETTINGS_FORMAT` check and loop as the Linux example);
  - `main/Kconfig.projbuild` and `sdkconfig.defaults` (TLS and SNTP);
  - the README says not to add `espressif/coremqtt` or use ESP-IDF's MQTT client.
- [X] T069 [US1] Add the `esp32-esp-idf` entry to `firmware/starters/targets.json` (`example: "esp32-wifi"`, `developer_paths: ["main/"]`, `toolchain: "ESP-IDF v5.4.1"`, both roles). `StarterBuilder` adds `sdkconfig`, `sdkconfig.old` and `managed_components/` to `.gitignore` for this target. Extend `StarterTest` and `AgentsBriefDriftTest` with the ESP32 layout.
- [X] T070 [US1] CI: an `esp32` leg in `firmware-starters` that runs `idf.py build` for every `.local/starters/esp32-esp-idf/*` inside `espressif/idf:v5.4.1`, and also builds the in-repo example. Assert that `components/iotos/CMakeLists.txt` compiles the same `firmware/sdk/src/*.c` and coreMQTT sources as the desktop `iotos` library, so message parity holds by construction (FR-013). Cache the ESP-IDF tools between runs where the image allows.
- [X] T071 [P] [US2] `docs/hardware/esp32-starter-bench.md` (research R17): parts, wiring of the RS-485 transceiver and Modbus sensor, the timed protocol, and the run checklist (questions that asked for known facts, code before the brief, access to `config/`, time). Transcripts stay in `.local/`. List it under hardware in `docs/README.md`.
- [ ] T072 [US2] Bench runs (quickstart 7), once with Claude Code and once with Codex, recording outcomes only in `esp32-starter-bench.md`. The person running it uses only the Firmware section, the starter's documents and the agent, with no other help. Each run must store readings matching the sensor within 60 minutes, with no question about known facts, the brief before code, and `config/` untouched (SC-001, SC-007). Then reboot the board and check the next `bdSeq` is one higher, and compare the ESP32's births with the desktop simulator's for the same profile and values (FR-013). Fix the templates and rerun for any failure.

### Phase 12: PR 027-3 documentation and verification

- [X] T073 [P] `docs/features/embedded-sdk.md`: the ESP32 target and its port. Add a `firmware/sdk/CHANGELOG.md` "Unreleased" entry.
- [X] T074 Checks as in T050, including the `esp32` leg of `.github/workflows/ci.yml`.
- [x] T075 Rebuild `api` (it bundles `firmware/`) and confirm the ESP32 target appears in `GET firmware/targets` on the stack. Leak scan, then open PR 027-3 against `main`.
- [X] T076 [US1] Starter, settings and kit archives date every entry a day back (`FirmwareArchive`). Phar wrote the server's UTC wall clock as each entry's zoneless ZIP time, so starters unpacked west of UTC held files from hours ahead and `idf.py build` regenerated forever. Found while building an ESP32 starter downloaded from the stack.

---

## Dependencies & Execution Order

### Pull requests

| PR | Phases | Depends on |
| --- | --- | --- |
| 027-0 | 1 | — |
| 027-1 | 2–7 | 027-0 merged |
| 026-4 (spec 026) | its 14–15, plus the NXP registry entry and CI `nxp` leg | 027-1 merged |
| 027-2 | 8–10 | 027-1 merged |
| 027-3 | 11–12 | 027-1 merged |
| 026-2 (spec 026) | its 9, 11, 12 | 027-1 merged |

After 027-1, the four PRs touch different files and can run in parallel. The exceptions:
- `ports/freertos/` is shared by 027-3 and 026-4; whichever lands second reuses it (T066).
- `targets.json` gains one entry from each of 027-3 and 026-4; rebase the second.

### Within PR 027-1

- T006–T011 have no order between them except T010 after T007–T009.
- T012 blocks T013–T016's wiring into controllers; T013–T016 are independent.
- T017 needs T013–T015.
- US1 (Phase 3): T018 and T019 → T020 → T021 → T022–T024 → T025 → T026, then T027 → T028 → T029 → T030; T031 needs T024.
- US2 (Phase 4) needs T021: T032 and T033 → T034 → T035 → T036.
- US3 (Phase 5) needs T021 and T023: T037 → T038 → T039; T040 → T042; T041 needs T037; T043 is independent; T044 needs T039–T043; T045 → T046.
- US6 (Phase 6) needs T024 and T031.
- Phase 7 needs Phases 3–6.

### Within PR 027-2

- US4 and US5 are independent. T053 and T054 are independent; T059 needs T057.

### Within PR 027-3

- T066 → T067 → T068 → T069 → T070; T071 is independent; T072 needs T068–T071.

## Parallel examples

```text
# PR 027-1, foundation:
T007 manifest schema | T008 brief schema + fixtures | T009 profile fixtures | T011 image
T013 registry        | T014 metric tables          | T015 history          | T016 settings_missing + simulator split
# PR 027-1, after T021:
T032 AGENTS template | T037 ConnectionSettings      | T040 migration        | T043 catalogue
# After PR 027-1 merges:
027-2 (dialog, onboarding, assistant) | 027-3 (ESP32) | 026-4 (NXP) | 026-2 (gateway itself)
# PR 027-2:
T053 gateway dialog  | T054 onboarding picker      | T057 assistant action
```

## Implementation strategy

- **MVP**: PR 027-1. A member downloads a Linux or AI-assisted starter from the profile page with a working AI brief, and an admin adds settings or downloads a full kit for a device or gateway. This is enough for the NXP partner's work (026-4) to begin.
- **Then, in parallel**:
  - 026-4 puts the NXP starter on the bench; it is the partner's critical path;
  - 027-3 adds ESP32 and proves the one-hour goal with two agents;
  - 027-2 brings the same downloads to gateways, onboarding and the assistant.
- **Called supported only after hardware**: a built target is not called supported until its bench run passes (T072 for ESP32, spec 026's EVKB bench for NXP).
