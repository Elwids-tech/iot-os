#!/usr/bin/env python3
"""Validate the versioned contracts in contracts/ without relying on any runtime's serializer.

Every *.schema.json under a contracts/**/v<N>/ directory or contracts/internal/ is
checked, so a new contract directory needs no change here:

- the schema is Draft 2020-12, its $id is its path under contracts/ (assumed when
  absent), and every $ref resolves;
- <stem>.fixture.json validates against the closed schema, and every case in
  <stem>.cases.json validates as labelled (contracts/README.md, "Cases files");
- oneOf branches are told apart by a const every branch requires, or by disjoint
  types, so tolerant readers cannot match a different branch;
- values of properties marked "$comment": "secret" start with "placeholder-";
- every catalogue entry (contracts/**/catalogue.json) has its schema, fixture,
  cases and test files that mention its id.

The repository-specific checks follow: the committed-telemetry negative cases, the
configuration profile hash, the command expiry and the pinned Sparkplug proto hash.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

from jsonschema import Draft202012Validator, FormatChecker, ValidationError, validators
from jsonschema.exceptions import SchemaError, best_match
from referencing import Registry
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012

REPOSITORY = pathlib.Path(__file__).resolve().parents[1]
DIALECT = "https://json-schema.org/draft/2020-12/schema"
ID_BASE = "https://iot-os.local/contracts/"
CATALOGUE_SCHEMA = "internal/catalogue.schema.json"
VERSION_DIRECTORY = re.compile(r"v[0-9]+")
# Errors tolerant readers drop (FR-030). Only the boolean `false` form is an unknown-field rule.
TOLERATED = frozenset({"additionalProperties", "unevaluatedProperties"})
# A schema made only of these keys holds shared definitions and needs no examples.
DEFINITION_KEYS = frozenset({"$schema", "$id", "$comment", "title", "description", "$defs"})
# Under these keywords the keys are names, not keywords.
NAMED_CHILDREN = frozenset({"properties", "patternProperties", "$defs", "dependentSchemas"})
# Under these keywords the values are data, not schemas.
DATA_KEYWORDS = frozenset({"const", "enum", "examples", "default"})
CASE_KEYS = frozenset({"description", "valid", "data", "error", "tolerant_valid"})
ERROR_KEYS = frozenset({"keyword", "instance_location", "code"})
PLACEHOLDER = "placeholder-"
FORMATS = FormatChecker()


def _ignore_false(keyword):
    original = Draft202012Validator.VALIDATORS[keyword]

    def check(validator, value, instance, schema):
        if value is not False:
            yield from original(validator, value, instance, schema)

    return check


def _secret(validator, value, instance, schema):
    if value == "secret" and instance is not None:
        if not (isinstance(instance, str) and instance.startswith(PLACEHOLDER)):
            yield ValidationError("secret")


# Tolerant readers ignore unknown properties; everything else is checked as written.
TolerantValidator = validators.extend(
    Draft202012Validator, {keyword: _ignore_false(keyword) for keyword in TOLERATED}
)
# Reports values at secret-marked locations that are not placeholders.
SecretValidator = validators.extend(Draft202012Validator, {"$comment": _secret})


def pointer(path):
    return "".join("/" + str(part).replace("~", "~0").replace("/", "~1") for part in path)


def shorten(text, limit=200):
    return text if len(text) <= limit else text[: limit - 3] + "..."


def describe(error):
    text = f"{pointer(error.absolute_path) or '(root)'}: {shorten(error.message)} [{error.validator}]"
    if error.context:
        closest = best_match(error.context)
        text += f"; closest: {pointer(closest.absolute_path) or '(root)'}: {shorten(closest.message)} [{closest.validator}]"
    return text


def contains(error, keyword, location):
    if error.validator == keyword and pointer(error.absolute_path) == location:
        return True
    return any(contains(child, keyword, location) for child in error.context)


def walk(node, at="", names=False):
    """Yield (pointer, schema object) for every schema object in a schema document."""
    if isinstance(node, dict):
        if not names:
            yield at, node
        for key, value in node.items():
            if not names and key in DATA_KEYWORDS:
                continue
            child = f"{at}/{pointer([key])[1:]}"
            yield from walk(value, child, names=not names and key in NAMED_CHILDREN)
    elif isinstance(node, list) and not names:
        for index, value in enumerate(node):
            yield from walk(value, f"{at}/{index}")


class Report:
    def __init__(self, root):
        self.root = root
        self.errors = []
        self.directories = defaultdict(Counter)
        self.catalogued = 0

    def where(self, path):
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return str(path)

    def fail(self, path, message):
        self.errors.append(f"{self.where(path)}: {message}")

    def read_json(self, path):
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            self.fail(path, "missing")
        except (OSError, ValueError) as error:
            self.fail(path, f"not valid JSON: {error}")
        return None

    def lines(self):
        for directory in sorted(self.directories):
            counts = self.directories[directory]
            parts = []
            for key, singular in (("schemas", "schema"), ("fixtures", "fixture"), ("cases files", "cases file")):
                if counts[key]:
                    parts.append(f"{counts[key]} {singular if counts[key] == 1 else key}")
            if counts["cases files"]:
                parts[-1] += f" ({counts['cases']} cases)"
            if "catalogue" in counts:
                entries = counts["catalogue"]
                parts.append(f"catalogue with {entries} {'entry' if entries == 1 else 'entries'}")
            yield f"{directory}: {', '.join(parts)}"

    def summary(self):
        domains = Counter()
        for directory, counts in self.directories.items():
            domains[directory.split("/")[0]] += counts["schemas"]
        listed = ", ".join(f"{domains[name]} {name}" for name in sorted(domains))
        return f"PASS {listed} schemas, {self.catalogued} catalogued contracts and pinned official Sparkplug definition"


class Contract:
    def __init__(self, path, contracts):
        self.path = path
        self.relative = path.relative_to(contracts).as_posix()
        self.directory = path.parent.relative_to(contracts).as_posix()
        self.stem = path.name.removesuffix(".schema.json")
        self.fixture = path.with_name(self.stem + ".fixture.json")
        self.cases = path.with_name(self.stem + ".cases.json")
        self.expected_id = ID_BASE + self.relative
        self.schema = None

    @property
    def id(self):
        return self.schema["$id"]

    @property
    def definitions_only(self):
        return set(self.schema) <= DEFINITION_KEYS


def checked_directory(parts):
    return bool(parts) and (parts[0] == "internal" or any(VERSION_DIRECTORY.fullmatch(part) for part in parts))


def default_reading(relative):
    """Schemas no catalogue lists are read tolerantly, except the strict envelope family."""
    return "strict" if relative.startswith("ingestion/") else "tolerant"


class Checker:
    def __init__(self, root):
        self.root = root
        self.contracts_root = root / "contracts"
        self.report = Report(root)
        self.contracts = []
        self.by_relative = {}
        self.registry = Registry()
        self.readings = {}
        self.case_counts = {}

    # Discovery and schemas

    def discover(self):
        for path in sorted(self.contracts_root.rglob("*.schema.json")):
            if checked_directory(path.parent.relative_to(self.contracts_root).parts):
                self.contracts.append(Contract(path, self.contracts_root))
            else:
                self.report.fail(path, "schemas live under a v<N>/ directory or contracts/internal/, where this checker finds them")
        stems = {(contract.path.parent, contract.stem) for contract in self.contracts}
        for path in sorted(self.contracts_root.rglob("*.cases.json")):
            stem = path.name.removesuffix(".cases.json")
            if (path.parent, stem) not in stems:
                self.report.fail(path, f"no {stem}.schema.json in a checked directory beside this cases file")

    def load(self, contract):
        schema = self.report.read_json(contract.path)
        if schema is None:
            return False
        if not isinstance(schema, dict):
            self.report.fail(contract.path, "a schema is a JSON object")
            return False
        if schema.get("$schema") != DIALECT:
            self.report.fail(contract.path, f"$schema must be {DIALECT}")
        declared = schema.get("$id")
        if declared is None:
            schema = {**schema, "$id": contract.expected_id}
        elif declared != contract.expected_id:
            self.report.fail(contract.path, f"$id is {declared!r}; it must be {contract.expected_id!r}, its path under contracts/")
        try:
            Draft202012Validator.check_schema(schema)
        except SchemaError as error:
            self.report.fail(contract.path, f"not a valid Draft 2020-12 schema: {describe(error)}")
            return False
        # Validate without $schema: jsonschema picks the validator class from a referenced
        # document's $schema, which would drop the tolerant and secret rules across files.
        # Every contract is 2020-12 (checked above), so nothing else changes.
        contract.schema = {key: value for key, value in schema.items() if key != "$schema"}
        return True

    def load_schemas(self):
        loaded, ids = [], {}
        for contract in self.contracts:
            if not self.load(contract):
                continue
            if contract.id in ids:
                self.report.fail(contract.path, f"$id {contract.id!r} is also used by contracts/{ids[contract.id]}")
                continue
            ids[contract.id] = contract.relative
            loaded.append(contract)
            self.by_relative[contract.relative] = contract
        self.contracts = loaded
        self.registry = Registry().with_resources(
            (contract.id, DRAFT202012.create_resource(contract.schema)) for contract in loaded
        )

    def check_refs(self, contract):
        resolver = self.registry.resolver(base_uri=contract.id)
        for at, node in walk(contract.schema):
            reference = node.get("$ref")
            if isinstance(reference, str):
                try:
                    resolver.lookup(reference)
                except Unresolvable:
                    self.report.fail(contract.path, f"#{at}: $ref {reference!r} does not resolve")

    # oneOf rule

    def _pieces(self, schema, resolver, depth=0):
        if depth > 16 or not isinstance(schema, dict):
            return []
        pieces = [schema]
        if isinstance(schema.get("$ref"), str):
            try:
                resolved = resolver.lookup(schema["$ref"])
            except Unresolvable:
                pass  # reported by check_refs
            else:
                pieces += self._pieces(resolved.contents, resolved.resolver, depth + 1)
        for member in schema.get("allOf", []):
            pieces += self._pieces(member, resolver, depth + 1)
        return pieces

    def _facts(self, branch, resolver):
        pieces = self._pieces(branch, resolver)
        types = own = None
        for piece in pieces:
            if "type" in piece:
                declared = type_set(piece["type"])
                types = declared if types is None else types & declared
            values = allowed_values(piece)
            if values is not None:
                own = values if own is None else [value for value in own if contains_value(values, value)]
        if types is None and own is not None:
            types = type_set([json_type(value) for value in own])
        required = set()
        for piece in pieces:
            required.update(name for name in piece.get("required", []) if isinstance(name, str))
        consts = {}
        for piece in pieces:
            for name, subschema in (piece.get("properties") or {}).items():
                values = allowed_values(subschema) if isinstance(subschema, dict) else None
                if values is not None and name in required:
                    consts[name] = values if name not in consts else [v for v in consts[name] if contains_value(values, v)]
        return types, own, consts

    def check_one_of(self, contract):
        resolver = self.registry.resolver(base_uri=contract.id)
        for at, node in walk(contract.schema):
            branches = node.get("oneOf")
            if not isinstance(branches, list):
                continue
            facts = [self._facts(branch, resolver) for branch in branches]
            clashes = [
                f"{first} and {second}"
                for first in range(len(facts))
                for second in range(first + 1, len(facts))
                if not distinguishable(facts[first], facts[second])
            ]
            if clashes:
                self.report.fail(
                    contract.path,
                    f"#{at}/oneOf: branches {', '.join(clashes)} are not told apart by a const property every branch "
                    "requires, or by disjoint types, so a tolerant reader could match more than one",
                )

    # Catalogues

    def load_catalogues(self):
        paths = sorted(self.contracts_root.rglob("catalogue.json"))
        if not paths:
            return []
        meta = self.by_relative.get(CATALOGUE_SCHEMA)
        if meta is None:
            for path in paths:
                self.report.fail(path, f"contracts/{CATALOGUE_SCHEMA} is missing, so this catalogue cannot be checked")
            return []
        validator = Draft202012Validator(meta.schema, registry=self.registry, format_checker=FORMATS)
        entries = []
        for path in paths:
            counts = self.report.directories[path.parent.relative_to(self.contracts_root).as_posix()]
            counts.setdefault("catalogue", 0)
            catalogue = self.report.read_json(path)
            if catalogue is None:
                continue
            rejected, whole = set(), False
            for error in validator.iter_errors(catalogue):
                self.report.fail(path, describe(error))
                if error.absolute_path and isinstance(error.absolute_path[0], int):
                    rejected.add(error.absolute_path[0])
                else:
                    whole = True
            if whole:
                continue
            counts["catalogue"] += len(catalogue)
            for index, item in enumerate(catalogue):
                if index not in rejected:
                    entries.append((path, item))
                    self.readings.setdefault(item["schema"], item["reading"])
        return entries

    def check_entries(self, entries):
        seen = {}
        for path, item in entries:
            identifier = item["id"]
            if identifier in seen:
                self.report.fail(path, f"{identifier}: listed more than once (also in {seen[identifier]})")
            else:
                seen[identifier] = self.report.where(path)
            contract = self.by_relative.get(item["schema"])
            if contract is None:
                self.report.fail(path, f"{identifier}: schema contracts/{item['schema']} does not exist or did not load")
            else:
                self.check_entry_files(path, identifier, item, contract)
            for key in ("producer_tests", "consumer_tests"):
                for test in item[key]:
                    target = self.root / test
                    if not target.is_file():
                        self.report.fail(path, f"{identifier}: {key} file {test} does not exist")
                    elif identifier not in target.read_text(errors="replace"):
                        self.report.fail(path, f"{identifier}: {key} file {test} does not mention {identifier!r}")
            self.report.catalogued += 1

    def check_entry_files(self, path, identifier, item, contract):
        domain = item["schema"].split("/")[0]
        if domain in ("internal", "ingestion") and contract.stem != identifier:
            self.report.fail(path, f"{identifier}: schema file stem is {contract.stem!r}; under {domain}/ the stem is the contract id")
        if not contract.fixture.exists():
            self.report.fail(path, f"{identifier}: no fixture {self.report.where(contract.fixture)}")
        if not contract.cases.exists():
            self.report.fail(path, f"{identifier}: no cases file {self.report.where(contract.cases)}")
            return
        valid, invalid = self.case_counts.get(contract.relative, (0, 0))
        if not valid:
            self.report.fail(path, f"{identifier}: {self.report.where(contract.cases)} needs at least one valid case")
        if not invalid:
            self.report.fail(
                path,
                f"{identifier}: {self.report.where(contract.cases)} needs at least one invalid case "
                "(tolerant_valid cases do not count)",
            )

    # Examples

    def validators_for(self, contract):
        return tuple(
            kind(contract.schema, registry=self.registry, format_checker=FORMATS)
            for kind in (Draft202012Validator, TolerantValidator, SecretValidator)
        )

    def errors(self, validator, instance, path, label):
        try:
            return sorted(validator.iter_errors(instance), key=lambda error: (pointer(error.absolute_path), error.validator))
        except Unresolvable as error:
            self.report.fail(path, f"{label}validation could not resolve a $ref: {error}")
            return []

    def check_secrets(self, validator, instance, path, label=""):
        stack, leaks = list(self.errors(validator, instance, path, label)), set()
        while stack:
            error = stack.pop()
            if error.validator == "$comment":
                leaks.add(pointer(error.absolute_path))
            stack.extend(error.context)
        for leak in sorted(leaks):
            self.report.fail(path, f"{label}{leak or '(root)'}: a secret field holds a value that does not start with {PLACEHOLDER!r}")

    def check_fixture(self, contract, strict, secret):
        counts = self.report.directories[contract.directory]
        if not contract.fixture.exists():
            if not contract.definitions_only:
                self.report.fail(contract.path, f"no fixture: add {contract.fixture.name} with one realistic valid instance")
            return
        counts["fixtures"] += 1
        instance = self.report.read_json(contract.fixture)
        if instance is None:
            return
        for error in self.errors(strict, instance, contract.fixture, ""):
            self.report.fail(contract.fixture, describe(error))
        self.check_secrets(secret, instance, contract.fixture)

    def check_cases(self, contract, strict, tolerant, secret):
        if not contract.cases.exists():
            return
        counts = self.report.directories[contract.directory]
        counts["cases files"] += 1
        cases = self.report.read_json(contract.cases)
        if cases is None:
            return
        if not isinstance(cases, list):
            self.report.fail(contract.cases, "a cases file is an array of {description, valid, data} objects")
            return
        reading = self.readings.get(contract.relative, default_reading(contract.relative))
        valid = invalid = 0
        for index, case in enumerate(cases):
            counts["cases"] += 1
            if not isinstance(case, dict):
                self.report.fail(contract.cases, f"case {index}: a case is an object")
                continue
            label = f'case {index} "{case.get("description", "")}": '
            problem = case_shape_problem(case)
            if problem:
                self.report.fail(contract.cases, label + problem)
                continue
            self.check_secrets(secret, case["data"], contract.cases, label)
            if case["valid"]:
                valid += 1
                for error in self.errors(strict, case["data"], contract.cases, label):
                    self.report.fail(contract.cases, f"{label}labelled valid, but {describe(error)}")
                continue
            if not case.get("tolerant_valid"):
                invalid += 1
            self.check_invalid_case(contract, case, label, reading, strict, tolerant)
        self.case_counts[contract.relative] = (valid, invalid)

    def check_invalid_case(self, contract, case, label, reading, strict, tolerant):
        expected, path = case["error"], contract.cases
        strict_errors = self.errors(strict, case["data"], path, label)
        if "keyword" not in expected:
            if reading != "strict":
                self.report.fail(path, f"{label}reader codes are only for strict contracts; name error.keyword and error.instance_location")
            elif strict_errors:
                self.report.fail(path, f"{label}a reader-code case must be valid against the schema, but {describe(strict_errors[0])}")
            return
        keyword, location = expected["keyword"], expected["instance_location"]
        want = f"{keyword} at {location or '(root)'}"
        if not strict_errors:
            self.report.fail(path, f"{label}should fail on {want}, but it is valid")
            return
        unexpected = [error for error in strict_errors if not contains(error, keyword, location)]
        if unexpected:
            found = "also fails" if len(unexpected) < len(strict_errors) else "fails instead"
            self.report.fail(path, f"{label}should fail only on {want}, but it {found} on {describe(unexpected[0])}")
        if case.get("tolerant_valid"):
            if keyword not in TOLERATED:
                self.report.fail(path, f"{label}a tolerant_valid case fails on additionalProperties or unevaluatedProperties, not {keyword}")
            for error in self.errors(tolerant, case["data"], path, label):
                self.report.fail(path, f"{label}tolerant readers should accept it, but {describe(error)}")
        elif reading == "tolerant":
            if keyword in TOLERATED:
                self.report.fail(path, f"{label}tolerant readers ignore unknown fields; mark the case \"tolerant_valid\": true")
            elif not self.errors(tolerant, case["data"], path, label):
                self.report.fail(path, f"{label}tolerant readers accept it; an invalid case must fail for them too")

    # Repository-specific checks kept from the original script

    def check_repository(self):
        for contract in self.contracts:
            if contract.relative.startswith("events/"):
                self.check_committed_negatives(contract)
        self.fact(
            "devices/v1/configuration.fixture.json",
            "profile_hash is not the SHA-256 of profile_canonical_json",
            lambda configuration: hashlib.sha256(configuration["profile_canonical_json"].encode()).hexdigest()
            == configuration["profile_hash"],
        )
        self.fact(
            "devices/v1/command.fixture.json",
            "expires_at must be 30 seconds after confirmed_at",
            lambda command: (
                datetime.fromisoformat(command["expires_at"]) - datetime.fromisoformat(command["confirmed_at"])
            ).total_seconds()
            == 30,
        )
        proto = self.contracts_root / "sparkplug/sparkplug_b.proto"
        self.fact(
            "sparkplug/upstream.json",
            "the SHA-256 of contracts/sparkplug/sparkplug_b.proto differs from this pin",
            lambda upstream: proto.is_file() and hashlib.sha256(proto.read_bytes()).hexdigest() == upstream["sha256"],
        )

    def fact(self, relative, message, holds):
        path = self.contracts_root / relative
        value = self.report.read_json(path)
        if value is None:
            return
        try:
            ok = holds(value)
        except (KeyError, TypeError, ValueError) as error:
            self.report.fail(path, f"{message} (could not check: {error!r})")
            return
        if not ok:
            self.report.fail(path, message)

    def check_committed_negatives(self, contract):
        if not contract.fixture.exists():
            return
        fixture = self.report.read_json(contract.fixture)
        if not isinstance(fixture, dict):
            return
        validator = Draft202012Validator(contract.schema, registry=self.registry, format_checker=FORMATS)
        mutations = [(f"a {name!r} property", {**fixture, name: {}}) for name in ("definition", "session_id", "broker_credentials")]
        mutations += [("a 'sequence' property", {**fixture, "sequence": 1}), ("empty 'readings'", {**fixture, "readings": []})]
        for what, instance in mutations:
            if validator.is_valid(instance):
                self.report.fail(contract.path, f"accepts its fixture with {what}; committed events must refuse it")

    # Entry points

    def run(self, repository=True):
        self.discover()
        self.load_schemas()
        for contract in self.contracts:
            self.report.directories[contract.directory]["schemas"] += 1
            self.check_refs(contract)
            self.check_one_of(contract)
        entries = self.load_catalogues()
        for contract in self.contracts:
            strict, tolerant, secret = self.validators_for(contract)
            self.check_fixture(contract, strict, secret)
            self.check_cases(contract, strict, tolerant, secret)
        self.check_entries(entries)
        if repository:
            self.check_repository()
        return self.report


def case_shape_problem(case):
    unknown = set(case) - CASE_KEYS
    if unknown:
        return f"unknown keys {sorted(unknown)}; a case has {sorted(CASE_KEYS)}"
    if not isinstance(case.get("description"), str) or not case["description"]:
        return "needs a description"
    if not isinstance(case.get("valid"), bool):
        return "needs valid: true or false"
    if "data" not in case:
        return "needs data"
    if "tolerant_valid" in case and not isinstance(case["tolerant_valid"], bool):
        return "tolerant_valid is true or false"
    expected = case.get("error")
    if case["valid"]:
        if expected is not None or case.get("tolerant_valid"):
            return "a valid case has no error and no tolerant_valid"
        return None
    if not isinstance(expected, dict) or set(expected) - ERROR_KEYS:
        return "an invalid case names the error it fails on: {keyword, instance_location} or a reader {code}"
    if ("keyword" in expected) != ("instance_location" in expected):
        return "error.keyword and error.instance_location go together"
    if "keyword" in expected:
        location = expected["instance_location"]
        if not isinstance(expected["keyword"], str) or not isinstance(location, str) or not (location == "" or location.startswith("/")):
            return "error.keyword is a JSON Schema keyword and error.instance_location a JSON Pointer (\"\" for the root)"
    elif not isinstance(expected.get("code"), str):
        return "an invalid case names the error it fails on: {keyword, instance_location} or a reader {code}"
    if case.get("tolerant_valid") and "keyword" not in expected:
        return "a tolerant_valid case names the unknown-field keyword and location"
    return None


def type_set(declared):
    names = {declared} if isinstance(declared, str) else set(declared)
    if "number" in names:
        names.add("integer")
    return names


def json_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    return "array" if isinstance(value, list) else "object"


def allowed_values(schema):
    if "const" in schema:
        return [schema["const"]]
    if isinstance(schema.get("enum"), list):
        return list(schema["enum"])
    return None


def same_value(first, second):
    return json_type(first) == json_type(second) and first == second


def contains_value(values, value):
    return any(same_value(value, other) for other in values)


def distinguishable(first, second):
    first_types, first_own, first_consts = first
    second_types, second_own, second_consts = second
    if first_types is not None and second_types is not None and not first_types & second_types:
        return True
    if first_own is not None and second_own is not None and not any(contains_value(second_own, v) for v in first_own):
        return True
    return any(
        not any(contains_value(second_consts[name], value) for value in first_consts[name])
        for name in first_consts.keys() & second_consts.keys()
    )


def check_contracts(root):
    """The generic contract rules only (no repository-specific files needed)."""
    return Checker(pathlib.Path(root)).run(repository=False)


def check(root):
    return Checker(pathlib.Path(root)).run(repository=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate the versioned contracts in contracts/.")
    parser.add_argument("--root", type=pathlib.Path, default=REPOSITORY, help="repository root (default: this checkout)")
    arguments = parser.parse_args(argv)
    report = check(arguments.root.resolve())
    for line in report.lines():
        print(line)
    sys.stdout.flush()
    if report.errors:
        for error in report.errors:
            print(f"FAIL {error}", file=sys.stderr)
        print(f"FAIL {len(report.errors)} contract problem(s)", file=sys.stderr)
        return 1
    print(report.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
