#!/usr/bin/env python3
"""Deterministic committed GPS inputs; no credentials, network, or device actions."""
import argparse
import copy
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID


def identity(n):
    return str(UUID(int=n, version=4))


def scenarios(interval_seconds=30, accuracy_metres=5.0):
    if not 1 <= interval_seconds <= 3600:
        raise ValueError("interval must be between 1 and 3600 seconds")
    if not 0 <= accuracy_metres <= 100000:
        raise ValueError("accuracy must be finite and between 0 and 100000 metres")
    origin = datetime(2026, 9, 25, tzinfo=timezone.utc)

    def stamp(seconds):
        return (origin + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")

    binding = {
        "schema_version": "location-binding.v1", "uuid": identity(1), "revision": 1,
        "organization_uuid": identity(2), "device_uuid": identity(3),
        "configuration_uuid": identity(4), "generation": 1,
        "latitude_parameter_uuid": identity(5), "longitude_parameter_uuid": identity(6),
        "accuracy_parameter_uuid": identity(7), "pairing": "same_event",
        "max_age_seconds": interval_seconds * 3, "max_future_skew_seconds": 5,
        "allow_unknown_accuracy": True,
    }
    result = []

    def case(name, latitude=51.0, longitude=-114.0, reason="eligible"):
        i = len(result) + 1
        event = {
            "schema_version": "telemetry.committed.v1", "event_id": identity(100 + i),
            "telemetry_id": identity(100 + i), "sequence": str(i),
            "organization_uuid": binding["organization_uuid"], "device_uuid": binding["device_uuid"],
            "configuration_uuid": binding["configuration_uuid"], "generation": 1,
            "readings": [],
        }
        for parameter, key, unit, value in [(5, "location.latitude", "deg", latitude),
                                           (6, "location.longitude", "deg", longitude),
                                           (7, "location.accuracy", "m", accuracy_metres)]:
            event["readings"].append({
                "parameter_uuid": identity(parameter), "key": key, "data_type": "number",
                "unit": unit, "value": value, "quality": "good",
                "observed_at": stamp(i * interval_seconds), "received_at": stamp(i * interval_seconds + 1),
                "timestamp_source": "source", "historical": False,
            })
        c = {"name": name, "binding": copy.deepcopy(binding), "event": event,
             "evaluated_at": stamp(i * interval_seconds + 2),
             "expected": {"status": "valid" if reason in ("eligible", "historical") else "unknown",
                          "reason": reason, "live_eligible": reason == "eligible"}}
        result.append(c)
        return c

    case("inside")
    case("outside", latitude=51.02)
    case("boundary", latitude=51.01)
    case("jitter_inside", latitude=51.00999)
    case("jitter_outside", latitude=51.01001)
    case("reentry")
    c = case("no_fix", reason="invalid_quality")
    for r in c["event"]["readings"][:2]:
        r.update(value=None, quality="invalid", diagnostic="no GPS fix")
    c = case("missing_longitude", reason="incomplete_fix")
    c["event"]["readings"].pop(1)
    c = case("split_timestamp", reason="incoherent_fix")
    c["event"]["readings"][1]["observed_at"] = stamp(1)
    c = case("stale", reason="stale_fix")
    c["evaluated_at"] = stamp(len(result) * interval_seconds + binding["max_age_seconds"] + 2)
    c = case("delayed", reason="stale_fix")
    for r in c["event"]["readings"]:
        r["observed_at"] = stamp(0)
    c = case("historical", reason="historical")
    for r in c["event"]["readings"]:
        r.update(historical=True, observed_at=stamp(0))
    for name, source in [("receipt_fallback", "receipt"), ("corrected_clock", "corrected_future"), ("derived_position", "derived"), ("legacy_time", None)]:
        c = case(name, reason="untrusted_time")
        for r in c["event"]["readings"]:
            if source is None:
                del r["timestamp_source"]
            else:
                r["timestamp_source"] = source
    c = case("future_clock", reason="future_time")
    for r in c["event"]["readings"]:
        r["observed_at"] = stamp(100000)
    c = case("unknown_accuracy")
    c["event"]["readings"].pop()
    c = case("required_accuracy", reason="accuracy_required")
    c["binding"]["allow_unknown_accuracy"] = False
    c["event"]["readings"].pop()
    c = case("bad_accuracy", reason="invalid_accuracy")
    c["event"]["readings"][-1]["value"] = -1
    c = case("wrong_units", reason="invalid_units")
    c["event"]["readings"][0]["unit"] = "rad"
    case("out_of_range", latitude=91, reason="invalid_coordinates")
    c = case("cross_tenant", reason="scope_mismatch")
    c["event"]["organization_uuid"] = identity(999)
    c = case("configuration_changed", reason="scope_mismatch")
    c["event"]["configuration_uuid"] = identity(998)
    c = case("generation_changed", reason="scope_mismatch")
    c["event"]["generation"] = 2
    case("reconnect")
    for name in ("duplicate", "runtime_restart"):
        c = copy.deepcopy(result[0]); c["name"] = name; result.append(c)
    c = case("duplicate_parameter", reason="ambiguous_parameters")
    c["event"]["readings"].append(copy.deepcopy(c["event"]["readings"][0]))
    c = case("accuracy_other_fix", reason="incoherent_accuracy")
    c["event"]["readings"][-1]["observed_at"] = stamp(0)
    return {"schema_version": "location-scenarios.v1",
            "test_parameters": {"interval_seconds": interval_seconds, "accuracy_metres": accuracy_metres},
            "reference_polygon": {"type": "Polygon", "coordinates": [[[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 51.01], [-114.01, 50.99]]]},
            "cases": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval-seconds", type=int, default=30)
    parser.add_argument("--accuracy-metres", type=float, default=5)
    parser.add_argument("--scenario", help="emit only this scenario as an internal resolver request")
    args = parser.parse_args()
    data = scenarios(args.interval_seconds, args.accuracy_metres)
    if args.scenario:
        matches = [c for c in data["cases"] if c["name"] == args.scenario]
        if not matches:
            parser.error("unknown scenario")
        data = {k: matches[0][k] for k in ("binding", "event", "evaluated_at")}
    print(json.dumps(data, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
