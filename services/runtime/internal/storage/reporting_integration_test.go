package storage

import (
	"math"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func persistReading(t *testing.T, store *Store, definition devices.Definition, reading devices.Reading) {
	t.Helper()
	ok, err := store.PersistResult(t.Context(), devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "reporting", Readings: []devices.Reading{reading}})
	if err != nil || !ok {
		t.Fatalf("persist failed: %v %v", ok, err)
	}
}

func countObservations(t *testing.T, store *Store, organization, parameter string) int {
	t.Helper()
	var count int
	if err := store.Pool.QueryRow(t.Context(), "SELECT count(*) FROM device_runtime.observations WHERE organization_uuid=$1 AND parameter_uuid=$2", organization, parameter).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestResentSourceSamplesAreStoredOnce(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	parameter := UUID()
	observed := time.Now().UTC().Add(-3 * time.Hour).Truncate(time.Millisecond)
	sample := devices.Reading{ParameterUUID: parameter, DataType: "number", Value: 42.5, Quality: "good", ObservedAt: observed, ReceivedAt: time.Now().UTC().Add(-time.Hour), TimestampSource: "source", Historical: true}
	persistReading(t, store, definition, sample)
	sample.ReceivedAt = time.Now().UTC()
	persistReading(t, store, definition, sample)
	if got := countObservations(t, store, organization, parameter); got != 1 {
		t.Fatalf("re-sent sample stored %d times", got)
	}

	// A different value at the same instant, or a receipt-timed sample, is new.
	sample.Value = 43.0
	persistReading(t, store, definition, sample)
	receipt := sample
	receipt.TimestampSource = "receipt"
	persistReading(t, store, definition, receipt)
	if got := countObservations(t, store, organization, parameter); got != 3 {
		t.Fatalf("distinct samples = %d, want 3", got)
	}
}

func TestHistoryPlacesBufferedSamplesAtObservedTime(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	parameter := UUID()
	now := time.Now().UTC().Truncate(time.Second)
	// A gateway uploads a two-hour backlog now.
	for i := 0; i < 4; i++ {
		observed := now.Add(-2*time.Hour + time.Duration(i)*30*time.Minute)
		persistReading(t, store, definition, devices.Reading{ParameterUUID: parameter, DataType: "number", Value: float64(10 + i), Quality: "good", ObservedAt: observed, ReceivedAt: now, TimestampSource: "source", Historical: true})
	}
	series, err := store.History(ctx, organization, definition.DeviceUUID, parameter, now.Add(-3*time.Hour), now, 100, HistoryOptions{ObservedTime: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 {
		t.Fatalf("series = %d", len(series))
	}
	points := []HistoryPoint{}
	for _, point := range series[0].Points {
		if point.Value != nil {
			points = append(points, point)
		}
	}
	if len(points) != 4 || points[0].At.After(now.Add(-110*time.Minute)) {
		t.Fatalf("backlog must spread over its observed times, got %d points starting %v", len(points), points)
	}
}

func TestCounterIncreaseHandlesResetsRolloversAndLocalDays(t *testing.T) {
	store, ctx, organization := historyStore(t)
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	parameter := UUID()
	vancouver, err := time.LoadLocation("America/Vancouver")
	if err != nil {
		t.Fatal(err)
	}
	unit := "kWh"
	day := time.Now().In(vancouver).AddDate(0, 0, -3)
	midnight := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, vancouver)
	samples := []struct {
		at    time.Time
		value float64
	}{
		{midnight.Add(-time.Hour), 990},      // carry sample on the previous local day
		{midnight.Add(time.Hour), 995},       // +5
		{midnight.Add(23 * time.Hour), 998},  // +3
		{midnight.Add(25 * time.Hour), 4},    // rollover at 1000: +6 on day two
		{midnight.Add(26 * time.Hour), 4},    // duplicate value: +0
		{midnight.Add(30 * time.Hour), 1},    // a meter reset mid-range
		{midnight.Add(47 * time.Hour), 11.5}, // +10.5
	}
	for _, sample := range samples {
		persistReading(t, store, definition, devices.Reading{ParameterUUID: parameter, DataType: "number", Unit: &unit, Value: sample.value, Quality: "good", ObservedAt: sample.at.UTC(), ReceivedAt: sample.at.UTC(), TimestampSource: "receipt"})
	}

	from := midnight
	to := midnight.AddDate(0, 0, 2)
	resets, err := store.CounterIncrease(ctx, organization, definition.DeviceUUID, parameter, from, to, "1d", vancouver, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resets.Points) != 2 || resets.Unit == nil || *resets.Unit != "kWh" {
		t.Fatalf("points = %+v", resets)
	}
	// Without a rollover value both decreases are resets that count from zero.
	if first, second := resets.Points[0], resets.Points[1]; first.Increase != 8 || second.Increase != 4+0+1+10.5 || second.Resets != 2 || !first.At.Equal(midnight) {
		t.Fatalf("reset increases = %+v", resets.Points)
	}

	rollover := 1000.0
	wraps, err := store.CounterIncrease(ctx, organization, definition.DeviceUUID, parameter, from, to, "1d", vancouver, &rollover)
	if err != nil {
		t.Fatal(err)
	}
	// 998 → 4 wraps (+6). 4 → 1 would imply using 997 of a 1000 range, so it
	// is a reset (+1), not a phantom wrap.
	if got := wraps.Points[1].Increase; math.Abs(got-(6+0+1+10.5)) > 1e-9 {
		t.Fatalf("rollover increase = %v", got)
	}
	if wraps.Points[0].Partial || wraps.Points[1].Partial {
		t.Fatalf("complete local days were marked partial: %+v", wraps.Points)
	}
}

func TestHistoryMergesConfigurationRevisionsOnlyWhenAsked(t *testing.T) {
	store, ctx, organization := historyStore(t)
	device, parameter := UUID(), UUID()
	first := devices.Definition{DeviceUUID: device, OrganizationUUID: organization, ConfigurationUUID: UUID()}
	second := first
	second.ConfigurationUUID = UUID()
	unit := "kW"
	now := time.Now().UTC().Truncate(time.Second)
	if err := store.Apply(ctx, first, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	persistReading(t, store, first, devices.Reading{ParameterUUID: parameter, DataType: "number", Unit: &unit, Value: 10.0, Quality: "good", ObservedAt: now.Add(-50 * time.Minute), ReceivedAt: now.Add(-50 * time.Minute)})
	if err := store.Apply(ctx, second, 2, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	ok, err := store.PersistResult(ctx, devices.Telemetry{UUID: UUID(), Generation: 2, Definition: second, SessionID: "reporting", Readings: []devices.Reading{{ParameterUUID: parameter, DataType: "number", Unit: &unit, Value: 12.0, Quality: "good", ObservedAt: now.Add(-10 * time.Minute), ReceivedAt: now.Add(-10 * time.Minute)}}})
	if err != nil || !ok {
		t.Fatalf("persist second configuration: %v %v", ok, err)
	}

	separate, err := store.History(ctx, organization, device, parameter, now.Add(-time.Hour), now, 100, HistoryOptions{})
	if err != nil || len(separate) != 2 {
		t.Fatalf("the default keeps one series per configuration: %d %v", len(separate), err)
	}
	merged, err := store.History(ctx, organization, device, parameter, now.Add(-time.Hour), now, 100, HistoryOptions{ObservedTime: true, MergeConfigurations: true})
	if err != nil || len(merged) != 1 {
		t.Fatalf("revisions with one unit merge into one series: %d %v", len(merged), err)
	}
	spans := merged[0].Configurations
	if len(spans) != 2 || spans[0].ConfigurationUUID != first.ConfigurationUUID || spans[1].ConfigurationUUID != second.ConfigurationUUID || merged[0].ConfigurationUUID != second.ConfigurationUUID {
		t.Fatalf("spans = %+v, newest = %s", spans, merged[0].ConfigurationUUID)
	}
}

func TestLatestAcrossFallsBackToEarlierConfigurations(t *testing.T) {
	store, ctx, organization := historyStore(t)
	device, power, flag := UUID(), UUID(), UUID()
	first := devices.Definition{DeviceUUID: device, OrganizationUUID: organization, ConfigurationUUID: UUID()}
	second := first
	second.ConfigurationUUID = UUID()
	now := time.Now().UTC().Truncate(time.Second)
	if err := store.Apply(ctx, first, 1, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	persistReading(t, store, first, devices.Reading{ParameterUUID: power, DataType: "number", Value: 41.0, Quality: "good", ObservedAt: now.Add(-time.Hour), ReceivedAt: now.Add(-time.Hour)})
	persistReading(t, store, first, devices.Reading{ParameterUUID: flag, DataType: "boolean", Value: true, Quality: "good", ObservedAt: now.Add(-time.Hour), ReceivedAt: now.Add(-time.Hour)})
	if err := store.Apply(ctx, second, 2, "device.applied.v1"); err != nil {
		t.Fatal(err)
	}
	ok, err := store.PersistResult(ctx, devices.Telemetry{UUID: UUID(), Generation: 2, Definition: second, SessionID: "reporting", Readings: []devices.Reading{{ParameterUUID: power, DataType: "number", Value: 43.0, Quality: "good", ObservedAt: now, ReceivedAt: now}}})
	if err != nil || !ok {
		t.Fatalf("persist: %v %v", ok, err)
	}

	carried, err := store.LatestAcross(ctx, organization, device, second.ConfigurationUUID)
	if err != nil || len(carried) != 2 {
		t.Fatalf("carried = %+v %v", carried, err)
	}
	for _, c := range carried {
		switch c.Reading.ParameterUUID {
		case power:
			if c.ConfigurationUUID != second.ConfigurationUUID {
				t.Fatalf("the current configuration's value wins: %+v", c)
			}
		case flag:
			if c.ConfigurationUUID != first.ConfigurationUUID || c.Reading.Value != true {
				t.Fatalf("a parameter without a current value falls back: %+v", c)
			}
		}
	}
}
