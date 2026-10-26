package dag

import (
	"encoding/json"
	"fmt"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"math"
	"regexp"
	"slices"
	"sort"
)

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var id = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`)

func Compile(w Workflow) (*Plan, []Diagnostic) {
	d := []Diagnostic{}
	fail := func(n, field, code, message string) { d = append(d, Diagnostic{n, field, code, message}) }
	if w.Schema != Schema || !uuid.MatchString(w.UUID) || !uuid.MatchString(w.Version) || !uuid.MatchString(w.Organization) {
		fail("", "schema_version", "identity", "Invalid v2 workflow identity")
	}
	if len(w.Nodes) < 2 || len(w.Nodes) > 100 || len(w.Edges) > 200 || len(w.Bindings) > 32 {
		fail("", "nodes", "limit", "Use 2–100 nodes, up to 200 edges and 32 bindings")
	}
	p := &Plan{Workflow: w, Incoming: map[string][]Edge{}, Bindings: map[string]Binding{}}
	// Each problem names its field, so the editor and the assistant can correct it rather than guess.
	for _, b := range w.Bindings {
		problem := func(field, message string) {
			fail("", "bindings", "binding", fmt.Sprintf("Binding %q: %s", b.Role, message)+" ("+field+")")
		}
		if !id.MatchString(b.Role) {
			problem("role", "the role must start with a letter and use up to 64 letters, digits, - or _")
		} else if p.Bindings[b.Role].Role != "" {
			problem("role", "another binding already uses this role")
		}
		for _, field := range [][2]string{{"device_uuid", b.Device}, {"configuration_uuid", b.Configuration}, {"parameter_uuid", b.Parameter}} {
			if !uuid.MatchString(field[1]) {
				problem(field[0], "copy the UUID from the device's applied configuration")
			}
		}
		if b.Generation < 1 {
			problem("generation", "use the device's current deployment generation, 1 or more")
		}
		if b.FreshSeconds < 1 || b.FreshSeconds > 86400 {
			problem("fresh_seconds", "how long a reading stays current must be 1 to 86400 seconds")
		}
		if !slices.Contains([]string{"number", "boolean", "string"}, b.DataType) {
			problem("data_type", "use number for numeric and integer parameters, boolean or string")
		}
		p.Bindings[b.Role] = b
	}
	registry := map[string]NodeType{}
	for _, t := range Registry() {
		registry[t.Type] = t
	}
	nodes := map[string]Node{}
	degree := map[string]int{}
	adj := map[string][]string{}
	actions := 0
	alerts := 0
	for _, n := range w.Nodes {
		if !id.MatchString(n.ID) || nodes[n.ID].ID != "" {
			fail(n.ID, "id", "duplicate", "Invalid or duplicate node ID")
		}
		nodes[n.ID] = n
		degree[n.ID] = 0
		t, ok := registry[n.Type]
		if !ok {
			fail(n.ID, "type", "unsupported", "Unsupported node type")
			continue
		}
		for key := range n.Config {
			if _, ok := t.Config[key]; !ok {
				fail(n.ID, "config."+key, "unknown", "Unsupported configuration field")
			}
		}
		for key, f := range t.Config {
			v, exists := n.Config[key]
			if !exists {
				if f.Required {
					fail(n.ID, "config."+key, "required", "Required field")
				}
				continue
			}
			valid := true
			switch f.Type {
			case "string":
				s, ok := v.(string)
				valid = ok && len(s) > 0 && len(s) <= 255 && (len(f.Enum) == 0 || slices.Contains(f.Enum, s))
			case "number":
				x, ok := number(v)
				valid = ok && !math.IsNaN(x) && !math.IsInf(x, 0) && (f.Min == nil || x >= *f.Min) && (f.Max == nil || x <= *f.Max)
				if f.Min != nil && math.Trunc(x) != x {
					valid = false
				}
			case "object":
				_, valid = v.(map[string]any)
			case "scalar":
				switch v.(type) {
				case float64, json.Number, string, bool:
				default:
					valid = false
				}
			}
			if !valid {
				fail(n.ID, "config."+key, "value", "Invalid configuration value")
			}
		}
		if n.Type == "source.parameter.v1" {
			if _, ok := p.Bindings[str(n.Config, "binding")]; !ok {
				fail(n.ID, "config.binding", "binding", "Unknown binding")
			}
		}
		if n.Type == "action.command.v1" {
			configs := commandConfigs(n.Config)
			if settings, exists := n.Config["settings"]; exists {
				values, ok := settings.(map[string]any)
				_, legacyBinding := n.Config["binding"]
				_, legacyValue := n.Config["value"]
				if !ok || len(values) == 0 || len(values) > 32 || legacyBinding || legacyValue {
					fail(n.ID, "config.settings", "settings", "Select 1–32 settings, without legacy binding/value fields")
				}
			}
			device, configuration := "", ""
			targets := map[string]bool{}
			for _, c := range configs {
				b, ok := p.Bindings[str(c, "binding")]
				if !ok {
					fail(n.ID, "config.settings", "binding", "Unknown command binding")
					continue
				}
				v := c["value"]
				_, numeric := number(v)
				_, boolean := v.(bool)
				_, text := v.(string)
				if b.DataType == "number" && !numeric || b.DataType == "boolean" && !boolean || b.DataType == "string" && !text {
					fail(n.ID, "config.settings", "type", "Command value does not match binding "+b.Role)
				}
				if device != "" && (device != b.Device || configuration != b.Configuration) {
					fail(n.ID, "config.settings", "device", "Settings must target one device configuration")
				}
				if targets[b.Parameter] {
					fail(n.ID, "config.settings", "duplicate", "Each parameter may be set only once")
				}
				targets[b.Parameter] = true
				device, configuration = b.Device, b.Configuration
			}
		}
		if n.Type == "window.v1" {
			duration, slide := num(n.Config, "duration_seconds"), num(n.Config, "slide_seconds")
			if slide <= 0 || duration < slide || math.Mod(duration, slide) != 0 || duration/slide > 100 {
				fail(n.ID, "config.slide_seconds", "window", "Slide must divide duration with at most 100 overlapping windows")
			}
		}
		if n.Type == "hysteresis.v1" && num(n.Config, "clear_below") >= num(n.Config, "activate_above") {
			fail(n.ID, "config.clear_below", "threshold", "Clear threshold must be below activation threshold")
		}
		if n.Type == "geofence.v1" {
			raw, _ := json.Marshal(n.Config["geometry"])
			var polygon rules.Polygon
			if err := json.Unmarshal(raw, &polygon); err != nil {
				fail(n.ID, "config.geometry", "polygon", "Invalid polygon")
			} else if _, err := rules.SpatialCondition(polygon, 0, 0, 0); err != nil {
				fail(n.ID, "config.geometry", "polygon", err.Error())
			}
		}
		if n.Type == "convert.v1" {
			_, ok := convert(0, str(n.Config, "from"), str(n.Config, "to"))
			if !ok {
				fail(n.ID, "config.to", "unit", "Incompatible units")
			}
		}
		if len(t.Outputs) == 0 {
			actions++
		}
		if n.Type == "action.alert.v1" {
			alerts++
		}
	}
	if len(w.Bindings) == 0 {
		fail("", "bindings", "required", "Bind at least one device")
	}
	if actions == 0 || alerts > 1 {
		fail("", "nodes", "actions", "Include an action; at most one alert lifecycle per workflow")
	}
	used := map[string]bool{}
	for _, e := range w.Edges {
		a, aok := nodes[e.Source]
		b, bok := nodes[e.Target]
		_, out := registry[a.Type].Outputs[e.SourcePort]
		_, in := registry[b.Type].Inputs[e.TargetPort]
		key := e.Target + ":" + e.TargetPort
		if !aok || !bok || !out || !in || used[key] {
			fail(e.Target, "edges", "port", "Invalid edge or multiple producers for one input")
			continue
		}
		used[key] = true
		p.Incoming[e.Target] = append(p.Incoming[e.Target], e)
		degree[e.Target]++
		adj[e.Source] = append(adj[e.Source], e.Target)
	}
	ready := []string{}
	for key, n := range nodes {
		for port := range registry[n.Type].Inputs {
			if !used[key+":"+port] {
				fail(key, "inputs."+port, "required", "Input is not connected")
			}
		}
		if degree[key] == 0 {
			ready = append(ready, key)
		}
	}
	for len(ready) > 0 {
		sort.Strings(ready)
		key := ready[0]
		ready = ready[1:]
		p.Order = append(p.Order, nodes[key])
		for _, next := range adj[key] {
			degree[next]--
			if degree[next] == 0 {
				ready = append(ready, next)
			}
		}
	}
	if len(p.Order) != len(nodes) {
		fail("", "edges", "cycle", "Graph must be acyclic")
	}
	types := map[string]string{}
	units := map[string]string{}
	roots := map[string]string{}
	live := map[string]bool{}
	for _, n := range p.Order {
		t := registry[n.Type]
		inputTypes := map[string]string{}
		inputUnits := map[string]string{}
		sources := map[string]bool{}
		for _, e := range p.Incoming[n.ID] {
			got := types[e.Source+":"+e.SourcePort]
			want := t.Inputs[e.TargetPort]
			inputTypes[e.TargetPort] = got
			inputUnits[e.TargetPort] = units[e.Source+":"+e.SourcePort]
			if want != "any" && got != want {
				fail(n.ID, "inputs."+e.TargetPort, "type", fmt.Sprintf("Expected %s, got %s", want, got))
			}
			if root := roots[e.Source]; root != "" {
				sources[root] = true
			}
		}
		if len(sources) > 1 && n.Type != "join.v1" {
			fail(n.ID, "inputs", "join", "Cross-device or branch reconvergence requires an explicit join")
		}
		root := ""
		for key := range sources {
			root = key
		}
		if n.Type == "source.parameter.v1" || n.Type == "join.v1" || n.Type == "branch.v1" {
			root = n.ID
		}
		roots[n.ID] = root
		if n.Type == "convert.v1" && inputUnits["in"] != str(n.Config, "from") {
			fail(n.ID, "config.from", "unit", "Conversion source unit does not match the connected parameter")
		}
		if n.Type == "geofence.v1" && (inputUnits["latitude"] != "deg" || inputUnits["longitude"] != "deg") {
			fail(n.ID, "inputs", "unit", "Geofence coordinates must be in degrees")
		}
		if n.Type == "math.v1" && (str(n.Config, "operator") == "add" || str(n.Config, "operator") == "subtract") && inputUnits["a"] != inputUnits["b"] {
			fail(n.ID, "inputs", "unit", "Addition and subtraction require matching units")
		}
		if n.Type == "math.v1" {
			switch str(n.Config, "operator") {
			case "multiply":
				if inputUnits["a"] != "" && inputUnits["b"] != "" {
					fail(n.ID, "inputs", "unit", "Multiplication requires at least one dimensionless input; compound units are unsupported")
				}
			case "divide":
				if inputUnits["b"] != "" && inputUnits["a"] != inputUnits["b"] {
					fail(n.ID, "inputs", "unit", "Division requires a dimensionless divisor or matching units")
				}
			}
		}
		for port, kind := range t.Outputs {
			if kind == "binding" {
				kind = p.Bindings[str(n.Config, "binding")].DataType
			}
			if kind == "input:a" {
				kind = inputTypes["a"]
			}
			if kind == "input:b" {
				kind = inputTypes["b"]
			}
			types[n.ID+":"+port] = kind
			unit := inputUnits["in"]
			if n.Type == "source.parameter.v1" {
				unit = p.Bindings[str(n.Config, "binding")].Unit
			}
			if n.Type == "join.v1" {
				unit = inputUnits[port]
			}
			if n.Type == "convert.v1" {
				unit = str(n.Config, "to")
			}
			if n.Type == "window.v1" && str(n.Config, "aggregate") == "count" {
				unit = ""
			}
			if n.Type == "math.v1" {
				unit = inputUnits["a"]
				if str(n.Config, "operator") == "multiply" && unit == "" {
					unit = inputUnits["b"]
				}
				if str(n.Config, "operator") == "divide" && inputUnits["a"] == inputUnits["b"] {
					unit = ""
				}
			}
			units[n.ID+":"+port] = unit
		}
		if n.Type == "window.v1" && (len(p.Incoming[n.ID]) != 1 || nodes[p.Incoming[n.ID][0].Source].Type != "source.parameter.v1") {
			fail(n.ID, "inputs.in", "window_source", "Window input must be a numeric device source")
		}
		if len(t.Outputs) == 0 {
			live[n.ID] = true
		}
	}
	for i := len(p.Order) - 1; i >= 0; i-- {
		n := p.Order[i]
		if live[n.ID] {
			for _, e := range p.Incoming[n.ID] {
				live[e.Source] = true
			}
		} else {
			fail(n.ID, "edges", "unreachable", "Node does not reach an action")
		}
	}
	if len(d) > 0 {
		return nil, d
	}
	canonical := w
	canonical.Nodes = append([]Node(nil), w.Nodes...)
	canonical.Edges = append([]Edge(nil), w.Edges...)
	canonical.Bindings = append([]Binding(nil), w.Bindings...)
	sort.Slice(canonical.Nodes, func(i, j int) bool { return canonical.Nodes[i].ID < canonical.Nodes[j].ID })
	sort.Slice(canonical.Edges, func(i, j int) bool { return Hash(canonical.Edges[i]) < Hash(canonical.Edges[j]) })
	sort.Slice(canonical.Bindings, func(i, j int) bool { return canonical.Bindings[i].Role < canonical.Bindings[j].Role })
	p.Hash = Hash(canonical)
	return p, d
}
