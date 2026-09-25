package committedconsumer

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestCheckpointOwnershipAndIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	c, err := Open(path, "test", "stream-creation")
	if err != nil {
		t.Fatal(err)
	}
	if other, err := Open(path, "test", "stream-creation"); err == nil {
		other.Close()
		t.Fatal("concurrent writers allowed")
	}
	event := devices.CommittedTelemetry{SchemaVersion: devices.CommittedTelemetryVersion, EventID: "one", TelemetryID: "one", Sequence: "1", OrganizationUUID: "org", DeviceUUID: "device", Readings: []devices.CommittedReading{{Quality: "good", Value: json.Number("9007199254740993")}}}
	if fresh, err := c.Apply(event, 1); err != nil || !fresh {
		t.Fatal(fresh, err)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if other, err := Open(path, "test", "new-stream"); err == nil {
		other.Close()
		t.Fatal("stream replacement was silent")
	}
	c, err = Open(path, "test", "stream-creation")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if fresh, err := c.Apply(event, 2); err != nil || fresh {
		t.Fatal("redelivery was not deduplicated", fresh, err)
	}
	event.OrganizationUUID = "other"
	if _, err := c.Apply(event, 3); err == nil {
		t.Fatal("identity collision crossed tenants")
	}
	if c.State.LastStreamSequence != 2 || len(c.State.Events) != 1 {
		t.Fatal("failed event changed checkpoint")
	}
}
