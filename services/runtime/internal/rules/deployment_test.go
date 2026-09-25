package rules

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestActivationChecksAppliedSourceParameters(t *testing.T) {
	d, _, err := CompileWorkflow(workflowFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	deg, metres := "deg", "m"
	base := devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{
		{UUID: d.Binding.LatitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg},
		{UUID: d.Binding.LongitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg},
		{UUID: *d.Binding.AccuracyParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &metres},
	}}
	for _, name := range []string{"valid", "derived", "wrong_unit", "unmapped", "non_numeric", "not_reported", "wrong_generation", "wrong_organization", "review_required"} {
		t.Run(name, func(t *testing.T) {
			p := base
			p.Parameters = append([]devices.Parameter{}, base.Parameters...)
			device := devices.Definition{SchemaVersion: "device-configuration.v1", OrganizationUUID: d.Binding.OrganizationUUID, DeviceUUID: d.Binding.DeviceUUID, ConfigurationUUID: d.Binding.ConfigurationUUID}
			for _, p := range base.Parameters {
				device.Mappings = append(device.Mappings, devices.Mapping{ParameterUUID: p.UUID, Metric: p.UUID, Datatype: "Double"})
			}
			generation, review := d.Binding.Generation, false
			switch name {
			case "derived":
				p.Parameters[0].Kind = "derived"
			case "wrong_unit":
				p.Parameters[0].Unit = &metres
			case "unmapped":
				device.Mappings = device.Mappings[1:]
			case "non_numeric":
				p.Parameters[0].DataType = "string"
			case "not_reported":
				p.Parameters[0].ReportsState = false
			case "wrong_generation":
				generation++
			case "wrong_organization":
				device.OrganizationUUID = d.UUID
			case "review_required":
				review = true
			}
			raw, _ := json.Marshal(p)
			hash := sha256.Sum256(raw)
			device.ProfileCanonicalJSON = string(raw)
			device.ProfileHash = hex.EncodeToString(hash[:])
			err := CheckDevice(d, device, generation, review)
			if (err == nil) != (name == "valid") {
				t.Fatal("unexpected activation validation", err)
			}
		})
	}
}
