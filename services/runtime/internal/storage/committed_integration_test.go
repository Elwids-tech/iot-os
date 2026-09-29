package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestCommittedTelemetryAtomicityAndIdentity(t *testing.T) {
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
	org, other := UUID(), UUID()
	defer func() {
		for _, table := range []string{"telemetry_outbox", "observations", "diagnostics", "latest", "devices"} {
			_, err := s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid IN ($1,$2)", org, other)
			must(err)
		}
		_, err := s.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid' IN ($1,$2)", org, other)
		must(err)
	}()
	d := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	must(s.Apply(ctx, d, 1, "device.applied.v1"))
	now := time.Now().UTC().Truncate(time.Microsecond)
	packet := devices.Telemetry{UUID: UUID(), Definition: d, Generation: 1, Readings: []devices.Reading{{ParameterUUID: UUID(), Key: "position.latitude", DataType: "number", Value: 51, Quality: "good", ObservedAt: now, ReceivedAt: now}}}
	count := func(table, id string) int {
		t.Helper()
		var n int
		column := "event_uuid"
		if table == "telemetry_outbox" {
			column = "telemetry_uuid"
		}
		must(s.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime."+table+" WHERE "+column+"=$1", id).Scan(&n))
		return n
	}
	stored, err := s.PersistResult(ctx, packet)
	must(err)
	if !stored {
		t.Fatal("accepted transaction reported as discarded")
	}
	stored, err = s.PersistResult(ctx, packet)
	must(err)
	if !stored {
		t.Fatal("committed duplicate lost storage evidence")
	}
	if count("telemetry_outbox", packet.UUID) != 1 || count("observations", packet.UUID) != 1 {
		t.Fatal("duplicate committed input")
	}
	must(s.AckCommitted(ctx, packet.UUID))
	must(s.Persist(ctx, packet))
	if count("telemetry_outbox", packet.UUID) != 1 {
		t.Fatal("published ledger lost deduplication")
	}
	// Invalid SQL on the second reading must roll back the first reading AND outbox.
	broken := packet
	broken.UUID = UUID()
	broken.Readings = append([]devices.Reading(nil), packet.Readings...)
	bad := packet.Readings[0]
	bad.ParameterUUID = "not-a-uuid"
	broken.Readings = append(broken.Readings, bad)
	if s.Persist(ctx, broken) == nil {
		t.Fatal("expected transaction failure")
	}
	if count("telemetry_outbox", broken.UUID) != 0 || count("observations", broken.UUID) != 0 {
		t.Fatal("partial commit escaped rollback")
	}
	for _, kind := range []string{"generation", "configuration", "tenant", "empty"} {
		p := packet
		p.UUID = UUID()
		switch kind {
		case "generation":
			p.Generation = 0
		case "configuration":
			p.Definition.ConfigurationUUID = UUID()
		case "tenant":
			p.Definition.OrganizationUUID = other
		case "empty":
			p.Readings = nil
		}
		accepted, err := s.PersistResult(ctx, p)
		must(err)
		if accepted {
			t.Fatal("no-op claimed stored", kind)
		}
		if count("telemetry_outbox", p.UUID) != 0 {
			t.Fatal("no-op emitted event", kind)
		}
	}
	invalid := packet
	invalid.UUID = UUID()
	invalid.Readings = append([]devices.Reading(nil), packet.Readings...)
	invalid.Readings[0].Quality = "invalid"
	invalid.Readings[0].Value = -1
	invalid.Readings[0].ReceivedAt = now.Add(time.Second)
	must(s.Persist(ctx, invalid))
	history := packet
	history.UUID = UUID()
	history.Readings = append([]devices.Reading(nil), packet.Readings...)
	history.Readings[0].Historical = true
	must(s.Persist(ctx, history))
	foreign := packet
	foreign.UUID = UUID()
	foreign.Definition = devices.Definition{DeviceUUID: UUID(), OrganizationUUID: other, ConfigurationUUID: UUID()}
	must(s.Apply(ctx, foreign.Definition, 1, "device.applied.v1"))
	must(s.Persist(ctx, foreign))
	events, err := s.CommittedPending(ctx)
	must(err)
	found := map[string]devices.CommittedTelemetry{}
	for _, e := range events {
		found[e.EventID] = e
	}
	if e := found[invalid.UUID]; len(e.Readings) != 1 || e.Readings[0].Quality != "invalid" || e.Readings[0].Value == nil {
		t.Fatal("diagnostic lost", e)
	}
	if !found[history.UUID].Readings[0].Historical {
		t.Fatal("historical classification lost")
	}
	if found[foreign.UUID].OrganizationUUID != other || found[history.UUID].OrganizationUUID != org {
		t.Fatal("tenant identity crossed")
	}
	backlog, err := s.CommittedBacklog(ctx)
	must(err)
	if backlog.Pending < 3 || backlog.OldestAgeSeconds < 0 {
		t.Fatal("invalid backlog", backlog)
	}
	// Schema setup is additive and safe on a subsequent runtime startup.
	reopened, err := Open(ctx, url)
	must(err)
	reopened.Pool.Close()
}
