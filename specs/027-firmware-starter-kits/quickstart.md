# Quickstart: Validating Firmware Starter Kits

The runs that prove [spec 027](spec.md) works. Contracts:
[starter layout](contracts/starter-layout.md), [platform API](contracts/platform-api.md),
[device brief](contracts/device-brief.md).

## Prerequisites

- The local stack is running with the devices overlay, and the api, workers and portal
  have been rebuilt from the branch under test
  ([local setup](../../docs/dev/local-setup.md#rebuild-one-service)).
- A signed-in organization admin, and a member without `Device.manage-connections`.
- A published profile with at least one writable metric. A second published profile is
  needed for gateway runs.
- CMake and a C compiler for runs 2 and 3. ESP-IDF v5.4.1 for run 7. Spec 026's EVKB
  bench for run 8.

## 1. Targets and permissions (API)

```bash
cd apps/api && php artisan test --compact --filter=Firmware
```

**Expect**:
- Targets list built targets first.
- `nxp-imxrt1050-mcuxpresso` is absent until spec 026 PR 4's example exists.
- Another organization's artifact gives a 404.
- A member can download starters but gets 403 for settings and kits.
- Draft artifacts and over-limit types give 422 with the macro name.
- The secret scan (starter layout, last section) passes for every target and role.
- The same request through each endpoint gives identical contents apart from
  `generated_at`.
- Generated files match the golden outputs in `contracts/firmware/fixtures/expected/`.
- An unauthenticated request gets 401.

## 2. Linux starter from the profile page (US1)

1. Open the profile, then **Firmware**, choose **Linux**, then **Connects directly**,
   and download.
2. Unpack the starter into `.local/starters/` and build it with `cmake -S <root> -B
   <root>/build && cmake --build <root>/build`.
3. Run `<root>/build/app`.

**Expect**:
- The build succeeds with no edits.
- The run prints the missing-settings message and exits without connecting.
- `iotos-starter.json` names the profile revision, `linux`, the SDK version, and each
  metric's `introduced_in`.

## 3. Settings for a direct device (US3)

1. Register a direct device with the same profile.
2. On its page, choose **Firmware**, then **Download settings**, and unpack into the
   starter from run 2.
3. Rebuild and run.

**Expect**:
- The device connects, and its births match the profile with no mapping changes.
- The activity log shows `device.connection-settings.downloaded` without secrets.
- The member from the prerequisites sees no settings action, and a direct POST is
  refused.

## 4. Updating a project (US6)

1. Add a line to `app/field.c` and create `app/device-brief.yaml` in the run-2 starter.
2. Publish a new profile revision that adds a metric and changes another's unit.
3. Download a new Linux starter and replace only the manifest's `replaceable` paths.
4. Rebuild.

**Expect**:
- The developer files are unchanged and the build succeeds.
- The new manifest shows the added metric with `introduced_in` set to the new revision,
  and the changed metric with `changed_in` set to it.

## 5. Gateway Firmware dialog (US4, US3)

1. Open a gateway, choose **Firmware**, keep the preselected health profile (or the
   default health table), and add the two published profiles.
2. Choose Linux and download the **full kit**.
3. Build it. Then run the SDK desktop simulator inside the kit with the kit's `config/`.

**Expect**:
- The gateway connects, and the births of its node and two device types match their
  profiles.
- Reopening the dialog shows the saved selection, for a second admin too.
- **Get credentials** is gone, and its server-export text remains as a note.

## 6. Onboarding and assistant (US4, US5)

1. In **Add device** (direct Sparkplug), choose "I'm writing the firmware", pick an
   available built target (Linux; ESP32 once 027-3 has merged), and download the starter
   and then the firmware kit.
2. With the assistant enabled, ask "I want to write Linux firmware for <profile>", then
   press the card.
3. With the assistant disabled, repeat step 1.

**Expect**:
- Step 1's starter has the same contents as the profile page's, and the kit adds the
  settings. A member without `Device.manage-connections` sees only the starter.
- Step 2 gives the same starter, and the stored conversation and tool results contain no
  username, password or CA.
- Step 3 works unchanged.

## 7. ESP32 bench with two coding agents (US2, SC-001, SC-007)

Follow `docs/hardware/esp32-starter-bench.md` (R17) once with Claude Code and once with
Codex. Start timing at **Firmware**.

**Expect**, in each run:
- The first agent output is questions.
- No question asks for anything in `generated/profiles/*.json` or the manifest.
- `device-brief.yaml` validates against `.iotos/device-brief.schema.json` and is
  confirmed before any code.
- `config/` is never opened.
- Readings matching the sensor's display are stored within 60 minutes.
- Unknown answers leave their metric unpublished.
- After a reboot, the next session's `bdSeq` is one higher, and the births match the
  desktop simulator's for the same profile (FR-013).

Record the outcomes, not the transcripts, in the bench doc.

## 8. NXP i.MX RT bench (SC-003)

After spec 026 PR 4:
1. Download an NXP full kit for a gateway with one Modbus device type.
2. Build it with `MCUXSDK_ROOT` set, flash the EVKB, and connect it over Ethernet.

**Expect**:
- The gateway and the Modbus simulator's devices are born and match their profiles.
- No file outside `app/` and `config/` was edited.

## 9. CI

The `Firmware starters` job is green:
- every Linux and ESP32 starter builds, and the Linux ones run to the missing-settings
  exit;
- the NXP build runs on firmware changes and nightly;
- AI-assisted starters pass their file and template checks;
- the contracts job validates the device brief fixtures (SC-002).
