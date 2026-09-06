package devices

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestSharedExpressionContracts(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/devices/v1/expressions.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		ID         string
		Expression any
		Context    map[string]any
		Expected   any
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err = decoder.Decode(&cases); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range cases {
		t.Run(fixture.ID, func(t *testing.T) {
			value, err := Evaluate(fixture.Expression, fixture.Context)
			if err != nil || !Equal(value, fixture.Expected) {
				t.Fatalf("got %#v (%v), expected %#v", value, err, fixture.Expected)
			}
		})
	}
}

func TestExecutableConfigurationContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/devices/v1/configuration.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var definition Definition
	if err = json.Unmarshal(raw, &definition); err != nil {
		t.Fatal(err)
	}
	profile, err := ParseProfile(definition)
	if err != nil {
		t.Fatal(err)
	}
	if len(profile.Parameters) != 6 || len(definition.Mappings) != 5 {
		t.Fatal("unexpected executable contract")
	}
}
