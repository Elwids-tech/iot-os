# SPDX-License-Identifier: MIT
# The desktop gateway simulator. Standalone (from a kit) it builds the SDK next to it:
#   cmake -S examples/desktop-simulator -B build && cmake --build build
cmake_minimum_required(VERSION 3.20)
project(gateway_simulator C)

if(NOT TARGET iotos)
  if(NOT IOTOS_SDK_DIR)
    if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/../../sdk/CMakeLists.txt)
      set(IOTOS_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/../../sdk) # a kit
    else()
      set(IOTOS_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/../..) # the repository's firmware/sdk
    endif()
  endif()
  set(IOTOS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  add_subdirectory(${IOTOS_SDK_DIR} iotos-sdk)
endif()

# -DIOTOS_CONFIG_DIR=<dir> points at another config, for example one kept outside the repository.
if(NOT IOTOS_CONFIG_DIR)
  if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/../../config/iotos_settings.c)
    set(IOTOS_CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR}/../../config) # a kit's generated config
  else()
    set(IOTOS_CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR}/sample-config)
  endif()
endif()

add_executable(gateway-sim main.c ${IOTOS_CONFIG_DIR}/iotos_settings.c)
target_include_directories(gateway-sim PRIVATE ${IOTOS_CONFIG_DIR})
target_link_libraries(gateway-sim PRIVATE iotos_posix)
target_compile_options(gateway-sim PRIVATE -Wall -Wextra -Werror)

if(TARGET iotos_test_support)
  target_compile_definitions(gateway-sim PRIVATE IOTOS_SIM_SELFTEST)
  target_link_libraries(gateway-sim PRIVATE iotos_test_support)
  add_test(NAME simulator COMMAND gateway-sim --selftest)
endif()
