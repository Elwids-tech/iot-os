// Package contractstest holds test helpers for the contracts in the repository's
// contracts/ directory: a strict producer assertion and the fixture and cases of a
// contract with their expected verdicts (contracts/README.md, "Cases files").
package contractstest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts"
)

// marker identifies the repository's contracts directory.
const marker = "internal/catalogue.schema.json"

var (
	loadOnce sync.Once
	loaded   *contracts.Registry
	loadErr  error
)

// Root returns the repository's contracts/ directory, found by walking up from the
// test's working directory, so tests always judge the checked-in contracts.
func Root(t testing.TB) string {
	t.Helper()
	root, err := findRoot()
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func findRoot() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(directory, "contracts")
		if _, err := os.Stat(filepath.Join(candidate, filepath.FromSlash(marker))); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", fmt.Errorf("contractstest: no contracts/%s above the working directory", marker)
		}
		directory = parent
	}
}

// Registry returns the repository's contracts, loaded once per test binary. The
// test fails if they are missing or do not compile.
func Registry(t testing.TB) *contracts.Registry {
	t.Helper()
	loadOnce.Do(func() {
		var root string
		if root, loadErr = findRoot(); loadErr == nil {
			loaded, loadErr = contracts.Load(root)
		}
	})
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if !loaded.Enabled() {
		t.Fatalf("contractstest: contracts at %s are disabled", loaded.Root())
	}
	return loaded
}

// AssertProduced fails the test unless value conforms to the contract as written
// (strict mode): what a producer sends must not carry undeclared fields. id is a
// catalogue id, a schema path under contracts/ or a schema $id. The failure names
// the contract and each failing keyword and instance location, with the missing
// property names of a required failure.
func AssertProduced(t testing.TB, id string, value any) {
	t.Helper()
	violations, err := Registry(t).Validate(id, value, contracts.Strict)
	if err != nil {
		t.Fatalf("%s: %v", id, err)
	}
	if len(violations) > 0 {
		t.Fatalf("produced value does not conform to %s:\n%s", id, List(violations))
	}
}

// List renders violations one per line.
func List(violations []contracts.Violation) string {
	lines := make([]string, len(violations))
	for index, violation := range violations {
		lines[index] = "  - " + violation.String()
	}
	return strings.Join(lines, "\n")
}

// Expected is the failure an invalid case declares: a keyword and instance
// location, or (envelope family) a reader code.
type Expected struct {
	Keyword          string `json:"keyword,omitempty"`
	InstanceLocation string `json:"instance_location"`
	Code             string `json:"code,omitempty"`
}

// Case is the fixture or one entry of a cases file.
type Case struct {
	// Name is "fixture" or "cases[<index>] <description>", for subtests.
	Name          string
	Description   string
	Data          json.RawMessage
	Valid         bool
	TolerantValid bool
	// Error is nil for a valid case.
	Error *Expected
}

// Accepted is the verdict schema validation in mode must reach. Valid cases pass
// both modes. A tolerant_valid case, and any case failing only on an unknown-field
// keyword, passes tolerant mode. A reader-code case is valid against the schema;
// only the envelope reader refuses it. Every other invalid case fails both modes.
func (c Case) Accepted(mode contracts.Mode) bool {
	switch {
	case c.Valid:
		return true
	case c.Error != nil && c.Error.Keyword == "":
		return true
	case mode == contracts.Tolerant:
		return c.TolerantValid || (c.Error != nil && contracts.IsUnknownFieldKeyword(c.Error.Keyword))
	}
	return false
}

// Cases returns a contract's fixture followed by every entry of its cases file.
// A contract without a cases file yields its fixture only.
func Cases(t testing.TB, id string) []Case {
	t.Helper()
	registry := Registry(t)
	schemaPath, err := registry.SchemaPath(id)
	if err != nil {
		t.Fatal(err)
	}
	stem := filepath.Join(registry.Root(), filepath.FromSlash(strings.TrimSuffix(schemaPath, ".schema.json")))
	fixture, err := os.ReadFile(stem + ".fixture.json")
	if err != nil {
		t.Fatalf("%s: %v", id, err)
	}
	cases := []Case{{Name: "fixture", Description: "golden fixture", Data: compact(t, fixture), Valid: true}}
	raw, err := os.ReadFile(stem + ".cases.json")
	if os.IsNotExist(err) {
		return cases
	}
	if err != nil {
		t.Fatalf("%s: %v", id, err)
	}
	var entries []struct {
		Description   string          `json:"description"`
		Valid         bool            `json:"valid"`
		TolerantValid bool            `json:"tolerant_valid"`
		Error         *Expected       `json:"error"`
		Data          json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("%s: %s.cases.json: %v", id, stem, err)
	}
	for index, entry := range entries {
		if !entry.Valid && entry.Error == nil {
			t.Fatalf("%s: case %d %q is invalid but names no error", id, index, entry.Description)
		}
		cases = append(cases, Case{
			Name:          fmt.Sprintf("cases[%d] %s", index, entry.Description),
			Description:   entry.Description,
			Data:          compact(t, entry.Data),
			Valid:         entry.Valid,
			TolerantValid: entry.TolerantValid,
			Error:         entry.Error,
		})
	}
	return cases
}

func compact(t testing.TB, raw []byte) json.RawMessage {
	t.Helper()
	var buffer bytes.Buffer
	if err := json.Compact(&buffer, raw); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
