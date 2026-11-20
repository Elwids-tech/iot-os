package app

import (
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
)

// A tracker reported once, a day before it was activated, and the person activating
// it chose to keep that report: the control plane sends the stored birth's values
// stamped with the new installation. They become readings observed when the tracker
// reported them; values without that stamp (or another installation's) do not.
func TestKeptBirthValuesBecomeReadingsObservedWhenReported(t *testing.T) {
	base := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: storage.UUID()}
	d := trackerDefinition(base, devices.Connection{UUID: storage.UUID(), GroupID: "adapters"}, true)
	revision := storage.UUID()
	reported := time.Date(2026, 11, 19, 15, 29, 24, 0, time.UTC)
	stamped := func(name string, value any, installation string) devices.Metric {
		return devices.Metric{Name: name, Datatype: "Double", Value: value, Timestamp: &reported, InstallationUUID: installation, AdapterRevisionUUID: revision}
	}
	birth := []devices.Metric{
		stamped("battery", 4.19, d.Adapter.InstallationUUID),
		stamped("latitude", 49.99, ""),             // reported before any installation
		stamped("latitude", 49.99, storage.UUID()), // another installation's
		{Name: "battery", Datatype: "Double"},      // names only: nothing to keep
		stamped("latitude", nil, d.Adapter.InstallationUUID),
	}
	kept := keptMetrics(d, birth)
	if len(kept) != 1 || kept[0].Name != "battery" {
		t.Fatalf("kept %+v", kept)
	}
	if got := keptMetrics(trackerDefinition(base, devices.Connection{UUID: storage.UUID()}, false), birth); len(got) != 0 {
		t.Fatalf("a device that announces its own births keeps nothing: %+v", got)
	}
	profile, err := devices.ParseProfile(d)
	if err != nil {
		t.Fatal(err)
	}
	activated := reported.Add(30 * time.Hour)
	readings := devices.Readings(d, profile, kept, map[string]devices.Reading{}, activated)
	if len(readings) != 1 {
		t.Fatalf("readings %+v", readings)
	}
	r := readings[0]
	if r.Quality != "good" || r.Value != 4.19 || !r.ObservedAt.Equal(reported) || !r.ReceivedAt.Equal(activated) || r.InstallationUUID != d.Adapter.InstallationUUID || r.Historical {
		t.Fatalf("reading %+v", r)
	}
}
