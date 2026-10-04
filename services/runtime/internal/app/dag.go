package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func (a *Application) dagRegistry(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, dag.Registry())
}
func (a *Application) compileDAG(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Workflow dag.Workflow `json:"workflow"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 262144))
	d.DisallowUnknownFields()
	if err := d.Decode(&input); err != nil {
		respond(w, 422, map[string]any{"message": err.Error()})
		return
	}
	p, diagnostics := dag.Compile(input.Workflow)
	if len(diagnostics) > 0 {
		respond(w, 200, map[string]any{"valid": false, "diagnostics": diagnostics})
		return
	}
	respond(w, 200, map[string]any{"valid": true, "diagnostics": diagnostics, "definition": p.Workflow, "definition_hash": p.Hash})
}
func (a *Application) simulateDAG(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Workflow dag.Workflow `json:"workflow"`
		Steps    []struct {
			At    time.Time                   `json:"at"`
			Event *devices.CommittedTelemetry `json:"event"`
		} `json:"steps"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 3*1024*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(&input); err != nil {
		respond(w, 422, map[string]any{"message": err.Error()})
		return
	}
	p, diags := dag.Compile(input.Workflow)
	if len(diags) > 0 || len(input.Steps) == 0 || len(input.Steps) > 1000 {
		respond(w, 422, map[string]any{"message": "Invalid simulation", "diagnostics": diags})
		return
	}
	s := p.Initial(input.Steps[0].At)
	results := []dag.Result{}
	seen := map[string]bool{}
	for _, step := range input.Steps {
		if step.Event != nil {
			if seen[step.Event.EventID] {
				continue
			}
			seen[step.Event.EventID] = true
		}
		result, err := p.Step(s, step.Event, step.At)
		if err != nil {
			respond(w, 422, map[string]any{"message": err.Error()})
			return
		}
		s = result.State
		results = append(results, result)
	}
	respond(w, 200, map[string]any{"mode": "side-effect-free", "definition_hash": p.Hash, "steps": results})
}
func (a *Application) dagExecution(w http.ResponseWriter, r *http.Request) {
	var state, trace json.RawMessage
	var enabled bool
	var reason *string
	var updated time.Time
	var next *time.Time
	err := a.Store.Pool.QueryRow(r.Context(), `SELECT state,last_trace,enabled,stopped_reason,updated_at,next_timer FROM device_runtime.dag_executions WHERE operation_uuid::text=$1 AND organization_uuid::text=$2`, r.URL.Query().Get("operation_uuid"), r.URL.Query().Get("organization_uuid")).Scan(&state, &trace, &enabled, &reason, &updated, &next)
	if err != nil {
		respond(w, 404, map[string]any{"message": "Execution not found"})
		return
	}
	respond(w, 200, map[string]any{"state": state, "trace": trace, "enabled": enabled, "stopped_reason": reason, "updated_at": updated, "next_timer": next, "consumer_healthy": a.rulesHealthy.Load()})
}

func (a *Application) dagHealth(w http.ResponseWriter, r *http.Request) {
	org := r.URL.Query().Get("organization_uuid")
	var executions, due, stateBytes int64
	var oldest *time.Time
	err := a.Store.Pool.QueryRow(r.Context(), `SELECT count(*),count(*) FILTER(WHERE enabled AND next_timer<now()),coalesce(sum(pg_column_size(state)),0),min(next_timer) FILTER(WHERE enabled) FROM device_runtime.dag_executions WHERE organization_uuid::text=$1`, org).Scan(&executions, &due, &stateBytes, &oldest)
	if err != nil {
		respond(w, 503, map[string]any{"message": "Automation health unavailable"})
		return
	}
	pending := uint64(0)
	ackPending := 0
	consumer, err := a.JS.ConsumerInfo(devices.CommittedTelemetryStream, "workflow-evaluator-v1")
	if err == nil {
		pending = consumer.NumPending
		ackPending = consumer.NumAckPending
	}
	respond(w, 200, map[string]any{"executions": executions, "due_timers": due, "state_bytes": stateBytes, "oldest_timer": oldest, "consumer_pending": pending, "pending_acknowledgements": ackPending, "consumer_healthy": err == nil && a.rulesHealthy.Load()})
}

func (a *Application) dagTimeline(w http.ResponseWriter, r *http.Request) {
	var before, evaluation int64
	for key, target := range map[string]*int64{"before": &before, "evaluation_id": &evaluation} {
		if value := r.URL.Query().Get(key); value != "" {
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil || n < 1 {
				respond(w, 422, map[string]any{"message": "Invalid timeline cursor"})
				return
			}
			*target = n
		}
	}
	rows, err := a.Store.DAGTimeline(r.Context(), r.URL.Query().Get("organization_uuid"), r.URL.Query().Get("workflow_uuid"), before, evaluation)
	if err != nil {
		respond(w, 503, map[string]any{"message": "Execution history is unavailable"})
		return
	}
	if evaluation > 0 {
		if len(rows) == 0 {
			respond(w, 404, map[string]any{"message": "Evaluation is unavailable or outside retention"})
			return
		}
		respond(w, 200, map[string]any{"data": rows[0]})
		return
	}
	var next *string
	if len(rows) > 20 {
		rows = rows[:20]
		next = &rows[19].ID
	}
	respond(w, 200, map[string]any{"data": rows, "next_cursor": next, "retention_limit": storage.DAGTimelineLimit})
}
