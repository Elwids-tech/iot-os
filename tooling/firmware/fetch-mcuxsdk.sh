#!/usr/bin/env bash
# Fetches the MCUXpresso SDK the NXP i.MX RT1050 starter is built and tested with (spec 027
# R11): release 26.09.00 through west, only the projects the RT1050 example uses, at depth 1.
# Then it keeps only the EVKB's board files and the RT1050 device files, and drops the git
# history, which leaves about 550 MB instead of 2 GB. The SDK's mcuxsdk/ folder is what
# MCUXSDK_ROOT names.
#
#   tooling/firmware/fetch-mcuxsdk.sh <workspace folder>
#
# Needs west (pip install west) and git. Does nothing when the workspace is already there.
set -euo pipefail

REVISION=v26.09.00
PROJECTS="core CMSIS mcux-devices-rt mcu-sdk-examples mcu-sdk-components mcuxsdk-tool-data lwip mbedtls3x
  freertos-kernel freertos-kernel-upstream mcux-freertos-drivers"

workspace=$1
if [ -f "$workspace/mcuxsdk/cmake/extension/mcux.cmake" ]; then
  echo "The MCUXpresso SDK is already in $workspace"
  exit 0
fi
west init -m https://github.com/nxp-mcuxpresso/mcuxsdk-manifests --mr "$REVISION" "$workspace"
# shellcheck disable=SC2086 # the project names are words
(cd "$workspace" && west update --narrow -o=--depth=1 $PROJECTS)

sdk="$workspace/mcuxsdk"
find "$sdk/examples/_boards" -mindepth 1 -maxdepth 1 -type d ! -name evkbimxrt1050 -exec rm -rf {} +
find "$sdk/devices/RT" -mindepth 1 -maxdepth 1 -type d -name 'RT*' ! -name RT1050 -exec rm -rf {} +
rm -rf "$sdk/middleware/mbedtls3x/tests"
find "$sdk" -name .git -prune -exec rm -rf {} +
du -sh "$sdk"
