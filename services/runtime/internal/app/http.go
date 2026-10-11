package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // counter buckets resolve IANA zones without OS tzdata

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
)

func (a *Application) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if !a.NATS.IsConnected() || !a.rulesHealthy.Load() || a.Store.Pool.Ping(r.Context()) != nil {
			respond(w, 503, map[string]any{"ok": false, "workflows": a.rulesStatus()})
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	internal := http.NewServeMux()
	internal.HandleFunc("GET /internal/telemetry/captures", a.listCaptures)
	internal.HandleFunc("POST /internal/telemetry/captures", a.startCapture)
	internal.HandleFunc("GET /internal/telemetry/captures/{capture}", a.getCapture)
	internal.HandleFunc("POST /internal/telemetry/captures/{capture}", a.changeCapture)
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
	internal.HandleFunc("GET /internal/telemetry/committed-status", a.committedStatus)
	internal.HandleFunc("POST /internal/locations/resolve", a.resolveLocation)
	internal.HandleFunc("POST /internal/locations/read", a.readLocation)
	internal.HandleFunc("POST /internal/locations/map", a.locationMap)
	internal.HandleFunc("POST /internal/rules/simulate", a.simulateRule)
	internal.HandleFunc("POST /internal/workflows/compile", a.compileWorkflow)
	internal.HandleFunc("GET /internal/dag/node-types", a.dagRegistry)
	internal.HandleFunc("GET /internal/dag/health", a.dagHealth)
	internal.HandleFunc("POST /internal/dag/compile", a.compileDAG)
	internal.HandleFunc("POST /internal/dag/simulate", a.simulateDAG)
	internal.HandleFunc("GET /internal/dag/execution", a.dagExecution)
	internal.HandleFunc("GET /internal/dag/timeline", a.dagTimeline)
	internal.HandleFunc("GET /internal/workflows/execution", a.ruleExecution)
	internal.HandleFunc("GET /internal/workflows/location-overview", a.workflowLocationOverview)
	internal.HandleFunc("GET /internal/rules/node-types", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, rules.NodeTypes()) })
	internal.HandleFunc("GET /internal/measurements/history", a.historyHTTP)
	internal.HandleFunc("GET /internal/measurements/records", a.historyRecordsHTTP)
	internal.HandleFunc("GET /internal/measurements/state-history", a.stateHistoryHTTP)
	internal.HandleFunc("GET /internal/measurements/increase", a.counterIncreaseHTTP)
	internal.HandleFunc("GET /internal/status", a.statusHTTP)
	internal.HandleFunc("POST /internal/rules/checkpoint/rebaseline", a.rebaselineRules)
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

// statusHTTP reports each subsystem separately so the portal can explain partial
// outages instead of treating the whole runtime as unavailable.
func (a *Application) statusHTTP(w http.ResponseWriter, r *http.Request) {
	storageState, messaging := "ok", "ok"
	if a.Store.Pool.Ping(r.Context()) != nil {
		storageState = "unavailable"
	}
	if !a.NATS.IsConnected() {
		messaging = "disconnected"
	}
	a.mu.Lock()
	connected, total := 0, len(a.brokers)
	for _, b := range a.brokers {
		if b.Client.IsConnectionOpen() {
			connected++
		}
	}
	a.mu.Unlock()
	respond(w, 200, map[string]any{"storage": storageState, "messaging": messaging, "workflows": a.rulesStatus(), "brokers": map[string]int{"connected": connected, "total": total}})
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
	carried, e := a.Store.LatestAcross(r.Context(), org, id, d.ConfigurationUUID)
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
	// A new configuration starts with no latest rows. Keep showing the previous
	// configuration's value, marked stale, while the parameter keeps its data
	// type and unit; drop parameters the new configuration no longer has.
	readings := []devices.Reading{}
	for _, c := range carried {
		if c.ConfigurationUUID != d.ConfigurationUUID {
			p, ok := params[c.Reading.ParameterUUID]
			if !ok || p.DataType != c.Reading.DataType || !sameUnit(p.Unit, c.Reading.Unit) {
				continue
			}
			if c.Reading.Quality == "good" {
				c.Reading.Quality = "stale"
				c.Reading.Diagnostic = "Retained from the previous configuration; waiting for telemetry."
			}
		}
		readings = append(readings, c.Reading)
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
	from, to, rangeError := historyWindow(q)
	maxPoints, _ := strconv.Atoi(q.Get("max_points"))
	if maxPoints == 0 {
		maxPoints = 500
	}
	if rangeError != nil || maxPoints < 10 || maxPoints > 1000 {
		respond(w, 422, map[string]string{"message": "invalid history range"})
		return
	}
	if !to.After(from) {
		respond(w, 200, map[string]any{"data": []any{}})
		return
	}
	options := storage.HistoryOptions{ObservedTime: q.Get("time_basis") == "observed", MergeConfigurations: q.Get("merge_configurations") == "1"}
	series, e := a.Store.History(r.Context(), q.Get("organization_uuid"), q.Get("device_uuid"), q.Get("parameter_uuid"), from, to, maxPoints, options)
	if e != nil {
		if errors.Is(e, storage.ErrHistoryTooBroad) {
			respond(w, 422, map[string]string{"message": e.Error()})
			return
		}
		a.Logger.Warn("history query failed", "error", e)
		if storage.IsQueryTimeout(e) {
			respond(w, 504, map[string]string{"message": rangeTooSlow})
			return
		}
		respond(w, 503, map[string]string{"message": "measurement history is unavailable"})
		return
	}
	respond(w, 200, map[string]any{"data": series, "from": from, "to": to, "max_points": maxPoints})
}

func historyWindow(q url.Values) (time.Time, time.Time, error) {
	from, fromError := time.Parse(time.RFC3339, q.Get("from"))
	to, toError := time.Parse(time.RFC3339, q.Get("to"))
	days, daysError := strconv.Atoi(q.Get("retention_days"))
	if fromError != nil || toError != nil || daysError != nil || days < 1 || days > 36500 || !to.After(from) {
		return time.Time{}, time.Time{}, errors.New("invalid history range")
	}
	now := time.Now().UTC()
	cutoff := now.AddDate(0, 0, -days)
	if from.Before(cutoff) {
		from = cutoff
	}
	if to.After(now) {
		to = now
	}
	return from, to, nil
}

func historyCursorScope(q url.Values, limit int) string {
	scope := strings.Join([]string{
		q.Get("organization_uuid"),
		q.Get("device_uuid"),
		q.Get("parameter_uuid"),
		q.Get("from"),
		q.Get("to"),
		strconv.Itoa(limit),
	}, "\x00")
	digest := sha256.Sum256([]byte(scope))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func decodeHistoryCursor(value, secret string) (*storage.HistoryCursor, error) {
	if value == "" {
		return nil, nil
	}
	payload, signature, ok := strings.Cut(value, ".")
	if !ok || payload == "" || signature == "" {
		return nil, errors.New("invalid cursor")
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	provided, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return nil, errors.New("invalid cursor")
	}
	var cursor storage.HistoryCursor
	if err = json.Unmarshal(raw, &cursor); err != nil || cursor.At.IsZero() || cursor.EventUUID == "" || len(cursor.EventUUID) > 64 || cursor.Consumed < 0 || cursor.Scope == "" {
		return nil, errors.New("invalid cursor")
	}
	return &cursor, nil
}

func encodeHistoryCursor(cursor *storage.HistoryCursor, secret string) string {
	if cursor == nil {
		return ""
	}
	raw, _ := json.Marshal(cursor)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *Application) historyRecordsHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, rangeError := historyWindow(q)
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit == 0 {
		limit = 500
	}
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if pageSize == 0 {
		pageSize = 50
	}
	scope := historyCursorScope(q, limit)
	cursor, cursorError := decodeHistoryCursor(q.Get("cursor"), a.Control.Token)
	if rangeError != nil || cursorError != nil || limit < 1 || limit > 5000 || pageSize < 1 || pageSize > 100 || (cursor != nil && (cursor.Consumed >= limit || cursor.Scope != scope)) {
		respond(w, 422, map[string]string{"message": "invalid history record request"})
		return
	}
	if !to.After(from) {
		respond(w, 200, map[string]any{"data": []any{}, "meta": map[string]any{"from": from, "to": to, "limit": limit, "page_size": pageSize, "returned": 0, "consumed": 0, "next_cursor": nil, "has_more": false, "limit_reached": false}})
		return
	}
	page, err := a.Store.HistoryRecords(r.Context(), q.Get("organization_uuid"), q.Get("device_uuid"), q.Get("parameter_uuid"), from, to, limit, pageSize, cursor)
	if err != nil {
		a.Logger.Warn("history records query failed", "error", err)
		respond(w, 503, map[string]string{"message": "measurement records are unavailable"})
		return
	}
	if page.Next != nil {
		page.Next.Scope = scope
	}
	next := encodeHistoryCursor(page.Next, a.Control.Token)
	var nextValue any
	if next != "" {
		nextValue = next
	}
	respond(w, 200, map[string]any{
		"data": page.Records,
		"meta": map[string]any{
			"from": from, "to": to, "limit": limit, "page_size": pageSize,
			"returned": len(page.Records), "consumed": page.Consumed,
			"next_cursor": nextValue, "has_more": next != "", "limit_reached": page.LimitReached,
		},
	})
}

// rangeTooSlow explains a range read cut off at its statement limit; a shorter
// range reads fewer readings.
const rangeTooSlow = "This range has too many readings to load in time. Choose a shorter range."

func (a *Application) stateHistoryHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, rangeError := historyWindow(q)
	maxPoints, _ := strconv.Atoi(q.Get("max_points"))
	if maxPoints == 0 {
		maxPoints = 500
	}
	if rangeError != nil || maxPoints < 10 || maxPoints > 500 {
		respond(w, 422, map[string]string{"message": "invalid state history request"})
		return
	}
	if !to.After(from) {
		respond(w, 200, map[string]any{"data": storage.StateHistory{From: from, To: to, Durations: []storage.StateDuration{}, Timeline: []storage.StateSegment{}}})
		return
	}
	history, err := a.Store.StateHistory(r.Context(), q.Get("organization_uuid"), q.Get("device_uuid"), q.Get("parameter_uuid"), from, to, maxPoints)
	if err != nil {
		a.Logger.Warn("state history query failed", "error", err)
		if storage.IsQueryTimeout(err) {
			respond(w, 504, map[string]string{"message": rangeTooSlow})
			return
		}
		respond(w, 503, map[string]string{"message": "state history is unavailable"})
		return
	}
	respond(w, 200, map[string]any{"data": history})
}

// counterIncreaseHTTP reports counter consumption per calendar bucket in an IANA
// time zone, for example daily energy in the site's local days.
func (a *Application) counterIncreaseHTTP(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, rangeError := historyWindow(q)
	bucket := q.Get("bucket")
	_, bucketOK := storage.CounterBuckets[bucket]
	location, locationError := time.LoadLocation(q.Get("timezone"))
	var rolloverAt *float64
	if raw := q.Get("rollover_at"); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value <= 0 || math.IsInf(value, 0) || math.IsNaN(value) {
			rangeError = errors.New("invalid rollover")
		}
		rolloverAt = &value
	}
	if rangeError != nil || !bucketOK || locationError != nil || q.Get("timezone") == "" {
		respond(w, 422, map[string]string{"message": "invalid counter increase request"})
		return
	}
	if !to.After(from) {
		respond(w, 200, map[string]any{"data": storage.CounterIncrease{From: from, To: to, Bucket: bucket, Timezone: location.String(), Points: []storage.IncreasePoint{}}})
		return
	}
	if storage.BucketEnd(from, bucket).Sub(from)*2000 < to.Sub(from) {
		respond(w, 422, map[string]string{"message": storage.ErrHistoryTooBroad.Error()})
		return
	}
	increase, err := a.Store.CounterIncrease(r.Context(), q.Get("organization_uuid"), q.Get("device_uuid"), q.Get("parameter_uuid"), from, to, bucket, location, rolloverAt)
	if err != nil {
		if errors.Is(err, storage.ErrHistoryTooBroad) || errors.Is(err, storage.ErrCounterUnitChanged) {
			respond(w, 422, map[string]string{"message": err.Error()})
			return
		}
		a.Logger.Warn("counter increase query failed", "error", err)
		if storage.IsQueryTimeout(err) {
			respond(w, 504, map[string]string{"message": rangeTooSlow})
			return
		}
		respond(w, 503, map[string]string{"message": "counter consumption is unavailable"})
		return
	}
	respond(w, 200, map[string]any{"data": increase})
}

func sameUnit(a, b *string) bool {
	return (a == nil || *a == "") && (b == nil || *b == "") || a != nil && b != nil && *a == *b
}
