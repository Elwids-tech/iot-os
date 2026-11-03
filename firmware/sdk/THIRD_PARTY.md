# Third-party code

| Component | Version | Licence | Used by | How |
| --- | --- | --- | --- | --- |
| [coreMQTT](https://github.com/FreeRTOS/coreMQTT) | v2.3.1 | MIT | The core, at the stream level | Vendored in `third_party/coreMQTT/` (its `source/` folder and `LICENSE`, unchanged) |
| [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) | 3.6.7 | Apache-2.0 | `ports/posix` (desktop) and the board ports | Fetched at build time, pinned by hash; not redistributed |
| [Unity](https://github.com/ThrowTheSwitch/Unity) | v2.6.1 | MIT | The tests only | Fetched at build time, pinned by hash; not redistributed |

The SDK's settings for coreMQTT are in `src/core_mqtt_config.h`. Update the vendored copy
by replacing `third_party/coreMQTT/` with the new release's `source/` folder and
`LICENSE`, then updating this table and `CHANGELOG.md`.
