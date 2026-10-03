package dag

func f(t string, required bool, choices ...string) Field {
	return Field{Type: t, Required: required, Enum: choices}
}
func bounded(min, max float64) Field {
	return Field{Type: "number", Required: true, Min: &min, Max: &max}
}
func Registry() []NodeType {
	input := map[string]string{"in": "number"}
	output := map[string]string{"out": "number"}
	boolIn := map[string]string{"in": "boolean"}
	boolOut := map[string]string{"out": "boolean"}
	return []NodeType{
		{"geofence.v1", "Geofence", map[string]string{"latitude": "number", "longitude": "number"}, boolOut, map[string]Field{"geometry": f("object", true), "uncertainty_metres": bounded(0, 10000), "condition": f("string", true, "outside", "inside")}, false, nil, true},
		{"source.parameter.v1", "Device parameter", nil, map[string]string{"out": "binding"}, map[string]Field{"binding": f("string", true)}, true, []string{"Workflow.view"}, true},
		{"constant.v1", "Constant", nil, map[string]string{"out": "number"}, map[string]Field{"value": f("number", true)}, false, nil, true},
		{"math.v1", "Arithmetic", map[string]string{"a": "number", "b": "number"}, output, map[string]Field{"operator": f("string", true, "add", "subtract", "multiply", "divide")}, false, nil, true},
		{"convert.v1", "Unit conversion", input, output, map[string]Field{"from": f("string", true, "C", "F", "K", "Pa", "kPa", "bar", "m", "cm"), "to": f("string", true, "C", "F", "K", "Pa", "kPa", "bar", "m", "cm")}, false, nil, true},
		{"compare.v1", "Compare", input, boolOut, map[string]Field{"operator": f("string", true, "gt", "gte", "lt", "lte", "eq"), "value": f("number", true)}, false, nil, true},
		{"boolean.v1", "Boolean logic", map[string]string{"a": "boolean", "b": "boolean"}, boolOut, map[string]Field{"operator": f("string", true, "and", "or")}, false, nil, true},
		{"window.v1", "Time window", input, output, map[string]Field{"duration_seconds": bounded(1, 86400), "slide_seconds": bounded(1, 86400), "lateness_seconds": bounded(0, 3600), "minimum_samples": bounded(1, 10000), "aggregate": f("string", true, "count", "sum", "min", "max", "average")}, true, nil, true},
		{"join.v1", "Correlate inputs", map[string]string{"a": "any", "b": "any"}, map[string]string{"a": "input:a", "b": "input:b"}, map[string]Field{"mode": f("string", true, "latest", "window")}, true, nil, true},
		{"branch.v1", "Branch", boolIn, map[string]string{"true": "boolean", "false": "boolean"}, map[string]Field{}, false, nil, true},
		{"hysteresis.v1", "Hysteresis", input, boolOut, map[string]Field{"activate_above": f("number", true), "clear_below": f("number", true)}, true, nil, true},
		{"sustained.v1", "Sustained condition", boolIn, boolOut, map[string]Field{"seconds": bounded(1, 86400)}, true, nil, true},
		{"cooldown.v1", "Cooldown", boolIn, boolOut, map[string]Field{"seconds": bounded(1, 86400)}, true, nil, true},
		{"action.alert.v1", "Alert", boolIn, nil, map[string]Field{"title": f("string", true)}, true, nil, true},
		{"action.event.v1", "Integration event", boolIn, nil, map[string]Field{"name": f("string", true), "cooldown_seconds": bounded(1, 86400)}, true, nil, true},
		{"action.command.v1", "Set device state", boolIn, nil, map[string]Field{"binding": f("string", true), "value": f("scalar", true), "cooldown_seconds": bounded(1, 86400), "ttl_seconds": bounded(1, 300)}, true, []string{"Device.command"}, true},
	}
}
