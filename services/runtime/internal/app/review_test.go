package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

// recordingJetStream accepts telemetry hand-offs without a NATS server.
type recordingJetStream struct {
	nats.JetStreamContext
	published []*nats.Msg
}

func (j *recordingJetStream) PublishMsg(m *nats.Msg, _ ...nats.PubOpt) (*nats.PubAck, error) {
	j.published = append(j.published, m)
	return &nats.PubAck{}, nil
}

// An adapter publisher restarted by a device activation announced a source with 8 of
// its 9 mapped metrics and, 16 ms later, all 9 (pilot, 2026-10-28). The partial birth
// set review; until ADR-025 only a new device activation cleared it, so commands and
// automations stayed blocked although every later birth matched.
func TestCompatibleRebirthClearsReviewAndUnblocksAutomations(t *testing.T) {
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
		_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.rule_heads WHERE organization_uuid=$1", base.OrganizationUUID)
	})

	temperature, rssi := storage.UUID(), storage.UUID()
	profile, _ := json.Marshal(devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{
		{UUID: temperature, Key: "temperature", DataType: "number", ReportsState: true},
		{UUID: rssi, Key: "rssi", DataType: "number", ReportsState: true},
	}})
	d := base
	d.SchemaVersion = "device-configuration.v1"
	d.ProfileCanonicalJSON = string(profile)
	hash := sha256.Sum256(profile)
	d.ProfileHash = hex.EncodeToString(hash[:])
	d.Source = devices.Source{ConnectionUUID: c.UUID, GroupID: "group", EdgeNodeID: "adapter", DeviceID: "src-1"}
	d.Mappings = []devices.Mapping{{ParameterUUID: temperature, Metric: "temperature", Datatype: "Double"}, {ParameterUUID: rssi, Metric: "rssi", Datatype: "Double"}}
	if err := a.Store.Apply(ctx, d, 2, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	a.definitions[d.DeviceUUID] = d
	a.generations[d.DeviceUUID] = 2

	stored := func() bool {
		t.Helper()
		var review bool
		if err := a.Store.Pool.QueryRow(ctx, "SELECT review_required FROM device_runtime.devices WHERE device_uuid=$1", d.DeviceUUID).Scan(&review); err != nil {
			t.Fatal(err)
		}
		return review
	}
	state := func() (review, compatible bool) {
		a.mu.Lock()
		defer a.mu.Unlock()
		return a.reviewRequired[d.DeviceUUID], a.compatible[d.DeviceUUID]
	}
	lastDiagnostic := func() string {
		t.Helper()
		var diagnostic string
		if err := a.Store.Pool.QueryRow(ctx, "SELECT event->'payload'->>'diagnostic' FROM device_runtime.outbox WHERE event->>'type'='device.presence.v1' AND event->'payload'->>'device_uuid'=$1 ORDER BY created_at DESC, uuid DESC LIMIT 1", d.DeviceUUID).Scan(&diagnostic); err != nil {
			t.Fatal(err)
		}
		return diagnostic
	}
	deploy := func(generation int) (string, string) {
		t.Helper()
		workflow, operation := storage.UUID(), storage.UUID()
		w := dag.Workflow{Schema: dag.Schema, UUID: workflow, Version: operation, Organization: d.OrganizationUUID,
			Bindings: []dag.Binding{{Role: "freezer", Device: d.DeviceUUID, Configuration: d.ConfigurationUUID, Generation: generation, Parameter: temperature, DataType: "number", FreshSeconds: 120}},
			Nodes:    []dag.Node{{ID: "source", Type: "source.parameter.v1", Config: map[string]any{"binding": "freezer"}}, {ID: "condition", Type: "compare.v1", Config: map[string]any{"operator": "gt", "value": float64(-10)}}, {ID: "alert", Type: "action.alert.v1", Config: map[string]any{"title": "Warm"}}},
			Edges:    []dag.Edge{{Source: "source", SourcePort: "out", Target: "condition", TargetPort: "in"}, {Source: "condition", SourcePort: "out", Target: "alert", TargetPort: "in"}}}
		if err := a.Store.DeployDAG(ctx, storage.DAGDeployment{Operation: operation, Workflow: workflow, Organization: d.OrganizationUUID, Generation: 1, Target: "active", Definition: &w}, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = a.Store.Pool.Exec(ctx, "DELETE FROM device_runtime.dag_executions WHERE operation_uuid=$1", operation)
		})
		var status, diagnostic string
		if err := a.Store.Pool.QueryRow(ctx, "SELECT outcome->>'status', outcome->>'diagnostic' FROM device_runtime.rule_heads WHERE rule_uuid=$1", workflow).Scan(&status, &diagnostic); err != nil {
			t.Fatal(err)
		}
		return status, diagnostic
	}

	if _, err := a.Engine.Accept(c.UUID, "spBv1.0/group/NBIRTH/adapter", sparkplugPayload(t, 0, bdSeqMetric(0)), time.Now()); err != nil {
		t.Fatal(err)
	}
	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 1, doubleMetric("temperature", 1, -18)))
	if review, compatible := state(); !review || compatible || !stored() {
		t.Fatalf("a birth without rssi must require review: memory %v, compatible %v, stored %v", review, compatible, stored())
	}
	if diagnostic := lastDiagnostic(); !strings.Contains(diagnostic, "metric rssi is missing") {
		t.Fatalf("presence diagnostic %q", diagnostic)
	}
	if status, diagnostic := deploy(2); status != "failed" || diagnostic != "device_review_required: freezer" {
		t.Fatalf("activation against a device in review: %s %q", status, diagnostic)
	}
	if len(js.published) != 0 {
		t.Fatal("an incompatible birth handed off readings")
	}

	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 2, doubleMetric("temperature", 1, -18), doubleMetric("rssi", 2, -71)))
	if review, compatible := state(); review || !compatible || stored() {
		t.Fatalf("a matching birth must clear review: memory %v, compatible %v, stored %v", review, compatible, stored())
	}
	if diagnostic := lastDiagnostic(); diagnostic != "" {
		t.Fatalf("presence still carries %q", diagnostic)
	}
	if len(js.published) != 1 {
		t.Fatalf("readings handed off: %d", len(js.published))
	}
	if status, diagnostic := deploy(2); status != "succeeded" || diagnostic != "" {
		t.Fatalf("activation after review cleared: %s %q", status, diagnostic)
	}
	// A binding to an older generation is still a changed binding, not a review.
	if status, diagnostic := deploy(1); status != "failed" || diagnostic != "binding_changed: freezer" {
		t.Fatalf("stale binding: %s %q", status, diagnostic)
	}

	// Review still latches while the current birth is incompatible.
	a.packet(c, "spBv1.0/group/DBIRTH/adapter/src-1", sparkplugPayload(t, 3, doubleMetric("temperature", 1, -18)))
	a.packet(c, "spBv1.0/group/DDATA/adapter/src-1", sparkplugPayload(t, 4, doubleMetric("", 1, -17)))
	if review, compatible := state(); !review || compatible || !stored() {
		t.Fatalf("data in an incompatible session cleared review: memory %v, compatible %v, stored %v", review, compatible, stored())
	}
}
