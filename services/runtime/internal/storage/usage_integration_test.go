package storage

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// usage.data_points.v1 (spec 029 US3, ADR-036): every stored reading counts once per
// organization and UTC hour, and the reporter sends cumulative counts.

func usageCount(t *testing.T, store *Store, organization string) int64 {
	t.Helper()
	var count int64
	if err := store.Pool.QueryRow(t.Context(), "SELECT COALESCE(sum(count),0) FROM device_runtime.usage_data_points WHERE organization_uuid=$1", organization).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func persistCounted(t *testing.T, store *Store, telemetry devices.Telemetry) int64 {
	t.Helper()
	outcome, err := store.PersistResultCounted(t.Context(), telemetry)
	if err != nil || !outcome.Stored {
		t.Fatalf("persist failed: %+v %v", outcome, err)
	}
	return outcome.Readings
}

// usageEvents are the usage events written since a moment, with only the buckets of
// one organization: the reporter covers every organization in the shared test database.
func usageEvents(t *testing.T, store *Store, since time.Time, organization string) []devices.UsageDataPoints {
	t.Helper()
	rows, err := store.Pool.Query(t.Context(), "SELECT event FROM device_runtime.outbox WHERE event->>'type'=$1 AND created_at>=$2 ORDER BY created_at, uuid", UsageEventType, since)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []devices.UsageDataPoints
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(raw, &envelope); err != nil {
			t.Fatal(err)
		}
		contractstest.AssertProduced(t, "usage.data_points.v1", envelope)
		var event devices.Event
		var payload devices.UsageDataPoints
		if err := json.Unmarshal(raw, &event); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		mine := []devices.UsageBucket{}
		for _, bucket := range payload.Buckets {
			if bucket.OrganizationUUID == organization {
				mine = append(mine, bucket)
			}
		}
		payload.Buckets = mine
		result = append(result, payload)
	}
	return result
}

func cleanUsageEvents(t *testing.T, store *Store, since time.Time) {
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(context.Background(), "DELETE FROM device_runtime.outbox WHERE event->>'type'=$1 AND created_at>=$2", UsageEventType, since)
	})
}

func TestStoredReadingsCountOncePerOrganization(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	readings := []devices.Reading{}
	for range 5 {
		readings = append(readings, devices.Reading{ParameterUUID: UUID(), DataType: "number", Value: 1.5, Quality: "good", ObservedAt: now, ReceivedAt: now, TimestampSource: "source"})
	}
	message := devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "usage", Readings: readings}
	if got := persistCounted(t, store, message); got != 5 {
		t.Fatalf("five readings counted %d", got)
	}
	// The same message delivered again stops at the ledger.
	if got := persistCounted(t, store, message); got != 0 {
		t.Fatalf("redelivery counted %d", got)
	}
	// The same source samples under a new telemetry UUID are skipped by the content match.
	message.UUID = UUID()
	if got := persistCounted(t, store, message); got != 0 {
		t.Fatalf("content-match duplicate counted %d", got)
	}
	// A calculated reading and an invalid one (stored as a diagnostic) each count.
	calculated := devices.Reading{ParameterUUID: UUID(), DataType: "number", Value: 3.0, Quality: "good", ObservedAt: now, ReceivedAt: now}
	invalid := devices.Reading{ParameterUUID: UUID(), DataType: "number", Value: "n/a", Quality: "invalid", Diagnostic: "not a number", ObservedAt: now, ReceivedAt: now}
	if got := persistCounted(t, store, devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "usage", Readings: []devices.Reading{calculated, invalid}}); got != 2 {
		t.Fatalf("calculated and invalid readings counted %d", got)
	}
	if got := usageCount(t, store, organization); got != 7 {
		t.Fatalf("bucket count = %d, want 7", got)
	}

	other, _, otherOrganization := historyStore(t)
	second := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: otherOrganization, ConfigurationUUID: UUID()}
	if err := other.Apply(ctx, second, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	persistCounted(t, other, devices.Telemetry{UUID: UUID(), Generation: 1, Definition: second, SessionID: "usage", Readings: []devices.Reading{calculated}})
	if got, gotOther := usageCount(t, store, organization), usageCount(t, other, otherOrganization); got != 7 || gotOther != 1 {
		t.Fatalf("organizations mixed: %d and %d", got, gotOther)
	}
}

func TestUsageReportsAreCumulativeFinalAndNotRepeated(t *testing.T) {
	store, ctx, organization := historyStore(t)
	started := time.Now().UTC().Add(-time.Second)
	cleanUsageEvents(t, store, started)
	now := time.Now().UTC().Truncate(time.Hour).Add(30 * time.Minute)
	closed, current := now.Add(-2*time.Hour).Truncate(time.Hour), now.Truncate(time.Hour)
	if _, err := store.Pool.Exec(ctx, "INSERT INTO device_runtime.usage_data_points(organization_uuid,hour,count) VALUES ($1,$2,10),($1,$3,3)", organization, closed, current); err != nil {
		t.Fatal(err)
	}

	watermark, err := store.ReportUsage(ctx, now, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if !watermark.Equal(current) {
		t.Fatalf("final_through = %s, want %s", watermark, current)
	}
	events := usageEvents(t, store, started, organization)
	if len(events) != 1 || len(events[0].Buckets) != 2 {
		t.Fatalf("first report = %+v", events)
	}
	if b := events[0].Buckets; b[0].Count != 10 || !b[0].Final || b[1].Count != 3 || b[1].Final || !events[0].FinalThrough.Equal(current) {
		t.Fatalf("first report buckets = %+v", b)
	}

	// Nothing changed: nothing is sent again.
	if _, err = store.ReportUsage(ctx, now.Add(time.Minute), watermark); err != nil {
		t.Fatal(err)
	}
	if events = usageEvents(t, store, started, organization); len(events) != 1 {
		t.Fatalf("an unchanged bucket was sent again: %+v", events)
	}

	// More readings in the open hour: the cumulative count, not the increase.
	if _, err = store.Pool.Exec(ctx, "UPDATE device_runtime.usage_data_points SET count=7 WHERE organization_uuid=$1 AND hour=$2", organization, current); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReportUsage(ctx, now.Add(2*time.Minute), watermark); err != nil {
		t.Fatal(err)
	}
	events = usageEvents(t, store, started, organization)
	if last := events[len(events)-1].Buckets; len(last) != 1 || last[0].Count != 7 || last[0].Final {
		t.Fatalf("growing bucket = %+v", last)
	}

	// The hour closes: it is sent once more as final, and the watermark moves on.
	later := now.Add(32 * time.Minute)
	if watermark, err = store.ReportUsage(ctx, later, watermark); err != nil {
		t.Fatal(err)
	}
	events = usageEvents(t, store, started, organization)
	if last := events[len(events)-1]; len(last.Buckets) != 1 || last.Buckets[0].Count != 7 || !last.Buckets[0].Final || !last.FinalThrough.Equal(current.Add(time.Hour)) {
		t.Fatalf("closed hour = %+v", last)
	}
	sent := len(events)
	if _, err = store.ReportUsage(ctx, later.Add(time.Minute), watermark); err != nil {
		t.Fatal(err)
	}
	if events = usageEvents(t, store, started, organization); len(events) != sent {
		t.Fatalf("a final bucket was sent again: %d events, want %d", len(events), sent)
	}
	var reported int64
	var final bool
	if err = store.Pool.QueryRow(ctx, "SELECT reported_count, reported_final FROM device_runtime.usage_data_points WHERE organization_uuid=$1 AND hour=$2", organization, current).Scan(&reported, &final); err != nil || reported != 7 || !final {
		t.Fatalf("reported state = %d %v %v", reported, final, err)
	}

	// An hour with no traffic at all still advances final_through, once.
	quiet := later.Add(time.Hour)
	if watermark, err = store.ReportUsage(ctx, quiet, watermark); err != nil {
		t.Fatal(err)
	}
	if !watermark.Equal(current.Add(2 * time.Hour)) {
		t.Fatalf("quiet final_through = %s", watermark)
	}
	advanced := 0
	rows, err := store.Pool.Query(ctx, "SELECT event FROM device_runtime.outbox WHERE event->>'type'=$1 AND created_at>=$2 AND event->'payload'->>'final_through'=$3", UsageEventType, started, watermark.Format(time.RFC3339))
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		advanced++
	}
	rows.Close()
	if advanced == 0 {
		t.Fatal("no event carried the new final_through")
	}
}

func TestReplayedReportsHaveTheSameID(t *testing.T) {
	hour := time.Date(2026, 11, 7, 19, 0, 0, 0, time.UTC)
	buckets := []devices.UsageBucket{{OrganizationUUID: "29000000-0000-4000-8000-000000000001", Hour: hour, Count: 118004, Final: true}}
	first, err := UsageEventUUID(hour.Add(time.Hour), buckets)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := UsageEventUUID(hour.Add(time.Hour), buckets)
	buckets[0].Count++
	changed, _ := UsageEventUUID(hour.Add(time.Hour), buckets)
	if first != second || first == changed {
		t.Fatalf("ids %s %s %s", first, second, changed)
	}
}

func TestUsageBucketsArePrunedAfterFortyDays(t *testing.T) {
	store, ctx, organization := historyStore(t)
	now := time.Now().UTC().Truncate(time.Hour)
	if _, err := store.Pool.Exec(ctx, "INSERT INTO device_runtime.usage_data_points(organization_uuid,hour,count) VALUES ($1,$2,1),($1,$3,1)", organization, now.Add(-41*24*time.Hour), now.Add(-39*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PruneUsage(ctx, now); err != nil {
		t.Fatal(err)
	}
	if got := usageCount(t, store, organization); got != 1 {
		t.Fatalf("after pruning %d buckets remain counted, want 1", got)
	}
}

// A runtime restart loses only the reporter's memory of what it last sent: the next
// report reads its watermark from the outbox and carries cumulative counts, and a
// message the broker delivers again after the restart is not counted (spec 029 SC-002).
func TestCountsStayExactAcrossARestart(t *testing.T) {
	store, ctx, organization := historyStore(t)
	started := time.Now().UTC().Add(-time.Second)
	cleanUsageEvents(t, store, started)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	message := func(readings int) devices.Telemetry {
		now := time.Now().UTC()
		values := []devices.Reading{}
		for range readings {
			values = append(values, devices.Reading{ParameterUUID: UUID(), DataType: "number", Value: 1.5, Quality: "good", ObservedAt: now, ReceivedAt: now})
		}
		return devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "restart", Readings: values}
	}

	first := message(3)
	persistCounted(t, store, first)
	if _, err := store.ReportUsage(ctx, time.Now().UTC(), time.Time{}); err != nil {
		t.Fatal(err)
	}

	// A new process opens the same database; its reporter remembers nothing.
	restarted, err := Open(ctx, os.Getenv("DEVICE_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restarted.Pool.Close)
	if outcome, err := restarted.PersistResultCounted(ctx, first); err != nil || outcome.Readings != 0 {
		t.Fatalf("a message delivered again after the restart counted %d (%v)", outcome.Readings, err)
	}
	persistCounted(t, restarted, message(4))
	if _, err := restarted.ReportUsage(ctx, time.Now().UTC().Add(time.Second), time.Time{}); err != nil {
		t.Fatal(err)
	}

	// Reports are cumulative per hour: the highest count of each hour is the usage.
	highest := map[time.Time]int64{}
	for _, event := range usageEvents(t, store, started, organization) {
		for _, bucket := range event.Buckets {
			highest[bucket.Hour] = max(highest[bucket.Hour], bucket.Count)
		}
	}
	var reported int64
	for _, count := range highest {
		reported += count
	}
	if reported != 7 || usageCount(t, store, organization) != 7 {
		t.Fatalf("reported %d and stored %d, want 7 and 7", reported, usageCount(t, store, organization))
	}
}

// With nothing to report, the reporter still writes an empty event every two minutes,
// each with its own id, so a quiet deployment's counts do not read as late (spec 029
// FR-014).
func TestAQuietReporterStillReportsEveryTwoMinutes(t *testing.T) {
	store, ctx, organization := historyStore(t)
	started := time.Now().UTC().Add(-time.Second)
	cleanUsageEvents(t, store, started)
	// Mid-hour, so the steps below never close an hour and write a real report.
	now := time.Now().UTC().Truncate(time.Hour).Add(30 * time.Minute)
	if _, err := store.Pool.Exec(ctx, "INSERT INTO device_runtime.usage_data_points(organization_uuid,hour,count) VALUES ($1,$2,4)", organization, now.Truncate(time.Hour)); err != nil {
		t.Fatal(err)
	}
	watermark, err := store.ReportUsage(ctx, now, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	count := func() int { return len(usageEvents(t, store, started, organization)) }
	reported := count()

	// A minute later nothing changed and the last report is recent: nothing is written.
	if _, err := store.ReportUsage(ctx, now.Add(time.Minute), watermark); err != nil || count() != reported {
		t.Fatalf("wrote %d events a minute later (%v)", count()-reported, err)
	}
	// Three minutes later: one empty event.
	if _, err := store.ReportUsage(ctx, now.Add(3*time.Minute), watermark); err != nil || count() != reported+1 {
		t.Fatalf("wrote %d events three minutes later (%v)", count()-reported, err)
	}
	events := usageEvents(t, store, started, organization)
	if heartbeat := events[len(events)-1]; len(heartbeat.Buckets) != 0 || !heartbeat.FinalThrough.Equal(watermark) {
		t.Fatalf("heartbeat = %+v", heartbeat)
	}
	// It counts from the event it just wrote, whose own id never collides with the next.
	if _, err := store.ReportUsage(ctx, now.Add(3*time.Minute+30*time.Second), watermark); err != nil || count() != reported+1 {
		t.Fatalf("wrote %d events right after a heartbeat (%v)", count()-reported-1, err)
	}
}

// A pass with more buckets than one event carries moves the watermark only in its last
// event, and each event gets its own time, so the relay sends that one last (ADR-036).
func TestOnlyAPassesLastEventMovesTheWatermark(t *testing.T) {
	store, ctx, _ := historyStore(t)
	started := time.Now().UTC().Add(-time.Second)
	cleanUsageEvents(t, store, started)
	now := time.Now().UTC().Truncate(time.Hour).Add(30 * time.Minute)
	closed, previous := now.Add(-2*time.Hour).Truncate(time.Hour), now.Add(-3*time.Hour).Truncate(time.Hour)
	organizations := make([]string, usageBatch+1)
	for i := range organizations {
		organizations[i] = UUID()
	}
	if _, err := store.Pool.Exec(ctx, "INSERT INTO device_runtime.usage_data_points(organization_uuid,hour,count) SELECT o,$2,1 FROM unnest($1::uuid[]) AS o", organizations, closed); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(context.Background(), "DELETE FROM device_runtime.usage_data_points WHERE organization_uuid=ANY($1::uuid[])", organizations)
	})

	watermark, err := store.ReportUsage(ctx, now, previous)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := store.Pool.Query(ctx, "SELECT (event->'payload'->>'final_through')::timestamptz, created_at FROM device_runtime.outbox WHERE event->>'type'=$1 AND created_at>=$2 ORDER BY created_at", UsageEventType, started)
	if err != nil {
		t.Fatal(err)
	}
	type written struct{ finalThrough, createdAt time.Time }
	var events []written
	for rows.Next() {
		var event written
		if err := rows.Scan(&event.finalThrough, &event.createdAt); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("%d buckets went out in %d events", len(organizations), len(events))
	}
	for i, event := range events {
		want := previous
		if i == len(events)-1 {
			want = watermark
		}
		if !event.finalThrough.Equal(want) {
			t.Fatalf("event %d of %d carries %s, want %s", i+1, len(events), event.finalThrough, want)
		}
		if i > 0 && !event.createdAt.After(events[i-1].createdAt) {
			t.Fatalf("events %d and %d share a time", i, i+1)
		}
	}

	// A restarted reporter reads the furthest watermark, not whichever event came first.
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if got, err := lastUsageWatermark(ctx, tx); err != nil || !got.Equal(watermark) {
		t.Fatalf("restart reads %s (%v), want %s", got, err, watermark)
	}
}
