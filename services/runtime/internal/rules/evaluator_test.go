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

func TestMembershipTransitionsRequireTwoKnownSides(t *testing.T) {
	f := fixture(t)
	c := compiled(t, f.Definition)

	inside, err := c.Step(c.Initial(), f.Steps[0].Event, f.Steps[0].At)
	if err != nil || inside.State.Condition != "inside" || inside.MembershipTransition != nil {
		t.Fatalf("initial membership emitted a crossing: %+v %v", inside, err)
	}

	exited, err := c.Step(inside.State, f.Steps[1].Event, f.Steps[1].At)
	if err != nil || exited.MembershipTransition == nil || exited.MembershipTransition.Type != "exited" {
		t.Fatalf("known inside to outside did not exit: %+v %v", exited, err)
	}

	insideEvent := *f.Steps[0].Event
	insideEvent.EventID = "00000000-0000-4000-8000-000000000997"
	insideEvent.TelemetryID = insideEvent.EventID
	insideEvent.Readings = append([]devices.CommittedReading(nil), insideEvent.Readings...)
	insideAt := f.Steps[1].At.Add(10 * time.Second)
	for index := range insideEvent.Readings {
		insideEvent.Readings[index].ObservedAt = insideAt.Add(-2 * time.Second)
		insideEvent.Readings[index].ReceivedAt = insideAt.Add(-time.Second)
	}
	entered, err := c.Step(exited.State, &insideEvent, insideAt)
	if err != nil || entered.MembershipTransition == nil || entered.MembershipTransition.Type != "entered" {
		t.Fatalf("known outside to inside did not enter: %+v %v", entered, err)
	}

	invalid := insideEvent
	invalid.EventID = "00000000-0000-4000-8000-000000000999"
	invalid.TelemetryID = invalid.EventID
	invalid.Readings = append([]devices.CommittedReading(nil), invalid.Readings...)
	invalid.Readings[0].Quality = "invalid"
	invalidAt := insideAt.Add(5 * time.Second)
	for index := range invalid.Readings {
		invalid.Readings[index].ObservedAt = invalidAt.Add(-2 * time.Second)
		invalid.Readings[index].ReceivedAt = invalidAt.Add(-time.Second)
	}
	unknown, err := c.Step(entered.State, &invalid, invalidAt)
	if err != nil || unknown.State.Condition != "unknown" || unknown.MembershipTransition != nil {
		t.Fatalf("invalid evidence did not remain unknown: %+v %v", unknown, err)
	}

	afterUnknown := *f.Steps[9].Event
	afterUnknown.EventID = "00000000-0000-4000-8000-000000000998"
	afterUnknown.TelemetryID = afterUnknown.EventID
	afterUnknown.Readings = append([]devices.CommittedReading(nil), afterUnknown.Readings...)
	afterUnknownAt := invalidAt.Add(5 * time.Second)
	for index := range afterUnknown.Readings {
		afterUnknown.Readings[index].ObservedAt = afterUnknownAt.Add(-2 * time.Second)
		afterUnknown.Readings[index].ReceivedAt = afterUnknownAt.Add(-time.Second)
	}
	afterUnknownResult, err := c.Step(unknown.State, &afterUnknown, afterUnknownAt)
	if err != nil || afterUnknownResult.State.Condition != "outside" || afterUnknownResult.MembershipTransition != nil {
		t.Fatalf("unknown evidence invented a crossing: %+v %v", afterUnknownResult, err)
	}
}
