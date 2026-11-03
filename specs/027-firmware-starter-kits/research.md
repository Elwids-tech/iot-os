# Research: Firmware Starter Kits

Decisions for [spec 027](spec.md). Spec 026's research ([026 research](../026-embedded-gateway-sdk/research.md))
still holds for the SDK itself (R1–R13) and for profile types in C (R20); this file
cites it as 026-Rn.

## Sources and layout

### R1. Where starter sources live

**Decision**:
- Built targets' ports and example projects stay in the SDK: `firmware/sdk/ports/<port>/`
  and `firmware/sdk/examples/<example>/`. They are versioned with the SDK, because they
  are code the SDK's CI builds and tests.
- Everything that is starter packaging lives in a new `firmware/starters/`, versioned with
  the platform, not the SDK:
  - `targets.json`: the target registry;
  - `templates/`: README, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, the porting guide and
    the device brief example;
  - `families/<family>.md`: the notes for AI-assisted families.

  Adding a family or editing the brief needs no SDK release (FR-014).
- The device brief schema is a contract: `contracts/firmware/device-brief.v1.schema.json`
  with fixtures (R8).

**Rationale**: the SDK keeps one meaning ("the C library and its tested ports"). Starter
text changes more often than the SDK, and those changes must not bump the SDK version
that devices report as `sdk_version`.

**Alternatives**:
- Everything under `firmware/sdk/`: every wording fix would become an SDK release.
- Templates inside `apps/api/resources`: the C examples and the templates that describe
  them would drift apart in two owners' folders.

### R2. Target registry

**Decision**: `firmware/starters/targets.json` lists every target. Each entry has:
- `id`, a stable slug used in URLs and manifests, such as `esp32-esp-idf`,
  `nxp-imxrt1050-mcuxpresso`, `linux` or `stm32`;
- `name` and `kind` (`built` or `ai_assisted`);
- `roles`: `direct`, `gateway`, or both;
- for built targets:
  - `example`, the SDK example copied as the project;
  - `developer_paths`, the folders the developer owns (`main/` for ESP-IDF, `app/`
    otherwise);
  - `toolchain`, the exact version CI builds with;
  - `settings_dir`, which is always `config/`;
- `family_notes`, the notes file for a named AI-assisted family.

The API reads the registry from the image (R15). A target whose example is missing from
the SDK copy is left out of the list, so the NXP target appears only once spec 026 PR 4
has added its example.

**Rationale**: one file decides what the picker shows, what CI builds (R16) and what
the generator copies. Leaving out targets with missing files makes "offered once the port
exists" automatic.

**Alternatives**: a PHP enum (CI and the C side could not read it); a database table
(targets ship with code, not tenant data).

### R3. Starter layout and ownership

**Decision**: the archive has one root folder,
`<code>-<target>-starter/`, which is the target's project:

```text
README.md                      quickstart, "Start with AI" prompt, update steps
AGENTS.md                      the AI brief (one copy)
CLAUDE.md                      one line: @AGENTS.md
iotos-starter.json             manifest (R6)
.gitignore                     config/*, build output, and per target sdkconfig
sdk/                           SDK release (replaceable)
generated/                     metric tables and profile metadata (replaceable)
.iotos/                        brief schema, porting guide, family notes (replaceable)
config/README.md               where the connection settings go; no settings
<project files>                the target's build files from its example
<developer paths>              main/ or app/: main.c, field.c, device-brief.example.yaml
```

The manifest lists `replaceable` paths (`sdk/`, `generated/`, `.iotos/`, `AGENTS.md`,
`CLAUDE.md`) and `developer_paths`. The README's update steps replace exactly the
replaceable paths (US6, SC-008). Build files that the developer may extend, such as the
top-level `CMakeLists.txt`, are developer-owned after the first download. They locate the
SDK through `sdk/` and the tables through `generated/`, and nothing else.

**Rationale**: the developer's code, the AI's code and the device brief never sit in a
folder that an update overwrites.

**Alternatives**: a flat layout like spec 026's kit (updates would overwrite application
code); a git submodule for the SDK (not every developer uses git, and starters must work
offline).

## Settings and downloads

### R4. Splitting settings from starters

**Decision**:
- **Connection settings** are target-independent C files plus the existing direct-device
  files:
  - `config/iotos_settings.h` (broker host and port, group, edge node, host ID,
    client ID and username, password, CA PEM, and `IOTOS_KIT_GATEWAY`);
  - `config/iotos_settings.c`, which defines `iotos_kit_settings` **without** the node's
    device type;
  - `config/README.md`;
  - for a direct device, also `device-config.json`, `ca.crt` and `quickstart.md`,
    unchanged (FR-033).
- The node type moves to `generated/iotos_types.c` as `iotos_kit_node_type`, because it
  comes from a profile.
- Each built example's CMake checks for `config/iotos_settings.c`:
  - **Present**: it compiles the file.
  - **Missing**: it compiles `sdk/starter/settings_missing.c` instead. That file defines
    an empty settings object and `iotos_kit_settings_present = 0`, so the example prints
    "No connection settings: download them from the device's page in IoT OS and put the
    files in config/" and stops without connecting (FR-006).
- `iotos_kit_settings` stays `const`, as in the SDK's sample settings today. `main.c`
  copies it into a mutable `iotos_settings` and sets `node_type = &iotos_kit_node_type`
  before `iotos_init`.
- Every built example rejects settings it does not understand: `#if
  IOTOS_KIT_SETTINGS_FORMAT != 1` gives `#error "These connection settings need a newer
  starter"`. Constitution IV: consumers reject versions they do not support.

**Rationale**:
- A starter then depends only on its profiles, target and SDK version (FR-004).
- Settings can be downloaded once and reused across targets.
- Builds always succeed, so CI and AI agents can build a starter without credentials.

**Alternatives**:
- `__has_include` (C23 or a GCC extension, not C99).
- A build failure when settings are missing (agents and CI could not build a starter).

### R5. Endpoints, permissions and responses

**Decision** ([platform-api](contracts/platform-api.md)):
- `GET firmware/targets`: the registry entries that are available.
- `POST firmware/starters`: takes `target`, `role`, `node_artifact` and
  `device_types[]`, all published artifact UUIDs. Each artifact needs
  `DeviceProfile.view` for that organization's profile.
- `POST devices/{device}/connection-settings` and
  `POST gateways/{gateway}/connection-settings`: `Device.manage-connections`.
- `POST devices/{device}/firmware-kit` and `POST gateways/{gateway}/firmware-kit`: a
  starter plus settings, under the same permission.

Every endpoint is under `/api/v1/organizations/{organization}/` and returns JSON
`{filename, manifest, archive_base64}`. This mirrors today's
`devices/{device}/connection-kit`, so the portal and the assistant card save it the same
way, and warnings come back in the manifest before the file is saved.

Every download endpoint:
- is throttled to 10 per minute;
- returns 404 for another organization's resources;
- sends `Cache-Control: no-store, private`.

Settings and kit downloads are recorded in the activity log without secrets. Starters
are not, because they hold no secrets and are as sensitive as the profile they come
from.

The gateway endpoints first apply the gateway's broker access, as the direct kit
provisions first (026-R15), and refuse a gateway without platform-issued credentials or
with a connection that is not ready. Settings use `devices.broker_public_url`.

**Rationale**:
- Same patterns, permissions and throttles as the kits people already use.
- Starters need only the profile permission Members already have, so firmware developers
  do not need connection rights.

**Alternatives**:
- A GET archive with query parameters for starters. It would need a second call to show
  warnings, and the portal and API are on different origins, so response headers need
  CORS exposure.
- Recording starters in the activity log. That is noise, since they hold no secrets.

### R6. Manifest and change history

**Decision**: `iotos-starter.json` (schema
`contracts/firmware/starter-manifest.v1.schema.json`) records:
- `format: 1`, `sdk_version`, `target` (id and kind), `role`;
- `generated_at`;
- `profiles[]`: code, name, revision and artifact UUID;
- `replaceable[]` and `developer_paths[]`;
- `warnings[]`;
- for each profile, `metrics[]`:
  - `key` and `datatype`;
  - `introduced_in`: the first published revision that has the key;
  - `changed_in`: the last revision that changed its type or unit;
- `retired[]`: retired keys, with the revision that retired each.

A developer who had revision 3 sees what changed in any later revision by reading
`introduced_in`, `changed_in` and `retired` against 3. The README shows how. Its update
recipe first checks that the new manifest's `format` is one the project knows (1), and
stops otherwise.

The generator computes these from the profile's published artifacts. Every published
revision is kept, and keys are never reused (device-profiles docs).

**Rationale**: the generator cannot know which revision a developer has. History per
metric answers "what changed since N" for any N, without asking (US6, scenario 2).

**Alternatives**:
- A diff against revision N−1 only (wrong when revisions are skipped).
- Asking "upgrading from?" in the dialog (one more question for every download).

### R7. Determinism

**Decision**: for the same target, artifacts and SDK version, starters are compared by
extracted contents. Every file except `iotos-starter.json`'s `generated_at` must be equal
(FR-007). Archive bytes may differ, because `PharData` stamps times. A feature test
builds the same starter twice and compares the contents; another builds it through each
entry point's endpoint.

**Rationale**: byte-identical ZIPs would need `ext-zip`, which the images do not have
(026-R14). Contents are what developers compare.

## AI brief

### R8. One instructions file, and the device brief format

**Decision**:
- **`AGENTS.md`** is the single instructions file. Codex, Cursor, GitHub Copilot's agent,
  Gemini CLI (with configuration) and others read it.
- **`CLAUDE.md`** holds only `@AGENTS.md`. Claude Code reads `CLAUDE.md` and imports the
  file it references, so there is one copy (FR-020).
- **The README** carries the fallback prompt for any other agent: "Read AGENTS.md and
  follow it. Start with the interview."
- **`AGENTS.md`** has these sections:
  1. **What this project is**: the SDK handles Sparkplug, you write the field side, and
     `iotos.h` is the only API.
  2. **Rules**:
     - never open, print, copy or commit `config/`;
     - never edit `sdk/`, `generated/` or `.iotos/`;
     - build before claiming success;
     - write nothing before the brief is confirmed.
  3. **Already known**: points at `generated/profiles/*.json` and the manifest; never
     ask about these.
  4. **Interview**: the questions from spec US2, asked per device type and per metric,
     grouped so a developer can answer a whole table at once, with "unknown" accepted.
  5. **Device brief**: if a brief exists with a `format` other than the schema's, stop
     and ask the developer to download a newer starter. Otherwise write
     `<developer path>/device-brief.yaml` against
     `.iotos/device-brief.schema.json`, show it, and wait for confirmation.
  6. **Port**: AI-assisted targets only. Fill the templates in `<developer path>/ports/`
     following `.iotos/porting.md` and the family notes.
  7. **Field side**: implement `field.c` from the brief. An unknown source stays a stub
     that reports "not available" (R9).
  8. **Verify**: build the project, run it, and compare the first readings with the
     device's own display.
  9. **Changing things later**: update the brief first, then the code.
- **The device brief** is YAML, with a JSON Schema (draft 2020-12) in
  `contracts/firmware/device-brief.v1.schema.json`, plus valid and invalid fixtures that
  `tooling/verify-devices-contracts.py` checks. It contains:
  - `format: 1` and `device` (board, MCU, framework and version, memory notes);
  - `uplink` (kind, and whether the modem runs TLS and MQTT itself);
  - `time_source` and `credential_storage`;
  - `device_types[]`, keyed by profile code. Each has:
    - `addressing`: bus, port, the address range and how device IDs are formed;
    - `poll_interval_s`, `offline_after`, and `report` (`on_change` with a deadband, or
      `interval`);
    - `metrics{}`, keyed by metric key. Each metric's `source` is one of `modbus`,
      `analog`, `digital`, `i2c`, `spi`, `can`, `pulse`, `computed` or `unknown`, with
      the fields that kind needs (Modbus: function, register, type, byte and word order,
      scale, offset);
    - `commands{}`: physical effect and read-back;
    - `instructions` (free text);
  - `power` and `watchdog`;
  - top-level `instructions` (free text: wiring, calibration, quirks);
  - `unconfirmed[]`: answers not yet proved by a reading.

  The value `unknown` is allowed wherever a fact can be missing (FR-023, FR-026).
- **Drift test**: a feature test renders `AGENTS.md` for every target and checks two
  things. Every path it names exists in that starter, and every SDK function it names is
  declared in `sdk/include/iotos/iotos.h`.

**Rationale**:
- One file serves the agents the owner named (Q3), and the import keeps a single copy.
- A schema makes the brief reviewable and keeps a later upload possible (Q2) without
  committing to it.
- The drift test keeps instructions honest as the SDK changes.

**Alternatives**:
- One file per agent (`.cursorrules`, `.github/copilot-instructions.md`): copies drift.
- A slash command or skill for Claude Code only: one agent only.
- Markdown briefs: they cannot be validated.

### R9. Field-side skeleton and unknown values

**Decision**: each built example's developer folder holds:
- `main.c`: connect, register the types, then add devices or the node, and loop;
- `field.c` and `field.h`: one `field_read_<type>_<metric>(...)` per metric, returning
  `FIELD_UNAVAILABLE` until it is implemented, and `field_command_<type>_<metric>(...)`
  per writable metric, returning "rejected".

Generated stubs are explicit: no stub ever returns a number. When a read returns
unavailable, `main.c` does not put that metric in the data message, and `on_birth` leaves
it out, so the SDK sends it as a null in births (026, "metrics it does not get are sent
as nulls"). This meets "never invent a value" (FR-023, constitution VI) with no SDK
change.

**Rationale**: a starter that builds and runs publishes nothing false. The agent's work
is exactly to replace stubs, one per metric, and the brief says which.

**Alternatives**: random demo values in the examples (devices would report invented data
the moment settings are added); omitting stubs (the agent would invent the structure).

## Targets

### R10. ESP32

**Decision**:
- **Framework**: ESP-IDF v5.4.1, the version the repository's ESP32 board already
  builds with (`docs/hardware/waveshare-audio-board.md`).
- **Port** `firmware/sdk/ports/esp-idf/`:
  - stream: `esp_tls` with the CA from the settings and the broker host checked;
  - clock: SNTP for UTC with the valid flag, and `esp_timer` for `monotonic_ms`;
  - storage: NVS for `bdSeq`;
  - log: `ESP_LOG`;
  - lock: a FreeRTOS mutex, through the shared `ports/freertos/` lock.
- **Example** `firmware/sdk/examples/esp32-wifi/`:
  - an ESP-IDF project whose `components/iotos/CMakeLists.txt` builds `sdk/` (the core
    plus the vendored coreMQTT);
  - `main/` as the developer path;
  - Wi-Fi SSID and password set through `idf.py menuconfig` (Kconfig), with `sdkconfig`
    in `.gitignore`;
  - `sdkconfig.defaults` setting the TLS and SNTP options.
- **No duplicates**: the example does not use ESP-IDF's own MQTT client or the
  `espressif/coremqtt` component, to avoid duplicate symbols (as 026-R3 notes for
  MCUXpresso).
- **CI** builds the generated ESP32 starter in `espressif/idf:v5.4.1` (R16).

**Rationale**:
- The same MQTT client and session code as the desktop path, so FR-013 holds by
  construction.
- The pinned version is the one the team already uses.

**Alternatives**:
- ESP-IDF's MQTT client through the modem-level port (a second code path to test).
- Arduino (out of scope).

### R11. NXP i.MX RT

**Decision**:
- **Project template**: the NXP target is spec 026 PR 4's
  `firmware/sdk/examples/rt1050-evkb-ethernet/` (MCUXpresso SDK 25.x, armgcc CMake,
  lwIP, mbedTLS, FreeRTOS), with `app/` as the developer path.
- **Registry**: its entry is added by spec 026 PR 4, which now depends on this spec's
  generator PR instead of spec 026 PR 2.
- **CI**: builds the generated NXP starter against the MCUXpresso SDK, fetched with
  `west` at a pinned manifest revision and limited to the RT1050 device, FreeRTOS,
  lwIP and mbedTLS. It is cached by revision, and runs on pull requests that touch
  `firmware/**`, `contracts/firmware/**` or the generator, and nightly. This replaces
  026-R13's "CI cross-compiles the core only" for the example (FR-011).
- **Redistribution**: starters still do not include the vendor SDK. The README points
  `MCUXSDK_ROOT` at the developer's copy.

**Rationale**:
- The partner needs this target now (Q3).
- Building the real example in CI is what makes it a built target.
- Path filters and the cache keep the cost off unrelated pull requests.

**Alternatives**:
- Cross-compiling the core only (the example could break unnoticed).
- Vendoring the MCUXpresso SDK (large, licensed per component, versioned per board).

### R12. Linux and desktop

**Decision**:
- `firmware/sdk/examples/linux-app/` is a CMake project with `app/` as the developer
  path, using the POSIX ports.
- Its `field.c` stubs work as in R9.
- Starters ship `sdk/examples/desktop-simulator/` **without** its `sample-config/`
  folder. In a starter, the simulator builds against the starter's `generated/` and
  `config/` (its kit mode), and the README shows how to run it to see a working
  connection before writing any field code. Leaving `sample-config/` out also keeps its
  placeholder broker address and certificate block out of starters, so the secret scan
  stays strict.

**Rationale**: Linux gateways (industrial PCs, Raspberry Pi) are real targets, and the
simulator gives a known-good connection to compare against.

### R13. AI-assisted families

**Decision**:
- **Picker entries**: `stm32` (STM32Cube), `rpi-pico` (Pico SDK), `nordic-nrf` (nRF
  Connect SDK), and `other`, each `kind: ai_assisted`.
- **Starter**: `sdk/`, `generated/` and `.iotos/`, plus:
  - `.iotos/porting.md`: which port each SDK interface needs, the two network levels,
    threading rules, and how to test a port against the platform;
  - the family notes: the family's usual TLS, network, storage and RTOS pieces, and the
    traps;
  - `app/` with `main.c`, `field.c` and copies of the port templates to fill in.
- **No build files**: the AI agent asks which build system is in use.
- **Labels**: the manifest and README say "AI-assisted: no tested example".

**Rationale**: the owner wants other microcontrollers supported through AI instructions
(Q3). Notes are cheap to add and need no CI toolchain.

**Alternatives**: offering only "Other" (named families get useful notes for little
cost); more built targets now (Q3 declined).

## Entry points

### R14. Where the downloads appear

**Decision**:
- **Profile page**: a **Firmware** section in `ProfileWorkspace` beside the other
  sections, shown when a published revision exists. It holds:
  - a `Panel` with a target `Select`, grouped Built and AI-assisted;
  - a role choice:
    - "Connects directly": a direct-device starter whose node type is this profile;
    - "Behind a gateway": a gateway starter with this profile as its one device type,
      so gateway firmware can start before a gateway is registered. The node type is
      the organization's published profile with code `gateway-health` when it exists
      (spec 026 PR 2 creates it, spec 026 R17), otherwise a table generated from the
      SDK's default health metrics (`node_artifact_uuid: null`), noted in the manifest.
      More device types are added from the gateway page;
  - **Download starter**;
  - a note that settings come from the device or gateway page.
- **Device page** (direct devices): a **Firmware** action in `DeviceActions`. It offers
  **Download settings** and **Download firmware kit** (starter for a chosen target plus
  settings), both behind `Device.manage-connections`.
- **Gateway page**: **Firmware** replaces **Get credentials**. The dialog:
  - preselects the node from the gateway's saved selection, otherwise the
    organization's `gateway-health` profile, otherwise the SDK default health table;
  - offers up to 8 downstream types as `SearchableSelect`s, preselected from the
    gateway's saved selection. With nothing saved, it suggests the profiles of devices
    already onboarded under the gateway;
  - has a target `Select`;
  - downloads the starter, settings or full kit.

  The selection is saved on the gateway when a download succeeds (data model), so
  teammates see the same choices (FR-042). The server-export text stays as a secondary
  note.
- **Onboarding**: today's wizard ([`DeviceOnboarding.tsx`](../../apps/portal/src/devices/DeviceOnboarding.tsx),
  `ConnectionKit.tsx`) gains "I'm writing the firmware" in its connection step. It adds
  a target `Select`, **Download starter** for anyone at that step, and **Download
  firmware kit** for people with `Device.manage-connections`, beside the existing
  **Download setup bundle**, which is unchanged. Spec 021's journey is not built yet; when it is, its
  Connect step reuses this component (FR-041).
- **Assistant**: the onboarding and profile scopes gain one tool action,
  `offer_firmware {profile_uuid, target}`.
  - It checks `DeviceProfile.view` and that a published revision exists, and stores
    `firmware_offer` in the conversation's `onboarding_state`, as `next_step` does.
  - The portal renders an `ActionCard` titled "<target> starter for <profile>", whose
    button calls `POST firmware/starters` with the person's session.
  - The tool result names no credentials and no settings. For settings, the assistant
    links to the device or gateway page, or offers spec 021's kit card where that is
    built (FR-043, FR-052).

**Rationale**:
- Each entry point is a thin caller of the same endpoints (FR-007).
- Using today's onboarding wizard avoids waiting for spec 021.
- The assistant pattern (state plus an emitted event plus a portal card) already exists
  for `next_step`.

**Alternatives**:
- Waiting for spec 021's journey (it would delay US4).
- Remembering the gateway selection in browser storage only (teammates would not share
  it).
- An assistant tool that returns the archive (it would put the file through the model
  conversation).

### R15. The image

**Decision**: R14 of spec 026 is extended:
- `.dockerignore` re-includes `!firmware/sdk` and `!firmware/starters`.
- Both API Dockerfiles copy them to `/var/firmware/sdk` and `/var/firmware/starters`.
- A `firmware.path` config key falls back like `devices.contracts_path`: the checkout's
  `../../firmware`, otherwise `/var/firmware`.

The device brief schema reaches the image through the existing `contracts` copy.

**Rationale**: the existing contracts pattern, so checkout-based tests and containers
both find the files.

### R16. CI for starters

**Decision**:
- **Generator command**: `php artisan firmware:starter-fixtures --output=<dir>` builds a
  starter for every available target and role from
  `contracts/firmware/fixtures/profiles/*.json` (published-artifact fixtures, no
  database). It is the same generator class the endpoints use.
- **New `Firmware starters` job**:
  1. PHP setup, then the command.
  2. `linux`: cmake build of every Linux starter, then run each with no settings and
     expect the "No connection settings" exit.
  3. `esp32`: `idf.py build` of every ESP32 starter in `espressif/idf:v5.4.1`.
  4. `nxp`: a west-fetched MCUXpresso build (R11), path-filtered and nightly.

  A matrix keeps them parallel.
- **AI-assisted starters** are checked for their file list and `-fsyntax-only` of their
  templates, as spec 026 checks templates.

**Rationale**: SC-002 is the generated starter building, not the SDK example in place,
because people build what the generator produces.

**Alternatives**: building SDK examples in place only (the generator's paths could break
unnoticed).

## Verification

### R17. Bench and agent evaluation

**Decision**: `docs/hardware/esp32-starter-bench.md` describes the bench. The parts are
an ESP32 development board, a 3.3 V RS-485 transceiver and a Modbus RTU temperature and
humidity sensor such as an XY-MD02. The protocol is:

1. Publish a two-metric profile.
2. Time starts when the Firmware section is opened.
3. Download the ESP32 starter.
4. Open it in the agent and give the README prompt.
5. Answer from the sensor's datasheet.
6. Confirm the brief.
7. Add settings from a direct device.
8. Flash.
9. Time stops at the first stored reading that matches the sensor's display.
10. Reboot the board: the next session announces `bdSeq` one higher than before (FR-013).
11. Compare the ESP32's NBIRTH and DBIRTH with the desktop simulator's for the same
    profile and values, using the runtime's decoded view: the same metrics, names,
    types and aliases (FR-013).

This runs with Claude Code and with Codex (SC-001, SC-007). The person running the bench
uses only the Firmware section, the starter's documents and the agent, with no other help
(SC-001). The run checklist records:
- questions that asked for known facts;
- whether code came before the brief;
- any access to `config/`;
- the time taken;
- the reboot and birth comparison results.

Message parity also holds by construction: every built target compiles the same
`firmware/sdk/src/` sources and vendored coreMQTT, and only the ports differ. CI checks
that the ESP32 component's source list matches the desktop library's.

Transcripts stay in the private `.local/` area. The public doc records outcomes only.
The NXP target uses spec 026's EVKB bench (SC-003).

**Rationale**: constitution IX: the simulator does not stand in for hardware or for how
agents behave.

### R18. Relationship to spec 026 and ADR-029

**Decision**:
- **ADR-030** (Proposed) records the split between starters and settings, the full kit,
  starters for signed-in members only, the assistant offering starters but never handling
  credentials, and built versus AI-assisted targets. It amends ADR-029 §3 (what a kit
  contains), and ADR-029's status line gains "amended by ADR-030".
- **Spec 026's documents are amended in this spec's documents PR**:
  - `kit-layout.md` points to [starter layout](contracts/starter-layout.md) and keeps
    only what still applies (type headers, identifier rules, size warnings);
  - the plan's Delivery table:
    - PR 2 keeps the gateway itself, the health profile and the end-to-end check, but
      not kits;
    - PR 4 depends on this spec's PR 1;
    - the gateway kit dialog moves here;
  - `tasks.md` marks the kit tasks as moved to spec 027.

**Rationale**: decisions change only through a new ADR (constitution), and spec 026's
unbuilt kit tasks must not be built twice.

### R19. Golden outputs and version checks

**Decision**: the generator's outputs cross from PHP into C firmware, so they get golden
fixtures (constitution IV):
- **Where**: `contracts/firmware/fixtures/expected/<case>/`.
- **Cases**:
  - `direct-relay-r2-linux`: `generated/`, `iotos-starter.json` with `generated_at`
    removed, and the developer path's `field.c`, `field.h` and `device-brief.example.yaml`;
  - `gateway-water-energy-linux`: the same for a gateway;
  - `settings-direct` and `settings-gateway`: `config/iotos_settings.h`,
    `config/iotos_settings.c` and `config/README.md` rendered from fixture credentials.
    Fixture credentials use `example.test` hosts, `fixture-` prefixed usernames and
    passwords, and a throwaway test CA. They are not real credentials.
- **Who writes them**: `php artisan firmware:starter-fixtures --golden` writes them.
- **Who checks them**: `GoldenOutputTest` regenerates every case and compares byte for
  byte; a change to the generator updates the fixtures in the same PR. The C side is the
  CI build of the generated starters (R16), which compiles the same files.
- `tooling/verify-devices-contracts.py` checks that every case folder listed in
  `contracts/firmware/fixtures/expected/cases.json` exists and is complete.

**Versions**:
- the settings header carries `IOTOS_KIT_SETTINGS_FORMAT 1`, and every example rejects
  any other value at compile time (R4);
- the manifest carries `format: 1`, and the README's update recipe stops on any other
  (R6);
- the device brief carries `format: 1`, and `AGENTS.md` stops on any other (R8).

**Rationale**: the platform's PHP generator and the developer's C build must agree
without sharing code. Golden files make every change to that agreement visible in
review.
