package devices

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

func TestConversionContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/devices/v2/conversions.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name       string
		Type       string
		Conversion *Conversion
		Value      any
		Expected   float64
		Error      bool
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			typ := f.Type
			if typ == "" {
				typ = "number"
			}
			p := Parameter{Kind: "measurement", DataType: typ, ReportsState: true}
			result, err := Convert(p, f.Conversion, f.Value)
			if (err != nil) != f.Error {
				t.Fatalf("result %v error %v", result, err)
			}
			if !f.Error {
				n, ok := Number(result)
				if !ok || math.Abs(n-f.Expected) > 1e-10 {
					t.Fatalf("got %v expected %v", result, f.Expected)
				}
			}
		})
	}
}

func convertedDefinition(t *testing.T) (Definition, Profile) {
	t.Helper()
	var c Conversion
	_ = json.Unmarshal([]byte(`{"source_unit":"W","multiplier":0.001,"offset":0}`), &c)
	p := Profile{SchemaVersion: "device-profile.v2", Parameters: []Parameter{
		{UUID: "power", Key: "power", Kind: "measurement", DataType: "number", ReportsState: true, IngressConversion: &c},
		{UUID: "double", Key: "double", Kind: "derived", DataType: "number", ReportsState: true},
	}, Calculations: []Calculation{{TargetParameterUUID: "double", Inputs: []struct {
		Alias         string `json:"alias"`
		ParameterUUID string `json:"parameter_uuid"`
	}{{ParameterUUID: "power", Alias: "p"}}, Expression: map[string]any{"*": []any{map[string]any{"var": "p"}, 2.0}}}}}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	d := Definition{SchemaVersion: "device-configuration.v2", ProfileCanonicalJSON: string(raw), ProfileHash: hex.EncodeToString(hash[:]), Mappings: []Mapping{{ParameterUUID: "power", Metric: "watts", Datatype: "Double", ConversionMode: "profile", IngressConversion: &c}}}
	return d, p
}

func TestConvertedReadingsAndConfiguration(t *testing.T) {
	d, p := convertedDefinition(t)
	metrics := []Metric{{Name: "watts", Datatype: "Double", Value: 1000.0}}
	readings, err := Preview(d, metrics)
	if err != nil || len(readings) != 2 || readings[0].Value != 1.0 || readings[1].Value != 2.0 {
		t.Fatalf("%+v %v", readings, err)
	}
	d.Mappings[0].ConversionMode = "none"
	d.Mappings[0].IngressConversion = nil
	readings, err = Preview(d, metrics)
	if err != nil || readings[0].Value != 1000.0 {
		t.Fatalf("bypass %+v %v", readings, err)
	}
	d.Mappings[0].ConversionMode = "profile"
	if _, err = Preview(d, metrics); err == nil {
		t.Fatal("mismatched inherited conversion accepted")
	}
	d, p = convertedDefinition(t)
	var custom Conversion
	_ = json.Unmarshal([]byte(`{"multiplier":0.01,"offset":1}`), &custom)
	d.Mappings[0].ConversionMode = "custom"
	d.Mappings[0].IngressConversion = &custom
	readings, err = Preview(d, metrics)
	if err != nil || readings[0].Value != 11.0 {
		t.Fatalf("override applied more than once: %+v %v", readings, err)
	}
	metrics[0].Value = "1000"
	readings = Readings(d, p, metrics, map[string]Reading{}, time.Now())
	if readings[0].Quality != "invalid" || readings[0].Value != nil || readings[1].Quality != "invalid" {
		t.Fatalf("invalid input leaked: %+v", readings)
	}
}

func TestConversionEligibility(t *testing.T) {
	d, _ := convertedDefinition(t)
	d.Mappings[0].Datatype = "String"
	if _, err := ParseProfile(d); err == nil {
		t.Fatal("nonnumeric source mapping was accepted")
	}

	_, p := convertedDefinition(t)
	c := p.Parameters[0].IngressConversion
	for _, invalid := range []Parameter{
		{Kind: "derived", DataType: "number", ReportsState: true}, {Kind: "measurement", DataType: "string", ReportsState: true},
		{Kind: "measurement", DataType: "number", ReportsState: true, AcceptsCommand: true},
	} {
		if ValidateConversion(invalid, c) == nil {
			t.Fatalf("accepted %+v", invalid)
		}
	}
	if err := json.Unmarshal([]byte(`{"multiplier":1,"offset":0,"script":"bad"}`), &Conversion{}); err == nil {
		t.Fatal("accepted unknown conversion field")
	}
}
