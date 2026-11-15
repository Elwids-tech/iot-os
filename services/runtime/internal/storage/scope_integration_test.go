package storage

import (
	"slices"
	"testing"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// A runtime owns every connection today (the zero Scope). These hold the narrower
// scope a runtime sharded by connection will use to what it owns (ADR-046).

func scopeFixture(t *testing.T) (store *Store, organization, mine, theirs string, own, other devices.Definition) {
	t.Helper()
	store, organization = connectivityStore(t)
	ctx := t.Context()
	mine, theirs = UUID(), UUID()
	own = devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID(), Source: devices.Source{ConnectionUUID: mine, GroupID: "g", EdgeNodeID: "edge", DeviceID: "a"}}
	other = devices.Definition{DeviceUUID: UUID(), OrganizationUUID: organization, ConfigurationUUID: UUID(), Source: devices.Source{ConnectionUUID: theirs, GroupID: "h", EdgeNodeID: "edge", DeviceID: "b"}}
	for _, d := range []devices.Definition{own, other} {
		if err := store.Apply(ctx, d, 1, "device.applied.v1"); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, table := range []string{"commands", "devices"} {
			_, _ = store.Pool.Exec(t.Context(), "DELETE FROM device_runtime."+table+" WHERE organization_uuid=$1", organization)
		}
	})
	return store, organization, mine, theirs, own, other
}

func TestCommandSweepsSettleOnlyTheCommandsOfTheirConnections(t *testing.T) {
	store, organization, mine, _, own, other := scopeFixture(t)
	ctx := t.Context()
	expires := time.Now().Add(time.Minute)
	ours := devices.Command{UUID: UUID(), OrganizationUUID: organization, DeviceUUID: own.DeviceUUID, ParameterUUID: UUID(), ConfigurationUUID: own.ConfigurationUUID, ExpiresAt: expires}
	theirs := devices.Command{UUID: UUID(), OrganizationUUID: organization, DeviceUUID: other.DeviceUUID, ParameterUUID: UUID(), ConfigurationUUID: other.ConfigurationUUID, ExpiresAt: expires}
	for _, c := range []devices.Command{ours, theirs} {
		if claimed, err := store.ClaimCommand(ctx, c); err != nil || !claimed {
			t.Fatalf("claim: %v %v", claimed, err)
		}
	}
	status := func(c devices.Command) string {
		t.Helper()
		var status string
		if err := store.Pool.QueryRow(ctx, "SELECT status FROM device_runtime.commands WHERE command_uuid=$1", c.UUID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		return status
	}
	outstanding := func(scope Scope) []string {
		t.Helper()
		commands, err := store.Outstanding(ctx, scope)
		if err != nil {
			t.Fatal(err)
		}
		found := []string{}
		for _, c := range commands {
			if c.UUID == ours.UUID || c.UUID == theirs.UUID {
				found = append(found, c.UUID)
			}
		}
		slices.Sort(found)
		return found
	}
	both := []string{ours.UUID, theirs.UUID}
	slices.Sort(both)
	if got := outstanding(Scope{}); !slices.Equal(got, both) {
		t.Fatalf("every connection: %v, want both commands", got)
	}
	scope := Scope{Connections: []string{mine}}
	if got := outstanding(scope); !slices.Equal(got, []string{ours.UUID}) {
		t.Fatalf("one connection: %v, want only its command", got)
	}
	if got := outstanding(Scope{Connections: []string{}}); len(got) != 0 {
		t.Fatalf("no connection: %v, want none", got)
	}
	if err := store.RecoverCommands(ctx, scope); err != nil {
		t.Fatal(err)
	}
	if status(ours) != "uncertain" || status(theirs) != "dispatching" {
		t.Fatalf("after one connection's runtime restarted: ours %s, theirs %s", status(ours), status(theirs))
	}
}

func TestConnectivityRowsAreLoadedAndPrunedByConnection(t *testing.T) {
	store, organization, mine, theirs, own, other := scopeFixture(t)
	ctx := t.Context()
	since := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	orphan := "device:" + UUID() // no applied definition, so no connection
	keys := []string{
		"gateway:" + mine + "/edge", "gateway:" + mine + "/edge@" + UUID(), "device:" + own.DeviceUUID,
		"gateway:" + theirs + "/edge", "device:" + other.DeviceUUID, orphan,
	}
	rows := []ConnectivityRow{}
	for _, key := range keys {
		kind := "device"
		if key[0] == 'g' {
			kind = "gateway"
		}
		rows = append(rows, ConnectivityRow{SubjectKey: key, OrganizationUUID: organization, Kind: kind, MonitoringSince: since})
	}
	if err := store.SaveConnectivity(ctx, rows); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(t.Context(), "DELETE FROM device_runtime.connectivity WHERE organization_uuid=$1", organization)
	})
	stored := func(scope Scope) []string {
		t.Helper()
		loaded, err := store.LoadConnectivity(ctx, scope)
		if err != nil {
			t.Fatal(err)
		}
		found := []string{}
		for _, row := range loaded {
			if slices.Contains(keys, row.SubjectKey) {
				found = append(found, row.SubjectKey)
			}
		}
		slices.Sort(found)
		return found
	}
	sorted := func(keys ...string) []string {
		keys = slices.Clone(keys)
		slices.Sort(keys)
		return keys
	}
	scope := Scope{Connections: []string{mine}}
	if got, want := stored(scope), sorted(keys[0], keys[1], keys[2]); !slices.Equal(got, want) {
		t.Fatalf("one connection loads %v, want %v", got, want)
	}
	if got := stored(Scope{}); !slices.Equal(got, sorted(keys...)) {
		t.Fatalf("every connection loads %v, want all six", got)
	}
	// One connection's runtime keeps its device and prunes the rest of what it owns.
	if _, err := store.PruneConnectivity(ctx, scope, []string{keys[2]}); err != nil {
		t.Fatal(err)
	}
	if got, want := stored(Scope{}), sorted(keys[2], keys[3], keys[4], orphan); !slices.Equal(got, want) {
		t.Fatalf("after one connection pruned: %v, want %v", got, want)
	}
}
