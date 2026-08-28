package definition

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validFixtureDirectory = "temperature-humidity-thermostat"

func TestCompilerReplaysTelemetryAndProducesDeterministicArtifacts(t *testing.T) {
	t.Parallel()

	request := validCompileRequest(t, []Fixture{
		{
			Name:  "temperature and humidity telemetry",
			Kind:  "telemetry",
			Input: readFixtureValue(t, "valid", validFixtureDirectory, "telemetry-payload.json"),
			Expected: map[string]any{
				"device_id":   "sensor-001",
				"observed_at": "2026-08-28T18:00:00Z",
				"values": map[string]any{
					"temperature": 22.4,
					"humidity":    47.8,
				},
			},
		},
	})

	first := compileRequest(t, request)
	second := compileRequest(t, request)

	if !first.Valid {
		t.Fatalf("expected valid compilation, got diagnostics: %#v", first.Diagnostics)
	}
	if first.InputHash != second.InputHash {
		t.Fatalf("input hash changed across identical compilations: %s != %s", first.InputHash, second.InputHash)
	}
	if first.ArtifactHashes.Profile == nil || first.ArtifactHashes.Binding == nil {
		t.Fatal("valid compilation did not produce both artifact hashes")
	}
	if *first.ArtifactHashes.Profile != *second.ArtifactHashes.Profile || *first.ArtifactHashes.Binding != *second.ArtifactHashes.Binding {
		t.Fatal("artifact hashes changed across identical compilations")
	}
	if len(first.Previews) != 1 || !first.Previews[0].Valid {
		t.Fatalf("expected one valid preview, got %#v", first.Previews)
	}
	assertJSONEqual(t, first.Previews[0].Canonical, request.Fixtures[0].Expected)
}

func TestCompilerGeneratesCommandRequestAndCorrelatesTerminalResponse(t *testing.T) {
	t.Parallel()

	expectedCommandRequest := readFixtureValue(t, "valid", validFixtureDirectory, "command-request.json")
	expectedCommandResponse := map[string]any{
		"target":     "thermostat.set_temperature",
		"command_id": "cmd-01",
		"status":     "succeeded",
		"fields": map[string]any{
			"applied_temp_level": 21.0,
		},
	}
	request := validCompileRequest(t, []Fixture{
		{
			Name: "command request",
			Kind: "command_request",
			Input: map[string]any{
				"target":       "thermostat.set_temperature",
				"command_id":   "cmd-01",
				"device_id":    "sensor-001",
				"requested_at": "2026-08-28T18:01:00Z",
				"fields": map[string]any{
					"temp_level": 21.0,
				},
			},
		},
		{
			Name:  "command response",
			Kind:  "command_response",
			Input: readFixtureValue(t, "valid", validFixtureDirectory, "command-response.json"),
		},
	})

	result := compileRequest(t, request)

	if !result.Valid {
		t.Fatalf("expected valid compilation, got diagnostics: %#v", result.Diagnostics)
	}
	if len(result.Previews) != 2 {
		t.Fatalf("expected two previews, got %d", len(result.Previews))
	}
	assertJSONEqual(t, result.Previews[0].Generated, expectedCommandRequest)
	assertJSONEqual(t, result.Previews[1].Canonical, expectedCommandResponse)
}

func TestCompilerDispatchesMultipleEventsFromFinalWildcard(t *testing.T) {
	t.Parallel()

	request := CompileRequest{
		Schema:   CompileRequestSchema,
		Profile:  readFixtureRaw(t, "valid", "multi-event", "profile.json"),
		Binding:  readFixtureRaw(t, "valid", "multi-event", "binding.json"),
		Fixtures: []Fixture{{Name: "multi event", Kind: "event", Input: readFixtureValue(t, "valid", "multi-event", "event-payload.json")}},
	}

	result := compileRequest(t, request)

	if !result.Valid {
		t.Fatalf("expected valid compilation, got diagnostics: %#v", result.Diagnostics)
	}
	canonical, ok := result.Previews[0].Canonical.(map[string]any)
	if !ok {
		t.Fatalf("event preview is not an object: %#v", result.Previews[0].Canonical)
	}
	events, ok := canonical["events"].([]map[string]any)
	if !ok || len(events) != 2 {
		t.Fatalf("expected two dispatched events, got %#v", canonical["events"])
	}
}

func TestCompilerRejectsUnsupportedDefinitionsWithoutArtifacts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		profile        json.RawMessage
		binding        json.RawMessage
		diagnosticCode string
	}{
		{
			name:           "nested wildcard path",
			profile:        readFixtureRaw(t, "valid", "multi-event", "profile.json"),
			binding:        readFixtureRaw(t, "invalid", "binding-unsupported-wildcard.json"),
			diagnosticCode: "UNSUPPORTED_JSONPATH",
		},
		{
			name:           "invalid profile key",
			profile:        readFixtureRaw(t, "invalid", "profile-invalid-key.json"),
			binding:        readFixtureRaw(t, "valid", validFixtureDirectory, "binding.json"),
			diagnosticCode: "INVALID_KEY",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := CompileRequest{
				Schema:   CompileRequestSchema,
				Profile:  test.profile,
				Binding:  test.binding,
				Fixtures: []Fixture{{Name: "input", Kind: "telemetry", Input: map[string]any{}}},
			}
			result := compileRequest(t, request)

			if result.Valid {
				t.Fatal("expected invalid compilation")
			}
			assertDiagnostic(t, result, test.diagnosticCode)
			assertNoArtifacts(t, result)
		})
	}
}

func TestCompilerRejectsInvalidCELAndDerivationCycles(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		mutate         func(*ProfileDocument)
		diagnosticCode string
	}{
		{
			name: "invalid CEL",
			mutate: func(profile *ProfileDocument) {
				profile.Version.Components[1].Telemetry = append(profile.Version.Components[1].Telemetry, Telemetry{
					UUID:        "11111111-1111-4111-8111-111111111121",
					Key:         "dew_point",
					Label:       "Dew point",
					ValueSchema: floatValueSchema(),
					Derivation:  &Derivation{CEL: "values[", Dependencies: []string{"environment.temperature"}},
				})
			},
			diagnosticCode: "INVALID_CEL",
		},
		{
			name: "derivation cycle",
			mutate: func(profile *ProfileDocument) {
				profile.Version.Components[1].Telemetry = append(profile.Version.Components[1].Telemetry,
					Telemetry{
						UUID:        "11111111-1111-4111-8111-111111111121",
						Key:         "cycle_a",
						Label:       "Cycle A",
						ValueSchema: floatValueSchema(),
						Derivation:  &Derivation{CEL: `values["environment.cycle_b"]`, Dependencies: []string{"environment.cycle_b"}},
					},
					Telemetry{
						UUID:        "11111111-1111-4111-8111-111111111122",
						Key:         "cycle_b",
						Label:       "Cycle B",
						ValueSchema: floatValueSchema(),
						Derivation:  &Derivation{CEL: `values["environment.cycle_a"]`, Dependencies: []string{"environment.cycle_a"}},
					},
				)
			},
			diagnosticCode: "DERIVATION_CYCLE",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var profile ProfileDocument
			decodeFixture(t, readFixtureRaw(t, "valid", validFixtureDirectory, "profile.json"), &profile)
			test.mutate(&profile)
			profileJSON, err := json.Marshal(profile)
			if err != nil {
				t.Fatalf("marshal profile: %v", err)
			}

			request := validCompileRequest(t, []Fixture{{
				Name:  "telemetry",
				Kind:  "telemetry",
				Input: readFixtureValue(t, "valid", validFixtureDirectory, "telemetry-payload.json"),
			}})
			request.Profile = profileJSON
			result := compileRequest(t, request)

			if result.Valid {
				t.Fatal("expected invalid compilation")
			}
			assertDiagnostic(t, result, test.diagnosticCode)
			assertNoArtifacts(t, result)
		})
	}
}

func TestRestrictedJSONPathAllowlistAndNumericPlacement(t *testing.T) {
	t.Parallel()

	allowed := []string{"$", "$.payload.value", "$.items[0].value", "$['payload'][1]['value']", "$.events[*]"}
	for _, expression := range allowed {
		if _, err := parseRestrictedPath(expression, strings.HasSuffix(expression, "[*]")); err != nil {
			t.Errorf("expected %q to be allowed: %v", expression, err)
		}
	}

	rejected := []string{"$..value", "$.events[*].nested", "$.events[*][0]", "$.events.*", "$.events[?(@.active)]"}
	for _, expression := range rejected {
		if _, err := parseRestrictedPath(expression, true); err == nil {
			t.Errorf("expected %q to be rejected", expression)
		}
	}

	path, err := parseRestrictedPath("$.items[1].value", false)
	if err != nil {
		t.Fatalf("parse numeric placement path: %v", err)
	}
	target := map[string]any{}
	if err := path.Set(target, 42.0); err != nil {
		t.Fatalf("set numeric placement path: %v", err)
	}
	assertJSONEqual(t, target, map[string]any{"items": []any{nil, map[string]any{"value": 42.0}}})
}

func TestCompilerRejectsFixtureTypeConstraintAndMissingValueFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		input  map[string]any
		needle string
	}{
		{
			name: "type",
			input: map[string]any{
				"device_id": "sensor-001", "timestamp": "2026-08-28T18:00:00Z", "temperature": "not-a-number", "humidity": 47.8,
			},
			needle: "coercible",
		},
		{
			name: "constraint",
			input: map[string]any{
				"device_id": "sensor-001", "timestamp": "2026-08-28T18:00:00Z", "temperature": 200.0, "humidity": 47.8,
			},
			needle: "maximum",
		},
		{
			name: "missing value",
			input: map[string]any{
				"device_id": "sensor-001", "timestamp": "2026-08-28T18:00:00Z", "humidity": 47.8,
			},
			needle: "missing",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := validCompileRequest(t, []Fixture{{Name: test.name, Kind: "telemetry", Input: test.input}})
			result := compileRequest(t, request)

			if result.Valid {
				t.Fatal("expected invalid compilation")
			}
			assertNoArtifacts(t, result)
			if !diagnosticsContain(result.Diagnostics, test.needle) {
				t.Fatalf("expected diagnostic containing %q, got %#v", test.needle, result.Diagnostics)
			}
		})
	}
}

func validCompileRequest(t *testing.T, fixtures []Fixture) CompileRequest {
	t.Helper()

	return CompileRequest{
		Schema:   CompileRequestSchema,
		Profile:  readFixtureRaw(t, "valid", validFixtureDirectory, "profile.json"),
		Binding:  readFixtureRaw(t, "valid", validFixtureDirectory, "binding.json"),
		Fixtures: fixtures,
	}
}

func compileRequest(t *testing.T, request CompileRequest) CompileResult {
	t.Helper()

	result, err := NewCompiler().Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile request: %v", err)
	}

	return result
}

func readFixtureRaw(t *testing.T, path ...string) json.RawMessage {
	t.Helper()

	fixturePath := filepath.Join(append([]string{"..", "..", "..", "..", "contracts", "fixtures", "device-onboarding"}, path...)...)
	contents, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture %s: %v", fixturePath, err)
	}

	return contents
}

func readFixtureValue(t *testing.T, path ...string) any {
	t.Helper()

	var value any
	decodeFixture(t, readFixtureRaw(t, path...), &value)

	return value
}

func decodeFixture(t *testing.T, source []byte, target any) {
	t.Helper()

	decoder := json.NewDecoder(strings.NewReader(string(source)))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
}

func assertJSONEqual(t *testing.T, actual, expected any) {
	t.Helper()

	actualJSON, err := canonicalBytes(actual)
	if err != nil {
		t.Fatalf("canonicalize actual value: %v", err)
	}
	expectedJSON, err := canonicalBytes(expected)
	if err != nil {
		t.Fatalf("canonicalize expected value: %v", err)
	}
	if string(actualJSON) != string(expectedJSON) {
		t.Fatalf("JSON values differ:\nactual:   %s\nexpected: %s", actualJSON, expectedJSON)
	}
}

func assertDiagnostic(t *testing.T, result CompileResult, code string) {
	t.Helper()

	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == code {
			return
		}
	}
	t.Fatalf("expected diagnostic %s, got %#v", code, result.Diagnostics)
}

func assertNoArtifacts(t *testing.T, result CompileResult) {
	t.Helper()

	if result.ProfileArtifact != nil || result.BindingArtifact != nil || result.ArtifactHashes.Profile != nil || result.ArtifactHashes.Binding != nil {
		t.Fatalf("invalid compilation produced artifacts: %#v", result.ArtifactHashes)
	}
}

func diagnosticsContain(diagnostics []Diagnostic, needle string) bool {
	for _, diagnostic := range diagnostics {
		if strings.Contains(strings.ToLower(diagnostic.Message), strings.ToLower(needle)) {
			return true
		}
	}

	return false
}

func floatValueSchema() ValueSchema {
	return ValueSchema{
		DataType: "float64",
		Required: false,
		Critical: false,
		Display:  DisplayMetadata{Order: 100},
	}
}
