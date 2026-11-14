package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// The telemetry stream's storage reads (spec 030, T046): catch-up by organization,
// device set and sequence in storage order, paged; the floor and head per
// organization, and their absence for an organization with nothing retained.
func TestCommittedAfterFloorAndHead(t *testing.T) {
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
	org, other, empty := UUID(), UUID(), UUID()
	defer func() {
		for _, table := range []string{"telemetry_events", "telemetry_outbox", "observations", "diagnostics", "latest", "devices"} {
			_, err := s.Pool.Exec(ctx, "DELETE FROM device_runtime."+table+" WHERE organization_uuid IN ($1,$2)", org, other)
			must(err)
		}
		_, err := s.Pool.Exec(ctx, "DELETE FROM device_runtime.outbox WHERE event->'payload'->>'organization_uuid' IN ($1,$2)", org, other)
		must(err)
	}()
	pump := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	valve := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: org, ConfigurationUUID: UUID()}
	foreign := devices.Definition{DeviceUUID: UUID(), OrganizationUUID: other, ConfigurationUUID: UUID()}
	for _, d := range []devices.Definition{pump, valve, foreign} {
		must(s.Apply(ctx, d, 1, "device.applied.v1"))
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	persist := func(d devices.Definition, n int) {
		t.Helper()
		for i := 0; i < n; i++ {
			must(s.Persist(ctx, devices.Telemetry{UUID: UUID(), Definition: d, Generation: 1, Readings: []devices.Reading{{ParameterUUID: UUID(), Key: "flow", DataType: "number", Value: i, Quality: "good", ObservedAt: now, ReceivedAt: now}}}))
		}
	}
	persist(pump, 3)
	persist(foreign, 1)
	persist(valve, 2)
	persist(pump, 1)

	// Catch-up from 0 for both devices: six rows in storage order, each carrying its
	// own sequence and the device it belongs to; the foreign organization's row is absent.
	all, err := s.CommittedAfter(ctx, org, []string{pump.DeviceUUID, valve.DeviceUUID}, 0, 500)
	must(err)
	if len(all) != 6 {
		t.Fatalf("expected 6 rows, got %d", len(all))
	}
	for i := 1; i < len(all); i++ {
		if all[i].Sequence <= all[i-1].Sequence {
			t.Fatalf("rows must be in sequence order: %d after %d", all[i].Sequence, all[i-1].Sequence)
		}
	}
	for _, row := range all {
		if row.Event.OrganizationUUID != org || row.Event.Sequence == "" || (row.Event.DeviceUUID != pump.DeviceUUID && row.Event.DeviceUUID != valve.DeviceUUID) {
			t.Fatalf("unexpected row %+v", row.Event)
		}
	}
	if all[3].Event.DeviceUUID != valve.DeviceUUID || all[5].Event.DeviceUUID != pump.DeviceUUID {
		t.Fatalf("storage order interleaves devices as they were persisted: %v", all)
	}

	// One device only, after a position, in pages of two.
	page, err := s.CommittedAfter(ctx, org, []string{pump.DeviceUUID}, all[0].Sequence, 2)
	must(err)
	if len(page) != 2 || page[0].Sequence != all[1].Sequence || page[1].Sequence != all[2].Sequence {
		t.Fatalf("expected the pump's second and third rows, got %v", page)
	}
	page, err = s.CommittedAfter(ctx, org, []string{pump.DeviceUUID}, page[1].Sequence, 2)
	must(err)
	if len(page) != 1 || page[0].Sequence != all[5].Sequence {
		t.Fatalf("expected the pump's last row only, got %v", page)
	}
	page, err = s.CommittedAfter(ctx, org, []string{pump.DeviceUUID}, all[5].Sequence, 2)
	must(err)
	if len(page) != 0 {
		t.Fatalf("nothing after the last row, got %v", page)
	}

	// The floor and head are the organization's own, across its devices.
	floor, ok, err := s.CommittedFloor(ctx, org)
	must(err)
	if !ok || floor != all[0].Sequence {
		t.Fatalf("floor: expected %d, got %d (ok %v)", all[0].Sequence, floor, ok)
	}
	head, err := s.CommittedHead(ctx, org)
	must(err)
	if head != all[5].Sequence {
		t.Fatalf("head: expected %d, got %d", all[5].Sequence, head)
	}
	if _, ok, err = s.CommittedFloor(ctx, empty); err != nil || ok {
		t.Fatalf("an organization with nothing retained has no floor (ok %v, err %v)", ok, err)
	}
	if head, err = s.CommittedHead(ctx, empty); err != nil || head != 0 {
		t.Fatalf("an organization with nothing retained has head 0, got %d (err %v)", head, err)
	}
	rows, err := s.CommittedAfter(ctx, empty, []string{pump.DeviceUUID}, 0, 10)
	must(err)
	if len(rows) != 0 {
		t.Fatalf("another organization never sees these devices: %v", rows)
	}
}
