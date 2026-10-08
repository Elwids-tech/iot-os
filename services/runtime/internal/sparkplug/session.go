package sparkplug

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"google.golang.org/protobuf/proto"
)

var ErrBirthRequired = errors.New("a fresh birth certificate is required")
var ErrDuplicate = errors.New("duplicate Sparkplug packet")

type Topic struct{ Group, Kind, Edge, Device string }

func ParseTopic(topic string) (Topic, error) {
	parts := strings.Split(topic, "/")
	var t Topic
	if len(parts) < 4 || len(parts) > 5 || parts[0] != "spBv1.0" {
		return t, errors.New("invalid Sparkplug B topic")
	}
	for _, part := range parts {
		if part == "" || strings.ContainsAny(part, "+#\x00") {
			return t, errors.New("invalid Sparkplug topic identifier")
		}
	}
	t = Topic{Group: parts[1], Kind: parts[2], Edge: parts[3]}
	if len(parts) == 5 {
		t.Device = parts[4]
	}
	switch t.Kind {
	case "NBIRTH", "NDATA", "NDEATH", "NCMD":
		if len(parts) != 4 {
			return Topic{}, errors.New("node topic must not contain a device identifier")
		}
	case "DBIRTH", "DDATA", "DDEATH", "DCMD":
		if len(parts) != 5 {
			return Topic{}, errors.New("device topic needs a device identifier")
		}
	default:
		return Topic{}, errors.New("unsupported Sparkplug message type")
	}
	return t, nil
}

type registry struct {
	Metrics map[string]devices.Metric
	Aliases map[uint64]string
	Online  bool
}
type node struct {
	Session   string
	BdSeq     uint64
	Seq       uint64
	BirthHash string
	Sources   map[string]*registry
	Online    bool
}
type Engine struct {
	mu    sync.Mutex
	nodes map[string]*node
}

func NewEngine() *Engine { return &Engine{nodes: map[string]*node{}} }

type Packet struct {
	Topic    Topic
	Session  string
	Metrics  []devices.Metric
	Birth    bool
	Death    bool
	Received time.Time
}

func key(connection string, t Topic) string { return connection + "/" + t.Edge }

func (e *Engine) Accept(connection string, topic string, raw []byte, at time.Time) (Packet, error) {
	t, err := ParseTopic(topic)
	if err != nil {
		return Packet{}, err
	}
	p := Packet{Topic: t, Received: at}
	if len(raw) > 1024*1024 {
		return p, errors.New("Sparkplug packet exceeds 1 MiB")
	}
	if t.Kind == "NCMD" || t.Kind == "DCMD" {
		return p, errors.New("commands are not inbound telemetry")
	}
	payload := &pb.Payload{}
	if err := proto.Unmarshal(raw, payload); err != nil {
		return p, fmt.Errorf("invalid Sparkplug protobuf: %w", err)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	k := key(connection, t)
	n := e.nodes[k]
	if t.Kind == "NBIRTH" {
		if payload.Seq == nil || payload.GetSeq() != 0 {
			return p, errors.New("NBIRTH sequence must be zero")
		}
		var bd uint64
		found := false
		for _, m := range payload.Metrics {
			if m.GetName() == "bdSeq" {
				bd = m.GetLongValue()
				if m.GetDatatype() != uint32(pb.DataType_Int64) || bd > 255 {
					return p, errors.New("invalid bdSeq")
				}
				found = true
			}
		}
		if !found {
			return p, errors.New("NBIRTH is missing bdSeq")
		}
		sum := sha256.Sum256(raw)
		birthHash := hex.EncodeToString(sum[:])
		if n != nil && n.Online && n.BirthHash == birthHash {
			return p, ErrDuplicate
		}
		n = &node{Session: fmt.Sprintf("%s:%d:%d:%d", k, bd, payload.GetTimestamp(), at.UnixNano()), BdSeq: bd, Seq: 0, BirthHash: birthHash, Sources: map[string]*registry{}, Online: true}
		e.nodes[k] = n
	} else {
		if n == nil || !n.Online {
			return p, ErrBirthRequired
		}
		p.Session = n.Session
		if t.Kind == "NDEATH" {
			var bd uint64
			found := false
			for _, m := range payload.Metrics {
				if m.GetName() == "bdSeq" {
					bd = m.GetLongValue()
					found = true
				}
			}
			if !found || bd != n.BdSeq {
				return p, errors.New("death certificate does not match the active session")
			}
			n.Online = false
			for _, source := range n.Sources {
				source.Online = false
			}
			p.Death = true
			return p, nil
		}
		if payload.Seq == nil || payload.GetSeq() > 255 {
			return p, ErrBirthRequired
		}
		if payload.GetSeq() == n.Seq {
			return p, ErrDuplicate
		}
		if payload.GetSeq() != (n.Seq+1)%256 {
			n.Online = false
			return p, ErrBirthRequired
		}
		n.Seq = payload.GetSeq()
	}
	p.Session = n.Session
	if t.Kind == "DDEATH" {
		if r := n.Sources[t.Device]; r != nil {
			r.Online = false
		}
		p.Death = true
		return p, nil
	}
	birth := t.Kind == "NBIRTH" || t.Kind == "DBIRTH"
	r := n.Sources[t.Device]
	if birth {
		r = &registry{Metrics: map[string]devices.Metric{}, Aliases: map[uint64]string{}, Online: true}
	}
	if r == nil || !r.Online {
		return p, ErrBirthRequired
	}
	result := []devices.Metric{}
	seen := map[string]bool{}
	for _, m := range payload.Metrics {
		name := m.GetName()
		datatype := pb.DataType(m.GetDatatype())
		if birth {
			if name == "" || seen[name] {
				n.Online = false
				return p, errors.New("birth metrics need unique names")
			}
			seen[name] = true
			if m.Alias != nil {
				if _, exists := r.Aliases[*m.Alias]; exists {
					n.Online = false
					return p, errors.New("birth aliases must be unique")
				}
				r.Aliases[*m.Alias] = name
			}
		}
		if !birth {
			if m.Alias != nil {
				aliasName, ok := r.Aliases[*m.Alias]
				if !ok || name != "" && name != aliasName {
					n.Online = false
					return p, ErrBirthRequired
				}
				name = aliasName
			}
			prior, ok := r.Metrics[name]
			if !ok {
				n.Online = false
				return p, ErrBirthRequired
			}
			if m.Datatype == nil {
				datatype = pb.DataType(pb.DataType_value[prior.Datatype])
			} else if datatype.String() != prior.Datatype {
				n.Online = false
				return p, ErrBirthRequired
			}
		}
		metric := decodeMetric(m, name, datatype, payload.GetTimestamp())
		metric.ReceivedAt = at
		result = append(result, metric)
		if !metric.Historical {
			r.Metrics[name] = metric
		}
	}
	if birth {
		n.Sources[t.Device] = r
	}
	p.Metrics = result
	p.Birth = birth
	return p, nil
}

func decodeMetric(m *pb.Payload_Metric, name string, datatype pb.DataType, fallback uint64) devices.Metric {
	metric := devices.Metric{Name: name, Alias: m.Alias, Datatype: datatype.String(), Historical: m.GetIsHistorical(), IsNull: m.GetIsNull()}
	if properties := m.GetProperties(); properties != nil {
		for i, key := range properties.Keys {
			if i >= len(properties.Values) {
				break
			}
			value := properties.Values[i]
			if value.GetType() != uint32(pb.DataType_String) || value.GetIsNull() {
				continue
			}
			switch key {
			case "installation_uuid":
				metric.InstallationUUID = value.GetStringValue()
			case "adapter_revision_uuid":
				metric.AdapterRevisionUUID = value.GetStringValue()
			}
		}
	}
	ts := fallback
	if m.Timestamp != nil {
		ts = *m.Timestamp
	}
	if ts != 0 {
		t := time.UnixMilli(int64(ts)).UTC()
		metric.Timestamp = &t
	}
	if metric.IsNull {
		return metric
	}
	validValue := false
	switch datatype {
	case pb.DataType_Int8, pb.DataType_Int16, pb.DataType_Int32, pb.DataType_UInt8, pb.DataType_UInt16, pb.DataType_UInt32:
		_, validValue = m.Value.(*pb.Payload_Metric_IntValue)
	case pb.DataType_Int64, pb.DataType_UInt64, pb.DataType_DateTime:
		_, validValue = m.Value.(*pb.Payload_Metric_LongValue)
	case pb.DataType_Float:
		_, validValue = m.Value.(*pb.Payload_Metric_FloatValue)
	case pb.DataType_Double:
		_, validValue = m.Value.(*pb.Payload_Metric_DoubleValue)
	case pb.DataType_Boolean:
		_, validValue = m.Value.(*pb.Payload_Metric_BooleanValue)
	case pb.DataType_String, pb.DataType_Text, pb.DataType_UUID:
		_, validValue = m.Value.(*pb.Payload_Metric_StringValue)
	case pb.DataType_Bytes:
		_, validValue = m.Value.(*pb.Payload_Metric_BytesValue)
	default:
		validValue = true
	}
	if !validValue {
		metric.Diagnostic = "Sparkplug value is missing or does not match its declared datatype"
		return metric
	}
	switch datatype {
	case pb.DataType_Int8:
		metric.Value = json.Number(strconv.FormatInt(int64(int8(m.GetIntValue())), 10))
	case pb.DataType_Int16:
		metric.Value = json.Number(strconv.FormatInt(int64(int16(m.GetIntValue())), 10))
	case pb.DataType_Int32:
		metric.Value = json.Number(strconv.FormatInt(int64(int32(m.GetIntValue())), 10))
	case pb.DataType_Int64:
		metric.Value = json.Number(strconv.FormatInt(int64(m.GetLongValue()), 10))
	case pb.DataType_UInt8, pb.DataType_UInt16, pb.DataType_UInt32:
		metric.Value = json.Number(strconv.FormatUint(uint64(m.GetIntValue()), 10))
	case pb.DataType_UInt64:
		metric.Value = json.Number(strconv.FormatUint(m.GetLongValue(), 10))
	case pb.DataType_Float:
		metric.Value = float64(m.GetFloatValue())
	case pb.DataType_Double:
		metric.Value = m.GetDoubleValue()
	case pb.DataType_Boolean:
		metric.Value = m.GetBooleanValue()
	case pb.DataType_String, pb.DataType_Text, pb.DataType_UUID:
		metric.Value = m.GetStringValue()
	case pb.DataType_DateTime:
		metric.Value = time.UnixMilli(int64(m.GetLongValue())).UTC().Format(time.RFC3339Nano)
	case pb.DataType_Bytes:
		metric.Value = base64.StdEncoding.EncodeToString(m.GetBytesValue())
	default:
		raw, _ := proto.Marshal(m)
		metric.Value = base64.StdEncoding.EncodeToString(raw)
		metric.Diagnostic = "complex Sparkplug type preserved as protobuf; not available as a typed parameter"
	}
	unsafe := datatype == pb.DataType_Int64 && (int64(m.GetLongValue()) > 9007199254740991 || int64(m.GetLongValue()) < -9007199254740991)
	unsafe = unsafe || datatype == pb.DataType_UInt64 && m.GetLongValue() > 9007199254740991
	if unsafe {
		metric.Value = nil
		metric.Diagnostic = "64-bit integer exceeds the exact numeric range supported by the public API"
	}
	if number, ok := metric.Value.(float64); ok && (math.IsNaN(number) || math.IsInf(number, 0)) {
		metric.Value = nil
		metric.Diagnostic = "Sparkplug numeric value is not finite"
	}
	if datatype == pb.DataType_UInt8 && m.GetIntValue() > 255 || datatype == pb.DataType_UInt16 && m.GetIntValue() > 65535 {
		metric.Value = nil
		metric.Diagnostic = "Sparkplug integer exceeds its declared datatype range"
	}
	if number, ok := metric.Value.(float64); ok {
		metric.Value = json.Number(strconv.FormatFloat(number, 'g', -1, 64))
	}
	return metric
}

func (e *Engine) Snapshot(source devices.Source) (string, []devices.Metric, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := e.nodes[source.ConnectionUUID+"/"+source.EdgeNodeID]
	if n == nil || !n.Online {
		return "", nil, false
	}
	r := n.Sources[source.DeviceID]
	if r == nil || !r.Online {
		return n.Session, nil, false
	}
	metrics := []devices.Metric{}
	for _, m := range r.Metrics {
		metrics = append(metrics, m)
	}
	return n.Session, metrics, true
}
func (e *Engine) Disconnect(connection string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for k, n := range e.nodes {
		if strings.HasPrefix(k, connection+"/") {
			n.Online = false
		}
	}
}

func EncodeMetric(name, datatype string, value any) (*pb.Payload_Metric, error) {
	dt, ok := pb.DataType_value[datatype]
	if !ok {
		return nil, errors.New("unknown command datatype")
	}
	m := &pb.Payload_Metric{Name: proto.String(name), Datatype: proto.Uint32(uint32(dt)), Timestamp: proto.Uint64(uint64(time.Now().UnixMilli()))}
	number, numeric := devices.Number(value)
	switch pb.DataType(dt) {
	case pb.DataType_Boolean:
		b, ok := value.(bool)
		if !ok {
			return nil, errors.New("boolean required")
		}
		m.Value = &pb.Payload_Metric_BooleanValue{BooleanValue: b}
	case pb.DataType_String, pb.DataType_Text, pb.DataType_UUID:
		s, ok := value.(string)
		if !ok {
			return nil, errors.New("string required")
		}
		m.Value = &pb.Payload_Metric_StringValue{StringValue: s}
	case pb.DataType_Float:
		if !numeric {
			return nil, errors.New("number required")
		}
		m.Value = &pb.Payload_Metric_FloatValue{FloatValue: float32(number)}
	case pb.DataType_Double:
		if !numeric {
			return nil, errors.New("number required")
		}
		m.Value = &pb.Payload_Metric_DoubleValue{DoubleValue: number}
	case pb.DataType_Int8, pb.DataType_Int16, pb.DataType_Int32:
		if !numeric {
			return nil, errors.New("integer required")
		}
		bits := map[pb.DataType]int{pb.DataType_Int8: 8, pb.DataType_Int16: 16, pb.DataType_Int32: 32}[pb.DataType(dt)]
		s := fmt.Sprint(value)
		n, e := strconv.ParseInt(s, 10, bits)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_IntValue{IntValue: uint32(n)}
	case pb.DataType_UInt8, pb.DataType_UInt16, pb.DataType_UInt32:
		bits := map[pb.DataType]int{pb.DataType_UInt8: 8, pb.DataType_UInt16: 16, pb.DataType_UInt32: 32}[pb.DataType(dt)]
		n, e := strconv.ParseUint(fmt.Sprint(value), 10, bits)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_IntValue{IntValue: uint32(n)}
	case pb.DataType_Int64:
		n, e := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_LongValue{LongValue: uint64(n)}
	case pb.DataType_UInt64:
		n, e := strconv.ParseUint(fmt.Sprint(value), 10, 64)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_LongValue{LongValue: n}
	case pb.DataType_DateTime:
		s, ok := value.(string)
		if !ok {
			return nil, errors.New("timestamp required")
		}
		t, e := time.Parse(time.RFC3339Nano, s)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_LongValue{LongValue: uint64(t.UnixMilli())}
	case pb.DataType_Bytes:
		s, ok := value.(string)
		if !ok {
			return nil, errors.New("base64 required")
		}
		b, e := base64.StdEncoding.DecodeString(s)
		if e != nil {
			return nil, e
		}
		m.Value = &pb.Payload_Metric_BytesValue{BytesValue: b}
	default:
		return nil, errors.New("unsupported command datatype")
	}
	return m, nil
}
