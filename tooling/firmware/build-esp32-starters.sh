#!/usr/bin/env bash
# Builds, with ESP-IDF v5.4 (spec 027 R16):
#  - every ESP32 starter that `php artisan firmware:starter-fixtures` wrote, as downloaded;
#  - a full kit: the direct relay starter with the golden connection settings in config/;
#  - the SDK's own example for the ESP32-C3, so the RISC-V chips build as well as Xtensa.
# Each build must leave its own files free of compiler warnings and compile exactly the core
# sources listed in <desktop sources>, the desktop library's (FR-013; core_sources.py).
#
#   tooling/firmware/build-esp32-starters.sh <starters> <desktop sources> <work folder>
#
# Run it where idf.py works: in espressif/idf:v5.4.1 in CI, or after ESP-IDF's export.sh.
set -euo pipefail

starters=$(cd "$1" && pwd -P)
desktop=$2
mkdir -p "$3"
work=$(cd "$3" && pwd -P)
repo=$(cd "$(dirname "$0")/../.." && pwd -P)

# <name> <project> <sdk> [idf.py options]: builds into <project>/build, or into the work
# folder when options are given, then checks its warnings and its core sources.
build() {
  local name=$1 project=$2 sdk=$3
  shift 3
  local out="$project/build" log="$work/$name.log"
  if [ $# -gt 0 ]; then
    out="$work/$name"
    set -- -B "$out" -DSDKCONFIG="$out/sdkconfig" "$@"
  fi
  echo "::group::$name"
  idf.py -C "$project" "$@" build 2>&1 | tee "$log"
  echo "::endgroup::"
  if grep -E "^($project|$sdk)/[^:]+:[0-9]+:[0-9]+: warning: " "$log"; then
    echo "$name: the compiler warned about the project's own files"
    exit 1
  fi
  python3 "$repo/tooling/firmware/core_sources.py" "$out/compile_commands.json" "$sdk" >"$work/$name.sources"
  if ! diff -u "$desktop" "$work/$name.sources"; then
    echo "$name compiles other core sources than the desktop library"
    exit 1
  fi
  echo "$name builds"
}

found=0
kit="$work/kit-direct-relay"
rm -rf "$kit"
cp -R "$starters/direct-relay" "$kit"
rm -rf "$kit/build" "$kit/sdkconfig" "$kit/sdkconfig.old" # from an earlier run
cp "$repo"/contracts/firmware/fixtures/expected/settings-direct/config/iotos_settings.[ch] "$kit/config/"
for starter in "$starters"/*/; do
  starter=${starter%/}
  build "$(basename "$starter")" "$starter" "$starter/sdk"
  found=$((found + 1))
done
test "$found" -gt 0 || { echo "no ESP32 starters in $starters"; exit 1; }
build kit-direct-relay "$kit" "$kit/sdk"
grep -q "IOTOS_KIT_HAVE_SETTINGS=1" "$kit/build/compile_commands.json"
build example-esp32c3 "$repo/firmware/sdk/examples/esp32-wifi" "$repo/firmware/sdk" -DIDF_TARGET=esp32c3
