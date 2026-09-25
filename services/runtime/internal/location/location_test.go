package location

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

type scenario struct {
	Name        string                     `json:"name"`
	Binding     Binding                    `json:"binding"`
	Event       devices.CommittedTelemetry `json:"event"`
	EvaluatedAt time.Time                  `json:"evaluated_at"`
	Expected    struct {
		Status       string `json:"status"`
		Reason       string `json:"reason"`
		LiveEligible bool   `json:"live_eligible"`
	} `json:"expected"`
}

func fixtures(t *testing.T) []scenario {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/location/v1/scenarios.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Cases []scenario `json:"cases"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err = d.Decode(&data); err != nil {
		t.Fatal(err)
	}
	return data.Cases
}

func TestSharedLocationScenarios(t *testing.T) {
	for _, c := range fixtures(t) {
		t.Run(c.Name, func(t *testing.T) {
			fix, err := Resolve(c.Binding, c.Event, c.EvaluatedAt)
			if err != nil {
				t.Fatal(err)
			}
			if fix.Status != c.Expected.Status || fix.Reason != c.Expected.Reason || fix.LiveEligible != c.Expected.LiveEligible {
				t.Fatalf("unexpected fix: %+v", fix)
			}
			if fix.Status == "unknown" && fix.Point != nil {
				t.Fatal("unknown fix exposed coordinates")
			}
			if c.Name == "unknown_accuracy" && fix.Point.AccuracyMetres != nil {
				t.Fatal("unknown accuracy became zero")
			}
			again, err := Resolve(c.Binding, c.Event, c.EvaluatedAt)
			if err != nil || !reflect.DeepEqual(fix, again) {
				t.Fatal("replay was not deterministic")
			}
		})
	}
}

func TestLocationFixContract(t *testing.T) {
	c := fixtures(t)[0]
	fix, err := Resolve(c.Binding, c.Event, c.EvaluatedAt)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../../contracts/location/v1/fix.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected Fix
	if err = json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fix, expected) {
		t.Fatalf("output differs from contract fixture: %+v", fix)
	}
}

func TestCoordinatePairNeverUsesPreviousEvent(t *testing.T) {
	c := fixtures(t)[0]
	first := c.Event
	first.Readings = c.Event.Readings[:1]
	f, err := Resolve(c.Binding, first, c.EvaluatedAt)
	if err != nil || f.Reason != "incomplete_fix" {
		t.Fatal(f, err)
	}
	second := c.Event
	second.Readings = c.Event.Readings[1:]
	f, err = Resolve(c.Binding, second, c.EvaluatedAt)
	if err != nil || f.Reason != "incomplete_fix" {
		t.Fatal("unrelated coordinate was reused", f, err)
	}
}

func TestMalformedCoordinatesAndPolicy(t *testing.T) {
	for _, value := range []any{math.NaN(), math.Inf(1), "51.0", true, json.Number("1e9999")} {
		c := fixtures(t)[0]
		c.Event.Readings[0].Value = value
		f, err := Resolve(c.Binding, c.Event, c.EvaluatedAt)
		if err != nil || f.Reason != "invalid_coordinates" {
			t.Fatal(f, err)
		}
	}
	for _, mutate := range []func(*Binding){
		func(b *Binding) { b.LongitudeParameterUUID = b.LatitudeParameterUUID },
		func(b *Binding) { b.MaxAgeSeconds = 0 }, func(b *Binding) { b.Pairing = "latest" },
		func(b *Binding) { b.Revision = 0 }, func(b *Binding) { b.MaxFutureSkewSeconds = -1 },
	} {
		c := fixtures(t)[0]
		mutate(&c.Binding)
		if _, err := Resolve(c.Binding, c.Event, c.EvaluatedAt); err == nil {
			t.Fatal("malformed binding accepted")
		}
	}
	c := fixtures(t)[0]
	maxAge := time.Duration(c.Binding.MaxAgeSeconds) * time.Second
	at := c.Event.Readings[0].ObservedAt.Add(maxAge)
	f, err := Resolve(c.Binding, c.Event, at)
	if err != nil || !f.LiveEligible {
		t.Fatal("exact maximum age should remain eligible", f, err)
	}
	f, err = Resolve(c.Binding, c.Event, at.Add(time.Nanosecond))
	if err != nil || f.Reason != "stale_fix" {
		t.Fatal(f, err)
	}
}
