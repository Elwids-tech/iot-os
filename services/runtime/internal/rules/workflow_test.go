package rules

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func workflowFixture(t *testing.T) Workflow {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/rules/v1/workflow.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var w Workflow
	if err := json.Unmarshal(raw, &w); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestWorkflowCompilesToExistingEvaluator(t *testing.T) {
	w := workflowFixture(t)
	d, c, err := CompileWorkflow(w)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../../contracts/rules/v1/definition.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected Definition
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(d, expected) {
		t.Fatal("graph changed evaluator semantics")
	}
	w.Nodes[0], w.Nodes[3] = w.Nodes[3], w.Nodes[0]
	w.Edges[0], w.Edges[2] = w.Edges[2], w.Edges[0]
	_, reordered, err := CompileWorkflow(w)
	if err != nil || reordered.Hash != c.Hash {
		t.Fatal("array order changed execution", err)
	}
}

func TestWorkflowRejectsUnsupportedGraphsAndConfigs(t *testing.T) {
	for name, mutate := range map[string]func(*Workflow){
		"cycle":             func(w *Workflow) { w.Edges[2] = WorkflowEdge{"2", "0"} },
		"branch":            func(w *Workflow) { w.Edges[2] = WorkflowEdge{"0", "3"} },
		"duplicate edge":    func(w *Workflow) { w.Edges[2] = w.Edges[0] },
		"disconnected":      func(w *Workflow) { w.Edges = w.Edges[:2] },
		"unknown node":      func(w *Workflow) { w.Nodes[3].Type = "device.command.v1" },
		"duplicate id":      func(w *Workflow) { w.Nodes[3].ID = w.Nodes[0].ID },
		"unknown config":    func(w *Workflow) { w.Nodes[3].Config = json.RawMessage(`{"script":"execute"}`) },
		"null config":       func(w *Workflow) { w.Nodes[3].Config = json.RawMessage(`null`) },
		"missing threshold": func(w *Workflow) { w.Nodes[2].Config = json.RawMessage(`{"max_gap_seconds":45,"minimum_samples":2}`) },
		"invalid policy": func(w *Workflow) {
			w.Nodes[2].Config = json.RawMessage(`{"outside_for_seconds":60,"max_gap_seconds":45,"minimum_samples":1}`)
		},
	} {
		t.Run(name, func(t *testing.T) {
			w := workflowFixture(t)
			mutate(&w)
			if _, _, err := CompileWorkflow(w); err == nil {
				t.Fatal("accepted invalid workflow")
			}
		})
	}
}
