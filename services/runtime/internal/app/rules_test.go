package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestRuleSimulationIsAuthenticatedAndIsolated(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/rules/v1/simulation.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	a := &Application{Control: &ControlClient{Token: "rule-test"}} // no database, broker or action service
	for _, authorized := range []bool{false, true} {
		req := httptest.NewRequest(http.MethodPost, "/internal/rules/simulate", bytes.NewReader(raw))
		if authorized {
			req.Header.Set("Authorization", "Bearer rule-test")
		}
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, req)
		want := 401
		if authorized {
			want = 200
		}
		if w.Code != want {
			t.Fatal(w.Code, w.Body.String())
		}
		if authorized {
			var response struct {
				Results []json.RawMessage `json:"results"`
			}
			if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response.Results) != 13 {
				t.Fatal(err, len(response.Results))
			}
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/rules/simulate", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer rule-test")
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, req)
	if w.Code != 422 {
		t.Fatal(w.Code)
	}
}
