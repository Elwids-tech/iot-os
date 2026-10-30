package storage

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// A device in review and a changed binding stop a running automation for different
// reasons, so the portal can say which one to fix (ADR-025).
func TestDAGSuspensionSeparatesDeviceReviewFromChangedBindings(t *testing.T) {
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
	defer s.Pool.Close()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	org, device, config, param := UUID(), UUID(), UUID(), UUID()
	at := time.Date(2090, 2, 1, 0, 0, 0, 0, time.UTC)
	defer func() {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_evaluations WHERE organization_uuid=$1`, org)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_executions WHERE organization_uuid=$1`, org)
		for _, table := range []string{"rule_heads", "devices"} {
			_, _ = s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", org)
		}
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, org)
	}()
	profile, _ := json.Marshal(devices.Profile{Parameters: []devices.Parameter{{UUID: param, DataType: "number", ReportsState: true}}})
	d := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: device, OrganizationUUID: org, ConfigurationUUID: config, ProfileCanonicalJSON: string(profile), Mappings: []devices.Mapping{{ParameterUUID: param, Metric: "temperature", Datatype: "Double"}}}
	must(s.Apply(ctx, d, 1, "device.applied.v1"))
	activate := func() string {
		t.Helper()
		workflow, operation := UUID(), UUID()
		w := dag.Workflow{Schema: dag.Schema, UUID: workflow, Version: operation, Organization: org,
			Bindings: []dag.Binding{{Role: "sensor", Device: device, Configuration: config, Generation: 1, Parameter: param, DataType: "number", FreshSeconds: 60}},
			Nodes:    []dag.Node{{ID: "source", Type: "source.parameter.v1", Config: map[string]any{"binding": "sensor"}}, {ID: "condition", Type: "compare.v1", Config: map[string]any{"operator": "gt", "value": float64(25)}}, {ID: "alert", Type: "action.alert.v1", Config: map[string]any{"title": "Hot"}}},
			Edges:    []dag.Edge{{Source: "source", SourcePort: "out", Target: "condition", TargetPort: "in"}, {Source: "condition", SourcePort: "out", Target: "alert", TargetPort: "in"}}}
		must(s.DeployDAG(ctx, DAGDeployment{operation, workflow, org, 1, "active", &w}, at))
		return operation
	}
	evaluate := func(generation int) {
		t.Helper()
		input := devices.CommittedTelemetry{EventID: UUID(), OrganizationUUID: org, DeviceUUID: device, ConfigurationUUID: config, Generation: generation, Readings: []devices.CommittedReading{{ParameterUUID: param, Value: float64(30), Quality: "good", ObservedAt: at.Add(time.Second), ReceivedAt: at.Add(time.Second)}}}
		tx, err := s.Pool.Begin(ctx)
		must(err)
		defer tx.Rollback(ctx)
		must(evaluateDAGs(ctx, tx, &input, at.Add(time.Second), at.Add(time.Second)))
		must(tx.Commit(ctx))
	}
	stopped := func(operation string) (bool, string, string) {
		t.Helper()
		var enabled bool
		var reason, event string
		must(s.Pool.QueryRow(ctx, `SELECT enabled, coalesce(stopped_reason,'') FROM device_runtime.dag_executions WHERE operation_uuid=$1`, operation).Scan(&enabled, &reason))
		_ = s.Pool.QueryRow(ctx, `SELECT event->'payload'->>'reason' FROM device_runtime.outbox WHERE event->>'type'='workflow.suspended.v1' AND event->'payload'->>'operation_uuid'=$1`, operation).Scan(&event)
		return enabled, reason, event
	}

	reviewed := activate()
	must(s.RequireReview(ctx, d))
	evaluate(1)
	if enabled, reason, event := stopped(reviewed); enabled || reason != "device_review_required: sensor" || event != reason {
		t.Fatalf("review suspension: enabled %v, reason %q, event %q", enabled, reason, event)
	}

	must(s.ClearReview(ctx, d))
	changed := activate()
	must(s.Apply(ctx, d, 2, "device.applied.v1"))
	evaluate(2)
	if enabled, reason, event := stopped(changed); enabled || reason != "binding_changed: sensor" || event != reason {
		t.Fatalf("binding suspension: enabled %v, reason %q, event %q", enabled, reason, event)
	}
}

// A refused activation advances the device's fence but not the generation its applied
// configuration came with, so an automation bound to that configuration keeps running
// and its readings are still stored (ADR-027).
func TestRefusedActivationKeepsRunningAutomationsBound(t *testing.T) {
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
	defer s.Pool.Close()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	org, device, config, param := UUID(), UUID(), UUID(), UUID()
	at := time.Date(2090, 3, 1, 0, 0, 0, 0, time.UTC)
	defer func() {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_evaluations WHERE organization_uuid=$1`, org)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.dag_executions WHERE organization_uuid=$1`, org)
		for _, table := range []string{"rule_heads", "observations", "latest", "devices"} {
			_, _ = s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", org)
		}
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1`, org)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, org)
	}()
	profile, _ := json.Marshal(devices.Profile{Parameters: []devices.Parameter{{UUID: param, DataType: "number", ReportsState: true}}})
	d := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: device, OrganizationUUID: org, ConfigurationUUID: config, ProfileCanonicalJSON: string(profile), Mappings: []devices.Mapping{{ParameterUUID: param, Metric: "temperature", Datatype: "Double"}}}
	must(s.Apply(ctx, d, 1, "device.applied.v1"))
	workflow, operation := UUID(), UUID()
	w := dag.Workflow{Schema: dag.Schema, UUID: workflow, Version: operation, Organization: org,
		Bindings: []dag.Binding{{Role: "sensor", Device: device, Configuration: config, Generation: 1, Parameter: param, DataType: "number", FreshSeconds: 60}},
		Nodes:    []dag.Node{{ID: "source", Type: "source.parameter.v1", Config: map[string]any{"binding": "sensor"}}, {ID: "condition", Type: "compare.v1", Config: map[string]any{"operator": "gt", "value": float64(25)}}, {ID: "alert", Type: "action.alert.v1", Config: map[string]any{"title": "Hot"}}},
		Edges:    []dag.Edge{{Source: "source", SourcePort: "out", Target: "condition", TargetPort: "in"}, {Source: "condition", SourcePort: "out", Target: "alert", TargetPort: "in"}}}
	must(s.DeployDAG(ctx, DAGDeployment{operation, workflow, org, 1, "active", &w}, at))

	refused := d
	refused.ConfigurationUUID = UUID()
	must(s.FailTransition(ctx, refused, 2, UUID(), "Source is offline or needs a fresh birth certificate. Review the source before retrying."))

	input := devices.CommittedTelemetry{EventID: UUID(), OrganizationUUID: org, DeviceUUID: device, ConfigurationUUID: config, Generation: 1, Readings: []devices.CommittedReading{{ParameterUUID: param, Value: float64(30), Quality: "good", ObservedAt: at.Add(time.Second), ReceivedAt: at.Add(time.Second)}}}
	tx, err := s.Pool.Begin(ctx)
	must(err)
	must(evaluateDAGs(ctx, tx, &input, at.Add(time.Second), at.Add(time.Second)))
	must(tx.Commit(ctx))
	var enabled bool
	var reason string
	must(s.Pool.QueryRow(ctx, `SELECT enabled, coalesce(stopped_reason,'') FROM device_runtime.dag_executions WHERE operation_uuid=$1`, operation).Scan(&enabled, &reason))
	if !enabled || reason != "" {
		t.Fatalf("a refused activation stopped the automation: enabled %v, reason %q", enabled, reason)
	}

	reading := []devices.Reading{{ParameterUUID: param, DataType: "number", Quality: "good", Value: float64(30), ObservedAt: at, ReceivedAt: at}}
	for generation, want := range map[int]bool{1: true, 2: false} {
		stored, err := s.PersistResult(ctx, devices.Telemetry{UUID: UUID(), Generation: generation, Definition: d, Readings: reading})
		if err != nil || stored != want {
			t.Fatalf("readings at generation %d: stored %v, want %v (%v)", generation, stored, want, err)
		}
	}
}
