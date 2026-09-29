package devices

import (
	"reflect"
	"testing"
	"time"
)

func TestTraceUsesActualConversionAndCalculation(t *testing.T) {
	d, p := convertedDefinition(t)
	now := time.Now()
	metrics := []Metric{{Name: d.Mappings[0].Metric, Datatype: d.Mappings[0].Datatype, Value: 1200.0}}
	var trace []ReadingTrace
	got := ReadingsTraced(d, p, metrics, map[string]Reading{}, now, &trace)
	expected := Readings(d, p, metrics, map[string]Reading{}, now)
	if !reflect.DeepEqual(got, expected) {
		t.Fatal("tracing changed processing")
	}
	if len(trace) != 1 || trace[0].Raw != 1200.0 || trace[0].Converted != 1.2 || trace[0].Quality != "good" {
		t.Fatalf("incorrect evidence: %+v", trace)
	}
	if len(got) != 2 {
		t.Fatal("derived calculation missing")
	}
	metrics[0].IsNull = true
	trace = nil
	got = ReadingsTraced(d, p, metrics, map[string]Reading{}, now, &trace)
	if trace[0].Quality != "invalid" || trace[0].Converted != nil || got[0].Value != nil {
		t.Fatal("null presented as calibrated value")
	}
}
