# Quickstart: Embedded Gateway SDK

Validation guide for reviewers and for the implementation PRs. Commands assume the
repository root. The platform steps assume the local devices stack is running
(`./taskw devices:up`).

## 1. SDK on the desktop (PR 1)

```bash
cmake -S firmware/sdk -B .local/sdk-build -DIOTOS_SANITIZE=ON && cmake --build .local/sdk-build
ctest --test-dir .local/sdk-build --output-on-failure
```

Expected: every test passes under AddressSanitizer and UBSan. The codec tests reproduce
`contracts/sparkplug/fixtures/{nbirth,dbirth-meter,ddata-alias,ndeath}.bin` byte for byte
and decode `dcmd-light.bin`. Then:

```bash
cd services/runtime && go test ./internal/sparkplug/ -run SDKFixtures
```

Expected: every payload in `contracts/sparkplug/fixtures/sdk/` replays with no
diagnostics.

## 2. Portability and size

```bash
cmake -S firmware/sdk -B .local/sdk-arm -DCMAKE_TOOLCHAIN_FILE=firmware/sdk/cmake/arm-none-eabi.cmake && cmake --build .local/sdk-arm --target iotos_size
```

Expected:
- The core (and, from PR 4, the FreeRTOS port) builds with `-Werror`.
- The size report shows `iotos_gateway` at 32 KB or less with `IOTOS_MAX_DEVICES=512`
  (SC-003).
- The library has no writable static data, and nothing in it references `malloc`,
  `calloc`, `realloc` or `free` (FR-005).

## 3. Gateway kit and desktop simulator (PR 2)

1. In the portal, **Fleet → Gateways**: register a gateway on a ready connection, then
   **Download kit**. Create the gateway health profile when offered, and add a published
   device profile as a device type (for example the water meter from
   `php artisan devices:prepare-water-meter-profile`).
2. Unzip the kit under `.local/`, then build and run the simulator:

   ```bash
   cmake -S .local/kit/examples/desktop-simulator -B .local/kit-sim && cmake --build .local/kit-sim
   .local/kit-sim/gateway-sim --devices water_meter=500 --state-file .local/kit-sim/state
   ```

3. Expected:
   - The gateway shows online.
   - **Connect → Discovery** lists the gateway's own source and 500 device sources.
   - The telemetry viewer shows the traffic with no out-of-step diagnostics.
4. Stop the simulator (Ctrl-C) and start it again with the same `--state-file`.
   Expected: all 500 sources are announced again within five minutes, with the next
   `bdSeq` (SC-004, User Story 7).
5. Stop it again. Expected: the gateway and its devices show offline.

## 4. The gateway itself (PR 2)

**Devices → Add device**: existing gateway, **The gateway itself**, gateway health
profile. Expected: uptime, connection type, SDK version and device counts arrive, and
the device reaches active. Stopping the simulator raises `gateway_offline`.

## 5. Bulk onboarding (PR 3)

1. In **Connect → Discovery**, filter by the gateway, search for the water meter sources,
   and choose **Select all 247 matching**. The selection spans the table's pages. Choose
   **Onboard selected**, pick the water meter profile, and keep the pattern
   `Meter {device_id}`.
2. Expected:
   - Progress reaches 247 *activation requested*.
   - The devices become active with stored readings within a few minutes.
   - The run reports no failures.
   - The simulator log shows three rebirths or fewer (R19).
3. Include one source whose type is another profile. Expected: it is skipped with a
   missing-metric reason, and the rest continue.
4. Repeat the same request (same `operation_uuid`). Expected: no duplicate devices.

## 6. Commands

Send a command to a writable metric of one simulated device. Expected: the simulator logs
it and publishes the new state, and the command completes as observed.

## 7. End to end, scripted (PR 2 and PR 3)

```bash
node tooling/verify-embedded-sdk.mjs .local/devices/environment.json
```

Runs steps 3 to 6 against the local stack and prints the rebirth count and timings.

## 8. Reference board (PR 4, bench)

On an MIMXRT1050-EVKB on Ethernet, with a USB-RS485 adapter on a PC running a Modbus
simulator for addresses 1–247 and the example's RS-485 polling loop:

1. Rebuild `api`, which bundles this PR's board example into kits, and download a fresh
   kit from the local stack. Build its `examples/rt1050-evkb-ethernet` with
   `MCUXSDK_ROOT` set, flash it, and open the serial console.
2. Expected:
   - The console shows the clock synced, the TLS connection and the births.
   - The portal shows the gateway and its devices as in step 3.
   - Unplugging the Ethernet cable marks them offline.
   - Plugging it back in re-announces every device within five minutes (SC-004).
3. Record the firmware's RAM and flash use and the time from kit download to first
   readings (SC-001) in the PR.
