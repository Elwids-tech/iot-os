package definition

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testInternalToken = "test-runtime-internal-token-00000001"

type compilerStub struct {
	result CompileResult
	err    error
}

func (stub compilerStub) Compile(context.Context, CompileRequest) (CompileResult, error) {
	return stub.result, stub.err
}

func TestCompileEndpointReturnsDomainDiagnosticsAsHTTP200(t *testing.T) {
	t.Parallel()

	result := CompileResult{
		Schema:         CompileResultSchema,
		Valid:          false,
		InputHash:      strings.Repeat("a", 64),
		Compiler:       compilerMetadata(),
		Diagnostics:    []Diagnostic{{Severity: "error", Code: "DERIVATION_CYCLE", Path: "/profile/version/derived_parameters", Message: "Cycle."}},
		ArtifactHashes: ArtifactHashes{},
		Previews:       []FixturePreview{},
	}
	handler := newTestHTTPHandler(t, compilerStub{result: result})
	response := performCompileRequest(t, handler, hubCompileRequest(t, "humidity"), testInternalToken)

	if response.Code != http.StatusOK {
		t.Fatalf("expected domain diagnostics over HTTP 200, got %d: %s", response.Code, response.Body.String())
	}
	var decoded CompileResult
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if decoded.Valid || len(decoded.Diagnostics) != 1 || decoded.Diagnostics[0].Code != "DERIVATION_CYCLE" {
		t.Fatalf("expected domain diagnostic result, got %#v", decoded)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected no-store response, got %q", response.Header().Get("Cache-Control"))
	}
}

func TestCompileEndpointRunsCanonicalCompilerWithByteStableResponse(t *testing.T) {
	t.Parallel()

	compiler := newTestCompiler(t)
	handler := newTestHTTPHandler(t, compiler)
	request := hubCompileRequest(t, "humidity")
	request.Fixtures = []Fixture{{
		Name:    "humidity",
		Kind:    "telemetry",
		Channel: "telemetry",
		Topic:   "gateways/north-hub-001/telemetry",
		Payload: fixtureValue(t, "valid/hub-fanout/telemetry-payload.json"),
	}}

	first := performCompileRequest(t, handler, request, testInternalToken)
	second := performCompileRequest(t, handler, request, testInternalToken)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("expected successful compilation, got %d and %d", first.Code, second.Code)
	}
	if !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Fatal("authenticated HTTP compilation response was not byte stable")
	}
	var result CompileResult
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode compile result: %v", err)
	}
	if !result.Valid || result.RuntimeBundle == nil || result.RuntimeBundle.DeviceUUID != "40000000-0000-4000-8000-000000000002" {
		t.Fatalf("expected exact logical Device bundle, got %#v", result)
	}
}

func TestCompileEndpointRequiresBearerAuthentication(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, compilerStub{})
	response := performCompileRequest(t, handler, hubCompileRequest(t, "humidity"), "wrong-token")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
	if response.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("expected Bearer challenge")
	}
}

func TestCompileEndpointRejectsMalformedUnknownAndOversizedRequests(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, compilerStub{})
	for name, payload := range map[string][]byte{
		"malformed": []byte(`{"schema":`),
		"unknown":   []byte(`{"unknown":true}`),
		"trailing":  []byte(`{} {}`),
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, CompileEndpointPath, bytes.NewReader(payload))
			request.Header.Set("Authorization", "Bearer "+testInternalToken)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
			}
		})
	}

	oversized := bytes.Repeat([]byte("x"), maximumCompileRequestBytes+1)
	request := httptest.NewRequest(http.MethodPost, CompileEndpointPath, bytes.NewReader(oversized))
	request.Header.Set("Authorization", "Bearer "+testInternalToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", response.Code)
	}
}

func TestCompileEndpointSeparatesCompilerFailureAndMediaType(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, compilerStub{err: errors.New("compiler failed")})
	response := performCompileRequest(t, handler, hubCompileRequest(t, "humidity"), testInternalToken)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected compiler failure 500, got %d", response.Code)
	}

	payload, _ := json.Marshal(hubCompileRequest(t, "humidity"))
	request := httptest.NewRequest(http.MethodPost, CompileEndpointPath, bytes.NewReader(payload))
	request.Header.Set("Authorization", "Bearer "+testInternalToken)
	request.Header.Set("Content-Type", "text/plain")
	mediaResponse := httptest.NewRecorder()
	handler.ServeHTTP(mediaResponse, request)
	if mediaResponse.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d", mediaResponse.Code)
	}
}

func TestHTTPHandlerRejectsWeakInternalToken(t *testing.T) {
	t.Parallel()

	if _, err := NewHTTPHandler(compilerStub{}, "short"); err == nil {
		t.Fatal("expected weak internal token to be rejected")
	}
}

func newTestHTTPHandler(t *testing.T, compiler CompilerService) http.Handler {
	t.Helper()

	handler, err := NewHTTPHandler(compiler, testInternalToken)
	if err != nil {
		t.Fatalf("create HTTP handler: %v", err)
	}

	return handler
}

func performCompileRequest(
	t *testing.T,
	handler http.Handler,
	requestValue CompileRequest,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()

	payload, err := json.Marshal(requestValue)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, CompileEndpointPath, bytes.NewReader(payload))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	return response
}
