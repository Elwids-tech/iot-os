# SPDX-License-Identifier: MIT
# A Linux or macOS program on the IoT OS SDK. In a starter:
#   cmake -S . -B build && cmake --build build && ./build/app
# The developer's code is in app/; sdk/, generated/ and config/ are found beside this file.
cmake_minimum_required(VERSION 3.20)
project(iotos_app C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/sdk/CMakeLists.txt)
  # A starter: the SDK, the generated tables and the connection settings sit beside this file.
  set(APP_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/sdk)
  set(APP_GENERATED_DIR ${CMAKE_CURRENT_LIST_DIR}/generated)
  set(APP_CONFIG_DIR ${CMAKE_CURRENT_LIST_DIR}/config)
else()
  # The SDK repository, where CI builds the example against the simulator's sample tables.
  set(APP_SDK_DIR ${CMAKE_CURRENT_LIST_DIR}/../..)
  set(APP_GENERATED_DIR ${APP_SDK_DIR}/examples/desktop-simulator/sample-config)
  set(APP_CONFIG_DIR ${APP_GENERATED_DIR})
endif()

if(NOT TARGET iotos)
  set(IOTOS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  add_subdirectory(${APP_SDK_DIR} iotos-sdk)
endif()
include(${APP_SDK_DIR}/starter/iotos_starter.cmake)

option(APP_WERROR "Treat compiler warnings as errors" OFF)
set(APP_WARNINGS -Wall -Wextra)
if(APP_WERROR OR TARGET iotos_test_support)
  list(APPEND APP_WARNINGS -Werror)
endif()

add_executable(app app/main.c app/field.c)
iotos_starter_sources(app ${APP_GENERATED_DIR} ${APP_CONFIG_DIR})
target_include_directories(app PRIVATE app)
target_link_libraries(app PRIVATE iotos_posix)
target_compile_options(app PRIVATE ${APP_WARNINGS})

if(TARGET iotos_test_support)
  # In the SDK repository: the same program without settings stops with the starter's message.
  add_executable(app-without-settings app/main.c app/field.c)
  iotos_starter_sources(app-without-settings ${APP_GENERATED_DIR} ${CMAKE_CURRENT_BINARY_DIR}/no-config)
  target_include_directories(app-without-settings PRIVATE app)
  target_link_libraries(app-without-settings PRIVATE iotos_posix)
  target_compile_options(app-without-settings PRIVATE ${APP_WARNINGS})
  add_test(NAME starter_missing_settings COMMAND app-without-settings)
  set_tests_properties(starter_missing_settings PROPERTIES PASS_REGULAR_EXPRESSION "No connection settings: download them")
endif()
