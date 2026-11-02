package storage

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestOlderInstallsMoveToTheTwoDayCompressionPolicy(t *testing.T) {
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
	// An install from before this change compresses after seven days.
	if _, err = s.Pool.Exec(ctx, `SELECT remove_compression_policy('device_runtime.observations');
		SELECT add_compression_policy('device_runtime.observations', compress_after => INTERVAL '7 days')`); err != nil {
		t.Fatal(err)
	}
	s.Pool.Close()
	for range 2 {
		if s, err = Open(ctx, url); err != nil {
			t.Fatal(err)
		}
		var policies int
		var after string
		err = s.Pool.QueryRow(ctx, `SELECT count(*), coalesce(min((config->>'compress_after')::interval)::text, '') FROM timescaledb_information.jobs
			WHERE proc_name='policy_compression' AND hypertable_schema='device_runtime' AND hypertable_name='observations'`).Scan(&policies, &after)
		s.Pool.Close()
		if err != nil || policies != 1 || after != "2 days" {
			t.Fatalf("want one two-day policy, got %d %q %v", policies, after, err)
		}
	}
}
