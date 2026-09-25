package app

import (
	"encoding/json"
	"errors"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
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

func (a *Application) ruleExecution(w http.ResponseWriter, r *http.Request) {
	var state json.RawMessage
	var enabled bool
	var reason *string
	var updated time.Time
	err := a.Store.Pool.QueryRow(r.Context(), `SELECT state,enabled,stopped_reason,updated_at FROM device_runtime.rule_executions WHERE operation_uuid::text=$1 AND organization_uuid::text=$2`, r.URL.Query().Get("operation_uuid"), r.URL.Query().Get("organization_uuid")).Scan(&state, &enabled, &reason, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		respond(w, 404, map[string]string{"message": "Execution not found"})
		return
	}
	if err != nil {
		respond(w, 503, map[string]string{"message": "Execution state unavailable"})
		return
	}
	respond(w, 200, map[string]any{"state": state, "enabled": enabled, "stopped_reason": reason, "updated_at": updated, "consumer_healthy": a.rulesHealthy.Load()})
}
