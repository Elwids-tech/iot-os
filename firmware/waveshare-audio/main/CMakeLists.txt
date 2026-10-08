idf_component_register(SRCS "main.c" "network.c" "sparkplug_wire.c" INCLUDE_DIRS "."
    REQUIRES esp_driver_i2c esp_driver_i2s esp_driver_usb_serial_jtag esp_driver_gpio
        esp_timer json esp_wifi esp_netif mqtt nvs_flash mbedtls)

# Keep credentials outside the repository; USB builds need no Wi-Fi header.
if(DEFINED ENV{WAVE_CONFIG_DIR})
    if(NOT EXISTS "$ENV{WAVE_CONFIG_DIR}/wave_credentials.h")
        message(FATAL_ERROR "WAVE_CONFIG_DIR must contain private wave_credentials.h")
    endif()
    target_include_directories(${COMPONENT_LIB} PRIVATE "$ENV{WAVE_CONFIG_DIR}")
    target_compile_definitions(${COMPONENT_LIB} PRIVATE WAVE_NETWORK_ENABLED=1)
endif()
