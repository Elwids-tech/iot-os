package contracts_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
)

// The repository's contracts.

func TestEveryFixtureValidatesStrictly(t *testing.T) {
	registry := contractstest.Registry(t)
	checked := 0
	for _, schemaPath := range registry.Schemas() {
		fixture := filepath.Join(registry.Root(), strings.TrimSuffix(schemaPath, ".schema.json")+".fixture.json")
		raw, err := os.ReadFile(fixture)
		if os.IsNotExist(err) {
			continue // a schema of shared $defs has no fixture; the contract checker enforces the rest
		}
		if err != nil {
			t.Fatal(err)
		}
		checked++
		t.Run(schemaPath, func(t *testing.T) {
			violations, err := registry.ValidateJSON(schemaPath, raw, contracts.Strict)
			if err != nil {
				t.Fatal(err)
			}
			if len(violations) > 0 {
				t.Fatalf("fixture does not validate:\n%s", contractstest.List(violations))
			}
		})
	}
	if checked == 0 {
		t.Fatal("no fixtures found")
	}
}

func TestEveryCaseMatchesItsVerdictInBothModes(t *testing.T) {
	registry := contractstest.Registry(t)
	files := 0
	for _, schemaPath := range registry.Schemas() {
		casesFile := filepath.Join(registry.Root(), strings.TrimSuffix(schemaPath, ".schema.json")+".cases.json")
		if _, err := os.Stat(casesFile); err != nil {
			continue
		}
		files++
		t.Run(schemaPath, func(t *testing.T) {
			for _, example := range contractstest.Cases(t, schemaPath) {
				for _, mode := range []contracts.Mode{contracts.Strict, contracts.Tolerant} {
					if problem := verdictProblem(registry, schemaPath, example, mode); problem != "" {
						t.Errorf("%s (%s): %s", example.Name, mode, problem)
					}
				}
			}
		})
	}
	if files == 0 {
		t.Fatal("no cases files found")
	}
}

// verdictProblem describes how a case's result in mode differs from its label. A
// rejected case must report the keyword and location it declares; the contract
// checker additionally requires that it fails on nothing else.
func verdictProblem(registry *contracts.Registry, reference string, example contractstest.Case, mode contracts.Mode) string {
	violations, err := registry.ValidateJSON(reference, example.Data, mode)
	if err != nil {
		return err.Error()
	}
	accepted := len(violations) == 0
	switch {
	case example.Accepted(mode) && !accepted:
		return "should be accepted, but fails on:\n" + contractstest.List(violations)
	case !example.Accepted(mode) && accepted:
		return fmt.Sprintf("should fail on %s at %q, but it is accepted", example.Error.Keyword, example.Error.InstanceLocation)
	case !accepted && !contains(violations, example.Error.Keyword, example.Error.InstanceLocation):
		return fmt.Sprintf("should fail on %s at %q, but fails on:\n%s", example.Error.Keyword, example.Error.InstanceLocation, contractstest.List(violations))
	}
	return ""
}

func contains(violations []contracts.Violation, keyword, location string) bool {
	for _, violation := range violations {
		if violation.Keyword == keyword && violation.InstanceLocation == location {
			return true
		}
	}
	return false
}

func TestCatalogueEntriesResolveWithTheirReading(t *testing.T) {
	registry := contractstest.Registry(t)
	for _, entry := range registry.Entries() {
		path, err := registry.SchemaPath(entry.ID)
		if err != nil || path != entry.Schema {
			t.Errorf("%s: schema %q, %v; want %q", entry.ID, path, err, entry.Schema)
		}
		reading, err := registry.Reading(entry.ID)
		if err != nil || reading.String() != entry.Reading {
			t.Errorf("%s: reading %s, %v; want %s", entry.ID, reading, err, entry.Reading)
		}
	}
}

func TestAssertProducedNamesTheContractKeywordLocationAndMissingField(t *testing.T) {
	entry := map[string]any{
		"id": "device.applied.v1", "group": "event", "schema": "internal/events/device.applied.v1.schema.json",
		"producer": "runtime", "consumer": "control_plane", "dedup": "uuid", "fences": []string{"generation"},
		"live_check": "control_plane:events", "producer_tests": []string{"a_test.go"}, "consumer_tests": []string{"BTest.php"},
	}
	message := failure(func(t testing.TB) {
		contractstest.AssertProduced(t, "internal/catalogue.schema.json", []any{entry})
	})
	for _, want := range []string{"internal/catalogue.schema.json", "required at /0", "missing reading"} {
		if !strings.Contains(message, want) {
			t.Fatalf("failure %q does not name %q", message, want)
		}
	}
	entry["reading"] = "tolerant"
	if message := failure(func(t testing.TB) {
		contractstest.AssertProduced(t, "internal/catalogue.schema.json", []any{entry})
	}); message != "" {
		t.Fatalf("a conforming value failed: %s", message)
	}
}

// recorder captures a helper's fatal failure instead of failing the test.
type recorder struct {
	testing.TB
	message string
}

type stopped struct{}

func (r *recorder) Helper() {}
func (r *recorder) Fatal(args ...any) {
	r.message = fmt.Sprint(args...)
	panic(stopped{})
}
func (r *recorder) Fatalf(format string, args ...any) {
	r.message = fmt.Sprintf(format, args...)
	panic(stopped{})
}

func failure(run func(testing.TB)) (message string) {
	r := &recorder{}
	defer func() {
		if value := recover(); value != nil {
			if _, ok := value.(stopped); !ok {
				panic(value)
			}
			message = r.message
		}
	}()
	run(r)
	return ""
}

// Modes and loading, on small trees built per test.

type tree struct {
	t    *testing.T
	root string
}

func newTree(t *testing.T) *tree {
	return &tree{t: t, root: t.TempDir()}
}

func (tr *tree) json(relative string, value any) {
	tr.t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		tr.t.Fatal(err)
	}
	target := filepath.Join(tr.root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		tr.t.Fatal(err)
	}
	if err := os.WriteFile(target, raw, 0o644); err != nil {
		tr.t.Fatal(err)
	}
}

func (tr *tree) load() *contracts.Registry {
	tr.t.Helper()
	registry, err := contracts.Load(tr.root)
	if err != nil {
		tr.t.Fatal(err)
	}
	return registry
}

func schemaAt(relative string, body map[string]any) map[string]any {
	body["$schema"] = contracts.Dialect
	body["$id"] = contracts.IDBase + relative
	return body
}

// counter is a closed object with a required non-negative integer count.
func counter(relative string) map[string]any {
	return schemaAt(relative, map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"count": map[string]any{"type": "integer", "minimum": 0}, "note": map[string]any{"type": "string"}},
		"required":             []string{"count"},
		"additionalProperties": false,
	})
}

func validate(t *testing.T, registry *contracts.Registry, reference, raw string, mode contracts.Mode) []contracts.Violation {
	t.Helper()
	violations, err := registry.ValidateJSON(reference, []byte(raw), mode)
	if err != nil {
		t.Fatal(err)
	}
	return violations
}

func pairs(violations []contracts.Violation) string {
	parts := make([]string, len(violations))
	for index, violation := range violations {
		parts[index] = violation.Keyword + "@" + violation.InstanceLocation
	}
	return strings.Join(parts, " ")
}

func TestStrictReportsUnknownFieldsAndTolerantIgnoresOnlyThose(t *testing.T) {
	tr := newTree(t)
	tr.json("internal/events/thing.counted.v1.schema.json", counter("internal/events/thing.counted.v1.schema.json"))
	registry := tr.load()
	id := "internal/events/thing.counted.v1.schema.json"

	if got := pairs(validate(t, registry, id, `{"count":1,"added_later":true}`, contracts.Strict)); got != "additionalProperties@" {
		t.Fatalf("strict: %s", got)
	}
	if got := validate(t, registry, id, `{"count":1,"added_later":true}`, contracts.Tolerant); len(got) != 0 {
		t.Fatalf("tolerant: %v", got)
	}
	if got := pairs(validate(t, registry, id, `{"count":-1,"added_later":true}`, contracts.Tolerant)); got != "minimum@/count" {
		t.Fatalf("tolerant must keep other errors: %s", got)
	}
	if got := pairs(validate(t, registry, id, `{}`, contracts.Tolerant)); got != "required@" {
		t.Fatalf("tolerant must keep required: %s", got)
	}
}

// The tolerant mode must re-evaluate oneOf and anyOf without the unknown-field
// rules. Filtering additionalProperties out of the strict result is not enough: the
// oneOf (and the other branch's const failure) would remain.
func TestTolerantRecomputesOneOfAndAnyOf(t *testing.T) {
	tr := newTree(t)
	branch := func(version string) map[string]any {
		return map[string]any{
			"type":                 "object",
			"properties":           map[string]any{"schema_version": map[string]any{"const": version}, "name": map[string]any{"type": "string"}},
			"required":             []string{"schema_version", "name"},
			"additionalProperties": false,
		}
	}
	relative := "internal/control/thing.changed.v1.schema.json"
	tr.json(relative, schemaAt(relative, map[string]any{
		"type": "object",
		"properties": map[string]any{
			"definition": map[string]any{"oneOf": []any{branch("thing.v1"), branch("thing.v2"), map[string]any{"type": "null"}}},
			"options":    map[string]any{"anyOf": []any{branch("options.v1"), map[string]any{"type": "string"}}},
		},
		"required":             []string{"definition"},
		"additionalProperties": false,
	}))
	registry := tr.load()

	newerField := `{"definition":{"schema_version":"thing.v2","name":"n","added_later":1},"options":{"schema_version":"options.v1","name":"o","added_later":2}}`
	strict := validate(t, registry, relative, newerField, contracts.Strict)
	for _, want := range []string{"oneOf@/definition", "additionalProperties@/definition", "anyOf@/options", "additionalProperties@/options"} {
		if !strings.Contains(" "+pairs(strict)+" ", " "+want+" ") {
			t.Fatalf("strict result %q lacks %s", pairs(strict), want)
		}
	}
	var filtered []contracts.Violation
	for _, violation := range strict {
		if !contracts.IsUnknownFieldKeyword(violation.Keyword) {
			filtered = append(filtered, violation)
		}
	}
	if len(filtered) == 0 {
		t.Fatal("this case must show that dropping leaf errors leaves the oneOf failure behind")
	}
	if got := validate(t, registry, relative, newerField, contracts.Tolerant); len(got) != 0 {
		t.Fatalf("tolerant readers must match the branch that failed only on an unknown field, got %s", pairs(got))
	}

	missingName := `{"definition":{"schema_version":"thing.v2","added_later":1}}`
	tolerant := validate(t, registry, relative, missingName, contracts.Tolerant)
	if !strings.Contains(pairs(tolerant), "oneOf@/definition") || !strings.Contains(pairs(tolerant), "required@/definition") {
		t.Fatalf("tolerant readers must still refuse a branch with a real fault, got %s", pairs(tolerant))
	}
	for _, violation := range tolerant {
		if contracts.IsUnknownFieldKeyword(violation.Keyword) {
			t.Fatalf("tolerant result reports an unknown field: %s", pairs(tolerant))
		}
	}
}

func TestTolerantReadingAppliesInsideReferencedFilesAndToUnevaluatedProperties(t *testing.T) {
	tr := newTree(t)
	tr.json("alpha/v1/thing.schema.json", counter("alpha/v1/thing.schema.json"))
	relative := "internal/events/thing.wrapped.v1.schema.json"
	tr.json(relative, schemaAt(relative, map[string]any{
		"type":                  "object",
		"properties":            map[string]any{"thing": map[string]any{"$ref": "../../alpha/v1/thing.schema.json"}},
		"required":              []string{"thing"},
		"unevaluatedProperties": false,
	}))
	registry := tr.load()
	data := `{"thing":{"count":1,"added_later":true},"extra":1}`
	if got := pairs(validate(t, registry, relative, data, contracts.Strict)); got != "unevaluatedProperties@ additionalProperties@/thing" {
		t.Fatalf("strict: %s", got)
	}
	if got := validate(t, registry, relative, data, contracts.Tolerant); len(got) != 0 {
		t.Fatalf("tolerant: %s", pairs(got))
	}
}

// Every repository schema has an $id since spec 002 T035, so the derived one is
// proved on a tree: a schema without $id is named by its path, by the $id the
// checker assumes, and by a relative $ref from another file.
func TestASchemaWithoutAnIDIsFoundByPathAndDerivedID(t *testing.T) {
	tr := newTree(t)
	anonymous := counter("alpha/v1/thing.schema.json")
	delete(anonymous, "$id")
	tr.json("alpha/v1/thing.schema.json", anonymous)
	wrapper := "internal/events/thing.wrapped.v1.schema.json"
	tr.json(wrapper, schemaAt(wrapper, map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"thing": map[string]any{"$ref": "../../alpha/v1/thing.schema.json"}},
		"required":             []string{"thing"},
		"additionalProperties": false,
	}))
	registry := tr.load()
	for _, reference := range []string{"alpha/v1/thing.schema.json", contracts.IDBase + "alpha/v1/thing.schema.json"} {
		if got := validate(t, registry, reference, `{"count":1}`, contracts.Strict); len(got) != 0 {
			t.Fatalf("%s: %s", reference, pairs(got))
		}
		if got := pairs(validate(t, registry, reference, `{}`, contracts.Strict)); got != "required@" {
			t.Fatalf("%s: %s", reference, got)
		}
	}
	if got := pairs(validate(t, registry, wrapper, `{"thing":{}}`, contracts.Strict)); got != "required@/thing" {
		t.Fatalf("a $ref to the derived id: %s", got)
	}
}

func TestOnlyTheFalseFormInSchemaPositionsIsDropped(t *testing.T) {
	tr := newTree(t)
	relative := "internal/state/thing.state.v1.schema.json"
	tr.json(relative, schemaAt(relative, map[string]any{
		"type": "object",
		"properties": map[string]any{
			// A property named like the keyword, and a const whose data looks like a schema.
			"additionalProperties": map[string]any{"const": map[string]any{"additionalProperties": false}},
			"labels":               map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
		},
		"required":             []string{"additionalProperties"},
		"additionalProperties": false,
	}))
	registry := tr.load()
	if got := validate(t, registry, relative, `{"additionalProperties":{"additionalProperties":false}}`, contracts.Tolerant); len(got) != 0 {
		t.Fatalf("const data must be untouched: %s", pairs(got))
	}
	if got := pairs(validate(t, registry, relative, `{"additionalProperties":{}}`, contracts.Tolerant)); got != "const@/additionalProperties" {
		t.Fatalf("const data must be untouched: %s", got)
	}
	if got := pairs(validate(t, registry, relative, `{"additionalProperties":{"additionalProperties":false},"labels":{"a":1}}`, contracts.Tolerant)); got != "type@/labels/a" {
		t.Fatalf("a schema-valued additionalProperties still applies: %s", got)
	}
}

func TestViolationsCarryNoValues(t *testing.T) {
	tr := newTree(t)
	relative := "internal/state/thing.secret.v1.schema.json"
	tr.json(relative, schemaAt(relative, map[string]any{
		"type": "object",
		"properties": map[string]any{
			"password": map[string]any{"type": "string", "maxLength": 3, "$comment": "secret"},
			"uuid":     map[string]any{"type": "string", "format": "uuid"},
		},
		"required":             []string{"uuid", "organization_uuid"},
		"additionalProperties": false,
	}))
	registry := tr.load()
	violations := validate(t, registry, relative, `{"password":"hunter2-placeholder","uuid":"not-a-uuid-value","sneaky-key":"leak-value"}`, contracts.Strict)
	if got := pairs(violations); got != "additionalProperties@ required@ maxLength@/password format@/uuid" {
		t.Fatalf("got %s", got)
	}
	encoded, err := json.Marshal(violations)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"hunter2", "not-a-uuid", "sneaky", "leak-value"} {
		if strings.Contains(string(encoded), value) {
			t.Fatalf("violations %s carry %q", encoded, value)
		}
	}
	if !strings.Contains(string(encoded), `"missing":["organization_uuid"]`) {
		t.Fatalf("a required violation names the missing property from the schema: %s", encoded)
	}
}

func TestReferencesResolveByCatalogueIDPathAndID(t *testing.T) {
	tr := newTree(t)
	internal := "internal/events/thing.counted.v1.schema.json"
	envelope := "ingestion/v1/thing.envelope.v1.schema.json"
	unlisted := "alpha/v1/thing.schema.json"
	for _, relative := range []string{internal, envelope, unlisted} {
		tr.json(relative, counter(relative))
	}
	tr.json("internal/catalogue.json", []map[string]any{{
		"id": "thing.counted.v1", "group": "event", "schema": internal, "producer": "runtime", "consumer": "control_plane",
		"dedup": "uuid", "fences": []string{}, "reading": "strict", "live_check": "none",
		"producer_tests": []string{"x"}, "consumer_tests": []string{"y"},
	}})
	registry := tr.load()
	for _, reference := range []string{"thing.counted.v1", internal, contracts.IDBase + internal} {
		if got := pairs(validate(t, registry, reference, `{}`, contracts.Strict)); got != "required@" {
			t.Fatalf("%s: %s", reference, got)
		}
	}
	for reference, want := range map[string]contracts.Mode{
		"thing.counted.v1": contracts.Strict, // the catalogue's reading wins
		envelope:           contracts.Strict, // ingestion/ is strict when no catalogue lists it
		unlisted:           contracts.Tolerant,
	} {
		if got, err := registry.Reading(reference); err != nil || got != want {
			t.Fatalf("%s: %s %v, want %s", reference, got, err, want)
		}
	}
	if _, err := registry.ValidateJSON("thing.missing.v1", []byte(`{}`), contracts.Strict); !errors.Is(err, contracts.ErrUnknownContract) {
		t.Fatalf("unknown id: %v", err)
	}
	if len(registry.Entries()) != 1 || len(registry.Schemas()) != 3 {
		t.Fatalf("entries %v schemas %v", registry.Entries(), registry.Schemas())
	}
}

func TestValidateEncodesGoValues(t *testing.T) {
	tr := newTree(t)
	relative := "alpha/v1/thing.schema.json"
	tr.json(relative, counter(relative))
	registry := tr.load()
	type thing struct {
		Count int64  `json:"count"`
		Note  string `json:"note,omitempty"`
	}
	for _, value := range []any{thing{Count: 9007199254740993}, json.RawMessage(`{"count":2}`), map[string]any{"count": 3}} {
		if violations, err := registry.Validate(relative, value, contracts.Strict); err != nil || len(violations) != 0 {
			t.Fatalf("%#v: %v %v", value, violations, err)
		}
	}
	if violations, _ := registry.Validate(relative, thing{Count: -1}, contracts.Strict); pairs(violations) != "minimum@/count" {
		t.Fatalf("got %s", pairs(violations))
	}
}

func TestOpenAPIAndUncheckedDirectoriesAreSkipped(t *testing.T) {
	tr := newTree(t)
	relative := "alpha/v1/thing.schema.json"
	tr.json(relative, counter(relative))
	// contracts/openapi has its own gate (php artisan contract:check); these would not compile here.
	tr.json("openapi/meta/supplement.schema.json", map[string]any{"$schema": "http://json-schema.org/draft-07/schema#", "$ref": "missing.json"})
	tr.json("definitions/loose.schema.json", map[string]any{"$ref": "missing.json"})
	registry := tr.load()
	if got := registry.Schemas(); len(got) != 1 || got[0] != relative {
		t.Fatalf("schemas %v", got)
	}
}

func TestAMissingRootYieldsADisabledRegistry(t *testing.T) {
	registry, err := contracts.Load(filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatalf("a missing root is not an error: %v", err)
	}
	if registry == nil || registry.Enabled() {
		t.Fatalf("registry %v must be disabled", registry)
	}
	if _, err := registry.ValidateJSON("device.applied.v1", []byte(`{}`), contracts.Tolerant); !errors.Is(err, contracts.ErrDisabled) {
		t.Fatalf("validate on a disabled registry: %v", err)
	}
	var none *contracts.Registry
	if none.Enabled() || none.Entries() != nil {
		t.Fatal("a nil registry is disabled")
	}
	if _, err := none.Validate("device.applied.v1", map[string]any{}, contracts.Strict); !errors.Is(err, contracts.ErrDisabled) {
		t.Fatalf("validate on a nil registry: %v", err)
	}
}

func TestABrokenContractDisablesTheRegistryWithAReason(t *testing.T) {
	tr := newTree(t)
	relative := "internal/events/thing.broken.v1.schema.json"
	tr.json(relative, schemaAt(relative, map[string]any{"$ref": "missing.schema.json"}))
	registry, err := contracts.Load(tr.root)
	if err == nil || !strings.Contains(err.Error(), relative) {
		t.Fatalf("error %v must name %s", err, relative)
	}
	if registry == nil || registry.Enabled() {
		t.Fatal("a broken contract disables the registry")
	}
}

func TestPathFromEnv(t *testing.T) {
	t.Setenv(contracts.PathEnv, "")
	if got := contracts.PathFromEnv(); got != contracts.DefaultPath {
		t.Fatalf("default %q", got)
	}
	t.Setenv(contracts.PathEnv, "/srv/contracts")
	if got := contracts.PathFromEnv(); got != "/srv/contracts" {
		t.Fatalf("configured %q", got)
	}
}
