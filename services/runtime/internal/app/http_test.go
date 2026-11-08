package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func latestBatch(t *testing.T, a *Application, token, org string, devices ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/measurements/latest-batch?organization_uuid="+org+"&devices="+strings.Join(devices, ","), nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, req)
	return response
}

// The batch read is internal: it needs the control token, refuses the whole request
// when a device the runtime serves belongs to another organization, and rejects a
// malformed device list before touching storage.
func TestLatestBatchRefusesUnauthenticatedForeignAndMalformedRequests(t *testing.T) {
	d := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: storage.UUID(), ConfigurationUUID: storage.UUID()}
	a := &Application{Control: &ControlClient{Token: "batch-test-token"}, definitions: map[string]devices.Definition{d.DeviceUUID: d}, compatible: map[string]bool{}, activeSince: map[string]time.Time{}}
	if response := latestBatch(t, a, "", d.OrganizationUUID, d.DeviceUUID); response.Code != 401 {
		t.Fatalf("expected 401 without the control token, got %d", response.Code)
	}
	if response := latestBatch(t, a, "batch-test-token", storage.UUID(), d.DeviceUUID); response.Code != 404 {
		t.Fatalf("expected 404 for a device of another organization, got %d %s", response.Code, response.Body.String())
	}
	many := make([]string, 101)
	for i := range many {
		many[i] = storage.UUID()
	}
	for name, list := range map[string][]string{"empty": {}, "101 devices": many, "a repeat": {d.DeviceUUID, d.DeviceUUID}, "not a uuid": {"meter-001"}} {
		if response := latestBatch(t, a, "batch-test-token", d.OrganizationUUID, list...); response.Code != 422 {
			t.Fatalf("%s: expected 422, got %d %s", name, response.Code, response.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/internal/measurements/latest-batch?organization_uuid="+storage.UUID()+"&devices[]="+d.DeviceUUID, nil)
	req.Header.Set("Authorization", "Bearer batch-test-token")
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, req)
	if response.Code != 404 {
		t.Fatalf("devices[] must be read like the comma list: got %d", response.Code)
	}
}

// One request: an active device gets latestHTTP's downgrades and presence, a device
// the runtime no longer serves is marked inactive, and a device with nothing retained
// answers with no readings rather than a value.
func TestLatestBatchMarksInactiveDevicesAndDowngradesActiveOnes(t *testing.T) {
	a := driftApplication(t)
	ctx := a.ctx
	volt := "V"
	parameter := storage.UUID()
	profile := devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{{UUID: parameter, Key: "voltage", Label: "Voltage", Kind: "measurement", DataType: "number", Unit: &volt}}}
	canonical, _ := json.Marshal(profile)
	sum := sha256.Sum256(canonical)
	org := storage.UUID()
	active := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: storage.UUID(), OrganizationUUID: org, ConfigurationUUID: storage.UUID(), ProfileCanonicalJSON: string(canonical), ProfileHash: hex.EncodeToString(sum[:])}
	inactive := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: storage.UUID(), OrganizationUUID: org, ConfigurationUUID: storage.UUID(), ProfileCanonicalJSON: string(canonical), ProfileHash: hex.EncodeToString(sum[:])}
	silent := storage.UUID()
	t.Cleanup(func() {
		purgeDevice(t, a.Store, active.DeviceUUID)
		purgeDevice(t, a.Store, inactive.DeviceUUID)
	})
	now := time.Now().UTC().Truncate(time.Microsecond)
	for _, d := range []devices.Definition{active, inactive} {
		if err := a.Store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
			t.Fatal(err)
		}
		reading := devices.Reading{ParameterUUID: parameter, Key: "voltage", Label: "Voltage", DataType: "number", Unit: &volt, Value: 230, Quality: "good", ObservedAt: now, ReceivedAt: now}
		if err := a.Store.Persist(ctx, devices.Telemetry{Generation: 1, UUID: storage.UUID(), Definition: d, SessionID: "s", Readings: []devices.Reading{reading}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Store.Apply(ctx, devices.Definition{DeviceUUID: inactive.DeviceUUID, OrganizationUUID: org}, 2, "device.deactivated.v1"); err != nil {
		t.Fatal(err)
	}
	a.definitions[active.DeviceUUID] = active
	a.compatible[active.DeviceUUID] = true
	a.activeSince = map[string]time.Time{active.DeviceUUID: now.Add(-time.Minute)}

	req := httptest.NewRequest(http.MethodGet, "/internal/measurements/latest-batch?organization_uuid="+org+"&devices="+strings.Join([]string{active.DeviceUUID, inactive.DeviceUUID, silent}, ","), nil)
	response := httptest.NewRecorder()
	a.latestBatchHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Data map[string]struct {
			Data              []devices.Reading `json:"data"`
			Presence          string            `json:"presence"`
			ConfigurationUUID string            `json:"configuration_uuid"`
			Processing        string            `json:"processing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 3 {
		t.Fatalf("expected an entry per requested device, got %v", body.Data)
	}
	got := body.Data[active.DeviceUUID]
	// The engine has no session for the source, so the retained good value is stale.
	if got.Presence != "offline" || got.ConfigurationUUID != active.ConfigurationUUID || got.Processing != "" || len(got.Data) != 1 || got.Data[0].Quality != "stale" || got.Data[0].Diagnostic != "Waiting for a current compatible source session." {
		t.Fatalf("active device: %+v", got)
	}
	got = body.Data[inactive.DeviceUUID]
	if got.Presence != "unknown" || got.ConfigurationUUID != "" || got.Processing != "inactive" || len(got.Data) != 1 || got.Data[0].Quality != "inactive" || fmt.Sprint(got.Data[0].Value) != "230" {
		t.Fatalf("inactive device: %+v", got)
	}
	got = body.Data[silent]
	if got.Presence != "unknown" || got.Processing != "inactive" || len(got.Data) != 0 {
		t.Fatalf("silent device: %+v", got)
	}

	// The single read's answer for the active device is the batch's entry.
	single := httptest.NewRecorder()
	a.latestHTTP(single, httptest.NewRequest(http.MethodGet, "/internal/measurements/latest?organization_uuid="+org+"&device_uuid="+active.DeviceUUID, nil))
	var one struct {
		Data     []devices.Reading `json:"data"`
		Presence string            `json:"presence"`
	}
	if err := json.Unmarshal(single.Body.Bytes(), &one); err != nil || single.Code != 200 {
		t.Fatal(single.Code, err)
	}
	if one.Presence != body.Data[active.DeviceUUID].Presence || len(one.Data) != 1 || one.Data[0].Quality != body.Data[active.DeviceUUID].Data[0].Quality || one.Data[0].Diagnostic != body.Data[active.DeviceUUID].Data[0].Diagnostic {
		t.Fatalf("single read %+v differs from the batch entry %+v", one, body.Data[active.DeviceUUID])
	}
}

// The status report carries the telemetry stream counters (spec 030, T056) and
// degrades each subsystem separately when nothing is connected.
func TestStatusReportsStreamCounters(t *testing.T) {
	a := &Application{Control: &ControlClient{Token: "status-test-token"}}
	a.streamsOpen.Store(3)
	a.broadcaster.dropped.Store(2)
	req := httptest.NewRequest(http.MethodGet, "/internal/status", nil)
	req.Header.Set("Authorization", "Bearer status-test-token")
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("expected 200, got %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Storage   string `json:"storage"`
		Messaging string `json:"messaging"`
		Streams   struct {
			Open    int64  `json:"open"`
			Dropped uint64 `json:"dropped"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Storage != "unavailable" || body.Messaging != "disconnected" || body.Streams.Open != 3 || body.Streams.Dropped != 2 {
		t.Fatalf("status: %s", response.Body.String())
	}
}
