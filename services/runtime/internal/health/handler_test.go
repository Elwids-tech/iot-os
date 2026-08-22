package health_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/health"
)

func TestHealthRoutes(t *testing.T) {
	t.Parallel()

	for _, path := range []string{"/healthz", "/readyz"} {
		path := path

		t.Run(path, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequest(http.MethodGet, path, nil)
			responseRecorder := httptest.NewRecorder()

			health.Routes().ServeHTTP(responseRecorder, request)

			if responseRecorder.Code != http.StatusOK {
				t.Fatalf("expected status %d, got %d", http.StatusOK, responseRecorder.Code)
			}

			var payload struct {
				Status string `json:"status"`
			}

			if err := json.NewDecoder(responseRecorder.Body).Decode(&payload); err != nil {
				t.Fatalf("decode health response: %v", err)
			}

			if payload.Status == "" {
				t.Fatal("expected a non-empty status")
			}
		})
	}
}
