package devices

import (
	"testing"
	"time"
)

func TestAdapterProvenanceRequiresEnrolledInstallation(t *testing.T) {
	installation := "10000000-0000-4000-8000-000000000001"
	revision := "20000000-0000-4000-8000-000000000001"
	d := Definition{DeviceUUID: "stable-virtual-device", Adapter: &AdapterBinding{InstallationUUID: installation, ManufacturerSerial: "WM-1042"}, Mappings: []Mapping{{ParameterUUID: "flow", Metric: "flow_rate", Datatype: "Double", ConversionMode: "none"}}}
	p := Profile{Parameters: []Parameter{{UUID: "flow", Key: "flow_rate", Kind: "measurement", DataType: "number", ReportsState: true}}}
	metric := Metric{Name: "flow_rate", Datatype: "Double", Value: 12.0, InstallationUUID: installation, AdapterRevisionUUID: revision}
	readings := Readings(d, p, []Metric{metric}, map[string]Reading{}, time.Now())
	if len(readings) != 1 || readings[0].Quality != "good" || readings[0].InstallationUUID != installation {
		t.Fatal(readings)
	}
	committed := ProjectCommitted(Telemetry{Definition: d, Readings: readings})
	if committed.DeviceUUID != "stable-virtual-device" || committed.Readings[0].AdapterRevisionUUID != revision || committed.Readings[0].ManufacturerSerial != "WM-1042" {
		t.Fatal(committed)
	}
	metric.InstallationUUID = "forged-installation"
	if got := Readings(d, p, []Metric{metric}, map[string]Reading{}, time.Now()); got[0].Quality != "invalid" || got[0].Value != nil {
		t.Fatal(got)
	}
	// A preview published before the installation was bound has no provenance and is left out.
	if got := Readings(d, p, []Metric{{Name: "flow_rate", Datatype: "Double", Value: 12.0}}, map[string]Reading{}, time.Now()); len(got) != 0 {
		t.Fatal("an unbound preview became a reading", got)
	}
	d.Adapter = nil
	if got := Readings(d, p, []Metric{metric}, map[string]Reading{}, time.Now()); got[0].Quality != "good" || got[0].InstallationUUID != "" {
		t.Fatal("native device incorrectly acquired adapter provenance", got)
	}
}

// Spec 020, FR-050: an adapter result without a decoder observation time is stamped
// with the receipt time and must not be labelled as the device's own time.
func TestReceiptStampedAdapterReadingsAreReceiptTimed(t *testing.T) {
	d := Definition{DeviceUUID: "tracker", Mappings: []Mapping{{ParameterUUID: "lat", Metric: "latitude", Datatype: "Double", ConversionMode: "none"}}}
	p := Profile{Parameters: []Parameter{{UUID: "lat", Key: "latitude", Kind: "measurement", DataType: "number", ReportsState: true}}}
	stamp := time.Now().Add(-time.Second).UTC()
	metric := Metric{Name: "latitude", Datatype: "Double", Value: 51.0, Timestamp: &stamp}
	if got := Readings(d, p, []Metric{metric}, map[string]Reading{}, time.Now()); got[0].TimestampSource != "source" {
		t.Fatal("a timestamped metric should stay source-timed", got[0].TimestampSource)
	}
	metric.TimestampSource = "receipt"
	got := Readings(d, p, []Metric{metric}, map[string]Reading{}, time.Now())
	if got[0].TimestampSource != "receipt" || !got[0].ObservedAt.Equal(stamp) {
		t.Fatal("receipt-stamped metric was labelled", got[0].TimestampSource)
	}
}
