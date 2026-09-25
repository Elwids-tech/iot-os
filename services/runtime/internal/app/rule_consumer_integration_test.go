package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

func TestRuleConsumerPersistsBeforeAckAndResumes(t *testing.T) {
	db, broker := os.Getenv("DEVICE_TEST_DATABASE_URL"), os.Getenv("DEVICE_TEST_NATS_URL")
	if db == "" || broker == "" {
		t.Skip("Requires isolated database and broker")
	}
	if !strings.Contains(db, "/iot_devices_test?") {
		t.Fatal("Refusing non-test database")
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := storage.Open(ctx, db)
	must(err)
	defer store.Pool.Close()
	nc, err := nats.Connect(broker)
	must(err)
	defer nc.Close()
	js, err := nc.JetStream()
	must(err)
	if _, err = js.StreamInfo(devices.CommittedTelemetryStream); err != nats.ErrStreamNotFound {
		t.Fatal("requires unused committed stream", err)
	}
	var count int
	must(store.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.rule_checkpoint`).Scan(&count))
	if count != 0 {
		t.Fatal("requires unused rule checkpoint")
	}
	a := &Application{ctx: ctx, Store: store, JS: js, NATS: nc, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	must(a.ensureCommittedStream())
	raw, err := os.ReadFile("../../../../contracts/rules/v1/definition.fixture.json")
	must(err)
	var d rules.Definition
	must(storage.Decode(raw, &d))
	d.UUID = storage.UUID()
	d.VersionUUID = storage.UUID()
	d.Binding.OrganizationUUID = storage.UUID()
	d.Binding.DeviceUUID = storage.UUID()
	d.Binding.ConfigurationUUID = storage.UUID()
	d.Policy.OutsideForSeconds = 0
	d.Policy.MinimumSamples = 1
	ids := []string{}
	defer func() {
		cancel()
		must(js.DeleteStream(devices.CommittedTelemetryStream))
		nc.Close()
		cleanup := context.Background()
		_, err = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_transitions WHERE operation_uuid=$1`, d.VersionUUID)
		must(err)
		for _, table := range []string{"rule_executions", "rule_heads", "telemetry_outbox", "observations", "diagnostics", "latest", "devices"} {
			_, err = store.Pool.Exec(cleanup, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", d.Binding.OrganizationUUID)
			must(err)
		}
		_, err = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, d.Binding.OrganizationUUID)
		must(err)
		_, err = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_inputs WHERE event_uuid=ANY($1::uuid[])`, ids)
		must(err)
		_, err = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_checkpoint`)
		must(err)
	}()
	deg, metres := "deg", "m"
	profile := devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{{UUID: d.Binding.LatitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg}, {UUID: d.Binding.LongitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg}, {UUID: *d.Binding.AccuracyParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &metres}}}
	p, _ := json.Marshal(profile)
	sum := sha256.Sum256(p)
	device := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: d.Binding.DeviceUUID, OrganizationUUID: d.Binding.OrganizationUUID, ConfigurationUUID: d.Binding.ConfigurationUUID, ProfileCanonicalJSON: string(p), ProfileHash: hex.EncodeToString(sum[:])}
	for _, p := range profile.Parameters {
		device.Mappings = append(device.Mappings, devices.Mapping{ParameterUUID: p.UUID, Metric: p.UUID, Datatype: "Double"})
	}
	must(store.Apply(ctx, device, 1, "device.applied.v1"))
	must(store.DeployRule(ctx, rules.Deployment{OperationUUID: d.VersionUUID, RuleUUID: d.UUID, OrganizationUUID: d.Binding.OrganizationUUID, Generation: 1, Target: "active", Definition: &d}, time.Now().UTC().Add(-time.Second)))
	must(a.startRuleConsumer(ctx))
	publish := func(lon float64) {
		at := time.Now().UTC()
		telemetry := devices.Telemetry{UUID: storage.UUID(), Definition: device, Generation: 1}
		ids = append(ids, telemetry.UUID)
		for i, p := range profile.Parameters {
			telemetry.Readings = append(telemetry.Readings, devices.Reading{ParameterUUID: p.UUID, Key: p.UUID, DataType: "number", Unit: p.Unit, Value: []float64{51, lon, 0}[i], Quality: "good", ObservedAt: at, ReceivedAt: at, TimestampSource: "source"})
		}
		must(store.Persist(context.Background(), telemetry))
		_, err = a.publishCommittedBatch(context.Background())
		must(err)
	}
	wait := func(transitions int, sequence uint64) {
		t.Helper()
		// A pull request from the closed connection can have reserved a message;
		// allow the durable consumer's 30-second acknowledgement lease to expire.
		deadline := time.Now().Add(40 * time.Second)
		for time.Now().Before(deadline) {
			var n int
			err = store.Pool.QueryRow(context.Background(), `SELECT count(*) FROM device_runtime.rule_transitions WHERE operation_uuid=$1`, d.VersionUUID).Scan(&n)
			must(err)
			consumer, e := a.JS.ConsumerInfo(devices.CommittedTelemetryStream, "workflow-evaluator-v1")
			if e == nil && n == transitions && consumer.AckFloor.Stream >= sequence {
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
		var state []byte
		_ = store.Pool.QueryRow(context.Background(), `SELECT state FROM device_runtime.rule_executions WHERE operation_uuid=$1`, d.VersionUUID).Scan(&state)
		consumer, _ := a.JS.ConsumerInfo(devices.CommittedTelemetryStream, "workflow-evaluator-v1")
		t.Fatal("consumer failed to persist and acknowledge", transitions, sequence, string(state), consumer)
	}
	publish(-114.02)
	wait(1, 1)
	// Publish the identical event again outside broker message-ID deduplication.
	var duplicate []byte
	must(store.Pool.QueryRow(ctx, `SELECT event FROM device_runtime.telemetry_outbox WHERE telemetry_uuid=$1`, ids[0]).Scan(&duplicate))
	var ev devices.CommittedTelemetry
	must(storage.Decode(duplicate, &ev))
	ev.Sequence = "1"
	duplicate, _ = json.Marshal(ev)
	_, err = js.Publish(devices.CommittedTelemetrySubject, duplicate)
	must(err)
	wait(1, 2)
	// Close the transport and start a new consumer using only SQL and broker state.
	cancel()
	nc.Close()
	ctx, cancel = context.WithCancel(context.Background())
	nc, err = nats.Connect(broker)
	must(err)
	js, err = nc.JetStream()
	must(err)
	a = &Application{ctx: ctx, Store: store, JS: js, NATS: nc, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	must(a.startRuleConsumer(ctx))
	publish(-114)
	wait(2, 3)
	var active bool
	must(store.Pool.QueryRow(ctx, `SELECT (state->>'active')::boolean FROM device_runtime.rule_executions WHERE operation_uuid=$1`, d.VersionUUID).Scan(&active))
	if active {
		t.Fatal("restart did not clear on inside observation")
	}
	cancel()
	nc.Close()
	// A replacement stream cannot silently start at a reset checkpoint.
	nc, err = nats.Connect(broker)
	must(err)
	js, err = nc.JetStream()
	must(err)
	must(js.DeleteStream(devices.CommittedTelemetryStream))
	a.JS = js
	a.NATS = nc
	must(a.ensureCommittedStream())
	if err = a.startRuleConsumer(context.Background()); err == nil {
		t.Fatal("accepted replacement stream")
	}
}
