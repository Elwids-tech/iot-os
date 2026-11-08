package devices

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
)

// The stream projection of the committed fixture is the telemetry-stream.v1 fixture,
// and conforms to the contract as written (spec 030, T036).
func TestStreamProjectionMatchesTheContractFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/events/v1/telemetry-committed.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var committed CommittedTelemetry
	if err = json.Unmarshal(raw, &committed); err != nil {
		t.Fatal(err)
	}
	event := ProjectStream(committed, 42)
	if event.SchemaVersion != "telemetry-stream.v1" || event.Position != "42" {
		t.Fatalf("unexpected header: %+v", event)
	}
	contractstest.AssertProduced(t, "events/v1/telemetry-stream.schema.json", event)
	actual, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := os.ReadFile("../../../../contracts/events/v1/telemetry-stream.fixture.json")
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
		t.Fatalf("stream projection differs from the contract fixture: %s", actual)
	}
}

// An adapter device's committed readings carry provenance, a diagnostic and a
// timestamp source; none of it reaches an application.
func TestStreamProjectionDropsTheInternalFields(t *testing.T) {
	committed := ProjectCommitted(adapterTelemetry(t))
	committed.Readings[0].Diagnostic = "Counter reset detected; consumption continues from the new value."
	raw, err := json.Marshal(ProjectStream(committed, 7))
	if err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err = json.Unmarshal(raw, &event); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"telemetry_id", "organization_uuid", "sequence"} {
		if _, present := event[field]; present {
			t.Fatalf("%s must not be relayed: %s", field, raw)
		}
	}
	readings := event["readings"].([]any)
	if len(readings) != len(committed.Readings) || len(readings) == 0 {
		t.Fatalf("every reading is projected: %s", raw)
	}
	for _, item := range readings {
		reading := item.(map[string]any)
		for _, field := range []string{"installation_uuid", "adapter_revision_uuid", "manufacturer_serial", "timestamp_source", "diagnostic", "label"} {
			if _, present := reading[field]; present {
				t.Fatalf("readings[].%s must not be relayed: %s", field, raw)
			}
		}
	}
	contractstest.AssertProduced(t, "telemetry-stream.v1", ProjectStream(committed, 7))
}

// The control events the runtime (open, reset) and Laravel (closed) write conform to
// telemetry-stream-open.v1, telemetry-stream-reset.v1 and telemetry-stream-closed.v1.
func TestStreamControlEventsConformToTheirContracts(t *testing.T) {
	openedAt := time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)
	contractstest.AssertProduced(t, "events/v1/telemetry-stream-open.schema.json", NewStreamOpen("42", 2, openedAt))
	contractstest.AssertProduced(t, "events/v1/telemetry-stream-open.schema.json", NewStreamOpen("0", 0, openedAt))
	contractstest.AssertProduced(t, "events/v1/telemetry-stream-reset.schema.json", NewStreamReset("9031"))
	for _, reason := range []string{"lifetime", "grant_changed", "credentials_changed", "runtime_unavailable", "shutdown"} {
		contractstest.AssertProduced(t, "events/v1/telemetry-stream-closed.schema.json", NewStreamClosed(reason, "9031"))
	}
	for _, fixture := range []string{"telemetry-stream-open", "telemetry-stream-reset", "telemetry-stream-closed"} {
		raw, err := os.ReadFile("../../../../contracts/events/v1/" + fixture + ".fixture.json")
		if err != nil {
			t.Fatal(err)
		}
		var value any
		if err = json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		contractstest.AssertProduced(t, fixture+".v1", value)
	}
}
