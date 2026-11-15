package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/storage"
	"github.com/nats-io/nats.go"
)

// BenchmarkPipeline measures what one runtime's serial stages carry, in messages a
// second (ADR-046): the storage consumer, the committed relay and the automation
// evaluator, each draining b.N ten-reading messages from 50 devices through the code
// the runtime runs. "geofences" gives every device one geofence rule; "idle" has no
// automation, which is the evaluator's cost for a message nothing reads.
//
// It needs an unused database and broker, like the integration tests:
//
//	DEVICE_TEST_DATABASE_URL=... DEVICE_TEST_NATS_URL=... \
//	  go test ./internal/app -run '^$' -bench Pipeline -benchtime 3000x
//
// DEVICE_BENCH_ROUND_TRIP=1ms holds everything the runtime sends to the database for
// that long, which is what a database on a second host costs. The broker stays local,
// as it is on both release shapes.
func BenchmarkPipeline(b *testing.B) {
	for _, withRules := range []bool{false, true} {
		name := "idle"
		if withRules {
			name = "geofences"
		}
		b.Run(name, func(b *testing.B) { benchmarkPipeline(b, withRules) })
	}
}

func benchmarkPipeline(b *testing.B, withRules bool) {
	db, broker := os.Getenv("DEVICE_TEST_DATABASE_URL"), os.Getenv("DEVICE_TEST_NATS_URL")
	if db == "" || broker == "" {
		b.Skip("Requires isolated database and broker")
	}
	if !strings.Contains(db, "/iot_devices_test?") {
		b.Fatal("Refusing non-test database")
	}
	must := func(err error) {
		b.Helper()
		if err != nil {
			b.Fatal(err)
		}
	}
	if raw := os.Getenv("DEVICE_BENCH_ROUND_TRIP"); raw != "" {
		delay, err := time.ParseDuration(raw)
		must(err)
		target, err := url.Parse(db)
		must(err)
		address, stop, err := delayedConnection(target.Host, delay)
		must(err)
		defer stop()
		target.Host = address
		db = target.String()
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := storage.Open(ctx, db)
	must(err)
	defer store.Pool.Close()
	// What one statement costs on this connection, so the rates can be read against it.
	const pings = 50
	pinging := time.Now()
	for i := 0; i < pings; i++ {
		_, err = store.Pool.Exec(ctx, "SELECT 1")
		must(err)
	}
	roundTrip := time.Since(pinging) / pings
	nc, err := nats.Connect(broker)
	must(err)
	defer nc.Close()
	js, err := nc.JetStream()
	must(err)
	const telemetryStream = "IOT_DEVICE_TELEMETRY"
	for _, stream := range []string{devices.CommittedTelemetryStream, telemetryStream} {
		if _, err = js.StreamInfo(stream); err != nats.ErrStreamNotFound {
			b.Fatal("requires unused stream "+stream, err)
		}
	}
	var count int
	must(store.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.rule_checkpoint`).Scan(&count))
	if count != 0 {
		b.Fatal("requires unused rule checkpoint")
	}

	raw, err := os.ReadFile("../../../../contracts/rules/v1/definition.fixture.json")
	must(err)
	var rule rules.Definition
	must(storage.Decode(raw, &rule))
	organization := storage.UUID()
	deg, metres := "deg", "m"
	profile := devices.Profile{SchemaVersion: "device-profile.v1", Parameters: []devices.Parameter{{UUID: rule.Binding.LatitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg}, {UUID: rule.Binding.LongitudeParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &deg}, {UUID: *rule.Binding.AccuracyParameterUUID, Kind: "measurement", DataType: "number", ReportsState: true, Unit: &metres}}}
	for len(profile.Parameters) < 10 {
		profile.Parameters = append(profile.Parameters, devices.Parameter{UUID: storage.UUID(), Kind: "measurement", DataType: "number", ReportsState: true})
	}
	canonical, _ := json.Marshal(profile)
	sum := sha256.Sum256(canonical)

	a := &Application{ctx: ctx, Store: store, JS: js, NATS: nc, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), definitions: map[string]devices.Definition{}, appliedGeneration: map[string]int{}, pending: map[string]*pendingCommand{}}
	operations := []string{}
	fleet := make([]devices.Definition, 50)
	for i := range fleet {
		d := devices.Definition{SchemaVersion: "device-configuration.v1", DeviceUUID: storage.UUID(), OrganizationUUID: organization, ConfigurationUUID: storage.UUID(), ProfileCanonicalJSON: string(canonical), ProfileHash: hex.EncodeToString(sum[:])}
		for _, p := range profile.Parameters {
			d.Mappings = append(d.Mappings, devices.Mapping{ParameterUUID: p.UUID, Metric: p.UUID, Datatype: "Double"})
		}
		must(store.Apply(ctx, d, 1, "device.applied.v1"))
		a.definitions[d.DeviceUUID], a.appliedGeneration[d.DeviceUUID] = d, 1
		fleet[i] = d
		if withRules {
			own := rule
			own.UUID, own.VersionUUID = storage.UUID(), storage.UUID()
			own.Binding.OrganizationUUID, own.Binding.DeviceUUID, own.Binding.ConfigurationUUID = organization, d.DeviceUUID, d.ConfigurationUUID
			must(store.DeployRule(ctx, rules.Deployment{OperationUUID: own.VersionUUID, RuleUUID: own.UUID, OrganizationUUID: organization, Generation: 1, Target: "active", Definition: &own}, time.Now().UTC().Add(-time.Second)))
			operations = append(operations, own.VersionUUID)
		}
	}
	ids := make([]string, 0, b.N)
	defer func() {
		cancel()
		for _, stream := range []string{devices.CommittedTelemetryStream, telemetryStream} {
			_ = js.DeleteStream(stream)
		}
		nc.Close()
		cleanup := context.Background()
		_, _ = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_transitions WHERE operation_uuid=ANY($1::uuid[])`, operations)
		for _, table := range []string{"rule_executions", "rule_heads", "telemetry_events", "telemetry_outbox", "observations", "diagnostics", "latest", "usage_data_points", "devices"} {
			_, _ = store.Pool.Exec(cleanup, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", organization)
		}
		_, _ = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1`, organization)
		_, _ = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_inputs WHERE event_uuid=ANY($1::uuid[])`, ids)
		_, _ = store.Pool.Exec(cleanup, `DELETE FROM device_runtime.rule_checkpoint`)
	}()

	// The ingest path's hand-off, as it leaves handOn: b.N messages waiting to be stored.
	must(a.ensureCommittedStream())
	must(a.ensureStream(&nats.StreamConfig{Name: telemetryStream, Subjects: []string{"iot.telemetry.>"}, Storage: nats.FileStorage, Retention: nats.LimitsPolicy, MaxAge: 7 * 24 * time.Hour, MaxBytes: 768 << 20, Discard: nats.DiscardNew}))
	base := time.Now().UTC()
	for i := 0; i < b.N; i++ {
		d := fleet[i%len(fleet)]
		at := base.Add(time.Duration(i) * time.Millisecond)
		telemetry := devices.Telemetry{UUID: storage.UUID(), Definition: d, Generation: 1, SessionID: "bench"}
		for j, p := range profile.Parameters {
			value := float64(i)
			if j < 3 {
				value = []float64{51, -114.02, 0}[j]
			}
			telemetry.Readings = append(telemetry.Readings, devices.Reading{ParameterUUID: p.UUID, Key: p.UUID, DataType: "number", Unit: p.Unit, Value: value, Quality: "good", ObservedAt: at, ReceivedAt: at})
		}
		ids = append(ids, telemetry.UUID)
		data, err := json.Marshal(telemetry)
		must(err)
		message := nats.NewMsg("iot.telemetry.device")
		message.Data = data
		message.Header.Set(nats.MsgIdHdr, telemetry.UUID)
		_, err = js.PublishMsg(message)
		must(err)
	}
	until := func(what string, done func() bool) time.Duration {
		b.Helper()
		started := time.Now()
		for !done() {
			if time.Since(started) > 10*time.Minute {
				b.Fatal(what + " did not finish")
			}
			time.Sleep(2 * time.Millisecond)
		}
		return time.Since(started)
	}
	rate := func(elapsed time.Duration) float64 { return float64(b.N) / elapsed.Seconds() }
	b.ResetTimer()

	// 1. The storage consumer: one message at a time, each in one transaction.
	must(a.consume("iot.telemetry.>", storageConsumer, a.storeTelemetry))
	stored := until("storing", func() bool {
		info, err := js.ConsumerInfo(telemetryStream, storageConsumer)
		return err == nil && info.AckFloor.Stream >= uint64(b.N)
	})

	// 2. The committed relay: publish, then mark the row, one event at a time.
	started := time.Now()
	for {
		published, err := a.publishCommittedBatch(ctx)
		must(err)
		if published == 0 {
			break
		}
	}
	relayed := time.Since(started)

	// 3. The automation evaluator: one message, one transaction, a synchronous acknowledgement.
	must(a.startRuleConsumer(ctx))
	evaluated := until("evaluating", func() bool {
		_, sequence, err := store.RuleCheckpoint(context.Background())
		return err == nil && sequence >= uint64(b.N)
	})
	b.StopTimer()
	b.ReportMetric(rate(stored), "stored/s")
	b.ReportMetric(rate(relayed), "relayed/s")
	b.ReportMetric(rate(evaluated), "evaluated/s")
	b.ReportMetric(float64(roundTrip.Microseconds())/1000, "round-trip-ms")
}

// delayedConnection forwards a loopback port to target and holds everything a client
// sends for delay, so each request costs a round trip of that length.
func delayedConnection(target string, delay time.Duration) (string, func(), error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, err
	}
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			server, err := net.Dial("tcp", target)
			if err != nil {
				client.Close()
				continue
			}
			go func() {
				defer client.Close()
				defer server.Close()
				go func() { _, _ = io.Copy(client, server); client.Close() }()
				buffer := make([]byte, 64<<10)
				for {
					n, err := client.Read(buffer)
					if n > 0 {
						time.Sleep(delay)
						if _, e := server.Write(buffer[:n]); e != nil {
							return
						}
					}
					if err != nil {
						return
					}
				}
			}()
		}
	}()
	return listener.Addr().String(), func() { listener.Close() }, nil
}
