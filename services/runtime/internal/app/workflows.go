package app

import (
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"net/http"
)

func (a *Application) compileWorkflow(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Workflow rules.Workflow `json:"workflow"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	d, c, err := rules.CompileWorkflow(input.Workflow)
	if err != nil {
		respond(w, 422, map[string]string{"message": err.Error()})
		return
	}
	respond(w, 200, map[string]any{"definition": d, "definition_hash": c.Hash, "valid": true})
}
