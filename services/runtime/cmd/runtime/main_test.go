package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/definition"
)

func TestRuntimeRoutesExposeHealthSurface(t *testing.T) {
	t.Parallel()

	compiler, err := definition.NewCompiler()
	if err != nil {
		t.Fatalf("create compiler: %v", err)
	}
	handler, err := runtimeRoutes(compiler, "test-runtime-internal-token-00000001")
	if err != nil {
		t.Fatalf("create runtime routes: %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected health route 200, got %d", response.Code)
	}
}

func TestRuntimeRoutesExposeAuthenticatedCompileSurface(t *testing.T) {
	t.Parallel()

	compiler, err := definition.NewCompiler()
	if err != nil {
		t.Fatalf("create compiler: %v", err)
	}
	handler, err := runtimeRoutes(compiler, "test-runtime-internal-token-00000001")
	if err != nil {
		t.Fatalf("create runtime routes: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, definition.CompileEndpointPath, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected authenticated compiler route, got %d", response.Code)
	}
}
