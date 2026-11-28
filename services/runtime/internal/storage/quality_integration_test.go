package storage

import (
	"fmt"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// Spec 038, research R4: an uncertain value is a stored data point that becomes the
// latest value; a value its source called bad is a diagnostic whose latest value is
// unknown, not the last valid one; any other invalid reading keeps the last valid value.
func TestSourceQualityInStorageAndLatest(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	bad, uncertain, failed := UUID(), UUID(), UUID()
	at := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	persist := func(when time.Time, readings ...devices.Reading) {
		t.Helper()
		for i := range readings {
			readings[i].DataType, readings[i].ObservedAt, readings[i].ReceivedAt, readings[i].TimestampSource = "number", when, when, "server"
		}
		if err := store.Persist(ctx, devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "quality", Readings: readings}); err != nil {
			t.Fatal(err)
		}
	}
	persist(at, devices.Reading{ParameterUUID: bad, Value: 21.0, Quality: "good"}, devices.Reading{ParameterUUID: uncertain, Value: 21.0, Quality: "good"}, devices.Reading{ParameterUUID: failed, Value: 21.0, Quality: "good"})
	persist(at.Add(time.Second),
		devices.Reading{ParameterUUID: bad, Quality: "invalid", Diagnostic: "No communication with the device", SourceBad: true},
		devices.Reading{ParameterUUID: uncertain, Value: 22.5, Quality: "uncertain", Diagnostic: "Uncertain value (UncertainLastUsableValue)"},
		devices.Reading{ParameterUUID: failed, Quality: "invalid", Diagnostic: "value is out of range"},
	)
	latest, err := store.Latest(ctx, organization, definition.DeviceUUID, definition.ConfigurationUUID)
	if err != nil {
		t.Fatal(err)
	}
	byParameter := map[string]devices.Reading{}
	for _, r := range latest {
		byParameter[r.ParameterUUID] = r
	}
	if r := byParameter[bad]; r.Quality != "invalid" || r.Value != nil || r.Diagnostic != "No communication with the device" {
		t.Fatalf("a bad value kept a value: %#v", r)
	}
	if r := byParameter[uncertain]; r.Quality != "uncertain" || fmt.Sprint(r.Value) != "22.5" {
		t.Fatalf("an uncertain value was not the latest: %#v", r)
	}
	if r := byParameter[failed]; r.Quality != "invalid" || fmt.Sprint(r.Value) != "21" {
		t.Fatalf("an invalid value lost the last valid one: %#v", r)
	}
	var observations int
	if err := store.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.observations WHERE organization_uuid=$1 AND parameter_uuid=$2", organization, uncertain).Scan(&observations); err != nil || observations != 2 {
		t.Fatalf("an uncertain value is a data point: %d %v", observations, err)
	}
}
