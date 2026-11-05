# Contract: Starter Layout

Archives are ZIP files built with `PharData` in a private temporary directory that is
always removed, as today's kit. This contract replaces the archive layouts in spec 026's
[kit layout](../../026-embedded-gateway-sdk/contracts/kit-layout.md). That contract's
type headers, identifier rules and size warnings still apply.

## Starter

File name: `<code>-<target>-starter.zip`, where `<code>` is the node profile's code (a
direct device) or the first device type's code (a gateway). It has one root folder of the
same name, without `.zip`.

```text
README.md                    quickstart, "Start with AI", update steps        replaceable: no
AGENTS.md                    AI brief (the only copy)                          replaceable
CLAUDE.md                    "@AGENTS.md"                                      replaceable
iotos-starter.json           manifest (data model)                             replaced on update
.gitignore                   config/*, !config/README.md, build/, and per target extras
config/README.md             where connection settings go; holds no settings
sdk/                         firmware/sdk: CMakeLists.txt, cmake/, include/, src/,   replaceable
                             ports/, third_party/, starter/ (iotos_starter.h,
                             settings_missing.c, iotos_starter.cmake),
                             examples/desktop-simulator/ (without sample-config/),
                             README.md, LICENSE, THIRD_PARTY.md, CHANGELOG.md, VERSION
generated/                   replaceable
  iotos_types.h              declares iotos_kit_types[], iotos_kit_node_type,
                             IOTOS_KIT_TYPE_COUNT and IOTOS_KIT_ROLE_GATEWAY
  iotos_types.c              includes every type header and defines them; the SDK
                             matches types by address, so nothing else includes them
  iotos_type_<id>.h          one per type (026 kit layout), node included
  profiles/<code>.json       per profile: key, label, description, datatype, unit,
                             writable, enum values, min/max; what the agent must not ask
.iotos/                      replaceable
  device-brief.schema.json   copy of contracts/firmware/v1/device-brief.schema.json
  porting.md                 the porting guide (AI-assisted targets; also in built ones)
  family.md                  the family notes (named AI-assisted targets only)
  reference/main.c           the Linux example's main.c (AI-assisted targets only)
<target project files>       from the target's example (below)
<developer paths>            developer-owned after the first download
  main.c                     connect, register types, add devices or the node, loop
                             (built targets; the agent writes it for AI-assisted ones)
  field.c, field.h           one read stub per metric, one command stub per writable
                             metric, all returning FIELD_UNAVAILABLE or FIELD_REJECTED
                             (R9); field_read and field_command dispatch by type code
                             and metric name; field_devices lists a gateway's devices
  device-brief.example.yaml  an annotated example for this profile set
```

The README and `.gitignore` are written once and are not replaced on update: the
developer may edit them. The README's update section names the replaceable paths
exactly as the manifest's `replaceable[]` does.

## Per target

| Target | Project files at the root | Developer path | Build |
| --- | --- | --- | --- |
| `linux` | `CMakeLists.txt` | `app/` | `cmake -S . -B build && cmake --build build` |
| `esp32-esp-idf` | `CMakeLists.txt`, `sdkconfig.defaults`, `components/iotos/CMakeLists.txt`, `main/Kconfig.projbuild` (Wi-Fi) | `main/` | `idf.py build` (ESP-IDF v5.4.1) |
| `nxp-imxrt1050-mcuxpresso` | `CMakeLists.txt`, `prj.conf`, `lwipopts.h` and `board/` from spec 026 PR 4's example (an MCUXpresso SDK 26.09 freestanding project) | `app/` | `cmake -S . -B build -G Ninja && cmake --build build` with `MCUXSDK_ROOT` and `ARMGCC_DIR` set |
| AI-assisted (`stm32`, `rpi-pico`, `nordic-nrf`, `other`) | none | `app/` (adds `app/ports/` with the port templates) | chosen by the developer and the agent |

Rules:
- **Locating the SDK**: every built project finds the SDK only through `sdk/` and the
  tables only through `generated/`.
- **Settings**: when `config/iotos_settings.c` exists, the build compiles it. Otherwise
  it compiles `sdk/starter/settings_missing.c`, and `main.c` prints the missing-settings
  message and returns without connecting.
- **Settings version**: every built example has `#if IOTOS_KIT_SETTINGS_FORMAT != 1`
  then `#error "These connection settings need a newer starter"` (constitution IV).
- **Settings object**: `main.c` copies the `const` `iotos_kit_settings` into a mutable
  `iotos_settings` and sets `node_type = &iotos_kit_node_type` before `iotos_init`.
- **Role**: examples also refuse settings whose `IOTOS_KIT_GATEWAY` differs from
  `IOTOS_KIT_ROLE_GATEWAY` in `generated/iotos_types.h`.
- **CMake**: `sdk/starter/iotos_starter.cmake` adds `generated/iotos_types.c` and the
  settings (or `settings_missing.c`) to a target, and re-runs the configuration when
  `config/` changes.
- **Simulator**: `sdk/examples/desktop-simulator/` builds against the starter's
  `generated/` and `config/` (its kit mode); the README shows the command.
- **ESP32**: the `.gitignore` adds `sdkconfig`, `sdkconfig.old` and `managed_components/`,
  because `sdkconfig` holds the Wi-Fi password.
- **Gitignore**: `config/*` with `!config/README.md`.

## Connection settings

File name: `<device-code>-connection-settings.zip` or
`<edge-node-id>-gateway-connection-settings.zip`. It has no root folder, so it unpacks
straight into a starter.

```text
config/iotos_settings.h
config/iotos_settings.c
config/README.md
device-config.json   ca.crt   quickstart.md      direct device only, unchanged from today's kit
```

`iotos_settings.h` follows spec 026's kit layout (`IOTOS_KIT_BROKER_HOST`, `…_PORT`,
`…_GROUP_ID`, `…_EDGE_NODE_ID`, `…_HOST_ID`, `…_USERNAME`, `…_PASSWORD`, `…_CA_PEM`,
`…_GATEWAY`) and adds `IOTOS_KIT_SETTINGS_FORMAT 1`. `iotos_settings.c` defines
`const iotos_settings iotos_kit_settings` with `node_type` NULL (`main.c` copies it and
sets `node_type` from `iotos_kit_node_type`) and `iotos_kit_settings_present = 1`.
`config/README.md` says the files are useful only inside a starter or full kit.

Golden copies of both settings files, rendered from fixture credentials, are in
`contracts/firmware/fixtures/expected/settings-{direct,gateway}/` (research R19).

## Full kit

File name: `<device-code>-<target>-firmware-kit.zip` or
`<edge-node-id>-<target>-firmware-kit.zip`. It is the starter, root folder included, with
the settings files placed in `<root>/config/`. For a direct device, the three existing
files are also placed at `<root>/`.

## What must never be in a starter

- Passwords, usernames, client IDs, the CA certificate, the broker address, group or edge
  node IDs, device codes, or any other tenant identity.
- Another organization's profile data.

A feature test unpacks starters for every target and role and searches them for the
test gateway's username, password and broker host, and for `BEGIN CERTIFICATE`, outside
`sdk/third_party` (SC-005). It also asserts that
`sdk/examples/desktop-simulator/sample-config/` is absent.
