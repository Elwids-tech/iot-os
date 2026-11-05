# Third-party code

| Component | Version | Licence | Used by | How |
| --- | --- | --- | --- | --- |
| [coreMQTT](https://github.com/FreeRTOS/coreMQTT) | v2.3.1 | MIT | The core, at the stream level | Vendored in `third_party/coreMQTT/` (its `source/` folder and `LICENSE`, unchanged) |
| [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) | 3.6.7 | Apache-2.0 | `ports/posix` (desktop) and the board ports | Fetched at build time, pinned by hash; not redistributed |
| [Unity](https://github.com/ThrowTheSwitch/Unity) | v2.6.1 | MIT | The tests only | Fetched at build time, pinned by hash; not redistributed |
| [FreeRTOS-Kernel](https://github.com/FreeRTOS/FreeRTOS-Kernel) | V11.3.1 | MIT | The cross-compile check of `ports/freertos` (`tests/freertos-config`) | Fetched at build time, pinned by hash; not redistributed. Boards use their own SDK's copy |
| MCUXpresso SDK board files for the EVKB (`evkbimxrt1050` `lwip_mqtt` example) | 26.09.00 | BSD-3-Clause | `examples/rt1050-evkb-ethernet` | Copied into its `board/`: `pin_mux.c`, `pin_mux.h` and `hardware_init.c` unchanged, `app.h` without its static IP addresses. Each keeps NXP's copyright and SPDX line |
| [MCUXpresso SDK](https://github.com/nxp-mcuxpresso/mcuxsdk-manifests) (drivers, lwIP, FreeRTOS, Mbed TLS) | 26.09.00 | BSD-3-Clause and the components' own | `ports/mcuxpresso-lwip` and the board example | Fetched by the developer with `west`; not redistributed |

The SDK's settings for coreMQTT are in `src/core_mqtt_config.h`. Update the vendored copy
by replacing `third_party/coreMQTT/` with the new release's `source/` folder and
`LICENSE`, then updating this table and `CHANGELOG.md`.
