package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/sparkplug/pb"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"google.golang.org/protobuf/proto"
)

type edgesFixture struct {
	a               *Application
	c               devices.Connection
	meterA, nodeA   devices.Definition // edge-a on c
	meterB, spareB  devices.Definition // edge-b on c; spare never births
	elsewhere       devices.Definition // edge-a on another connection
	connectionUUIDs []string
	sessionA        string
	outbox          func(kind, field, value string) []map[string]any
	devicePresence  func(d devices.Definition) []string
	compatible      func(device string) bool
	rebirthWanted   func(edgeKey string) bool
}

func sparkplugPayload(t *testing.T, seq uint64, metrics ...*pb.Payload_Metric) []byte {
	t.Helper()
	raw, err := proto.Marshal(&pb.Payload{Timestamp: proto.Uint64(uint64(time.Now().UnixMilli())), Seq: proto.Uint64(seq), Metrics: metrics})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func doubleMetric(name string, alias uint64, value float64) *pb.Payload_Metric {
	return &pb.Payload_Metric{Name: proto.String(name), Alias: proto.Uint64(alias), Datatype: proto.Uint32(uint32(pb.DataType_Double)), Value: &pb.Payload_Metric_DoubleValue{DoubleValue: value}}
}

func bdSeqMetric(value uint64) *pb.Payload_Metric {
	return &pb.Payload_Metric{Name: proto.String("bdSeq"), Datatype: proto.Uint32(uint32(pb.DataType_Int64)), Value: &pb.Payload_Metric_LongValue{LongValue: value}}
}

// newEdgesFixture puts two live edge nodes on one broker connection, with a
// configured device on each and a same-named edge on a second connection.
func newEdgesFixture(t *testing.T) edgesFixture {
	t.Helper()
	a, d := lifecycleFixture(t)
	ctx := context.Background()
	a.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	a.rebirth = map[string]time.Time{}
	a.rebirthPending = map[string]rebirthRequest{}
	f := edgesFixture{a: a, c: devices.Connection{UUID: storage.UUID(), OrganizationUUID: d.OrganizationUUID, GroupID: "group"}}
	other := storage.UUID()
	f.connectionUUIDs = []string{f.c.UUID, other}
	t.Cleanup(func() {
		for _, connection := range f.connectionUUIDs {
			_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'connection_uuid'=$1", connection)
		}
	})
	define := func(connection, edge, device string) devices.Definition {
		definition := devices.Definition{DeviceUUID: storage.UUID(), OrganizationUUID: d.OrganizationUUID, ConfigurationUUID: storage.UUID(), Source: devices.Source{ConnectionUUID: connection, GroupID: "group", EdgeNodeID: edge, DeviceID: device}}
		a.definitions[definition.DeviceUUID] = definition
		a.compatible[definition.DeviceUUID] = true
		return definition
	}
	f.meterA, f.nodeA = define(f.c.UUID, "edge-a", "meter"), define(f.c.UUID, "edge-a", "")
	f.meterB, f.spareB = define(f.c.UUID, "edge-b", "meter"), define(f.c.UUID, "edge-b", "spare")
	f.elsewhere = define(other, "edge-a", "meter")
	for _, connection := range f.connectionUUIDs {
		for _, edge := range []string{"edge-a", "edge-b"} {
			birth, err := a.Engine.Accept(connection, "spBv1.0/group/NBIRTH/"+edge, sparkplugPayload(t, 0, bdSeqMetric(0), doubleMetric("Uptime", 1, 1)), time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if connection == f.c.UUID && edge == "edge-a" {
				f.sessionA = birth.Session
			}
			if _, err = a.Engine.Accept(connection, "spBv1.0/group/DBIRTH/"+edge+"/meter", sparkplugPayload(t, 1, doubleMetric("Voltage", 1, 230)), time.Now()); err != nil {
				t.Fatal(err)
			}
		}
	}
	f.outbox = func(kind, field, value string) []map[string]any {
		t.Helper()
		rows, err := a.Store.Pool.Query(ctx, "SELECT event->'payload' FROM device_runtime.outbox WHERE event->>'type'=$1 AND event->'payload'->>($2::text)=$3", kind, field, value)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		payloads := []map[string]any{}
		for rows.Next() {
			var raw []byte
			payload := map[string]any{}
			if err = rows.Scan(&raw); err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			payloads = append(payloads, payload)
		}
		return payloads
	}
	f.devicePresence = func(d devices.Definition) []string {
		t.Helper()
		presence := []string{}
		for _, payload := range f.outbox("device.presence.v1", "device_uuid", d.DeviceUUID) {
			presence = append(presence, payload["presence"].(string))
		}
		return presence
	}
	f.compatible = func(device string) bool { a.mu.Lock(); defer a.mu.Unlock(); return a.compatible[device] }
	f.rebirthWanted = func(key string) bool { a.mu.Lock(); defer a.mu.Unlock(); _, ok := a.rebirthPending[key]; return ok }
	return f
}

// One edge node losing its session must not make other edges on the same broker
// connection look unknown; until 2026-10 every rejected packet did.
func TestRejectedPacketOnlyAffectsItsEdgeAndDevice(t *testing.T) {
	f := newEdgesFixture(t)
	a, c := f.a, f.c

	// Sequence 1 was the DBIRTH, so 5 is a gap: the engine drops edge-a's whole session.
	a.packet(c, "spBv1.0/group/DDATA/edge-a/meter", sparkplugPayload(t, 5, doubleMetric("", 1, 231)))
	for _, d := range []devices.Definition{f.meterA, f.nodeA} {
		if presence := f.devicePresence(d); len(presence) != 1 || presence[0] != "unknown" {
			t.Fatalf("edge-a source %s presence %v, want one unknown", d.Source.Key(), presence)
		}
		if f.compatible(d.DeviceUUID) {
			t.Fatalf("edge-a source %s stayed compatible", d.Source.Key())
		}
	}
	for _, d := range []devices.Definition{f.meterB, f.spareB, f.elsewhere} {
		if presence := f.devicePresence(d); len(presence) != 0 {
			t.Fatalf("source %s presence %v, want untouched", d.Source.Key(), presence)
		}
	}
	if !f.compatible(f.meterB.DeviceUUID) {
		t.Fatal("edge-b lost compatibility")
	}
	if events := f.outbox("connection.presence.v1", "connection_uuid", c.UUID); len(events) != 0 {
		t.Fatalf("rejected packet reported the whole connection: %v", events)
	}
	gateways := f.outbox("gateway.presence.v1", "connection_uuid", c.UUID)
	if len(gateways) != 1 || gateways[0]["edge_node_id"] != "edge-a" || gateways[0]["presence"] != "unknown" || gateways[0]["session_id"] != f.sessionA {
		t.Fatalf("gateway presence: %v", gateways)
	}
	if !f.rebirthWanted(c.UUID + "/edge-a") {
		t.Fatal("no rebirth requested for edge-a")
	}
	if !a.Engine.NodeOnline(c.UUID, "edge-b") {
		t.Fatal("edge-b session dropped")
	}

	// Data from a device that never sent DBIRTH costs only that device; edge-b keeps its session.
	a.packet(c, "spBv1.0/group/DDATA/edge-b/spare", sparkplugPayload(t, 2, doubleMetric("Voltage", 1, 1)))
	if presence := f.devicePresence(f.spareB); len(presence) != 1 || presence[0] != "unknown" {
		t.Fatalf("unborn device presence %v, want one unknown", presence)
	}
	if presence := f.devicePresence(f.meterB); len(presence) != 0 {
		t.Fatalf("edge-b meter presence %v, want untouched", presence)
	}
	if gateways = f.outbox("gateway.presence.v1", "connection_uuid", c.UUID); len(gateways) != 1 {
		t.Fatalf("device-level rejection reported its gateway: %v", gateways)
	}
	if !f.rebirthWanted(c.UUID + "/edge-b") {
		t.Fatal("no rebirth requested for edge-b")
	}
}

// An edge keeps sending until its rebirth arrives. Each device is reported unknown
// once, and again only after its presence has changed.
func TestRejectedPacketsReportEachDeviceOnceUntilItsPresenceChanges(t *testing.T) {
	f := newEdgesFixture(t)
	a, c := f.a, f.c
	edgeA := []devices.Definition{f.meterA, f.nodeA}
	count := func(d devices.Definition, presence string) int {
		t.Helper()
		n := 0
		for _, reported := range f.devicePresence(d) {
			if reported == presence {
				n++
			}
		}
		return n
	}

	for _, seq := range []uint64{5, 6, 7} {
		a.packet(c, "spBv1.0/group/DDATA/edge-a/meter", sparkplugPayload(t, seq, doubleMetric("", 1, 231)))
	}
	for _, d := range edgeA {
		if presence := f.devicePresence(d); len(presence) != 1 || presence[0] != "unknown" {
			t.Fatalf("source %s presence %v after three rejected packets, want one unknown", d.Source.Key(), presence)
		}
	}

	// The rebirth brings edge-a back, and the accepted path reports its devices online.
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/edge-a", sparkplugPayload(t, 0, bdSeqMetric(1), doubleMetric("Uptime", 1, 2)), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/DBIRTH/edge-a/meter", sparkplugPayload(t, 1, doubleMetric("Voltage", 1, 230)), time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, d := range edgeA {
		a.devicePresence(d, "online", "", time.Now().UTC(), true)
	}
	a.packet(c, "spBv1.0/group/DDATA/edge-a/meter", sparkplugPayload(t, 9, doubleMetric("", 1, 231)))
	for _, d := range edgeA {
		if unknown, online := count(d, "unknown"), count(d, "online"); unknown != 2 || online != 1 {
			t.Fatalf("source %s reported unknown %d and online %d times, want 2 and 1", d.Source.Key(), unknown, online)
		}
	}
}

// Losing the broker connection still makes every device on it unknown, and only those.
func TestBrokerDisconnectMarksEveryDeviceOnTheConnectionUnknown(t *testing.T) {
	f := newEdgesFixture(t)
	f.a.connectionLost(f.c.UUID, errors.New("EOF"))
	if events := f.outbox("connection.presence.v1", "connection_uuid", f.c.UUID); len(events) != 1 || events[0]["presence"] != "unknown" {
		t.Fatalf("connection presence: %v", events)
	}
	for _, d := range []devices.Definition{f.meterA, f.nodeA, f.meterB, f.spareB} {
		if presence := f.devicePresence(d); len(presence) != 1 || presence[0] != "unknown" {
			t.Fatalf("source %s presence %v, want one unknown", d.Source.Key(), presence)
		}
		if f.compatible(d.DeviceUUID) {
			t.Fatalf("source %s stayed compatible", d.Source.Key())
		}
	}
	if presence := f.devicePresence(f.elsewhere); len(presence) != 0 {
		t.Fatalf("device on another connection presence %v, want untouched", presence)
	}
	if f.a.Engine.NodeOnline(f.c.UUID, "edge-a") || f.a.Engine.NodeOnline(f.c.UUID, "edge-b") {
		t.Fatal("disconnect left an edge session online")
	}
	if !f.a.Engine.NodeOnline(f.connectionUUIDs[1], "edge-a") {
		t.Fatal("disconnect dropped another connection's session")
	}
}

// adapterMetric is a metric the managed adapter publisher sends for an installation.
func adapterMetric(name string, alias uint64, value float64, installation string, observed time.Time, historical bool) *pb.Payload_Metric {
	str := uint32(pb.DataType_String)
	metric := doubleMetric(name, alias, value)
	metric.Timestamp = proto.Uint64(uint64(observed.UnixMilli()))
	metric.IsHistorical = proto.Bool(historical)
	metric.Properties = &pb.Payload_PropertySet{Keys: []string{"installation_uuid", "adapter_revision_uuid"}, Values: []*pb.Payload_PropertyValue{
		{Type: &str, Value: &pb.Payload_PropertyValue_StringValue{StringValue: installation}},
		{Type: &str, Value: &pb.Payload_PropertyValue_StringValue{StringValue: "30000000-0000-4000-8000-000000000009"}},
	}}
	return metric
}

// An adapter's node death is a redeploy, restart or pause (spec 018, D3): its devices
// are unknown, not offline, and only a new reading, never a birth announced again or
// history, counts as hearing from them (D2).
func TestAdapterNodeDeathIsUnknownAndOnlyNewReadingsAreHeard(t *testing.T) {
	a, base := lifecycleFixture(t)
	ctx := context.Background()
	a.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	a.rebirth = map[string]time.Time{}
	a.rebirthPending = map[string]rebirthRequest{}
	a.JS = &recordingJetStream{}
	c := devices.Connection{UUID: storage.UUID(), OrganizationUUID: base.OrganizationUUID, GroupID: "adapters-" + base.OrganizationUUID}
	t.Cleanup(func() {
		_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'connection_uuid'=$1", c.UUID)
	})
	d := trackerDefinition(base, c, true)
	if err := a.Store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	a.definitions = map[string]devices.Definition{d.DeviceUUID: d}
	a.connectivity = newConnectivityTracker(time.Now().UTC(), a.Engine.NodeOnline)
	a.connectivity.finishSeeding()
	a.connectivity.connect(c.UUID, time.Now().UTC())
	a.connectivity.define(d, time.Now().UTC())
	installation := d.Adapter.InstallationUUID
	topic := func(kind, device string) string {
		if device == "" {
			return "spBv1.0/" + c.GroupID + "/" + kind + "/adapter"
		}
		return "spBv1.0/" + c.GroupID + "/" + kind + "/adapter/" + device
	}
	state := func() connectivityState {
		t.Helper()
		states := a.connectivity.state(d.OrganizationUUID, []string{d.DeviceUUID}, time.Now().UTC())
		if len(states) != 1 {
			t.Fatalf("states %v", states)
		}
		return states[0]
	}
	observed := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)

	// The publisher's node birth and the source's stored birth, announced again.
	a.packet(c, topic("NBIRTH", ""), sparkplugPayload(t, 0, bdSeqMetric(0)))
	a.packet(c, topic("DBIRTH", "src-1"), sparkplugPayload(t, 1, adapterMetric("battery", 1, 3.9, installation, observed, false), adapterMetric("latitude", 2, 51.0, installation, observed, false)))
	if s := state(); s.State != "waiting" || s.LastHeardAt != nil {
		t.Fatalf("a birth announced again was heard: %+v", s)
	}
	// History is a backfill, not the device reporting.
	a.packet(c, topic("DDATA", "src-1"), sparkplugPayload(t, 2, adapterMetric("", 1, 3.8, installation, observed.Add(-time.Hour), true)))
	if s := state(); s.State != "waiting" || s.LastHeardAt != nil {
		t.Fatalf("a historical reading was heard: %+v", s)
	}
	fresh := observed.Add(time.Hour)
	a.packet(c, topic("DDATA", "src-1"), sparkplugPayload(t, 3, adapterMetric("", 1, 3.7, installation, fresh, false)))
	s := state()
	if s.LastHeardAt == nil || s.LastObservedAt == nil || !s.LastObservedAt.Equal(fresh) || s.State != "learning" {
		t.Fatalf("a new reading: %+v", s)
	}
	heard := *s.LastHeardAt

	// A redeploy: the node death reports the device unknown, with why, and keeps its last-seen time.
	a.packet(c, topic("NDEATH", ""), sparkplugPayload(t, 0, bdSeqMetric(0)))
	reported := presenceReports(a, ctx, d.DeviceUUID)
	last := reported[len(reported)-1]
	if last["presence"] != "unknown" || last["diagnostic"] != adapterRestarting || last["last_seen_at"] != nil {
		t.Fatalf("presence after the adapter's death: %v", last)
	}
	for _, payload := range reported {
		if payload["presence"] == "offline" {
			t.Fatalf("an adapter death reported its device offline: %v", reported)
		}
	}
	if s := state(); s.State != "interrupted" || *s.Interruption != interruptAdapter || !s.LastHeardAt.Equal(heard) {
		t.Fatalf("during the redeploy: %+v", s)
	}
	a.packet(c, topic("NBIRTH", ""), sparkplugPayload(t, 0, bdSeqMetric(1)))
	if s := state(); s.State != "learning" || !s.LastHeardAt.Equal(heard) {
		t.Fatalf("after the redeploy: %+v", s)
	}
}

// presenceReports lists the device.presence.v1 payloads reported for device, oldest first.
func presenceReports(a *Application, ctx context.Context, device string) []map[string]any {
	rows, err := a.Store.Pool.Query(ctx, "SELECT event->'payload' FROM device_runtime.outbox WHERE event->>'type'='device.presence.v1' AND event->'payload'->>'device_uuid'=$1 ORDER BY created_at", device)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	result := []map[string]any{}
	for rows.Next() {
		var raw []byte
		payload := map[string]any{}
		if err = rows.Scan(&raw); err == nil && json.Unmarshal(raw, &payload) == nil {
			result = append(result, payload)
		}
	}
	return result
}
