package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// BenchmarkPersistResult measures storing a ten-reading message, the hot path that
// data point counting adds an upsert to (spec 029 SC-004). Run with
// DEVICE_TEST_DATABASE_URL and -bench=PersistResult.
func BenchmarkPersistResult(b *testing.B) { benchmarkPersist(b, "") }

// BenchmarkPersistSourceStamped stores readings that carry the device's own
// timestamp, which the storing transaction first compares with what is stored. Its
// cost must not grow with the number of daily chunks the retention keeps.
func BenchmarkPersistSourceStamped(b *testing.B) { benchmarkPersist(b, "source") }

func benchmarkPersist(b *testing.B, timestampSource string) {
	databaseURL := os.Getenv("DEVICE_TEST_DATABASE_URL")
	if databaseURL == "" || !strings.Contains(databaseURL, "/iot_devices_test?") {
		b.Skip("Requires isolated Devices database")
	}
	ctx := b.Context()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		b.Fatal(err)
	}
	organization := UUID()
	b.Cleanup(func() {
		// b.Context() is cancelled before cleanups run, so the deletes need their own.
		cleanup := context.Background()
		for _, table := range []string{"telemetry_events", "telemetry_outbox", "observations", "diagnostics", "latest", "devices", "usage_data_points"} {
			_, _ = store.Pool.Exec(cleanup, "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", organization)
		}
		store.Pool.Close()
	})
	definition := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID()}
	if err := store.Apply(ctx, definition, 1, "device.applied.v1"); err != nil {
		b.Fatal(err)
	}
	parameters := make([]string, 10)
	for i := range parameters {
		parameters[i] = UUID()
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		now := time.Now().UTC()
		readings := make([]devices.Reading, len(parameters))
		for j, parameter := range parameters {
			readings[j] = devices.Reading{ParameterUUID: parameter, DataType: "number", Value: float64(i), Quality: "good", ObservedAt: now, ReceivedAt: now, TimestampSource: timestampSource}
		}
		if ok, err := store.PersistResult(ctx, devices.Telemetry{UUID: UUID(), Generation: 1, Definition: definition, SessionID: "bench", Readings: readings}); err != nil || !ok {
			b.Fatalf("persist failed: %v %v", ok, err)
		}
	}
}
