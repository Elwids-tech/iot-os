# SPDX-License-Identifier: MIT
# The desktop gateway simulator. Inside a starter (sdk/examples/desktop-simulator) it uses
# the starter's generated/ and config/; in the SDK repository, sample-config/:
#   cmake -S sdk/examples/desktop-simulator -B build/simulator && cmake --build build/simulator
cmake_minimum_required(VERSION 3.20)
project(gateway_simulator C)

set(IOTOS_SDK_ROOT ${CMAKE_CURRENT_LIST_DIR}/../..)
if(NOT TARGET iotos)
  set(IOTOS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  add_subdirectory(${IOTOS_SDK_ROOT} iotos-sdk)
endif()
include(${IOTOS_SDK_ROOT}/starter/iotos_starter.cmake)

set(IOTOS_STARTER_ROOT ${CMAKE_CURRENT_LIST_DIR}/../../..)
if(EXISTS ${IOTOS_STARTER_ROOT}/generated/iotos_types.c)
  set(IOTOS_GENERATED_DIR ${IOTOS_STARTER_ROOT}/generated) # a starter
  set(IOTOS_DEFAULT_CONFIG_DIR ${IOTOS_STARTER_ROOT}/config)
else()
  set(IOTOS_GENERATED_DIR ${CMAKE_CURRENT_LIST_DIR}/sample-config)
  set(IOTOS_DEFAULT_CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR}/sample-config)
endif()
# -DIOTOS_CONFIG_DIR=<dir> points at other settings, for example ones kept outside the project.
if(NOT IOTOS_CONFIG_DIR)
  set(IOTOS_CONFIG_DIR ${IOTOS_DEFAULT_CONFIG_DIR})
endif()

add_executable(gateway-sim main.c)
iotos_starter_sources(gateway-sim ${IOTOS_GENERATED_DIR} ${IOTOS_CONFIG_DIR})
target_link_libraries(gateway-sim PRIVATE iotos_posix)
target_compile_options(gateway-sim PRIVATE -Wall -Wextra -Werror)

if(TARGET iotos_test_support)
  target_compile_definitions(gateway-sim PRIVATE IOTOS_SIM_SELFTEST)
  target_link_libraries(gateway-sim PRIVATE iotos_test_support)
  add_test(NAME simulator COMMAND gateway-sim --selftest)
endif()
