package devices

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestCommittedProjectionMatchesSharedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/devices/v1/telemetry.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var input Telemetry
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	input.Generation = 1
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
