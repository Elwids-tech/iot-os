package app

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"net/http"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func (a *Application) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if !a.NATS.IsConnected() || a.Store.Pool.Ping(r.Context()) != nil {
			respond(w, 503, map[string]bool{"ok": false})
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	internal := http.NewServeMux()
	internal.HandleFunc("POST /internal/validate", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Definition devices.Definition `json:"definition"`
			Metrics    []devices.Metric   `json:"metrics"`
		}
		if !decodeBody(w, r, &request) {
			return
		}
		readings, e := devices.Preview(request.Definition, request.Metrics)
		if e != nil {
			respond(w, 422, map[string]string{"message": e.Error()})
			return
		}
		respond(w, 200, map[string]any{"valid": true, "readings": readings})
	})
	internal.HandleFunc("POST /internal/command-check", func(w http.ResponseWriter, r *http.Request) {
		var c devices.Command
		if !decodeBody(w, r, &c) {
			return
		}
		check, _, e := a.commandCheck(c)
		if e != nil {
			respond(w, 422, map[string]string{"message": e.Error()})
			return
		}
		respond(w, 200, check)
	})
	internal.HandleFunc("GET /internal/measurements/latest", a.latestHTTP)
	internal.HandleFunc("GET /internal/measurements/history", a.historyHTTP)
	mux.Handle("/internal/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := "Bearer " + a.Control.Token
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) != 1 {
			respond(w, 401, map[string]string{"message": "unauthorized"})
			return
		}
		internal.ServeHTTP(w, r)
	}))
	return mux
}
func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	decoder.UseNumber()
	if e := decoder.Decode(target); e != nil {
		respond(w, 400, map[string]string{"message": "invalid request body"})
		return false
	}
	return true
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *Application) latestHTTP(w http.ResponseWriter, r *http.Request) {
	unlock := a.lockDevice(r.URL.Query().Get("device_uuid"))
	defer unlock()
	org, id := r.URL.Query().Get("organization_uuid"), r.URL.Query().Get("device_uuid")
	a.mu.Lock()
	d, exists := a.definitions[id]
	compatible := a.compatible[id]
	activeSince := a.activeSince[id]
	a.mu.Unlock()
	if !exists {
		configuration := r.URL.Query().Get("configuration_uuid")
		if configuration == "" {
			respond(w, 200, map[string]any{"data": []devices.Reading{}, "presence": "unknown"})
			return
		}
		readings, err := a.Store.Latest(r.Context(), org, id, configuration)
		if err != nil {
			respond(w, 503, map[string]string{"message": "measurement storage unavailable"})
			return
		}
		for i := range readings {
			readings[i].Quality = "inactive"
			readings[i].Diagnostic = "Ingestion is disabled; retained last valid reading."
		}
		respond(w, 200, map[string]any{"data": readings, "presence": "unknown", "processing": "inactive"})
		return
	}
	if d.OrganizationUUID != org {
		respond(w, 404, map[string]string{"message": "device not found"})
		return
	}
	readings, e := a.Store.Latest(r.Context(), org, id, d.ConfigurationUUID)
	if e != nil {
		respond(w, 503, map[string]string{"message": "measurement storage is unavailable"})
		return
	}
	_, _, online := a.Engine.Snapshot(d.Source)
	presence := "offline"
	if online {
		presence = "online"
	}
	profile, e := devices.ParseProfile(d)
	if e != nil {
		respond(w, 503, map[string]string{"message": "profile unavailable"})
		return
	}
	params := map[string]devices.Parameter{}
	for _, p := range profile.Parameters {
		params[p.UUID] = p
	}
	for i := range readings {
		p := params[readings[i].ParameterUUID]
		if readings[i].Quality == "good" {
			if readings[i].ReceivedAt.Before(activeSince) {
				readings[i].Quality = "stale"
				readings[i].Diagnostic = "Retained reading; waiting for telemetry after activation."
			} else if !online || !compatible {
				readings[i].Quality = "stale"
				readings[i].Diagnostic = "Waiting for a current compatible source session."
			} else if p.Reporting != nil && p.Reporting.StaleAfterSeconds > 0 && time.Since(readings[i].ReceivedAt) > time.Duration(p.Reporting.StaleAfterSeconds)*time.Second {
				readings[i].Quality = "stale"
				readings[i].Diagnostic = "The parameter’s freshness interval has elapsed."
			}
		}
	}
	respond(w, 200, map[string]any{"data": readings, "presence": presence, "configuration_uuid": d.ConfigurationUUID})
}
func (a *Application) historyHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, e1 := time.Parse(time.RFC3339, q.Get("from"))
	to, e2 := time.Parse(time.RFC3339, q.Get("to"))
	days, e3 := strconv.Atoi(q.Get("retention_days"))
	maxPoints, _ := strconv.Atoi(q.Get("max_points"))
	if maxPoints == 0 {
		maxPoints = 500
	}
	if e1 != nil || e2 != nil || e3 != nil || days < 1 || days > 36500 || !to.After(from) || maxPoints < 10 || maxPoints > 1000 {
		respond(w, 422, map[string]string{"message": "invalid history range"})
		return
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -days)
	if from.Before(cutoff) {
		from = cutoff
	}
	if to.After(time.Now()) {
		to = time.Now().UTC()
	}
	if !to.After(from) {
		respond(w, 200, map[string]any{"data": []any{}})
		return
	}
	series, e := a.Store.History(r.Context(), q.Get("organization_uuid"), q.Get("device_uuid"), q.Get("parameter_uuid"), from, to, maxPoints)
	if e != nil {
		if errors.Is(e, storage.ErrHistoryTooBroad) {
			respond(w, 422, map[string]string{"message": e.Error()})
			return
		}
		a.Logger.Warn("history query failed", "error", e)
		respond(w, 503, map[string]string{"message": "measurement history is unavailable"})
		return
	}
	respond(w, 200, map[string]any{"data": series, "from": from, "to": to, "max_points": maxPoints})
}
