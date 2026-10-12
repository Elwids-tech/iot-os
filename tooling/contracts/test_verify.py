"""Unit tests for tooling/verify-devices-contracts.py.

Each test builds a small contracts tree in a temporary directory, so the rules are
proven independently of the repository's contracts. The last group copies the real
contracts to prove the repository-specific checks still run.
"""
import importlib.util
import io
import json
import pathlib
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

REPOSITORY = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "verify_devices_contracts", REPOSITORY / "tooling/verify-devices-contracts.py"
)
verify = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verify)

DIALECT = "https://json-schema.org/draft/2020-12/schema"


def schema(path, **body):
    return {"$schema": DIALECT, "$id": "https://iot-os.local/contracts/" + path, **body}


def counter_schema(path, **extra):
    """A closed object with a required integer `count` and an optional `note`."""
    return schema(
        path,
        type="object",
        properties={"count": {"type": "integer", "minimum": 0}, "note": {"type": "string"}},
        required=["count"],
        additionalProperties=False,
        **extra,
    )


def entry(contract_id, schema_path, **changes):
    value = {
        "id": contract_id,
        "group": "event",
        "schema": schema_path,
        "producer": "runtime",
        "consumer": "control_plane",
        "dedup": "uuid",
        "fences": ["generation"],
        "reading": "tolerant",
        "live_check": "control_plane:events",
        "producer_tests": ["services/runtime/producer_test.go"],
        "consumer_tests": ["apps/api/tests/ConsumerTest.php"],
    }
    value.update(changes)
    return value


VALID = {"description": "a count", "valid": True, "data": {"count": 1}}
MISSING_COUNT = {
    "description": "missing count",
    "valid": False,
    "error": {"keyword": "required", "instance_location": ""},
    "data": {},
}


class Tree:
    """A throwaway repository root with a contracts/ directory."""

    def __init__(self, test):
        directory = tempfile.TemporaryDirectory()
        test.addCleanup(directory.cleanup)
        self.root = pathlib.Path(directory.name)
        (self.root / "contracts").mkdir()

    def json(self, path, value):
        target = self.root / "contracts" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, indent=2) + "\n")

    def text(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)

    def contract(self, stem, body, fixture, cases=None):
        self.json(stem + ".schema.json", body)
        if fixture is not None:
            self.json(stem + ".fixture.json", fixture)
        if cases is not None:
            self.json(stem + ".cases.json", cases)

    def catalogue_schema(self):
        """The repository's catalogue schema with its examples, so they are checked here too."""
        for name in ("catalogue.schema.json", "catalogue.fixture.json", "catalogue.cases.json"):
            source = REPOSITORY / "contracts/internal" / name
            self.json("internal/" + name, json.loads(source.read_text()))

    def errors(self):
        return verify.check_contracts(self.root).errors


class Discovery(unittest.TestCase):
    def test_finds_schemas_in_versioned_and_internal_directories(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/thing.schema.json"), {"count": 1})
        tree.contract("beta/nested/v2/other", counter_schema("beta/nested/v2/other.schema.json"), {"count": 2})
        tree.contract(
            "internal/control/thing.changed.v1",
            counter_schema("internal/control/thing.changed.v1.schema.json"),
            {"count": 3},
        )
        report = verify.check_contracts(tree.root)
        self.assertEqual([], report.errors)
        self.assertEqual(
            {"alpha/v1", "beta/nested/v2", "internal/control"},
            {name for name, counts in report.directories.items() if counts["schemas"]},
        )

    def test_validates_a_fixture_in_a_new_directory_without_a_script_change(self):
        tree = Tree(self)
        tree.contract(
            "internal/events/thing.counted.v1",
            counter_schema("internal/events/thing.counted.v1.schema.json"),
            {"count": "three"},
        )
        [error] = tree.errors()
        self.assertIn("contracts/internal/events/thing.counted.v1.fixture.json", error)
        self.assertIn("/count", error)
        self.assertIn("type", error)

    def test_a_missing_required_field_is_named(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/thing.schema.json"), {"note": "x"})
        [error] = tree.errors()
        self.assertIn("contracts/alpha/v1/thing.fixture.json", error)
        self.assertIn("'count'", error)

    def test_a_schema_needs_a_fixture(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/thing.schema.json"), None)
        [error] = tree.errors()
        self.assertIn("contracts/alpha/v1/thing.schema.json", error)
        self.assertIn("fixture", error)

    def test_a_definitions_only_schema_needs_no_fixture(self):
        tree = Tree(self)
        tree.json(
            "internal/common.schema.json",
            schema("internal/common.schema.json", **{"$defs": {"uuid": {"type": "string", "format": "uuid"}}}),
        )
        self.assertEqual([], tree.errors())

    def test_a_schema_outside_a_versioned_or_internal_directory_is_refused(self):
        tree = Tree(self)
        tree.contract("loose/thing", counter_schema("loose/thing.schema.json"), {"count": 1})
        [error] = tree.errors()
        self.assertIn("contracts/loose/thing.schema.json", error)

    def test_an_id_that_does_not_match_the_path_is_refused(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/elsewhere.schema.json"), {"count": 1})
        [error] = tree.errors()
        self.assertIn("$id", error)

    def test_a_schema_without_an_id_gets_its_path_and_resolves_relative_refs(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/thing.schema.json"), {"count": 1})
        wrapper = {
            "$schema": DIALECT,
            "type": "object",
            "properties": {"thing": {"$ref": "thing.schema.json"}},
            "required": ["thing"],
            "additionalProperties": False,
        }
        tree.contract("alpha/v1/wrapper", wrapper, {"thing": {"count": -1}})
        [error] = tree.errors()
        self.assertIn("contracts/alpha/v1/wrapper.fixture.json", error)
        self.assertIn("/thing/count", error)

    def test_a_broken_ref_is_reported(self):
        tree = Tree(self)
        body = counter_schema("alpha/v1/thing.schema.json")
        body["properties"]["other"] = {"$ref": "https://iot-os.local/contracts/alpha/v1/missing.schema.json"}
        tree.contract("alpha/v1/thing", body, {"count": 1})
        errors = tree.errors()
        self.assertTrue(errors)
        self.assertTrue(any("missing.schema.json" in error for error in errors), errors)

    def test_an_orphan_cases_file_is_refused(self):
        tree = Tree(self)
        tree.json("alpha/v1/ghost.cases.json", [VALID])
        [error] = tree.errors()
        self.assertIn("contracts/alpha/v1/ghost.cases.json", error)


class Cases(unittest.TestCase):
    def check(self, cases, path="alpha/v1/thing"):
        tree = Tree(self)
        tree.contract(path, counter_schema(path + ".schema.json"), {"count": 1}, cases)
        return tree.errors()

    def test_valid_and_invalid_cases_pass_as_labelled(self):
        self.assertEqual([], self.check([VALID, MISSING_COUNT]))

    def test_a_valid_case_that_fails_is_reported(self):
        [error] = self.check([{"description": "negative", "valid": True, "data": {"count": -1}}, MISSING_COUNT])
        self.assertIn("contracts/alpha/v1/thing.cases.json", error)
        self.assertIn("negative", error)
        self.assertIn("/count", error)

    def test_an_invalid_case_that_passes_is_reported(self):
        passes = {**MISSING_COUNT, "description": "actually fine", "data": {"count": 2}}
        [error] = self.check([VALID, passes])
        self.assertIn("actually fine", error)

    def test_an_invalid_case_must_fail_on_its_declared_keyword(self):
        wrong = {**MISSING_COUNT, "description": "wrong keyword", "data": {"count": "x"}}
        [error] = self.check([VALID, wrong])
        self.assertIn("wrong keyword", error)
        self.assertIn("required", error)

    def test_an_invalid_case_must_fail_at_its_declared_location(self):
        wrong = {
            "description": "wrong location",
            "valid": False,
            "error": {"keyword": "type", "instance_location": "/note"},
            "data": {"count": "x"},
        }
        [error] = self.check([VALID, wrong])
        self.assertIn("wrong location", error)

    def test_an_invalid_case_must_not_fail_for_another_reason_too(self):
        extra = {**MISSING_COUNT, "description": "two faults", "data": {"note": 5}}
        [error] = self.check([VALID, extra])
        self.assertIn("two faults", error)

    def test_an_invalid_case_needs_an_expected_error(self):
        unnamed = {"description": "no error", "valid": False, "data": {}}
        [error] = self.check([VALID, unnamed])
        self.assertIn("no error", error)

    def test_a_tolerant_valid_case_fails_closed_and_passes_tolerant(self):
        unknown = {
            "description": "newer producer field",
            "valid": False,
            "tolerant_valid": True,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1, "added_later": True},
        }
        self.assertEqual([], self.check([VALID, MISSING_COUNT, unknown], "internal/events/thing.counted.v1"))

    def test_a_tolerant_valid_case_with_a_real_fault_is_reported(self):
        unknown = {
            "description": "unknown field and a bad count",
            "valid": False,
            "tolerant_valid": True,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": -1, "added_later": True},
        }
        errors = self.check([VALID, MISSING_COUNT, unknown], "internal/events/thing.counted.v1")
        self.assertTrue(errors)
        self.assertTrue(all("unknown field and a bad count" in error for error in errors), errors)

    def test_a_tolerant_valid_case_that_is_closed_valid_is_reported(self):
        fine = {
            "description": "nothing unknown",
            "valid": False,
            "tolerant_valid": True,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1},
        }
        [error] = self.check([VALID, MISSING_COUNT, fine], "internal/events/thing.counted.v1")
        self.assertIn("nothing unknown", error)

    def test_tolerant_reading_applies_inside_schemas_in_other_files(self):
        tree = Tree(self)
        tree.contract("alpha/v1/thing", counter_schema("alpha/v1/thing.schema.json"), {"count": 1})
        stem = "internal/events/thing.wrapped.v1"
        body = schema(
            stem + ".schema.json",
            type="object",
            properties={"thing": {"$ref": "https://iot-os.local/contracts/alpha/v1/thing.schema.json"}},
            required=["thing"],
            additionalProperties=False,
        )
        unknown = {
            "description": "newer field inside the referenced object",
            "valid": False,
            "tolerant_valid": True,
            "error": {"keyword": "additionalProperties", "instance_location": "/thing"},
            "data": {"thing": {"count": 1, "added_later": True}},
        }
        missing = {
            "description": "missing count inside the referenced object",
            "valid": False,
            "error": {"keyword": "required", "instance_location": "/thing"},
            "data": {"thing": {}},
        }
        tree.contract(stem, body, {"thing": {"count": 1}}, [unknown, missing])
        self.assertEqual([], tree.errors())

    def test_an_unknown_field_case_of_a_tolerant_contract_must_be_marked(self):
        unmarked = {
            "description": "unmarked unknown field",
            "valid": False,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1, "added_later": True},
        }
        [error] = self.check([VALID, MISSING_COUNT, unmarked], "internal/events/thing.counted.v1")
        self.assertIn("tolerant_valid", error)

    def test_an_unknown_field_case_of_a_strict_contract_is_a_plain_invalid_case(self):
        unknown = {
            "description": "unknown field",
            "valid": False,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1, "added_later": True},
        }
        self.assertEqual([], self.check([VALID, unknown], "ingestion/v1/thing.envelope.v1"))

    def test_a_reader_code_case_must_be_schema_valid(self):
        reader = {"description": "duplicate", "valid": False, "error": {"code": "duplicate_value"}, "data": {"count": 1}}
        self.assertEqual([], self.check([VALID, MISSING_COUNT, reader], "ingestion/v1/thing.envelope.v1"))
        broken = {**reader, "description": "reader code on bad data", "data": {"count": -1}}
        [error] = self.check([VALID, MISSING_COUNT, broken], "ingestion/v1/thing.envelope.v1")
        self.assertIn("reader code on bad data", error)

    def test_a_reader_code_is_only_for_strict_contracts(self):
        reader = {"description": "duplicate", "valid": False, "error": {"code": "duplicate_value"}, "data": {"count": 1}}
        [error] = self.check([VALID, MISSING_COUNT, reader], "internal/events/thing.counted.v1")
        self.assertIn("duplicate", error)

    def test_a_malformed_cases_file_is_reported(self):
        [error] = self.check({"valid": True})
        self.assertIn("contracts/alpha/v1/thing.cases.json", error)


class Catalogue(unittest.TestCase):
    STEM = "internal/events/thing.counted.v1"

    def build(self, cases=(VALID, MISSING_COUNT), fixture=True, tests=True, **changes):
        tree = Tree(self)
        tree.catalogue_schema()
        tree.contract(
            self.STEM,
            counter_schema(self.STEM + ".schema.json"),
            {"count": 1} if fixture else None,
            list(cases) if cases is not None else None,
        )
        if tests:
            tree.text("services/runtime/producer_test.go", 'AssertProduced(t, "thing.counted.v1", event)\n')
            tree.text("apps/api/tests/ConsumerTest.php", "$this->contractCases('thing.counted.v1');\n")
        tree.json("internal/catalogue.json", [entry("thing.counted.v1", self.STEM + ".schema.json", **changes)])
        return tree

    def assert_one_error(self, tree, *fragments):
        errors = tree.errors()
        self.assertEqual(1, len(errors), errors)
        for fragment in fragments:
            self.assertIn(fragment, errors[0])

    def test_a_complete_entry_passes(self):
        tree = self.build()
        report = verify.check_contracts(tree.root)
        self.assertEqual([], report.errors)
        self.assertEqual(1, report.catalogued)

    def test_an_entry_needs_its_schema(self):
        tree = self.build(schema="internal/events/thing.missing.v1.schema.json")
        errors = tree.errors()
        self.assertTrue(any("thing.counted.v1" in e and "thing.missing.v1.schema.json" in e for e in errors), errors)

    def test_an_entry_needs_a_fixture(self):
        tree = self.build(fixture=False)
        errors = tree.errors()
        self.assertTrue(any("thing.counted.v1" in e and "fixture" in e for e in errors), errors)

    def test_an_entry_needs_cases(self):
        self.assert_one_error(self.build(cases=None), "thing.counted.v1", "cases")

    def test_an_entry_needs_a_valid_case(self):
        self.assert_one_error(self.build(cases=[MISSING_COUNT]), "thing.counted.v1", "valid")

    def test_an_entry_needs_an_invalid_case(self):
        self.assert_one_error(self.build(cases=[VALID]), "thing.counted.v1", "invalid")

    def test_a_tolerant_valid_case_does_not_count_as_invalid(self):
        unknown = {
            "description": "newer producer field",
            "valid": False,
            "tolerant_valid": True,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1, "added_later": True},
        }
        self.assert_one_error(self.build(cases=[VALID, unknown]), "thing.counted.v1", "invalid")

    def test_listed_test_files_must_exist(self):
        tree = self.build(tests=False)
        errors = tree.errors()
        self.assertEqual(2, len(errors), errors)
        self.assertTrue(any("services/runtime/producer_test.go" in e for e in errors), errors)
        self.assertTrue(any("apps/api/tests/ConsumerTest.php" in e for e in errors), errors)

    def test_listed_test_files_must_mention_the_id(self):
        tree = self.build()
        tree.text("services/runtime/producer_test.go", "func TestSomethingElse(t *testing.T) {}\n")
        self.assert_one_error(tree, "thing.counted.v1", "services/runtime/producer_test.go")

    def test_an_entry_must_match_the_catalogue_schema(self):
        self.assert_one_error(self.build(group="query"), "contracts/internal/catalogue.json", "/0/group")

    def test_internal_entries_need_producer_tests(self):
        self.assert_one_error(self.build(producer_tests=[]), "/0/producer_tests")

    def test_ids_are_unique_across_catalogues(self):
        tree = self.build()
        tree.json(
            "ingestion/v1/catalogue.json",
            [entry("thing.counted.v1", self.STEM + ".schema.json", group="envelope", reading="strict")],
        )
        errors = tree.errors()
        self.assertTrue(any("thing.counted.v1" in e and "more than once" in e for e in errors), errors)

    def test_the_file_stem_must_be_the_id(self):
        tree = self.build(id="thing.renamed.v1")
        tree.text("services/runtime/producer_test.go", "thing.renamed.v1\n")
        tree.text("apps/api/tests/ConsumerTest.php", "thing.renamed.v1\n")
        self.assert_one_error(tree, "thing.renamed.v1", "stem")

    def test_the_catalogue_reading_decides_how_cases_are_judged(self):
        unknown = {
            "description": "unknown field",
            "valid": False,
            "error": {"keyword": "additionalProperties", "instance_location": ""},
            "data": {"count": 1, "added_later": True},
        }
        tolerant = self.build(cases=[VALID, MISSING_COUNT, unknown])
        self.assertTrue(any("tolerant_valid" in e for e in tolerant.errors()))
        strict = self.build(cases=[VALID, MISSING_COUNT, unknown], reading="strict")
        self.assertEqual([], strict.errors())

    def test_a_catalogue_needs_the_catalogue_schema(self):
        tree = Tree(self)
        tree.json("ingestion/v1/catalogue.json", [])
        [error] = tree.errors()
        self.assertIn("catalogue.schema.json", error)


class Secrets(unittest.TestCase):
    def build(self, password, cases=None):
        tree = Tree(self)
        body = schema(
            "internal/state/thing.state.v1.schema.json",
            type="object",
            properties={
                "connections": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/connection"},
                }
            },
            required=["connections"],
            additionalProperties=False,
            **{
                "$defs": {
                    "connection": {
                        "type": "object",
                        "properties": {
                            "username": {"type": "string"},
                            "password": {"type": ["string", "null"], "$comment": "secret"},
                        },
                        "required": ["username", "password"],
                        "additionalProperties": False,
                    }
                }
            },
        )
        fixture = {"connections": [{"username": "runtime", "password": password}]}
        tree.contract("internal/state/thing.state.v1", body, fixture, cases)
        return tree

    def test_placeholder_values_pass(self):
        self.assertEqual([], self.build("placeholder-broker-password").errors())

    def test_null_passes(self):
        self.assertEqual([], self.build(None).errors())

    def test_a_real_looking_value_fails_without_printing_it(self):
        [error] = self.build("hunter2-correct-horse").errors()
        self.assertIn("contracts/internal/state/thing.state.v1.fixture.json", error)
        self.assertIn("/connections/0/password", error)
        self.assertIn("placeholder-", error)
        self.assertNotIn("hunter2", error)

    def test_case_data_is_checked_too(self):
        cases = [
            {
                "description": "leaky case",
                "valid": True,
                "data": {"connections": [{"username": "runtime", "password": "s3cret"}]},
            }
        ]
        [error] = self.build("placeholder-x", cases).errors()
        self.assertIn("leaky case", error)
        self.assertNotIn("s3cret", error)

    def test_secret_markers_in_schemas_in_other_files_are_enforced(self):
        tree = Tree(self)
        connection = schema(
            "alpha/v1/connection.schema.json",
            type="object",
            properties={"password": {"type": "string", "$comment": "secret"}},
            required=["password"],
            additionalProperties=False,
        )
        tree.contract("alpha/v1/connection", connection, {"password": "placeholder-a"})
        snapshot = schema(
            "internal/state/thing.state.v1.schema.json",
            type="object",
            properties={"connection": {"$ref": "https://iot-os.local/contracts/alpha/v1/connection.schema.json"}},
            required=["connection"],
            additionalProperties=False,
        )
        tree.contract("internal/state/thing.state.v1", snapshot, {"connection": {"password": "letmein"}})
        [error] = tree.errors()
        self.assertIn("contracts/internal/state/thing.state.v1.fixture.json", error)
        self.assertIn("/connection/password", error)
        self.assertNotIn("letmein", error)


class OneOf(unittest.TestCase):
    def build(self, branches, extra=()):
        tree = Tree(self)
        for stem, body, fixture in extra:
            tree.contract(stem, body, fixture)
        body = schema(
            "internal/control/thing.changed.v1.schema.json",
            type="object",
            properties={"definition": {"oneOf": branches}},
            required=["definition"],
            additionalProperties=False,
        )
        tree.contract("internal/control/thing.changed.v1", body, {"definition": None})
        return tree

    @staticmethod
    def branch(version=None, required=True):
        properties = {"name": {"type": "string"}}
        if version:
            properties["schema_version"] = {"const": version}
        return {
            "type": "object",
            "properties": properties,
            "required": (["schema_version"] if version and required else []) + ["name"],
            "additionalProperties": False,
        }

    def test_branches_without_a_distinguishing_const_fail(self):
        errors = self.build([self.branch(), self.branch(), {"type": "null"}]).errors()
        self.assertEqual(1, len(errors), errors)
        self.assertIn("contracts/internal/control/thing.changed.v1.schema.json", errors[0])
        self.assertIn("/properties/definition/oneOf", errors[0])
        self.assertIn("const", errors[0])

    def test_a_const_that_is_not_required_does_not_distinguish(self):
        errors = self.build([self.branch("a.v1", required=False), self.branch("a.v2"), {"type": "null"}]).errors()
        self.assertEqual(1, len(errors), errors)

    def test_branches_told_apart_by_a_required_const_pass(self):
        self.assertEqual([], self.build([self.branch("a.v1"), self.branch("a.v2"), {"type": "null"}]).errors())

    def test_branches_told_apart_by_type_pass(self):
        self.assertEqual([], self.build([self.branch(), {"type": "null"}]).errors())

    def test_branches_are_resolved_through_refs(self):
        v1 = schema("alpha/v1/config.schema.json", **self.branch("config.v1"))
        v2 = schema("alpha/v2/config.schema.json", **self.branch("config.v2"))
        extra = [
            ("alpha/v1/config", v1, {"schema_version": "config.v1", "name": "x"}),
            ("alpha/v2/config", v2, {"schema_version": "config.v2", "name": "x"}),
        ]
        branches = [
            {"$ref": "https://iot-os.local/contracts/alpha/v1/config.schema.json"},
            {"$ref": "https://iot-os.local/contracts/alpha/v2/config.schema.json"},
            {"type": "null"},
        ]
        self.assertEqual([], self.build(branches, extra).errors())


class Repository(unittest.TestCase):
    """Runs the full checker, including the repository-specific checks, on a copy."""

    def copy(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = pathlib.Path(directory.name)
        shutil.copytree(REPOSITORY / "contracts", root / "contracts")
        return root

    def run_main(self, root):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = verify.main(["--root", str(root)])
        return status, out.getvalue() + err.getvalue()

    def test_the_repository_contracts_pass_with_per_directory_counts(self):
        status, output = self.run_main(self.copy())
        self.assertEqual(0, status, output)
        self.assertIn("PASS", output)
        for directory in ("devices/v1", "events/v1", "location/v1", "rules/v1", "ingestion/v1", "internal"):
            self.assertIn(directory, output)

    def test_the_command_expiry_check_still_runs(self):
        root = self.copy()
        path = root / "contracts/devices/v1/command.fixture.json"
        command = json.loads(path.read_text())
        command["expires_at"] = "2026-09-06T00:01:00Z"
        path.write_text(json.dumps(command))
        status, output = self.run_main(root)
        self.assertEqual(1, status)
        self.assertIn("contracts/devices/v1/command.fixture.json", output)
        self.assertIn("expires_at", output)

    def test_the_committed_event_negative_checks_still_run(self):
        root = self.copy()
        path = root / "contracts/events/v1/telemetry-committed.schema.json"
        body = json.loads(path.read_text())
        body["additionalProperties"] = True
        path.write_text(json.dumps(body))
        status, output = self.run_main(root)
        self.assertEqual(1, status)
        self.assertIn("contracts/events/v1/telemetry-committed", output)

    def test_the_profile_hash_and_sparkplug_checks_still_run(self):
        root = self.copy()
        path = root / "contracts/devices/v1/configuration.fixture.json"
        configuration = json.loads(path.read_text())
        configuration["profile_hash"] = "0" * 64
        path.write_text(json.dumps(configuration))
        with open(root / "contracts/sparkplug/sparkplug_b.proto", "a") as proto:
            proto.write("\n")
        status, output = self.run_main(root)
        self.assertEqual(1, status)
        self.assertIn("profile_hash", output)
        self.assertIn("sparkplug_b.proto", output)


if __name__ == "__main__":
    unittest.main()
