# Raspberry Pi Pico notes

- **Framework**: the Pico SDK (C), with FreeRTOS SMP or bare metal with the SDK's async
  context. The Pico W and Pico 2 W have Wi-Fi through the CYW43 driver.
- **Network**: lwIP from the Pico SDK. Use the `pico_cyw43_arch_lwip_threadsafe_background`
  or `_sys_freertos` variant, and take the lwIP lock around socket calls.
- **TLS**: mbedTLS from the Pico SDK (`pico_mbedtls`) over lwIP's altcp or sockets for
  the stream port. Use `pico_rand` for entropy.
- **Clock**: SNTP from lwIP, then the always-on timer or the RP2040 RTC. Report the time
  as invalid until it has been set.
- **Storage**: the last flash sector, written with `flash_range_erase` and
  `flash_range_program` with interrupts off and the other core paused.
- **Lock**: a FreeRTOS mutex, or a Pico SDK `mutex_t` on bare metal.
- **Traps**:
  - The RP2040 has 264 KB of RAM. TLS and the SDK's buffers fit, but keep the device count
    and `IOTOS_TX_BUFFER` modest.
  - Writing flash stalls code running from flash on both cores.
