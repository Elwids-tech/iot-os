package definition

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

const testOrganizationUUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

func TestCompilerBuildsByteStableRouteAwareHubBundle(t *testing.T) {
	t.Parallel()

	compiler := newTestCompiler(t)
	request := hubCompileRequest(t, "humidity")
	request.Fixtures = []Fixture{{
		Name:    "hub humidity telemetry",
		Kind:    "telemetry",
		Channel: "telemetry",
		Topic:   "gateways/north-hub-001/telemetry",
		Payload: fixtureValue(t, "valid/hub-fanout/telemetry-payload.json"),
		ExpectedParameterValues: []ExpectedParameterValue{{
			ParameterUUID: "44000000-0000-4000-8000-000000000003",
			Value:         48.1,
		}},
	}}

	first, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile first result: %v", err)
	}
	second, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile second result: %v", err)
	}
	if !first.Valid {
		t.Fatalf("expected valid result, diagnostics: %#v, previews: %#v", first.Diagnostics, first.Previews)
	}
	firstBytes, err := canonicalBytes(first)
	if err != nil {
		t.Fatalf("canonicalize first result: %v", err)
	}
	secondBytes, err := canonicalBytes(second)
	if err != nil {
		t.Fatalf("canonicalize second result: %v", err)
	}
	if !bytes.Equal(firstBytes, secondBytes) {
		t.Fatal("repeated compilation was not byte stable")
	}

	bundle := requireBundle(t, first)
	assertBundleIdentity(t, bundle, map[string]string{
		"organization":    testOrganizationUUID,
		"gateway":         "30000000-0000-4000-8000-000000000001",
		"gateway_route":   "43000000-0000-4000-8000-000000000002",
		"device":          "40000000-0000-4000-8000-000000000002",
		"profile":         "44000000-0000-4000-8000-000000000001",
		"profile_version": "44000000-0000-4000-8000-000000000002",
		"binding":         "45000000-0000-4000-8000-000000000001",
		"binding_version": "45000000-0000-4000-8000-000000000002",
	})
	if len(bundle.ParameterPipelines) != 1 || bundle.ParameterPipelines[0].Mapping.TargetParameterUUID != "44000000-0000-4000-8000-000000000003" {
		t.Fatalf("expected UUID-addressed humidity pipeline, got %#v", bundle.ParameterPipelines)
	}
	if len(bundle.Channels) != 1 || bundle.Channels[0].Topic != "gateways/north-hub-001/telemetry" {
		t.Fatalf("expected resolved Gateway topic, got %#v", bundle.Channels)
	}
	expectedBundle := fixtureDocument[RuntimeBundle](t, "valid/hub-fanout/humidity-runtime-bundle.json")
	if !canonicalEqual(bundle, expectedBundle) {
		t.Fatalf("compiled Runtime Bundle does not match the checked-in golden fixture")
	}

	withoutIdentity := bundle
	withoutIdentity.RuntimeBundleHash = ""
	expectedHash, err := canonicalHash(withoutIdentity)
	if err != nil {
		t.Fatalf("hash Runtime Bundle source: %v", err)
	}
	if bundle.RuntimeBundleHash != expectedHash || first.ArtifactHashes.RuntimeBundle == nil || *first.ArtifactHashes.RuntimeBundle != expectedHash {
		t.Fatalf("Runtime Bundle hash mismatch: bundle=%s hashes=%#v expected=%s", bundle.RuntimeBundleHash, first.ArtifactHashes, expectedHash)
	}
}

func TestCompilerCalibratesThreePhaseMeterAndEvaluatesDerivation(t *testing.T) {
	t.Parallel()

	compiler := newTestCompiler(t)
	request := CompileRequest{
		Schema:           CompileRequestSchema,
		OrganizationUUID: testOrganizationUUID,
		Profile:          fixtureDocument[ProfileDocument](t, "valid/three-phase-meter/profile.json"),
		Binding:          fixtureDocument[BindingDocument](t, "valid/three-phase-meter/binding.json"),
		Gateway:          fixtureDocument[GatewayDocument](t, "valid/hub-fanout/gateway.json"),
		Route:            fixtureDocument[GatewayRouteDocument](t, "valid/three-phase-meter/route.json"),
		Fixtures: []Fixture{{
			Name:    "three-phase telemetry",
			Kind:    "telemetry",
			Channel: "telemetry",
			Topic:   "gateways/north-hub-001/telemetry",
			Payload: fixtureValue(t, "valid/three-phase-meter/telemetry-payload.json"),
			ExpectedParameterValues: []ExpectedParameterValue{
				{ParameterUUID: "51000000-0000-4000-8000-000000000009", Value: 1534.2},
			},
		}},
	}

	result, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile meter: %v", err)
	}
	if !result.Valid {
		t.Fatalf("expected meter fixture to compile, diagnostics: %#v, preview: %#v", result.Diagnostics, result.Previews)
	}
	bundle := requireBundle(t, result)
	if len(bundle.ParameterPipelines) != 7 {
		t.Fatalf("expected seven measured pipelines, got %d", len(bundle.ParameterPipelines))
	}
	if len(bundle.DerivedPipelines) != 1 || bundle.DerivedPipelines[0].ParameterUUID != "51000000-0000-4000-8000-000000000010" || bundle.DerivedPipelines[0].EvaluationOrder != 0 {
		t.Fatalf("expected deterministic average-voltage derivation, got %#v", bundle.DerivedPipelines)
	}
	values := result.Previews[0].Values
	assertPreviewValue(t, values, "51000000-0000-4000-8000-000000000003", 230.1)
	assertPreviewValue(t, values, "51000000-0000-4000-8000-000000000009", 1534.2)
	assertPreviewValue(t, values, "51000000-0000-4000-8000-000000000010", (230.1+229.7+231.0)/3.0)
}

func TestCompilerOrdersSameDeviceDerivationsAndRejectsMissingDependencies(t *testing.T) {
	t.Parallel()

	request := CompileRequest{
		Schema:           CompileRequestSchema,
		OrganizationUUID: testOrganizationUUID,
		Profile:          fixtureDocument[ProfileDocument](t, "valid/three-phase-meter/profile.json"),
		Binding:          fixtureDocument[BindingDocument](t, "valid/three-phase-meter/binding.json"),
		Gateway:          fixtureDocument[GatewayDocument](t, "valid/hub-fanout/gateway.json"),
		Route:            fixtureDocument[GatewayRouteDocument](t, "valid/three-phase-meter/route.json"),
		Fixtures:         []Fixture{},
	}
	request.Profile.Version.DerivedParameters = append(request.Profile.Version.DerivedParameters, DerivedParameter{
		UUID:  "51000000-0000-4000-8000-000000000011",
		Key:   "double_average_voltage",
		Label: "Double average voltage",
		ValueSchema: ValueSchema{
			DataType:    "float64",
			Constraints: ValueConstraints{},
		},
		Expression: DerivedExpression{
			Language: "cel",
			Source:   "p['51000000-0000-4000-8000-000000000010'] * 2.0",
		},
		Dependencies: []string{"51000000-0000-4000-8000-000000000010"},
	})

	compiler := newTestCompiler(t)
	result, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile ordered derivations: %v", err)
	}
	if !result.Valid {
		t.Fatalf("expected valid derivation graph, got %#v", result.Diagnostics)
	}
	if result.RuntimeBundle == nil || len(result.RuntimeBundle.DerivedPipelines) != 2 ||
		result.RuntimeBundle.DerivedPipelines[0].ParameterUUID != "51000000-0000-4000-8000-000000000010" ||
		result.RuntimeBundle.DerivedPipelines[1].ParameterUUID != "51000000-0000-4000-8000-000000000011" {
		t.Fatalf("expected topological derivation order, got %#v", result.RuntimeBundle)
	}

	request.Profile.Version.DerivedParameters[1].Dependencies = []string{"51000000-0000-4000-8000-000000000099"}
	request.Profile.Version.DerivedParameters[1].Expression.Source = "p['51000000-0000-4000-8000-000000000099'] * 2.0"
	invalid, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile missing derivation dependency: %v", err)
	}
	assertDiagnosticCode(t, invalid, "DERIVATION_DEPENDENCY_NOT_FOUND")
}

func TestCompilerAppliesRestrictedCELCalibrationAndGatewayRouteSelector(t *testing.T) {
	t.Parallel()

	request := hubCompileRequest(t, "humidity")
	request.Binding.Version.ParameterMappings[0].Calibration = append(
		request.Binding.Version.ParameterMappings[0].Calibration,
		CalibrationOperation{Op: "cel", Expression: "value + 1.0"},
	)
	request.Route.Route.InboundScopes[0].Selector = &RouteSelector{
		Source: PathRef{Scope: "message", JSONPath: "$.message_id"},
		Equals: "hub-message-0001",
	}
	request.Fixtures = []Fixture{{
		Name:    "selected calibrated humidity",
		Kind:    "telemetry",
		Channel: "telemetry",
		Topic:   "gateways/north-hub-001/telemetry",
		Payload: fixtureValue(t, "valid/hub-fanout/telemetry-payload.json"),
		ExpectedParameterValues: []ExpectedParameterValue{{
			ParameterUUID: "44000000-0000-4000-8000-000000000003",
			Value:         49.1,
		}},
	}}

	compiler := newTestCompiler(t)
	result, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile selected calibration: %v", err)
	}
	if !result.Valid {
		t.Fatalf("expected selector and restricted CEL calibration to pass, got %#v %#v", result.Diagnostics, result.Previews)
	}
	if result.RuntimeBundle == nil || result.RuntimeBundle.Channels[0].RouteSelector == nil {
		t.Fatal("expected Gateway Route selector in Runtime Bundle")
	}

	payload := fixtureValue(t, "valid/hub-fanout/telemetry-payload.json").(map[string]any)
	payload["message_id"] = "different-message"
	request.Fixtures[0].Payload = payload
	rejected, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile selector mismatch: %v", err)
	}
	if rejected.Valid || rejected.Previews[0].Accepted {
		t.Fatal("expected a non-matching Gateway Route selector to reject the fixture")
	}
}

func TestCompilerEncodesMinimalCommandAndDecodesCorrelatedDeviceSuccess(t *testing.T) {
	t.Parallel()

	compiler := newTestCompiler(t)
	request := hubCompileRequest(t, "temperature")
	request.Fixtures = []Fixture{
		{
			Name:    "thermostat request",
			Kind:    "command_request",
			Channel: "set_temperature_request",
			Topic:   "gateways/north-hub-001/devices/sensors/temperature/commands/set-temperature/request",
			Payload: fixtureValue(t, "valid/hub-fanout/command-request.json"),
			CommandInput: map[string]any{
				"41000000-0000-4000-8000-000000000005": 21.5,
			},
		},
		{
			Name:    "thermostat response",
			Kind:    "command_response",
			Channel: "set_temperature_response",
			Topic:   "gateways/north-hub-001/devices/sensors/temperature/commands/set-temperature/response",
			Payload: fixtureValue(t, "valid/hub-fanout/command-response.json"),
		},
	}

	result, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile thermostat: %v", err)
	}
	if !result.Valid {
		t.Fatalf("expected Command fixtures to compile, diagnostics: %#v, previews: %#v", result.Diagnostics, result.Previews)
	}
	bundle := requireBundle(t, result)
	if len(bundle.CommandPipelines) != 1 || bundle.CommandPipelines[0].ResponseTopic == nil {
		t.Fatalf("expected correlated Command pipeline, got %#v", bundle.CommandPipelines)
	}

	encoded, err := compiler.EncodeCommand(context.Background(), *result.ProfileArtifact, bundle, "41000000-0000-4000-8000-000000000004", CommandInvocation{
		CommandID:   "cmd-0001",
		RequestedAt: "2026-08-29T18:01:00Z",
		Inputs: map[string]any{
			"41000000-0000-4000-8000-000000000005": 21.5,
		},
	})
	if err != nil {
		t.Fatalf("encode Command: %v", err)
	}
	if !canonicalEqual(encoded, fixtureValue(t, "valid/hub-fanout/command-request.json")) {
		t.Fatalf("encoded payload included wrong fields: %#v", encoded)
	}
	if _, includesUIOnlyMetadata := encoded["required"]; includesUIOnlyMetadata {
		t.Fatalf("encoded payload leaked Profile UI metadata: %#v", encoded)
	}

	decoded, err := compiler.DecodeCommandResponse(
		context.Background(),
		*result.ProfileArtifact,
		bundle,
		"41000000-0000-4000-8000-000000000004",
		fixtureValue(t, "valid/hub-fanout/command-response.json"),
	)
	if err != nil {
		t.Fatalf("decode Device response: %v", err)
	}
	if decoded.CorrelationID != "cmd-0001" || decoded.Status != "succeeded" || !decoded.Terminal || !decoded.Succeeded {
		t.Fatalf("expected correlated Device success, got %#v", decoded)
	}
	if !scalarEqual(decoded.Outputs["41000000-0000-4000-8000-000000000006"], 21.5) {
		t.Fatalf("expected typed Command output, got %#v", decoded.Outputs)
	}

	if _, err := compiler.DecodeCommandResponse(
		context.Background(),
		*result.ProfileArtifact,
		bundle,
		"41000000-0000-4000-8000-000000000004",
		map[string]any{"puback": true},
	); err == nil {
		t.Fatal("MQTT PUBACK must not be decoded as Device Command success")
	}
}

func TestCompilerPinsRouteVariablesIntoCommandBundle(t *testing.T) {
	t.Parallel()

	request := hubCompileRequest(t, "temperature")
	request.Route.Route.TopicVariables["bus_id"] = "bus-7"
	request.Binding.Version.Channels[1].TopicTemplate = "gateways/{gateway_id}/buses/{bus_id}/commands/request"
	request.Binding.Version.CommandMappings[0].RequestEnvelope.RouteVariablePaths = map[string]string{
		"bus_id": "$.bus_id",
	}
	request.Fixtures = []Fixture{}

	compiler := newTestCompiler(t)
	result, err := compiler.Compile(context.Background(), request)
	if err != nil {
		t.Fatalf("compile route-variable Command: %v", err)
	}
	if !result.Valid || result.RuntimeBundle == nil {
		t.Fatalf("expected valid route-variable bundle, got %#v", result.Diagnostics)
	}
	pipeline := result.RuntimeBundle.CommandPipelines[0]
	if pipeline.RequestTopic != "gateways/north-hub-001/buses/bus-7/commands/request" {
		t.Fatalf("route variable was not resolved into topic: %s", pipeline.RequestTopic)
	}
	encoded, err := compiler.EncodeCommand(
		context.Background(),
		*result.ProfileArtifact,
		*result.RuntimeBundle,
		"41000000-0000-4000-8000-000000000004",
		CommandInvocation{
			CommandID:   "cmd-route-variable",
			RequestedAt: "2026-08-29T18:01:00Z",
			Inputs: map[string]any{
				"41000000-0000-4000-8000-000000000005": 20.0,
			},
		},
	)
	if err != nil {
		t.Fatalf("encode route-variable Command: %v", err)
	}
	if encoded["bus_id"] != "bus-7" {
		t.Fatalf("route variable was not pinned into Command payload: %#v", encoded)
	}
}

func TestCompilerReportsCanonicalInvalidFixtures(t *testing.T) {
	t.Parallel()

	profileCases := []struct {
		name string
		file string
		code string
	}{
		{name: "duplicate UUID", file: "invalid/profile-duplicate-parameter-uuid.json", code: "DUPLICATE_DEFINITION_UUID"},
		{name: "derivation cycle", file: "invalid/profile-derived-cycle.json", code: "DERIVATION_CYCLE"},
		{name: "unsafe CEL", file: "invalid/profile-unsafe-cel.json", code: "CEL_UNSUPPORTED_SYMBOL"},
	}
	for _, testCase := range profileCases {
		t.Run(testCase.name, func(t *testing.T) {
			compiler := newTestCompiler(t)
			request := hubCompileRequest(t, "humidity")
			request.Profile = fixtureDocument[ProfileDocument](t, testCase.file)
			request.Binding.Binding.ProfileUUID = request.Profile.Profile.UUID
			request.Binding.Version.ProfileVersionUUID = request.Profile.Version.UUID
			request.Binding.Version.ParameterMappings = []ParameterMapping{}
			request.Route.Route.ProfileVersionUUID = request.Profile.Version.UUID
			request.Fixtures = []Fixture{}

			result, err := compiler.Compile(context.Background(), request)
			if err != nil {
				t.Fatalf("compile invalid Profile: %v", err)
			}
			assertDiagnosticCode(t, result, testCase.code)
		})
	}

	bindingCases := []struct {
		name string
		file string
		code string
	}{
		{name: "missing policies", file: "invalid/binding-missing-policies.json", code: "MAPPING_POLICY_REQUIRED"},
		{name: "unresolved target", file: "invalid/binding-unresolved-target.json", code: "MAPPING_TARGET_NOT_FOUND"},
		{name: "incompatible type", file: "invalid/binding-incompatible-type.json", code: "TYPE_MISMATCH"},
	}
	for _, testCase := range bindingCases {
		t.Run(testCase.name, func(t *testing.T) {
			compiler := newTestCompiler(t)
			request := hubCompileRequest(t, "temperature")
			request.Binding = fixtureDocument[BindingDocument](t, testCase.file)
			request.Route.Route.BindingVersionUUID = request.Binding.Version.UUID
			request.Fixtures = []Fixture{}

			result, err := compiler.Compile(context.Background(), request)
			if err != nil {
				t.Fatalf("compile invalid Binding: %v", err)
			}
			assertDiagnosticCode(t, result, testCase.code)
		})
	}
}

func hubCompileRequest(t *testing.T, kind string) CompileRequest {
	t.Helper()

	return CompileRequest{
		Schema:           CompileRequestSchema,
		OrganizationUUID: testOrganizationUUID,
		Profile:          fixtureDocument[ProfileDocument](t, "valid/hub-fanout/"+kind+"-profile.json"),
		Binding:          fixtureDocument[BindingDocument](t, "valid/hub-fanout/"+kind+"-binding.json"),
		Gateway:          fixtureDocument[GatewayDocument](t, "valid/hub-fanout/gateway.json"),
		Route:            fixtureDocument[GatewayRouteDocument](t, "valid/hub-fanout/"+kind+"-route.json"),
		Fixtures:         []Fixture{},
	}
}

func fixtureDocument[T any](t *testing.T, name string) T {
	t.Helper()

	payload, err := os.ReadFile(fixturePath(name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var document T
	if err := decodeStrict(payload, &document); err != nil {
		t.Fatalf("decode fixture %s: %v", name, err)
	}

	return document
}

func fixtureValue(t *testing.T, name string) any {
	t.Helper()

	payload, err := os.ReadFile(fixturePath(name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("decode fixture value %s: %v", name, err)
	}

	return value
}

func fixturePath(name string) string {
	return filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "device-onboarding", name)
}

func newTestCompiler(t *testing.T) *Compiler {
	t.Helper()

	compiler, err := NewCompiler()
	if err != nil {
		t.Fatalf("create compiler: %v", err)
	}

	return compiler
}

func requireBundle(t *testing.T, result CompileResult) RuntimeBundle {
	t.Helper()

	if result.RuntimeBundle == nil || result.ProfileArtifact == nil || result.BindingArtifact == nil {
		t.Fatalf("expected compiled artifacts, got %#v", result.ArtifactHashes)
	}

	return *result.RuntimeBundle
}

func assertBundleIdentity(t *testing.T, bundle RuntimeBundle, expected map[string]string) {
	t.Helper()

	actual := map[string]string{
		"organization":    bundle.OrganizationUUID,
		"gateway":         bundle.GatewayUUID,
		"gateway_route":   bundle.GatewayRouteUUID,
		"device":          bundle.DeviceUUID,
		"profile":         bundle.ProfileUUID,
		"profile_version": bundle.ProfileVersionUUID,
		"binding":         bundle.BindingUUID,
		"binding_version": bundle.BindingVersionUUID,
	}
	for key, value := range expected {
		if actual[key] != value {
			t.Fatalf("identity %s mismatch: got %s want %s", key, actual[key], value)
		}
	}
}

func assertPreviewValue(t *testing.T, values []PreviewValue, parameterUUID string, expected any) {
	t.Helper()

	for _, value := range values {
		if value.ParameterUUID == parameterUUID {
			actualNumber, actualNumeric := numericValue(value.Value)
			expectedNumber, expectedNumeric := numericValue(expected)
			matches := scalarEqual(value.Value, expected)
			if actualNumeric && expectedNumeric {
				matches = math.Abs(actualNumber-expectedNumber) < 1e-12
			}
			if !matches {
				t.Fatalf("parameter %s value mismatch: got %#v want %#v", parameterUUID, value.Value, expected)
			}

			return
		}
	}
	t.Fatalf("parameter %s was not produced in %#v", parameterUUID, values)
}

func assertDiagnosticCode(t *testing.T, result CompileResult, code string) {
	t.Helper()

	if result.Valid {
		t.Fatalf("expected invalid result containing %s", code)
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == code {
			return
		}
	}
	t.Fatalf("expected diagnostic %s, got %#v", code, result.Diagnostics)
}
