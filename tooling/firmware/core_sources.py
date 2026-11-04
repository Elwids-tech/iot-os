#!/usr/bin/env python3
"""Prints the SDK core files a build compiled, so CI can compare a board's build with the
desktop library's (spec 027 FR-013): the src/*.c and coreMQTT sources found in a
compile_commands.json under one SDK folder, relative to it, one per line, sorted.

    core_sources.py <compile_commands.json> <sdk folder>
"""

import json
import os
import re
import sys

CORE = re.compile(r"src/[^/]+\.c|third_party/coreMQTT/source/[^/]+\.c")


def core_sources(commands_path: str, sdk: str) -> list[str]:
    sdk = os.path.realpath(sdk)
    with open(commands_path, encoding="utf-8") as handle:
        entries = json.load(handle)
    found = set()
    for entry in entries:
        path = os.path.realpath(os.path.join(entry.get("directory", ""), entry["file"]))
        relative = os.path.relpath(path, sdk)
        if CORE.fullmatch(relative):
            found.add(relative)
    return sorted(found)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print("\n".join(core_sources(sys.argv[1], sys.argv[2])))
