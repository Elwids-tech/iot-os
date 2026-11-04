# Nordic nRF notes

- **Framework**: the nRF Connect SDK, which is Zephyr with Nordic's libraries. Builds use
  `west` and CMake.
- **Network**: nRF91 parts have an LTE-M or NB-IoT modem with Zephyr sockets, which offload
  TLS to the modem. nRF70 parts add Wi-Fi to an nRF53 or nRF54 host.
- **TLS**: on nRF91, provision the CA into the modem's credential store and open a TLS
  socket with `SOL_TLS` options: the modem verifies the broker. Elsewhere, use mbedTLS
  through Zephyr's sockets.
- **Clock**: the `date_time` library, which takes the time from the modem network or
  SNTP. Report the time as invalid until `date_time_is_valid()`.
- **Storage**: Zephyr's settings subsystem on NVS or ZMS.
- **Lock**: a Zephyr `k_mutex`.
- **Traps**:
  - The nRF Connect SDK has its own MQTT library (`CONFIG_MQTT_LIB`) and samples that use
    it. Do not enable it: the IoT OS SDK runs its own MQTT client.
  - nRF91 modems limit how many TLS sockets and credentials they keep; use one.
  - Cellular links drop often: keep `IOTOS_KEEPALIVE_S` and the reconnect back-off at
    their defaults.
