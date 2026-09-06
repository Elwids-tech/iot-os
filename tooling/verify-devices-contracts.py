#!/usr/bin/env python3
"""Validate versioned contracts without relying on the runtime's serializer."""
import hashlib
import json
import pathlib
from datetime import datetime
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

root = pathlib.Path(__file__).resolve().parents[1]
directory = root / "contracts/devices/v1"
schemas = {}
for path in directory.glob("*.schema.json"):
    schema = json.loads(path.read_text())
    schema["$id"] = "https://iot-os.local/contracts/devices/v1/" + path.name
    Draft202012Validator.check_schema(schema)
    schemas[path.stem.removesuffix(".schema")] = schema
registry = Registry().with_resources((schema["$id"], Resource.from_contents(schema)) for schema in schemas.values())
for name, schema in schemas.items():
    instance = json.loads((directory / (name + ".fixture.json")).read_text())
    Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()).validate(instance)
configuration = json.loads((directory / "configuration.fixture.json").read_text())
assert hashlib.sha256(configuration["profile_canonical_json"].encode()).hexdigest() == configuration["profile_hash"]
command = json.loads((directory / "command.fixture.json").read_text())
assert (datetime.fromisoformat(command["expires_at"]) - datetime.fromisoformat(command["confirmed_at"])).total_seconds() == 30
upstream = json.loads((root / "contracts/sparkplug/upstream.json").read_text())
assert hashlib.sha256((root / "contracts/sparkplug/sparkplug_b.proto").read_bytes()).hexdigest() == upstream["sha256"]
print(f"PASS {len(schemas)} executable Devices contracts and pinned official Sparkplug definition")
