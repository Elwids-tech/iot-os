package app

import (
	"net/http"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
)

func (a *Application) simulateRule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Definition rules.Definition `json:"definition"`
		State      *rules.State     `json:"state"`
		Steps      []struct {
			At    time.Time                   `json:"at"`
			Event *devices.CommittedTelemetry `json:"event"`
		} `json:"steps"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	if len(input.Steps) < 1 || len(input.Steps) > 1000 {
		respond(w, 422, map[string]string{"error": "simulation requires 1–1000 steps"})
		return
	}
	compiled, err := rules.Compile(input.Definition)
	if err != nil {
		respond(w, 422, map[string]string{"error": err.Error()})
		return
	}
	state := compiled.Initial()
	if input.State != nil {
		state = *input.State
	}
	results := []rules.Result{}
	for _, step := range input.Steps {
		result, err := compiled.Step(state, step.Event, step.At)
		if err != nil {
			respond(w, 422, map[string]string{"error": err.Error()})
			return
		}
		results = append(results, result)
		state = result.State
	}
	respond(w, 200, map[string]any{"definition_hash": compiled.Hash, "results": results})
}
