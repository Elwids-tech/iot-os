# SPDX-License-Identifier: MIT
# Cross-compiles the SDK core for the i.MX RT1050's Cortex-M7, as CI and the board do:
#   cmake -S firmware/sdk -B .local/sdk-arm -DCMAKE_TOOLCHAIN_FILE=firmware/sdk/cmake/arm-none-eabi.cmake
#   cmake --build .local/sdk-arm --target iotos_size
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_C_FLAGS_INIT "-mcpu=cortex-m7 -mfpu=fpv5-d16 -mfloat-abi=hard -mthumb -Os -ffunction-sections -fdata-sections")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
