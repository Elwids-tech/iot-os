package storage

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/contracts/contractstest"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// connectivityStore is historyStore plus the organization's connectivity rows.
func connectivityStore(t *testing.T) (*Store, string) {
	t.Helper()
	store, ctx, organization := historyStore(t)
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(ctx, "DELETE FROM device_runtime.connectivity WHERE organization_uuid=$1", organization)
	})
	return store, organization
}

func TestConnectivityTransitionsCommitTheirRowAndEventTogetherOnce(t *testing.T) {
	store, organization := connectivityStore(t)
	ctx := t.Context()
	device := UUID()
	key := "device:" + device
	since := time.Date(2026, 10, 25, 14, 2, 11, 0, time.UTC)
	opened := since.Add(2 * time.Minute)
	row := ConnectivityRow{SubjectKey: key, OrganizationUUID: organization, Kind: "device", MonitoringSince: since.Add(-time.Hour), HeardSinceMonitoring: true, Episode: 1, Open: true, OfflineSince: &since, OpenedAt: &opened, Cause: "death_certificate", AffectedDeviceUUIDs: []string{device}}
	payload, _ := json.Marshal(map[string]any{"organization_uuid": organization, "subject": map[string]any{"kind": "device", "device_uuid": device, "connection_uuid": nil, "edge_node_id": nil, "adapter_uuid": nil}, "episode": 1, "transition": "opened", "cause": "death_certificate", "offline_since": since, "at": opened, "last_heard_at": since, "last_observed_at": nil, "offline_after_seconds": nil, "offline_after_automatic": true, "reporting_interval_seconds": nil, "poll_interval_seconds": nil, "grace_seconds": 120, "settings_generation": 0, "affected_device_uuids": []string{device}, "stop_reason": nil})
	ev := devices.Event{UUID: ConnectivityEventUUID(key, 1, "opened"), Type: "device.connectivity.v1", Payload: payload}
	var envelope map[string]any
	raw, _ := json.Marshal(ev)
	_ = json.Unmarshal(raw, &envelope)
	contractstest.AssertProduced(t, "device.connectivity.v1", envelope)

	inserted, err := store.TransitionConnectivity(ctx, row, ev)
	if err != nil || !inserted {
		t.Fatalf("transition: %v %v", inserted, err)
	}
	if ev.UUID != UUIDv5(connectivityNamespace, key+"#1#opened") {
		t.Fatal("the event id is not the UUID v5 of subject, episode and transition")
	}
	// Storing the same transition again adds no second event.
	if inserted, err = store.TransitionConnectivity(ctx, row, ev); err != nil || inserted {
		t.Fatalf("replay: %v %v", inserted, err)
	}
	var events int
	if err = store.Pool.QueryRow(ctx, "SELECT count(*) FROM device_runtime.outbox WHERE uuid=$1 AND event->>'type'='device.connectivity.v1'", ev.UUID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("events %d %v", events, err)
	}

	// A failing event write leaves the row as it was: they commit together.
	broken := ev
	broken.UUID = "not-a-uuid"
	closed := row
	closed.Open, closed.OfflineSince, closed.OpenedAt = false, nil, nil
	if _, err = store.TransitionConnectivity(ctx, closed, broken); err == nil {
		t.Fatal("an invalid event id was stored")
	}

	loaded, err := store.LoadConnectivity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	index := slices.IndexFunc(loaded, func(r ConnectivityRow) bool { return r.SubjectKey == key })
	if index < 0 {
		t.Fatal("row not loaded")
	}
	got := loaded[index]
	if !got.Open || got.Episode != 1 || got.Cause != "death_certificate" || !got.OfflineSince.Equal(since) || !got.OpenedAt.Equal(opened) || !got.HeardSinceMonitoring || !slices.Equal(got.AffectedDeviceUUIDs, []string{device}) || got.OrganizationUUID != organization {
		t.Fatalf("loaded %+v", got)
	}

	// Rows without an open episode for subjects no longer monitored are pruned.
	waiting := ConnectivityRow{SubjectKey: "device:" + UUID(), OrganizationUUID: organization, Kind: "device", MonitoringSince: since}
	kept := ConnectivityRow{SubjectKey: "gateway:" + UUID() + "/edge-7", OrganizationUUID: organization, Kind: "gateway", MonitoringSince: since}
	if err = store.SaveConnectivity(ctx, []ConnectivityRow{waiting, kept}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.PruneConnectivity(ctx, []string{kept.SubjectKey}); err != nil {
		t.Fatal(err)
	}
	var keys []string
	rows, err := store.Pool.Query(ctx, "SELECT subject_key FROM device_runtime.connectivity WHERE organization_uuid=$1 ORDER BY subject_key", organization)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		keys = append(keys, k)
	}
	rows.Close()
	want := []string{key, kept.SubjectKey}
	slices.Sort(want)
	if !slices.Equal(keys, want) {
		t.Fatalf("after pruning %v, want %v (the open episode stays)", keys, want)
	}
}

func TestReportingSeedReadsDistinctRecentObservedTimesThatAreNotHistory(t *testing.T) {
	store, organization := connectivityStore(t)
	ctx := t.Context()
	now := time.Now().UTC().Truncate(time.Second)
	tracker := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	quiet := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	elsewhere := devices.Definition{DeviceUUID: tracker.DeviceUUID, OrganizationUUID: UUID(), ConfigurationUUID: UUID()}
	for _, d := range []devices.Definition{tracker, quiet} {
		if err := store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
			t.Fatal(err)
		}
	}
	battery, latitude := UUID(), UUID()
	reading := func(parameter string, observed, received time.Time, historical bool) devices.Reading {
		return devices.Reading{ParameterUUID: parameter, DataType: "number", Value: 1.0, Quality: "good", ObservedAt: observed, ReceivedAt: received, Historical: historical}
	}
	want := []time.Time{}
	for i := 70; i >= 0; i-- {
		observed := now.Add(-time.Duration(i) * time.Hour)
		// Two parameters per reading share an observed time: one time, not two.
		persistReading(t, store, tracker, reading(battery, observed, observed.Add(time.Minute), false))
		persistReading(t, store, tracker, reading(latitude, observed, observed.Add(time.Minute), false))
		want = append(want, observed)
	}
	// History and readings older than the window are not the device reporting.
	persistReading(t, store, tracker, reading(battery, now.Add(-30*time.Minute), now, true))
	persistReading(t, store, tracker, reading(battery, now.Add(-8*24*time.Hour), now.Add(-8*24*time.Hour), false))

	seed, err := store.ReportingSeed(ctx, []SeedDevice{{OrganizationUUID: organization, DeviceUUID: tracker.DeviceUUID}, {OrganizationUUID: organization, DeviceUUID: quiet.DeviceUUID}, {OrganizationUUID: elsewhere.OrganizationUUID, DeviceUUID: elsewhere.DeviceUUID}}, now.Add(-7*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	got := seed[tracker.DeviceUUID]
	want = want[len(want)-SeedLimit:]
	if len(got) != SeedLimit || !got[0].Equal(want[0]) || !got[len(got)-1].Equal(want[len(want)-1]) {
		t.Fatalf("seed has %d times from %v to %v, want %d from %s to %s", len(got), got[0], got[len(got)-1], SeedLimit, want[0], want[len(want)-1])
	}
	for i := 1; i < len(got); i++ {
		if got[i].Sub(got[i-1]) != time.Hour {
			t.Fatalf("gap %d is %s", i, got[i].Sub(got[i-1]))
		}
	}
	if len(seed[quiet.DeviceUUID]) != 0 || len(seed) != 1 {
		t.Fatalf("seeded devices without readings, or another organization's: %v", seed)
	}
}
