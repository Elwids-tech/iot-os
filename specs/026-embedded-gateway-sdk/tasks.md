# Tasks: Embedded Gateway SDK

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/sdk-c-api.md](contracts/sdk-c-api.md),
[contracts/kit-layout.md](contracts/kit-layout.md),
[contracts/platform-api.md](contracts/platform-api.md), [quickstart.md](quickstart.md)

The work ships as five pull requests against `main` (plan § Delivery). None is stacked:
each is opened only after the PRs it depends on have merged. PR 3 depends only on PR 0,
so it can be built alongside PR 1. Every PR runs a leak scan before it is opened: no
partner, product or person names, no hosts other than `example.com`/`.test`, and no local
home paths.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**:
  - US1: connect with the reference port
  - US2: downstream devices
  - US3: pluggable network
  - US4: gateway kit
  - US5: bulk onboarding
  - US6: gateway health
  - US7: desktop simulator
- SDK paths are relative to `firmware/sdk/` unless they start at the repository root.

---

## PR 0: Documents

### Phase 1: Documents

- [x] T001 ADR-029 (Proposed) in `docs/adr/ADR-029-embedded-sdk-and-gateway-kits.md` and its row in `docs/adr/README.md`
- [x] T002 `specs/026-embedded-gateway-sdk/`: spec, checklist, plan, research, data model, three contracts, quickstart, tasks
- [x] T003 Add spec 026 to `docs/roadmap.md` under "Devices and adapters", linked like the spec 025 entry
- [x] T004 Leak scan the documents, then open the documents PR against `main`

**Checkpoint**: PR 0 merged. PR 1 and PR 3 can start.

---

## PR 1: SDK core, desktop port, fixtures, CI

### Phase 2: SDK foundation (blocks US1, US2, US3, US7)

- [ ] T005 Scaffold `firmware/sdk/`:
  - `LICENSE`: MIT. Ask the owner for the copyright holder line.
  - `VERSION`: `0.1.0`.
  - `CHANGELOG.md`, with an "Unreleased" section.
  - `README.md`: what the SDK is, the ports, and how to build.
  - `THIRD_PARTY.md`: coreMQTT (MIT, vendored, with its tag), mbedTLS 3.x (Apache-2.0, desktop and board ports) and Unity (MIT, tests only).
  - Every `.c` and `.h` file starts with `SPDX-License-Identifier: MIT`.
- [ ] T006 [P] Vendor coreMQTT's pinned release (its `source/` folder and `LICENSE`, no tests or docs) into `firmware/sdk/third_party/coreMQTT/` (R3).
- [ ] T007 `firmware/sdk/CMakeLists.txt`:
  - A C99 `iotos` library holding the core `src/*.c` and the vendored coreMQTT, built with `-Wall -Wextra -Werror` on gcc and clang.
  - An `IOTOS_SANITIZE` option that adds ASan and UBSan.
  - An `iotos_posix` library.
  - mbedTLS 3.x and Unity through `FetchContent`, pinned by tag and `URL_HASH`.
  - Tests registered with CTest. Builds go under `.local/`.
- [ ] T008 [P] `firmware/sdk/cmake/arm-none-eabi.cmake`:
  - The toolchain uses `-mcpu=cortex-m7 -mfpu=fpv5-d16 -mfloat-abi=hard -std=c99 -Wall -Wextra -Werror`.
  - An `iotos_size` target prints `sizeof(iotos_gateway)` and the `.text`/`.data`/`.bss` sizes.
  - `iotos_size` fails in any of these cases, using `arm-none-eabi-size` and `arm-none-eabi-nm` on `libiotos.a` (the core and coreMQTT):
    - `sizeof(iotos_gateway)` exceeds 32768 bytes with `IOTOS_MAX_DEVICES=512` (SC-003);
    - the library has any `.data` or `.bss`, so all state is inside `iotos_gateway`;
    - it references `malloc`, `calloc`, `realloc` or `free` (FR-005).
- [ ] T009 Public headers in `firmware/sdk/include/iotos/`, exactly as in [sdk-c-api](contracts/sdk-c-api.md):
  - `iotos_config_defaults.h`: each limit guarded by `#ifndef`:
    - `IOTOS_MAX_DEVICES 512`, `IOTOS_MAX_DEVICE_TYPES 8`, `IOTOS_MAX_METRICS_PER_TYPE 64`
    - `IOTOS_DEVICE_ID_MAX 24`, `IOTOS_TX_BUFFER 4096`, `IOTOS_RX_BUFFER 1024`
    - `IOTOS_BIRTHS_PER_SECOND 20`, `IOTOS_KEEPALIVE_S 20`, `IOTOS_HEALTH_INTERVAL_S 60`, `IOTOS_CLOCK_WAIT_S 300`
  - `iotos_types.h`:
    - `iotos_status`: `IOTOS_OK` = 0, every other code negative.
    - The datatype enum, `iotos_metric_def`, `iotos_device_type`, `iotos_value` and `iotos_settings` (including `node_type`).
    - `iotos_event` and `iotos_connection_type`.
  - `iotos_ports.h`: the stream, mqtt, clock, storage, log and lock ports, and `iotos_ports`. A comment says port structures only gain members at the end and `NULL` means unsupported, so ports should use designated initialisers (FR-030).
  - `iotos_health.h`: the eight health metric names as `IOTOS_HEALTH_*` string constants (data model § Gateway health profile).
  - `iotos.h`: lifecycle, devices, writer, health setters, callbacks, `iotos_status_text` and `iotos_mqtt_inbound`. The callback comments state the threading rules from [sdk-c-api](contracts/sdk-c-api.md#callbacks): what each callback may call, and which hold the lock.
- [ ] T010 Streaming writer in `src/codec.c` and `src/codec.h` (internal) (R2):
  - **Layout:** fields go in field-number order (payload `timestamp`, `metrics`, then `seq`), as Python protobuf serialises them. Length prefixes are reserved and patched.
  - **Metrics:** name, alias, timestamp, datatype, `is_null`, and a value for Boolean, Int8–64, UInt8–64, Float, Double, String, DateTime and Bytes.
  - **Value checks:** finite numbers, 64-bit integers within ±2^53, UInt8/16 in range, strings at most 64 KiB. A failure returns `IOTOS_E_INVALID`.
  - **Buffer:** overflowing the buffer returns `IOTOS_E_TOO_LARGE` and never truncates.
- [ ] T011 Streaming reader in `src/codec.c`:
  - Decodes an NCMD/DCMD payload one metric at a time into a callback: name, alias, datatype, `is_null`, value.
  - Bounded by `IOTOS_RX_BUFFER`.
  - Rejects bad varints, lengths past the end, and unknown wire types without reading out of bounds.
- [ ] T012 `tests/test_codec.c`:
  - Reproduces `contracts/sparkplug/fixtures/{nbirth,dbirth-meter,ddata-alias,ndeath}.bin` byte for byte, with `TIME=1712345000000` from `tooling/simulators/write_fixtures.py`.
  - Decodes `dcmd-light.bin`.
  - Round-trips every datatype and covers each value-check failure.
  - Checks a full buffer returns `IOTOS_E_TOO_LARGE`.
  - Feeds 10,000 seeded random buffers to the reader with no sanitizer findings.

**Checkpoint**: the codec is pinned to the runtime's existing fixtures.

### Phase 3: User Story 1, connect a gateway (P1) 🎯 MVP

**Goal**: a gateway connects over verified TLS, announces itself with its health metrics, survives rebirth and host restarts, and goes offline through its will.

**Independent test**: `ctest` session tests pass under the sanitizers; in PR 2, the desktop port connects to the local stack (quickstart 3).

- [ ] T013 [US1] `src/mqtt_stream.c`: coreMQTT over `iotos_stream_port` (R3):
  - **Transport:** `send`/`recv` mapped to coreMQTT's transport interface, with partial reads and writes handled.
  - **Connect:**
    - MQTT 3.1.1, clean session.
    - The client ID and username are `settings.username`.
    - Keepalive is `IOTOS_KEEPALIVE_S`.
    - The will is the NDEATH carrying the current `bdSeq`, at QoS 1, not retained.
  - **Subscribe:** exactly `spBv1.0/<group>/NCMD/<edge>`, `spBv1.0/<group>/DCMD/<edge>/+` and `spBv1.0/STATE/<host_id>`.
  - **Refusals:** CONNACK codes 4 and 5 map to `IOTOS_E_AUTH`.
  - **Inbound:** messages go through the same path as `iotos_mqtt_inbound`.
  - **Memory:** coreMQTT's context and fixed buffer (the RX buffer) live in `iotos_gateway`; nothing is static.
- [ ] T014 [US1] `src/session.c` (R8, data model § Session states):
  - **States:** `disconnected → waiting_for_host → birthing → online`.
  - **bdSeq:**
    - Kept modulo 256 and incremented before each connect.
    - Loaded and saved through the storage port under the key `bdseq`, or kept in RAM when there is no storage port.
    - The NDEATH will is re-encoded with it on every connect.
  - **Sequence:** one `seq` counter (0–255, wrapping) covers NBIRTH (seq 0), NDATA, DBIRTH, DDATA and DDEATH. Every publish goes through one locked path.
  - **Host STATE:** parse the retained Sparkplug 3.0 JSON `{"online":true,"timestamp":…}` with a minimal parser. Births start on online. A new online STATE while online triggers a full rebirth.
  - **Rebirth:** NCMD `Node Control/Rebirth` triggers one. Retained NCMD/DCMD are ignored.
  - **Back-off:** starts at 1 s and doubles to a 300 s cap, with ±20% jitter. `on_event` reports authentication failures separately from transport failures.
  - **Takeover:** a session takeover is reported when the broker closes the connection within 10 s of connecting three times in five minutes.
  - **Clock:** births are held while the clock is invalid. `IOTOS_E_CLOCK` is reported after `IOTOS_CLOCK_WAIT_S`, then every minute.
  - **Calls:** `iotos_poll` returns within `budget_ms`. `iotos_stop` publishes NDEATH, then disconnects.
  - **Lock:** `iotos_poll` takes the lock only around its own state changes and sends, and releases it before calling `on_command` or `on_event`. `on_birth` runs with the lock held. The lock is never taken twice by one task, so a non-recursive mutex works.
- [ ] T015 [US1] `src/health.c`: fills the default health metrics by their `iotos_health.h` names when the node type contains them:
  - **From the SDK:** `uptime` (integer, seconds since `iotos_start`), `sdk_version` (from `VERSION`), `devices_configured`, `devices_online` and `reconnects`.
  - **From the setters:** `iotos_set_firmware_version` gives `firmware_version`. `iotos_set_connection` gives `connection_type` (`ethernet`, `wifi`, `cellular` or `other`) and `signal_strength` (null when `has_signal` is false).
  - **When:** in every NBIRTH, and as NDATA every `IOTOS_HEALTH_INTERVAL_S`.
  - **Names only:** `bdSeq` and `Node Control/Rebirth` are added to the NBIRTH by name, without aliases.
- [ ] T016 [P] [US1] Desktop ports in `ports/posix/`, with `iotos_posix.h` declaring `iotos_posix_ports_init()`:
  - `stream_mbedtls.c`: mbedTLS over BSD sockets, with SNI, hostname verification, the settings CA, and recv timeouts.
  - `clock.c`: `clock_gettime(CLOCK_REALTIME)`, valid once it is after 2024-01-01 (`1704067200000`).
  - `storage_file.c`: one file per key in a directory, written to a temporary file and renamed.
  - `log.c` (stderr) and `lock.c` (pthread mutex).
- [ ] T017 [P] [US1] Test doubles in `tests/support/`:
  - `fake_mqtt_port.c`: records topics, payloads, QoS and retain, and accepts injected inbound messages.
  - `fake_stream.c`: a scripted MQTT broker at the byte level.
  - `fake_clock.c` and `fake_storage.c`.
  - `fake_lock.c`: a non-recursive lock that fails the test when one task takes it twice.
  - `decode.c`: decodes recorded payloads for assertions.
- [ ] T018 [US1] `tests/test_session.c` (fake MQTT port):
  - The will carries the current `bdSeq`; `bdSeq` increments and persists across `iotos_init` through the fake storage.
  - Nothing is published before STATE online.
  - The NBIRTH has seq 0, followed by the queued DBIRTHs.
  - `seq` wraps from 255 to 0.
  - An NCMD Rebirth, and a new STATE online, each produce a fresh NBIRTH followed by every DBIRTH.
  - Retained NCMD is ignored.
  - An authentication failure is its own event, and back-off delays grow up to the cap.
  - Three broker closes within 10 s of connecting, inside five minutes, report a session takeover; two do not.
  - An invalid clock holds births and reports `IOTOS_E_CLOCK` after the wait.
  - An `on_event` handler that publishes NDATA succeeds with `fake_lock`.
  - `iotos_stop` publishes NDEATH.
- [ ] T019 [P] [US1] `tests/test_mqtt_stream.c` (fake stream):
  - The CONNECT packet has the client ID, clean session, keepalive, and the will's topic, payload, QoS 1 and retain off.
  - SUBSCRIBE carries exactly the three filters.
  - CONNACK 5 returns `IOTOS_E_AUTH`.
  - Partial sends and receives are handled.

**Checkpoint**: a node-only gateway session works against the fakes.

### Phase 4: User Story 2, downstream devices (P1)

**Goal**: the integrator adds devices of shared types, publishes values, marks devices offline and receives validated commands, without composing Sparkplug.

**Independent test**: `ctest -R 'devices|writer|commands|size'`, covering 500 devices of two types, limits, offline devices and commands.

- [ ] T020 [US2] `src/devices.c` (data model § Device slot):
  - **Slots:**
    - `id`: up to `IOTOS_DEVICE_ID_MAX` characters from `[A-Za-z0-9_.:-]`, unique per gateway.
    - `type`: an index into the registered types.
    - `state`: `free`, `offline`, `birth_pending` or `born`.
  - **`iotos_register_type`:** returns `IOTOS_E_FULL` beyond `IOTOS_MAX_DEVICE_TYPES` types or `IOTOS_MAX_METRICS_PER_TYPE` metrics.
  - **`iotos_device_add`:** returns `IOTOS_E_DUPLICATE`, `IOTOS_E_INVALID` (bad ID or unregistered type) or `IOTOS_E_FULL`, and leaves other devices untouched.
  - **Offline and remove:** `iotos_device_offline` sends a DDEATH and moves the device to `offline`. `iotos_device_remove` sends a DDEATH and frees the slot.
  - **Aliases:** `((slot + 1) << 16) | metric_index`. Node metrics use `index + 1` (R9).
  - **Birth queue:** a ring of slot indexes.
- [ ] T021 [US2] `src/writer.c`:
  - **API:** `iotos_begin`, `iotos_put_*`, `iotos_put_at`, `iotos_commit` and `iotos_abort`.
  - **Lock:** held from begin until commit or abort, and only one writer is open at a time.
  - **Values:** metrics are found by name in the device's type. Each put checks the datatype and narrows integers with a range check.
  - **Timestamps:** `iotos_put_at` sets the time for the following puts; otherwise the clock gives it. An invalid clock returns `IOTOS_E_CLOCK`.
  - **Commit:**
    - Data carries aliases only. A NULL device sends NDATA.
    - A `birth_pending` device returns `IOTOS_PENDING_BIRTH` and sends nothing.
    - An `offline` device moves to `birth_pending` and is queued.
  - **Births:** a birth writer gives every type metric its name and alias. Metrics `on_birth` did not fill go as nulls with their datatype.
- [ ] T022 [US2] Paced births in `src/session.c`:
  - `iotos_poll` drains the birth queue at `IOTOS_BIRTHS_PER_SECOND`, NBIRTH first.
  - A birth that exceeds `IOTOS_TX_BUFFER`, or the MQTT port's `max_payload`, is reported through `on_event` with `IOTOS_E_TOO_LARGE`, naming the device type. The SDK moves on to the next birth.
  - Every NBIRTH moves each `born` or `birth_pending` slot back to `birth_pending`.
- [ ] T023 [US2] `src/commands.c` (R9):
  - **Decoding:** NCMD and DCMD are decoded with the reader. The device comes from the topic, and metrics are matched by name, never by alias.
  - **Rejections:** each is reported through `on_event` and the log port, and never applied:
    - an unknown device, or one that is `offline` or not yet born;
    - an unknown metric, or one not flagged `writable`;
    - a wrong datatype, or a value failing the range checks.
  - **Valid commands:** `on_command` is called on the poll task with the lock released, so it can publish the new state straight away.
  - **Rebirth:** `Node Control/Rebirth` is handled inside the SDK.
- [ ] T024 [P] [US2] `tests/test_devices.c` and `tests/test_writer.c`:
  - 500 devices of two types are born in order at the configured rate.
  - Aliases are unique across the node.
  - Limit, duplicate and invalid-ID errors leave other devices untouched.
  - A pending birth refuses publishes.
  - After offline, a publish returns `IOTOS_PENDING_BIRTH` and sends nothing. The device's DBIRTH follows, carrying the values `on_birth` writes, and DDATA is sent only on the next publish. So the order is DDEATH, DBIRTH, DDATA.
  - Unfilled metrics are nulls.
  - Writer datatype and range errors are returned.
  - `iotos_put_at` timestamps are used.
- [ ] T025 [P] [US2] `tests/test_commands.c`:
  - A valid DCMD reaches `on_command`.
  - An `on_command` that publishes the new state inside the callback succeeds with `fake_lock`, and the DDATA follows.
  - Each rejection case in T023 is reported and never applied.
  - A retained DCMD is ignored.
  - A command for an offline device is rejected.
  - `dcmd-light.bin` decodes into the callback.
- [ ] T026 [P] [US2] `tests/test_size.c`: a quick desktop check that `sizeof(iotos_gateway)` is 32768 bytes or less with `IOTOS_MAX_DEVICES=512` and the other defaults. Pointer sizes differ on the desktop, so SC-003 and FR-005 are judged by the arm `iotos_size` target (T008).

### Phase 5: User Story 3, pluggable network (P1)

**Goal**: one session runs unchanged over a TLS byte stream or over a modem's own MQTT.

**Independent test**: `ctest -R ports` gives identical message sequences at both levels.

- [ ] T027 [US3] MQTT-port level in `src/session.c`:
  - With `ports.mqtt` set, the session uses it: connect with the will, publish, subscribe, and `poll` delivering through `iotos_mqtt_inbound`. Nothing above the transport changes.
  - `iotos_init` returns `IOTOS_E_INVALID` unless exactly one of `stream` and `mqtt` is set.
  - `max_payload` is enforced as in T022.
- [ ] T028 [P] [US3] Port templates in `ports/templates/` (FR-014):
  - **Templates:** `stream-template.c`, `clock-template.c`, `storage-template.c`, `log-template.c` and `lock-template.c`.
  - **Annotations:** each spells out its port's contract for every function: return values, timeouts and error handling, plus:
    - partial I/O, and where the CA and hostname check belong (stream);
    - when the time counts as valid (clock);
    - atomic writes and missing keys (storage);
    - why the lock must not be recursive (lock).
  - **Check:** a CTest compiles each template with `-fsyntax-only` against `iotos_ports.h`, so they stay in step with the headers.
- [ ] T029 [US3] `tests/test_ports.c`: one scripted session runs once over `fake_stream` with coreMQTT and once over `fake_mqtt_port`.
  - The topics, payloads, QoS and retain flags are identical at both levels.
  - A `max_payload` smaller than a birth is reported with the type named.

### Phase 6: User Story 7, desktop simulator, SDK side (P3)

**Goal**: a gateway simulator on the same SDK code, before kits exist.

**Independent test**: `ctest -R simulator` passes the 500-device self-test.

- [ ] T030 [US7] `examples/desktop-simulator/` (`CMakeLists.txt`, `main.c`):
  - **Paths:** `IOTOS_SDK_DIR` defaults to `../../sdk` when it exists (a kit), otherwise the repository's `firmware/sdk`. The config directory defaults to `../../config` when it exists, otherwise `sample-config/`.
  - **Options:**
    - `--devices <type>=<count>` (repeatable)
    - `--interval <s>` (default 10)
    - `--state-file <path>` (`bdSeq` storage)
    - `--rate <births/s>`
  - **Devices:** IDs are `sim-<type>-<nnn>`.
  - **Values:**
    - booleans toggle and strings read `sim-<n>`;
    - DateTime is now;
    - integer metrics count up, and double metrics follow a random walk.
  - **Commands:** applied, then the new state is published from inside `on_command`.
  - **Direct kits:** with `IOTOS_KIT_GATEWAY 0`, it generates values for the node type's own metrics and refuses `--devices`.
  - **Stop:** SIGINT calls `iotos_stop`.
- [ ] T031 [P] [US7] `examples/desktop-simulator/sample-config/`: hand-written `iotos_settings.{h,c}`, `iotos_types.h`, `iotos_type_gateway_health.h` and `iotos_type_water_meter.h`.
  - Placeholder values: `mqtt.example.test`, port 8883, dummy credentials and `IOTOS_KIT_GATEWAY 1`.
  - The same shapes a kit generates ([kit-layout](contracts/kit-layout.md)).
- [ ] T032 [US7] `--selftest` mode in `examples/desktop-simulator/main.c`, registered with CTest:
  - Runs the simulator in-process against `tests/support/fake_mqtt_port.c` with 500 devices of two types.
  - Asserts an NBIRTH followed by 500 DBIRTHs in seq order, then data.

### Phase 7: Contract fixtures, CI and docs (PR 1)

- [ ] T033 `tools/fixtures.c` and an `iotos_fixtures` CMake target:
  - Drives the real session against the fake port with a fixed clock (`TIME=1712345000000`).
  - Writes `contracts/sparkplug/fixtures/sdk/`:
    - `nbirth-gateway.bin`, `ndata-health.bin`, `dbirth-water-meter.bin`
    - `ddata-alias.bin`, `ddata-null.bin`, `ddeath.bin`, `ndeath-will.bin`
    - `all-datatypes.bin`, and a `seq-wrap/` series of 260 messages
  - Writes `expected.json`: per file, the topic, decoded values, aliases and seq.
  - A CTest regenerates the fixtures into a temporary directory and compares them with the committed files.
- [ ] T034 Commit the generated `contracts/sparkplug/fixtures/sdk/` files. Extend `tooling/verify-devices-contracts.py` to check that every file is present and listed in `expected.json`.
- [ ] T035 [P] Runtime command fixtures (R11):
  - **Helpers:** extract `commandPayload(metric, ts)` from the inline `proto.Marshal` in `services/runtime/internal/app/commands.go:114`, and `rebirthPayload(ts)` from `services/runtime/internal/app/application.go:273`. The runtime calls them with the current time; there is no behaviour change, and the existing runtime tests pass unchanged.
  - **Test:** `services/runtime/internal/app/sdk_command_fixtures_test.go`:
    - With `-update`, it writes `contracts/sparkplug/fixtures/sdk/commands/{ncmd-rebirth,dcmd-bool,dcmd-double,dcmd-string}.bin` through the helpers, using `sparkplug.EncodeMetric` and `TIME=1712345000000`.
    - Without `-update`, it asserts the committed files match.
  - **C side:** extend `tests/test_commands.c` to decode them.
- [ ] T036 [P] `services/runtime/internal/sparkplug/sdk_fixtures_test.go` `TestSDKFixtures`:
  - Replays the fixtures in order through the session with the pinned Tahu protobuf.
  - Asserts the values and aliases in `expected.json`, zero diagnostics, the seq wrap accepted, and the NDEATH `bdSeq` matching the NBIRTH.
- [ ] T037 `.github/workflows/ci.yml` `sdk` job, with actions pinned by SHA like the other jobs:
  - A `{gcc, clang}` matrix on `ubuntu-latest`: CMake with `-DIOTOS_SANITIZE=ON`, build, `ctest --output-on-failure`.
  - A cross-compile step: install `gcc-arm-none-eabi` from apt, configure with the toolchain file, build `iotos_size`.
  - Cache the `FetchContent` downloads.
  - The existing `runtime` job already runs the new Go tests.
- [ ] T038 [P] Documentation:
  - `docs/features/embedded-sdk.md`, SDK part:
    - architecture, ports and templates, limits, wire rules, building and testing;
    - threading: which callbacks hold the lock, and publishing from `on_command`;
    - 64-bit integers are limited to ±2^53;
    - how store-and-forward will extend `iotos_storage_port` without breaking ports (FR-030).
  - `firmware/sdk/CHANGELOG.md`: "Unreleased" entries for the core, the desktop port, the templates and the simulator.
  - `docs/README.md`: an entry in the Features list and the repository map.
  - `docs/dev/gotchas.md`, the R8/R9 traps:
    - any NBIRTH wipes device registries;
    - one seq counter per node;
    - DDATA before its DBIRTH triggers a rebirth;
    - the broker grants only literal filters;
    - commands arrive by name and are confirmed by a later state reading.
- [ ] T039 Check PR 1 and open it:
  - Run quickstart 1 and 2 locally (sanitizers with clang on macOS, then the arm size target), `cd services/runtime && go test ./internal/sparkplug/ ./internal/app/` (whole packages, because T035 moves code) and `./taskw lint`.
  - **Rebuild:** T035 changes runtime code without changing behaviour, so rebuild `runtime` with the stack's env files and overlays (AGENTS.md command).
  - **Verify:** with the Python simulator, check that a command still completes and an activation still triggers one rebirth.
  - Leak scan, then open the PR against `main` after PR 0 has merged.

**Checkpoint**: PR 1 merged. PR 2 and PR 4 can start.

---

## PR 2: Kits, the gateway itself, gateway health profile

### Phase 8: Kit foundation

- [ ] T040 Put the SDK in the API image (R14):
  - In `.dockerignore`, add `!firmware/sdk` after the `firmware` exclusion.
  - Add `COPY firmware/sdk /var/firmware-sdk` to `deploy/docker/api/Dockerfile` and `deploy/docker/api/Dockerfile.release`.
  - Add `sdk_path` to `apps/api/config/devices.php`: `base_path('../../firmware/sdk')` when it exists, otherwise `/var/firmware-sdk`, mirroring `contracts_path`.

### Phase 9: User Story 6, the gateway's own health (P2)

**Goal**: a gateway's own source is onboarded as a device with a one-click health profile.

**Independent test**: `php artisan test --compact --filter 'GatewayHealthProfile|GatewayNodeOnboarding'`, then quickstart 4.

- [ ] T041 [US6] `apps/api/app/Domain/DeviceProfiles/Actions/PrepareGatewayHealthProfile.php`:
  - Under an organization lock, creates the profile and publishes it through `PublishDeviceProfile`, following `PrepareWaterMeterProfile`.
  - Code `gateway-health`, name "Gateway health", category `gateways`.
  - Every parameter has `reports_state = true` and `accepts_command = false`:

    | Key | Label | Type | Unit | Kind | Notes |
    | --- | --- | --- | --- | --- | --- |
    | `uptime` | Uptime | integer | s | counter | |
    | `connection_type` | Connection | enum | | state | `ethernet`, `wifi`, `cellular`, `other` |
    | `signal_strength` | Signal strength | number | dBm | measurement | |
    | `firmware_version` | Firmware version | string | | state | |
    | `sdk_version` | SDK version | string | | state | |
    | `devices_configured` | Devices configured | integer | | measurement | |
    | `devices_online` | Devices online | integer | | measurement | |
    | `reconnects` | Reconnects | integer | | counter | |

  - Parameter configuration ([data model](data-model.md#gateway-health-profile)), which `ProfileConfigurationValidator` requires or the metrics need:
    - `uptime` and `reconnects`: `counter_config` `{"monotonic": true, "reset_behavior": "new_segment"}`, so a reboot starts a new segment instead of a diagnostic.
    - `connection_type`: `validation_logic` `{"rule": {"in": [{"var": "value"}, ["ethernet", "wifi", "cellular", "other"]]}}`.
    - Every parameter: `reporting_config.stale_after_seconds = 180`, three default health intervals.
  - Returns the existing profile, unchanged, when the code already exists.
  - Records `device_profile.gateway_health.created` with `revision`.
- [ ] T042 [US6] `apps/api/app/Domain/DeviceProfiles/Http/Controllers/GatewayHealthProfileController.php` `@store`:
  - Route `POST device-profiles/gateway-health` in `apps/api/app/Domain/DeviceProfiles/routes/api.php`, registered before the `device-profiles/{profile}` routes.
  - Requires `DeviceProfile.create` and `DeviceProfile.publish`.
  - Returns 201 when created and 200 when it already existed, with `{ "profile_uuid", "artifact_uuid", "created" }`.
  - Add an `ActivityCatalogue` entry.
- [ ] T043 [US6] `apps/api/tests/Feature/Domain/DeviceProfiles/GatewayHealthProfileTest.php`:
  - Creates and publishes once; later calls return the same artifact.
  - The published revision has the counter, enum and staleness configuration from T041.
  - An edited profile is returned as is, with `created: false`.
  - Missing permissions get 403.
  - Another organization's profile is never returned.
  - The parameter keys equal the `IOTOS_HEALTH_*` names parsed from `firmware/sdk/include/iotos/iotos_health.h`.
- [ ] T044 [US6] `POST device-onboardings` gains `source: "node"` in `OnboardingController` and its request (R16):
  - In gateway mode, exactly one of `source` and `source_device_id` is required.
  - `source: "node"` is stored as `source_device_id = ''`.
  - The existing one-setup-per-(gateway, source) rule applies.
  - Direct mode is unchanged.
- [ ] T045 [US6] `apps/api/tests/Feature/Domain/Devices/GatewayNodeOnboardingTest.php`:
  - A node source onboards under an existing gateway without a new gateway or connection, and compiles `source.device_id = ''`.
  - A second attempt gets 422, and sending both fields gets 422.
  - Another organization's gateway gets 404.
  - The discovery path (`OnboardSource` → configuration) still attaches a node source.
  - Direct-mode tests pass unchanged.
- [ ] T046 [P] [US6] `packages/api-client/src/onboarding.ts` adds `source: "node"` to the request type. `packages/api-client/src/devices.ts` adds `createGatewayHealthProfile`.
- [ ] T047 [US6] `apps/portal/src/devices/DeviceOnboarding.tsx`:
  - In gateway mode, a **The gateway itself** choice beside the device ID field.
  - When chosen, it suggests the organization's gateway health profile, or offers **Create gateway health profile** when there is none.
  - Uses the kit's `SearchableSelect`.
- [ ] T048 [US6] Extend `apps/portal/e2e/onboarding.spec.ts` (mocked API): node onboarding, profile creation, and the request body carrying `source: "node"`.

### Phase 10: User Story 4, gateway kit (P2)

**Goal**: an operator downloads a ready-to-build kit for a gateway, generated from published profiles.

**Independent test**: `php artisan test --compact --filter 'EmbeddedKit|GatewayKit|DeviceOnboarding'`, then quickstart 3.

- [ ] T049 [US4] `apps/api/app/Domain/Devices/Services/EmbeddedKit.php` ([kit-layout](contracts/kit-layout.md), R20):
  - **Settings:** renders `config/iotos_settings.h` and `config/iotos_settings.c`, with `.node_type` set to the node's type and `IOTOS_KIT_GATEWAY` set to 1 for a gateway kit and 0 for a direct kit.
  - **Types:** renders `config/iotos_types.h` and one `config/iotos_type_<code>.h` per artifact, the node's included.
    - `iotos_kit_types[]` and `IOTOS_KIT_TYPE_COUNT` list the downstream types only.
    - With no downstream types (a direct kit), the count is 0 and the array holds one `NULL`, so it stays valid C99.
  - **Type mapping:**

    | Profile type | Kit writes |
    | --- | --- |
    | boolean | `IOTOS_BOOLEAN` |
    | integer | `IOTOS_INT64` |
    | number | `IOTOS_DOUBLE` |
    | enum, string | `IOTOS_STRING` |
    | timestamp | `IOTOS_DATETIME` |
    | bytes | `IOTOS_BYTES` |

  - **Metrics:**
    - Names are the parameter keys, in profile order.
    - Parameters without `reports_state`, and `derived` ones, are left out.
    - `writable` equals `accepts_command`.
  - **Identifiers:** `<code>` becomes `[a-z0-9_]`, with a numeric suffix on a collision.
  - **Escaping:** strings are C-escaped, and control characters are rejected.
  - **Size:** an estimate of `birth_bytes` per type at a 24-character ID, with a warning above 4096.
  - **Bundled files:**
    - The SDK from `config('devices.sdk_path')`: `include/`, `src/`, `ports/`, `third_party/`, `LICENSE`, `THIRD_PARTY.md`, `CHANGELOG.md`, `VERSION`.
    - Every folder under `examples/` except `sample-config/`, so the board example joins once PR 4 adds it.
    - `kit.json`: `sdk_version`, `generated_at`, the gateway uuid, profile codes and revisions, and warnings. No secrets.
- [ ] T050 [US4] `apps/api/tests/Feature/Domain/Devices/EmbeddedKitTest.php`:
  - Covers the type mapping, skipped parameters, writable flags, escaping, rejected control characters, the collision suffix, the size warning and `kit.json` holding no password.
  - When `cc` is on the PATH, it runs `cc -std=c99 -fsyntax-only -I<sdk>/include` on the generated `config/` files of both a gateway kit and a direct kit (no downstream types); otherwise the test is skipped.
- [ ] T051 [US4] `apps/api/app/Domain/Devices/Services/GatewayKit.php`:
  - **Settings:** the host and port of `devices.broker_public_url`, the group, edge node, host ID, username, the decrypted `SparkplugGateway.password`, and the CA PEM.
  - **Refusals (422):** reuse `DeviceConnectionKit`'s messages for:
    - a gateway with no credentials (platform-managed);
    - a connection that is not `ready`;
    - no public `ssl://` URL;
    - a missing or invalid CA.
  - **README.md:** covers:
    - building the simulator and the board example;
    - which files to edit;
    - one kit per gateway;
    - keeping `config/` out of version control;
    - the CA verifies the broker and is not a client certificate;
    - publishing the new state after a command;
    - the cost of raising `IOTOS_DEVICE_ID_MAX`.
  - **Archive:** zipped with `PharData` in a private temporary directory that is always removed, named `<edge>-gateway-kit.zip`.
- [ ] T052 [US4] `apps/api/app/Domain/Devices/Http/Controllers/GatewayKitController.php` `@store` and `@archive`, with a `GatewayKitRequest`:
  - **Validation:**
    - `health_artifact_uuid` is required.
    - `device_types` has 0–8 entries from distinct profiles.
    - Each artifact must be a published revision in this organization, otherwise 404.
  - **Routes:** `POST gateways/{gateway}/kit` and `GET gateways/{gateway}/kit/archive?health=&types[]=` in `apps/api/app/Domain/Devices/routes/api.php`, with `throttle:10,1`.
  - **Access:** `Device.manage-connections`. Another organization's gateway gets 404.
  - **Headers:** `Cache-Control: no-store, private` and `Pragma: no-cache`. The archive adds `Content-Disposition: attachment`.
  - **Activity:** `ActivityLog::record` `gateway.kit.downloaded` with `sdk_version`, `health_profile_revision` and `device_types` (code and revision), plus an `ActivityCatalogue` entry.
- [ ] T053 [US4] `apps/api/app/Domain/Devices/Services/DeviceConnectionKit.php`:
  - Adds `config/iotos_settings.h`, `config/iotos_settings.c`, `config/iotos_types.h` and `config/iotos_type_<code>.h`, with the device's profile as the node type and `IOTOS_KIT_GATEWAY 0` ([kit-layout](contracts/kit-layout.md#direct-device-kit)).
  - Adds `sdk/` and `examples/`.
  - `device-config.json`, `ca.crt` and `quickstart.md` stay byte-for-byte as today.
- [ ] T054 [US4] `apps/api/tests/Feature/Domain/Devices/GatewayKitTest.php`:
  - The archive file list and settings values are right.
  - A missing permission gets 403, and another organization's gateway or artifact gets 404.
  - Unpublished artifacts, every 422 refusal, the no-store headers and the throttle are covered.
  - The activity entry carries no secrets, and the password appears in no JSON response.
  - `DeviceOnboardingTest` gains assertions for the direct kit's new files (including `config/iotos_settings.c` and `IOTOS_KIT_GATEWAY 0`), with its existing assertions unchanged.
- [ ] T055 [US4] API contract and client:
  - Run `cd apps/api && php artisan contract:export` and add any supplement entries.
  - Add `gatewayKit` and `gatewayKitArchiveUrl` to `packages/api-client/src/devices.ts`.
  - `contract:export --check` passes.
- [ ] T056 [US4] `apps/portal/src/devices/GatewayKitDialog.tsx`, used from `GatewayPage.tsx` and `GatewaysPage.tsx`:
  - **Download kit** replaces **Get credentials**, which is kept as a secondary note about the server export. It shows only with `Device.manage-connections`.
  - The dialog first applies broker access (`POST gateways/{gateway}/provision`).
  - A health profile `SearchableSelect`, with **Create gateway health profile** (T046) when the organization has none.
  - Up to 8 device-type `SearchableSelect`s of published profiles.
  - **Download kit** calls `POST gateways/{gateway}/kit` once, never on a selection change: each call returns the credentials, records a download and counts against the 10-per-minute throttle. The dialog then starts the archive download from `gatewayKitArchiveUrl`, as `ConnectionKit.tsx` does, and shows the birth-size warnings from the POST response with the result.
  - Credentials stay in component state only, as in `ConnectionKit.tsx`.
  - Content sits in a `Panel`.
- [ ] T057 [US4] `apps/portal/e2e/gateway-kit.spec.ts` (mocked API):
  - The dialog provisions first and creates the health profile.
  - The 8-type limit shows.
  - Changing selections sends no kit request. One **Download kit** click sends one POST and then the archive GET, and the warnings show.
  - The archive URL carries the chosen revisions.
  - The button is hidden without permission.

### Phase 11: User Story 7, simulator from a kit, and the end-to-end check

- [ ] T058 [US7] `tooling/verify-embedded-sdk.mjs` (R21), reading `.local/devices/environment.json`:
  1. Registers a gateway and downloads its kit into `.local/`.
  2. Builds `examples/desktop-simulator` with CMake.
  3. Runs it with `--devices water_meter=250 --devices <second type>=250`.
  4. Asserts 500 discovered sources and zero runtime diagnostics.
  5. Stops and restarts the simulator with the same `--state-file`, then asserts all 500 sources are announced again within five minutes with the next `bdSeq` (SC-004, US7).
  6. Bulk-onboards 247 sources, counting rebirths from the simulator log. This step is skipped with a note while the bulk endpoint returns 404.
  7. Onboards the gateway's own source with the health profile.
  8. Sends one command and asserts it is confirmed.
  9. Stops the simulator and asserts the gateway and its devices go offline.
  - Prints timings, including the re-announcement time, and the rebirth count.
- [ ] T059 [US7] `tooling/test-devices.mjs` runs `verify-embedded-sdk.mjs` when `cc` and `cmake` are on the PATH, and prints why when it skips.

### Phase 12: PR 2 documentation and verification

- [ ] T060 [P] Documentation:
  - `docs/features/devices.md`: gateway kits and onboarding the gateway itself. This replaces the "the portal never shows gateway credentials" text.
  - The kits section of `docs/features/embedded-sdk.md`.
  - `apps/api/resources/help/devices.md`: the kit download steps.
- [ ] T061 Checks:
  - `cd apps/api && php artisan test --compact`, `vendor/bin/pint --test`, `php artisan contract:export --check` and `php artisan contract:check --base=origin/main`, as CI runs them.
  - `pnpm --filter @iot-os/portal lint`, the portal e2e specs and `./taskw lint`.
- [ ] T062 Rebuild `api`, its workers and `portal` with the stack's env files and overlays (AGENTS.md command; see [the list](../../docs/dev/local-setup.md#rebuild-one-service)).
  - Run quickstart 3, 4, 6 and 7 against the running stack, preserving unsaved browser edits.
  - Check that the kit came from the image's `/var/firmware-sdk`.
- [ ] T063 Set ADR-029 to Accepted in its status line and in its `docs/adr/README.md` row. Leak scan, then open PR 2 against `main` after PR 1 has merged.

**Checkpoint**: PR 2 merged. Kits and node onboarding are live.

---

## PR 3: Bulk onboarding

### Phase 13: User Story 5, onboard hundreds of discovered devices (P2)

**Goal**: one action creates, maps and activates up to 500 discovered sources of one gateway with one profile.

**Independent test**: `php artisan test --compact --filter BulkOnboarding`, then quickstart 5 with the Python simulator.

- [ ] T064 [US5] Migration `apps/api/database/migrations/2026_11_XX_000000_create_device_bulk_onboardings.php`:
  - **`device_bulk_onboardings`:**
    - `id`; `uuid` (unique); `organization_id` FK; `sparkplug_gateway_id` FK; `device_profile_artifact_id` FK
    - `name_pattern`: string(120)
    - `request_hash`: char(64)
    - `status`: string, default `queued`
    - `created_by`: bigint (an integer user id)
    - `started_at`, `finished_at`: nullable timestamptz; timestamps
    - Index `(organization_id, created_at)`.
  - **`device_bulk_onboarding_items`:**
    - `id`; `device_bulk_onboarding_id` FK with cascade delete
    - `source_device_id`: string(128)
    - `discovery_candidate_id`, `device_id`: nullable FKs
    - `status`: string, default `pending`
    - `reason`: nullable string(500)
    - `attempts`: smallint, default 0; timestamps
    - Unique `(device_bulk_onboarding_id, source_device_id)`.
  - `down()` drops both tables.
- [ ] T065 [P] [US5] Models in `apps/api/app/Domain/Devices/Models/` and enums in `apps/api/app/Domain/Devices/Enums/`:
  - `DeviceBulkOnboarding` and `DeviceBulkOnboardingItem`, with relations and casts.
  - `BulkOnboardingStatus`: `queued`, `running`, `succeeded`, `partial_failure`, `failed`.
  - `BulkOnboardingItemStatus`: `pending`, `activation_requested`, `skipped`, `failed`. `active` is derived, never stored.
- [ ] T066 [P] [US5] Move `DeviceController::mappingSuggestions` into `apps/api/app/Domain/Devices/Services/MappingSuggestions.php`. The endpoint calls the service and its existing tests pass unchanged.
- [ ] T067 [US5] `apps/api/app/Domain/Devices/Services/BulkOnboarding.php`, following `GeofenceService`:
  - **Validation:**
    - `source_device_ids`: 1–500 distinct, non-empty IDs, each a discovered source of the gateway (`''` is not allowed).
    - The artifact must be a published revision in the organization.
    - `name_pattern`: at most 120 characters; must contain `{device_id}`; may also use `{gateway}` and `{n}`.
  - **`request_hash`:** SHA-256 of the normalised request, with IDs sorted.
  - **Idempotency:** the same `operation_uuid` with a different hash gets 409. The same request returns the existing run.
  - **Creation:** creates the run and one `pending` item per source.
  - **Codes:** `<edge node id>-<device id>`, lowercased, invalid characters replaced, with a numeric suffix on a clash.
  - **Roll-up:**
    - `succeeded` when every item is `activation_requested` or later;
    - `partial_failure` when at least one item is `skipped` or `failed` and at least one succeeded;
    - `failed` when none succeeded.
  - **Retry:** re-queues `failed` items only, incrementing `attempts`.
- [ ] T068 [US5] `apps/api/app/Domain/Devices/Jobs/OnboardDiscoveredSources.php`, following `DeployAdapter` (R18):
  - **Queue:** `ShouldQueue`, `tries = 1`, the `default` queue on the database connection.
  - **Guard:** `queued → running`.
  - **Chunks:** at most 50 items per job, then it dispatches the next job (the release worker has `--timeout=60`).
  - **Each item:** claimed with `lockForUpdate` and re-checked as `pending`. Then, in one transaction:
    1. Check the candidate is still available, or skip with `already onboarded`.
    2. Create the device with its generated name and code.
    3. Save a draft with `MappingSuggestions`.
    4. Compile it. A missing metric or a datatype mismatch skips the item with a reason such as `missing metric flow_rate` or `datatype String for number parameter level`.
    5. Activate it through `DeviceConfigurationService`. The item becomes `activation_requested`.
  - **Failures:** an exception marks the item `failed` with a reason of at most 500 characters. Items are never retried automatically.
  - **Activity:** `device.onboarding.started` gains `bulk_run_uuid`. `failed()` marks the remaining items and the run failed. The last chunk rolls the run up and records `device.bulk_onboarding.finished` with counts per status.
- [ ] T069 [US5] `apps/api/app/Domain/Devices/Http/Controllers/BulkOnboardingController.php` `@store`, `@show` and `@retry`, with a request and resource, and routes in `apps/api/app/Domain/Devices/routes/api.php`:
  - `POST gateways/{gateway}/bulk-onboardings`: `Device.manage` and `Device.activate`, `throttle:5,1`. Returns 202 with the run, 409 or 422. Records `device.bulk_onboarding.started`.
  - `GET bulk-onboardings/{run}`: `Device.view`. Returns counts (including `active`, derived from each device's applied configuration) and items paged by `?cursor=`, 100 per page.
  - `POST bulk-onboardings/{run}/retry`: the same permissions as create.
  - Another organization's run or gateway gets 404.
  - `ActivityCatalogue` entries for the new codes.
- [ ] T070 [US5] `apps/api/tests/Feature/Domain/Devices/BulkOnboardingTest.php`:
  - **Run:** 247 sources run through every chunk, with codes and names generated.
  - **Items:**
    - A source missing a profile metric is skipped with its reason while the others continue.
    - An already onboarded source is skipped.
  - **Idempotency:** the same `operation_uuid` with the same request returns the run, and with a different one gets 409.
  - **Duplicates:** a duplicate dispatch creates no second device.
  - **Status:**
    - `active` appears only after the runtime acknowledges.
    - Every roll-up status is covered.
  - **Retry:** re-runs failed items only.
  - **Access and limits:**
    - Missing permissions get 403, and another organization gets 404.
    - More than 500 IDs, and node sources, get 422.
  - **Activity:** entries are recorded with no secrets.
- [ ] T071 [US5] Add a `default` queue worker to `deploy/compose/compose.app.yml`, mirroring the release (`queue:work database --queue=default --sleep=2 --timeout=60 --max-time=3600`). Add it to the service list in `docs/dev/local-setup.md#rebuild-one-service`.
- [ ] T072 [P] [US5] API contract and client: run `php artisan contract:export` (the check passes); add `createBulkOnboarding`, `bulkOnboarding` and `retryBulkOnboarding` to `packages/api-client/src/devices.ts`.
- [ ] T073 [US5] `apps/portal/src/devices/DiscoveryPage.tsx`:
  - With a gateway filter set, `DataTable` row selection inside `CollectionPage`, offered only with `Device.manage` and `Device.activate`.
  - **Select all N matching:** the page shows 25 rows at a time, so this action loads every source matching the gateway filter and search, in pages of 100 (the endpoint's maximum). The selection then spans pages and keeps each source's metrics for the dialog's match summary.
  - An **Onboard selected** action, through the table's `bulkActions` with the selected IDs.
  - Selecting more than 500 asks the operator to split the selection.
- [ ] T074 [US5] `apps/portal/src/devices/BulkOnboardingDialog.tsx`:
  - A profile `SearchableSelect` of published profiles.
  - The name pattern (default `{device_id}`), with a preview of three names.
  - A match summary, computed from every selected source's metrics (T073), that flags sources whose birth lacks a profile metric before starting.
  - A client-generated `operation_uuid`, kept across retries of the same submit.
- [ ] T075 [US5] Run panel in `apps/portal/src/devices/BulkOnboardingRun.tsx`, shown on the Discovery page:
  - A `Panel` that polls `GET bulk-onboardings/{run}` until it finishes.
  - Counts shown with `Status`/`statusOf` and a per-item `DataTable` with reasons.
  - **Retry failed**, and `RelativeTime` for the start and finish times.
- [ ] T076 [US5] `apps/portal/e2e/bulk-onboarding.spec.ts` (mocked API):
  - Selection, including **Select all N matching** across pages, the dialog preview, the mismatch flag for a source on another page, progress polling, and retry.
  - The action is hidden without permission.
- [ ] T077 [P] [US5] `--meters <count>` option in `tooling/simulators/sparkplug_simulator.py`, announcing `meter-001`… under the gateway. Unit test in `tooling/simulators/test_sparkplug_simulator.py`. It lets quickstart 5 run before PR 2.
- [ ] T078 [P] [US5] Documentation: bulk onboarding in `docs/features/devices.md`, and the steps in `apps/api/resources/help/devices.md`.
- [ ] T079 [US5] Check, rebuild and verify PR 3:
  - Run the T061 checks.
  - Rebuild `api`, its workers (including the new `default` worker) and `portal`.
  - Run quickstart 5 with the Python simulator (`--meters 247`).
  - If PR 2 has merged, also run `verify-embedded-sdk.mjs` and record its rebirth count in the PR.
  - If PR 4 has already merged, remove spec 026 from `docs/roadmap.md` here.
  - Leak scan, then open the PR against `main`.
- [ ] T080 [US5] Only if T079 counts more than three rebirths per run (R19): the runtime skips the activation rebirth when the source's current birth is already cached, in `services/runtime/internal/app/application.go`, with a test in `services/runtime/internal/app/`. Re-measure, then record the result in research R19.

**Checkpoint**: PR 3 merged. 247 devices onboard in one action.

---

## PR 4: Board port, modem template, bench

### Phase 14: User Story 1 on hardware and User Story 3 modem template

**Goal**: the kit's board example builds unchanged for the MIMXRT1050-EVKB and connects over Ethernet; integrators have a modem template.

**Independent test**: quickstart 8 on the bench.

- [ ] T081 [P] [US1] `ports/freertos/lock.c` (a non-recursive mutex from `xSemaphoreCreateMutexStatic`, which the SDK never takes twice on one task) and `ports/freertos/log.c` (through a `IOTOS_FREERTOS_PRINTF` macro, defaulting to `PRINTF`), with `iotos_freertos.h`.
- [ ] T082 [US1] `.github/workflows/ci.yml` `sdk` cross-compile also builds `ports/freertos` against FreeRTOS-Kernel headers pinned with `FetchContent`, using a minimal `FreeRTOSConfig.h` in `firmware/sdk/tests/freertos-config/`.
- [ ] T083 [US1] `ports/mcuxpresso-lwip/`, with `iotos_mcux.h`:
  - `stream_mbedtls_lwip.c`: mbedTLS over lwIP sockets, with hostname verification, the settings CA, and entropy from the board's TRNG.
  - `clock_sntp.c`: lwIP SNTP, valid after the first sync.
- [ ] T084 [US1] `examples/rt1050-evkb-ethernet/`:
  - **Build:** CMake/armgcc using `MCUXSDK_ROOT`, pinned to the MCUXpresso SDK 25.x version it was verified with (stated in its README).
  - **Base:** the SDK's lwIP + mbedTLS + FreeRTOS examples (ENET, DHCP).
  - **coreMQTT:** builds the SDK's pinned copy from `sdk/third_party/coreMQTT/`. The README says to leave the MCUXpresso coreMQTT middleware unselected, because two copies give duplicate symbols (R3).
  - **Tasks:**
    - one for the network and SNTP, and one for the SDK poll;
    - an RS-485 polling stub: an LPUART Modbus RTU read loop over addresses 1–247, with the integrator's hooks marked `TODO(integrator)`. It is built only when `IOTOS_KIT_GATEWAY` is 1, so a direct kit's example has no polling task.
  - **Console:** logs the clock sync, TLS and births.
  - **Config:** read from `../../config`.
- [ ] T085 [US1] Extend `apps/api/tests/Feature/Domain/Devices/GatewayKitTest.php` to assert that `examples/rt1050-evkb-ethernet/` is in the kit.
- [ ] T086 [P] [US3] `ports/templates/modem-at-mqtt-template.c`, an MQTT port annotated for the BG95 command family (R5):
  - `AT+QMTCFG` for the will, `AT+QMTOPEN`, `AT+QMTCONN`, `AT+QMTPUBEX` with an explicit length, `AT+QMTSUB`, and the `+QMTRECV` URC.
  - Which receive mode keeps binary payloads intact, and the `AT+QLTS`/`AT+CCLK` clock.
  - The header says "untested" until the phase-2 bench modem passes, and names the transparent-TLS-socket fallback.
- [ ] T087 [P] [US1] `tooling/hardware/modbus_simulator.py`:
  - A pymodbus RTU server answering addresses 1–247 on one serial port, with `--port`, `--baud` and a register map matching the board example.
  - Pin `pymodbus` in `tooling/hardware/requirements.txt`.
  - Add `tooling/hardware/test_modbus_simulator.py` for the register map, run locally like the other hardware tests.
- [ ] T088 [P] [US1] `docs/hardware/rt1050-evkb.md`:
  - The bench: the board, an RS-485 click on an Arduino click shield, a USB-RS485 adapter, and an optional Modbus sensor.
  - Wiring, the shield's single-UART limit, the Modbus simulator, and the phase-2 modem.
  - No partner names.
  - Also in PR 4's documentation:
    - list the bench doc under hardware in `docs/README.md`;
    - add the FreeRTOS and MCUXpresso/lwIP ports, the board example and the modem template's status to the ports section of `docs/features/embedded-sdk.md`;
    - add "Unreleased" entries for them in `firmware/sdk/CHANGELOG.md`.
- [ ] T089 [US1] Bench run, quickstart 8:
  - Rebuild `api` with the stack's env files and overlays (AGENTS.md command), because the image bundles `firmware/sdk` into kits and this PR adds the board example. Download a fresh kit from the local stack and check that it contains `examples/rt1050-evkb-ethernet/`.
  - Build from that kit, flash, and watch the console.
  - Unplug the Ethernet cable, then plug it back in: everything is re-announced within five minutes (SC-004).
  - Record RAM and flash use, and the time from kit download to first readings (SC-001), in the PR.

### Phase 15: Polish (PR 4)

- [ ] T090 [P] Public developer page `apps/docs/src/content/docs/docs/developers/embedded-sdk.mdx`, in the Developers sidebar group. It has no repository paths and names no licence (`docs/dev/docs-site.md` writing rules).
- [ ] T091 Check, release and open PR 4:
  - **Checks:**
    - quickstart 1 and 2, with the cross-compile now including `ports/freertos`;
    - `cd apps/api && php artisan test --compact --filter 'GatewayKit|EmbeddedKit'`;
    - `python -m unittest discover -s tooling/hardware -p 'test_*.py'`;
    - `./taskw lint`.
  - Move the `firmware/sdk/CHANGELOG.md` entries under `0.1.0`.
  - If PR 3 has already merged, remove spec 026 from `docs/roadmap.md` here (T079 does it if PR 3 merges last).
  - Leak scan, then open PR 4 against `main` once PR 2 has merged (T085 needs the kit endpoint).

**Checkpoint**: the feature is complete. Run `/speckit-converge` before closing it.

---

## Dependencies & Execution Order

### Pull requests

| PR | Phases | Depends on |
| --- | --- | --- |
| 0 | 1 | — |
| 1 | 2–7 | PR 0 merged |
| 2 | 8–12 | PR 1 merged (the kit bundles the SDK; T043 reads `iotos_health.h`) |
| 3 | 13 | PR 0 merged; it is built and checked with the Python simulator (T077) |
| 4 | 14–15 | PR 1 and PR 2 merged (T085 asserts the board example in the gateway kit) |

### Within PR 1

- Phase 2 blocks everything else.
- US1 (Phase 3) comes before US2 (Phase 4): devices need the session and the seq path.
- US3 (Phase 5) needs T014, and T029 needs T017.
- US7 (Phase 6) needs US1 and US2.
- Phase 7 needs Phases 3 to 5. T036 needs T034, and T035's C side needs T023.

### Within PR 2

- T040 blocks T049.
- US6 (Phase 9) comes before US4's dialog (T056 uses T042 and T046), but T049–T054 can run alongside Phase 9.
- T058 needs Phases 9 and 10.

### Within PR 3

- T064 → T065 → T067 → T068 → T069 → T070.
- T066 can run alongside T064.
- The portal tasks T073–T076 need T072.
- T080 runs only if T079's measurement calls for it.

### Within PR 4

- T081 → T082.
- T083 → T084 → T089.
- T086–T088 and T090 are independent.

## Parallel examples

```text
# PR 1, after T009:
T010 codec writer        | T016 desktop ports         | T017 test doubles
# PR 1, Phase 7:
T035 Go command fixtures | T036 Go replay test        | T038 docs
# PR 2, after T040:
T041–T045 health + node  | T049–T050 header generation
# PR 3, at the start:
T064 migration           | T066 MappingSuggestions    | T077 Python simulator
# PR 4:
T081 FreeRTOS port       | T086 modem template        | T087 Modbus simulator | T088 bench doc | T090 docs page
```

## Implementation strategy

- **MVP:** PR 1 plus PR 2's US4 and US6. A firmware engineer downloads a kit, runs the simulator or board example, and the gateway and its devices appear in Discovery.
- **Then PR 3:** devices at the partner's scale become usable.
- **Last, PR 4:** hardware verification. The board port is called supported only after the bench run (T089), and the modem template only after the phase-2 modem check.
- **When PR 3 lands first:** quickstart 5 runs on the Python simulator until PR 2 merges; then T058's bulk step covers it.
