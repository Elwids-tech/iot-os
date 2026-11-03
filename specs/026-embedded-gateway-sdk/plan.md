# Implementation Plan: Embedded Gateway SDK

**Branch**: `spec/026-embedded-gateway-sdk` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/026-embedded-gateway-sdk/spec.md`; decisions
in [ADR-029](../../docs/adr/ADR-029-embedded-sdk-and-gateway-kits.md)

## Summary

The work has four parts:

1. **SDK.** Grow the ESP32 board's bounded Sparkplug codec into a portable C99 SDK in
   `firmware/sdk/`. It has no heap and is sized at compile time, and it runs the edge-node
   session for a gateway and up to 512 downstream devices. Network, clock, storage,
   logging and locking are ports. The network has two levels: a TLS stream the SDK runs
   coreMQTT over, or a modem's own MQTT. Its payloads are pinned to the runtime by golden
   fixtures replayed on both sides. It ships a desktop port (tests and a gateway
   simulator) and an i.MX RT1050 EVKB port (MCUXpresso SDK, lwIP, mbedTLS, FreeRTOS).
2. **Kits.** Laravel generates C headers from published profiles: settings, plus one
   metric table per device type. It bundles them with the SDK into a new gateway kit
   (ADR-029) and into the existing direct-device kit.
3. **The gateway itself.** Onboarding accepts a gateway's own source under an existing
   gateway, and a one-click gateway health profile matches the SDK's health metrics.
4. **Bulk onboarding.** A batch run with per-source items, executed by a queued job,
   creates, maps and activates hundreds of discovered devices of one gateway with one
   profile. The portal's Discovery page gains row selection and a progress view.

## Technical Context

**Language/Version**: C99 (SDK); PHP 8.4 / Laravel 13; TypeScript / React 19; Go 1.27 (fixture test only)

**Primary Dependencies**:
- SDK: coreMQTT (MIT), mbedTLS 3.x (ports), FreeRTOS and MCUXpresso SDK 25.x (board port), Unity (tests)
- Platform: existing; no new packages

**Storage**: PostgreSQL 17: `device_bulk_onboardings`, `device_bulk_onboarding_items`; no runtime storage change

**Testing**:
- SDK: CTest + Unity with ASan/UBSan on gcc and clang; `arm-none-eabi-gcc` cross-compile with a size, static-data and no-heap check
- Contracts: Go replay of the SDK fixtures
- Platform: PHPUnit feature tests; Playwright with a mocked API
- End to end: local `tooling/verify-embedded-sdk.mjs`
- Hardware: EVKB bench run

**Target Platform**: i.MX RT1050 (Cortex-M7) with FreeRTOS; macOS and Linux desktop; single-node Docker Compose platform

**Project Type**: embedded library plus web application changes (Laravel API, React portal)

**Performance Goals**:
- 500 devices re-announced in about 25 s at the default 20 births/s (SC-004 allows 5 min)
- Bulk run of 247 sources queued in under 5 s, with every item reaching *activation requested* within 2 min
- Three rebirths or fewer per bulk run (R19)

**Constraints**:
- The SDK uses no heap, and needs 32 KB or less for 500 devices (SC-003)
- The SDK subscribes with exactly the broker's literal filters
- One sequence counter per node
- No partner names in the repository
- No stacked PRs

**Scale/Scope**:
- SDK: about 3,500 lines of C (core, three ports, two templates, tests, two examples)
- Platform: 2 tables, 6 endpoints, 1 job, 3 portal surfaces
- Docs: 1 ADR, 2 new docs, 1 docs-site page

## Constitution Check

| Principle | Check |
| --- | --- |
| I. Laravel owns intent | Kits, the health profile and bulk onboarding are Laravel. The runtime gains a fixture test and two extracted payload helpers with no behaviour change (R11), plus the conditional R19 fallback, a runtime-internal change. The SDK talks only to the broker, like any device. ✅ |
| II. Immutable versions | Kits pin published profile revisions. Bulk items save drafts and activate through `DeviceConfigurationService`; an item is *active* only after runtime acknowledgement, which is read from the device and never stored by the job. ✅ |
| III. Tenant isolation | Every new route resolves the organization from the route. Artifacts, gateways and candidates are looked up within it (404 otherwise). Tests prove another organization cannot download a kit, see a run, or onboard its sources. Broker ACLs keep each gateway in its namespace. ✅ |
| IV. Contracts first | SDK payloads are golden fixtures in `contracts/sparkplug/fixtures/sdk/`, replayed by C and Go tests. The new routes land in the OpenAPI export and `packages/api-client` in the same PR. `created_by` is the integer user id. ✅ |
| V. AI proposes | No assistant tools are added. Bulk onboarding is a person's action with `Device.activate`. ✅ |
| VI. Never invent state | The SDK holds data while the clock is invalid, sends unknown values as nulls, and relies on the NDEATH will for offline. Bulk items never claim *active* before acknowledgement. ✅ |
| VII. Durable, idempotent | Runs are keyed by `operation_uuid` + `request_hash`, with one item per source and per-item transactions. The job is `tries = 1` with a running guard and a retry endpoint for failed items. No item is retried forever. ✅ |
| VIII. One design system | Discovery selection uses `DataTable` row selection inside `CollectionPage`. Dialogs use `SearchableSelect` for profiles, progress uses `Status`/`statusOf`, content sits in `Panel`, times use `RelativeTime`. No new kit component. ✅ |
| IX. Verified where it runs | PR 1 rebuilds runtime for the extracted payload helpers and checks a command and a rebirth. In PR 2 and PR 3, api, workers and portal are rebuilt and steps 3–7 of the quickstart are run on the stack. PR 4 changes the SDK the api image bundles into kits, so it rebuilds api and runs the EVKB bench (step 8) from a kit downloaded from the stack, because the simulator does not stand in for hardware. ✅ |

**Gate result**: pass, with the deviations in Complexity Tracking.

## Design

### SDK (`firmware/sdk/`)

```text
firmware/sdk/
├── LICENSE  THIRD_PARTY.md  CHANGELOG.md  VERSION  README.md  CMakeLists.txt
├── cmake/arm-none-eabi.cmake
├── include/iotos/iotos.h  iotos_config_defaults.h  iotos_ports.h  iotos_types.h  iotos_health.h
├── third_party/coreMQTT/   vendored pinned release with its licence (R3)
├── src/codec.c        streaming Sparkplug protobuf writer and reader (R2)
├── src/session.c      connect, STATE, bdSeq, seq, births queue, rebirth, back-off (R8)
├── src/devices.c      slots, IDs, types, aliases (R7, R9)
├── src/writer.c       iotos_begin/put/commit, value checks
├── src/commands.c     NCMD/DCMD decode by name, validation, callbacks
├── src/health.c       default node metrics
├── src/mqtt_stream.c  coreMQTT over iotos_stream_port (R3)
├── ports/posix/       mbedTLS stream, clock, file storage, log, pthread lock
├── ports/freertos/    lock and log
├── ports/mcuxpresso-lwip/  mbedTLS over lwIP sockets, SNTP clock
├── ports/templates/   stream, modem-at-mqtt (BG95 annotated), clock, storage, log and lock templates
├── examples/desktop-simulator/   gateway simulator over a kit
├── examples/rt1050-evkb-ethernet/
├── tools/fixtures.c   writes contracts/sparkplug/fixtures/sdk/*.bin
└── tests/             Unity tests per module and a fake-broker session test
```

Public API and ports: [contracts/sdk-c-api.md](contracts/sdk-c-api.md). The session
follows the runtime's rules listed in research R8 and R9. The desktop simulator takes
`--devices type=count`, `--interval`, `--state-file` and `--rate`. It generates values
per datatype (random walk, monotonic counters, toggles) and answers commands by
publishing the new state.

### Contracts and runtime

- `contracts/sparkplug/fixtures/sdk/` holds the SDK-written payloads and `expected.json`
  (decoded values, aliases, sequence), written by `tools/fixtures.c`.
  `tooling/verify-devices-contracts.py` checks that they are present and listed.
- `services/runtime/internal/sparkplug/sdk_fixtures_test.go` replays them through the
  session and asserts no diagnostics.
- `services/runtime/internal/app` gains `commandPayload` and `rebirthPayload`, extracted
  from the inline encoding with no behaviour change. A test writes the NCMD/DCMD
  fixtures with them at a fixed time for the C tests (R11).

### API (`apps/api`)

- **Image**: `.dockerignore` `!firmware/sdk`, `COPY firmware/sdk /var/firmware-sdk` in
  both Dockerfiles, `devices.sdk_path` config (R14).
- **Kit generation**: `Domain/Devices/Services/EmbeddedKit.php` renders
  `iotos_settings.{h,c}`, `iotos_types.h` and `iotos_type_<code>.h` from a gateway and
  profile artifacts (R20, [kit-layout](contracts/kit-layout.md)), and adds the SDK, the
  pinned coreMQTT and the examples. `DeviceConnectionKit` adds the headers for direct
  devices. `GatewayKit` builds the gateway archive.
- **Routes** ([platform-api](contracts/platform-api.md)):
  - `GatewayKitController@store/@archive`
  - `OnboardingController@store` gains `source: node`
  - `GatewayHealthProfileController@store`, which uses `PublishDeviceProfile`
  - `BulkOnboardingController@store/@show/@retry`
- **Bulk onboarding**:
  - Models `DeviceBulkOnboarding` and `DeviceBulkOnboardingItem`, and a migration.
  - `Services/BulkOnboarding` (create, hash, roll-up, retry, following `GeofenceService`).
  - `Jobs/OnboardDiscoveredSources` (following `DeployAdapter`) on the `default` queue.
  - `Services/MappingSuggestions`, extracted from `DeviceController::mappingSuggestions`.
  - Each item runs the `AdapterService::activate` sequence (R18).
- **Activity**: `ActivityLog::record` for the codes in the
  [data model](data-model.md#existing-tables), with catalogue entries in
  `ActivityCatalogue`.
- **Compose**: the dev compose gains the `default` queue worker if it lacks one (the
  release compose has it).

### Portal (`apps/portal`) and client

- `packages/api-client`: `gatewayKit`, `gatewayKitArchiveUrl`, `createGatewayHealthProfile`,
  `createBulkOnboarding`, `bulkOnboarding`, `retryBulkOnboarding`, and `source: "node"`
  in the onboarding request type.
- `devices/GatewayPage.tsx` and `GatewaysPage.tsx`:
  - **Download kit** replaces **Get credentials**, which keeps the server-export text as a
    secondary note.
  - The dialog: a health profile `SearchableSelect` with **Create gateway health
    profile** when the organization has none; device types (up to 8, each a
    `SearchableSelect` of published profiles); download.
  - It calls the kit endpoint once, on **Download kit**, never while the selection
    changes. It shows the size warnings from that response, then fetches the archive
    URL, as `ConnectionKit.tsx` does.
  - Credentials live only in component state, as in `ConnectionKit.tsx`.
- `devices/DeviceOnboarding.tsx`: in gateway mode, a **The gateway itself** choice beside
  the device ID field, with the health profile suggested.
- `devices/DiscoveryPage.tsx`:
  - `DataTable` row selection when a gateway filter is set, plus **Onboard selected**.
  - The page shows 25 rows at a time, so a **Select all N matching** action loads every
    matching source (up to 500, in pages of 100, the endpoint's maximum). The selection
    then spans pages, and the dialog sees every selected source's metrics.
  - The dialog has a profile `SearchableSelect`, the name pattern with a preview of three
    names, and a match summary: sources whose birth lacks a profile metric are flagged
    before starting.
  - A run `Panel` polls `GET bulk-onboardings/{run}` with counts, a per-item table and
    **Retry failed**.
- E2E (mocked API): `apps/portal/e2e/gateway-kit.spec.ts`,
  `apps/portal/e2e/bulk-onboarding.spec.ts`.

### Tooling and CI

- `.github/workflows/ci.yml` gains an `sdk` job:
  - a `{gcc, clang}` matrix running CMake, CTest and the sanitizers on `ubuntu-latest`;
  - an `arm-none-eabi-gcc` (apt) cross-compile with the size target. It fails above 32 KB
    of state at 512 devices, on any writable static data in the library, or on any
    reference to `malloc`, `calloc`, `realloc` or `free`.
- The existing `runtime` job runs the new Go fixture test.
- `tooling/verify-embedded-sdk.mjs` (R21) is local only; `test-devices.mjs` calls it when
  `cc` and `cmake` exist.
- `tooling/hardware/` gains `modbus_simulator.py`: pymodbus answering addresses 1–247 on
  one RS-485 adapter (the bench setup).

### Documentation

- `docs/features/embedded-sdk.md` (new): the core and desktop port in PR 1, kits in
  PR 2, and the board ports and templates in PR 4.
- `docs/hardware/rt1050-evkb.md` (new), listed under hardware in `docs/README.md`.
- `firmware/sdk/CHANGELOG.md`: "Unreleased" entries in each PR that changes the SDK
  (PR 1 and PR 4), moved under `0.1.0` at release.
- `docs/features/devices.md`: gateway kits, the gateway itself, bulk onboarding; the
  "never shows credentials" text is replaced.
- `docs/README.md`: index and repository map.
- `docs/dev/gotchas.md`: the Sparkplug traps from R8 and R9.
- `apps/api/resources/help/devices.md` and the public developer page (R22).
- `docs/roadmap.md`: spec 026 under Devices and adapters, until it ships.

## Project Structure

### Documentation (this feature)

```text
specs/026-embedded-gateway-sdk/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
├── checklists/requirements.md
└── contracts/sdk-c-api.md  kit-layout.md  platform-api.md
docs/adr/ADR-029-embedded-sdk-and-gateway-kits.md
```

### Source Code (repository root)

```text
firmware/sdk/                                            (new, MIT)
contracts/sparkplug/fixtures/sdk/                        (new fixtures)
services/runtime/internal/sparkplug/sdk_fixtures_test.go
services/runtime/internal/app/{commands,application}.go (payload helpers), sdk_command_fixtures_test.go
apps/api/app/Domain/Devices/{Services,Http/Controllers,Jobs,Models}/   kits, health profile, bulk runs
apps/api/database/migrations/2026_11_*_create_device_bulk_onboardings.php
apps/api/tests/Feature/Domain/Devices/{GatewayKitTest,GatewayNodeOnboardingTest,BulkOnboardingTest}.php
packages/api-client/src/{devices,onboarding}.ts
apps/portal/src/devices/{GatewayPage,GatewaysPage,DeviceOnboarding,DiscoveryPage}.tsx (+ GatewayKitDialog, BulkOnboardingDialog)
apps/portal/e2e/{gateway-kit,bulk-onboarding}.spec.ts
deploy/docker/api/{Dockerfile,Dockerfile.release}, .dockerignore, deploy/compose/compose.app.yml
.github/workflows/ci.yml
tooling/verify-embedded-sdk.mjs, tooling/hardware/modbus_simulator.py
docs/features/embedded-sdk.md, docs/hardware/rt1050-evkb.md, apps/docs/.../developers/embedded-sdk.mdx
```

## Delivery

There are no stacked PRs: each PR targets `main` and is opened once the PRs it depends
on have merged.

| PR | Contents | Depends on | Verified by |
| --- | --- | --- | --- |
| 0 | Documents: spec, plan, research, data model, contracts, quickstart, tasks, ADR-029 (Proposed) | — | review |
| 1 | SDK core, desktop port and simulator, tests, SDK fixtures and the Go replay, CI `sdk` job, `docs/features/embedded-sdk.md` (SDK part) | 0 | quickstart 1–2 |
| 2 | Kits (image copy, header generation, gateway kit routes and dialog, direct kit headers), the gateway itself, health profile, `verify-embedded-sdk.mjs`, devices docs and help | 1 | quickstart 3, 4, 6, 7; containers rebuilt |
| 3 | Bulk onboarding (tables, job, routes, Discovery selection and run panel) | 0 | quickstart 5 with the Python simulator before PR 2, then with the SDK simulator |
| 4 | MCUXpresso/lwIP port, FreeRTOS port, EVKB example, modem template, bench doc, `modbus_simulator.py`, docs-site page | 1, 2 | api rebuilt; quickstart 8 on the EVKB bench from a kit downloaded from the stack |

PR 3 can be opened alongside PR 1. PR 2 is opened after PR 1 merges, and PR 4 after PR 2
merges, because its kit test needs the kit endpoint. ADR-029 moves to Accepted when PR 2
merges.

## Risks

- **Modem binary receive** (R5): verified on the phase-2 bench modem before the template
  is called supported.
- **Rebirth load during bulk runs** (R19): measured by the end-to-end check. A runtime
  change follows only if it exceeds three rebirths per run.
- **Device ID length**: the SDK default is 24 characters, against the platform's 128. The
  kit README says how to raise `IOTOS_DEVICE_ID_MAX` and what it costs per device.
- **Vendor SDK drift**: the board example pins the MCUXpresso SDK version it was verified
  with, and the docs say so.
- **Two coreMQTT copies**: a project that also builds the MCUXpresso coreMQTT middleware
  gets duplicate symbols. The board example leaves it out and its README says so (R3).

## Complexity Tracking

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| The Devices domain gains its first queued job (until now asynchronous work went through the runtime outbox) | Bulk onboarding is Laravel-side work (creating devices, drafts, activations) and does not fit in one request | Synchronous creation times out at hundreds of items; the outbox is for runtime work, not control-plane work |
| The repository's first licence file, scoped to `firmware/sdk/` | Integrators compile the SDK into closed-source firmware (Q2) | A repository-wide licence is a separate owner decision |
| Third-party C code: coreMQTT vendored in `firmware/sdk/third_party/` and copied into kits; mbedTLS and Unity fetched by CMake for desktop builds | Maintained protocol and TLS libraries instead of in-house ones (R3, R4) | Writing an MQTT client or TLS integration is more code to own and audit |
| End-to-end SDK check runs locally, not in CI | The full stack is not available in CI, like every other `verify-*` script | Bringing up the stack in CI is a separate infrastructure change |
