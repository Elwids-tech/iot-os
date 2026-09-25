package app

import (
	"net/http"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
)

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
