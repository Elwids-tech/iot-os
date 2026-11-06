package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func TestStartupDelayBacksOffToTenSeconds(t *testing.T) {
	for attempt, want := range map[int]time.Duration{1: 500 * time.Millisecond, 2: time.Second, 3: 2 * time.Second, 5: 8 * time.Second, 6: 10 * time.Second, 100: 10 * time.Second} {
		if got := startupDelay(attempt); got != want {
			t.Errorf("startupDelay(%d) = %s, want %s", attempt, got, want)
		}
	}
}

// unresolvedTransport fails the first dials the way Docker's DNS does while a
// container is being recreated.
type unresolvedTransport struct {
	failures atomic.Int32
	next     http.RoundTripper
}

func (u *unresolvedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if u.failures.Add(-1) >= 0 {
		return nil, &net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "server misbehaving", Name: "api-web", Server: "127.0.0.11:53", IsTemporary: true}}
	}
	return u.next.RoundTrip(r)
}

func noDelay(int) time.Duration { return time.Millisecond }

func TestStartupWaitsForTheControlPlaneToAnswer(t *testing.T) {
	var served atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if served.Add(1) == 1 {
			// nginx is up before php-fpm behind it.
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = io.WriteString(w, `{"connections":[],"devices":[{"uuid":"device-1"}],"retention":[]}`)
	}))
	defer server.Close()
	transport := &unresolvedTransport{next: http.DefaultTransport}
	transport.failures.Store(2)
	control := &ControlClient{URL: server.URL, Token: strings.Repeat("t", 32), Client: &http.Client{Transport: transport}}
	var logs bytes.Buffer
	var state devices.ControlState
	attempts := 0
	err := awaitControlPlane(context.Background(), slog.New(slog.NewTextHandler(&logs, nil)), time.Minute, noDelay, func() error {
		attempts++
		return control.request(context.Background(), "GET", "/state", nil, &state)
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 4 || len(state.Devices) != 1 {
		t.Fatalf("attempts = %d, devices = %d; want 4 attempts and the fetched state", attempts, len(state.Devices))
	}
	if retries := strings.Count(logs.String(), "control plane not ready"); retries != 3 {
		t.Errorf("logged %d retries, want 3:\n%s", retries, logs.String())
	}
	if !strings.Contains(logs.String(), "server misbehaving") || !strings.Contains(logs.String(), "returned 502") {
		t.Errorf("retries should log their cause:\n%s", logs.String())
	}
}

func TestStartupStopsWaitingWhenRetryingCannotHelp(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	unavailable := &controlStatusError{Method: "GET", Path: "/state", Status: http.StatusServiceUnavailable}

	attempts := 0
	rejected := &controlStatusError{Method: "GET", Path: "/state", Status: http.StatusBadRequest}
	err := awaitControlPlane(context.Background(), logger, time.Minute, noDelay, func() error { attempts++; return rejected })
	if !errors.Is(err, rejected) || attempts != 1 {
		t.Errorf("a rejected request should fail at once, got %v after %d attempts", err, attempts)
	}

	attempts = 0
	err = awaitControlPlane(context.Background(), logger, 20*time.Millisecond, func(int) time.Duration { return 5 * time.Millisecond }, func() error { attempts++; return unavailable })
	if !errors.Is(err, unavailable) || attempts < 2 || attempts > 4 {
		t.Errorf("the wait should run out with the last error, got %v after %d attempts", err, attempts)
	}

	ctx, cancel := context.WithCancel(context.Background())
	attempts = 0
	err = awaitControlPlane(ctx, logger, 2*time.Hour, func(int) time.Duration { return time.Hour }, func() error {
		attempts++
		time.AfterFunc(10*time.Millisecond, cancel)
		return unavailable
	})
	if !errors.Is(err, context.Canceled) || attempts != 1 {
		t.Errorf("shutdown should end the wait, got %v after %d attempts", err, attempts)
	}
}

// The /state snapshot (internal.control-state.v1) carries each device's offline-alert
// settings; they apply unless their generation is lower than the one held, and a
// device without them uses the defaults (spec 018, T016).
func TestSyncStateAppliesConnectivitySettingsUnlessOlder(t *testing.T) {
	organization, connection := storage.UUID(), storage.UUID()
	define := func(edge string) devices.Definition {
		return devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: organization, ConfigurationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: connection, GroupID: "onboarding-" + organization, EdgeNodeID: edge}}
	}
	tuned, plain := define("box-1"), define("box-2")
	tracker := newConnectivityTracker(trackerStart, nil)
	tracker.define(tuned, trackerStart)
	tracker.define(plain, trackerStart)
	hour, poll := 3600, 300
	settings := devices.ConnectivitySettings{Generation: 4, Enabled: true, Style: styleConnectsReport, OfflineAfterSeconds: &hour, PollIntervalSeconds: &poll, GraceSeconds: 30}
	var snapshot atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(snapshot.Load())
	}))
	defer server.Close()
	a := &Application{ctx: context.Background(), Control: &ControlClient{URL: server.URL, Client: server.Client()}, connectivity: tracker, generations: map[string]int{}, brokers: map[string]*broker{}}
	sync := func(s devices.ConnectivitySettings) {
		t.Helper()
		snapshot.Store(devices.ControlState{Devices: []devices.DeviceState{
			{UUID: tuned.DeviceUUID, OrganizationUUID: organization, Generation: 1, DeploymentStatus: "applied", Applied: &tuned, Connectivity: &s},
			{UUID: plain.DeviceUUID, OrganizationUUID: organization, Generation: 1, DeploymentStatus: "applied", Applied: &plain},
		}})
		if err := a.syncState(); err != nil {
			t.Fatal(err)
		}
	}
	sync(settings)
	if got := tracker.devices[tuned.DeviceUUID].settings; got.Generation != 4 || got.Style != styleConnectsReport || *got.OfflineAfterSeconds != 3600 || *got.PollIntervalSeconds != 300 || got.GraceSeconds != 30 {
		t.Fatalf("applied %+v", got)
	}
	if got := tracker.devices[plain.DeviceUUID].settings; got != devices.DefaultConnectivity() {
		t.Fatalf("a device without settings uses %+v", got)
	}
	older := settings
	older.Generation, older.GraceSeconds = 3, 600
	sync(older)
	if got := tracker.devices[tuned.DeviceUUID].settings.GraceSeconds; got != 30 {
		t.Fatalf("an older generation applied: grace %d", got)
	}
	// Generations stay 0 until settings can be changed, so an equal one applies.
	equal := settings
	equal.GraceSeconds = 90
	sync(equal)
	if got := tracker.devices[tuned.DeviceUUID].settings.GraceSeconds; got != 90 {
		t.Fatalf("an equal generation was not applied: grace %d", got)
	}
}

// The runtime reads the snapshot and the settings message tolerantly: every case the
// contracts accept decodes into the settings the tracker applies.
func TestConnectivityContractsDecodeIntoTrackerSettings(t *testing.T) {
	check := func(name string, s devices.ConnectivitySettings) {
		t.Helper()
		if s.Style != styleStaysConnected && s.Style != styleConnectsReport || s.GraceSeconds < 0 || s.GraceSeconds > 3600 {
			t.Fatalf("%s: %+v", name, s)
		}
		tracker := newConnectivityTracker(trackerStart, nil)
		device := storage.UUID()
		tracker.define(devices.Definition{DeviceUUID: device, OrganizationUUID: storage.UUID()}, trackerStart)
		tracker.configure(device, s, trackerStart)
		if got := tracker.devices[device].settings; got.Generation != s.Generation || got.Enabled != s.Enabled || got.GraceSeconds != s.GraceSeconds {
			t.Fatalf("%s: applied %+v", name, got)
		}
	}
	for _, example := range consumable(t, "internal.control-state.v1") {
		var state devices.ControlState
		if err := storage.Decode(example.Data, &state); err != nil {
			t.Fatalf("%s: %v", example.Name, err)
		}
		for _, device := range state.Devices {
			if device.Connectivity == nil {
				t.Fatalf("%s: device %s has no settings", example.Name, device.UUID)
			}
			check(example.Name, *device.Connectivity)
		}
	}
	for _, example := range consumable(t, "device.connectivity-settings.v1") {
		var message struct {
			Type    string                       `json:"type"`
			Payload devices.ConnectivitySettings `json:"payload"`
		}
		if err := storage.Decode(example.Data, &message); err != nil || message.Type != "device.connectivity-settings.v1" {
			t.Fatalf("%s: %v %s", example.Name, err, message.Type)
		}
		check(example.Name, message.Payload)
	}
}

// GET /internal/connectivity answers for at most 500 of one organization's devices
// (spec 018, T017).
func TestConnectivityEndpointAnswersForOneOrganization(t *testing.T) {
	// The endpoint judges at the time it is asked.
	f := newTrackerFixtureAt(t, time.Now().UTC().Add(-time.Hour).Truncate(time.Second))
	box := f.device(f.direct, "box-1", "", settingsWith(styleStaysConnected, 0))
	quiet := f.device(f.direct, "box-2", "", settingsWith(styleStaysConnected, 0))
	for range 3 {
		f.report("box-1", "", box)
		f.run(time.Minute, tick)
	}
	other := storage.UUID()
	f.tr.define(devices.Definition{DeviceUUID: other, OrganizationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: f.conn, GroupID: "onboarding-x", EdgeNodeID: "box-9"}}, f.now)
	token := strings.Repeat("t", 32)
	a := &Application{Control: &ControlClient{Token: token}, connectivity: f.tr}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	get := func(query string, authorized bool) (int, map[string]any) {
		t.Helper()
		request, _ := http.NewRequest("GET", server.URL+"/internal/connectivity?"+query, nil)
		if authorized {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body := map[string]any{}
		_ = json.NewDecoder(response.Body).Decode(&body)
		return response.StatusCode, body
	}
	status, body := get("organization="+f.org+"&devices="+box+","+quiet+","+other, true)
	if status != 200 {
		t.Fatalf("status %d %v", status, body)
	}
	listed := body["devices"].([]any)
	if len(listed) != 2 {
		t.Fatalf("another organization's device was answered for: %v", listed)
	}
	states := map[string]map[string]any{}
	for _, item := range listed {
		entry := item.(map[string]any)
		states[entry["device_uuid"].(string)] = entry
	}
	if s := states[box]; s["state"] != "monitored" || s["reporting_interval_seconds"] != float64(60) || s["offline_after_seconds"] != float64(900) || s["offline_after_automatic"] != true || s["readings_counted"] != float64(3) || s["interruption"] != nil || s["last_heard_at"] == nil || s["anchor_at"] == nil {
		t.Fatalf("box %v", s)
	}
	if s := states[quiet]; s["state"] != "waiting" || s["last_heard_at"] != nil || s["offline_after_seconds"] != nil {
		t.Fatalf("quiet %v", s)
	}
	for _, c := range []struct {
		query      string
		authorized bool
		status     int
	}{
		{"devices=" + box, true, 422},
		{"organization=" + f.org + "&devices=" + strings.TrimSuffix(strings.Repeat(box+",", 501), ","), true, 422},
		{"organization=" + f.org + "&devices=" + box, false, 401},
	} {
		if status, _ := get(c.query, c.authorized); status != c.status {
			t.Errorf("%s: status %d, want %d", c.query, status, c.status)
		}
	}
}
