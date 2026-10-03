package dag

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
)

func (p *Plan) Initial(at time.Time) State {
	s := State{Started: at, At: at, Nodes: map[string]*NodeState{}}
	for _, n := range p.Order {
		s.Nodes[n.ID] = &NodeState{}
		if n.Type == "window.v1" {
			slide := int64(num(n.Config, "slide_seconds"))
			s.Nodes[n.ID].LastEnd = ((at.Unix()+slide-1)/slide)*slide + int64(num(n.Config, "duration_seconds")) - slide
		}
	}
	return s
}
func unknown(reason string) Value { return Value{Reason: reason} }
func fresh(v Value, at time.Time) Value {
	if v.Known && !v.Expires.IsZero() && !at.Before(v.Expires) {
		return unknown("stale")
	}
	return v
}
func boolean(v Value) (bool, bool)      { b, ok := v.Value.(bool); return b, v.Known && ok }
func metadata(v Value, value any) Value { v.Value = value; return v }
func merge(a, b Value, value any) Value {
	if !a.Known || !b.Known {
		return unknown("missing input")
	}
	if a.Window != b.Window {
		return unknown("unmatched window")
	}
	v := a
	v.Value = value
	v.Token = Hash([]string{a.Token, b.Token})
	if v.Expires.IsZero() || !b.Expires.IsZero() && b.Expires.Before(v.Expires) {
		v.Expires = b.Expires
	}
	if b.At.After(v.At) {
		v.At = b.At
	}
	return v
}

// Step clones state. Only its committed result may replace the previous state.
// A nil event is a recorded timer tick, supplied only after draining a broker cutoff.
func (p *Plan) Step(previous State, event *devices.CommittedTelemetry, at time.Time) (Result, error) {
	return p.StepThrough(previous, event, at, at)
}

// StepThrough limits window finalization to the time covered by a drained broker
// cutoff. Processing may happen later; that later wall clock still governs
// freshness and command expiry, but cannot close additional windows.
func (p *Plan) StepThrough(previous State, event *devices.CommittedTelemetry, at, finalizedThrough time.Time) (Result, error) {
	if at.Before(previous.At) {
		return Result{}, fmt.Errorf("clock cannot move backwards")
	}
	raw, _ := json.Marshal(previous)
	var s State
	if err := json.Unmarshal(raw, &s); err != nil {
		return Result{}, err
	}
	s.At = at
	if s.Nodes == nil {
		return Result{}, fmt.Errorf("missing execution state")
	}
	if event != nil {
		if event.OrganizationUUID != p.Workflow.Organization {
			return Result{}, fmt.Errorf("event organization mismatch")
		}
		for _, n := range p.Order {
			if n.Type != "source.parameter.v1" {
				continue
			}
			b := p.Bindings[str(n.Config, "binding")]
			if event.DeviceUUID != b.Device {
				continue
			}
			ns := s.Nodes[n.ID]
			if event.ConfigurationUUID != b.Configuration || event.Generation != b.Generation {
				return Result{}, fmt.Errorf("binding_changed")
			}
			for _, r := range event.Readings {
				if r.ParameterUUID != b.Parameter {
					continue
				}
				if r.ObservedAt.Before(s.Started) || r.ObservedAt.After(at) || r.Historical {
					continue
				}
				if r.Quality != "good" || r.Value == nil {
					if !r.ObservedAt.Before(ns.Value.At) {
						ns.Value = Value{At: r.ObservedAt, Reason: "invalid reading"}
					}
					continue
				}
				validType := false
				switch b.DataType {
				case "number":
					_, validType = number(r.Value)
				case "boolean":
					_, validType = r.Value.(bool)
				case "string":
					_, validType = r.Value.(string)
				}
				if !validType {
					if !r.ObservedAt.Before(ns.Value.At) {
						ns.Value = Value{At: r.ObservedAt, Reason: "reading type mismatch"}
					}
					continue
				}
				v := Value{Known: true, Value: r.Value, At: r.ObservedAt, Expires: r.ObservedAt.Add(time.Duration(b.FreshSeconds) * time.Second), Token: event.EventID}
				if !r.ObservedAt.Before(ns.Value.At) {
					ns.Value = v
				}
				if x, ok := number(r.Value); ok {
					if len(ns.Samples) >= 10000 {
						return Result{}, fmt.Errorf("source sample limit exceeded")
					}
					ns.Samples = append(ns.Samples, Sample{x, r.ObservedAt, event.EventID})
				}
			}
		}
	}
	result := Result{Intents: []Intent{}, Trace: []Trace{}}
	// Finalize all windows with the same deadline together. Multiple window periods
	// are evaluated separately, so joins cannot combine different windows.
	deadlines := map[int64]bool{}
	if event == nil {
		for _, n := range p.Order {
			if n.Type != "window.v1" {
				continue
			}
			ns := s.Nodes[n.ID]
			slide := int64(num(n.Config, "slide_seconds"))
			late := int64(num(n.Config, "lateness_seconds"))
			for end, count := ns.LastEnd+slide, 0; end+late <= finalizedThrough.Unix() && count < 128; end, count = end+slide, count+1 {
				deadlines[end+late] = true
			}
		}
	}
	ticks := []int64{}
	for d := range deadlines {
		ticks = append(ticks, d)
	}
	sort.Slice(ticks, func(i, j int) bool { return ticks[i] < ticks[j] })
	if len(ticks) > 128 {
		ticks = ticks[:128]
	}
	ticks = append(ticks, 0)
	for _, tick := range ticks {
		values := map[string]Value{}
		for _, n := range p.Order {
			ns := s.Nodes[n.ID]
			in := map[string]Value{}
			out := map[string]Value{}
			for _, e := range p.Incoming[n.ID] {
				in[e.TargetPort] = values[e.Source+":"+e.SourcePort]
			}
			v := in["in"]
			switch n.Type {
			case "source.parameter.v1":
				out["out"] = fresh(ns.Value, at)
			case "constant.v1":
				out["out"] = Value{Known: true, Value: num(n.Config, "value"), At: at, Token: n.ID}
			case "window.v1":
				out["out"] = fresh(ns.Value, at)
				if ns.Value.Token == "" {
					out["out"] = unknown("window pending")
				}
				if tick == 0 {
					break
				}
				end := tick - int64(num(n.Config, "lateness_seconds"))
				slide := int64(num(n.Config, "slide_seconds"))
				if end != ns.LastEnd+slide {
					break
				}
				start := end - int64(num(n.Config, "duration_seconds"))
				source := s.Nodes[p.Incoming[n.ID][0].Source]
				samples := []Sample{}
				for _, sample := range source.Samples {
					if sample.At.Unix() >= start && sample.At.Unix() < end {
						samples = append(samples, sample)
					}
				}
				v = Value{Window: fmt.Sprintf("%d:%d", start, end), Token: fmt.Sprintf("%d:%d", start, end), At: time.Unix(end, 0).UTC(), Reason: "insufficient evidence"}
				if len(samples) >= int(num(n.Config, "minimum_samples")) {
					x := samples[0].Value
					agg := str(n.Config, "aggregate")
					if agg == "sum" || agg == "average" {
						x = 0
					}
					for _, sample := range samples {
						switch agg {
						case "sum", "average":
							x += sample.Value
						case "min":
							x = math.Min(x, sample.Value)
						case "max":
							x = math.Max(x, sample.Value)
						}
					}
					if agg == "count" {
						x = float64(len(samples))
					}
					if agg == "average" {
						x /= float64(len(samples))
					}
					v.Known = true
					v.Value = x
					v.Reason = ""
				}
				ns.LastEnd = end
				v.Expires = time.Unix(end+slide+int64(num(n.Config, "lateness_seconds")), 0).UTC()
				ns.Value = v
				out["out"] = v
			case "join.v1":
				a, b := in["a"], in["b"]
				valid := a.Known && b.Known && a.Window == b.Window
				if str(n.Config, "mode") == "window" {
					valid = valid && a.Window != ""
				}
				if str(n.Config, "mode") == "latest" {
					valid = valid && a.Window == ""
				}
				if valid {
					out["a"] = merge(a, b, a.Value)
					out["b"] = merge(a, b, b.Value)
				} else {
					out["a"] = unknown("join waiting for matching inputs")
					out["b"] = out["a"]
				}
			case "math.v1":
				a, b := in["a"], in["b"]
				x, xok := number(a.Value)
				y, yok := number(b.Value)
				v = merge(a, b, float64(0))
				if xok && yok && v.Known {
					switch str(n.Config, "operator") {
					case "add":
						v.Value = x + y
					case "subtract":
						v.Value = x - y
					case "multiply":
						v.Value = x * y
					case "divide":
						if y == 0 {
							v = unknown("division by zero")
						} else {
							v.Value = x / y
						}
					}
				}
				out["out"] = v
			case "convert.v1":
				if v.Known {
					x, _ := number(v.Value)
					y, _ := convert(x, str(n.Config, "from"), str(n.Config, "to"))
					v.Value = y
				}
				out["out"] = v
			case "geofence.v1":
				lat, lon := in["latitude"], in["longitude"]
				v = merge(lat, lon, false)
				if v.Known {
					raw, _ := json.Marshal(n.Config["geometry"])
					var polygon rules.Polygon
					_ = json.Unmarshal(raw, &polygon)
					x, _ := number(lon.Value)
					y, _ := number(lat.Value)
					condition, err := rules.SpatialCondition(polygon, x, y, num(n.Config, "uncertainty_metres"))
					if err != nil || condition == "unknown" {
						v = unknown("uncertain location")
					} else {
						v.Value = condition == str(n.Config, "condition")
					}
				}
				out["out"] = v
			case "compare.v1":
				if v.Known {
					x, _ := number(v.Value)
					y := num(n.Config, "value")
					b := false
					switch str(n.Config, "operator") {
					case "gt":
						b = x > y
					case "gte":
						b = x >= y
					case "lt":
						b = x < y
					case "lte":
						b = x <= y
					case "eq":
						b = x == y
					}
					v.Value = b
				}
				out["out"] = v
			case "boolean.v1":
				a, aok := boolean(in["a"])
				b, bok := boolean(in["b"])
				v = merge(in["a"], in["b"], false)
				if aok && bok && v.Known {
					v.Value = a && b
					if str(n.Config, "operator") == "or" {
						v.Value = a || b
					}
				}
				out["out"] = v
			case "branch.v1":
				b, ok := boolean(v)
				out["true"] = unknown("branch skipped")
				out["false"] = out["true"]
				if ok {
					if b {
						out["true"] = v
					} else {
						out["false"] = metadata(v, true)
					}
				}
			case "hysteresis.v1":
				if v.Known {
					x, _ := number(v.Value)
					if x > num(n.Config, "activate_above") {
						ns.Active = true
					}
					if x < num(n.Config, "clear_below") {
						ns.Active = false
					}
					v.Value = ns.Active
				}
				out["out"] = v
			case "sustained.v1":
				b, ok := boolean(v)
				if !ok || !b {
					ns.Since = nil
				} else if ns.Since == nil {
					t := at
					ns.Since = &t
				}
				if ok {
					v.Value = b && ns.Since != nil && !at.Before(ns.Since.Add(time.Duration(num(n.Config, "seconds"))*time.Second))
				}
				out["out"] = v
			case "cooldown.v1":
				b, ok := boolean(v)
				if ok && b {
					if at.Before(ns.LastAction.Add(time.Duration(num(n.Config, "seconds")) * time.Second)) {
						v = unknown("cooldown")
					} else if v.Token != ns.LastToken {
						ns.LastAction = at
						ns.LastToken = v.Token
					}
				}
				out["out"] = v
			case "action.alert.v1", "action.command.v1", "action.event.v1":
				b, ok := boolean(v)
				if !ok {
					break
				}
				previousActive := ns.Active
				ns.Active = b
				if n.Type == "action.alert.v1" {
					if b == previousActive {
						break
					}
					kind := "cleared"
					if b {
						kind = "activated"
						s.Episode++
						ns.Episode = s.Episode
					}
					if ns.Episode == 0 {
						break
					}
					intent := p.intent(n, v, at, fmt.Sprintf("episode:%d:%s", ns.Episode, kind))
					intent.Episode = ns.Episode
					intent.Transition = kind
					result.Intents = append(result.Intents, intent)
					break
				}
				if !b || v.Window == "" && previousActive || v.Token == ns.LastToken {
					break
				}
				if at.Before(ns.LastAction.Add(time.Duration(num(n.Config, "cooldown_seconds")) * time.Second)) {
					break
				}
				trigger := v.Window
				if trigger == "" {
					ns.Episode++
					trigger = fmt.Sprintf("episode:%d", ns.Episode)
				}
				intent := p.intent(n, v, at, trigger)
				ns.LastAction = at
				ns.LastToken = v.Token
				result.Intents = append(result.Intents, intent)
			}
			for port, value := range out {
				if x, ok := number(value.Value); ok && (math.IsNaN(x) || math.IsInf(x, 0)) {
					value = unknown("non-finite result")
				}
				values[n.ID+":"+port] = value
				out[port] = value
			}
			result.Trace = append(result.Trace, Trace{n.ID, in, out})
			if len(result.Trace) > 1000 {
				result.Trace = result.Trace[len(result.Trace)-1000:]
			}
		}
	}
	// Retain only samples that can contribute to a not-yet-finalized window.
	for _, n := range p.Order {
		if n.Type != "source.parameter.v1" {
			continue
		}
		cutoff := at.Unix()
		for _, w := range p.Order {
			if w.Type == "window.v1" && p.Incoming[w.ID][0].Source == n.ID {
				c := s.Nodes[w.ID].LastEnd + int64(num(w.Config, "slide_seconds")) - int64(num(w.Config, "duration_seconds"))
				if c < cutoff {
					cutoff = c
				}
			}
		}
		ns := s.Nodes[n.ID]
		kept := ns.Samples[:0]
		for _, sample := range ns.Samples {
			if sample.At.Unix() >= cutoff {
				kept = append(kept, sample)
			}
		}
		ns.Samples = kept
	}
	next := func(t time.Time) {
		if result.NextTimer == nil || t.Before(*result.NextTimer) {
			result.NextTimer = &t
		}
	}
	for _, n := range p.Order {
		ns := s.Nodes[n.ID]
		if n.Type == "window.v1" {
			next(time.Unix(ns.LastEnd+int64(num(n.Config, "slide_seconds"))+int64(num(n.Config, "lateness_seconds")), 0).UTC())
		}
		if ns.Since != nil && n.Type == "sustained.v1" {
			t := ns.Since.Add(time.Duration(num(n.Config, "seconds")) * time.Second)
			if t.After(at) {
				next(t)
			}
		}
		if n.Type == "source.parameter.v1" && ns.Value.Expires.After(at) {
			next(ns.Value.Expires)
		}
	}
	result.State = s
	return result, nil
}
func (p *Plan) intent(n Node, v Value, at time.Time, trigger string) Intent {
	expires := at.Add(5 * time.Minute)
	if n.Type == "action.command.v1" {
		base := at
		if v.Window != "" {
			base = v.At
		}
		expires = base.Add(time.Duration(num(n.Config, "ttl_seconds")) * time.Second)
	}
	return Intent{ID: Hash([]string{p.Workflow.Version, n.ID, "default", trigger}), Workflow: p.Workflow.UUID, Version: p.Workflow.Version, Organization: p.Workflow.Organization, Node: n.ID, Correlation: "default", Kind: n.Type, Trigger: trigger, At: at, Expires: expires, Config: n.Config}
}
func convert(x float64, from, to string) (float64, bool) {
	type unit struct {
		family        string
		scale, offset float64
	}
	units := map[string]unit{"C": {"temperature", 1, 273.15}, "F": {"temperature", 5.0 / 9, 255.3722222222222}, "K": {"temperature", 1, 0}, "Pa": {"pressure", 1, 0}, "kPa": {"pressure", 1000, 0}, "bar": {"pressure", 100000, 0}, "m": {"length", 1, 0}, "cm": {"length", .01, 0}}
	a, aok := units[from]
	b, bok := units[to]
	if !aok || !bok || a.family != b.family {
		return 0, false
	}
	return (x*a.scale + a.offset - b.offset) / b.scale, true
}
