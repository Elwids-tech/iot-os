package dag

import (
	"fmt"
	"testing"
	"time"
)

// "Off for 30 minutes": a boolean input, the false side of a branch, a duration, an alert.
func offForThirtyMinutes() Workflow {
	w := fixture()
	w.Bindings[0].DataType, w.Bindings[0].Unit, w.Bindings[0].FreshSeconds = "boolean", "", 600
	w.Nodes = []Node{{"input", "source.parameter.v1", map[string]any{"binding": "sensor"}}, {"off", "branch.v1", map[string]any{}}, {"off_30m", "sustained.v1", map[string]any{"seconds": float64(1800)}}, {"alert", "action.alert.v1", map[string]any{"title": "Off for 30 minutes"}}}
	w.Edges = []Edge{{"input", "out", "off", "in"}, {"off", "false", "off_30m", "in"}, {"off_30m", "out", "alert", "in"}}
	return w
}

// A device whose readings arrive late goes stale between reports. The gap must
// neither restart the duration, clear a raised alert, nor complete the duration
// by itself; only a reading that says otherwise restarts it (ADR-051).
func TestSustainedHoldsItsClockThroughStaleGaps(t *testing.T) {
	p := compiled(t, offForThirtyMinutes())
	start := time.Unix(1800000000, 0).UTC()
	s := p.Initial(start)
	// Each reading was observed 8 minutes before it arrives, so 2 of its 10 fresh minutes are left.
	for _, tc := range []struct {
		minute    int
		value     any // nil: a timer evaluation with no reading
		sustained string
		reason    string
		alert     string
		intent    string
	}{
		{10, false, "waiting", "", "not_matched", ""},
		{13, nil, "waiting", "stale", "waiting", ""}, // stale: the clock keeps its start
		{20, false, "waiting", "", "not_matched", ""},
		{30, false, "waiting", "", "not_matched", ""},
		{39, false, "waiting", "", "not_matched", ""},
		{41, nil, "waiting", "stale", "waiting", ""}, // 30 minutes passed during a gap: not raised on no data
		{45, false, "matched", "", "triggered", "activated"},
		{48, nil, "waiting", "stale", "waiting", ""}, // a gap does not clear the alert
		{50, false, "matched", "", "active", ""},
		{55, true, "not_matched", "", "triggered", "cleared"}, // back on: the other side of the branch
		{60, false, "waiting", "", "not_matched", ""},         // off again: a new 30 minutes
		{89, false, "waiting", "", "not_matched", ""},
		{91, false, "matched", "", "triggered", "activated"},
	} {
		now := start.Add(time.Duration(tc.minute) * time.Minute)
		var event = reading(fmt.Sprint(tc.minute), tc.value, now.Add(-8*time.Minute))
		if tc.value == nil {
			event = nil
		}
		r, err := p.Step(s, event, now)
		if err != nil {
			t.Fatal(err)
		}
		s = r.State
		held, alert := r.Trace[2], r.Trace[3]
		intent := ""
		if len(r.Intents) == 1 {
			intent = r.Intents[0].Transition
		}
		if held.Status != tc.sustained || held.Outputs["out"].Reason != tc.reason || alert.Status != tc.alert || intent != tc.intent || len(r.Intents) > 1 {
			t.Fatalf("minute %d: sustained %s (%q), alert %s, intents %+v", tc.minute, held.Status, held.Outputs["out"].Reason, alert.Status, r.Intents)
		}
	}
}

// A branch with no usable input has not chosen a side, so it reports why instead of "branch skipped".
func TestBranchPassesOnWhyItHasNoInput(t *testing.T) {
	p := compiled(t, offForThirtyMinutes())
	start := time.Unix(1800000000, 0).UTC()
	r, err := p.Step(p.Initial(start), reading("one", true, start.Add(time.Second)), start.Add(time.Second))
	if err != nil || r.Trace[1].Outputs["false"].Reason != "branch skipped" || !r.Trace[1].Outputs["true"].Known {
		t.Fatalf("taken side: %+v %v", r.Trace[1], err)
	}
	r, err = p.Step(r.State, nil, start.Add(11*time.Minute))
	if err != nil || r.Trace[1].Outputs["false"].Reason != "stale" || r.Trace[1].Outputs["true"].Reason != "stale" {
		t.Fatalf("stale input: %+v %v", r.Trace[1], err)
	}
}
