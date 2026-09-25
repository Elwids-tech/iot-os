package rules

import (
	"fmt"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

type Deployment struct {
	OperationUUID    string      `json:"operation_uuid"`
	RuleUUID         string      `json:"rule_uuid"`
	OrganizationUUID string      `json:"organization_uuid"`
	Generation       int         `json:"generation"`
	Target           string      `json:"target"`
	Definition       *Definition `json:"definition"`
}

func (d Deployment) Validate() error {
	if !uuidPattern.MatchString(d.OperationUUID) || !uuidPattern.MatchString(d.RuleUUID) || !uuidPattern.MatchString(d.OrganizationUUID) || d.Generation < 1 || (d.Target != "active" && d.Target != "inactive") {
		return fmt.Errorf("invalid workflow deployment")
	}
	if d.Target == "active" {
		if d.Definition == nil || d.Definition.UUID != d.RuleUUID || d.Definition.VersionUUID != d.OperationUUID || d.Definition.Binding.OrganizationUUID != d.OrganizationUUID {
			return fmt.Errorf("deployment identity mismatch")
		}
		_, err := Compile(*d.Definition)
		return err
	}
	if d.Definition != nil {
		return fmt.Errorf("disable must not carry a definition")
	}
	return nil
}

// CheckDevice verifies that the binding uses mapped, directly observed numeric
// coordinates in the exact currently applied configuration and generation.
func CheckDevice(d Definition, device devices.Definition, generation int, review bool) error {
	b := d.Binding
	if review || device.DeviceUUID != b.DeviceUUID || device.OrganizationUUID != b.OrganizationUUID || device.ConfigurationUUID != b.ConfigurationUUID || generation != b.Generation {
		return fmt.Errorf("bound device configuration is no longer applied or requires review")
	}
	p, err := devices.ParseProfile(device)
	if err != nil {
		return err
	}
	wanted := map[string]string{b.LatitudeParameterUUID: "deg", b.LongitudeParameterUUID: "deg"}
	if b.AccuracyParameterUUID != nil {
		wanted[*b.AccuracyParameterUUID] = "m"
	}
	for id, unit := range wanted {
		found, mapped := false, false
		for _, parameter := range p.Parameters {
			if parameter.UUID == id {
				found = parameter.ReportsState && parameter.Kind != "derived" && (parameter.DataType == "number" || parameter.DataType == "integer") && parameter.Unit != nil && *parameter.Unit == unit
			}
		}
		for _, mapping := range device.Mappings {
			if mapping.ParameterUUID == id && mapping.Metric != "" {
				mapped = true
			}
		}
		if !found || !mapped {
			return fmt.Errorf("location parameters must be mapped numeric source measurements in deg/m")
		}
	}
	return nil
}
