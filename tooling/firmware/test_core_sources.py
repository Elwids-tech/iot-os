import json
import os
import tempfile
import unittest

from core_sources import core_sources


class CoreSourcesTest(unittest.TestCase):
    def test_lists_the_core_files_under_the_sdk_relative_and_sorted(self):
        with tempfile.TemporaryDirectory() as folder:
            sdk = os.path.join(folder, "starter", "sdk")
            commands = os.path.join(folder, "compile_commands.json")
            entries = [
                {"directory": folder, "file": os.path.join(sdk, "src", "session.c")},
                {"directory": os.path.join(folder, "build"), "file": "../starter/sdk/src/codec.c"},
                {"directory": folder, "file": os.path.join(sdk, "third_party/coreMQTT/source/core_mqtt.c")},
                {"directory": folder, "file": os.path.join(sdk, "ports/esp-idf/stream.c")},
                {"directory": folder, "file": os.path.join(folder, "starter", "main", "main.c")},
                {"directory": folder, "file": "/opt/esp/idf/components/sdk/src/other.c"},
                {"directory": folder, "file": os.path.join(sdk, "src", "session.c")},
            ]
            with open(commands, "w", encoding="utf-8") as handle:
                json.dump(entries, handle)

            self.assertEqual(
                core_sources(commands, sdk),
                ["src/codec.c", "src/session.c", "third_party/coreMQTT/source/core_mqtt.c"],
            )


if __name__ == "__main__":
    unittest.main()
