# SPDX-License-Identifier: MIT
# iotos_size: reports the SDK's RAM and flash on the target and fails when
#  - sizeof(iotos_gateway) exceeds 32768 bytes with the default limits (SC-003);
#  - the library (core and coreMQTT) has any .data or .bss, so all state is in iotos_gateway;
#  - it references malloc, calloc, realloc or free (FR-005).
find_program(IOTOS_NM NAMES arm-none-eabi-nm REQUIRED)
find_program(IOTOS_SIZE NAMES arm-none-eabi-size REQUIRED)
add_library(iotos_size_probe OBJECT ${CMAKE_CURRENT_LIST_DIR}/size_probe.c)
target_link_libraries(iotos_size_probe PRIVATE iotos)
add_custom_target(iotos_size ALL
  COMMAND ${CMAKE_COMMAND}
    -DNM=${IOTOS_NM} -DSIZE=${IOTOS_SIZE}
    -DLIBRARY=$<TARGET_FILE:iotos>
    -DPROBE=$<TARGET_OBJECTS:iotos_size_probe>
    -P ${CMAKE_CURRENT_LIST_DIR}/check_size.cmake
  DEPENDS iotos iotos_size_probe
  VERBATIM)
