# SPDX-License-Identifier: MIT
cmake_minimum_required(VERSION 3.20)

file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/VERSION" IOTOS_VERSION LIMIT_COUNT 1)
project(iotos_sdk VERSION ${IOTOS_VERSION} LANGUAGES C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

option(IOTOS_SANITIZE "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
if(CMAKE_CROSSCOMPILING)
  set(IOTOS_HOST_DEFAULT OFF)
else()
  set(IOTOS_HOST_DEFAULT ON)
endif()
option(IOTOS_BUILD_POSIX "Build the POSIX ports (mbedTLS over sockets)" ${IOTOS_HOST_DEFAULT})
if(NOT EXISTS ${CMAKE_CURRENT_LIST_DIR}/tests)
  set(IOTOS_HOST_DEFAULT OFF) # a kit's copy ships without the tests
endif()
option(IOTOS_BUILD_TESTS "Build the tests, the fixture writer and the simulator self-test" ${IOTOS_HOST_DEFAULT})

set(IOTOS_WARNINGS -Wall -Wextra -Werror)
if(IOTOS_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all)
  add_link_options(-fsanitize=address,undefined)
endif()

# The core: the SDK and the vendored coreMQTT, no OS, no heap.
include(${CMAKE_CURRENT_LIST_DIR}/cmake/iotos_sources.cmake)
add_library(iotos STATIC ${IOTOS_CORE_SOURCES})
target_include_directories(iotos
  PUBLIC ${CMAKE_CURRENT_LIST_DIR}/include
  PRIVATE ${IOTOS_CORE_PRIVATE_INCLUDE_DIRS})
target_compile_options(iotos PRIVATE ${IOTOS_WARNINGS})

if(CMAKE_CROSSCOMPILING)
  include(${CMAKE_CURRENT_LIST_DIR}/cmake/iotos_size.cmake)
endif()

include(FetchContent)

if(IOTOS_BUILD_POSIX)
  set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
  set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
  set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(mbedtls
    URL https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.7/mbedtls-3.6.7.tar.bz2
    URL_HASH SHA256=a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    EXCLUDE_FROM_ALL)
  FetchContent_MakeAvailable(mbedtls)

  add_library(iotos_posix STATIC
    ports/posix/clock.c
    ports/posix/lock.c
    ports/posix/log.c
    ports/posix/ports.c
    ports/posix/storage_file.c
    ports/posix/stream_mbedtls.c)
  target_include_directories(iotos_posix PUBLIC ${CMAKE_CURRENT_LIST_DIR}/ports/posix)
  target_link_libraries(iotos_posix PUBLIC iotos mbedtls mbedx509 mbedcrypto)
  find_package(Threads REQUIRED)
  target_link_libraries(iotos_posix PUBLIC Threads::Threads)
  target_compile_options(iotos_posix PRIVATE ${IOTOS_WARNINGS})
endif()

if(IOTOS_BUILD_TESTS)
  enable_testing()
  FetchContent_Declare(unity
    URL https://github.com/ThrowTheSwitch/Unity/archive/refs/tags/v2.6.1.tar.gz
    URL_HASH SHA256=b41a66d45a6b99758fb3202ace6178177014d52fc524bf1f72687d93e9867292
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    EXCLUDE_FROM_ALL)
  FetchContent_MakeAvailable(unity)
  target_compile_definitions(unity PUBLIC UNITY_INCLUDE_DOUBLE)
  add_subdirectory(tests)
  add_subdirectory(tools)
  add_subdirectory(examples/desktop-simulator)
  add_subdirectory(examples/linux-app)
endif()
