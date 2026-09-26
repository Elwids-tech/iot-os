package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func historyStore(t *testing.T) (*Store, context.Context, string) {
	t.Helper()
	databaseURL := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("Requires isolated Devices database")
	}
	if !strings.Contains(databaseURL, "/iot_devices_test?") {
		t.Fatal("Refusing non-test database")
	}
	ctx := context.Background()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	organization := UUID()
	t.Cleanup(func() {
		for _, table := range []string{"telemetry_outbox", "observations", "diagnostics", "latest", "commands", "devices"} {
			_, _ = store.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", organization)
		}
		_, _ = store.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid'=$1", organization)
		store.Pool.Close()
	})
	return store, ctx, organization
}

func TestHistoryRecordsUsesStableLimitedKeysetPagination(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	parameter := UUID()
	receivedAt := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	events := []string{
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
		"10000000-0000-4000-8000-000000000003",
		"10000000-0000-4000-8000-000000000004",
		"10000000-0000-4000-8000-000000000005",
	}
	for index, eventUUID := range events {
		packet := devices.Telemetry{
			UUID: eventUUID, Generation: 1, Definition: definition, SessionID: "history",
			Readings: []devices.Reading{{
				ParameterUUID: parameter, DataType: "integer", Value: index,
				Quality: "good", ObservedAt: receivedAt, ReceivedAt: receivedAt, TimestampSource: "source", Historical: true,
			}},
		}
		if err := store.Persist(ctx, packet); err != nil {
			t.Fatal(err)
		}
	}

	latest, err := store.LatestCommittedEvent(ctx, organization, definition.DeviceUUID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil || latest == nil || latest.EventID != events[len(events)-1] {
		t.Fatal("latest committed identity lost", err)
	}
	foreignLatest, err := store.LatestCommittedEvent(ctx, UUID(), definition.DeviceUUID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil || foreignLatest != nil {
		t.Fatal("latest crossed tenant", err)
	}
	// A newer incomplete/invalid event must replace the earlier good evidence.
	invalidID := UUID()
	invalid := devices.Telemetry{UUID: invalidID, Generation: 1, Definition: definition, SessionID: "history", Readings: []devices.Reading{{ParameterUUID: UUID(), DataType: "number", Quality: "invalid", ReceivedAt: receivedAt, ObservedAt: receivedAt}}}
	if err := store.Persist(ctx, invalid); err != nil {
		t.Fatal(err)
	}
	latest, err = store.LatestCommittedEvent(ctx, organization, definition.DeviceUUID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil || latest == nil || latest.EventID != invalidID {
		t.Fatal("invalid newest event was hidden", err)
	}
	from, to := receivedAt.Add(-time.Minute), receivedAt.Add(time.Minute)
	first, err := store.HistoryRecords(ctx, organization, definition.DeviceUUID, parameter, from, to, 3, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Records) != 2 || first.Next == nil || first.Consumed != 2 || first.LimitReached {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Records[0].TimestampSource != "source" || !first.Records[0].Historical {
		t.Fatal("raw provenance lost")
	}
	committed, err := store.CommittedEvent(ctx, organization, definition.DeviceUUID, events[0], time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil || committed == nil || committed.Sequence == "" || committed.Readings[0].ParameterUUID != parameter {
		t.Fatalf("stored event unavailable: %v %v", committed, err)
	}
	for _, scope := range [][2]string{{UUID(), definition.DeviceUUID}, {organization, UUID()}} {
		hidden, err := store.CommittedEvent(ctx, scope[0], scope[1], events[0], time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
		if err != nil || hidden != nil {
			t.Fatal("stored event crossed scope", err)
		}
	}
	expired, err := store.CommittedEvent(ctx, organization, definition.DeviceUUID, events[0], time.Now().Add(time.Minute), time.Now().Add(time.Hour))
	if err != nil || expired != nil {
		t.Fatal("stored event crossed retention", err)
	}
	second, err := store.HistoryRecords(ctx, organization, definition.DeviceUUID, parameter, from, to, 3, 2, first.Next)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Records) != 1 || second.Next != nil || second.Consumed != 3 || !second.LimitReached {
		t.Fatalf("total limit was not enforced: %#v", second)
	}
	got := []string{first.Records[0].EventUUID, first.Records[1].EventUUID, second.Records[0].EventUUID}
	want := []string{events[4], events[3], events[2]}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("equal timestamps duplicated, skipped, or reordered: got %v want %v", got, want)
		}
	}
	foreign, err := store.HistoryRecords(ctx, UUID(), definition.DeviceUUID, parameter, from, to, 10, 10, nil)
	if err != nil || len(foreign.Records) != 0 {
		t.Fatalf("history crossed the organization boundary: %#v / %v", foreign, err)
	}
}

func TestStateHistoryCarriesAndCollapsesReports(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	parameter := UUID()
	from := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	for index, report := range []struct {
		at    time.Time
		value bool
	}{
		{from.Add(-time.Minute), true},
		{from.Add(time.Minute), true},
		{from.Add(2 * time.Minute), false},
	} {
		packet := devices.Telemetry{
			UUID: UUID(), Generation: 1, Definition: definition, SessionID: "states",
			Readings: []devices.Reading{{
				ParameterUUID: parameter, DataType: "boolean", Value: report.value,
				Quality: "good", ObservedAt: report.at, ReceivedAt: report.at,
			}},
		}
		if err := store.Persist(ctx, packet); err != nil {
			t.Fatalf("persist state %d: %v", index, err)
		}
	}

	history, err := store.StateHistory(ctx, organization, definition.DeviceUUID, parameter, from, from.Add(5*time.Minute), 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Timeline) != 2 || history.Sampled {
		t.Fatalf("repeated report was not collapsed: %#v", history)
	}
	if history.Timeline[0].Value != true || !history.Timeline[0].From.Equal(from) || !history.Timeline[0].To.Equal(from.Add(2*time.Minute)) {
		t.Fatalf("carry-in state is incorrect: %#v", history.Timeline[0])
	}
	if history.Timeline[1].Value != false || !history.Timeline[1].To.Equal(from.Add(5*time.Minute)) {
		t.Fatalf("final state was not extended: %#v", history.Timeline[1])
	}
}
