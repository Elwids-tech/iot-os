// Package dag contains the versioned, side-effect-free automation compiler and evaluator.
package dag

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

const Schema = "automation-workflow.v2"

type Binding struct {
	Role          string `json:"role"`
	Device        string `json:"device_uuid"`
	Configuration string `json:"configuration_uuid"`
	Generation    int    `json:"generation"`
	Parameter     string `json:"parameter_uuid"`
	DataType      string `json:"data_type"`
	Unit          string `json:"unit"`
	FreshSeconds  int    `json:"fresh_seconds"`
}
type Node struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	Config map[string]any `json:"config"`
}
type Edge struct {
	Source     string `json:"source"`
	SourcePort string `json:"source_port"`
	Target     string `json:"target"`
	TargetPort string `json:"target_port"`
}
type Workflow struct {
	Schema       string    `json:"schema_version"`
	UUID         string    `json:"uuid"`
	Version      string    `json:"version_uuid"`
	Organization string    `json:"organization_uuid"`
	Bindings     []Binding `json:"bindings"`
	Nodes        []Node    `json:"nodes"`
	Edges        []Edge    `json:"edges"`
}
type Diagnostic struct {
	Node    string `json:"node_id,omitempty"`
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Field struct {
	Type     string   `json:"type"`
	Required bool     `json:"required"`
	Enum     []string `json:"enum,omitempty"`
	Min      *float64 `json:"minimum,omitempty"`
	Max      *float64 `json:"maximum,omitempty"`
}
type NodeType struct {
	Type        string            `json:"type"`
	Label       string            `json:"label"`
	Inputs      map[string]string `json:"inputs"`
	Outputs     map[string]string `json:"outputs"`
	Config      map[string]Field  `json:"config_schema"`
	Stateful    bool              `json:"stateful"`
	Permissions []string          `json:"permissions"`
	Simulation  bool              `json:"simulation"`
}
type Value struct {
	Known   bool      `json:"known"`
	Value   any       `json:"value"`
	At      time.Time `json:"observed_at"`
	Expires time.Time `json:"expires_at"`
	Window  string    `json:"window,omitempty"`
	Token   string    `json:"token,omitempty"`
	Reason  string    `json:"reason,omitempty"`
}
type Sample struct {
	Value float64   `json:"value"`
	At    time.Time `json:"at"`
	Event string    `json:"event_id"`
}
type NodeState struct {
	Value      Value      `json:"value"`
	Samples    []Sample   `json:"samples,omitempty"`
	LastEnd    int64      `json:"last_end,omitempty"`
	Since      *time.Time `json:"since,omitempty"`
	Active     bool       `json:"active"`
	Episode    int        `json:"episode"`
	LastAction time.Time  `json:"last_action"`
	LastToken  string     `json:"last_token"`
}
type State struct {
	Started time.Time             `json:"started_at"`
	At      time.Time             `json:"evaluated_at"`
	Nodes   map[string]*NodeState `json:"nodes"`
	Episode int                   `json:"episode"`
}
type Intent struct {
	ID           string         `json:"id"`
	Workflow     string         `json:"workflow_uuid"`
	Version      string         `json:"operation_uuid"`
	Organization string         `json:"organization_uuid"`
	Node         string         `json:"node_id"`
	Correlation  string         `json:"correlation_key"`
	Kind         string         `json:"kind"`
	Trigger      string         `json:"trigger"`
	At           time.Time      `json:"occurred_at"`
	Expires      time.Time      `json:"expires_at"`
	Config       map[string]any `json:"config"`
	Episode      int            `json:"episode"`
	Transition   string         `json:"transition,omitempty"`
}
type Trace struct {
	Node      string           `json:"node_id"`
	Inputs    map[string]Value `json:"inputs"`
	Outputs   map[string]Value `json:"outputs"`
	Status    string           `json:"status"`
	Reason    string           `json:"reason"`
	EventNote string           `json:"event_note,omitempty"`
	IntentIDs []string         `json:"intent_ids,omitempty"`
}
type Result struct {
	State          State      `json:"state"`
	Intents        []Intent   `json:"intents"`
	Trace          []Trace    `json:"trace"`
	TraceTruncated bool       `json:"trace_truncated"`
	NextTimer      *time.Time `json:"next_timer"`
}
type Plan struct {
	Workflow Workflow
	Hash     string
	Order    []Node
	Incoming map[string][]Edge
	Bindings map[string]Binding
}

func Hash(v any) string {
	raw, _ := json.Marshal(v)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}
func number(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		value, err := n.Float64()
		return value, err == nil
	}
	return 0, false
}
func str(c map[string]any, k string) string  { s, _ := c[k].(string); return s }
func num(c map[string]any, k string) float64 { n, _ := number(c[k]); return n }
