package committedconsumer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestCheckpointOwnershipAndIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	stream := Stream{ID: "stream-1", Created: "2026-10-01T00:00:00Z"}
	c, err := Open(path, "test", stream)
	if err != nil {
		t.Fatal(err)
	}
	if other, err := Open(path, "test", stream); err == nil {
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
	if other, err := Open(path, "test", Stream{ID: "stream-2", Created: stream.Created}); err == nil {
		other.Close()
		t.Fatal("stream replacement was silent")
	}
	c, err = Open(path, "test", stream)
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

func TestCheckpointFollowsTheStreamIDAcrossCreationTimeRewrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	// State saved before streams carried an ID.
	if err := os.WriteFile(path, []byte(`{"consumer":"test","stream_created":"2026-10-01T00:00:00Z","last_stream_sequence":7,"events":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	stream := Stream{ID: "stream-1", Created: "2026-10-01T00:00:00Z"}
	if other, err := Open(path, "test", Stream{ID: "stream-1", Created: "2026-11-01T00:00:00Z"}); err == nil {
		other.Close()
		t.Fatal("adopted an ID without proof of the same stream")
	}
	c, err := Open(path, "test", stream)
	if err != nil || c.State.StreamID != "stream-1" || c.State.LastStreamSequence != 7 {
		t.Fatal("did not adopt the stream ID", c, err)
	}
	c.Close()
	// NATS rewrote the creation time; the adopted ID still identifies the stream.
	c, err = Open(path, "test", Stream{ID: "stream-1", Created: "2026-11-01T00:00:00Z"})
	if err != nil || c.State.LastStreamSequence != 7 {
		t.Fatal("rejected a rewritten creation time", err)
	}
	c.Close()
	if other, err := Open(path, "test", Stream{ID: "stream-2", Created: stream.Created}); err == nil {
		other.Close()
		t.Fatal("stream replacement was silent")
	}
}
