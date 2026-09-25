package app

import (
	"bytes"
	"net/http/httptest"
	"os"
	"testing"
)

func TestWorkflowCompilationEndpoint(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/rules/v1/workflow.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	a := &Application{Control: &ControlClient{Token: "workflow-test"}}
	for _, tc := range []struct {
		body, token string
		status      int
	}{
		{`{"workflow":` + string(raw) + `}`, "", 401},
		{`{"workflow":` + string(raw) + `}`, "workflow-test", 200},
		{`{"workflow":{}}`, "workflow-test", 422},
	} {
		r := httptest.NewRequest("POST", "/internal/workflows/compile", bytes.NewBufferString(tc.body))
		r.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
