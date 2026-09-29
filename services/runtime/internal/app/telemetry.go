package app

import (
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/telemetry"
	"net/http"
)

func (a *Application) captureManager() *telemetry.Manager {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.captures == nil {
		a.captures = telemetry.New()
	}
	return a.captures
}
func (a *Application) listCaptures(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, map[string]any{"data": a.captureManager().List(r.URL.Query().Get("organization_uuid"))})
}
func (a *Application) getCapture(w http.ResponseWriter, r *http.Request) {
	s, ok := a.captureManager().Get(r.URL.Query().Get("organization_uuid"), r.PathValue("capture"))
	if !ok {
		respond(w, 422, map[string]string{"message": "Capture not found or expired. Runtime restart clears captures."})
		return
	}
	respond(w, 200, map[string]any{"data": s})
}
func (a *Application) startCapture(w http.ResponseWriter, r *http.Request) {
	var input struct {
		telemetry.Scope
		Seconds int `json:"duration_seconds"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	// The API resolves scope from authorized database records. Recheck the broker tenant here.
	a.mu.Lock()
	broker, ok := a.brokers[input.Connection]
	valid := ok && broker.Connection.OrganizationUUID == input.Organization
	a.mu.Unlock()
	if !valid {
		respond(w, 422, map[string]string{"message": "The selected gateway connection is not running."})
		return
	}
	s, err := a.captureManager().Start(storage.UUID(), input.Scope, input.Seconds)
	if err != nil {
		respond(w, 422, map[string]string{"message": err.Error()})
		return
	}
	respond(w, 201, map[string]any{"data": s})
}
func (a *Application) changeCapture(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Organization string `json:"organization_uuid"`
		Action       string `json:"action"`
	}
	if !decodeBody(w, r, &input) {
		return
	}
	manager := a.captureManager()
	s, ok := manager.Get(input.Organization, r.PathValue("capture"))
	if !ok {
		respond(w, 422, map[string]string{"message": "Capture not found or expired."})
		return
	}
	if s.Scope.Device != "" {
		unlock := a.lockDevice(s.Scope.Device)
		defer unlock()
		if input.Action == "suspend" {
			a.mu.Lock()
			d, active := a.definitions[s.Scope.Device]
			a.mu.Unlock()
			if !active || d.OrganizationUUID != input.Organization || d.Source.ConnectionUUID != s.Scope.Connection || d.Source.EdgeNodeID != s.Scope.Edge || s.Scope.SourceDevice == nil || d.Source.DeviceID != *s.Scope.SourceDevice {
				respond(w, 422, map[string]string{"message": "This device is no longer active on the captured source."})
				return
			}
		}
	}
	if err := manager.Change(input.Organization, s.ID, input.Action); err != nil {
		respond(w, 422, map[string]string{"message": err.Error()})
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
