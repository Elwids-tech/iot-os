package devices

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
)

// A committed event for adapter readings carries their provenance and must conform
// to telemetry.committed.v1 as the relay publishes it (spec 002 T030, SC-007).
func TestCommittedAdapterReadingsConformToTheContract(t *testing.T) {
	event := ProjectCommitted(adapterTelemetry(t))
	event.Sequence = "42" // the relay sets it from the outbox sequence (storage.CommittedPending)
	for _, r := range event.Readings {
		if r.InstallationUUID != meterInstallation || r.AdapterRevisionUUID != meterRevision || r.ManufacturerSerial != "WM-1042" {
			t.Fatalf("committed reading lacks adapter provenance: %+v", r)
		}
	}
	contractstest.AssertProduced(t, "events/v1/telemetry-committed.schema.json", event)
}

func TestCommittedProjectionMatchesSharedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/devices/v1/telemetry.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var input Telemetry
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	event := ProjectCommitted(input)
	event.Sequence = "1"
	actual, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := os.ReadFile("../../../../contracts/events/v1/telemetry-committed.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err = json.Unmarshal(actual, &a); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(expected, &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("committed projection differs from the contract fixture: %s", actual)
	}
}
