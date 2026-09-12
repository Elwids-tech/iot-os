package devices

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
)

type Conversion struct {
	SourceUnit *string  `json:"source_unit"`
	Multiplier *float64 `json:"multiplier"`
	Offset     *float64 `json:"offset"`
}

func (c *Conversion) UnmarshalJSON(data []byte) error {
	type plain Conversion
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	return decoder.Decode((*plain)(c))
}

func ValidateConversion(p Parameter, c *Conversion) error {
	if c == nil {
		return nil
	}
	if (p.Kind != "measurement" && p.Kind != "counter") || (p.DataType != "number" && p.DataType != "integer") || !p.ReportsState || p.AcceptsCommand {
		return errors.New("incoming conversion requires a read-only numeric measurement or counter")
	}
	if c.Multiplier == nil || c.Offset == nil || !finite(*c.Multiplier) || !finite(*c.Offset) || *c.Multiplier == 0 {
		return errors.New("conversion requires a finite nonzero multiplier and finite offset")
	}
	if p.Counter != nil && p.Counter.Monotonic && *c.Multiplier < 0 {
		return errors.New("a monotonic counter requires a positive multiplier")
	}
	if c.SourceUnit != nil && len([]rune(*c.SourceUnit)) > 255 {
		return errors.New("incoming unit exceeds 255 characters")
	}
	return nil
}

func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }

func Convert(p Parameter, c *Conversion, value any) (any, error) {
	if err := ValidateConversion(p, c); err != nil {
		return nil, err
	}
	if c == nil {
		return value, nil
	}
	number, ok := Number(value)
	if !ok {
		return nil, errors.New("conversion input must be a finite number")
	}
	result := number**c.Multiplier + *c.Offset
	if !finite(result) {
		return nil, errors.New("conversion result is not finite")
	}
	if err := ValidateValue(p, result); err != nil {
		return nil, fmt.Errorf("converted value: %w", err)
	}
	return result, nil
}

func validateConversions(d Definition, p Profile) error {
	params := map[string]Parameter{}
	for _, parameter := range p.Parameters {
		params[parameter.UUID] = parameter
		if parameter.IngressConversion != nil && p.SchemaVersion == "device-profile.v1" {
			return errors.New("conversions require device-profile.v2")
		}
		if err := ValidateConversion(parameter, parameter.IngressConversion); err != nil {
			return err
		}
	}
	for _, mapping := range d.Mappings {
		parameter, ok := params[mapping.ParameterUUID]
		if !ok {
			return errors.New("mapping references an unknown parameter")
		}
		if d.SchemaVersion == "device-configuration.v1" {
			if mapping.IngressConversion != nil || mapping.ConversionMode != "" || parameter.IngressConversion != nil {
				return errors.New("conversions require device-configuration.v2")
			}
			continue
		}
		switch mapping.ConversionMode {
		case "", "profile":
			if !reflect.DeepEqual(mapping.IngressConversion, parameter.IngressConversion) {
				return errors.New("effective conversion does not match the published profile default")
			}
		case "none":
			if mapping.IngressConversion != nil {
				return errors.New("disabled conversion must not contain settings")
			}
		case "custom":
			if mapping.IngressConversion == nil {
				return errors.New("custom conversion requires settings")
			}
		default:
			return errors.New("unknown conversion mode")
		}
		if mapping.IngressConversion != nil {
			switch mapping.Datatype {
			case "Float", "Double", "Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16", "UInt32", "UInt64":
			default:
				return errors.New("incoming conversion requires a numeric source datatype")
			}
		}
		if err := ValidateConversion(parameter, mapping.IngressConversion); err != nil {
			return err
		}
	}
	return nil
}
