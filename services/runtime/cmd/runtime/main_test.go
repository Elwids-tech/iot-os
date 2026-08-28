package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/definition"
)

const routeTestToken = "test-runtime-internal-token-00000001"

func TestRuntimeRoutesComposeHealthAndCompileSurfaces(t *testing.T) {
	t.Parallel()

	handler, err := runtimeRoutes(routeTestToken)
	if err != nil {
		t.Fatalf("create runtime routes: %v", err)
	}

	healthRequest := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	healthResponse := httptest.NewRecorder()
	handler.ServeHTTP(healthResponse, healthRequest)
	if healthResponse.Code != http.StatusOK {
		t.Fatalf("expected health route 200, got %d", healthResponse.Code)
	}

	compileRequest := httptest.NewRequest(http.MethodPost, definition.CompileEndpointPath, nil)
	compileResponse := httptest.NewRecorder()
	handler.ServeHTTP(compileResponse, compileRequest)
	if compileResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected compile route authentication challenge, got %d", compileResponse.Code)
	}
}
