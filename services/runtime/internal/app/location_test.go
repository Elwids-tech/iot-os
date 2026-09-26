package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestLocationPreviewRequiresRuntimeAuthentication(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/location/v1/scenarios.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []map[string]json.RawMessage `json:"cases"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	c := fixture.Cases[0]
	body, err := json.Marshal(map[string]json.RawMessage{"binding": c["binding"], "event": c["event"], "evaluated_at": c["evaluated_at"]})
	if err != nil {
		t.Fatal(err)
	}
	a := &Application{Control: &ControlClient{Token: "location-test-token"}}
	for _, authorized := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/internal/locations/resolve", bytes.NewReader(body))
		if authorized {
			req.Header.Set("Authorization", "Bearer location-test-token")
		}
		response := httptest.NewRecorder()
		a.Handler().ServeHTTP(response, req)
		want := 401
		if authorized {
			want = 200
		}
		if response.Code != want {
			t.Fatal(response.Code, response.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/locations/resolve", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer location-test-token")
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, req)
	if response.Code != 422 {
		t.Fatal(response.Code)
	}
}

func TestStoredLocationRejectsUnauthenticatedAndInvalidRequests(t *testing.T) {
	a := &Application{Control: &ControlClient{Token: "test-token"}}
	for _, authorized := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/internal/locations/read", bytes.NewBufferString(`{}`))
		if authorized {
			req.Header.Set("Authorization", "Bearer test-token")
		}
		response := httptest.NewRecorder()
		a.Handler().ServeHTTP(response, req)
		expected := 401
		if authorized {
			expected = 422
		}
		if response.Code != expected {
			t.Fatal(response.Code, response.Body.String())
		}
	}
}
