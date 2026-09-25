package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
)

func TestDurableRulesRecoveryFencesAndAtomicity(t *testing.T) {
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
	var count int
	must(s.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.rule_checkpoint`).Scan(&count))
	if count != 0 {
		t.Fatal("requires unused workflow checkpoint")
	}
	raw, err := os.ReadFile("../../../../contracts/rules/v1/definition.fixture.json")
	must(err)
	var d rules.Definition
	must(Decode(raw, &d))
	d.UUID = UUID()
	d.VersionUUID = UUID()
	d.Binding.OrganizationUUID = UUID()
	d.Binding.DeviceUUID = UUID()
	d.Binding.ConfigurationUUID = UUID()
	defer func() {
		_, err = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox DROP CONSTRAINT IF EXISTS workflow_test_fail`)
		must(err)
		_, err = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_transitions WHERE operation_uuid IN (SELECT operation_uuid FROM device_runtime.rule_executions WHERE organization_uuid=$1)`, d.Binding.OrganizationUUID)
		must(err)
		for _, table := range []string{"rule_executions", "rule_heads", "devices"} {
			_, err = s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", d.Binding.OrganizationUUID)
			must(err)
		}
		_, err = s.Pool.Exec(ctx, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, d.Binding.OrganizationUUID)
		must(err)
		_, err = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_inputs WHERE consumed_at >= $1`, time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC))
		must(err)
		_, err = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_checkpoint`)
		must(err)
	}()
	deg, metres := "deg", "m"
	profile := devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{{UUID: d.Binding.LatitudeParameterUUID, DataType: "number", Kind: "measurement", ReportsState: true, Unit: &deg}, {UUID: d.Binding.LongitudeParameterUUID, DataType: "number", Kind: "measurement", ReportsState: true, Unit: &deg}, {UUID: *d.Binding.AccuracyParameterUUID, DataType: "number", Kind: "measurement", ReportsState: true, Unit: &metres}}}
	p, _ := json.Marshal(profile)
	hash := sha256.Sum256(p)
	device := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: d.Binding.DeviceUUID, OrganizationUUID: d.Binding.OrganizationUUID, ConfigurationUUID: d.Binding.ConfigurationUUID, ProfileCanonicalJSON: string(p), ProfileHash: hex.EncodeToString(hash[:])}
	for _, p := range profile.Parameters {
		device.Mappings = append(device.Mappings, devices.Mapping{ParameterUUID: p.UUID, Metric: p.UUID, Datatype: "Double"})
	}
	must(s.Apply(ctx, device, 1, "device.applied.v1"))
	at := time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC)
	request := rules.Deployment{OperationUUID: d.VersionUUID, RuleUUID: d.UUID, OrganizationUUID: d.Binding.OrganizationUUID, Generation: 1, Target: "active", Definition: &d}
	must(s.DeployRule(ctx, request, at))
	must(s.DeployRule(ctx, request, at))
	_, err = s.PrepareRuleConsumer(ctx, at, 1, 0)
	must(err)
	packet := func(when time.Time, lon float64) devices.CommittedTelemetry {
		id := UUID()
		e := devices.CommittedTelemetry{SchemaVersion: devices.CommittedTelemetryVersion, EventID: id, TelemetryID: id, Sequence: "1", OrganizationUUID: d.Binding.OrganizationUUID, DeviceUUID: d.Binding.DeviceUUID, ConfigurationUUID: d.Binding.ConfigurationUUID, Generation: 1}
		for i, p := range profile.Parameters {
			value := []float64{51, lon, 0}[i]
			e.Readings = append(e.Readings, devices.CommittedReading{ParameterUUID: p.UUID, DataType: "number", Unit: p.Unit, Value: value, Quality: "good", ObservedAt: when, ReceivedAt: when, TimestampSource: "source"})
		}
		return e
	}
	state := func() rules.State {
		var raw []byte
		must(s.Pool.QueryRow(ctx, `SELECT state FROM device_runtime.rule_executions WHERE operation_uuid=$1`, request.OperationUUID).Scan(&raw))
		var state rules.State
		must(Decode(raw, &state))
		return state
	}
	first := packet(at.Add(time.Second), -114.02)
	must(s.ConsumeRuleTelemetry(ctx, 1, first, at.Add(time.Second)))
	must(s.ConsumeRuleTelemetry(ctx, 1, first, at.Add(2*time.Second))) // ack lost
	must(s.ConsumeRuleTelemetry(ctx, 2, first, at.Add(2*time.Second))) // broker dedup window expired
	if state().Samples != 1 {
		t.Fatal("duplicate observation contributed evidence")
	}
	must(s.ConsumeRuleTelemetry(ctx, 3, packet(at.Add(31*time.Second), -114.02), at.Add(31*time.Second)))
	if state().Active {
		t.Fatal("activated before duration")
	}
	// A new Store represents a runtime restart: no in-memory execution state.
	restarted, err := Open(ctx, url)
	must(err)
	defer restarted.Pool.Close()
	_, err = restarted.PrepareRuleConsumer(ctx, at, 1, 3)
	must(err)
	must(restarted.TickRules(ctx, at.Add(61*time.Second)))
	if !state().Active || state().Episode != 1 {
		t.Fatal("restart lost pending timer")
	}
	must(restarted.TickRules(ctx, at.Add(62*time.Second)))
	must(s.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.rule_transitions WHERE operation_uuid=$1`, request.OperationUUID).Scan(&count))
	if count != 1 {
		t.Fatal("timer duplicated activation", count)
	}
	must(restarted.TickRules(ctx, at.Add(150*time.Second)))
	if !state().Active || state().Condition != "unknown" {
		t.Fatal("missing GPS cleared an active episode")
	}
	// Force transition outbox insertion to fail. State, transition and checkpoint
	// must all roll back so redelivery can complete the exact same clear once.
	_, err = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox ADD CONSTRAINT workflow_test_fail CHECK (event->>'type' <> 'workflow.transition.v1') NOT VALID`)
	must(err)
	inside := packet(at.Add(151*time.Second), -114)
	if err = s.ConsumeRuleTelemetry(ctx, 4, inside, at.Add(151*time.Second)); err == nil {
		t.Fatal("expected transactional outbox failure")
	}
	if !state().Active {
		t.Fatal("failed transaction changed state")
	}
	var checkpoint uint64
	must(s.Pool.QueryRow(ctx, `SELECT sequence FROM device_runtime.rule_checkpoint`).Scan(&checkpoint))
	if checkpoint != 3 {
		t.Fatal("checkpoint advanced without transition")
	}
	_, err = s.Pool.Exec(ctx, `ALTER TABLE device_runtime.outbox DROP CONSTRAINT workflow_test_fail`)
	must(err)
	must(s.ConsumeRuleTelemetry(ctx, 4, inside, at.Add(151*time.Second)))
	if state().Active {
		t.Fatal("fresh inside did not clear")
	}
	if err = s.ConsumeRuleTelemetry(ctx, 6, packet(at.Add(152*time.Second), -114), at.Add(152*time.Second)); err == nil {
		t.Fatal("accepted checkpoint gap")
	}
	if _, err = s.PrepareRuleConsumer(ctx, at.Add(time.Second), 1, 4); err == nil {
		t.Fatal("accepted replaced stream")
	}
	if _, err = s.PrepareRuleConsumer(ctx, at, 6, 8); err == nil {
		t.Fatal("accepted retention gap")
	}
	// A newer device generation fences the old binding even for timer evaluation.
	must(s.Apply(ctx, device, 2, "device.applied.v1"))
	must(s.TickRules(ctx, at.Add(153*time.Second)))
	var enabled bool
	var reason string
	must(s.Pool.QueryRow(ctx, `SELECT enabled,stopped_reason FROM device_runtime.rule_executions WHERE operation_uuid=$1`, request.OperationUUID).Scan(&enabled, &reason))
	if enabled || reason != "binding_changed" {
		t.Fatal("old configuration continued running")
	}
	// Invalid deployment must fail durably and cannot restart the old binding.
	failed := request
	failed.OperationUUID = UUID()
	failed.Generation = 2
	failedDefinition := d
	failedDefinition.VersionUUID = failed.OperationUUID
	failed.Definition = &failedDefinition
	must(s.DeployRule(ctx, failed, at.Add(154*time.Second)))
	var outcome []byte
	must(s.Pool.QueryRow(ctx, `SELECT outcome FROM device_runtime.rule_heads WHERE rule_uuid=$1`, d.UUID).Scan(&outcome))
	var status map[string]any
	must(Decode(outcome, &status))
	if status["status"] != "failed" {
		t.Fatal("accepted stale deployment")
	}
	disable := rules.Deployment{OperationUUID: UUID(), RuleUUID: d.UUID, OrganizationUUID: d.Binding.OrganizationUUID, Generation: 3, Target: "inactive"}
	must(s.DeployRule(ctx, disable, at.Add(155*time.Second)))
	must(s.DeployRule(ctx, request, at.Add(156*time.Second))) // old control redelivery cannot resurrect
	must(s.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.rule_executions WHERE rule_uuid=$1 AND enabled`, d.UUID).Scan(&count))
	if count != 0 {
		t.Fatal("old activation resurrected")
	}
}
