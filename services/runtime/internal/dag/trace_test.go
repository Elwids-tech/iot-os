package dag

import (
	"testing"
	"time"
)

func TestTraceExplainsCommandDecisionsWithoutChangingTriggers(t *testing.T) {
	p := compiled(t, multiCommandFixture())
	at := time.Unix(1800000000, 0).UTC()
	step := func(s State, value float64, offset int, want string, intents int) Result {
		t.Helper()
		r, err := p.Step(s, reading(time.Duration(offset).String(), value, at.Add(time.Duration(offset)*time.Second)), at.Add(time.Duration(offset)*time.Second))
		if err != nil {
			t.Fatal(err)
		}
		last := r.Trace[len(r.Trace)-1]
		if last.Status != want || len(r.Intents) != intents || len(last.IntentIDs) != intents {
			t.Fatalf("trace %+v, intents %d", last, len(r.Intents))
		}
		return r
	}
	a := step(p.Initial(at), 0, 0, "not_matched", 0)
	b := step(a.State, 40, 1, "triggered", 2)
	c := step(b.State, 40, 2, "suppressed", 0)
	d := step(c.State, 0, 3, "not_matched", 0)
	e := step(d.State, 40, 4, "suppressed", 0)
	if e.Trace[len(e.Trace)-1].Reason != "Action cooldown has not elapsed." {
		t.Fatal("missing cooldown explanation")
	}
	f, err := p.Step(e.State, nil, at.Add(130*time.Second))
	if err != nil || len(f.Intents) != 0 || f.Trace[0].Outputs["out"].Known || f.Trace[len(f.Trace)-1].Status != "waiting" {
		t.Fatalf("stale evidence: %+v %v", f, err)
	}
}

func TestTraceExplainsIgnoredHistoricalReadings(t *testing.T) {
	p := compiled(t, fixture())
	at := time.Unix(1800000000, 0).UTC()
	event := reading("historical", float64(40), at)
	event.Readings[0].Historical = true
	r, err := p.Step(p.Initial(at), event, at)
	if err != nil || r.Trace[0].Outputs["out"].Known || r.Trace[0].EventNote == "" || len(r.Intents) != 0 {
		t.Fatalf("ignored reading trace: %+v %v", r, err)
	}
}

// An alert raises and clears on a change. While nothing changes the trace says
// which state held, so an alert that is doing its job never reads as blocked.
func TestTraceNamesAnUnchangedAlert(t *testing.T) {
	p := compiled(t, fixture())
	at := time.Unix(1800000000, 0).UTC()
	s := p.Initial(at)
	for i, tc := range []struct {
		value   float64
		status  string
		intents int
	}{{10, "not_matched", 0}, {30, "triggered", 1}, {31, "active", 0}, {10, "triggered", 1}, {11, "not_matched", 0}} {
		now := at.Add(time.Duration(i+1) * time.Second)
		r, err := p.Step(s, reading(now.String(), tc.value, now), now)
		if err != nil {
			t.Fatal(err)
		}
		last := r.Trace[len(r.Trace)-1]
		if last.Status != tc.status || len(r.Intents) != tc.intents {
			t.Fatalf("step %d: trace %+v, intents %d", i, last, len(r.Intents))
		}
		s = r.State
	}
}
