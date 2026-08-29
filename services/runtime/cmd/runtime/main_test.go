package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRuntimeRoutesExposeHealthSurface(t *testing.T) {
	t.Parallel()

	handler := runtimeRoutes()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected health route 200, got %d", response.Code)
	}
}
