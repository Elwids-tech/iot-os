# SPDX-License-Identifier: MIT
# iotos_freertos_check: compiles ports/freertos for the Cortex-M7 against a pinned FreeRTOS
# kernel and the minimal FreeRTOSConfig.h beside this file, so the shared FreeRTOS ports keep
# building outside a vendor SDK. Only compiled, never linked or run:
#   cmake --build .local/sdk-arm --target iotos_freertos_check
include(FetchContent)
FetchContent_Declare(freertos_kernel
  URL https://github.com/FreeRTOS/FreeRTOS-Kernel/releases/download/V11.3.1/FreeRTOS-KernelV11.3.1.zip
  URL_HASH SHA256=0ce48d03f9f45ebe3d3090731a5cf54a245083aadef5fa33ecad43a07d35193a
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR headers-only) # the kernel's own CMakeLists.txt needs a port and a config target
FetchContent_MakeAvailable(freertos_kernel)

add_library(iotos_freertos_check OBJECT
  ${CMAKE_CURRENT_SOURCE_DIR}/../../ports/freertos/lock.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../../ports/freertos/log.c)
target_include_directories(iotos_freertos_check PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../../ports/freertos
  ${freertos_kernel_SOURCE_DIR}/include
  ${freertos_kernel_SOURCE_DIR}/portable/GCC/ARM_CM7/r0p1)
target_link_libraries(iotos_freertos_check PRIVATE iotos)
target_compile_definitions(iotos_freertos_check PRIVATE IOTOS_FREERTOS_PRINTF=printf)
target_compile_options(iotos_freertos_check PRIVATE ${IOTOS_WARNINGS})
