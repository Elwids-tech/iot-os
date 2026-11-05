#!/usr/bin/env bash
# Builds, with the MCUXpresso SDK 26.09.00 and the Arm GNU Toolchain 14.2 (spec 027 R11):
#  - every NXP i.MX RT1050 starter that `php artisan firmware:starter-fixtures` wrote, as
#    downloaded, so without connection settings;
#  - a full kit: the direct relay starter with the golden connection settings in config/;
#  - the SDK's own example, against the simulator's sample tables.
# Each build must leave its own files free of compiler warnings and compile exactly the core
# sources listed in <desktop sources>, the desktop library's (FR-013; core_sources.py).
#
#   tooling/firmware/build-nxp-starters.sh <starters> <desktop sources> <work folder>
#
# Set MCUXSDK_ROOT to the mcuxsdk/ folder of the SDK workspace and ARMGCC_DIR to the
# toolchain; CMake 3.30 or later and Ninja must be on the PATH.
set -euo pipefail

: "${MCUXSDK_ROOT:?set MCUXSDK_ROOT to the mcuxsdk/ folder of the MCUXpresso SDK workspace}"
: "${ARMGCC_DIR:?set ARMGCC_DIR to the Arm GNU Toolchain folder}"
starters=$(cd "$1" && pwd -P)
desktop=$2
mkdir -p "$3"
work=$(cd "$3" && pwd -P)
repo=$(cd "$(dirname "$0")/../.." && pwd -P)

# <name> <project> <sdk>: builds into the work folder, then checks its warnings and its core
# sources, and prints the memory each region uses.
build() {
  local name=$1 project=$2 sdk=$3
  local out="$work/$name" log="$work/$name.log"
  rm -rf "$out"
  echo "::group::$name"
  { cmake -S "$project" -B "$out" -G Ninja && cmake --build "$out"; } 2>&1 | tee "$log"
  echo "::endgroup::"
  test -f "$out/iotos_app.elf" || { echo "$name: no iotos_app.elf"; exit 1; }
  if grep -E "^($project|$sdk)/[^:]+:[0-9]+:[0-9]+: warning: " "$log"; then
    echo "$name: the compiler warned about the project's own files"
    exit 1
  fi
  python3 "$repo/tooling/firmware/core_sources.py" "$out/compile_commands.json" "$sdk" >"$work/$name.sources"
  if ! diff -u "$desktop" "$work/$name.sources"; then
    echo "$name compiles other core sources than the desktop library"
    exit 1
  fi
  sed -n '/^Memory region/,/m_heap/p' "$log"
  echo "$name builds"
}

found=0
kit="$work/kit-direct-relay-project"
rm -rf "$kit"
cp -R "$starters/direct-relay" "$kit"
cp "$repo"/contracts/firmware/fixtures/expected/settings-direct/config/iotos_settings.[ch] "$kit/config/"
for starter in "$starters"/*/; do
  starter=${starter%/}
  build "$(basename "$starter")" "$starter" "$starter/sdk"
  grep -q "settings_missing.c" "$work/$(basename "$starter")/compile_commands.json"
  found=$((found + 1))
done
test "$found" -gt 0 || { echo "no NXP starters in $starters"; exit 1; }
build kit-direct-relay "$kit" "$kit/sdk"
grep -q "IOTOS_KIT_HAVE_SETTINGS=1" "$work/kit-direct-relay/compile_commands.json"
build example "$repo/firmware/sdk/examples/rt1050-evkb-ethernet" "$repo/firmware/sdk"
