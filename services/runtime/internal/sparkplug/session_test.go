package sparkplug

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"google.golang.org/protobuf/proto"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, e := os.ReadFile("../../../../contracts/sparkplug/fixtures/" + name)
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func mustAccept(t *testing.T, e *Engine, topic, file string) Packet {
	t.Helper()
	p, err := e.Accept("connection", topic, fixture(t, file), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func TestIndependentPythonFixturesAliasesAndDeath(t *testing.T) {
	e := NewEngine()
	birth := mustAccept(t, e, "spBv1.0/group/NBIRTH/edge", "nbirth.bin")
	if !birth.Birth || len(birth.Metrics) != 3 {
		t.Fatal(birth)
	}
	n, ok := devices.Number(birth.Metrics[2].Value)
	if !ok || n != -5 {
		t.Fatal("signed int32 was not preserved")
	}
	mustAccept(t, e, "spBv1.0/group/DBIRTH/edge/meter", "dbirth-meter.bin")
	data := mustAccept(t, e, "spBv1.0/group/DDATA/edge/meter", "ddata-alias.bin")
	if len(data.Metrics) != 1 || data.Metrics[0].Name != "Voltage L1" || data.Metrics[0].Datatype != "Double" || !devices.Equal(data.Metrics[0].Value, float64(232)) {
		t.Fatal(data)
	}
	mustAccept(t, e, "spBv1.0/group/NDEATH/edge", "ndeath.bin")
	_, _, online := e.Snapshot(devices.Source{ConnectionUUID: "connection", EdgeNodeID: "edge", DeviceID: "meter"})
	if online {
		t.Fatal("node death did not invalidate its device")
	}
}
func TestBirthRequiredDuplicatesSequenceAndOldDeath(t *testing.T) {
	e := NewEngine()
	if _, err := e.Accept("connection", "spBv1.0/group/DDATA/edge/meter", fixture(t, "ddata-alias.bin"), time.Now()); !errors.Is(err, ErrBirthRequired) {
		t.Fatal(err)
	}
	mustAccept(t, e, "spBv1.0/group/NBIRTH/edge", "nbirth.bin")
	if _, err := e.Accept("connection", "spBv1.0/group/NBIRTH/edge", fixture(t, "nbirth.bin"), time.Now()); !errors.Is(err, ErrDuplicate) {
		t.Fatal(err)
	}
	raw := fixture(t, "ndeath.bin")
	payload := &pb.Payload{}
	_ = proto.Unmarshal(raw, payload)
	payload.Metrics[0].Value = &pb.Payload_Metric_LongValue{LongValue: 0}
	raw, _ = proto.Marshal(payload)
	if _, err := e.Accept("connection", "spBv1.0/group/NDEATH/edge", raw, time.Now()); err == nil {
		t.Fatal("old bdSeq accepted")
	}
	_, _, online := e.Snapshot(devices.Source{ConnectionUUID: "connection", EdgeNodeID: "edge"})
	if !online {
		t.Fatal("old death invalidated current session")
	}
	mustAccept(t, e, "spBv1.0/group/DBIRTH/edge/meter", "dbirth-meter.bin")
	payload = &pb.Payload{}
	_ = proto.Unmarshal(fixture(t, "ddata-alias.bin"), payload)
	payload.Seq = proto.Uint64(4)
	raw, _ = proto.Marshal(payload)
	if _, err := e.Accept("connection", "spBv1.0/group/DDATA/edge/meter", raw, time.Now()); !errors.Is(err, ErrBirthRequired) {
		t.Fatal("sequence gap accepted", err)
	}
}
func TestSequenceWrapAndUnknownAlias(t *testing.T) {
	e := NewEngine()
	mustAccept(t, e, "spBv1.0/group/NBIRTH/edge", "nbirth.bin")
	mustAccept(t, e, "spBv1.0/group/DBIRTH/edge/meter", "dbirth-meter.bin")
	for seq := 2; seq <= 257; seq++ {
		p := &pb.Payload{}
		_ = proto.Unmarshal(fixture(t, "ddata-alias.bin"), p)
		p.Seq = proto.Uint64(uint64(seq % 256))
		raw, _ := proto.Marshal(p)
		if _, err := e.Accept("connection", "spBv1.0/group/DDATA/edge/meter", raw, time.Now()); err != nil {
			t.Fatalf("sequence %d: %v", seq, err)
		}
	}
	p := &pb.Payload{Seq: proto.Uint64(2), Metrics: []*pb.Payload_Metric{{Alias: proto.Uint64(99), Value: &pb.Payload_Metric_DoubleValue{DoubleValue: 1}}}}
	raw, _ := proto.Marshal(p)
	if _, err := e.Accept("connection", "spBv1.0/group/DDATA/edge/meter", raw, time.Now()); !errors.Is(err, ErrBirthRequired) {
		t.Fatal(err)
	}
}
func TestTopicBoundaryAndCommandFixture(t *testing.T) {
	for _, topic := range []string{"spAv1.0/g/NBIRTH/e", "spBv1.0/g/DBIRTH/e", "spBv1.0/g/NBIRTH/e/d", "spBv1.0/+/NDATA/e", "spBv1.0/g/DDATA/e/"} {
		if _, e := ParseTopic(topic); e == nil {
			t.Fatal("accepted", topic)
		}
	}
	p := &pb.Payload{}
	if err := proto.Unmarshal(fixture(t, "dcmd-light.bin"), p); err != nil {
		t.Fatal(err)
	}
	if p.Metrics[0].GetName() != "Brightness" || p.Metrics[0].GetIntValue() != 8 {
		t.Fatal(p)
	}
	if _, e := EncodeMetric("Brightness", "Int8", 256); e == nil {
		t.Fatal("out of range command encoded")
	}
}
