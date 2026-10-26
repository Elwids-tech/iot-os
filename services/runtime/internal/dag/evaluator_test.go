package dag

import (
	"encoding/json"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"slices"
	"strings"
	"testing"
	"time"
)

const org = "11111111-1111-4111-a111-111111111111"
const device = "22222222-2222-4222-a222-222222222222"
const configuration = "33333333-3333-4333-a333-333333333333"
const parameter = "44444444-4444-4444-a444-444444444444"

func fixture() Workflow {
	return Workflow{Schema: Schema, UUID: org, Version: configuration, Organization: org, Bindings: []Binding{{"sensor", device, configuration, 1, parameter, "number", "C", 120}}, Nodes: []Node{{"source", "source.parameter.v1", map[string]any{"binding": "sensor"}}, {"threshold", "compare.v1", map[string]any{"operator": "gt", "value": float64(25)}}, {"alert", "action.alert.v1", map[string]any{"title": "Hot"}}}, Edges: []Edge{{"source", "out", "threshold", "in"}, {"threshold", "out", "alert", "in"}}}
}
func compiled(t *testing.T, w Workflow) *Plan {
	t.Helper()
	p, d := Compile(w)
	if len(d) > 0 {
		t.Fatalf("compile: %+v", d)
	}
	return p
}
func reading(id string, value any, observed time.Time) *devices.CommittedTelemetry {
	return &devices.CommittedTelemetry{SchemaVersion: "telemetry.committed.v1", EventID: id, OrganizationUUID: org, DeviceUUID: device, ConfigurationUUID: configuration, Generation: 1, Readings: []devices.CommittedReading{{ParameterUUID: parameter, Value: value, Quality: "good", ObservedAt: observed, ReceivedAt: observed}}}
}
func TestUnknownDoesNotClearAndRestartDoesNotDuplicate(t *testing.T) {
	p := compiled(t, fixture())
	at := time.Unix(1800000000, 0).UTC()
	s := p.Initial(at)
	r, e := p.Step(s, reading("one", float64(30), at.Add(time.Second)), at.Add(time.Second))
	if e != nil || len(r.Intents) != 1 || r.Intents[0].Transition != "activated" {
		t.Fatalf("activation: %+v %v", r, e)
	}
	raw, _ := json.Marshal(r.State)
	var recovered State
	_ = json.Unmarshal(raw, &recovered)
	r, e = p.Step(recovered, nil, at.Add(121*time.Second))
	if e != nil || len(r.Intents) != 0 {
		t.Fatalf("stale must not clear: %+v %v", r.Intents, e)
	}
	r, e = p.Step(r.State, reading("two", float64(10), at.Add(122*time.Second)), at.Add(122*time.Second))
	if e != nil || len(r.Intents) != 1 || r.Intents[0].Transition != "cleared" {
		t.Fatalf("clear: %+v %v", r.Intents, e)
	}
}
func TestWindowFinalizesOnceAndRejectsLateCorrection(t *testing.T) {
	w := fixture()
	w.Nodes = append(w.Nodes, Node{"window", "window.v1", map[string]any{"duration_seconds": float64(60), "slide_seconds": float64(60), "lateness_seconds": float64(5), "minimum_samples": float64(2), "aggregate": "average"}})
	w.Edges = []Edge{{"source", "out", "window", "in"}, {"window", "out", "threshold", "in"}, {"threshold", "out", "alert", "in"}}
	p := compiled(t, w)
	at := time.Unix(1800000000, 0).UTC()
	s := p.Initial(at)
	for _, sec := range []int{20, 10} {
		r, e := p.Step(s, reading(string(rune(sec)), float64(40), at.Add(time.Duration(sec)*time.Second)), at.Add(21*time.Second))
		if e != nil {
			t.Fatal(e)
		}
		s = r.State
		if len(r.Intents) != 0 {
			t.Fatal("window acted provisionally")
		}
	}
	r, e := p.Step(s, nil, at.Add(65*time.Second))
	if e != nil || len(r.Intents) != 1 {
		t.Fatalf("close: %+v %v", r.Intents, e)
	}
	r, e = p.Step(r.State, reading("late", float64(-100), at.Add(30*time.Second)), at.Add(66*time.Second))
	if e != nil || len(r.Intents) != 0 {
		t.Fatal("late data revised finalized action")
	}
	r, e = p.Step(r.State, nil, at.Add(125*time.Second))
	if e != nil || len(r.Intents) != 0 {
		t.Fatal("empty window cleared active alert")
	}
}
func TestCompilerRejectsUnsafeGraphs(t *testing.T) {
	for _, kind := range []string{"cycle", "port", "type", "config", "binding", "unreachable"} {
		t.Run(kind, func(t *testing.T) {
			w := fixture()
			switch kind {
			case "cycle":
				w.Edges = append(w.Edges, Edge{"threshold", "out", "threshold", "in"})
			case "port":
				w.Edges[0].SourcePort = "missing"
			case "type":
				w.Bindings[0].DataType = "boolean"
			case "config":
				w.Nodes[1].Config["script"] = "eval"
			case "binding":
				w.Bindings[0].Generation = 0
			case "unreachable":
				w.Nodes = append(w.Nodes, Node{"unused", "constant.v1", map[string]any{"value": float64(1)}})
			}
			if _, d := Compile(w); len(d) == 0 {
				t.Fatal("accepted unsafe graph")
			}
		})
	}
}
func TestCompilerNamesTheBindingFieldToFix(t *testing.T) {
	w := fixture()
	w.Bindings[0].FreshSeconds = 0
	w.Bindings[0].DataType = "integer"
	w.Bindings = append(w.Bindings, w.Bindings[0])
	_, d := Compile(w)
	var messages []string
	for _, diagnostic := range d {
		if diagnostic.Code == "binding" {
			messages = append(messages, diagnostic.Message)
		}
	}
	want := []string{
		`Binding "sensor": how long a reading stays current must be 1 to 86400 seconds (fresh_seconds)`,
		`Binding "sensor": use number for numeric and integer parameters, boolean or string (data_type)`,
		`Binding "sensor": another binding already uses this role (role)`,
	}
	for _, message := range want {
		if !slices.Contains(messages, message) {
			t.Fatalf("missing %q in %q", message, messages)
		}
	}
}
func TestHashIgnoresArrayOrder(t *testing.T) {
	w := fixture()
	a := compiled(t, w)
	w.Nodes[0], w.Nodes[2] = w.Nodes[2], w.Nodes[0]
	w.Edges[0], w.Edges[1] = w.Edges[1], w.Edges[0]
	b := compiled(t, w)
	if a.Hash != b.Hash {
		t.Fatal("array order changed semantics")
	}
}
func TestCrossDeviceWindowJoinAndCommand(t *testing.T) {
	w := fixture()
	b := w.Bindings[0]
	b.Role = "pressure"
	b.Device = "55555555-5555-4555-a555-555555555555"
	w.Bindings = append(w.Bindings, b)
	window := map[string]any{"duration_seconds": float64(60), "slide_seconds": float64(60), "lateness_seconds": float64(5), "minimum_samples": float64(1), "aggregate": "average"}
	w.Nodes = []Node{{"a", "source.parameter.v1", map[string]any{"binding": "sensor"}}, {"b", "source.parameter.v1", map[string]any{"binding": "pressure"}}, {"wa", "window.v1", window}, {"wb", "window.v1", window}, {"join", "join.v1", map[string]any{"mode": "window"}}, {"hot", "compare.v1", map[string]any{"operator": "gt", "value": float64(25)}}, {"high", "compare.v1", map[string]any{"operator": "gt", "value": float64(25)}}, {"and", "boolean.v1", map[string]any{"operator": "and"}}, {"command", "action.command.v1", map[string]any{"binding": "sensor", "value": float64(0), "cooldown_seconds": float64(60), "ttl_seconds": float64(30)}}}
	w.Edges = []Edge{{"a", "out", "wa", "in"}, {"b", "out", "wb", "in"}, {"wa", "out", "join", "a"}, {"wb", "out", "join", "b"}, {"join", "a", "hot", "in"}, {"join", "b", "high", "in"}, {"hot", "out", "and", "a"}, {"high", "out", "and", "b"}, {"and", "out", "command", "in"}}
	p := compiled(t, w)
	at := time.Unix(1800000000, 0).UTC()
	r, _ := p.Step(p.Initial(at), reading("one", float64(30), at.Add(time.Second)), at.Add(time.Second))
	other := reading("two", float64(40), at.Add(2*time.Second))
	other.DeviceUUID = b.Device
	r, e := p.Step(r.State, other, at.Add(2*time.Second))
	if e != nil {
		t.Fatal(e)
	}
	r, e = p.Step(r.State, nil, at.Add(65*time.Second))
	if e != nil || len(r.Intents) != 1 {
		t.Fatalf("join: %+v %v", r.Intents, e)
	}
	id := r.Intents[0].ID
	r, e = p.Step(r.State, nil, at.Add(66*time.Second))
	if e != nil || len(r.Intents) != 0 {
		t.Fatal("repeated action", id)
	}
}

func TestBrokerJSONNumbersMatchHTTP(t *testing.T) {
	w := fixture()
	raw, _ := json.Marshal(w)
	var decoded Workflow
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	p := compiled(t, decoded)
	at := time.Unix(1800000000, 0).UTC()
	r, e := p.Step(p.Initial(at), reading("one", json.Number("30"), at.Add(time.Second)), at.Add(time.Second))
	if e != nil || len(r.Intents) != 1 {
		t.Fatalf("broker number: %+v %v", r.Intents, e)
	}
}

func TestArithmeticUnitsRemainSound(t *testing.T) {
	for _, tc := range []struct {
		name, operator, a, b, conversion string
		valid                            bool
	}{
		{"compound product rejected", "multiply", "source", "source", "C", false},
		{"scalar on left preserves unit", "multiply", "constant", "source", "C", true},
		{"scalar on right preserves unit", "multiply", "source", "constant", "C", true},
		{"ratio cannot convert as temperature", "divide", "source", "source", "C", false},
		{"dimensionless divisor preserves unit", "divide", "source", "constant", "C", true},
		{"inverse units rejected", "divide", "constant", "source", "C", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := fixture()
			w.Nodes = append(w.Nodes, Node{"constant", "constant.v1", map[string]any{"value": float64(2)}}, Node{"math", "math.v1", map[string]any{"operator": tc.operator}}, Node{"conversion", "convert.v1", map[string]any{"from": tc.conversion, "to": "F"}})
			w.Edges = []Edge{{tc.a, "out", "math", "a"}, {tc.b, "out", "math", "b"}, {"math", "out", "conversion", "in"}, {"conversion", "out", "threshold", "in"}, {"threshold", "out", "alert", "in"}}
			// Remove an unused constant so reachability does not mask unit validation.
			if tc.a != "constant" && tc.b != "constant" {
				w.Nodes = append(w.Nodes[:3], w.Nodes[4:]...)
			}
			_, diagnostics := Compile(w)
			if (len(diagnostics) == 0) != tc.valid {
				t.Fatalf("valid=%v diagnostics=%+v", tc.valid, diagnostics)
			}
		})
	}
}

func TestDelayedBrokerCutoffDoesNotFinalizeNewerWindows(t *testing.T) {
	w := fixture()
	w.Nodes = append(w.Nodes, Node{"window", "window.v1", map[string]any{"duration_seconds": float64(60), "slide_seconds": float64(60), "lateness_seconds": float64(5), "minimum_samples": float64(1), "aggregate": "average"}})
	w.Edges = []Edge{{"source", "out", "window", "in"}, {"window", "out", "threshold", "in"}, {"threshold", "out", "alert", "in"}}
	p := compiled(t, w)
	at := time.Unix(1800000000, 0).UTC()
	r, err := p.Step(p.Initial(at), reading("first", float64(40), at.Add(10*time.Second)), at.Add(10*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	// The 65-second cutoff takes until second 190 to drain. Only the first
	// window has a complete broker snapshot, despite three deadlines passing.
	r, err = p.StepThrough(r.State, nil, at.Add(190*time.Second), at.Add(65*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if got := r.State.Nodes["window"].LastEnd; got != at.Add(60*time.Second).Unix() {
		t.Fatalf("finalized beyond cutoff: %d", got)
	}
	// Input still pending beyond that cutoff must count in the next window.
	r, err = p.Step(r.State, reading("backlogged", float64(10), at.Add(90*time.Second)), at.Add(191*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	r, err = p.StepThrough(r.State, nil, at.Add(192*time.Second), at.Add(125*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !r.State.Nodes["window"].Value.Known || r.State.Nodes["window"].Value.Value != float64(10) {
		t.Fatalf("lost backlog evidence: %+v", r.State.Nodes["window"].Value)
	}
	if len(r.Intents) != 1 || r.Intents[0].Transition != "cleared" {
		t.Fatalf("expected clear from complete second window: %+v", r.Intents)
	}
}
