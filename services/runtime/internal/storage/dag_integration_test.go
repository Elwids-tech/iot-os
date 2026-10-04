package storage

import (
	"context"
	"encoding/json"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDAGDurableRecoveryAtomicityAndFencing(t *testing.T) {
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("Requires isolated Devices database")
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		t.Fatal("Refusing non-test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Pool.Close() }()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	org, device, config, param, workflow, operation := UUID(), UUID(), UUID(), UUID(), UUID(), UUID()
	at := time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC)
	defer func() {
		_, _ = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox DROP CONSTRAINT IF EXISTS dag_test_fail`)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_intents WHERE operation_uuid=$1`, operation)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_executions WHERE organization_uuid=$1`, org)
		for _, table := range []string{"rule_heads", "devices"} {
			_, _ = s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", org)
		}
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, org)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_inputs WHERE consumed_at >= $1`, at)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_checkpoint`)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_clock`)
	}()
	profile, _ := json.Marshal(devices.Profile{Parameters: []devices.Parameter{{UUID: param, DataType: "number", ReportsState: true}}})
	d := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: device, OrganizationUUID: org, ConfigurationUUID: config, ProfileCanonicalJSON: string(profile), Mappings: []devices.Mapping{{ParameterUUID: param, Metric: "temperature", Datatype: "Double"}}}
	must(s.Apply(ctx, d, 1, "device.applied.v1"))
	w := dag.Workflow{Schema: dag.Schema, UUID: workflow, Version: operation, Organization: org, Bindings: []dag.Binding{{Role: "sensor", Device: device, Configuration: config, Generation: 1, Parameter: param, DataType: "number", FreshSeconds: 60}}, Nodes: []dag.Node{{ID: "source", Type: "source.parameter.v1", Config: map[string]any{"binding": "sensor"}}, {ID: "condition", Type: "compare.v1", Config: map[string]any{"operator": "gt", "value": float64(25)}}, {ID: "sustained", Type: "sustained.v1", Config: map[string]any{"seconds": float64(5)}}, {ID: "alert", Type: "action.alert.v1", Config: map[string]any{"title": "Hot"}}}, Edges: []dag.Edge{{Source: "source", SourcePort: "out", Target: "condition", TargetPort: "in"}, {Source: "condition", SourcePort: "out", Target: "sustained", TargetPort: "in"}, {Source: "sustained", SourcePort: "out", Target: "alert", TargetPort: "in"}}}
	request := DAGDeployment{operation, workflow, org, 1, "active", &w}
	must(s.DeployDAG(ctx, request, at))
	_, err = s.PrepareRuleConsumer(ctx, at, 1, 0)
	must(err)
	input := devices.CommittedTelemetry{EventID: UUID(), OrganizationUUID: org, DeviceUUID: device, ConfigurationUUID: config, Generation: 1, Readings: []devices.CommittedReading{{ParameterUUID: param, Value: float64(40), Quality: "good", ObservedAt: at.Add(time.Second), ReceivedAt: at.Add(time.Second)}}}
	must(s.ConsumeRuleTelemetry(ctx, 1, input, at.Add(time.Second)))
	entries, err := s.DAGTimeline(ctx, org, workflow, 0, 0)
	must(err)
	if len(entries) != 1 || entries[0].Outcome != "waiting" {
		t.Fatalf("missing initial evidence: %+v", entries)
	}
	initialID := entries[0].ID
	// Close and reopen the store while evidence is pending.
	s.Pool.Close()
	s, err = Open(ctx, url)
	must(err)
	_, err = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox ADD CONSTRAINT dag_test_fail CHECK(event->>'type' <> 'automation.intent.v1')`)
	must(err)
	if err = s.TickDAGs(ctx, at.Add(7*time.Second), 1); err == nil {
		t.Fatal("expected atomic outbox failure")
	}
	var stateRaw []byte
	must(s.Pool.QueryRow(ctx, `SELECT state FROM device_runtime.dag_executions WHERE operation_uuid=$1`, operation).Scan(&stateRaw))
	var state dag.State
	must(json.Unmarshal(stateRaw, &state))
	if state.Nodes["alert"].Active {
		t.Fatal("failed transaction changed state")
	}
	entries, err = s.DAGTimeline(ctx, org, workflow, 0, 0)
	must(err)
	if len(entries) != 1 || entries[0].ID != initialID {
		t.Fatal("rolled-back evaluation leaked into timeline")
	}
	_, err = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox DROP CONSTRAINT dag_test_fail`)
	must(err)
	must(s.TickDAGs(ctx, at.Add(7*time.Second), 1))
	must(s.ConsumeRuleTelemetry(ctx, 2, input, at.Add(8*time.Second)))
	must(s.TickDAGs(ctx, at.Add(9*time.Second), 2))
	var count int
	must(s.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.dag_intents WHERE operation_uuid=$1`, operation).Scan(&count))
	if count != 1 {
		t.Fatalf("got %d intents", count)
	}
	entries, err = s.DAGTimeline(ctx, org, workflow, 0, 0)
	must(err)
	foundIntent := false
	for _, entry := range entries {
		foundIntent = foundIntent || len(entry.IntentIDs) > 0
	}
	if !foundIntent {
		t.Fatal("timeline cannot correlate action intent")
	}
	foreign, err := s.DAGTimeline(ctx, UUID(), workflow, 0, 0)
	must(err)
	if len(foreign) != 0 {
		t.Fatal("timeline crossed organization boundary")
	}
	// A busy workflow stays bounded and older-page cursors exclude newer rows.
	tx, err := s.Pool.Begin(ctx)
	must(err)
	for i := 0; i <= DAGTimelineLimit; i++ {
		must(recordDAGEvaluation(ctx, tx, w, &input, at, &dag.Result{Trace: []dag.Trace{}}, ""))
	}
	must(tx.Commit(ctx))
	must(s.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.dag_evaluations WHERE workflow_uuid=$1`, workflow).Scan(&count))
	if count != DAGTimelineLimit {
		t.Fatalf("history limit failed: %d", count)
	}
	entries, err = s.DAGTimeline(ctx, org, workflow, 0, 0)
	must(err)
	if len(entries) != 21 {
		t.Fatal("missing pagination sentinel")
	}
	cursor, err := strconv.ParseInt(entries[19].ID, 10, 64)
	must(err)
	older, err := s.DAGTimeline(ctx, org, workflow, cursor, 0)
	must(err)
	if len(older) != 21 || older[0].ID != entries[20].ID {
		t.Fatal("older page skipped or repeated an evaluation")
	}
	disable := DAGDeployment{UUID(), workflow, org, 2, "inactive", nil}
	must(s.DeployDAG(ctx, disable, at.Add(10*time.Second)))
	must(s.DeployDAG(ctx, request, at.Add(11*time.Second)))
	var enabled bool
	must(s.Pool.QueryRow(ctx, `SELECT enabled FROM device_runtime.dag_executions WHERE operation_uuid=$1`, operation).Scan(&enabled))
	if enabled {
		t.Fatal("stale deployment resurrected execution")
	}
}
