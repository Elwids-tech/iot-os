package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/jackc/pgx/v5"
)

func (a *Application) workflowLocationOverview(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	days, err := strconv.Atoi(q.Get("retention_days"))
	if err != nil || days < 1 || days > 36500 {
		respond(w, 422, map[string]string{"message": "Invalid retention"})
		return
	}
	var definitionRaw, state json.RawMessage
	var enabled bool
	var reason *string
	var updated time.Time
	err = a.Store.Pool.QueryRow(r.Context(), `SELECT definition,state,enabled,stopped_reason,updated_at FROM device_runtime.rule_executions
 WHERE operation_uuid::text=$1 AND organization_uuid::text=$2`, q.Get("operation_uuid"), q.Get("organization_uuid")).Scan(&definitionRaw, &state, &enabled, &reason, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		respond(w, 404, map[string]string{"message": "Execution not found"})
		return
	}
	if err != nil {
		respond(w, 503, map[string]string{"message": "Execution unavailable"})
		return
	}
	var definition rules.Definition
	if json.Unmarshal(definitionRaw, &definition) != nil || definition.Binding.Validate() != nil || definition.Binding.OrganizationUUID != q.Get("organization_uuid") {
		respond(w, 503, map[string]string{"message": "Execution binding unavailable"})
		return
	}
	at := time.Now().UTC()
	event, err := a.Store.LatestCommittedEvent(r.Context(), definition.Binding.OrganizationUUID, definition.Binding.DeviceUUID, at.AddDate(0, 0, -days), at)
	if err != nil {
		respond(w, 503, map[string]string{"message": "Location evidence unavailable"})
		return
	}
	var fix *location.Fix
	if event != nil {
		resolved, err := location.Resolve(definition.Binding, *event, at)
		if err != nil {
			respond(w, 503, map[string]string{"message": "Location evidence invalid"})
			return
		}
		fix = &resolved
	}
	respond(w, 200, map[string]any{"evaluated_at": at, "device_uuid": definition.Binding.DeviceUUID, "configuration_uuid": definition.Binding.ConfigurationUUID,
		"max_age_seconds": definition.Binding.MaxAgeSeconds, "geometry": definition.Geometry, "fix": fix,
		"execution": map[string]any{"state": state, "enabled": enabled, "stopped_reason": reason, "updated_at": updated, "consumer_healthy": a.rulesHealthy.Load()}})
}
