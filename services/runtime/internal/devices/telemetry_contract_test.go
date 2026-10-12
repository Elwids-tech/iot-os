package devices

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
)

// An adapter-backed water meter (spec 002 T030, T031): platform identities, the
// adapter binding Laravel writes into its configuration, and the provenance the
// managed publisher puts in each metric's properties.
const (
	meterOrganization  = "30000000-0000-4000-8000-000000000001"
	meterDevice        = "30000000-0000-4000-8000-000000000002"
	meterConfiguration = "30000000-0000-4000-8000-000000000003"
	meterArtifact      = "30000000-0000-4000-8000-000000000004"
	meterConnection    = "30000000-0000-4000-8000-000000000005"
	meterCandidate     = "30000000-0000-4000-8000-000000000006"
	meterInstallation  = "30000000-0000-4000-8000-000000000007"
	meterAdapter       = "30000000-0000-4000-8000-000000000008"
	meterRevision      = "30000000-0000-4000-8000-000000000009"
	meterCapture       = "30000000-0000-4000-8000-00000000000a"
	meterTelemetry     = "30000000-0000-4000-8000-00000000000b"
	meterFlow          = "31000000-0000-4000-8000-000000000001"
	meterVolume        = "31000000-0000-4000-8000-000000000002"
	meterValve         = "31000000-0000-4000-8000-000000000003"
)

// meterProfile is a compiled profile with a measurement, a monotonic counter and an
// enum parameter.
const meterProfile = `{"alarm_templates":[],"calculations":[],"parameters":[` +
	`{"accepts_command":false,"counter":null,"data_type":"number","display":{"precision":3},"format":null,"key":"flow_rate","kind":"measurement","label":"Flow rate","reporting":{"stale_after_seconds":15},"reports_state":true,"unit":"L/min","uuid":"` + meterFlow + `","validation":null},` +
	`{"accepts_command":false,"counter":{"monotonic":true,"reset_behavior":"diagnose"},"data_type":"number","display":{"precision":3},"format":null,"key":"total_volume","kind":"counter","label":"Total volume","reporting":{"stale_after_seconds":15},"reports_state":true,"unit":"L","uuid":"` + meterVolume + `","validation":null},` +
	`{"accepts_command":false,"counter":null,"data_type":"enum","display":{"widget":"badge"},"format":null,"key":"valve_state","kind":"state","label":"Valve","reporting":{"stale_after_seconds":15},"reports_state":true,"unit":null,"uuid":"` + meterValve + `","validation":{"diagnostic_code":"valve_state_unknown","engine":"json_logic","message":"Valve must be open or closed.","rule":{"in":[{"var":"value"},["open","closed"]]}}}` +
	`],"profile":{"category":"water-metering","code":"water-meter","name":"Water meter","revision":1,"uuid":"31000000-0000-4000-8000-000000000000"},"schema_version":"device-profile.v1"}`

// adapterMeter is the definition the runtime holds for the meter: what Laravel's
// activation sends (a device-configuration.v2 with an adapter binding and
// conversion mode "none", whose ingress_conversion is null), decoded into Go.
func adapterMeter(t *testing.T) (Definition, Profile) {
	t.Helper()
	hash := sha256.Sum256([]byte(meterProfile))
	source := sha256.Sum256([]byte("WM-1042"))
	d := Definition{
		Adapter:              &AdapterBinding{InstallationUUID: meterInstallation, AdapterUUID: meterAdapter, ManufacturerSerial: "WM-1042"},
		SchemaVersion:        "device-configuration.v2",
		ConfigurationUUID:    meterConfiguration,
		DeviceUUID:           meterDevice,
		OrganizationUUID:     meterOrganization,
		ProfileArtifactUUID:  meterArtifact,
		ProfileHash:          hex.EncodeToString(hash[:]),
		ProfileCanonicalJSON: meterProfile,
		Source: Source{
			ConnectionUUID: meterConnection, CandidateUUID: meterCandidate, GroupID: "adapters-" + meterOrganization,
			EdgeNodeID: "adapter-" + meterAdapter, DeviceID: "src-" + hex.EncodeToString(source[:])[:32],
		},
		BirthRevision: 1,
		Mappings: []Mapping{
			{ConversionMode: "none", ParameterUUID: meterFlow, Metric: "flow_rate", Datatype: "Double"},
			{ConversionMode: "none", ParameterUUID: meterVolume, Metric: "total_volume", Datatype: "Double"},
			{ConversionMode: "none", ParameterUUID: meterValve, Metric: "valve_state", Datatype: "String"},
		},
	}
	p, err := ParseProfile(d)
	if err != nil {
		t.Fatal(err)
	}
	return d, p
}

// adapterTelemetry is the message ingestion publishes on iot.telemetry.device for one
// adapter packet during a capture, built the way application.go builds it: readings
// from the real mapping, with the counter falling below its last value.
func adapterTelemetry(t *testing.T) Telemetry {
	t.Helper()
	d, p := adapterMeter(t)
	received := time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)
	observed := received.Add(-2 * time.Second)
	metric := func(name, datatype string, value any) Metric {
		return Metric{Name: name, Datatype: datatype, Value: value, Timestamp: &observed, ReceivedAt: received, InstallationUUID: meterInstallation, AdapterRevisionUUID: meterRevision}
	}
	latest := map[string]Reading{meterVolume: {ParameterUUID: meterVolume, Value: 8400.0, Quality: "good"}}
	readings := Readings(d, p, []Metric{metric("flow_rate", "Double", 12.5), metric("total_volume", "Double", 3.25), metric("valve_state", "String", "open")}, latest, received)
	if len(readings) != 3 {
		t.Fatalf("expected three readings, got %+v", readings)
	}
	for _, r := range readings {
		if r.Quality != "good" || r.InstallationUUID != meterInstallation || r.AdapterRevisionUUID != meterRevision || r.ManufacturerSerial != "WM-1042" {
			t.Fatalf("reading lacks adapter provenance: %+v", r)
		}
	}
	if valve, _ := reading(readings, meterValve); valve.DataType != "enum" {
		t.Fatalf("valve reading data type %q, want enum", valve.DataType)
	}
	if volume, _ := reading(readings, meterVolume); volume.CounterEvent != "reset" {
		t.Fatalf("volume reading counter event %q, want reset", volume.CounterEvent)
	}
	session := d.Source.ConnectionUUID + "/" + d.Source.EdgeNodeID + ":3:1760256000000:1760256000123456789"
	return Telemetry{CaptureID: meterCapture, Generation: 2, UUID: meterTelemetry, Definition: d, SessionID: session, Readings: readings}
}

// The internal telemetry message must conform to its contract as the runtime sends
// it (spec 002 T031, SC-007).
func TestAdapterTelemetryConformsToTheInternalTelemetryContract(t *testing.T) {
	contractstest.AssertProduced(t, "devices/v1/telemetry.schema.json", adapterTelemetry(t))
}
