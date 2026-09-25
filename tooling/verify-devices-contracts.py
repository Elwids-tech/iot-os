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
for path in (root / "contracts/devices").glob("v*/*.schema.json"):
    schema = json.loads(path.read_text())
    schema["$id"] = "https://iot-os.local/contracts/devices/" + path.parent.name + "/" + path.name
    Draft202012Validator.check_schema(schema)
    schemas[path.parent.name + "/" + path.stem.removesuffix(".schema")] = schema
registry = Registry().with_resources((schema["$id"], Resource.from_contents(schema)) for schema in schemas.values())
for name, schema in schemas.items():
    instance = json.loads((root / "contracts/devices" / (name + ".fixture.json")).read_text())
    Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()).validate(instance)
event_count = 0
event_schemas = []
for path in (root / "contracts/events").glob("v*/*.schema.json"):
    event_count += 1
    schema = json.loads(path.read_text())
    event_schemas.append(schema)
    Draft202012Validator.check_schema(schema)
    fixture = json.loads(path.with_name(path.name.replace(".schema.json", ".fixture.json")).read_text())
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    validator.validate(fixture)
    for forbidden in ("definition", "session_id", "broker_credentials"):
        assert not validator.is_valid({**fixture, forbidden: {}}), forbidden
    assert not validator.is_valid({**fixture, "sequence": 1})
    assert not validator.is_valid({**fixture, "readings": []})
location_paths = list((root / "contracts/location").glob("v*/*.schema.json"))
location_schemas = [json.loads(path.read_text()) for path in location_paths]
location_registry = Registry().with_resources(
    (s["$id"], Resource.from_contents(s)) for s in event_schemas + location_schemas
)
for path, schema in zip(location_paths, location_schemas):
    Draft202012Validator.check_schema(schema)
    fixture = json.loads(path.with_name(path.name.replace(".schema.json", ".fixture.json")).read_text())
    Draft202012Validator(schema, registry=location_registry, format_checker=FormatChecker()).validate(fixture)
rule_paths = list((root / "contracts/rules").glob("v*/*.schema.json"))
rule_schemas = [json.loads(path.read_text()) for path in rule_paths]
rule_registry = Registry().with_resources(
    (s["$id"], Resource.from_contents(s)) for s in event_schemas + location_schemas + rule_schemas
)
for path, schema in zip(rule_paths, rule_schemas):
    Draft202012Validator.check_schema(schema)
    fixture = json.loads(path.with_name(path.name.replace(".schema.json", ".fixture.json")).read_text())
    Draft202012Validator(schema, registry=rule_registry, format_checker=FormatChecker()).validate(fixture)
configuration = json.loads((directory / "configuration.fixture.json").read_text())
assert hashlib.sha256(configuration["profile_canonical_json"].encode()).hexdigest() == configuration["profile_hash"]
command = json.loads((directory / "command.fixture.json").read_text())
assert (datetime.fromisoformat(command["expires_at"]) - datetime.fromisoformat(command["confirmed_at"])).total_seconds() == 30
upstream = json.loads((root / "contracts/sparkplug/upstream.json").read_text())
assert hashlib.sha256((root / "contracts/sparkplug/sparkplug_b.proto").read_bytes()).hexdigest() == upstream["sha256"]
print(f"PASS {len(schemas)} Devices, {event_count} event, {len(location_schemas)} location, {len(rule_schemas)} rule contracts and pinned official Sparkplug definition")
