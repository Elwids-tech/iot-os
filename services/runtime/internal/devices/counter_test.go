package devices

import (
	"strings"
	"testing"
	"time"
)

const (
	voltageL1      = "20000000-0000-4000-8000-000000000001"
	voltageL2      = "20000000-0000-4000-8000-000000000002"
	voltageL3      = "20000000-0000-4000-8000-000000000003"
	energyImported = "20000000-0000-4000-8000-000000000004"
	voltageAverage = "20000000-0000-4000-8000-000000000010"
)

func meter(t *testing.T) (Definition, Profile) {
	t.Helper()
	d := golden(t, "three-phase-energy-meter")
	p, e := ParseProfile(d)
	if e != nil {
		t.Fatal(e)
	}
	for _, parameter := range p.Parameters {
		if parameter.ReportsState {
			d.Mappings = append(d.Mappings, Mapping{ParameterUUID: parameter.UUID, Metric: parameter.Key, Datatype: "Double"})
		}
	}
	return d, p
}

func reading(readings []Reading, parameter string) (Reading, bool) {
	for _, r := range readings {
		if r.ParameterUUID == parameter {
			return r, true
		}
	}
	return Reading{}, false
}

func TestCounterDecreaseStartsSegmentInsteadOfInvalidating(t *testing.T) {
	d, p := meter(t)
	received := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	latest := map[string]Reading{energyImported: {ParameterUUID: energyImported, Value: 1200.5, Quality: "good"}}

	readings := Readings(d, p, []Metric{{Name: "energy.imported", Datatype: "Double", Value: 3.25}}, latest, received)
	r, ok := reading(readings, energyImported)
	if !ok || r.Quality != "good" || r.Value != 3.25 || r.CounterEvent != "reset" {
		t.Fatalf("reset reading was not kept as a new segment: %+v", r)
	}
	if !strings.Contains(r.Diagnostic, "reset detected") {
		t.Fatalf("diagnose profiles flag the reset for review: %q", r.Diagnostic)
	}

	// The next reading is compared with the new segment, so it stays valid.
	latest[energyImported] = r
	readings = Readings(d, p, []Metric{{Name: "energy.imported", Datatype: "Double", Value: 4.0}}, latest, received.Add(time.Minute))
	if next, _ := reading(readings, energyImported); next.Quality != "good" || next.CounterEvent != "" {
		t.Fatalf("readings after a reset must continue normally: %+v", next)
	}
}

func TestCounterRolloverAndIncrease(t *testing.T) {
	rollover := 1000.0
	counter := &CounterConfig{Monotonic: true, RolloverAt: &rollover}
	if increase, event := counter.Increase(990, 15); event != "rollover" || increase != 25 {
		t.Fatalf("rollover increase = %v %q", increase, event)
	}
	if increase, event := (&CounterConfig{Monotonic: true}).Increase(990, 15); event != "reset" || increase != 15 {
		t.Fatalf("reset increase = %v %q", increase, event)
	}
	if increase, event := counter.Increase(10, 12.5); event != "" || increase != 2.5 {
		t.Fatalf("normal increase = %v %q", increase, event)
	}
	// A value above the rollover point cannot have wrapped; treat it as a reset.
	if _, event := counter.Increase(1500, 3); event != "reset" {
		t.Fatalf("decrease from above the rollover point = %q", event)
	}
	// A mid-range decrease would imply using 603 of a 1000 range: a reset.
	if increase, event := counter.Increase(400, 3); event != "reset" || increase != 3 {
		t.Fatalf("mid-range decrease = %v %q", increase, event)
	}
}

func TestHistoricalCounterSamplesAreNotComparedWithLiveValue(t *testing.T) {
	d, p := meter(t)
	received := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	observed := received.Add(-6 * time.Hour)
	latest := map[string]Reading{energyImported: {ParameterUUID: energyImported, Value: 1200.5, Quality: "good"}}

	readings := Readings(d, p, []Metric{{Name: "energy.imported", Datatype: "Double", Value: 1100.0, Timestamp: &observed, Historical: true}}, latest, received)
	r, _ := reading(readings, energyImported)
	if r.Quality != "good" || r.CounterEvent != "" || !r.ObservedAt.Equal(observed) {
		t.Fatalf("buffered counter sample must be stored as observed: %+v", r)
	}
}

func TestHistoricalBatchCalculationsDoNotUseLiveInputs(t *testing.T) {
	d, p := meter(t)
	received := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	observed := received.Add(-2 * time.Hour)
	latest := map[string]Reading{
		voltageL2: {ParameterUUID: voltageL2, Value: 240.0, Quality: "good", ReceivedAt: received},
		voltageL3: {ParameterUUID: voltageL3, Value: 240.0, Quality: "good", ReceivedAt: received},
	}

	partial := Readings(d, p, []Metric{{Name: "voltage.l1", Datatype: "Double", Value: 220.0, Timestamp: &observed, Historical: true}}, latest, received)
	if _, ok := reading(partial, voltageAverage); ok {
		t.Fatal("a buffered input was combined with live cached inputs")
	}

	complete := Readings(d, p, []Metric{
		{Name: "voltage.l1", Datatype: "Double", Value: 220.0, Timestamp: &observed, Historical: true},
		{Name: "voltage.l2", Datatype: "Double", Value: 230.0, Timestamp: &observed, Historical: true},
		{Name: "voltage.l3", Datatype: "Double", Value: 240.0, Timestamp: &observed, Historical: true},
	}, latest, received)
	average, ok := reading(complete, voltageAverage)
	if !ok || average.Value != 230.0 || !average.Historical || !average.ObservedAt.Equal(observed) {
		t.Fatalf("buffered batch with all inputs must derive at the observed time: %+v", average)
	}
}
