# Research: Embedded Gateway SDK

## SDK

### R1. Where the SDK lives and what it is called

**Decision**: `firmware/sdk/`, next to `firmware/waveshare-audio/`. C symbols and macros
use the `iotos_` / `IOTOS_` prefix; the public header is `include/iotos/iotos.h`. The SDK
has its own semantic version in `firmware/sdk/VERSION`, starting at `0.1.0`, and a
`CHANGELOG.md`. Kits record the version they contain.

**Rationale**: `firmware/` already holds device code. A folder-level version keeps SDK
releases independent of platform releases while kits still pin one. The prefix avoids
the generic `iot_` used by FreeRTOS and AWS libraries.

**Alternatives**: a separate repository (cleaner licence boundary, but kits, contract
fixtures and the end-to-end test would span two repositories); `packages/` (holds
TypeScript workspaces).

### R2. Sparkplug encoding: own streaming codec, not nanopb or Tahu C

**Decision**: grow the bounded codec in
`firmware/waveshare-audio/main/sparkplug_wire.c` into a streaming writer and reader.
The writer appends one metric at a time straight into the transmit buffer (protobuf
length prefixes are reserved and patched), so a large birth needs no per-metric
structures. It covers the payload fields and datatypes the runtime accepts (data
model §Datatypes) and nothing else. The reader decodes NCMD/DCMD into a callback one
metric at a time.

**Rationale**: no dynamic memory and no code generator in the integrator's build.
Memory stays proportional to the buffer, not to the metric count. The subset is small
(about 600 lines) and is pinned to the official Tahu `.proto` through golden fixtures
that the Go runtime decodes (R11). The runtime decodes Int8–64, UInt8–64, Float,
Double, Boolean, String/Text/UUID, DateTime and Bytes as typed values, and turns
anything else into a per-metric diagnostic
(`services/runtime/internal/sparkplug/session.go:276-326`). So the SDK writes exactly
those types, and checks the runtime's value rules before writing: no NaN or Inf, 64-bit
integers within ±2^53, and UInt8/16 in range.

**Alternatives**: nanopb (zlib licence, static allocation possible, but repeated
metrics need callbacks or fixed arrays sized for the largest birth, and it adds a
generator step); the Eclipse Tahu C library (built on nanopb and grows payload arrays
on the heap, which conflicts with FR-005).

### R3. MQTT client at the byte-stream level: coreMQTT

**Decision**: the SDK runs MQTT 3.1.1 through coreMQTT (MIT) when the integrator
supplies a byte stream. A pinned coreMQTT release (its `source/` folder and licence) is
vendored at `firmware/sdk/third_party/coreMQTT/`, with the tag recorded in
`THIRD_PARTY.md`. Every build uses that copy, the board included (the MCUXpresso
middleware copy is not used), so the board runs the MQTT code the tests ran. Kits copy
it from the SDK folder, because the API image cannot fetch it at download time. A
project must not also build the MCUXpresso coreMQTT middleware, because two copies give
duplicate symbols. The board example's README says to leave it unselected.

**Rationale**: coreMQTT is portable C with no OS or heap use, and its transport
interface (`send`/`recv` on a network context) maps directly onto FR-012's byte
stream. It is maintained and already part of the vendor SDK, which matches the
owner's preference for maintained libraries over in-house protocol code.

**Alternatives**: an in-house MQTT client (more protocol code to own); lwIP's MQTT app
(tied to lwIP, unusable over a modem stream); Paho Embedded C (EPL/EDL licence, less
active).

### R4. TLS stays in the ports

**Decision**: the core never touches TLS. A byte-stream port is a TLS stream: on
MCUXpresso it is mbedTLS over lwIP sockets; on the desktop it is mbedTLS over BSD
sockets (pinned through `FetchContent`). Hostname verification and the kit's CA are
required in both.

**Rationale**: using the same TLS library on the desktop as on the board catches CA,
SNI and configuration mistakes before hardware. Modems with their own TLS implement
the MQTT level (R5) and keep TLS on the modem.

**Alternatives**: OpenSSL on the desktop (simpler on Linux, but differs from the board);
TLS in the core (would force one TLS library on every integrator).

### R5. Modems that run MQTT themselves

**Decision**: a second interface, `iotos_mqtt_port`, with connect (including the will),
publish, subscribe, disconnect and an inbound-message callback. The session layer
(births, sequence, rebirth, commands) is identical above both levels. The repository
ships a template for a UART modem with AT MQTT commands, annotated with the Quectel
BG95 command family (`AT+QMTCFG` for the will, `AT+QMTOPEN`, `AT+QMTCONN`,
`AT+QMTPUBEX` with an explicit length, `AT+QMTSUB`, the `+QMTRECV` URC).

**Rationale**: the partner's uplink varies by project, and some modems keep TLS and
MQTT on the modem to save MCU memory.

**Risk**: Sparkplug payloads are binary. Some modem firmware handles binary publish
but delivers received messages as text or hex. The template documents the receive
mode to use. If a modem cannot receive binary NCMD/DCMD cleanly, the integrator uses
the modem's transparent TLS socket with the byte-stream level instead. This is checked
on the phase-2 bench modem before the template is called supported.

### R6. Clock

**Decision**: `iotos_clock_port` returns UTC milliseconds and whether the time is
valid. The SDK holds births and data while it is invalid and reports the reason
(FR-006). Setting the time is the port's job: lwIP SNTP on the board, network time
(`AT+QLTS`/`AT+CCLK`) on a modem, `clock_gettime` on the desktop.

**Rationale**: constitution VI. A gateway that boots with a 1970 clock would otherwise
write readings into the past.

### R7. Memory model and limits

**Decision**: all state lives in one caller-provided `iotos_gateway` structure whose size
is fixed by compile-time limits (defaults in `iotos_config_defaults.h`, overridable):

| Limit | Default |
| --- | --- |
| `IOTOS_MAX_DEVICES` | 512 |
| `IOTOS_MAX_DEVICE_TYPES` | 8 |
| `IOTOS_MAX_METRICS_PER_TYPE` | 64 |
| `IOTOS_DEVICE_ID_MAX` | 24 characters (platform maximum is 128) |
| `IOTOS_TX_BUFFER` | 4096 bytes |
| `IOTOS_RX_BUFFER` | 1024 bytes |

A device costs its ID plus a type index and state flags (about 28 bytes at the
defaults), so 500 devices need about 14 KB. Metric tables are `const` and live in
flash. The SDK does not cache metric values. The core and the vendored coreMQTT keep no
writable static data: coreMQTT's context and its fixed buffer (the RX buffer) also live
in `iotos_gateway`, so its size is the SDK's whole RAM use. The arm size target checks
this, and that nothing references the heap.

**Rationale**: FR-004, FR-005 and SC-003 (32 KB or less for 500 devices, excluding the
network and TLS stacks). Caching values for report-by-exception would cost about 80 KB
at 500 devices × 20 metrics, so the integrator decides what changed.

### R8. Births, rebirth bursts and values

**Decision**: a birth asks the integrator for current values through a callback
(`on_birth(device, writer)`). A metric the integrator cannot fill is sent as a
Sparkplug null. After a connect or rebirth request, the SDK queues the NBIRTH, then
each device's DBIRTH, and sends them from `iotos_poll()` at a configurable rate
(default 20 births per second, so 500 devices take 25 s, inside SC-004). `iotos_commit()`
for a device whose birth is still queued returns `IOTOS_PENDING_BIRTH`. Its values are
not lost, because the birth callback supplies the latest ones.

**Rationale**: FR-007 without buffering per-device values. Sparkplug births must carry
every metric the device will report.

The runtime's rules shape the session
(`services/runtime/internal/sparkplug/session.go`):

- Any NBIRTH other than an exact duplicate starts a new session and wipes every device
  registry (`:130`), so every DBIRTH is re-sent after every NBIRTH.
- DBIRTH, NDATA, DDATA and DDEATH share one sequence counter for the whole node. A gap
  takes the node offline (`:159-164`), so all publishing goes through one serialized
  path.
- DDATA before its DBIRTH rejects that device and makes the runtime ask the whole node
  to rebirth (`internal/app/application.go:330`). That is why `iotos_commit()` refuses
  rather than sends while a birth is pending.
- `bdSeq` is an Int64 metric with a value of 0–255 (`:108-124`). The SDK keeps it modulo
  256, increments it before each connect, and re-encodes the NDEATH will each time, as
  the ESP32 firmware does (`firmware/waveshare-audio/main/network.c:56-63`).
- The SDK subscribes with exactly the broker's literal filters: `NCMD/<edge>`,
  `DCMD/<edge>/+` and `spBv1.0/STATE/<host_id>`
  (`apps/api/app/Domain/Devices/Services/BrokerProvisioner.php:59-74`). A per-device
  DCMD subscription is denied.
- It births when the host's retained STATE says `{"online":true}`. Rebirth requests
  arrive as NCMD `Node Control/Rebirth`. The runtime sends them after its own
  reconnects and after an activation that applies at once, throttled to one per 30 s
  per edge node (`requestRebirth` in `application.go`). At 20 births per second, 500
  devices re-announce in 25 s, inside that window (see R19).

### R9. Aliases

**Decision**: every metric has an alias that is unique across the edge node and all
its devices: node metrics use `metric_index + 1`, and device metrics use
`((device_slot + 1) << 16) | metric_index`. Births carry name and alias; data and
commands carry the alias only.

**Rationale**: the Sparkplug specification requires an alias to be unique across all
metrics of an edge node. The runtime is more lenient and scopes aliases per device
(`session.go:179`), so node-wide unique aliases satisfy both. A per-type alias shared by
500 devices would break the specification and other host applications.

Commands are different: the runtime sends NCMD/DCMD with the metric **name**, its
datatype and a timestamp, without an alias (`internal/app/commands.go:114`). The SDK
matches commands by name. A command is confirmed only by a later live reading of the
mapped state metric with the same value, within 30 s (`commands.go:156-176`). So the
quickstart tells the integrator to publish the new state right after applying a
command. The SDK ignores retained commands, as the ESP32 firmware does.

### R10. Threads

**Decision**: one task drives the SDK through `iotos_poll()`, which handles network
I/O, births, keepalive and inbound commands.

The writer calls (`iotos_begin()` to `iotos_commit()`), `iotos_device_add()`,
`iotos_device_offline()` and `iotos_device_remove()` may be called from other tasks.
They take the lock from `iotos_lock_port`: a non-recursive FreeRTOS mutex by default, a
no-op for single-threaded builds.

Callbacks run on the poll task:
- `iotos_poll()` releases the lock before calling `on_command` or `on_event`, so those
  callbacks can publish. Publishing the new state inside `on_command` is how R9's command
  confirmation is meant to work.
- `on_birth` runs with the lock held and writes only to the birth writer it is given.

**Rationale**: a non-recursive lock held across the command callback would deadlock the
documented command flow.

### R11. Tests and contract fixtures

**Decision**: unit tests use Unity (MIT, via `FetchContent`) under CTest, built with gcc
and clang and AddressSanitizer/UBSan on Linux and macOS. A fixture generator in the SDK
writes golden payloads (NBIRTH, DBIRTH, NDATA, DDATA, NDEATH, DDEATH, nulls, every
datatype, alias-only data, sequence wrap) to `contracts/sparkplug/fixtures/sdk/`. A Go
test in the runtime decodes each one with the pinned Tahu protobuf and runs it through
ingestion, expecting no diagnostics. The C tests also decode NCMD/DCMD fixtures that
the Go side generates. The runtime builds those payloads inline with the current time
(`internal/app/commands.go:114`, `internal/app/application.go:273`). Two small helpers
are extracted from them, `commandPayload` and `rebirthPayload`, each taking the timestamp,
with no behaviour change. The Go fixture writer then produces the runtime's real bytes
at a fixed time.

The existing fixtures (`contracts/sparkplug/fixtures/nbirth.bin`, `dbirth-meter.bin`,
`ddata-alias.bin`, `ndeath.bin`, `dcmd-light.bin`, written deterministically by
`tooling/simulators/write_fixtures.py` with `TIME=1712345000000`) are the first test:
the C writer reproduces the four outbound ones byte for byte, and the C reader
decodes `dcmd-light.bin`.

**Rationale**: constitution IV. The payloads cross a language boundary, so both sides
are tested against the same committed bytes.

### R12. Licence and third-party code

**Decision**: `firmware/sdk/LICENSE` is MIT, and every SDK source file carries
`SPDX-License-Identifier: MIT`. `firmware/sdk/THIRD_PARTY.md` lists coreMQTT (MIT),
mbedTLS (Apache-2.0, desktop port and board port) and Unity (MIT, tests only). No other
folder's licence changes (Q2).

### R13. Reference board build

**Decision**: the board example targets the MIMXRT1050-EVKB with MCUXpresso SDK 25.x and
its CMake/armgcc build (also usable from MCUXpresso for VS Code). It is based on the
SDK's lwIP + mbedTLS + FreeRTOS examples. Kits do not redistribute the vendor SDK: the
integrator points `MCUXSDK_ROOT` at their copy.

*Amended 2026-11-04 (PR 4):* the example is built with MCUXpresso SDK 26.09.00, the
current release. NXP's 26.x SDK replaced the `armgcc/build_*.sh` scripts with a CMake and
Kconfig build of "freestanding" projects (`CMakeLists.txt` and `prj.conf` at the project
root, the board files in the project), so the example is one of those, built as
`flexspi_nor_sdram_debug` (code in HyperFlash, data in SDRAM). It uses the SDK's mbedTLS
3.6.7 without PSA and its own `lwipopts.h` and mbedTLS configuration. CI also builds every
NXP starter against the real SDK, in a separate path-filtered and nightly workflow. CI cross-compiles the SDK core (and,
once the board port lands, the FreeRTOS port against pinned FreeRTOS-Kernel headers) with
`arm-none-eabi-gcc -mcpu=cortex-m7 -mfpu=fpv5-d16
-mfloat-abi=hard -std=c99 -Wall -Wextra -Werror` and reports flash and RAM size. The
full board build and the hardware run happen on the bench (constitution IX).

**Rationale**: the vendor SDK is large and versioned per board; integrators already
have it. A cross-compile in CI catches non-portable code without downloading it.

## Platform

### R14. Getting the SDK into the API image

**Decision**: `.dockerignore` re-includes `!firmware/sdk` after its `firmware`
exclusion. Both `deploy/docker/api/Dockerfile` and `Dockerfile.release` gain
`COPY firmware/sdk /var/firmware-sdk`. A `devices.sdk_path` config key falls back the
same way `devices.contracts_path` does (`apps/api/config/devices.php:13`): the checkout
path `base_path('../../firmware/sdk')` when it exists, `/var/firmware-sdk` otherwise.
Kits are zipped with `PharData` like today's kit, because the images have no `ext-zip`.

**Rationale**: it follows the existing `contracts/` pattern, so tests running PHP from
the checkout (`tooling/test-devices.mjs`) and the containers both find the SDK.

**Alternatives**: moving the SDK under `apps/api` (wrong owner); packing a tarball at
image build time (another build step, and stale in checkout-based tests).

### R15. Gateway kit endpoint

**Decision**: `POST gateways/{gateway}/kit` returns the kit as JSON (`archive_base64`,
`filename`, the SDK version and the profile revisions used), and
`GET gateways/{gateway}/kit/archive` returns the ZIP for the browser download. Both
mirror `devices/{device}/connection-kit` (`OnboardingController.php:130-151`):
`Device.manage-connections`, a 404 for another organization's gateway, throttled to 10
per minute, `Cache-Control: no-store, private`, `Pragma: no-cache`, and an activity
entry `gateway.kit.downloaded` carrying the profile revisions and SDK version but no
secrets.

The kit is refused for a gateway without credentials (platform-managed gateways
created from runtime births) and for a connection that is not `ready`. Before
downloading, the portal applies the gateway's broker access (`POST
gateways/{gateway}/provision`, idempotent), as the direct-kit dialog provisions first.
The settings use `devices.broker_public_url`, not the internal URL the server export
uses.

The chosen profile revisions travel in the request. The archive GET takes them as
query parameters, so the browser download needs no stored state. Credentials are read
from the encrypted `SparkplugGateway.password` and appear only inside the archive.

**Alternatives**: reveal-once credentials with forced rotation (Q1, not chosen);
storing kit requests (needless state).

### R16. The gateway's own source under an existing gateway

**Decision**: `POST device-onboardings` in gateway mode accepts `source: "node"`
(mutually exclusive with `source_device_id`), stored as `source_device_id = ''`. The
wizard offers **The gateway itself** when a gateway is chosen.

**Rationale**: everything after the request already handles `''` as the node's own
metrics. Candidates are created with `device_id ?? ''`
(`RuntimeController.php:209`), the onboarding uniqueness and `availableToOnboard`
work, `compile()` emits `source.device_id = ''`, the runtime matches it
(`internal/app/telemetry.go:73`), and commands go out as NCMD
(`internal/app/commands.go:118-121`). Only the request validation (`required_if` plus
the regex, and `ConvertEmptyStringsToNull`) blocks it. An explicit `source: "node"`
avoids relying on empty strings surviving middleware. The discovery path
(`OnboardSource.tsx` → configuration) can already attach a node source; a test pins
that it keeps working.

### R17. Gateway health profile

**Decision**: there is no built-in profile catalogue; profiles belong to
organizations. `POST device-profiles/gateway-health` creates and publishes the
organization's profile with code `gateway-health` from the SDK's default health
metrics (data model §Gateway health profile), or returns the existing one. It follows
`PrepareWaterMeterProfile` (model create under an organization lock, then
`PublishDeviceProfile`), but is guarded by `DeviceProfile.create` and
`DeviceProfile.publish` instead of `DemoEnvironment`. The kit dialog and the node onboarding offer
it when the organization has none.

**Alternatives**: a global built-in profile (no such concept, and it would cross
organizations); a seeder (not reachable by tenants).

### R18. Bulk onboarding: batch rows plus a queued job

**Decision**: follow `GeofenceService`. A `device_bulk_onboardings` run is keyed by
`operation_uuid` plus `request_hash` and has one `device_bulk_onboarding_items` row per
source. Item outcomes are recorded without stopping the rest, items can be retried,
and the run's status rolls up from its items. The work runs in a queued job
`OnboardDiscoveredSources` (pattern: `DeployAdapter`: `ShouldQueue`, `tries = 1`, a
`queued`→`running` guard against duplicate runs, a `failed()` handler) on the
`default` database queue. The release compose already runs that worker; the dev compose
gains one if it lacks it. That worker runs with `--timeout=60`, so one job handles at
most 50 items and then dispatches the next job for the rest. Each item is claimed under
a row lock and re-checked as `pending`, so a duplicate dispatch cannot onboard a source
twice.

Each item does what `AdapterService::activate` does in one transaction
(`apps/api/app/Domain/DeviceAdapters/Services/AdapterService.php:238-274`):

1. Re-check the candidate is still available.
2. Create the device with its generated name and code.
3. Save a draft with mappings from a `MappingSuggestions` service, extracted from
   `DeviceController::mappingSuggestions` so the endpoint and the job share it.
4. Compile it, which runs the type and missing-metric checks.
5. Activate it.

Activation becomes **active** only on the runtime's acknowledgement (constitution II).
The run shows each item as *activation requested* until then, and the portal reads
device state for the final outcome.

**Rationale**: about 500 runtime-backed activations do not fit in one HTTP request. The
geofence batch is the project's tested pattern for per-item outcomes, and the adapter
path is the tested way to create and activate a device in one step.

**Alternatives**: `Bus::batch` (unused in the project, and the batch tables duplicate
the run/item rows); synchronous creation (request timeouts at this scale).

### R19. Rebirth storms during bulk activation

**Decision**: the job enqueues its activations close together. The runtime's per-edge
rebirth throttle (one request per 30 s, with later requests queued) then turns a
247-device run into a handful of rebirths rather than 247. At 20 births per second, a
500-device gateway completes a rebirth in about 25 s, inside the throttle window. The
end-to-end check measures the number of rebirths in a 247-device run. If it exceeds
three, the plan's fallback is to have the runtime skip the activation rebirth when the
source's current birth is already cached. That is a runtime change, made in this
feature only if the measurement requires it.

**Measured (PR 3, 2026-11-03, local stack, Python simulator with `--meters 247`)**: a run
of 248 selected sources (247 water meters and one energy meter) reached 247
*activation requested* and one skipped in 10 s, and all 247 devices were active with
stored readings 40 s after submitting. The simulator logged **2 rebirths** for the run;
a retry of 247 failed items on another gateway logged 1. Both are within three, so the
runtime fallback (T080) is not needed.

**Measured (PR 2, 2026-11-05, dev stack, the SDK's desktop simulator with 500
devices)**: each bulk run of 247 activations brought 2 rebirths, but the runtime
refused **29, 236, 245 and 245** of them as offline in four runs. The runtime's
Sparkplug engine forgets a node's devices on its NBIRTH, and the SDK re-announces them
at 20 per second, so after each rebirth a device has no birth for up to 25 s. The first
activation's rebirth opened that gap, and a fast burst of the rest landed in it. A
refused device stayed `registered`, and Retry failed did not cover it. The Python
simulator re-announces everything at once, so PR 3 did not see it.

**Fix (runtime, after PR 2)**: an activation whose edge node is online but has not
announced the source in its current session is held instead of refused, for up to
90 s (`holdForBirth` in `application.go`). The control consumer moves on, and the
device's fence stays free. The device's DBIRTH applies the held activation, checked
against that birth, and the birth becomes its first reading, so it asks for no further
rebirth. A held activation asks for a rebirth only when the node is not announcing
already (none sent and no NBIRTH in the last 30 s), because a rebirth restarts the
announcement. An activation that applies at once still asks for one, coalesced as
before, since its readings need a birth after it. An offline node, a device that died
in the node's session, and a birth that does not come within 90 s are still refused.

### R20. Profile types to Sparkplug types in the kit

**Decision**: the kit writes each device-type metric with the Sparkplug type below,
which `DeviceConfigurationService` accepts for that profile type (`:109-121`):

| Profile type | Kit writes | Also accepted |
| --- | --- | --- |
| boolean | Boolean | — |
| integer | Int64 | Int8–32, UInt8–64 |
| number | Double | Float, Int*, UInt* |
| enum, string | String | Text, UUID |
| timestamp | DateTime | — |
| bytes | Bytes | — |

Metric names are the profile parameter keys, as in today's direct kit, so the
onboarding suggestions match by key. Parameters that do not report state, and
derived parameters, are left out, as today. Parameters that accept commands are
flagged writable in the type table.

**Rationale**: the widest safe type per profile type, so a value never fails a
datatype check. Int64 and Double cost no more than smaller types for typical values
(varint encoding; Double is 4 bytes more than Float per value).

### R21. End-to-end check

**Decision**: `tooling/verify-embedded-sdk.mjs`, local only like the other `verify-*`
scripts (`docs/dev/testing.md:220-237`):

1. Registers a gateway through the API and downloads its kit.
2. Builds the desktop simulator from the kit with CMake, and runs it with 500 devices
   of two types.
3. Asserts 500 discovered sources and zero runtime diagnostics.
4. Restarts the simulator with the same state file and asserts all 500 sources are
   announced again within five minutes with the next `bdSeq` (SC-004, User Story 7).
5. Bulk-onboards 247 devices and asserts them active with stored readings, counting
   rebirths (R19).
6. Onboards the gateway's own source with the health profile.
7. Sends one command and asserts it is confirmed.
8. Stops the simulator and asserts the gateway and its devices go offline.

`test-devices.mjs` calls it when a C compiler and CMake are present. CI runs only the
SDK unit tests, the cross-compile and the Go fixture test.

### R22. Documentation placement

**Decision**: new `docs/features/embedded-sdk.md` (SDK, kits, bench setup), with changes
to `docs/features/devices.md` (gateway kits, onboarding the gateway itself, bulk
onboarding), and an entry in the `docs/README.md` Features list and repository map.
`docs/hardware/rt1050-evkb.md` describes the bench (board, RS-485 click, USB adapter,
Modbus simulator), with no partner names. On the public docs site, a draft page at
`apps/docs/src/content/docs/docs/developers/embedded-sdk.mdx` goes in the Developers
sidebar group. It contains no repository paths and names no licence (docs-site
writing rules, `docs/dev/docs-site.md:54-56`); the licence ships in the kit. In-app
help (`apps/api/resources/help/devices.md`) gains the kit and bulk onboarding steps.
`docs/dev/gotchas.md` gains the Sparkplug traps in R8 and R9.

### R23. Decision record

**Decision**: ADR-029, "Embedded SDK and gateway kits" (Proposed with the documents
PR). It records three decisions: gateway credentials leave the platform in kits
downloaded from the portal; the SDK is MIT-licensed at folder level and kept in this
repository; and the SDK's codec is its own, pinned by contract fixtures. No accepted ADR
forbids portal-delivered gateway credentials; the rule existed only in
`docs/features/devices.md` and the gateway page, which change in the same PR as the
endpoint.
