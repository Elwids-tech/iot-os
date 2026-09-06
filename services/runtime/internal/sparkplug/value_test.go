package sparkplug

import (
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"math"
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
