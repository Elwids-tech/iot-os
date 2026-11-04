# Implementation Plan: Firmware Starter Kits

**Branch**: `spec/027-firmware-starter-kits` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/027-firmware-starter-kits/spec.md`; decisions
in [ADR-030](../../docs/adr/ADR-030-firmware-starters.md), which amends
[ADR-029](../../docs/adr/ADR-029-embedded-sdk-and-gateway-kits.md)

## Summary

Laravel gains one firmware generator. From published profile revisions and a target in
a registry, it builds:
- **starters**: credential-free projects with the SDK, generated metric tables, the
  target's example and an AI brief;
- **connection settings**: credential files for one device or gateway;
- **full kits**: a starter plus settings.

The work has four parts:
1. **Generator and entry points.** A new `Firmware` domain with four endpoints
   (targets, starters, settings and kits, for devices and gateways), a Firmware section on
   profiles, Firmware actions on device and gateway pages, a target picker in today's
   onboarding wizard, and an assistant card. This replaces spec 026's unbuilt kit work.
2. **AI brief.**
   - One `AGENTS.md`, imported by `CLAUDE.md`, that interviews the developer and has
     them confirm a schema-checked `device-brief.yaml` before any field code.
   - Field stubs that publish nothing until they are implemented.
   - A drift test that keeps the instructions in step with the SDK.
3. **Targets.**
   - Built targets: Linux (new example), ESP32 on ESP-IDF 5.4.1 (new port and example)
     and NXP i.MX RT (spec 026 PR 4's example, registered here). CI builds each
     generated starter.
   - AI-assisted families (STM32, Pico, nRF, Other) get templates and notes.
4. **Records.** ADR-030 and amendments to spec 026's kit layout and delivery, so the kit
   work is built once.

## Technical Context

**Language/Version**: PHP 8.4 / Laravel 13; TypeScript / React 19; C99 (examples and
ports); YAML and JSON Schema (device brief)

**Primary Dependencies**:
- Existing platform packages; no new PHP or JS packages.
- ESP-IDF v5.4.1 (ESP32 target).
- MCUXpresso SDK 25.x through `west` (NXP CI only).
- `jsonschema` 4.26 (already used by the contracts verifier).

**Storage**: PostgreSQL 17: one nullable `jsonb` column, `sparkplug_gateways.firmware_selection`.
Starters, settings and kits are generated per request and never stored.

**Testing**:
- PHPUnit feature tests:
  - layout per target;
  - the secret scan;
  - tenant isolation and permissions;
  - determinism across entry points;
  - manifest history;
  - limits;
  - the `AGENTS.md` drift test.
- Contract fixtures for the device brief and the manifest.
- Playwright with a mocked API, for the Firmware section, the gateway dialog, the onboarding
  picker and the assistant card.
- The CI `Firmware starters` job (generated starters built per target).
- The ESP32 bench with two coding agents, and spec 026's EVKB bench.

**Target Platform**:
- The single-node Docker Compose platform.
- Starter targets: Linux and macOS, ESP32 (Xtensa and RISC-V variants that ESP-IDF 5.4
  supports, verified on one ESP32 board), and i.MX RT1050 EVKB.

**Project Type**: web application changes (Laravel API, React portal), plus embedded
example projects and packaging templates.

**Performance Goals**:
- A starter for 8 types of 64 metrics is generated in under 3 s, with an archive under
  2 MB.
- Three actions from any entry point to a download (SC-006).

**Constraints**:
- No credentials or connection details in starters (FR-004).
- The SDK's public API is unchanged (FR-012).
- Starters only for signed-in members (Q1).
- One instructions file (Q3).
- No partner names.
- No stacked pull requests.

**Scale/Scope**:
- **API**: 1 domain, 6 endpoints, 1 column, 4 activity codes, 1 assistant action.
- **Portal**: 4 surfaces.
- **Firmware**: 1 port (ESP-IDF), 2 examples (Linux, ESP32), a registry, 7 templates and
  3 family notes.
- **CI**: 1 job.
- **Docs**: 1 ADR, 2 docs, and amendments to spec 026.

## Constitution Check

| Principle | Check |
| --- | --- |
| I. Laravel owns intent | The generator, permissions and assistant action are Laravel. The runtime is untouched. Devices built from starters talk only to the broker. ✅ |
| II. Immutable versions | Starters are built only from published artifacts, and the manifest pins each revision. Nothing is activated by a download. ✅ |
| III. Tenant isolation | Every artifact, device and gateway is resolved within the route's organization (404 otherwise). Tests prove another organization cannot obtain a starter, settings or kit, nor read a saved gateway selection. Starters need signing in (Q1). ✅ |
| IV. Contracts first | `contracts/firmware/` gains the device brief and manifest schemas with fixtures, plus golden copies of the generated C headers, settings files and manifest that `GoldenOutputTest` compares byte for byte (R19); the CI starter builds are the C consumer. Consumers reject unknown versions: examples `#error` on another `IOTOS_KIT_SETTINGS_FORMAT`, the README's update recipe on another manifest `format`, and `AGENTS.md` on another brief `format`. New routes land in OpenAPI and `packages/api-client` in the same PR. `saved_by_user_id` is an integer. ✅ |
| V. AI proposes | The assistant only offers a starter card that the person presses. It has no write and never sees credentials (FR-052). Coding agents run on the developer's machine, outside the platform. Every entry point works with the assistant disabled. ✅ |
| VI. Never invent state | Field stubs return "unavailable", so unknown metrics are left out of data and sent as nulls in births (R9). The brief records unknowns, and the manifest shows what changed between revisions. ✅ |
| VII. Durable, idempotent | No messaging change. Downloads are idempotent reads, apart from saving a gateway's selection, which is last-writer-wins on one column. ✅ |
| VIII. One design system | The Firmware section and dialogs use `Panel`, `Select` (fixed target list), `SearchableSelect` (profiles), the existing `ActionCard`, and toasts above the dialog actions. No new kit component. ✅ |
| IX. Verified where it runs | Each PR rebuilds the containers it changes (027-1 and 027-2: api, workers and portal; 027-3: api, which bundles `firmware/`) and runs its quickstart steps on the stack. ESP32 and NXP are accepted on hardware (runs 7 and 8), not on the simulator. ✅ |

**Gate result**: pass, with the deviations in Complexity Tracking. Re-checked after
Phase 1 design: unchanged.

## Design

### Starter sources (`firmware/starters/`, new)

```text
firmware/starters/
├── targets.json                registry (data model)
├── templates/
│   ├── README.md.tmpl          quickstart, Start with AI, update steps
│   ├── AGENTS.md.tmpl          the AI brief (contracts/device-brief.md)
│   ├── CLAUDE.md               "@AGENTS.md"
│   ├── gitignore.tmpl
│   ├── config-README.md
│   ├── porting.md
│   └── device-brief.example.yaml.tmpl
└── families/{stm32,rpi-pico,nordic-nrf}.md
```

Templates use simple `{{name}}` placeholders, rendered by PHP with no template engine.
No placeholder may expand to a secret: the renderer receives only starter facts.

### SDK additions (`firmware/sdk/`)

Additions only, with no change to the public API (FR-012):
- `starter/settings_missing.c`: the empty settings and `iotos_kit_settings_present = 0`
  (R4).
- `examples/desktop-simulator/`: its kit mode reads the starter's `generated/` and
  `config/`, and its `sample-config/` splits the node type into `iotos_types.c`.
  Starters ship the simulator without `sample-config/` (R12).
- `examples/linux-app/`: a CMake project with `app/main.c`, `field.c` and `field.h`.
- `ports/esp-idf/`: stream (`esp_tls`), clock (SNTP and `esp_timer`), storage (NVS) and
  log.
- `ports/freertos/lock`: shared with spec 026 PR 4. Whichever pull request lands first
  adds it.
- `examples/esp32-wifi/`: an ESP-IDF project, with `components/iotos`, `main/` and
  `Kconfig.projbuild` for Wi-Fi.
- `CHANGELOG.md` "Unreleased" entries; no version bump until release.

`examples/rt1050-evkb-ethernet/` comes from spec 026 PR 4. Its `armgcc` CMake locates
`sdk/`, `generated/` and `config/` the same way (R11).

### Contracts (`contracts/firmware/`, new)

- `device-brief.schema.json` and `starter-manifest.schema.json` (draft 2020-12).
- `fixtures/briefs/*.yaml`: the valid and invalid briefs listed in the
  [device brief contract](contracts/device-brief.md).
- `fixtures/profiles/*.json`: published-artifact fixtures for CI starter builds (R16): a
  direct sensor, a writable relay, two gateway device types, and one 64-metric type.
- `fixtures/expected/<case>/` and `fixtures/expected/cases.json`: golden generator
  outputs for two starters and two settings sets, with fixture credentials (R19).
- `tooling/verify-devices-contracts.py` validates both schemas and the fixtures, checks
  that every listed golden case is complete, and has tests in
  `tooling/contracts/test_verify.py`.

### API (`apps/api`)

- **Image** (R15):
  - `.dockerignore` re-includes `!firmware/sdk` and `!firmware/starters`;
  - both Dockerfiles `COPY firmware/sdk /var/firmware/sdk` and
    `COPY firmware/starters /var/firmware/starters`;
  - `config/firmware.php` has `path` with the checkout fallback.
- **Domain** `app/Domain/Firmware/`:
  - `Services/TargetRegistry`: reads `targets.json` and drops unavailable targets.
  - `Services/MetricTables`: artifact parameters to C type tables (026-R20, 026 kit
    layout), plus `generated/profiles/<code>.json`.
  - `Services/MetricHistory`: `introduced_in`, `changed_in` and `retired` from the
    profile's published artifacts (R6).
  - `Services/StarterBuilder`: composes a starter from the target, artifacts and SDK copy
    (starter layout), renders the templates and returns the files and manifest. It is
    pure, with no database access, so the CI command uses it with fixtures.
  - `Services/ConnectionSettings`:
    - builds the settings files from a direct device's onboarding (reusing
      `DeviceConnectionKit`'s checks and existing files) or from a gateway (encrypted
      password, `devices.broker_public_url`, provisioning first);
    - is the only class that reads credentials for downloads.
  - `Services/FirmwareArchive`: the `PharData` ZIP in a private temporary directory,
    removed in `finally` (today's kit code moves here; `DeviceConnectionKit` keeps its
    output).
  - `Http/Controllers`:
    - `FirmwareTargetController@index`;
    - `FirmwareStarterController@store`;
    - `ConnectionSettingsController@device/@gateway`;
    - `FirmwareKitController@device/@gateway`.
  - `Http/Requests`: validation per the data model.
  - `routes/api.php`, required from `routes/api.php`.
  - `Console/StarterFixtures`: `firmware:starter-fixtures --output`.
- **Devices**:
  - a migration adding `sparkplug_gateways.firmware_selection`;
  - `SparkplugGateway` casts it;
  - the `gateways` list resource adds it, filtered by profile visibility.
- **Activity**: the four codes in the data model, with `ActivityCatalogue` entries.
- **Assistant**:
  - `OnboardingTools` and `ProfileAssistantTools` gain `offer_firmware` (contract).
  - `OnboardingAssistant` and `ProfileAssistant` instructions gain one paragraph: offer a
    starter when someone wants to write firmware; never ask for or repeat credentials;
    for settings, point to the device or gateway page.
- **Tests** (`tests/Feature/Domain/Firmware/`):
  - `TargetsTest`;
  - `StarterTest` (layout per target and role, limits, drafts, determinism, history);
  - `SecretScanTest` (SC-005);
  - `SettingsAndKitTest` (permissions, activity, unchanged direct files);
  - `TenantIsolationTest`;
  - `AgentsBriefDriftTest`;
  - `GoldenOutputTest` (R19);
  - `OfferFirmwareToolTest`.

### Portal (`apps/portal`) and client

- **`packages/api-client`**: `firmwareTargets`, `createFirmwareStarter`,
  `deviceConnectionSettings`, `gatewayConnectionSettings`, `deviceFirmwareKit` and
  `gatewayFirmwareKit`, with types for the manifest and `firmware_selection`.
- **`lib/download.ts`**: one helper that saves `{filename, archive_base64}`, as
  `ConnectionKit.tsx` does today. Archive data lives only in component state.
- **`profiles/ProfileWorkspace.tsx`**: a **Firmware** section shown when a published
  revision exists (R14). Its `Panel` holds:
  - a target `Select` grouped Built and AI-assisted, with each AI-assisted option saying
    "no tested example";
  - the two roles;
  - **Download starter**, showing manifest warnings in the panel after download.
- **`devices/DeviceActions.tsx`**: a **Firmware** menu for direct devices with
  **Download settings** and **Download firmware kit** (target `Select`), shown only with
  `Device.manage-connections`.
- **`devices/GatewayPage.tsx` and `GatewaysPage.tsx`**: **Firmware** replaces **Get
  credentials**. A new `GatewayFirmwareDialog.tsx` has:
  - the node profile and up to 8 type `SearchableSelect`s, preselected as in the data
    model;
  - a target `Select`;
  - **Download starter**, **Download settings** and **Download full kit**, the last two
    behind the permission.

  The server-export command stays as a note under a disclosure.
- **`devices/ConnectionKit.tsx`**: "I'm writing the firmware" reveals a target `Select`,
  **Download starter**, and **Download firmware kit** (with `Device.manage-connections`)
  beside the unchanged **Download setup bundle**.
- **`adapters/OnboardingAssistant.tsx`** (and the profile assistant panel): render
  `firmware_offer` as an `ActionCard` whose button downloads the starter.
- **E2E** (mocked API):
  - `e2e/firmware-profile.spec.ts`;
  - `e2e/gateway-firmware.spec.ts`;
  - `e2e/onboarding-firmware.spec.ts`;
  - `e2e/assistant-firmware.spec.ts`.

### Tooling and CI

- **`.github/workflows/ci.yml`** gains a `firmware-starters` job with matrix
  `{linux, esp32, nxp, ai-assisted}`:
  - **Shared step**: PHP setup with the composer cache, then
    `php artisan firmware:starter-fixtures --output=.local/starters`.
  - **`linux`**: build each starter, and run it to the missing-settings exit.
  - **`esp32`**: `idf.py build` per starter in `espressif/idf:v5.4.1`.
  - **`nxp`**: the MCUXpresso SDK through `west` at a pinned manifest revision (cached),
    then the armgcc build. It runs on PRs that touch `firmware/**`,
    `contracts/firmware/**` or `apps/api/app/Domain/Firmware/**`, and nightly
    (`schedule`). It is skipped until the NXP registry entry exists.
  - **`ai-assisted`**: file list checks and `-fsyntax-only` on the templates in `app/ports/`.
- **The existing `sdk` job** keeps building the SDK and its desktop examples.

### Documentation

- `docs/adr/ADR-030-firmware-starters.md` (Proposed), a row in `docs/adr/README.md`, and
  ADR-029's status line "Proposed; amended by ADR-030".
- `docs/features/embedded-sdk.md`: targets, starters, settings and kits, the AI brief and
  the device brief format.
- The public developer page `apps/docs/src/content/docs/docs/developers/embedded-sdk.mdx`
  (created here if spec 026 PR 4 has not yet): the SDK, the targets, the AI workflow and
  the device brief format, and that starters come from the Firmware section after
  signing in (FR-044). Spec 026 PR 4 adds the NXP board to it.
- `docs/hardware/esp32-starter-bench.md`: the bench and protocol (R17), listed in
  `docs/README.md`.
- `docs/features/devices.md`: Firmware actions, which replace "Get credentials".
- `apps/api/resources/help/devices.md` and the help for profiles: where to get firmware.
- `docs/roadmap.md`: spec 027 under Devices and adapters.
- Spec 026 amendments (R18): `contracts/kit-layout.md` header, `plan.md` Delivery, and
  `tasks.md` notes on the moved tasks.

## Project Structure

### Documentation (this feature)

```text
specs/027-firmware-starter-kits/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
├── checklists/requirements.md
└── contracts/starter-layout.md  platform-api.md  device-brief.md
docs/adr/ADR-030-firmware-starters.md
```

### Source Code (repository root)

```text
firmware/starters/                                         (new)
firmware/sdk/starter/settings_missing.c                     (new)
firmware/sdk/examples/{linux-app,esp32-wifi}/               (new)
firmware/sdk/ports/{esp-idf,freertos}/                      (new; freertos shared with 026 PR 4)
contracts/firmware/                                         (new schemas and fixtures)
apps/api/app/Domain/Firmware/                               (new domain)
apps/api/config/firmware.php
apps/api/database/migrations/2026_11_*_add_firmware_selection_to_sparkplug_gateways.php
apps/api/app/Domain/Assistant/Tools/{OnboardingTools,ProfileAssistantTools}.php
apps/api/tests/Feature/Domain/Firmware/
packages/api-client/src/{firmware,devices}.ts
apps/portal/src/profiles/ProfileWorkspace.tsx (+ FirmwareSection.tsx)
apps/portal/src/devices/{DeviceActions,GatewayPage,GatewaysPage,ConnectionKit}.tsx (+ GatewayFirmwareDialog.tsx)
apps/portal/src/adapters/OnboardingAssistant.tsx
apps/portal/e2e/{firmware-profile,gateway-firmware,onboarding-firmware,assistant-firmware}.spec.ts
deploy/docker/api/{Dockerfile,Dockerfile.release}, .dockerignore
.github/workflows/ci.yml
tooling/verify-devices-contracts.py, tooling/contracts/test_verify.py
```

**Structure Decision**: a new `Firmware` domain owns generation and downloads, because
it spans profiles, devices and gateways and is not device lifecycle. Packaging sources
live beside the SDK in `firmware/`, and schemas in `contracts/`.

## Delivery

There are no stacked PRs: each targets `main` and opens once its dependencies have
merged. Spec 026 PRs are listed where they now fit.

| PR | Contents | Depends on | Verified by |
| --- | --- | --- | --- |
| 027-0 | Documents: spec, plan, research, data model, contracts, quickstart, tasks, ADR-030 (Proposed); spec 026 amendments; roadmap | — | review |
| 027-1 | Firmware domain and endpoints, including the gateway settings and full kit with `firmware_selection`; registry; templates and AI brief; brief and manifest schemas with fixtures; Linux example and `settings_missing.c`; AI-assisted families; image copy; api-client; profile Firmware section; device Firmware actions; CI job (linux and ai-assisted); docs | 027-0 | quickstart 1–4, 9 (linux and ai-assisted); api, workers and portal rebuilt |
| 026-4 | (spec 026) MCUXpresso/lwIP and FreeRTOS ports, EVKB example, NXP registry entry, CI `nxp` leg, bench doc | 027-1 | quickstart 8 on the EVKB bench from a kit downloaded from the stack |
| 027-2 | Gateway Firmware dialog; onboarding target picker; assistant `offer_firmware` and card; E2E | 027-1 | quickstart 5–6; api, workers and portal rebuilt |
| 027-3 | ESP-IDF port, ESP32 example and registry entry, CI `esp32` leg, `esp32-starter-bench.md` | 027-1 | quickstart 7 on the bench with two agents; quickstart 9 (esp32) |
| 026-2 | (spec 026) The gateway itself, built-in health profile, `verify-embedded-sdk.mjs` using the gateway full kit | 027-1 | 026 quickstart 3, 6, 7 |

**Order**:
- The partner's NXP target is the critical path: 027-0, then 027-1, then 026-4.
- 027-2, 027-3 and 026-2 can each be opened as soon as 027-1 merges, in parallel with
  026-4.
- The gateway dialog uses the health profile when 026-2 has landed, and the SDK default
  table otherwise.
- ADR-030 moves to Accepted when 027-1 merges. ADR-029 moves to Accepted when 026-2
  merges, as amended.

## Risks

- **AI agent behaviour varies.** Agents may skip the interview or read `config/`.
  - Mitigation: starters hold no secrets, so the worst case is a poor interview.
  - The bench runs two agents (SC-007), and the drift test keeps the instructions
    accurate.
  - The brief is plain text, so new agents need no change.
- **Vendor toolchain weight in CI.** The ESP-IDF image is a few GB, and the MCUXpresso
  SDK through `west` is large.
  - Mitigation: a pinned image and cache, the NXP leg path-filtered and nightly, and a
    parallel matrix.
- **Vendor drift.** ESP-IDF 5.4 and MCUXpresso 25.x will age.
  - Mitigation: the registry's `toolchain` is the single pin. Bumping it is a reviewed
    change with CI proof.
- **Developers committing settings.** `.gitignore` and the README warn, but this cannot
  be prevented.
  - Mitigation: the settings README explains re-registering until credential rotation
    exists (ADR-029 consequence).
- **Duplicate coreMQTT.** An ESP-IDF project that also adds `espressif/coremqtt` fails to
  link. The example and README say not to.

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| A new `Firmware` domain | Generation spans profiles, devices, gateways and the assistant | Putting it in `Devices` mixes packaging with device lifecycle, and `DeviceConnectionKit` is already overloaded |
| Vendor toolchains in CI (ESP-IDF image, MCUXpresso through `west`) | FR-011: every built target's generated starter builds in CI | Building only the SDK core lets examples and generator paths break unnoticed |
| A saved per-gateway selection (one `jsonb` column) | FR-042: teammates see the same choices | Browser storage is per person, and deriving from onboarded devices alone does not help before devices exist |
| Instruction content (`AGENTS.md`) that tests can only partly check | US2 depends on agent behaviour, which is outside the platform | The drift test covers paths and API names; the rest is proved on the bench (R17) |
