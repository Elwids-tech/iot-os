# Contract: Device Brief and AI Brief

## Device brief

**File**: `<developer path>/device-brief.yaml` in the developer's project. The platform
never receives it (Q2).

**Schema**: `contracts/firmware/device-brief.v1.schema.json` (JSON Schema draft 2020-12),
copied into every starter as `.iotos/device-brief.schema.json`. Its structure is in the
[data model](../data-model.md#device-brief-developers-project-never-stored-by-the-platform).

**Fixtures** in `contracts/firmware/fixtures/briefs/`:

| Fixture | Valid? | Shows |
| --- | --- | --- |
| `modbus-gateway.yaml` | valid | Two Modbus RTU device types on two RS-485 ports, address ranges, a writable coil |
| `esp32-direct-sensor.yaml` | valid | A direct ESP32 device with one Modbus sensor and one analog input |
| `with-unknowns.yaml` | valid | `unknown` sources and an `unconfirmed[]` list |
| `invalid-modbus-missing-register.yaml` | invalid | A Modbus source without `register` |
| `invalid-unknown-kind.yaml` | invalid | A source kind outside the enum |

`tooling/verify-devices-contracts.py` validates the fixtures (valid ones pass, invalid
ones fail). Its tests cover the check.

**Versioning**:
- `format: 1`. A breaking change adds `device-brief.v2.schema.json` and keeps v1 in the
  repository, so existing projects stay valid.
- Starters ship the schema version their `AGENTS.md` writes.

**Cross-checks** the schema cannot express are made by the agent, as `AGENTS.md`
instructs. They are listed in the schema's `description`:
- metric keys must exist in `generated/profiles/<code>.json`;
- `commands` keys must be writable there.

## AI brief

**Files**:
- `AGENTS.md`: the only copy.
- `CLAUDE.md`: exactly `@AGENTS.md`.
- `README.md` "Start with AI": the fallback prompt.

They are rendered from `firmware/starters/templates/` with the starter's facts: the
target, its developer path, the profile names, the metric counts and the build command.
The files hold no secrets.

**Required sections of `AGENTS.md`**, in order (checked by a feature test for every
target):

1. **What this project is**: the SDK handles Sparkplug and the connection; you write the
   field side; `sdk/include/iotos/iotos.h` is the only API; the threading rules in short.
2. **Rules**:
   - never open, print, copy or commit anything in `config/` except `config/README.md`;
   - never edit `sdk/`, `generated/` or `.iotos/`;
   - write no code before the device brief is confirmed;
   - never invent a value: an unknown source stays a stub;
   - build, and run where possible, before saying it works.
3. **Already known, do not ask**: points at `iotos-starter.json` and
   `generated/profiles/*.json`, and lists what they answer: metric names, types, units,
   ranges, writability, and whether this is a gateway or a direct device.
4. **Interview**, in this order:
   1. hardware;
   2. uplink;
   3. time source and credential storage;
   4. then per device type:
      - addressing;
      - each metric's source, asked as one table per type;
      - each writable metric's effect and read-back;
      - polling, reporting and offline rules;
   5. power and watchdog;
   6. instructions.

   "I don't know" is recorded as `unknown`. Built targets skip the port questions.
5. **Device brief**: if a brief exists with a `format` other than the schema's, stop and
   ask the developer to download a newer starter. Otherwise write it, validate it against
   `.iotos/device-brief.schema.json`, show it, and wait for an explicit confirmation.
6. **Port** (AI-assisted targets only): fill `app/ports/` from the templates, following
   `.iotos/porting.md` and `.iotos/family.md`, before the field side.
7. **Field side**: implement `field.c` from the brief only.
8. **Verify**:
   - build;
   - with settings present, run and watch for the first data;
   - ask the developer to compare the first readings with the device's own display, and
     move confirmed answers out of `unconfirmed`.
9. **Later changes**: update the brief first, then the code.

**Drift test**: for every available target and both roles, every path named in
`AGENTS.md` and `README.md` exists in the starter, and every `iotos_*` identifier named
there is declared in `sdk/include/iotos/`.
