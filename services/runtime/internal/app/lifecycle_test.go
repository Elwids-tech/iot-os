package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

func lifecycleFixture(t *testing.T) (*Application, devices.Definition) {
	t.Helper()
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires disposable runtime database")
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		t.Fatal("refusing non-test database")
	}
	ctx := context.Background()
	store, err := storage.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	d := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: storage.UUID(), ConfigurationUUID: storage.UUID()}
	a := &Application{ctx: ctx, Store: store, Engine: sparkplug.NewEngine(), definitions: map[string]devices.Definition{d.DeviceUUID: d}, generations: map[string]int{d.DeviceUUID: 1}, latest: map[string]map[string]devices.Reading{}, sessions: map[string]string{d.DeviceUUID: "old"}, compatible: map[string]bool{d.DeviceUUID: true}, reviewRequired: map[string]bool{}, presenceAt: map[string]time.Time{}, pending: map[string]*pendingCommand{}, brokers: map[string]*broker{}}
	if err = store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"observations", "diagnostics", "latest", "commands", "devices"} {
			_, _ = store.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", d.OrganizationUUID)
		}
		_, _ = store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1", d.OrganizationUUID)
		store.Pool.Close()
	})
	return a, d
}

func TestDeactivationFencesCachesTelemetryCommandsAndStaleReconciliation(t *testing.T) {
	a, d := lifecycleFixture(t)
	ctx := context.Background()
	packet := devices.Telemetry{UUID: storage.UUID(), Generation: 1, Definition: d, Readings: []devices.Reading{{ParameterUUID: storage.UUID(), Quality: "good", DataType: "number", Value: 50, ReceivedAt: time.Now().UTC(), ObservedAt: time.Now().UTC()}}}
	if err := a.Store.Persist(ctx, packet); err != nil {
		t.Fatal(err)
	}
	if err := a.deactivate(d.DeviceUUID, d.OrganizationUUID, 2, "operation-off"); err != nil {
		t.Fatal(err)
	}
	if _, ok := a.definitions[d.DeviceUUID]; ok {
		t.Fatal("definition still enabled")
	}
	if _, ok := a.sessions[d.DeviceUUID]; ok {
		t.Fatal("session cache not removed")
	}
	packet.UUID = storage.UUID()
	if err := a.Store.Persist(ctx, packet); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := a.Store.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.observations WHERE device_uuid=$1", d.DeviceUUID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("inactive ingestion: %d %v", count, err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(devices.ControlState{Devices: []devices.DeviceState{{UUID: d.DeviceUUID, OrganizationUUID: d.OrganizationUUID, Generation: 1, Applied: &d, DeploymentStatus: "applied"}}})
	}))
	defer server.Close()
	a.Control = &ControlClient{URL: server.URL, Client: server.Client()}
	if err := a.syncState(); err != nil {
		t.Fatal(err)
	}
	if _, ok := a.definitions[d.DeviceUUID]; ok {
		t.Fatal("stale API snapshot resurrected inactive device")
	}
	command := devices.Command{UUID: storage.UUID(), OrganizationUUID: d.OrganizationUUID, DeviceUUID: d.DeviceUUID, ConfigurationUUID: d.ConfigurationUUID, ParameterUUID: storage.UUID(), Generation: 1, ExpiresAt: time.Now().Add(time.Minute)}
	if err := a.dispatch(command); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := a.Store.Pool.QueryRow(ctx, "SELECT status FROM device_runtime.commands WHERE command_uuid=$1", command.UUID).Scan(&status); err != nil || status != "cancelled" {
		t.Fatalf("queued command not cancelled: %s %v", status, err)
	}
	if err := a.activate(d, 3, "operation-on"); err != nil {
		t.Fatal(err)
	}
	if _, ok := a.definitions[d.DeviceUUID]; ok {
		t.Fatal("offline activation enabled device")
	}
	if a.generations[d.DeviceUUID] != 3 {
		t.Fatal("failed activation did not advance fence")
	}
	if err := a.activate(d, 3, "operation-on"); err != nil {
		t.Fatal(err)
	}
	saved, err := a.Store.SavedDevices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved[d.DeviceUUID].Generation != 3 || saved[d.DeviceUUID].Applied != nil {
		t.Fatal("restart would restore wrong state")
	}
}

func TestDeviceFenceBlocksTransitionUntilProcessingBoundaryAndSeparatesDevices(t *testing.T) {
	a := &Application{}
	release := a.lockDevice("first")
	entered := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(1)
	go func() { defer wait.Done(); unlock := a.lockDevice("first"); close(entered); unlock() }()
	select {
	case <-entered:
		t.Fatal("transition bypassed processing fence")
	case <-time.After(20 * time.Millisecond):
	}
	other := a.lockDevice("other")
	other()
	release()
	wait.Wait()
}
