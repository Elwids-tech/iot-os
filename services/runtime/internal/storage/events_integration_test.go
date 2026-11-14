package storage

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// publishedEvent is the event the outbox holds for a message: what the committed
// stream carried, with readings in parameter order like a rebuilt event.
func publishedEvent(t *testing.T, s *Store, id string) devices.CommittedTelemetry {
	t.Helper()
	var raw []byte
	var sequence int64
	if err := s.Pool.QueryRow(t.Context(), `SELECT sequence,event FROM device_runtime.telemetry_outbox WHERE telemetry_uuid=$1`, id).Scan(&sequence, &raw); err != nil {
		t.Fatal(err)
	}
	var event devices.CommittedTelemetry
	if err := Decode(raw, &event); err != nil {
		t.Fatal(err)
	}
	event.Sequence = json.Number(jsonInt(sequence)).String()
	sort.Slice(event.Readings, func(a, b int) bool { return event.Readings[a].ParameterUUID < event.Readings[b].ParameterUUID })
	return event
}

func jsonInt(value int64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func sameEvent(t *testing.T, what string, got *devices.CommittedTelemetry, want devices.CommittedTelemetry) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: event not found", what)
	}
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if string(a) != string(b) {
		t.Fatalf("%s: rebuilt event differs from the published one\n got %s\nwant %s", what, a, b)
	}
}

// ADR-042: a reading is stored once and an event is rebuilt from it. The rebuilt
// event must be the event that was published, for a good reading, an invalid one
// and a re-sent sample, and it must outlive its outbox row.
func TestStoredEventsAreRebuiltFromTheirReadings(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 3, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	latitude, longitude, battery := UUID(), UUID(), UUID()
	unit := "deg"
	// Nanoseconds that round up to the next microsecond: the database keeps
	// microseconds, and a published event keeps the nanoseconds.
	received := time.Now().UTC().Add(-10 * time.Minute).Truncate(time.Second).Add(123456789 * time.Nanosecond)
	observed := received.Add(-2 * time.Second)
	reading := func(parameter, key string, value any, quality string) devices.Reading {
		return devices.Reading{ParameterUUID: parameter, Key: key, Label: key, DataType: "number", Unit: &unit, Value: value,
			Quality: quality, ObservedAt: observed, ReceivedAt: received, TimestampSource: "source"}
	}
	first := devices.Telemetry{UUID: UUID(), Generation: 3, Definition: definition, SessionID: "events", Readings: []devices.Reading{
		reading(latitude, "lat", 6.9, "good"), reading(longitude, "lon", 79.8, "good"),
	}}
	first.Readings = append(first.Readings, devices.Reading{ParameterUUID: battery, Key: "battery", Label: "battery", DataType: "number",
		Quality: "invalid", Diagnostic: "source reported null value", ObservedAt: observed, ReceivedAt: received, TimestampSource: "source"})
	if err := store.Persist(ctx, first); err != nil {
		t.Fatal(err)
	}
	from, until := received.Add(-time.Hour), time.Now().Add(time.Minute)
	got, err := store.CommittedEvent(ctx, organization, definition.DeviceUUID, first.UUID, from, until)
	if err != nil {
		t.Fatal(err)
	}
	sameEvent(t, "good and invalid readings", got, publishedEvent(t, store, first.UUID))

	// The device reconnects and sends the same buffered sample again, under a new
	// message ID and a later receipt. Nothing new is stored for it.
	resent := first
	resent.UUID = UUID()
	resent.Readings = []devices.Reading{reading(latitude, "lat", 6.9, "good"), reading(longitude, "lon", 79.8, "good")}
	for i := range resent.Readings {
		resent.Readings[i].ReceivedAt = received.Add(time.Minute)
		resent.Readings[i].Historical = true // sent again as buffered history
	}
	outcome, err := store.PersistResultCounted(ctx, resent)
	if err != nil || !outcome.Stored || outcome.Readings != 0 {
		t.Fatalf("re-sent sample was stored again: %+v %v", outcome, err)
	}
	got, err = store.CommittedEvent(ctx, organization, definition.DeviceUUID, resent.UUID, from, until)
	if err != nil {
		t.Fatal(err)
	}
	sameEvent(t, "re-sent sample", got, publishedEvent(t, store, resent.UUID))
	latest, err := store.LatestCommittedEvent(ctx, organization, definition.DeviceUUID, from, until)
	if err != nil || latest == nil || latest.EventID != resent.UUID {
		t.Fatalf("the re-sent message is the device's newest event: %v %v", latest, err)
	}

	// Past the ledger window the outbox rows go; the events stay for the retention.
	want := []devices.CommittedTelemetry{publishedEvent(t, store, first.UUID), publishedEvent(t, store, resent.UUID)}
	if _, err = store.Pool.Exec(ctx, `UPDATE device_runtime.telemetry_outbox SET created_at=now()-interval '9 days', published_at=now()-interval '9 days' WHERE organization_uuid=$1`, organization); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Cleanup(ctx, organization, time.Now().UTC().Add(-400*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var left int
	if err = store.Pool.QueryRow(ctx, `SELECT count(*) FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1`, organization).Scan(&left); err != nil || left != 0 {
		t.Fatalf("outbox rows past the ledger window were kept: %d %v", left, err)
	}
	events, sampled, err := store.CommittedEvents(ctx, organization, definition.DeviceUUID, from, until, 10)
	if err != nil || sampled || len(events) != 2 {
		t.Fatalf("events lost with their outbox rows: %d %v %v", len(events), sampled, err)
	}
	for i := range events {
		sameEvent(t, "after the outbox row is pruned", &events[i], want[i])
	}

	// The measurement retention ends an event: its row and its readings go together.
	if _, err = store.Cleanup(ctx, organization, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if gone, err := store.CommittedEvent(ctx, organization, definition.DeviceUUID, first.UUID, from, until); err != nil || gone != nil {
		t.Fatalf("an expired event is still readable: %v %v", gone, err)
	}
}

// An upgrade finds events only in the outbox. Opening the store gives each one its
// event row, once, so location trails survive the upgrade.
func TestOutboxEventsFromBeforeEventRowsAreBackfilled(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	// The outbox event holds nanoseconds; the copy must land on the reading's row.
	received := time.Now().UTC().Add(-time.Minute).Truncate(time.Second).Add(987654999 * time.Nanosecond)
	packet := devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "upgrade", Readings: []devices.Reading{
		{ParameterUUID: UUID(), Key: "level", DataType: "number", Value: 4, Quality: "good", ObservedAt: received, ReceivedAt: received},
	}}
	if err := store.Persist(ctx, packet); err != nil {
		t.Fatal(err)
	}
	want := publishedEvent(t, store, packet.UUID)
	// As the previous runtime left it: the outbox row and the reading, no event row.
	// The backfill copies sequences above the newest event row, so clear them all.
	if _, err := store.Pool.Exec(ctx, `DELETE FROM device_runtime.telemetry_events WHERE sequence >= (SELECT sequence FROM device_runtime.telemetry_outbox WHERE telemetry_uuid=$1)`, packet.UUID); err != nil {
		t.Fatal(err)
	}
	upgraded, err := Open(ctx, os.Getenv("DEVICE_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Pool.Close()
	got, err := upgraded.CommittedEvent(ctx, organization, definition.DeviceUUID, packet.UUID, received.Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	sameEvent(t, "backfilled event", got, want)
}
