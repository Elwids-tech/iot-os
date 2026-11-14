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
		for _, table := range []string{"telemetry_events", "telemetry_outbox", "observations", "diagnostics", "latest", "commands", "devices"} {
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
	// Observations are deleted one day-chunk per batch, including compressed chunks.
	older := old
	older.UUID = UUID()
	older.Readings = append([]devices.Reading(nil), old.Readings...)
	older.Readings[0].ReceivedAt = now.Add(-101 * 24 * time.Hour)
	must(s.Persist(ctx, older))
	_, e = s.Pool.Exec(ctx, "SELECT compress_chunk(c, if_not_compressed => true) FROM show_chunks('device_runtime.observations', older_than => INTERVAL '90 days') c")
	must(e)
	// One batch of one row: one day-chunk of observations and one event row.
	partial, partialErr := s.cleanup(ctx, org, now.Add(-90*24*time.Hour), 1, 1)
	if partial != 2 || !errors.Is(partialErr, ErrCleanupIncomplete) {
		t.Fatalf("expected resumable cleanup backlog, got %d / %v", partial, partialErr)
	}
	deleted, e := s.Cleanup(ctx, org, now.Add(-90*24*time.Hour))
	must(e)
	if deleted != 2 {
		t.Fatalf("wrong cleanup count: %d", deleted)
	}
	must(s.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.telemetry_events WHERE organization_uuid=$1 AND received_at<$2", org, now.Add(-90*24*time.Hour)).Scan(&count))
	if count != 0 {
		t.Fatal("expired event rows survived cleanup")
	}
	must(s.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.observations WHERE organization_uuid=$1", other).Scan(&count))
	if count != 1 {
		t.Fatal("cleanup crossed organization boundary")
	}
	history, e := s.History(ctx, org, d.DeviceUUID, parameter, now.Add(-time.Hour), now.Add(time.Minute), 100, HistoryOptions{})
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
	history, e = s.History(ctx, org, d.DeviceUUID, textParameter, now.Add(-time.Hour), now.Add(time.Minute), 100, HistoryOptions{})
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

// A plant's snapshot is one query: each device's applied configuration wins over an
// earlier one even when the earlier value is newer, a deactivated device keeps its
// newest retained value, a device with nothing retained is absent, and another
// organization's device never appears, however it is named.
func TestLatestBatchPrefersAppliedConfigurationsWithinTheOrganization(t *testing.T) {
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
		for _, table := range []string{"telemetry_events", "telemetry_outbox", "observations", "diagnostics", "latest", "commands", "devices"} {
			if _, e := s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1 OR organization_uuid=$2", org, other); e != nil {
				t.Error(e)
			}
		}
		_, _ = s.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid' IN ($1,$2)", org, other)
	})
	must := func(e error) {
		t.Helper()
		if e != nil {
			t.Fatal(e)
		}
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	reading := func(parameter string, value int, at time.Time) devices.Reading {
		return devices.Reading{ParameterUUID: parameter, DataType: "number", Value: value, Quality: "good", ObservedAt: at, ReceivedAt: at}
	}
	report := func(d devices.Definition, generation int, readings ...devices.Reading) {
		t.Helper()
		must(s.Persist(ctx, devices.Telemetry{Generation: generation, UUID: UUID(), Definition: d, SessionID: "s", Readings: readings}))
	}
	p1, p2 := UUID(), UUID()

	// Device A: two configurations; the applied one, c2, reported p1 earlier than c1 did.
	first := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	must(s.Apply(ctx, first, 1, "device.applied.v1"))
	report(first, 1, reading(p1, 1, now.Add(-20*time.Second)), reading(p2, 2, now.Add(-20*time.Second)))
	applied := first
	applied.ConfigurationUUID = UUID()
	must(s.Apply(ctx, applied, 2, "device.applied.v1"))
	report(applied, 2, reading(p1, 10, now.Add(-30*time.Second)))

	// Device B: reported, then deactivated, so no configuration is preferred.
	deactivated := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	must(s.Apply(ctx, deactivated, 1, "device.applied.v1"))
	report(deactivated, 1, reading(p1, 5, now.Add(-10*time.Second)))
	must(s.Apply(ctx, devices.Definition{DeviceUUID: deactivated.DeviceUUID, OrganizationUUID: org}, 2, "device.deactivated.v1"))

	// Device C never reported; device D belongs to another organization.
	silent := UUID()
	foreign := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: other, ConfigurationUUID: UUID()}
	must(s.Apply(ctx, foreign, 1, "device.applied.v1"))
	report(foreign, 1, reading(p1, 7, now))

	batch, e := s.LatestBatch(ctx, org, []string{applied.DeviceUUID, deactivated.DeviceUUID, silent, foreign.DeviceUUID})
	must(e)
	if len(batch) != 2 {
		t.Fatalf("expected two devices with retained values, got %d: %v", len(batch), batch)
	}
	byParameter := func(carried []CarriedReading) map[string]CarriedReading {
		result := map[string]CarriedReading{}
		for _, c := range carried {
			result[c.Reading.ParameterUUID] = c
		}
		return result
	}
	a := byParameter(batch[applied.DeviceUUID])
	if len(a) != 2 || a[p1].ConfigurationUUID != applied.ConfigurationUUID || a[p1].Reading.Value != json.Number("10") {
		t.Fatalf("the applied configuration's value must win: %+v", a)
	}
	if a[p2].ConfigurationUUID != first.ConfigurationUUID || a[p2].Reading.Value != json.Number("2") {
		t.Fatalf("a parameter only the earlier configuration reported is carried: %+v", a)
	}
	b := byParameter(batch[deactivated.DeviceUUID])
	if len(b) != 1 || b[p1].ConfigurationUUID != deactivated.ConfigurationUUID || b[p1].Reading.Value != json.Number("5") {
		t.Fatalf("a deactivated device keeps its retained value: %+v", b)
	}
	if _, found := batch[silent]; found {
		t.Fatal("a device with nothing retained must be absent")
	}
	if _, found := batch[foreign.DeviceUUID]; found {
		t.Fatal("another organization's device must never appear")
	}
	if _, e = s.LatestBatch(ctx, org, nil); e == nil {
		t.Fatal("an empty batch must be refused")
	}
	many := make([]string, 101)
	for i := range many {
		many[i] = UUID()
	}
	if _, e = s.LatestBatch(ctx, org, many); e == nil {
		t.Fatal("more than 100 devices must be refused")
	}
}
