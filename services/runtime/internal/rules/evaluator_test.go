package rules

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

type simulation struct {
	Definition Definition `json:"definition"`
	Steps      []struct {
		At    time.Time                   `json:"at"`
		Event *devices.CommittedTelemetry `json:"event"`
	} `json:"steps"`
}

func fixture(t *testing.T) simulation {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/rules/v1/simulation.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var s simulation
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err = decoder.Decode(&s); err != nil {
		t.Fatal(err)
	}
	return s
}
func compiled(t *testing.T, d Definition) *Compiled {
	t.Helper()
	c, err := Compile(d)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func TestGeofenceSimulationAndRestart(t *testing.T) {
	f := fixture(t)
	c := compiled(t, f.Definition)
	raw, err := os.ReadFile("../../../../contracts/rules/v1/simulation.expected.json")
	if err != nil {
		t.Fatal(err)
	}
	var expectations []struct {
		Condition  string  `json:"condition"`
		Active     bool    `json:"active"`
		Reason     string  `json:"reason"`
		Transition *string `json:"transition"`
	}
	if err = json.Unmarshal(raw, &expectations); err != nil {
		t.Fatal(err)
	}
	state := c.Initial()
	for i, step := range f.Steps {
		before := state
		result, err := c.Step(state, step.Event, step.At)
		if err != nil {
			t.Fatal(i, err)
		}
		want := expectations[i]
		if result.State.Condition != want.Condition || result.State.Active != want.Active || result.Reason != want.Reason {
			t.Fatalf("step %d: %+v", i, result)
		}
		if (result.Transition == nil) != (want.Transition == nil) {
			t.Fatal("transition mismatch", i, result)
		}
		if want.Transition != nil && result.Transition.Type != *want.Transition {
			t.Fatal("wrong transition", i, result)
		}
		if i == 4 {
			for name, value := range map[string]any{"state": result.State, "transition": result.Transition} {
				raw, err := os.ReadFile("../../../../contracts/rules/v1/" + name + ".fixture.json")
				if err != nil {
					t.Fatal(err)
				}
				actual, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				var a, b any
				if err = json.Unmarshal(raw, &a); err != nil {
					t.Fatal(err)
				}
				if err = json.Unmarshal(actual, &b); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(a, b) {
					t.Fatalf("%s fixture differs: %s", name, actual)
				}
			}
		}
		// Simulate a process restart after each committed state boundary.
		encoded, err := json.Marshal(result.State)
		if err != nil {
			t.Fatal(err)
		}
		var restored State
		if err = json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		state = restored
		restarted := compiled(t, f.Definition)
		again, err := restarted.Step(before, step.Event, step.At)
		if err != nil || !reflect.DeepEqual(result, again) {
			t.Fatal("replay diverged", i, err)
		}
		if result.Transition != nil {
			duplicate, err := c.Step(state, step.Event, step.At)
			if err != nil || duplicate.Transition != nil {
				t.Fatal("committed transition repeated", i, err)
			}
		}
	}
}
func TestUnknownAndLateEvidenceCannotClearOrAccumulate(t *testing.T) {
	f := fixture(t)
	c := compiled(t, f.Definition)
	s := c.Initial()
	for _, step := range f.Steps[:5] {
		r, err := c.Step(s, step.Event, step.At)
		if err != nil {
			t.Fatal(err)
		}
		s = r.State
	}
	late := *f.Steps[0].Event
	r, err := c.Step(s, &late, f.Steps[4].At.Add(time.Second))
	if err != nil || !r.State.Active || r.Transition != nil || r.Reason != "out_of_order" {
		t.Fatal(r, err)
	}
	invalid := *f.Steps[7].Event
	invalid.Readings = append([]devices.CommittedReading(nil), invalid.Readings...)
	invalid.Readings[0].Quality = "invalid"
	r, err = c.Step(s, &invalid, f.Steps[7].At)
	if err != nil || r.State.Condition != "unknown" || !r.State.Active || r.Transition != nil {
		t.Fatal(r, err)
	}
	newVersion := f.Definition
	newVersion.VersionUUID = "00000000-0000-4000-8000-000000009999"
	replacement := compiled(t, newVersion)
	if _, err = replacement.Step(s, nil, f.Steps[7].At); err == nil {
		t.Fatal("old state crossed definition boundary")
	}
	if _, err = c.Step(s, nil, f.Steps[0].At); err == nil {
		t.Fatal("backward evaluation accepted")
	}
}
func TestSingleObservationAndGapCannotSatisfyDuration(t *testing.T) {
	f := fixture(t)
	c := compiled(t, f.Definition)
	first, err := c.Step(c.Initial(), f.Steps[1].Event, f.Steps[1].At)
	if err != nil {
		t.Fatal(err)
	}
	tick, err := c.Step(first.State, nil, f.Steps[1].At.Add(60*time.Second))
	if err != nil || tick.Transition != nil || tick.State.Condition != "unknown" {
		t.Fatal(tick, err)
	}
	// Changing the original definition after compilation cannot alter its policy.
	f.Definition.Policy.OutsideForSeconds = 0
	if c.definition.Policy.OutsideForSeconds != 60 {
		t.Fatal("compiled snapshot was mutated")
	}
}
