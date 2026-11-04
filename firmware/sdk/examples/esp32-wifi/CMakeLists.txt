# SPDX-License-Identifier: MIT
# An ESP32 program on the IoT OS SDK, with ESP-IDF v5.4. In a starter:
#   idf.py menuconfig          the Wi-Fi network, under "IoT OS application"
#   idf.py build flash monitor
# The developer's code is in main/; components/iotos builds sdk/ with generated/ and config/.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(iotos_app)
