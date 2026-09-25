package storage

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func TestDurableStorageRetentionAndCommandRecovery(t *testing.T) {
	url := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("Requires the isolated Devices database")
	}
	if !strings.Contains(url, "/iot_devices_test?") {
		t.Fatal("Refusing a non-test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Pool.Close)
	org, other := UUID(), UUID()
	t.Cleanup(func() {
		for _, table := range []string{"telemetry_outbox", "observations", "diagnostics", "latest", "commands", "devices"} {
			if _, e := s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1 OR organization_uuid=$2", org, other); e != nil {
				t.Error(e)
			}
		}
		_, _ = s.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid' IN ($1,$2)", org, other)
	})
	d := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	parameter := UUID()
	now := time.Now().UTC().Truncate(time.Microsecond)
	reading := devices.Reading{ParameterUUID: parameter, DataType: "number", Value: 230, Quality: "good", ObservedAt: now, ReceivedAt: now}
	packet := devices.Telemetry{Generation: 1, UUID: UUID(), Definition: d, SessionID: "first", Readings: []devices.Reading{reading}}
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	must(s.Apply(ctx, d, 1, "device.applied.v1"))
	must(s.Persist(ctx, packet))
	must(s.Persist(ctx, packet))
	var count int
	must(s.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.observations WHERE device_uuid=$1", d.DeviceUUID).Scan(&count))
	if count != 1 {
		t.Fatal("redelivery duplicated telemetry")
	}
	invalid := packet
	invalid.UUID = UUID()
	invalid.Readings = append([]devices.Reading(nil), packet.Readings...)
	invalid.Readings[0].Value = nil
	invalid.Readings[0].Quality = "invalid"
	invalid.Readings[0].ReceivedAt = now.Add(time.Second)
	must(s.Persist(ctx, invalid))
	latest, e := s.Latest(ctx, org, d.DeviceUUID, d.ConfigurationUUID)
	must(e)
	if len(latest) != 1 || latest[0].Quality != "invalid" || latest[0].Value != json.Number("230") {
		t.Fatalf("last valid value not retained: %+v", latest)
	}
	if latest[0].LastValidReceivedAt == nil || !latest[0].LastValidReceivedAt.Equal(now) {
		t.Fatalf("last valid receipt not retained: %+v", latest)
	}
	// A delayed older observation cannot replace a newer diagnostic or its last valid value.
	must(s.Persist(ctx, packet))
	latest, e = s.Latest(ctx, org, d.DeviceUUID, d.ConfigurationUUID)
	must(e)
	if latest[0].Quality != "invalid" {
		t.Fatal("redelivery overwrote current quality")
	}
	old := packet
	old.UUID = UUID()
	old.Readings = append([]devices.Reading(nil), packet.Readings...)
	old.Readings[0].ReceivedAt = now.Add(-100 * 24 * time.Hour)
	old.Readings[0].ObservedAt = now // retention trusts receipt, not device clock
	must(s.Persist(ctx, old))
	foreign := old
	foreign.UUID = UUID()
	foreign.Definition.OrganizationUUID = other
	foreign.Definition.DeviceUUID = UUID()
	must(s.Apply(ctx, foreign.Definition, 1, "device.applied.v1"))
	must(s.Persist(ctx, foreign))
	// A bounded pass must report backlog, remain tenant scoped, and resume safely.
	older := old
	older.UUID = UUID()
	must(s.Persist(ctx, older))
	partial, partialErr := s.cleanup(ctx, org, now.Add(-90*24*time.Hour), 1, 1)
	if partial != 1 || !errors.Is(partialErr, ErrCleanupIncomplete) {
		t.Fatalf("expected resumable cleanup backlog, got %d / %v", partial, partialErr)
	}
	deleted, e := s.Cleanup(ctx, org, now.Add(-90*24*time.Hour))
	must(e)
	if deleted != 1 {
		t.Fatalf("wrong cleanup count: %d", deleted)
	}
	must(s.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.observations WHERE organization_uuid=$1", other).Scan(&count))
	if count != 1 {
		t.Fatal("cleanup crossed organization boundary")
	}
	history, e := s.History(ctx, org, d.DeviceUUID, parameter, now.Add(-time.Hour), now.Add(time.Minute), 100)
	must(e)
	if len(history) != 1 || len(history[0].Points) != 1 {
		t.Fatal(history)
	}
	// Nonnumeric changes in one second must remain separate timestamped events.
	textParameter := UUID()
	for i, value := range []string{"red", "blue", "green"} {
		text := packet
		text.UUID = UUID()
		text.Readings = []devices.Reading{{ParameterUUID: textParameter, DataType: "string", Value: value, Quality: "good", ObservedAt: now, ReceivedAt: now.Add(time.Duration(i) * time.Millisecond)}}
		must(s.Persist(ctx, text))
	}
	history, e = s.History(ctx, org, d.DeviceUUID, textParameter, now.Add(-time.Hour), now.Add(time.Minute), 100)
	must(e)
	if len(history) != 1 || len(history[0].Points) != 3 {
		t.Fatal("nonnumeric events were bucketed", history)
	}
	command := devices.Command{UUID: UUID(), OrganizationUUID: org, DeviceUUID: d.DeviceUUID, ParameterUUID: parameter, ConfigurationUUID: d.ConfigurationUUID, ExpiresAt: now.Add(30 * time.Second)}
	claimed, e := s.ClaimCommand(ctx, command)
	must(e)
	if !claimed {
		t.Fatal("command was not claimed")
	}
	claimed, e = s.ClaimCommand(ctx, command)
	must(e)
	if claimed {
		t.Fatal("command was claimed twice")
	}
	must(s.CommandStatus(ctx, command, "observed", "matched", &now))
	must(s.CommandStatus(ctx, command, "sent", "late acknowledgement", &now))
	must(s.CommandStatus(ctx, command, "timed_out", "late expiry", nil))
	var status string
	must(s.Pool.QueryRow(ctx, "SELECT status FROM device_runtime.commands WHERE command_uuid=$1", command.UUID).Scan(&status))
	if status != "observed" {
		t.Fatal("terminal command state regressed", status)
	}
	command.UUID = UUID()
	claimed, e = s.ClaimCommand(ctx, command)
	must(e)
	must(s.RecoverCommands(ctx))
	must(s.Pool.QueryRow(ctx, "SELECT status FROM device_runtime.commands WHERE command_uuid=$1", command.UUID).Scan(&status))
	if status != "uncertain" {
		t.Fatal("restart did not mark ambiguous dispatch uncertain")
	}
	claimed, e = s.ClaimCommand(ctx, command)
	must(e)
	if claimed {
		t.Fatal("restart allowed a command replay")
	}
}
