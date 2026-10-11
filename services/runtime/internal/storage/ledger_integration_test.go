package storage

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLedgersArePrunedOutsideTheRedeliveryWindow(t *testing.T) {
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
	now := time.Now().UTC()
	org := UUID()
	expired, recent, pending := UUID(), UUID(), UUID()
	expiredInput, recentInput := UUID(), UUID()
	oldCommitted, unpublishedCommitted, windowCommitted := UUID(), UUID(), UUID()
	t.Cleanup(func() {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.outbox WHERE uuid IN ($1,$2,$3)`, expired, recent, pending)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.rule_inputs WHERE event_uuid IN ($1,$2)`, expiredInput, recentInput)
		_, _ = s.Pool.Exec(ctx, `DELETE FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1`, org)
	})
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	day := 24 * time.Hour
	must(exec(ctx, s, `INSERT INTO device_runtime.outbox(uuid,event,created_at,published_at) VALUES ($1,'{}',$4,$4),($2,'{}',$5,$5),($3,'{}',$6,NULL)`,
		expired, recent, pending, now.Add(-9*day), now.Add(-day), now.Add(-30*day)))
	must(exec(ctx, s, `INSERT INTO device_runtime.rule_inputs(event_uuid,consumed_at) VALUES ($1,$3),($2,$4)`,
		expiredInput, recentInput, now.Add(-9*day), now.Add(-day)))
	must(exec(ctx, s, `INSERT INTO device_runtime.telemetry_outbox(telemetry_uuid,organization_uuid,event,created_at,published_at) VALUES ($1,$4,'{}',$5,$5),($2,$4,'{}',$5,NULL),($3,$4,'{}',$6,$6)`,
		oldCommitted, unpublishedCommitted, windowCommitted, org, now.Add(-30*day), now.Add(-3*day)))

	if _, err = s.PruneLedgers(ctx, now); err != nil {
		t.Fatal(err)
	}
	remaining := func(query string, ids ...any) []string {
		t.Helper()
		rows, err := s.Pool.Query(ctx, query, ids...)
		must(err)
		defer rows.Close()
		found := []string{}
		for rows.Next() {
			var id string
			must(rows.Scan(&id))
			found = append(found, id)
		}
		must(rows.Err())
		return found
	}
	if got := remaining(`SELECT uuid::text FROM device_runtime.outbox WHERE uuid IN ($1,$2,$3) ORDER BY created_at`, expired, recent, pending); len(got) != 2 || got[0] != pending || got[1] != recent {
		t.Fatalf("outbox kept %v; want the unpublished and the recent event only", got)
	}
	if got := remaining(`SELECT event_uuid::text FROM device_runtime.rule_inputs WHERE event_uuid IN ($1,$2)`, expiredInput, recentInput); len(got) != 1 || got[0] != recentInput {
		t.Fatalf("rule inputs kept %v; want only the recent marker", got)
	}

	// A two-day retention removes published committed events older than the
	// eight-day redelivery window, never unpublished ones or ones inside it.
	if _, err = s.Cleanup(ctx, org, now.Add(-2*day)); err != nil {
		t.Fatal(err)
	}
	got := remaining(`SELECT telemetry_uuid::text FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1 ORDER BY created_at, published_at NULLS FIRST`, org)
	if len(got) != 2 || got[0] != unpublishedCommitted || got[1] != windowCommitted {
		t.Fatalf("committed events kept %v; want the unpublished and in-window events", got)
	}
}

func exec(ctx context.Context, s *Store, query string, args ...any) error {
	_, err := s.Pool.Exec(ctx, query, args...)
	return err
}
