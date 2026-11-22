package dag

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
)

// The alert limits the control plane reads out of an automation graph (spec 037)
// must be the values this evaluator acts on. The control plane's DeploymentGraph is
// tested against the same file; here each probed case is run with a reading at and
// just either side of every limit.
type limitCase struct {
	Name     string   `json:"name"`
	Workflow Workflow `json:"workflow"`
	Limits   []struct {
		Role     string  `json:"role"`
		Operator string  `json:"operator"`
		Value    float64 `json:"value"`
	} `json:"limits"`
	Probe string `json:"probe"`
}

func TestAlertLimitsFixtureMatchesTheEvaluator(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/rules/v2/alert-limits.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []json.RawMessage `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	probed := 0
	for _, encoded := range file.Cases {
		var probe struct {
			Name  string `json:"name"`
			Probe string `json:"probe"`
		}
		if err := json.Unmarshal(encoded, &probe); err != nil {
			t.Fatal(err)
		}
		if probe.Probe == "" {
			continue
		}
		var c limitCase
		if err := json.Unmarshal(encoded, &c); err != nil {
			t.Fatalf("%s: %v", probe.Name, err)
		}
		probed++
		t.Run(c.Name, func(t *testing.T) {
			p := compiled(t, c.Workflow)
			at := time.Unix(1800000000, 0).UTC()
			// Whether one reading, on a fresh execution, raises the alert.
			raises := func(value float64) bool {
				r, e := p.Step(p.Initial(at), reading(fmt.Sprint(value), value, at.Add(time.Second)), at.Add(time.Second))
				if e != nil {
					t.Fatal(e)
				}
				for _, intent := range r.Intents {
					if intent.Transition == "activated" {
						return true
					}
				}
				return false
			}
			expect := func(value float64, want bool) {
				t.Helper()
				if got := raises(value); got != want {
					t.Fatalf("a reading of %v raises the alert: %v, the fixture says %v", value, got, want)
				}
			}
			if c.Probe == "hysteresis" {
				hysteresis(t, p, at, c)
				return
			}
			for _, limit := range c.Limits {
				if limit.Role != "raise" {
					t.Fatalf("unexpected role %q", limit.Role)
				}
				v, d := limit.Value, 0.01
				above, below := map[string]bool{"gt": true, "gte": true}[limit.Operator], map[string]bool{"lt": true, "lte": true}[limit.Operator]
				expect(v+d, above)
				expect(v-d, below)
				if c.Probe == "exact" {
					expect(v, map[string]bool{"gte": true, "lte": true, "eq": true}[limit.Operator])
				}
			}
		})
	}
	if probed < 10 {
		t.Fatalf("only %d cases were probed", probed)
	}
}

// A hysteresis case turns on above its raise limit and off below its clear limit, and
// nothing changes in between.
func hysteresis(t *testing.T, p *Plan, at time.Time, c limitCase) {
	t.Helper()
	var raise, clear float64
	for _, limit := range c.Limits {
		switch {
		case limit.Role == "raise" && limit.Operator == "gt":
			raise = limit.Value
		case limit.Role == "clear" && limit.Operator == "lt":
			clear = limit.Value
		default:
			t.Fatalf("unexpected limit %+v", limit)
		}
	}
	s := p.Initial(at)
	steps := []struct {
		value float64
		want  string
	}{{(raise + clear) / 2, ""}, {raise, ""}, {raise + 0.01, "activated"}, {(raise + clear) / 2, ""}, {clear, ""}, {clear - 0.01, "cleared"}}
	for i, step := range steps {
		now := at.Add(time.Duration(i+1) * time.Second)
		r, e := p.Step(s, reading(fmt.Sprint(i), step.value, now), now)
		if e != nil {
			t.Fatal(e)
		}
		s = r.State
		got := ""
		for _, intent := range r.Intents {
			got = intent.Transition
		}
		if got != step.want {
			t.Fatalf("step %d, reading %v: transition %q, the fixture says %q", i, step.value, got, step.want)
		}
	}
}
