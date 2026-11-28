package sparkplug

import (
	"fmt"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"math"
	"strings"
	"testing"
)

func TestMalformedAndUnsafeValuesDoNotBecomeZero(t *testing.T) {
	cases := []struct {
		datatype pb.DataType
		metric   *pb.Payload_Metric
	}{
		{pb.DataType_Int32, &pb.Payload_Metric{}},
		{pb.DataType_Boolean, &pb.Payload_Metric{}},
		{pb.DataType_Double, &pb.Payload_Metric{Value: &pb.Payload_Metric_IntValue{IntValue: 42}}},
		{pb.DataType_Int64, &pb.Payload_Metric{Value: &pb.Payload_Metric_LongValue{LongValue: 9007199254740992}}},
		{pb.DataType_UInt64, &pb.Payload_Metric{Value: &pb.Payload_Metric_LongValue{LongValue: math.MaxUint64}}},
		{pb.DataType_Double, &pb.Payload_Metric{Value: &pb.Payload_Metric_DoubleValue{DoubleValue: math.NaN()}}},
		{pb.DataType_UInt8, &pb.Payload_Metric{Value: &pb.Payload_Metric_IntValue{IntValue: 256}}},
	}
	for _, test := range cases {
		value := decodeMetric(test.metric, "reading", test.datatype, 0)
		if value.Diagnostic == "" || value.Value != nil {
			t.Fatalf("unsafe %s value escaped: %+v", test.datatype, value)
		}
	}
	value := decodeMetric(&pb.Payload_Metric{Value: &pb.Payload_Metric_BooleanValue{BooleanValue: false}}, "switch", pb.DataType_Boolean, 0)
	if value.Diagnostic != "" || value.Value != false {
		t.Fatal("explicit false was rejected")
	}
}

func TestTimestampSourcePropertyMarksReceiptTime(t *testing.T) {
	stamp := uint64(1793143430789)
	str := uint32(pb.DataType_String)
	receipt := "receipt"
	other := "device"
	metric := func(value string) *pb.Payload_Metric {
		return &pb.Payload_Metric{Timestamp: &stamp, Value: &pb.Payload_Metric_DoubleValue{DoubleValue: 1}, Properties: &pb.Payload_PropertySet{Keys: []string{"timestamp_source"}, Values: []*pb.Payload_PropertyValue{{Type: &str, Value: &pb.Payload_PropertyValue_StringValue{StringValue: value}}}}}
	}
	if got := decodeMetric(metric(receipt), "t", pb.DataType_Double, 0); got.TimestampSource != "receipt" || got.Timestamp == nil {
		t.Fatal(got)
	}
	if got := decodeMetric(metric(other), "t", pb.DataType_Double, 0); got.TimestampSource != "" {
		t.Fatal("only the receipt marker is recognised", got)
	}
}

// Spec 038, research R4: an OPC UA source sends its quality and reason as properties,
// and "server" for a value a server confirmed on a periodic read.
func TestQualityPropertiesAreRead(t *testing.T) {
	stamp := uint64(1793143430789)
	str := uint32(pb.DataType_String)
	property := func(value string) *pb.Payload_PropertyValue {
		return &pb.Payload_PropertyValue{Type: &str, Value: &pb.Payload_PropertyValue_StringValue{StringValue: value}}
	}
	null := true
	bad := &pb.Payload_Metric{Timestamp: &stamp, IsNull: &null, Properties: &pb.Payload_PropertySet{Keys: []string{"quality", "quality_reason", "timestamp_source"}, Values: []*pb.Payload_PropertyValue{property("bad"), property("No communication with the device"), property("server")}}}
	got := decodeMetric(bad, "t", pb.DataType_Double, 0)
	if got.Quality != "bad" || got.QualityReason != "No communication with the device" || got.TimestampSource != "server" || !got.IsNull {
		t.Fatal(got)
	}
	uncertain := &pb.Payload_Metric{Timestamp: &stamp, Value: &pb.Payload_Metric_DoubleValue{DoubleValue: 21.5}, Properties: &pb.Payload_PropertySet{Keys: []string{"quality", "quality_reason"}, Values: []*pb.Payload_PropertyValue{property("uncertain"), property(strings.Repeat("x", 200))}}}
	got = decodeMetric(uncertain, "t", pb.DataType_Double, 0)
	if got.Quality != "uncertain" || fmt.Sprint(got.Value) != "21.5" || len(got.QualityReason) != 120 {
		t.Fatal(got)
	}
	unknown := &pb.Payload_Metric{Timestamp: &stamp, Value: &pb.Payload_Metric_DoubleValue{DoubleValue: 1}, Properties: &pb.Payload_PropertySet{Keys: []string{"quality"}, Values: []*pb.Payload_PropertyValue{property("excellent")}}}
	if got = decodeMetric(unknown, "t", pb.DataType_Double, 0); got.Quality != "" {
		t.Fatal("an unknown quality word is ignored", got)
	}
}
