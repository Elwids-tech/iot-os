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

func TestCompileEndpointReturnsDomainValidationAsSuccessfulHTTPResponse(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, NewCompiler())
	validRequest := validCompileRequest(t, []Fixture{{
		Name:  "telemetry",
		Kind:  "telemetry",
		Input: readFixtureValue(t, "valid", validFixtureDirectory, "telemetry-payload.json"),
	}})
	validResponse := performCompileRequest(t, handler, validRequest, testInternalToken)
	if validResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid definition, got %d: %s", validResponse.Code, validResponse.Body.String())
	}
	var validResult CompileResult
	decodeHTTPResponse(t, validResponse, &validResult)
	if !validResult.Valid || validResult.ProfileArtifact == nil || validResult.BindingArtifact == nil {
		t.Fatalf("expected valid result with artifacts, got %#v", validResult)
	}

	invalidRequest := validRequest
	invalidRequest.Schema = "iot.definition-compile-request.v2"
	invalidResponse := performCompileRequest(t, handler, invalidRequest, testInternalToken)
	if invalidResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 for domain-invalid definition, got %d: %s", invalidResponse.Code, invalidResponse.Body.String())
	}
	var invalidResult CompileResult
	decodeHTTPResponse(t, invalidResponse, &invalidResult)
	if invalidResult.Valid {
		t.Fatal("expected domain-invalid compiler result")
	}
	assertDiagnostic(t, invalidResult, "UNSUPPORTED_REQUEST_SCHEMA")
	assertNoArtifacts(t, invalidResult)
}

func TestCompileEndpointRequiresBearerAuthentication(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, NewCompiler())
	request := validCompileRequest(t, []Fixture{{Name: "telemetry", Kind: "telemetry", Input: map[string]any{}}})

	for _, token := range []string{"", "wrong-runtime-internal-token-0000001"} {
		response := performCompileRequest(t, handler, request, token)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
		}
		if response.Header().Get("WWW-Authenticate") == "" {
			t.Fatal("unauthorized response omitted WWW-Authenticate")
		}
	}
}

func TestCompileEndpointRejectsMalformedUnknownAndOversizedRequests(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, NewCompiler())
	tests := []struct {
		name       string
		body       string
		statusCode int
	}{
		{name: "malformed", body: `{"schema":`, statusCode: http.StatusBadRequest},
		{name: "unknown field", body: `{"schema":"iot.definition-compile-request.v1","profile":{},"binding":{},"fixtures":[],"unknown":true}`, statusCode: http.StatusBadRequest},
		{name: "multiple values", body: `{}` + `{}`, statusCode: http.StatusBadRequest},
		{name: "oversized", body: `{"schema":"` + strings.Repeat("a", maximumCompileRequestBytes) + `"}`, statusCode: http.StatusRequestEntityTooLarge},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			httpRequest := httptest.NewRequest(http.MethodPost, CompileEndpointPath, strings.NewReader(test.body))
			httpRequest.Header.Set("Authorization", "Bearer "+testInternalToken)
			httpRequest.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, httpRequest)
			if response.Code != test.statusCode {
				t.Fatalf("expected %d, got %d: %s", test.statusCode, response.Code, response.Body.String())
			}
		})
	}
}

func TestCompileEndpointSeparatesCompilerFailureFromDomainValidation(t *testing.T) {
	t.Parallel()

	handler := newTestHTTPHandler(t, failingCompiler{})
	request := validCompileRequest(t, []Fixture{{Name: "telemetry", Kind: "telemetry", Input: map[string]any{}}})
	response := performCompileRequest(t, handler, request, testInternalToken)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
	}
	var payload errorResponse
	decodeHTTPResponse(t, response, &payload)
	if payload.Error.Code != "compiler_unavailable" {
		t.Fatalf("unexpected error response: %#v", payload)
	}
}

func TestHTTPHandlerRejectsWeakInternalToken(t *testing.T) {
	t.Parallel()

	if _, err := NewHTTPHandler(NewCompiler(), "too-short"); err == nil {
		t.Fatal("expected weak internal token to be rejected")
	}
}

type failingCompiler struct{}

func (failingCompiler) Compile(context.Context, CompileRequest) (CompileResult, error) {
	return CompileResult{}, errors.New("compiler failed")
}

func newTestHTTPHandler(t *testing.T, compiler CompilerService) http.Handler {
	t.Helper()

	handler, err := NewHTTPHandler(compiler, testInternalToken)
	if err != nil {
		t.Fatalf("create HTTP handler: %v", err)
	}

	return handler
}

func performCompileRequest(t *testing.T, handler http.Handler, request CompileRequest, token string) *httptest.ResponseRecorder {
	t.Helper()

	body, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	httpRequest := httptest.NewRequest(http.MethodPost, CompileEndpointPath, bytes.NewReader(body))
	httpRequest.Header.Set("Content-Type", "application/json")
	if token != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httpRequest)

	return response
}

func decodeHTTPResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode HTTP response: %v", err)
	}
}
