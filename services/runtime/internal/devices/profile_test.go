package devices

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func golden(t *testing.T, fixture string) Definition {
	t.Helper()
	raw, e := os.ReadFile("../../../../contracts/definitions/device-profiles/" + fixture + ".v1.json")
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(raw)
	return Definition{SchemaVersion: "device-configuration.v1", ProfileCanonicalJSON: string(raw), ProfileHash: hex.EncodeToString(hash[:])}
}
func TestProfileFixtureCalculationAndInvalidInput(t *testing.T) {
	d := golden(t, "three-phase-energy-meter")
	p, e := ParseProfile(d)
	if e != nil {
		t.Fatal(e)
	}
	metrics := []Metric{}
	for _, parameter := range p.Parameters {
		if !parameter.ReportsState {
			continue
		}
		d.Mappings = append(d.Mappings, Mapping{ParameterUUID: parameter.UUID, Metric: parameter.Label, Datatype: "Double"})
		metrics = append(metrics, Metric{Name: parameter.Label, Datatype: "Double", Value: float64(230)})
	}
	preview, e := Preview(d, metrics)
	if e != nil {
		t.Fatal(e)
	}
	last := preview[len(preview)-1]
	if last.Key != "voltage.average" || last.Value != float64(230) || last.Quality != "good" {
		t.Fatal(last)
	}
	metrics[0].Value = float64(-1)
	preview = Readings(d, p, metrics, map[string]Reading{}, time.Now())
	if preview[0].Quality != "invalid" || preview[len(preview)-1].Quality != "invalid" {
		t.Fatal("invalid input did not propagate")
	}
	d.ProfileHash = strings.Repeat("0", 64)
	if _, e = ParseProfile(d); e == nil {
		t.Fatal("tampered artifact accepted")
	}
}
func TestRestrictedExpressionsAndCommandValidation(t *testing.T) {
	cases := []struct {
		Expression string
		Context    map[string]any
		Want       any
		Error      bool
	}{
		{`{"/":[{"+":[{"var":"a"},{"var":"b"}]},2]}`, map[string]any{"a": 2.0, "b": 4.0}, 3.0, false},
		{`{"/":[1,0]}`, nil, nil, true}, {`{"var":"missing"}`, nil, nil, true}, {`{"eval":"anything"}`, nil, nil, true},
		{`{"in":["blink",["blink","strobe"]]}`, nil, true, false},
	}
	for _, test := range cases {
		var expression any
		dec := json.NewDecoder(strings.NewReader(test.Expression))
		dec.UseNumber()
		_ = dec.Decode(&expression)
		result, e := Evaluate(expression, test.Context)
		if test.Error {
			if e == nil {
				t.Fatal("expected error", test.Expression)
			}
			continue
		}
		if e != nil || !Equal(result, test.Want) {
			t.Fatal(test.Expression, result, e)
		}
	}
	d := golden(t, "rgb-light")
	p, e := ParseProfile(d)
	if e != nil {
		t.Fatal(e)
	}
	for _, parameter := range p.Parameters {
		if parameter.Key == "brightness" {
			if e = ValidateValue(parameter, json.Number("8")); e != nil {
				t.Fatal(e)
			}
			if e = ValidateValue(parameter, json.Number("11")); e == nil {
				t.Fatal("brightness out of range accepted")
			}
			if e = ValidateValue(parameter, "8"); e == nil {
				t.Fatal("string brightness accepted")
			}
		}
	}
}
