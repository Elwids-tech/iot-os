package rules

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/location"
)

// Workflow is a portable authoring document, independent of a canvas library.
// V1 deliberately supports only the proven geofence chain, not arbitrary DAGs.
type Workflow struct {
	SchemaVersion string         `json:"schema_version"`
	UUID          string         `json:"uuid"`
	VersionUUID   string         `json:"version_uuid"`
	Nodes         []WorkflowNode `json:"nodes"`
	Edges         []WorkflowEdge `json:"edges"`
}

type WorkflowNode struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Config json.RawMessage `json:"config"`
}

type WorkflowEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

func config(raw json.RawMessage, target any, required []string) error {
	if len(raw) == 0 || raw[0] != '{' {
		return fmt.Errorf("node config must be an object")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, key := range required {
		if len(fields[key]) == 0 || bytes.Equal(fields[key], []byte("null")) {
			return fmt.Errorf("missing config field %s", key)
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(target)
}

// CompileWorkflow checks structure and node configuration, then uses the same
// compiler as simulation/execution. Node array order has no execution meaning.
func CompileWorkflow(w Workflow) (Definition, *Compiled, error) {
	fail := func(message string) (Definition, *Compiled, error) {
		return Definition{}, nil, fmt.Errorf("%s", message)
	}
	if w.SchemaVersion != "automation-workflow.v1" || len(w.Nodes) != 4 || len(w.Edges) != 3 {
		return fail("v1 requires four nodes and three edges")
	}
	nodes := make(map[string]WorkflowNode)
	byType := make(map[string]string)
	for _, n := range w.Nodes {
		if n.ID == "" || len(n.ID) > 64 || nodes[n.ID].ID != "" || byType[n.Type] != "" {
			return fail("node IDs and types must be unique")
		}
		nodes[n.ID], byType[n.Type] = n, n.ID
	}
	registry := NodeTypes()
	d := Definition{SchemaVersion: "geofence-rule.v1", UUID: w.UUID, VersionUUID: w.VersionUUID, EvaluatorVersion: "geofence.v1"}
	for _, n := range registry {
		if byType[n.Type] == "" {
			return fail("unsupported or missing node type")
		}
		d.Pipeline = append(d.Pipeline, n.Type)
	}
	seen := make(map[string]bool)
	for _, edge := range w.Edges {
		valid := false
		for i := 0; i < len(registry)-1; i++ {
			if edge.Source == byType[registry[i].Type] && edge.Target == byType[registry[i+1].Type] {
				valid = true
			}
		}
		if !valid || seen[edge.Source] {
			return fail("edges must form the supported typed chain without cycles, branches or duplicates")
		}
		seen[edge.Source] = true
	}
	var source struct {
		Binding location.Binding `json:"binding"`
	}
	var membership struct {
		Geometry          Polygon `json:"geometry"`
		UncertaintyMetres float64 `json:"uncertainty_metres"`
	}
	var sustained struct {
		OutsideForSeconds int `json:"outside_for_seconds"`
		MaxGapSeconds     int `json:"max_gap_seconds"`
		MinimumSamples    int `json:"minimum_samples"`
	}
	required := [][]string{{"binding"}, {"geometry", "uncertainty_metres"}, {"outside_for_seconds", "max_gap_seconds", "minimum_samples"}, {}}
	for i, target := range []any{&source, &membership, &sustained, &struct{}{}} {
		if err := config(nodes[byType[registry[i].Type]].Config, target, required[i]); err != nil {
			return fail(fmt.Sprintf("%s: %s", registry[i].Type, err))
		}
	}
	d.Binding, d.Geometry = source.Binding, membership.Geometry
	d.Policy = Policy{OutsideForSeconds: sustained.OutsideForSeconds, MaxGapSeconds: sustained.MaxGapSeconds, MinimumSamples: sustained.MinimumSamples, UncertaintyMetres: membership.UncertaintyMetres}
	c, err := Compile(d)
	return d, c, err
}
