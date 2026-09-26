package app

import (
	"net/http"
	"regexp"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
)

// Resolves stored evidence only, at server time, using a control-plane approved
// immutable binding. The existing preview endpoint accepts synthetic events.
func (a *Application) readLocation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Binding       location.Binding `json:"binding"`
		EventID       string           `json:"event_id"`
		RetentionDays int              `json:"retention_days"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	validID := regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString(input.EventID)
	if input.Binding.Validate() != nil || !validID || input.RetentionDays < 1 || input.RetentionDays > 36500 {
		respond(w, 422, map[string]string{"message": "invalid location read"})
		return
	}
	at := time.Now().UTC()
	event, err := a.Store.CommittedEvent(r.Context(), input.Binding.OrganizationUUID, input.Binding.DeviceUUID, input.EventID, at.AddDate(0, 0, -input.RetentionDays), at)
	if err != nil {
		respond(w, 503, map[string]string{"message": "location evidence unavailable"})
		return
	}
	if event == nil {
		respond(w, 200, map[string]any{"found": false})
		return
	}
	fix, err := location.Resolve(input.Binding, *event, at)
	if err != nil {
		respond(w, 503, map[string]string{"message": "location evidence invalid"})
		return
	}
	respond(w, 200, map[string]any{"found": true, "data": fix})
}

// Internal deterministic preview only. It does not authorize activation, mutate
// rule state, cache positions or emit any notification/device command.
func (a *Application) resolveLocation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Binding     location.Binding           `json:"binding"`
		Event       devices.CommittedTelemetry `json:"event"`
		EvaluatedAt time.Time                  `json:"evaluated_at"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	fix, err := location.Resolve(input.Binding, input.Event, input.EvaluatedAt)
	if err != nil {
		respond(w, 422, map[string]string{"error": err.Error()})
		return
	}
	respond(w, 200, fix)
}
