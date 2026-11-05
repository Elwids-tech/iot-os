package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// trackerDefinition maps battery and latitude from src-1 on the connection's adapter edge.
func trackerDefinition(base devices.Definition, c devices.Connection, adapter bool) devices.Definition {
	battery, latitude := storage.UUID(), storage.UUID()
	profile, _ := json.Marshal(devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{
		{UUID: battery, Key: "battery", DataType: "number", ReportsState: true},
		{UUID: latitude, Key: "latitude", DataType: "number", ReportsState: true},
	}})
	d := base
	d.ConfigurationUUID = storage.UUID()
	d.SchemaVersion = "device-configuration.v2"
	d.ProfileCanonicalJSON = string(profile)
	hash := sha256.Sum256(profile)
	d.ProfileHash = hex.EncodeToString(hash[:])
	d.Source = devices.Source{ConnectionUUID: c.UUID, GroupID: c.GroupID, EdgeNodeID: "adapter", DeviceID: "src-1"}
	d.Mappings = []devices.Mapping{{ParameterUUID: battery, Metric: "battery", Datatype: "Double", ConversionMode: "none"}, {ParameterUUID: latitude, Metric: "latitude", Datatype: "Double", ConversionMode: "none"}}
	if adapter {
		d.Adapter = &devices.AdapterBinding{InstallationUUID: storage.UUID(), AdapterUUID: storage.UUID(), ManufacturerSerial: "TRK-1001"}
	}
	return d
}

type deviceRow struct {
	Generation, Applied int
	Outcome, Diagnostic string
	Configuration       string
}

func storedDevice(t *testing.T, a *Application, device string) deviceRow {
	t.Helper()
	var row deviceRow
	if err := a.Store.Pool.QueryRow(context.Background(), `SELECT generation, COALESCE(applied_generation,0), outcome->>'type', COALESCE(outcome->'payload'->>'diagnostic',''), COALESCE(definition->>'configuration_uuid','')
 FROM device_runtime.devices WHERE device_uuid=$1`, device).Scan(&row.Generation, &row.Applied, &row.Outcome, &row.Diagnostic, &row.Configuration); err != nil {
		t.Fatal(err)
	}
	return row
}

// settled waits until a held activation of device is answered at generation.
func settled(t *testing.T, a *Application, device string, generation int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		a.mu.Lock()
		_, held := a.held[device]
		answered := a.generations[device] >= generation && !held
		a.mu.Unlock()
		if answered {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the activation at generation %d was not answered", generation)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A polled tracker reports hourly. After a platform deploy the tenant adapter
// re-announced only its node (pilot, 2026-10-30), so the tracker had no live birth
// until its next reading and every configuration apply was refused as offline. The
// platform's adapter defines an adapter-fed source's metrics, so activation checks
// its last stored birth instead; a device that announces its own births still needs
// a live one (ADR-027). Without a stored birth the activation waits for a live one
// while the node announces, then is refused (R19).
func TestAdapterFedActivationChecksTheStoredBirth(t *testing.T) {
	a, base := lifecycleFixture(t)
	a.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	a.rebirth = map[string]time.Time{}
	a.rebirthPending = map[string]rebirthRequest{}
	a.heldFor = 20 * time.Millisecond
	c := devices.Connection{UUID: storage.UUID(), OrganizationUUID: base.OrganizationUUID, GroupID: "adapters"}
	t.Cleanup(func() {
		_, _ = a.Store.Pool.Exec(context.Background(), "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'connection_uuid'=$1", c.UUID)
	})
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/adapters/NBIRTH/adapter", sparkplugPayload(t, 0, bdSeqMetric(0)), time.Now()); err != nil {
		t.Fatal(err)
	}
	stored := []devices.Metric{{Name: "battery", Datatype: "Double"}, {Name: "latitude", Datatype: "Double"}}

	native := trackerDefinition(base, c, false)
	if err := a.activate(native, 2, stored, "native"); err != nil {
		t.Fatal(err)
	}
	settled(t, a, base.DeviceUUID, 2)
	if row := storedDevice(t, a, base.DeviceUUID); row.Outcome != "device.failed.v1" || row.Diagnostic != "Source is offline or needs a fresh birth certificate. Review the source before retrying." {
		t.Fatalf("a device that announces its own births activated without one: %+v", row)
	}

	tracker := trackerDefinition(base, c, true)
	if err := a.activate(tracker, 3, stored[:1], "partial"); err != nil {
		t.Fatal(err)
	}
	if row := storedDevice(t, a, base.DeviceUUID); row.Outcome != "device.failed.v1" || row.Diagnostic != "metric latitude is missing or its datatype changed" {
		t.Fatalf("a stored birth without latitude: %+v", row)
	}
	if err := a.activate(tracker, 4, nil, "unknown"); err != nil {
		t.Fatal(err)
	}
	settled(t, a, base.DeviceUUID, 4)
	if row := storedDevice(t, a, base.DeviceUUID); row.Outcome != "device.failed.v1" || row.Applied != 1 || row.Configuration != base.ConfigurationUUID {
		t.Fatalf("an adapter-fed source with no stored birth: %+v", row)
	}

	if err := a.activate(tracker, 5, stored, "stored"); err != nil {
		t.Fatal(err)
	}
	if row := storedDevice(t, a, base.DeviceUUID); row.Outcome != "device.applied.v1" || row.Generation != 5 || row.Applied != 5 || row.Configuration != tracker.ConfigurationUUID {
		t.Fatalf("the stored birth matches: %+v", row)
	}
	var presence string
	if err := a.Store.Pool.QueryRow(a.ctx, "SELECT outcome->'payload'->>'presence' FROM device_runtime.devices WHERE device_uuid=$1", base.DeviceUUID).Scan(&presence); err != nil || presence != "unknown" {
		t.Fatalf("presence must wait for data: %q %v", presence, err)
	}
	if a.definitions[base.DeviceUUID].ConfigurationUUID != tracker.ConfigurationUUID || a.appliedGeneration[base.DeviceUUID] != 5 {
		t.Fatal("the configuration was not applied in memory")
	}
	if _, asked := a.rebirthPending[c.UUID+"/adapter"]; !asked {
		t.Fatal("activation must ask the adapter to announce its sources")
	}
}

// A refused activation advanced the fence and, with it, the generation automations
// bind to, although the applied configuration had not changed. Every automation bound
// to the device then failed binding_changed until someone saved it again (pilot,
// 2026-10-30). The applied generation now stays with the applied configuration.
func TestRefusedActivationKeepsAutomationsBound(t *testing.T) {
	a, base := lifecycleFixture(t)
	ctx := context.Background()
	a.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	a.rebirth = map[string]time.Time{}
	a.rebirthPending = map[string]rebirthRequest{}
	js := &recordingJetStream{}
	a.JS = js
	c := devices.Connection{UUID: storage.UUID(), OrganizationUUID: base.OrganizationUUID, GroupID: "group"}
	t.Cleanup(func() {
		_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'connection_uuid'=$1", c.UUID)
		_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.dag_executions WHERE organization_uuid=$1", base.OrganizationUUID)
		_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.rule_heads WHERE organization_uuid=$1", base.OrganizationUUID)
	})
	d := trackerDefinition(base, c, false)
	if err := a.Store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	a.definitions[d.DeviceUUID] = d
	deploy := func(generation int) (string, string) {
		t.Helper()
		workflow, operation := storage.UUID(), storage.UUID()
		w := dag.Workflow{Schema: dag.Schema, UUID: workflow, Version: operation, Organization: d.OrganizationUUID,
			Bindings: []dag.Binding{{Role: "tracker", Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Generation: generation, Parameter: d.Mappings[0].ParameterUUID, DataType: "number", FreshSeconds: 7200}},
			Nodes:    []dag.Node{{ID: "source", Type: "source.parameter.v1", Config: map[string]any{"binding": "tracker"}}, {ID: "condition", Type: "compare.v1", Config: map[string]any{"operator": "lt", "value": float64(3.5)}}, {ID: "alert", Type: "action.alert.v1", Config: map[string]any{"title": "Battery low"}}},
			Edges:    []dag.Edge{{Source: "source", SourcePort: "out", Target: "condition", TargetPort: "in"}, {Source: "condition", SourcePort: "out", Target: "alert", TargetPort: "in"}}}
		if err := a.Store.DeployDAG(ctx, storage.DAGDeployment{Operation: operation, Workflow: workflow, Organization: d.OrganizationUUID, Generation: 1, Target: "active", Definition: &w}, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		var status, diagnostic string
		if err := a.Store.Pool.QueryRow(ctx, "SELECT outcome->>'status', outcome->>'diagnostic' FROM device_runtime.rule_heads WHERE rule_uuid=$1", workflow).Scan(&status, &diagnostic); err != nil {
			t.Fatal(err)
		}
		return status, diagnostic
	}
	if status, diagnostic := deploy(1); status != "succeeded" {
		t.Fatalf("binding to the applied configuration: %s %q", status, diagnostic)
	}

	// The source is offline: the request at generation 2 is refused.
	if err := a.activate(trackerDefinition(base, c, false), 2, nil, "refused"); err != nil {
		t.Fatal(err)
	}
	if row := storedDevice(t, a, d.DeviceUUID); row.Outcome != "device.failed.v1" || row.Generation != 2 || row.Applied != 1 || row.Configuration != d.ConfigurationUUID {
		t.Fatalf("refused activation: %+v", row)
	}
	if a.generations[d.DeviceUUID] != 2 || a.appliedGeneration[d.DeviceUUID] != 1 {
		t.Fatalf("memory: fence %d, applied %d", a.generations[d.DeviceUUID], a.appliedGeneration[d.DeviceUUID])
	}
	if status, diagnostic := deploy(1); status != "succeeded" || diagnostic != "" {
		t.Fatalf("the applied configuration's binding after a refused activation: %s %q", status, diagnostic)
	}
	if status, diagnostic := deploy(2); status != "failed" || diagnostic != "binding_changed: tracker" {
		t.Fatalf("a binding to the refused generation: %s %q", status, diagnostic)
	}

	// Readings keep the applied generation, so running automations and storage accept them.
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/adapter", sparkplugPayload(t, 0, bdSeqMetric(0)), time.Now()); err != nil {
		t.Fatal(err)
	}
	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 1, doubleMetric("battery", 1, 3.2), doubleMetric("latitude", 2, 51.04)))
	if len(js.published) != 1 {
		t.Fatalf("readings handed off: %d", len(js.published))
	}
	var telemetry devices.Telemetry
	if err := storage.Decode(js.published[0].Data, &telemetry); err != nil {
		t.Fatal(err)
	}
	if telemetry.Generation != 1 {
		t.Fatalf("telemetry generation %d, want the applied 1", telemetry.Generation)
	}
	if stored, err := a.Store.PersistResult(ctx, telemetry); err != nil || !stored {
		t.Fatalf("storage refused the applied generation's readings: %v %v", stored, err)
	}

	saved, err := a.Store.SavedDevices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if state := saved[d.DeviceUUID]; state.Generation != 2 || state.AppliedGeneration != 1 || state.Applied == nil || state.Applied.ConfigurationUUID != d.ConfigurationUUID {
		t.Fatalf("a restart would restore %+v", state)
	}

	// A configuration that does apply still changes the binding.
	next := d
	next.ConfigurationUUID = storage.UUID()
	if err := a.activate(next, 3, nil, "applied"); err != nil {
		t.Fatal(err)
	}
	if row := storedDevice(t, a, d.DeviceUUID); row.Outcome != "device.applied.v1" || row.Applied != 3 {
		t.Fatalf("applied activation: %+v", row)
	}
	if status, diagnostic := deploy(1); status != "failed" || diagnostic != "binding_changed: tracker" {
		t.Fatalf("a binding to the replaced configuration: %s %q", status, diagnostic)
	}
}

// recordingClient is a connected broker client that records what it publishes.
type recordingClient struct {
	mqtt.Client
	mu     sync.Mutex
	topics []string
}

func (c *recordingClient) IsConnectionOpen() bool { return true }
func (c *recordingClient) Publish(topic string, _ byte, _ bool, _ any) mqtt.Token {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.topics = append(c.topics, topic)
	return nil
}
func (c *recordingClient) published() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.topics...)
}

// heldFixture puts a recording broker client on a new connection.
func heldFixture(t *testing.T) (*Application, devices.Definition, devices.Connection, *recordingClient, *recordingJetStream) {
	t.Helper()
	a, base := lifecycleFixture(t)
	a.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	a.rebirth = map[string]time.Time{}
	a.rebirthPending = map[string]rebirthRequest{}
	js := &recordingJetStream{}
	a.JS = js
	c := devices.Connection{UUID: storage.UUID(), OrganizationUUID: base.OrganizationUUID, GroupID: "group"}
	client := &recordingClient{}
	a.brokers[c.UUID] = &broker{Connection: c, Client: client}
	t.Cleanup(func() {
		_, _ = a.Store.Pool.Exec(context.Background(), "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'connection_uuid'=$1", c.UUID)
	})
	return a, base, c, client, js
}

// handedOff decodes the telemetry handed to storage, by device.
func handedOff(t *testing.T, js *recordingJetStream) map[string][]devices.Telemetry {
	t.Helper()
	byDevice := map[string][]devices.Telemetry{}
	for _, m := range js.published {
		var telemetry devices.Telemetry
		if err := storage.Decode(m.Data, &telemetry); err != nil {
			t.Fatal(err)
		}
		byDevice[telemetry.Definition.DeviceUUID] = append(byDevice[telemetry.Definition.DeviceUUID], telemetry)
	}
	return byDevice
}

const offlineDiagnostic = "Source is offline or needs a fresh birth certificate. Review the source before retrying."

// The embedded SDK paces births at 20 per second, so after a rebirth a 500-device
// gateway takes about 25 s to announce its devices again. An activation checked after
// the NBIRTH but before its device's DBIRTH was refused as offline: 29 of 247 in a
// bulk onboarding on the dev stack (2026-11-05). It is now held without blocking, then
// applied against that DBIRTH, which becomes its first reading (R19).
func TestActivationBetweenNBirthAndDBirthAppliesOnTheBirth(t *testing.T) {
	a, base, c, client, js := heldFixture(t)
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/adapter", sparkplugPayload(t, 0, bdSeqMetric(0)), time.Now()); err != nil {
		t.Fatal(err)
	}
	d := trackerDefinition(base, c, false)
	started := time.Now()
	if err := a.activate(d, 2, nil, "held"); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("the activation blocked the control consumer while it waited")
	}
	if row := storedDevice(t, a, d.DeviceUUID); row.Generation != 1 {
		t.Fatalf("answered before the birth: %+v", row)
	}
	if _, held := a.held[d.DeviceUUID]; !held {
		t.Fatal("the activation is not held")
	}
	value, _ := a.fences.Load(d.DeviceUUID)
	if fence := value.(*sync.Mutex); !fence.TryLock() {
		t.Fatal("a held activation keeps the device fence")
	} else {
		fence.Unlock()
	}
	if topics := client.published(); len(topics) != 0 {
		t.Fatalf("a rebirth would restart the announcement in flight: %v", topics)
	}

	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 1, doubleMetric("battery", 1, 3.2), doubleMetric("latitude", 2, 51.04)))
	if row := storedDevice(t, a, d.DeviceUUID); row.Outcome != "device.applied.v1" || row.Generation != 2 || row.Applied != 2 || row.Configuration != d.ConfigurationUUID {
		t.Fatalf("the birth did not apply the held activation: %+v", row)
	}
	if _, held := a.held[d.DeviceUUID]; held {
		t.Fatal("the hold outlived its answer")
	}
	readings := handedOff(t, js)[d.DeviceUUID]
	if len(readings) != 1 || readings[0].Generation != 2 || len(readings[0].Readings) != 2 {
		t.Fatalf("the birth must be the first reading: %+v", readings)
	}
	if topics := client.published(); len(topics) != 0 || len(a.rebirthPending) != 0 {
		t.Fatalf("the birth carried the state, yet a rebirth was asked for: %v %v", topics, a.rebirthPending)
	}
}

// Holding is only for a birth that is due. An offline gateway, a device that died in
// its gateway's session, and a birth that does not arrive within the bound are still
// refused, and a late birth does not apply a refused activation.
func TestActivationRefusesASourceThatStaysOffline(t *testing.T) {
	a, base, c, client, _ := heldFixture(t)
	a.heldFor = 50 * time.Millisecond
	d := trackerDefinition(base, c, false)
	refused := func(generation int) {
		t.Helper()
		if row := storedDevice(t, a, d.DeviceUUID); row.Outcome != "device.failed.v1" || row.Generation != generation || row.Applied != 1 || row.Diagnostic != offlineDiagnostic {
			t.Fatalf("generation %d: %+v", generation, row)
		}
	}

	if err := a.activate(d, 2, nil, "gateway-offline"); err != nil {
		t.Fatal(err)
	}
	refused(2)

	// Online for a minute without announcing the device: ask for a rebirth, then give up.
	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/adapter", sparkplugPayload(t, 0, bdSeqMetric(0)), time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := a.activate(d, 3, nil, "never-announced"); err != nil {
		t.Fatal(err)
	}
	if _, held := a.held[d.DeviceUUID]; !held {
		t.Fatal("a due birth was not waited for")
	}
	if topics := client.published(); len(topics) != 1 || topics[0] != "spBv1.0/group/NCMD/adapter" {
		t.Fatalf("nothing would announce the device: %v", topics)
	}
	settled(t, a, d.DeviceUUID, 3)
	refused(3)
	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 1, doubleMetric("battery", 1, 3.2), doubleMetric("latitude", 2, 51.04)))
	refused(3)

	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/DDEATH/adapter/src-1", sparkplugPayload(t, 2), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := a.activate(d, 4, nil, "device-died"); err != nil {
		t.Fatal(err)
	}
	refused(4)
	if len(client.published()) != 1 {
		t.Fatal("a dead device is not announced again; no rebirth is due")
	}
}

// Bulk onboarding activates a gateway's devices within seconds while the gateway
// re-announces them at its own pace. Every activation applies, whether its device's
// birth came before or after it; the held ones ask for no rebirth of their own.
func TestBurstOfActivationsDuringAPacedRebirthAllApply(t *testing.T) {
	a, base, c, client, js := heldFixture(t)
	const count = 40
	defs := make([]devices.Definition, count)
	for i := range defs {
		defs[i] = trackerDefinition(base, c, false)
		defs[i].DeviceUUID = storage.UUID()
		defs[i].Source.EdgeNodeID = "gateway"
		defs[i].Source.DeviceID = fmt.Sprintf("meter-%03d", i)
	}
	var seq uint64
	birth := func(i int) []byte {
		seq = (seq + 1) % 256
		return sparkplugPayload(t, seq, doubleMetric("battery", 1, 3+float64(i)/100), doubleMetric("latitude", 2, 51.04))
	}
	nbirth := func(at time.Time) {
		seq = 0
		if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/gateway", sparkplugPayload(t, 0, bdSeqMetric(0), doubleMetric("Uptime", 1, float64(at.UnixNano()))), at); err != nil {
			t.Fatal(err)
		}
	}
	// Discovery saw every device an hour ago.
	nbirth(time.Now().Add(-time.Hour))
	for i := range defs {
		if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/DBIRTH/gateway/"+defs[i].Source.DeviceID, birth(i), time.Now()); err != nil {
			t.Fatal(err)
		}
	}

	// The first activation applies at once and asks for a rebirth. The answer resets
	// every source, and the births follow one by one while the burst arrives.
	if err := a.activate(defs[0], 2, nil, "bulk-0"); err != nil {
		t.Fatal(err)
	}
	nbirth(time.Now())
	paced := 0
	for ; paced < count/3; paced++ {
		a.packet(c, "spBv1.0/group/DBIRTH/gateway/"+defs[paced].Source.DeviceID, birth(paced))
	}
	for i := 1; i < count; i++ {
		if err := a.activate(defs[i], 2, nil, fmt.Sprintf("bulk-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if len(a.held) != count-paced {
		t.Fatalf("%d held, want the %d whose births had not arrived", len(a.held), count-paced)
	}
	for ; paced < count; paced++ {
		a.packet(c, "spBv1.0/group/DBIRTH/gateway/"+defs[paced].Source.DeviceID, birth(paced))
	}

	readings := handedOff(t, js)
	for i, d := range defs {
		if row := storedDevice(t, a, d.DeviceUUID); row.Outcome != "device.applied.v1" || row.Generation != 2 || row.Applied != 2 {
			t.Fatalf("device %d: %+v", i, row)
		}
		if i >= count/3 && (len(readings[d.DeviceUUID]) != 1 || readings[d.DeviceUUID][0].Generation != 2) {
			t.Fatalf("device %d: its birth was not its first reading: %+v", i, readings[d.DeviceUUID])
		}
	}
	if len(a.held) != 0 {
		t.Fatalf("%d activations still held", len(a.held))
	}
	if topics := client.published(); len(topics) != 1 {
		t.Fatalf("rebirths sent during the burst: %v", topics)
	}
}
